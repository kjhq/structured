from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.db.session import get_db
from structured_backend.errors import AppError
from structured_backend.models.user import User
from structured_backend.services import users as user_service

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    db: DbSession,
    key: str | None = Security(api_key_header),
) -> User:
    if not key:
        raise AppError(
            "unauthorized",
            "Missing API key",
            status_code=401,
            hint="Pass X-API-Key header",
        )
    user = await user_service.get_user_by_api_key(db, key)
    if user is None:
        raise AppError(
            "unauthorized",
            "Invalid or revoked API key",
            status_code=401,
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
