# Discord Identity Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shared `STRUCTURED_API_KEY` identity with Discord snowflake users: bot scopes by `author.id` via `X-Bot-Secret` + `X-Discord-Id`; widget auth is Discord ID + DM'd widget token; `/link`/`/relink` mints/rotates the token.

**Architecture:** One `users` row per Discord ID (UUID PK, `discord_id` unique). Widget token stored hashed. Bot is a trusted client (`BOT_API_SECRET`); Discord ID selects the user per request. Shared `tasks.user_id` FK — no physical table per Discord user.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, pytest/httpx, Discord.js bot, Android Kotlin widget, Docker Compose on `general`.

**Spec:** `docs/superpowers/specs/2026-07-23-discord-identity-auth-design.md`

## Global Constraints

- Allowlist: `AUTHORIZED_USER_IDS` comma-separated Discord snowflakes (bot only)
- Widget headers: `X-Discord-Id` + `X-Widget-Token`
- Bot headers: `X-Bot-Secret` + `X-Discord-Id` (Discord ID required for tool calls that need a user; list/initialize may omit Discord ID)
- Token prefix `wt_`; store SHA-256 hex hash only; `/relink` invalidates previous
- Auto-create user row on first bot request for an allowlisted Discord ID; widget token only via `/link`
- Legacy attach: if exactly one user with `discord_id IS NULL`, first `/link` for primary user attaches that row
- Do not mint new `sk_` keys for bot/widget; leave `api_keys` table unused
- `create_all` alone will not ALTER live Postgres — entrypoint must `ADD COLUMN IF NOT EXISTS`
- Package: `backend/src/structured_backend/`; tests: `cd backend && uv run pytest`
- Deploy via git push/pull on `general` (no scp)

## File map

| Path | Responsibility |
|---|---|
| `backend/src/structured_backend/models/user.py` | Add `discord_id`, `widget_token_hash` |
| `backend/src/structured_backend/services/users.py` | Discord ensure/link/verify helpers |
| `backend/src/structured_backend/config.py` | `bot_api_secret` |
| `backend/src/structured_backend/api/deps.py` | Widget auth + bot auth dependencies |
| `backend/src/structured_backend/api/bot_link.py` | `POST /v1/bot/link` mint token |
| `backend/src/structured_backend/main.py` | Wire router; MCP middleware headers |
| `backend/src/structured_backend/mcp_server/server.py` | Resolve user via bot secret + discord id |
| `backend/scripts/entrypoint.sh` | ALTER columns then create_all |
| `backend/tests/conftest.py` | Widget header fixtures |
| `backend/tests/test_auth.py` | Widget + bot auth + link/relink |
| `bot/src/config.ts` | `BOT_API_SECRET`, `AUTHORIZED_USER_IDS` |
| `bot/src/mcp.ts` | Bot secret + per-request Discord ID |
| `bot/src/bot.ts` | Allowlist multi, `/link`, pass discord id into prompt |
| `bot/src/agent.ts` | Accept `discordUserId`, set MCP context |
| `bot/.env.example` | New env vars |
| `widget/.../ApiCredentials.kt` | baseUrl + discordId + widgetToken |
| `widget/.../BackendClient.kt` | New headers |
| `widget/.../MainActivity.kt` + `activity_main.xml` | Three fields UI |
| `docker-compose.yml` | Pass `BOT_API_SECRET` into api + bot |

---

### Task 1: User model + Discord/token service

**Files:**
- Modify: `backend/src/structured_backend/models/user.py`
- Modify: `backend/src/structured_backend/services/users.py`
- Create: `backend/tests/test_discord_users.py`

**Interfaces:**
- Produces:
  - `generate_widget_token() -> str`  # `wt_` + urlsafe
  - `hash_widget_token(raw: str) -> str`  # sha256 hex (reuse same hash helper as API keys or alias)
  - `async def get_user_by_discord_id(db, discord_id: str) -> User | None`
  - `async def ensure_user_for_discord(db, *, discord_id: str, timezone: str = "UTC") -> User`
  - `async def link_widget_token(db, *, discord_id: str, timezone: str = "UTC") -> tuple[User, str]`  # returns raw token; attaches legacy singleton if needed
  - `async def get_user_by_discord_and_token(db, discord_id: str, raw_token: str) -> User | None`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_discord_users.py
