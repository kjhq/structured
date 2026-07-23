from datetime import date
from uuid import UUID

from fastapi import APIRouter

from structured_backend.api.deps import CurrentUser, DbSession
from structured_backend.schemas.series import ExceptionCreate, SeriesCreate, SeriesRead, SeriesUpdate
from structured_backend.services.series import SeriesService, series_to_read

router = APIRouter()


@router.get("", response_model=list[SeriesRead])
async def list_series(user: CurrentUser, db: DbSession) -> list[SeriesRead]:
    items = await SeriesService(db).list(user)
    return [series_to_read(s) for s in items]


@router.post("", response_model=SeriesRead, status_code=201)
async def create_series(body: SeriesCreate, user: CurrentUser, db: DbSession) -> SeriesRead:
    series = await SeriesService(db).create(user, body)
    return series_to_read(series)


@router.patch("/{series_id}", response_model=SeriesRead)
async def update_series(
    series_id: UUID, body: SeriesUpdate, user: CurrentUser, db: DbSession
) -> SeriesRead:
    series = await SeriesService(db).update(user, series_id, body)
    return series_to_read(series)


@router.delete("/{series_id}", status_code=204)
async def delete_series(series_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await SeriesService(db).soft_delete(user, series_id)


@router.post("/{series_id}/exceptions", response_model=SeriesRead)
async def add_exception(
    series_id: UUID, body: ExceptionCreate, user: CurrentUser, db: DbSession
) -> SeriesRead:
    series = await SeriesService(db).add_exception(user, series_id, body)
    return series_to_read(series)


@router.post("/{series_id}/occurrences/{occurrence_day}/complete")
async def complete_occurrence(
    series_id: UUID, occurrence_day: date, user: CurrentUser, db: DbSession
) -> dict[str, bool]:
    await SeriesService(db).complete_occurrence(user, series_id, occurrence_day)
    return {"ok": True}
