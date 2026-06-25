"""Google Indexing API wrapper.

Endpoints used:
  POST /v3/urlNotifications:publish   — request indexing of a URL
"""
from __future__ import annotations

import logging

from sqlmodel.ext.asyncio.session import AsyncSession

from app.google.client import (
    INDEXING_API_BASE,
    google_request,
    raise_for_google_error,
)

log = logging.getLogger(__name__)

PUBLISH_ENDPOINT = f"{INDEXING_API_BASE}/urlNotifications:publish"


async def publish_url(
    db: AsyncSession,
    sub: str,
    url: str,
    notify_type: str = "URL_UPDATED",
) -> dict:
    """Submit a URL for indexing. Returns the API response dict.

    notify_type: "URL_UPDATED" or "URL_DELETED".
    Raises GoogleAPIError on failure.
    """
    if notify_type not in ("URL_UPDATED", "URL_DELETED"):
        raise ValueError(f"invalid notify_type: {notify_type}")

    resp = await google_request(
        db,
        sub,
        "POST",
        PUBLISH_ENDPOINT,
        json_body={"url": url, "type": notify_type},
    )
    raise_for_google_error(resp)
    return resp.json()  # type: ignore[no-any-return]
