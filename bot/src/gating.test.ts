import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gateMessage, type GatingMessage } from "./gating.js";
import { FIXTURE_CHANNEL, FIXTURE_USERS, installTestEnv } from "./test/fixtures.js";

installTestEnv();

const BOT = "bot-user-id";

function msg(overrides: Partial<{
  authorId: string;
  bot: boolean;
  dm: boolean;
  channelId: string;
  mention: boolean;
  replyToBot: boolean;
}>): GatingMessage {
  const authorId = overrides.authorId ?? FIXTURE_USERS.alice;
  return {
    author: { bot: overrides.bot ?? false, id: authorId },
    channelId: overrides.channelId ?? FIXTURE_CHANNEL,
    channel: { isDMBased: () => Boolean(overrides.dm) },
    mentions: {
      users: { has: (id: string) => Boolean(overrides.mention && id === BOT) },
      repliedUser: overrides.replyToBot ? { id: BOT } : null,
    },
  };
}

describe("gating", () => {
  it("unauthorized for strangers", () => {
    assert.equal(gateMessage(msg({ authorId: FIXTURE_USERS.stranger }), { guild_mode: "all" }, BOT), "unauthorized");
  });

  it("silent for bots", () => {
    assert.equal(gateMessage(msg({ bot: true }), { guild_mode: "all" }, BOT), "silent");
  });

  it("DMs always handle for allowlisted users", () => {
    assert.equal(gateMessage(msg({ dm: true }), { guild_mode: "mention" }, BOT), "handle");
  });

  it("guild_mode all handles without mention", () => {
    assert.equal(gateMessage(msg({}), { guild_mode: "all" }, BOT), "handle");
  });

  it("mention mode is silent without mention", () => {
    assert.equal(gateMessage(msg({}), { guild_mode: "mention" }, BOT), "silent");
  });

  it("mention mode handles @bot", () => {
    assert.equal(gateMessage(msg({ mention: true }), { guild_mode: "mention" }, BOT), "handle");
  });

  it("mention mode handles reply to bot", () => {
    assert.equal(gateMessage(msg({ replyToBot: true }), { guild_mode: "mention" }, BOT), "handle");
  });

  it("channel mode handles planner channel", () => {
    assert.equal(
      gateMessage(msg({ channelId: "planner-1" }), { guild_mode: "channel", planner_channel_id: "planner-1" }, BOT),
      "handle",
    );
  });

  it("channel mode is silent in other channels without mention", () => {
    assert.equal(
      gateMessage(msg({ channelId: "other" }), { guild_mode: "channel", planner_channel_id: "planner-1" }, BOT),
      "silent",
    );
  });
});
