/* PrepNucleus per-question clock (prep.js qcNew / qcShow / qcPause / qcLeft / qcTick / qcNext), owner bug 2026-10-09:
 * each question's budget is spent once, only while it is on screen; leaving and coming back keeps what is left (no
 * reset); a budget that runs out locks the question for good; time is counted from timestamps, so a long gap (the app
 * in the background) is charged in full on the next tick; the hand-over goes to the next open question.
 *
 * node --test test/prep-qclock.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../prep.js");

test("a new clock: every question has the full budget, none running, none locked", () => {
  const c = P.qcNew(3, 30);
  assert.deepEqual(c.rem, [30000, 30000, 30000]);
  assert.deepEqual(c.out, [false, false, false]);
  assert.equal(c.on, -1);
  assert.equal(P.qcLeft(c, 0, 5000), 30000);
});

test("time counts only while the question is on screen and is remembered per question", () => {
  const c = P.qcNew(3, 30), t = 1_000_000;
  P.qcShow(c, 0, t);
  assert.equal(P.qcLeft(c, 0, t + 10000), 20000);
  P.qcShow(c, 1, t + 10000);             // move on: question 1 keeps 20 s
  assert.equal(P.qcLeft(c, 0, t + 50000), 20000, "off screen, question 1 does not count down");
  assert.equal(P.qcLeft(c, 1, t + 15000), 25000);
  P.qcShow(c, 0, t + 15000);             // come back
  assert.equal(P.qcLeft(c, 0, t + 15000), 20000, "no reset to 30 s on revisit");
  assert.equal(P.qcLeft(c, 1, t + 99000), 25000);
  P.qcShow(c, 0, t + 16000);             // a repaint of the same question changes nothing
  assert.equal(P.qcLeft(c, 0, t + 17000), 18000);
  P.qcPause(c, t + 17000);               // the grid hides it
  assert.equal(c.on, -1);
  assert.equal(P.qcLeft(c, 0, t + 60000), 18000);
});

test("running out locks the question for good; showing it again does not restart it", () => {
  const c = P.qcNew(2, 30), t = 0;
  P.qcShow(c, 0, t);
  assert.equal(P.qcTick(c, t + 29999), -1);
  assert.equal(P.qcTick(c, t + 30000), 0, "the tick reports the question it locked");
  assert.equal(c.out[0], true); assert.equal(c.rem[0], 0); assert.equal(c.on, -1);
  assert.equal(P.qcTick(c, t + 31000), -1, "locks once");
  P.qcShow(c, 0, t + 40000);
  assert.equal(c.on, -1, "a locked question's clock never runs again");
  assert.equal(P.qcLeft(c, 0, t + 50000), 0);
});

test("background: a long gap between ticks is charged in full (timestamps, not tick counts)", () => {
  const c = P.qcNew(2, 60), t = 5000;
  P.qcShow(c, 1, t);
  assert.equal(P.qcTick(c, t + 1000), -1);
  // the interval slept for 5 minutes in the background; the next tick (or the visibility event) sees the real time
  assert.equal(P.qcTick(c, t + 300000), 1);
  assert.equal(c.out[1], true);
  // a pause after the budget is gone also locks (the question was hidden at or past its end)
  const d = P.qcNew(1, 10); P.qcShow(d, 0, 0); P.qcPause(d, 15000);
  assert.equal(d.out[0], true); assert.equal(d.rem[0], 0);
  // a clock that steps backwards never adds time
  const e = P.qcNew(1, 10); P.qcShow(e, 0, 10000); P.qcPause(e, 4000);
  assert.equal(e.rem[0], 10000);
});

test("hand-over: the next open question after the one that ran out, else the first open one before it, else -1", () => {
  const c = P.qcNew(5, 30), open = () => true;
  assert.equal(P.qcNext(c, 1, open), 2);
  c.out[2] = c.out[3] = true;
  assert.equal(P.qcNext(c, 1, open), 4);
  c.out[4] = true;
  assert.equal(P.qcNext(c, 4, open), 0, "wraps to an earlier open question");
  c.out[0] = true;
  assert.equal(P.qcNext(c, 4, open), 1);
  assert.equal(P.qcNext(c, 4, (i) => i !== 1), -1, "practice: answered questions are not open, so the set is done");
});
