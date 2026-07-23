"""Task CRUD — wired up once DB session + routes are implemented."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from structured_backend.models.task import Task
from structured_backend.schemas.task import TaskCreate, TaskUpdate


class TaskService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, data: TaskCreate) -> Task:
        raise NotImplementedError

    async def get(self, task_id: UUID) -> Task | None:
        raise NotImplementedError

    async def update(self, task_id: UUID, data: TaskUpdate) -> Task | None:
        raise NotImplementedError

    async def delete(self, task_id: UUID) -> bool:
        raise NotImplementedError
