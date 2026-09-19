/* test/voice-vitals-numbers.test.mjs — spoken numbers -> digits for vitals autofill.
 * "BP one twenty by eighty, pulse eighty eight" must fill like the digit form; and number words
 * with NO vital cue must never fabricate a vital. node --test test/voice-vitals-numbers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const V = require("../voice-vitals.js");

test("wordsToNumbers: common spoken vital forms", () => {
  assert.equal(V.wordsToNumbers("pulse eighty eight"), "pulse 88");
  assert.equal(V.wordsToNumbers("blood pressure one twenty by eighty"), "blood pressure 120 by 80");
  assert.equal(V.wordsToNumbers("temperature ninety eight point six"), "temperature 98.6");
  assert.equal(V.wordsToNumbers("respiratory rate sixteen"), "respiratory rate 16");
  assert.equal(V.wordsToNumbers("bp one hundred and two by sixty"), "bp 102 by 60");
  assert.equal(V.wordsToNumbers("pulse one thirty six"), "pulse 136");
  assert.equal(V.wordsToNumbers("pulse one ten"), "pulse 110");          // colloquial one-teen decade
  assert.equal(V.wordsToNumbers("bp one eighteen by eighty"), "bp 118 by 80");
  assert.equal(V.wordsToNumbers("bp two ten by one ten"), "bp 210 by 110");
});

test("extract: spoken vitals populate the same fields as digits", () => {
  const f = {};
  V.extract("blood pressure one twenty by eighty, pulse eighty eight, temperature ninety nine point four")
    .forEach((r) => (f[r.field] = r.value));
  assert.equal(f.bpSys, 120);
  assert.equal(f.bpDia, 80);
  assert.equal(f.pulse, 88);
  assert.equal(f.temp, 99.4);
});

test("extract: colloquial one-teen pulse (one ten) fills 110", () => {
  const f = {};
  V.extract("pulse one ten regular").forEach((r) => (f[r.field] = r.value));
  assert.equal(f.pulse, 110);
});

test("SAFETY: number words with no vital cue never create a vital", () => {
  const fields = V.extract("I told him one twenty times to rest for eight days").map((r) => r.field);
  assert.deepEqual(fields, []);
});

test("extract: spoken spo2 and blood sugar populate structured fields", () => {
  const f = {};
  V.extract("pulse eighty eight, saturation ninety seven percent, random blood sugar one twenty")
    .forEach((r) => (f[r.field] = r.value));
  assert.equal(f.pulse, 88);
  assert.equal(f.spo2, 97);
  assert.equal(f.grbs, 120);
});

test("digit-form input is untouched", () => {
  assert.equal(V.wordsToNumbers("BP 120/80 pulse 88"), "BP 120/80 pulse 88");
});
