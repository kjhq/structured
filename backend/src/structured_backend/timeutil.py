from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from structured_backend.models.user import User


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def user_local_now(user: User, now: datetime | None = None) -> datetime:
    moment = now or utcnow()
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(ZoneInfo(user.timezone))


def user_today(user: User, now: datetime | None = None) -> date:
    """Calendar date for the user, respecting day_starts_at."""
    local = user_local_now(user, now)
    boundary = user.day_starts_at or time(0, 0)
    local_clock = local.time().replace(tzinfo=None)
    if local_clock < boundary:
        return (local - timedelta(days=1)).date()
    return local.date()
