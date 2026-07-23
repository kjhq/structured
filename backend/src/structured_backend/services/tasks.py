import uuid
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from structured_backend.errors import AppError
from structured_backend.models.alert import Alert
from structured_backend.models.task import Task
from structured_backend.models.user import User
from structured_backend.schemas.task import TaskCreate, TaskUpdate
from structured_backend.timeutil import user_today, utcnow


def validate_task_shape(
    *,
    day: date | None,
    start_time,
    is_all_day: bool,
) -> None:
    if day is None:
        if start_time is not None or is_all_day:
            raise AppError(
                "validation_error",
                "Inbox tasks cannot have start_time or is_all_day",
                hint="Omit day for inbox, or set day for scheduled tasks",
                fields={"day": "must be null for inbox"},
            )
        return
    if is_all_day:
        if start_time is not None:
            raise AppError(
                "validation_error",
                "All-day tasks cannot have start_time",
                hint="Set is_all_day=true without start_time, or provide start_time for timed tasks",
            )
        return
    if start_time is None:
        raise AppError(
            "validation_error",
            "Timed task needs day and start_time",
            hint="Set is_all_day=true, or omit day for inbox",
            fields={"start_time": "required when not all-day and day is set"},
        )


class TaskService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, user: User, data: TaskCreate) -> Task:
        if data.client_request_id:
            existing = await self._by_client_request(user.id, data.client_request_id)
            if existing:
                return existing

        validate_task_shape(
            day=data.day,
            start_time=data.start_time,
            is_all_day=data.is_all_day,
        )
        duration = data.duration_minutes
        if data.day is not None and not data.is_all_day and duration is None:
            duration = 30

        task = Task(
            user_id=user.id,
            title=data.title,
            notes=data.notes,
            day=data.day,
            start_time=data.start_time,
            duration_minutes=duration,
            is_all_day=data.is_all_day,
            color=data.color,
            symbol=data.symbol,
            client_request_id=data.client_request_id,
            alerts=[
                Alert(kind=a.kind, offset_minutes=a.offset_minutes) for a in data.alerts
            ],
        )
        self.db.add(task)
        await self.db.commit()
        return await self.get(user, task.id)  # type: ignore[return-value]

    async def get(self, user: User, task_id: uuid.UUID) -> Task | None:
        result = await self.db.execute(
            select(Task)
            .options(selectinload(Task.alerts))
            .where(
                Task.id == task_id,
                Task.user_id == user.id,
                Task.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def list_inbox(self, user: User) -> list[Task]:
        result = await self.db.execute(
            select(Task)
            .options(selectinload(Task.alerts))
            .where(
                Task.user_id == user.id,
                Task.deleted_at.is_(None),
                Task.day.is_(None),
            )
            .order_by(Task.created_at.asc())
        )
        return list(result.scalars().all())

    async def list_for_day(self, user: User, day: date) -> list[Task]:
        result = await self.db.execute(
            select(Task)
            .options(selectinload(Task.alerts))
            .where(
                Task.user_id == user.id,
                Task.deleted_at.is_(None),
                Task.day == day,
            )
            .order_by(Task.is_all_day.desc(), Task.start_time.asc())
        )
        return list(result.scalars().all())

    async def list_today(self, user: User, now: datetime | None = None) -> list[Task]:
        return await self.list_for_day(user, user_today(user, now))

    async def list_range(self, user: User, day_from: date, day_to: date) -> list[Task]:
        result = await self.db.execute(
            select(Task)
            .options(selectinload(Task.alerts))
            .where(
                Task.user_id == user.id,
                Task.deleted_at.is_(None),
                Task.day.is_not(None),
                Task.day >= day_from,
                Task.day <= day_to,
            )
            .order_by(Task.day.asc(), Task.is_all_day.desc(), Task.start_time.asc())
        )
        return list(result.scalars().all())

    async def list_open(
        self,
        user: User,
        *,
        before: date | None = None,
        now: datetime | None = None,
    ) -> list[Task]:
        cutoff = before or user_today(user, now)
        result = await self.db.execute(
            select(Task)
            .options(selectinload(Task.alerts))
            .where(
                Task.user_id == user.id,
                Task.deleted_at.is_(None),
                Task.completed_at.is_(None),
                Task.day.is_not(None),
                Task.day < cutoff,
            )
            .order_by(Task.day.asc(), Task.start_time.asc())
        )
        return list(result.scalars().all())

    async def update(self, user: User, task_id: uuid.UUID, data: TaskUpdate) -> Task:
        task = await self.get(user, task_id)
        if task is None:
            raise AppError("not_found", "Task not found", status_code=404)

        payload = data.model_dump(exclude_unset=True)
        day = payload.get("day", task.day)
        start_time = payload.get("start_time", task.start_time)
        is_all_day = payload.get("is_all_day", task.is_all_day)
        # Allow clearing day to move to inbox via explicit null if field was set
        if "day" in payload and payload["day"] is None:
            day = None
            if "is_all_day" not in payload:
                is_all_day = False
            if "start_time" not in payload:
                start_time = None

        validate_task_shape(day=day, start_time=start_time, is_all_day=is_all_day)

        for key, value in payload.items():
            setattr(task, key, value)
        if "day" in payload and payload["day"] is None:
            task.is_all_day = False
            task.start_time = None

        task.updated_at = utcnow()
        await self.db.commit()
        return await self.get(user, task_id)  # type: ignore[return-value]

    async def complete(self, user: User, task_id: uuid.UUID) -> Task:
        task = await self.get(user, task_id)
        if task is None:
            raise AppError("not_found", "Task not found", status_code=404)
        if task.completed_at is None:
            task.completed_at = utcnow()
            task.updated_at = utcnow()
            await self.db.commit()
        return await self.get(user, task_id)  # type: ignore[return-value]

    async def uncomplete(self, user: User, task_id: uuid.UUID) -> Task:
        task = await self.get(user, task_id)
        if task is None:
            raise AppError("not_found", "Task not found", status_code=404)
        if task.completed_at is not None:
            task.completed_at = None
            task.updated_at = utcnow()
            await self.db.commit()
        return await self.get(user, task_id)  # type: ignore[return-value]

    async def soft_delete(self, user: User, task_id: uuid.UUID) -> None:
        task = await self.get(user, task_id)
        if task is None:
            raise AppError("not_found", "Task not found", status_code=404)
        task.deleted_at = utcnow()
        task.updated_at = utcnow()
        await self.db.commit()

    async def _by_client_request(self, user_id: uuid.UUID, client_request_id: str) -> Task | None:
        result = await self.db.execute(
            select(Task)
            .options(selectinload(Task.alerts))
            .where(
                Task.user_id == user_id,
                Task.client_request_id == client_request_id,
                Task.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()
