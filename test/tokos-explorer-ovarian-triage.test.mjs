import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const O = createRequire(import.meta.url)("../tokos-models/explorer-ovarian-triage.js");
const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]"); // em and en dash are banned in learner text
const d = (o) => Object.assign({ type: "unilocular", colourScore: 2 }, o);
const ids = (r) => r.B.concat(r.M).join(",");

test("model contract", () => {
  assert.equal(O.id, "ovarian-triage");
  assert.equal(O.kind, "explorer");
  assert.equal(O.review, "ai_drafted");
  assert.deepEqual(O.featureIds, ["B1", "B2", "B3", "B4", "B5", "M1", "M2", "M3", "M4", "M5"]);
  assert.ok(O.sources.length >= 2 && O.sources.every((s) => /^https:\/\//.test(s.url)));
  assert.match(O.notes.aid.en, /does not replace/);
  assert.match(O.notes.noImages.en, /descriptions only/);
});

test("B1 unilocular cyst", () => {
  const r = O.classify(d({}));
  assert.equal(ids(r), "B1");
  assert.equal(r.outcome, "benign");
});

test("B2 solid component: below 7 mm counts, 7 mm does not", () => {
  assert.equal(ids(O.classify(d({ type: "unilocular-solid", largestSolidMm: 6.9 }))), "B2");
  assert.equal(ids(O.classify(d({ type: "unilocular-solid", largestSolidMm: 7 }))), "", "7 mm is not below 7 mm");
  assert.equal(ids(O.classify(d({ type: "multilocular-solid", outline: "smooth", largestDiameterMm: 50, largestSolidMm: 5 }))), "B2");
  assert.equal(O.classify(d({ type: "unilocular-solid", largestSolidMm: 12 })).outcome, "inconclusive");
});

test("B3 acoustic shadows and B5 no blood flow", () => {
  assert.equal(ids(O.classify(d({ type: "solid", outline: "smooth", acousticShadows: true }))), "B3");
  assert.equal(ids(O.classify(d({ type: "solid", outline: "smooth", colourScore: 1 }))), "B5");
  assert.equal(O.classify(d({ type: "solid", outline: "smooth", colourScore: 1, acousticShadows: true })).outcome, "benign");
});

test("B4 smooth multilocular below 100 mm: 99.9 counts, 100 does not", () => {
  const m = (mm, outline) => O.classify(d({ type: "multilocular", outline: outline || "smooth", largestDiameterMm: mm }));
  assert.equal(ids(m(99.9)), "B4");
  assert.equal(ids(m(100)), "", "100 mm is not below 100 mm");
  assert.equal(m(100).outcome, "inconclusive");
  assert.equal(ids(m(60, "irregular")), "", "an irregular multilocular cyst is not B4");
});

test("M1 irregular solid tumour", () => {
  const r = O.classify(d({ type: "solid", outline: "irregular" }));
  assert.equal(ids(r), "M1");
  assert.equal(r.outcome, "malignant");
  assert.equal(ids(O.classify(d({ type: "solid", outline: "smooth" }))), "", "a smooth solid tumour has no feature");
});

test("M2 ascites and M5 very strong flow", () => {
  assert.equal(ids(O.classify(d({ type: "solid", outline: "smooth", ascites: true }))), "M2");
  assert.equal(ids(O.classify(d({ type: "solid", outline: "smooth", colourScore: 4 }))), "M5");
  assert.equal(ids(O.classify(d({ type: "solid", outline: "smooth", colourScore: 3 }))), "");
});

test("M3 papillary structures: 3 do not count, 4 do", () => {
  assert.equal(ids(O.classify(d({ type: "unilocular-solid", largestSolidMm: 20, papillaryStructures: 3 }))), "");
  assert.equal(ids(O.classify(d({ type: "unilocular-solid", largestSolidMm: 20, papillaryStructures: 4 }))), "M3");
  assert.equal(ids(O.classify(d({ type: "unilocular-solid", largestSolidMm: 20, papillaryStructures: 9 }))), "M3");
});

test("M4 irregular multilocular-solid tumour: 99 mm does not count, 100 mm does", () => {
  const m = (mm) => O.classify(d({ type: "multilocular-solid", outline: "irregular", largestDiameterMm: mm, largestSolidMm: 30 }));
  assert.equal(ids(m(99)), "");
  assert.equal(ids(m(100)), "M4");
  assert.equal(m(100).outcome, "malignant");
  assert.equal(ids(O.classify(d({ type: "multilocular-solid", outline: "smooth", largestDiameterMm: 150, largestSolidMm: 30 }))), "");
});

test("the three decision rules (BMJ 2010)", () => {
  assert.equal(O.fromFeatures(["M1"]).outcome, "malignant");
  assert.equal(O.fromFeatures(["M1", "M2", "M5"]).outcome, "malignant");
  assert.equal(O.fromFeatures(["B1", "B5"]).outcome, "benign");
  assert.equal(O.fromFeatures(["B3"]).outcome, "benign");
  const both = O.fromFeatures(["B1", "M2"]);
  assert.equal(both.outcome, "inconclusive");
  assert.equal(both.secondStage, true);
  assert.equal(both.conclusive, false);
  const none = O.fromFeatures([]);
  assert.equal(none.outcome, "inconclusive");
  assert.equal(O.fromFeatures(["M5", "B1", "B1"]).B.length, 1, "duplicates collapse");
  assert.equal(O.fromFeatures(["B9"]).ok, false);
  assert.equal(O.fromFeatures("B1").ok, false);
  for (const o of ["malignant", "benign", "inconclusive"]) assert.ok(O.rules[o].en && /[ऀ-ॿ]/.test(O.rules[o].hi));
  assert.match(O.rules.inconclusive.en, /second-stage test/);
});

test("whole cases: conflict, none, and a classic benign cyst", () => {
  // unilocular cyst with very strong flow: B1 and M5 together
  const c = O.classify(d({ colourScore: 4 }));
  assert.equal(ids(c), "B1,M5");
  assert.equal(c.outcome, "inconclusive");
  // smooth multilocular 120 mm, moderate flow: no feature at all
  const n = O.classify(d({ type: "multilocular", outline: "smooth", largestDiameterMm: 120, colourScore: 3 }));
  assert.equal(ids(n), "");
  assert.equal(n.outcome, "inconclusive");
  // classic dermoid-like: shadows, small solid part, no flow
  const b = O.classify(d({ type: "unilocular-solid", largestSolidMm: 5, acousticShadows: true, colourScore: 1 }));
  assert.equal(ids(b), "B2,B3,B5");
  assert.equal(b.outcome, "benign");
  // solid, irregular, ascites, papillary, strong flow
  const m = O.classify(d({ type: "solid", outline: "irregular", ascites: true, colourScore: 4, papillaryStructures: 5 }));
  assert.equal(ids(m), "M1,M2,M3,M5");
  assert.equal(m.outcome, "malignant");
});

test("describe and classify refuse incomplete or out-of-range descriptions", () => {
  for (const bad of [null, {}, { type: "x", colourScore: 2 }, { type: "unilocular" }, { type: "unilocular", colourScore: 5 }, { type: "unilocular", colourScore: 0 },
    { type: "solid", colourScore: 2 }, { type: "multilocular", outline: "smooth", colourScore: 2 }, { type: "multilocular", outline: "smooth", largestDiameterMm: 0, colourScore: 2 },
    { type: "unilocular-solid", colourScore: 2 }, { type: "unilocular-solid", largestSolidMm: -1, colourScore: 2 },
    d({ papillaryStructures: 2.5 }), d({ papillaryStructures: -1 }), d({ ascites: "yes" }), d({ acousticShadows: 1 })]) {
    const r = O.classify(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.error.en && /[ऀ-ॿ]/.test(r.error.hi));
  }
});

test("performance figures are the published ones", () => {
  assert.equal(O.performance.validation2010.patients, 1938);
  assert.equal(O.performance.validation2010.sensitivity, "92% (340/369)");
  assert.equal(O.performance.validation2010.specificity, "96% (1083/1132)");
  assert.equal(O.performance.derivation2008.prospective.sensitivity, "95% (106/112)");
});

test("learner text: English and Hindi, no em dash, ASCII numerals in Hindi", () => {
  const texts = [...Object.values(O.types), ...Object.values(O.features).map((f) => f.name), ...Object.values(O.notes), O.title, O.subtitle];
  for (const t of texts) {
    assert.ok(t.en.trim() && /[ऀ-ॿ]/.test(t.hi));
    assert.ok(!DASH.test(t.en + t.hi));
    assert.ok(!/[०-९]/.test(t.hi));
  }
});
