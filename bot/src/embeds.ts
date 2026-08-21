import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

export const DEFAULT_ACCENT = 0x5e96cb;

export function parseColor(hex?: string | null): number {
  if (!hex) return DEFAULT_ACCENT;
  const m = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return DEFAULT_ACCENT;
  return Number.parseInt(m, 16);
}

export type PlannerItem = {
  id?: string;
  task_id?: string;
  title?: string;
  notes?: string | null;
  day?: string | null;
  start_time?: string | null;
  duration_minutes?: number | null;
  is_all_day?: boolean;
  completed_at?: string | null;
  color?: string | null;
  is_occurrence?: boolean;
  series_id?: string | null;
  alerts?: unknown[];
};

export function itemId(item: PlannerItem): string {
  return String(item.id ?? item.task_id ?? "");
}

function whenLabel(item: PlannerItem): string {
  if (!item.day) return "inbox";
  if (item.is_all_day || !item.start_time) return `all-day ${item.day}`;
  const clock = item.start_time.slice(0, 5);
  return `${item.day} ${clock}`;
}

function kindFooter(item: PlannerItem): string {
  if (!item.day) return "inbox";
  if (item.is_all_day || !item.start_time) return `all-day · ${item.day}`;
  return `timed · ${item.day}`;
}

export function taskEmbed(item: PlannerItem, extra?: string): EmbedBuilder {
  const title = item.completed_at ? `~~${item.title ?? "Task"}~~` : (item.title ?? "Task");
  const embed = new EmbedBuilder()
    .setTitle(title.slice(0, 256))
    .setColor(parseColor(item.color))
    .setFooter({ text: kindFooter(item) });
  const notes = (item.notes ?? "").trim();
  if (notes) embed.setDescription(notes.slice(0, 200));
  embed.addFields({ name: "When", value: whenLabel(item), inline: true });
  if (item.duration_minutes) {
    embed.addFields({ name: "Duration", value: `${item.duration_minutes} min`, inline: true });
  }
  embed.addFields({
    name: "Recurring",
    value: item.is_occurrence ? "yes" : "no",
    inline: true,
  });
  if (extra) embed.setDescription([embed.data.description, extra].filter(Boolean).join("\n").slice(0, 4096));
  return embed;
}

function lineFor(item: PlannerItem): string {
  const done = item.completed_at ? "✓ " : "";
  const title = item.title ?? "(untitled)";
  if (!item.day) return `${done}**${title}**`;
  if (item.is_all_day || !item.start_time) return `${done}**${title}**`;
  return `${done}\`${item.start_time.slice(0, 5)}\` **${title}**`;
}

export function listEmbed(
  title: string,
  items: PlannerItem[],
  emptyText: string,
  footer?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(title).setColor(DEFAULT_ACCENT);
  if (items.length === 0) {
    embed.setDescription(emptyText);
    if (footer) embed.setFooter({ text: footer });
    return embed;
  }
  const cap = 40;
  const shown = items.slice(0, cap);
  const lines = shown.map(lineFor);
  const extra = items.length - shown.length;
  if (extra > 0) lines.push(`and ${extra} more — ask in chat.`);
  embed.setDescription(lines.join("\n").slice(0, 4096));
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

export function weekEmbed(
  items: PlannerItem[],
  streaks: Array<{ title?: string; done?: number; expected?: number }>,
): EmbedBuilder {
  const byDay = new Map<string, PlannerItem[]>();
  for (const item of items) {
    const day = item.day ?? "inbox";
    const list = byDay.get(day) ?? [];
    list.push(item);
    byDay.set(day, list);
  }
  const parts: string[] = [];
  for (const [day, list] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`**${day}**`);
    for (const item of list) parts.push(lineFor(item));
  }
  const extra = streaks
    .slice(0, 8)
    .map((s) => `${s.title ?? "series"} ${s.done ?? 0}/${s.expected ?? 0} this week`)
    .join(" · ");
  const embed = new EmbedBuilder()
    .setTitle("This week")
    .setColor(DEFAULT_ACCENT)
    .setDescription(parts.join("\n").slice(0, 4096) || "Nothing scheduled this week.");
  if (extra) embed.setFooter({ text: extra.slice(0, 2048) });
  return embed;
}

export const allowedMentions = { parse: [] as const };

export function notifyEmbed(payload: {
  title?: string;
  description?: string;
  color?: string;
  fields?: Array<{ name: string; value: string }>;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle((payload.title ?? "Reminder").slice(0, 256))
    .setColor(parseColor(payload.color));
  if (payload.description) embed.setDescription(payload.description.slice(0, 200));
  for (const field of payload.fields ?? []) {
    embed.addFields({ name: field.name.slice(0, 256), value: field.value.slice(0, 1024), inline: true });
  }
  return embed;
}

export function okRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("s1:noop").setLabel("Done").setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
}
