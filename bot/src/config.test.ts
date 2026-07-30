import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { installTestEnv, restoreTestEnv, TEST_ENV } from "./test/fixtures.js";

describe("config fixtures", () => {
  before(() => installTestEnv());
  after(() => restoreTestEnv());

  it("uses explicit test env values, not production secrets", async () => {
    const { config } = await import("./config.js");
    assert.equal(config.DISCORD_BOT_TOKEN, TEST_ENV.DISCORD_BOT_TOKEN);
    assert.equal(config.LLM_API_KEY, TEST_ENV.LLM_API_KEY);
    assert.equal(config.BOT_API_SECRET, TEST_ENV.BOT_API_SECRET);
    assert.equal(config.AUTHORIZED_USER_IDS, TEST_ENV.AUTHORIZED_USER_IDS);
  });
});
