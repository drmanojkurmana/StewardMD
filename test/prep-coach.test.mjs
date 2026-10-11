/* KnowYourIQ (prep-coach.js + capture in prep.js/prep-assess.js/prep-tests.js).
 * What must hold:
 *  - capture: the three owner chips with their exact labels, skippable; each chip pairs with the
 *    mark-for-review flag and rides with time taken, answer changes and the confused pair; the
 *    capture survives the saved session and the attempt record;
 *  - outcomes: confident-right (mastered), confident-wrong (misconception), guess-right (lucky),
 *    guess-wrong, confused, right, wrong, blank;
 *  - classification is deterministic with no LLM: Read again / Just revise / Exam ready from
 *    recency-weighted accuracy with the confident-wrong, streak, unsure, slow, forgotten and
 *    day-span rules; Exam ready is by the student's own counted answers only;
 *  - tiers are topic priority = weakness x exam importance (owner definition): Diamond >
 *    Platinum > Gold > Silver; neutral importance with an honest label when no data covers a
 *    subject; no tier below N = 5;
 *  - guards: N = 5 before any group or tier, blanks and non-own rows never count;
 *  - pairs: confused pairs persist capped per topic with short texts, newest first;
 *  - schedule: 1 / 7 / 21 day reviews per group, and Due today reuses prep-plan.js dueNow;
 *  - honesty: never an IQ number, intelligence score, rank, percentile or predicted score.
 * node --test test/prep-coach.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../prep-coach.js");
const A = require("../prep-assess.js");
const PLAN = require("../prep-plan.js");
const DATA = require("../prep-knowyouriq-data.js");
const K = C.KYIQ;

/* One topic's aggregate from shorthand: oks = [1/0], confs aligned, days aligned (default spread). */
const agg = (t, oks, confs = [], days = null, slow = []) => {
  const aggs = {};
  oks.forEach((ok, i) => C.noteAnswer(aggs, t, {
    ok: !!ok, conf: confs[i] ?? null, slow: !!slow[i],
    day: days ? days[i] : 100 + Math.floor(i / 3), ts: (100 + i) * 86400000,
  }));
  return aggs;
};
const stat = (aggs, t) => C.summarize(aggs).find((x) => x.t === t);
const SRC = { blueprint: null, pyq: null, data: DATA, exam: "neet-pg" };

test("name and config: KnowYourIQ in ONE object, never an intelligence test", () => {
  assert.equal(K.NAME, "KnowYourIQ");
  assert.equal(K.TAGLINE, "Know what you know.");
  assert.match(K.NOTEST, /not an intelligence test/);
  for (const k of ["MIN_N", "HIST_N", "DECAY", "READY_ACC", "REVISE_ACC", "MAX_UNSURE", "MAX_SLOW",
    "READY_DAYS_MIN", "REREAD_CW_MIN", "WEAK_W", "IMPORT_W", "NEUTRAL", "TIER_MIN", "REVIEW_DAYS",
    "PAIR_N", "SUMMARY_MAX_BYTES", "INTRO_KEY", "SLOW_MS"]) assert.ok(K[k] !== undefined, k + " lives in KYIQ");
  assert.equal(K.MIN_N, 5);
  assert.deepEqual(C.TIER_ORDER, ["diamond", "platinum", "gold", "silver"]);
});

test("chips: three owner labels, skippable, coach and assess agree", () => {
  assert.deepEqual(C.CONF.map((c) => c[0]), ["guessing", "confident", "confused"]);
  assert.deepEqual(C.CONF.map((c) => c[1]), ["I'm guessing", "I'm confident", "I'm confused between options"]);
  for (const v of ["guessing", "confident", "confused"]) assert.equal(C.cleanConf(v), v);
  for (const v of [null, undefined, "", "sure", 0, 1, {}, []]) assert.equal(C.cleanConf(v), null);
  for (const v of ["guessing", "confident", "confused", null, "nope"]) assert.equal(A.cleanConf(v), C.cleanConf(v));
  assert.deepEqual(C.cleanPair(2, 0, 4), [0, 2]);
  assert.equal(C.cleanPair(1, 1, 4), null);
  assert.equal(C.cleanPair(0, 9, 4), null);
  assert.deepEqual(A.cleanPair([3, 1], 4), [1, 3]);
  assert.equal(A.cleanPair([1], 4), null);
});

