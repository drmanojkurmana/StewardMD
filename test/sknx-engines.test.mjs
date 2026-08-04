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

test("capitalized 'Melanoma' label still forces referral (case-insensitive guardrail)", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "eczema", prob: 0.6 }],
    lesionProbs:  [{ label: "Melanoma", prob: 0.2 }, { label: "nevus", prob: 0.8 }],
    features: {}
  }, "v2beta");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
  assert.match(a.referralReason, /melanoma/i);
});

test("synonym label 'basal cell carcinoma' forces referral (synonym-robust guardrail)", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "eczema", prob: 0.6 }],
    lesionProbs:  [{ label: "basal cell carcinoma", prob: 0.2 }, { label: "nevus", prob: 0.8 }],
    features: {}
  }, "v2beta");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
});

test("differently-cased benign label is not mistaken for malignant (no false positive)", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "psoriasis", prob: 0.72 }],
    lesionProbs:  [{ label: "NEVUS", prob: 0.9 }, { label: "Eczema", prob: 0.05 }],
    features: {}
  }, "v2beta");
  assert.equal(a.referral, false);
  assert.equal(a.rxEligible, true);
});

// --- broadened malignant/refer set (beyond melanoma/BCC/SCC) ---
test("Mycosis Fungoides (cutaneous lymphoma) forces referral, blocks Rx, names the finding", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "eczema", prob: 0.6 }],
    lesionProbs:  [{ label: "Mycosis Fungoides", prob: 0.4 }, { label: "eczema", prob: 0.5 }],
    features: {}
  }, "v2beta");
  assert.equal(a.referral, true);
  assert.equal(a.rxEligible, false);
  assert.match(a.referralReason, /Mycosis Fungoides/i);
});

test("Merkel cell carcinoma (and MCC / Kaposi / DFSP synonyms) force referral", () => {
  for (const label of ["Merkel cell carcinoma", "MCC", "Kaposi sarcoma", "dermatofibrosarcoma protuberans", "sebaceous carcinoma", "cutaneous metastasis", "Bowen disease"]) {
    const a = ENG.makeAnalysis({
      generalProbs: [{ label: "psoriasis", prob: 0.6 }],
      lesionProbs:  [{ label, prob: 0.3 }, { label: "nevus", prob: 0.6 }],
      features: {}
    }, "v2beta");
    assert.equal(a.referral, true, "expected referral for malignant label: " + label);
    assert.equal(a.rxEligible, false, "expected no Rx for malignant label: " + label);
  }
});

test("benign 'dermatofibroma' is NOT mis-hit by the malignant 'dermatofibrosarcoma' key (exact-key match)", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "eczema", prob: 0.6 }],
    lesionProbs:  [{ label: "dermatofibroma", prob: 0.9 }, { label: "nevus", prob: 0.05 }],
    features: {}
  }, "v2beta");
  assert.equal(a.referral, false);
  assert.equal(a.rxEligible, true);
});

test("melanoma subtypes + short code force referral (amelanotic/nodular/acral/lentigo maligna/mel)", () => {
  for (const label of ["amelanotic melanoma", "nodular melanoma", "acral lentiginous melanoma", "lentigo maligna", "lentigo maligna melanoma", "mel", "keratoacanthoma", "atypical fibroxanthoma", "extramammary paget disease", "porocarcinoma"]) {
    const a = ENG.makeAnalysis({
      generalProbs: [{ label: "eczema", prob: 0.6 }],
      lesionProbs:  [{ label, prob: 0.2 }, { label: "nevus", prob: 0.7 }],
      features: {}
    }, "v2beta");
    assert.equal(a.referral, true, "expected referral for malignant label: " + label);
    assert.equal(a.rxEligible, false, "expected no Rx for malignant label: " + label);
  }
});

test("benign 'solar lentigo' / 'sebaceous hyperplasia' are NOT mis-hit as malignant (exact-key)", () => {
  for (const label of ["solar lentigo", "lentigo", "sebaceous hyperplasia", "seborrheic keratosis"]) {
    const a = ENG.makeAnalysis({
      generalProbs: [{ label: "psoriasis", prob: 0.6 }],
      lesionProbs:  [{ label, prob: 0.9 }, { label: "nevus", prob: 0.05 }],
      features: {}
    }, "v2beta");
    assert.equal(a.referral, false, "benign label must NOT refer: " + label);
    assert.equal(a.rxEligible, true, "benign label must stay Rx-eligible: " + label);
  }
});
