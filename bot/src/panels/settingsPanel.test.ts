import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyPanelSet,
  isValidClock,
  normalizeStoredClock,
  panelEmbed,
} from "./settingsPanel.js";
import { parseCustomId, settingsRows } from "../components.js";
import { installTestEnv } from "../test/fixtures.js";
import type { UserSettings } from "../botApi.js";

installTestEnv();

const base: UserSettings = {
  timezone: "Asia/Kolkata",
  briefing_morning_time: null,
  briefing_evening_time: null,
  quiet_hours_start: null,
  quiet_hours_end: null,
  reminders_enabled: true,
  overdue_enabled: false,
  capture_images: true,
  capture_voice: true,
};

describe("isValidClock", () => {
  it("accepts HH:MM 24h", () => {
    for (const v of ["00:00", "07:30", "21:05", "23:59"]) {
      assert.equal(isValidClock(v), true, v);
    }
  });

  it("rejects junk", () => {
    for (const v of ["24:00", "7:5", "12:60", "abc", "", "12:00pm", "12"]) {
      assert.equal(isValidClock(v), false, v);
    }
  });
});

describe("applyPanelSet", () => {
  it("briefing off clears only that slot", () => {
    const s = { ...base, briefing_morning_time: "07:00" };
    assert.deepEqual(applyPanelSet("briefing_morning", "off", s), {
      briefing_morning_time: null,
    });
  });

  it("briefing clock sets time", () => {
    assert.deepEqual(applyPanelSet("briefing_evening", "21:00", base), {
      briefing_evening_time: "21:00",
    });
  });

  it("reminders toggles boolean", () => {
    assert.deepEqual(applyPanelSet("reminders", "off", base), { reminders_enabled: false });
    assert.deepEqual(applyPanelSet("reminders", "on", base), { reminders_enabled: true });
  });

  it("quiet_clear clears both bounds", () => {
    const s = { ...base, quiet_hours_start: "23:00", quiet_hours_end: "07:00" };
    assert.deepEqual(applyPanelSet("quiet_clear", undefined, s), {
      quiet_hours_start: null,
      quiet_hours_end: null,
    });
  });

  it("capture toggles booleans", () => {
    assert.deepEqual(applyPanelSet("capture_images", "off", base), { capture_images: false });
    assert.deepEqual(applyPanelSet("capture_voice", "off", base), { capture_voice: false });
  });

  it("unknown field returns empty body", () => {
    assert.deepEqual(applyPanelSet("bogus" as never, "x", base), {});
  });
});

describe("normalizeStoredClock", () => {
  it("trims seconds from API values", () => {
    assert.equal(normalizeStoredClock("07:30:00"), "07:30");
    assert.equal(normalizeStoredClock(null), "");
  });
});

describe("panel rendering", () => {
  it("embed shows timezone and briefing state", () => {
    const embed = panelEmbed(base, { timezone: "Asia/Kolkata", today: "2026-08-21" });
    const data = embed.toJSON();
    assert.equal(data.title, "⚙️ Settings");
    assert.match(String(data.description), /Asia\/Kolkata/);
    assert.match(String(data.description), /morning.*off/i);
  });

  it("rows round-trip through parseCustomId", () => {
    const s = { ...base, briefing_morning_time: "07:30", reminders_enabled: false };
    for (const row of settingsRows(s)) {
      for (const btn of row.components) {
        const id = String((btn.toJSON() as { custom_id?: string }).custom_id);
        if (id.endsWith(":noop")) continue;
        assert.notEqual(parseCustomId(id), null, id);
      }
    }
  });
});
