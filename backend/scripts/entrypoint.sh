#!/bin/sh
set -e
python - <<'PY'
import asyncio
from sqlalchemy import text
from structured_backend.db.base import Base
from structured_backend.db.session import engine
import structured_backend.models  # noqa: F401

async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Live Postgres may already have users without Discord columns;
        # create_all will not ALTER existing tables.
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id VARCHAR(32)"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS widget_token_hash VARCHAR(64)"
        ))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_discord_id ON users (discord_id)"
        ))
    print("database schema ready", flush=True)

asyncio.run(main())
PY
exec uvicorn structured_backend.main:app --host 0.0.0.0 --port 8000
