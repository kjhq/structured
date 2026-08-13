import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  enqueue,
  queueKey,
  queueSizeForTest,
  setQueueIdleMsForTest,
  resetQueueForTest,
} from "./queue.js";

describe("queue", () => {
  beforeEach(() => {
    resetQueueForTest();
  });
  it("serializes tasks for the same user+channel", async () => {
    const order: number[] = [];
    const key = queueKey("u1", "1");

    const a = enqueue(key, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
      return "a";
    });
    const b = enqueue(key, async () => {
      order.push(3);
      return "b";
    });

    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, "a");
    assert.equal(rb, "b");
    assert.deepEqual(order, [1, 2, 3]);
  });

  it("runs different user+channel keys in parallel", async () => {
    let bothStarted = false;
    let aStarted = false;
    let bStarted = false;

    const a = enqueue(queueKey("u1", "10"), async () => {
      aStarted = true;
      await new Promise((r) => setTimeout(r, 40));
      if (bStarted) bothStarted = true;
      return 10;
    });
    const b = enqueue(queueKey("u2", "20"), async () => {
      bStarted = true;
      await new Promise((r) => setTimeout(r, 40));
      if (aStarted) bothStarted = true;
      return 20;
    });

    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, 10);
    assert.equal(rb, 20);
    assert.equal(bothStarted, true);
  });

  it("isolates same channel for different users", async () => {
    let bothStarted = false;
    let aStarted = false;
    let bStarted = false;
    const channel = "shared";

    const a = enqueue(queueKey("u1", channel), async () => {
      aStarted = true;
      await new Promise((r) => setTimeout(r, 40));
      if (bStarted) bothStarted = true;
      return "a";
    });
    const b = enqueue(queueKey("u2", channel), async () => {
      bStarted = true;
      await new Promise((r) => setTimeout(r, 40));
      if (aStarted) bothStarted = true;
      return "b";
    });

    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, "a");
    assert.equal(rb, "b");
    assert.equal(bothStarted, true);
  });

  it("continues after a failed task", async () => {
    const key = queueKey("u1", "3");
    const first = enqueue(key, async () => {
      throw new Error("boom");
    });
    const second = enqueue(key, async () => "ok");

    await assert.rejects(first);
    assert.equal(await second, "ok");
  });

  it("drops idle queue tails", async () => {
    setQueueIdleMsForTest(20);
    const key = queueKey("idle-user", "idle-channel");
    await enqueue(key, async () => "done");
    assert.ok(queueSizeForTest() >= 1);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(queueSizeForTest(), 0);
  });
});
