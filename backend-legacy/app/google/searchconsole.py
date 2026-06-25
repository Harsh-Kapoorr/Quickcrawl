"""Google Search Console API wrapper.

Endpoints used:
  GET  /webmasters/v3/sites                       — list verified properties
  POST /v1/urlInspection/index:inspect            — check index status of a URL
"""
from __future__ import annotations

from sqlmodel.ext.asyncio.session import AsyncSession

from app.google.client import (
    SEARCHCONSOLE_API_BASE,
    WEBMASTERS_API_BASE,
    google_request,
    raise_for_google_error,
)


async def list_sites(db: AsyncSession, sub: str) -> list[dict]:
    """Return the user's verified Search Console sites."""
    resp = await google_request(db, sub, "GET", f"{WEBMASTERS_API_BASE}/sites")
    raise_for_google_error(resp)
    data = resp.json()
    return data.get("siteEntry", [])  # type: ignore[no-any-return]


async def inspect_url(
    db: AsyncSession, sub: str, site_url: str, inspection_url: str
) -> dict:
    """Inspect a URL's index status under a specific property.

    site_url must be the property the URL belongs to (e.g.
    "https://example.com/" or "sc-domain:example.com").
    """
    resp = await google_request(
        db,
        sub,
        "POST",
        f"{SEARCHCONSOLE_API_BASE}/urlInspection/index:inspect",
        json_body={"inspectionUrl": inspection_url, "siteUrl": site_url},
    )
    raise_for_google_error(resp)
    return resp.json()  # type: ignore[no-any-return]
