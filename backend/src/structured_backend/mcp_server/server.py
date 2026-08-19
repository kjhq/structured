"""MCP adapter using FastMCP over the same domain services."""

from __future__ import annotations

import contextvars
from collections.abc import Awaitable, Callable
from datetime import date, time
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from structured_backend.config import settings
from structured_backend.db.session import SessionLocal
from structured_backend.errors import AppError
from structured_backend.mcp_server import tools as planner
from structured_backend.services import users as user_service

# Docker Compose bot uses Host: api:8000; localhost for host-side curls.
# Without this, streamable HTTP returns 421 Misdirected Request.
_mcp_transport_security = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=[
        "127.0.0.1",
        "127.0.0.1:*",
        "localhost",
        "localhost:*",
        "[::1]",
        "[::1]:*",
        "api",
        "api:*",
    ],
    allowed_origins=[
        "http://127.0.0.1",
        "http://127.0.0.1:*",
        "http://localhost",
        "http://localhost:*",
        "http://api",
        "http://api:*",
    ],
)

mcp = FastMCP(
    "structured-planner",
    instructions=(
        "Task planner for the authenticated user. Timezone comes from the user profile — "
        "do not ask for timezone. Incomplete tasks never auto-complete overnight; use "
        "open_backlog to find previously unticked dated tasks. Recurring work uses series "
        "tools (planner_create_series / list / update / delete / skip_occurrence / "
        "override_occurrence). Day views and complete support occurrence ids "
        "occ_<series>_<YYYY-MM-DD>. Prefer concise responses. Prefer day_from/day_to spans "
        "of at most 7 days."
    ),
    transport_security=_mcp_transport_security,
)

_bot_secret: contextvars.ContextVar[str | None] = contextvars.ContextVar("bot_secret", default=None)
_discord_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("discord_id", default=None)
_session_factory: contextvars.ContextVar[async_sessionmaker[AsyncSession] | None] = contextvars.ContextVar(
    "session_factory", default=None
)


def set_bot_secret(secret: str | None) -> contextvars.Token[str | None]:
    return _bot_secret.set(secret)


def set_discord_id(discord_id: str | None) -> contextvars.Token[str | None]:
    return _discord_id.set(discord_id)


def set_session_factory(factory: async_sessionmaker[AsyncSession] | None) -> None:
    _session_factory.set(factory)


def _auth_headers_from_mcp_request() -> tuple[str | None, str | None]:
    """Read bot auth from the HTTP request attached to this MCP message.

    Streamable HTTP runs tools in a session task — BaseHTTPMiddleware
    contextvars set on the ASGI request are not visible here. FastMCP does
    attach the Starlette Request to RequestContext.request.
    """
    try:
        ctx = mcp.get_context()
        req = ctx.request_context.request
    except Exception:  # noqa: BLE001
        return None, None
    if req is None:
        return None, None
    return req.headers.get("x-bot-secret"), req.headers.get("x-discord-id")


async def _session_and_user():
    secret, discord_id = _auth_headers_from_mcp_request()
    if not secret:
        secret = _bot_secret.get()
    if not discord_id:
        discord_id = _discord_id.get()
    if not settings.bot_secret_ok(secret):
        raise AppError("unauthorized", "Invalid bot secret", status_code=401)
    if not discord_id:
        raise AppError(
            "unauthorized",
            "Missing X-Discord-Id",
            status_code=401,
            hint="Bot must set Discord user id",
        )
    if not settings.is_discord_allowed(discord_id):
        raise AppError(
            "unauthorized",
            "Discord user not allowlisted",
            status_code=403,
            hint="Set AUTHORIZED_DISCORD_IDS on the backend",
        )
    factory = _session_factory.get() or SessionLocal
    session = factory()
    try:
        user = await user_service.ensure_user_for_discord(session, discord_id=discord_id)
        yield session, user
    finally:
        await session.close()


def _fmt(value: str | None) -> planner.ResponseFormat:
    if value == "detailed":
        return planner.ResponseFormat.detailed
    return planner.ResponseFormat.concise


