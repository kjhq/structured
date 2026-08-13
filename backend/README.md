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
uv run uvicorn structured_backend.main:app --reload --port 8000
```

Docs: http://localhost:8000/docs  
MCP: http://localhost:8000/mcp/mcp (pass `X-Bot-Secret` + `X-Discord-Id`)

## Docker (api + postgres + proxy)

Root `docker-compose.yml` runs postgres, internal `api` (MCP enabled, not published), Caddy `proxy` on `:8003`/`:8443` (REST `/v1/*` only), and `bot` on the compose network.

Required env: `SECRET_KEY`, `BOT_API_SECRET`, `AUTHORIZED_DISCORD_IDS` (must include every bot `AUTHORIZED_USER_IDS` snowflake). Set `REQUIRE_SECURE_SECRETS=true` in prod. Empty `AUTHORIZED_DISCORD_IDS` denies all Discord identities while MCP is on.

```bash
# from repo root
export SECRET_KEY=$(openssl rand -hex 32)
export BOT_API_SECRET=$(openssl rand -hex 32)
export AUTHORIZED_DISCORD_IDS=your,discord,snowflakes
docker compose up --build -d
```

Public clients hit the proxy (`https://host:8443/v1/...`). Bot uses `http://api:8000/mcp/mcp`. Public `/mcp` is blocked by Caddy.

## Migrations (Alembic)

Entrypoint runs `alembic upgrade head` (no boot-time `create_all`).

**Existing DB created with `create_all`:** backup first, then stamp baseline and upgrade:

```bash
# backup
pg_dump -Fc "$DATABASE_URL_SYNC" > backup.dump

# inside api container / backend venv
alembic stamp 0001_users_keys
alembic upgrade head
```

**Rollback** (after backup): `alembic downgrade -1` (or target revision). Re-deploy previous image if needed.

**Fresh DB:** `alembic upgrade head` alone.

## Auth

| Client | Headers |
|---|---|
| Widget / REST | `X-Discord-Id` + `X-Widget-Token` (from Discord `/link`) |
| Bot / MCP | `X-Bot-Secret` + `X-Discord-Id` |
| Bot link | `POST /v1/bot/link/prepare` then `/activate` (legacy `/link` still works) |

## Key routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/health` | liveness |
| GET | `/v1/ready` | DB ping |
| GET | `/v1/me` | user + timezone |
| GET | `/v1/widget/snapshot` | authoritative widget payload + ETag |
| GET | `/v1/inbox` | unscheduled |
| GET | `/v1/today` | today (tasks + occurrences) |
| GET | `/v1/tasks/open` | previously unticked dated tasks |
| GET | `/v1/tasks/search?q=` | fuzzy title |
| POST | `/v1/tasks` | create |
| POST | `/v1/tasks/{id}/complete` | complete |
| POST | `/v1/tasks/batch` | batch ops (atomic) |
| CRUD | `/v1/series` | recurring |

## Hard rules

- Incomplete tasks never auto-complete overnight
- Open backlog does not move `day` unless you call reschedule explicitly
- Timezone lives on the user row
