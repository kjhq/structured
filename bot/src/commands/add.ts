import type { ChatInputCommandInteraction } from "discord.js";
import { postAction } from "../botApi.js";
import { allowedMentions, taskEmbed, itemId, type PlannerItem } from "../embeds.js";
import { itemActionRow } from "../components.js";
import { dmFlags } from "../messaging.js";
import { fetchUserContext } from "../userContext.js";
import { parseWhen } from "../parseWhen.js";

export async function handleAddSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply(dmFlags(interaction));
  const title = interaction.options.getString("title", true);
  const when = interaction.options.getString("when") ?? undefined;
  const duration = interaction.options.getInteger("duration") ?? undefined;
  const remind = interaction.options.getBoolean("remind") ?? false;
  const ctx = await fetchUserContext(interaction.user.id);
  const parsed = parseWhen(when, ctx.today);
  if ("error" in parsed) {
    await interaction.editReply(parsed.error);
    return;
  }
  try {
    const created = (await postAction(interaction.user.id, "add", {
      title,
      day: parsed.day,
      start_time: parsed.start_time,
      is_all_day: parsed.is_all_day,
      remind,
      duration_minutes: duration,
      client_request_id: `discord:ix:${interaction.id}`,
    })) as PlannerItem & { warnings?: { overlaps?: unknown[] } };
    const id = itemId(created);
    const warn =
      created.warnings?.overlaps && created.warnings.overlaps.length
        ? "Heads up: overlaps another timed block."
        : undefined;
    await interaction.editReply({
      content: warn,
      embeds: [taskEmbed(created)],
      components: id ? [itemActionRow(id, { occurrence: id.startsWith("occ_") })] : [],
      allowedMentions,
    });
  } catch (err) {
    await interaction.editReply(err instanceof Error ? err.message.slice(0, 400) : "Add failed.");
  }
}
