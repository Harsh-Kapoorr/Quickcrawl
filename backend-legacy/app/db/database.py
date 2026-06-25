"""Database engine, session factory, and FastAPI dependency.

SQLite + asyncio is finicky: the worker polls every second while user
requests can also write, and aiosqlite's pool doesn't reliably
serialize them on its own. We use a process-wide asyncio.Lock to
serialize DB-mutating operations, with a separate async path for
pure reads (which SQLite handles fine concurrently via WAL).
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from pathlib import Path

import aiosqlite
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from app.config import get_settings

_engine: async_sessionmaker[AsyncSession] | None = None
_write_lock: asyncio.Lock | None = None


def _ensure_data_dir() -> None:
    Path(get_settings().data_dir).mkdir(parents=True, exist_ok=True)


def _connect() -> aiosqlite.Connection:
    """Return an aiosqlite connection factory with WAL + busy_timeout.

    Note: aiosqlite's connect is async, but SQLAlchemy's async engine
    expects a sync factory here. We use the synchronous sqlite3 path
    inside `creator` and let aiosqlite handle async wrapping.
    """
    import sqlite3

    db_path = get_settings().db_url.replace("sqlite+aiosqlite:///", "", 1)
    conn = sqlite3.connect(db_path, timeout=30, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def get_engine() -> async_sessionmaker[AsyncSession]:
    """Lazy-init the engine. Called once on first request / startup."""
    global _engine, _write_lock
    if _engine is None:
        _ensure_data_dir()
        eng = create_async_engine(
            get_settings().db_url,
            echo=False,
            future=True,
            # `creator` lets us hand SQLAlchemy a fully-configured
            # sqlite3.Connection (with PRAGMAs set) that aiosqlite wraps.
            creator=_connect,
        )
        _engine = async_sessionmaker(eng, expire_on_commit=False, class_=AsyncSession)
    if _write_lock is None:
        _write_lock = asyncio.Lock()
    return _engine


def get_write_lock() -> asyncio.Lock:
    """Process-wide lock that all DB writes must hold.

    SQLite serializes writes at the OS level (one writer at a time);
    without this lock, aiosqlite's per-connection task scheduling lets
    two writes interleave and the second one hits `database is locked`
    before busy_timeout kicks in.
    """
    get_engine()  # ensure init
    assert _write_lock is not None
    return _write_lock


async def init_db() -> None:
    """Create all tables. Idempotent — safe to call on every startup."""
    factory = get_engine()
    # Import models so SQLModel.metadata is populated before create_all.
    from app.db import models  # noqa: F401

    async with factory() as session:
        conn = await session.connection()
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: per-request async session."""
    factory = get_engine()
    async with factory() as session:
        yield session
