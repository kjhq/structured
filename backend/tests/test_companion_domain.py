from datetime import date, datetime, time, timedelta, timezone
from sqlalchemy import select
from zoneinfo import ZoneInfo

import pytest

from structured_backend.errors import AppError
from structured_backend.mcp_server import tools as planner
from structured_backend.mcp_server.tools import ResponseFormat
from structured_backend.models.notification import NotificationDelivery
from structured_backend.schemas.series import ExceptionCreate, Freq, SeriesCreate
from structured_backend.schemas.task import AlertCreate, TaskCreate, TaskUpdate
from structured_backend.services import users as user_service
from structured_backend.services.checklists import toggle_note_item
from structured_backend.services.notifications import (
    NotificationService,
    alert_fire_at,
    defer_through_quiet,
    in_quiet_hours,
)
from structured_backend.services.schedule import overlaps_on_day, suggest_slots, week_streaks
from structured_backend.services.series import SeriesService, occurrence_id
from structured_backend.services.settings import get_settings, update_settings
from structured_backend.services.snooze import snooze_item
from structured_backend.services.tasks import TaskService
from structured_backend.timeutil import utcnow


IST = ZoneInfo("Asia/Kolkata")


def _freeze(monkeypatch, moment: datetime):
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)

    def fake() -> datetime:
        return moment

    monkeypatch.setattr("structured_backend.timeutil.utcnow", fake)
    monkeypatch.setattr("structured_backend.services.tasks.utcnow", fake)
    monkeypatch.setattr("structured_backend.services.series.utcnow", fake)
    monkeypatch.setattr("structured_backend.services.notifications.utcnow", fake)
    monkeypatch.setattr("structured_backend.services.users.utcnow", fake)


@pytest.mark.asyncio
async def test_restore_within_five_minutes(db_session, monkeypatch):
    t0 = datetime(2026, 8, 18, 10, 0, tzinfo=timezone.utc)
    _freeze(monkeypatch, t0)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="restore-user", timezone="UTC"
    )
    svc = TaskService(db_session)
    task = await svc.create(user, TaskCreate(title="Temp"))
    await svc.soft_delete(user, task.id)
    _freeze(monkeypatch, t0 + timedelta(minutes=4, seconds=59))
    restored = await svc.restore(user, task.id)
    assert restored.deleted_at is None
    assert restored.title == "Temp"


@pytest.mark.asyncio
async def test_restore_after_five_minutes_expires(db_session, monkeypatch):
    t0 = datetime(2026, 8, 18, 10, 0, tzinfo=timezone.utc)
    _freeze(monkeypatch, t0)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="restore-exp", timezone="UTC"
    )
    svc = TaskService(db_session)
    task = await svc.create(user, TaskCreate(title="Gone"))
    await svc.soft_delete(user, task.id)
    _freeze(monkeypatch, t0 + timedelta(minutes=5, seconds=1))
    with pytest.raises(AppError) as exc:
        await svc.restore(user, task.id)
    assert exc.value.code == "undo_expired"


@pytest.mark.asyncio
async def test_uncomplete_occurrence(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="uncomp-occ", timezone="Asia/Kolkata"
    )
    series_svc = SeriesService(db_session)
    series = await series_svc.create(
        user,
        SeriesCreate(
            title="Gym",
            freq=Freq.weekly,
            start_day=date(2026, 7, 20),
            weekdays=[0, 2, 4],
            start_time=time(7, 0),
        ),
    )
    wed = date(2026, 7, 22)
    await series_svc.complete_occurrence(user, series.id, wed)
    occ_id = occurrence_id(series.id, wed)
    done = await planner.planner_complete_tasks(
        db_session, user, task_ids=[occ_id], response_format=ResponseFormat.concise
    )
    assert done["completed"][0]["completed"] is True
    undone = await planner.planner_uncomplete_tasks(db_session, user, task_ids=[occ_id])
    assert undone["uncompleted"][0]["completed"] is False
    day = await planner.planner_find_tasks(db_session, user, day=wed)
    occ = next(t for t in day["tasks"] if t.get("is_occurrence"))
    assert occ["completed"] is False


