import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { getSettings, patchSettings, type UserSettings } from "../botApi.js";
import { panelModalId, settingsRows } from "../components.js";
import type { PanelField } from "../components.js";
import { ymdToHuman } from "../timezone.js";

const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidClock(value: string | null | undefined): boolean {
  return typeof value === "string" && CLOCK_RE.test(value.trim());
}

export function normalizeStoredClock(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 5);
}

/** Map a panel interaction to a settings PATCH body. */
export function applyPanelSet(
  field: PanelField,
  value: string | undefined,
  current: UserSettings,
): Record<string, unknown> {
  switch (field) {
    case "briefing_morning":
      return { briefing_morning_time: value === "off" ? null : value };
    case "briefing_evening":
      return { briefing_evening_time: value === "off" ? null : value };
    case "reminders":
      return { reminders_enabled: value === "on" };
    case "quiet_clear":
      return { quiet_hours_start: null, quiet_hours_end: null };
    case "capture_images":
      return { capture_images: value === "on" };
    case "capture_voice":
      return { capture_voice: value === "on" };
    default:
      return {};
  }
}

export function panelEmbed(
  s: UserSettings,
  ctx: { timezone: string; today: string },
): EmbedBuilder {
  const quiet =
    s.quiet_hours_start && s.quiet_hours_end
      ? `${normalizeStoredClock(s.quiet_hours_start)}–${normalizeStoredClock(s.quiet_hours_end)}`
      : "off";
  const lines = [
    `**Timezone:** ${s.timezone} · today ${ymdToHuman(ctx.today, s.timezone)}`,
    "",
    `Morning briefing: **${s.briefing_morning_time ? normalizeStoredClock(s.briefing_morning_time) : "off"}**`,
    `Evening briefing: **${s.briefing_evening_time ? normalizeStoredClock(s.briefing_evening_time) : "off"}**`,
    `Reminder DMs: **${s.reminders_enabled ? "on" : "off"}**`,
    `Quiet hours: **${quiet}**`,
    `Image capture: **${s.capture_images ? "on" : "off"}** · Voice capture: **${s.capture_voice ? "on" : "off"}**`,
    "",
    "Use the buttons below. ✏️ opens a time picker.",
  ];
  return new EmbedBuilder()
    .setTitle("⚙️ Settings")
    .setDescription(lines.join("\n"))
    .setColor(0x5e96cb);
}

export async function openSettingsPanel(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  const s = await getSettings(interaction.user.id);
  const payload = {
    embeds: [panelEmbed(s, { timezone: s.timezone, today: "" })],
    components: settingsRows(s),
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
}

export async function handlePanelSet(
  interaction: ButtonInteraction,
  field: PanelField,
  value?: string,
): Promise<void> {
  const current = await getSettings(interaction.user.id);
  const body = applyPanelSet(field, value, current);
  const s = await patchSettings(interaction.user.id, body);
  const payload = {
    embeds: [panelEmbed(s, { timezone: s.timezone, today: "" })],
    components: settingsRows(s),
  };
  try {
    await interaction.update(payload);
  } catch {
    await interaction.editReply(payload).catch(() => {});
  }
}

export async function openPanelModal(
  interaction: ButtonInteraction,
  field: PanelField,
): Promise<void> {
  const modal = new ModalBuilder().setCustomId(panelModalId(field));
  if (field === "briefing_morning" || field === "briefing_evening") {
    const input = new TextInputBuilder()
      .setCustomId("time")
      .setLabel("Time as HH:MM (24h), or 'off'")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("08:00");
    modal.setTitle(field === "briefing_morning" ? "Morning briefing" : "Evening briefing");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  } else if (field === "quiet_clear") {
    const start = new TextInputBuilder()
      .setCustomId("start")
      .setLabel("Quiet start HH:MM (24h)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("23:00");
    const end = new TextInputBuilder()
      .setCustomId("end")
      .setLabel("Quiet end HH:MM (24h)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("07:00");
    modal.setTitle("Quiet hours");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(start),
      new ActionRowBuilder<TextInputBuilder>().addComponents(end),
    );
  } else {
    return;
  }
  await interaction.showModal(modal);
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const field = interaction.customId.split(":")[3] as PanelField;
  if (field === "briefing_morning" || field === "briefing_evening") {
    const raw = interaction.fields.getTextInputValue("time").trim();
    if (raw.toLowerCase() === "off") {
      const current = await getSettings(interaction.user.id);
      const s = await patchSettings(interaction.user.id, applyPanelSet(field, "off", current));
      await replyPanel(interaction, s);
      return;
    }
    if (!isValidClock(raw)) {
      await interaction.reply({
        content: `\`${raw}\` is not HH:MM (24h). Try again — e.g. \`08:00\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const current = await getSettings(interaction.user.id);
    const s = await patchSettings(interaction.user.id, applyPanelSet(field, raw, current));
    await replyPanel(interaction, s);
    return;
  }
  if (field === "quiet_clear") {
    const start = interaction.fields.getTextInputValue("start").trim();
    const end = interaction.fields.getTextInputValue("end").trim();
    if (!isValidClock(start) || !isValidClock(end)) {
      await interaction.reply({
        content: "Both times must be HH:MM (24h), e.g. `23:00` and `07:00`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (start === end) {
      await interaction.reply({
        content: "Quiet start and end cannot be equal. Use different times or clear quiet hours.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const s = await patchSettings(interaction.user.id, {
      quiet_hours_start: start,
      quiet_hours_end: end,
    });
    await replyPanel(interaction, s);
  }
}

async function replyPanel(
  interaction: ModalSubmitInteraction,
  s: UserSettings,
): Promise<void> {
  const payload = {
    content: "Updated ✅",
    embeds: [panelEmbed(s, { timezone: s.timezone, today: "" })],
    components: settingsRows(s),
  };
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}
