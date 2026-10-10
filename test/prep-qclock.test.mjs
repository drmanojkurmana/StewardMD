/* PrepNucleus per-question clock (prep.js qcNew / qcShow / qcPause / qcLeft / qcTick / qcStep / qcAfter / qcLevel /
 * qcStats). Owner 2026-10-09: each question's budget is spent once, only while it is on screen; a revisit carries on (no
 * reset); a budget that runs out locks the question for good. Owner 2026-10-10 (timer box): visible time only, so the
 * background, a locked screen and a sheet stop the clock and nothing is lost; a monotonic clock; red under 20%; Test Mode
 * moves to the next question with time, after the last one the test is marked.
 *
 * A fake clock: `run(c, from, to, step)` ticks every `step` ms like the app's 250 ms interval.
 * node --test test/prep-qclock.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../prep.js");
function run(c, from, to, step = 250) { let x = -1; for (let t = from + step; t <= to; t += step) { const k = P.qcTick(c, t); if (k >= 0 && x < 0) x = k; } return x; }

test("a new clock: every question has the full budget, none running, none locked", () => {
  const c = P.qcNew(3, 60);
  assert.deepEqual(c.rem, [60000, 60000, 60000]);
  assert.deepEqual(c.out, [false, false, false]);
  assert.deepEqual(c.used, [0, 0, 0]);
  assert.equal(c.on, -1);
  assert.equal(P.qcLeft(c, 0, 5000), 60000);
});

test("time counts only while the question is on screen and is remembered per question (no reset on revisit)", () => {
  const c = P.qcNew(3, 30), t = 1_000_000;
  P.qcShow(c, 0, t);
  run(c, t, t + 10000);
  assert.equal(P.qcLeft(c, 0, t + 10000), 20000);
  P.qcShow(c, 1, t + 10000);             // the next question restarts at its own full budget
  assert.equal(P.qcLeft(c, 1, t + 10000), 30000, "each question has its own countdown");
  assert.equal(P.qcLeft(c, 0, t + 50000), 20000, "off screen, question 1 does not count down");
  run(c, t + 10000, t + 15000);
  assert.equal(P.qcLeft(c, 1, t + 15000), 25000);
  P.qcShow(c, 0, t + 15000);             // come back
  assert.equal(P.qcLeft(c, 0, t + 15000), 20000, "no reset to 30 s on revisit");
  assert.equal(P.qcLeft(c, 1, t + 99000), 25000);
  run(c, t + 15000, t + 17000);
  assert.equal(P.qcLeft(c, 0, t + 17000), 18000);
  P.qcPause(c, t + 17000);               // the grid hides it
  assert.equal(c.on, -1);
  assert.equal(P.qcLeft(c, 0, t + 60000), 18000);
});

test("running out locks the question for good; showing it again does not restart it", () => {
  const c = P.qcNew(2, 30);
  P.qcShow(c, 0, 0);
  assert.equal(run(c, 0, 29750), -1);
  assert.equal(P.qcTick(c, 30000), 0, "the tick reports the question it locked");
  assert.equal(c.out[0], true); assert.equal(c.rem[0], 0); assert.equal(c.on, -1);
  assert.equal(P.qcTick(c, 31000), -1, "locks once");
  P.qcShow(c, 0, 40000);
  assert.equal(c.on, -1, "a locked question's clock never runs again");
  assert.equal(P.qcLeft(c, 0, 50000), 0);
});

test("pause and resume: background, screen lock or a sheet cost nothing; the clock goes on where it stopped", () => {
  const c = P.qcNew(1, 60);
  P.qcShow(c, 0, 0);
  run(c, 0, 20000);
  P.qcPause(c, 20000);                   // the app goes to the background (visibilitychange hidden)
  assert.equal(P.qcLeft(c, 0, 20000 + 300000), 40000, "five minutes away are not charged");
  P.qcShow(c, 0, 320000);                // back in front
  run(c, 320000, 330000);
  assert.equal(P.qcLeft(c, 0, 330000), 30000);
});

test("a frozen page (no event, a long gap between readings) is not charged; a backwards clock adds nothing", () => {
  const c = P.qcNew(2, 60);
  P.qcShow(c, 1, 5000);
  assert.equal(P.qcTick(c, 6000), -1);
  assert.equal(P.qcLeft(c, 1, 6000), 59000);
  assert.equal(P.qcLeft(c, 1, 6000 + 300000), 59000, "a reading after a long gap shows the time as it was");
  assert.equal(P.qcTick(c, 6000 + 300000), -1, "the phone was locked 5 minutes: nothing is charged");
  assert.equal(P.qcLeft(c, 1, 306000), 59000);
  run(c, 306000, 307000);
  assert.equal(P.qcLeft(c, 1, 307000), 58000, "and it carries on from there");
  assert.equal(P.QC_GAP, 3000);
  const e = P.qcNew(1, 10); P.qcShow(e, 0, 10000); P.qcPause(e, 4000);
  assert.equal(e.rem[0], 10000, "a clock that steps backwards never adds time");
});

test("no drift: 100 s of ticks at uneven intervals spend exactly 100 s", () => {
  const c = P.qcNew(1, 100);
  P.qcShow(c, 0, 0);
  let t = 0, k = -1, i = 0;
  while (k < 0 && t < 200000) { t += [250, 249, 251, 300, 180, 333][i++ % 6]; k = P.qcTick(c, t); }
  assert.equal(k, 0);
  assert.ok(t >= 100000 && t < 100400, "locked on the first tick at or past 100 s: " + t);
  assert.equal(c.used[0], 100000, "used is exact, capped at the budget");
});

test("line level: green over half, amber to 20%, red strictly under 20% (60 s: the last 12 s; 100 s: the last 20 s)", () => {
  assert.equal(P.qcLevel(60000, 60000), "ok");
  assert.equal(P.qcLevel(30001, 60000), "ok");
  assert.equal(P.qcLevel(30000, 60000), "mid");
  assert.equal(P.qcLevel(12000, 60000), "mid", "exactly 20% left is not red yet");
  assert.equal(P.qcLevel(11999, 60000), "low", "under 20% is red");
  assert.equal(P.qcLevel(20000, 100000), "mid");
  assert.equal(P.qcLevel(19999, 100000), "low");
  assert.equal(P.qcLevel(1, 100000), "low");
  assert.equal(P.qcLevel(0, 60000), "out");
});

test("Test Mode hand-over: the next question after the one that ran out that still has time, else -1 (marked)", () => {
  const c = P.qcNew(5, 30);
  assert.equal(P.qcAfter(c, 1), 2);
  c.out[2] = c.out[3] = true;
  assert.equal(P.qcAfter(c, 1), 4);
  assert.equal(P.qcAfter(c, 4), -1, "the last question: the test is marked, no wrap to earlier questions");
  c.out[4] = true;
  assert.equal(P.qcAfter(c, 3), -1);
  // the older hand-over (qcNext) is kept for its callers
  assert.equal(P.qcNext(P.qcNew(3, 30), 2, () => true), 0);
});

test("result stats: average seconds over the questions shown, timed-out count", () => {
  const c = P.qcNew(4, 60);
  P.qcShow(c, 0, 0); run(c, 0, 20000);
  P.qcShow(c, 1, 20000); run(c, 20000, 80000);   // runs out
  P.qcShow(c, 2, 80000); run(c, 80000, 90000); P.qcPause(c, 90000);
  assert.deepEqual(P.qcStats(c), { avg: 30, n: 3, out: 1 });
  assert.equal(P.qcStats(null), null);
});
