from fastapi import APIRouter

from structured_backend.api import auth, batch, health, inbox, me, series, tasks

api_router = APIRouter(prefix="/v1")
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(me.router, tags=["me"])
api_router.include_router(inbox.router, tags=["inbox"])
api_router.include_router(series.router, prefix="/series", tags=["series"])
api_router.include_router(batch.router, prefix="/tasks", tags=["tasks"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
