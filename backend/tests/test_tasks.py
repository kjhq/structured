from datetime import date, datetime, time, timezone
from uuid import UUID

import pytest

from structured_backend.timeutil import user_today


@pytest.mark.asyncio
async def test_create_inbox_and_list(client, api_headers):
    r = await client.post("/v1/tasks", headers=api_headers, json={"title": "Buy milk"})
    assert r.status_code == 201
    task = r.json()
    assert task["day"] is None
    assert task["completed_at"] is None

    inbox = await client.get("/v1/inbox", headers=api_headers)
    assert inbox.status_code == 200
    assert any(t["id"] == task["id"] for t in inbox.json())


@pytest.mark.asyncio
async def test_create_all_day_on_today(client, api_headers):
    r = await client.post(
        "/v1/tasks",
        headers=api_headers,
        json={"title": "Focus day", "day": "2026-07-23", "is_all_day": True},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["is_all_day"] is True
    assert body["start_time"] is None

    day = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-23"})
    assert any(t["id"] == body["id"] for t in day.json())


@pytest.mark.asyncio
async def test_timed_requires_start(client, api_headers):
    r = await client.post(
        "/v1/tasks",
        headers=api_headers,
        json={"title": "Meeting", "day": "2026-07-23"},
    )
    assert r.status_code == 400
    assert r.json()["code"] == "validation_error"


@pytest.mark.asyncio
async def test_incomplete_yesterday_still_incomplete(client, api_headers, monkeypatch):
    # Create all-day on July 22
    r = await client.post(
        "/v1/tasks",
        headers=api_headers,
        json={"title": "Leftover", "day": "2026-07-22", "is_all_day": True},
    )
    assert r.status_code == 201
    task_id = r.json()["id"]

    # Freeze "now" to July 23 morning Kolkata
    frozen = datetime(2026, 7, 23, 4, 30, tzinfo=timezone.utc)  # 10:00 IST

    import structured_backend.services.tasks as tasks_mod
    import structured_backend.timeutil as timeutil

    monkeypatch.setattr(timeutil, "utcnow", lambda: frozen)
    monkeypatch.setattr(tasks_mod, "utcnow", lambda: frozen)

    detail = await client.get(f"/v1/tasks?day=2026-07-22", headers=api_headers)
    found = next(t for t in detail.json() if t["id"] == task_id)
    assert found["completed_at"] is None

    open_r = await client.get("/v1/tasks/open", headers=api_headers)
    assert open_r.status_code == 200
    assert any(t["id"] == task_id for t in open_r.json())

    today_r = await client.get("/v1/today", headers=api_headers)
    assert all(t["id"] != task_id for t in today_r.json())


@pytest.mark.asyncio
async def test_open_excludes_inbox(client, api_headers):
    r = await client.post("/v1/tasks", headers=api_headers, json={"title": "inbox only"})
    task_id = r.json()["id"]
    open_r = await client.get("/v1/tasks/open", headers=api_headers)
    assert all(t["id"] != task_id for t in open_r.json())


@pytest.mark.asyncio
async def test_complete_uncomplete_delete(client, api_headers):
    r = await client.post("/v1/tasks", headers=api_headers, json={"title": "Do it"})
    task_id = r.json()["id"]

    done = await client.post(f"/v1/tasks/{task_id}/complete", headers=api_headers)
    assert done.status_code == 200
    assert done.json()["completed_at"] is not None

    undone = await client.post(f"/v1/tasks/{task_id}/uncomplete", headers=api_headers)
    assert undone.json()["completed_at"] is None

    deleted = await client.delete(f"/v1/tasks/{task_id}", headers=api_headers)
    assert deleted.status_code == 204
    inbox = await client.get("/v1/inbox", headers=api_headers)
    assert all(t["id"] != task_id for t in inbox.json())


@pytest.mark.asyncio
async def test_idempotent_create(client, api_headers):
    payload = {"title": "Once", "client_request_id": "req-1"}
    a = await client.post("/v1/tasks", headers=api_headers, json=payload)
    b = await client.post("/v1/tasks", headers=api_headers, json=payload)
    assert a.status_code == 201
    assert b.status_code == 201
    assert a.json()["id"] == b.json()["id"]
