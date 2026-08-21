import { join } from "path";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type Message,
} from "discord.js";
import { config, isAuthorizedUser } from "./config.js";
import { promptFull, type PlannerMutation, type PromptResult } from "./agent.js";
import { historyKey } from "./store.js";
import { enqueue, queueKey } from "./queue.js";
import { syncCommands } from "./registration.js";
import { replySafe, withAck } from "./messaging.js";
import { getSettings, type UserSettings } from "./botApi.js";
import { allowedMentions, itemId, listEmbed, taskEmbed, type PlannerItem } from "./embeds.js";
import { itemActionRow } from "./components.js";
import { handleView } from "./commands/views.js";
import { handleAddSlash } from "./commands/add.js";
import { handleLink } from "./commands/link.js";
import {
  handleClear,
  handleHelp,
  handleStatus,
  handleTimezone,
} from "./commands/misc.js";
import { handleSettingsSlash } from "./commands/settingsCmd.js";
import { routeButton, routeContextMenu, routeModal } from "./interactions.js";
import {
  createCapturedTasks,
  createInboxThis,
  captureDecision,
  extractTasksFromImage,
  isImageAttachment,
  isVoiceAttachment,
  transcribeAudio,
  transcribeEnabled,
  visionEnabled,
} from "./capture.js";

const INBOX_THIS_RE = /^(inbox this|remind me about that)\b/i;

type PromptFn = (
  text: string,
  channelId: string | undefined,
  discordUserId: string,
) => Promise<string>;
let promptImpl: PromptFn | null = null;

/** Test hook — swap planner prompt without Discord or LLM. */
export function setPromptForTest(fn: PromptFn | null): void {
  promptImpl = fn;
}

export { handleLink, handleView };

function rowsFromMutations(mutations: PlannerMutation[]): ReturnType<typeof itemActionRow>[] {
  const last = mutations.at(-1);
  if (!last) return [];
  if (last.name === "planner_delete_tasks") {
    const ids = last.data.deleted;
    const id = Array.isArray(ids) ? String(ids[0] ?? "") : "";
    if (id) return [itemActionRow(id)];
  }
  if (last.name === "planner_create_task" || last.name === "planner_reschedule") {
    const id = String(last.data.task_id ?? last.data.id ?? "");
    if (id) return [itemActionRow(id, { occurrence: id.startsWith("occ_") })];
  }
  if (last.name === "planner_complete_tasks") {
    const first = Array.isArray(last.data.completed) ? last.data.completed[0] : null;
    const id =
      first && typeof first === "object" ? String((first as { task_id?: string }).task_id ?? "") : "";
    if (id) return [itemActionRow(id, { completed: true, occurrence: id.startsWith("occ_") })];
  }
  return [];
}

async function handlePrompt(
  channel: Message["channel"],
  channelId: string,
  text: string,
  discordUserId: string,
  clientRequestId?: string,
): Promise<void> {
  await enqueue(`user:${discordUserId}`, async () => {
    await enqueue(queueKey(discordUserId, channelId), async () => {
      if ("sendTyping" in channel) {
        channel.sendTyping().catch(() => {});
      }
      const typing = setInterval(() => {
        if ("sendTyping" in channel) {
          channel.sendTyping().catch(() => {});
        }
      }, 8000);

      try {
        let result: PromptResult;
        if (promptImpl) {
          result = { content: await promptImpl(text, channelId, discordUserId), mutations: [] };
        } else {
          result = await promptFull(text, channelId, discordUserId, { clientRequestId });
        }
        await replySafe(channel, result.content, { components: rowsFromMutations(result.mutations) });
      } catch (err) {
        console.error("prompt failed", err);
        const msg =
          err instanceof Error && err.message.toLowerCase().includes("timeout")
            ? "Request timed out (LLM or planner MCP). Try again in a moment."
            : "Error processing your request. Try again.";
        if ("send" in channel) {
          await channel.send({ content: msg, allowedMentions }).catch(() => {});
        }
      } finally {
        clearInterval(typing);
      }
    });
  });
}

