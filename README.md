# structured

Self-hosted task planner — replaces Structured.app MCP.

```
structured/
├── backend/   FastAPI + Postgres (+ MCP /mcp)
├── bot/       Discord bot (migrate off Structured MCP next)
└── widget/    Android widget (migrate to REST next)
```

## Backend quick start

```bash
cd backend
docker compose up -d postgres
uv sync --extra dev
uv run uvicorn structured_backend.main:app --reload --port 8000
```

Create a user/API key:

```bash
uv run python scripts/create_user.py --timezone Asia/Kolkata --label bot
```

## Status

- [x] Backend REST + open backlog + recurrence + MCP tools
- [ ] Bot: point at our `/mcp`
- [ ] Widget: REST client
