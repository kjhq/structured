import {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ComponentType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type MessageContextMenuCommandInteraction,
  type TextBasedChannel,
} from "discord.js";
import { config, isAuthorizedUser } from "./config.js";
import { promptFull, type PlannerMutation, type PromptResult } from "./agent.js";
import { clear, historySize, historyKey } from "./store.js";
import { enqueue, queueKey } from "./queue.js";
import { getMcpClient, isMcpConnected, listMcpTools } from "./mcp.js";
import { fetchUserContext } from "./userContext.js";
import { gateMessage } from "./gating.js";
import {
  allowedMentions,
  itemId,
  listEmbed,
  taskEmbed,
  weekEmbed,
  type PlannerItem,
} from "./embeds.js";
import {
  itemActionRow,
  parseCustomId,
  restoreRow,
  type ButtonOp,
} from "./components.js";
import {
  BotApiError,
  getSettings,
  getView,
  patchSettings,
  postAction,
  type UserSettings,
} from "./botApi.js";
import { parseWhen } from "./parseWhen.js";
import {
  createCapturedTasks,
  createInboxThis,
  extractTasksFromImage,
  isImageAttachment,
  isVoiceAttachment,
  transcribeAudio,
  transcribeEnabled,
  visionEnabled,
  captureDecision,
} from "./capture.js";
import { notifyStatusLine } from "./notifyWorker.js";

