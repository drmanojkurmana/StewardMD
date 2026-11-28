// PrepNucleus Focus (prep-focus.js): the pure session engine. Plans, the phase at a time, focus minutes that skip
// breaks, saving into the store, streak, week, timeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const F = require("../prep-focus.js");

const T0 = new Date(2026, 10, 28, 9, 0, 0).getTime();
const min = (m) => m * 60e3;

test("formats clocks and minutes", () => {
  assert.equal(F.fmtClock(1500), "25:00");
  assert.equal(F.fmtClock(59.6), "01:00");
  assert.equal(F.fmtClock(3723), "1:02:03");
  assert.equal(F.fmtClock(-5), "00:00");
  assert.equal(F.fmtMin(45), "45m");
  assert.equal(F.fmtMin(120), "2h");
  assert.equal(F.fmtMin(80), "1h 20m");
});

test("plans: timer, pomodoro, stopwatch", () => {
  assert.deepEqual(F.planOf("timer", 50), [["f", 3000]]);
  const p = F.planOf("pomo", 0, 25);
  assert.equal(p.length, 7);
  assert.deepEqual(p.slice(0, 3), [["f", 1500], ["b", 300], ["f", 1500]]);
  assert.equal(p[p.length - 1][0], "f", "no break after the last block");
  assert.equal(F.focusBlocks(p), 4);
  assert.deepEqual(F.planOf("pomo", 0, 50).filter((x) => x[0] === "b").map((x) => x[1]), [600, 600]);
  assert.equal(F.planOf("watch")[0][1], 6 * 3600);
  assert.deepEqual(F.planOf("timer", "x"), [["f", 1500]], "a bad duration falls back to 25 min");
});

test("phaseAt walks the plan and counts only focus", () => {
  const run = { t0: T0, plan: F.planOf("pomo", 0, 25) };
  let ph = F.phaseAt(run, T0 + min(10));
  assert.equal(ph.kind, "f"); assert.equal(ph.i, 0); assert.equal(Math.round(ph.left), 900); assert.equal(Math.round(ph.done), 600);
  ph = F.phaseAt(run, T0 + min(27));
  assert.equal(ph.kind, "b"); assert.equal(Math.round(ph.done), 1500, "a break adds no focus");
  ph = F.phaseAt(run, T0 + min(32));
  assert.equal(ph.kind, "f"); assert.equal(ph.i, 2); assert.equal(F.blockNo(run.plan, ph.i), 2); assert.equal(Math.round(ph.done), 1620);
  ph = F.phaseAt(run, T0 + min(500));
  assert.equal(ph.over, true); assert.equal(Math.round(ph.done), 6000);
  assert.equal(F.phaseAt(run, T0 - 5000).done, 0, "a clock before the start is 0");
});

test("topTag picks the subject with most answers", () => {
  assert.equal(F.topTag({ Anatomy: 3, Pharmacology: 7 }), "Pharmacology");
  assert.equal(F.topTag({}), "");
});

test("saveRun stores minutes by day and month, skips under a minute, caps at the plan", () => {
  const fo = {}, fxm = {};
  assert.equal(F.saveRun(fo, fxm, { t0: T0, plan: [["f", 1500]] }, T0 + 40e3), null);
  const e = F.saveRun(fo, fxm, { t0: T0, plan: [["f", 1500]], q: 10, r: 7, tags: { Anatomy: 10 } }, T0 + min(40));
  assert.equal(e.m, 25, "time after the end is not counted");
  assert.equal(e.ok, 1); assert.equal(e.tag, "Anatomy"); assert.equal(e.q, 10); assert.equal(e.r, 7);
  assert.equal(fo.d["2026-11-28"], 25); assert.equal(fxm["2026-11"], 25); assert.equal(fo.log.length, 1);
  const e2 = F.saveRun(fo, fxm, { t0: T0 + min(60), plan: [["f", 3000]] }, T0 + min(72));
  assert.equal(e2.m, 12); assert.equal(e2.ok, 0, "ended early");
  assert.equal(fo.d["2026-11-28"], 37);
  for (let i = 0; i < 230; i++) F.saveRun(fo, fxm, { t0: T0 + i, plan: [["f", 120]] }, T0 + i + min(3));
  assert.equal(fo.log.length, 200, "log is capped");
});

test("streak counts days with 10+ minutes, from today or yesterday", () => {
  const d = { "2026-11-26": 30, "2026-11-27": 15, "2026-11-28": 12 };
  assert.equal(F.streak(d, T0), 3);
  assert.equal(F.streak({ "2026-11-26": 30, "2026-11-27": 15 }, T0), 2, "today not started yet keeps yesterday's streak");
  assert.equal(F.streak({ "2026-11-28": 5 }, T0), 0);
  assert.equal(F.streak({}, T0), 0);
});

test("week is the last 7 days, oldest first", () => {
  const w = F.week({ "2026-11-28": 40, "2026-11-22": 10 }, T0);
  assert.equal(w.length, 7);
  assert.equal(w[0].k, "2026-11-22"); assert.equal(w[0].m, 10);
  assert.equal(w[6].k, "2026-11-28"); assert.equal(w[6].m, 40); assert.equal(w[6].label, "S");
});

test("timeline places today's sessions and the live one", () => {
  const log = [{ s: T0, e: T0 + min(60) }, { s: T0 - 864e5, e: T0 - 864e5 + min(30) }];
  const tl = F.timeline(log, { t0: T0 + min(120) }, T0 + min(150));
  assert.equal(tl.length, 2, "yesterday is left out");
  assert.ok(Math.abs(tl[0].a - 9 / 24) < 1e-9); assert.ok(Math.abs(tl[0].b - 10 / 24) < 1e-9);
  assert.equal(tl[1].live, true);
});

test("schedules: labels, validity and the one on now", () => {
  assert.equal(F.schLabel({ from: "06:00", to: "08:00", days: [5, 1, 2, 3, 4] }), "6:00 to 8:00 AM, weekdays");
  assert.equal(F.schLabel({ from: "11:30", to: "13:00", days: [6, 0] }), "11:30 AM to 1:00 PM, weekends");
  assert.equal(F.schLabel({ from: "19:00", to: "21:00", days: [1, 3] }), "7:00 to 9:00 PM, Mon, Wed");
  assert.equal(F.schValid({ from: "09:00", to: "09:10", days: [1] }), false, "under 15 minutes");
  assert.equal(F.schValid({ from: "22:00", to: "01:00", days: [1] }), false, "no window across midnight");
  assert.equal(F.schValid({ from: "09:00", to: "10:00", days: [] }), false, "needs a day");
  assert.equal(F.schValid({ from: "9:00", to: "10:00", days: [2] }), true);
  const sat = new Date(2026, 10, 28, 7, 0).getTime(), mon = new Date(2026, 10, 30, 7, 0).getTime();
  const list = [{ id: "m", from: "06:00", to: "08:00", days: [1, 2, 3, 4, 5] }];
  assert.equal(F.schActive(list, sat), null, "weekday schedule is off on Saturday");
  assert.equal(F.schActive(list, mon).id, "m");
  assert.equal(F.schActive([{ ...list[0], on: false }], mon), null, "switched off");
  assert.equal(F.schActive(list, new Date(2026, 10, 30, 8, 0).getTime()), null, "the end minute is outside");
});