import pytest
from structured_backend.services import users as user_service


@pytest.mark.asyncio
async def test_ensure_user_for_discord_is_idempotent(db_session):
    u1 = await user_service.ensure_user_for_discord(db_session, discord_id="111", timezone="Asia/Kolkata")
    u2 = await user_service.ensure_user_for_discord(db_session, discord_id="111", timezone="Asia/Kolkata")
    assert u1.id == u2.id
    assert u1.discord_id == "111"
    assert u1.timezone == "Asia/Kolkata"


@pytest.mark.asyncio
async def test_link_widget_token_verifies_and_relink_invalidates(db_session):
    user, raw1 = await user_service.link_widget_token(db_session, discord_id="222", timezone="UTC")
    assert raw1.startswith("wt_")
    found = await user_service.get_user_by_discord_and_token(db_session, "222", raw1)
    assert found is not None and found.id == user.id

    _, raw2 = await user_service.link_widget_token(db_session, discord_id="222", timezone="UTC")
    assert await user_service.get_user_by_discord_and_token(db_session, "222", raw1) is None
    assert await user_service.get_user_by_discord_and_token(db_session, "222", raw2) is not None


@pytest.mark.asyncio
async def test_link_attaches_single_legacy_user(db_session):
    legacy, _ = await user_service.create_user(db_session, timezone="UTC", label="legacy")
    assert legacy.discord_id is None
    linked, raw = await user_service.link_widget_token(db_session, discord_id="333", timezone="UTC")
    assert linked.id == legacy.id
    assert linked.discord_id == "333"
    assert await user_service.get_user_by_discord_and_token(db_session, "333", raw) is not None
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd backend && uv run pytest tests/test_discord_users.py -v`  
Expected: import/attribute errors for missing fields/functions

- [ ] **Step 3: Implement model + service**

Add to `User`:

```python
discord_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
widget_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
```

In `users.py`:

```python
def generate_widget_token() -> str:
    return "wt_" + secrets.token_urlsafe(32)

def hash_widget_token(raw: str) -> str:
    return hash_api_key(raw)  # same sha256

async def get_user_by_discord_id(db: AsyncSession, discord_id: str) -> User | None:
    result = await db.execute(select(User).where(User.discord_id == discord_id))
    return result.scalar_one_or_none()

async def ensure_user_for_discord(db, *, discord_id: str, timezone: str = "UTC") -> User:
    existing = await get_user_by_discord_id(db, discord_id)
    if existing:
        return existing
    user = User(discord_id=discord_id, timezone=timezone, day_starts_at=time(0, 0))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

async def link_widget_token(db, *, discord_id: str, timezone: str = "UTC") -> tuple[User, str]:
    user = await get_user_by_discord_id(db, discord_id)
    if user is None:
        # legacy attach: exactly one user with null discord_id
        result = await db.execute(select(User).where(User.discord_id.is_(None)))
        orphans = list(result.scalars().all())
        if len(orphans) == 1:
            user = orphans[0]
            user.discord_id = discord_id
        else:
            user = User(discord_id=discord_id, timezone=timezone, day_starts_at=time(0, 0))
            db.add(user)
            await db.flush()
    raw = generate_widget_token()
    user.widget_token_hash = hash_widget_token(raw)
    await db.commit()
    await db.refresh(user)
    return user, raw

async def get_user_by_discord_and_token(db, discord_id: str, raw_token: str) -> User | None:
    user = await get_user_by_discord_id(db, discord_id)
    if user is None or not user.widget_token_hash:
        return None
    if user.widget_token_hash != hash_widget_token(raw_token):
        return None
    return user
```

Keep `create_user` for now (still creates ApiKey) so old helpers compile; new tests use Discord path.

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd backend && uv run pytest tests/test_discord_users.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/structured_backend/models/user.py backend/src/structured_backend/services/users.py backend/tests/test_discord_users.py
git commit -m "feat(backend): Discord user identity and widget token hashing"
```

---

### Task 2: Widget REST auth + migrate fixtures

