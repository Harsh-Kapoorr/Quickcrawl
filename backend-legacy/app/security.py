"""URL validation, property-matching, and per-IP rate limiting.

Security helpers used by the API:
  - parse_and_validate_url / validate_urls_against_properties
  - _property_matches_url (URL-aware, not naive str.startswith)
  - enforce_*_rate (per-IP sliding-window rate limits)
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.models import Property

MAX_URL_LENGTH = 2048
MAX_URLS_PER_BATCH = 1000


class URLValidationError(ValueError):
    """Raised when a URL is malformed, unsafe, or doesn't match a property."""


def _normalize_url(raw: str) -> str:
    """Trim whitespace and common wrapper characters."""
    s = raw.strip()
    if not s:
        raise URLValidationError("URL is empty")
    for ch in '"\'<>':
        s = s.strip(ch)
    return s.strip()


def parse_and_validate_url(raw: str) -> str:
    """Validate a single URL. Returns the normalized string on success."""
    url = _normalize_url(raw)
    if len(url) > MAX_URL_LENGTH:
        raise URLValidationError(f"URL exceeds {MAX_URL_LENGTH} chars")

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise URLValidationError(f"only http/https allowed, got {parsed.scheme!r}")
    if not parsed.netloc:
        raise URLValidationError("missing host")
    # Reject hostnames that look like internal infra even though we're local
    if parsed.hostname and parsed.hostname.lower() in ("localhost", "127.0.0.1", "0.0.0.0"):  # noqa: S104
        raise URLValidationError("loopback hosts not allowed as target URLs")

    return url


def _is_public_suffix_collision(domain: str, host: str) -> bool:
    """True when `domain` is a public suffix and `host` only collides via suffix.

    E.g. domain="co.uk", host="barfoo.co.uk" — they share the suffix but the
    registrable parts differ. Catches the most common lookalike attacks.
    """
    public_suffixes = {"co.uk", "co.jp", "co.kr", "com.au", "co.nz", "com.br",
                       "co.in", "com.cn", "com.hk", "com.tw", "com.sg"}
    if domain not in public_suffixes:
        return False
    return host != domain and host.endswith("." + domain)


def _property_matches_url(prop_site: str, url: str) -> bool:
    """Return True if `url` is covered by the given Search Console property.

    Two property formats:
      - URL-prefix: "https://example.com/" or "http://example.com/path/"
      - Domain:     "sc-domain:example.com" (covers all schemes/subdomains)

    Matching is URL-aware (scheme + host + path boundary) — NOT a naive
    `str.startswith` — so that e.g. property "https://example.com/" does
    not match "https://example.com.evil.com/x".
    """
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if not host:
        return False

    if prop_site.startswith("sc-domain:"):
        domain = prop_site[len("sc-domain:") :].lower().lstrip(".")
        if host == domain:
            return True
        # Subdomain match, but reject public-suffix lookalikes.
        if host.endswith("." + domain) and not _is_public_suffix_collision(domain, host):
            return True
        return False

    if prop_site.startswith("http://") or prop_site.startswith("https://"):
        prop_parsed = urlparse(prop_site)
        if (parsed.scheme or "").lower() != (prop_parsed.scheme or "").lower():
            return False
        if host != (prop_parsed.hostname or "").lower():
            return False
        # Path must be either identical or end at a '/' boundary.
        prefix = prop_parsed.path or "/"
        if not prefix.endswith("/"):
            prefix += "/"
        url_path = parsed.path or "/"
        return url_path == prefix.rstrip("/") or url_path.startswith(prefix)

    return False


async def validate_urls_against_properties(
    urls: list[str], db: AsyncSession, google_sub: str
) -> dict[str, str]:
    """Validate a list of URLs and pair each with a matching property site URL."""
    if not urls:
        raise URLValidationError("no URLs provided")
    if len(urls) > MAX_URLS_PER_BATCH:
        raise URLValidationError(
            f"too many URLs ({len(urls)}); max per batch is {MAX_URLS_PER_BATCH}"
        )

    props = (
        await db.execute(
            select(Property).where(Property.google_sub == google_sub)
        )
    ).scalars().all()

    if not props:
        raise URLValidationError(
            "no verified properties found — sync properties from Google first"
        )

    validated: dict[str, str] = {}
    seen: set[str] = set()
    for raw in urls:
        if raw in seen:
            continue
        seen.add(raw)
        url = parse_and_validate_url(raw)
        match = next(
            (p.site_url for p in props if _property_matches_url(p.site_url, url)),
            None,
        )
        if not match:
            raise URLValidationError(
                f"URL does not match any verified property: {url}"
            )
        validated[url] = match

    return validated


# ----------------------------------------------------------------------
# Per-IP rate limiting (sliding window, in-process)
# ----------------------------------------------------------------------


class _SlidingWindow:
    """Sliding-window rate limiter: max N requests in `window` seconds."""

    def __init__(self, max_calls: int, window_seconds: float) -> None:
        self.max_calls = max_calls
        self.window = window_seconds
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window
        async with self._lock:
            q = self._buckets[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max_calls:
                raise HTTPException(
                    status_code=429,
                    detail=f"too many requests; max {self.max_calls} per {self.window:.0f}s",
                )
            q.append(now)


def _client_ip(request: Request) -> str:
    return (request.client.host if request.client else "unknown") or "unknown"


# Per-endpoint limits.
google_redirect_limiter = _SlidingWindow(max_calls=10, window_seconds=60.0)
google_callback_limiter = _SlidingWindow(max_calls=20, window_seconds=60.0)
setup_limiter = _SlidingWindow(max_calls=20, window_seconds=60.0)
batch_submit_limiter = _SlidingWindow(max_calls=20, window_seconds=60.0)
property_sync_limiter = _SlidingWindow(max_calls=6, window_seconds=60.0)


async def enforce_google_redirect_rate(request: Request) -> None:
    await google_redirect_limiter.check(_client_ip(request))


async def enforce_google_callback_rate(request: Request) -> None:
    await google_callback_limiter.check(_client_ip(request))


async def enforce_setup_rate(request: Request) -> None:
    await setup_limiter.check(_client_ip(request))


async def enforce_batch_submit_rate(request: Request) -> None:
    await batch_submit_limiter.check(_client_ip(request))


async def enforce_property_sync_rate(request: Request) -> None:
    await property_sync_limiter.check(_client_ip(request))
