# structured

Self-hosted task planner — replaces [Structured](https://structured.app) MCP with our own backend.

## Layout

```
structured/
├── backend/     FastAPI + Postgres — source of truth for tasks
├── bot/           Discord bot (LLM agent, will talk to backend instead of MCP)
└── widget/        Android home-screen Day & Week widget (will talk to backend instead of MCP)
```

## Status

- [x] Monorepo assembled from archived projects
- [ ] Backend API (tasks, inbox, auth)
- [ ] Bot: swap MCP client → backend REST client
- [ ] Widget: swap McpClient → backend REST client

## Quick start

```bash
# backend
cd backend && docker compose up -d
uv sync && uv run uvicorn structured_backend.main:app --reload

# bot
cd bot && npm install && npm run dev

# widget
cd widget && ./gradlew assembleDebug
```
