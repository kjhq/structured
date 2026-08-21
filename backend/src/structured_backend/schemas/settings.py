from datetime import time

from pydantic import BaseModel, Field


class SettingsRead(BaseModel):
    timezone: str
    day_starts_at: time
    briefing_morning_time: time | None = None
    briefing_evening_time: time | None = None
    quiet_hours_start: time | None = None
    quiet_hours_end: time | None = None
    reminders_enabled: bool
    overdue_enabled: bool
    capture_images: bool
    capture_voice: bool


class SettingsUpdate(BaseModel):
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    day_starts_at: time | None = None
    briefing_morning_time: time | None = None
    briefing_evening_time: time | None = None
    quiet_hours_start: time | None = None
    quiet_hours_end: time | None = None
    reminders_enabled: bool | None = None
    overdue_enabled: bool | None = None
    capture_images: bool | None = None
    capture_voice: bool | None = None
