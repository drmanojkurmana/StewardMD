// test/queue-eta.test.mjs — pure queue logic: state machine, ordering, ETA, learning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, isTerminal, orderQueue, computeEtas, updateStats, meanFor, confidence, DEFAULT_CONSULT_MIN } from "../functions/_queue_eta.js";

test("state machine allows real transitions, blocks illegal ones", () => {
  assert.equal(canTransition("registered", "waiting"), true);
  assert.equal(canTransition("called", "in_consultation"), true);
  assert.equal(canTransition("in_consultation", "completed"), true);
  assert.equal(canTransition("waiting", "completed"), false);      // can't finish someone never seen
  assert.equal(canTransition("completed", "waiting"), false);      // terminal is terminal
  assert.equal(canTransition("registered", "banana"), false);      // unknown status
  assert.equal(isTerminal("no_show"), true);
  assert.equal(isTerminal("waiting"), false);
});

test("ordering: emergency > priority > arrival; excludes in-consult/terminal", () => {
  const tickets = [
    { id: "a", status: "waiting", priority: 0, registeredAt: 100 },
    { id: "b", status: "waiting", priority: 2, registeredAt: 300 },   // emergency, latest arrival
    { id: "c", status: "registered", priority: 1, registeredAt: 200 },// priority
    { id: "d", status: "in_consultation", priority: 0, registeredAt: 50 }, // excluded
    { id: "e", status: "completed", priority: 0, registeredAt: 10 },  // excluded
    { id: "f", status: "waiting", priority: 0, registeredAt: 50 }     // earliest normal
  ];
  const ids = orderQueue(tickets).map((t) => t.id);
  assert.deepEqual(ids, ["b", "c", "f", "a"]);   // emergency, priority, then arrival order
});

test("computeEtas: cumulative windows from when the doctor is free; confidence in [40,99]", () => {
  const now = 1_700_000_000_000;
  const ordered = [
    { id: "1", visitType: "new" },
    { id: "2", visitType: "followup" },
    { id: "3", visitType: "new" }
  ];
  const r = computeEtas(ordered, { nowMs: now, stats: null, inFlightRemainingMin: 5 });
  assert.equal(r[0].position, 1);
  // first patient starts 5 min out (current consult remaining), default 12-min slots
  assert.equal(r[0].etaStart, now + 5 * 60000);
  assert.equal(r[0].etaEnd, now + (5 + DEFAULT_CONSULT_MIN) * 60000);
  assert.equal(r[1].etaStart, now + (5 + DEFAULT_CONSULT_MIN) * 60000);
  assert.equal(r[2].etaStart, now + (5 + 2 * DEFAULT_CONSULT_MIN) * 60000);
  r.forEach((x) => { assert.ok(x.etaConfidence >= 40 && x.etaConfidence <= 99); });
});

test("learning: mean converges per visit type; meanFor prefers the visit-type mean", () => {
  let s = null;
  [10, 12, 14].forEach((d) => { s = updateStats(s, d, "new"); });      // mean 12
  [20, 24, 28].forEach((d) => { s = updateStats(s, d, "followup"); }); // mean 24
  assert.equal(Math.round(meanFor(s, "new")), 12);
  assert.equal(Math.round(meanFor(s, "followup")), 24);
  assert.equal(s.n, 6);                                                 // overall count
  assert.ok(meanFor(null, "new") === DEFAULT_CONSULT_MIN);              // cold start falls back
});

test("confidence tightens with low variance, loosens deeper in the queue", () => {
  let tight = null; [12, 12, 12, 12].forEach((d) => { tight = updateStats(tight, d, "new"); }); // sd 0
  let loose = null; [4, 24, 6, 22].forEach((d) => { loose = updateStats(loose, d, "new"); });   // high sd
  assert.ok(confidence(tight, 0) >= confidence(loose, 0));
  assert.ok(confidence(loose, 0) >= confidence(loose, 6));   // deeper in queue → lower confidence
});
