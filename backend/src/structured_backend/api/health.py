from fastapi import APIRouter
from sqlalchemy import text

from structured_backend.api.deps import DbSession
from structured_backend.errors import AppError

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def ready(db: DbSession) -> dict[str, str]:
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        raise AppError(
            "not_ready",
            "Database unavailable",
            status_code=503,
            hint=str(exc),
        ) from exc
    return {"status": "ready"}