def _error(err: Exception) -> dict[str, Any]:
    if isinstance(err, AppError):
        out: dict[str, Any] = {"error": True, "code": err.code, "message": err.message}
        if err.hint:
            out["hint"] = err.hint
        return out
    # Do not leak internal exception text to MCP clients.
    return {"error": True, "code": "internal", "message": "Internal server error"}


def _date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _time(value: str | None) -> time | None:
    return time.fromisoformat(value) if value else None


async def _run(fn: Callable[..., Awaitable[dict[str, Any]]], **kwargs: Any) -> dict[str, Any]:
    try:
        async for db, user in _session_and_user():
            return await fn(db, user, **kwargs)
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


@mcp.tool(name="planner_get_overview")
async def planner_get_overview(response_format: str = "concise", next_n: int = 5) -> dict[str, Any]:
    """Today summary, open backlog, overlaps, streaks, and settings. Prefer this before listing everything."""
    return await _run(
        planner.planner_get_overview, response_format=_fmt(response_format), next_n=next_n
    )


@mcp.tool(name="planner_find_tasks")
async def planner_find_tasks(
    q: str | None = None,
    day: str | None = None,
    day_from: str | None = None,
    day_to: str | None = None,
    open_backlog: bool = False,
    inbox: bool = False,
    response_format: str = "concise",
) -> dict[str, Any]:
    """Find tasks. Prefer day_from+day_to spans of at most 7 days. Mutually exclusive with inbox/open_backlog."""
    return await _run(
        planner.planner_find_tasks,
        q=q,
        day=_date(day),
        day_from=_date(day_from),
        day_to=_date(day_to),
        open_backlog=open_backlog,
        inbox=inbox,
        response_format=_fmt(response_format),
    )


@mcp.tool(name="planner_create_task")
async def planner_create_task(
    title: str,
    day: str | None = None,
    start_time: str | None = None,
    is_all_day: bool = False,
    notes: str | None = None,
    duration_minutes: int | None = None,
    color: str | None = None,
    symbol: str | None = None,
    alerts: list[dict[str, Any]] | None = None,
    client_request_id: str | None = None,
    response_format: str = "concise",
) -> dict[str, Any]:
    """Create inbox (omit day), all-day (day + is_all_day), or timed (day + start_time). Alerts only when the user asked to remind/ping."""
    return await _run(
        planner.planner_create_task,
        title=title,
        day=_date(day),
        start_time=_time(start_time),
        is_all_day=is_all_day,
        notes=notes,
        duration_minutes=duration_minutes,
        color=color,
        symbol=symbol,
        alerts=alerts,
        client_request_id=client_request_id,
        response_format=_fmt(response_format),
    )


@mcp.tool(name="planner_update_task")
async def planner_update_task(
    task_id: str,
    title: str | None = None,
    day: str | None = None,
    start_time: str | None = None,
    is_all_day: bool | None = None,
    notes: str | None = None,
    duration_minutes: int | None = None,
    color: str | None = None,
    symbol: str | None = None,
    alerts: list[dict[str, Any]] | None = None,
    response_format: str = "concise",
) -> dict[str, Any]:
    """Update a task by task_id from planner_find_tasks. alerts=[] clears reminders. Find first — never guess ids."""
    return await _run(
        planner.planner_update_task,
        task_id=task_id,
        title=title,
        day=_date(day),
        start_time=_time(start_time),
        is_all_day=is_all_day,
        notes=notes,
        duration_minutes=duration_minutes,
        color=color,
        symbol=symbol,
        alerts=alerts,
        response_format=_fmt(response_format),
    )


@mcp.tool(name="planner_complete_tasks")
async def planner_complete_tasks(
    task_ids: list[str],
    response_format: str = "concise",
) -> dict[str, Any]:
    """Mark tasks complete by task_id. Also accepts occurrence ids occ_<series-uuid>_<YYYY-MM-DD>."""
    return await _run(
        planner.planner_complete_tasks, task_ids=task_ids, response_format=_fmt(response_format)
    )


