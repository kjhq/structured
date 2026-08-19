from datetime import date, time

import pytest

from structured_backend.mcp_server import tools as planner
from structured_backend.schemas.task import TaskCreate
from structured_backend.services import users as user_service
from structured_backend.services.tasks import TaskService


BOT = {"X-Bot-Secret": "dev-bot-secret", "X-Discord-Id": "companion-rest-user"}


@pytest.mark.asyncio
async def test_bot_views_and_actions_round_trip(client):
    created = await client.post(
        "/v1/bot/actions/add",
        headers=BOT,
        json={"title": "Gym", "day": "2026-08-18", "start_time": "07:00", "remind": True},
    )
    assert created.status_code == 200
    body = created.json()
    assert body["title"] == "Gym"
    assert body["alerts"]
    task_id = body["task_id"]

    today = await client.get("/v1/bot/views/today", headers=BOT)
    assert today.status_code == 200
    assert "items" in today.json()

    inbox = await client.get("/v1/bot/views/inbox", headers=BOT)
    assert inbox.status_code == 200

    complete = await client.post(
        "/v1/bot/actions/complete",
        headers=BOT,
        json={"id": task_id},
    )
    assert complete.status_code == 200
    assert complete.json()["completed"][0]["completed"] is True

    undone = await client.post(
        "/v1/bot/actions/uncomplete",
        headers=BOT,
        json={"id": task_id},
    )
    assert undone.status_code == 200

    snoozed = await client.post(
        "/v1/bot/actions/snooze",
        headers=BOT,
        json={"id": task_id, "minutes": 60},
    )
    assert snoozed.status_code == 200


@pytest.mark.asyncio
async def test_bot_settings_patch_timezone(client):
    got = await client.get("/v1/bot/settings", headers=BOT)
    assert got.status_code == 200
    assert got.json()["guild_mode"] == "all"

    patched = await client.patch(
        "/v1/bot/settings",
        headers=BOT,
        json={"timezone": "Asia/Kolkata", "reminders_enabled": True},
    )
    assert patched.status_code == 200
    assert patched.json()["timezone"] == "Asia/Kolkata"


@pytest.mark.asyncio
async def test_bot_settings_requires_secret(client):
    res = await client.get("/v1/bot/settings", headers={"X-Discord-Id": "x"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_notifications_due_requires_secret(client):
    res = await client.get("/v1/bot/notifications/due")
    assert res.status_code == 401

    ok = await client.get("/v1/bot/notifications/due", headers={"X-Bot-Secret": "dev-bot-secret"})
    assert ok.status_code == 200
    assert "items" in ok.json()


@pytest.mark.asyncio
async def test_mcp_uncomplete_restore_and_toggle(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="mcp-new-tools", timezone="UTC"
    )
    svc = TaskService(db_session)
    task = await svc.create(
        user,
        TaskCreate(title="Milk run", notes="- [ ] milk\n- [ ] eggs", is_all_day=True, day=date(2026, 8, 18)),
    )
    toggled = await planner.planner_toggle_note_item(
        db_session, user, task_id=str(task.id), item_text="milk", checked=True
    )
    assert "- [x] milk" in toggled["notes"]

    await planner.planner_complete_tasks(db_session, user, task_ids=[str(task.id)])
    undone = await planner.planner_uncomplete_tasks(db_session, user, task_ids=[str(task.id)])
    assert undone["uncompleted"][0]["completed"] is False

    await planner.planner_delete_tasks(db_session, user, task_ids=[str(task.id)])
    restored = await planner.planner_restore_tasks(db_session, user, task_ids=[str(task.id)])
    assert str(task.id) in restored["restored"]

    slots = await planner.planner_suggest_slots(
        db_session, user, duration_minutes=30, day=date(2026, 8, 18), after_time=time(7, 0)
    )
    assert "slots" in slots

    settings = await planner.planner_update_settings(
        db_session, user, timezone="Asia/Kolkata", briefing_morning_time="off"
    )
    assert settings["timezone"] == "Asia/Kolkata"
    assert settings["briefing_morning_time"] is None
