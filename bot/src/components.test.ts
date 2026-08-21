import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  customId,
  itemActionRow,
  parseCustomId,
  panelModalId,
  panelSetId,
  restoreRow,
  settingsRows,
  viewRows,
  type PanelField,
} from "./components.js";
import { installTestEnv, restoreTestEnv } from "./test/fixtures.js";
import type { UserSettings } from "./botApi.js";

installTestEnv();

describe("parseCustomId", () => {
  it("parses s2 item ops with ids containing colons", () => {
    assert.deepEqual(parseCustomId("s2:c:task-1"), { kind: "item", op: "c", id: "task-1" });
    const occ = "occ_abc-123_2026-08-21";
    assert.deepEqual(parseCustomId(`s2:k:${occ}`), { kind: "item", op: "k", id: occ });
    assert.deepEqual(parseCustomId("s2:ml"), { kind: "item", op: "ml", id: undefined });
  });

  it("still parses legacy s1 item ops", () => {
    assert.deepEqual(parseCustomId("s1:c:task-9"), { kind: "item", op: "c", id: "task-9" });
    assert.deepEqual(parseCustomId("s1:ml"), { kind: "item", op: "ml", id: undefined });
  });

  it("parses panel set and modal ids", () => {
    assert.deepEqual(parseCustomId("s2:p:set:reminders:on"), {
      kind: "panel-set",
      field: "reminders",
      value: "on",
    });
    assert.deepEqual(parseCustomId("s2:p:set:briefing_morning:off"), {
      kind: "panel-set",
      field: "briefing_morning",
      value: "off",
    });
    assert.deepEqual(parseCustomId(panelModalId("briefing_evening")), {
      kind: "panel-modal",
      field: "briefing_evening",
    });
  });

  it("rejects unknown ops and prefixes", () => {
    assert.equal(parseCustomId("s2:x:task"), null);
    assert.equal(parseCustomId("nope:c:task"), null);
    assert.equal(parseCustomId("s2:p:set:bogus:on"), null);
  });
});

describe("viewRows", () => {
  it("caps at five rows and skips completed items", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      completed_at: i === 0 ? "2026-08-21T00:00:00Z" : null,
    }));
    const rows = viewRows(items as never);
    assert.equal(rows.length, 5);
  });

  it("adds skip button only for occurrences", () => {
    const rows = viewRows([
      { id: "plain", title: "Plain" },
      { id: "occ_x_2026-08-21", title: "Occ", is_occurrence: true },
    ] as never);
    assert.equal(rows.length, 2);
    const plainButtons = rows[0].components.map(
      (b) => String((b.toJSON() as { label?: string }).label),
    );
    assert.ok(!plainButtons.includes("Skip"));
    const occButtons = rows[1].components.map(
      (b) => String((b.toJSON() as { label?: string }).label),
    );
    assert.ok(occButtons.includes("Skip"));
  });
});

describe("settingsRows", () => {
  const base: UserSettings = {
    timezone: "Asia/Kolkata",
    briefing_morning_time: "07:30:00",
    briefing_evening_time: null,
    quiet_hours_start: "23:00:00",
    quiet_hours_end: "07:00:00",
    reminders_enabled: true,
    overdue_enabled: false,
    capture_images: true,
    capture_voice: false,
  };

  it("renders at most five rows", () => {
    const rows = settingsRows(base);
    assert.ok(rows.length <= 5);
    for (const row of rows) assert.ok(row.components.length >= 1);
  });

  it("labels reflect current values", () => {
    const rows = settingsRows(base);
    const labels = rows.flatMap((r) =>
      r.components.map((b) => String((b.toJSON() as { label?: string }).label)),
    );
    assert.ok(labels.some((l) => l.includes("07:30")));
    assert.ok(labels.some((l) => l.includes("Evening off")));
    assert.ok(labels.some((l) => l.includes("Reminders ON")));
    assert.ok(labels.some((l) => l.includes("23:00–07:00")));
    assert.ok(labels.some((l) => l.includes("Voice OFF")));
  });

  it("toggle targets carry the opposite value", () => {
    const rows = settingsRows(base);
    const ids = rows.flatMap((r) =>
      r.components.map((b) => String((b.toJSON() as { custom_id?: string }).custom_id)),
    );
    assert.ok(ids.includes(panelSetId("reminders", "off")));
    assert.ok(ids.includes(panelSetId("capture_voice", "on")));
  });
});

describe("round trips", () => {
  it("itemActionRow and restoreRow produce parseable ids", () => {
    for (const row of [itemActionRow("t-1"), itemActionRow("occ_a_2026-08-21", { occurrence: true }), restoreRow("t-2")]) {
      for (const btn of row.components) {
        const id = String((btn.toJSON() as { custom_id?: string }).custom_id);
        assert.notEqual(parseCustomId(id), null, id);
      }
    }
  });

  it("every panel field round-trips", () => {
    const fields: PanelField[] = [
      "briefing_morning",
      "briefing_evening",
      "reminders",
      "quiet_clear",
      "capture_images",
      "capture_voice",
    ];
    for (const f of fields) {
      assert.notEqual(parseCustomId(panelSetId(f, "on")), null);
    }
  });
});
