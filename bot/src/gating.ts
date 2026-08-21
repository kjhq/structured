import { isAuthorizedUser } from "./config.js";

export type GuildMode = "all" | "mention" | "channel";

export interface GatingSettings {
  guild_mode?: string | null;
  planner_channel_id?: string | null;
}

export interface GatingMessage {
  author: { bot: boolean; id: string };
  channelId: string;
  channel?: { isDMBased?: () => boolean };
  mentions?: {
    users?: { has: (id: string) => boolean };
    repliedUser?: { id: string } | null;
  };
  reference?: unknown;
}

export type GateResult = "handle" | "silent" | "unauthorized";

function isDm(message: GatingMessage): boolean {
  try {
    return Boolean(message.channel?.isDMBased?.());
  } catch {
    return false;
  }
}

export function botWasAddressed(message: GatingMessage, botUserId: string): boolean {
  if (message.mentions?.users?.has(botUserId)) return true;
  if (message.mentions?.repliedUser?.id === botUserId) return true;
  const ref = message.reference as { resolved?: { author?: { id: string } } } | null | undefined;
  if (ref?.resolved?.author?.id === botUserId) return true;
  return false;
}

export function gateMessage(
  message: GatingMessage,
  settings: GatingSettings | null,
  botUserId: string | undefined,
): GateResult {
  if (message.author.bot) return "silent";
  if (!isAuthorizedUser(message.author.id)) return "unauthorized";
  if (isDm(message)) return "handle";

  const mode = (settings?.guild_mode ?? "all") as GuildMode;
  if (mode === "all") return "handle";

  if (mode === "mention") {
    if (botUserId && botWasAddressed(message, botUserId)) return "handle";
    return "silent";
  }

  if (mode === "channel") {
    if (settings?.planner_channel_id && message.channelId === settings.planner_channel_id) {
      return "handle";
    }
    if (botUserId && botWasAddressed(message, botUserId)) return "handle";
    return "silent";
  }

  return "handle";
}
