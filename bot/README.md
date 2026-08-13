# structured-bot

Discord bot for task management via **our** planner backend (MCP `/mcp`).

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

## environment

| variable | required | default | description |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | yes | – | discord bot token |
| `LLM_API_KEY` | yes | – | llm provider key |
| `LLM_BASE_URL` | no | mistral | openai-compatible base |
| `LLM_MODEL` | no | mistral-medium-latest | model |
| `AUTHORIZED_USER_IDS` | yes | – | comma-separated Discord snowflakes (must also be in backend `AUTHORIZED_DISCORD_IDS`) |
| `BOT_API_SECRET` | yes | – | must match backend `BOT_API_SECRET` |
| `API_BASE_URL` | no | `http://127.0.0.1:8000` | REST base for `/v1/bot/link` |
| `TIMEZONE` | no | UTC | display / default user TZ on link |
| `MCP_URL` | no | `http://127.0.0.1:8000/mcp/mcp` | our backend MCP |

## commands

- `/help` `/link` `/relink` `/timezone` `/status` `/clear`
- DMs: any other text → LLM agent + planner tools (scoped to your Discord ID)
- Guilds: mention the bot or reply to it, then natural language
