import { writeFileSync } from "fs";
import { createBot } from "./bot.js";
import { config } from "./config.js";
import { getMcpClient, listMcpTools } from "./mcp.js";

const READY_PATH = "/tmp/structured-bot-ready";

const bot = createBot();

process.on("unhandledRejection", (err) =>
  console.error("unhandledRejection", err),
);
process.on("uncaughtException", (err) =>
  console.error("uncaughtException", err),
);
process.once("SIGINT", () => {
  bot.destroy();
  process.exit(0);
});
process.once("SIGTERM", () => {
  bot.destroy();
  process.exit(0);
});

async function main(): Promise<void> {
  console.log(`Connecting to planner MCP at ${config.MCP_URL}…`);
  try {
    await getMcpClient();
    const tools = await listMcpTools(true);
    console.log(`MCP ready (${tools.length} tools)`);
    try {
      writeFileSync(READY_PATH, "ok");
    } catch (err) {
      console.warn("Could not write ready file:", err);
    }
  } catch (err) {
    console.warn(
      "MCP unavailable — Discord will still start. Ensure backend is up and STRUCTURED_API_KEY is valid.",
      err instanceof Error ? err.message : err,
    );
  }

  console.log("Starting Discord bot…");
  await bot.login(config.DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  console.error("Failed to start bot", err);
  process.exit(1);
});
