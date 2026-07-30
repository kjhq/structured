import pytest


@pytest.mark.asyncio
async def test_weekly_interval_multi_weekday_same_bucket(client, api_headers):
    """interval=2 weekly series: Mon+Wed in same ISO week share one active week."""
    r = await client.post(
        "/v1/series",
        headers=api_headers,
        json={
            "title": "Biweekly MW",
            "freq": "weekly",
            "interval": 2,
            "weekdays": [0, 2],  # Mon, Wed
            "start_day": "2026-07-20",  # Monday
            "is_all_day": True,
        },
    )
    assert r.status_code == 201

    # Week 0: Mon Jul 20 and Wed Jul 22 both match
    mon = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-20"})
    wed = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-22"})
    assert any(t.get("is_occurrence") for t in mon.json())
    assert any(t.get("is_occurrence") for t in wed.json())

    # Week 1 (Jul 27–Aug 2): neither Mon Jul 27 nor Wed Jul 29
    mon2 = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-27"})
    wed2 = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-07-29"})
    assert not any(t.get("is_occurrence") for t in mon2.json())
    assert not any(t.get("is_occurrence") for t in wed2.json())

    # Week 2: Mon Aug 3 matches again
    mon3 = await client.get("/v1/tasks", headers=api_headers, params={"day": "2026-08-03"})
    assert any(t.get("is_occurrence") for t in mon3.json())
