from types import SimpleNamespace

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
