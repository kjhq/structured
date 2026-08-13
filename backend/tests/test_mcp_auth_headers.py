from types import SimpleNamespace

import pytest

from structured_backend.config import settings
from structured_backend.errors import AppError
from structured_backend.mcp_server import server as mcp_server


def test_auth_headers_from_mcp_request_reads_starlette_like_request(monkeypatch):
    req = SimpleNamespace(
        headers={"x-bot-secret": "sec", "x-discord-id": "123"},
    )
    ctx = SimpleNamespace(request_context=SimpleNamespace(request=req))
    monkeypatch.setattr(mcp_server.mcp, "get_context", lambda: ctx)

    secret, discord_id = mcp_server._auth_headers_from_mcp_request()
    assert secret == "sec"
    assert discord_id == "123"


def test_auth_headers_from_mcp_request_missing_context(monkeypatch):
    def boom():
        raise RuntimeError("no ctx")

    monkeypatch.setattr(mcp_server.mcp, "get_context", boom)
    assert mcp_server._auth_headers_from_mcp_request() == (None, None)


@pytest.mark.asyncio
async def test_session_and_user_refuses_missing_request_headers(monkeypatch):
    def boom():
        raise RuntimeError("no ctx")

    monkeypatch.setattr(mcp_server.mcp, "get_context", boom)
    monkeypatch.setattr(settings, "bot_api_secret", "sec")
    mcp_server.set_bot_secret("sec")
    mcp_server.set_discord_id("123")

    with pytest.raises(AppError) as exc:
        async for _ in mcp_server._session_and_user():
            pass
    assert exc.value.status_code == 401


def test_auth_headers_from_mcp_request_reads_starlette_like_request(monkeypatch):
    req = SimpleNamespace(
        headers={"x-bot-secret": "sec", "x-discord-id": "123"},
    )
    ctx = SimpleNamespace(request_context=SimpleNamespace(request=req))
    monkeypatch.setattr(mcp_server.mcp, "get_context", lambda: ctx)

    secret, discord_id = mcp_server._auth_headers_from_mcp_request()
    assert secret == "sec"
    assert discord_id == "123"


def test_auth_headers_from_mcp_request_missing_context(monkeypatch):
    def boom():
        raise RuntimeError("no ctx")

    monkeypatch.setattr(mcp_server.mcp, "get_context", boom)
    assert mcp_server._auth_headers_from_mcp_request() == (None, None)