test("capture: chip plus mark pair with time, changes and pair; skips cost nothing", () => {
  assert.deepEqual(C.capture("confident", true, 12345, 2, null),
    { conf: "confident", mark: true, ms: 12345, changed: 2, pair: null });
  assert.deepEqual(C.capture("confused", false, 5000, 0, [2, 0, 4]).pair, [0, 2]);
  assert.deepEqual(C.capture(null, false, 0, 0), { conf: null, mark: false, ms: 0, changed: 0, pair: null });
  assert.deepEqual(C.capture("bogus", 0, -5, -1), { conf: null, mark: false, ms: 0, changed: 0, pair: null });
  assert.equal(C.capture("guessing", false, 99999999, 0).ms, 600000, "per-question time capped like the runner");
  assert.deepEqual(C.confCounts(["confident", "confident", null, "guessing", "bogus"]), { guessing: 1, confident: 2, confused: 0 });
  assert.equal(C.topicKey("anatomy", "m1"), "anatomy|m1");
});

test("outcomes: confidence x result, with misconception and lucky named", () => {
  assert.equal(C.outcome(1, "confident"), "mastered");
  assert.equal(C.outcome(0, "confident"), "misconception");
  assert.equal(C.outcome(1, "guessing"), "lucky");
  assert.equal(C.outcome(0, "guessing"), "guesswrong");
  assert.equal(C.outcome(1, "confused"), "confused");
  assert.equal(C.outcome(0, "confused"), "confused");
  assert.equal(C.outcome(1, null), "right");
  assert.equal(C.outcome(0, null), "wrong");
  assert.equal(C.outcome(null, "confident"), "blank");
  assert.equal(C.OUTCOMES.misconception, "Confident but wrong");
  assert.equal(C.OUTCOMES.lucky, "Guessed right");
});

test("pairs ride the session and the record; skips and non-confused store nothing", () => {
  const items = [{ id: "q1", _s: "anatomy", _m: "m1", a: 0, o: ["a", "b", "c", "d"] }, { id: "q2", _s: "anatomy", _m: "m1", a: 1, o: ["a", "b", "c", "d"] }];
  const run = { t2: { exam: "neet-pg" }, title: "T", mode: "exam", i: 0, ans: [0, -1], mark: { 1: true }, ms: [5000, 0], changed: [1, 0], conf: ["confused", null], confPair: [[2, 0], null], items, sc: null, t0: 5, limit: 0, phase: "" };
  const pk = A.sessPack(run, 99);
  assert.deepEqual(pk.conf, ["confused", null]);
  assert.deepEqual(pk.pair, [[2, 0], null]);
  const p = A.profile("neet-pg");
  const rec = A.result({ attempt_id: "c1", test_type: "mini", started: 0, finished: 1, items, ans: [0, -1], mark: [false, true], ms: [5000, 0], changed: [1, 0], conf: ["confused", "confident"], pair: [[2, 0], [1, 3]] }, p);
  assert.equal(rec.items[0].conf, "confused");
  assert.deepEqual(rec.items[0].pair, [0, 2]);
  assert.equal(rec.items[1].conf, "confident");
  assert.ok(!("pair" in rec.items[1]), "a pair without a Confused chip is dropped");
  const rec2 = A.result({ attempt_id: "c2", test_type: "mini", started: 0, finished: 1, items, ans: [0, -1], mark: [false, false], ms: [0, 0], changed: [0, 0], conf: [null, null] }, p);
  assert.ok(!("conf" in rec2.items[0]) && !("pair" in rec2.items[0]), "skipped chips cost nothing");
});

