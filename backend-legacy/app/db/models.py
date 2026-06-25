"""SQLModel ORM models."""
from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum  # noqa: UP042

from sqlalchemy import Column, DateTime, Index, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class JobStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    SUBMITTED = "submitted"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PublishType(StrEnum):
    URL_UPDATED = "URL_UPDATED"
    URL_DELETED = "URL_DELETED"


class OAuthToken(SQLModel, table=True):
    """The single Google account's tokens (single-user local app).

    The actual token strings are encrypted at rest in `access_token_enc`
    and `refresh_token_enc` (AES-256-GCM, key in OS Keychain).
    """

    __tablename__ = "oauth_token"

    id: int | None = Field(default=None, primary_key=True)
    google_sub: str = Field(index=True, unique=True, description="Google user ID")
    email: str = Field(index=True)
    name: str | None = None
    picture: str | None = None
    scope: str = Field(sa_column=Column(Text))

    access_token_enc: str = Field(sa_column=Column(Text))
    refresh_token_enc: str | None = Field(default=None, sa_column=Column(Text))
    token_type: str = Field(default="Bearer")
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True)))

    created_at: datetime = Field(default_factory=_utcnow, sa_column=Column(DateTime(timezone=True)))
    updated_at: datetime = Field(default_factory=_utcnow, sa_column=Column(DateTime(timezone=True)))


class PendingOAuth(SQLModel, table=True):
    """Short-lived state for in-flight OAuth flows.

    Stores the PKCE verifier and a CSRF `state` token. The
    `expires_at` column is enforced: any row past expiry is swept on
    app startup so PKCE material doesn't accumulate in the DB.
    """

    __tablename__ = "pending_oauth"

    state: str = Field(primary_key=True, max_length=64)
    code_verifier: str = Field(sa_column=Column(Text))
    created_at: datetime = Field(default_factory=_utcnow, sa_column=Column(DateTime(timezone=True)))
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True)))


class Property(SQLModel, table=True):
    """A Search Console site the user has access to."""

    __tablename__ = "property"
    __table_args__ = (UniqueConstraint("google_sub", "site_url", name="uq_property_user_site"),)

    id: int | None = Field(default=None, primary_key=True)
    google_sub: str = Field(index=True)
    site_url: str = Field(index=True, description="e.g. sc-domain:example.com or https://example.com/")
    permission_level: str = Field(default="siteOwner")
    last_synced: datetime = Field(default_factory=_utcnow, sa_column=Column(DateTime(timezone=True)))


class Batch(SQLModel, table=True):
    """A user-submitted group of URL jobs."""

    __tablename__ = "batch"

    id: int | None = Field(default=None, primary_key=True)
    name: str | None = Field(default=None, max_length=200)
    google_sub: str = Field(index=True)
    property_url: str
    publish_type: str = Field(default=PublishType.URL_UPDATED)
    total: int = Field(default=0)
    pending: int = Field(default=0)
    processing: int = Field(default=0)
    succeeded: int = Field(default=0)
    failed: int = Field(default=0)
    cancelled: int = Field(default=0)
    created_at: datetime = Field(default_factory=_utcnow, sa_column=Column(DateTime(timezone=True)))


class Job(SQLModel, table=True):
    """One URL submission attempt (part of a Batch)."""

    __tablename__ = "job"
    __table_args__ = (
        Index("ix_job_status_created", "status", "created_at"),
        Index("ix_job_batch", "batch_id"),
    )

    id: int | None = Field(default=None, primary_key=True)
    batch_id: int = Field(foreign_key="batch.id", index=True)
    url: str = Field(sa_column=Column(Text))
    property_url: str
    publish_type: str = Field(default=PublishType.URL_UPDATED)
    status: str = Field(default=JobStatus.PENDING, index=True)
    attempts: int = Field(default=0)
    last_error: str | None = Field(default=None, sa_column=Column(Text))
    http_status: int | None = Field(default=None)
    google_notify_time: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )

    created_at: datetime = Field(default_factory=_utcnow, sa_column=Column(DateTime(timezone=True)))
    next_attempt_at: datetime = Field(default_factory=_utcnow, sa_column=Column(DateTime(timezone=True)))
    submitted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    completed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class QuotaUsage(SQLModel, table=True):
    """One row per UTC day. Tracks how many publish calls we've made."""

    __tablename__ = "quota_usage"
    __table_args__ = (UniqueConstraint("day", name="uq_quota_day"),)

    id: int | None = Field(default=None, primary_key=True)
    day: str = Field(index=True, description="YYYY-MM-DD (UTC)")
    count: int = Field(default=0)
    last_request_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class RevokedSession(SQLModel, table=True):
    """Session tokens the user has explicitly logged out.

    Allows server-side session revocation (since signed cookies can't
    be invalidated by changing the key alone). Tokens here are pruned
    on app startup once they're older than the session max-age.
    """

    __tablename__ = "revoked_session"
    __table_args__ = (UniqueConstraint("token", name="uq_revoked_token"),)

    id: int | None = Field(default=None, primary_key=True)
    token: str = Field(sa_column=Column(Text))
    revoked_at: datetime = Field(default_factory=_utcnow, sa_column=Column(DateTime(timezone=True)))


class AppSetting(SQLModel, table=True):
    """Encrypted key-value store for runtime-configurable settings.

    Values are AES-256-GCM encrypted with the same keychain key used
    for OAuth tokens, so secrets stored here are protected at rest the
    same way.

    Used by the UI to override env-only config (e.g. Google OAuth
    credentials) without restarting the backend.
    """

    __tablename__ = "app_setting"

    key: str = Field(primary_key=True, max_length=64)
    value_enc: str = Field(sa_column=Column(Text))
    updated_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True)),
    )
