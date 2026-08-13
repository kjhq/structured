# structured-bot

Discord bot for task management via **our** planner backend (MCP `/mcp` + `/v1/bot/*`).

Identity = Discord user ID. Bot proves itself with `BOT_API_SECRET`; each request scopes tools with `X-Discord-Id`.

## quick start

```bash
# backend must be running (BOT_API_SECRET set)
cd ../bot
cp .env.example .env   # fill DISCORD_*, LLM_*, AUTHORIZED_USER_IDS, BOT_API_SECRET
npm install
npm run dev
```

Then in Discord: `/link` → bot DMs Discord ID + widget token for the Android app.

Deploy order: migrate API (`alembic upgrade` 0003), then recreate the bot container with the `structured_bot_data` volume. Set `NOTIFY_POLL_MS=0` to disable reminder DMs.

## environment

| variable | required | default | description |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | yes | – | discord bot token |
| `LLM_API_KEY` | yes | – | llm provider key |
| `LLM_BASE_URL` | no | mistral | openai-compatible base |
| `LLM_MODEL` | no | mistral-medium-latest | model |
| `AUTHORIZED_USER_IDS` | yes | – | comma-separated Discord snowflakes (must also be in backend `AUTHORIZED_DISCORD_IDS`) |
| `BOT_API_SECRET` | yes | – | must match backend `BOT_API_SECRET` |
| `API_BASE_URL` | no | `http://127.0.0.1:8000` | REST base for `/v1/bot/*` |
| `TIMEZONE` | no | UTC | display / default user TZ on link |
| `MCP_URL` | no | `http://127.0.0.1:8000/mcp/mcp` | our backend MCP |
| `DATA_DIR` | no | `/app/data` | conversation history JSON |
| `NOTIFY_POLL_MS` | no | `20000` | `0` disables the reminder worker |
| `LLM_VISION_MODEL` | no | unset | image capture off unless set |
| `TRANSCRIBE_URL` | no | unset | voice capture off unless set |

## commands

- `/help` `/link` `/relink` `/timezone` `/status` `/clear`
- `/today` `/inbox` `/open` `/week` `/add` `/settings`
- Right-click a message → **Inbox this**
- DMs: any other text → LLM agent + planner tools (scoped to your Discord ID)
- Guilds: mention the bot or reply to it, then natural language

Add = calendar. Remind/ping = calendar + Discord DM. Briefings stay off until `/settings briefing`.
