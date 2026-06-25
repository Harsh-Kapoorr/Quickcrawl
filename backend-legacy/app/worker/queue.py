"""Background worker: drains the `jobs` table and submits URLs to Google.

Lifecycle:
  - Started once on FastAPI app startup (`asyncio.create_task`).
  - Polls every ~1s for jobs whose `next_attempt_at <= now` AND status='pending'.
  - Atomically claims a job via UPDATE ... WHERE status='pending' RETURNING.
  - Submits via `app.google.indexing.publish_url`.
  - Updates job + batch counters.
  - On worker startup, sweeps any PROCESSING jobs older than the lease
    timeout back to PENDING (crash recovery).

Single-process by design (medium scale, ≤2000/day). The atomic claim
is still UPDATE-based so it stays correct under any future multi-worker
deployment, and so crash recovery is safe.

All DB writes go through `get_write_lock()` to serialize against the
HTTP request handlers — SQLite is single-writer and aiosqlite doesn't
reliably serialize concurrent connections on its own.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.config import get_settings
from app.db.database import get_engine, get_write_lock
from app.db.models import Batch, Job, JobStatus
from app.google.client import GoogleAPIError, OAuthReauthRequired
from app.google.indexing import publish_url
from app.worker.rate_limiter import get_rate_limiter, quota_exhausted, record_request
from app.worker.retry import should_retry

log = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 1.0
JOB_LEASE_TIMEOUT = timedelta(minutes=5)
RECOVERY_SWEEP_INTERVAL = 60.0  # seconds between stuck-job sweeps
COUNTERS = ("pending", "processing", "succeeded", "failed", "cancelled")


def _next_utc_midnight() -> datetime:
    """Return the next UTC midnight as an aware datetime."""
    now = datetime.now(UTC)
    return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


async def _bump_counters(db: AsyncSession, batch: Batch, old: str, new: str) -> None:
    if old == new:
        return
    if old in COUNTERS:
        setattr(batch, old, max(getattr(batch, old) - 1, 0))
    if new in COUNTERS:
        setattr(batch, new, getattr(batch, new) + 1)


async def enqueue_batch(db: AsyncSession, jobs: list[Job]) -> None:
    """Reset the given jobs to PENDING with `next_attempt_at = now`."""
    now = datetime.now(UTC)
    for j in jobs:
        j.status = JobStatus.PENDING
        j.next_attempt_at = now
        db.add(j)
    await db.commit()


async def recover_stuck_jobs(db: AsyncSession) -> int:
    """Reset PROCESSING jobs whose lease has expired back to PENDING.

    Also re-balances Batch counters so the UI doesn't drift after a crash.
    """
    cutoff = datetime.now(UTC) - JOB_LEASE_TIMEOUT
    result = await db.execute(
        update(Job)
        .where(Job.status == JobStatus.PROCESSING)
        .where(Job.next_attempt_at < cutoff)
        .values(status=JobStatus.PENDING)
        .returning(Job.id, Job.batch_id)
    )
    rows = result.all()
    if not rows:
        return 0
    batch_ids = {batch_id for _, batch_id in rows}
    for batch_id in batch_ids:
        batch = await db.get(Batch, batch_id)
        if batch is None:
            continue
        batch.processing = max(batch.processing - 1, 0)
        batch.pending += 1
        db.add(batch)
    await db.commit()
    log.warning("recovered %d stuck jobs from a previous run", len(rows))
    return len(rows)


async def _claim_one(db: AsyncSession) -> Job | None:
    """Atomically claim exactly one ready job. Returns None if nothing to do.

    SQLite's UPDATE has no LIMIT, so an UPDATE...RETURNING would otherwise
    transition every matching job to PROCESSING in a single call — leaving
    the unprocessed ones stuck in PROCESSING until the lease-timeout sweep
    reclaims them. We pick one candidate via SELECT, then UPDATE only that
    row (still scoped to status='pending' as a TOCTOU guard).
    """
    now = datetime.now(UTC)
    candidate_id = (
        await db.execute(
            select(Job.id)
            .where(Job.status == JobStatus.PENDING)
            .where(Job.next_attempt_at <= now)
            .order_by(Job.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if candidate_id is None:
        return None

    result = await db.execute(
        update(Job)
        .where(Job.id == candidate_id)
        .where(Job.status == JobStatus.PENDING)
        .values(status=JobStatus.PROCESSING, next_attempt_at=now)
        .execution_options(synchronize_session=False)
        .returning(Job.id)
    )
    claimed_ids = result.scalars().all()
    if not claimed_ids:
        # Lost the race to another worker; try again next tick.
        return None
    job = await db.get(Job, claimed_ids[0])
    await db.commit()
    return job


def _sanitize_error(message: str) -> str:
    if not message:
        return ""
    return message.splitlines()[0][:300]


async def _process_one(db: AsyncSession, job: Job) -> None:
    """Submit a single job to Google and update its state.

    The lock is held for the local DB bookkeeping around the Google API
    call but RELEASED during the call itself so request handlers can
    proceed. (The session stays bound to `db`, but the API call doesn't
    touch it.)
    """
    settings = get_settings()
    write_lock = get_write_lock()

    # --- Phase 1: prep under the write lock ---
    async with write_lock:
        batch = await db.get(Batch, job.batch_id)
        if batch is None:
            log.error("job %s has no batch — marking failed", job.id)
            job.status = JobStatus.FAILED
            job.last_error = "batch missing"
            await db.commit()
            return

        if await quota_exhausted(db):
            log.info("daily quota exhausted — deferring job %s", job.id)
            job.status = JobStatus.PENDING
            job.next_attempt_at = _next_utc_midnight()
            await _bump_counters(db, batch, "processing", "pending")
            db.add(job)
            db.add(batch)
            await db.commit()
            return

        await get_rate_limiter().wait()
        job.attempts += 1
        await _bump_counters(db, batch, "pending", "processing")
        await record_request(db)
        db.add(job)
        db.add(batch)
        await db.commit()

    # --- Phase 2: Google API call (lock released; HTTP requests can proceed) ---
    try:
        result = await publish_url(
            db,
            batch.google_sub,
            job.url,
            notify_type=job.publish_type,
        )
        api_result: tuple[bool, dict | Exception | None] = (True, result)
    except OAuthReauthRequired as exc:
        api_result = (False, exc)
    except GoogleAPIError as exc:
        api_result = (False, exc)
    except Exception as exc:  # noqa: BLE001
        api_result = (False, exc)

    # --- Phase 3: record outcome under the write lock ---
    async with write_lock:
        # Re-fetch batch in case it was modified while we were awaiting Google.
        batch = await db.get(Batch, job.batch_id)  # type: ignore[assignment]
        if batch is None:
            return

        ok, payload = api_result
        if ok:
            assert isinstance(payload, dict)
            notify_time_str = (
                payload.get("urlNotificationMetadata", {})
                .get("latestUpdate", {})
                .get("notifyTime")
            )
            if notify_time_str:
                try:
                    job.google_notify_time = datetime.fromisoformat(
                        notify_time_str.replace("Z", "+00:00")
                    )
                except ValueError:
                    pass
            job.status = JobStatus.SUBMITTED
            job.http_status = 200
            job.submitted_at = datetime.now(UTC)
            job.completed_at = job.submitted_at
            job.last_error = None
            await _bump_counters(db, batch, "processing", "succeeded")
            log.info("submitted url=%s (job=%s)", job.url, job.id)
        else:
            assert isinstance(payload, Exception)
            if isinstance(payload, OAuthReauthRequired):
                log.warning("re-auth required for sub=%s", batch.google_sub)
                job.last_error = "re-auth required"
                job.http_status = 401
                job.status = JobStatus.FAILED
                job.completed_at = datetime.now(UTC)
                await _bump_counters(db, batch, "processing", "failed")
            else:
                retry, delay = should_retry(payload, job.attempts, settings.max_attempts)
                code = getattr(payload, "status_code", None) or 500
                msg = getattr(payload, "message", str(payload))
                log.warning(
                    "google api error for job=%s url=%s code=%s retry=%s delay=%.1f",
                    job.id, job.url, code, retry, delay,
                )
                job.last_error = _sanitize_error(f"{code}: {msg}")
                job.http_status = code
                if retry:
                    job.status = JobStatus.PENDING
                    job.next_attempt_at = datetime.now(UTC) + timedelta(seconds=delay)
                    await _bump_counters(db, batch, "processing", "pending")
                else:
                    job.status = JobStatus.FAILED
                    job.completed_at = datetime.now(UTC)
                    await _bump_counters(db, batch, "processing", "failed")

        db.add(job)
        db.add(batch)
        await db.commit()


async def _worker_loop() -> None:
    """Main worker loop. Runs until cancelled."""
    log.info("indexing worker started")
    factory = get_engine()
    write_lock = get_write_lock()

    # Recovery sweep on startup — picks up any PROCESSING jobs left
    # behind by a previous crashed run.
    async with factory() as db, write_lock:
        await recover_stuck_jobs(db)
    last_recovery = asyncio.get_event_loop().time()

    while True:
        try:
            now_loop = asyncio.get_event_loop().time()
            if now_loop - last_recovery > RECOVERY_SWEEP_INTERVAL:
                async with factory() as db, write_lock:
                    await recover_stuck_jobs(db)
                last_recovery = now_loop

            async with factory() as db, write_lock:
                job = await _claim_one(db)
            if job is None:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                continue
            async with factory() as db:
                await _process_one(db, job)
        except asyncio.CancelledError:
            log.info("indexing worker stopping (cancelled)")
            raise
        except Exception:  # noqa: BLE001
            log.exception("worker loop iteration crashed; sleeping before retry")
            await asyncio.sleep(5.0)


_task: asyncio.Task[None] | None = None


def start_worker() -> None:
    global _task
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_worker_loop(), name="indexing-worker")


async def stop_worker() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
