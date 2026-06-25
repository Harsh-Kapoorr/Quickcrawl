"""Tests for PKCE + state generation (no DB or HTTP needed)."""
from __future__ import annotations

import pytest

from app.auth.oauth import _new_pkce_pair, _new_state


def test_state_is_unique_and_long() -> None:
    a, b = _new_state(), _new_state()
    assert a != b
    assert len(a) >= 32


def test_pkce_pair_shape() -> None:
    verifier, challenge = _new_pkce_pair()
    assert 43 <= len(verifier) <= 128
    # Challenge must be SHA-256(verifier) → 43 chars of base64url-no-pad
    import base64
    import hashlib

    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    assert challenge == expected
    assert 43 <= len(challenge) <= 64


@pytest.mark.parametrize("i", range(5))
def test_pkce_unique_per_call(i: int) -> None:  # noqa: ARG001
    v1, _ = _new_pkce_pair()
    v2, _ = _new_pkce_pair()
    assert v1 != v2
