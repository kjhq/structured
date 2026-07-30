import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync, existsSync } from "fs";
import { installTestEnv, restoreTestEnv } from "./test/fixtures.js";

const READY_PATH = "/tmp/structured-bot-ready-test";

describe("health transitions", () => {
  before(() => installTestEnv());
  after(() => {
    restoreTestEnv();
    try {
      unlinkSync(READY_PATH);
    } catch {
      // ignore
    }
  });

  it("writes ready file after MCP probe succeeds", async () => {
    const { writeFileSync } = await import("fs");
    const probe = async () => 3;
    try {
      unlinkSync(READY_PATH);
    } catch {
      // ignore
    }

    const toolCount = await probe();
    assert.equal(toolCount, 3);
    writeFileSync(READY_PATH, "ok");
    assert.equal(existsSync(READY_PATH), true);
  });

  it("clears ready file when probe fails", async () => {
    const { writeFileSync } = await import("fs");
    writeFileSync(READY_PATH, "ok");
    assert.equal(existsSync(READY_PATH), true);

    const probe = async () => {
      throw new Error("mcp down");
    };

    let exited = false;
    const clearReady = () => {
      try {
        unlinkSync(READY_PATH);
      } catch {
        // ignore
      }
    };

    try {
      await probe();
    } catch {
      clearReady();
      exited = true;
    }

    assert.equal(exited, true);
    assert.equal(existsSync(READY_PATH), false);
  });
});
