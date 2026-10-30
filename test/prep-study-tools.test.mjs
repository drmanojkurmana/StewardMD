/* PrepNucleus study tools and timetable (owner 2026-10-30).
 * What must hold:
 *  - notes: saved, trimmed, capped at NOTE_MAX, an empty text deletes; marked test questions land in mk (not own deck
 *    or previous-year items);
 *  - practice stats rows: own deck and 5-option items are never sent; blanks are [id, null, s, -1];
 *  - reset: one subject clears only that subject's cards, accuracy, mistakes and coaching; every subject clears all
 *    progress; bookmarks and notes always stay;
 *  - stats ?pct=1: an item under PCT_MIN_N answers is never returned (no thin or made-up numbers);
 *  - rank: standing() gives rank and percentile only from MIN_N attempts, ties share a rank;
 *  - timetable: days split by size (at least one each, sums to the study days), rest days skipped, where() names the
 *    day, behind() lists unfinished past blocks, lay() keeps done subjects' past days and lays the rest from today.
 * node --test test/prep-study-tools.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as Stats from "../functions/api/prep/stats.js";
import * as Rank from "../functions/_prep-rank.js";

const require = createRequire(import.meta.url);
const T = require("../prep-tools.js");
const TT = require("../prep-timetable.js");

test("notes: save, trim, cap, delete", () => {
  const s = {};
  const it = { id: "q1", _s: "anatomy", _m: "brachial", q: "  Which   nerve supplies the deltoid?  " };
  assert.equal(T.setNote(s, it, "  axillary C5 C6 \n", 10), true);
  assert.deepEqual(s.qn.q1, ["anatomy", "brachial", "axillary C5 C6", 10, "Which nerve supplies the deltoid?"]);
  assert.equal(T.setNote(s, it, "axillary C5 C6", 11), false, "same text is no change");
  T.setNote(s, it, "x".repeat(T.NOTE_MAX + 50), 12);
  assert.equal(T.noteOf(s, "q1").length, T.NOTE_MAX);
  assert.equal(T.setNote(s, it, "   ", 13), true);
  assert.equal(s.qn.q1, undefined);
  assert.equal(T.setNote(s, it, "", 14), false, "deleting nothing is no change");
});

test("marked in tests: kept for bank items only", () => {
  const s = {};
  const items = [{ id: "a", _s: "anatomy", _m: "m1", q: "A" }, { id: "b", _s: "deck", _m: "d", q: "B" }, { id: "c", _s: "pyq", _py: 1, q: "C" }, { id: "d", _s: "physiology", _m: "m2", q: "D" }, { id: "e", _s: "anatomy", _m: "m1", q: "E", _gone: true }];
  const n = T.noteMarks(s, items, { 0: true, 1: true, 2: true, 3: false, 4: true }, 5);
  assert.equal(n, 1);
  assert.deepEqual(Object.keys(s.mk), ["a"]);
  assert.deepEqual(s.mk.a, ["anatomy", "m1", 5, "A"]);
});

test("practice stats rows", () => {
  const it = { id: "q1", _s: "anatomy", a: 2, o: ["a", "b", "c", "d"] };
  assert.deepEqual(T.statRow(it, 2, 12400), ["q1", 1, 12, 2]);
  assert.deepEqual(T.statRow(it, 0, 1000), ["q1", 0, 1, 0]);
  assert.deepEqual(T.statRow(it, -1, 0), ["q1", null, 0, -1]);
  assert.equal(T.statRow({ ...it, _s: "deck" }, 1, 0), null);
  assert.equal(T.statRow({ ...it, o: ["a", "b", "c", "d", "e"] }, 1, 0), null);
  assert.equal(T.statRow({ ...it, id: "bad id" }, 1, 0), null);
  assert.equal(T.statExam("mrcp-part1"), "mrcp");
  assert.equal(T.statExam("neet-pg"), "neet-pg");
  // The server accepts every exam tab the app sends.
  for (const ex of ["neet-pg", "neet-ss", "usmle", "fmge", "plab", "mrcs", "amc", "mccqe", "mrcp"]) assert.ok(Stats.EXAMS[ex], ex);
});

function progress() {
  return {
    cards: { "p:m1:q1": [1, 2, 3, 4, 1, 0], "p:m1:c:k1": [1, 1, 1, 1, 1, 0], "p:m2:q2": [1, 2, 3, 4, 1, 0] },
    conf: { "p:m1": { x: 1 }, "p:m2": { y: 1 } },
    mod: { m1: { t: 3, ok: 2 }, m2: { t: 1, ok: 0 } },
    mt: { q1: ["anatomy", "m1"], q2: ["physiology", "m2"] },
    coach_t: { "anatomy|m1": {}, "physiology|m2": {} }, coach_pairs: { "anatomy|m1": [] },
    ky_q: { q1: [1, 0, 0, 0], q2: [0, 1, 0, 0] }, ky_ty: { a: 1 },
    ra: [["m1", 1], ["m2", 0], ["m1", 0]], days: { 100: 4 }, last: { s: "anatomy", m: "m1" },
    bm: { q1: ["anatomy", "m1"] }, qn: { q1: ["anatomy", "m1", "n", 1, "s"] }, pt: { d: 1 }, mh: [{ ts: 1 }], t2h: [{ a: 1 }]
  };
}

test("reset one subject leaves the others, bookmarks and notes", () => {
  const s = progress();
  const p = T.resetApply(s, { m1: 1 }, "anatomy");
  assert.deepEqual(Object.keys(s.cards), ["p:m2:q2"]);
  assert.deepEqual(Object.keys(s.conf), ["p:m2"]);
  assert.deepEqual(Object.keys(s.mod), ["m2"]);
  assert.deepEqual(Object.keys(s.mt), ["q2"]);
  assert.deepEqual(Object.keys(s.coach_t), ["physiology|m2"]);
  assert.deepEqual(Object.keys(s.ky_q), ["q2"]);
  assert.deepEqual(s.ra, [["m2", 0]]);
  assert.equal(s.last, null);
  assert.equal(s.pt, null);
  assert.deepEqual(s.days, { 100: 4 }, "the streak stays on a one-subject reset");
  assert.ok(s.bm.q1 && s.qn.q1);
  assert.equal(p.cards.length, 2);
});

test("reset every subject clears all progress; tests only when asked", () => {
  const s = progress();
  T.resetApply(s, null, null, { tests: false });
  for (const k of ["cards", "conf", "mod", "mt", "coach_t", "ky_q", "days"]) assert.deepEqual(s[k], {}, k);
  assert.deepEqual(s.ra, []);
  assert.equal(s.mh.length, 1, "test history kept unless asked");
  assert.ok(s.bm.q1 && s.qn.q1);
  const s2 = progress();
  T.resetApply(s2, null, null, { tests: true });
  assert.deepEqual(s2.mh, []); assert.deepEqual(s2.t2h, []);
});

test("stats pct: nothing under the minimum, whole percents above it", () => {
  assert.equal(Stats.pctOf({ o0: 10, o1: 10, o2: 5, o3: 4 }), null, "29 answers is not enough");
  assert.deepEqual(Stats.pctOf({ o0: 15, o1: 9, o2: 3, o3: 3 }), { n: 30, o: [50, 30, 10, 10] });
  assert.deepEqual(Stats.pctIds("a1,a1,bad id,b2"), ["a1", "b2"]);
  assert.equal(Stats.pctIds(Array.from({ length: 100 }, (_, i) => "id" + i).join(",")).length, Stats.PCT_MAX_IDS);
});

test("stats pct GET answers only items with enough answers", async () => {
  const rows = [{ item_id: "q1", o0: 20, o1: 10, o2: 0, o3: 0 }, { item_id: "q2", o0: 1, o1: 1, o2: 0, o3: 0 }];
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) };
  const res = await Stats.onRequestGet({ request: new Request("https://x/api/prep/stats?pct=1&ids=q1,q2"), env: { PREP_STATS_DB: db } });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(Object.keys(j.items), ["q1"]);
  assert.deepEqual(j.items.q1.o, [67, 33, 0, 0]);
});

test("rank is served by the stats door, not a route of its own", async () => {
  const rows = [{ bin: 900, n: 30 }];
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }), run: async () => ({}) }) }) };
  const g = await Stats.onRequestGet({ request: new Request("https://x/api/prep/stats?rank=1&key=neet-pg:grand&pct=50"), env: { PREP_STATS_DB: db } });
  assert.equal(g.status, 200);
  const j = await g.json();
  assert.equal(j.n, 30); assert.equal(j.rank, 31); assert.equal(j.percentile, 0);
  const p = await Stats.onRequestPost({ request: new Request("https://x/api/prep/stats", { method: "POST", body: JSON.stringify({ v: 1, kind: "rank", key: "neet-pg:grand", pct: 95 }) }), env: { PREP_STATS_DB: db } });
  assert.equal(p.status, 200);
  const bad = await Stats.onRequestPost({ request: new Request("https://x/api/prep/stats", { method: "POST", body: JSON.stringify({ v: 1, kind: "rank", key: "bad key", pct: 95 }) }), env: { PREP_STATS_DB: db } });
  assert.equal(bad.status, 400);
});

test("rank: standing from the histogram", () => {
  assert.equal(Rank.binOf(55.55), 556);
  assert.equal(Rank.binOf(101), null);
  assert.equal(Rank.binOf(-25), -250);
  assert.ok(Rank.validKey("neet-pg:grand"));
  assert.ok(Rank.validKey("neet-pg:grand:PG2024.r1"));
  assert.ok(!Rank.validKey("NEET PG:grand"));
  const few = Rank.standing([{ bin: 500, n: 3 }], 500);
  assert.equal(few.rank, null); assert.equal(few.percentile, null); assert.equal(few.n, 3);
  const rows = [{ bin: 900, n: 5 }, { bin: 600, n: 4 }, { bin: 500, n: 2 }, { bin: 100, n: 9 }];
  const s = Rank.standing(rows, 600);
  assert.deepEqual(s, { n: 20, above: 5, same: 4, below: 11, min: Rank.MIN_N, rank: 6, percentile: 65 });
});

test("timetable: split by size, at least one day each", () => {
  assert.deepEqual(TT.split(10, [1, 1]), [5, 5]);
  const d = TT.split(30, [10, 5, 1]);
  assert.equal(d.reduce((a, b) => a + b, 0), 30);
  assert.ok(d[0] > d[1] && d[1] > d[2] && d[2] >= 1);
  assert.deepEqual(TT.split(2, [5, 5, 5]), [1, 1, 1], "more subjects than days: one each");
});

test("timetable: rest days skipped, today named, behind listed", () => {
  // Day 20000 = 2024-10-04, a Friday. Sundays off.
  const start = 20000, off = [0];
  assert.equal(TT.weekday(start), 5);
  const subjects = [{ id: "anatomy", w: 2 }, { id: "physiology", w: 1 }];
  const end = start + 10;   // 11 days, two Sundays (start + 2, start + 9) => 9 study days
  const sch = TT.schedule({ subjects, start, end, off, done: {} });
  assert.equal(TT.studyDays(start, end, off), 9);
  assert.equal(sch.blocks[0].days + sch.blocks[1].days, 9);
  assert.equal(sch.blocks[0].days, 6);
  assert.equal(sch.blocks[1].to, end);
  const tt = { start, end, off, done: {} };
  assert.deepEqual(TT.where(tt, sch.blocks, start + 2), { k: "rest" });
  assert.deepEqual(TT.where(tt, sch.blocks, start + 3), { k: "study", sid: "anatomy", n: 3, of: 6 });
  assert.deepEqual(TT.where(tt, sch.blocks, start - 1), { k: "before" });
  assert.deepEqual(TT.where(tt, sch.blocks, end + 1), { k: "rev" });
  assert.deepEqual(TT.behind(sch.blocks, {}, sch.blocks[0].to + 1), ["anatomy"]);
  assert.deepEqual(TT.behind(sch.blocks, { anatomy: 1 }, sch.blocks[0].to + 1), []);
});

test("timetable: re-plan keeps done days and lays the rest from today", () => {
  const start = 20000, off = [];
  const subjects = [{ id: "a", w: 1 }, { id: "b", w: 1 }, { id: "c", w: 1 }];
  const old = TT.schedule({ subjects, start, end: start + 8, off, done: {} }).blocks;   // 3 days each
  const today = start + 5, done = { a: start + 2 };
  const nb = TT.lay({ subjects, start: today, end: start + 8, off, done, old });
  assert.deepEqual(nb[0], { sid: "a", from: start, to: start + 2, days: 3 });
  assert.equal(nb.length, 3);
  assert.equal(nb[1].sid, "b"); assert.equal(nb[1].from, today);
  assert.equal(nb[2].to, start + 8);
  assert.equal(nb[1].days + nb[2].days, 4);
});

test("timetable: move and next module", () => {
  assert.deepEqual(TT.move(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(TT.move(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  const topics = [{ id: "mixed", group: "mixed" }, { id: "t1" }, { id: "t2" }, { id: "t3" }];
  assert.equal(TT.nextModule(topics, { t1: { t: 4, ok: 4 } }), "t2");
  assert.equal(TT.nextModule(topics, { t1: { t: 4, ok: 4 }, t2: { t: 4, ok: 1 }, t3: { t: 2, ok: 2 } }), "t2");
  assert.equal(TT.suggestEnd(100, null), 220);
  assert.equal(TT.suggestEnd(100, 200), 200 - TT.revDays(100) - 1);
});

test("reset limits: one in any 3 months, 3 in any 12 months", () => {
  const D = (s) => Date.parse(s + "T10:00:00Z");
  assert.deepEqual(T.resetQuota([], D("2026-01-10")), { used: 0, left: 3, ok: true, next: null });
  // One reset: the next is 3 months later.
  let q = T.resetQuota([D("2026-01-10")], D("2026-03-01"));
  assert.equal(q.ok, false); assert.equal(q.left, 2); assert.equal(q.next, T.addMonths(D("2026-01-10"), 3));
  assert.equal(T.resetQuota([D("2026-01-10")], D("2026-04-10")).ok, true);
  // Three in 9 months: the 4th waits for the first to be 12 months old, not just 3 months after the last.
  const three = [D("2026-01-10"), D("2026-04-10"), D("2026-07-10")];
  q = T.resetQuota(three, D("2026-10-11"));
  assert.equal(q.used, 3); assert.equal(q.left, 0); assert.equal(q.ok, false); assert.equal(q.next, T.addMonths(D("2026-01-10"), 12));
  assert.equal(T.resetQuota(three, D("2027-01-10")).ok, true);
  // Month ends do not spill: 30 Nov + 3 months is the end of February.
  assert.equal(new Date(T.addMonths(Date.parse("2026-11-30T10:00:00"), 3)).getDate(), 28);
  // noteReset keeps only the last 12 months.
  const s = { rsl: [D("2024-01-01"), D("2026-01-10")] };
  T.noteReset(s, D("2026-05-01"));
  assert.deepEqual(s.rsl, [D("2026-01-10"), D("2026-05-01")]);
});
