"""Shared Google API client: builds authed httpx clients, auto-refreshes tokens."""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import httpx
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.crypto import decrypt
from app.auth.keychain import load_key
from app.auth.oauth import refresh_access_token
from app.db.models import OAuthToken

log = logging.getLogger(__name__)

INDEXING_API_BASE = "https://indexing.googleapis.com/v3"
SEARCHCONSOLE_API_BASE = "https://searchconsole.googleapis.com/v1"
WEBMASTERS_API_BASE = "https://www.googleapis.com/webmasters/v3"


class GoogleAPIError(RuntimeError):
    """Wraps an HTTP error from a Google API."""

    def __init__(self, status_code: int, message: str, retry_after: int | None = None):
        super().__init__(f"{status_code}: {message}")
        self.status_code = status_code
        self.message = message
        self.retry_after = retry_after


class OAuthReauthRequired(GoogleAPIError):  # noqa: N818 — semantic suffix matters
    """The refresh token has been revoked or the user changed password.

    Treated as a permanent failure by the worker — re-running the OAuth
    flow is the only fix. HTTP status: 401.
    """

    def __init__(self) -> None:
        super().__init__(401, "re-auth required")


async def get_valid_access_token(db: AsyncSession, sub: str) -> str:
    """Return a fresh access_token for the user, refreshing if needed."""
    token = (
        await db.execute(select(OAuthToken).where(OAuthToken.google_sub == sub))
    ).scalar_one_or_none()
    if token is None:
        raise OAuthReauthRequired()

    now = datetime.now(UTC)
    if token.expires_at.replace(tzinfo=UTC) > now + timedelta(minutes=5):
        return decrypt(token.access_token_enc, load_key())

    log.info("refreshing access token for sub=%s", sub)
    return await refresh_access_token(db, token)


async def authed_client(db: AsyncSession, sub: str) -> httpx.AsyncClient:
    """Return an httpx AsyncClient with a valid Bearer token attached."""
    token = await get_valid_access_token(db, sub)
    return httpx.AsyncClient(
        headers={"Authorization": f"Bearer {token}"},
        timeout=httpx.Timeout(30.0, connect=10.0),
    )


async def google_request(
    db: AsyncSession,
    sub: str,
    method: str,
    url: str,
    *,
    json_body: dict | None = None,
    params: dict | None = None,
) -> httpx.Response:
    """Make an authenticated request.

    If the first attempt gets 401, force a token refresh and retry once.
    If the second attempt still gets 401, raise `OAuthReauthRequired`
    so the worker treats it as permanent.
    """
    client = await authed_client(db, sub)
    try:
        resp = await client.request(method, url, json=json_body, params=params)
    finally:
        await client.aclose()

    if resp.status_code != 401:
        return resp

    # Force refresh and try once more
    token = (
        await db.execute(select(OAuthToken).where(OAuthToken.google_sub == sub))
    ).scalar_one_or_none()
    if token is not None:
        try:
            await refresh_access_token(db, token)
        except Exception as exc:  # noqa: BLE001 — refresh failed
            log.warning("refresh failed for sub=%s: %s", sub, exc)
            raise OAuthReauthRequired() from exc

        client = await authed_client(db, sub)
        try:
            resp = await client.request(method, url, json=json_body, params=params)
        finally:
            await client.aclose()

    if resp.status_code == 401:
        raise OAuthReauthRequired()
    return resp


def raise_for_google_error(resp: httpx.Response) -> None:
    """Convert a non-2xx response into a GoogleAPIError with parsed details."""
    if resp.status_code < 400:
        return
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        body = {"raw": resp.text[:500]}
    message = (
        body.get("error", {}).get("message")
        if isinstance(body.get("error"), dict)
        else body.get("error_description") or str(body)
    )
    retry_after = None
    ra = resp.headers.get("Retry-After")
    if ra and ra.isdigit():
        retry_after = int(ra)
    raise GoogleAPIError(resp.status_code, str(message), retry_after=retry_after)
