"""OS keychain integration for the encryption key.

Strategy:
1. Try OS keychain via the `keyring` library.
2. If unavailable (no daemon, headless CI, etc.), fall back to a
   passphrase-derived key (PBKDF2-HMAC-SHA256). The salt is a per-
   installation random value stored next to the DB so offline attackers
   can't precompute a single rainbow table for every installation.

Storage layout when KEYCHAIN is available:
    keyring("gsc-indexer", "encryption-key")  ->  random 32-byte AES key
    keyring("gsc-indexer", "encryption-salt") ->  random 16-byte PBKDF2 salt
                                                 (used only as fallback
                                                  so passphrase mode works
                                                  even after the keychain
                                                  becomes unavailable)

Storage layout when KEYCHAIN is NOT available (passphrase mode):
    data/.salt  ->  random 16-byte PBKDF2 salt
"""
from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path

import keyring
from keyring.errors import KeyringError, NoKeyringError

from app.auth.crypto import generate_key
from app.config import get_settings

log = logging.getLogger(__name__)

KEYRING_SERVICE = "gsc-indexer"
KEYRING_USER_KEY = "encryption-key"
KEYRING_USER_SALT = "encryption-salt"
SALT_SIZE = 16
FALLBACK_SALT_FILE = ".salt"


class KeychainError(RuntimeError):
    """No keychain backend AND no passphrase configured, or other key issue."""


def _keyring_available() -> bool:
    try:
        keyring.get_keyring()
        return True
    except NoKeyringError:
        return False
    except Exception as exc:  # noqa: BLE001 — defensive, keyring raises many
        log.warning("keyring backend error: %s", exc)
        return False


def _salt_path() -> Path:
    return Path(get_settings().data_dir) / FALLBACK_SALT_FILE


def _read_or_create_salt() -> bytes:
    """Return the persistent salt, creating one if missing."""
    if _keyring_available():
        existing_hex = keyring.get_password(KEYRING_SERVICE, KEYRING_USER_SALT)
        if existing_hex:
            return bytes.fromhex(existing_hex)
        salt = os.urandom(SALT_SIZE)
        keyring.set_password(KEYRING_SERVICE, KEYRING_USER_SALT, salt.hex())
        return salt

    path = _salt_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return path.read_bytes()
    salt = os.urandom(SALT_SIZE)
    # Restrictive permissions: only the owner can read the salt.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, salt)
    finally:
        os.close(fd)
    return salt


def _passphrase_key(passphrase: str, salt: bytes) -> bytes:
    """Derive a 32-byte key from a user passphrase via PBKDF2."""
    if not passphrase:
        raise KeychainError("passphrase is empty")
    return hashlib.pbkdf2_hmac(
        "sha256",
        passphrase.encode("utf-8"),
        salt,
        iterations=600_000,
        dklen=32,
    )


def get_or_create_key() -> bytes:
    """Load the encryption key, creating one if needed.

    Raises KeychainError if neither keychain nor passphrase is available.
    """
    if _keyring_available():
        existing = keyring.get_password(KEYRING_SERVICE, KEYRING_USER_KEY)
        if existing is not None:
            return bytes.fromhex(existing)
        key = generate_key()
        keyring.set_password(KEYRING_SERVICE, KEYRING_USER_KEY, key.hex())
        # Always ensure a salt exists too (used by passphrase fallback)
        _read_or_create_salt()
        log.info("generated and stored new encryption key in OS keychain")
        return key

    passphrase = get_settings().encryption_passphrase
    if passphrase:
        log.warning(
            "OS keychain unavailable — using passphrase-derived encryption key. "
            "Set encryption_passphrase in .env to the SAME value on every run, "
            "otherwise stored tokens cannot be decrypted."
        )
        salt = _read_or_create_salt()
        return _passphrase_key(passphrase, salt)

    raise KeychainError(
        "No OS keychain AND no ENCRYPTION_PASSPHRASE configured. "
        "Set ENCRYPTION_PASSPHRASE in backend/.env to enable token storage."
    )


def load_key() -> bytes:
    """Get the encryption key without creating a new one if missing.

    Raises KeychainError when storage is unconfigured.
    """
    try:
        return get_or_create_key()
    except KeychainError:
        raise
    except KeyringError as exc:
        log.error("keyring error: %s", exc)
        raise KeychainError(str(exc)) from exc
