"""App-level settings endpoints.

Lets the UI override env-only configuration (Google OAuth credentials
today, more later) without editing .env or restarting the backend.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession

from app.app_settings import (
    clear_google_oauth_credentials,
    get_google_oauth_credentials,
    has_db_google_credentials,
    set_google_oauth_credentials,
)
from app.auth.session import require_session
from app.config import get_settings
from app.db.database import get_session

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/google")
async def get_google_credentials(
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Show current source + client_id. Client secret is never returned."""
    client_id, _client_secret, source = await get_google_oauth_credentials(db)
    has_db = await has_db_google_credentials(db)
    return {
        "source": source,  # "db" or "env"
        "client_id": client_id or None,  # public, not a secret
        "client_secret_set": bool(_client_secret),
        "has_db_overrides": has_db,
        "redirect_uri": f"{get_settings().backend_url.rstrip('/')}/api/auth/callback",
    }


@router.put("/google")
async def put_google_credentials(
    payload: dict,
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Save Google OAuth credentials to the encrypted DB store.

    Body: {"client_id": "...", "client_secret": "..."}

    NOTE: changing credentials invalidates any existing OAuth sessions
    for the previous client. You'll need to sign out and sign in again.
    """
    cid = payload.get("client_id")
    secret = payload.get("client_secret")
    if not isinstance(cid, str) or not isinstance(secret, str):
        raise HTTPException(status_code=400, detail="client_id and client_secret are required strings")
    if not cid.strip() or not secret.strip():
        raise HTTPException(status_code=400, detail="client_id and client_secret cannot be empty")
    try:
        await set_google_oauth_credentials(db, cid, secret)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "source": "db"}


@router.delete("/google")
async def delete_google_credentials(
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Clear DB-stored credentials and fall back to .env values."""
    await clear_google_oauth_credentials(db)
    return {"ok": True, "source": "env"}
