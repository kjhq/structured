# structured

Self-hosted task planner — replaces Structured.app MCP.

```
structured/
├── backend/   FastAPI + Postgres (+ MCP /mcp)
├── bot/       Discord bot → our /mcp + API key
├── widget/    Android widget → our /v1 REST + API key
└── ios/       iOS widget → same /v1 REST + API key
```

## Backend

```bash
cd backend
docker compose up -d postgres
uv sync --extra dev
uv run python -c "
import asyncio
from structured_backend.db.base import Base
from structured_backend.db.session import engine
import structured_backend.models  # noqa
async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
asyncio.run(main())
"
uv run python scripts/create_user.py --timezone Asia/Kolkata --label bot
uv run uvicorn structured_backend.main:app --reload --port 8000
```

## Bot

```bash
cd bot
cp .env.example .env   # set STRUCTURED_API_KEY + Discord/LLM
npm install && npm run dev
```

## Widget (Android)

Paste backend URL (`http://10.0.2.2:8000` on emulator) + Discord `/link` token in the app. No Structured OAuth.

## Widget (iOS)

Open `ios/StructuredWidget.xcodeproj` on a Mac. Paste backend URL (`http://127.0.0.1:8003` on Simulator) + Discord `/link` token. See [ios/README.md](ios/README.md).

Core display logic is Foundation-only and can be tested without Xcode:

```bash
cd ios && swift test
```

## Status

- [x] Backend REST + open backlog + recurrence + MCP
- [x] Bot migrated off Structured OAuth
- [x] Widget migrated to REST
- [x] iOS WidgetKit companion
- [x] Discord companion: slash views, buttons, alerts, capture
