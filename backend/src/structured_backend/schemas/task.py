from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TaskBase(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    notes: str | None = None
    day: date | None = None
    start_time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=1)
    is_all_day: bool = False
    icon: str | None = None
    color: str | None = None


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    notes: str | None = None
    day: date | None = None
    start_time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=1)
    is_all_day: bool | None = None
    completed: bool | None = None
    icon: str | None = None
    color: str | None = None


class TaskRead(TaskBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    completed: bool
    created_at: datetime
    updated_at: datetime
