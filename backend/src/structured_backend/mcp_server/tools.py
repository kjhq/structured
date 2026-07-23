"""Agent-facing planner tools — thin wrappers over domain services."""

from __future__ import annotations

from datetime import date, time
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.errors import AppError
from structured_backend.models.user import User
from structured_backend.schemas.series import ExceptionCreate, Freq, SeriesCreate, SeriesUpdate
from structured_backend.schemas.task import TaskCreate, TaskUpdate
from structured_backend.services.search import search_tasks
from structured_backend.services.series import SeriesService, series_to_read
from structured_backend.services.tasks import TaskService
from structured_backend.timeutil import user_today


class ResponseFormat(str, Enum):
    concise = "concise"
    detailed = "detailed"


def parse_occurrence_id(oid: str) -> tuple[UUID, date]:
    """Parse `occ_<uuid>_<YYYY-MM-DD>` into series id + day."""
    if not oid.startswith("occ_"):
        raise AppError(
            "validation_error",
            f"Not an occurrence id: {oid}",
            hint="Occurrence ids look like occ_<series-uuid>_<YYYY-MM-DD>",
        )
    rest = oid[4:]
    if len(rest) < 12 or rest[-11] != "_":
        raise AppError("validation_error", f"Malformed occurrence id: {oid}")
    try:
        return UUID(rest[:-11]), date.fromisoformat(rest[-10:])
    except ValueError as err:
        raise AppError("validation_error", f"Malformed occurrence id: {oid}") from err


def format_task(task, fmt: ResponseFormat) -> dict[str, Any]:
    if fmt == ResponseFormat.detailed:
        return _task_detailed(task)
    return {
        "task_id": str(task.id),
        "title": task.title,
        "day": task.day.isoformat() if task.day else None,
        "start_time": task.start_time.isoformat() if task.start_time else None,
        "is_all_day": task.is_all_day,
        "completed": task.completed_at is not None,
        "is_occurrence": False,
    }


def format_occurrence(occ, fmt: ResponseFormat) -> dict[str, Any]:
    base = {
        "task_id": occ.id,
        "series_id": str(occ.series_id),
        "title": occ.title,
        "day": occ.day.isoformat(),
        "start_time": occ.start_time.isoformat() if occ.start_time else None,
        "is_all_day": occ.is_all_day,
        "completed": occ.completed_at is not None,
        "is_occurrence": True,
    }
    if fmt == ResponseFormat.detailed:
        base["notes"] = occ.notes
        base["duration_minutes"] = occ.duration_minutes
        base["color"] = occ.color
        base["symbol"] = occ.symbol
        base["completed_at"] = occ.completed_at.isoformat() if occ.completed_at else None
    return base


def format_series(series, fmt: ResponseFormat) -> dict[str, Any]:
    read = series_to_read(series)
    out: dict[str, Any] = {
        "series_id": str(read.id),
        "title": read.title,
        "freq": read.freq,
        "interval": read.interval,
        "weekdays": read.weekdays,
        "start_day": read.start_day.isoformat(),
        "end_day": read.end_day.isoformat() if read.end_day else None,
        "start_time": read.start_time.isoformat() if read.start_time else None,
        "is_all_day": read.is_all_day,
    }
    if fmt == ResponseFormat.detailed:
        out["notes"] = read.notes
        out["duration_minutes"] = read.duration_minutes
        out["color"] = read.color
        out["symbol"] = read.symbol
        out["timezone"] = read.timezone
    return out


def _task_detailed(task) -> dict[str, Any]:
    return {
        "task_id": str(task.id),
        "title": task.title,
        "notes": task.notes,
        "day": task.day.isoformat() if task.day else None,
        "start_time": task.start_time.isoformat() if task.start_time else None,
        "duration_minutes": task.duration_minutes,
        "is_all_day": task.is_all_day,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "color": task.color,
        "symbol": task.symbol,
        "is_occurrence": False,
    }


async def planner_get_overview(
    db: AsyncSession,
    user: User,
    *,
    response_format: ResponseFormat = ResponseFormat.concise,
    next_n: int = 5,
) -> dict[str, Any]:
    svc = TaskService(db)
    series_svc = SeriesService(db)
    today = user_today(user)
    today_tasks = await svc.list_today(user)
    today_occs = await series_svc.materialize_range(user, today, today)
    open_tasks = await svc.list_open(user)
    timed_tasks = [t for t in today_tasks if t.start_time and not t.completed_at]
    timed_occs = [o for o in today_occs if o.start_time and not o.completed_at]
    next_timed: list[dict[str, Any]] = []
    for item in sorted(
        [(t.start_time, format_task(t, response_format)) for t in timed_tasks]
        + [(o.start_time, format_occurrence(o, response_format)) for o in timed_occs],
        key=lambda x: x[0] or time.min,
    )[:next_n]:
        next_timed.append(item[1])
    return {
        "timezone": user.timezone,
        "today": today.isoformat(),
        "today_count": len(today_tasks) + len(today_occs),
        "open_backlog_count": len(open_tasks),
        "series_count": len(await series_svc.list(user)),
        "next_timed": next_timed,
        "open_preview": [format_task(t, response_format) for t in open_tasks[:5]],
    }


