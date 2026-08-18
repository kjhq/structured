from __future__ import annotations

from datetime import date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.models.user import User
from structured_backend.services.series import SeriesService
from structured_backend.services.tasks import TaskService
from structured_backend.timeutil import user_today


def _minutes(t: time) -> int:
    return t.hour * 60 + t.minute


def _fmt(minutes: int) -> str:
    minutes = max(0, minutes)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _duration(item) -> int:
    if item.duration_minutes:
        return item.duration_minutes
    if getattr(item, "is_all_day", False) or item.start_time is None:
        return 0
    return 30


def _timed_blocks(tasks, occs) -> list[dict]:
    out: list[dict] = []
    for item in list(tasks) + list(occs):
        if getattr(item, "completed_at", None) is not None:
            continue
        if getattr(item, "is_all_day", False) or item.start_time is None:
            continue
        start = _minutes(item.start_time)
        dur = _duration(item)
        title = item.title
        ident = str(item.id) if not getattr(item, "is_occurrence", False) else item.id
        if hasattr(item, "is_occurrence") or ident.startswith("occ_"):
            ident = getattr(item, "id", ident)
        out.append(
            {
                "id": str(ident),
                "title": title,
                "start": start,
                "end": start + dur,
            }
        )
    return out


async def _day_items(db: AsyncSession, user: User, day: date):
    tasks = await TaskService(db).list_for_day(user, day)
    occs = await SeriesService(db).materialize_range(user, day, day)
    return tasks, occs


async def overlaps_on_day(
    db: AsyncSession,
    user: User,
    day: date,
    *,
    ignore_task_id: UUID | None = None,
) -> list[dict]:
    tasks, occs = await _day_items(db, user, day)
    if ignore_task_id is not None:
        tasks = [t for t in tasks if t.id != ignore_task_id]
    blocks = _timed_blocks(tasks, occs)
    hits: list[dict] = []
    for i, a in enumerate(blocks):
        for b in blocks[i + 1 :]:
            if a["start"] < b["end"] and b["start"] < a["end"]:
                hits.append(
                    {
                        "a_id": a["id"],
                        "a_title": a["title"],
                        "b_id": b["id"],
                        "b_title": b["title"],
                        "from": _fmt(max(a["start"], b["start"])),
                        "to": _fmt(min(a["end"], b["end"])),
                    }
                )
    return hits


async def overlap_warnings_for_item(
    db: AsyncSession,
    user: User,
    *,
    day: date | None,
    start_time: time | None,
    duration_minutes: int | None,
    is_all_day: bool,
    ignore_id: str | None = None,
) -> list[dict]:
    if day is None or is_all_day or start_time is None:
        return []
    tasks, occs = await _day_items(db, user, day)
    blocks = _timed_blocks(tasks, occs)
    start = _minutes(start_time)
    end = start + (duration_minutes or 30)
    warnings: list[dict] = []
    for b in blocks:
        if ignore_id and b["id"] == ignore_id:
            continue
        if start < b["end"] and b["start"] < end:
            warnings.append(
                {
                    "with_id": b["id"],
                    "with_title": b["title"],
                    "from": _fmt(max(start, b["start"])),
                    "to": _fmt(min(end, b["end"])),
                }
            )
    return warnings


async def suggest_slots(
    db: AsyncSession,
    user: User,
    *,
    duration_minutes: int = 30,
    day: date | None = None,
    after_time: time | None = None,
    count: int = 5,
) -> list[dict]:
    target = day or user_today(user)
    tasks, occs = await _day_items(db, user, target)
    busy = sorted(_timed_blocks(tasks, occs), key=lambda b: b["start"])
    window_start = 7 * 60
    window_end = 21 * 60
    cursor = window_start
    if after_time is not None:
        cursor = max(cursor, _minutes(after_time))
    elif target == user_today(user):
        local = datetime.now(ZoneInfo(user.timezone)).time()
        cursor = max(cursor, _minutes(local))
    slots: list[dict] = []
    i = 0
    while cursor + duration_minutes <= window_end and len(slots) < count:
        while i < len(busy) and busy[i]["end"] <= cursor:
            i += 1
        if i < len(busy) and busy[i]["start"] < cursor + duration_minutes and busy[i]["end"] > cursor:
            cursor = busy[i]["end"]
            continue
        slots.append(
            {
                "day": target.isoformat(),
                "start_time": _fmt(cursor),
                "end_time": _fmt(cursor + duration_minutes),
            }
        )
        cursor += duration_minutes
    return slots


async def week_streaks(db: AsyncSession, user: User) -> list[dict]:
    today = user_today(user)
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    occs = await SeriesService(db).materialize_range(user, monday, sunday)
    by_series: dict[UUID, dict] = {}
    for occ in occs:
        bucket = by_series.setdefault(
            occ.series_id,
            {"series_id": str(occ.series_id), "title": occ.title, "done": 0, "expected": 0, "window": "week"},
        )
        if occ.day <= today:
            bucket["expected"] += 1
            if occ.completed_at is not None:
                bucket["done"] += 1
    return list(by_series.values())
