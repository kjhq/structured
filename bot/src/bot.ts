import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import { config, isAuthorizedUser } from "./config.js";
import { prompt } from "./agent.js";
import { clear, historySize, historyKey } from "./store.js";
import { enqueue, queueKey } from "./queue.js";
import { getMcpClient, isMcpConnected, listMcpTools } from "./mcp.js";
import { fetchUserContext } from "./userContext.js";

/** Discord message limit is 2000 chars. */
const DISCORD_CHUNK = 1900;

function splitMessage(text: string, max = DISCORD_CHUNK): string[] {
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

async function replySafe(
  channel: TextBasedChannel,
  text: string,
): Promise<void> {
  const body = text?.trim() ? text : "(empty response)";
  const sendOpts = { allowedMentions: { parse: [] as const } };
  for (const chunk of splitMessage(body)) {
    try {
      if ("send" in channel) {
        await channel.send({ content: chunk, ...sendOpts });
      }
    } catch (err) {
      console.error("Failed to send reply chunk", err);
      try {
        if ("send" in channel) {
          await channel.send({
            content: "(message truncated — send failed)",
            ...sendOpts,
          });
        }
      } catch {
        // ignore
      }
      break;
    }
  }
}

const HELP_TEXT =
  "Planner Task Bot\n\n" +
  "Send natural language, for example:\n" +
  '• "what tasks do I have?"\n' +
  '• "add review PR at 3pm tomorrow"\n' +
  '• "what did I leave incomplete?"\n' +
  '• "what\'s in my inbox?"\n\n' +
  "Commands:\n" +
  "/help — this message\n" +
  "/link — DM widget credentials (Discord ID + token)\n" +
  "/relink — rotate widget token and DM the new one\n" +
  "/timezone — configured timezone\n" +
  "/status — model, MCP, history size\n" +
  "/clear — reset conversation history";

const slashCommands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show help and example prompts"),
  new SlashCommandBuilder()
    .setName("link")
    .setDescription("DM widget credentials (Discord ID + token)"),
  new SlashCommandBuilder()
    .setName("relink")
    .setDescription("Rotate widget token and DM the new credentials"),
  new SlashCommandBuilder()
    .setName("timezone")
    .setDescription("Show configured timezone"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show model, MCP, and history status"),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Reset conversation history for this channel"),
].map((cmd) => cmd.toJSON());

async function unauthorizedReply(
  target: ChatInputCommandInteraction | Message,
): Promise<void> {
  if ("reply" in target && "commandName" in target) {
    await target.reply({ content: "Unauthorized.", ephemeral: true });
    return;
  }
  if ("reply" in target) {
    await target.reply("Unauthorized.");
  }
}

async function handleStatus(
  discordUserId: string,
  channelId: string,
): Promise<string> {
  let toolCount = "?";
  let timezone = config.TIMEZONE;
  try {
    const ctx = await fetchUserContext(discordUserId);
    timezone = ctx.timezone;
    if (isMcpConnected(discordUserId)) {
      toolCount = String((await listMcpTools(discordUserId)).length);
    } else {
      await getMcpClient(discordUserId);
      toolCount = String((await listMcpTools(discordUserId)).length);
    }
  } catch {
    toolCount = "error";
  }
  const key = historyKey(discordUserId, channelId);
  return [
    `Timezone: ${timezone}`,
    `Model: ${config.LLM_MODEL}`,
    `LLM: ${config.LLM_BASE_URL}`,
    `MCP connected: ${isMcpConnected(discordUserId) ? "yes" : "no"}`,
    `MCP tools: ${toolCount}`,
    `History messages: ${historySize(key)}`,
  ].join("\n");
}

