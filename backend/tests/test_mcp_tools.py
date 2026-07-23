import pytest
from datetime import date, time

from structured_backend.mcp_server.tools import (
    ResponseFormat,
    parse_occurrence_id,
    planner_complete_tasks,
    planner_create_series,
    planner_create_task,
    planner_delete_series,
    planner_delete_tasks,
    planner_find_tasks,
    planner_get_overview,
    planner_list_series,
    planner_skip_occurrence,
)
from structured_backend.services import users as user_service
from structured_backend.services.series import occurrence_id


@pytest.mark.asyncio
async def test_planner_overview_and_find(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="mcp-test-user", timezone="Asia/Kolkata"
    )

    created = await planner_create_task(
        db_session,
        user,
        title="Leftover",
        day=date(2026, 7, 22),
        is_all_day=True,
    )
    assert created["title"] == "Leftover"

    overview = await planner_get_overview(db_session, user, response_format=ResponseFormat.concise)
    assert "open_backlog_count" in overview
    assert overview["timezone"] == "Asia/Kolkata"
    assert "series_count" in overview

    found = await planner_find_tasks(
        db_session, user, open_backlog=True, response_format=ResponseFormat.concise
    )
    assert any(t["task_id"] == created["task_id"] for t in found["tasks"])


@pytest.mark.asyncio
async def test_planner_series_create_find_complete_skip_delete(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="mcp-series-user", timezone="Asia/Kolkata"
    )
    series = await planner_create_series(
        db_session,
        user,
        title="Gym",
        freq="weekly",
        start_day=date(2026, 7, 20),  # Monday
        weekdays=[0, 2, 4],
        start_time=time(7, 0),
    )
    assert series["freq"] == "weekly"
    assert series["title"] == "Gym"

    listed = await planner_list_series(db_session, user)
    assert any(s["series_id"] == series["series_id"] for s in listed["series"])

    wed = date(2026, 7, 22)
    day = await planner_find_tasks(db_session, user, day=wed)
    occ = next(t for t in day["tasks"] if t.get("is_occurrence"))
    assert occ["title"] == "Gym"
    assert occ["task_id"].startswith("occ_")

    sid, od = parse_occurrence_id(occ["task_id"])
    assert str(sid) == series["series_id"]
    assert od == wed
    assert occurrence_id(sid, od) == occ["task_id"]

    done = await planner_complete_tasks(db_session, user, task_ids=[occ["task_id"]])
    assert done["completed"][0]["completed"] is True

    fri = date(2026, 7, 24)
    await planner_skip_occurrence(
        db_session, user, series_id=series["series_id"], day=fri
    )
    fri_day = await planner_find_tasks(db_session, user, day=fri)
    assert not any(t.get("is_occurrence") and t["title"] == "Gym" for t in fri_day["tasks"])

    await planner_delete_series(db_session, user, series_id=series["series_id"])
    listed2 = await planner_list_series(db_session, user)
    assert listed2["series"] == []


@pytest.mark.asyncio
async def test_planner_delete_task(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="mcp-del-user", timezone="Asia/Kolkata"
    )
    created = await planner_create_task(db_session, user, title="Temp")
    deleted = await planner_delete_tasks(db_session, user, task_ids=[created["task_id"]])
    assert deleted["deleted"] == [created["task_id"]]
    inbox = await planner_find_tasks(db_session, user, inbox=True)
    assert inbox["tasks"] == []
