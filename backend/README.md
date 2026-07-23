# backend

FastAPI service — replaces `mcp.structured.app` for bot + widget.

## API surface (planned)

Mirrors what bot/widget already expect from Structured MCP tools:

| Endpoint | Replaces MCP tool |
|---|---|
| `GET /v1/inbox` | `get_inbox` |
| `GET /v1/today` | `get_today` |
| `GET /v1/tasks?day=` | `get_tasks_for_day` |
| `GET /v1/tasks?day_from=&day_to=` | `list_tasks` |
| `POST /v1/tasks` | `create_task` |
| `PATCH /v1/tasks/{id}` | `update_task` |
| `POST /v1/tasks/{id}/complete` | `complete_task` |
| `DELETE /v1/tasks/{id}` | `delete_task` |
| `POST /v1/tasks/recurring` | `create_recurring_task` |

Auth: bearer tokens (no Structured OAuth). Bot and widget each get an API key or user JWT.

## Run locally

```bash
cp .env.example .env
docker compose up -d   # postgres
uv sync
uv run alembic upgrade head
uv run uvicorn structured_backend.main:app --reload --port 8000
```

Docs at http://localhost:8000/docs

## Layout

```
backend/
├── alembic/              DB migrations
├── src/structured_backend/
│   ├── main.py           FastAPI app entry
│   ├── config.py         Settings from env
│   ├── api/              HTTP routes
│   │   ├── router.py
│   │   ├── auth.py
│   │   ├── tasks.py
│   │   └── health.py
│   ├── models/           SQLAlchemy ORM
│   │   └── task.py
│   ├── schemas/          Pydantic request/response
│   │   └── task.py
│   ├── services/         Business logic
│   │   └── tasks.py
│   └── db/
│       ├── session.py
│       └── base.py
├── tests/
├── docker-compose.yml
├── pyproject.toml
└── .env.example
```
