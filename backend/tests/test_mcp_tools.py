import pytest

from structured_backend.mcp_server.tools import (
    ResponseFormat,
    planner_create_task,
    planner_find_tasks,
    planner_get_overview,
)
from structured_backend.services.users import create_user, get_user_by_api_key


@pytest.mark.asyncio
async def test_planner_overview_and_find(db_session):
    user, raw = await create_user(db_session, timezone="Asia/Kolkata")
    # re-fetch via key to mirror auth path
    user = await get_user_by_api_key(db_session, raw)
    assert user is not None

    created = await planner_create_task(
        db_session,
        user,
        title="Leftover",
        day=__import__("datetime").date(2026, 7, 22),
        is_all_day=True,
    )
    assert created["title"] == "Leftover"

    overview = await planner_get_overview(db_session, user, response_format=ResponseFormat.concise)
    assert "open_backlog_count" in overview
    assert overview["timezone"] == "Asia/Kolkata"

    found = await planner_find_tasks(
        db_session, user, open_backlog=True, response_format=ResponseFormat.concise
    )
    assert any(t["task_id"] == created["task_id"] for t in found["tasks"])
