from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.etag import content_etag
from structured_backend.models.user import User
from structured_backend.schemas.task import TaskRead
from structured_backend.schemas.timeline import TimelineItem
from structured_backend.schemas.widget import WidgetSnapshot
from structured_backend.services.series import SeriesService
from structured_backend.services.tasks import TaskService
from structured_backend.timeutil import user_today, utcnow


def _task_to_item(t) -> TimelineItem:
    return TimelineItem(
        id=str(t.id),
        title=t.title,
        notes=t.notes,
        day=t.day,
        start_time=t.start_time,
        duration_minutes=t.duration_minutes,
        is_all_day=t.is_all_day,
        completed_at=t.completed_at,
        color=t.color,
        symbol=t.symbol,
        is_occurrence=False,
        alerts=[{"kind": a.kind, "offset_minutes": a.offset_minutes} for a in (t.alerts or [])],
    )


def _occ_to_item(o) -> TimelineItem:
    return TimelineItem(
        id=o.id,
        title=o.title,
        notes=o.notes,
        day=o.day,
        start_time=o.start_time,
        duration_minutes=o.duration_minutes,
        is_all_day=o.is_all_day,
        completed_at=o.completed_at,
        color=o.color,
        symbol=o.symbol,
        is_occurrence=True,
        series_id=o.series_id,
    )


async def merge_day(user: User, db: AsyncSession, day: date) -> list[TimelineItem]:
    tasks = await TaskService(db).list_for_day(user, day)
    occs = await SeriesService(db).materialize_range(user, day, day)
    return [_task_to_item(t) for t in tasks] + [_occ_to_item(o) for o in occs]


def _snapshot_version(
    logical_date: date,
    today: list[TimelineItem],
    inbox: list[TaskRead],
    due: list[TimelineItem],
    tomorrow: list[TimelineItem],
    week: list[TimelineItem],
) -> str:
    parts: list[str | None] = [str(logical_date)]
    for items in (today, due, tomorrow, week):
        for item in sorted(items, key=lambda i: i.id):
            parts.extend(
                [
                    item.id,
                    item.title,
                    str(item.day) if item.day else None,
                    str(item.start_time) if item.start_time else None,
                    str(item.duration_minutes) if item.duration_minutes is not None else None,
                    str(item.is_all_day),
                    item.notes,
                    item.color,
                    item.symbol,
                    str(item.completed_at) if item.completed_at else None,
                    str(item.series_id) if item.series_id else None,
                ]
            )
    for t in sorted(inbox, key=lambda x: str(x.id)):
        parts.extend(
            [
                str(t.id),
                t.title,
                str(t.day) if t.day else None,
                str(t.completed_at) if t.completed_at else None,
                str(t.updated_at),
            ]
        )
    return content_etag(parts)[1:-1]


async def build_widget_snapshot(user: User, db: AsyncSession) -> WidgetSnapshot:
    logical_date = user_today(user)
    today_items = await merge_day(user, db, logical_date)
    tomorrow_items = await merge_day(user, db, logical_date + timedelta(days=1))

    inbox_tasks = await TaskService(db).list_inbox(user)
    inbox = [TaskRead.model_validate(t) for t in inbox_tasks]

    open_tasks = await TaskService(db).list_open(user, before=logical_date)
    missed = await SeriesService(db).latest_missed_occurrences(user, before=logical_date)
    due = [_task_to_item(t) for t in open_tasks] + [_occ_to_item(o) for o in missed]

    # Match Android WeekRepository: today through today+7 (8 days).
    week_end = logical_date + timedelta(days=7)
    week_tasks = await TaskService(db).list_range(user, logical_date, week_end)
    week_occs = await SeriesService(db).materialize_range(user, logical_date, week_end)
    week = [
        item
        for item in (
            [_task_to_item(t) for t in week_tasks] + [_occ_to_item(o) for o in week_occs]
        )
        if item.completed_at is None
    ]

    version = _snapshot_version(logical_date, today_items, inbox, due, tomorrow_items, week)

    return WidgetSnapshot(
        logical_date=logical_date,
        timezone=user.timezone,
        day_starts_at=user.day_starts_at,
        generated_at=utcnow(),
        version=version,
        today=today_items,
        inbox=inbox,
        due=due,
        tomorrow=tomorrow_items,
        week=week,
    )
