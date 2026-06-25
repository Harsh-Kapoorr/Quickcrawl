"""Tests for the retry policy."""
from __future__ import annotations

from app.google.client import GoogleAPIError
from app.worker.retry import should_retry


def _err(code: int, retry_after: int | None = None) -> GoogleAPIError:
    return GoogleAPIError(code, "boom", retry_after=retry_after)


def test_429_is_retryable() -> None:
    retry, delay = should_retry(_err(429), attempt=0, max_attempts=5)
    assert retry is True
    assert delay >= 0


def test_429_respects_retry_after() -> None:
    # Retry-After is the *upper bound*; we jitter it to break thundering herds.
    _, delay = should_retry(_err(429, retry_after=42), attempt=0, max_attempts=5)
    assert 0.0 <= delay <= 42.0


def test_429_retry_after_capped() -> None:
    # Even if Google returns a huge Retry-After, we cap it.
    _, delay = should_retry(_err(429, retry_after=10_000), attempt=0, max_attempts=5)
    from app.worker.retry import MAX_BACKOFF_SECONDS
    assert delay <= MAX_BACKOFF_SECONDS


def test_5xx_is_retryable() -> None:
    retry, _ = should_retry(_err(503), attempt=0, max_attempts=5)
    assert retry is True


def test_4xx_not_retryable() -> None:
    retry, _ = should_retry(_err(403), attempt=0, max_attempts=5)
    assert retry is False


def test_4xx_429_still_retryable() -> None:
    retry, _ = should_retry(_err(429), attempt=0, max_attempts=5)
    assert retry is True


def test_max_attempts_respected() -> None:
    retry, _ = should_retry(_err(503), attempt=5, max_attempts=5)
    assert retry is False


def test_network_error_retryable() -> None:
    retry, _ = should_retry(ConnectionError("x"), attempt=0, max_attempts=5)
    assert retry is True
