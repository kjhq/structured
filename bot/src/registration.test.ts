import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildCommands,
  commandsFingerprint,
  syncCommands,
} from "./registration.js";
import { installTestEnv, restoreTestEnv } from "./test/fixtures.js";

installTestEnv();

describe("buildCommands", () => {
  it("has no guild subcommand", () => {
    const settings = buildCommands().find((c) => c.name === "settings");
    assert.ok(settings);
    const subs = ((settings.options ?? []) as Array<{ name: string }>).map((o) => o.name);
    assert.ok(subs.includes("briefing"));
    assert.ok(!subs.includes("guild"));
  });

  it("registers the core command set", () => {
    const names = buildCommands().map((c) => c.name).sort();
    assert.deepEqual(names, [
      "Inbox this",
      "add",
      "clear",
      "help",
      "inbox",
      "link",
      "open",
      "relink",
      "settings",
      "status",
      "timezone",
      "today",
      "week",
    ]);
  });
});

describe("syncCommands", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cmdreg-"));
    path = join(dir, "commands-hash.txt");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fakeClient() {
    const sets: unknown[] = [];
    return {
      application: {
        commands: {
          set: async (cmds: unknown) => {
            sets.push(cmds);
          },
        },
      },
      sets,
    };
  }

  it("pushes and records fingerprint on first run", async () => {
    const client = fakeClient();
    const pushed = await syncCommands(client as never, path);
    assert.equal(pushed, true);
    assert.equal(client.sets.length, 1);
    assert.ok(readFileSync(path, "utf8").length > 0);
  });

  it("skips push when fingerprint unchanged", async () => {
    const client = fakeClient();
    await syncCommands(client as never, path);
    const again = await syncCommands(client as never, path);
    assert.equal(again, false);
    assert.equal(client.sets.length, 1);
  });

  it("pushes when fingerprint is stale", async () => {
    const client = fakeClient();
    await syncCommands(client as never, path);
    writeFileSync(path, "stale");
    const pushed = await syncCommands(client as never, path);
    assert.equal(pushed, true);
    assert.equal(client.sets.length, 2);
  });
});

describe("commandsFingerprint", () => {
  it("is stable across calls", () => {
    const cmds = buildCommands();
    assert.equal(commandsFingerprint(cmds), commandsFingerprint(cmds));
  });

  it("differs when definitions change", () => {
    const cmds = buildCommands();
    const tweaked = JSON.parse(JSON.stringify(cmds)) as typeof cmds;
    (tweaked[0] as { description: string }).description = "Changed";
    assert.notEqual(commandsFingerprint(cmds), commandsFingerprint(tweaked));
  });
});
