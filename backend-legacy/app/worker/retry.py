"""Retry classification for Google API errors.

Pure functions — no DB, no I/O — so they're trivially testable.
"""
from __future__ import annotations

import random

from app.google.client import GoogleAPIError

# Maximum delay we'll ever back off for, even if Google asks for longer.
# 600s = 10 minutes. The worker will pick the job up again after this.
MAX_BACKOFF_SECONDS = 600.0


def should_retry(err: Exception, attempt: int, max_attempts: int) -> tuple[bool, float]:
    """Return (retry?, delay_seconds).

    Retry policy:
      - 429: respect Retry-After (clamped), with full jitter
      - 5xx: exponential backoff with full jitter
      - Network/transport errors: exponential backoff
      - 4xx (not 429): permanent failure
      - Once max_attempts reached: no retry
    """
    if attempt >= max_attempts:
        return False, 0.0

    if isinstance(err, GoogleAPIError):
        code = err.status_code
        if code == 429:
            base = float(err.retry_after) if err.retry_after else 2.0
            base = min(base, MAX_BACKOFF_SECONDS)
            # Full jitter: pick uniformly in [0, base] to break thundering herds.
            return True, random.uniform(0, base)  # noqa: S311
        if 500 <= code < 600:
            return True, _exp_backoff(attempt)
        return False, 0.0

    # httpx network errors, timeouts, etc.
    return True, _exp_backoff(attempt)


def _exp_backoff(attempt: int, base: float = 2.0, cap: float = 300.0) -> float:
    """Exponential backoff with full jitter, attempt is 0-indexed."""
    delay = min(cap, base * (2**attempt))
    return random.uniform(0, delay)  # noqa: S311

