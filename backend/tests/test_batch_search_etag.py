import pytest


@pytest.mark.asyncio
async def test_batch_complete(client, api_headers):
    a = await client.post("/v1/tasks", headers=api_headers, json={"title": "A"})
    b = await client.post("/v1/tasks", headers=api_headers, json={"title": "B"})
    ids = [a.json()["id"], b.json()["id"]]
    r = await client.post(
        "/v1/tasks/batch",
        headers=api_headers,
        json={"action": "complete", "task_ids": ids},
    )
    assert r.status_code == 200
    assert all(t["completed_at"] is not None for t in r.json())


@pytest.mark.asyncio
async def test_search(client, api_headers):
    await client.post("/v1/tasks", headers=api_headers, json={"title": "Grocery run"})
    await client.post("/v1/tasks", headers=api_headers, json={"title": "Other"})
    r = await client.get("/v1/tasks/search", headers=api_headers, params={"q": "groc"})
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert "Grocery" in r.json()[0]["title"]


@pytest.mark.asyncio
async def test_etag_304(client, api_headers):
    await client.post(
        "/v1/tasks",
        headers=api_headers,
        json={"title": "Day", "day": "2026-07-23", "is_all_day": True},
    )
    first = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-23"})
    etag = first.headers["etag"]
    second = await client.get(
        "/v1/tasks",
        headers={**api_headers, "If-None-Match": etag},
        params={"day": "2026-07-23"},
    )
    assert second.status_code == 304
