import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const Q = createRequire(import.meta.url)("../tokos-models/explorer-popq.js");
const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]"); // em and en dash are banned in learner text
// tvl 9 cm: stage 0 needs C or D at -7 or higher up; stage IV starts at +7 (tvl - 2)
const base = { Aa: -3, Ba: -3, C: -8, D: -9, Ap: -3, Bp: -3, gh: 3, pb: 3, tvl: 9 };
const st = (o) => Q.stage(Object.assign({}, base, o));

test("model contract", () => {
  assert.equal(Q.id, "popq");
  assert.equal(Q.kind, "explorer");
  assert.ok(["ai_drafted", "reviewed"].includes(Q.review && typeof Q.review === "object" ? Q.review.status : Q.review));
  assert.deepEqual(Q.points.map((p) => p.id), ["Aa", "Ba", "C", "D", "Ap", "Bp", "gh", "pb", "tvl"]);
  assert.equal(Q.stages.length, 5);
  assert.ok(Q.sources.length >= 3 && Q.sources.every((s) => /^https:\/\//.test(s.url)));
});

test("stage 0: all four vaginal points at -3 and C or D at -(tvl-2) or higher", () => {
  const r = st({});
  assert.equal(r.ok, true);
  assert.equal(r.stage, 0);
  assert.equal(r.roman, "0");
  assert.equal(st({ C: -7, D: -9 }).stage, 0, "C exactly at -(tvl-2)");
  assert.equal(st({ C: -6.5, D: -7 }).stage, 0, "D exactly at -(tvl-2) is enough (either C or D)");
  assert.equal(st({ C: -6.5, D: -6.5 }).stage, 1, "neither C nor D reaches -(tvl-2)");
  assert.equal(st({ C: -6, D: -8 }).stage, 0 + 1 * 0, "D deep enough, C not: still stage 0 by 'either C or D'");
});

test("inconsistent D does not hide a prolapsed C; D below C is flagged", () => {
  assert.equal(st({ C: 5, D: -9 }).stage, 3);
  assert.equal(st({ C: -8, D: -5 }).warnings.length, 1, "D more distal than C is flagged");
  assert.deepEqual(st({ C: 5, D: -9 }).warnings, []);
  assert.deepEqual(st({}).warnings, []);
  assert.deepEqual(st({ D: -8, C: -8 }).warnings, []);
});

test("stage 0 needs every one of Aa, Ba, Ap, Bp at exactly -3", () => {
  for (const k of ["Aa", "Ba", "Ap", "Bp"]) {
    assert.equal(st({ [k]: -2.5 }).stage, 1, k + " at -2.5");
    assert.equal(st({ [k]: -2 }).stage, 1, k + " at -2");
  }
});

test("stage I to II edge: leading edge more than 1 cm above the hymen is I, from -1 is II", () => {
  assert.equal(st({ Ba: -1.5 }).stage, 1);
  assert.equal(st({ Ba: -1.1 }).stage, 1);
  assert.equal(st({ Ba: -1 }).stage, 2);
  assert.equal(st({ Ba: -0.5 }).stage, 2);
  assert.equal(st({ Ba: 0 }).stage, 2);
});

test("stage II to III edge: +1 is still II, beyond +1 is III", () => {
  assert.equal(st({ Ba: 1 }).stage, 2);
  assert.equal(st({ Ba: 1.1 }).stage, 3);
  assert.equal(st({ Ba: 1.5 }).stage, 3);
  assert.equal(st({ Ba: 3 }).stage, 3);
});

test("stage III to IV edge: less than +(tvl-2) is III, +(tvl-2) or more is IV", () => {
  assert.equal(st({ C: 6.9 }).stage, 3);
  assert.equal(st({ C: 7 }).stage, 4);
  assert.equal(st({ C: 8 }).stage, 4);
  assert.equal(st({ C: 9 }).stage, 4, "complete eversion");
  // the edge moves with the vaginal length
  assert.equal(Q.stage(Object.assign({}, base, { tvl: 10, C: 7.9 })).stage, 3);
  assert.equal(Q.stage(Object.assign({}, base, { tvl: 10, C: 8 })).stage, 4);
  assert.equal(Q.stage(Object.assign({}, base, { tvl: 7, C: 4.9, D: -6 })).stage, 3);
  assert.equal(Q.stage(Object.assign({}, base, { tvl: 7, C: 5, D: -6 })).stage, 4);
});

test("the leading edge is the most distal of the six points, and it names the point", () => {
  let r = st({ Ap: 2, Ba: 0.5 });
  assert.deepEqual(r.leadingEdge, { point: "Ap", value: 2 });
  assert.equal(r.stage, 3);
  r = st({ D: 0.5, C: -1 });
  assert.deepEqual(r.leadingEdge, { point: "D", value: 0.5 });
  assert.equal(r.stage, 2);
  r = st({ Aa: 3, Ba: 5, C: 1 });
  assert.deepEqual(r.leadingEdge, { point: "Ba", value: 5 });
  assert.equal(r.stage, 3);
  assert.deepEqual(st({ Ba: 0, Bp: 2, C: 1 }).compartments, { anterior: 0, apical: 1, posterior: 2 });
});

test("no D after hysterectomy: stage from C alone", () => {
  const h = Object.assign({}, base); delete h.D;
  assert.equal(Q.stage(h).stage, 0);
  assert.equal(Q.stage(h).hasD, false);
  assert.equal(Q.stage(Object.assign({}, h, { C: -6 })).stage, 1);
  assert.equal(Q.stage(Object.assign({}, h, { D: null, C: -7 })).stage, 0);
  assert.equal(Q.stage(Object.assign({}, h, { C: 7 })).stage, 4);
  assert.deepEqual(Q.stage(Object.assign({}, h, { C: 2 })).compartments.apical, 2);
});

test("worked cases across the five stages", () => {
  assert.equal(st({}).stage, 0);
  assert.equal(st({ Aa: -2, Ba: -2, C: -6 }).stage, 1);
  assert.equal(st({ Aa: 0, Ba: 0.5, C: -3, D: -5 }).stage, 2);
  assert.equal(st({ Aa: 2, Ba: 4, C: 2, D: 0 }).stage, 3);
  assert.equal(st({ Aa: 3, Ba: 9, C: 9, D: 9, Ap: 3, Bp: 9 }).stage, 4);
});

test("validate: ranges from the TOMUS form, required points, numbers only", () => {
  assert.equal(Q.validate(base).ok, true);
  const t = (o, needle) => { const r = Q.validate(Object.assign({}, base, o)); assert.equal(r.ok, false, JSON.stringify(o)); assert.ok(r.errors.some((e) => e.includes(needle)), needle + " in " + r.errors.join("|")); };
  t({ Aa: -3.5 }, "Aa"); t({ Aa: 3.5 }, "Aa"); t({ Ap: 4 }, "Ap"); t({ Ap: -4 }, "Ap");
  t({ Ba: -4 }, "Ba"); t({ Ba: 9.5 }, "Ba"); t({ Bp: 10 }, "Bp"); t({ C: -9.5 }, "C"); t({ C: 9.5 }, "C"); t({ D: 10 }, "D");
  t({ tvl: 0 }, "tvl"); t({ gh: -1 }, "gh"); t({ pb: -1 }, "pb");
  assert.equal(Q.validate(Object.assign({}, base, { Ba: 9, Bp: 9, C: -9, D: 9 })).ok, true, "range ends are allowed");
  for (const k of ["Aa", "Ba", "C", "Ap", "Bp", "gh", "pb", "tvl"]) { const p = Object.assign({}, base); delete p[k]; assert.equal(Q.validate(p).ok, false, "missing " + k); }
  for (const bad of ["3", NaN, Infinity, null]) assert.equal(Q.validate(Object.assign({}, base, { Aa: bad })).ok, false);
  assert.equal(Q.validate(Object.assign({}, base, { D: "x" })).ok, false);
  assert.equal(Q.validate(null).ok, false);
  assert.equal(Q.stage({}).ok, false);
});

test("learner text: English and Hindi, no em dash, ASCII numerals in Hindi", () => {
  const texts = [...Q.points.map((p) => p.name), ...Q.stages.map((s) => s.rule), ...Object.values(Q.notes), Q.title, Q.subtitle];
  for (const t of texts) {
    assert.ok(t.en.trim() && /[ऀ-ॿ]/.test(t.hi));
    assert.ok(!DASH.test(t.en + t.hi));
    assert.ok(!/[०-९]/.test(t.hi));
  }
});

test("warnings: Ba cannot be above Aa, Bp cannot be above Ap (Bump 1996)", () => {
  assert.equal(st({ Aa: -1, Ba: -2 }).warnings.length, 1);
  assert.match(st({ Aa: -1, Ba: -2 }).warnings[0].en, /Ba .*Aa/);
  assert.match(st({ Ap: 0, Bp: -1 }).warnings[0].en, /Bp .*Ap/);
  assert.equal(st({ Aa: -1, Ba: -1 }).warnings.length, 0);
});
