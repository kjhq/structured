from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi.security import APIKeyHeader

from structured_backend.config import settings

router = APIRouter()
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def require_api_key(key: str | None = Security(api_key_header)) -> str:
    if not key or key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return key


@router.get("/verify")
async def verify_key(_: str = Depends(require_api_key)) -> dict[str, bool]:
    return {"valid": True}
