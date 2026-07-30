import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { prompt, setChatImplForTest } from "./agent.js";
import {
  setMcpClientFactoryForTest,
  resetAllMcpSessionsForTest,
} from "./mcp.js";
import { load, resetAll, resetDateTracking, historyKey } from "./store.js";
import { setFetchUserContextForTest } from "./userContext.js";
import type { LLMMessage } from "./llm.js";
import {
  FIXTURE_CHANNEL,
  FIXTURE_USERS,
  installTestEnv,
  restoreTestEnv,
} from "./test/fixtures.js";

function overviewClient(userId: string, timezone: string, today: string): Client {
  const toolCalls: string[] = [];
  return {
    connect: async () => {},
    close: async () => {},
    listTools: async () => ({
      tools: [{ name: "planner_get_overview", inputSchema: { type: "object" } }],
    }),
    callTool: async ({ name }: { name: string }) => {
      toolCalls.push(`${userId}:${name}`);
      if (name === "planner_get_overview") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ timezone, today, today_count: 0 }),
            },
          ],
        };
      }
      return { content: [{ type: "text", text: "{}" }] };
    },
    __toolCalls: toolCalls,
  } as unknown as Client & { __toolCalls: string[] };
}

describe("agent integration", () => {
  before(() => installTestEnv());
  after(() => restoreTestEnv());

  beforeEach(async () => {
    resetAll();
    resetDateTracking();
    setChatImplForTest(null);
    setFetchUserContextForTest(null);
    await resetAllMcpSessionsForTest();
    setMcpClientFactoryForTest(null);
  });

  it("parallel users cannot cross history in shared channel", async () => {
    const clients = new Map<string, Client>();
    setMcpClientFactoryForTest(async (userId) => {
      const tz = userId === FIXTURE_USERS.alice ? "America/New_York" : "Asia/Tokyo";
      const today = userId === FIXTURE_USERS.alice ? "2026-07-01" : "2026-07-02";
      const c = overviewClient(userId, tz, today);
      clients.set(userId, c);
      return c;
    });

    let call = 0;
    setChatImplForTest(async (messages) => {
      call++;
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      if (call === 1) {
        assert.match(system, /America\/New_York/);
        assert.match(system, /2026-07-01/);
        return { content: "alice reply" };
      }
      assert.match(system, /Asia\/Tokyo/);
      assert.match(system, /2026-07-02/);
      return { content: "bob reply" };
    });

    const [ra, rb] = await Promise.all([
      prompt("hello", FIXTURE_CHANNEL, FIXTURE_USERS.alice),
      prompt("hello", FIXTURE_CHANNEL, FIXTURE_USERS.bob),
    ]);
    assert.equal(ra, "alice reply");
    assert.equal(rb, "bob reply");

    const keyA = historyKey(FIXTURE_USERS.alice, FIXTURE_CHANNEL);
    const keyB = historyKey(FIXTURE_USERS.bob, FIXTURE_CHANNEL);
    assert.equal(load(keyA).length, 2);
    assert.equal(load(keyB).length, 2);
    assert.equal(load(keyA)[1].content, "alice reply");
    assert.equal(load(keyB)[1].content, "bob reply");
  });

  it("uses server-derived timezone in system prompt", async () => {
    setMcpClientFactoryForTest(async (userId) =>
      overviewClient(userId, "Europe/London", "2026-03-15"),
    );

    let capturedSystem = "";
    setChatImplForTest(async (messages) => {
      capturedSystem = messages.find((m) => m.role === "system")?.content ?? "";
      return { content: "ok" };
    });

    await prompt("status?", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    assert.match(capturedSystem, /Europe\/London/);
    assert.match(capturedSystem, /2026-03-15/);
    assert.doesNotMatch(capturedSystem, /UTC.*from their server profile/);
  });

  it("handles malformed tool arguments without throwing", async () => {
    setMcpClientFactoryForTest(async (userId) => overviewClient(userId, "UTC", "2026-01-01"));

    let round = 0;
    setChatImplForTest(async (messages) => {
      round++;
      if (round === 1) {
        return {
          content: null,
          tool_calls: [
            {
              id: "tc1",
              type: "function",
              function: { name: "planner_find_tasks", arguments: "{not-json" },
            },
          ],
        };
      }
      const toolMsg = messages.find((m) => m.role === "tool");
      assert.ok(toolMsg);
      assert.match(String(toolMsg?.content), /invalid tool arguments JSON/i);
      return { content: "recovered" };
    });

    const out = await prompt("find tasks", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    assert.equal(out, "recovered");
  });

  it("clears history when server logical day changes", async () => {
    let today = "2026-05-01";
    setFetchUserContextForTest(async () => ({ timezone: "UTC", today }));

    setMcpClientFactoryForTest(async (userId) => overviewClient(userId, "UTC", today));
    setChatImplForTest(async () => ({ content: "day-one" }));

    const key = historyKey(FIXTURE_USERS.alice, FIXTURE_CHANNEL);
    await prompt("first", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    assert.equal(load(key).length, 2);

    today = "2026-05-02";
    setChatImplForTest(async () => ({ content: "day-two" }));
    await prompt("second", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    const history = load(key);
    assert.equal(history.length, 2);
    assert.equal(history[0].content, "second");
    assert.equal(history[1].content, "day-two");
  });
});