/** Discord message limit is 2000 chars. */
const DISCORD_CHUNK = 1900;
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
  extras?: { embeds?: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] },
): Promise<void> {
  const body = text?.trim() ? text : extras?.embeds?.length ? "" : "(empty response)";
  const sendOpts = {
    allowedMentions,
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
      try {
        if ("send" in channel) {
          await channel.send({
            content: "(message truncated — send failed)",
            allowedMentions,
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
  "Chat naturally, or use shortcuts:\n" +
  "/today  /inbox  /open  /week  /add  /timezone  /settings\n\n" +
  "Examples:\n" +
  "• add review PR at 3pm tomorrow\n" +
  "• remind me to call the bank in 20 minutes\n" +
  "• ping me 10 minutes before gym\n" +
  "• what's left from yesterday?\n" +
  "• inbox this  (reply to a message, or right-click → Apps)\n\n" +
  "Add = calendar. Remind/ping = calendar + Discord DM.\n" +
  "Briefings are off until /settings briefing.\n\n" +
  "/link — widget credentials via DM\n" +
  "/clear — reset chat memory for this channel";

const slashCommands = [
  new SlashCommandBuilder().setName("help").setDescription("Show help and example prompts"),
  new SlashCommandBuilder().setName("link").setDescription("DM widget credentials (Discord ID + token)"),
  new SlashCommandBuilder()
    .setName("relink")
    .setDescription("Rotate widget token and DM the new one"),
  new SlashCommandBuilder()
    .setName("timezone")
    .setDescription("Show or set your planner timezone")
    .addStringOption((o) =>
      o.setName("zone").setDescription("IANA timezone, e.g. Asia/Kolkata").setRequired(false),
    ),
  new SlashCommandBuilder().setName("status").setDescription("Show model, MCP, and history status"),
  new SlashCommandBuilder().setName("clear").setDescription("Reset conversation history for this channel"),
  new SlashCommandBuilder().setName("today").setDescription("Today's timeline"),
  new SlashCommandBuilder().setName("inbox").setDescription("Undated inbox"),
  new SlashCommandBuilder().setName("open").setDescription("Open backlog (unticked past days)"),
  new SlashCommandBuilder().setName("week").setDescription("Next 7 days"),
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a task without the LLM")
    .addStringOption((o) => o.setName("title").setDescription("Task title").setRequired(true))
    .addStringOption((o) =>
      o.setName("when").setDescription("YYYY-MM-DD, today, tomorrow, HH:MM, or YYYY-MM-DD HH:MM"),
    )
    .addIntegerOption((o) => o.setName("duration").setDescription("Duration in minutes"))
    .addBooleanOption((o) => o.setName("remind").setDescription("DM at start time (default false)")),
  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Planner companion settings")
    .addSubcommand((s) => s.setName("get").setDescription("Show current settings"))
    .addSubcommand((s) =>
      s
        .setName("briefing")
        .setDescription("Morning/evening briefing")
        .addStringOption((o) =>
          o
            .setName("which")
            .setDescription("morning, evening, or off")
            .setRequired(true)
            .addChoices(
              { name: "morning", value: "morning" },
              { name: "evening", value: "evening" },
              { name: "off", value: "off" },
            ),
        )
        .addStringOption((o) => o.setName("time").setDescription("HH:MM local")),
    )
    .addSubcommand((s) =>
      s
        .setName("quiet")
        .setDescription("Quiet hours (both required; same value clears)")
        .addStringOption((o) => o.setName("start").setDescription("HH:MM").setRequired(true))
        .addStringOption((o) => o.setName("end").setDescription("HH:MM").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("guild")
        .setDescription("When the bot listens in servers")
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("all, mention, or channel")
            .setRequired(true)
            .addChoices(
              { name: "all", value: "all" },
              { name: "mention", value: "mention" },
              { name: "channel", value: "channel" },
            ),
        )
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Required for mode=channel").addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("reminders")
        .setDescription("Master switch for alert DMs")
        .addBooleanOption((o) =>
          o.setName("enabled").setDescription("On or off").setRequired(true),
        ),
    ),
  new ContextMenuCommandBuilder().setName("Inbox this").setType(ApplicationCommandType.Message),
].map((cmd) => cmd.toJSON());

async function unauthorizedReply(
  target: ChatInputCommandInteraction | Message | ButtonInteraction | MessageContextMenuCommandInteraction,
): Promise<void> {
  if ("reply" in target && "commandName" in target) {
    await target.reply({ content: "Unauthorized.", flags: MessageFlags.Ephemeral });
    return;
  }
  if ("isButton" in target && typeof target.isButton === "function") {
    await target.reply({ content: "Unauthorized.", flags: MessageFlags.Ephemeral });
    return;
  }
  // Non-allowlisted users in guilds stay silent — no spam in servers.
  if ("guild" in target && target.guild) {
    return;
  }
  if ("reply" in target) {
    await target.reply({
      content: "Unauthorized.",
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
}

function stripBotMention(text: string, botId: string): string {
  return text.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
}

function formatSettings(s: UserSettings): string {
  return [
    `timezone: ${s.timezone}`,
    `day_starts_at: ${s.day_starts_at ?? "00:00"}`,
    `briefing morning: ${s.briefing_morning_time ?? "off"}`,
    `briefing evening: ${s.briefing_evening_time ?? "off"}`,
    `quiet: ${s.quiet_hours_start && s.quiet_hours_end ? `${s.quiet_hours_start}–${s.quiet_hours_end}` : "off"}`,
    `reminders: ${s.reminders_enabled ? "on" : "off"}`,
    `capture images/voice: ${s.capture_images ? "on" : "off"}/${s.capture_voice ? "on" : "off"}`,
  ].join("\n");
}

async function handleStatus(discordUserId: string, channelId: string): Promise<string> {
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
    `MCP connected: ${isMcpConnected(discordUserId) ? "yes" : "no"}`,
    `MCP tools: ${toolCount}`,
    `History messages: ${historySize(key)}`,
    notifyStatusLine(),
  ].join("\n");
}

export async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const base = config.API_BASE_URL.replace(/\/$/, "");

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

function rowsFromMutations(mutations: PlannerMutation[]): ActionRowBuilder<ButtonBuilder>[] {
  const last = mutations.at(-1);
  if (!last) return [];
  if (last.name === "planner_delete_tasks") {
    const ids = last.data.deleted;
    const id = Array.isArray(ids) ? String(ids[0] ?? "") : "";
    if (id) return [restoreRow(id)];
  }
  if (last.name === "planner_create_task" || last.name === "planner_reschedule") {
    const id = String(last.data.task_id ?? last.data.id ?? "");
    if (id) return [itemActionRow(id, { occurrence: id.startsWith("occ_") })];
  }
  if (last.name === "planner_complete_tasks") {
    const first = Array.isArray(last.data.completed) ? last.data.completed[0] : null;
    const id =
      first && typeof first === "object"
        ? String((first as { task_id?: string }).task_id ?? "")
        : "";
    if (id) return [itemActionRow(id, { completed: true, occurrence: id.startsWith("occ_") })];
  }
  return [];
}

function asItems(raw: unknown): PlannerItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is PlannerItem => Boolean(x) && typeof x === "object");
}

async function handlePrompt(
  channel: TextBasedChannel,
  channelId: string,
  text: string,
  discordUserId: string,
  clientRequestId?: string,
): Promise<void> {
  await enqueue(`user:${discordUserId}`, async () => {
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
          err instanceof Error &&
          (err.name === "TimeoutError" ||
            err.message.toLowerCase().includes("timeout"))
            ? "Request timed out (LLM or planner MCP). Try again in a moment."
            : "Error processing your request. Try again.";
        if ("send" in channel) {
          await channel
            .send({ content: msg, allowedMentions })
            .catch(() => {});
        }
      } finally {
        clearInterval(typing);
      }
    });
  });
}

export async function handleView(
  interaction: ChatInputCommandInteraction,
  which: "today" | "inbox" | "open" | "week",
): Promise<void> {
  await interaction.deferReply();
  const data = await getView(interaction.user.id, which);
  const items = asItems(data.items);
  if (which === "week") {
    const streaks = Array.isArray(data.streaks)
      ? (data.streaks as Array<{ title?: string; done?: number; expected?: number }>)
      : [];
    await interaction.editReply({
      embeds: [weekEmbed(items, streaks)],
      allowedMentions,
    });
    return;
  }
  const titles = {
    today: "Today",
    inbox: "Inbox",
    open: "Open backlog",
  };
  const empty = {
    today: "Nothing on today.",
    inbox: "Inbox is empty. Add a title with /add, or chat a reminder.",
    open: "No leftover dated tasks.",
  };
  let extra =
    which === "inbox"
      ? "Use /add when: … to schedule, or ask in chat."
      : undefined;
  if (which === "today") {
    const [inbox, open] = await Promise.all([
      getView(interaction.user.id, "inbox"),
      getView(interaction.user.id, "open"),
    ]);
    extra = `inbox ${asItems(inbox.items).length} · open ${asItems(open.items).length}`;
  }
  const incomplete = items.filter((i) => !i.completed_at).slice(0, 5);
  const rows = incomplete
    .map((i) => itemId(i))
    .filter(Boolean)
    .slice(0, 1)
    .map((id) => itemActionRow(id, { occurrence: id.startsWith("occ_") }));
  await interaction.editReply({
    embeds: [listEmbed(titles[which], items, empty[which], extra)],
    components: rows,
    allowedMentions,
  });
}

async function handleAddSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
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
        : "";
    await interaction.editReply({
      content: warn || undefined,
      embeds: [taskEmbed(created)],
      components: id ? [itemActionRow(id, { occurrence: id.startsWith("occ_") })] : [],
      allowedMentions,
    });
  } catch (err) {
    await interaction.editReply(err instanceof Error ? err.message.slice(0, 400) : "Add failed.");
  }
}

async function handleSettingsSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (sub === "get") {
      const s = await getSettings(interaction.user.id);
      await interaction.editReply(formatSettings(s));
      return;
    }
    const body: Record<string, unknown> = {};
    if (sub === "briefing") {
      const which = interaction.options.getString("which", true);
      const clock = interaction.options.getString("time");
      if (which === "off") {
        body.briefing_morning_time = null;
        body.briefing_evening_time = null;
      } else if (!clock) {
        await interaction.editReply("Provide time as HH:MM, or which=off.");
        return;
      } else if (which === "morning") {
        body.briefing_morning_time = clock;
      } else {
        body.briefing_evening_time = clock;
      }
    } else if (sub === "quiet") {
      const start = interaction.options.getString("start", true);
      const end = interaction.options.getString("end", true);
      if (start === end) {
        body.quiet_hours_start = null;
        body.quiet_hours_end = null;
      } else {
        body.quiet_hours_start = start;
        body.quiet_hours_end = end;
      }
    } else if (sub === "guild") {
      const mode = interaction.options.getString("mode", true);
      body.guild_mode = mode;
      const channel = interaction.options.getChannel("channel");
      if (channel) body.planner_channel_id = channel.id;
    } else if (sub === "reminders") {
      body.reminders_enabled = interaction.options.getBoolean("enabled", true);
    }
    const s = await patchSettings(interaction.user.id, body);
    await interaction.editReply(formatSettings(s));
  } catch (err) {
    await interaction.editReply(err instanceof Error ? err.message.slice(0, 400) : "Settings failed.");
  }
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAuthorizedUser(interaction.user.id)) {
    await unauthorizedReply(interaction);
    return;
  }

  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  switch (interaction.commandName) {
    case "help":
      await interaction.reply({
        content: HELP_TEXT,
        flags: MessageFlags.Ephemeral,
      });
      break;
    case "link":
    case "relink":
      await handleLink(interaction);
      break;
    case "timezone": {
      const zone = interaction.options.getString("zone");
      if (zone) {
        await interaction.deferReply();
        const s = await patchSettings(userId, { timezone: zone });
        const ctx = await fetchUserContext(userId);
        await interaction.editReply(
          `Timezone set to \`${s.timezone}\` (logical today: ${ctx.today}). Times stay civil-local.`,
        );
        break;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const ctx = await fetchUserContext(userId);
      await interaction.editReply(
        `Your server timezone is \`${ctx.timezone}\` (logical today: ${ctx.today}). ` +
          `Bot default for new users on /link is \`${config.TIMEZONE}\`.`,
      );
      break;
    }
    case "clear": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await enqueue(queueKey(userId, channelId), async () => {
        clear(historyKey(userId, channelId));
      });
      await interaction.editReply("Conversation history cleared.");
      break;
    }
    case "status": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(await handleStatus(userId, channelId));
      break;
    }
    case "today":
    case "inbox":
    case "open":
    case "week":
      await handleView(interaction, interaction.commandName);
      break;
    case "add":
      await handleAddSlash(interaction);
      break;
    case "settings":
      await handleSettingsSlash(interaction);
      break;
    default:
      await interaction.reply("Unknown command.");
  }
}

