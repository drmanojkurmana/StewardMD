import { test } from "node:test";
import assert from "node:assert";
import ENG from "../sknx-engines.js";

test("melanoma above the low refer-threshold forces referral and blocks Rx", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "eczema", prob: 0.6 }],
    lesionProbs:  [{ label: "melanoma", prob: 0.2 }, { label: "nevus", prob: 0.8 }],
    features: {}
  }, "v2beta");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
  assert.match(a.referralReason, /melanoma/i);
});

test("benign inflammatory case is Rx-eligible with a ranked differential", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "psoriasis", prob: 0.72 }, { label: "eczema", prob: 0.18 }],
    lesionProbs:  [{ label: "nevus", prob: 0.9 }, { label: "melanoma", prob: 0.02 }],
    features: {}
  }, "v2beta");
  assert.equal(a.referral, false);
  assert.equal(a.rxEligible, true);
  assert.equal(a.differential[0].label, "psoriasis");
});

test("an ABCDE red-flag feature forces referral even with low malignancy prob", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "benign keratosis", prob: 0.7 }],
    lesionProbs:  [{ label: "melanoma", prob: 0.05 }],
    features: { asymmetry: true, borderIrregular: true, colorVariegation: true, diameterMm: 8 }
  }, "v2beta");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
});

test("v1 entitlement omits the lesion engine but STILL applies red-flag features", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "acne", prob: 0.8 }],
    lesionProbs:  [{ label: "melanoma", prob: 0.9 }], // ignored at v1
    features: {}
  }, "v1");
  assert.equal(a.lesion, null);
  assert.equal(a.rxEligible, true);
});
