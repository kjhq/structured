import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

export type ButtonOp = "c" | "u" | "z" | "t" | "k" | "r" | "ml";

export interface ParsedCustomId {
  op: ButtonOp;
  id?: string;
}

const OPS = new Set<string>(["c", "u", "z", "t", "k", "r", "ml"]);

export function parseCustomId(customId: string): ParsedCustomId | null {
  if (!customId.startsWith("s1:")) return null;
  const parts = customId.split(":");
  const op = parts[1];
  if (!OPS.has(op)) return null;
  const id = parts.slice(2).join(":") || undefined;
  return { op: op as ButtonOp, id };
}

export function customId(op: ButtonOp, id?: string): string {
  if (!id) return `s1:${op}`;
  return `s1:${op}:${id}`;
}

export function itemActionRow(
  id: string,
  opts: { occurrence?: boolean; completed?: boolean } = {},
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (opts.completed) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(customId("u", id))
        .setLabel("Undo")
        .setStyle(ButtonStyle.Secondary),
    );
    return row;
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(customId("c", id))
      .setLabel("Complete")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(customId("z", id))
      .setLabel("Snooze 1h")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId("t", id))
      .setLabel("Tomorrow")
      .setStyle(ButtonStyle.Secondary),
  );
  if (opts.occurrence) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(customId("k", id))
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

export function restoreRow(id: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId("r", id))
      .setLabel("Undo")
      .setStyle(ButtonStyle.Danger),
  );
}

export function briefingRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId("ml"))
      .setLabel("Move leftovers to today")
      .setStyle(ButtonStyle.Primary),
  );
}

export function disabledRow(row: ActionRowBuilder<ButtonBuilder>): ActionRowBuilder<ButtonBuilder> {
  const next = new ActionRowBuilder<ButtonBuilder>();
  for (const comp of row.components) {
    if (comp instanceof ButtonBuilder) {
      next.addComponents(ButtonBuilder.from(comp).setDisabled(true));
    }
  }
  return next;
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
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(customId("ml"))
          .setLabel("Move leftovers to today")
          .setStyle(ButtonStyle.Primary),
      );
      continue;
    }
    if (!id) continue;
    if (b === "complete") {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(customId("c", id))
          .setLabel("Complete")
          .setStyle(ButtonStyle.Success),
      );
    } else if (b === "snooze_1h") {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(customId("z", id))
          .setLabel("Snooze 1h")
          .setStyle(ButtonStyle.Secondary),
      );
    } else if (b === "tomorrow") {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(customId("t", id))
          .setLabel("Tomorrow")
          .setStyle(ButtonStyle.Secondary),
      );
    } else if (b === "skip") {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(customId("k", id))
          .setLabel("Skip")
          .setStyle(ButtonStyle.Secondary),
      );
    }
  }
  return row.components.length ? [row] : [];
}
