import { ActivityType, type Client, type User } from "discord.js";
import { authorizedUserIds, config } from "./config.js";
import {
  ackDelivery,
  failDelivery,
  getSettings,
  getView,
  notificationsDue,
  unclaimDelivery,
  type DueItem,
} from "./botApi.js";
import { allowedMentions, notifyEmbed } from "./embeds.js";
import { rowsFromNotifyButtons } from "./components.js";
import { enqueue } from "./queue.js";

const SEND_CAP = 5;

export type NotifyStatus = {
  ok: boolean;
  at: number;
  error?: string;
  lastCount?: number;
};

let status: NotifyStatus = { ok: true, at: 0 };
let pollTimer: ReturnType<typeof setInterval> | null = null;
let presenceTimer: ReturnType<typeof setInterval> | null = null;

export function notifyStatusLine(): string {
  if (config.NOTIFY_POLL_MS === 0) return "notify: off";
  if (!status.at) return "notify: starting";
  const ageSec = Math.max(0, Math.round((Date.now() - status.at) / 1000));
  if (!status.ok) return `notify: error (${status.error ?? "unknown"}, ${ageSec}s ago)`;
  return `notify: ok ${ageSec}s ago` + (status.lastCount != null ? ` (${status.lastCount} sent)` : "");
}

async function sendOne(client: Client, item: DueItem): Promise<void> {
  const discordId = item.discord_id;
  if (!discordId || !item.delivery_id) return;
  await enqueue(`notify:${discordId}`, async () => {
    let user: User;
    try {
      user = await client.users.fetch(discordId);
    } catch {
      // Leave claimed so the 60s lease retries (spec 7.6 discord_4xx).
      return;
    }
    const id = item.occurrence_id || item.task_id;
    const components = rowsFromNotifyButtons(item.buttons, item.task_id, item.occurrence_id);
    try {
      const msg = await user.send({
        embeds: [notifyEmbed(item.embed ?? { title: "Reminder" })],
        components,
        allowedMentions,
      });
      await ackDelivery(item.delivery_id, msg.id);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      const dmsClosed =
        /50007|403|400|Cannot send messages to this user|Cannot send messages|Missing Access/i.test(
          text,
        );
      if (dmsClosed) {
        await failDelivery(item.delivery_id, "dms_closed").catch(() => {});
      }
      // Other Discord 4xx: leave claimed so lease expiry retries.
    }
    void id;
  });
}

export async function pollDue(client: Client): Promise<void> {
  try {
    const items = await notificationsDue(50);
    const byUser = new Map<string, DueItem[]>();
    for (const item of items) {
      const uid = item.discord_id;
      if (!uid) continue;
      const list = byUser.get(uid) ?? [];
      list.push(item);
      byUser.set(uid, list);
    }
    let sent = 0;
    for (const [, list] of byUser) {
      const batch = list.slice(0, SEND_CAP);
      const rest = list.slice(SEND_CAP);
      for (const item of rest) {
        await unclaimDelivery(item.delivery_id).catch(() => {});
      }
      for (const item of batch) {
        await sendOne(client, item);
        sent += 1;
      }
    }
    status = { ok: true, at: Date.now(), lastCount: sent };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    status = { ok: false, at: Date.now(), error: text.slice(0, 120) };
    console.error("notify poll failed", err);
  }
}

async function tickPresence(client: Client): Promise<void> {
  const ids = authorizedUserIds();
  if (ids.length !== 1 || !client.user) return;
  const discordId = ids[0];
  try {
    const settings = await getSettings(discordId);
    if (!settings.presence_enabled) {
      await client.user.setPresence({ activities: [] });
      return;
    }
    const today = (await getView(discordId, "today")) as {
      items?: Array<{ title?: string; start_time?: string; completed_at?: string | null }>;
    };
    const inbox = (await getView(discordId, "inbox")) as { items?: unknown[] };
    const next = (today.items ?? []).find((i) => i.start_time && !i.completed_at);
    const name = next?.title
      ? `${(next.start_time ?? "").slice(0, 5)} ${next.title}`.trim()
      : `inbox (${(inbox.items ?? []).length})`;
    await client.user.setActivity({ name: name.slice(0, 120), type: ActivityType.Watching });
  } catch (err) {
    console.error("presence tick failed", err);
  }
}

export function startCompanionLoops(client: Client): void {
  if (config.NOTIFY_POLL_MS > 0) {
    void pollDue(client);
    pollTimer = setInterval(() => {
      void pollDue(client);
    }, config.NOTIFY_POLL_MS);
  }
  presenceTimer = setInterval(() => {
    void tickPresence(client);
  }, 60_000);
  void tickPresence(client);
}

export function stopCompanionLoops(): void {
  if (pollTimer) clearInterval(pollTimer);
  if (presenceTimer) clearInterval(presenceTimer);
  pollTimer = null;
  presenceTimer = null;
}
