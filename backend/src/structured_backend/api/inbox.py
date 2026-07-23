from fastapi import APIRouter, Header, Response

from structured_backend.api.deps import CurrentUser, DbSession
from structured_backend.schemas.task import TaskRead
from structured_backend.services.tasks import TaskService

router = APIRouter()


def _etag_for(tasks: list) -> str:
    if not tasks:
        return '"empty"'
    latest = max(t.updated_at.isoformat() for t in tasks)
    return f'"{latest}-{len(tasks)}"'


@router.get("/inbox", response_model=list[TaskRead])
async def get_inbox(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
) -> list[TaskRead] | Response:
    tasks = await TaskService(db).list_inbox(user)
    etag = _etag_for(tasks)
    if if_none_match and if_none_match == etag:
        return Response(status_code=304)
    response.headers["ETag"] = etag
    return [TaskRead.model_validate(t) for t in tasks]


@router.get("/today", response_model=list[TaskRead])
async def get_today(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
) -> list[TaskRead] | Response:
    tasks = await TaskService(db).list_today(user)
    etag = _etag_for(tasks)
    if if_none_match and if_none_match == etag:
        return Response(status_code=304)
    response.headers["ETag"] = etag
    return [TaskRead.model_validate(t) for t in tasks]
