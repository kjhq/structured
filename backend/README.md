# backend

FastAPI service — replaces `mcp.structured.app` for bot + widget.

## Run locally

```bash
cp .env.example .env
docker compose up -d postgres
uv sync --extra dev
# tests use in-memory SQLite; for Postgres create tables:
uv run python -c "
import asyncio
from structured_backend.db.base import Base
from structured_backend.db.session import engine
from structured_backend import models  # noqa
async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
asyncio.run(main())
"
uv run python scripts/create_user.py --timezone Asia/Kolkata --label bot
uv run uvicorn structured_backend.main:app --reload --port 8000
```

Docs: http://localhost:8000/docs  
MCP: http://localhost:8000/mcp (pass `X-API-Key`)

## Docker (api + postgres)

```bash
docker compose up --build -d
```

## Auth

`X-API-Key: sk_...` from `scripts/create_user.py`

## Key routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/health` | liveness |
| GET | `/v1/ready` | DB ping |
| GET | `/v1/me` | user + timezone |
| GET | `/v1/inbox` | unscheduled |
| GET | `/v1/today` | today (tasks + occurrences) |
| GET | `/v1/tasks/open` | previously unticked dated tasks |
| GET | `/v1/tasks/search?q=` | fuzzy title |
| POST | `/v1/tasks` | create |
| POST | `/v1/tasks/{id}/complete` | complete |
| POST | `/v1/tasks/batch` | batch ops |
| CRUD | `/v1/series` | recurring |

## Hard rules

- Incomplete tasks never auto-complete overnight
- Open backlog does not move `day` unless you call reschedule explicitly
- Timezone lives on the user row
