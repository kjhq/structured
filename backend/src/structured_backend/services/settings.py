from __future__ import annotations

from datetime import time

from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.errors import AppError
from structured_backend.models.user import User
from structured_backend.schemas.settings import SettingsRead, SettingsUpdate
from structured_backend.timeutil import validate_timezone

_GUILD_MODES = frozenset({"all", "mention", "channel"})


def get_settings(user: User) -> dict:
    return SettingsRead(
        timezone=user.timezone,
        day_starts_at=user.day_starts_at,
        briefing_morning_time=user.briefing_morning_time,
        briefing_evening_time=user.briefing_evening_time,
        quiet_hours_start=user.quiet_hours_start,
        quiet_hours_end=user.quiet_hours_end,
        reminders_enabled=user.reminders_enabled,
        overdue_enabled=user.overdue_enabled,
        guild_mode=user.guild_mode,
        planner_channel_id=user.planner_channel_id,
        capture_images=user.capture_images,
        capture_voice=user.capture_voice,
        presence_enabled=user.presence_enabled,
    ).model_dump(mode="json")


async def update_settings(db: AsyncSession, user: User, data: dict | SettingsUpdate) -> dict:
    if isinstance(data, dict):
        payload = SettingsUpdate.model_validate(data)
    else:
        payload = data
    fields = payload.model_dump(exclude_unset=True)

    if "timezone" in fields and fields["timezone"] is not None:
        user.timezone = validate_timezone(fields["timezone"])
        fields.pop("timezone")

    if "guild_mode" in fields and fields["guild_mode"] is not None:
        mode = fields["guild_mode"]
        if mode not in _GUILD_MODES:
            raise AppError(
                "validation_error",
                f"Invalid guild_mode '{mode}'",
                hint="Use all, mention, or channel",
            )

    quiet_start = fields.get("quiet_hours_start", user.quiet_hours_start)
    quiet_end = fields.get("quiet_hours_end", user.quiet_hours_end)
    if (quiet_start is None) != (quiet_end is None):
        raise AppError(
            "validation_error",
            "Quiet hours need both start and end",
            hint="Pass quiet_hours_start and quiet_hours_end, or both null",
        )
    if quiet_start is not None and quiet_end is not None and quiet_start == quiet_end:
        raise AppError(
            "validation_error",
            "Quiet hours start and end cannot be equal",
        )

    guild_mode = fields.get("guild_mode", user.guild_mode)
    channel_id = fields.get("planner_channel_id", user.planner_channel_id)
    if guild_mode == "channel" and not channel_id:
        raise AppError(
            "validation_error",
            "guild_mode=channel requires planner_channel_id",
        )

    for key, value in fields.items():
        setattr(user, key, value)
    await db.commit()
    await db.refresh(user)
    return get_settings(user)
