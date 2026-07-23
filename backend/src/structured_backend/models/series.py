from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from structured_backend.db.base import Base

if TYPE_CHECKING:
    from structured_backend.models.user import User


class Series(Base):
    __tablename__ = "series"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    freq: Mapped[str] = mapped_column(String(16), nullable=False)  # daily|weekly|monthly|yearly
    interval: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    weekdays: Mapped[str | None] = mapped_column(String(32))  # comma-separated 0=Mon .. 6=Sun
    start_day: Mapped[date] = mapped_column(Date, nullable=False)
    end_day: Mapped[date | None] = mapped_column(Date)
    start_time: Mapped[time | None] = mapped_column(Time)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    is_all_day: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    color: Mapped[str | None] = mapped_column(String(32))
    symbol: Mapped[str | None] = mapped_column(String(64))
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship()
    exceptions: Mapped[list[SeriesException]] = relationship(
        back_populates="series", cascade="all, delete-orphan"
    )
    completions: Mapped[list[SeriesCompletion]] = relationship(
        back_populates="series", cascade="all, delete-orphan"
    )


class SeriesException(Base):
    __tablename__ = "series_exceptions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    series_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("series.id"), nullable=False, index=True)
    occurrence_day: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # skip|override
    title: Mapped[str | None] = mapped_column(String(500))
    start_time: Mapped[time | None] = mapped_column(Time)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    is_all_day: Mapped[bool | None] = mapped_column(Boolean)

    series: Mapped[Series] = relationship(back_populates="exceptions")


class SeriesCompletion(Base):
    __tablename__ = "series_completions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    series_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("series.id"), nullable=False, index=True)
    occurrence_day: Mapped[date] = mapped_column(Date, nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    series: Mapped[Series] = relationship(back_populates="completions")
