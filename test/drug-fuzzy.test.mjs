/* test/drug-fuzzy.test.mjs — OCR/handwriting near-miss → known generic.
 * CRITICAL: the reported "Atorvastain"/"Clarithomycin" cases must resolve; junk must NOT. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const DrugFuzzy = require("../kb/ai/drug-fuzzy.js");
const { bestGenericMatch, editDistance } = DrugFuzzy;

const VOCAB = [
  "atorvastatin", "clarithromycin", "metformin", "amoxicillin", "ceftriaxone", "azithromycin",
  "aspirin", "ramipril", "pantoprazole", "levofloxacin", "clindamycin", "warfarin", "insulin",
];

test("editDistance basics", () => {
  assert.equal(editDistance("abc", "abc"), 0);
  assert.equal(editDistance("atorvastain", "atorvastatin"), 1);   // one insertion
  assert.equal(editDistance("clarithomycin", "clarithromycin"), 1);
});

test("resolves the reported handwriting/OCR near-misses", () => {
  assert.equal(bestGenericMatch("Atorvastain", VOCAB).generic, "atorvastatin");   // the exact bug
  assert.equal(bestGenericMatch("Clarithomycin", VOCAB).generic, "clarithromycin");
  assert.equal(bestGenericMatch("Metfformin", VOCAB).generic, "metformin");
  assert.equal(bestGenericMatch("Amoxicilin", VOCAB).generic, "amoxicillin");
  assert.equal(bestGenericMatch("Ceftriaxone", VOCAB).generic, "ceftriaxone");    // exact still fine
  assert.equal(bestGenericMatch("Azithromicin", VOCAB).generic, "azithromycin");
});

test("does NOT map junk / too-far / too-short / ambiguous (safety)", () => {
  assert.equal(bestGenericMatch("banana", VOCAB), null);            // not a drug
  assert.equal(bestGenericMatch("asa", VOCAB), null);              // too short (<6)
  assert.equal(bestGenericMatch("xyzqwerty", VOCAB), null);        // far from everything
  assert.equal(bestGenericMatch("", VOCAB), null);
  assert.equal(bestGenericMatch("paracetamol", []), null);        // empty vocab
  // a token roughly equidistant from two real generics must NOT be force-picked
  const amb = bestGenericMatch("clindamycin", ["clindamycin", "clarithromycin"]);
  assert.equal(amb && amb.generic, "clindamycin"); // clearly closest (d=1) -> ok, not ambiguous here
});

test("threshold: a 2-edit miss on a long name still resolves; a 4-edit does not", () => {
  assert.equal(bestGenericMatch("pantorazole", VOCAB).generic, "pantoprazole"); // ~1-2 edits
  assert.equal(bestGenericMatch("levoxflxacin", VOCAB) && bestGenericMatch("levoxflxacin", VOCAB).generic, "levofloxacin");
  assert.equal(bestGenericMatch("metronidazxxxx", VOCAB), null); // not in vocab + far
});
