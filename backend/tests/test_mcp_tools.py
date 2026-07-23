import pytest
from datetime import date

from structured_backend.mcp_server.tools import (
    ResponseFormat,
    planner_create_task,
    planner_find_tasks,
    planner_get_overview,
)
from structured_backend.services import users as user_service


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

    found = await planner_find_tasks(
        db_session, user, open_backlog=True, response_format=ResponseFormat.concise
    )
    assert any(t["task_id"] == created["task_id"] for t in found["tasks"])
