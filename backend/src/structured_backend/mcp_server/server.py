"""MCP adapter using FastMCP over the same domain services."""

from __future__ import annotations

import contextvars
from datetime import date, time
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

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
        "open_backlog to find previously unticked dated tasks. Prefer concise responses."
    ),
    transport_security=_mcp_transport_security,
)

_api_key: contextvars.ContextVar[str | None] = contextvars.ContextVar("api_key", default=None)
_session_factory: contextvars.ContextVar[async_sessionmaker[AsyncSession] | None] = contextvars.ContextVar(
    "session_factory", default=None
)


def set_api_key(key: str | None) -> None:
    _api_key.set(key)


def set_session_factory(factory: async_sessionmaker[AsyncSession] | None) -> None:
    _session_factory.set(factory)


async def _session_and_user():
    key = _api_key.get()
    if not key:
        raise AppError("unauthorized", "Missing API key", status_code=401, hint="Pass X-API-Key")
    factory = _session_factory.get() or SessionLocal
    session = factory()
    try:
        user = await user_service.get_user_by_api_key(session, key)
        if user is None:
            raise AppError("unauthorized", "Invalid API key", status_code=401)
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
    return {"error": True, "code": "internal", "message": str(err)}


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
    """Mark one or more tasks complete by task_id. Does not change day."""
    try:
        async for db, user in _session_and_user():
            return await planner.planner_complete_tasks(
                db, user, task_ids=task_ids, response_format=_fmt(response_format)
            )
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
    """Move a task to a new day/time, or explicitly move open backlog to today (never automatic)."""
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