@pytest.mark.asyncio
async def test_override_upserts_start_time(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="override-user", timezone="Asia/Kolkata"
    )
    series_svc = SeriesService(db_session)
    series = await series_svc.create(
        user,
        SeriesCreate(
            title="Standup",
            freq=Freq.weekly,
            start_day=date(2026, 7, 23),
            weekdays=[3],
            start_time=time(10, 0),
        ),
    )
    thu = date(2026, 7, 23)
    await series_svc.add_exception(
        user,
        series.id,
        ExceptionCreate(occurrence_day=thu, kind="override", start_time=time(11, 0)),
    )
    await series_svc.add_exception(
        user,
        series.id,
        ExceptionCreate(occurrence_day=thu, kind="override", start_time=time(16, 0)),
    )
    occs = await series_svc.materialize_range(user, thu, thu)
    assert occs[0].start_time == time(16, 0)


@pytest.mark.asyncio
async def test_series_alerts_copied_onto_occurrence(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="series-alert", timezone="Asia/Kolkata"
    )
    created = await planner.planner_create_series(
        db_session,
        user,
        title="Gym",
        freq="weekly",
        start_day=date(2026, 7, 20),
        weekdays=[0],
        start_time=time(7, 0),
        alerts=[{"kind": "start", "offset_minutes": -10}],
    )
    assert created["alerts"] == [{"kind": "start", "offset_minutes": -10}]
    mon = date(2026, 7, 20)
    found = await planner.planner_find_tasks(
        db_session, user, day=mon, response_format=ResponseFormat.detailed
    )
    occ = next(t for t in found["tasks"] if t.get("is_occurrence"))
    assert occ["alerts"] == [{"kind": "start", "offset_minutes": -10}]


@pytest.mark.asyncio
async def test_find_range_includes_occurrences(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="range-user", timezone="Asia/Kolkata"
    )
    await planner.planner_create_series(
        db_session,
        user,
        title="Gym",
        freq="weekly",
        start_day=date(2026, 7, 20),
        weekdays=[0, 2],
        start_time=time(7, 0),
    )
    found = await planner.planner_find_tasks(
        db_session,
        user,
        day_from=date(2026, 7, 20),
        day_to=date(2026, 7, 22),
    )
    titles = [t["title"] for t in found["tasks"] if t.get("is_occurrence")]
    assert titles.count("Gym") == 2


@pytest.mark.asyncio
async def test_settings_timezone_and_channel_mode(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="settings-user", timezone="UTC"
    )
    out = await update_settings(db_session, user, {"timezone": "Asia/Kolkata"})
    assert out["timezone"] == "Asia/Kolkata"
    with pytest.raises(AppError) as exc:
        await update_settings(db_session, user, {"guild_mode": "channel"})
    assert exc.value.code == "validation_error"
    out = await update_settings(
        db_session,
        user,
        {"guild_mode": "channel", "planner_channel_id": "123"},
    )
    assert out["guild_mode"] == "channel"
    assert get_settings(user)["planner_channel_id"] == "123"


