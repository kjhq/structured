from datetime import date
from uuid import UUID

from fastapi import APIRouter, Header, Response

from structured_backend.api.deps import CurrentUser, DbSession
from structured_backend.config import settings
from structured_backend.errors import AppError
from structured_backend.etag import content_etag
from structured_backend.schemas.task import TaskCreate, TaskRead, TaskUpdate
from structured_backend.schemas.timeline import TimelineItem
from structured_backend.services.series import SeriesService
from structured_backend.services.tasks import TaskService

router = APIRouter()


def _etag_for_timeline(items: list[TimelineItem]) -> str:
    parts: list[str | None] = []
    for item in sorted(items, key=lambda i: i.id):
        parts.extend(
            [
                item.id,
                item.title,
                str(item.day) if item.day else None,
                str(item.start_time) if item.start_time else None,
                str(item.completed_at) if item.completed_at else None,
                str(item.is_occurrence),
                str(item.series_id) if item.series_id else None,
            ]
        )
    return content_etag(parts)


def _etag_for_tasks(tasks: list) -> str:
    parts: list[str | None] = []
    for t in sorted(tasks, key=lambda x: str(x.id)):
        parts.extend(
            [
                str(t.id),
                t.title,
                str(t.day) if t.day else None,
                str(t.completed_at) if t.completed_at else None,
                str(t.updated_at),
                t.client_request_id,
            ]
        )
    return content_etag(parts)


def _etag_for(items: list) -> str:
    if not items:
        return '"empty"'
    if isinstance(items[0], TimelineItem):
        return _etag_for_timeline(items)
    return _etag_for_tasks(items)


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
        alerts=[
            {"kind": a.kind, "offset_minutes": a.offset_minutes} for a in (o.alerts or [])
        ],
    )


async def merge_day(user, db, day: date) -> list[TimelineItem]:
    tasks = await TaskService(db).list_for_day(user, day)
    occs = await SeriesService(db).materialize_range(user, day, day)
    return [_task_to_item(t) for t in tasks] + [_occ_to_item(o) for o in occs]


@router.get("/open", response_model=list[TaskRead])
async def list_open(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    before: date | None = None,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
) -> list[TaskRead] | Response:
    tasks = await TaskService(db).list_open(user, before=before)
    etag = _etag_for_tasks(tasks)
    if if_none_match and if_none_match == etag:
        return Response(status_code=304)
    response.headers["ETag"] = etag
    return [TaskRead.model_validate(t) for t in tasks]


@router.get("/search", response_model=list[TaskRead])
async def search_tasks_route(user: CurrentUser, db: DbSession, q: str) -> list[TaskRead]:
    from structured_backend.services.search import search_tasks as do_search

    tasks = await do_search(db, user, q)
    return [TaskRead.model_validate(t) for t in tasks]


@router.get("", response_model=list[TimelineItem])
async def list_tasks(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    day: date | None = None,
    day_from: date | None = None,
    day_to: date | None = None,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
) -> list[TimelineItem] | Response:
    if day is not None:
        items = await merge_day(user, db, day)
    elif day_from is not None and day_to is not None:
        span = (day_to - day_from).days + 1
        if day_to < day_from:
            raise AppError("validation_error", "day_to must be >= day_from")
        if span > settings.max_range_days:
            raise AppError(
                "validation_error",
                f"Date range exceeds {settings.max_range_days} days",
                hint=f"Request at most {settings.max_range_days} days at a time",
            )
        tasks = await TaskService(db).list_range(user, day_from, day_to)
        occs = await SeriesService(db).materialize_range(user, day_from, day_to)
        items = [_task_to_item(t) for t in tasks] + [_occ_to_item(o) for o in occs]
    else:
        raise AppError(
            "validation_error",
            "Provide day= or day_from=&day_to=",
            hint="Use /v1/today or /v1/inbox for those views",
        )
    etag = _etag_for(items)
    if if_none_match and if_none_match == etag:
        return Response(status_code=304)
    response.headers["ETag"] = etag
    return items


@router.post("", response_model=TaskRead, status_code=201)
async def create_task(
    body: TaskCreate,
    user: CurrentUser,
    db: DbSession,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> TaskRead:
    if idempotency_key and not body.client_request_id:
        body = body.model_copy(update={"client_request_id": idempotency_key})
    task = await TaskService(db).create(user, body)
    return TaskRead.model_validate(task)


@router.patch("/{task_id}", response_model=TaskRead)
async def update_task(
    task_id: UUID, body: TaskUpdate, user: CurrentUser, db: DbSession
) -> TaskRead:
    task = await TaskService(db).update(user, task_id, body)
    return TaskRead.model_validate(task)


@router.post("/{task_id}/complete", response_model=TaskRead)
async def complete_task(task_id: UUID, user: CurrentUser, db: DbSession) -> TaskRead:
    task = await TaskService(db).complete(user, task_id)
    return TaskRead.model_validate(task)


@router.post("/{task_id}/uncomplete", response_model=TaskRead)
async def uncomplete_task(task_id: UUID, user: CurrentUser, db: DbSession) -> TaskRead:
    task = await TaskService(db).uncomplete(user, task_id)
    return TaskRead.model_validate(task)


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await TaskService(db).soft_delete(user, task_id)
