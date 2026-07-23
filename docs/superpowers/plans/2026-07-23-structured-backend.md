# Structured Backend v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a FastAPI + Postgres modular monolith that owns tasks (REST `/v1` + thin MCP `/mcp`), with incomplete-overnight semantics, per-user timezone, API-key auth, and agent-friendly tools — replacing Structured.app MCP for bot/widget.

**Architecture:** Domain services hold all business rules. REST and MCP are thin adapters over the same services. Postgres is source of truth. Completion never happens on day rollover; open backlog is a query.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, Pydantic v2, pytest + httpx, Docker Compose (Postgres 16), MCP Python SDK for `/mcp`.

**Spec:** `docs/superpowers/specs/2026-07-23-structured-backend-design.md`

**Out of this plan:** bot client swap, widget client swap, subtasks, OAuth login UI (separate follow-up plans).

## Global Constraints

- Never auto-complete or auto-roll incomplete tasks overnight
- Inbox = `day IS NULL`; open backlog = incomplete dated tasks with `day < today(user)` only
- Timezone from user row; agents omit timezone by default
- Auth: `X-API-Key` header → user (v1)
- Idempotency via `Idempotency-Key` header or body `client_request_id` on creates/batch
- Soft delete with 5-minute undo window before purge eligibility
- Errors: `{code, message, hint, fields?}` for REST; MCP tool results use `isError: true` + same message
- MCP tools: max ~6, prefix `planner_`, `response_format: concise|detailed`
- Package lives under `backend/src/structured_backend/`
- Tests under `backend/tests/`; run with `cd backend && uv run pytest`

## File map

| Path | Responsibility |
|---|---|
| `backend/src/structured_backend/main.py` | App factory, middleware, mount routers + MCP |
| `backend/src/structured_backend/config.py` | Settings from env |
| `backend/src/structured_backend/db/` | Engine, session, Base |
| `backend/src/structured_backend/models/` | User, ApiKey, Task, Alert, Series, SeriesException |
| `backend/src/structured_backend/schemas/` | Pydantic DTOs + error model |
| `backend/src/structured_backend/services/` | Domain: users, tasks, open_backlog, series, search |
| `backend/src/structured_backend/api/` | REST routes |
| `backend/src/structured_backend/mcp_server/` | Thin MCP tool adapter |
| `backend/src/structured_backend/errors.py` | Problem JSON exception handlers |
| `backend/src/structured_backend/timeutil.py` | User-local "today" with `day_starts_at` |
| `backend/scripts/create_user.py` | CLI: create user + print API key once |
| `backend/alembic/` | Migrations |
| `backend/tests/` | Unit + API tests |

---

### Task 1: Repo bootstrap + health/ready

**Files:**
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_health.py` (replace stub if needed)
- Modify: `backend/src/structured_backend/main.py`
- Modify: `backend/src/structured_backend/api/health.py`
- Modify: `backend/src/structured_backend/api/router.py`
- Create: `backend/src/structured_backend/errors.py`
- Modify: `backend/.gitignore` if missing venv entries (root `.gitignore` already covers)

**Interfaces:**
- Produces: `GET /v1/health` → `{"status":"ok"}`; `GET /v1/ready` → `{"status":"ready"}` when DB up (Task 2 wires real DB; for now ready can return ready without DB or skip until Task 2)
- Produces: `AppError` exception type used by later tasks

- [ ] **Step 1: Init git if missing**

```bash
cd /Users/artac/Documents/coding/ongoing/structured
git rev-parse --is-inside-work-tree || git init
```

- [ ] **Step 2: Write failing health test**

```python
# backend/tests/test_health.py
from fastapi.testclient import TestClient
from structured_backend.main import app

