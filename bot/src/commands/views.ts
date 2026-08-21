import type { ChatInputCommandInteraction } from "discord.js";
import { getView as fetchView } from "../botApi.js";
import { allowedMentions, itemId, listEmbed, weekEmbed, type PlannerItem } from "../embeds.js";
import { viewRows } from "../components.js";
import { dmFlags } from "../messaging.js";

function asItems(raw: unknown): PlannerItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is PlannerItem => Boolean(x) && typeof x === "object");
}

export async function handleView(
  interaction: ChatInputCommandInteraction,
  which: "today" | "inbox" | "open" | "week",
): Promise<void> {
  await interaction.deferReply(dmFlags(interaction));
  const data = await fetchView(interaction.user.id, which);
  const items = asItems(data.items);
  if (which === "week") {
    const streaks = Array.isArray(data.streaks)
      ? (data.streaks as Array<{ title?: string; done?: number; expected?: number }>)
      : [];
    await interaction.editReply({ embeds: [weekEmbed(items, streaks)], allowedMentions });
    return;
  }
  const titles = { today: "Today", inbox: "Inbox", open: "Open backlog" };
  const empty = {
    today: "Nothing on today.",
    inbox: "Inbox is empty. Add a title with /add, or just chat.",
    open: "No leftover dated tasks.",
  };
  let extra: string | undefined;
  if (which === "today") {
    const [inbox, open] = await Promise.all([
      fetchView(interaction.user.id, "inbox"),
      fetchView(interaction.user.id, "open"),
    ]);
    extra = `inbox ${asItems(inbox.items).length} · leftovers ${asItems(open.items).length}`;
  }
  const rows = viewRows(items);
  await interaction.editReply({
    embeds: [listEmbed(titles[which], items, empty[which], extra)],
    components: rows,
    allowedMentions,
  });
}

export function firstIncompleteId(items: PlannerItem[]): string {
  for (const item of items) {
    if (!item.completed_at) {
      const id = itemId(item);
      if (id) return id;
    }
  }
  return "";
}
