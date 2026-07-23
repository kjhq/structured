from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, Field


class TimelineItem(BaseModel):
    """One-off task or materialized recurring occurrence for day views."""

    id: str
    title: str
    notes: str | None = None
    day: date | None = None
    start_time: time | None = None
    duration_minutes: int | None = None
    is_all_day: bool = False
    completed_at: datetime | None = None
    color: str | None = None
    symbol: str | None = None
    is_occurrence: bool = False
    series_id: UUID | None = None
    alerts: list = Field(default_factory=list)
