"""Tests for URL parsing + property matching."""
from __future__ import annotations

import pytest

from app.security import URLValidationError, _property_matches_url, parse_and_validate_url


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("https://example.com/", "https://example.com/"),
        ("  https://example.com  ", "https://example.com"),
        ('"https://example.com"', "https://example.com"),
        ("<https://example.com>", "https://example.com"),
        ("https://example.com/path?q=1", "https://example.com/path?q=1"),
    ],
)
def test_parse_and_validate_url_accepted(raw: str, expected: str) -> None:
    assert parse_and_validate_url(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "ftp://example.com/",
        "example.com",  # no scheme
        "https://localhost/x",
        "https://127.0.0.1/x",
        "https://" + "a" * 3000 + ".com/",
    ],
)
def test_parse_and_validate_url_rejected(raw: str) -> None:
    with pytest.raises(URLValidationError):
        parse_and_validate_url(raw)


@pytest.mark.parametrize(
    "prop,url,expected",
    [
        ("https://example.com/", "https://example.com/", True),
        ("https://example.com/", "https://example.com/x", True),
        ("https://example.com/", "https://other.com/", False),
        ("https://example.com/", "http://example.com/", False),  # scheme mismatch
        ("sc-domain:example.com", "https://example.com/x", True),
        ("sc-domain:example.com", "https://blog.example.com/", True),
        ("sc-domain:example.com", "https://example.org/", False),
        ("sc-domain:example.com", "https://notexample.com/", False),
    ],
)
def test_property_matches_url(prop: str, url: str, expected: bool) -> None:
    assert _property_matches_url(prop, url) is expected


@pytest.mark.parametrize(
    "url",
    [
        # Subdomain-injection attempts — must NEVER match a URL-prefix property.
        "https://example.com.evil.com/",
        "https://example.com.evil.com/x",
        "https://evilexample.com/",
        "https://example-com.evil.com/",
    ],
)
def test_property_matches_url_blocks_subdomain_injection(url: str) -> None:
    assert _property_matches_url("https://example.com/", url) is False


def test_property_matches_url_with_path_prefix() -> None:
    """A URL-prefix property with a path should match its subpaths only."""
    assert _property_matches_url("https://example.com/blog/", "https://example.com/blog/x") is True
    assert _property_matches_url("https://example.com/blog/", "https://example.com/news/") is False