async def planner_find_tasks(
    db: AsyncSession,
    user: User,
    *,
    q: str | None = None,
    day: date | None = None,
    open_backlog: bool = False,
    inbox: bool = False,
    response_format: ResponseFormat = ResponseFormat.concise,
) -> dict[str, Any]:
    svc = TaskService(db)
    if inbox:
        tasks = await svc.list_inbox(user)
        return {"tasks": [format_task(t, response_format) for t in tasks]}
    if open_backlog:
        tasks = await svc.list_open(user)
        return {"tasks": [format_task(t, response_format) for t in tasks]}
    if day is not None:
        tasks = await svc.list_for_day(user, day)
        occs = await SeriesService(db).materialize_range(user, day, day)
        return {
            "tasks": [format_task(t, response_format) for t in tasks]
            + [format_occurrence(o, response_format) for o in occs]
        }
    if q:
        tasks = await search_tasks(db, user, q)
        series_hits = [
            s
            for s in await SeriesService(db).list(user)
            if q.lower() in s.title.lower()
        ]
        return {
            "tasks": [format_task(t, response_format) for t in tasks],
            "series": [format_series(s, response_format) for s in series_hits],
        }
    raise AppError(
        "validation_error",
        "Provide q, day, open_backlog=true, or inbox=true",
        hint="Use open_backlog for previously unticked dated tasks",
    )


async def planner_create_task(
    db: AsyncSession,
    user: User,
    *,
    title: str,
    day: date | None = None,
    start_time: time | None = None,
    is_all_day: bool = False,
    notes: str | None = None,
    duration_minutes: int | None = None,
    response_format: ResponseFormat = ResponseFormat.concise,
) -> dict[str, Any]:
    data = TaskCreate(
        title=title,
        day=day,
        start_time=start_time,
        is_all_day=is_all_day,
        notes=notes,
        duration_minutes=duration_minutes,
    )
    task = await TaskService(db).create(user, data)
    return format_task(task, response_format)


async def planner_update_task(
    db: AsyncSession,
    user: User,
    *,
    task_id: str,
    title: str | None = None,
    day: date | None = None,
    start_time: time | None = None,
    is_all_day: bool | None = None,
    notes: str | None = None,
    response_format: ResponseFormat = ResponseFormat.concise,
) -> dict[str, Any]:
    data = TaskUpdate(
        title=title,
        day=day,
        start_time=start_time,
        is_all_day=is_all_day,
        notes=notes,
    )
    task = await TaskService(db).update(user, UUID(task_id), data)
    return format_task(task, response_format)


async def planner_complete_tasks(
    db: AsyncSession,
    user: User,
    *,
    task_ids: list[str],
    response_format: ResponseFormat = ResponseFormat.concise,
) -> dict[str, Any]:
    """Complete one-off tasks or occurrence ids (`occ_<series>_<day>`)."""
    task_svc = TaskService(db)
    series_svc = SeriesService(db)
    out: list[dict[str, Any]] = []
    for tid in task_ids:
        if tid.startswith("occ_"):
            series_id, day = parse_occurrence_id(tid)
            await series_svc.complete_occurrence(user, series_id, day)
            out.append(
                {
                    "task_id": tid,
                    "series_id": str(series_id),
                    "day": day.isoformat(),
                    "completed": True,
                    "is_occurrence": True,
                }
            )
        else:
            task = await task_svc.complete(user, UUID(tid))
            out.append(format_task(task, response_format))
    return {"completed": out}


async def planner_delete_tasks(
    db: AsyncSession,
    user: User,
    *,
    task_ids: list[str],
) -> dict[str, Any]:
    """Soft-delete one-off tasks. For a single occurrence use planner_skip_occurrence;
    to remove a whole recurring rule use planner_delete_series."""
    svc = TaskService(db)
    deleted: list[str] = []
    for tid in task_ids:
        if tid.startswith("occ_"):
            raise AppError(
                "validation_error",
                f"Cannot delete occurrence {tid} with planner_delete_tasks",
                hint="Use planner_skip_occurrence for one day, or planner_delete_series for the whole rule",
            )
        await svc.soft_delete(user, UUID(tid))
        deleted.append(tid)
    return {"deleted": deleted}


