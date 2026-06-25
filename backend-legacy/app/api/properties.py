"""Properties endpoints: list/sync Search Console sites."""
from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.session import require_session
from app.db.database import get_session, get_write_lock
from app.db.models import Batch, Job, JobStatus, Property
from app.google.client import GoogleAPIError
from app.google.searchconsole import list_sites
from app.security import enforce_property_sync_rate

# Job ownership in this schema goes via Job.batch_id -> Batch.google_sub.
# Any UPDATE on Job must JOIN Batch and filter by google_sub, otherwise a
# single-user property sync can mutate (or in this case, cancel) jobs that
# belong to a different tenant sharing the same property URL.

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/properties", tags=["properties"])


@router.get("")
async def get_properties(
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (
        await db.execute(select(Property).where(Property.google_sub == sub))
    ).scalars().all()
    return [
        {
            "site_url": r.site_url,
            "permission_level": r.permission_level,
            "last_synced": r.last_synced.isoformat(),
        }
        for r in rows
    ]


@router.post("/sync")
async def sync_properties(
    request: Request,
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
    _rl: None = Depends(enforce_property_sync_rate),
) -> dict:
    """Fetch the user's verified sites from Google and store them."""
    try:
        sites = await list_sites(db, sub)
    except GoogleAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    now = datetime.now(UTC)
    async with get_write_lock():
        existing = {
            p.site_url: p
            for p in (
                await db.execute(select(Property).where(Property.google_sub == sub))
            ).scalars().all()
        }
        seen: set[str] = set()
        added = 0
        updated = 0
        for entry in sites:
            site_url = entry.get("siteUrl", "")
            if not site_url or site_url in seen:
                continue
            seen.add(site_url)
            perm = entry.get("permissionLevel", "siteOwner")
            if site_url in existing:
                p = existing[site_url]
                if p.permission_level != perm:
                    p.permission_level = perm
                    p.last_synced = now
                    db.add(p)
                    updated += 1
            else:
                db.add(
                    Property(
                        google_sub=sub,
                        site_url=site_url,
                        permission_level=perm,
                        last_synced=now,
                    )
                )
                added += 1

        removed = 0
        cancelled_jobs = 0
        for site_url, p in existing.items():
            if site_url not in seen:
                for old_status in (JobStatus.PENDING, JobStatus.PROCESSING):
                    # IMPORTANT: scope by Batch.google_sub so we only touch
                    # jobs owned by the current user. Without this filter,
                    # any other tenant sharing the same property URL would
                    # have their jobs silently cancelled.
                    res = await db.execute(
                        update(Job)
                        .where(Job.batch_id == Batch.id)  # type: ignore[arg-type]
                        .where(Batch.google_sub == sub)
                        .where(Job.property_url == site_url)
                        .where(Job.status == old_status)
                        .values(
                            status=JobStatus.CANCELLED,
                            last_error="property removed",
                            completed_at=now,
                        )
                        .returning(Job.batch_id)
                    )
                    batch_ids = list(res.scalars().all())
                    if not batch_ids:
                        continue
                    cancelled_jobs += len(batch_ids)
                    col = "pending" if old_status == JobStatus.PENDING else "processing"
                    for batch_id in batch_ids:
                        batch = await db.get(Batch, batch_id)
                        if batch is None or batch.google_sub != sub:
                            continue
                        setattr(batch, col, max(getattr(batch, col) - 1, 0))
                        batch.cancelled += 1
                        db.add(batch)
                await db.delete(p)
                removed += 1

        if cancelled_jobs:
            log.info(
                "property sync cancelled %d jobs belonging to removed properties",
                cancelled_jobs,
            )

        await db.commit()

    return {
        "added": added,
        "updated": updated,
        "removed": removed,
        "cancelled_jobs": cancelled_jobs,
        "total": len(seen),
    }
