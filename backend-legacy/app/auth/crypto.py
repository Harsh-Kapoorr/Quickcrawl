"""AES-256-GCM encryption for tokens at rest.

Format on disk (base64url-encoded):
    version (1B) || nonce (12B) || ciphertext || tag (16B)

`version` lets us rotate algorithms later without breaking old tokens.
"""
from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION_V1 = b"\x01"
NONCE_SIZE = 12
KEY_SIZE = 32  # AES-256


class CryptoError(Exception):
    """Generic encryption/decryption failure (do not leak details)."""


def generate_key() -> bytes:
    """Generate a fresh 256-bit key (e.g. for first-run keychain init)."""
    return AESGCM.generate_key(bit_length=KEY_SIZE * 8)


def encrypt(plaintext: str, key: bytes) -> str:
    """Encrypt UTF-8 string. Returns base64url string suitable for DB storage."""
    if len(key) != KEY_SIZE:
        raise CryptoError(f"key must be {KEY_SIZE} bytes, got {len(key)}")
    nonce = os.urandom(NONCE_SIZE)
    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), associated_data=VERSION_V1)
    blob = VERSION_V1 + nonce + ct
    return base64.urlsafe_b64encode(blob).decode("ascii")


def decrypt(ciphertext_b64: str, key: bytes) -> str:
    """Decrypt a string previously produced by `encrypt`.

    Raises CryptoError on any tampering (authentication tag mismatch).
    """
    try:
        blob = base64.urlsafe_b64decode(ciphertext_b64.encode("ascii"))
    except (ValueError, base64.binascii.Error) as exc:
        raise CryptoError("invalid ciphertext encoding") from exc

    if len(blob) < 1 + NONCE_SIZE + 16:
        raise CryptoError("ciphertext too short")
    version, nonce, ct = blob[0:1], blob[1 : 1 + NONCE_SIZE], blob[1 + NONCE_SIZE :]
    if version != VERSION_V1:
        raise CryptoError(f"unsupported version: {version!r}")

    try:
        aesgcm = AESGCM(key)
        pt = aesgcm.decrypt(nonce, ct, associated_data=VERSION_V1)
    except InvalidTag as exc:
        raise CryptoError("authentication failed (key mismatch or tampered data)") from exc

    return pt.decode("utf-8")
