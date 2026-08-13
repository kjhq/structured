from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from structured_backend.api.deps import DbSession
from structured_backend.config import settings
from structured_backend.errors import AppError
from structured_backend.services import users as user_service
from structured_backend.timeutil import validate_timezone

router = APIRouter(prefix="/bot", tags=["bot"])


class LinkBody(BaseModel):
    discord_id: str = Field(min_length=1)
    timezone: str | None = None


class ActivateBody(BaseModel):
    discord_id: str = Field(min_length=1)
    pending_id: str = Field(min_length=1)


def _require_bot(secret: str | None, discord_id: str) -> None:
    if not settings.bot_secret_ok(secret):
        raise AppError("unauthorized", "Invalid bot secret", status_code=401)
    if not settings.is_discord_allowed(discord_id):
        raise AppError(
            "unauthorized",
            "Discord user not allowlisted",
            status_code=403,
            hint="Set AUTHORIZED_DISCORD_IDS on the backend",
        )


@router.post("/link/prepare")
async def bot_link_prepare(
    body: LinkBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
) -> dict[str, str]:
    """Mint a pending widget token without invalidating the active one."""
    _require_bot(x_bot_secret, body.discord_id)
    tz = body.timezone or "UTC"
    validate_timezone(tz)
    user, raw, pending_id = await user_service.prepare_widget_token(
        db,
        discord_id=body.discord_id,
        timezone=tz,
    )
    return {
        "discord_id": user.discord_id or body.discord_id,
        "widget_token": raw,
        "pending_id": pending_id,
        "user_id": str(user.id),
    }


@router.post("/link/activate")
async def bot_link_activate(
    body: ActivateBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
) -> dict[str, str]:
    """Promote a pending token after successful DM delivery."""
    _require_bot(x_bot_secret, body.discord_id)
    user = await user_service.activate_widget_token(
        db,
        discord_id=body.discord_id,
        pending_id=body.pending_id,
    )
    return {
        "discord_id": user.discord_id or body.discord_id,
        "user_id": str(user.id),
        "status": "active",
    }


@router.post("/link")
async def bot_link(
    body: LinkBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
    x_legacy_bot_link: str | None = Header(default=None, alias="X-Legacy-Bot-Link"),
) -> dict[str, str]:
    """Legacy one-shot rotate — tests/admin only. Prefer /link/prepare + /link/activate."""
    _require_bot(x_bot_secret, body.discord_id)
    if x_legacy_bot_link != "1":
        raise AppError("not_found", "Not found", status_code=404)
    tz = body.timezone or "UTC"
    validate_timezone(tz)
    user, raw = await user_service.link_widget_token(
        db,
        discord_id=body.discord_id,
        timezone=tz,
    )
    return {
        "discord_id": user.discord_id or body.discord_id,
        "widget_token": raw,
        "user_id": str(user.id),
    }
