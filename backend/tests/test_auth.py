import pytest


@pytest.mark.asyncio
async def test_me_requires_api_key(client):
    response = await client.get("/v1/me")
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


@pytest.mark.asyncio
async def test_me_with_key(client, api_headers):
    response = await client.get("/v1/me", headers=api_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["timezone"] == "Asia/Kolkata"
    assert "id" in body
