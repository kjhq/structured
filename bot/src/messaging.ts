import {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type TextBasedChannel,
} from "discord.js";

export const DISCORD_CHUNK = 1900;

export type RepliableInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | MessageContextMenuCommandInteraction
  | ModalSubmitInteraction;

export function splitMessage(text: string, max = DISCORD_CHUNK): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf("\n", max);
    if (cut < Math.floor(max / 2)) cut = max;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function replySafe(
  channel: TextBasedChannel,
  text: string,
  extras?: { embeds?: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] },
): Promise<void> {
  const body = text?.trim() ? text : extras?.embeds?.length ? "" : "(empty response)";
  const sendOpts = {
    allowedMentions: { parse: [] as const },
    embeds: extras?.embeds,
    components: extras?.components,
  };
  const chunks = body ? splitMessage(body) : [""];
  for (const [i, chunk] of chunks.entries()) {
    try {
      if ("send" in channel) {
        await channel.send({
          content: chunk || undefined,
          ...sendOpts,
          embeds: i === 0 ? extras?.embeds : undefined,
          components: i === 0 ? extras?.components : undefined,
        });
      }
    } catch (err) {
      console.error("Failed to send reply chunk", err);
      break;
    }
  }
}

export function labelOf(interaction: RepliableInteraction): string {
  if (interaction.isChatInputCommand()) return `/${interaction.commandName}`;
  if (interaction.isMessageContextMenuCommand()) return `menu ${interaction.commandName}`;
  if (interaction.isButton()) return `button ${interaction.customId}`;
  return `modal ${interaction.customId}`;
}

/**
 * Guarantees the interaction is acknowledged within ~1s even if the handler
 * stalls, and always answers with an ephemeral error on failure.
 */
export async function withAck(
  interaction: RepliableInteraction,
  fn: () => Promise<void>,
): Promise<void> {
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled && !interaction.deferred && !interaction.replied) {
      void interaction
        .deferReply({ flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }, 1000);
  try {
    await fn();
  } catch (err) {
    console.error(`interaction failed (${labelOf(interaction)})`, err);
    const content = "Something went wrong. Try again.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    } catch {
      // token expired or channel gone — nothing more we can do
    }
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}

/** Personal data must not broadcast in servers: ephemeral there, normal in DMs. */
export function dmFlags(interaction: { guildId?: string | null }): {
  flags?: MessageFlags;
} {
  return interaction.guildId ? { flags: MessageFlags.Ephemeral } : {};
}
