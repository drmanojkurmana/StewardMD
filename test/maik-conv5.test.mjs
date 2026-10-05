/* test/maik-conv5.test.mjs — the rules behind the 4 Oct 2026 MaiK conversation fixes (edge-router.js):
 * a scheme or package ask is a scheme lookup and never ICD, the scheme named decides the states, and
 * the disease-word spelling fix is conservative. The UI replay is test/run-maik-conv5.mjs. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const E = require("../edge-router.js");

test("scheme words make a scheme ask, with the scheme words stripped from the term", () => {
  for (const [q, key, term] of [
    ["What is the arogyasri code for pancreatitis", "aarogyasri", "pancreatitis"],
    ["Ars codes for Malaria", "aarogyasri", "Malaria"],
    ["aarogya sri package for dengue", "aarogyasri", "dengue"],
    ["YSR code for appendicitis", "ap", "appendicitis"],
    ["pmjay package code for cholecystectomy", "pmjay", "cholecystectomy"],
    ["ayushman bharat rate for hernia", "pmjay", "hernia"],
    ["cmchis code for snake bite", "cmchis", "snake bite"],
    ["mjpjay package for burns", "mjpjay", "burns"],
    ["package code for malaria", null, "malaria"]
  ]) {
    const a = E.schemeAsk(q);
    assert.ok(a, q);
    assert.equal(a.key, key, q);
    assert.equal(a.term, term, q);
  }
});

test("Aarogyasri means both Andhra Pradesh and Telangana, each with its own scheme id", () => {
  const a = E.schemeAsk("arogyasri code for malaria");
  assert.deepEqual(a.targets.map((t) => t.state + ":" + t.scheme), ["andhra-pradesh:ap-ntr-vaidya-seva", "telangana:telangana-aarogyasri"]);
});

test("'ars' counts only next to code or package; ARDS and plain questions are not scheme asks", () => {
  for (const q of ["ards management", "ars", "what is ARDS", "icd code for ards", "ventilator settings in ards", "dosing scheme for vancomycin", "icd code for dental abscess"]) {
    assert.equal(E.schemeAsk(q), null, q);
  }
});

test("a scheme ask holds Layer 0 and there is no ICD option", () => {
  const r = E.rules("What is the arogyasri code for pancreatitis");
  assert.equal(r && r.kind, "scheme");
  assert.equal(r.scheme.term, "pancreatitis");
  assert.ok(!E.candidates("What is the arogyasri code for malaria").some((c) => c.kind === "icd"));
  // An ICD ask without a scheme word is unchanged.
  assert.equal(E.rules("icd code for type 2 diabetes").kind, "icd");
});

test("spell: one edit to a single known word, a run-together tail dropped, short or known words untouched", () => {
  const v = { abscess: 1, dental: 1, pneumonia: 1, hellp: 1, syndrome: 1, malaria: 1, sepsis: 1 };
  assert.deepEqual(E.spell("dental absccess", v), { text: "dental abscess", changed: true });
  assert.deepEqual(E.spell("Pneumoniacns", v), { text: "pneumonia", changed: true });
  assert.deepEqual(E.spell("hello", v), { text: "hello", changed: false });            // 5 letters: never touched (HELLP)
  assert.deepEqual(E.spell("malaria", v), { text: "malaria", changed: false });
  assert.equal(E.spell("antibiogram", v).changed, false);                                   // nothing within 2 edits
  // Two known words equally near: no guess.
  assert.equal(E.spell("sepsys", { sepsis: 1, sepsus: 1 }).changed, false);
});

test("openVerb: English, Hinglish and Tenglish open words", () => {
  for (const q of ["Open antibiogram", "antibiogram kholo", "icu teruvu", "take me to drugs"]) assert.ok(E.openVerb(q), q);
  for (const q of ["antibiogram", "what is the antibiogram", "antibiogram for klebsiella"]) assert.ok(!E.openVerb(q), q);
});
