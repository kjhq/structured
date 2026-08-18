import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  inboxTitle,
  parseVisionJson,
  visionEnabled,
  transcribeEnabled,
  jumpNotes,
} from "./capture.js";
import { installTestEnv } from "./test/fixtures.js";

describe("capture", () => {
  before(() => installTestEnv());

  it("vision unset does not report enabled", () => {
    assert.equal(visionEnabled(), false);
    assert.equal(transcribeEnabled(), false);
  });

  it("inbox title collapses whitespace and caps at 80", () => {
    assert.equal(inboxTitle("  hello   world  "), "hello world");
    assert.equal(inboxTitle(""), "Discord message");
    assert.equal(inboxTitle("x".repeat(90)).length, 80);
  });

  it("jump notes include discord URL in guilds", () => {
    const notes = jumpNotes("title leftover text here", {
      guildId: "g1",
      channelId: "c1",
      messageId: "m1",
    });
    assert.match(notes, /https:\/\/discord.com\/channels\/g1\/c1\/m1/);
  });

  it("parses vision JSON and ignores junk", () => {
    const tasks = parseVisionJson('here {"tasks":[{"title":"Milk"},{"title":""}]}');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, "Milk");
    assert.deepEqual(parseVisionJson("not json"), []);
  });
});
