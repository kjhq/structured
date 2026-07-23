from datetime import date

from fastapi import APIRouter, Depends, Query

from structured_backend.api.deps import get_current_user
from structured_backend.schemas.task import TaskCreate, TaskRead, TaskUpdate

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[TaskRead])
async def list_tasks(
    day: date | None = None,
    day_from: date | None = None,
    day_to: date | None = None,
) -> list[TaskRead]:
    raise NotImplementedError


@router.post("", response_model=TaskRead, status_code=201)
async def create_task(body: TaskCreate) -> TaskRead:
    raise NotImplementedError


@router.patch("/{task_id}", response_model=TaskRead)
async def update_task(task_id: str, body: TaskUpdate) -> TaskRead:
    raise NotImplementedError


@router.post("/{task_id}/complete", response_model=TaskRead)
async def complete_task(task_id: str) -> TaskRead:
    raise NotImplementedError


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: str) -> None:
    raise NotImplementedError
