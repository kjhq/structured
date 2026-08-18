# Useful Discord Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the companion spec so Discord can capture, act, and ping against the same Postgres planner the widget already reads.

**Architecture:** Domain services own rules. MCP and `/v1/bot/*` are thin adapters. Bot owns Gateway, DMs, buttons, and the poll loop. Backend computes due notifications.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic; discord.js 14; existing MCP FastMCP; pytest / node:test.

**Spec:** `docs/superpowers/specs/2026-08-18-useful-discord-bot-design.md`

## Global Constraints

- Never auto-complete or auto-roll incomplete tasks
- Timezone from user row; tools omit timezone
- Discord identity: `X-Bot-Secret` + `X-Discord-Id`; widget token unchanged
- Backend never calls Discord; bot never gets a Postgres connection
- “add at 7” = no alert; “remind/ping” = alert row; briefings opt-in (NULL times)
- Reminders DM-only; closed DMs never leak into a guild
- Alert catch-up 5 minutes; briefing catch-up 2 hours; quiet hours defer
- Undo restore window 5 minutes
- `client_request_id` injected by bot, not invented by the LLM
- Python via `uv run`; bot tests via `npm test`
- Package: `backend/src/structured_backend/`; tests: `backend/tests/` and `bot/src/*.test.ts`

## File map

| Path | Responsibility |
|---|---|
| `backend/src/structured_backend/models/user.py` | Settings columns |
| `backend/src/structured_backend/models/alert.py` | Optional `series_id`; exactly one owner |
| `backend/src/structured_backend/models/notification.py` | `NotificationDelivery` |
| `backend/src/structured_backend/models/series.py` | `alerts` relationship |
| `backend/alembic/versions/0003_bot_companion.py` | Migration |
| `backend/src/structured_backend/schemas/settings.py` | Settings DTOs |
| `backend/src/structured_backend/schemas/task.py` | `TaskUpdate.alerts` |
| `backend/src/structured_backend/schemas/series.py` | Series alerts; occurrence alerts |
| `backend/src/structured_backend/services/tasks.py` | Restore, replace alerts, snooze one-off |
| `backend/src/structured_backend/services/series.py` | Upsert exception, uncomplete occ, series alerts, snooze occ |
| `backend/src/structured_backend/services/settings.py` | Validate + apply user/bot settings |
| `backend/src/structured_backend/services/schedule.py` | Overlaps, suggest_slots, streaks |
| `backend/src/structured_backend/services/notifications.py` | fire_at, quiet hours, enqueue, claim/ack/fail/unclaim |
| `backend/src/structured_backend/services/checklists.py` | Toggle `- [ ]` / `- [x]` lines |
| `backend/src/structured_backend/mcp_server/tools.py` | All planner_* expansions |
| `backend/src/structured_backend/mcp_server/server.py` | FastMCP wrappers |
| `backend/src/structured_backend/api/bot_link.py` | Keep link; share `_require_bot` via deps |
| `backend/src/structured_backend/api/bot_companion.py` | settings, views, actions, notifications |
| `backend/src/structured_backend/api/router.py` | Mount companion routes |
| `bot/src/config.ts` | DATA_DIR, NOTIFY_POLL_MS, vision/transcribe |
| `bot/src/historyFile.ts` | Persist store Map |
| `bot/src/store.ts` | Hook persist |
| `bot/src/embeds.ts` / `components.ts` / `gating.ts` / `botApi.ts` | Discord UX + REST |
| `bot/src/notifyWorker.ts` | Poll due + DM |
| `bot/src/capture.ts` | Image / voice / inbox-this |
| `bot/src/agent.ts` | Prompt + inject client_request_id + vision |
| `bot/src/bot.ts` | Slash, buttons, gating, context menu |
| `bot/src/index.ts` | Start worker |
| `docker-compose.yml` | `structured_bot_data` volume |
| `bot/Dockerfile` | Writable `/app/data` |

---

### Task 1: Schema — settings, series alerts, deliveries

**Files:** models, alembic 0003, `models/__init__.py`

**Produces:** User settings columns (defaults: reminders true, guild_mode `all`, briefings NULL). Alert CHECK exactly one of task_id/series_id. `notification_deliveries` unique `(user_id, source_key)`.

Tests: SQLite `create_all` in conftest imports new models; a user row has `guild_mode == "all"`; creating Alert with both FKs null fails.

### Task 2: Restore + uncomplete occurrence + exception upsert

**Files:** `services/tasks.py`, `services/series.py`

**Produces:**
- `TaskService.restore(user, id) -> Task` if `deleted_at` within 5 min else `AppError("undo_expired")`
- `SeriesService.restore` same
- `SeriesService.uncomplete_occurrence(user, series_id, day)`
- `add_exception` upserts same `(kind, day)`; override removes skip for that day

Tests in `backend/tests/test_companion_domain.py` with frozen `timeutil.utcnow`.

### Task 3: Alerts on create/update + occurrence alerts in views

**Produces:** MCP/REST create series+task with `alerts`; update replace-all; `_occ_to_item` copies series alerts; widget snapshot includes them.

### Task 4: Settings service

**Produces:** `get_settings(user) -> dict`, `update_settings(user, data) -> dict`. Validate IANA tz, quiet hours both-or-neither, `guild_mode=channel` requires `planner_channel_id`.

### Task 5: Schedule intelligence

**Produces:**
- `overlaps_on_day(user, db, day) -> list`
- `suggest_slots(user, db, *, duration_minutes, day, after_time, count) -> list[dict]`
- `week_streaks(user, db) -> list`

Half-open intervals; 07:00–21:00 window; week Mon–Sun.

### Task 6: NotificationService

**Produces:** `alert_fire_at`, `in_quiet_hours`, `defer_through_quiet`, `enqueue_due(db, now)`, `claim_due(db, now, limit)`, `ack`, `fail`, `unclaim`. SQLite path without `SKIP LOCKED`. Catch-up 5 min alerts / 2h briefings. `reminders_enabled=false` skips alert enqueue.

### Task 7: Snooze + checklists

**Produces:** `snooze_item(db, user, id, *, minutes=None, tomorrow=False)`; `toggle_note_item(notes, item_text, checked) -> str`.

### Task 8: MCP tools

Extend existing tools; add uncomplete, restore, override, update_settings, suggest_slots, toggle_note_item. Inject overlap warnings on create/update/reschedule. Range find via `day_from`/`day_to`. `isError` remains JSON `{error:true}` in tool body (agent already reads it).

### Task 9: Bot REST `/v1/bot/{settings,views,actions,notifications}`

Auth: secret-only for due/ack/fail/unclaim; secret+`X-Discord-Id` for the rest. Reuse `_require_bot`.

### Task 10: Bot config, history file, client_request_id inject

### Task 11: Discord gating, embeds, buttons, slash, context menu, action lock

### Task 12: Notify worker + presence

### Task 13: Capture (image/voice/inbox-this NL)

### Task 14: Agent prompt + `/help` + README + compose volume

### Task 15: Full pytest + npm test

Each task: failing tests first, then implementation, then commit.