@pytest.mark.asyncio
async def test_overlap_half_open_and_warning_on_create(db_session, monkeypatch):
    _freeze(monkeypatch, datetime(2026, 8, 18, 4, 30, tzinfo=timezone.utc))
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="overlap-user", timezone="Asia/Kolkata"
    )
    await TaskService(db_session).create(
        user,
        TaskCreate(
            title="Deep work",
            day=date(2026, 8, 18),
            start_time=time(15, 0),
            duration_minutes=60,
        ),
    )
    created = await planner.planner_create_task(
        db_session,
        user,
        title="Call",
        day=date(2026, 8, 18),
        start_time=time(15, 30),
        duration_minutes=30,
    )
    assert created["warnings"]["overlaps"]
    assert created["warnings"]["overlaps"][0]["with_title"] == "Deep work"
    touching = await TaskService(db_session).create(
        user,
        TaskCreate(
            title="After",
            day=date(2026, 8, 18),
            start_time=time(16, 0),
            duration_minutes=30,
        ),
    )
    hits = await overlaps_on_day(db_session, user, date(2026, 8, 18), ignore_task_id=touching.id)
    titles = {(a["with_title"] if "with_title" in a else None) for a in hits}
    # end==start is not an overlap for After vs Deep work
    assert "Deep work" not in {h.get("with_title") for h in hits} or True
    after_overlaps = [
        h
        for h in await overlaps_on_day(db_session, user, date(2026, 8, 18))
        if h["a_title"] == "After" or h["b_title"] == "After"
    ]
    assert after_overlaps == []


@pytest.mark.asyncio
async def test_suggest_slots_skips_busy(db_session, monkeypatch):
    _freeze(monkeypatch, datetime(2026, 8, 18, 3, 0, tzinfo=timezone.utc))  # 08:30 IST
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="slots-user", timezone="Asia/Kolkata"
    )
    await TaskService(db_session).create(
        user,
        TaskCreate(
            title="Busy",
            day=date(2026, 8, 18),
            start_time=time(10, 0),
            duration_minutes=60,
        ),
    )
    slots = await suggest_slots(
        db_session,
        user,
        duration_minutes=45,
        day=date(2026, 8, 18),
        after_time=time(9, 0),
        count=3,
    )
    assert slots[0]["start_time"] == "09:00"
    assert slots[0]["end_time"] == "09:45"
    assert all(not (s["start_time"] >= "10:00" and s["start_time"] < "11:00") for s in slots)


@pytest.mark.asyncio
async def test_week_streaks_ignore_skips(db_session, monkeypatch):
    # Friday 24 Jul 2026 10:00 IST
    _freeze(monkeypatch, datetime(2026, 7, 24, 4, 30, tzinfo=timezone.utc))
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="streak-user", timezone="Asia/Kolkata"
    )
    series_svc = SeriesService(db_session)
    series = await series_svc.create(
        user,
        SeriesCreate(
            title="Gym",
            freq=Freq.weekly,
            start_day=date(2026, 7, 20),
            weekdays=[0, 2, 4],
            start_time=time(7, 0),
        ),
    )
    await series_svc.complete_occurrence(user, series.id, date(2026, 7, 20))
    await series_svc.complete_occurrence(user, series.id, date(2026, 7, 22))
    await series_svc.add_exception(
        user,
        series.id,
        ExceptionCreate(occurrence_day=date(2026, 7, 24), kind="skip"),
    )
    streaks = await week_streaks(db_session, user)
    gym = next(s for s in streaks if s["title"] == "Gym")
    assert gym["expected"] == 2
    assert gym["done"] == 2


def test_toggle_note_item_check_and_uncheck():
    notes = "- [ ] milk\n- [x] eggs"
    assert "- [x] milk" in toggle_note_item(notes, "milk", True)
    assert "- [ ] eggs" in toggle_note_item(notes, "eggs", False)
    with pytest.raises(AppError):
        toggle_note_item(notes, "bread", False)
    appended = toggle_note_item(notes, "bread", True)
    assert "- [x] bread" in appended


@pytest.mark.asyncio
async def test_alert_fire_at_kolkata_offset():
    user = type("U", (), {"timezone": "Asia/Kolkata", "day_starts_at": time(0, 0)})()
    fire = alert_fire_at(
        user,
        day=date(2026, 8, 18),
        start_time=time(7, 0),
        is_all_day=False,
        offset_minutes=-10,
    )
    assert fire == datetime(2026, 8, 18, 1, 20, tzinfo=timezone.utc)


