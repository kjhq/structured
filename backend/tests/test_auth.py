import pytest


@pytest.mark.asyncio
async def test_me_requires_widget_auth(client):
    response = await client.get("/v1/me")
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


@pytest.mark.asyncio
async def test_me_with_widget_token(client, api_headers):
    response = await client.get("/v1/me", headers=api_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["timezone"] == "Asia/Kolkata"
    assert "id" in body


@pytest.mark.asyncio
async def test_me_rejects_bad_token(client, api_headers):
    bad = {**api_headers, "X-Widget-Token": "wt_nope"}
    response = await client.get("/v1/me", headers=bad)
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


@pytest.mark.asyncio
async def test_bot_link_requires_secret(client):
    response = await client.post("/v1/bot/link", json={"discord_id": "555"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_bot_link_returns_token(client, monkeypatch):
    from structured_backend.config import settings

    monkeypatch.setattr(settings, "bot_api_secret", "test-bot-secret")
    response = await client.post(
        "/v1/bot/link",
        json={"discord_id": "555"},
        headers={"X-Bot-Secret": "test-bot-secret"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["discord_id"] == "555"
    assert body["widget_token"].startswith("wt_")

    me = await client.get(
        "/v1/me",
        headers={"X-Discord-Id": "555", "X-Widget-Token": body["widget_token"]},
    )
    assert me.status_code == 200
