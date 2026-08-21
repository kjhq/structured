import { startCompanionLoops, stopCompanionLoops } from "./notifyWorker.js";
import { unlinkSync, writeFileSync } from "fs";
import { createBot } from "./bot.js";
import { config } from "./config.js";
import { probeMcp } from "./mcp.js";

const READY_PATH = "/tmp/structured-bot-ready";

const bot = createBot();

function clearReady(): void {
  try {
    unlinkSync(READY_PATH);
  } catch {
    // ignore
  }
}

process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection", err);
  clearReady();
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err);
  clearReady();
  process.exit(1);
});
process.once("SIGINT", () => {
  clearReady();
  stopCompanionLoops();
  bot.destroy();
  process.exit(0);
});
process.once("SIGTERM", () => {
  clearReady();
  stopCompanionLoops();
  bot.destroy();
  process.exit(0);
});

async function main(): Promise<void> {
  console.log(`Connecting to planner MCP at ${config.MCP_URL}…`);
  try {
    const toolCount = await probeMcp();
    console.log(`MCP ready (${toolCount} tools)`);
    writeFileSync(READY_PATH, "ok");
  } catch (err) {
    clearReady();
    console.error(
      "MCP unavailable — refusing to start. Ensure backend is up and BOT_API_SECRET matches.",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  console.log("Starting Discord bot…");
  await bot.login(config.DISCORD_BOT_TOKEN);
  startCompanionLoops(bot);
}

main().catch((err) => {
  console.error("Failed to start bot", err);
  clearReady();
  process.exit(1);
});
