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

test("v1 entitlement hides the lesion DISPLAY but the malignancy guardrail STILL refers (safety, tier-independent)", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "acne", prob: 0.8 }],
    lesionProbs:  [{ label: "melanoma", prob: 0.9 }],
    features: {}
  }, "v1");
  assert.equal(a.lesion, null, "lesion display object stays a v2beta surfacing");
  assert.equal(a.referral, true, "R1 C1: a named malignancy must refer even at v1 (guardrail is not tier-gated)");
  assert.equal(a.rxEligible, false, "must NOT be Rx-eligible when a carcinoma is present");
  assert.match(a.referralReason, /melanoma/i);
});

test("v1 benign lesion: no referral, no lesion display (guardrail only fires on malignancy)", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "psoriasis", prob: 0.7 }],
    lesionProbs:  [{ label: "nevus", prob: 0.95 }],
    features: {}
  }, "v1");
  assert.equal(a.lesion, null, "no lesion display at v1");
  assert.equal(a.referral, false);
  assert.equal(a.rxEligible, true);
});

test("SCAR caution: a prominent 'Drug Rash' surfaces a severe-reaction caution (not a hard referral)", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "Drug Rash", prob: 0.8 }, { label: "Eczema", prob: 0.2 }],
    lesionProbs: [], features: {}
  }, "v2beta");
  assert.match(a.caution || "", /severe reaction|SJS|TEN|DRESS/i);
  assert.equal(a.referral, false, "caution is not a hard referral");
  assert.equal(a.rxEligible, true);
});

test("SCAR caution: a benign top differential has no caution", () => {
  const a = ENG.makeAnalysis({
    generalProbs: [{ label: "Psoriasis", prob: 0.9 }, { label: "Drug Rash", prob: 0.1 }],
    lesionProbs: [], features: {}
  }, "v2beta");
  assert.equal(a.caution, null, "low-scoring, non-top Drug Rash does not trigger the caution");
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
