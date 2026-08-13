import pytest

from structured_backend.config import Settings

pytestmark = pytest.mark.real_allowlist


def test_empty_allowlist_denies_when_mcp_enabled():
    settings = Settings(
        enable_mcp=True,
        authorized_discord_ids="",
        require_secure_secrets=False,
        bot_api_secret="unit-bot-secret",
        secret_key="unit-secret-key",
    )
    assert settings.is_discord_allowed("123") is False


def test_empty_allowlist_allows_when_mcp_disabled():
    settings = Settings(
        enable_mcp=False,
        authorized_discord_ids="",
        require_secure_secrets=False,
        bot_api_secret="unit-bot-secret",
        secret_key="unit-secret-key",
    )
    assert settings.is_discord_allowed("123") is True


def test_allowlist_membership():
    settings = Settings(
        enable_mcp=True,
        authorized_discord_ids="111, 222",
        require_secure_secrets=False,
        bot_api_secret="unit-bot-secret",
        secret_key="unit-secret-key",
    )
    assert settings.is_discord_allowed("111") is True
    assert settings.is_discord_allowed("222") is True
    assert settings.is_discord_allowed("333") is False
