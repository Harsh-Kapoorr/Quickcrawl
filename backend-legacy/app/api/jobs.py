"""Jobs and batches endpoints."""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.session import require_session
from app.config import get_settings
from app.db.database import get_session, get_write_lock
from app.db.models import Batch, Job, JobStatus, PublishType
from app.security import (
    URLValidationError,
    enforce_batch_submit_rate,
    validate_urls_against_properties,
)
from app.worker.queue import enqueue_batch

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.post("/batch")
async def create_batch(
    payload: dict,
    request: Request,
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
    _rl: None = Depends(enforce_batch_submit_rate),
) -> dict:
    """Create a new batch and queue its jobs."""
    urls = payload.get("urls")
    if not isinstance(urls, list) or not all(isinstance(u, str) for u in urls):
        raise HTTPException(status_code=400, detail="urls must be a list of strings")

    # `name` is optional. If present it must be a non-empty string; otherwise
    # SQLAlchemy will raise when assigning a non-string value to the column.
    raw_name = payload.get("name")
    if raw_name is not None and not isinstance(raw_name, str):
        raise HTTPException(status_code=400, detail="name must be a string")
    name = (raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else None) or (
        f"Batch {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')}"
    )
    publish_type_raw = payload.get("publish_type", PublishType.URL_UPDATED.value)
    if publish_type_raw not in (PublishType.URL_UPDATED.value, PublishType.URL_DELETED.value):
        raise HTTPException(status_code=400, detail="publish_type must be URL_UPDATED or URL_DELETED")
    publish_type = PublishType(publish_type_raw)

    try:
        url_to_property = await validate_urls_against_properties(urls, db, sub)
    except URLValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    groups: dict[str, list[str]] = {}
    for url, prop in url_to_property.items():
        groups.setdefault(prop, []).append(url)

    batch_ids: list[int] = []
    deduped_count = len(url_to_property)
    async with get_write_lock():
        for prop_site, prop_urls in groups.items():
            batch = Batch(
                name=name,
                google_sub=sub,
                property_url=prop_site,
                publish_type=publish_type.value,
                total=len(prop_urls),
                pending=len(prop_urls),
            )
            db.add(batch)
            await db.flush()
            jobs = [
                Job(
                    batch_id=batch.id,  # type: ignore[arg-type]
                    url=u,
                    property_url=prop_site,
                    publish_type=publish_type.value,
                    status=JobStatus.PENDING,
                )
                for u in prop_urls
            ]
            db.add_all(jobs)
            await db.commit()
            await db.refresh(batch)
            await enqueue_batch(db, jobs)
            batch_ids.append(batch.id)  # type: ignore[arg-type]

    # Soft dedup: surface (but don't block) URLs we successfully submitted
    # for the same property within the dedup window.
    settings = get_settings()
    recently_submitted = await _recently_submitted_urls(
        db,
        sub=sub,
        groups=groups,
        exclude_batch_ids=set(batch_ids),
        window_hours=settings.dedup_window_hours,
    )

    return {
        "batch_ids": batch_ids,
        "total_urls": deduped_count,
        "recently_submitted": recently_submitted,
    }


async def _recently_submitted_urls(
    db: AsyncSession,
    *,
    sub: str,
    groups: dict[str, list[str]],
    exclude_batch_ids: set[int],
    window_hours: int,
) -> list[dict]:
    """Find URLs that this user has recently submitted for the same property.

    Surfaces (but doesn't block) duplicates within `window_hours`.
    Returns one record per (url, property) pair, sorted by last_seen desc.
    """
    if window_hours <= 0:
        return []
    cutoff = datetime.now(UTC) - timedelta(hours=window_hours)
    results: list[dict] = []
    for prop_site, prop_urls in groups.items():
        rows = (
            await db.execute(
                select(Job)
                .join(Batch, Job.batch_id == Batch.id)  # type: ignore[arg-type]
                .where(Batch.google_sub == sub)
                .where(Job.url.in_(prop_urls))
                .where(Job.property_url == prop_site)
                .where(
                    Job.status.in_(
                        [
                            JobStatus.SUBMITTED,
                            JobStatus.PROCESSING,
                            JobStatus.PENDING,
                        ]
                    )
                )
                .where(Job.created_at >= cutoff)
            )
        ).scalars().all()
        for r in rows:
            if r.batch_id in exclude_batch_ids:
                continue
            results.append(
                {
                    "url": r.url,
                    "property_url": r.property_url,
                    "status": r.status,
                    "last_submitted_at": r.submitted_at.isoformat()
                    if r.submitted_at
                    else None,
                    "last_seen_at": r.created_at.isoformat(),
                    "batch_id": r.batch_id,
                }
            )
    # Most recently seen first
    results.sort(key=lambda d: d["last_seen_at"], reverse=True)
    return results