def test_health():
    client = TestClient(app)
    r = client.get("/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 3: Run test**

```bash
cd backend && uv sync --extra dev && uv run pytest tests/test_health.py -v
```

Expected: PASS if scaffold already works; if import fails, fix package layout until PASS.

- [ ] **Step 4: Add AppError + handler**

```python
# backend/src/structured_backend/errors.py
from fastapi import Request
from fastapi.responses import JSONResponse

class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        hint: str | None = None,
        fields: dict[str, str] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.hint = hint
        self.fields = fields

async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    body: dict = {"code": exc.code, "message": exc.message}
    if exc.hint:
        body["hint"] = exc.hint
    if exc.fields:
        body["fields"] = exc.fields
    return JSONResponse(status_code=exc.status_code, content=body)
```

Register in `main.py`: `app.add_exception_handler(AppError, app_error_handler)`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers backend/README.md backend/pyproject.toml backend/src backend/tests backend/docker-compose.yml backend/.env.example .gitignore README.md
git commit -m "$(cat <<'EOF'
chore: bootstrap structured monorepo and backend skeleton

EOF
)"
```

---

### Task 2: Users, API keys, Alembic, auth dependency

**Files:**
- Create: `backend/src/structured_backend/models/user.py`
- Create: `backend/src/structured_backend/models/api_key.py`
- Modify: `backend/src/structured_backend/models/__init__.py`
- Create: `backend/src/structured_backend/services/users.py`
- Create: `backend/src/structured_backend/api/deps.py`
- Modify: `backend/src/structured_backend/api/auth.py`
- Create: `backend/src/structured_backend/api/me.py`
- Modify: `backend/src/structured_backend/api/router.py`
- Create: `backend/alembic.ini`, `backend/alembic/env.py`, first migration
- Create: `backend/tests/test_auth.py`
- Create: `backend/scripts/create_user.py`
- Modify: `backend/tests/conftest.py` (async DB fixture or SQLite+aiosqlite for tests)

**Interfaces:**
- Produces: `User(id, email|None, timezone, day_starts_at, created_at)`
- Produces: `ApiKey(id, user_id, key_hash, label, last_used_at, revoked_at|None)`
- Produces: `async def get_current_user(x_api_key) -> User`
- Produces: `create_user(timezone, email=None) -> (User, raw_api_key)`
- Consumes: `get_db`, `settings.api_key` removed as global sole auth — prefer per-user keys; keep env `BOOTSTRAP_ADMIN_KEY` optional for first user only if needed

**Note:** Prefer `aiosqlite` + `sqlite+aiosqlite:///:memory:` in tests to avoid requiring Postgres for unit/API tests. Production stays Postgres.

- [ ] **Step 1: Add test deps**

In `pyproject.toml` add: `aiosqlite`, keep `httpx`, `pytest-asyncio`.

- [ ] **Step 2: Write failing auth test**

```python
# backend/tests/test_auth.py
import pytest
from httpx import ASGITransport, AsyncClient

@pytest.mark.asyncio
async def test_me_requires_api_key(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/v1/me")
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_me_with_key(app, api_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/v1/me", headers=api_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["timezone"] == "Asia/Kolkata"
    assert "id" in body
```

- [ ] **Step 3: Run — expect FAIL (401 always or 404)**

```bash
cd backend && uv run pytest tests/test_auth.py -v
```

- [ ] **Step 4: Implement models + hash helper + deps**

```python
# key hashing
import hashlib, secrets

def generate_api_key() -> str:
    return "sk_" + secrets.token_urlsafe(32)

def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
```

`get_current_user`: look up `hash_api_key(header)`, reject revoked, update `last_used_at`, return user.

- [ ] **Step 5: Alembic initial migration** for `users`, `api_keys`

```bash
cd backend && uv run alembic revision --autogenerate -m "users_and_api_keys"
uv run alembic upgrade head   # against docker compose postgres when integrating
```

- [ ] **Step 6: `scripts/create_user.py`**

Prints raw key once: `uv run python scripts/create_user.py --timezone Asia/Kolkata --label bot`

- [ ] **Step 7: Tests PASS + commit**

```bash
uv run pytest tests/test_auth.py tests/test_health.py -v
git add backend && git commit -m "feat(backend): users, API keys, and /v1/me"
```

---

### Task 3: Task model + create/list/inbox/today CRUD

**Files:**
- Create/replace: `backend/src/structured_backend/models/task.py`
- Create: `backend/src/structured_backend/models/alert.py`
- Create: `backend/src/structured_backend/schemas/task.py` (expand)
- Create: `backend/src/structured_backend/services/tasks.py`
- Create: `backend/src/structured_backend/timeutil.py`
- Modify: `backend/src/structured_backend/api/tasks.py`, `inbox.py`
- Create: `backend/src/structured_backend/api/today.py` (or fold into tasks)
- Create: `backend/tests/test_tasks_crud.py`
- Alembic revision: tasks + alerts

**Interfaces:**
- Produces: `TaskService.create(user, TaskCreate) -> Task`
- Produces: `TaskService.list_for_day(user, day) -> list[Task]`
- Produces: `TaskService.list_inbox(user) -> list[Task]`
- Produces: `TaskService.list_today(user, now: datetime) -> list[Task]`
- Produces: `user_today(user, now: datetime) -> date` in `timeutil.py`

