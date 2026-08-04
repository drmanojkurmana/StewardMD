// test/sknx-rx.test.mjs — SknX Phase 3 clinician-confirmed-Rx guardrail.
// Proves the Rx affordance is impossible unless ALL five conditions hold, that malignant/urgent
// conditions are never draftable, and that drafts carry no patient dose.
import { test } from "node:test";
import assert from "node:assert";
import RX from "../sknx-rx.js";

// A benign, rx-eligible analysis. `lesion` present => the v2beta dual-engine malignancy screen RAN and
// cleared (a required precondition for any Rx draft; see the lesion-gate test below).
const benign = { differential: [{ label: "psoriasis", prob: 0.72, band: "high" }], lesion: { top: "nevus", prob: 0.9, band: "high" }, referral: false, rxEligible: true };
// A malignant/referral analysis (lesion engine forced referral).
const malignant = { differential: [{ label: "melanoma", prob: 0.4, band: "moderate" }], lesion: { top: "melanoma", prob: 0.4, band: "moderate" }, referral: true, rxEligible: false };

// deps that satisfy the flag + prescriber conditions (injected so the test never touches window globals).
const ON = { flagOn: true, canPrescribe: () => true };

test("eligible: true only when rxEligible + not-referral + flag on + verified prescriber + curated draft", () => {
  assert.equal(RX.eligible(benign, ON), true, "all conditions hold -> eligible");
  assert.equal(RX.eligible(null, ON), false, "no analysis");
  assert.equal(RX.eligible({ ...benign, rxEligible: false }, ON), false, "rxEligible false");
  assert.equal(RX.eligible({ ...benign, referral: true }, ON), false, "referral true");
  assert.equal(RX.eligible(malignant, ON), false, "malignant referral");
  assert.equal(RX.eligible(benign, { flagOn: false, canPrescribe: () => true }), false, "flag OFF");
  assert.equal(RX.eligible(benign, { flagOn: true, canPrescribe: () => false }), false, "not a prescriber");
});

test("eligible defaults to FALSE with no deps (flag off + no prescriber in a bare env)", () => {
  // No window.SMD_SKNX_FLAGS / SMD_RX in node -> flagOn false, canPrescribe false -> never eligible.
  assert.equal(RX.eligible(benign), false);
});

test("eligible is FALSE when the malignancy screen never ran (no analysis.lesion, e.g. a v1 tier)", () => {
  // Even with the flag on + a verified prescriber + rxEligible + not-referral, absence of a lesion read
  // means no malignancy screen ran -> no Rx (R1 HIGH: don't offer Rx on a tier without the screen).
  const noScreen = { differential: [{ label: "psoriasis", prob: 0.72, band: "high" }], referral: false, rxEligible: true };
  assert.equal(RX.eligible(noScreen, ON), false);
  // Adding the lesion read (screen ran and cleared) makes the same case eligible.
  assert.equal(RX.eligible({ ...noScreen, lesion: { top: "nevus", band: "high" } }, ON), true);
});

test("draftFor: malignant/urgent conditions are NEVER draftable (return null)", () => {
  for (const label of ["melanoma", "malignant melanoma", "BCC", "basal cell carcinoma", "SCC", "squamous cell carcinoma", "cellulitis"]) {
    assert.equal(RX.draftFor(label), null, "must not draft for: " + label);
  }
  // An unknown condition with no curated first-line is also null (no invented drugs).
  assert.equal(RX.draftFor("zzz-unknown"), null);
});

test("draftFor: a curated benign condition returns class-level options with cited sources and NO patient dose", () => {
  const d = RX.draftFor("psoriasis");
  assert.ok(d && Array.isArray(d.regimen) && d.regimen.length >= 1);
  for (const r of d.regimen) {
    assert.ok(typeof r.class === "string" && r.class.length > 0, "each regimen entry has a therapeutic class");
    assert.doesNotMatch(String(r.name), /\b\d+\s?(mg|mcg|ml)\b/i, "no patient dose in the drug name");
    assert.doesNotMatch(String(r.class), /\b\d+\s?(mg|mcg|ml)\b/i, "no patient dose in the class");
  }
  // Sources are cited from the vetted evidence corpus (each has a url).
  assert.ok(d.sources.length >= 1, "expected cited sources");
  for (const s of d.sources) assert.ok(s.url && /^https?:/i.test(s.url), "source has an http(s) url");
  assert.equal(d.topic, "psoriasis");
});

test("REGIMENS drug names are qualified, never a bare generic (pad must not auto-fill a dose)", () => {
  // The SMD_RX pad auto-fills a Drug Index dose for a line whose name matches a bare generic. Every
  // SknX drug line must stay class-level/qualified (a parenthetical or a class prefix) so it lands as
  // an unverified line for the clinician to dose - never a pre-filled dose (R1 Medium).
  for (const [cond, regimen] of Object.entries(RX.REGIMENS)) {
    for (const r of regimen) {
      if (r.isAdvice) continue;
      assert.ok(/\(|^Topical|^Non-/.test(r.name), cond + ": drug name must be qualified, got '" + r.name + "'");
      assert.doesNotMatch(r.name, /\b\d+\s?(mg|mcg|ml)\b/i, cond + ": no patient dose in a drug name");
    }
  }
});

test("openDraft: a referral/malignant analysis NEVER opens the Rx pad (zero calls)", () => {
  let calls = 0;
  const spyRx = { open: () => { calls++; } };
  const opened = RX.openDraft(malignant, { ...ON, rx: spyRx });
  assert.equal(opened, false);
  assert.equal(calls, 0, "SMD_RX.open must not be called on a referral");
});

test("openDraft: with the flag OFF, the pad never opens (even for a benign case + prescriber)", () => {
  let calls = 0;
  const spyRx = { open: () => { calls++; } };
  const opened = RX.openDraft(benign, { flagOn: false, canPrescribe: () => true, rx: spyRx });
  assert.equal(opened, false);
  assert.equal(calls, 0);
});

test("openDraft: an eligible benign case opens SMD_RX once with {topic, regimen}", () => {
  let received = null, calls = 0;
  const spyRx = { open: (ctx) => { calls++; received = ctx; } };
  const opened = RX.openDraft(benign, { ...ON, rx: spyRx });
  assert.equal(opened, true);
  assert.equal(calls, 1);
  assert.equal(received.topic, "psoriasis");
  assert.ok(Array.isArray(received.regimen) && received.regimen.length >= 1);
  // No patient dose leaks into any regimen line handed to the pad.
  for (const r of received.regimen) assert.doesNotMatch(String(r.name), /\b\d+\s?mg\b/i);
});
