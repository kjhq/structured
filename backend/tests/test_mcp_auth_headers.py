import json
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


def test_tool_result_sets_is_error_when_payload_has_error():
    err = mcp_server._tool_result({"error": True, "code": "not_found", "message": "missing"})
    assert err.isError is True
    payload = json.loads(err.content[0].text)
    assert payload["error"] is True
    ok = mcp_server._tool_result({"title": "Gym"})
    assert ok.isError is False


@pytest.mark.asyncio
async def test_run_sets_is_error_on_app_error(monkeypatch):
    async def boom():
        raise AppError("not_found", "missing", status_code=404)
        if False:  # pragma: no cover
            yield None, None

    monkeypatch.setattr(mcp_server, "_session_and_user", boom)

    async def dummy(_db, _user):
        return {"title": "unused"}

    result = await mcp_server._run(dummy)
    assert result.isError is True
    payload = json.loads(result.content[0].text)
    assert payload["error"] is True
    assert payload["code"] == "not_found"


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
