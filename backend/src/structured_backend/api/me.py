from datetime import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from structured_backend.api.deps import CurrentUser, DbSession
from structured_backend.models.user import User

router = APIRouter()


class UserRead(BaseModel):
    id: str
    email: str | None
    timezone: str
    day_starts_at: time

    @classmethod
    def from_orm_user(cls, user: User) -> "UserRead":
        return cls(
            id=str(user.id),
            email=user.email,
            timezone=user.timezone,
            day_starts_at=user.day_starts_at,
        )


class UserUpdate(BaseModel):
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    day_starts_at: time | None = None
    email: str | None = None


@router.get("/me", response_model=UserRead)
async def get_me(user: CurrentUser) -> UserRead:
    return UserRead.from_orm_user(user)


@router.patch("/me", response_model=UserRead)
async def patch_me(body: UserUpdate, user: CurrentUser, db: DbSession) -> UserRead:
    if body.timezone is not None:
        user.timezone = body.timezone
    if body.day_starts_at is not None:
        user.day_starts_at = body.day_starts_at
    if body.email is not None:
        user.email = body.email
    await db.commit()
    await db.refresh(user)
    return UserRead.from_orm_user(user)
