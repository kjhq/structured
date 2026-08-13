from __future__ import annotations

import secrets as secrets_mod

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_KNOWN_INSECURE_SECRETS = frozenset(
    {
        "change-me",
        "change-me-in-production",
        "change-me-bot-secret",
        "dev-bot-secret",
        "dev-api-key",
    }
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://structured:structured@localhost:5432/structured"
    secret_key: str = "change-me"
    bot_api_secret: str = "dev-bot-secret"
    api_key: str = "dev-api-key"
    cors_origins: list[str] = ["http://localhost:3000"]
    """Comma-separated Discord snowflakes allowed for bot/MCP/link/widget. Empty = deny all when MCP is on."""
    authorized_discord_ids: str = ""
    """When True, mount /mcp on this process. Public REST deploy should set False."""
    enable_mcp: bool = True
    """When True, refuse known insecure default secrets at startup."""
    require_secure_secrets: bool = False
    """Max days allowed for day_from/day_to materialization."""
    max_range_days: int = 366
    """Max task_ids in a single batch request."""
    max_batch_size: int = 100
    """Max notification rows claimed per due poll."""
    notification_claim_limit: int = 50

    @field_validator("bot_api_secret", "secret_key")
    @classmethod
    def _strip_secret(cls, v: str) -> str:
        return v.strip()

    @model_validator(mode="after")
    def _reject_insecure_defaults(self) -> Settings:
        if not self.require_secure_secrets:
            return self
        for name, value in (
            ("BOT_API_SECRET", self.bot_api_secret),
            ("SECRET_KEY", self.secret_key),
        ):
            if not value or value in _KNOWN_INSECURE_SECRETS:
                raise ValueError(
                    f"{name} is missing or uses a known insecure default. "
                    "Set a strong random secret and REQUIRE_SECURE_SECRETS=true."
                )
        return self

    def authorized_id_set(self) -> set[str] | None:
        raw = self.authorized_discord_ids.strip()
        if not raw:
            return None
        return {s.strip() for s in raw.split(",") if s.strip()}

    def is_discord_allowed(self, discord_id: str) -> bool:
        allowed = self.authorized_id_set()
        if allowed is None:
            return not self.enable_mcp
        return discord_id in allowed

    def bot_secret_ok(self, provided: str | None) -> bool:
        if not provided:
            return False
        return secrets_mod.compare_digest(provided, self.bot_api_secret)


settings = Settings()
