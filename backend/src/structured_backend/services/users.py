import hashlib
import secrets
import uuid
from datetime import timedelta, time, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.errors import AppError
from structured_backend.models.api_key import ApiKey
from structured_backend.models.user import User
from structured_backend.timeutil import utcnow, validate_timezone


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
    validate_timezone(timezone)
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
    api_key.last_used_at = utcnow()
    await db.commit()
    result = await db.execute(select(User).where(User.id == api_key.user_id))
    return result.scalar_one_or_none()


async def get_user(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


def generate_widget_token() -> str:
    return "wt_" + secrets.token_urlsafe(32)


def hash_widget_token(raw: str) -> str:
    return hash_api_key(raw)


async def get_user_by_discord_id(db: AsyncSession, discord_id: str) -> User | None:
    result = await db.execute(select(User).where(User.discord_id == discord_id))
    return result.scalar_one_or_none()


async def ensure_user_for_discord(
    db: AsyncSession,
    *,
    discord_id: str,
    timezone: str = "UTC",
) -> User:
    validate_timezone(timezone)
    existing = await get_user_by_discord_id(db, discord_id)
    if existing is not None:
        return existing
    user = User(discord_id=discord_id, timezone=timezone, day_starts_at=time(0, 0))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await get_user_by_discord_id(db, discord_id)
        if existing is not None:
            return existing
        raise
    await db.refresh(user)
    return user


async def _get_or_create_discord_user(
    db: AsyncSession,
    *,
    discord_id: str,
    timezone: str,
) -> User:
    validate_timezone(timezone)
    user = await get_user_by_discord_id(db, discord_id)
    if user is not None:
        user.timezone = timezone
        return user
    # Do not auto-adopt orphan users — that can bind the wrong Discord identity.
    user = User(discord_id=discord_id, timezone=timezone, day_starts_at=time(0, 0))
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        user = await get_user_by_discord_id(db, discord_id)
        if user is None:
            raise
        user.timezone = timezone
    return user


async def prepare_widget_token(
    db: AsyncSession,
    *,
    discord_id: str,
    timezone: str = "UTC",
    ttl_minutes: int = 30,
) -> tuple[User, str, str]:
    """Mint a pending token without invalidating the active widget token."""
    user = await _get_or_create_discord_user(db, discord_id=discord_id, timezone=timezone)
    raw = generate_widget_token()
    pending_id = secrets.token_urlsafe(16)
    user.pending_widget_token_hash = hash_widget_token(raw)
    user.pending_widget_token_id = pending_id
    user.pending_widget_token_expires_at = utcnow() + timedelta(minutes=ttl_minutes)
    await db.commit()
    await db.refresh(user)
    return user, raw, pending_id


async def activate_widget_token(
    db: AsyncSession,
    *,
    discord_id: str,
    pending_id: str,
) -> User:
    """Promote pending token to active; clears pending fields."""
    user = await get_user_by_discord_id(db, discord_id)
    if user is None:
        raise AppError("not_found", "User not found", status_code=404)
    if (
        not user.pending_widget_token_id
        or user.pending_widget_token_id != pending_id
        or not user.pending_widget_token_hash
    ):
        raise AppError("validation_error", "Unknown or expired pending token", status_code=400)
    expires = user.pending_widget_token_expires_at
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < utcnow():
            user.pending_widget_token_hash = None
            user.pending_widget_token_id = None
            user.pending_widget_token_expires_at = None
            await db.commit()
            raise AppError("validation_error", "Pending token expired", status_code=400)

    user.widget_token_hash = user.pending_widget_token_hash
    user.pending_widget_token_hash = None
    user.pending_widget_token_id = None
    user.pending_widget_token_expires_at = None
    await db.commit()
    await db.refresh(user)
    return user


async def link_widget_token(
    db: AsyncSession,
    *,
    discord_id: str,
    timezone: str = "UTC",
) -> tuple[User, str]:
    """Legacy one-shot rotate (tests / admin). Prefer prepare + activate."""
    user = await _get_or_create_discord_user(db, discord_id=discord_id, timezone=timezone)
    raw = generate_widget_token()
    user.widget_token_hash = hash_widget_token(raw)
    user.pending_widget_token_hash = None
    user.pending_widget_token_id = None
    user.pending_widget_token_expires_at = None
    await db.commit()
    await db.refresh(user)
    return user, raw


async def get_user_by_discord_and_token(
    db: AsyncSession,
    discord_id: str,
    raw_token: str,
) -> User | None:
    user = await get_user_by_discord_id(db, discord_id)
    if user is None or not user.widget_token_hash:
        return None
    if not secrets.compare_digest(user.widget_token_hash, hash_widget_token(raw_token)):
        return None
    return user
