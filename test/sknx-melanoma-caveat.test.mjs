// test/sknx-melanoma-caveat.test.mjs - regression guard for the SknX melanoma safety gap
// (qa-report/clinical_safety.md H7). The deployed differential model has NO melanoma class, so a
// melanoma can be read as a benign pigmented/melanocytic lesion (nevus, lentigo, seborrheic keratosis)
// with no ABCDE ticked and no OOD -> would otherwise pass as benign + Rx-eligible. Asserts that any
// pigmented/melanocytic TOP differential now (a) forces rxEligible=false and (b) surfaces a
// "cannot exclude melanoma" caveat, while non-pigmented reads and the existing malignant/red-flag/OOD
// guardrails are unchanged.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = { exports: {} };
const win = {};
new Function("module", "window", fs.readFileSync(join(ROOT, "sknx-engines.js"), "utf8"))(mod, win);
const ENG = mod.exports;

const gp = (label, prob) => ({ label: label, prob: prob });

// H7: pigmented/melanocytic top differential -> not Rx-eligible + melanoma caveat
test("H7: nevus top differential is NOT rxEligible and carries a melanoma caveat", () => {
  const a = ENG.makeAnalysis({ generalProbs: [gp("nevus", 0.8), gp("eczema", 0.1)], features: {} }, "v1");
  assert.equal(a.rxEligible, false);
  assert.match(String(a.caution || ""), /melanoma/i);
});
test("H7: melanocytic nevus label is treated as pigmented", () => {
  const a = ENG.makeAnalysis({ generalProbs: [gp("melanocytic nevus", 0.7)], features: {} }, "v1");
  assert.equal(a.rxEligible, false);
});
test("H7: lentigo top differential is NOT rxEligible", () => {
  const a = ENG.makeAnalysis({ generalProbs: [gp("solar lentigo", 0.6)], features: {} }, "v1");
  assert.equal(a.rxEligible, false);
});
test("H7: seborrheic/benign keratosis (pigmented mimic) is NOT rxEligible", () => {
  const a = ENG.makeAnalysis({ generalProbs: [gp("benign keratosis", 0.6)], features: {} }, "v1");
  assert.equal(a.rxEligible, false);
});

// No-over-trigger: a non-pigmented inflammatory read with no red flag stays Rx-eligible, no melanoma caveat
test("no-over-trigger: psoriasis top differential stays rxEligible with no melanoma caveat", () => {
  const a = ENG.makeAnalysis({ generalProbs: [gp("psoriasis", 0.8), gp("eczema", 0.1)], features: {} }, "v1");
  assert.equal(a.rxEligible, true);
  assert.doesNotMatch(String(a.caution || ""), /melanoma/i);
});

// Regressions: the pre-existing guardrails must still hold
test("regression: a named malignant lesionProb still forces referral (not Rx-eligible)", () => {
  const a = ENG.makeAnalysis({ generalProbs: [gp("psoriasis", 0.7)], lesionProbs: [gp("BCC", 0.4)], features: {} }, "v1");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
});
test("regression: red-flag features still force referral", () => {
  const a = ENG.makeAnalysis({ generalProbs: [gp("eczema", 0.7)], features: { bleeding: true } }, "v1");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
});
test("regression: OOD is never Rx-eligible", () => {
  const a = ENG.makeAnalysis({ generalProbs: [gp("eczema", 0.5)], ood: true, features: {} }, "v1");
  assert.equal(a.rxEligible, false);
  assert.equal(a.ood, true);
});
