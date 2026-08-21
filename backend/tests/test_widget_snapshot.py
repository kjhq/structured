import pytest
from datetime import datetime, timezone


@pytest.mark.asyncio
async def test_widget_snapshot_due_includes_missed_recurrence(client, api_headers, monkeypatch):
    frozen = datetime(2026, 7, 30, 4, 30, tzinfo=timezone.utc)  # 10:00 IST Jul 30
    monkeypatch.setattr("structured_backend.timeutil.utcnow", lambda: frozen)
    monkeypatch.setattr("structured_backend.services.widget_snapshot.utcnow", lambda: frozen)

    # Weekly Thursday series starting Jul 16 — Jul 23 missed before "today" Jul 30
    series = await client.post(
        "/v1/series",
        headers=api_headers,
        json={
            "title": "Weekly missed",
            "freq": "weekly",
            "weekdays": [3],
            "start_day": "2026-07-16",
            "is_all_day": True,
        },
    )
    assert series.status_code == 201

    snap = await client.get("/v1/widget/snapshot", headers=api_headers)
    assert snap.status_code == 200
    body = snap.json()
    due_occ = [d for d in body["due"] if d.get("is_occurrence")]
    assert len(due_occ) >= 1
    # Latest missed should be Jul 23 (most recent incomplete before today Jul 30)
    assert any(d["day"] == "2026-07-23" for d in due_occ)
    assert all(d["completed_at"] is None for d in due_occ)


@pytest.mark.asyncio
async def test_widget_snapshot_occurrence_includes_alerts(client, api_headers, monkeypatch):
    frozen = datetime(2026, 7, 30, 4, 30, tzinfo=timezone.utc)
    monkeypatch.setattr("structured_backend.timeutil.utcnow", lambda: frozen)
    monkeypatch.setattr("structured_backend.services.widget_snapshot.utcnow", lambda: frozen)

    series = await client.post(
        "/v1/series",
        headers=api_headers,
        json={
            "title": "Gym",
            "freq": "weekly",
            "weekdays": [3],
            "start_day": "2026-07-16",
            "start_time": "07:00:00",
            "alerts": [{"kind": "start", "offset_minutes": -10}],
        },
    )
    assert series.status_code == 201

    snap = await client.get("/v1/widget/snapshot", headers=api_headers)
    assert snap.status_code == 200
    today_occ = [d for d in snap.json()["today"] if d.get("is_occurrence")]
    assert today_occ
    assert today_occ[0]["alerts"] == [{"kind": "start", "offset_minutes": -10}]


@pytest.mark.asyncio
async def test_widget_snapshot_etag(client, api_headers):
    first = await client.get("/v1/widget/snapshot", headers=api_headers)
    etag = first.headers["etag"]
    assert etag == f'"{first.json()["version"]}"'
    second = await client.get(
        "/v1/widget/snapshot",
        headers={**api_headers, "If-None-Match": etag},
    )
    assert second.status_code == 304

    created = await client.post(
        "/v1/tasks",
        headers=api_headers,
        json={"title": "etag-probe", "day": "2026-07-30", "is_all_day": True},
    )
    assert created.status_code == 201
    task_id = created.json()["id"]
    after_create = await client.get("/v1/widget/snapshot", headers=api_headers)
    assert after_create.status_code == 200
    assert after_create.headers["etag"] != etag

    patched = await client.patch(
        f"/v1/tasks/{task_id}",
        headers=api_headers,
        json={"title": "etag-probe-renamed"},
    )
    assert patched.status_code == 200
    after_rename = await client.get(
        "/v1/widget/snapshot",
        headers={**api_headers, "If-None-Match": after_create.headers["etag"]},
    )
    assert after_rename.status_code == 200
    assert after_rename.headers["etag"] != after_create.headers["etag"]
