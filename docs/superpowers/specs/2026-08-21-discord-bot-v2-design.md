# Discord Bot v2 — DM-only personal companion

Date: 2026-08-21
Status: Approved (user sign-off in session)

## Problem

The current bot (bot.ts, 1016 lines) is flaky and carries multi-user guild
machinery that a single-user DM bot does not need:

- `/settings briefing` intermittently fails with "The application did not
  respond". Root causes: global slash commands are bulk re-registered on every
  startup (`application.commands.set()` in the ready handler), which opens a
  stale-client-cache window after every deploy; there is no ack-first
  guarantee and no interaction-level error capture.
- Views attach action buttons to only the first incomplete item
  (`slice(0, 1)`), so lists are mostly read-only.
- Briefings deliver a near-empty embed ("Morning briefing" + a date).
- Guild mode (`/settings guild`, gating.ts, `guild_mode` +
  `planner_channel_id` columns) and presence (`presence_enabled` column +
  60s activity-status poller) are dead weight for a personal DM bot.

## Decisions (user-approved)

1. **Chat-first**: natural language via LLM agent remains the primary
   interaction; slash commands are shortcuts; buttons do complete/snooze.
2. **Full silence in servers**: the bot ignores all non-DM messages. Slash
   commands still work anywhere but reply ephemerally in servers (personal
   data must not broadcast). In DMs replies are normal messages so buttons
   persist.
3. **Interactive settings panel**: `/settings` opens an ephemeral panel with
   toggle buttons and modals with HH:MM validation. The old slash subcommand
   syntax keeps working.

## Scope

### Removed

- `bot/src/gating.ts` and its tests; guild branches in message handling,
  `unauthorizedReply`, `stripBotMention`.
- `/settings guild` subcommand; `guild_mode`, `planner_channel_id`,
  `presence_enabled` from: bot settings formatting, `UserSettings` type,
  backend `User` model, `SettingsRead`/`SettingsUpdate`, settings service
  validation, MCP `planner_update_settings` params, tests.
- Presence poller (`tickPresence`) in notifyWorker.

### Reliability contract

- Every interaction handler runs inside an ack wrapper that:
  - defers automatically if the handler has not acked within ~1s;
  - catches all errors and always answers ephemerally with a short reason;
  - logs command name / customId / interaction id on failure.
- Command registration moves to `registration.ts`: fetch existing global
  commands, compare against desired JSON, call `.set()` only when different;
  log the diff. Registration happens once at startup, off the interaction
  path.

### Settings panel

Ephemeral message re-rendered after each change:

```
⚙️ Settings — Asia/Kolkata · today Fri Aug 21
Morning briefing   [07:30] [off]
Evening briefing   [21:00] [off]
Reminders          [ON]
Quiet hours        [23:00–07:00] [clear]
Image/Voice capture [on] [on]
✏️ Set times…      ← modal, validates HH:MM before PATCH
```

Buttons carry customIds under the `s2:` scheme (`s2:set:<field>[:value]`,
`s2:modal:<field>`). Modal submit validates `HH:MM` (00–23:00–59) before
PATCHing; invalid input re-opens feedback without losing state.

### Briefings with content (backend)

Briefing embeds are rendered **at send time** (in `/v1/bot/notifications/due`
for claimed rows of kind `briefing_morning|briefing_evening|overdue`) from
live data:

- morning: today's items (timed first, ≤10 lines) + inbox + open counts;
- evening: completed-today count vs remaining today + leftovers count;
- overdue: open backlog summary lines.

All briefings keep the "Move leftovers to today" button. Enqueue-time payload
keeps only kind/date; rendering happens server-side at claim time so content
is fresh.

### Views

`/today`, `/inbox`, `/open`: buttons (Complete / Snooze 1h / Tomorrow /
Skip-if-occurrence) on up to **5** incomplete items (Discord's 5-row limit),
strike-through on completion, footer with inbox·open counts. `/week` keeps
day grouping + streak footer.

### Code structure

```
bot/src/
  index.ts config.ts                  kept as-is
  registration.ts                     command defs + hash-diff registration
  messaging.ts                        ack wrapper, splitMessage, error replies
  commands/{views,add,settings,link,misc}.ts
  panels/settingsPanel.ts             panel render + modal handling
  interactions.ts                     button/modal router (s2: scheme)
  bot.ts                              thin event wiring (<200 lines)
  agent/mcp/store/queue/llm/timezone/parseWhen/userContext/historyFile
                                      kept; guild references stripped
  capture.ts                          kept; jumpNotes gains @me DM links
  notifyWorker.ts                     poll loop only (presence removed)
  embeds.ts components.ts             extended for 5-row views + panel
```

### Backend changes

- Migration `0005_drop_guild_presence`: drop `users.guild_mode`,
  `users.planner_channel_id`, `users.presence_enabled`.
- `notifications.py`: add briefing render helpers used by the due endpoint.
- `bot_companion.py`: render fresh embeds for claimed briefing rows.

## Testing

- Bot: node:test suites updated — guild-gate tests removed; new tests for
  DM-only gate, ack wrapper, registration diff, settings panel flows,
  5-row view components. `npm run typecheck && npm test` green.
- Backend: pytest updates for schema drops, settings service, MCP tool args,
  briefing embed rendering. `uv run pytest` green (with `.env` caveat per
  AGENTS.md).

## Deployment

On `general`: pg_dump backup → `git pull` → `docker compose up -d --build`
(alembic 0005 runs via entrypoint) → verify: /settings panel renders and
persists, buttons work on 5-item views, briefing dry-run (set time ~2 min
ahead), no "did not respond" on rapid invocations.

## Risks

- Column drop is destructive → pg_dump taken pre-migrate.
- Discord client command cache may need one manual refresh (Ctrl+R) after
  the hash-diff registration lands.
- Ephemeral-in-guild rule means buttons in servers live on ephemeral
  messages — supported by discord.js, but list commands are really meant
  for DMs now.
