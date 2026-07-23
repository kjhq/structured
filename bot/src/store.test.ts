import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { load, push, trim, resetAll, clear, historySize } from "./store.js";

describe("store", () => {
  const channelId = "42";

  beforeEach(() => {
    resetAll();
  });

  it("load returns empty array for unknown chat", () => {
    assert.deepEqual(load("999"), []);
  });

  it("push appends to chat history", () => {
    push(channelId, { role: "user", content: "hello" });
    assert.equal(load(channelId).length, 1);
    assert.equal(load(channelId)[0].content, "hello");
  });

  it("push appends multiple messages", () => {
    push(channelId, { role: "user", content: "a" }, { role: "assistant", content: "b" });
    assert.equal(load(channelId).length, 2);
  });

  it("clear removes one chat only", () => {
    push(channelId, { role: "user", content: "a" });
    push("7", { role: "user", content: "b" });
    clear(channelId);
    assert.deepEqual(load(channelId), []);
    assert.equal(load("7").length, 1);
  });

  it("historySize counts messages", () => {
    assert.equal(historySize(channelId), 0);
    push(channelId, { role: "user", content: "a" }, { role: "assistant", content: "b" });
    assert.equal(historySize(channelId), 2);
  });

  it("trim keeps recent messages within limit", () => {
    for (let i = 0; i < 20; i++) {
      push(channelId, { role: "user", content: "msg " + i });
    }
    trim(channelId);
    const msgs = load(channelId);
    assert.ok(msgs.length >= 1);
    assert.ok(msgs.length <= 20);
    // newest message should still be present
    assert.equal(msgs[msgs.length - 1].content, "msg 19");
  });
});
