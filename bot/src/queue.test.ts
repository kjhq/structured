import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { enqueue } from "./queue.js";

describe("queue", () => {
  it("serializes tasks for the same chatId", async () => {
    const order: number[] = [];
    const channelId = "1";

    const a = enqueue(channelId, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
      return "a";
    });
    const b = enqueue(channelId, async () => {
      order.push(3);
      return "b";
    });

    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, "a");
    assert.equal(rb, "b");
    assert.deepEqual(order, [1, 2, 3]);
  });

  it("runs different chats in parallel", async () => {
    let bothStarted = false;
    let aStarted = false;
    let bStarted = false;

    const a = enqueue("10", async () => {
      aStarted = true;
      await new Promise((r) => setTimeout(r, 40));
      if (bStarted) bothStarted = true;
      return 10;
    });
    const b = enqueue("20", async () => {
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

  it("continues after a failed task", async () => {
    const channelId = "3";
    const first = enqueue(channelId, async () => {
      throw new Error("boom");
    });
    const second = enqueue(channelId, async () => "ok");

    await assert.rejects(first);
    assert.equal(await second, "ok");
  });
});
