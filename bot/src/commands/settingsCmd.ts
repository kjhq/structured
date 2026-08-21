import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { getSettings, patchSettings } from "../botApi.js";
import { isValidClock, openSettingsPanel } from "../panels/settingsPanel.js";

export async function handleSettingsSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === "get") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await openSettingsPanel(interaction);
    return;
  }
  if (sub === "briefing") {
    const which = interaction.options.getString("which", true);
    const clock = interaction.options.getString("time");
    if (which === "off") {
      await applyAndShow(interaction, { briefing_morning_time: null, briefing_evening_time: null });
      return;
    }
    if (!clock || !isValidClock(clock)) {
      await interaction.reply({
        content: "Provide time as HH:MM (24h), or which=off. Tip: /settings opens a panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const body =
      which === "morning"
        ? { briefing_morning_time: clock }
        : { briefing_evening_time: clock };
    await applyAndShow(interaction, body);
    return;
  }
  if (sub === "quiet") {
    const start = interaction.options.getString("start", true);
    const end = interaction.options.getString("end", true);
    if (!isValidClock(start) || !isValidClock(end)) {
      await interaction.reply({
        content: "Times must be HH:MM (24h), e.g. start=23:00 end=07:00.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (start === end) {
      await applyAndShow(interaction, { quiet_hours_start: null, quiet_hours_end: null });
      return;
    }
    await applyAndShow(interaction, { quiet_hours_start: start, quiet_hours_end: end });
    return;
  }
  if (sub === "reminders") {
    await applyAndShow(interaction, {
      reminders_enabled: interaction.options.getBoolean("enabled", true),
    });
    return;
  }
  await interaction.reply({
    content: "Unknown subcommand.",
    flags: MessageFlags.Ephemeral,
  });
}

async function applyAndShow(
  interaction: ChatInputCommandInteraction,
  body: Record<string, unknown>,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await patchSettings(interaction.user.id, body);
    await openSettingsPanel(interaction);
  } catch (err) {
    await interaction.editReply(
      err instanceof Error ? err.message.slice(0, 400) : "Settings failed.",
    );
  }
}