@router.get("")
async def list_jobs(
    status: str | None = Query(default=None),
    batch_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """List jobs for the current user, optionally filtered."""
    stmt = (
        select(Job)
        .join(Batch, Job.batch_id == Batch.id)  # type: ignore[arg-type]
        .where(Batch.google_sub == sub)
    )
    if status:
        stmt = stmt.where(Job.status == status)
    if batch_id:
        stmt = stmt.where(Job.batch_id == batch_id)
    stmt = stmt.order_by(Job.created_at.desc()).offset(offset).limit(limit)

    rows = (await db.execute(stmt)).scalars().all()
    count_stmt = (
        select(func.count(Job.id))  # type: ignore[arg-type]
        .join(Batch, Job.batch_id == Batch.id)  # type: ignore[arg-type]
        .where(Batch.google_sub == sub)
    )
    if status:
        count_stmt = count_stmt.where(Job.status == status)
    total = (await db.execute(count_stmt)).scalar_one()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": r.id,
                "batch_id": r.batch_id,
                "url": r.url,
                "property_url": r.property_url,
                "status": r.status,
                "attempts": r.attempts,
                "last_error": r.last_error,
                "http_status": r.http_status,
                "google_notify_time": r.google_notify_time.isoformat()
                if r.google_notify_time
                else None,
                "created_at": r.created_at.isoformat(),
                "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in rows
        ],
    }


@router.get("/batch/{batch_id}")
async def get_batch(
    batch_id: int,
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
) -> dict:
    batch = await db.get(Batch, batch_id)
    if batch is None or batch.google_sub != sub:
        raise HTTPException(status_code=404, detail="batch not found")

    jobs = (
        await db.execute(
            select(Job).where(Job.batch_id == batch_id).order_by(Job.created_at)
        )
    ).scalars().all()
    return {
        "id": batch.id,
        "name": batch.name,
        "property_url": batch.property_url,
        "publish_type": batch.publish_type,
        "total": batch.total,
        "pending": batch.pending,
        "processing": batch.processing,
        "succeeded": batch.succeeded,
        "failed": batch.failed,
        "created_at": batch.created_at.isoformat(),
        "jobs": [
            {
                "id": j.id,
                "url": j.url,
                "status": j.status,
                "attempts": j.attempts,
                "last_error": j.last_error,
                "http_status": j.http_status,
                "google_notify_time": j.google_notify_time.isoformat()
                if j.google_notify_time
                else None,
                "submitted_at": j.submitted_at.isoformat() if j.submitted_at else None,
                "completed_at": j.completed_at.isoformat() if j.completed_at else None,
            }
            for j in jobs
        ],
    }


@router.get("/batches")
async def list_batches(
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    rows = (
        await db.execute(
            select(Batch)
            .where(Batch.google_sub == sub)
            .order_by(Batch.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    return {
        "items": [
            {
                "id": b.id,
                "name": b.name,
                "property_url": b.property_url,
                "publish_type": b.publish_type,
                "total": b.total,
                "pending": b.pending,
                "processing": b.processing,
                "succeeded": b.succeeded,
                "failed": b.failed,
                "cancelled": b.cancelled,
                "created_at": b.created_at.isoformat(),
            }
            for b in rows
        ]
    }


@router.post("/{job_id}/requeue")
async def requeue_job(
    job_id: int,
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
) -> dict:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    batch = await db.get(Batch, job.batch_id)
    if batch is None or batch.google_sub != sub:
        raise HTTPException(status_code=404, detail="job not found")
    if job.status != JobStatus.FAILED.value:
        raise HTTPException(status_code=400, detail=f"only failed jobs can be requeued (current: {job.status})")

    async with get_write_lock():
        job.status = JobStatus.PENDING
        job.attempts = 0
        job.last_error = None
        job.next_attempt_at = datetime.now(UTC)
        batch.failed = max(batch.failed - 1, 0)
        batch.pending += 1
        db.add(job)
        db.add(batch)
        await db.commit()
        await enqueue_batch(db, [job])
    return {"ok": True, "job_id": job_id}


# silence unused-import warning for json (kept for future use)
_ = json
