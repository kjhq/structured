from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from structured_backend.db.base import Base

if TYPE_CHECKING:
    from structured_backend.models.api_key import ApiKey


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, nullable=True)
    discord_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    widget_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pending_widget_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pending_widget_token_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pending_widget_token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    day_starts_at: Mapped[time] = mapped_column(Time, nullable=False, default=time(0, 0))
    briefing_morning_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    briefing_evening_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    quiet_hours_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    quiet_hours_end: Mapped[time | None] = mapped_column(Time, nullable=True)
    reminders_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    overdue_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    guild_mode: Mapped[str] = mapped_column(String(16), default="all", nullable=False)
    planner_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    capture_images: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    capture_voice: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    presence_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    api_keys: Mapped[list[ApiKey]] = relationship(back_populates="user")
