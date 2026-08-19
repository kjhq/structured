import { config } from "./config.js";

const TIMEOUT_MS = 15_000;

export class BotApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Bot API ${status}: ${body.slice(0, 180)}`);
    this.name = "BotApiError";
  }
}

function base(): string {
  return config.API_BASE_URL.replace(/\/$/, "");
}

function headers(discordId?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Bot-Secret": config.BOT_API_SECRET,
  };
  if (discordId) h["X-Discord-Id"] = discordId;
  return h;
}

async function request(
  path: string,
  init: RequestInit & { discordId?: string } = {},
): Promise<unknown> {
  const { discordId, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...rest,
      headers: { ...headers(discordId), ...(rest.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new BotApiError(0, err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  if (!res.ok) {
    throw new BotApiError(res.status, text);
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export type UserSettings = {
  timezone: string;
  day_starts_at?: string;
  briefing_morning_time?: string | null;
  briefing_evening_time?: string | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  reminders_enabled: boolean;
  overdue_enabled?: boolean;
  guild_mode: string;
  planner_channel_id?: string | null;
  capture_images: boolean;
  capture_voice: boolean;
  presence_enabled: boolean;
};

const settingsCache = new Map<string, { value: UserSettings; expires: number }>();
const SETTINGS_TTL_MS = 15_000;

export function invalidateSettings(discordId: string): void {
  settingsCache.delete(discordId);
}

export async function getSettings(discordId: string): Promise<UserSettings> {
  const hit = settingsCache.get(discordId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = (await request("/v1/bot/settings", { discordId })) as UserSettings;
  settingsCache.set(discordId, { value, expires: Date.now() + SETTINGS_TTL_MS });
  return value;
}

export async function patchSettings(
  discordId: string,
  body: Record<string, unknown>,
): Promise<UserSettings> {
  const value = (await request("/v1/bot/settings", {
    method: "PATCH",
    discordId,
    body: JSON.stringify(body),
  })) as UserSettings;
  settingsCache.set(discordId, { value, expires: Date.now() + SETTINGS_TTL_MS });
  return value;
}

export async function getView(
  discordId: string,
  which: "today" | "inbox" | "open" | "week",
): Promise<Record<string, unknown>> {
  return (await request(`/v1/bot/views/${which}`, { discordId })) as Record<string, unknown>;
}

export async function postAction(
  discordId: string,
  action:
    | "complete"
    | "uncomplete"
    | "snooze"
    | "skip"
    | "restore"
    | "add"
    | "move-open",
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (await request(`/v1/bot/actions/${action}`, {
    method: "POST",
    discordId,
    body: JSON.stringify(body),
  })) as Record<string, unknown>;
}

export type DueItem = {
  delivery_id: string;
  discord_id?: string;
  kind?: string;
  embed?: {
    title?: string;
    description?: string;
    color?: string;
    fields?: Array<{ name: string; value: string }>;
  };
  buttons?: string[];
  task_id?: string | null;
  occurrence_id?: string | null;
};

export async function notificationsDue(limit = 50): Promise<DueItem[]> {
  const data = (await request(`/v1/bot/notifications/due?limit=${limit}`)) as {
    items?: DueItem[];
  };
  return data.items ?? [];
}

export async function ackDelivery(id: string, discordMessageId: string): Promise<void> {
  await request(`/v1/bot/notifications/${id}/ack`, {
    method: "POST",
    body: JSON.stringify({ discord_message_id: discordMessageId }),
  });
}

export async function failDelivery(id: string, reason: string): Promise<void> {
  await request(`/v1/bot/notifications/${id}/fail`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function unclaimDelivery(id: string): Promise<void> {
  await request(`/v1/bot/notifications/${id}/unclaim`, { method: "POST" });
}