Validation rules:
- Inbox: `day is None`, `start_time is None`, `is_all_day is False`
- All-day: `day` set, `is_all_day True`, `start_time` null
- Timed: `day` + `start_time` set; `duration_minutes` optional default 30
- Raise `AppError` with hint on invalid combos

- [ ] **Step 1: Failing test — create inbox + today incomplete**

```python
@pytest.mark.asyncio
async def test_create_inbox_and_list(app, api_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/v1/tasks", headers=api_headers, json={"title": "Buy milk"})
        assert r.status_code == 201
        task = r.json()
        assert task["day"] is None
        assert task["completed_at"] is None
        inbox = await c.get("/v1/inbox", headers=api_headers)
        assert any(t["id"] == task["id"] for t in inbox.json())
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement model, service, routes** (replace `NotImplementedError` stubs)

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(backend): task create, inbox, and day/today lists"
```

---

### Task 4: Open backlog + no silent completion (core pain)

**Files:**
- Create: `backend/src/structured_backend/services/open_backlog.py`
- Modify: `backend/src/structured_backend/api/tasks.py` — `GET /tasks/open`
- Create: `backend/tests/test_open_backlog.py`
- Create: `backend/tests/test_no_auto_complete.py`

**Interfaces:**
- Produces: `list_open_backlog(user, *, before: date | None, now: datetime) -> list[Task]`
  - Filter: `deleted_at IS NULL`, `completed_at IS NULL`, `day IS NOT NULL`, `day < user_today(user, now)` (or `day < before` if provided)
  - Does **not** update any rows

- [ ] **Step 1: Write failing tests**

```python
@pytest.mark.asyncio
async def test_incomplete_yesterday_still_incomplete(app, api_headers, freeze_now):
    # create all-day task on 2026-07-22 while "now" is that day
    # advance clock to 2026-07-23 10:00 Asia/Kolkata
    # GET task by id — completed_at still null
    # GET /v1/tasks/open — includes it
    # GET /v1/today — does NOT include it (still dated yesterday)
    ...

@pytest.mark.asyncio
async def test_open_excludes_inbox(app, api_headers):
    # inbox task never appears in /tasks/open
    ...
```

Use a `freeze_now` fixture that monkeypatches `timeutil.utcnow` or injects `now` via dependency override.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement open backlog service + route**

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "feat(backend): open backlog without auto-complete or auto-roll"
```

---

### Task 5: Complete / uncomplete / update / soft delete + idempotency

**Files:**
- Modify: `services/tasks.py`, `api/tasks.py`
- Create: `backend/tests/test_mutations.py`

**Interfaces:**
- `complete(task_id) -> Task` sets `completed_at = now` (idempotent if already complete)
- `uncomplete(task_id) -> Task` sets `completed_at = None`
- `update(task_id, TaskUpdate) -> Task`
- `soft_delete(task_id) -> None` sets `deleted_at`
- Create: if `client_request_id` present and exists for user, return existing task (200/201 consistent — use 200 on replay)

- [ ] **Step 1: Failing tests for complete, uncomplete, soft delete, idempotent create**

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(backend): complete, uncomplete, soft delete, idempotent create"
```

---

### Task 6: Batch ops + search + ETag

**Files:**
- Modify: `api/tasks.py`, `services/tasks.py`
- Create: `services/search.py`
- Create: `backend/tests/test_batch_search_etag.py`

**Interfaces:**
- `POST /v1/tasks/batch` body: `{ "action": "complete"|"delete"|"move", "task_ids": [...], "day"?: "YYYY-MM-DD", "start_time"?: ... }`
- `GET /v1/tasks/search?q=` — `ilike` on title, limit 50 default
- List responses set `ETag` from max(`updated_at`) + count; honor `If-None-Match` → 304

