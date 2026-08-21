import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { itemId, type PlannerItem } from "./embeds.js";
import type { UserSettings } from "./botApi.js";

export type ButtonOp = "c" | "u" | "z" | "t" | "k" | "r" | "ml";

const OPS = new Set<string>(["c", "u", "z", "t", "k", "r", "ml"]);

export type PanelField =
  | "briefing_morning"
  | "briefing_evening"
  | "reminders"
  | "quiet_clear"
  | "capture_images"
  | "capture_voice";

const PANEL_FIELDS = new Set<string>([
  "briefing_morning",
  "briefing_evening",
  "reminders",
  "quiet_clear",
  "capture_images",
  "capture_voice",
]);

export type ParsedCustomId =
  | { kind: "item"; op: ButtonOp; id?: string }
  | { kind: "panel-set"; field: PanelField; value?: string }
  | { kind: "panel-modal"; field: PanelField }
  | { kind: "noop" };

/** Accepts both the legacy s1: item scheme and the v2 s2: scheme. */
export function parseCustomId(customId: string): ParsedCustomId | null {
  if (customId === "s1:noop" || customId === "s2:noop") return { kind: "noop" };
  const parts = customId.split(":");
  if (parts[0] === "s1" || (parts[0] === "s2" && parts[1] !== "p")) {
    const op = parts[0] === "s1" ? parts[1] : parts[1];
    if (!op || !OPS.has(op)) return null;
    const id = parts.slice(2).join(":") || undefined;
    return { kind: "item", op: op as ButtonOp, id };
  }
  if (parts[0] === "s2" && parts[1] === "p") {
    const action = parts[2];
    if (action === "set") {
      const field = parts[3];
      if (!field || !PANEL_FIELDS.has(field)) return null;
      return { kind: "panel-set", field: field as PanelField, value: parts[4] };
    }
    if (action === "modal") {
      const field = parts[3];
      if (!field || !PANEL_FIELDS.has(field)) return null;
      return { kind: "panel-modal", field: field as PanelField };
    }
  }
  return null;
}

export function customId(op: ButtonOp, id?: string): string {
  if (!id) return `s2:${op}`;
  return `s2:${op}:${id}`;
}

export function panelSetId(field: PanelField, value?: string): string {
  return value ? `s2:p:set:${field}:${value}` : `s2:p:set:${field}`;
}

export function panelModalId(field: PanelField): string {
  return `s2:p:modal:${field}`;
}

export function noopId(): string {
  return "s2:noop";
}

function button(
  id: string,
  label: string,
  style: ButtonStyle,
): ButtonBuilder {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

export function itemActionRow(
  id: string,
  opts: { occurrence?: boolean; completed?: boolean } = {},
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (opts.completed) {
    row.addComponents(button(customId("u", id), "Undo", ButtonStyle.Secondary));
    return row;
  }
  row.addComponents(
    button(customId("c", id), "Complete", ButtonStyle.Success),
    button(customId("z", id), "Snooze 1h", ButtonStyle.Secondary),
    button(customId("t", id), "Tomorrow", ButtonStyle.Secondary),
  );
  if (opts.occurrence) {
    row.addComponents(button(customId("k", id), "Skip", ButtonStyle.Secondary));
  }
  return row;
}

export function restoreRow(id: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(customId("r", id), "Undo", ButtonStyle.Danger),
  );
}

export function briefingRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(customId("ml"), "Move leftovers to today", ButtonStyle.Primary),
  );
}

/** One action row per incomplete item, capped at Discord's five-row limit. */
export function viewRows(
  items: PlannerItem[],
  maxRows = 5,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (const item of items) {
    if (rows.length >= maxRows) break;
    if (item.completed_at) continue;
    const id = itemId(item);
    if (!id) continue;
    rows.push(itemActionRow(id, { occurrence: Boolean(item.is_occurrence || id.startsWith("occ_")) }));
  }
  return rows;
}

function clockLabel(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 5);
}

export function settingsRows(s: UserSettings): ActionRowBuilder<ButtonBuilder>[] {  const morningOn = Boolean(s.briefing_morning_time);
  const eveningOn = Boolean(s.briefing_evening_time);
  const quietOn = Boolean(s.quiet_hours_start && s.quiet_hours_end);

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(panelModalId("briefing_morning"), `Morning ${morningOn ? clockLabel(s.briefing_morning_time) : "off"} ✏️`, ButtonStyle.Primary),
    button(panelSetId("briefing_morning", "off"), "morning off", ButtonStyle.Secondary).setDisabled(!morningOn),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(panelModalId("briefing_evening"), `Evening ${eveningOn ? clockLabel(s.briefing_evening_time) : "off"} ✏️`, ButtonStyle.Primary),
    button(panelSetId("briefing_evening", "off"), "evening off", ButtonStyle.Secondary).setDisabled(!eveningOn),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(panelSetId("reminders", s.reminders_enabled ? "off" : "on"), `Reminders ${s.reminders_enabled ? "ON" : "OFF"}`, s.reminders_enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    button(panelModalId("quiet_clear"), quietOn ? `${clockLabel(s.quiet_hours_start)}–${clockLabel(s.quiet_hours_end)} ✏️` : "Quiet off ✏️", ButtonStyle.Primary),
    button(panelSetId("quiet_clear"), "clear quiet", ButtonStyle.Secondary).setDisabled(!quietOn),
  );
  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(panelSetId("capture_images", s.capture_images ? "off" : "on"), `Images ${s.capture_images ? "ON" : "OFF"}`, s.capture_images ? ButtonStyle.Success : ButtonStyle.Secondary),
    button(panelSetId("capture_voice", s.capture_voice ? "off" : "on"), `Voice ${s.capture_voice ? "ON" : "OFF"}`, s.capture_voice ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  return [row1, row2, row3, row4];
}

export function rowsFromNotifyButtons(
  buttons: string[] | undefined,
  taskId: string | null | undefined,
  occurrenceId?: string | null,
): ActionRowBuilder<ButtonBuilder>[] {
  const id = occurrenceId || taskId;
  if (!buttons || buttons.length === 0) return [];
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const b of buttons) {
    if (b === "ml") {
      row.addComponents(button(customId("ml"), "Move leftovers to today", ButtonStyle.Primary));
      continue;
    }
    if (!id) continue;
    if (b === "complete") {
      row.addComponents(button(customId("c", id), "Complete", ButtonStyle.Success));
    } else if (b === "snooze_1h") {
      row.addComponents(button(customId("z", id), "Snooze 1h", ButtonStyle.Secondary));
    } else if (b === "tomorrow") {
      row.addComponents(button(customId("t", id), "Tomorrow", ButtonStyle.Secondary));
    } else if (b === "skip") {
      row.addComponents(button(customId("k", id), "Skip", ButtonStyle.Secondary));
    }
  }
  return row.components.length ? [row] : [];
}