**Files:**
- Modify: `backend/src/structured_backend/api/deps.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_auth.py`
- Modify: all tests using `api_headers` (keep fixture name; change header contents)

**Interfaces:**
- Consumes: `get_user_by_discord_and_token`, `link_widget_token`
- Produces: `get_current_user` resolves via `X-Discord-Id` + `X-Widget-Token` (replace `X-API-Key`)

- [ ] **Step 1: Write failing auth tests**

```python
# backend/tests/test_auth.py
@pytest.mark.asyncio
async def test_me_requires_widget_auth(client):
    response = await client.get("/v1/me")
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_me_with_widget_token(client, api_headers):
    response = await client.get("/v1/me", headers=api_headers)
    assert response.status_code == 200
    assert response.json()["timezone"] == "Asia/Kolkata"

@pytest.mark.asyncio
async def test_me_rejects_bad_token(client, api_headers):
    bad = {**api_headers, "X-Widget-Token": "wt_nope"}
    response = await client.get("/v1/me", headers=bad)
    assert response.status_code == 401
```

- [ ] **Step 2: Run — expect FAIL** (still X-API-Key path or wrong headers)

Run: `cd backend && uv run pytest tests/test_auth.py -v`

- [ ] **Step 3: Implement deps + conftest**

`deps.py`:

```python
from fastapi.security import APIKeyHeader

discord_id_header = APIKeyHeader(name="X-Discord-Id", auto_error=False)
widget_token_header = APIKeyHeader(name="X-Widget-Token", auto_error=False)

async def get_current_user(
    db: DbSession,
    discord_id: str | None = Security(discord_id_header),
    token: str | None = Security(widget_token_header),
) -> User:
    if not discord_id or not token:
        raise AppError("unauthorized", "Missing Discord credentials", status_code=401,
                       hint="Pass X-Discord-Id and X-Widget-Token")
    user = await user_service.get_user_by_discord_and_token(db, discord_id, token)
    if user is None:
        raise AppError("unauthorized", "Invalid Discord ID or widget token", status_code=401)
    return user
```

`conftest.py` fixture:

```python
@pytest_asyncio.fixture
async def api_headers(db_session: AsyncSession) -> dict[str, str]:
    _user, raw = await user_service.link_widget_token(
        db_session, discord_id="999000111", timezone="Asia/Kolkata"
    )
    return {"X-Discord-Id": "999000111", "X-Widget-Token": raw}
```

Remove unused `create_user` import if unused; keep if other tests need it.

- [ ] **Step 4: Run full suite**

Run: `cd backend && uv run pytest -v`  
Expected: all PASS (task tests use `api_headers`)

- [ ] **Step 5: Commit**

```bash
git add backend/src/structured_backend/api/deps.py backend/tests/conftest.py backend/tests/test_auth.py
git commit -m "feat(backend): widget auth via Discord ID + token"
```

---

### Task 3: Bot secret auth + `/v1/bot/link` + MCP user resolution

**Files:**
- Modify: `backend/src/structured_backend/config.py`
- Create: `backend/src/structured_backend/api/bot_link.py`
- Modify: `backend/src/structured_backend/api/router.py` (include bot router)
- Modify: `backend/src/structured_backend/main.py` (middleware context for MCP)
- Modify: `backend/src/structured_backend/mcp_server/server.py`
- Modify: `backend/tests/test_auth.py` (add bot link + MCP scoping tests)
- Modify: `backend/tests/test_mcp_tools.py` (headers)

**Interfaces:**
- Produces:
  - Settings field `bot_api_secret: str = "dev-bot-secret"`
  - `POST /v1/bot/link` body `{"discord_id": "..."}` → `{"discord_id", "widget_token", "user_id"}`  
    Auth: `X-Bot-Secret` only
  - MCP middleware reads `X-Bot-Secret` + optional `X-Discord-Id`; tool handlers `ensure_user_for_discord` when Discord ID present
- Consumes: `link_widget_token`, `ensure_user_for_discord`

- [ ] **Step 1: Write failing tests**

