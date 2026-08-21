from __future__ import annotations

from datetime import date, datetime, time, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.errors import AppError
from structured_backend.models.user import User
from structured_backend.schemas.series import ExceptionCreate
from structured_backend.schemas.task import AlertCreate, TaskUpdate
from structured_backend.services.series import SeriesService, parse_occurrence_id
from structured_backend.services.tasks import TaskService
from structured_backend.timeutil import user_local_now, user_today


def _add_hours(day: date, start: time, hours: int) -> tuple[date, time]:
    dt = datetime.combine(day, start) + timedelta(hours=hours)
    return dt.date(), dt.time().replace(microsecond=0)


async def snooze_item(
    db: AsyncSession,
    user: User,
    item_id: str,
    *,
    minutes: int | None = None,
    tomorrow: bool = False,
) -> dict:
    if not minutes and not tomorrow:
        raise AppError("validation_error", "Provide minutes or tomorrow=true")
    hours = (minutes or 0) / 60
    task_svc = TaskService(db)
    series_svc = SeriesService(db)
    local_now = user_local_now(user)

    if item_id.startswith("occ_"):
        series_id, day = parse_occurrence_id(item_id)
        series = await series_svc.get(user, series_id)
        if series is None:
            raise AppError("not_found", "Series not found", status_code=404)
        occs = await series_svc.materialize_range(user, day, day)
        occ = next((o for o in occs if o.id == item_id), None)
        if occ is None:
            raise AppError("not_found", "Occurrence not found", status_code=404)
        if tomorrow:
            await series_svc.add_exception(
                user, series_id, ExceptionCreate(occurrence_day=day, kind="skip")
            )
            clone_day = day + timedelta(days=1)
            from structured_backend.schemas.task import TaskCreate

            cloned = await task_svc.create(
                user,
                TaskCreate(
                    title=occ.title,
                    day=clone_day,
                    start_time=occ.start_time,
                    is_all_day=occ.is_all_day,
                    duration_minutes=occ.duration_minutes,
                    notes=occ.notes,
                    color=occ.color,
                    symbol=occ.symbol,
                    alerts=[
                        AlertCreate(kind=a.kind, offset_minutes=a.offset_minutes)
                        for a in (occ.alerts or [])
                    ],
                ),
            )
            from structured_backend.services.notifications import NotificationService, occ_source_prefix

            await NotificationService(db).drop_pending(user, occ_source_prefix(series_id, day))
            return {
                "task_id": str(cloned.id),
                "title": cloned.title,
                "day": clone_day.isoformat(),
                "start_time": cloned.start_time.isoformat() if cloned.start_time else None,
                "skipped_occurrence": item_id,
            }
        base_time = occ.start_time or local_now.time().replace(microsecond=0)
        if occ.is_all_day or occ.start_time is None:
            new_dt = local_now + timedelta(minutes=minutes or 60)
            new_day, new_time = new_dt.date(), new_dt.time().replace(microsecond=0)
            is_all_day = False
        else:
            new_day, new_time = _add_hours(day, base_time, hours if minutes else 1)
            is_all_day = False
        await series_svc.add_exception(
            user,
            series_id,
            ExceptionCreate(
                occurrence_day=day,
                kind="override",
                start_time=new_time,
                is_all_day=is_all_day,
            ),
        )
        from structured_backend.services.notifications import NotificationService, occ_source_prefix

        await NotificationService(db).drop_pending(user, occ_source_prefix(series_id, day))
        return {
            "task_id": item_id,
            "day": day.isoformat(),
            "start_time": new_time.isoformat(),
            "is_occurrence": True,
        }

    task = await task_svc.get(user, UUID(item_id))
    if task is None:
        raise AppError("not_found", "Task not found", status_code=404)
    if tomorrow:
        new_day = (task.day or user_today(user)) + timedelta(days=1)
        if task.day is None:
            updated = await task_svc.update(
                user, task.id, TaskUpdate(day=new_day, is_all_day=True, start_time=None)
            )
        else:
            updated = await task_svc.update(user, task.id, TaskUpdate(day=new_day))
        from structured_backend.services.notifications import NotificationService, task_source_prefix

        await NotificationService(db).drop_pending(user, task_source_prefix(updated.id))
        return {
            "task_id": str(updated.id),
            "title": updated.title,
            "day": updated.day.isoformat() if updated.day else None,
            "start_time": updated.start_time.isoformat() if updated.start_time else None,
        }
    delta = timedelta(minutes=minutes or 60)
    if task.day is None or task.is_all_day or task.start_time is None:
        new_dt = local_now + delta
        updated = await task_svc.update(
            user,
            task.id,
            TaskUpdate(
                day=new_dt.date(),
                start_time=new_dt.time().replace(microsecond=0),
                is_all_day=False,
            ),
        )
    else:
        new_day, new_time = _add_hours(task.day, task.start_time, (minutes or 60) / 60)
        updated = await task_svc.update(
            user,
            task.id,
            TaskUpdate(day=new_day, start_time=new_time, is_all_day=False),
        )
    from structured_backend.services.notifications import NotificationService, task_source_prefix

    await NotificationService(db).drop_pending(user, task_source_prefix(updated.id))
    return {
        "task_id": str(updated.id),
        "title": updated.title,
        "day": updated.day.isoformat() if updated.day else None,
        "start_time": updated.start_time.isoformat() if updated.start_time else None,
    }
