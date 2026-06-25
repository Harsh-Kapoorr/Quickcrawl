"""Tests for the AES-256-GCM crypto module."""
from __future__ import annotations

import pytest

from app.auth.crypto import CryptoError, decrypt, encrypt, generate_key


def test_roundtrip_simple() -> None:
    key = generate_key()
    ct = encrypt("hello world", key)
    assert decrypt(ct, key) == "hello world"


def test_roundtrip_unicode() -> None:
    key = generate_key()
    msg = "héllo 🔑 中文"
    ct = encrypt(msg, key)
    assert decrypt(ct, key) == msg


def test_tampered_ciphertext_fails() -> None:
    key = generate_key()
    ct = encrypt("secret", key)
    # Flip a character in the middle of the ciphertext (not the version byte,
    # which encodes to 'A' on purpose and would be a no-op).
    mid = len(ct) // 2
    orig_char = ct[mid]
    flipped = "B" if orig_char != "B" else "C"
    bad = ct[:mid] + flipped + ct[mid + 1 :]
    assert bad != ct
    with pytest.raises(CryptoError):
        decrypt(bad, key)


def test_wrong_key_fails() -> None:
    ct = encrypt("secret", generate_key())
    with pytest.raises(CryptoError):
        decrypt(ct, generate_key())


def test_unique_nonces() -> None:
    key = generate_key()
    a = encrypt("same plaintext", key)
    b = encrypt("same plaintext", key)
    assert a != b, "two encryptions of the same plaintext must differ (unique nonce)"


def test_wrong_key_size_raises() -> None:
    with pytest.raises(CryptoError):
        encrypt("x", b"\x00" * 16)  # 128-bit key, expected 256


def test_invalid_ciphertext_raises() -> None:
    with pytest.raises(CryptoError):
        decrypt("not-base64-or-anything", generate_key())
