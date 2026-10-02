import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const S = createRequire(import.meta.url)("../tokos-models/explorer-cervical-screening.js");
const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]"); // em and en dash are banned in learner text
const end = (results) => S.walk(results).end;

test("model contract and guideline versions", () => {
  assert.equal(S.id, "cervical-screening");
  assert.equal(S.kind, "explorer");
  assert.ok(["ai_drafted", "reviewed"].includes(S.review && typeof S.review === "object" ? S.review.status : S.review));
  assert.equal(S.guideline.algorithm.year, 2016);
  assert.equal(S.guideline.algorithm.version, "26 August 2016");
  assert.equal(S.guideline.current.year, 2025);
  assert.match(S.guideline.current.title, /2023-2030/);
  assert.ok(S.sources.length >= 3 && S.sources.every((s) => /^https:\/\//.test(s.url)));
  assert.deepEqual(S.constants, { ageMin: 30, ageMax: 65, intervalYears: 5, followUpYears: 1 });
});

test("ageBand: 30 to 65 is the programme band; symptoms are not screening", () => {
  const r = (a, s) => S.ageBand(a, s).result;
  assert.equal(r(29), "under-30");
  assert.equal(r(30), "age-30-65");
  assert.equal(r(65), "age-30-65");
  assert.equal(r(66), "over-65");
  assert.equal(r(45, true), "symptoms");
  assert.equal(r(20, true), "symptoms");
  assert.equal(S.ageBand(45).next, "via");
  assert.equal(S.ageBand(20).next, "outside-under-30");
  for (const bad of [-1, 121, NaN, "40", null]) assert.equal(S.ageBand(bad).ok, false);
});

test("entry step routes by age band", () => {
  assert.equal(S.next("start", "age-30-65").step.id, "via");
  assert.equal(S.next("start", "under-30").step.id, "outside-under-30");
  assert.equal(S.next("start", "over-65").step.id, "outside-over-65");
  assert.equal(S.next("start", "symptoms").step.id, "refer-symptoms");
  assert.equal(S.next("start", "symptoms").step.terminal, true);
});

test("VIA negative: repeat after 5 years; VIA positive: refer to the gynaecologist", () => {
  assert.equal(S.next("via", "negative").step.id, "repeat-5y");
  assert.equal(S.next("via", "negative").step.terminal, true);
  assert.equal(S.next("via", "positive").step.id, "refer-gyn");
  assert.match(S.steps["repeat-5y"].title.en, /5 years/);
  assert.match(S.steps["refer-gyn"].title.en, /gynaecologist or lady medical officer/);
});

test("after referral: eligible for cryotherapy, otherwise biopsy; biopsy by grade", () => {
  assert.equal(S.next("refer-gyn", "eligible-cryo").step.id, "cryotherapy");
  assert.equal(S.next("refer-gyn", "not-eligible").step.id, "biopsy");
  assert.equal(S.next("cryotherapy", "done").step.id, "followup-1y");
  assert.equal(S.next("biopsy", "cin1").step.id, "cryotherapy-cin1");
  assert.equal(S.next("biopsy", "normal").step.id, "followup-1y"); // a negative biopsy still has a path
  assert.match(S.steps["cryotherapy-cin1"].text.en, /ASCCP 2019/);
  assert.equal(S.next("biopsy", "cin2-3").step.id, "leep");
  assert.equal(S.next("biopsy", "cancer").step.id, "refer-tcc");
  assert.equal(S.next("cryotherapy-cin1", "done").step.id, "followup-1y");
  assert.equal(S.next("leep", "done").step.id, "followup-1y");
  assert.match(S.steps["followup-1y"].title.en, /one year with VIA/);
  assert.match(S.steps["refer-tcc"].title.en, /tertiary cancer centre/);
});

test("walk: whole pathways end where the 2016 algorithm ends", () => {
  assert.equal(end(["age-30-65", "negative"]), "repeat-5y");
  assert.equal(end(["age-30-65", "positive", "eligible-cryo", "done"]), "followup-1y");
  assert.equal(end(["age-30-65", "positive", "not-eligible", "cin1", "done"]), "followup-1y");
  assert.equal(end(["age-30-65", "positive", "not-eligible", "cin2-3", "done"]), "followup-1y");
  assert.equal(end(["age-30-65", "positive", "not-eligible", "cancer"]), "refer-tcc");
  const w = S.walk(["age-30-65", "positive", "not-eligible", "cin2-3", "done"]);
  assert.equal(w.ok, true);
  assert.equal(w.terminal, true);
  assert.deepEqual(w.path.map((p) => p.id), ["start", "via", "refer-gyn", "biopsy", "leep", "followup-1y"]);
  assert.equal(S.walk(["age-30-65"]).terminal, false);
  assert.equal(S.walk([]).ok, true);
});

test("next refuses unknown steps, results that do not apply, and steps past the end", () => {
  assert.equal(S.next("nope", "x").ok, false);
  assert.equal(S.next("via", "cin1").ok, false);
  assert.equal(S.next("start", "negative").ok, false);
  assert.equal(S.next("repeat-5y", "done").ok, false);
  assert.equal(S.next("refer-tcc", "done").ok, false);
  const bad = S.walk(["age-30-65", "positive", "maybe"]);
  assert.deepEqual([bad.ok, bad.at], [false, 2]);
  assert.ok(bad.error.en && /[ऀ-ॿ]/.test(bad.error.hi));
});

test("every step reaches an end; no dead ends; every decision result is labelled", () => {
  for (const id of S.stepIds) {
    const s = S.steps[id];
    if (s.kind === "end") { assert.equal(s.results, undefined, id); continue; }
    for (const [res, to] of Object.entries(s.results)) { assert.ok(S.steps[to], id + " -> " + to); assert.ok(S.resultLabels[res], "label for " + res); }
  }
  const seen = new Set(["start"]), q = ["start"];
  while (q.length) for (const to of Object.values(S.steps[q.shift()].results || {})) if (!seen.has(to)) { seen.add(to); q.push(to); }
  assert.equal(seen.size, S.stepIds.length, "every step is reachable from the start");
});

test("cryotherapy eligibility: all five criteria met and none of the exclusions", () => {
  const ok = { quadrants: 2, ectocervixOnly: true, fullyVisible: true, coverableByProbe: true, suspectInvasive: false, postcoitalBleeding: false, postmenopausalBleeding: false, overtGrowth: false, irregularSurface: false, bleedsOnTouch: false };
  let r = S.cryotherapyEligibility(ok);
  assert.deepEqual([r.ok, r.eligible, r.result, r.reasonIds], [true, true, "eligible-cryo", []]);
  assert.equal(S.cryotherapyEligibility(Object.assign({}, ok, { quadrants: 1 })).eligible, true);
  const fails = { quadrants: [3, "quadrants"], ectocervixOnly: [false, "ectocervix"], fullyVisible: [false, "visible"], coverableByProbe: [false, "probe"], suspectInvasive: [true, "invasive"],
    postcoitalBleeding: [true, "postcoital"], postmenopausalBleeding: [true, "postmenopausal"], overtGrowth: [true, "overtGrowth"], irregularSurface: [true, "irregularSurface"], bleedsOnTouch: [true, "bleedsOnTouch"] };
  for (const [k, [v, id]] of Object.entries(fails)) {
    r = S.cryotherapyEligibility(Object.assign({}, ok, { [k]: v }));
    assert.equal(r.eligible, false, k);
    assert.deepEqual(r.reasonIds, [id], k);
    assert.equal(r.result, "not-eligible");
    assert.ok(r.reasons[0].en && /[ऀ-ॿ]/.test(r.reasons[0].hi));
  }
  r = S.cryotherapyEligibility(Object.assign({}, ok, { quadrants: 4, irregularSurface: true }));
  assert.deepEqual(r.reasonIds, ["quadrants", "irregularSurface"]);
  assert.equal(S.next("refer-gyn", S.cryotherapyEligibility(ok).result).step.id, "cryotherapy");
  assert.equal(S.next("refer-gyn", r.result).step.id, "biopsy");
  for (const bad of [null, {}, Object.assign({}, ok, { quadrants: 0 }), Object.assign({}, ok, { quadrants: 5 }), Object.assign({}, ok, { quadrants: 2.5 }), Object.assign({}, ok, { fullyVisible: "yes" })]) assert.equal(S.cryotherapyEligibility(bad).ok, false);
});

test("HPV and Pap are described as not modelled, with the reason", () => {
  assert.match(S.otherTests.hpv.en, /not modelled/);
  assert.match(S.otherTests.pap.en, /none is modelled/);
  assert.ok(!Object.values(S.steps).some((s) => /HPV/.test(s.title.en + s.text.en)), "no HPV step is invented");
});

test("learner text: English and Hindi, no em dash, ASCII numerals in Hindi", () => {
  const texts = [S.title, S.subtitle, ...Object.values(S.notes), ...Object.values(S.otherTests), ...Object.values(S.resultLabels)];
  for (const s of Object.values(S.steps)) texts.push(s.title, s.text);
  for (const t of texts) {
    assert.ok(t.en.trim() && t.hi.trim());
    assert.ok(!DASH.test(t.en + t.hi));
    assert.ok(!/[०-९]/.test(t.hi));
  }
  for (const s of Object.values(S.steps)) assert.ok(/[ऀ-ॿ]/.test(s.title.hi + s.text.hi), s.id);
});

test("WHO 2021 note: HPV DNA primary test and VIA every 3 years", () => {
  assert.match(S.otherTests.who.en, /HPV DNA/);
  assert.match(S.otherTests.who.en, /every 3 years/);
  assert.match(S.otherTests.who.en, /Thermal ablation/);
  assert.ok(S.sources.some((x) => /WHO guideline/.test(x.label)));
});
