import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCustomId, customId } from "./components.js";
import { parseWhen, addDays } from "./parseWhen.js";

describe("custom_id", () => {
  it("round-trips occurrence ids", () => {
    const occ = "occ_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee_2026-08-18";
    const id = customId("c", occ);
    assert.ok(id.length < 100);
    const parsed = parseCustomId(id);
    assert.deepEqual(parsed, { op: "c", id: occ });
  });

  it("parses ml without id", () => {
    assert.deepEqual(parseCustomId("s1:ml"), { op: "ml", id: undefined });
  });

  it("rejects unknown prefix", () => {
    assert.equal(parseCustomId("x:c:1"), null);
  });

  it("rejects draft ok/x ops", () => {
    assert.equal(parseCustomId("s1:ok:draft1"), null);
    assert.equal(parseCustomId("s1:x:draft1"), null);
  });
});

describe("parseWhen", () => {
  it("empty is inbox", () => {
    assert.deepEqual(parseWhen(undefined, "2026-08-18"), { is_all_day: false });
  });

  it("today / tomorrow / ymd / clock", () => {
    assert.deepEqual(parseWhen("today", "2026-08-18"), { day: "2026-08-18", is_all_day: true });
    assert.deepEqual(parseWhen("tomorrow", "2026-08-18"), { day: "2026-08-19", is_all_day: true });
    assert.deepEqual(parseWhen("2026-08-20", "2026-08-18"), { day: "2026-08-20", is_all_day: true });
    assert.deepEqual(parseWhen("7:05", "2026-08-18"), {
      day: "2026-08-18",
      start_time: "07:05",
      is_all_day: false,
    });
    assert.deepEqual(parseWhen("2026-08-21 15:30", "2026-08-18"), {
      day: "2026-08-21",
      start_time: "15:30",
      is_all_day: false,
    });
  });

  it("rejects free NL", () => {
    const parsed = parseWhen("after lunch", "2026-08-18");
    assert.ok("error" in parsed);
  });

  it("addDays crosses months", () => {
    assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  });
});
