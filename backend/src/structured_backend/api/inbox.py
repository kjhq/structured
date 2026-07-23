from fastapi import APIRouter, Header, Response

from structured_backend.api.deps import CurrentUser, DbSession
from structured_backend.api.tasks import _etag_for, merge_day
from structured_backend.schemas.task import TaskRead
from structured_backend.schemas.timeline import TimelineItem
from structured_backend.services.tasks import TaskService
from structured_backend.timeutil import user_today

router = APIRouter()


@router.get("/inbox", response_model=list[TaskRead])
async def get_inbox(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
) -> list[TaskRead] | Response:
    tasks = await TaskService(db).list_inbox(user)
    etag = f'"{len(tasks)}"'
    if if_none_match and if_none_match == etag:
        return Response(status_code=304)
    response.headers["ETag"] = etag
    return [TaskRead.model_validate(t) for t in tasks]


@router.get("/today", response_model=list[TimelineItem])
async def get_today(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
) -> list[TimelineItem] | Response:
    items = await merge_day(user, db, user_today(user))
    etag = _etag_for(items)
    if if_none_match and if_none_match == etag:
        return Response(status_code=304)
    response.headers["ETag"] = etag
    return items
