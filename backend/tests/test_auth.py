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
