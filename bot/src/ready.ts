import { unlinkSync, writeFileSync } from "fs";
import { Events, type Client } from "discord.js";

export const READY_PATH =
  process.env.BOT_READY_PATH?.trim() || "/tmp/structured-bot-ready";

export function markReady(): void {
  writeFileSync(READY_PATH, "ok");
}

export function clearReady(): void {
  try {
    unlinkSync(READY_PATH);
  } catch {
    // ignore
  }
}

type HealthClient = Pick<Client, "once" | "on">;

/** Health file is true only while the Discord gateway is up. */
export function attachGatewayHealth(client: HealthClient): void {
  client.once(Events.ClientReady, () => {
    markReady();
  });
  client.on(Events.Error, () => {
    clearReady();
  });
  client.on(Events.Invalidated, () => {
    clearReady();
  });
  client.on(Events.ShardDisconnect, () => {
    clearReady();
  });
  client.on(Events.ShardResume, () => {
    markReady();
  });
  client.on(Events.ShardReady, () => {
    markReady();
  });
}

export async function gracefulShutdown(bot: {
  destroy: () => Promise<void>;
}): Promise<void> {
  clearReady();
  try {
    await bot.destroy();
  } catch {
    // ignore
  }
}
