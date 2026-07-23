# Structured Backend Design

**Date:** 2026-07-23  
**Status:** Draft for review  
**Scope:** Self-hosted task planner API that replaces Structured.app MCP for Discord bot + Android widget, with a product-shaped multi-user core.

## Goal

Own the data and API. Stop hitting `mcp.structured.app`. Keep bot + widget working, then make the backend better than Structured where it hurts: reliability, incomplete-task semantics, timezone, and agent-friendly tools.

## Decisions locked

| Topic | Choice |
|---|---|
| Audience | Multi-user now; product/public later |
| Incomplete overnight | Stay on original day; never auto-complete; never auto-roll |
| Client interfaces | REST product API + thin MCP facade |
| Auth (v1) | Per-user API keys; real login later |
| Architecture | Modular FastAPI monolith + Postgres |

## Pain points addressed

From current bot/widget usage against Structured MCP:

1. **Silent completion** — Incomplete tasks (especially all-day) must not become complete overnight. Completion only via explicit complete/uncomplete.
2. **Open backlog** — First-class query for previously unticked work (`day < today` in user TZ, still incomplete).
3. **Timezone guessing** — User timezone stored in DB; agents do not pass timezone on every call.
4. **OAuth / MCP session flakiness** — Stateless HTTP + API keys; no Structured OAuth token files; no sticky MCP session dance.
5. **Fat opaque payloads** — Concise defaults, pagination/filters, actionable errors; no 12k truncation hacks as the primary strategy.
6. **Recurring stub** — Real series + occurrence exceptions so the widget can show recurring work.
7. **Find-by-guess** — Search + small overview tools so the agent does not list everything to find an id.

## Architecture

One FastAPI process, three layers:

```
bot (MCP or REST tools) ─┐
widget (REST) ───────────┼─► adapters ─► domain services ─► Postgres
Cursor / other agents ───┘   (REST /v1 + MCP /mcp)
```

| Piece | Responsibility |
|---|---|
| Domain services | Tasks, recurrence, open backlog, users/timezone, search — only place business rules live |
| REST adapter | Product API for widget and apps; stable JSON; ETags |
| MCP adapter | Thin agent tools over the same services; no second business path |
| Auth | `X-API-Key` → user; JWT/OAuth can land later without rewriting ownership |

### Hard rules

- Completion only via explicit complete/uncomplete — never on day rollover.
- Incomplete tasks keep their original `day`; open backlog is a query, not a rewrite.
- Timezone comes from the user record; tools omit timezone by default (optional override only).
- Mutations accept `client_request_id` / `Idempotency-Key` for safe retries.

## Data model

### Users

- `id`, `email` (nullable until real auth), `timezone` (IANA, required), `day_starts_at` (default `00:00` local), `created_at`
- API keys: `key_hash`, `user_id`, `label` (`bot` / `widget` / `cursor`), `last_used_at`, revocable

### Tasks (one-off + inbox)

- `id`, `user_id`, `title`, `notes`
- `day` nullable — `null` means inbox
- `start_time` nullable, `duration_minutes`, `is_all_day`
- `completed_at` nullable — incomplete means `null` until explicitly completed
- `color`, `symbol` / `icon`
- `client_request_id` nullable, unique per user (idempotency)
- `created_at`, `updated_at`, `deleted_at` (soft delete / undo window)

### Recurring series

- Series: rule (`daily` / `weekly` / …), interval, weekdays, time, duration, timezone snapshot
- Occurrence exceptions: `skip` or `override` for a single occurrence
- Completing one occurrence does not complete the series
- Materialize instances for a requested date range on read (v1); exceptions stored

### Open backlog (derived)

Not a table. Incomplete **dated** tasks where `day < today(user.timezone)` (respecting `day_starts_at`), or explicit filters like `before=`. Inbox (`day IS NULL`) is **not** part of open backlog — use `/inbox`. Never auto-moves `day`.

### Alerts (v1 slim)

- `task_id`, `offset_minutes`, `kind` — matches what the widget already models

## REST API (`/v1`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/me` | Current user + timezone |
| `PATCH` | `/me` | Set timezone / day boundary |
| `GET` | `/inbox` | Unscheduled tasks (`day` null) |
| `GET` | `/today` | Tasks for today in user TZ (includes recurring occurrences) |
| `GET` | `/tasks?day=` | Single day (includes recurring occurrences) |
| `GET` | `/tasks?day_from=&day_to=` | Range for week widget |
| `GET` | `/tasks/open?before=` | Previously unticked dated tasks |
| `GET` | `/tasks/search?q=` | Fuzzy title find |
| `POST` | `/tasks` | Create inbox / timed / all-day |
| `PATCH` | `/tasks/{id}` | Update |
| `POST` | `/tasks/{id}/complete` | Set `completed_at` |
| `POST` | `/tasks/{id}/uncomplete` | Clear `completed_at` |
| `DELETE` | `/tasks/{id}` | Soft delete |
| `POST` | `/tasks/batch` | Complete / move / delete many |
| `GET` | `/series` | List recurring series |
| `POST` | `/series` | Create recurring series |
| `PATCH` | `/series/{id}` | Update series rule |
| `DELETE` | `/series/{id}` | Soft-delete series |
| `POST` | `/series/{id}/exceptions` | Skip or override one occurrence |

