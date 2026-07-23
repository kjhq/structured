from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from structured_backend.api.router import api_router
from structured_backend.config import settings
from structured_backend.errors import AppError, app_error_handler
from structured_backend.mcp_server.server import mcp, set_api_key


class ApiKeyContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        set_api_key(request.headers.get("x-api-key"))
        try:
            return await call_next(request)
        finally:
            set_api_key(None)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Required for FastMCP streamable HTTP when mounted under FastAPI.
    async with mcp.session_manager.run():
        yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Structured Backend",
        version="0.1.0",
        description="Self-hosted task planner API",
        lifespan=lifespan,
    )
    app.add_exception_handler(AppError, app_error_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(ApiKeyContextMiddleware)
    app.include_router(api_router)

    app.mount("/mcp", mcp.streamable_http_app())

    @app.get("/")
    async def root() -> dict[str, str]:
        return {
            "service": "structured-backend",
            "docs": "/docs",
            "mcp": "/mcp/mcp",
        }

    return app


app = create_app()
