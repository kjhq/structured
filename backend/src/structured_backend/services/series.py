from __future__ import annotations

import uuid
from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from structured_backend.errors import AppError
from structured_backend.models.series import Series, SeriesCompletion, SeriesException
from structured_backend.models.user import User
from structured_backend.schemas.series import (
    ExceptionCreate,
    OccurrenceRead,
    SeriesCreate,
    SeriesRead,
    SeriesUpdate,
)
from structured_backend.timeutil import utcnow


def _encode_weekdays(weekdays: list[int] | None) -> str | None:
    if not weekdays:
        return None
    return ",".join(str(d) for d in sorted(weekdays))


def _decode_weekdays(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    return [int(x) for x in raw.split(",") if x != ""]


def series_to_read(series: Series) -> SeriesRead:
    return SeriesRead(
        id=series.id,
        title=series.title,
        notes=series.notes,
        freq=series.freq,
        interval=series.interval,
        weekdays=_decode_weekdays(series.weekdays),
        start_day=series.start_day,
        end_day=series.end_day,
        start_time=series.start_time,
        duration_minutes=series.duration_minutes,
        is_all_day=series.is_all_day,
        color=series.color,
        symbol=series.symbol,
        timezone=series.timezone,
    )


def occurrence_id(series_id: uuid.UUID, day: date) -> str:
    return f"occ_{series_id}_{day.isoformat()}"


def _matches(series: Series, day: date) -> bool:
    if day < series.start_day:
        return False
    if series.end_day and day > series.end_day:
        return False
    if series.freq == "daily":
        delta = (day - series.start_day).days
        return delta % series.interval == 0
    if series.freq == "weekly":
        weekdays = _decode_weekdays(series.weekdays) or [series.start_day.weekday()]
        if day.weekday() not in weekdays:
            return False
        # Monday-based week index from start so interval>1 multi-weekday series
        # share one week bucket across Mon–Sun of the same calendar week.
        start_monday = series.start_day - timedelta(days=series.start_day.weekday())
        day_monday = day - timedelta(days=day.weekday())
        weeks = (day_monday - start_monday).days // 7
        return weeks % series.interval == 0
    if series.freq == "monthly":
        if day.day != series.start_day.day:
            # last day of month fallback if start day doesn't exist
            last = monthrange(day.year, day.month)[1]
            if series.start_day.day > last and day.day == last:
                pass
            else:
                return False
        months = (day.year - series.start_day.year) * 12 + (day.month - series.start_day.month)
        return months % series.interval == 0
    if series.freq == "yearly":
        if (day.month, day.day) != (series.start_day.month, series.start_day.day):
            return False
        years = day.year - series.start_day.year
        return years % series.interval == 0
    return False


class SeriesService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, user: User, data: SeriesCreate) -> Series:
        if data.freq == "weekly" and not data.weekdays:
            data = data.model_copy(update={"weekdays": [data.start_day.weekday()]})
        series = Series(
            user_id=user.id,
            title=data.title,
            notes=data.notes,
            freq=data.freq.value,
            interval=data.interval,
            weekdays=_encode_weekdays(data.weekdays),
            start_day=data.start_day,
            end_day=data.end_day,
            start_time=data.start_time,
            duration_minutes=data.duration_minutes or (30 if not data.is_all_day else None),
            is_all_day=data.is_all_day,
            color=data.color,
            symbol=data.symbol,
            timezone=user.timezone,
        )
        self.db.add(series)
        await self.db.commit()
        await self.db.refresh(series)
        return series

    async def list(self, user: User) -> list[Series]:
        result = await self.db.execute(
            select(Series).where(Series.user_id == user.id, Series.deleted_at.is_(None))
        )
        return list(result.scalars().all())

    async def get(self, user: User, series_id: uuid.UUID) -> Series | None:
        result = await self.db.execute(
            select(Series)
            .options(selectinload(Series.exceptions), selectinload(Series.completions))
            .where(
                Series.id == series_id,
                Series.user_id == user.id,
                Series.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def update(self, user: User, series_id: uuid.UUID, data: SeriesUpdate) -> Series:
        series = await self.get(user, series_id)
        if series is None:
            raise AppError("not_found", "Series not found", status_code=404)
        payload = data.model_dump(exclude_unset=True)
        if "freq" in payload and payload["freq"] is not None:
            payload["freq"] = payload["freq"].value if hasattr(payload["freq"], "value") else payload["freq"]
        if "weekdays" in payload:
            payload["weekdays"] = _encode_weekdays(payload["weekdays"])
        for key, value in payload.items():
            setattr(series, key, value)
        series.updated_at = utcnow()
        await self.db.commit()
        return await self.get(user, series_id)  # type: ignore[return-value]

    async def soft_delete(self, user: User, series_id: uuid.UUID) -> None:
        series = await self.get(user, series_id)
        if series is None:
            raise AppError("not_found", "Series not found", status_code=404)
        series.deleted_at = utcnow()
        await self.db.commit()

    async def add_exception(self, user: User, series_id: uuid.UUID, data: ExceptionCreate) -> Series:
        series = await self.get(user, series_id)
        if series is None:
            raise AppError("not_found", "Series not found", status_code=404)
        exc = SeriesException(
            series_id=series.id,
            occurrence_day=data.occurrence_day,
            kind=data.kind,
            title=data.title,
            start_time=data.start_time,
            duration_minutes=data.duration_minutes,
            is_all_day=data.is_all_day,
        )
        self.db.add(exc)
        await self.db.commit()
        return await self.get(user, series_id)  # type: ignore[return-value]

    async def complete_occurrence(self, user: User, series_id: uuid.UUID, day: date) -> None:
        series = await self.get(user, series_id)
        if series is None:
            raise AppError("not_found", "Series not found", status_code=404)
        if not _matches(series, day):
            raise AppError(
                "validation_error",
                "Day does not match series recurrence",
                hint="Pick an occurrence day that the rule generates",
            )
        existing = next((c for c in series.completions if c.occurrence_day == day), None)
        if existing:
            return
        self.db.add(SeriesCompletion(series_id=series.id, occurrence_day=day, completed_at=utcnow()))
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()

    async def materialize_range(
        self, user: User, day_from: date, day_to: date
    ) -> list[OccurrenceRead]:
        if day_to < day_from:
            raise AppError(
                "validation_error",
                "day_to must be >= day_from",
            )
        span = (day_to - day_from).days + 1
        from structured_backend.config import settings

        if span > settings.max_range_days:
            raise AppError(
                "validation_error",
                f"Date range exceeds {settings.max_range_days} days",
                hint=f"Request at most {settings.max_range_days} days at a time",
            )
        result = await self.db.execute(
            select(Series)
            .options(selectinload(Series.exceptions), selectinload(Series.completions))
            .where(Series.user_id == user.id, Series.deleted_at.is_(None))
        )
        series_list = list(result.scalars().all())
        out: list[OccurrenceRead] = []
        day = day_from
        while day <= day_to:
            for series in series_list:
                if not _matches(series, day):
                    continue
                skip = any(
                    e.occurrence_day == day and e.kind == "skip" for e in series.exceptions
                )
                if skip:
                    continue
                override = next(
                    (e for e in series.exceptions if e.occurrence_day == day and e.kind == "override"),
                    None,
                )
                completed = next(
                    (c for c in series.completions if c.occurrence_day == day),
                    None,
                )
                out.append(
                    OccurrenceRead(
                        id=occurrence_id(series.id, day),
                        series_id=series.id,
                        title=override.title if override and override.title else series.title,
                        day=day,
                        start_time=(
                            override.start_time
                            if override and override.start_time is not None
                            else series.start_time
                        ),
                        duration_minutes=(
                            override.duration_minutes
                            if override and override.duration_minutes is not None
                            else series.duration_minutes
                        ),
                        is_all_day=(
                            override.is_all_day
                            if override and override.is_all_day is not None
                            else series.is_all_day
                        ),
                        completed_at=completed.completed_at if completed else None,
                        color=series.color,
                        symbol=series.symbol,
                        notes=series.notes,
                    )
                )
            day += timedelta(days=1)
        return out

    async def latest_missed_occurrences(
        self, user: User, *, before: date
    ) -> list[OccurrenceRead]:
        """One latest incomplete past occurrence per active series."""
        # Look back a bounded window to avoid unbounded CPU.
        from structured_backend.config import settings

        lookback = min(90, settings.max_range_days)
        day_from = before - timedelta(days=lookback)
        occs = await self.materialize_range(user, day_from, before - timedelta(days=1))
        latest: dict[uuid.UUID, OccurrenceRead] = {}
        for occ in occs:
            if occ.completed_at is not None:
                continue
            prev = latest.get(occ.series_id)
            if prev is None or occ.day > prev.day:
                latest[occ.series_id] = occ
        return sorted(latest.values(), key=lambda o: o.day, reverse=True)
