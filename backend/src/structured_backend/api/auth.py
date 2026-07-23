from fastapi import APIRouter

from structured_backend.api.deps import CurrentUser

router = APIRouter()


@router.get("/verify")
async def verify_key(_: CurrentUser) -> dict[str, bool]:
    return {"valid": True}
