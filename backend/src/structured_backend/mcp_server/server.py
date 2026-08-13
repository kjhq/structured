"""MCP adapter using FastMCP over the same domain services."""

from __future__ import annotations

import contextvars
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
        "tools (planner_create_series / list / update / delete / skip_occurrence). "
        "Day views and complete support occurrence ids occ_<series>_<YYYY-MM-DD>. "
        "Prefer concise responses."
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


@mcp.tool(name="planner_get_overview")
async def planner_get_overview(response_format: str = "concise", next_n: int = 5) -> dict[str, Any]:
    """Today summary, open backlog count, and next timed tasks. Prefer this before listing everything."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_get_overview(
                db, user, response_format=_fmt(response_format), next_n=next_n
            )
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


@mcp.tool(name="planner_find_tasks")
async def planner_find_tasks(
    q: str | None = None,
    day: str | None = None,
    open_backlog: bool = False,
    inbox: bool = False,
    response_format: str = "concise",
) -> dict[str, Any]:
    """Find tasks by search query, day (YYYY-MM-DD), open_backlog, or inbox. Do not use for mutations."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_find_tasks(
                db,
                user,
                q=q,
                day=date.fromisoformat(day) if day else None,
                open_backlog=open_backlog,
                inbox=inbox,
                response_format=_fmt(response_format),
            )
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


@mcp.tool(name="planner_create_task")
async def planner_create_task(
    title: str,
    day: str | None = None,
    start_time: str | None = None,
    is_all_day: bool = False,
    notes: str | None = None,
    duration_minutes: int | None = None,
    response_format: str = "concise",
) -> dict[str, Any]:
    """Create inbox (omit day), all-day (day + is_all_day), or timed (day + start_time HH:MM or HH:MM:SS)."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_create_task(
                db,
                user,
                title=title,
                day=date.fromisoformat(day) if day else None,
                start_time=time.fromisoformat(start_time) if start_time else None,
                is_all_day=is_all_day,
                notes=notes,
                duration_minutes=duration_minutes,
                response_format=_fmt(response_format),
            )
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


@mcp.tool(name="planner_update_task")
async def planner_update_task(
    task_id: str,
    title: str | None = None,
    day: str | None = None,
    start_time: str | None = None,
    is_all_day: bool | None = None,
    notes: str | None = None,
    response_format: str = "concise",
) -> dict[str, Any]:
    """Update a task by task_id from planner_find_tasks. Find first — never guess ids."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_update_task(
                db,
                user,
                task_id=task_id,
                title=title,
                day=date.fromisoformat(day) if day else None,
                start_time=time.fromisoformat(start_time) if start_time else None,
                is_all_day=is_all_day,
                notes=notes,
                response_format=_fmt(response_format),
            )
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


@mcp.tool(name="planner_complete_tasks")
async def planner_complete_tasks(
    task_ids: list[str],
    response_format: str = "concise",
) -> dict[str, Any]:
    """Mark tasks complete by task_id. Also accepts occurrence ids occ_<series-uuid>_<YYYY-MM-DD>."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_complete_tasks(
                db, user, task_ids=task_ids, response_format=_fmt(response_format)
            )
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


@mcp.tool(name="planner_delete_tasks")
async def planner_delete_tasks(task_ids: list[str]) -> dict[str, Any]:
    """Soft-delete one-off tasks by task_id. For one recurring day use planner_skip_occurrence; for whole rule use planner_delete_series."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_delete_tasks(db, user, task_ids=task_ids)
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


@mcp.tool(name="planner_reschedule")
async def planner_reschedule(
    task_id: str | None = None,
    day: str | None = None,
    start_time: str | None = None,
    move_open_before_to_today: bool = False,
    response_format: str = "concise",
) -> dict[str, Any]:
    """Move a one-off task to a new day/time, or explicitly move open backlog to today (never automatic)."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_reschedule(
                db,
                user,
                task_id=task_id,
                day=date.fromisoformat(day) if day else None,
                start_time=time.fromisoformat(start_time) if start_time else None,
                move_open_before_to_today=move_open_before_to_today,
                response_format=_fmt(response_format),
            )
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


@mcp.tool(name="planner_list_series")
async def planner_list_series(response_format: str = "concise") -> dict[str, Any]:
    """List recurring series rules for the user."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_list_series(
                db, user, response_format=_fmt(response_format)
            )
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


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
    response_format: str = "concise",
) -> dict[str, Any]:
    """Create recurring series. freq=daily|weekly|monthly|yearly. weekdays 0=Mon..6=Sun for weekly."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_create_series(
                db,
                user,
                title=title,
                freq=freq,
                start_day=date.fromisoformat(start_day),
                interval=interval,
                weekdays=weekdays,
                end_day=date.fromisoformat(end_day) if end_day else None,
                start_time=time.fromisoformat(start_time) if start_time else None,
                is_all_day=is_all_day,
                notes=notes,
                duration_minutes=duration_minutes,
                response_format=_fmt(response_format),
            )
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


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
    response_format: str = "concise",
) -> dict[str, Any]:
    """Update a recurring series by series_id from planner_list_series / find."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_update_series(
                db,
                user,
                series_id=series_id,
                title=title,
                freq=freq,
                interval=interval,
                weekdays=weekdays,
                end_day=date.fromisoformat(end_day) if end_day else None,
                start_time=time.fromisoformat(start_time) if start_time else None,
                is_all_day=is_all_day,
                notes=notes,
                duration_minutes=duration_minutes,
                response_format=_fmt(response_format),
            )
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


@mcp.tool(name="planner_delete_series")
async def planner_delete_series(series_id: str) -> dict[str, Any]:
    """Soft-delete an entire recurring series rule (all future occurrences)."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_delete_series(db, user, series_id=series_id)
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}


@mcp.tool(name="planner_skip_occurrence")
async def planner_skip_occurrence(
    occurrence_id: str | None = None,
    series_id: str | None = None,
    day: str | None = None,
) -> dict[str, Any]:
    """Skip one occurrence day (hide it). Pass occurrence_id (occ_…) or series_id + day."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_skip_occurrence(
                db,
                user,
                occurrence_id=occurrence_id,
                series_id=series_id,
                day=date.fromisoformat(day) if day else None,
            )
    except Exception as err:  # noqa: BLE001
        return _error(err)
    return {"error": True, "message": "no session"}
