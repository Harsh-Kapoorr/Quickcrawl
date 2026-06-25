"""FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from app.api import auth, inspect, jobs, properties, quota, setup
from app.api import settings as settings_api
from app.auth.oauth import sweep_expired_pending
from app.auth.session import SESSION_MAX_AGE_SECONDS, prune_revoked
from app.config import get_settings
from app.db.database import get_engine, init_db
from app.worker.queue import start_worker, stop_worker

logging.basicConfig(
    level=get_settings().log_level.upper(),
    format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        log.warning(
            "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are empty — "
            "sign-in will fail until backend/.env is populated"
        )
    log.info("starting gsc-indexer backend on %s:%s", settings.host, settings.port)
    await init_db()
    async with get_engine()() as db:
        await sweep_expired_pending(db)
        pruned = await prune_revoked(db, SESSION_MAX_AGE_SECONDS)
        if pruned:
            log.info("pruned %d stale revoked-session rows", pruned)
    start_worker()
    try:
        yield
    finally:
        await stop_worker()


app = FastAPI(
    title="GSC Mass Indexer",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url=None,
    lifespan=lifespan,
)

# CORS: localhost + 127.0.0.1 — needed because the user may open the
# frontend on either host (browsers treat them as different origins).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        get_settings().frontend_url,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next) -> Response:
    """Apply defense-in-depth headers to every backend response."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault(
        "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
    )
    return response


# Health endpoint is intentionally outside /api so uptime monitors can hit it
@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True}


# Mount routers
app.include_router(auth.router)
app.include_router(properties.router)
app.include_router(jobs.router)
app.include_router(quota.router)
app.include_router(inspect.router)
app.include_router(settings_api.router)
app.include_router(setup.router)