test("aggregates: counts, recency ring, day span; blanks and non-own rows never count", () => {
  const aggs = agg("anatomy|m1", [1, 1, 0, 1, 1], ["confident", "guessing", "confused", null, "confident"]);
  const st = stat(aggs, "anatomy|m1");
  assert.equal(st.n, 5); assert.equal(st.ok, 4);
  assert.equal(st.cr, 2); assert.equal(st.gr, 1); assert.equal(st.cf, 1);
  assert.equal(st.days, 2);
  const rows = [
    { t: "a|m", ok: 1, conf: "confident", own: true }, { t: "a|m", ok: null, own: true },
    { t: "a|m", ok: 1, own: false }, { t: null, ok: 1 },
  ];
  const a2 = C.aggsFromRows(rows, 0);
  assert.equal(a2["a|m"].n, 1, "only the counted row files");
  assert.equal(a2["a|m"].cr, 1);
  const rec = { items: [{ item_id: "q1", correct: true, conf: "confident" }, { item_id: "qX", correct: true }] };
  assert.deepEqual(C.rowsFromAttempt(rec, (id) => (id === "q1" ? "a|m" : null)),
    [{ t: "a|m", ok: 1, conf: "confident", ms: 0, ts: 0, pair: null, own: true }], "unmapped items drop out");
});

test("reconf: a retag moves confidence counters only", () => {
  const aggs = agg("a|m", [1, 1, 1, 1, 1], ["confident", null, null, null, null]);
  C.reconf(aggs, "a|m", true, "confident", "guessing");
  const st = stat(aggs, "a|m");
  assert.equal(st.n, 5); assert.equal(st.ok, 5);
  assert.equal(st.cr, 0); assert.equal(st.gr, 1);
  assert.equal(C.reconf({}, "nope", true, "confident", null), null);
});

test("classification: the three groups and their rules", () => {
  const t = "anatomy|m1";
  const g = (oks, confs, days, slow) => C.classify(stat(agg(t, oks, confs, days, slow), t));
  assert.equal(g([1, 1, 1, 1, 1], ["confident", "confident", "confident", "confident", "confident"]).group, "ready");
  assert.equal(g([1, 1, 1, 1, 1], ["confident", "confident", "confident", "confident", "confident"]).label, "Exam ready");
  assert.equal(g([0, 1, 1, 1, 1], ["guessing", "guessing", "guessing", null, null]).group, "revise");
  assert.equal(g([0, 1, 1, 1, 1], ["guessing", "guessing", "guessing", null, null]).label, "Just revise");
  assert.equal(g([1, 0, 0, 0, 0]).group, "reread");
  assert.equal(g([1, 0, 0, 0, 0]).label, "Read again");
  assert.equal(g([1, 1, 1, 0, 0], ["confident", "confident", "confident", "confident", "confident"]).group, "reread",
    "two confident-wrong force Read again");
  assert.equal(g([1, 1, 0, 0, 0]).group, "reread", "a trailing wrong streak forces Read again");
  assert.equal(g([1, 1, 1, 1, 1], ["guessing", "guessing", "guessing", null, null]).group, "revise",
    "all right but mostly guessed is not Exam ready");
  assert.equal(g([1, 1, 1, 1, 1], [], [7, 7, 7, 7, 7]).group, "revise", "one day is not Exam ready");
  assert.equal(g([1, 1, 1, 1, 1], [], null, [1, 1, 1, 1, 1]).group, "revise", "too slow is not Exam ready");
  const forg = g([1, 1, 1, 1, 1, 0, 1, 0, 0, 1]);
  assert.equal(forg.group, "revise");
  assert.match(forg.why, /forgotten after a gap/);
});

test("guards: N = 5 with honest copy, and the student's own answers only", () => {
  const few = C.classify(stat(agg("a|m", [1, 1, 1, 1]), "a|m"));
  assert.equal(few.group, "fresh");
  assert.equal(few.label, "Not enough data yet");
  assert.match(few.why, /Answer 5 questions/);
  const tier = C.tierFor(stat(agg("a|m", [1, 1, 1, 1]), "a|m"), { w: 1, neutral: false });
  assert.equal(tier.id, null, "no tier below N = 5");
});

