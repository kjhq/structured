import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GatewayIntentBits, Events } from "discord.js";
import { createBot, handleLink, handleView, registerBotHandlers } from "./bot.js";
import { setFetchUserContextForTest } from "./userContext.js";
import {
  FIXTURE_USERS,
  installTestEnv,
  restoreTestEnv,
} from "./test/fixtures.js";

function linkInteraction(overrides: { sendFails?: boolean } = {}) {
  const edits: string[] = [];
  const dmAttempts: string[] = [];
  const user = {
    id: FIXTURE_USERS.alice,
    send: async (text: string) => {
      dmAttempts.push(text);
      if (overrides.sendFails) throw new Error("Cannot DM");
    },
  };
  return {
    user,
    deferReply: async () => {},
    editReply: async (text: string) => {
      edits.push(text);
    },
    edits,
    dmAttempts,
  };
}

describe("bot integration", () => {
  before(() => installTestEnv());
  after(() => restoreTestEnv());

  beforeEach(() => {
    setFetchUserContextForTest(null);
  });

  it("createBot registers MessageContent and guild message handler", () => {
    const client = createBot();
    const options = (client as unknown as { options: { intents: { bitfield: number } } }).options;
    const bitfield = options.intents.bitfield;
    assert.ok(bitfield & GatewayIntentBits.MessageContent);
    assert.ok(bitfield & GatewayIntentBits.GuildMessages);

    const listeners = client.listeners(Events.MessageCreate);
    assert.ok(listeners.length >= 1);
  });

  it("registerBotHandlers wires InteractionCreate without login", () => {
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
    };
    registerBotHandlers(fakeClient as never);
    assert.ok(events.has(Events.MessageCreate));
    assert.ok(events.has(Events.InteractionCreate));
  });

  it("link delivery failure does not call activate (old token preserved)", async () => {
    const fetchCalls: Array<{ url: string; body?: string }> = [];
    const baseFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      fetchCalls.push({ url, body: init?.body?.toString() });
      if (url.endsWith("/v1/bot/link/prepare")) {
        return new Response(
          JSON.stringify({
            discord_id: FIXTURE_USERS.alice,
            widget_token: "pending-token",
            pending_id: "pending-123",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/v1/bot/link/activate")) {
        return new Response("should not happen", { status: 500 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      const interaction = linkInteraction({ sendFails: true });
      await handleLink(interaction as never);
      assert.equal(fetchCalls.length, 1);
      assert.ok(fetchCalls[0].url.endsWith("/v1/bot/link/prepare"));
      assert.ok(
        interaction.edits.some((e) => e.includes("NOT rotated")),
        `expected NOT rotated message, got: ${interaction.edits.join(" | ")}`,
      );
    } finally {
      globalThis.fetch = baseFetch;
    }
  });

  it("successful link calls prepare then activate after DM", async () => {
    const fetchCalls: string[] = [];
    const baseFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.endsWith("/v1/bot/link/prepare")) {
        return new Response(
          JSON.stringify({
            discord_id: FIXTURE_USERS.alice,
            widget_token: "pending-token",
            pending_id: "pending-456",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/v1/bot/link/activate")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      const interaction = linkInteraction();
      await handleLink(interaction as never);
      assert.deepEqual(
        fetchCalls.map((u) => u.split("/").slice(-2).join("/")),
        ["link/prepare", "link/activate"],
      );
      assert.equal(interaction.dmAttempts.length, 1);
      assert.match(interaction.dmAttempts[0], /pending-token/);
    } finally {
      globalThis.fetch = baseFetch;
    }
  });

  it("/today uses REST views and never calls the LLM", async () => {
    const fetchCalls: string[] = [];
    const baseFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.includes("/v1/bot/views/")) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const edits: unknown[] = [];
    const interaction = {
      user: { id: FIXTURE_USERS.alice },
      deferReply: async () => {},
      editReply: async (payload: unknown) => {
        edits.push(payload);
      },
    };

    try {
      await handleView(interaction as never, "today");
      assert.ok(fetchCalls.some((u) => u.includes("/v1/bot/views/today")));
      assert.ok(fetchCalls.some((u) => u.includes("/v1/bot/views/inbox")));
      assert.ok(fetchCalls.some((u) => u.includes("/v1/bot/views/open")));
      assert.equal(
        fetchCalls.filter((u) => !u.includes("/v1/bot/views/")).length,
        0,
      );
      assert.equal(edits.length, 1);
    } finally {
      globalThis.fetch = baseFetch;
    }
  });
});
