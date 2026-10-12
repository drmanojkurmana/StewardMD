import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SP = require("../smd-spring.js");
const SD = require("../sheet-drag.js");
const VT = require("../view-transitions.js");
const LT = require("../large-title.js");
const PR = require("../pull-refresh.js");
const PH = require("../picker-haptics.js");
const SK = require("../skeletons.js");
const LP = require("../long-press-preview.js");
const LA = require("../live-activities.js");

test("spring settles, and a release velocity carries past the start", () => {
  const r = SP.simulate(0, 100, 0, 380, 34);
  assert.ok(r.steps > 0 && r.steps < 240 * 1.5, "settles within 1.5s: " + r.steps);
  const fling = SP.simulate(0, 0, -2000, 380, 34);
  assert.ok(Math.min(...fling.path) < -20, "a fling overshoots in its direction first");
});

test("sheet drag: distance or flick dismisses, rubber band upward", () => {
  assert.equal(SD.shouldDismiss(250, 0, 700), true);
  assert.equal(SD.shouldDismiss(40, 0, 700), false);
  assert.equal(SD.shouldDismiss(20, 900, 700), true);
  assert.equal(SD.shouldDismiss(8, 2000, 700), false, "a twitch is not a flick");
  assert.ok(SD.rubber(-100) > -100 && SD.rubber(-100) < 0);
  assert.equal(SD.rubber(30), 30);
  assert.equal(SD.isBottomSheetRect({ top: 300, bottom: 844, width: 390, height: 544 }, 390, 844), true);
  assert.equal(SD.isBottomSheetRect({ top: 0, bottom: 844, width: 390, height: 844 }, 390, 844), false, "a full-screen page is not a sheet");
  assert.equal(SD.isBottomSheetRect({ top: 700, bottom: 800, width: 390, height: 100 }, 390, 844), false);
});

test("view transitions: heading match is case/space-insensitive and never trivial", () => {
  assert.equal(VT.titleMatch("Amiodarone", "  amiodarone "), true);
  assert.equal(VT.titleMatch("Amiodarone", "Amiodarone (oral)"), true);
  assert.equal(VT.titleMatch("Back", "Ba"), false);
  assert.equal(VT.titleMatch("Aspirin", "Atorvastatin"), false);
  assert.equal(VT.isRowRect({ width: 360, height: 70 }, 390), true);
  assert.equal(VT.isRowRect({ width: 90, height: 90 }, 390), false, "tiles are not rows");
});

test("large title: progress and styles", () => {
  assert.equal(LT.progress(0, 60), 0);
  assert.equal(LT.progress(60, 60), 1);
  assert.equal(LT.progress(999, 60), 1);
  assert.deepEqual(LT.titleStyle(0, 0), { s: 1, o: 1 });
  assert.ok(LT.titleStyle(-60, 0).s > 1, "over-pull grows the title");
  assert.ok(LT.titleStyle(30, 0.5).s < 1 && LT.titleStyle(30, 0.5).o < 1);
});

test("pull to refresh: resistance is monotonic and capped", () => {
  let prev = -1;
  for (let d = 0; d <= 1000; d += 50) { const r = PR.resist(d); assert.ok(r >= prev); prev = r; }
  assert.ok(PR.resist(10000) <= PR.MAX);
  assert.equal(PR.triggered(PR.resist(60)), false);
  assert.equal(PR.triggered(PR.resist(160)), true);
});

test("picker haptics: step index", () => {
  assert.equal(PH.stepIndex("2.5", "0", "0.5"), 5);
  assert.equal(PH.stepIndex("70", "", "any"), 70);
  assert.equal(PH.stepIndex("", "0", "1"), null);
  assert.equal(PH.snapIndex(88, 44), 2);
});

test("skeletons: only whole-placeholder loading text", () => {
  for (const t of ["Loading…", "Loading ward patients…", "Loading...", "Syncing labs into ICU dashboard…", "Fetching"]) assert.equal(SK.isPlaceholderText(t), true, t);
  for (const t of ["Load more", "Downloading 3 files", "Loaded 3 patients and 4 labs in the ward today, all reviewed by the team", ""]) assert.equal(SK.isPlaceholderText(t), false, t);
});

test("long-press menu placement stays on screen", () => {
  assert.deepEqual(LP.placeMenu({ top: 100, bottom: 180 }, 120, 844), { top: 190, side: "below" });
  assert.equal(LP.placeMenu({ top: 600, bottom: 780 }, 120, 844).side, "above");
  const over = LP.placeMenu({ top: 40, bottom: 820 }, 300, 844);
  assert.ok(over.top >= 12 && over.top + 300 <= 844 - 12 + 0.001);
  assert.equal(LP.labelOf("  Call  "), "Call");
  assert.equal(LP.labelOf("x".repeat(40)), "", "long text is not a label");
});

test("live activity payloads are clipped and shaped (Lock Screen backstop)", () => {
  assert.equal(LA.sanitize({}), null);
  const p = LA.sanitize({ key: "icu-tasks", title: "t".repeat(80), detail: "d".repeat(99), startedAt: 1000, endsAt: 500, symbol: "rm -rf", tint: "red" });
  assert.equal(p.title.length, 40);
  assert.equal(p.detail.length, 60);
  assert.equal(p.symbol, "timer");
  assert.equal(p.tint, "#0F766E");
  assert.ok(p.endsAt > p.startedAt, "an end before the start is corrected");
  assert.equal(LA.sanitize({ key: "opd-queue", startedAt: 0 }).startedAt > 0, true);
});
