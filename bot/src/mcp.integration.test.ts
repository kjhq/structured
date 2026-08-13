import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  createAuthenticatedFetch,
  listMcpSessionUserIdsForTest,
  resetAllMcpSessionsForTest,
  setMcpClientFactoryForTest,
  getMcpClient,
  resetMcpClient,
  isMcpConnected,
  callToolForUser,
} from "./mcp.js";
import {
  FIXTURE_USERS,
  installTestEnv,
  restoreTestEnv,
} from "./test/fixtures.js";

function mockClient(userId: string): Client {
  return {
    connect: async () => {},
    close: async () => {},
    listTools: async () => ({ tools: [{ name: `tools-for-${userId}` }] }),
    callTool: async () => ({ content: [{ type: "text", text: "{}" }] }),
  } as unknown as Client;
}

describe("mcp integration", () => {
  before(() => installTestEnv());
  after(() => restoreTestEnv());

  beforeEach(async () => {
    await resetAllMcpSessionsForTest();
    setMcpClientFactoryForTest(null);
  });

  it("authenticated fetch sets per-user Discord header", async () => {
    const seen: string[] = [];
    const baseFetch = globalThis.fetch;
    globalThis.fetch = (async (_url, init) => {
      const headers = new Headers(init?.headers);
      seen.push(headers.get("X-Discord-Id") ?? "");
      seen.push(headers.get("X-Bot-Secret") ?? "");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      const fetchA = createAuthenticatedFetch(FIXTURE_USERS.alice);
      const fetchB = createAuthenticatedFetch(FIXTURE_USERS.bob);
      await fetchA("http://example.test/mcp", { method: "POST" });
      await fetchB("http://example.test/mcp", { method: "POST" });
      assert.deepEqual(seen, [
        FIXTURE_USERS.alice,
        "test-bot-secret",
        FIXTURE_USERS.bob,
        "test-bot-secret",
      ]);
    } finally {
      globalThis.fetch = baseFetch;
    }
  });

  it("parallel users get isolated MCP sessions", async () => {
    const clients = new Map<string, Client>();
    setMcpClientFactoryForTest(async (userId) => {
      const c = mockClient(userId);
      clients.set(userId, c);
      return c;
    });

    const [a, b] = await Promise.all([
      getMcpClient(FIXTURE_USERS.alice),
      getMcpClient(FIXTURE_USERS.bob),
    ]);

    assert.notEqual(a, b);
    assert.equal(clients.get(FIXTURE_USERS.alice), a);
    assert.equal(clients.get(FIXTURE_USERS.bob), b);
    assert.deepEqual(
      listMcpSessionUserIdsForTest().sort(),
      [FIXTURE_USERS.alice, FIXTURE_USERS.bob].sort(),
    );
  });

  it("resetMcpClient reconnects only the target user", async () => {
    let aliceConnects = 0;
    let bobConnects = 0;
    setMcpClientFactoryForTest(async (userId) => {
      if (userId === FIXTURE_USERS.alice) aliceConnects++;
      if (userId === FIXTURE_USERS.bob) bobConnects++;
      return mockClient(userId);
    });

    await getMcpClient(FIXTURE_USERS.alice);
    await getMcpClient(FIXTURE_USERS.bob);
    assert.equal(isMcpConnected(FIXTURE_USERS.alice), true);
    assert.equal(isMcpConnected(FIXTURE_USERS.bob), true);

    await resetMcpClient(FIXTURE_USERS.alice);
    assert.equal(isMcpConnected(FIXTURE_USERS.alice), false);
    assert.equal(isMcpConnected(FIXTURE_USERS.bob), true);

    await getMcpClient(FIXTURE_USERS.alice);
    assert.equal(aliceConnects, 2);
    assert.equal(bobConnects, 1);
  });

  it("serializes callTool for the same user", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    setMcpClientFactoryForTest(async () => {
      return {
        connect: async () => {},
        close: async () => {},
        listTools: async () => ({ tools: [] }),
        callTool: async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 30));
          inFlight--;
          return { content: [{ type: "text", text: "{}" }] };
        },
      } as unknown as Client;
    });

    await Promise.all([
      callToolForUser(FIXTURE_USERS.alice, "planner_get_overview", {}),
      callToolForUser(FIXTURE_USERS.alice, "planner_find_tasks", {}),
    ]);
    assert.equal(maxInFlight, 1);
  });

  it("resetMcpClient awaits in-flight connect and closes that client", async () => {
    let closed = 0;
    let connectStarted = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    setMcpClientFactoryForTest(async () => {
      connectStarted = true;
      await gate;
      return {
        connect: async () => {},
        close: async () => {
          closed++;
        },
        listTools: async () => ({ tools: [] }),
        callTool: async () => ({ content: [{ type: "text", text: "{}" }] }),
      } as unknown as Client;
    });

    const connecting = getMcpClient(FIXTURE_USERS.alice);
    while (!connectStarted) {
      await new Promise((r) => setTimeout(r, 1));
    }
    const resetting = resetMcpClient(FIXTURE_USERS.alice);
    release();
    await connecting;
    await resetting;
    assert.equal(closed, 1);
    assert.equal(isMcpConnected(FIXTURE_USERS.alice), false);
  });
});