async function handleCaptureAndMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  const channel = message.channel;
  if (!channel.isTextBased()) return;

  let settings: UserSettings | null = null;
  try {
    settings = await getSettings(message.author.id);
  } catch {
    settings = null;
  }

  const images = [...(message.attachments?.values() ?? [])].filter(isImageAttachment);
  const voices = [...(message.attachments?.values() ?? [])].filter(isVoiceAttachment);
  const decision = captureDecision({
    hasImage: images.length > 0,
    hasVoice: voices.length > 0,
    captureImages: settings?.capture_images !== false,
    captureVoice: settings?.capture_voice !== false,
    visionOn: visionEnabled(),
    transcribeOn: transcribeEnabled(),
  });

  if (decision === "image-notice") {
    await replySafe(channel, "Image capture is off (no vision model). Paste the list as text.");
    return;
  }
  if (decision === "voice-notice") {
    await replySafe(channel, "Voice capture is off.");
    return;
  }

  if (decision === "image") {
    if ("sendTyping" in channel) channel.sendTyping().catch(() => {});
    try {
      const ctx = await fetchContext(message.author.id);
      const tasks = await extractTasksFromImage(
        images[0].url,
        message.content.trim(),
        ctx.timezone,
        ctx.today,
      );
      if (tasks.length === 0) {
        await replySafe(channel, "I couldn't find tasks in that image.");
        return;
      }
      const overflow = Math.max(0, tasks.length - 10);
      const limited = tasks.slice(0, 10);
      const created = await createCapturedTasks(message.author.id, message.id, limited);
      const bits: string[] = [];
      if (images.length > 1) bits.push(`Used the first image (${images.length} attached).`);
      if (overflow > 0) bits.push(`Ignored ${overflow} extra.`);
      const extra = bits.join(" ");
      if (created.length === 1) {
        const id = itemId(created[0]);
        await replySafe(channel, extra, {
          embeds: [taskEmbed(created[0])],
          components: id ? [itemActionRow(id)] : [],
        });
      } else {
        await replySafe(
          channel,
          `${extra ? extra + "\n" : ""}Created ${created.length} tasks. Tell me if I should delete any.`,
          { embeds: [listEmbed("From image", created, "")] },
        );
      }
    } catch (err) {
      console.error("image capture failed", err);
      await replySafe(channel, "I couldn't find tasks in that image.");
    }
    return;
  }

  if (decision === "voice") {
    try {
      const transcript = await transcribeAudio(voices[0].url, voices[0].name ?? "voice.ogg");
      if (!transcript) {
        await replySafe(channel, "I couldn't transcribe that.");
        return;
      }
      await handlePrompt(
        channel,
        message.channelId,
        `[voice transcript]\n${transcript}`,
        message.author.id,
        `discord:msg:${message.id}`,
      );
    } catch (err) {
      console.error("voice capture failed", err);
      await replySafe(channel, "Voice capture is off.");
    }
    return;
  }

  let text = message.content.trim();
  if (INBOX_THIS_RE.test(text) && message.reference?.messageId) {
    try {
      const src = await message.fetchReference();
      await handleInboxThis(
        message.author.id,
        {
          content: src.content,
          guildId: src.guildId,
          channelId: src.channelId,
          id: src.id,
        },
        channel,
      );
    } catch (err) {
      console.error("inbox this failed", err);
      await replySafe(channel, "Could not inbox that message.");
    }
    return;
  }

  if (!text) return;
  await handlePrompt(channel, message.channelId, text, message.author.id, `discord:msg:${message.id}`);
}

async function fetchContext(discordUserId: string) {
  const { fetchUserContext } = await import("./userContext.js");
  return fetchUserContext(discordUserId);
}

async function handleInboxThis(
  discordUserId: string,
  source: { content: string; guildId?: string | null; channelId: string; id: string },
  channel: Message["channel"],
): Promise<void> {
  const item = await createInboxThis(discordUserId, source);
  const id = itemId(item);
  await replySafe(channel, "Inboxed.", {
    embeds: [taskEmbed(item)],
    components: id ? [itemActionRow(id)] : [],
  });
}

async function handleMessage(message: Message): Promise<void> {
  if (message.guildId) return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) {
    await message
      .reply({
        content: "Unauthorized.",
        allowedMentions: { parse: [], repliedUser: false },
      })
      .catch(() => {});
    return;
  }
  await handleCaptureAndMessage(message);
}

function slashDispatch(interaction: import("discord.js").ChatInputCommandInteraction): Promise<void> {
  switch (interaction.commandName) {
    case "help":
      return handleHelp(interaction);
    case "link":
    case "relink":
      return handleLink(interaction);
    case "timezone":
      return handleTimezone(interaction);
    case "clear":
      return handleClear(interaction);
    case "status":
      return handleStatus(interaction);
    case "today":
    case "inbox":
    case "open":
    case "week":
      return handleView(interaction, interaction.commandName as "today" | "inbox" | "open" | "week");
    case "add":
      return handleAddSlash(interaction);
    case "settings":
      return handleSettingsSlash(interaction);
    default:
      return interaction
        .reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral })
        .then(() => {});
  }
}

export function createBot(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
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
    try {
      await syncCommands(readyClient, join(config.DATA_DIR, "commands-hash.txt"));
    } catch (err) {
      console.error("slash command registration failed", err);
    }
  });

  client.on(Events.InteractionCreate, (interaction) => {
    return (async () => {
      if (interaction.isChatInputCommand()) {
        await withAck(interaction, async () => {
          await slashDispatch(interaction);
        });
        return;
      }
      if (interaction.isButton()) {
        await withAck(
          interaction,
          async () => {
            await routeButton(interaction);
          },
          () => interaction.deferUpdate().then(() => undefined).catch(() => {}),
        );
        return;
      }
      if (interaction.isModalSubmit()) {
        await withAck(interaction, async () => {
          await routeModal(interaction);
        });
        return;
      }
      if (interaction.isMessageContextMenuCommand()) {
        await withAck(interaction, async () => {
          await routeContextMenu(interaction);
        });
      }
    })();
  });

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(message).catch((err) => {
      console.error("Message handler error", err);
    });
  });
}

export async function handleMessageForTest(message: Message): Promise<void> {
  await handleMessage(message);
}
