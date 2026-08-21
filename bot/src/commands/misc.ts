import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";
import { getMcpClient, isMcpConnected, listMcpTools } from "../mcp.js";
import { fetchUserContext } from "../userContext.js";
import { clear, historyKey, historySize } from "../store.js";
import { patchSettings } from "../botApi.js";
import { enqueue, queueKey } from "../queue.js";
import { notifyStatusLine } from "../notifyWorker.js";

export const HELP_TEXT =
  "Structured — your planner in Discord\n\n" +
  "**Just chat.** Examples:\n" +
  "• add review PR at 3pm tomorrow\n" +
  "• remind me to call the bank in 20 minutes\n" +
  "• ping me 10 minutes before gym\n" +
  "• what's left from yesterday?\n" +
  "• every Monday gym at 7am\n\n" +
  "**Shortcuts:** /today /inbox /open /week /add /settings\n" +
  "/link — widget credentials via DM\n" +
  "/clear — reset chat memory\n\n" +
  "Add = calendar only. Remind/ping = calendar + DM.\n" +
  "Briefings are off until you set them in /settings.";

export async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: HELP_TEXT, flags: MessageFlags.Ephemeral });
}

export async function handleClear(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await enqueue(queueKey(interaction.user.id, interaction.channelId), async () => {
    clear(historyKey(interaction.user.id, interaction.channelId));
  });
  await interaction.editReply("Conversation history cleared.");
}

export async function handleTimezone(interaction: ChatInputCommandInteraction): Promise<void> {
  const zone = interaction.options.getString("zone");
  if (zone) {
    await interaction.deferReply();
    const s = await patchSettings(interaction.user.id, { timezone: zone });
    const ctx = await fetchUserContext(interaction.user.id);
    await interaction.editReply(
      `Timezone set to \`${s.timezone}\` (logical today: ${ctx.today}). Times stay civil-local.`,
    );
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ctx = await fetchUserContext(interaction.user.id);
  await interaction.editReply(
    `Your timezone is \`${ctx.timezone}\` (logical today: ${ctx.today}). ` +
      `Bot default for new users on /link is \`${config.TIMEZONE}\`.`,
  );
}

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordUserId = interaction.user.id;
  let toolCount = "?";
  let timezone = config.TIMEZONE;
  try {
    const ctx = await fetchUserContext(discordUserId);
    timezone = ctx.timezone;
    if (!isMcpConnected(discordUserId)) {
      await getMcpClient(discordUserId);
    }
    toolCount = String((await listMcpTools(discordUserId)).length);
  } catch {
    toolCount = "error";
  }
  const key = historyKey(discordUserId, interaction.channelId);
  await interaction.editReply(
    [
      `Timezone: ${timezone}`,
      `Model: ${config.LLM_MODEL}`,
      `MCP connected: ${isMcpConnected(discordUserId) ? "yes" : "no"}`,
      `MCP tools: ${toolCount}`,
      `History messages: ${historySize(key)}`,
      notifyStatusLine(),
    ].join("\n"),
  );
}
