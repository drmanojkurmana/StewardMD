// Voice ambient — per-chunk language detection that drives Auto-mode model routing.
// detectScript(text) → "te" | "hi" | "en" | "" so Auto sends the NEXT chunk to the right model
// (Telugu → specialist, Devanagari → Hindi, Latin → English).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// voice-ambient.js is a browser IIFE that also does module.exports = API (window is null in Node).
const AMB = require("../voice-ambient.js");
const { detectScript } = AMB;

test("detectScript: Telugu script → te", () => {
  assert.equal(detectScript("జ్వరం మూడు రోజుల నుండి ఉంది"), "te");
  assert.equal(detectScript("ceftriaxone one gram IV BD ఇవ్వండి"), "te", "any Telugu char wins (code-switch)");
});

test("detectScript: Devanagari → hi", () => {
  assert.equal(detectScript("बुखार तीन दिन से है"), "hi");
  assert.equal(detectScript("amlodipine 5 mg रोज़ दो"), "hi");
});

test("detectScript: Latin/English → en", () => {
  assert.equal(detectScript("patient has fever for three days"), "en");
  assert.equal(detectScript("ceftriaxone one gram IV BD"), "en");
});

test("detectScript: empty / non-linguistic → ''", () => {
  assert.equal(detectScript(""), "");
  assert.equal(detectScript("   "), "");
  assert.equal(detectScript("123 456"), "");
  assert.equal(detectScript(null), "");
});

// Telugu takes precedence over Latin in a mixed chunk (specialist gives the best Telugu transcription).
test("detectScript: mixed Telugu+Latin → te (specialist wins)", () => {
  assert.equal(detectScript("BP 120 by 80 జ్వరం undi"), "te");
});
