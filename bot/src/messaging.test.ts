import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import {
  labelOf,
  splitMessage,
  withAck,
  type RepliableInteraction,
} from "./messaging.js";
import { FIXTURE_USERS, installTestEnv, restoreTestEnv } from "./test/fixtures.js";

installTestEnv();

function fakeInteraction(overrides: Partial<Record<string, unknown>> = {}) {
  const state = {
    deferred: false,
    replied: false,
    deferCalls: 0,
    replyCalls: [] as unknown[],
    followUpCalls: [] as unknown[],
  };
  const interaction = {
    isButton: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => true,
    isMessageContextMenuCommand: () => false,
    commandName: "settings",
    customId: "",
    user: { id: FIXTURE_USERS.alice },
    guildId: null,
    get deferred() {
      return state.deferred;
    },
    get replied() {
      return state.replied;
    },
    deferReply: async () => {
      state.deferCalls += 1;
      state.deferred = true;
    },
    reply: async (payload: unknown) => {
      state.replyCalls.push(payload);
      state.replied = true;
    },
    followUp: async (payload: unknown) => {
      state.followUpCalls.push(payload);
    },
    ...overrides,
  } as unknown as RepliableInteraction & Record<string, unknown>;
  return { interaction, state };
}

describe("splitMessage", () => {
  it("returns single chunk for short text", () => {
    assert.deepEqual(splitMessage("hello"), ["hello"]);
  });

  it("splits long text at newlines", () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const chunks = splitMessage(text, 1000);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(chunk.length <= 1000);
    assert.equal(chunks.join("\n").replace(/\n\n/g, "\n"), text.replace(/\n\n/g, "\n"));
  });
});

describe("labelOf", () => {
  it("labels slash commands", () => {
    const { interaction } = fakeInteraction();
    assert.equal(labelOf(interaction), "/settings");
  });

  it("labels buttons", () => {
    const { interaction } = fakeInteraction({
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: "s2:c:task-1",
    });
    assert.equal(labelOf(interaction), "button s2:c:task-1");
  });
});

describe("withAck", () => {
  let timers: NodeJS.Timeout[] = [];
  beforeEach(() => {
    timers = [];
    const originalSetTimeout = globalThis.setTimeout;
    // Track but do not install fake timers; use real short waits instead.
    void originalSetTimeout;
  });
  afterEach(() => {
    for (const t of timers) clearTimeout(t);
  });

  it("does not defer when handler acks quickly", async () => {
    const { interaction, state } = fakeInteraction();
    await withAck(interaction, async () => {
      await interaction.deferReply();
    });
    assert.equal(state.deferCalls, 1);
    assert.equal(state.replyCalls.length, 0);
  });

  it("auto-defers when handler stalls past 1s", async () => {
    const { interaction, state } = fakeInteraction();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const promise = withAck(interaction, async () => {
      await gate;
      await interaction.deferReply();
    });
    await new Promise((r) => setTimeout(r, 1300));
    assert.ok(state.deferCalls >= 1, "auto-defer should have fired");
    release();
    await promise;
  });

  it("replies ephemerally on handler error", async () => {
    const { interaction, state } = fakeInteraction();
    await withAck(interaction, async () => {
      throw new Error("boom");
    });
    assert.equal(state.replyCalls.length, 1);
    const payload = state.replyCalls[0] as { content: string; flags?: unknown };
    assert.match(payload.content, /Something went wrong/);
    assert.equal(payload.flags, MessageFlags.Ephemeral);
  });

  it("follows up when already deferred", async () => {
    const { interaction, state } = fakeInteraction({ deferred: true });
    await withAck(interaction, async () => {
      throw new Error("boom");
    });
    assert.equal(state.followUpCalls.length, 1);
    assert.equal(state.replyCalls.length, 0);
  });
});