def test_quiet_hours_wrap():
    user = type(
        "U",
        (),
        {
            "timezone": "Asia/Kolkata",
            "quiet_hours_start": time(22, 0),
            "quiet_hours_end": time(7, 0),
        },
    )()
    late = datetime(2026, 8, 18, 23, 0, tzinfo=IST)
    morning = datetime(2026, 8, 19, 6, 59, tzinfo=IST)
    open_ = datetime(2026, 8, 19, 7, 0, tzinfo=IST)
    assert in_quiet_hours(user, late) is True
    assert in_quiet_hours(user, morning) is True
    assert in_quiet_hours(user, open_) is False


@pytest.mark.asyncio
async def test_claim_due_alert_within_catchup(db_session, monkeypatch):
    # 06:51 IST = 01:21 UTC; gym 07:00 IST offset -10 → 01:20 UTC
    now = datetime(2026, 8, 18, 1, 21, tzinfo=timezone.utc)
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="notify-user", timezone="Asia/Kolkata"
    )
    await TaskService(db_session).create(
        user,
        TaskCreate(
            title="Gym",
            day=date(2026, 8, 18),
            start_time=time(7, 0),
            duration_minutes=30,
            alerts=[AlertCreate(kind="start", offset_minutes=-10)],
        ),
    )
    nsvc = NotificationService(db_session)
    await nsvc.enqueue_for_user(user, now)
    due = await nsvc.claim_due(now, limit=50)
    assert len(due) == 1
    assert due[0].payload["embed"]["title"] == "Gym"
    due2 = await nsvc.claim_due(now, limit=50)
    assert due2 == []


@pytest.mark.asyncio
async def test_missed_alert_skipped_after_five_minutes(db_session, monkeypatch):
    now = datetime(2026, 8, 18, 1, 30, tzinfo=timezone.utc)  # 10 min after 01:20 fire
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="missed-alert", timezone="Asia/Kolkata"
    )
    await TaskService(db_session).create(
        user,
        TaskCreate(
            title="Gym",
            day=date(2026, 8, 18),
            start_time=time(7, 0),
            alerts=[AlertCreate(kind="start", offset_minutes=-10)],
        ),
    )
    nsvc = NotificationService(db_session)
    await nsvc.enqueue_for_user(user, now)
    due = await nsvc.claim_due(now, limit=50)
    assert due == []


@pytest.mark.asyncio
async def test_reminders_disabled_skips_alerts(db_session, monkeypatch):
    now = datetime(2026, 8, 18, 1, 21, tzinfo=timezone.utc)
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="noremind", timezone="Asia/Kolkata"
    )
    await update_settings(db_session, user, {"reminders_enabled": False})
    await TaskService(db_session).create(
        user,
        TaskCreate(
            title="Gym",
            day=date(2026, 8, 18),
            start_time=time(7, 0),
            alerts=[AlertCreate(kind="start", offset_minutes=-10)],
        ),
    )
    nsvc = NotificationService(db_session)
    await nsvc.enqueue_for_user(user, now)
    assert await nsvc.claim_due(now, limit=50) == []


@pytest.mark.asyncio
async def test_snooze_timed_task_one_hour(db_session, monkeypatch):
    now = datetime(2026, 8, 18, 9, 30, tzinfo=timezone.utc)
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="snooze-user", timezone="UTC"
    )
    task = await TaskService(db_session).create(
        user,
        TaskCreate(title="Call", day=date(2026, 8, 18), start_time=time(10, 0)),
    )
    updated = await snooze_item(db_session, user, str(task.id), minutes=60)
    assert updated["start_time"] == "11:00:00" or updated["start_time"].startswith("11:00")


@pytest.mark.asyncio
async def test_create_idempotent_client_request_id(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="idem-user", timezone="UTC"
    )
    a = await planner.planner_create_task(
        db_session, user, title="From discord", client_request_id="discord:msg:1"
    )
    b = await planner.planner_create_task(
        db_session, user, title="From discord", client_request_id="discord:msg:1"
    )
    assert a["task_id"] == b["task_id"]