```python
@pytest.mark.asyncio
async def test_bot_link_requires_secret(client):
    r = await client.post("/v1/bot/link", json={"discord_id": "555"})
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_bot_link_returns_token(client, monkeypatch):
    from structured_backend.config import settings
    monkeypatch.setattr(settings, "bot_api_secret", "test-bot-secret")
    r = await client.post(
        "/v1/bot/link",
        json={"discord_id": "555"},
        headers={"X-Bot-Secret": "test-bot-secret"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["discord_id"] == "555"
    assert body["widget_token"].startswith("wt_")

    me = await client.get(
        "/v1/me",
        headers={"X-Discord-Id": "555", "X-Widget-Token": body["widget_token"]},
    )
    assert me.status_code == 200
```

Update MCP tests to send `X-Bot-Secret` + `X-Discord-Id` instead of `X-API-Key` (read `tests/test_mcp_tools.py` and mirror fixture).

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && uv run pytest tests/test_auth.py tests/test_mcp_tools.py -v`

- [ ] **Step 3: Implement**

`config.py`: add `bot_api_secret: str = "dev-bot-secret"`

`bot_link.py`:

```python
from fastapi import APIRouter, Header
from pydantic import BaseModel
from structured_backend.api.deps import DbSession
from structured_backend.config import settings
from structured_backend.errors import AppError
from structured_backend.services import users as user_service

router = APIRouter(prefix="/v1/bot", tags=["bot"])

class LinkBody(BaseModel):
    discord_id: str
    timezone: str | None = None

@router.post("/link")
async def bot_link(
    body: LinkBody,
    db: DbSession,
    x_bot_secret: str | None = Header(default=None, alias="X-Bot-Secret"),
):
    if not x_bot_secret or x_bot_secret != settings.bot_api_secret:
        raise AppError("unauthorized", "Invalid bot secret", status_code=401)
    user, raw = await user_service.link_widget_token(
        db, discord_id=body.discord_id, timezone=body.timezone or "UTC"
    )
    return {"discord_id": user.discord_id, "widget_token": raw, "user_id": str(user.id)}
```

Include router in `api/router.py`.

MCP context in `main.py` middleware — replace API key with:

```python
set_bot_secret(request.headers.get("x-bot-secret"))
set_discord_id(request.headers.get("x-discord-id"))
```

In `mcp_server/server.py` `_session_and_user`:

```python
secret = _bot_secret.get()
discord_id = _discord_id.get()
if not secret or secret != settings.bot_api_secret:
    raise AppError("unauthorized", "Invalid bot secret", status_code=401)
if not discord_id:
    raise AppError("unauthorized", "Missing X-Discord-Id", status_code=401, hint="Bot must set Discord user id")
user = await user_service.ensure_user_for_discord(session, discord_id=discord_id)
```

Note: ListTools at connect time may hit tools without Discord ID — if FastMCP list_tools goes through same path and fails, either (a) allow missing Discord ID only when no tool mutation runs (list_tools doesn't call `_session_and_user`), or (b) bot connects with a placeholder. Prefer (a): only `_session_and_user` requires Discord ID; initialize/list_tools do not call it.

- [ ] **Step 4: Run full backend tests**

Run: `cd backend && uv run pytest -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/structured_backend/config.py backend/src/structured_backend/api/bot_link.py backend/src/structured_backend/api/router.py backend/src/structured_backend/main.py backend/src/structured_backend/mcp_server/server.py backend/tests/
git commit -m "feat(backend): bot secret auth, /v1/bot/link, MCP Discord scoping"
```

---

### Task 4: Schema entrypoint ALTER for live Postgres

**Files:**
- Modify: `backend/scripts/entrypoint.sh`
- Modify: `docker-compose.yml` (pass `BOT_API_SECRET` to api)

- [ ] **Step 1: Update entrypoint**

Before `create_all`, run:

```python
await conn.execute(text("""
ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS widget_token_hash VARCHAR(64);
"""))
# unique index if not exists
await conn.execute(text("""
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_discord_id ON users (discord_id);
"""))
```

Import `text` from SQLAlchemy. Keep `create_all` after.

- [ ] **Step 2: Compose env for api**

```yaml
environment:
  DATABASE_URL: ...
  SECRET_KEY: ${SECRET_KEY:-change-me-in-production}
  BOT_API_SECRET: ${BOT_API_SECRET:-change-me-bot-secret}
  CORS_ORIGINS: '["*"]'
