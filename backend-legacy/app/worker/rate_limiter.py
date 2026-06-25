"""Daily quota tracking and per-second rate limiting.

Two layers:
  - Daily quota: hard cap from settings.daily_quota (Google's default 200).
    Tracks per-UTC-day call count in the `quota_usage` table.
  - Token bucket: enforces a minimum gap between successive requests
    so we don't burst and trip 429s.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import QuotaUsage


def _today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


async def get_usage(db: AsyncSession) -> int:
    row = (
        await db.execute(select(QuotaUsage).where(QuotaUsage.day == _today()))
    ).scalar_one_or_none()
    return row.count if row else 0


async def quota_exhausted(db: AsyncSession) -> bool:
    return (await get_usage(db)) >= get_settings().daily_quota


async def record_request(db: AsyncSession) -> None:
    today = _today()
    row = (
        await db.execute(select(QuotaUsage).where(QuotaUsage.day == today))
    ).scalar_one_or_none()
    now = datetime.now(UTC)
    if row is None:
        db.add(QuotaUsage(day=today, count=1, last_request_at=now))
    else:
        row.count += 1
        row.last_request_at = now
        db.add(row)
    await db.commit()


class RateLimiter:
    """Simple async token bucket. Singleton across worker lifetime."""

    def __init__(self, min_interval: float) -> None:
        self._min_interval = min_interval
        self._lock = asyncio.Lock()
        self._last_call = 0.0

    async def wait(self) -> None:
        if self._min_interval <= 0:
            return
        async with self._lock:
            now = asyncio.get_event_loop().time()
            gap = now - self._last_call
            if gap < self._min_interval:
                await asyncio.sleep(self._min_interval - gap)
            self._last_call = asyncio.get_event_loop().time()


_rate_limiter: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter(get_settings().min_request_interval)
    return _rate_limiter