- [ ] **Step 1: Failing tests**

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(backend): batch mutations, search, and ETags"
```

---

### Task 7: Recurring series + exceptions + materialize into day views

**Files:**
- Create: `models/series.py`, `models/series_exception.py`
- Create: `schemas/series.py`
- Create: `services/series.py`
- Create: `api/series.py`
- Modify: day/today/range list services to merge materialized occurrences
- Create: `backend/tests/test_series.py`
- Alembic migration

**Interfaces:**
- Series fields: `freq` enum `daily|weekly|monthly|yearly`, `interval`, `weekdays` (list[int] 0=Mon), `start_day`, `end_day|None`, `start_time|None`, `duration_minutes`, `is_all_day`, `title`, `color`, `symbol`, `timezone` snapshot, `deleted_at`
- Exception: `series_id`, `occurrence_day`, `kind` `skip|override`, override fields nullable
- Occurrence id format for clients: `occ_{series_id}_{YYYY-MM-DD}` (stable string, not UUID row)
- Completing an occurrence creates/updates an exception or completion record for that day only — **does not** complete the series
  - Store completion as exception kind `override` with `completed_at` set, or separate `series_completions` table `(series_id, occurrence_day, completed_at)` — prefer dedicated `series_completions` for clarity

- [ ] **Step 1: Failing test — weekly series appears on matching days; skip hides one; complete occurrence leaves other days open**

- [ ] **Step 2: Implement materializer + REST `/v1/series*`**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(backend): recurring series with exceptions and day materialization"
```

---

### Task 8: MCP facade (`planner_*` tools)

**Files:**
- Create: `backend/src/structured_backend/mcp_server/server.py`
- Create: `backend/src/structured_backend/mcp_server/tools.py`
- Modify: `main.py` to mount Streamable HTTP MCP at `/mcp`
- Create: `backend/tests/test_mcp_tools.py`
- Add dep: `mcp` (official Python SDK)

**Interfaces:**
- Auth: same `X-API-Key` (or MCP auth header mapping to API key)
- Tools:
  1. `planner_get_overview`
  2. `planner_find_tasks`
  3. `planner_create_task`
  4. `planner_update_task`
  5. `planner_complete_tasks`
  6. `planner_reschedule`
- Each accepts optional `response_format: concise|detailed` (default concise)
- Concise: title, day, start, completed bool, short id
- Detailed: full task fields
- No timezone param required; read from user
- On validation failure return tool error content with actionable hint (not opaque traceback)

- [ ] **Step 1: Failing test calling tool functions directly (unit) with service mocks or test DB**

- [ ] **Step 2: Implement tools as thin wrappers over services**

- [ ] **Step 3: Mount MCP; document URL in `backend/README.md`**

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "feat(backend): MCP planner_* facade over domain services"
```

---

### Task 9: Docker API service + README polish + ready check

**Files:**
- Create: `backend/Dockerfile`
- Modify: `backend/docker-compose.yml` — add `api` service
- Modify: `backend/src/structured_backend/api/health.py` — `/ready` pings DB
- Modify: `backend/README.md`, root `README.md`
- Create: `backend/.env.example` updates (`DATABASE_URL`, no global sole API key required)

- [ ] **Step 1: `/ready` fails closed without DB**

```python
@pytest.mark.asyncio
async def test_ready_ok(app):
    ...
```

- [ ] **Step 2: Dockerfile + compose**

```yaml
api:
  build: .
  ports: ["8000:8000"]
  env_file: .env
  depends_on:
    postgres:
      condition: service_healthy
```

- [ ] **Step 3: Manual smoke**

```bash
cd backend && docker compose up --build -d
uv run python scripts/create_user.py --timezone Asia/Kolkata --label bot
curl -s -H "X-API-Key: $KEY" http://localhost:8000/v1/me
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(backend): Docker API service and ready probe"
```

---

## Follow-up plans (do not implement in this plan)

1. **Bot migration** — replace Structured MCP URL with our `/mcp` or REST tool bridge; delete `structured_token.json` OAuth flow  
2. **Widget migration** — replace `McpClient` with REST + API key; keep sample data fallback  
3. **Subtasks** — deferred per spec  

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| Modular monolith REST+MCP | 1, 8 |
| API keys multi-user | 2 |
| Task CRUD + inbox/today | 3 |
| No auto-complete; open backlog | 4 |
| Complete/uncomplete/soft delete/idempotency | 5 |
| Batch, search, ETag | 6 |
| Recurrence + exceptions | 7 |
| `planner_*` tools, concise/detailed | 8 |
| Deploy compose | 9 |
| Subtasks / OAuth / client swaps | Follow-ups |

---

## Self-review notes

- No TBD placeholders in task bodies  
- Types consistent: `completed_at` nullable datetime; open backlog never mutates `day`  
- Occurrence ids are strings `occ_{uuid}_{date}` — document in series task so bot/widget can round-trip complete  
- Test DB: SQLite memory OK if JSON/UUID quirks handled; else use Postgres testcontainer — prefer SQLite+compat for speed unless series JSON needs Postgres-specific types (use portable types)  
