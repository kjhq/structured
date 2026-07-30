from enum import Enum
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, Field

from structured_backend.api.deps import CurrentUser, DbSession
from structured_backend.config import settings
from structured_backend.errors import AppError
from structured_backend.schemas.task import TaskRead, TaskUpdate
from structured_backend.services.tasks import TaskService

router = APIRouter()


class BatchAction(str, Enum):
    complete = "complete"
    delete = "delete"
    move = "move"


class BatchRequest(BaseModel):
    action: BatchAction
    task_ids: list[UUID] = Field(min_length=1)
    day: str | None = None  # YYYY-MM-DD for move
    start_time: str | None = None


@router.post("/batch", response_model=list[TaskRead])
async def batch_tasks(body: BatchRequest, user: CurrentUser, db: DbSession) -> list[TaskRead]:
    from datetime import date, time

    if len(body.task_ids) > settings.max_batch_size:
        raise AppError(
            "validation_error",
            f"Batch exceeds {settings.max_batch_size} task_ids",
            hint=f"Send at most {settings.max_batch_size} ids per request",
        )

    svc = TaskService(db)
    results: list[TaskRead] = []
    try:
        for task_id in body.task_ids:
            if body.action == BatchAction.complete:
                task = await svc.complete(user, task_id, commit=False)
                results.append(TaskRead.model_validate(task))
            elif body.action == BatchAction.delete:
                await svc.soft_delete(user, task_id, commit=False)
            elif body.action == BatchAction.move:
                if not body.day:
                    raise AppError(
                        "validation_error",
                        "move requires day",
                        hint='Pass "day": "YYYY-MM-DD"',
                    )
                update = TaskUpdate(day=date.fromisoformat(body.day))
                if body.start_time:
                    update.start_time = time.fromisoformat(body.start_time)
                    update.is_all_day = False
                task = await svc.update(user, task_id, update, commit=False)
                results.append(TaskRead.model_validate(task))
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return results