test("recency: the newest answers weigh heaviest; analysis is deterministic and offline", () => {
  assert.ok(C.wacc([0, 0, 0, 0, 1]) > C.wacc([1, 0, 0, 0, 0]), "a late right beats an early right");
  const aggs = agg("b|m2", [1, 0, 1, 1, 0]);
  Object.assign(aggs, agg("a|m1", [1, 1, 1, 1, 1], ["confident", "confident", "confident", "confident", "confident"]));
  const a1 = C.analyze(aggs, "neet-pg", SRC), a2 = C.analyze(aggs, "neet-pg", SRC);
  assert.deepEqual(a1, a2);
  const src = fs.readFileSync(new URL("../prep-coach.js", import.meta.url), "utf8");
  for (const w of ["fetch(", "XMLHttpRequest", "Math.random", "Date.now"]) assert.ok(!src.includes(w), "no " + w + " in the coach module");
});

test("weakness: confident-wrong weighs most", () => {
  const t = "a|m";
  const cw = stat(agg(t, [1, 1, 1, 0, 0], ["confident", "confident", "confident", "confident", "confident"]), t);
  const plain = stat(agg(t, [1, 1, 1, 0, 0]), t);
  assert.ok(C.weaknessOf(cw) > C.weaknessOf(plain), "the same score with confident-wrong is weaker");
  assert.ok(C.weaknessOf(plain) >= 0 && C.weaknessOf(plain) <= 1);
});

test("importance: blends present sources, neutral and labelled when absent", () => {
  const full = C.importanceOf("medicine", "neet-pg", { blueprint: { medicine: 0.9 }, pyq: { medicine: 0.8 }, data: DATA });
  assert.equal(full.neutral, false);
  assert.ok(full.w >= 0 && full.w <= 1);
  assert.equal(full.parts.length, 4, "blueprint + pyq + yield + bank");
  const none = C.importanceOf("nope-subject", "neet-pg", { blueprint: null, pyq: null, data: { exams: {}, bank: {} } });
  assert.equal(none.neutral, true);
  assert.equal(none.w, K.NEUTRAL);
});

test("tiers: priority order Diamond > Platinum > Gold > Silver, with a why", () => {
  const mk = (oks, confs) => stat(agg("medicine|m", oks, confs), "medicine|m");
  const imp = (w) => ({ w, neutral: false });
  const weakest = mk([0, 0, 0, 0, 0], ["confident", "confident", "confident", "confident", "confident"]);
  const weak = mk([1, 1, 0, 0, 0]);
  const mid = mk([1, 1, 1, 0, 0]);
  const strong = mk([1, 1, 1, 1, 1], ["confident", "confident", "confident", "confident", "confident"]);
  assert.equal(C.tierFor(weakest, imp(1)).id, "diamond", "very important and weakest is Diamond");
  assert.equal(C.tierFor(strong, imp(0)).id, "silver", "less important and less weak is Silver");
  const order = [weakest, weak, mid, strong].map((s) => C.tierFor(s, imp(0.9)).id);
  const rank = { diamond: 0, platinum: 1, gold: 2, silver: 3 };
  for (let i = 1; i < order.length; i++) assert.ok(rank[order[i]] >= rank[order[i - 1]], "priority never rises as weakness falls: " + order.join(","));
  const view = C.analyze(agg("medicine|m", [1, 1, 1, 0, 0, 1, 0, 0], ["confident", null, null, "confident", null, null, "confident", null]), "neet-pg", SRC);
  const first = view.topics[0];
  assert.match(first.tierWhy, /you got 4 of 8 right with 2 confident-wrong/);
  assert.match(first.tierWhy, /NEET-PG/);
});

