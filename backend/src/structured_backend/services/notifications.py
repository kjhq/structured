from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from structured_backend.config import settings
from structured_backend.errors import AppError
from structured_backend.models.notification import NotificationDelivery
from structured_backend.models.user import User
from structured_backend.services.series import SeriesService
from structured_backend.services.tasks import TaskService
from structured_backend.timeutil import user_today, utcnow


def alert_fire_at(
    user: User,
    *,
    day: date,
    start_time: time | None,
    is_all_day: bool,
    offset_minutes: int | None,
) -> datetime:
    tz = ZoneInfo(user.timezone)
    if is_all_day or start_time is None:
        nine = time(9, 0)
        boundary = user.day_starts_at or time(0, 0)
        local_t = nine if nine >= boundary else boundary
    else:
        local_t = start_time
    local = datetime.combine(day, local_t, tzinfo=tz)
    return local.astimezone(timezone.utc) + timedelta(minutes=offset_minutes or 0)


def in_quiet_hours(user: User, moment: datetime) -> bool:
    start, end = user.quiet_hours_start, user.quiet_hours_end
    if start is None or end is None:
        return False
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    local = moment.astimezone(ZoneInfo(user.timezone)).time().replace(microsecond=0)
    local = time(local.hour, local.minute, local.second)
    if start < end:
        return start <= local < end
    if start > end:
        return local >= start or local < end
    return False


def defer_through_quiet(user: User, fire_at: datetime) -> datetime:
    if not in_quiet_hours(user, fire_at):
        return fire_at
    tz = ZoneInfo(user.timezone)
    local = fire_at.astimezone(tz)
    end = user.quiet_hours_end
    assert end is not None
    candidate = local.replace(hour=end.hour, minute=end.minute, second=0, microsecond=0)
    if candidate <= local:
        candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc)


def _source_key_alert(kind_id: str, fire_at: datetime) -> str:
    stamp = fire_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    return f"alert:{kind_id}:{stamp}"


def task_source_prefix(task_id: UUID | str) -> str:
    return f"alert:task:{task_id}:"


def occ_source_prefix(series_id: UUID | str, day: date) -> str:
    return f"alert:occ:{series_id}:{day.isoformat()}:"


def _embed(title: str, when: str, color: str | None = None, notes: str | None = None) -> dict:
    fields = [{"name": "When", "value": when}]
    if notes:
        fields.append({"name": "Notes", "value": notes[:200]})
    return {
        "title": title,
        "description": "",
        "color": color or "#5E96CB",
        "fields": fields,
    }


BRIEFING_TITLES = {
    "briefing_morning": "Morning briefing",
    "briefing_evening": "Evening wrap",
    "overdue": "Leftovers",
}


def _briefing_line(item: Any) -> str:
    title = getattr(item, "title", None) or "(untitled)"
    done = "✓ " if getattr(item, "completed_at", None) else ""
    start = getattr(item, "start_time", None)
    day = getattr(item, "day", None)
    if start and not getattr(item, "is_all_day", False):
        clock = start.strftime("%H:%M") if hasattr(start, "strftime") else str(start)[:5]
        return f"{done}`{clock}` **{title}**" + (f" · {day}" if day else "")
    return f"{done}**{title}**" + (f" · {day}" if day else "")


