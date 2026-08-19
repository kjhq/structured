# AGENTS.md

## Cursor Cloud specific instructions

Monorepo with three apps (see `README.md` for the product overview):

- `backend/` — FastAPI + Postgres API (REST `/v1/*` + MCP `/mcp/mcp`). Python 3.12, managed with `uv`.
- `bot/` — Discord bot (Node + TypeScript, npm). Talks to the backend's MCP + `/v1/bot/*`.
- `widget/` — Android/Kotlin app. Not runnable in this headless VM (no Android SDK/emulator); ignore for cloud dev.

The update script already refreshes dependencies on boot (`uv sync --extra dev --project backend` and `npm install --prefix bot`). `uv` lives at `~/.local/bin/uv`. The default `node` on `PATH` is v22 (injected by the runner); Node 24 is installed via `nvm` but is not the default. The bot's `engines` asks for `>=24`, but its tests, typecheck, and `tsx` dev server all run fine on the default Node 22, so no special Node handling is needed.

### Postgres (must start it manually each boot)

Postgres 16 is installed but is **not** auto-started. Start it before running the backend against Postgres:

```bash
sudo pg_ctlcluster 16 main start
```

The `structured` role/database (password `structured`) and the app tables persist in the VM snapshot, matching `backend/.env` (`DATABASE_URL=postgresql+asyncpg://structured:structured@localhost:5432/structured`).

### Backend — create tables with `create_all`, not Alembic

For local dev, create tables using the `create_all` snippet documented in `backend/README.md` (run from `backend/` with `uv run`). Do **not** use `alembic upgrade head` on a fresh database: migration `0001` runs `create_all` (which already includes the `ck_alerts_exactly_one_owner` constraint) and `0003` then re-adds that same constraint, so the fresh-DB upgrade fails with a `DuplicateObjectError`. Alembic is intended for the Docker/production entrypoint, not fresh local dev DBs.

Run the dev server (auto-reload) from `backend/`:

```bash
uv run uvicorn structured_backend.main:app --reload --port 8000
```

Health: `GET /v1/health`, DB ping: `GET /v1/ready`, Swagger: `/docs`.

### Backend tests — the `.env` file breaks 3 tests

`cd backend && uv run pytest` uses in-memory SQLite (no Postgres needed). However, pydantic-settings reads `backend/.env` from the working directory, and the `test_bot_companion.py` tests hardcode the code-default `X-Bot-Secret: dev-bot-secret`. If `backend/.env` sets a different `BOT_API_SECRET`, those 3 tests fail with 401. Run the suite with the `.env` absent (or with `BOT_API_SECRET=dev-bot-secret`) to get a clean 66/66 pass. Lint: `uv run ruff check .` (the repo currently has pre-existing ruff findings, mostly in tests).

### Bot — validate without live credentials

`cd bot`: `npm run typecheck` and `npm test` (Node built-in runner via `tsx`) run with no backend or Discord. `npm test` mocks MCP. The `esbuild` postinstall is blocked by the environment's allow-scripts policy, but `tsx` still works, so tests/dev are unaffected.

Running the bot live (`npm run dev`) requires real secrets: `DISCORD_BOT_TOKEN`, `LLM_API_KEY`, `AUTHORIZED_USER_IDS`, and a `BOT_API_SECRET` that matches the backend. On startup the bot first probes the backend MCP endpoint (`MCP_URL`, default `http://127.0.0.1:8000/mcp/mcp`) and exits if it is unreachable, then logs into Discord. With a running backend and matching `BOT_API_SECRET` it reports `MCP ready (N tools)`; only the Discord login needs a real token.
