import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "fs";
import { Events } from "discord.js";
import { installTestEnv, restoreTestEnv } from "./test/fixtures.js";
import {
  READY_PATH,
  attachGatewayHealth,
  clearReady,
  markReady,
} from "./ready.js";

describe("gateway ready marker", () => {
  before(() => installTestEnv());
  after(() => restoreTestEnv());

  beforeEach(() => {
    clearReady();
  });

  it("markReady writes the health file and clearReady removes it", () => {
    markReady();
    assert.equal(existsSync(READY_PATH), true);
    clearReady();
    assert.equal(existsSync(READY_PATH), false);
  });

  it("writes ready on ClientReady and clears on error or invalidated", async () => {
    const events = new Map<string, Array<(...args: unknown[]) => unknown>>();
    const fakeClient = {
      once: (event: string, fn: (...args: unknown[]) => unknown) => {
        const list = events.get(event) ?? [];
        list.push(fn);
        events.set(event, list);
      },
      on: (event: string, fn: (...args: unknown[]) => unknown) => {
        const list = events.get(event) ?? [];
        list.push(fn);
        events.set(event, list);
      },
      destroy: async () => {},
    };

    attachGatewayHealth(fakeClient as never);
    assert.equal(existsSync(READY_PATH), false);

    await events.get(Events.ClientReady)![0]();
    assert.equal(existsSync(READY_PATH), true);

    await events.get(Events.Error)![0](new Error("gateway"));
    assert.equal(existsSync(READY_PATH), false);

    markReady();
    await events.get(Events.Invalidated)![0]();
    assert.equal(existsSync(READY_PATH), false);

    markReady();
    await events.get(Events.ShardDisconnect)![0]();
    assert.equal(existsSync(READY_PATH), false);

    await events.get(Events.ShardResume)![0]();
    assert.equal(existsSync(READY_PATH), true);
  });

  it("gracefulShutdown clears the ready file and awaits destroy", async () => {
    markReady();
    let destroyed = false;
    const fakeClient = {
      destroy: async () => {
        destroyed = true;
      },
    };
    const { gracefulShutdown } = await import("./ready.js");
    await gracefulShutdown(fakeClient as never);
    assert.equal(destroyed, true);
    assert.equal(existsSync(READY_PATH), false);
  });
});

after(() => {
  try {
    unlinkSync(READY_PATH);
  } catch {
    // ignore
  }
});
