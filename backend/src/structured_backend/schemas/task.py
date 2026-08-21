from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AlertCreate(BaseModel):
    kind: str = "start"
    offset_minutes: int | None = None


class AlertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: str
    offset_minutes: int | None


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    notes: str | None = None
    day: date | None = None
    start_time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=1)
    is_all_day: bool = False
    color: str | None = None
    symbol: str | None = None
    client_request_id: str | None = Field(default=None, max_length=128)
    alerts: list[AlertCreate] = Field(default_factory=list)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    notes: str | None = None
    day: date | None = None
    start_time: time | None = None
    duration_minutes: int | None = Field(default=None, ge=1)
    is_all_day: bool | None = None
    color: str | None = None
    symbol: str | None = None
    alerts: list[AlertCreate] | None = None


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    notes: str | None
    day: date | None
    start_time: time | None
    duration_minutes: int | None
    is_all_day: bool
    completed_at: datetime | None
    color: str | None
    symbol: str | None
    client_request_id: str | None
    created_at: datetime
    updated_at: datetime
    alerts: list[AlertRead] = Field(default_factory=list)
