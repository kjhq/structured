from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from structured_backend.api.deps import DbSession
from structured_backend.config import settings
from structured_backend.errors import AppError
from structured_backend.services import users as user_service

router = APIRouter(prefix="/bot", tags=["bot"])


class LinkBody(BaseModel):
    discord_id: str = Field(min_length=1)
    timezone: str | None = None


@router.post("/link")
async def bot_link(
    body: LinkBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
) -> dict[str, str]:
    if not x_bot_secret or x_bot_secret != settings.bot_api_secret:
        raise AppError("unauthorized", "Invalid bot secret", status_code=401)
    user, raw = await user_service.link_widget_token(
        db,
        discord_id=body.discord_id,
        timezone=body.timezone or "UTC",
    )
    return {
        "discord_id": user.discord_id or body.discord_id,
        "widget_token": raw,
        "user_id": str(user.id),
    }
