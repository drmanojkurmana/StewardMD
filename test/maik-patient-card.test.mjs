/* A patient case gets choices, not a canned redirect (owner, 2026-09-27). MaiK answered
 * "35year old male patient ... non-healing ulcer on leg with 450 RBS and 72K platelets" with the same
 * "Start Dx My Patient or Clinical Reasoning" text three times, "Give me dd" included. Now the first
 * such message gets a card (Start Case / Dx My Patient / Answer here / Answer, don't ask again), a
 * message that asks for something is answered at once, and hospital IDs are stripped before a case is
 * answered. Runs the REAL isPatientSpecific, MAIK_PT_ASK and maikStripIds out of home.js; the card in
 * the running app is covered by test/run-maik-patient-card-ui.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const grab = (re, label) => { const m = home.match(re); assert.ok(m, "could not extract " + label + " from home.js"); return m[0]; };
const src = [
  grab(/function isPatientSpecific\(q\) \{.*\}/, "isPatientSpecific"),
  grab(/var MAIK_PT_ASK = .+;/, "MAIK_PT_ASK"),
  grab(/function maikStripIds\(s\) \{[\s\S]*?\n    \}/, "maikStripIds"),
].join("\n");
const { isPatientSpecific, MAIK_PT_ASK, maikStripIds } = new Function(src + "\nreturn { isPatientSpecific: isPatientSpecific, MAIK_PT_ASK: MAIK_PT_ASK, maikStripIds: maikStripIds };")();

const CASE = "35year old male patient with and a non-healing ulcer on leg with 450 RBS and 72K platelets";

test("the transcript's case is a patient case, and on its own it gets the choice card", () => {
  assert.equal(isPatientSpecific(CASE), true);
  assert.equal(MAIK_PT_ASK.test(CASE), false);
  assert.equal(MAIK_PT_ASK.test("my patient is a 60 year old man with fever?"), false, "one question mark is not a demand");
});

test("a message that asks for something is answered at once", () => {
  for (const q of [CASE + " Give me dd", CASE + "???", CASE + " ddx", "my patient has fever and rash, management?",
    "this patient with DKA, what is the next step", "differential for my patient with ascites", "rx for this patient"]) {
    assert.equal(MAIK_PT_ASK.test(q), true, q);
  }
});

test("hospital IDs and emails are stripped; lab values, ages and doses stay", () => {
  assert.equal(maikStripIds(CASE), CASE);
  const s = maikStripIds("UHID 4481123 45M with sepsis, platelets 72000, Hb 7.2, MRN: A12345, mail dr.x@gmail.com, ceftriaxone 2 g");
  for (const gone of ["4481123", "A12345", "UHID", "MRN", "gmail"]) assert.ok(!s.includes(gone), gone + " left in: " + s);
  for (const kept of ["45M", "sepsis", "platelets 72000", "Hb 7.2", "ceftriaxone 2 g"]) assert.ok(s.includes(kept), kept + " lost: " + s);
});

test("the canned redirect is gone and the card's buttons reach the real tools", () => {
  assert.ok(!home.includes("I can help you assess this"));
  const card = grab(/function maikPatientCard\(question\) \{[\s\S]*?\n    \}/, "maikPatientCard");
  for (const want of ['data-maik-tool="startcase"', 'data-maik-tool="reasoning"', "data-maik-anyway", "data-maik-ptnoask"]) assert.ok(card.includes(want), want);
  assert.match(home, /startcase: openCaseChooser/, "Start Case opens the case chooser");
  assert.match(home, /reasoning: function \(\) \{ openDxChooser\(\); \}/, "Dx My Patient opens the Dx chooser");
  assert.match(home, /hasAttribute\("data-maik-ptnoask"\)\) \{ try \{ localStorage\.setItem\("smd_maik_ptask", "0"\)/, "don't ask again is remembered");
});
