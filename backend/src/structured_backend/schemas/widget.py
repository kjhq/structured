from datetime import date, datetime, time

from pydantic import BaseModel

from structured_backend.schemas.task import TaskRead
from structured_backend.schemas.timeline import TimelineItem


class WidgetSnapshot(BaseModel):
    logical_date: date
    timezone: str
    day_starts_at: time
    generated_at: datetime
    version: str
    today: list[TimelineItem]
    inbox: list[TaskRead]
    due: list[TimelineItem]
    tomorrow: list[TimelineItem]
    week: list[TimelineItem]
