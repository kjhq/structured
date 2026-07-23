import hashlib
import secrets
import uuid
from datetime import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.models.api_key import ApiKey
from structured_backend.models.user import User


def generate_api_key() -> str:
    return "sk_" + secrets.token_urlsafe(32)


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def create_user(
    db: AsyncSession,
    *,
    timezone: str = "UTC",
    email: str | None = None,
    label: str = "default",
    day_starts_at: time | None = None,
) -> tuple[User, str]:
    user = User(
        timezone=timezone,
        email=email,
        day_starts_at=day_starts_at or time(0, 0),
    )
    db.add(user)
    await db.flush()

    raw = generate_api_key()
    key = ApiKey(user_id=user.id, key_hash=hash_api_key(raw), label=label)
    db.add(key)
    await db.commit()
    await db.refresh(user)
    return user, raw


async def get_user_by_api_key(db: AsyncSession, raw_key: str) -> User | None:
    digest = hash_api_key(raw_key)
    result = await db.execute(
        select(ApiKey).where(ApiKey.key_hash == digest, ApiKey.revoked_at.is_(None))
    )
    api_key = result.scalar_one_or_none()
    if api_key is None:
        return None
    from structured_backend.timeutil import utcnow

    api_key.last_used_at = utcnow()
    await db.commit()
    result = await db.execute(select(User).where(User.id == api_key.user_id))
    return result.scalar_one_or_none()


async def get_user(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()
