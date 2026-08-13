import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GatewayIntentBits, Events, MessageFlags } from "discord.js";
import {
  createBot,
  handleLink,
  handleMessageForTest,
  registerBotHandlers,
  setPromptForTest,
} from "./bot.js";
import { setFetchUserContextForTest } from "./userContext.js";
import { historyKey, historySize, push } from "./store.js";
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

function captureHandlers() {
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
  return events;
}

function slashInteraction(commandName: string) {
  const order: string[] = [];
  const replies: unknown[] = [];
  const interaction = {
    isChatInputCommand: () => true,
    user: { id: FIXTURE_USERS.alice },
    commandName,
    channelId: "channel-1",
    replied: false,
    deferred: false,
    lastDeferOpts: undefined as unknown,
    deferReply: async (opts?: { flags?: unknown; ephemeral?: boolean }) => {
      order.push("defer");
      interaction.deferred = true;
      interaction.lastDeferOpts = opts;
      return opts;
    },
    editReply: async (payload: unknown) => {
      order.push("edit");
      replies.push(payload);
    },
    reply: async (payload: unknown) => {
      order.push("reply");
      replies.push(payload);
    },
    order,
    replies,
  };
  return interaction;
}

describe("bot integration", () => {
  before(() => installTestEnv());
  after(() => restoreTestEnv());

  beforeEach(() => {
    setFetchUserContextForTest(null);
    setPromptForTest(async () => "ok");
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
    const events = captureHandlers();
    assert.ok(events.has(Events.MessageCreate));
    assert.ok(events.has(Events.InteractionCreate));
  });

  it("guild unauthorized messages stay silent", async () => {
    const replies: unknown[] = [];
    await handleMessageForTest({
      author: { bot: false, id: FIXTURE_USERS.stranger },
      content: "hello",
      guild: { id: "guild-1" },
      channel: { isTextBased: () => true },
      channelId: "channel-1",
      reply: async (payload: unknown) => {
        replies.push(payload);
      },
    } as never);
    assert.equal(replies.length, 0);
  });

  it("DM unauthorized messages reply without mentioning the author", async () => {
    const replies: unknown[] = [];
    await handleMessageForTest({
      author: { bot: false, id: FIXTURE_USERS.stranger },
      content: "hello",
      guild: null,
      channel: { isTextBased: () => true },
      channelId: "dm-1",
      reply: async (payload: unknown) => {
        replies.push(payload);
      },
    } as never);
    assert.equal(replies.length, 1);
    const payload = replies[0] as {
      content: string;
      allowedMentions: { parse: unknown[]; repliedUser: boolean };
    };
    assert.equal(payload.content, "Unauthorized.");
    assert.deepEqual(payload.allowedMentions.parse, []);
    assert.equal(payload.allowedMentions.repliedUser, false);
  });

  it("allowlisted guild messages still run the planner prompt", async () => {
    const prompted: string[] = [];
    setPromptForTest(async (text, channelId, userId) => {
      prompted.push(`${userId}:${channelId}:${text}`);
      return "done";
    });
    await handleMessageForTest({
      author: { bot: false, id: FIXTURE_USERS.alice },
      content: `<@bot-user> what is today?`,
      guild: { id: "guild-1" },
      mentions: {
        users: { has: (id: string) => id === "bot-user" },
        repliedUser: null,
      },
      client: { user: { id: "bot-user" } },
      channel: {
        isTextBased: () => true,
        sendTyping: async () => {},
        send: async () => {},
      },
      channelId: "channel-1",
    } as never);
    assert.deepEqual(prompted, [
      `${FIXTURE_USERS.alice}:channel-1:what is today?`,
    ]);
  });

  it("ignores guild messages that do not mention or reply to the bot", async () => {
    const prompted: string[] = [];
    setPromptForTest(async (text) => {
      prompted.push(text);
      return "done";
    });
    await handleMessageForTest({
      author: { bot: false, id: FIXTURE_USERS.alice },
      content: "done",
      guild: { id: "guild-1" },
      mentions: {
        users: { has: () => false },
        repliedUser: null,
      },
      client: { user: { id: "bot-user" } },
      channel: {
        isTextBased: () => true,
        sendTyping: async () => {},
        send: async () => {},
      },
      channelId: "channel-1",
    } as never);
    assert.deepEqual(prompted, []);
  });

  it("runs the planner on a guild reply to the bot", async () => {
    const prompted: string[] = [];
    setPromptForTest(async (text) => {
      prompted.push(text);
      return "done";
    });
    await handleMessageForTest({
      author: { bot: false, id: FIXTURE_USERS.alice },
      content: "also add milk",
      guild: { id: "guild-1" },
      mentions: {
        users: { has: () => false },
        repliedUser: { id: "bot-user" },
      },
      client: { user: { id: "bot-user" } },
      channel: {
        isTextBased: () => true,
        sendTyping: async () => {},
        send: async () => {},
      },
      channelId: "channel-1",
    } as never);
    assert.deepEqual(prompted, ["also add milk"]);
  });

  it("fetches the referenced message when repliedUser is missing", async () => {
    const prompted: string[] = [];
    setPromptForTest(async (text) => {
      prompted.push(text);
      return "done";
    });
    await handleMessageForTest({
      author: { bot: false, id: FIXTURE_USERS.alice },
      content: "also add milk",
      guild: { id: "guild-1" },
      mentions: {
        users: { has: () => false },
        repliedUser: null,
      },
      reference: { messageId: "prior-bot-msg" },
      fetchReference: async () => ({ author: { id: "bot-user" } }),
      client: { user: { id: "bot-user" } },
      channel: {
        isTextBased: () => true,
        sendTyping: async () => {},
        send: async () => {},
      },
      channelId: "channel-1",
    } as never);
    assert.deepEqual(prompted, ["also add milk"]);
  });

  it("DMs from allowlisted users run without a mention", async () => {
    const prompted: string[] = [];
    setPromptForTest(async (text) => {
      prompted.push(text);
      return "done";
    });
    await handleMessageForTest({
      author: { bot: false, id: FIXTURE_USERS.alice },
      content: "inbox",
      guild: null,
      mentions: {
        users: { has: () => false },
        repliedUser: null,
      },
      client: { user: { id: "bot-user" } },
      channel: {
        isTextBased: () => true,
        sendTyping: async () => {},
        send: async () => {},
      },
      channelId: "dm-1",
    } as never);
    assert.deepEqual(prompted, ["inbox"]);
  });

  it("/timezone defers before fetching user context", async () => {
    const order: string[] = [];
    setFetchUserContextForTest(async () => {
      order.push("mcp");
      return { timezone: "UTC", today: "2026-01-01" };
    });
    const interaction = slashInteraction("timezone");
    const origDefer = interaction.deferReply;
    interaction.deferReply = async (opts) => {
      order.push("defer");
      return origDefer(opts);
    };
    const events = captureHandlers();
    const handler = events.get(Events.InteractionCreate)![0];
    await handler(interaction);
    assert.deepEqual(order, ["defer", "mcp"]);
    assert.ok(interaction.order.includes("edit"));
    assert.ok(!interaction.order.includes("reply"));
  });

  it("/help replies ephemerally", async () => {
    const interaction = slashInteraction("help");
    const events = captureHandlers();
    const handler = events.get(Events.InteractionCreate)![0];
    await handler(interaction);
    assert.equal(interaction.replies.length, 1);
    const payload = interaction.replies[0] as { content: string; flags: number };
    assert.match(payload.content, /Planner Task Bot/);
    assert.equal(payload.flags, MessageFlags.Ephemeral);
  });

  it("/status is ephemeral and omits LLM base URL", async () => {
    setFetchUserContextForTest(async () => ({
      timezone: "UTC",
      today: "2026-01-01",
      source: "profile",
    }));
    const interaction = slashInteraction("status");
    const events = captureHandlers();
    const handler = events.get(Events.InteractionCreate)![0];
    await handler(interaction);
    assert.equal(
      (interaction.lastDeferOpts as { flags?: number } | undefined)?.flags,
      MessageFlags.Ephemeral,
    );
    const text = String(interaction.replies[0]);
    assert.match(text, /Timezone/);
    assert.match(text, /Model:/);
    assert.doesNotMatch(text, /LLM:/);
    assert.doesNotMatch(text, /api\.example\.com/);
  });

  it("/clear waits for an in-flight prompt on the same channel", async () => {
    const key = historyKey(FIXTURE_USERS.alice, "channel-1");
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let promptStarted = false;
    setPromptForTest(async (text, channelId, userId) => {
      promptStarted = true;
      await gate;
      push(historyKey(userId, channelId ?? "channel-1"), {
        role: "user",
        content: text,
      }, { role: "assistant", content: "done" });
      return "done";
    });

    const promptDone = handleMessageForTest({
      author: { bot: false, id: FIXTURE_USERS.alice },
      content: "<@bot-user> keep going",
      guild: { id: "guild-1" },
      mentions: {
        users: { has: (id: string) => id === "bot-user" },
        repliedUser: null,
      },
      client: { user: { id: "bot-user" } },
      channel: {
        isTextBased: () => true,
        sendTyping: async () => {},
        send: async () => {},
      },
      channelId: "channel-1",
    } as never);

    while (!promptStarted) {
      await new Promise((r) => setTimeout(r, 1));
    }

    const interaction = slashInteraction("clear");
    const events = captureHandlers();
    const handler = events.get(Events.InteractionCreate)![0];
    const clearDone = handler(interaction);
    release();
    await promptDone;
    await clearDone;
    assert.ok(interaction.order.includes("defer"));
    assert.ok(interaction.order.includes("edit"));
    assert.equal(
      (interaction.lastDeferOpts as { flags?: number } | undefined)?.flags,
      MessageFlags.Ephemeral,
    );
    assert.equal(historySize(key), 0);
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
});
