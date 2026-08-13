import { createBot } from "./bot.js";
import { config } from "./config.js";
import { probeMcp } from "./mcp.js";
import {
  attachGatewayHealth,
  clearReady,
  gracefulShutdown,
} from "./ready.js";

const bot = createBot();
attachGatewayHealth(bot);

process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection", err);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err);
  clearReady();
  process.exit(1);
});
process.once("SIGINT", () => {
  void gracefulShutdown(bot).finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void gracefulShutdown(bot).finally(() => process.exit(0));
});

async function main(): Promise<void> {
  console.log(`Connecting to planner MCP at ${config.MCP_URL}…`);
  try {
    const toolCount = await probeMcp();
    console.log(`MCP ready (${toolCount} tools)`);
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
}

main().catch((err) => {
  console.error("Failed to start bot", err);
  clearReady();
  process.exit(1);
});
