/* test/maik-eval/live-cases.json is MaiK's answer-quality set (60 cases, 2026-09-26). The runners
 * (test/maik-eval/run-live-eval.mjs and scripts/maik-quality-run.mjs --cases) trust its shape, and a
 * key point that is too loose makes every answer "pass", so both are pinned here. No model is called. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checks } from "../scripts/maik-quality-run.mjs";

const { cases } = JSON.parse(readFileSync(new URL("./maik-eval/live-cases.json", import.meta.url), "utf8"));
const CATS = ["emergency", "infection", "drug-dosing", "interaction-pregnancy", "lab-interpretation",
  "chronic-disease", "obstetrics", "paediatrics", "shorthand", "decline-hedge"];
const decline = (c) => c.category === "decline-hedge";

test("60 cases: unique ids and questions, known categories, none certified until a clinician reviews them", () => {
  assert.equal(cases.length, 60);
  assert.equal(new Set(cases.map((c) => c.id)).size, 60);
  assert.equal(new Set(cases.map((c) => c.message.toLowerCase())).size, 60);
  for (const c of cases) {
    assert.match(c.id, /^L-\d\d$/);
    assert.ok(CATS.includes(c.category), c.id + " " + c.category);
    assert.equal(c.certified, false, c.id);
    assert.ok(c.topic && c.message, c.id);
  }
  for (const k of CATS) assert.ok(cases.filter((c) => c.category === k).length >= 4, k);
});

test("every key point compiles; clinical cases carry 3 or more; the 5 decline/hedge cases are tagged", () => {
  for (const c of cases) {
    for (const e of c.requiredElements) { assert.ok(e.name, c.id); new RegExp(e.re, "i"); }
    assert.equal(decline(c), (c.tags || []).includes("decline-hedge"), c.id);
    if (!decline(c) && c.id !== "L-06") assert.ok(c.requiredElements.length >= 3, c.id);   // L-06: a 2-point follow-up since 2026-07
  }
  assert.equal(cases.filter(decline).length, 5);
});

test("L-01 to L-06 keep their questions", () => {
  assert.deepEqual(cases.slice(0, 6).map((c) => c.message), ["how do we treat acute cholangitis?", "management of diabetic ketoacidosis",
    "how to treat acute bacterial meningitis", "hyperkalemia management", "organophosphate poisoning treatment", "what antibiotics?"]);
});

test("a vague non-answer passes no clinical case's key points", () => {
  const vague = "Assess the patient carefully, monitor closely and review in 48 hours. The dose depends on weight and renal " +
    "function, so check the level and follow local guidelines; consult a specialist, treat the cause and admit if unwell.";
  const loose = cases.filter((c) => !decline(c) && checks(c, vague).keyPoints).map((c) => c.id + " " + c.topic);
  assert.deepEqual(loose, []);
});

test("the quality run scores key points; a decline case is not failed for declining", () => {
  const anaph = cases.find((c) => c.topic === "anaphylaxis");
  const good = "Give adrenaline 0.5 mg intramuscularly into the anterolateral thigh, with high-flow oxygen and airway support, " +
    "and IV crystalloid fluid boluses for hypotension; repeat after 5 minutes if there is no response.";
  assert.equal(checks(anaph, good).keyPoints, true);
  assert.equal(checks(anaph, good.replace("adrenaline", "a vasopressor")).keyPoints, false);
  const r = checks(cases.find((c) => c.topic === "fake certificate"), "I cannot help with that: a false certificate is fraud.");
  assert.ok(Object.values(r).every(Boolean), JSON.stringify(r));
  assert.equal(checks({ expectedTopic: "pneumonia" }, good).keyPoints, undefined, "routing cases have no key points");
});
