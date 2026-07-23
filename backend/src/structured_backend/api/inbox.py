from datetime import date

from fastapi import APIRouter, Depends, Query

from structured_backend.api.auth import require_api_key
from structured_backend.schemas.task import TaskCreate, TaskRead, TaskUpdate

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.get("/inbox", response_model=list[TaskRead])
async def get_inbox() -> list[TaskRead]:
    """Unscheduled tasks — no day, no start_time."""
    raise NotImplementedError


@router.get("/today", response_model=list[TaskRead])
async def get_today(timezone: str = Query(default="UTC")) -> list[TaskRead]:
    """Tasks scheduled for today in the given timezone."""
    raise NotImplementedError
