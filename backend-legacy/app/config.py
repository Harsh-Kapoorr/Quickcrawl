"""Application configuration loaded from environment / .env file."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    google_client_id: str = Field(default="", description="Google OAuth client ID")
    google_client_secret: str = Field(default="", description="Google OAuth client secret")

    backend_url: str = Field(
        default="http://127.0.0.1:8000",
        description="Public-facing URL of the backend (used in OAuth redirects)",
    )
    frontend_url: str = Field(
        default="http://localhost:3000",
        description="Frontend origin allowed by CORS",
    )

    data_dir: Path = Field(default=Path("./data"), description="Directory for SQLite DB")
    database_url: str | None = Field(default=None, description="Override DB URL")

    encryption_passphrase: str = Field(
        default="",
        description=(
            "Fallback passphrase to derive encryption key if OS keychain "
            "is unavailable. Leave empty to require keychain."
        ),
    )

    host: str = Field(default="127.0.0.1", description="Bind address")
    port: int = Field(default=8000, ge=1, le=65535)
    log_level: str = Field(default="INFO")
    allow_lan_bind: bool = Field(
        default=False,
        description="Opt-in to bind to LAN addresses. Refused by default.",
    )
    session_cookie_secure: bool = Field(
        default=False,
        description=(
            "Send session cookies over HTTPS only. MUST be true when "
            "binding to non-loopback addresses."
        ),
    )

    daily_quota: int = Field(default=200, ge=1, description="Max publishes per UTC day")
    min_request_interval: float = Field(
        default=1.0, ge=0.0, description="Min seconds between API calls"
    )
    max_attempts: int = Field(default=5, ge=1, le=20)
    dedup_window_hours: int = Field(
        default=1,
        ge=0,
        description=(
            "Hours after a successful submit during which the same URL+property "
            "is treated as a 'recently submitted' duplicate and surfaced as a "
            "soft warning. Set to 0 to disable the check."
        ),
    )

    @field_validator("host")
    @classmethod
    def _no_public_bind(cls, v: str, info) -> str:  # type: ignore[no-untyped-def]
        """Refuse to bind to anything other than loopback by default.

        Loopback: 127.0.0.0/8 and ::1. Other addresses (LAN IPs, public
        IPs, 0.0.0.0) require an explicit `ALLOW_LAN_BIND=1` opt-in so
        the app stays local-only by default. Public binds (0.0.0.0, ::)
        are NEVER allowed.
        """
        v = v.strip()
        # The strings below are values we REFUSE outright, not values we bind to.
        forbidden = {"0.0.0.0", "::", ""}  # noqa: S104
        if v in forbidden:
            raise ValueError(
                f"Refusing to bind to {v!r}. GSC Indexer is a local-only app; "
                "use 127.0.0.1 or [::1]. To opt in to LAN, set ALLOW_LAN_BIND=1."
            )
        allow_lan = info.data.get("allow_lan_bind", False) if info.data else False
        if v in ("127.0.0.1", "localhost", "::1"):
            return v
        if allow_lan:
            return v
        raise ValueError(
            f"Refusing to bind to non-loopback address {v!r}. "
            "This is a local-only app; if you really want LAN access, "
            "set ALLOW_LAN_BIND=1 in .env AND enable HTTPS."
        )

    @model_validator(mode="after")
    def _lan_requires_secure(self) -> Settings:
        if self.allow_lan_bind and not self.session_cookie_secure:
            raise ValueError(
                "ALLOW_LAN_BIND=1 requires SESSION_COOKIE_SECURE=1 "
                "(HTTPS-only session cookies). Set both in .env."
            )
        return self

    @property
    def db_path(self) -> Path:
        return self.data_dir / "gsc.db"

    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite+aiosqlite:///{self.db_path}"

    @property
    def google_oauth_scopes(self) -> list[str]:
        return [
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
            "https://www.googleapis.com/auth/indexing",
            "https://www.googleapis.com/auth/webmasters.readonly",
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
