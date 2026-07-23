from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from structured_backend.api.router import api_router
from structured_backend.config import settings
from structured_backend.errors import AppError, app_error_handler

app = FastAPI(
    title="Structured Backend",
    version="0.1.0",
    description="Self-hosted task planner API",
)

app.add_exception_handler(AppError, app_error_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "structured-backend", "docs": "/docs"}