function apiErrorMessage(err: unknown): string {
  if (err instanceof BotApiError) {
    if (err.status === 404) return "Already gone.";
    if (/undo_expired/.test(err.body)) return "Undo expired.";
    if (err.status === 403) return "Not your task.";
    return err.message.slice(0, 300);
  }
  return err instanceof Error ? err.message.slice(0, 300) : "Action failed.";
}

async function runButtonOp(userId: string, op: ButtonOp, id?: string): Promise<void> {
  switch (op) {
    case "c":
      if (!id) throw new Error("missing id");
      await postAction(userId, "complete", { id });
      return;
    case "u":
      if (!id) throw new Error("missing id");
      await postAction(userId, "uncomplete", { id });
      return;
    case "z":
      if (!id) throw new Error("missing id");
      await postAction(userId, "snooze", { id, minutes: 60 });
      return;
    case "t":
      if (!id) throw new Error("missing id");
      await postAction(userId, "snooze", { id, tomorrow: true });
      return;
    case "k":
      if (!id) throw new Error("missing id");
      await postAction(userId, "skip", { occurrence_id: id });
      return;
    case "r":
      if (!id) throw new Error("missing id");
      await postAction(userId, "restore", { task_id: id, id });
      return;
    case "ml":
      await postAction(userId, "move-open", {});
      return;
    default:
      throw new Error("unknown op");
  }
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (!isAuthorizedUser(interaction.user.id)) {
    await unauthorizedReply(interaction);
    return;
  }
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.kind !== "item") {
    await interaction.reply({ content: "Unknown button.", flags: MessageFlags.Ephemeral });
    return;
  }
  await enqueue(`user:${interaction.user.id}`, async () => {
    try {
      await runButtonOp(interaction.user.id, parsed.op, parsed.id);
      const embeds = interaction.message.embeds.map((e) => {
        const b = EmbedBuilder.from(e);
        if (parsed.op === "c" && b.data.title) b.setTitle(`~~${b.data.title.replace(/~~/g, "")}~~`);
        if (parsed.op === "u" && b.data.title) b.setTitle(b.data.title.replace(/~~/g, ""));
        return b;
      });
      let components: ActionRowBuilder<ButtonBuilder>[];
      if (parsed.op === "c" && parsed.id) {
        components = [itemActionRow(parsed.id, { completed: true, occurrence: parsed.id.startsWith("occ_") })];
      } else if (parsed.op === "u" && parsed.id) {
        components = [itemActionRow(parsed.id, { occurrence: parsed.id.startsWith("occ_") })];
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
      await interaction.update({
        embeds,
        components,
        allowedMentions,
      });
    } catch (err) {
      const msg = apiErrorMessage(err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      if (/Undo expired/.test(msg)) {
        const expired = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("s1:noop")
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

async function handleInboxThis(
  discordUserId: string,
  source: { content: string; guildId?: string | null; channelId: string; id: string },
  channel: TextBasedChannel,
): Promise<void> {
  const item = await createInboxThis(discordUserId, source);
  const id = itemId(item);
  await replySafe(channel, "Inboxed.", {
    embeds: [taskEmbed(item)],
    components: id ? [itemActionRow(id)] : [],
  });
}

async function handleContextMenu(interaction: MessageContextMenuCommandInteraction): Promise<void> {
  if (!isAuthorizedUser(interaction.user.id)) {
    await unauthorizedReply(interaction);
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

async function handleCaptureAndMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  const botId = message.client?.user?.id;
  let settings: UserSettings | null = null;
  if (isAuthorizedUser(message.author.id)) {
    try {
      settings = await getSettings(message.author.id);
    } catch {
      settings = null;
    }
  }
  let gate = gateMessage(message, null, botId);
  if (gate === "unauthorized") {
    await unauthorizedReply(message);
    return;
  }
  if (gate === "silent" && message.guild && botId && message.reference?.messageId) {
    // mentions.repliedUser can be missing — resolve the reply target directly.
    try {
      const ref = await message.fetchReference();
      if (ref.author?.id === botId) gate = "handle";
    } catch {
      // not a reply to the bot
    }
  }
  if (gate === "silent") return;

  const channel = message.channel;
  if (!channel.isTextBased()) return;

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
      const ctx = await fetchUserContext(message.author.id);
      const tasks = await extractTasksFromImage(
        images[0].url,
        message.content.trim(),
        ctx.timezone,
        ctx.today,
      );
      if (tasks.length === 0) {
        await replySafe(channel, "I couldn’t find tasks in that image.");
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
      await replySafe(channel, "I couldn’t find tasks in that image.");
    }
    return;
  }

  if (decision === "voice") {
    try {
      const transcript = await transcribeAudio(voices[0].url, voices[0].name ?? "voice.ogg");
      if (!transcript) {
        await replySafe(channel, "I couldn’t transcribe that.");
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
  const me = message.client.user;
  if (me && message.guild) {
    text = stripBotMention(text, me.id);
    if (!text) return;
  }
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

export function createBot(): Client {
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
    try {
      if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
        return;
      }
      if (interaction.isButton()) {
        await handleButton(interaction);
        return;
      }
      if (interaction.isMessageContextMenuCommand()) {
        await handleContextMenu(interaction);
      }
    } catch (err) {
      console.error("Interaction error", err);
      if (interaction.isRepliable()) {
        const reply = interaction.replied || interaction.deferred
          ? interaction.followUp.bind(interaction)
          : interaction.reply.bind(interaction);
        await reply({
          content: "Something went wrong. Try again.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleCaptureAndMessage(message);
    } catch (err) {
      console.error("Message handler error", err);
      await message.reply("Something went wrong. Try again.").catch(() => {});
    }
  });
}

export async function handleMessageForTest(message: Message): Promise<void> {
  await handleCaptureAndMessage(message);
}
