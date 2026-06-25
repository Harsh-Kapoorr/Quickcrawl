"""Quota usage endpoint."""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.session import require_session
from app.config import get_settings
from app.db.database import get_session
from app.db.models import QuotaUsage

router = APIRouter(prefix="/api/quota", tags=["quota"])


def _today_utc() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


@router.get("")
async def quota(
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Today's usage and limit (per UTC day)."""
    today = _today_utc()
    row = (
        await db.execute(select(QuotaUsage).where(QuotaUsage.day == today))
    ).scalar_one_or_none()
    used = row.count if row else 0
    limit = get_settings().daily_quota
    return {
        "date": today,
        "used": used,
        "limit": limit,
        "remaining": max(limit - used, 0),
    }
