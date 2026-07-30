import pytest


@pytest.mark.asyncio
async def test_weekly_series_materializes_and_skip(client, api_headers):
    # Thursday 2026-07-23
    r = await client.post(
        "/v1/series",
        headers=api_headers,
        json={
            "title": "Weekly run",
            "freq": "weekly",
            "weekdays": [3],  # Thursday
            "start_day": "2026-07-23",
            "start_time": "17:00:00",
            "duration_minutes": 60,
        },
    )
    assert r.status_code == 201
    series_id = r.json()["id"]

    day = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-23"})
    assert day.status_code == 200
    occs = [t for t in day.json() if t.get("is_occurrence")]
    assert len(occs) == 1
    assert occs[0]["title"] == "Weekly run"

    # Next Thursday
    next_thu = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-30"})
    assert any(t.get("is_occurrence") for t in next_thu.json())

    # Skip July 23
    skip = await client.post(
        f"/v1/series/{series_id}/exceptions",
        headers=api_headers,
        json={"occurrence_day": "2026-07-23", "kind": "skip"},
    )
    assert skip.status_code == 200
    day2 = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-23"})
    assert not any(t.get("is_occurrence") for t in day2.json())

    # Complete July 30 occurrence only
    await client.post(
        f"/v1/series/{series_id}/occurrences/2026-07-30/complete",
        headers=api_headers,
    )
    thu30 = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-30"})
    occ = next(t for t in thu30.json() if t.get("is_occurrence"))
    assert occ["completed_at"] is not None

    # Aug 6 still open
    aug = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-08-06"})
    occ2 = next(t for t in aug.json() if t.get("is_occurrence"))
    assert occ2["completed_at"] is None


@pytest.mark.asyncio
async def test_skip_rejects_non_occurrence_day(client, api_headers):
    r = await client.post(
        "/v1/series",
        headers=api_headers,
        json={
            "title": "Monthly Slice",
            "freq": "monthly",
            "start_day": "2026-07-21",
            "is_all_day": True,
        },
    )
    assert r.status_code == 201
    series_id = r.json()["id"]

    bad = await client.post(
        f"/v1/series/{series_id}/exceptions",
        headers=api_headers,
        json={"occurrence_day": "2026-07-22", "kind": "skip"},
    )
    assert bad.status_code == 400
    body = bad.json()
    assert body["code"] == "validation_error"
    assert "does not match" in body["message"].lower()
