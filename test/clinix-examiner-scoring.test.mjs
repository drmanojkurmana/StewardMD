/* test/clinix-examiner-scoring.test.mjs - a viva answer is marked on what it says.
 *
 * Audit 2026-09-27: evaluateAnswer gave 20 points to ANY non-empty answer, so "banana" five times
 * finalized as honours with 100/100. Scoring is now the share of each turn's expected concepts the
 * answer names.
 *
 * node --test test/clinix-examiner-scoring.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Engine from "../clinix-engine.js";
import Examiner from "../clinix-examiner.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rhd = JSON.parse(readFileSync(join(ROOT, "clinix/diseases/rheumatic-heart-disease.json"), "utf8")).cases[0];

function rhdState() {
  const s = Engine.createCaseState(rhd, {});
  s.examRevealed = JSON.parse(JSON.stringify(rhd.exam));
  s.differential = ["Mitral stenosis"];
  return s;
}

function runViva(answers) {
  const s = rhdState();
  const v = Examiner.createVivaSession(s);
  const scores = [];
  for (let i = 0; i < 5; i++) {
    const q = Examiner.getNextQuestion(v, s);
    scores.push(Examiner.evaluateAnswer(v, q, typeof answers === "string" ? answers : answers[i]).score);
  }
  return { card: Examiner.finalizeViva(v), scores };
}

test("gibberish scores zero on every turn and fails the viva", () => {
  for (const junk of ["banana", "asdf qwer zxcv", "yes", "I think it is fine really", "lorem ipsum dolor sit amet"]) {
    const { card, scores } = runViva(junk);
    assert.deepEqual(scores, [0, 0, 0, 0, 0], junk + ": " + scores);
    assert.equal(card.totalScore, 0);
    assert.equal(card.verdict, "fail_knowledge");
  }
});

test("a relevant answer outscores an irrelevant one on every turn", () => {
  const good = [
    "Irregularly irregular pulse with a pulse deficit, loud S1, an opening snap and a low-pitched rumbling mid-diastolic murmur at the apex; a tapping apex beat and a diastolic thrill. Malar flush.",
    "The opening snap, loud S1 and the mid-diastolic rumble at the apex with a tapping apex point to rheumatic mitral stenosis rather than mitral regurgitation.",
    "Exercise or handgrip raises heart rate and afterload; the diastolic murmur of mitral stenosis gets louder in the left lateral position in expiration, and inspiration makes right-sided murmurs louder.",
    "An urgent echocardiogram and ECG: an echo showing a tight valve area or left atrial thrombus, or fast AF on the ECG, changes management within the hour.",
    "Watch for fast atrial fibrillation and tachycardia, falling oxygen saturation and pulmonary oedema with a rising respiratory rate, hypotension, and stroke from embolism; escalate early."
  ];
  const bad = runViva("the weather is nice and I like cricket");
  const ok = runViva(good);
  for (let i = 0; i < 5; i++) assert.ok(ok.scores[i] > bad.scores[i], `turn ${i}: ${ok.scores[i]} vs ${bad.scores[i]}`);
  assert.ok(ok.card.totalScore >= 80, "good answers earn honours: " + ok.card.totalScore);
});

test("a partial answer earns partial credit", () => {
  const s = rhdState();
  const v = Examiner.createVivaSession(s);
  const q = Examiner.getNextQuestion(v, s);
  const r = Examiner.evaluateAnswer(v, q, "There was a loud S1.");
  assert.ok(r.score > 0 && r.score < 20, "partial: " + r.score);
  assert.equal(r.verdict === "correct", false);
});

test("feedback names what a good answer would have covered, without an em-dash", () => {
  const s = rhdState();
  const v = Examiner.createVivaSession(s);
  const r = Examiner.evaluateAnswer(v, Examiner.getNextQuestion(v, s), "banana");
  assert.equal(r.score, 0);
  assert.equal(r.verdict, "unsatisfactory");
  assert.ok(r.feedback.length > 20);
  assert.equal(r.feedback.indexOf("—"), -1);
});

test("every question carries the expected points it is marked against", () => {
  const s = rhdState();
  const v = Examiner.createVivaSession(s);
  for (let i = 0; i < 5; i++) {
    const q = Examiner.getNextQuestion(v, s);
    assert.ok(Array.isArray(q.expectedPoints) && q.expectedPoints.length > 0, q.type);
    Examiner.evaluateAnswer(v, q, "x");
  }
});
