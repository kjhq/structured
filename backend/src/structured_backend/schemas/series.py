from datetime import date, datetime, time
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Freq(str, Enum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    yearly = "yearly"


class SeriesCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    notes: str | None = None
    freq: Freq
    interval: int = Field(default=1, ge=1)
    weekdays: list[int] | None = None  # 0=Mon .. 6=Sun
    start_day: date
    end_day: date | None = None
    start_time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=1)
    is_all_day: bool = False
    color: str | None = None
    symbol: str | None = None


class SeriesUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    notes: str | None = None
    freq: Freq | None = None
    interval: int | None = Field(default=None, ge=1)
    weekdays: list[int] | None = None
    end_day: date | None = None
    start_time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=1)
    is_all_day: bool | None = None
    color: str | None = None
    symbol: str | None = None


class SeriesRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    notes: str | None
    freq: str
    interval: int
    weekdays: list[int] | None
    start_day: date
    end_day: date | None
    start_time: time | None
    duration_minutes: int | None
    is_all_day: bool
    color: str | None
    symbol: str | None
    timezone: str


class ExceptionCreate(BaseModel):
    occurrence_day: date
    kind: str = Field(pattern="^(skip|override)$")
    title: str | None = None
    start_time: time | None = None
    duration_minutes: int | None = None
    is_all_day: bool | None = None


class OccurrenceRead(BaseModel):
    """Materialized occurrence for day views."""

    id: str
    series_id: UUID
    title: str
    day: date
    start_time: time | None
    duration_minutes: int | None
    is_all_day: bool
    completed_at: datetime | None
    color: str | None
    symbol: str | None
    notes: str | None = None
    is_occurrence: bool = True
