import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import {
  ApplicationCommandType,
  ChannelType,
  ContextMenuCommandBuilder,
  SlashCommandBuilder,
  type Client,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";

export function buildCommands(): RESTPostAPIApplicationCommandsJSONBody[] {
  return [
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
    new SlashCommandBuilder().setName("clear").setDescription("Reset conversation history for this chat"),
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
      .addSubcommand((s) => s.setName("get").setDescription("Open the interactive settings panel"))
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
          .setName("reminders")
          .setDescription("Master switch for alert DMs")
          .addBooleanOption((o) =>
            o.setName("enabled").setDescription("On or off").setRequired(true),
          ),
      ),
    new ContextMenuCommandBuilder().setName("Inbox this").setType(ApplicationCommandType.Message),
  ].map((cmd) => cmd.toJSON());
}

export function commandsFingerprint(cmds: RESTPostAPIApplicationCommandsJSONBody[]): string {
  return createHash("sha256").update(JSON.stringify(cmds)).digest("hex");
}

/**
 * Push global commands only when their fingerprint changed. Avoids the
 * bulk-overwrite on every restart that leaves clients with stale caches.
 */
export async function syncCommands(client: Client, fingerprintPath: string): Promise<boolean> {
  const cmds = buildCommands();
  const fp = commandsFingerprint(cmds);
  let prev: string | null = null;
  try {
    prev = readFileSync(fingerprintPath, "utf8").trim();
  } catch {
    prev = null;
  }
  if (prev === fp) return false;
  if (!client.application) throw new Error("client.application unavailable before login");
  await client.application.commands.set(cmds);
  writeFileSync(fingerprintPath, fp);
  console.log(`Slash commands updated (${cmds.length}); fingerprint ${fp.slice(0, 12)}`);
  return true;
}

export const CHANNEL_TYPE_GUILD_TEXT = ChannelType.GuildText;
