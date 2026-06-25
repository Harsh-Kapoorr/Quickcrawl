"""URL inspection endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.session import require_session
from app.db.database import get_session
from app.db.models import Property
from app.google.client import GoogleAPIError
from app.google.searchconsole import inspect_url
from app.security import URLValidationError, _property_matches_url, parse_and_validate_url

router = APIRouter(prefix="/api/inspect", tags=["inspect"])


@router.get("")
async def inspect(
    url: str = Query(..., description="The URL to inspect"),
    sub: str = Depends(require_session),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Check the index status of a single URL."""
    try:
        target = parse_and_validate_url(url)
    except URLValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    props = (
        await db.execute(select(Property).where(Property.google_sub == sub))
    ).scalars().all()
    match = next(
        (p.site_url for p in props if _property_matches_url(p.site_url, target)),
        None,
    )
    if not match:
        raise HTTPException(status_code=400, detail="URL does not match any verified property")

    try:
        result = await inspect_url(db, sub, match, target)
    except GoogleAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    inspection = result.get("inspectionResult", {})
    return {
        "url": target,
        "property_url": match,
        "indexed": inspection.get("indexStatusResult", {}).get("verdict") == "PASS",
        "raw": inspection,
    }
