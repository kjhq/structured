import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { todayYmd, todayHuman, nowLocal, ymdToHuman } from "./timezone.js";

describe("timezone", () => {
  it("todayYmd returns YYYY-MM-DD in UTC", () => {
    const d = new Date("2026-07-07T12:00:00Z");
    assert.equal(todayYmd(d, "UTC"), "2026-07-07");
  });

  it("todayYmd adjusts for timezone offset", () => {
    // At 20:00 UTC on July 7, Kolkata (UTC+5:30) is already July 8
    const d = new Date("2026-07-07T20:00:00Z");
    assert.equal(todayYmd(d, "Asia/Kolkata"), "2026-07-08");
    assert.equal(todayYmd(d, "UTC"), "2026-07-07");
  });

  it("todayHuman returns readable date", () => {
    const d = new Date("2026-07-07T12:00:00Z");
    assert.equal(todayHuman(d, "UTC"), "Tuesday, July 7, 2026");
  });

  it("todayHuman adjusts for timezone offset", () => {
    const d = new Date("2026-07-07T20:00:00Z");
    assert.equal(todayHuman(d, "Asia/Kolkata"), "Wednesday, July 8, 2026");
  });

  it("nowLocal returns clock time in timezone", () => {
    const d = new Date("2026-07-07T12:00:00Z");
    assert.equal(nowLocal(d, "UTC"), "12:00 PM");
    // Kolkata is UTC+5:30 → 5:30 PM
    assert.equal(nowLocal(d, "Asia/Kolkata"), "5:30 PM");
  });

  it("ymdToHuman formats server logical date", () => {
    const s = ymdToHuman("2026-07-08", "Asia/Kolkata");
    assert.match(s, /July/);
    assert.match(s, /8/);
  });
});