async def render_briefing_embed(db: AsyncSession, user: User, kind: str) -> dict:
    """Fresh embed for a claimed briefing row so content reflects send-time state."""
    from structured_backend.api.tasks import merge_day
    from structured_backend.services.tasks import TaskService

    today = user_today(user)
    task_svc = TaskService(db)
    parts: list[str] = []

    if kind == "briefing_morning":
        items = await merge_day(user, db, today)
        open_today = [i for i in items if not i.completed_at]
        inbox = await task_svc.list_inbox(user)
        backlog = await task_svc.list_open(user)
        if open_today:
            parts.extend(_briefing_line(i) for i in open_today[:10])
            extra = len(open_today) - 10
            if extra > 0:
                parts.append(f"and {extra} more")
        else:
            parts.append("Nothing scheduled today.")
        parts.append("")
        parts.append(
            f"inbox {len(inbox)} · leftovers {len(backlog)}"
        )
    elif kind == "briefing_evening":
        items = await merge_day(user, db, today)
        done = [i for i in items if i.completed_at]
        remaining = [i for i in items if not i.completed_at]
        parts.append(f"Done today: **{len(done)}**")
        if remaining:
            parts.append("Still open:")
            parts.extend(_briefing_line(i) for i in remaining[:10])
        else:
            parts.append("Everything on today is ticked. 🎉")
        backlog = await task_svc.list_open(user)
        if backlog:
            parts.append("")
            parts.append(f"leftovers from earlier days: {len(backlog)}")
    else:
        backlog = await task_svc.list_open(user)
        if backlog:
            parts.extend(_briefing_line(i) for i in backlog[:10])
            extra = len(backlog) - 10
            if extra > 0:
                parts.append(f"and {extra} more")
        else:
            parts.append("No leftover tasks.")

    return {
        "title": BRIEFING_TITLES.get(kind, "Briefing"),
        "description": "\n".join(parts).strip()[:4000],
        "color": "#5E96CB",
        "fields": [],
    }


def _as_utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


class NotificationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _insert(
        self,
        user: User,
        *,
        kind: str,
        source_key: str,
        fire_at: datetime,
        payload: dict,
        status: str = "pending",
        skip_reason: str | None = None,
    ) -> None:
        dup = await self.db.scalar(
            select(NotificationDelivery.id).where(
                NotificationDelivery.user_id == user.id,
                NotificationDelivery.source_key == source_key,
            )
        )
        if dup is not None:
            return
        row = NotificationDelivery(
            user_id=user.id,
            kind=kind,
            source_key=source_key,
            fire_at=fire_at,
            payload=payload,
            status=status,
            skip_reason=skip_reason,
        )
        self.db.add(row)
        try:
            await self.db.commit()
        except IntegrityError:
            # Concurrent poll won the race. rollback() expires modified
            # instances, so reload the user before callers touch attrs again.
            await self.db.rollback()
            await self.db.refresh(user)

    async def drop_pending(self, user: User, prefix: str) -> None:
        """Delete pending/claimed rows for a source_key prefix (snooze). Keep delivered."""
        await self.db.execute(
            delete(NotificationDelivery).where(
                NotificationDelivery.user_id == user.id,
                NotificationDelivery.source_key.startswith(prefix),
                NotificationDelivery.status.in_(("pending", "claimed")),
            )
        )
        await self.db.commit()

    async def skip_pending(self, user: User, prefix: str, reason: str = "completed") -> None:
        result = await self.db.execute(
            select(NotificationDelivery).where(
                NotificationDelivery.user_id == user.id,
                NotificationDelivery.source_key.startswith(prefix),
                NotificationDelivery.status.in_(("pending", "claimed")),
            )
        )
        rows = list(result.scalars().all())
        if not rows:
            return
        for row in rows:
            row.status = "skipped"
            row.skip_reason = reason
        await self.db.commit()

    async def enqueue_for_user(self, user: User, now: datetime | None = None) -> None:
        now = now or utcnow()
        today = user_today(user, now)
        days = [today - timedelta(days=1), today, today + timedelta(days=1)]
        await self.db.refresh(user)

        if user.reminders_enabled:
            task_svc = TaskService(self.db)
            series_svc = SeriesService(self.db)
            for day in days:
                for task in await task_svc.list_for_day(user, day):
                    if task.completed_at is not None:
                        continue
                    for alert in task.alerts or []:
                        await self._enqueue_alert(
                            user,
                            now,
                            title=task.title,
                            day=task.day or day,
                            start_time=task.start_time,
                            is_all_day=task.is_all_day,
                            offset_minutes=alert.offset_minutes,
                            color=task.color,
                            notes=task.notes,
                            key_id=f"task:{task.id}",
                            task_id=str(task.id),
                            buttons=["complete", "snooze_1h", "tomorrow"],
                        )
                for occ in await series_svc.materialize_range(user, day, day):
                    if occ.completed_at is not None:
                        continue
                    for alert in occ.alerts or []:
                        buttons = ["complete", "snooze_1h", "skip"]
                        await self._enqueue_alert(
                            user,
                            now,
                            title=occ.title,
                            day=occ.day,
                            start_time=occ.start_time,
                            is_all_day=occ.is_all_day,
                            offset_minutes=alert.offset_minutes,
                            color=occ.color,
                            notes=occ.notes,
                            key_id=f"occ:{occ.series_id}:{occ.day.isoformat()}",
                            task_id=occ.id,
                            buttons=buttons,
                            occurrence_id=occ.id,
                        )

        await self._enqueue_briefing(user, now, today, "morning", user.briefing_morning_time)
        await self._enqueue_briefing(user, now, today, "evening", user.briefing_evening_time)
        if user.briefing_evening_time is None and user.overdue_enabled:
            open_tasks = await TaskService(self.db).list_open(user)
            if open_tasks:
                await self._enqueue_briefing(user, now, today, "overdue", time(18, 0))

    async def _enqueue_alert(
        self,
        user: User,
        now: datetime,
        *,
        title: str,
        day: date,
        start_time: time | None,
        is_all_day: bool,
        offset_minutes: int | None,
        color: str | None,
        notes: str | None,
        key_id: str,
        task_id: str,
        buttons: list[str],
        occurrence_id: str | None = None,
    ) -> None:
        fire_at = alert_fire_at(
            user,
            day=day,
            start_time=start_time,
            is_all_day=is_all_day,
            offset_minutes=offset_minutes,
        )
        fire_at = defer_through_quiet(user, fire_at)
        if fire_at > now + timedelta(minutes=15):
            return
        when = f"{day.isoformat()} {start_time.strftime('%H:%M') if start_time else 'all-day'}"
        payload = {
            "discord_id": user.discord_id,
            "kind": "alert",
            "embed": _embed(title, when, color, notes),
            "buttons": buttons,
            "task_id": task_id,
            "occurrence_id": occurrence_id,
        }
        status = "pending"
        skip_reason = None
        if now - fire_at > timedelta(minutes=5):
            status = "skipped"
            skip_reason = "missed"
        await self._insert(
            user,
            kind="alert",
            source_key=_source_key_alert(key_id, fire_at),
            fire_at=fire_at,
            payload=payload,
            status=status,
            skip_reason=skip_reason,
        )

    async def _enqueue_briefing(
        self,
        user: User,
        now: datetime,
        today: date,
        which: str,
        local_time: time | None,
    ) -> None:
        if local_time is None:
            return
        tz = ZoneInfo(user.timezone)
        fire_at = datetime.combine(today, local_time, tzinfo=tz).astimezone(timezone.utc)
        fire_at = defer_through_quiet(user, fire_at)
        kind = "overdue" if which == "overdue" else f"briefing_{which}"
        source_key = f"briefing:{which}:{today.isoformat()}" if which != "overdue" else f"overdue:{today.isoformat()}"
        status = "pending"
        skip_reason = None
        if user_today(user, fire_at) != today:
            status = "skipped"
            skip_reason = "missed"
        elif now - fire_at > timedelta(hours=2):
            status = "skipped"
            skip_reason = "missed"
        title = {
            "morning": "Morning briefing",
            "evening": "Evening wrap",
        }.get(which, "Leftovers")
        payload = {
            "discord_id": user.discord_id,
            "kind": kind,
            "embed": _embed(title, today.isoformat()),
            "buttons": ["ml"],
            "task_id": None,
        }
        await self._insert(
            user,
            kind=kind,
            source_key=source_key,
            fire_at=fire_at,
            payload=payload,
            status=status,
            skip_reason=skip_reason,
        )

    async def claim_due(
        self, now: datetime | None = None, limit: int | None = None
    ) -> list[NotificationDelivery]:
        now = now or utcnow()
        if limit is None:
            limit = settings.notification_claim_limit
        stale = now - timedelta(seconds=60)
        stmt = (
            select(NotificationDelivery)
            .options(selectinload(NotificationDelivery.user))
            .where(
                or_(
                    and_(
                        NotificationDelivery.status == "pending",
                        NotificationDelivery.fire_at <= now,
                    ),
                    and_(
                        NotificationDelivery.status == "claimed",
                        NotificationDelivery.claimed_at.is_not(None),
                        NotificationDelivery.claimed_at < stale,
                        NotificationDelivery.delivered_at.is_(None),
                    ),
                )
            )
            .order_by(NotificationDelivery.fire_at.asc())
            .limit(limit)
        )
        conn = await self.db.connection()
        if conn.dialect.name == "postgresql":
            stmt = stmt.with_for_update(skip_locked=True)
        result = await self.db.execute(stmt)
        rows = list(result.scalars().all())
        claimed: list[NotificationDelivery] = []
        for row in rows:
            user = row.user
            fire_at = _as_utc(row.fire_at)
            if user is not None and (in_quiet_hours(user, now) or in_quiet_hours(user, fire_at)):
                deferred = defer_through_quiet(user, fire_at if fire_at > now else now)
                if row.kind != "alert" and user_today(user, deferred) != user_today(user, fire_at):
                    row.status = "skipped"
                    row.skip_reason = "missed"
                    continue
                row.fire_at = deferred
                if deferred > now:
                    row.status = "pending"
                    row.claimed_at = None
                    continue
                fire_at = deferred
            catchup = timedelta(minutes=5) if row.kind == "alert" else timedelta(hours=2)
            if now - fire_at > catchup:
                row.status = "skipped"
                row.skip_reason = "missed"
                continue
            cas = await self.db.execute(
                update(NotificationDelivery)
                .where(
                    NotificationDelivery.id == row.id,
                    or_(
                        NotificationDelivery.status == "pending",
                        and_(
                            NotificationDelivery.status == "claimed",
                            NotificationDelivery.claimed_at.is_not(None),
                            NotificationDelivery.claimed_at < stale,
                            NotificationDelivery.delivered_at.is_(None),
                        ),
                    ),
                )
                .values(status="claimed", claimed_at=now)
            )
            if cas.rowcount != 1:
                continue
            row.status = "claimed"
            row.claimed_at = now
            claimed.append(row)
        await self.db.commit()
        for row in claimed:
            await self.db.refresh(row)
        return claimed

    async def ack(self, delivery_id: UUID, discord_message_id: str) -> NotificationDelivery:
        row = await self.db.get(NotificationDelivery, delivery_id)
        if row is None:
            raise AppError("not_found", "Delivery not found", status_code=404)
        row.status = "delivered"
        row.delivered_at = utcnow()
        row.discord_message_id = discord_message_id
        await self.db.commit()
        return row

    async def fail(self, delivery_id: UUID, reason: str) -> NotificationDelivery:
        row = await self.db.get(NotificationDelivery, delivery_id)
        if row is None:
            raise AppError("not_found", "Delivery not found", status_code=404)
        row.status = "failed"
        row.skip_reason = reason
        await self.db.commit()
        return row

    async def unclaim(self, delivery_id: UUID) -> NotificationDelivery:
        row = await self.db.get(NotificationDelivery, delivery_id)
        if row is None:
            raise AppError("not_found", "Delivery not found", status_code=404)
        row.status = "pending"
        row.claimed_at = None
        await self.db.commit()
        return row
