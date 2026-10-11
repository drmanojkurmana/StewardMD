/* PrepNucleus My coaching, PR-a (prep-coach.js + capture in prep.js/prep-assess.js/prep-tests.js).
 * What must hold:
 *  - capture: Guessing/Confident/Confused chips, skippable; each chip pairs with the mark-for-review flag and
 *    rides with time taken and answer changes; the pair survives the saved session and the attempt record;
 *  - classification is deterministic with no LLM: Read again / Just revise / Exam ready from accuracy bands;
 *  - thresholds come from the tier config (Silver lowest and default, stricter up the tiers);
 *  - guards: N = 5 answers before any group, the unsure share can veto Exam ready, and only the student's own
 *    counted answers feed Exam ready (blanks, non-own rows and unmapped items never count);
 *  - schedule: 1 / 7 / 21 day reviews per group, and Due today reuses prep-plan.js dueNow.
 * node --test test/prep-coach.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../prep-coach.js");
const A = require("../prep-assess.js");
const PLAN = require("../prep-plan.js");

const rows = (t, oks, confs = [], own = []) =>
  oks.map((ok, i) => ({ t, ok, conf: confs[i] ?? null, own: own[i] ?? true }));

test("chips: three ids, skippable, coach and assess agree", () => {
  assert.deepEqual(C.CONF.map((c) => c[0]), ["guessing", "confident", "confused"]);
  assert.deepEqual(C.CONF.map((c) => c[1]), ["Guessing", "Confident", "Confused"]);
  for (const v of ["guessing", "confident", "confused"]) assert.equal(C.cleanConf(v), v);
  for (const v of [null, undefined, "", "sure", 0, 1, {}, []]) assert.equal(C.cleanConf(v), null);
  for (const v of ["guessing", "confident", "confused", null, "nope"]) assert.equal(A.cleanConf(v), C.cleanConf(v));
});

test("capture: chip plus mark pair with time and changes; skips cost nothing", () => {
  assert.deepEqual(C.capture("confident", true, 12345, 2), { conf: "confident", mark: true, ms: 12345, changed: 2 });
  assert.deepEqual(C.capture(null, false, 0, 0), { conf: null, mark: false, ms: 0, changed: 0 });
  assert.deepEqual(C.capture("bogus", 0, -5, -1), { conf: null, mark: false, ms: 0, changed: 0 });
  assert.equal(C.capture("guessing", false, 99999999, 0).ms, 600000, "per-question time capped like the runner");
  assert.deepEqual(C.confCounts(["confident", "confident", null, "guessing", "bogus"]), { guessing: 1, confident: 2, confused: 0 });
  assert.equal(C.topicKey("anatomy", "m1"), "anatomy|m1");
});

test("pairs: chip plus mark survive the saved session and the attempt record", () => {
  const items = [{ id: "q1", _s: "anatomy", _m: "m1", a: 0, o: ["a", "b"] }, { id: "q2", _s: "anatomy", _m: "m1", a: 1, o: ["a", "b"] }];
  const run = { t2: { exam: "neet-pg" }, title: "T", mode: "exam", i: 0, ans: [0, -1], mark: { 1: true }, ms: [5000, 0], changed: [1, 0], conf: ["confident", null], items, sc: null, t0: 5, limit: 0, phase: "" };
  const pk = A.sessPack(run, 99);
  assert.deepEqual(pk.conf, ["confident", null]);
  assert.deepEqual(pk.mark, { 1: true });
  const p = A.profile("neet-pg");
  const rec = A.result({ attempt_id: "c1", test_type: "mini", started: 0, finished: 1, items, ans: [0, -1], mark: [false, true], ms: [5000, 0], changed: [1, 0], conf: ["confident", null] }, p);
  assert.equal(rec.items[0].conf, "confident");
  assert.equal(rec.items[1].marked, true);
  assert.ok(!("conf" in rec.items[1]), "a skipped chip is omitted, not stored as null");
  assert.equal(rec.items[0].ms, 5000); assert.equal(rec.items[0].changed, 1);
});

test("tiers: Silver lowest and default, stricter up the ladder", () => {
  assert.deepEqual(C.tierIds(), ["silver", "gold", "platinum", "diamond"]);
  assert.equal(C.tierOf(null), "silver");
  assert.equal(C.tierOf({}), "silver");
  assert.equal(C.tierOf({ coachTier: "bogus" }), "silver");
  assert.equal(C.tierOf({ coachTier: "gold" }), "gold");
  const ids = C.tierIds();
  for (const t of ids) {
    assert.equal(C.TIERS[t].minN, 5, t + " keeps the N = 5 guard");
    assert.ok(C.TIERS[t].reviseAcc < C.TIERS[t].readyAcc, t + " revise band below ready");
  }
  for (let i = 1; i < ids.length; i++) {
    assert.ok(C.TIERS[ids[i]].readyAcc >= C.TIERS[ids[i - 1]].readyAcc, "ready bar never lower than Silver");
    assert.ok(C.TIERS[ids[i]].maxUnsure <= C.TIERS[ids[i - 1]].maxUnsure, "unsure cap never looser than Silver");
  }
});

test("classification: the three groups from accuracy bands", () => {
  const t = "anatomy|m1";
  const g = (oks, confs) => C.analyze(rows(t, oks, confs), "silver").topics[0];
  assert.equal(g([1, 1, 1, 1, 0]).group, "ready");
  assert.equal(g([1, 1, 1, 1, 0]).label, "Exam ready");
  assert.equal(g([1, 1, 1, 0, 0]).group, "revise");
  assert.equal(g([1, 1, 1, 0, 0]).label, "Just revise");
  assert.equal(g([1, 0, 0, 0, 0]).group, "reread");
  assert.equal(g([1, 0, 0, 0, 0]).label, "Read again");
  assert.deepEqual(C.analyze(rows(t, [1, 1, 1, 1, 1]), "diamond").topics[0].group, "ready");
  assert.equal(C.analyze(rows(t, [1, 1, 1, 1, 0]), "diamond").topics[0].group, "revise", "80% is ready on Silver, revise on Diamond");
});

test("guards: N = 5, the unsure veto, and the student's own answers only", () => {
  const t = "anatomy|m1";
  const few = C.analyze(rows(t, [1, 1, 1, 1]), "silver").topics[0];
  assert.equal(few.group, "fresh");
  assert.equal(few.label, "Too few answers");
  const unsure = C.analyze(rows(t, [1, 1, 1, 1, 1], ["confused", "confused", null, null, null]), "silver").topics[0];
  assert.equal(unsure.group, "revise", "100% right but 40% confused is not Exam ready");
  const blanks = C.analyze([{ t, ok: 1 }, { t, ok: 1 }, { t, ok: 1 }, { t, ok: 1 }, { t, ok: null }, { t, ok: null }], "silver").topics[0];
  assert.equal(blanks.n, 4); assert.equal(blanks.blank, 2); assert.equal(blanks.group, "fresh", "blanks are noted, not counted");
  const foreign = C.analyze(rows(t, [1, 1, 1, 1, 1], [], [true, true, true, false, false]), "silver").topics[0];
  assert.equal(foreign.n, 3); assert.equal(foreign.skipped, 2); assert.equal(foreign.group, "fresh", "non-own rows never feed a group");
  const rec = { items: [{ item_id: "q1", correct: true, conf: "confident" }, { item_id: "qX", correct: true }] };
  assert.deepEqual(C.rowsFromAttempt(rec, (id) => (id === "q1" ? t : null)), [{ t, ok: 1, conf: "confident", own: true }], "unmapped items drop out");
});

test("analysis is deterministic and offline", () => {
  const input = rows("b|m2", [1, 0, 1, 1, 0]).concat(rows("a|m1", [1, 1, 1, 1, 1]));
  const a1 = C.analyze(input, "gold"), a2 = C.analyze(input, "gold");
  assert.deepEqual(a1, a2);
  assert.deepEqual(a1.topics.map((x) => x.t), ["a|m1", "b|m2"], "topic-key order, independent of input order");
  const src = fs.readFileSync(new URL("../prep-coach.js", import.meta.url), "utf8");
  for (const w of ["fetch(", "XMLHttpRequest", "Math.random", "Date.now"]) assert.ok(!src.includes(w), "no " + w + " in the coach module");
});

test("schedule: 1 / 7 / 21 day reviews; Due today reuses prep-plan.js", () => {
  assert.deepEqual([C.REVIEW_1D, C.REVIEW_7D, C.REVIEW_21D], [1, 7, 21]);
  assert.deepEqual(C.REVIEW_DAYS, { reread: 1, revise: 7, ready: 21 });
  assert.equal(C.nextReview("reread", 100), 101);
  assert.equal(C.nextReview("revise", 100), 107);
  assert.equal(C.nextReview("ready", 100), 121);
  const store = { coach: {} };
  C.noteReview(store, "a|m1", "reread", 100);
  C.noteReview(store, "a|m2", "ready", 100);
  assert.deepEqual(store.coach, { "a|m1": { g: "reread", next: 101 }, "a|m2": { g: "ready", next: 121 } });
  assert.deepEqual(C.dueTopics(store.coach, 101), ["a|m1"]);
  assert.deepEqual(C.dueTopics(store.coach, 121), ["a|m1", "a|m2"]);
  // Due today: the plan count is prep-plan.js dueNow, not a reimplementation
  store.cards = { "p:m1:q1": [0, 1, 90, 100, 2], "p:m1:q2": [0, 1, 90, 101, 1], "p:m1:c:card1": [0, 1, 90, 99, 1] };
  const due = C.dueToday(store, 100);
  assert.equal(due.plan, PLAN.dueNow(store, 100));
  assert.equal(due.plan, 1, "one question due; flashcards never count");
  assert.deepEqual(due.coach, []);
});
