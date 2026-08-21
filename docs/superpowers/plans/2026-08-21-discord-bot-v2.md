# Discord Bot v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Discord companion as a reliable, DM-only personal planner bot with interactive settings, 5-item actionable views, and content-rich briefings; delete all guild/presence machinery end-to-end.

**Architecture:** Keep proven core (per-user MCP sessions, LLM loop, queue, history store, capture); rewrite the Discord surface layer into focused modules (`registration`, `messaging`, `commands/*`, `panels/settingsPanel`, `interactions`) wired by a thin `bot.ts`. Backend drops guild/presence columns (migration 0005) and renders briefing embeds at send time.

**Tech Stack:** Node 24 + TypeScript + discord.js 14 + node:test/tsx (bot); FastAPI + SQLAlchemy + Alembic + pytest (backend).

## Global Constraints

- Bot is DM-only: any `MessageCreate` with `guildId` is ignored before anything else.
- In guilds, ALL slash/command replies are ephemeral; in DMs they are normal messages (buttons must persist).
- Every interaction handler runs inside `withAck()`; first ack within ~1s guaranteed.
- customId scheme: item ops keep `s1:` compat, new code emits `s2:`; panel ids `s2:p:set:<field>[:<value>]`, `s2:p:modal:<field>`, `s2:noop`; modals `s2:m:<field>`.
- Time inputs validated against `/^([01]\d|2[0-3]):[0-5]\d$/` before PATCH.
- Commands registered via fingerprint file (`DATA_DIR/commands-hash.txt`); `.set()` only on change.
- No comments in code unless essential (repo style).
- Verify: `cd bot && npm run typecheck && npm test`; backend `cd backend && uv run pytest` (run without conflicting `.env` per AGENTS.md).

---

### Task 1: Backend — drop guild/presence columns (migration 0005)

**Files:**
- Create: `backend/alembic/versions/0005_drop_guild_presence.py`
- Modify: `backend/src/structured_backend/models/user.py` (remove 3 columns)
- Modify: `backend/src/structured_backend/schemas/settings.py` (remove fields)
- Modify: `backend/src/structured_backend/services/settings.py` (remove validation)
- Modify: `backend/src/structured_backend/mcp_server/tools.py` + `server.py` (remove params from planner_update_settings)

**Interfaces:**
- Produces: `SettingsRead`/`SettingsUpdate` without `guild_mode`, `planner_channel_id`, `presence_enabled`; `planner_update_settings` without those kwargs.

- [ ] Write migration 0005 (drop 3 columns; downgrade re-adds with defaults)
- [ ] Remove columns from model, schemas, service validation (`_GUILD_MODES`, channel requirement block)
- [ ] Remove `guild_mode`/`planner_channel_id`/`presence_enabled` params from MCP tool wrappers
- [ ] Fix backend tests referencing removed fields; run `uv run pytest`
- [ ] Commit `feat(backend): drop guild_mode/planner_channel_id/presence_enabled`

### Task 2: Backend — briefing embeds rendered at send time

**Files:**
- Modify: `backend/src/structured_backend/services/notifications.py` (add `render_briefing_embed`)
- Modify: `backend/src/structured_backend/api/bot_companion.py` (render in due endpoint)

**Interfaces:**
- Produces: `async def render_briefing_embed(db, user, kind: str) -> dict` returning `{title, description, color}`; due endpoint swaps embed for kinds `briefing_morning|briefing_evening|overdue`.

- [ ] Implement renderer: morning = today's items (≤10 lines) + inbox/open counts; evening = done vs remaining; overdue = open backlog lines
- [ ] Hook into `notifications_due` after `claim_due` (keep enqueue-time embed on failure)
- [ ] Test: due endpoint returns briefing embed containing a today task title
- [ ] Commit `feat(backend): render briefing embeds at send time`

### Task 3: Bot — messaging.ts (ack wrapper + reply helpers)

**Files:**
- Create: `bot/src/messaging.ts`, `bot/src/messaging.test.ts`
- Modify later: bot.ts stops defining its own copies

**Interfaces:**
- Produces: `splitMessage(text, max?)`, `replySafe(channel, text, extras?)`, `withAck(interaction, fn)`, `labelOf(interaction)`, `dmFlags(interaction)` returning `{ flags?: MessageFlags }` (ephemeral in guilds).

- [ ] Write failing tests: withAck defers within 1s when handler stalls; withAck catches throw and replies ephemeral; splitMessage chunks >1900
- [ ] Implement module (code in plan body below)
- [ ] Green; commit `feat(bot): messaging module with ack-first wrapper`

### Task 4: Bot — registration.ts (hash-diff command sync)

**Files:**
- Create: `bot/src/registration.ts`, `bot/src/registration.test.ts`

