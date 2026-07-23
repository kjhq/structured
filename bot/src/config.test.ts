import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("config", () => {
  it("exports config with default values", async () => {
    const { config } = await import("./config.js");
    assert.ok(typeof config.DISCORD_BOT_TOKEN === "string");
    assert.ok(config.DISCORD_BOT_TOKEN.length > 0);
    assert.ok(typeof config.LLM_API_KEY === "string");
    assert.ok(config.LLM_API_KEY.length > 0);
  });
});