List endpoints (`/today`, `/tasks`, `/tasks/open`, `/inbox`) support `If-None-Match` / ETag for cheap widget refresh.

Auth header: `X-API-Key: <key>`.

## MCP tools (agent adapter)

Few workflow tools, not 1:1 REST wrappers. Naming prefix `planner_`. Support `response_format: concise | detailed`.

1. `planner_get_overview` — today summary + open backlog counts + next N timed blocks  
2. `planner_find_tasks` — search / day / open / inbox filters  
3. `planner_create_task` — inbox vs scheduled; server applies user TZ  
4. `planner_update_task` — by id from find  
5. `planner_complete_tasks` — one or many ids  
6. `planner_reschedule` — move day/time; optional explicit “move open from date → today” (never automatic)

### Agent-friendly conventions

Drawn from [Anthropic — Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), [MCP tool best practices](https://github.com/anthropics/skills/blob/main/skills/mcp-builder/reference/mcp_best_practices.md), and [AWS MCP tool design](https://aws.amazon.com/blogs/machine-learning/mcp-tool-design-practical-approaches-and-tradeoffs/):

- Prefer a small set of high-impact tools over endpoint wrappers
- Concise responses by default; detailed on demand; paginate/filter large lists
- Enums + defaults in schemas; unambiguous parameter names (`task_id` not `id` alone when ambiguous)
- Descriptions include when to use and when not to use
- Errors are actionable English so the model can self-correct (`isError: true` for tool execution failures)
- Prefer human-readable fields in concise mode; include technical ids in detailed mode

## Reliability

- Stateless HTTP; no sticky MCP sessions
- Postgres is the single source of truth; MCP and REST share services
- Idempotency on creates and batch mutations
- Soft delete + short undo window (default 5 minutes) before hard purge
- Health: `/v1/health` (process) + `/v1/ready` (DB)
- Widget uses ETag / `updated_at` for cheap refresh
- Bot timeouts return a clear retryable signal

## Error shape

REST:

```json
{
  "code": "validation_error",
  "message": "Timed task needs day and start_time",
  "hint": "Set is_all_day=true, or omit day for inbox",
  "fields": { "start_time": "required when not all-day and day is set" }
}
```

MCP: same message text inside a tool result with `isError: true`.

Never silent complete. Never silent day rewrite.

## Testing

- Unit: open-backlog rules, timezone day boundaries (`day_starts_at`), idempotency keys
- API: create task → leave incomplete across mocked midnight → still incomplete and listed under `/tasks/open`
- Later: small agent eval fixtures for find / create / complete / open-backlog

## Deploy (v1)

- Docker Compose: `api` + `postgres` on `general` (or another always-on host you choose at ship time)
- Bot and widget configured with base URL + per-user API keys
- Admin/CLI to create users and issue keys until real auth exists

## Out of scope (v1)

- **Subtasks / checklists** — Structured MCP examples use them; v1 uses `notes` only. First-class subtasks (independently completable children) are a follow-up
- Task duplicate helper (can copy via create from find for now)
- Full Structured import/migration tooling (can be a follow-up)
- Social OAuth / email-password login UI
- Multi-device sync protocol beyond REST + ETags
- Sharing / teams / public feeds
- Focus timer / Live Activity / calendar import (Structured app chrome)
- Splitting MCP into a separate deployable (revisit only if load requires it)

## Migration plan (clients)

1. Implement backend domain + REST to parity with current bot/widget needs  
2. Point widget `McpClient` → REST client  
3. Replace bot `mcp.ts` Structured transport with our MCP URL (or REST tool bridge)  
4. Delete Structured OAuth setup (`structured_token.json`, publishable key, setup-auth against Structured)  
5. Keep sample/local fixtures for offline widget work  

## Success criteria

- Incomplete all-day task from yesterday still incomplete today and visible via open backlog  
- Bot can create/find/complete without passing timezone  
- Widget week/day views load without Structured MCP  
- No Structured OAuth files required to run bot or widget  
- Agent tools stay under ~6 and return concise, actionable payloads  

## Structured MCP parity check (2026-07-23)

Compared against [Structured MCP help](https://help.structured.app/en/articles/9871042), [blog examples](https://structured.app/blog/structured-mcp), and this repo’s bot/widget tool usage.

**In v1:** schedule views, create/update/complete/delete, alerts, color/icon, recurrence, batch ops, unfinished/open backlog (explicit — no silent overnight completion).

**Deferred:** subtasks/checklists (use `notes`), duplicate helper, Structured import, Focus/calendar chrome.

**Intentionally better than Structured:** no auto-complete overnight, user TZ in DB, agent-friendly condensed tools, API-key reliability (no OAuth session flakiness).

