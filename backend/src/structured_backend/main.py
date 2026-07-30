from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from structured_backend.api.router import api_router
from structured_backend.config import settings
from structured_backend.errors import AppError, app_error_handler
from structured_backend.mcp_server.server import mcp, set_bot_secret, set_discord_id


class BotAuthASGIMiddleware:
    """Pure ASGI middleware so contextvars reach handlers (unlike BaseHTTPMiddleware).

    MCP tool auth still prefers headers on RequestContext.request — see
    `_auth_headers_from_mcp_request` — because tools run in a session task.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {
            k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])
        }
        set_bot_secret(headers.get("x-bot-secret"))
        set_discord_id(headers.get("x-discord-id"))
        try:
            await self.app(scope, receive, send)
        finally:
            set_bot_secret(None)
            set_discord_id(None)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.enable_mcp:
        async with mcp.session_manager.run():
            yield
    else:
        yield


def create_app(*, enable_mcp: bool | None = None) -> FastAPI:
    mount_mcp = settings.enable_mcp if enable_mcp is None else enable_mcp
    app = FastAPI(
        title="Structured Backend",
        version="0.1.0",
        description="Self-hosted task planner API",
        lifespan=lifespan if mount_mcp else None,
    )
    app.add_exception_handler(AppError, app_error_handler)
    # Never pair Access-Control-Allow-Origin: * with credentials.
    star_cors = "*" in settings.cors_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if star_cors else settings.cors_origins,
        allow_credentials=not star_cors,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(BotAuthASGIMiddleware)
    app.include_router(api_router)

    if mount_mcp:
        app.mount("/mcp", mcp.streamable_http_app())

    @app.get("/")
    async def root() -> dict[str, str]:
        out = {
            "service": "structured-backend",
            "docs": "/docs",
        }
        if mount_mcp:
            out["mcp"] = "/mcp/mcp"
        return out

    return app


app = create_app()
