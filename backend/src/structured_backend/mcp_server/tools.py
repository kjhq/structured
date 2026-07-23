"""Agent-facing planner tools — thin wrappers over domain services."""

from __future__ import annotations

from datetime import date, time
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.errors import AppError
from structured_backend.models.user import User
from structured_backend.schemas.task import TaskCreate, TaskUpdate
from structured_backend.services.search import search_tasks
from structured_backend.services.tasks import TaskService
from structured_backend.timeutil import user_today


class ResponseFormat(str, Enum):
    concise = "concise"
    detailed = "detailed"


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
    }


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
    }


async def planner_get_overview(
    db: AsyncSession,
    user: User,
    *,
    response_format: ResponseFormat = ResponseFormat.concise,
    next_n: int = 5,
) -> dict[str, Any]:
    svc = TaskService(db)
    today = user_today(user)
    today_tasks = await svc.list_today(user)
    open_tasks = await svc.list_open(user)
    timed = [t for t in today_tasks if t.start_time and not t.completed_at][:next_n]
    return {
        "timezone": user.timezone,
        "today": today.isoformat(),
        "today_count": len(today_tasks),
        "open_backlog_count": len(open_tasks),
        "next_timed": [format_task(t, response_format) for t in timed],
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
    elif open_backlog:
        tasks = await svc.list_open(user)
    elif day is not None:
        tasks = await svc.list_for_day(user, day)
    elif q:
        tasks = await search_tasks(db, user, q)
    else:
        raise AppError(
            "validation_error",
            "Provide q, day, open_backlog=true, or inbox=true",
            hint="Use open_backlog for previously unticked dated tasks",
        )
    return {"tasks": [format_task(t, response_format) for t in tasks]}


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
    svc = TaskService(db)
    out = []
    for tid in task_ids:
        task = await svc.complete(user, UUID(tid))
        out.append(format_task(task, response_format))
    return {"completed": out}


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
    update = TaskUpdate(day=day)
    if start_time is not None:
        update.start_time = start_time
        update.is_all_day = False
    task = await svc.update(user, UUID(task_id), update)
    return format_task(task, response_format)
