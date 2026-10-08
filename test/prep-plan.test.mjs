/* PrepNucleus plan (prep-plan.js) pure helpers: readiness, the day planner, item progress, onboarding answers, FMGE.
 * What must hold: readiness is the geometric mean of coverage x retention x accuracy x 100, coverage follows the exam
 * blueprint (FMGE) or the module count, retention is FSRS retrievability today, accuracy is the last 200 answers (module
 * totals before the log existed); nothing done is 0 and "empty"; the planner puts due reviews first, a lesson in the
 * weakest subject, then new questions, a mock on weekends (every day in the last 14 days), and its total never passes
 * the daily minutes; FMGE uses all 19 MBBS subjects and the bulletin's pattern.
 * node --test test/prep-plan.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../prep-plan.js");
const P = require("../prep.js");
const C = require("../specialty-core.js");

const TODAY = 20000;
const subjects = [
  { id: "anatomy", name: "Anatomy", mods: ["a1", "a2", "a3", "a4"] },
  { id: "physiology", name: "Physiology", mods: ["p1", "p2"] },
  { id: "pathology", name: "Pathology", mods: ["q1", "q2", "q3", "q4", "q5", "q6"] }
];
// A card answered `ago` days ago with stability s, due on `due`.
const card = (s, ago, due, reps = 1) => [5, s, TODAY - ago, due == null ? TODAY + 5 : due, reps, 0];
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("readiness: nothing done is 0, empty, with every factor 0", () => {
  const r = L.readiness({ subjects, store: P.emptyStore(), today: TODAY });
  assert.equal(r.score, 0); assert.equal(r.empty, true);
  assert.deepEqual([r.cov, r.ret, r.acc, r.cards, r.answers, r.attempted, r.modules], [0, 0, 0, 0, 0, 0, 12]);
  assert.equal(r.weakest.length, 3);
  assert.deepEqual(r.weakest.map((x) => x.id), ["pathology", "anatomy", "physiology"], "ties: the heaviest subject first");
});

test("readiness: geometric mean of the three factors, x 100", () => {
  const s = P.emptyStore();
  s.cards["p:a1:x"] = card(10, 0); s.cards["p:a2:y"] = card(10, 10); s.cards["p:p1:z"] = card(4, 2);
  s.mod = { a1: { t: 1, ok: 1 }, a2: { t: 1, ok: 0 }, p1: { t: 1, ok: 1 } };
  s.ra = [["a1", 1], ["a2", 0], ["p1", 1], ["zz-other-exam", 0]];
  const r = L.readiness({ subjects, store: s, today: TODAY });
  const ret = (C.retrievability(0, 10) + C.retrievability(10, 10) + C.retrievability(2, 4)) / 3;
  assert.ok(close(r.cov, 3 / 12), "3 of 12 modules attempted, weights = module counts");
  assert.ok(close(r.ret, ret));
  assert.ok(close(r.acc, 2 / 3), "answers outside the exam are not counted");
  assert.equal(r.score, Math.round(100 * Math.cbrt((3 / 12) * ret * (2 / 3))));
  assert.equal(r.empty, false);
  const an = r.subjects.find((x) => x.id === "anatomy");
  assert.deepEqual([an.att, an.mods, an.cards, an.n, an.ok], [2, 4, 2, 2, 1]);
  assert.ok(close(an.cov, 0.5) && close(an.acc, 0.5));
  assert.equal(r.weakest[0].id, "pathology", "untouched subject is weakest");
});

test("readiness: blueprint weights coverage; a subject missing from it weighs 0", () => {
  const s = P.emptyStore();
  s.mod = { p1: { t: 2, ok: 2 }, p2: { t: 1, ok: 1 } };
  s.cards["p:p1:a"] = card(30, 0); s.cards["p:p2:b"] = card(30, 0);
  const r = L.readiness({ subjects, weights: { anatomy: 10, physiology: 30 }, store: s, today: TODAY });
  assert.ok(close(r.cov, 30 / 40), "physiology fully covered = 30 of 40 blueprint marks");
  assert.ok(!r.weakest.some((x) => x.id === "pathology"), "weight 0 never listed among the weakest");
  assert.ok(close(r.acc, 1), "no log yet: module totals");
});

test("readiness: accuracy reads only the last 200 answers", () => {
  const s = P.emptyStore();
  s.cards["p:a1:x"] = card(10, 0);
  for (let i = 0; i < 300; i++) L.noteAnswer(s, "a1", i >= 100);   // first 100 wrong, then 200 right
  const r = L.readiness({ subjects, store: s, today: TODAY });
  assert.equal(r.answers, 200); assert.equal(r.acc, 1);
  for (let i = 0; i < 700; i++) L.noteAnswer(s, "a1", 0);
  assert.equal(s.ra.length, 600, "the log is capped");
});

test("readiness: all wrong scores 0 but is not the empty state", () => {
  const s = P.emptyStore();
  s.cards["p:a1:x"] = card(1, 0); L.noteAnswer(s, "a1", 0);
  const r = L.readiness({ subjects, store: s, today: TODAY });
  assert.equal(r.score, 0); assert.equal(r.empty, false);
});

test("daysLeft: none without a date or after it; 0 on the day", () => {
  const td = L.dayOfDate("2026-10-06");
  assert.equal(L.daysLeft(null, td), null);
  assert.equal(L.daysLeft("not a date", td), null);
  assert.equal(L.daysLeft("2026-10-05", td), null);
  assert.equal(L.daysLeft("2026-10-06", td), 0);
  assert.equal(L.daysLeft("2026-10-31", td), 25);
  assert.equal(L.dayOfDate("2026-10-06"), C.dayNum(Date.UTC(2026, 9, 6, 12), 0), "same day scale as SPECIALTY_CORE.dayNum");
});

const base = { minutes: 60, due: 0, perQ: 1, lesson: null, mock: { id: "neet-pg", label: "NEET-PG pattern", min: 53 }, weekend: false, daysLeft: null, weak: [] };
const kinds = (p) => p.items.map((i) => i.k).join(",");

test("planDay: reviews first, then the lesson, then new questions; total within the minutes", () => {
  const p = L.planDay({ ...base, due: 20, lesson: { m: "med-x", s: "medicine", title: "X", minutes: 6 }, weak: [{ s: "anatomy", m: "a1" }] });
  assert.equal(kinds(p), "rev,lsn,new");
  assert.deepEqual([p.items[0].n, p.items[0].min], [20, 10]);
  assert.equal(p.items[2].n, 44); assert.deepEqual(p.items[2].mods, [{ s: "anatomy", m: "a1" }]);
  assert.equal(p.total, 60);
});

test("planDay: a big review load takes the whole day and nothing else", () => {
  const p = L.planDay({ ...base, minutes: 15, due: 400, lesson: { m: "x", s: "y", title: "X", minutes: 5 } });
  assert.equal(kinds(p), "rev"); assert.deepEqual([p.items[0].n, p.total], [30, 15]);
});

test("planDay: nothing due and no lesson -> new questions only; under 5 fitting -> none", () => {
  assert.equal(kinds(L.planDay({ ...base, minutes: 15 })), "new");
  assert.equal(L.planDay({ ...base, minutes: 15 }).items[0].n, 15);
  const p = L.planDay({ ...base, minutes: 15, due: 24 });
  assert.equal(kinds(p), "rev", "12 min of reviews leaves 3 min: no 3-question set");
  assert.equal(L.planDay({ ...base, minutes: 15, perQ: 1.5 }).items[0].n, 10, "USMLE pace");
});

test("planDay: a lesson that does not fit is left out", () => {
  const p = L.planDay({ ...base, minutes: 15, due: 20, lesson: { m: "x", s: "y", title: "X", minutes: 6 } });
  assert.equal(kinds(p), "rev,new");
});

test("planDay: weekends add a mini mock when it fits; weekdays never", () => {
  assert.equal(kinds(L.planDay({ ...base, minutes: 90, weekend: true, due: 10 })), "rev,new,mock");
  assert.equal(kinds(L.planDay({ ...base, minutes: 30, weekend: true })), "new", "mock 53 min does not fit 30");
  assert.equal(kinds(L.planDay({ ...base, minutes: 120 })), "new");
});

test("planDay: last 14 days -> no new lesson, a mock every day when it fits", () => {
  const lesson = { m: "x", s: "y", title: "X", minutes: 5 };
  assert.equal(kinds(L.planDay({ ...base, minutes: 120, daysLeft: 10, lesson })), "new,mock");
  assert.equal(kinds(L.planDay({ ...base, minutes: 120, daysLeft: 40, lesson })), "lsn,new");
  assert.equal(kinds(L.planDay({ ...base, minutes: 120, daysLeft: null, lesson })), "lsn,new");
});

test("planDay: the total never passes the daily minutes", () => {
  for (const minutes of L.MINUTES) for (const due of [0, 1, 7, 33, 500]) for (const weekend of [false, true]) for (const perQ of [1, 1.5]) for (const daysLeft of [null, 3, 100]) {
    const p = L.planDay({ ...base, minutes, due, weekend, perQ, daysLeft, lesson: { m: "x", s: "y", title: "X", minutes: 7 } });
    assert.ok(p.total <= minutes, JSON.stringify({ minutes, due, weekend, perQ, daysLeft, total: p.total }));
    assert.equal(p.total, p.items.reduce((a, i) => a + i.min, 0));
    if (due) assert.equal(p.items[0].k, "rev", "reviews come first when anything is due");
  }
});

test("pickLesson: the weakest subject that has an unfinished lesson", () => {
  const lessons = [{ m: "med-a", s: "medicine", title: "A", minutes: 5 }, { m: "phm-b", s: "pharmacology", title: "B", minutes: 5 }, { m: "phm-c", s: "pharmacology", title: "C", minutes: 5 }];
  const s = P.emptyStore();
  assert.equal(L.pickLesson(lessons, ["anatomy", "pharmacology", "medicine"], s).m, "phm-b");
  s.ls["phm-b"] = { done: 1 };
  assert.equal(L.pickLesson(lessons, ["anatomy", "pharmacology", "medicine"], s).m, "phm-c");
  s.ls["phm-c"] = { done: 1 };
  assert.equal(L.pickLesson(lessons, ["anatomy", "pharmacology", "medicine"], s).m, "med-a");
  assert.equal(L.pickLesson(lessons, ["anatomy"], s), null);
});

test("itemProgress: reviews by due drop, new by cards made today, lesson and mock by today's finish", () => {
  const s = P.emptyStore(), dayOf = (ms) => Math.floor(ms / 864e5);
  s.cards["p:a1:x"] = card(3, 3, TODAY); s.cards["p:a1:y"] = card(3, 3, TODAY - 1); s.cards["p:a1:z"] = card(3, 3, TODAY);
  const rev = { k: "rev", n: 2, due0: L.dueNow(s, TODAY) };
  assert.deepEqual(L.itemProgress(rev, s, TODAY, dayOf), { x: 0, of: 2, done: false });
  s.cards["p:a1:x"][3] = TODAY + 4;
  assert.deepEqual(L.itemProgress(rev, s, TODAY, dayOf), { x: 1, of: 2, done: false });
  s.cards["p:a1:y"][3] = TODAY + 1;
  assert.equal(L.itemProgress(rev, s, TODAY, dayOf).done, true);
  const nw = { k: "new", n: 2, base: L.newToday(s, TODAY) };
  C.review(s, "p:a2", "n1", 3, TODAY); C.review(s, "p:a2", "n2", 1, TODAY);
  assert.deepEqual(L.itemProgress(nw, s, TODAY, dayOf), { x: 2, of: 2, done: true });
  const ls = { k: "lsn", m: "a1" };
  assert.equal(L.itemProgress(ls, s, TODAY, dayOf).done, false);
  s.ls.a1 = { done: (TODAY - 1) * 864e5 + 5 };
  assert.equal(L.itemProgress(ls, s, TODAY, dayOf).done, false, "finished yesterday does not tick today");
  s.ls.a1.done = TODAY * 864e5 + 5;
  assert.equal(L.itemProgress(ls, s, TODAY, dayOf).done, true);
  const mk = { k: "mock", t0: TODAY * 864e5 };
  assert.equal(L.itemProgress(mk, s, TODAY, dayOf).done, false);
  s.mh.push({ ts: TODAY * 864e5 + 100, label: "x", marks: 1, max: 4, n: 1 });
  assert.equal(L.itemProgress(mk, s, TODAY, dayOf).done, true);
});

test("newToday and dueNow skip module flashcards (p:<module>:c:<cardId>)", () => {
  const s = P.emptyStore();
  C.review(s, "p:a1", "q1", 3, TODAY);
  C.review(s, "p:a1:c", "c01", 3, TODAY); C.review(s, "p:a1:c", "c02", 1, TODAY);
  assert.equal(L.newToday(s, TODAY), 1);
  s.cards["p:a1:c:c01"][3] = TODAY; s.cards["p:a1:q1"][3] = TODAY + 3;
  assert.equal(L.dueNow(s, TODAY), 0);
});

test("subjectAction: most due, then the weakest, then the first untouched module", () => {
  const mods = [{ id: "a1", title: "A1", n: 10 }, { id: "a2", title: "A2", n: 10 }, { id: "a3", title: "A3", n: 0 }, { id: "a4", title: "A4", n: 8 }];
  const s = P.emptyStore();
  assert.deepEqual(L.subjectAction(mods, s, TODAY), { k: "start", m: "a1", title: "A1" });
  s.mod.a1 = { t: 10, ok: 3 }; s.cards["p:a1:x"] = card(3, 3, TODAY + 3);
  assert.deepEqual(L.subjectAction(mods, s, TODAY), { k: "weak", m: "a1", title: "A1" });
  s.cards["p:a2:x"] = card(3, 3, TODAY); s.cards["p:a2:y"] = card(3, 3, TODAY);
  assert.deepEqual(L.subjectAction(mods, s, TODAY), { k: "due", m: "a2", title: "A2", n: 2 });
  assert.equal(L.subjectAction([], s, TODAY), null);
});

test("onboarding answers: first open needs onboarding until finished or skipped", () => {
  assert.equal(L.needsOnboard(P.emptyStore()), true);
  assert.equal(L.needsOnboard({ pl: { ob: 1 } }), false);
  assert.deepEqual(L.EXAM_CHOICES.map((e) => e.id), ["neet-pg", "ini-cet", "neet-ss", "usmle", "fmge"]);
  assert.equal(L.choiceOf("ini-cet").tab, "neet-pg");
  assert.deepEqual(L.MINUTES, [15, 30, 60, 90, 120]);
});

test("FMGE: exam tab over the whole MBBS bank, the bulletin's pattern and blueprint", () => {
  const fm = P.examOf("fmge");
  assert.equal(fm.id, "fmge"); assert.equal(fm.branch, "mbbs"); assert.equal(fm.all, true);
  const m = P.mockOf("fmge", "fmge");
  assert.deepEqual([m.n, m.min, m.plus, m.minus, m.parts, m.pass], [300, 300, 1, 0, 2, 150]);
  const items = Array.from({ length: 4 }, (_, i) => ({ id: "x" + i, a: 0, _s: "s" }));
  assert.equal(P.scoreMock(items, [0, 1, -1, 0], m).marks, 2, "+1, no negative marking");
  const bp = L.BLUEPRINT.fmge, tax = require("../prep/taxonomy.json");
  const mbbs = tax.branches.find((b) => b.id === "mbbs").subjects.map((s) => s.id).sort();
  assert.deepEqual(Object.keys(bp).sort(), mbbs, "every MBBS subject has a blueprint weight");
  assert.equal(Object.values(bp).reduce((a, b) => a + b, 0), 295, "300 marks less radiotherapy (no bank subject)");
});

test("level: XP is answers, right answers and lesson XP; level n starts at 50n(n-1) XP; ranks band the levels", () => {
  assert.equal(L.xpOf({ mod: { a: { t: 10, ok: 7 }, b: { t: 3, ok: 0 } }, ls: { c: { xp: 80 } } }), 100);
  assert.equal(L.xpOf({}), 0);
  assert.deepEqual([0, 99, 100, 300, 1000, 6600].map((x) => L.levelOf(x).n), [1, 1, 2, 3, 5, 12]);
  assert.deepEqual([1, 3, 5, 8, 12].map((n) => L.levelOf(50 * n * (n - 1)).rank), ["Fresher", "Intern", "Resident", "Registrar", "Consultant"]);
  const lv = L.levelOf(150); assert.equal(lv.lo, 100); assert.equal(lv.hi, 300); assert.equal(lv.p, 0.25);
});

test("lessons keyed apart from their module (radnotes): pickLesson and itemProgress read progress by key; the plan item carries the key", () => {
  const lessons = [{ m: "rad-gi", k: "radnotes-n1-a", s: "radiology", title: "A", minutes: 5 }, { m: "rad-gi", k: "radnotes-n1-b", s: "radiology", title: "B", minutes: 5 }];
  const s = { ls: { "radnotes-n1-a": { done: Date.now() } } };
  assert.equal(L.pickLesson(lessons, ["radiology"], s).k, "radnotes-n1-b");
  const p = L.planDay({ minutes: 30, due: 0, perQ: 1, lesson: lessons[1], mock: null, weekend: false, daysLeft: null, weak: [] });
  const it = p.items.find((x) => x.k === "lsn");
  assert.equal(it.m, "rad-gi");
  assert.equal(it.l, "radnotes-n1-b");
  const day = (t) => Math.floor(t / 864e5), td = day(Date.now());
  assert.equal(L.itemProgress(it, { ls: { "radnotes-n1-b": { done: Date.now() } } }, td, day).done, true);
  assert.equal(L.itemProgress(it, { ls: { "rad-gi": { done: Date.now() } } }, td, day).done, false);
});