**Interfaces:**
- Produces: `buildCommands(): RESTPostAPIApplicationCommandsJSONBody[]` (no guild subcommand), `commandsFingerprint(cmds): string`, `syncCommands(client, fingerprintPath): Promise<boolean>` (true = pushed).

- [ ] Failing tests: fingerprint stable; syncCommands skips `.set()` when hash matches; sets + writes when different
- [ ] Implement with command definitions moved out of bot.ts (settings subcommands: get/briefing/quiet/reminders only)
- [ ] Green; commit `feat(bot): fingerprint-based command registration`

### Task 5: Bot — components.ts v2 (s2 scheme, 5-row views, panel rows)

**Files:**
- Modify: `bot/src/components.ts`
- Create: `bot/src/components.test.ts`

**Interfaces:**
- Produces: `parseCustomId` returning discriminated union `{kind:"item"|"panel-set"|"panel-modal"|"noop"}`; `viewRows(items, maxRows=5)`; `settingsRows(settings)`; `parseCustomId` accepts legacy `s1:` item ids.

- [ ] Failing tests: round-trip item ids (both prefixes), panel ids, viewRows caps at 5 skipping completed, settingsRows ≤5 rows
- [ ] Implement; green; commit `feat(bot): component scheme v2 with panel rows`

### Task 6: Bot — settings panel

**Files:**
- Create: `bot/src/panels/settingsPanel.ts`, `bot/src/panels/settingsPanel.test.ts`

**Interfaces:**
- Consumes: `getSettings/patchSettings` (botApi), `settingsRows`, `dmFlags`.
- Produces: `openSettingsPanel(interaction)`, `refreshSettingsPanel(interaction)`, `applyPanelSet(field, value?, current): Record<string,unknown>`, `isValidClock(v): boolean`, `handlePanelSet(interaction, field, value?)`, `openPanelModal(interaction, field)`, `handleQuietModal(interaction)`.

- [ ] Failing tests: applyPanelSet mappings (off→null, on/off→bool, quiet_clear→both null); isValidClock rejects bad input; panel renders ≤5 rows
- [ ] Implement panel embed + rows + modal submit validation
- [ ] Green; commit `feat(bot): interactive settings panel`

### Task 7: Bot — commands modules + interactions router

**Files:**
- Create: `bot/src/commands/views.ts`, `bot/src/commands/add.ts`, `bot/src/commands/link.ts`, `bot/src/commands/misc.ts`, `bot/src/commands/settingsCmd.ts`, `bot/src/interactions.ts`

**Interfaces:**
- Consumes: Tasks 3–6 modules.
- Produces: `handleView(interaction, which)`, `handleAddSlash`, `handleLink`, `handleHelp/handleStatus/handleClear/handleTimezone`, `handleSettingsSlash` (legacy subs, no guild), `routeButton(interaction)`, `routeModal(interaction)`, `routeContextMenu(interaction)`.

- [ ] Move + upgrade handlers: views use `viewRows` (5 items) + footer counts + guild-ephemeral flags; add/link/misc largely transplanted; settings opens panel or applies legacy sub
- [ ] Router dispatches parsed customIds to item ops (complete/uncomplete/snooze/tomorrow/skip/restore/move-open) with strike-through updates
- [ ] Update `bot.integration.test.ts` mocks for new signatures; green; commit `refactor(bot): command modules and interaction router`

### Task 8: Bot — thin bot.ts, DM-only, delete gating + presence

**Files:**
- Modify: `bot/src/bot.ts` (rewrite to wiring), `bot/src/index.ts` (call syncCommands), `bot/src/notifyWorker.ts` (remove presence), `bot/src/agent.ts` (prompt line), `bot/src/capture.ts` (@me links)
- Delete: `bot/src/gating.ts`, `bot/src/gating.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `createBot()`, `registerBotHandlers(client)`, `handleMessageForTest(message)` exports preserved for tests.

- [ ] MessageCreate: `if (message.guildId) return;` then authorize → capture/inbox-this/prompt paths
- [ ] InteractionCreate routes through `withAck`; ready handler calls `syncCommands`
- [ ] Remove presence timer; strip guild refs; rewrite HELP_TEXT chat-first
- [ ] Full suite: `npm run typecheck && npm test` green; commit `refactor(bot): DM-only thin wiring, remove gating and presence`

### Task 9: Backend test sweep + full verification

- [ ] `cd backend && uv run pytest` green (66+ tests, updated)
- [ ] `cd bot && npm run typecheck && npm test` green
- [ ] Commit any stragglers

### Task 10: Deploy to general + verify

- [ ] pg_dump backup on general
- [ ] Push main; pull on general; `docker compose up -d --build` (alembic 0005 runs)
- [ ] Verify: containers healthy; `/settings` panel renders + persists; buttons on 5-item view; briefing dry-run; logs clean
