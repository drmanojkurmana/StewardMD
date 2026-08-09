// test/queue-eta.test.mjs — pure queue logic: state machine, ordering, ETA, learning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, isTerminal, orderQueue, reorderSeq, computeEtas, updateStats, meanFor, confidence, DEFAULT_CONSULT_MIN } from "../functions/_queue_eta.js";

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

test("reorderSeq: move-to-#1 / down / no-op, and the persisted seq re-sorts the queue", () => {
  // A same-priority band ordered by arrival (registeredAt as default seq).
  const q = [
    { id: "a", status: "waiting", priority: 0, registeredAt: 100 },
    { id: "b", status: "waiting", priority: 0, registeredAt: 200 },
    { id: "c", status: "waiting", priority: 0, registeredAt: 300 },
    { id: "d", status: "waiting", priority: 0, registeredAt: 400 }
  ];
  const ordered = orderQueue(q);
  assert.deepEqual(ordered.map((t) => t.id), ["a", "b", "c", "d"]);

  // Move d (last, #4) to #1: it should sort first after we persist the returned seq.
  const rd = reorderSeq(ordered, "d", 0);
  assert.ok(rd && rd.seq < 100, "seq below the current top");
  q.find((t) => t.id === "d").seq = rd.seq;
  assert.deepEqual(orderQueue(q).map((t) => t.id), ["d", "a", "b", "c"]);

  // Move a down to index 2 (between the current occupants of slots 1 and 2).
  const ordered2 = orderQueue(q);   // ["d","a","b","c"]
  const ra = reorderSeq(ordered2, "a", 2);
  q.find((t) => t.id === "a").seq = ra.seq;
  assert.deepEqual(orderQueue(q).map((t) => t.id), ["d", "b", "a", "c"]);

  // No-op / invalid moves return null.
  assert.equal(reorderSeq(orderQueue(q), "a", orderQueue(q).findIndex((t) => t.id === "a")), null);
  assert.equal(reorderSeq(ordered, "zzz", 0), null);
});

test("concurrency: two independent moves computed against the same order never corrupt the queue", () => {
  // Two nurses reorder at the same instant; each reorderSeq is computed against the ORIGINAL order and
  // only writes its own ticket's seq. Applying both must yield a valid total order: all tickets present,
  // no duplicates, deterministic sort. (Last-writer wins on intent, but ordering is never corrupted.)
  const base = () => [
    { id: "a", status: "waiting", priority: 0, registeredAt: 100 },
    { id: "b", status: "waiting", priority: 0, registeredAt: 200 },
    { id: "c", status: "waiting", priority: 0, registeredAt: 300 },
    { id: "d", status: "waiting", priority: 0, registeredAt: 400 }
  ];
  const q = base();
  const ordered = orderQueue(q);                       // [a,b,c,d]
  const m1 = reorderSeq(ordered, "d", 0);              // nurse 1: d -> #1  (vs original order)
  const m2 = reorderSeq(ordered, "c", 1);              // nurse 2: c -> #2  (vs the SAME original order)
  q.find((t) => t.id === "d").seq = m1.seq;
  q.find((t) => t.id === "c").seq = m2.seq;
  const result = orderQueue(q).map((t) => t.id);
  assert.equal(result.length, 4, "no tickets lost");
  assert.equal(new Set(result).size, 4, "no duplicate positions");
  assert.deepEqual(orderQueue(q).map((t) => t.id), result, "sort is deterministic (stable on re-run)");
});

test("reorderSeq: emergencies stay on top — a manual move reorders within its priority band", () => {
  const q = [
    { id: "emg", status: "waiting", priority: 2, registeredAt: 500 },
    { id: "x", status: "waiting", priority: 0, registeredAt: 100 },
    { id: "y", status: "waiting", priority: 0, registeredAt: 200 }
  ];
  const ordered = orderQueue(q);   // ["emg","x","y"]
  // Try to move y to the very top (index 0): priority keeps emg first; y leads the normal band.
  const r = reorderSeq(ordered, "y", 0);
  q.find((t) => t.id === "y").seq = r.seq;
  assert.deepEqual(orderQueue(q).map((t) => t.id), ["emg", "y", "x"]);
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
