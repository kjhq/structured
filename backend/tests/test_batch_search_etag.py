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
async def test_batch_rollback_on_error(client, api_headers):
    good = await client.post("/v1/tasks", headers=api_headers, json={"title": "Good"})
    good_id = good.json()["id"]
    bad_id = "00000000-0000-0000-0000-000000000099"
    r = await client.post(
        "/v1/tasks/batch",
        headers=api_headers,
        json={"action": "complete", "task_ids": [good_id, bad_id]},
    )
    assert r.status_code == 404
    inbox = await client.get("/v1/inbox", headers=api_headers)
    task = next(t for t in inbox.json() if t["id"] == good_id)
    assert task["completed_at"] is None


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


@pytest.mark.asyncio
async def test_etag_changes_on_title_update(client, api_headers):
    created = await client.post(
        "/v1/tasks",
        headers=api_headers,
        json={"title": "Original", "day": "2026-07-23", "is_all_day": True},
    )
    task_id = created.json()["id"]
    first = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-23"})
    etag_before = first.headers["etag"]

    await client.patch(
        f"/v1/tasks/{task_id}",
        headers=api_headers,
        json={"title": "Renamed"},
    )
    second = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-23"})
    etag_after = second.headers["etag"]
    assert etag_before != etag_after


@pytest.mark.asyncio
async def test_range_cap_returns_400(client, api_headers, monkeypatch):
    monkeypatch.setattr("structured_backend.config.settings.max_range_days", 30)
    r = await client.get(
        "/v1/tasks",
        headers=api_headers,
        params={"day_from": "2026-01-01", "day_to": "2026-03-01"},
    )
    assert r.status_code == 400
    assert r.json()["code"] == "validation_error"
