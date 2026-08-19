import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  load,
  push,
  trim,
  resetAll,
  clear,
  historySize,
  historyKey,
  checkDateReset,
  resetDateTracking,
  reloadFromDisk,
  resetMemory,
} from "./store.js";

describe("store", () => {
  const userA = "user-a";
  const userB = "user-b";
  const channelId = "42";
  const keyA = historyKey(userA, channelId);
  const keyB = historyKey(userB, channelId);

  beforeEach(() => {
    resetAll();
    resetDateTracking();
  });

  it("load returns empty array for unknown chat", () => {
    assert.deepEqual(load(historyKey("x", "999")), []);
  });

  it("push appends to chat history", () => {
    push(keyA, { role: "user", content: "hello" });
    assert.equal(load(keyA).length, 1);
    assert.equal(load(keyA)[0].content, "hello");
  });

  it("isolates history for different users in same channel", () => {
    push(keyA, { role: "user", content: "a-only" });
    push(keyB, { role: "user", content: "b-only" });
    assert.equal(load(keyA)[0].content, "a-only");
    assert.equal(load(keyB)[0].content, "b-only");
    assert.equal(load(keyA).length, 1);
  });

  it("push appends multiple messages", () => {
    push(keyA, { role: "user", content: "a" }, { role: "assistant", content: "b" });
    assert.equal(load(keyA).length, 2);
  });

  it("clear removes one user+channel only", () => {
    push(keyA, { role: "user", content: "a" });
    push(historyKey(userA, "7"), { role: "user", content: "b" });
    clear(keyA);
    assert.deepEqual(load(keyA), []);
    assert.equal(load(historyKey(userA, "7")).length, 1);
  });

  it("historySize counts messages", () => {
    assert.equal(historySize(keyA), 0);
    push(keyA, { role: "user", content: "a" }, { role: "assistant", content: "b" });
    assert.equal(historySize(keyA), 2);
  });

  it("trim keeps recent messages within limit", () => {
    for (let i = 0; i < 20; i++) {
      push(keyA, { role: "user", content: "msg " + i });
    }
    trim(keyA);
    const msgs = load(keyA);
    assert.ok(msgs.length >= 1);
    assert.ok(msgs.length <= 20);
    assert.equal(msgs[msgs.length - 1].content, "msg 19");
  });

  it("checkDateReset clears one key when server day changes", () => {
    checkDateReset(keyA, "2026-01-01");
    push(keyA, { role: "user", content: "old" });
    assert.equal(load(keyA).length, 1);

    const reset = checkDateReset(keyA, "2026-01-02");
    assert.equal(reset, true);
    assert.deepEqual(load(keyA), []);
    assert.equal(load(keyB).length, 0);
  });

  it("reloadFromDisk restores persisted history", () => {
    push(keyA, { role: "user", content: "persisted" });
    reloadFromDisk();
    assert.equal(load(keyA).length, 1);
    assert.equal(load(keyA)[0].content, "persisted");
  });

  it("survives in-memory reset then reloadFromDisk (process restart)", () => {
    push(keyA, { role: "user", content: "persisted" });
    resetMemory();
    assert.equal(load(keyA).length, 0);
    reloadFromDisk();
    assert.equal(load(keyA).length, 1);
    assert.equal(load(keyA)[0].content, "persisted");
  });
});