async def planner_reschedule(
    db: AsyncSession,
    user: User,
    *,
    task_id: str | None = None,
    day: date | None = None,
    start_time: time | None = None,
    move_open_before_to_today: bool = False,
    response_format: ResponseFormat = ResponseFormat.concise,
) -> dict[str, Any]:
    """Reschedule one task, or explicitly move open backlog onto today."""
    svc = TaskService(db)
    if move_open_before_to_today:
        today = user_today(user)
        open_tasks = await svc.list_open(user)
        moved = []
        for t in open_tasks:
            updated = await svc.update(
                user,
                t.id,
                TaskUpdate(day=today, is_all_day=t.is_all_day, start_time=t.start_time),
            )
            moved.append(format_task(updated, response_format))
        return {"moved": moved, "to_day": today.isoformat()}
    if not task_id or not day:
        raise AppError(
            "validation_error",
            "Provide task_id and day, or move_open_before_to_today=true",
            hint="move_open_before_to_today is never automatic — only when explicitly requested",
        )
    if task_id.startswith("occ_"):
        raise AppError(
            "validation_error",
            "Cannot reschedule a single occurrence with planner_reschedule",
            hint="Skip that day with planner_skip_occurrence, or update the series rule",
        )
    update = TaskUpdate(day=day)
    if start_time is not None:
        update.start_time = start_time
        update.is_all_day = False
    task = await svc.update(user, UUID(task_id), update)
    return format_task(task, response_format)


async def planner_list_series(
    db: AsyncSession,
    user: User,
    *,
    response_format: ResponseFormat = ResponseFormat.concise,
) -> dict[str, Any]:
    items = await SeriesService(db).list(user)
    return {"series": [format_series(s, response_format) for s in items]}


async def planner_create_series(
    db: AsyncSession,
    user: User,
    *,
    title: str,
    freq: str,
    start_day: date,
    interval: int = 1,
    weekdays: list[int] | None = None,
    end_day: date | None = None,
    start_time: time | None = None,
    is_all_day: bool = False,
    notes: str | None = None,
    duration_minutes: int | None = None,
    response_format: ResponseFormat = ResponseFormat.concise,
) -> dict[str, Any]:
    """Create a recurring rule. weekdays: 0=Mon .. 6=Sun (weekly)."""
    try:
        freq_enum = Freq(freq)
    except ValueError as err:
        raise AppError(
            "validation_error",
            f"Invalid freq '{freq}'",
            hint="Use daily, weekly, monthly, or yearly",
        ) from err
    data = SeriesCreate(
        title=title,
        notes=notes,
        freq=freq_enum,
        interval=interval,
        weekdays=weekdays,
        start_day=start_day,
        end_day=end_day,
        start_time=start_time,
        duration_minutes=duration_minutes,
        is_all_day=is_all_day,
    )
    series = await SeriesService(db).create(user, data)
    return format_series(series, response_format)


async def planner_update_series(
    db: AsyncSession,
    user: User,
    *,
    series_id: str,
    title: str | None = None,
    freq: str | None = None,
    interval: int | None = None,
    weekdays: list[int] | None = None,
    end_day: date | None = None,
    start_time: time | None = None,
    is_all_day: bool | None = None,
    notes: str | None = None,
    duration_minutes: int | None = None,
    response_format: ResponseFormat = ResponseFormat.concise,
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if title is not None:
        payload["title"] = title
    if freq is not None:
        try:
            payload["freq"] = Freq(freq)
        except ValueError as err:
            raise AppError(
                "validation_error",
                f"Invalid freq '{freq}'",
                hint="Use daily, weekly, monthly, or yearly",
            ) from err
    if interval is not None:
        payload["interval"] = interval
    if weekdays is not None:
        payload["weekdays"] = weekdays
    if end_day is not None:
        payload["end_day"] = end_day
    if start_time is not None:
        payload["start_time"] = start_time
    if is_all_day is not None:
        payload["is_all_day"] = is_all_day
    if notes is not None:
        payload["notes"] = notes
    if duration_minutes is not None:
        payload["duration_minutes"] = duration_minutes
    series = await SeriesService(db).update(user, UUID(series_id), SeriesUpdate(**payload))
    return format_series(series, response_format)


async def planner_delete_series(
    db: AsyncSession,
    user: User,
    *,
    series_id: str,
) -> dict[str, Any]:
    await SeriesService(db).soft_delete(user, UUID(series_id))
    return {"deleted_series_id": series_id}


async def planner_skip_occurrence(
    db: AsyncSession,
    user: User,
    *,
    series_id: str | None = None,
    day: date | None = None,
    occurrence_id: str | None = None,
) -> dict[str, Any]:
    """Skip one occurrence (hide that day). Pass occurrence_id or series_id+day."""
    if occurrence_id:
        sid, occ_day = parse_occurrence_id(occurrence_id)
    elif series_id and day:
        sid, occ_day = UUID(series_id), day
    else:
        raise AppError(
            "validation_error",
            "Provide occurrence_id or series_id+day",
        )
    await SeriesService(db).add_exception(
        user,
        sid,
        ExceptionCreate(occurrence_day=occ_day, kind="skip"),
    )
    return {"skipped": True, "series_id": str(sid), "day": occ_day.isoformat()}
