from typing import Annotated

from fastapi import Depends, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.db.session import get_db
from structured_backend.config import settings
from structured_backend.errors import AppError
from structured_backend.models.user import User
from structured_backend.services import users as user_service

discord_id_header = APIKeyHeader(name="X-Discord-Id", auto_error=False)
widget_token_header = APIKeyHeader(name="X-Widget-Token", auto_error=False)

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    db: DbSession,
    discord_id: str | None = Security(discord_id_header),
    token: str | None = Security(widget_token_header),
) -> User:
    if not discord_id or not token:
        raise AppError(
            "unauthorized",
            "Missing Discord credentials",
            status_code=401,
            hint="Pass X-Discord-Id and X-Widget-Token",
        )
    user = await user_service.get_user_by_discord_and_token(db, discord_id, token)
    if user is None:
        raise AppError(
            "unauthorized",
            "Invalid Discord ID or widget token",
            status_code=401,
        )
    if not settings.is_discord_allowed(discord_id):
        raise AppError(
            "unauthorized",
            "Discord user not allowlisted",
            status_code=403,
            hint="Set AUTHORIZED_DISCORD_IDS on the backend",
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
