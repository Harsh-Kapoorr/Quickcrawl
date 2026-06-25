"""App-level settings storage.

Stores runtime-configurable settings in the DB (encrypted). The DB value
takes priority over the corresponding env var; deleting the DB row
restores the env value.
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.crypto import decrypt, encrypt
from app.auth.keychain import load_key
from app.config import get_settings
from app.db.models import AppSetting

GOOGLE_CLIENT_ID = "google_client_id"
GOOGLE_CLIENT_SECRET = "google_client_secret"  # noqa: S105 — DB key, not password


async def _read_db(db: AsyncSession, key: str) -> str | None:
    row = (
        await db.execute(select(AppSetting).where(AppSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        return None
    try:
        return decrypt(row.value_enc, load_key())
    except Exception:  # noqa: BLE001 — corrupted ciphertext or key changed
        return None


async def _write_db(db: AsyncSession, key: str, value: str) -> None:
    enc = encrypt(value, load_key())
    row = (
        await db.execute(select(AppSetting).where(AppSetting.key == key))
    ).scalar_one_or_none()
    if row is None:
        db.add(AppSetting(key=key, value_enc=enc))
    else:
        row.value_enc = enc
        row.updated_at = datetime.now(UTC)
    await db.commit()


async def _delete_db(db: AsyncSession, key: str) -> None:
    row = (
        await db.execute(select(AppSetting).where(AppSetting.key == key))
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()


async def get_google_oauth_credentials(db: AsyncSession) -> tuple[str, str, str]:
    """Return (client_id, client_secret, source) where source is 'db' or 'env'.

    The DB value (if present) takes priority over the env values.
    """
    db_id = await _read_db(db, GOOGLE_CLIENT_ID)
    db_secret = await _read_db(db, GOOGLE_CLIENT_SECRET)
    if db_id and db_secret:
        return db_id, db_secret, "db"
    s = get_settings()
    return s.google_client_id, s.google_client_secret, "env"


async def has_db_google_credentials(db: AsyncSession) -> bool:
    db_id = await _read_db(db, GOOGLE_CLIENT_ID)
    db_secret = await _read_db(db, GOOGLE_CLIENT_SECRET)
    return bool(db_id and db_secret)


async def set_google_oauth_credentials(
    db: AsyncSession, client_id: str, client_secret: str
) -> None:
    if not client_id.strip() or not client_secret.strip():
        raise ValueError("client_id and client_secret must be non-empty")
    await _write_db(db, GOOGLE_CLIENT_ID, client_id.strip())
    await _write_db(db, GOOGLE_CLIENT_SECRET, client_secret.strip())


async def clear_google_oauth_credentials(db: AsyncSession) -> None:
    await _delete_db(db, GOOGLE_CLIENT_ID)
    await _delete_db(db, GOOGLE_CLIENT_SECRET)