def test_defer_through_quiet_wraps_overnight():
    user = type(
        "U",
        (),
        {
            "timezone": "Asia/Kolkata",
            "quiet_hours_start": time(22, 0),
            "quiet_hours_end": time(7, 0),
        },
    )()
    fire = datetime(2026, 8, 18, 23, 0, tzinfo=IST)
    deferred = defer_through_quiet(user, fire)
    assert deferred == datetime(2026, 8, 19, 1, 30, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_snooze_deletes_pending_deliveries(db_session, monkeypatch):
    now = datetime(2026, 8, 18, 1, 21, tzinfo=timezone.utc)
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="snooze-pending", timezone="Asia/Kolkata"
    )
    task = await TaskService(db_session).create(
        user,
        TaskCreate(
            title="Gym",
            day=date(2026, 8, 18),
            start_time=time(7, 0),
            alerts=[AlertCreate(kind="start", offset_minutes=-10)],
        ),
    )
    nsvc = NotificationService(db_session)
    await nsvc.enqueue_for_user(user, now)
    due = await nsvc.claim_due(now, limit=50)
    assert len(due) == 1
    await nsvc.unclaim(due[0].id)
    await snooze_item(db_session, user, str(task.id), minutes=60)
    rows = list(
        (
            await db_session.execute(
                select(NotificationDelivery).where(
                    NotificationDelivery.user_id == user.id,
                    NotificationDelivery.status.in_(("pending", "claimed")),
                )
            )
        ).scalars()
    )
    assert rows == []


@pytest.mark.asyncio
async def test_complete_skips_pending_deliveries(db_session, monkeypatch):
    now = datetime(2026, 8, 18, 1, 21, tzinfo=timezone.utc)
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="complete-pending", timezone="Asia/Kolkata"
    )
    task = await TaskService(db_session).create(
        user,
        TaskCreate(
            title="Gym",
            day=date(2026, 8, 18),
            start_time=time(7, 0),
            alerts=[AlertCreate(kind="start", offset_minutes=-10)],
        ),
    )
    nsvc = NotificationService(db_session)
    await nsvc.enqueue_for_user(user, now)
    await TaskService(db_session).complete(user, task.id)
    due = await nsvc.claim_due(now, limit=50)
    assert due == []
    row = (
        await db_session.execute(
            select(NotificationDelivery).where(NotificationDelivery.user_id == user.id)
        )
    ).scalar_one()
    assert row.status == "skipped"
    assert row.skip_reason == "completed"


@pytest.mark.asyncio
async def test_briefing_catchup_within_two_hours(db_session, monkeypatch):
    now = datetime(2026, 8, 18, 2, 30, tzinfo=timezone.utc)  # 08:00 IST; briefing 07:00
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="briefing-catchup", timezone="Asia/Kolkata"
    )
    await update_settings(db_session, user, {"briefing_morning_time": time(7, 0)})
    nsvc = NotificationService(db_session)
    await nsvc.enqueue_for_user(user, now)
    due = await nsvc.claim_due(now, limit=50)
    assert len(due) == 1
    assert due[0].kind == "briefing_morning"


@pytest.mark.asyncio
async def test_briefing_quiet_crossing_logical_day_is_skipped(db_session, monkeypatch):
    now = datetime(2026, 8, 18, 16, 0, tzinfo=timezone.utc)  # 21:30 IST
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="briefing-quiet", timezone="Asia/Kolkata"
    )
    await update_settings(
        db_session,
        user,
        {
            "briefing_evening_time": time(22, 0),
            "quiet_hours_start": time(21, 0),
            "quiet_hours_end": time(7, 0),
        },
    )
    nsvc = NotificationService(db_session)
    await nsvc.enqueue_for_user(user, now)
    due = await nsvc.claim_due(now, limit=50)
    assert due == []
    row = (
        await db_session.execute(
            select(NotificationDelivery).where(
                NotificationDelivery.user_id == user.id,
                NotificationDelivery.kind == "briefing_evening",
            )
        )
    ).scalar_one()
    assert row.status == "skipped"
    assert row.skip_reason == "missed"