test("compiled data: derived weights only, nothing republished", () => {
  assert.equal(DATA.v, 1);
  assert.ok(DATA.exams["neet-pg"] && DATA.exams["ini-cet"], "both exams covered");
  assert.ok(DATA.bank.medicine >= 0 && DATA.bank.medicine <= 1);
  const raw = fs.readFileSync(new URL("../prep-knowyouriq-data.js", import.meta.url), "utf8");
  assert.ok(!raw.includes("dreampg"), "no source string ships");
  assert.ok(!raw.includes("Amino Acids"), "no chapter rows ship");
  // Freshness needs the yield source, which lives outside the repo: CI has no ~/prep-data, so it
  // checks the committed shape above and skips --check; maintainers with the source run it fully.
  const home = process.env.HOME || "";
  let hasSource = false;
  try { fs.statSync(home + "/prep-data/assessment/external/dreampg/chapter-yield.json"); hasSource = true; } catch {}
  if (hasSource) execFileSync("node", ["scripts/compile-knowyouriq.mjs", "--check"], { cwd: new URL("..", import.meta.url), stdio: "pipe" });
  else console.log("# skip: no chapter-yield source on this machine; shape asserts above still ran");
});

test("pairs: capped per topic, newest first, device only", () => {
  const pairs = {};
  for (let i = 0; i < 7; i++) C.notePair(pairs, "a|m", { q: "q" + i, a: 0, b: 1, ta: "x".repeat(200), tb: "Y", ts: i });
  assert.equal(pairs["a|m"].length, K.PAIR_N);
  assert.equal(pairs["a|m"][0].q, "q2", "oldest drop off");
  assert.ok(pairs["a|m"][0].ta.length <= K.PAIR_TEXT, "texts stay short");
  const top = C.topPairs(pairs, 5);
  assert.equal(top[0].q, "q6", "newest first");
  assert.match(C.pairLine({ ta: "X", tb: "Y" }), /You mix up/);
});

test("schedule: 1 / 7 / 21 day reviews; Due today reuses prep-plan.js", () => {
  assert.deepEqual(K.REVIEW_DAYS, { reread: 1, revise: 7, ready: 21 });
  assert.equal(C.nextReview("reread", 100), 101);
  assert.equal(C.nextReview("revise", 100), 107);
  assert.equal(C.nextReview("ready", 100), 121);
  const store = { coach: {} };
  C.noteReview(store, "a|m1", "reread", 100);
  C.noteReview(store, "a|m2", "ready", 100);
  assert.deepEqual(store.coach, { "a|m1": { g: "reread", next: 101 }, "a|m2": { g: "ready", next: 121 } });
  assert.deepEqual(C.dueTopics(store.coach, 101), ["a|m1"]);
  assert.deepEqual(C.dueTopics(store.coach, 121), ["a|m1", "a|m2"]);
  store.cards = { "p:m1:q1": [0, 1, 90, 100, 2], "p:m1:q2": [0, 1, 90, 101, 1], "p:m1:c:card1": [0, 1, 90, 99, 1] };
  const due = C.dueToday(store, 100);
  assert.equal(due.plan, PLAN.dueNow(store, 100));
  assert.equal(due.plan, 1, "one question due; flashcards never count");
  assert.deepEqual(due.coach, []);
});

test("Ask MaiK summary: compact, grouped, no scores or predictions", () => {
  const aggs = agg("medicine|m", [1, 1, 1, 1, 0], ["guessing", "guessing", "guessing", null, null]);
  const view = C.analyze(aggs, "neet-pg", SRC);
  const s = C.summaryText(view, "neet-pg", ["a|m"], [{ t: "a|m", ta: "X", tb: "Y" }]);
  assert.ok(s.length <= K.SUMMARY_MAX_BYTES);
  assert.match(s, /KnowYourIQ/);
  assert.match(s, /Just revise/);
  assert.match(s, /Due today/);
  assert.match(s, /I mix up/);
  assert.match(s, /No scores, ranks or predictions/);
  assert.ok(!/\bIQ\s*\d/i.test(s), "no IQ number");
});

test("honesty: the coach never names ranks, percentiles or predicted scores", () => {
  const raw = fs.readFileSync(new URL("../prep-coach.js", import.meta.url), "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(src, /percentile/i);
  assert.doesNotMatch(src, /predicted score/i);
  assert.doesNotMatch(src, /national rank|your rank is/i);
  assert.ok(!/\bIQ\s*(of|=|:)?\s*\d/i.test(src), "no IQ number anywhere");
});

test("intro state: device only, try/catch, never crashes in node", () => {
  assert.equal(C.introSeen(), false);
  assert.equal(C.introDismiss(true), true);
});
