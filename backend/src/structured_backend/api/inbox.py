from fastapi import APIRouter, Depends

from structured_backend.api.deps import get_current_user
from structured_backend.schemas.task import TaskRead

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/inbox", response_model=list[TaskRead])
async def get_inbox() -> list[TaskRead]:
    """Unscheduled tasks — no day, no start_time."""
    raise NotImplementedError


@router.get("/today", response_model=list[TaskRead])
async def get_today() -> list[TaskRead]:
    """Tasks scheduled for today in the user's timezone."""
    raise NotImplementedError
