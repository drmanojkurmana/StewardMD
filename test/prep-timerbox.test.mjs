/* PrepNucleus timer box and mode prefs (prep-setup.js, owner 2026-10-10): the timer is on by default at 60 s a question;
 * the stepper goes up to 100 s; the earlier strict-timer values (30 s, 45 s) stay reachable; saved version 1 choices
 * migrate without losing a chosen clock; the mode and the timer are remembered for the device (the "*" entry) on every
 * scope, the filters per scope.
 *
 * node --test test/prep-timerbox.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const S = require("../prep-setup.js");

test("defaults: Learning Mode, timer on, 60 s a question", () => {
  const d = S.normSel({});
  assert.equal(d.mode, "study");
  assert.equal(d.timer, "q");
  assert.equal(d.qs, 60);
  assert.equal(S.QS_DEF, 60);
  assert.deepEqual(S.runOpts({}, 20), { qsec: 60 });
});

test("seconds: 60 up to 100 in steps of 10; the earlier 30 and 45 s stay; never above 100", () => {
  assert.deepEqual(S.QSECS, [30, 45, 60, 70, 80, 90, 100]);
  assert.equal(S.QS_MAX, 100);
  assert.equal(S.stepQs(60, 1), 70);
  assert.equal(S.stepQs(90, 1), 100);
  assert.equal(S.stepQs(100, 1), 100, "clamped at 100");
  assert.equal(S.stepQs(60, -1), 45);
  assert.equal(S.stepQs(30, -1), 30, "clamped at the lowest step");
  assert.equal(S.snapQs(120), 100, "an older custom 120 s snaps to 100");
  assert.equal(S.snapQs(65), 70, "ties go up");
  assert.equal(S.snapQs(88), 90);
  assert.equal(S.snapQs(35), 30);
  assert.equal(S.snapQs("x"), 60);
  assert.equal(S.snapQs(5), 60, "nonsense values fall back to the default");
  assert.equal(S.normSel({ qs: 75 }).qs, 80);
});

test("red threshold in seconds: under 20% of the time (60 -> 12, 100 -> 20, 45 -> 9)", () => {
  assert.equal(S.lowAt(60), 12);
  assert.equal(S.lowAt(100), 20);
  assert.equal(S.lowAt(45), 9);
  assert.equal(S.LOW, 0.2);
});

test("Test Mode: timer off is untimed; each question; whole set", () => {
  assert.deepEqual(S.runOpts({ mode: "exam", timer: "off" }, 10), { untimed: true });
  assert.deepEqual(S.runOpts({ mode: "exam", timer: "q", qs: 100 }, 10), { qsec: 100 });
  assert.deepEqual(S.runOpts({ mode: "exam", timer: "set", mins: 0 }, 10), { limit: 600 });
});

test("migration of version 1 choices (strict timer sheet)", () => {
  // a chosen clock per question is kept, seconds snapped to the stepper
  assert.deepEqual(pick(S.migrate({ mode: "study", timer: "q", qs: 45 })), { mode: "study", timer: "q", qs: 45, v: 2 });
  assert.equal(S.normSel(S.migrate({ timer: "q", qs: 120 })).qs, 100);
  // whole set kept
  assert.deepEqual(pick(S.migrate({ mode: "exam", timer: "set", mins: 30 })), { mode: "exam", timer: "set", v: 2 });
  // a timed test's Off ran the whole set at exam pace: still does
  assert.equal(S.migrate({ mode: "exam", timer: "off" }).timer, "set");
  // practice Off was the old default: the new default (on, 60 s)
  const p = S.migrate({ mode: "study", timer: "off", qs: 90 });
  assert.equal(p.timer, "q"); assert.equal(p.qs, 60);
  // a version 2 choice is left alone, Off included
  assert.equal(S.migrate({ v: 2, mode: "study", timer: "off" }).timer, "off");
  function pick(o) { const r = { mode: o.mode, timer: o.timer, v: o.v }; if (o.timer === "q") r.qs = o.qs; return r; }
});

test("remembered: mode and timer for the device on every scope, filters per scope", () => {
  let m = S.remember({}, "module", "ana-x", { type: "case", n: 30, mode: "exam", timer: "q", qs: 90 });
  const y = S.recall(m, "subject", "anatomy");
  assert.equal(y.mode, "exam", "the last mode is preselected anywhere");
  assert.equal(y.qs, 90, "the timer seconds follow the student");
  assert.equal(y.type, "all", "filters stay per scope");
  m = S.remember(m, "bookmarks", "", { mode: "study", timer: "off" });
  const x = S.recall(m, "module", "ana-x");
  assert.equal(x.type, "case"); assert.equal(x.n, 30);
  assert.equal(x.mode, "study"); assert.equal(x.timer, "off", "the newest timer choice wins on an older scope");
  // a version 1 map (no "*", no v) migrates on read
  const old = { module: { type: "all", mode: "study", timer: "off", qs: 60, t: 1 }, "module:ana-z": { mode: "exam", timer: "q", qs: 30, t: 2 } };
  assert.deepEqual([S.recall(old, "module", "ana-z").timer, S.recall(old, "module", "ana-z").qs], ["q", 30]);
  assert.equal(S.recall(old, "module", "other").timer, "q", "the old practice Off becomes on");
  assert.equal(S.summary(S.recall(old, "module", "ana-z")), "20 questions · test mode, 30 s a question");
});
