/* test/voice-diarize.test.mjs — best-effort Doctor/Patient Q&A labelling (display-only heuristic).
 * node --test test/voice-diarize.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../voice-diarize.js");

test("questions -> Doctor, first-person answers -> Patient", () => {
  const qa = D.toQA("How long have you had this fever? I have had fever for three days. Any cough? No cough.");
  assert.equal(qa[0].speaker, "doctor");
  assert.match(qa[0].text, /How long/);
  assert.equal(qa[1].speaker, "patient");
  assert.match(qa[1].text, /three days/);
  assert.equal(qa[2].speaker, "doctor");
  assert.equal(qa[3].speaker, "patient");
});

test("clinical directive reads as Doctor", () => {
  const qa = D.toQA("Let's do a CBC and start paracetamol.");
  assert.equal(qa[0].speaker, "doctor");
});

test("consecutive same-speaker turns merge into one bubble", () => {
  const qa = D.toQA("Any fever? Any cough? Any breathlessness?");
  assert.equal(qa.length, 1);
  assert.equal(qa[0].speaker, "doctor");
});

test("empty transcript -> no turns", () => {
  assert.deepEqual(D.toQA(""), []);
});
