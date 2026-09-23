// phi-india.js: Indian identifier redaction layered on reasoning.js redactPHI().
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PI = require("../phi-india.js");

// The real redactPHI from reasoning.js, lifted out so the base rules and the India layer run together
// exactly as they do on the phone.
const SRC = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const FN = SRC.slice(SRC.indexOf("  function redactPHI(text) {"), SRC.indexOf("  window.SMD_redactPHI = redactPHI;"));
function loadRedact(flag) {
  const store = new Map(flag == null ? [] : [["smd_phi_india", flag]]);
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null) };
  const api = new Function("module", "localStorage", readFileSync(new URL("../phi-india.js", import.meta.url), "utf8") + "; return module.exports;")({ exports: {} }, localStorage);
  api.enabled = () => { try { return localStorage.getItem("smd_phi_india") !== "0"; } catch (e) { return true; } };
  return new Function("window", FN + "; return redactPHI;")({ SMD_PHI_INDIA: api });
}
const redact = loadRedact(null);

test("the module and the reasoning.js hook are both present", () => {
  assert.equal(typeof PI.apply, "function");
  assert.ok(FN.length > 200, "redactPHI located in reasoning.js");
  assert.match(FN, /SMD_PHI_INDIA/);
});

test("ABHA Address and UPI IDs no longer leak (the base email rule needs a dotted domain)", () => {
  assert.equal(redact("addr ramesh.kumar1990@abdm seen"), "addr [redacted] seen");
  assert.equal(redact("sandbox id test_user@sbx"), "sandbox id [redacted]");
  assert.equal(redact("pay to ramesh98@okaxis or 9876@ybl"), "pay to [redacted] or [redacted]");
  assert.equal(redact("mail a.b@hospital.in"), "mail [redacted]", "ordinary email still handled by the base rule");
});

test("PAN, masked Aadhaar and labelled Indian IDs are redacted", () => {
  assert.equal(redact("PAN ABCPK1234Z on file"), "PAN [redacted] on file");
  assert.equal(redact("id shown as XXXX XXXX 4821"), "id shown as [redacted]");
  assert.match(redact("Aadhar: 1234"), /^Aadhar: \[redacted\]$/);
  assert.match(redact("Ration Card No: WAP123456"), /\[redacted\]/);
  assert.doesNotMatch(redact("Ration Card No: WAP123456"), /WAP123456/);
  assert.doesNotMatch(redact("Voter ID ZXC1234567"), /ZXC1234567/);
  assert.doesNotMatch(redact("PMJAY ID PMJ9988"), /PMJ9988/);
  assert.doesNotMatch(redact("Pincode: 530045"), /530045/);
});

test("Aadhaar / ABHA / phone numbers written in Indic digits are caught", () => {
  // Devanagari Aadhaar 4-4-4, Telugu phone, Tamil ABHA 2-4-4-4
  assert.equal(redact("आधार १२३४ ५६७८ ९०१२"), "आधार [redacted]");
  assert.equal(redact("ఫోన్ ౯౮౭౬౫౪౩౨౧౦"), "ఫోన్ [redacted]");
  assert.equal(redact("ABHA ௧௨-௩௪௫௬-௭௮௯௦-௧௨௩௪"), "ABHA: [redacted]");
  assert.equal(PI.foldDigits("৭ ੮ ૯ ୦ ೫ ൬"), "7 8 9 0 5 6");
});

test("Hindi and Telugu name labels are redacted", () => {
  assert.equal(redact("नाम: रमेश कुमार"), "नाम: [redacted]");
  assert.equal(redact("రోగి పేరు: సీత"), "రోగి పేరు: [redacted]");
});

test("clinical values are never touched", () => {
  const clinical = [
    "Na 138, K 4.2, pH 7.32, Hb 9.8 g/dL, HbA1c 7.2%, eGFR 45, CD4 350",
    "amoxicillin 500 mg PO tid; ceftriaxone 2 g IV @ 24 h; vancomycin 15 mg/kg @ q12h",
    "BP 130/80, HR 96, SpO2 94% on RA, QTc 450 ms, T2DM since 2015",
    "EGFR exon 19 del, HER2 3+, PD-L1 TPS 60%, BRCA1 c.68_69del, ECOG 1, T2N1M0",
    "Hb ९.८ g/dL, Na १३८",  // Indic short values: folded, not redacted
  ];
  for (const c of clinical.slice(0, 4)) assert.equal(PI.apply(c), c, c);
  assert.equal(redact(clinical[4]), "Hb 9.8 g/dL, Na 138");
});

test("flag OFF restores the base redactPHI output byte-identically", () => {
  const off = loadRedact("0");
  const inputs = ["addr ramesh@abdm", "PAN ABCPK1234Z", "आधार १२३४ ५६७८ ९०१२", "नाम: रमेश", "Na 138"];
  for (const s of inputs) {
    const base = new Function("window", FN + "; return redactPHI;")({})(s);
    assert.equal(off(s), base, s);
  }
  assert.equal(off("addr ramesh@abdm"), "addr ramesh@abdm", "documents the old leak");
});

test("idempotent: running twice changes nothing more", () => {
  const s = "Pt ramesh@okaxis PAN ABCPK1234Z आधार १२३४ ५६७८ ९०१२ Na 138";
  assert.equal(redact(redact(s)), redact(s));
});
