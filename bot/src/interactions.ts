import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { isAuthorizedUser } from "./config.js";
import { postAction, BotApiError } from "./botApi.js";
import { allowedMentions } from "./embeds.js";
import { itemActionRow, parseCustomId, noopId, type ButtonOp } from "./components.js";
import {
  handleModalSubmit,
  handlePanelSet,
  openPanelModal,
  openSettingsPanel,
} from "./panels/settingsPanel.js";
import { createInboxThis } from "./capture.js";
import { enqueue } from "./queue.js";

export function apiErrorMessage(err: unknown): string {
  if (err instanceof BotApiError) {
    if (err.status === 404) return "Already gone.";
    if (/undo_expired/.test(err.body)) return "Undo expired.";
    if (err.status === 403) return "Not your task.";
    return err.message.slice(0, 300);
  }
  return err instanceof Error ? err.message.slice(0, 300) : "Action failed.";
}

/** Works whether or not the interaction was already acked via deferUpdate. */
async function updateOrEdit(
  interaction: ButtonInteraction,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await interaction.update(payload as never);
  } catch {
    await interaction.editReply(payload as never).catch(() => {});
  }
}

async function runItemOp(userId: string, op: ButtonOp, id?: string): Promise<void> {
  switch (op) {
    case "c":
      await postAction(userId, "complete", { id });
      return;
    case "u":
      await postAction(userId, "uncomplete", { id });
      return;
    case "z":
      await postAction(userId, "snooze", { id, minutes: 60 });
      return;
    case "t":
      await postAction(userId, "snooze", { id, tomorrow: true });
      return;
    case "k":
      await postAction(userId, "skip", { occurrence_id: id });
      return;
    case "r":
      await postAction(userId, "restore", { task_id: id, id });
      return;
    case "ml":
      await postAction(userId, "move-open", {});
      return;
    default:
      throw new Error("unknown op");
  }
}

export async function routeButton(interaction: ButtonInteraction): Promise<void> {
  if (!isAuthorizedUser(interaction.user.id)) {
    await interaction.reply({ content: "Unauthorized.", flags: MessageFlags.Ephemeral });
    return;
  }
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) {
    await interaction.reply({ content: "Unknown button.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (parsed.kind === "noop") {
    await interaction.deferUpdate().catch(() => {});
    return;
  }
  if (parsed.kind === "panel-modal") {
    await openPanelModal(interaction, parsed.field);
    return;
  }
  if (parsed.kind === "panel-set") {
    await enqueue(`user:${interaction.user.id}`, async () => {
      await handlePanelSet(interaction, parsed.field, parsed.value);
    });
    return;
  }

  const { op, id } = parsed;
  await enqueue(`user:${interaction.user.id}`, async () => {
    try {
      await runItemOp(interaction.user.id, op, id);
      const embeds = interaction.message.embeds.map((e) => {
        const b = EmbedBuilder.from(e);
        if (op === "c" && b.data.title) b.setTitle(`~~${b.data.title.replace(/~~/g, "")}~~`);
        if (op === "u" && b.data.title) b.setTitle(b.data.title.replace(/~~/g, ""));
        return b;
      });
      let components: ActionRowBuilder<ButtonBuilder>[];
      if (op === "c" && id) {
        components = [itemActionRow(id, { completed: true, occurrence: id.startsWith("occ_") })];
      } else if (op === "u" && id) {
        components = [itemActionRow(id, { occurrence: id.startsWith("occ_") })];
      } else {
        components = interaction.message.components.flatMap((row) => {
          if (row.type !== ComponentType.ActionRow) return [];
          const rebuilt = new ActionRowBuilder<ButtonBuilder>();
          for (const comp of row.components) {
            if (comp.type === ComponentType.Button) {
              rebuilt.addComponents(ButtonBuilder.from(comp).setDisabled(true));
            }
          }
          return rebuilt.components.length ? [rebuilt] : [];
        });
      }
      await updateOrEdit(interaction, { embeds, components, allowedMentions });
    } catch (err) {
      const msg = apiErrorMessage(err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      if (/Undo expired/.test(msg)) {
        const expired = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(noopId())
            .setLabel("Undo expired.")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );
        await interaction.message.edit({ components: [expired] }).catch(() => {});
      } else if (/Already gone/.test(msg)) {
        await interaction.message.edit({ components: [] }).catch(() => {});
      }
    }
  });
}

export async function routeModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!isAuthorizedUser(interaction.user.id)) {
    await interaction.reply({ content: "Unauthorized.", flags: MessageFlags.Ephemeral });
    return;
  }
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.kind !== "panel-modal") {
    await interaction.reply({ content: "Unknown form.", flags: MessageFlags.Ephemeral });
    return;
  }
  await handleModalSubmit(interaction);
}

export async function routeContextMenu(
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> {
  if (!isAuthorizedUser(interaction.user.id)) {
    await interaction.reply({ content: "Unauthorized.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const target = interaction.targetMessage;
    await createInboxThis(interaction.user.id, {
      content: target.content,
      guildId: target.guildId,
      channelId: target.channelId,
      id: target.id,
    });
    await interaction.editReply("Saved to inbox.");
  } catch (err) {
    await interaction.editReply(err instanceof Error ? err.message.slice(0, 400) : "Inbox failed.");
  }
}

export { openSettingsPanel };
