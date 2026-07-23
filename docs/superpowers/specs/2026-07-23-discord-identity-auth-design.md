# Discord Identity Auth Design

**Date:** 2026-07-23  
**Status:** Draft for review  
**Scope:** Replace shared API-key identity with Discord user ID as the planner identity for bot + widget. Personal / allowlisted multi-user — not a public product.

## Goal

Discord messages write tasks under the messaging user’s Discord ID. Widget reads/writes that same bucket after the user pastes Discord ID + a one-time DM’d widget token. No shared `STRUCTURED_API_KEY` as “who am I.”

## Decisions locked

| Topic | Choice |
|---|---|
| Audience | Allowlisted Discord users only (`AUTHORIZED_USER_IDS`) |
| Identity | Discord snowflake ID |
| Widget auth | Discord ID + widget token (DM’d once) |
| Token lifetime | Permanent until `/relink` rotates |
| Schema | One `users` / `tasks` model; isolate by `user_id` — **not** a physical table per Discord ID |
| Bot → API | Server secret proves bot; Discord ID header selects user |
| Old `sk_` API keys | Off hot path (unused or deleted later) |

## Why this replaces the old auth

Current deploy: one env API key → one DB user; Discord ID only gates chat; widget pastes the same secret. Chat “you” and planner “you” are unrelated. New model: Discord ID is the planner user; widget proves possession of a token minted for that ID.

## Architecture

```
Discord user (allowlisted)
  │  message / slash
  ▼
structured-bot
  │  BOT_API_SECRET + X-Discord-Id: <author.id>
  ▼
FastAPI ──► users (discord_id) ──► tasks (user_id)
  ▲
  │  X-Discord-Id + X-Widget-Token
structured-widget
```

| Piece | Responsibility |
|---|---|
| Allowlist | Bot-only gate: reject non-listed Discord IDs before any planner work |
| User row | `discord_id` unique; timezone; `widget_token_hash` |
| Bot transport | MCP (or REST) with bot secret + per-request Discord ID |
| Widget transport | REST `/v1` with Discord ID + widget token |
| Domain services | Unchanged ownership rules — still `user_id` scoped |

## Data model changes

### `users`

- Keep internal UUID `id` as FK target for tasks.
- Add `discord_id` `TEXT` unique, nullable only during migration.
- Add `widget_token_hash` `TEXT` nullable until first `/link`.
- Keep `timezone`, `day_starts_at`, timestamps.
- `email` remains optional/unused.

### Tokens

- Generate high-entropy random token (e.g. `wt_` + url-safe secret).
- Store only hash (same hashing approach as current API keys).
- `/link` / `/relink` overwrites hash → previous token invalid immediately.
- Plaintext shown once via Discord DM only.

### `api_keys`

- No longer used for bot or widget identity.
- Leave table in place unused for this iteration, or drop in a follow-up — do not mint new `sk_` keys for clients.

### Tasks

- No schema change required beyond existing `user_id` FK.
- Isolation = “tasks for this Discord user,” implemented as rows under that user’s UUID — not `CREATE TABLE tasks_<discord_id>`.

## Bot behavior

### Env

| Var | Role |
|---|---|
| `AUTHORIZED_USER_IDS` | Comma-separated Discord snowflakes |
| `BOT_API_SECRET` | Shared secret with backend; bot is a trusted client |
| `MCP_URL` / API base | Unchanged endpoint shape where possible |
| `TIMEZONE` | Default timezone when creating a new user row |

Remove: `STRUCTURED_API_KEY` as user identity.

### Allowlist

On every message and slash command: if `author.id` not in allowlist → “Unauthorized.”

### `/link` and `/relink`

1. Allowlist check.
2. Ensure user row for `author.id` (create with default timezone if missing).
3. Mint token, store hash, invalidate previous.
4. DM plaintext token + Discord ID and short widget paste instructions.
5. If DM fails (closed DMs) → reply with error asking to open DMs; do not print token in guild channel.

