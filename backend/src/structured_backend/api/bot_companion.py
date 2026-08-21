from datetime import date, time, timedelta
from uuid import UUID

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from structured_backend.api.bot_link import _require_bot
from structured_backend.api.deps import DbSession
from structured_backend.api.tasks import merge_day
from structured_backend.config import settings
from structured_backend.errors import AppError
from structured_backend.mcp_server import tools as planner
from structured_backend.mcp_server.tools import ResponseFormat
from structured_backend.schemas.task import TaskRead
from structured_backend.services import users as user_service
from structured_backend.services.notifications import NotificationService, render_briefing_embed
from structured_backend.services.series import SeriesService
from structured_backend.services.settings import get_settings, update_settings
from structured_backend.services.snooze import snooze_item
from structured_backend.services.tasks import TaskService
from structured_backend.services.schedule import week_streaks
from structured_backend.timeutil import user_today, utcnow

router = APIRouter(prefix="/bot", tags=["bot"])


class IdBody(BaseModel):
    id: str | None = None
    task_id: str | None = None
    occurrence_id: str | None = None
    series_id: str | None = None
    minutes: int | None = None
    tomorrow: bool = False


class AckBody(BaseModel):
    discord_message_id: str = Field(min_length=1)


class FailBody(BaseModel):
    reason: str = Field(min_length=1)


class AddBody(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    day: date | None = None
    start_time: time | None = None
    is_all_day: bool = False
    remind: bool = False
    notes: str | None = None
    duration_minutes: int | None = Field(default=None, ge=1)
    client_request_id: str | None = None


def _bot_secret(secret: str | None) -> None:
    if not settings.bot_secret_ok(secret):
        raise AppError("unauthorized", "Invalid bot secret", status_code=401)


async def _bot_user(db, secret: str | None, discord_id: str | None):
    if not discord_id:
        raise AppError("unauthorized", "Missing X-Discord-Id", status_code=401)
    _require_bot(secret, discord_id)
    return await user_service.ensure_user_for_discord(db, discord_id=discord_id)


@router.get("/notifications/due")
async def notifications_due(
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    limit: int | None = None,
) -> dict:
    _bot_secret(x_bot_secret)
    nsvc = NotificationService(db)
    if limit is None:
        limit = settings.notification_claim_limit
    from structured_backend.models.user import User
    from sqlalchemy import select

    users = list((await db.execute(select(User).where(User.discord_id.is_not(None)))).scalars().all())
    now = utcnow()
    for user in users:
        if user.discord_id and settings.is_discord_allowed(user.discord_id):
            await nsvc.enqueue_for_user(user, now)
    claimed = await nsvc.claim_due(now, limit=limit)
    items = []
    for row in claimed:
        payload = dict(row.payload or {})
        if row.kind in ("briefing_morning", "briefing_evening", "overdue") and row.user is not None:
            try:
                payload["embed"] = await render_briefing_embed(db, row.user, row.kind)
            except Exception:
                pass
        payload["delivery_id"] = str(row.id)
        items.append(payload)
    return {"items": items}


@router.post("/notifications/{delivery_id}/ack")
async def notifications_ack(
    delivery_id: UUID,
    body: AckBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
) -> dict:
    _bot_secret(x_bot_secret)
    row = await NotificationService(db).ack(delivery_id, body.discord_message_id)
    return {"status": row.status}


@router.post("/notifications/{delivery_id}/fail")
async def notifications_fail(
    delivery_id: UUID,
    body: FailBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
) -> dict:
    _bot_secret(x_bot_secret)
    row = await NotificationService(db).fail(delivery_id, body.reason)
    return {"status": row.status, "reason": row.skip_reason}


@router.post("/notifications/{delivery_id}/unclaim")
async def notifications_unclaim(
    delivery_id: UUID,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
) -> dict:
    _bot_secret(x_bot_secret)
    row = await NotificationService(db).unclaim(delivery_id)
    return {"status": row.status}


@router.get("/settings")
async def bot_get_settings(
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    return get_settings(user)


@router.patch("/settings")
async def bot_patch_settings(
    body: dict,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    return await update_settings(db, user, body)


@router.get("/views/today")
async def view_today(
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    items = await merge_day(user, db, user_today(user))
    return {"today": user_today(user).isoformat(), "items": [i.model_dump(mode="json") for i in items]}


@router.get("/views/inbox")
async def view_inbox(
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    tasks = await TaskService(db).list_inbox(user)
    return {"items": [TaskRead.model_validate(t).model_dump(mode="json") for t in tasks]}


@router.get("/views/open")
async def view_open(
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    tasks = await TaskService(db).list_open(user)
    return {"items": [TaskRead.model_validate(t).model_dump(mode="json") for t in tasks]}


@router.get("/views/week")
async def view_week(
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    start = user_today(user)
    end = start + timedelta(days=6)
    tasks = await TaskService(db).list_range(user, start, end)
    occs = await SeriesService(db).materialize_range(user, start, end)
    from structured_backend.api.tasks import _occ_to_item, _task_to_item

    items = [_task_to_item(t).model_dump(mode="json") for t in tasks] + [
        _occ_to_item(o).model_dump(mode="json") for o in occs
    ]
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "items": items,
        "streaks": await week_streaks(db, user),
    }


@router.post("/actions/complete")
async def action_complete(
    body: IdBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    tid = body.id or body.task_id or body.occurrence_id
    if not tid:
        raise AppError("validation_error", "id required")
    return await planner.planner_complete_tasks(db, user, task_ids=[tid], response_format=ResponseFormat.concise)


@router.post("/actions/uncomplete")
async def action_uncomplete(
    body: IdBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    tid = body.id or body.task_id or body.occurrence_id
    if not tid:
        raise AppError("validation_error", "id required")
    return await planner.planner_uncomplete_tasks(db, user, task_ids=[tid])


@router.post("/actions/snooze")
async def action_snooze(
    body: IdBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    tid = body.id or body.task_id or body.occurrence_id
    if not tid:
        raise AppError("validation_error", "id required")
    return await snooze_item(db, user, tid, minutes=body.minutes, tomorrow=body.tomorrow)


@router.post("/actions/skip")
async def action_skip(
    body: IdBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    occ = body.occurrence_id or body.id
    if not occ:
        raise AppError("validation_error", "occurrence_id required")
    return await planner.planner_skip_occurrence(db, user, occurrence_id=occ)


@router.post("/actions/restore")
async def action_restore(
    body: IdBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    task_ids = [body.task_id or body.id] if (body.task_id or (body.id and not body.series_id)) else []
    series_ids = [body.series_id] if body.series_id else []
    return await planner.planner_restore_tasks(db, user, task_ids=[t for t in task_ids if t], series_ids=series_ids)


@router.post("/actions/move-open")
async def action_move_open(
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    return await planner.planner_reschedule(db, user, move_open_before_to_today=True)


@router.post("/actions/add")
async def action_add(
    body: AddBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_discord_id: str | None = Header(default=None, alias="X-Discord-Id"),
) -> dict:
    user = await _bot_user(db, x_bot_secret, x_discord_id)
    alerts = [{"kind": "start", "offset_minutes": 0}] if body.remind and body.start_time else []
    return await planner.planner_create_task(
        db,
        user,
        title=body.title,
        day=body.day,
        start_time=body.start_time,
        is_all_day=body.is_all_day,
        notes=body.notes,
        duration_minutes=body.duration_minutes,
        alerts=alerts,
        client_request_id=body.client_request_id,
    )