@mcp.tool(name="planner_uncomplete_tasks")
async def planner_uncomplete_tasks(
    task_ids: list[str],
    response_format: str = "concise",
) -> dict[str, Any]:
    """Uncheck tasks or occurrences. Use this for undo-complete, not restore of deletes."""
    return await _run(
        planner.planner_uncomplete_tasks, task_ids=task_ids, response_format=_fmt(response_format)
    )


@mcp.tool(name="planner_delete_tasks")
async def planner_delete_tasks(task_ids: list[str]) -> dict[str, Any]:
    """Soft-delete one-off tasks by task_id. For one recurring day use planner_skip_occurrence; for whole rule use planner_delete_series."""
    return await _run(planner.planner_delete_tasks, task_ids=task_ids)


@mcp.tool(name="planner_restore_tasks")
async def planner_restore_tasks(
    task_ids: list[str] | None = None,
    series_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Undo a soft-delete within 5 minutes. Do not recreate; restore the same id."""
    return await _run(planner.planner_restore_tasks, task_ids=task_ids, series_ids=series_ids)


@mcp.tool(name="planner_reschedule")
async def planner_reschedule(
    task_id: str | None = None,
    day: str | None = None,
    start_time: str | None = None,
    move_open_before_to_today: bool = False,
    snooze_minutes: int | None = None,
    tomorrow: bool = False,
    response_format: str = "concise",
) -> dict[str, Any]:
    """Move a one-off, snooze (minutes or tomorrow), or explicitly move open backlog to today (never automatic)."""
    return await _run(
        planner.planner_reschedule,
        task_id=task_id,
        day=_date(day),
        start_time=_time(start_time),
        move_open_before_to_today=move_open_before_to_today,
        snooze_minutes=snooze_minutes,
        tomorrow=tomorrow,
        response_format=_fmt(response_format),
    )


@mcp.tool(name="planner_list_series")
async def planner_list_series(response_format: str = "concise") -> dict[str, Any]:
    """List recurring series rules for the user."""
    return await _run(planner.planner_list_series, response_format=_fmt(response_format))


@mcp.tool(name="planner_create_series")
async def planner_create_series(
    title: str,
    freq: str,
    start_day: str,
    interval: int = 1,
    weekdays: list[int] | None = None,
    end_day: str | None = None,
    start_time: str | None = None,
    is_all_day: bool = False,
    notes: str | None = None,
    duration_minutes: int | None = None,
    color: str | None = None,
    symbol: str | None = None,
    alerts: list[dict[str, Any]] | None = None,
    client_request_id: str | None = None,
    response_format: str = "concise",
) -> dict[str, Any]:
    """Create recurring series. freq=daily|weekly|monthly|yearly. weekdays 0=Mon..6=Sun for weekly. Alerts only for remind/ping."""
    _ = client_request_id  # reserved; series rows do not store Discord idempotency keys
    return await _run(
        planner.planner_create_series,
        title=title,
        freq=freq,
        start_day=date.fromisoformat(start_day),
        interval=interval,
        weekdays=weekdays,
        end_day=_date(end_day),
        start_time=_time(start_time),
        is_all_day=is_all_day,
        notes=notes,
        duration_minutes=duration_minutes,
        color=color,
        symbol=symbol,
        alerts=alerts,
        response_format=_fmt(response_format),
    )


@mcp.tool(name="planner_update_series")
async def planner_update_series(
    series_id: str,
    title: str | None = None,
    freq: str | None = None,
    interval: int | None = None,
    weekdays: list[int] | None = None,
    end_day: str | None = None,
    start_time: str | None = None,
    is_all_day: bool | None = None,
    notes: str | None = None,
    duration_minutes: int | None = None,
    color: str | None = None,
    symbol: str | None = None,
    alerts: list[dict[str, Any]] | None = None,
    response_format: str = "concise",
) -> dict[str, Any]:
    """Update a recurring series by series_id from planner_list_series / find."""
    return await _run(
        planner.planner_update_series,
        series_id=series_id,
        title=title,
        freq=freq,
        interval=interval,
        weekdays=weekdays,
        end_day=_date(end_day),
        start_time=_time(start_time),
        is_all_day=is_all_day,
        notes=notes,
        duration_minutes=duration_minutes,
        color=color,
        symbol=symbol,
        alerts=alerts,
        response_format=_fmt(response_format),
    )


@mcp.tool(name="planner_delete_series")
async def planner_delete_series(series_id: str) -> dict[str, Any]:
    """Soft-delete an entire recurring series rule (all future occurrences)."""
    return await _run(planner.planner_delete_series, series_id=series_id)


@mcp.tool(name="planner_skip_occurrence")
async def planner_skip_occurrence(
    occurrence_id: str | None = None,
    series_id: str | None = None,
    day: str | None = None,
) -> dict[str, Any]:
    """Skip one occurrence day (hide it). Pass occurrence_id (occ_…) or series_id + day."""
    return await _run(
        planner.planner_skip_occurrence,
        occurrence_id=occurrence_id,
        series_id=series_id,
        day=_date(day),
    )


@mcp.tool(name="planner_override_occurrence")
async def planner_override_occurrence(
    occurrence_id: str | None = None,
    series_id: str | None = None,
    day: str | None = None,
    title: str | None = None,
    start_time: str | None = None,
    duration_minutes: int | None = None,
    is_all_day: bool | None = None,
) -> dict[str, Any]:
    """Change just one occurrence (this Thursday). Do not update the whole series rule."""
    return await _run(
        planner.planner_override_occurrence,
        occurrence_id=occurrence_id,
        series_id=series_id,
        day=_date(day),
        title=title,
        start_time=_time(start_time),
        duration_minutes=duration_minutes,
        is_all_day=is_all_day,
    )


@mcp.tool(name="planner_update_settings")
async def planner_update_settings(
    timezone: str | None = None,
    day_starts_at: str | None = None,
    briefing_morning_time: str | None = None,
    briefing_evening_time: str | None = None,
    quiet_hours_start: str | None = None,
    quiet_hours_end: str | None = None,
    reminders_enabled: bool | None = None,
    overdue_enabled: bool | None = None,
    guild_mode: str | None = None,
    planner_channel_id: str | None = None,
    capture_images: bool | None = None,
    capture_voice: bool | None = None,
    presence_enabled: bool | None = None,
) -> dict[str, Any]:
    """Patch user settings. Time fields are HH:MM or 'off' to clear. Empty call is a no-op."""
    return await _run(
        planner.planner_update_settings,
        timezone=timezone,
        day_starts_at=day_starts_at,
        briefing_morning_time=briefing_morning_time,
        briefing_evening_time=briefing_evening_time,
        quiet_hours_start=quiet_hours_start,
        quiet_hours_end=quiet_hours_end,
        reminders_enabled=reminders_enabled,
        overdue_enabled=overdue_enabled,
        guild_mode=guild_mode,
        planner_channel_id=planner_channel_id,
        capture_images=capture_images,
        capture_voice=capture_voice,
        presence_enabled=presence_enabled,
    )


@mcp.tool(name="planner_suggest_slots")
async def planner_suggest_slots(
    duration_minutes: int = 30,
    day: str | None = None,
    after_time: str | None = None,
    count: int = 5,
) -> dict[str, Any]:
    """Propose free clock slots in 07:00–21:00. Do not schedule until the user confirms."""
    return await _run(
        planner.planner_suggest_slots,
        duration_minutes=duration_minutes,
        day=_date(day),
        after_time=_time(after_time),
        count=count,
    )


@mcp.tool(name="planner_toggle_note_item")
async def planner_toggle_note_item(
    task_id: str,
    item_text: str,
    checked: bool,
) -> dict[str, Any]:
    """Toggle a '- [ ]' / '- [x]' line in one-off task notes. Does not complete the parent task. occ_* rejected."""
    return await _run(
        planner.planner_toggle_note_item,
        task_id=task_id,
        item_text=item_text,
        checked=checked,
    )
