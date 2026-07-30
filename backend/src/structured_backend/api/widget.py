from fastapi import APIRouter, Header, Response

from structured_backend.api.deps import CurrentUser, DbSession
from structured_backend.schemas.widget import WidgetSnapshot
from structured_backend.services.widget_snapshot import build_widget_snapshot

router = APIRouter()


@router.get("/widget/snapshot", response_model=WidgetSnapshot)
async def get_widget_snapshot(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
) -> WidgetSnapshot | Response:
    snapshot = await build_widget_snapshot(user, db)
    etag = f'"{snapshot.version}"'
    if if_none_match and if_none_match == etag:
        return Response(status_code=304)
    response.headers["ETag"] = etag
    return snapshot
