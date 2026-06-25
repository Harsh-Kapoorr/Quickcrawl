"""Tests for the soft-dedup query in jobs.create_batch."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api import jobs as jobs_api


def _make_db(jobs_returned: list):
    """Build a stand-in for AsyncSession where `await db.execute(stmt)` returns
    a chainable `.scalars().all()` mock."""
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = jobs_returned
    # AsyncMock for `execute` so `await db.execute(...)` works; side_effect
    # returns the pre-built result.
    async_execute = AsyncMock(return_value=result)
    db.execute = async_execute
    return db


def _recent_job(url: str, status: str, minutes_ago: int = 5, batch_id: int = 999):
    return SimpleNamespace(
        url=url,
        property_url="https://example.com/",
        status=status,
        created_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
        submitted_at=(
            datetime.now(UTC) - timedelta(minutes=minutes_ago)
            if status == "submitted"
            else None
        ),
        batch_id=batch_id,
    )


@pytest.mark.asyncio
async def test_dedup_returns_recent_submitted() -> None:
    db = _make_db(
        [_recent_job("https://example.com/a", "submitted", minutes_ago=5)]
    )
    result = await jobs_api._recently_submitted_urls(
        db,
        sub="user-1",
        groups={"https://example.com/": ["https://example.com/a"]},
        exclude_batch_ids=set(),
        window_hours=1,
    )
    assert len(result) == 1
    assert result[0]["url"] == "https://example.com/a"
    assert result[0]["status"] == "submitted"


@pytest.mark.asyncio
async def test_dedup_excludes_current_batch() -> None:
    db = _make_db(
        [_recent_job("https://example.com/a", "submitted", minutes_ago=5)]
    )
    result = await jobs_api._recently_submitted_urls(
        db,
        sub="user-1",
        groups={"https://example.com/": ["https://example.com/a"]},
        exclude_batch_ids={999},
        window_hours=1,
    )
    assert result == []


@pytest.mark.asyncio
async def test_dedup_window_disabled() -> None:
    db = _make_db([])
    result = await jobs_api._recently_submitted_urls(
        db,
        sub="user-1",
        groups={"https://example.com/": ["https://example.com/a"]},
        exclude_batch_ids=set(),
        window_hours=0,
    )
    assert result == []
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_dedup_groups_by_property() -> None:
    db = _make_db([])
    await jobs_api._recently_submitted_urls(
        db,
        sub="user-1",
        groups={"https://example.com/": ["https://example.com/page"]},
        exclude_batch_ids=set(),
        window_hours=1,
    )
    call_args = db.execute.call_args
    stmt = call_args[0][0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "https://example.com/" in compiled
    assert "https://example.com/page" in compiled
