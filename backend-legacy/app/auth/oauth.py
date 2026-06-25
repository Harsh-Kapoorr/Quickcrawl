"""OAuth 2.0 with PKCE for Google sign-in.

Flow:
  1. /api/auth/google  → generate `state` (CSRF) + `code_verifier` /
     `code_challenge` (PKCE), persist in `pending_oauth`, redirect to Google.
  2. /api/auth/callback → verify `state`, exchange code+verifier for tokens,
     fetch user info, encrypt + persist tokens, issue session cookie,
     delete the pending row, redirect to frontend.

Credentials are read on each request from the DB (if set) or .env.
This lets the user change OAuth credentials from the UI without
restarting the backend.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from authlib.integrations.httpx_client import AsyncOAuth2Client
from sqlalchemy import delete
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.app_settings import get_google_oauth_credentials
from app.auth.crypto import decrypt, encrypt
from app.auth.keychain import load_key
from app.config import get_settings
from app.db.models import OAuthToken, PendingOAuth

log = logging.getLogger(__name__)

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 — URL, not password
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

# How long a PKCE/state token is valid for. After this we reject the
# callback even if Google calls back successfully.
PKCE_TTL = timedelta(minutes=10)

# Generic message returned to the browser on any OAuth failure.
# Details go to logs only.
GENERIC_OAUTH_ERROR = "OAuth flow failed; check the backend logs for details."


class OAuthError(RuntimeError):
    """Raised for any OAuth flow failure."""


def _b64url_nopad(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _new_pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) using S256."""
    verifier = _b64url_nopad(secrets.token_bytes(48))  # 64 chars, plenty of entropy
    challenge = _b64url_nopad(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def _new_state() -> str:
    return secrets.token_urlsafe(32)


async def sweep_expired_pending(db: AsyncSession) -> int:
    """Delete any pending OAuth rows whose PKCE TTL has expired."""
    now = datetime.now(UTC)
    result = await db.execute(
        delete(PendingOAuth).where(PendingOAuth.expires_at < now).returning(PendingOAuth.state)
    )
    rows = result.scalars().all()
    if rows:
        await db.commit()
        log.info("swept %d expired pending oauth rows", len(rows))
    return len(rows)


async def start_oauth(db: AsyncSession) -> str:
    """Build the Google authorize URL and persist the PKCE + state pair.

    Credentials are read fresh each call from DB (if set) or env, so
    the UI can change them without a restart.

    Returns the URL to redirect the user to.
    """
    settings = get_settings()
    client_id, client_secret, _source = await get_google_oauth_credentials(db)
    if not client_id or not client_secret:
        raise OAuthError("oauth_not_configured")

    state = _new_state()
    verifier, challenge = _new_pkce_pair()
    pending = PendingOAuth(
        state=state,
        code_verifier=verifier,
        expires_at=datetime.now(UTC) + PKCE_TTL,
    )
    db.add(pending)
    await db.commit()

    redirect_uri = f"{settings.backend_url.rstrip('/')}/api/auth/callback"
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": " ".join(settings.google_oauth_scopes),
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
    }
    return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"


async def complete_oauth(
    db: AsyncSession, code: str, state: str
) -> tuple[str, str, str]:
    """Exchange the code for tokens, persist encrypted, return (sub, email, name).

    Raises OAuthError on any failure. On success the pending row is deleted.
    """
    settings = get_settings()
    pending = (
        await db.execute(select(PendingOAuth).where(PendingOAuth.state == state))
    ).scalar_one_or_none()
    if pending is None:
        raise OAuthError("invalid_state")
    if pending.expires_at.replace(tzinfo=UTC) < datetime.now(UTC):
        await db.delete(pending)
        await db.commit()
        raise OAuthError("expired_state")
    # Consume state immediately to prevent replay (delete even on later failure)
    await db.delete(pending)
    await db.commit()

    client_id, client_secret, _source = await get_google_oauth_credentials(db)
    redirect_uri = f"{settings.backend_url.rstrip('/')}/api/auth/callback"
    client = AsyncOAuth2Client(
        client_id=client_id,
        client_secret=client_secret,
    )
    try:
        token_resp = await client.fetch_token(
            GOOGLE_TOKEN_URL,
            code=code,
            redirect_uri=redirect_uri,
            code_verifier=pending.code_verifier,
            grant_type="authorization_code",
        )
    except Exception as exc:  # authlib raises many subclasses
        log.warning("token exchange failed: %s", exc)
        raise OAuthError("token_exchange_failed") from exc

    access_token = token_resp.get("access_token")
    refresh_token = token_resp.get("refresh_token")
    expires_in = int(token_resp.get("expires_in", 3600))
    scope = token_resp.get("scope", "")
    if not access_token:
        raise OAuthError("no_access_token")

    # Identify the user
    try:
        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        userinfo_resp.raise_for_status()
        info = userinfo_resp.json()
    except Exception as exc:
        log.warning("userinfo fetch failed: %s", exc)
        raise OAuthError("userinfo_failed") from exc

    sub = info.get("sub")
    email = info.get("email", "")
    name = info.get("name", "")
    picture = info.get("picture", "")
    if not sub:
        raise OAuthError("no_sub")

    # Persist encrypted tokens
    key = load_key()
    expires_at = datetime.now(UTC) + timedelta(seconds=expires_in - 60)

    existing = (
        await db.execute(select(OAuthToken).where(OAuthToken.google_sub == sub))
    ).scalar_one_or_none()

    if existing is not None:
        existing.email = email
        existing.name = name
        existing.picture = picture
        existing.scope = scope
        existing.access_token_enc = encrypt(access_token, key)
        if refresh_token:
            existing.refresh_token_enc = encrypt(refresh_token, key)
        existing.token_type = token_resp.get("token_type", "Bearer")
        existing.expires_at = expires_at
        existing.updated_at = datetime.now(UTC)
    else:
        db.add(
            OAuthToken(
                google_sub=sub,
                email=email,
                name=name,
                picture=picture,
                scope=scope,
                access_token_enc=encrypt(access_token, key),
                refresh_token_enc=encrypt(refresh_token, key) if refresh_token else None,
                token_type=token_resp.get("token_type", "Bearer"),
                expires_at=expires_at,
            )
        )
    await db.commit()

    return sub, email, name


async def refresh_access_token(db: AsyncSession, token: OAuthToken) -> str:
    """Refresh the access token if expired/near-expiry; returns fresh access_token."""
    if not token.refresh_token_enc:
        raise OAuthError("no_refresh_token")

    key = load_key()
    refresh_token = decrypt(token.refresh_token_enc, key)
    client_id, client_secret, _source = await get_google_oauth_credentials(db)
    client = AsyncOAuth2Client(
        client_id=client_id,
        client_secret=client_secret,
    )
    try:
        resp = await client.fetch_token(
            GOOGLE_TOKEN_URL,
            grant_type="refresh_token",
            refresh_token=refresh_token,
        )
    except Exception as exc:
        log.warning("token refresh failed: %s", exc)
        raise OAuthError("refresh_failed") from exc

    access = resp.get("access_token")
    expires_in = int(resp.get("expires_in", 3600))
    new_refresh = resp.get("refresh_token")  # Google may rotate it; use the new one.
    if not access:
        raise OAuthError("no_access_in_refresh")

    token.access_token_enc = encrypt(access, key)
    if new_refresh:
        token.refresh_token_enc = encrypt(new_refresh, key)
    token.expires_at = datetime.now(UTC) + timedelta(seconds=max(expires_in - 60, 0))
    token.updated_at = datetime.now(UTC)
    db.add(token)
    await db.commit()
    return access
