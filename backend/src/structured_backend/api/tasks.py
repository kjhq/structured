from datetime import date
from uuid import UUID

from fastapi import APIRouter, Header, Response

from structured_backend.api.deps import CurrentUser, DbSession
from structured_backend.errors import AppError
from structured_backend.schemas.task import TaskCreate, TaskRead, TaskUpdate
from structured_backend.services.tasks import TaskService

router = APIRouter()


def _etag_for(tasks: list) -> str:
    if not tasks:
        return '"empty"'
    latest = max(t.updated_at.isoformat() for t in tasks)
    return f'"{latest}-{len(tasks)}"'


@router.get("/open", response_model=list[TaskRead])
async def list_open(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    before: date | None = None,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
) -> list[TaskRead] | Response:
    tasks = await TaskService(db).list_open(user, before=before)
    etag = _etag_for(tasks)
    if if_none_match and if_none_match == etag:
        return Response(status_code=304)
    response.headers["ETag"] = etag
    return [TaskRead.model_validate(t) for t in tasks]


@router.get("/search", response_model=list[TaskRead])
async def search_tasks(user: CurrentUser, db: DbSession, q: str) -> list[TaskRead]:
    from structured_backend.services.search import search_tasks as do_search

    tasks = await do_search(db, user, q)
    return [TaskRead.model_validate(t) for t in tasks]


@router.get("", response_model=list[TaskRead])
async def list_tasks(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    day: date | None = None,
    day_from: date | None = None,
    day_to: date | None = None,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
) -> list[TaskRead] | Response:
    svc = TaskService(db)
    if day is not None:
        tasks = await svc.list_for_day(user, day)
    elif day_from is not None and day_to is not None:
        tasks = await svc.list_range(user, day_from, day_to)
    else:
        raise AppError(
            "validation_error",
            "Provide day= or day_from=&day_to=",
            hint="Use /v1/today or /v1/inbox for those views",
        )
    etag = _etag_for(tasks)
    if if_none_match and if_none_match == etag:
        return Response(status_code=304)
    response.headers["ETag"] = etag
    return [TaskRead.model_validate(t) for t in tasks]


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
