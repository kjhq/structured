# structured-bot

Discord bot for task management via **our** planner backend (MCP `/mcp` + API key).

No Structured.app OAuth. No `structured_token.json`.

## quick start

```bash
# backend must be running; create a key:
cd ../backend && uv run python scripts/create_user.py --timezone Asia/Kolkata --label bot

cd ../bot
cp .env.example .env   # fill DISCORD_*, LLM_*, STRUCTURED_API_KEY, MCP_URL
npm install
npm run dev
```

## environment

| variable | required | default | description |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | yes | – | discord bot token |
| `LLM_API_KEY` | yes | – | llm provider key |
| `LLM_BASE_URL` | no | mistral | openai-compatible base |
| `LLM_MODEL` | no | mistral-small-latest | model |
| `AUTHORIZED_USER_ID` | yes | – | discord user id |
| `TIMEZONE` | no | UTC | display / prompt timezone (server also has user TZ) |
| `MCP_URL` | no | `http://127.0.0.1:8000/mcp` | our backend MCP |
| `STRUCTURED_API_KEY` | yes | – | `sk_…` from create_user |

## commands

- `/help` `/timezone` `/status` `/clear`
- any other text → LLM agent + planner tools