```

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/entrypoint.sh docker-compose.yml
git commit -m "chore: migrate users Discord columns on API boot"
```

---

### Task 5: Discord bot — config, MCP headers, allowlist, `/link`

**Files:**
- Modify: `bot/src/config.ts`
- Modify: `bot/src/mcp.ts`
- Modify: `bot/src/agent.ts`
- Modify: `bot/src/bot.ts`
- Modify: `bot/.env.example`
- Modify: `docker-compose.yml` bot env (`BOT_API_SECRET`, `AUTHORIZED_USER_IDS`; remove `STRUCTURED_API_KEY` override if any)

**Interfaces:**
- Consumes: `POST /v1/bot/link`, MCP with bot headers
- Produces: `setMcpDiscordUserId(id: string | null)`, `prompt(channelId, query, discordUserId)`

- [ ] **Step 1: Update config schema**

```typescript
AUTHORIZED_USER_IDS: z.string().min(1), // comma-separated
BOT_API_SECRET: z.string().min(1),
// remove STRUCTURED_API_KEY
// keep AUTHORIZED_USER_ID optional migration: if present alone, treat as single-id list — prefer only AUTHORIZED_USER_IDS
MCP_URL: z.string().url().default("http://127.0.0.1:8000/mcp/mcp"),
API_BASE_URL: z.string().url().default("http://127.0.0.1:8000"), // for /v1/bot/link
```

Parse allowlist:

```typescript
export function isAuthorized(userId: string): boolean {
  const ids = config.AUTHORIZED_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(userId);
}
```

- [ ] **Step 2: MCP fetch headers + Discord context**

```typescript
let currentDiscordId: string | null = null;
export function setMcpDiscordUserId(id: string | null) {
  currentDiscordId = id;
}

const fetchWithAuth: FetchLike = (url, init) => {
  const headers = new Headers(init?.headers);
  headers.set("X-Bot-Secret", config.BOT_API_SECRET);
  if (currentDiscordId) headers.set("X-Discord-Id", currentDiscordId);
  // timeout signal as today
  return fetch(url, { ...init, headers, signal });
};
```

- [ ] **Step 3: Thread discord id through prompt**

`prompt(channelId, query, discordUserId: string)`:
- `setMcpDiscordUserId(discordUserId)` at start
- `finally { setMcpDiscordUserId(null) }`
- `handlePrompt` / `handleMessage` pass `message.author.id`
- Slash-driven prompts (if any) pass `interaction.user.id`

- [ ] **Step 4: `/link` and `/relink` commands**

Register both slash commands. Handler:

```typescript
async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const res = await fetch(`${config.API_BASE_URL}/v1/bot/link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bot-Secret": config.BOT_API_SECRET,
    },
    body: JSON.stringify({
      discord_id: interaction.user.id,
      timezone: config.TIMEZONE,
    }),
  });
  if (!res.ok) {
    await interaction.editReply(`Link failed (${res.status}).`);
    return;
  }
  const body = await res.json() as { discord_id: string; widget_token: string };
  const dmText =
    `Structured widget credentials:\n` +
    `Discord ID: \`${body.discord_id}\`\n` +
    `Widget token: \`${body.widget_token}\`\n` +
    `Paste both into the widget with your backend URL.\n` +
    `Token was rotated — old token no longer works.`;
  try {
    await interaction.user.send(dmText);
    await interaction.editReply("Sent credentials via DM.");
  } catch {
    await interaction.editReply(
      "Could not DM you. Open DMs from server members, then run /link again. Token was still rotated — run /link after enabling DMs.",
    );
  }
}
```

**Important:** If DM fails after mint, token is already rotated — message must say run `/link` again after enabling DMs (mints again). Spec: do not print token in guild. Current ephemeral reply must NOT include token.

Update HELP_TEXT to mention `/link`.

- [ ] **Step 5: Typecheck**

Run: `cd bot && npx tsc --noEmit`  
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add bot/ docker-compose.yml
git commit -m "feat(bot): Discord identity, bot secret MCP, /link token DM"
```

---

