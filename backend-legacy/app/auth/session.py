"""Signed cookie-based session for the browser-facing app.

Sessions are short-lived (8 hours) and contain only the Google `sub`
(user ID) — no tokens. The signing key is derived from the encryption
key via proper HKDF (input keying material = encryption key, salt =
fixed context label, info = purpose). Sessions CAN be invalidated
server-side via the `RevokedSession` table — see `app/db/models.py`.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.keychain import load_key
from app.db.models import RevokedSession

SESSION_MAX_AGE_SECONDS = 8 * 3600
SESSION_COOKIE_NAME = "gsc_session"
SESSION_COOKIE_SECURE_DEFAULT = False  # set True in production with TLS


def _signing_key() -> bytes:
    """Derive a 32-byte signing key from the encryption key using HKDF."""
    raw = load_key()
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"gsc-indexer-session-v1",
        info=b"session-cookie-signer",
    ).derive(raw)


@lru_cache
def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_signing_key(), salt=b"gsc-session")


def issue_session(response: Response, google_sub: str, *, secure: bool) -> str:
    """Issue a session cookie. Returns the raw token so callers can record it."""
    token = _serializer().dumps({"sub": google_sub})
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    return token


def read_session(request: Request) -> dict[str, Any] | None:
    raw = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw:
        return None
    try:
        return _serializer().loads(raw, max_age=SESSION_MAX_AGE_SECONDS)  # type: ignore[no-any-return]
    except (SignatureExpired, BadSignature):
        return None


def clear_session(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


async def is_revoked(db: AsyncSession, token: str) -> bool:
    """Return True if this session token has been explicitly revoked."""
    from sqlalchemy import func

    count = (
        await db.execute(
            select(func.count(RevokedSession.id)).where(  # type: ignore[arg-type]
                RevokedSession.token == token
            )
        )
    ).scalar_one()
    return bool(count)


async def revoke_token(db: AsyncSession, token: str) -> None:
    """Add a token to the revoked-sessions table. Idempotent."""
    db.add(RevokedSession(token=token))
    await db.commit()


async def prune_revoked(db: AsyncSession, older_than_seconds: int) -> int:
    """Garbage-collect revoked-sessions older than the max session age."""
    from datetime import UTC, datetime, timedelta

    cutoff = datetime.now(UTC) - timedelta(seconds=older_than_seconds)
    result = await db.execute(
        delete(RevokedSession).where(RevokedSession.revoked_at < cutoff).returning(RevokedSession.id)
    )
    n = len(result.scalars().all())
    if n:
        await db.commit()
    return n


def require_session(request: Request) -> str:
    """FastAPI dependency: returns the Google sub or raises 401.

    Does NOT check the revoked-sessions table (to avoid an extra DB
    round-trip on every authenticated request); instead use
    `require_session_checked` for routes where revocation matters
    (logout, account-deletion, etc.).
    """
    sess = read_session(request)
    if not sess or "sub" not in sess:
        raise HTTPException(status_code=401, detail="not signed in")
    return str(sess["sub"])


async def require_session_checked(request: Request, db: AsyncSession) -> str:
    """Like `require_session` but also checks the revocation table."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    sess = read_session(request)
    if not sess or "sub" not in sess:
        raise HTTPException(status_code=401, detail="not signed in")
    if token and await is_revoked(db, token):
        raise HTTPException(status_code=401, detail="session revoked")
    return str(sess["sub"])
