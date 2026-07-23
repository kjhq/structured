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
import { config } from "./config.js";
import { prompt } from "./agent.js";
import { clear, historySize } from "./store.js";
import { enqueue } from "./queue.js";
import { getMcpClient, isMcpConnected, listMcpTools } from "./mcp.js";

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
  "/timezone — configured timezone\n" +
  "/status — model, MCP, history size\n" +
  "/clear — reset conversation history";

const slashCommands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show help and example prompts"),
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

function isAuthorized(userId: string): boolean {
  return !config.AUTHORIZED_USER_ID || userId === config.AUTHORIZED_USER_ID;
}

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

async function handleStatus(channelId: string): Promise<string> {
  let toolCount = "?";
  try {
    if (isMcpConnected()) {
      toolCount = String((await listMcpTools()).length);
    } else {
      await getMcpClient();
      toolCount = String((await listMcpTools()).length);
    }
  } catch {
    toolCount = "error";
  }
  return [
    `Timezone: ${config.TIMEZONE}`,
    `Model: ${config.LLM_MODEL}`,
    `LLM: ${config.LLM_BASE_URL}`,
    `MCP connected: ${isMcpConnected() ? "yes" : "no"}`,
    `MCP tools: ${toolCount}`,
    `History messages: ${historySize(channelId)}`,
  ].join("\n");
}

async function handlePrompt(
  channel: TextBasedChannel,
  channelId: string,
  text: string,
): Promise<void> {
  await enqueue(channelId, async () => {
    if ("sendTyping" in channel) {
      channel.sendTyping().catch(() => {});
    }
    const typing = setInterval(() => {
      if ("sendTyping" in channel) {
        channel.sendTyping().catch(() => {});
      }
    }, 8000);

    try {
      const result = await prompt(text, channelId);
      await replySafe(channel, result);
    } catch (err) {
      console.error("prompt failed", err);
      const msg =
        err instanceof Error &&
        (err.name === "TimeoutError" ||
          err.message.toLowerCase().includes("timeout"))
          ? "Request timed out (LLM or Structured MCP). Try again in a moment."
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
  if (!isAuthorized(interaction.user.id)) {
    await unauthorizedReply(interaction);
    return;
  }

  const channelId = interaction.channelId;

  switch (interaction.commandName) {
    case "help":
      await interaction.reply(HELP_TEXT);
      break;
    case "timezone":
      await interaction.reply(
        `Timezone is \`${config.TIMEZONE}\` (set the \`TIMEZONE\` env var to change).`,
      );
      break;
    case "clear":
      clear(channelId);
      await interaction.reply("Conversation history cleared.");
      break;
    case "status": {
      await interaction.deferReply();
      await interaction.editReply(await handleStatus(channelId));
      break;
    }
    default:
      await interaction.reply("Unknown command.");
  }
}

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.content.trim()) return;
  if (!isAuthorized(message.author.id)) {
    await unauthorizedReply(message);
    return;
  }

  const text = message.content.trim();
  const channel = message.channel;
  if (!channel.isTextBased()) return;

  await handlePrompt(channel, message.channelId, text);
}

export function createBot(): Client {
  // Message Content is privileged — without portal toggle Discord rejects login.
  // DMs still carry content without that intent; guild free-text needs it enabled.
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

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

  return client;
}
