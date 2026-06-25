"""Auth endpoints: sign in, callback, status, logout."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.oauth import GENERIC_OAUTH_ERROR, OAuthError, complete_oauth, start_oauth
from app.auth.session import (
    SESSION_COOKIE_NAME,
    clear_session,
    issue_session,
    read_session,
    revoke_token,
)
from app.config import get_settings
from app.db.database import get_session, get_write_lock
from app.security import enforce_google_callback_rate, enforce_google_redirect_rate

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/google")
async def sign_in(
    request: Request,
    db: AsyncSession = Depends(get_session),
    _rl: None = Depends(enforce_google_redirect_rate),
) -> RedirectResponse:
    """Redirect to Google's OAuth consent screen."""
    try:
        async with get_write_lock():
            url = await start_oauth(db)
    except OAuthError:
        raise HTTPException(status_code=500, detail=GENERIC_OAUTH_ERROR) from None
    return RedirectResponse(url, status_code=302)


@router.get("/callback")
async def callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    db: AsyncSession = Depends(get_session),
    _rl: None = Depends(enforce_google_callback_rate),
) -> RedirectResponse:
    """Exchange the auth code for tokens and issue a session cookie."""
    settings = get_settings()
    frontend = settings.frontend_url.rstrip("/")

    if error:
        log.info("OAuth callback received error=%s from Google", error)
        return RedirectResponse(f"{frontend}/?oauth_error={error}", status_code=302)

    if not code or not state:
        log.warning("OAuth callback missing code or state")
        return RedirectResponse(f"{frontend}/?oauth_error=missing_params", status_code=302)

    try:
        async with get_write_lock():
            sub, _email, _name = await complete_oauth(db, code, state)
    except OAuthError:
        raise HTTPException(status_code=400, detail=GENERIC_OAUTH_ERROR) from None

    resp = RedirectResponse(f"{frontend}/", status_code=302)
    secure = settings.session_cookie_secure
    issue_session(resp, sub, secure=secure)
    return resp


@router.get("/status")
async def status(request: Request) -> dict:
    sess = read_session(request)
    return {"signed_in": bool(sess), "sub": sess.get("sub") if sess else None}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Revoke the session server-side AND clear the cookie."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        try:
            async with get_write_lock():
                await revoke_token(db, token)
        except Exception as exc:  # noqa: BLE001
            log.warning("failed to revoke token: %s", exc)
    clear_session(response)
    return {"ok": True}
