#!/bin/sh
set -e
python - <<'PY'
import asyncio
from structured_backend.db.base import Base
from structured_backend.db.session import engine
import structured_backend.models  # noqa: F401

async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("database schema ready", flush=True)

asyncio.run(main())
PY
exec uvicorn structured_backend.main:app --host 0.0.0.0 --port 8000
