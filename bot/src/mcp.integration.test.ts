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
});