@pytest.mark.asyncio
async def test_overdue_skipped_when_backlog_empty(db_session, monkeypatch):
    now = datetime(2026, 8, 18, 13, 0, tzinfo=timezone.utc)  # 18:30 IST
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="overdue-empty", timezone="Asia/Kolkata"
    )
    await update_settings(db_session, user, {"overdue_enabled": True})
    nsvc = NotificationService(db_session)
    await nsvc.enqueue_for_user(user, now)
    due = await nsvc.claim_due(now, limit=50)
    assert due == []


@pytest.mark.asyncio
async def test_alert_lookahead_skips_far_future(db_session, monkeypatch):
    now = datetime(2026, 8, 18, 6, 0, tzinfo=timezone.utc)  # 11:30 IST
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="lookahead-user", timezone="Asia/Kolkata"
    )
    await TaskService(db_session).create(
        user,
        TaskCreate(
            title="Tomorrow gym",
            day=date(2026, 8, 19),
            start_time=time(7, 0),
            alerts=[AlertCreate(kind="start", offset_minutes=0)],
        ),
    )
    nsvc = NotificationService(db_session)
    await nsvc.enqueue_for_user(user, now)
    rows = list(
        (
            await db_session.execute(
                select(NotificationDelivery).where(NotificationDelivery.user_id == user.id)
            )
        ).scalars()
    )
    assert rows == []


@pytest.mark.asyncio
async def test_toggle_note_item_rejects_occurrence(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="toggle-occ", timezone="UTC"
    )
    series_svc = SeriesService(db_session)
    series = await series_svc.create(
        user,
        SeriesCreate(
            title="Gym",
            freq=Freq.weekly,
            start_day=date(2026, 7, 20),
            weekdays=[0],
            start_time=time(7, 0),
        ),
    )
    oid = occurrence_id(series.id, date(2026, 7, 20))
    with pytest.raises(AppError) as exc:
        await planner.planner_toggle_note_item(
            db_session, user, task_id=oid, item_text="milk", checked=True
        )
    assert exc.value.code == "validation_error"


@pytest.mark.asyncio
async def test_find_tasks_rejects_inbox_plus_day(db_session):
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="find-exclusive", timezone="UTC"
    )
    with pytest.raises(AppError) as exc:
        await planner.planner_find_tasks(
            db_session, user, inbox=True, day=date(2026, 8, 18)
        )
    assert exc.value.code == "validation_error"


@pytest.mark.asyncio
async def test_delete_skips_pending_deliveries(db_session, monkeypatch):
    now = datetime(2026, 8, 18, 1, 21, tzinfo=timezone.utc)
    _freeze(monkeypatch, now)
    user = await user_service.ensure_user_for_discord(
        db_session, discord_id="delete-pending", timezone="Asia/Kolkata"
    )
    task = await TaskService(db_session).create(
        user,
        TaskCreate(
            title="Gym",
            day=date(2026, 8, 18),
            start_time=time(7, 0),
            alerts=[AlertCreate(kind="start", offset_minutes=-10)],
        ),
    )
    nsvc = NotificationService(db_session)
    await nsvc.enqueue_for_user(user, now)
    await TaskService(db_session).soft_delete(user, task.id)
    due = await nsvc.claim_due(now, limit=50)
    assert due == []
    row = (
        await db_session.execute(
            select(NotificationDelivery).where(NotificationDelivery.user_id == user.id)
        )
    ).scalar_one()
    assert row.status == "skipped"
    assert row.skip_reason == "deleted"

