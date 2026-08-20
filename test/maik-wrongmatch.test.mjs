/* MaiK wrong-topic guard: a weak lexical match that shares only a generic qualifier with the query but
 * differs on the distinctive disease noun must be REJECTED (the real "Metabolic Acidosis -> Metabolic
 * Encephalopathy" bug), while synonyms and correct matches are never second-guessed.
 * node --test test/maik-wrongmatch.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const KB = require("../kb/ai/maik-kb.js");
const trusted = KB._matchTrusted;

test("REJECTS shared-qualifier / different-head-noun mismatches (the bug)", () => {
  assert.equal(trusted("metabolic acidosis", "Metabolic encephalopathy"), false);
  assert.equal(trusted("chronic kidney disease", "Chronic liver disease"), false);
  assert.equal(trusted("nephrotic syndrome", "Nephritic syndrome"), false);
  assert.equal(trusted("acute pancreatitis", "Acute pericarditis"), false);
});

test("TRUSTS synonyms (no shared word) and correct matches (shared distinctive noun)", () => {
  assert.equal(trusted("heart attack", "Myocardial infarction"), true);   // no overlap -> don't second-guess
  assert.equal(trusted("high blood pressure", "Hypertension"), true);
  assert.equal(trusted("diabetes", "Diabetes mellitus"), true);
  assert.equal(trusted("type 2 diabetes", "Diabetes mellitus"), true);
  assert.equal(trusted("community acquired pneumonia", "Pneumonia"), true);
  assert.equal(trusted("nephrotic syndrome", "Nephrotic syndrome"), true);
  assert.equal(trusted("metabolic acidosis", "Renal tubular acidosis"), true);   // shares distinctive "acidosis"
});

test("diseasePhrase extracts the query's disease term", () => {
  const p = KB._diseasePhrase("how to correct metabolic acidosis");
  assert.ok(/acidosis/.test(p), "expected the phrase to contain 'acidosis', got: " + p);
});