### Planner traffic

- Resolve planner user solely from `message.author.id` / interaction user id.
- Each MCP/API call from bot includes `BOT_API_SECRET` (or `Authorization: Bearer <bot-secret>`) plus `X-Discord-Id`.
- Backend rejects bot calls missing valid secret; then loads/creates-not — load user by Discord ID (user should exist after first `/link` or auto-ensure on first allowed message — **auto-ensure user row on first allowed planner message**; token still only via `/link`).

**Clarified rule:** First allowlisted message may create the user row so tasks can be saved before `/link`. Widget cannot read until `/link` has set a token. Relink only rotates token.

## Backend auth adapters

### Widget / public REST (`/v1`)

Headers:

- `X-Discord-Id: <snowflake>`
- `X-Widget-Token: <plaintext token>`

Flow: find user by `discord_id` → verify token hash → set request user. Fail → 401.

Replace current `X-API-Key` dependency for widget traffic.

### Bot / MCP

Headers (or equivalent MCP middleware):

- `X-Bot-Secret: <BOT_API_SECRET>`
- `X-Discord-Id: <snowflake>`

Flow: validate bot secret against settings → resolve user by Discord ID → scope tools. Fail secret → 401; unknown Discord ID with no auto-create path → 401.

Do **not** accept widget token as bot auth, or bot secret as widget auth.

### Config

- `BOT_API_SECRET` in backend settings (required in prod).
- Keep host allowlist for MCP DNS-rebinding as already deployed.

## Widget behavior

Settings fields:

1. Backend URL (base, no `/v1`)
2. Discord user ID
3. Widget token

Persist locally (same prefs store as today). All `BackendClient` calls attach Discord ID + token headers. Auth failures surface as a clear settings/auth error. Remove `sk_` API key UI/copy.

Phone reachability (tunnel / public bind) is **required for use** but is a deploy concern, not part of this auth schema.

## Migration (existing `general` deploy)

1. Schema: add `discord_id`, `widget_token_hash`.
2. If exactly one legacy user with null `discord_id` and operator runs `/link` as the primary allowlisted ID: attach that legacy user to the Discord ID (preserve existing tasks). If ambiguous (0 or many legacy users): create fresh row; optional one-shot SQL to reassign `tasks.user_id`.
3. Update compose env: `AUTHORIZED_USER_IDS`, `BOT_API_SECRET`; remove bot `STRUCTURED_API_KEY`.
4. Deploy backend → bot → rebuild widget APK.
5. Operator: `/link` → paste into widget → smoke Discord create → widget refresh.

## Error handling

| Case | Behavior |
|---|---|
| Not allowlisted | Discord “Unauthorized.” |
| `/link` DM closed | Instruct to open DMs; no token in channel |
| Bad widget credentials | HTTP 401; widget shows auth error |
| Bot secret wrong / missing | API 401; Discord tools fail with clear log/message |
| User row missing for Discord ID on widget | 401 |
| User row missing on bot call | Auto-create row (no token yet) so tasks can save |

## Testing

- Backend: hash verify; widget header auth; bot secret + Discord ID scoping; relink invalidates old token.
- Bot: allowlist; `/link` DM success/failure paths (mocked Discord + API).
- Widget: credentials persistence; headers on requests.

## Non-goals

- Public signup, OAuth, email login.
- Per-Discord physical tables.
- Token expiry by time (only `/relink`).
- Exposing API publicly as part of this change (separate deploy step).

## Success criteria

1. Allowlisted Discord user creates a task via bot → task stored under their Discord-linked user.
2. Same user pastes Discord ID + token into widget → sees that task after refresh.
3. Second allowlisted Discord user has a separate task bucket.
4. Non-allowlisted Discord user cannot use bot.
5. Wrong widget token cannot read another user’s tasks.
6. `/relink` breaks old widget token until new token is pasted.