### Task 6: Android widget — Discord ID + token

**Files:**
- Modify: `widget/app/src/main/java/com/example/structuredwidget/data/ApiCredentials.kt`
- Modify: `widget/app/src/main/java/com/example/structuredwidget/data/BackendClient.kt`
- Modify: `widget/app/src/main/java/com/example/structuredwidget/MainActivity.kt`
- Modify: `widget/app/src/main/res/layout/activity_main.xml`
- Grep/update any other `getApiKey` / `X-API-Key` usages under `widget/`

**Interfaces:**
- Produces: `save(baseUrl, discordId, widgetToken)`, getters; client sends `X-Discord-Id` + `X-Widget-Token`

- [ ] **Step 1: Update credentials store**

```kotlin
fun isConfigured(): Boolean =
    !getDiscordId().isNullOrBlank() &&
    !getWidgetToken().isNullOrBlank() &&
    !getBaseUrl().isNullOrBlank()

fun save(baseUrl: String, discordId: String, widgetToken: String) { ... }

// prefs keys: base_url, discord_id, widget_token
// clear old api_key on save/clear for cleanliness
```

- [ ] **Step 2: BackendClient headers**

```kotlin
.header("X-Discord-Id", discordId)
.header("X-Widget-Token", token)
```

- [ ] **Step 3: Layout + MainActivity**

Add EditTexts: Discord ID, Widget token (replace API key field). Hints match `/link` DM copy. Status string: “Not connected — paste URL + Discord ID + token”.

- [ ] **Step 4: Build**

Run: `cd widget && ./gradlew :app:assembleDebug`  
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
git add widget/
git commit -m "feat(widget): auth with Discord ID + widget token"
```

---

### Task 7: Docs + deploy checklist

**Files:**
- Modify: `bot/README.md`, `widget/README.md`, `backend/README.md` (auth sections only)
- Modify: `bot/.env.example`

- [ ] **Step 1: Document env**

```
# bot/.env.example
DISCORD_BOT_TOKEN=
LLM_API_KEY=
AUTHORIZED_USER_IDS=123456789012345678
BOT_API_SECRET=change-me
API_BASE_URL=http://api:8000
MCP_URL=http://api:8000/mcp/mcp
TIMEZONE=Asia/Kolkata
```

- [ ] **Step 2: Deploy notes in README (short)**

On `general`: set `BOT_API_SECRET` + `AUTHORIZED_USER_IDS` in compose/`.env`; remove `STRUCTURED_API_KEY` from `bot/.env`; `git pull && docker compose build && docker compose up -d`; Discord `/link`; paste into widget; ensure API reachable from phone.

- [ ] **Step 3: Commit**

```bash
git add bot/README.md widget/README.md backend/README.md bot/.env.example
git commit -m "docs: Discord identity auth setup"
```

---

### Task 8: Smoke on `general` (manual)

- [ ] **Step 1: Push main** (when user asks / as part of deploy)

```bash
git push origin main
```

- [ ] **Step 2: Pull + rebuild**

```bash
ssh general 'cd ~/services/structured && git pull origin main && docker compose build api bot && docker compose up -d'
```

- [ ] **Step 3: Verify**

```bash
ssh general 'cd ~/services/structured && docker compose logs bot --tail 30 && curl -sf http://127.0.0.1:8003/v1/health'
```

Expected: bot MCP ready; health ok.

- [ ] **Step 4: Discord `/link` → widget paste → create task in Discord → widget refresh shows it**

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| `discord_id` + `widget_token_hash` | Task 1 |
| Widget headers auth | Task 2 |
| Bot secret + Discord ID MCP | Task 3 |
| `/link` mint + DM | Task 5 |
| Allowlist multi | Task 5 |
| Relink invalidates | Task 1 + 5 |
| Legacy single-user attach | Task 1 |
| Auto-ensure user on bot tool use | Task 3 |
| Widget UI three fields | Task 6 |
| Live Postgres ALTER | Task 4 |
| No physical table per Discord ID | All tasks (column FK only) |
| Deploy git push/pull | Task 8 |

No TBD placeholders. Header names consistent: `X-Discord-Id`, `X-Widget-Token`, `X-Bot-Secret`.
