"""Public first-run setup endpoints (no auth required).

Lets a brand-new open-source user enter their Google OAuth credentials
through the UI without hand-editing `backend/.env`. After credentials
are saved, sign-in works as normal.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession

from app.app_settings import (
    has_db_google_credentials,
    set_google_oauth_credentials,
)
from app.config import get_settings
from app.db.database import get_session
from app.security import enforce_setup_rate

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status")
async def setup_status(db: AsyncSession = Depends(get_session)) -> dict:
    """Whether the user still needs to enter Google OAuth credentials.

    Public endpoint — no session required. Returns the redirect URI the
    user must register in Google Cloud Console for OAuth to succeed.
    """
    has_db = await has_db_google_credentials(db)
    settings = get_settings()
    env_configured = bool(
        settings.google_client_id.strip() and settings.google_client_secret.strip()
    )
    return {
        "setup_required": not (has_db or env_configured),
        "credentials_source": "db" if has_db else ("env" if env_configured else None),
        "redirect_uri": f"{settings.backend_url.rstrip('/')}/api/auth/callback",
    }


@router.put("/credentials")
async def put_setup_credentials(
    payload: dict,
    db: AsyncSession = Depends(get_session),
    _rl: None = Depends(enforce_setup_rate),
) -> dict:
    """Save Google OAuth credentials during first-run setup.

    Public endpoint — no session required. Once any credentials exist
    (DB or env), this route refuses further writes to prevent an
    unauthenticated user from hijacking an existing install.
    """
    settings = get_settings()
    env_configured = bool(
        settings.google_client_id.strip() and settings.google_client_secret.strip()
    )
    if env_configured or await has_db_google_credentials(db):
        raise HTTPException(
            status_code=409,
            detail="credentials already configured — sign in to change them",
        )

    cid = payload.get("client_id")
    secret = payload.get("client_secret")
    if not isinstance(cid, str) or not isinstance(secret, str):
        raise HTTPException(
            status_code=400, detail="client_id and client_secret are required strings"
        )
    if not cid.strip() or not secret.strip():
        raise HTTPException(
            status_code=400, detail="client_id and client_secret cannot be empty"
        )
    try:
        await set_google_oauth_credentials(db, cid, secret)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "source": "db"}