export async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const base = config.API_BASE_URL.replace(/\/$/, "");

  // Two-phase: prepare pending token, DM it, then activate (invalidate old).
  let prepareRes: Response;
  try {
    prepareRes = await fetch(`${base}/v1/bot/link/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Secret": config.BOT_API_SECRET,
      },
      body: JSON.stringify({
        discord_id: interaction.user.id,
        timezone: config.TIMEZONE,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    await interaction.editReply(
      `Link failed (timeout/network). ${err instanceof Error ? err.message : String(err)}`.slice(
        0,
        180,
      ),
    );
    return;
  }

  if (!prepareRes.ok) {
    const detail = await prepareRes.text().catch(() => "");
    await interaction.editReply(
      `Link failed (${prepareRes.status}). ${detail.slice(0, 120)}`.trim(),
    );
    return;
  }

  const body = (await prepareRes.json()) as {
    discord_id: string;
    widget_token: string;
    pending_id: string;
  };
  const dmText =
    "Structured widget credentials:\n" +
    `Discord ID: \`${body.discord_id}\`\n` +
    `Widget token: \`${body.widget_token}\`\n` +
    "Paste both into the widget with your backend URL.\n" +
    "This token activates only after successful delivery.";

  try {
    await interaction.user.send(dmText);
  } catch {
    await interaction.editReply(
      "Could not DM you. Open DMs from server members, then run /link again. " +
        "Your existing widget token was NOT rotated.",
    );
    return;
  }

  try {
    const activateRes = await fetch(`${base}/v1/bot/link/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Secret": config.BOT_API_SECRET,
      },
      body: JSON.stringify({
        discord_id: interaction.user.id,
        pending_id: body.pending_id,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!activateRes.ok) {
      const detail = await activateRes.text().catch(() => "");
      await interaction.editReply(
        `Credentials DMed, but activation failed (${activateRes.status}). ` +
          `${detail.slice(0, 100)}. Run /link again.`.trim(),
      );
      return;
    }
  } catch (err) {
    await interaction.editReply(
      `Credentials DMed, but activation failed: ${err instanceof Error ? err.message : String(err)}. Run /link again.`,
    );
    return;
  }

  await interaction.editReply("Sent credentials via DM. Old token (if any) is now invalid.");
}

async function handlePrompt(
  channel: TextBasedChannel,
  channelId: string,
  text: string,
  discordUserId: string,
): Promise<void> {
  const key = queueKey(discordUserId, channelId);
  await enqueue(key, async () => {
    if ("sendTyping" in channel) {
      channel.sendTyping().catch(() => {});
    }
    const typing = setInterval(() => {
      if ("sendTyping" in channel) {
        channel.sendTyping().catch(() => {});
      }
    }, 8000);

    try {
      const result = await prompt(text, channelId, discordUserId);
      await replySafe(channel, result);
    } catch (err) {
      console.error("prompt failed", err);
      const msg =
        err instanceof Error &&
        (err.name === "TimeoutError" ||
          err.message.toLowerCase().includes("timeout"))
          ? "Request timed out (LLM or planner MCP). Try again in a moment."
          : "Error processing your request. Try again.";
      if ("send" in channel) {
        await channel
          .send({ content: msg, allowedMentions: { parse: [] } })
          .catch(() => {});
      }
    } finally {
      clearInterval(typing);
    }
  });
}

async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!isAuthorizedUser(interaction.user.id)) {
    await unauthorizedReply(interaction);
    return;
  }

  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  switch (interaction.commandName) {
    case "help":
      await interaction.reply(HELP_TEXT);
      break;
    case "link":
    case "relink":
      await handleLink(interaction);
      break;
    case "timezone": {
      const ctx = await fetchUserContext(userId);
      await interaction.reply(
        `Your server timezone is \`${ctx.timezone}\` (logical today: ${ctx.today}). ` +
          `Bot default for new users on /link is \`${config.TIMEZONE}\`.`,
      );
      break;
    }
    case "clear":
      clear(historyKey(userId, channelId));
      await interaction.reply("Conversation history cleared.");
      break;
    case "status": {
      await interaction.deferReply();
      await interaction.editReply(await handleStatus(userId, channelId));
      break;
    }
    default:
      await interaction.reply("Unknown command.");
  }
}

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.content.trim()) return;
  if (!isAuthorizedUser(message.author.id)) {
    await unauthorizedReply(message);
    return;
  }

  const text = message.content.trim();
  const channel = message.channel;
  if (!channel.isTextBased()) return;

  await handlePrompt(channel, message.channelId, text, message.author.id);
}

export function createBot(): Client {
  // Message Content is privileged — enable in Discord Developer Portal or guild NL breaks.
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  registerBotHandlers(client);
  return client;
}

/** Separated for integration tests without Discord login. */
export function registerBotHandlers(client: Client): void {
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    await readyClient.application.commands.set(slashCommands);
    console.log("Slash commands registered");
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleSlashCommand(interaction);
    } catch (err) {
      console.error("Slash command error", err);
      const reply = interaction.replied || interaction.deferred
        ? interaction.followUp.bind(interaction)
        : interaction.reply.bind(interaction);
      await reply({
        content: "Something went wrong. Try again.",
        ephemeral: true,
      }).catch(() => {});
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleMessage(message);
    } catch (err) {
      console.error("Message handler error", err);
      await message.reply("Something went wrong. Try again.").catch(() => {});
    }
  });
}

export async function handleMessageForTest(message: Message): Promise<void> {
  await handleMessage(message);
}
