from fastapi import APIRouter

from structured_backend.api import auth, health, inbox, tasks

api_router = APIRouter(prefix="/v1")
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(inbox.router, tags=["inbox"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
