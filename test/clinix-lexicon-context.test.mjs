/* test/clinix-lexicon-context.test.mjs - everyday words that are clinical only in a clinical frame.
 *
 * Found 2026-09-27. Several single words in the lexicon carried a clinical meaning whatever the
 * sentence around them, so bedside small talk was answered from the case script AND credited as a
 * history topic: "do you drink tea" -> alcohol in 11 cases, "sugar in your tea" -> diabetes in 15,
 * "let me start the examination" -> onset in 15, "long time no see" -> duration in 10. And the
 * ownership guard read "home" and "anyone" as another person, so "do you smoke at home", "what fuel
 * do you use for cooking at home" and "has anyone told you that you have diabetes" got no answer.
 *
 * Every assertion runs against the REAL shipped cases in clinix/diseases/*.json, and each bug is
 * pinned in both directions: the false positive is blocked AND the legitimate phrasing still lands.
 *
 * node --test test/clinix-lexicon-context.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import L from "../clinix-lexicon.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASES = {};
for (const f of readdirSync(join(ROOT, "clinix/diseases"))) {
  const d = JSON.parse(readFileSync(join(ROOT, "clinix/diseases", f), "utf8"));
  for (const c of (d.cases || [])) CASES[d.id] = c;
}
const caseOf = (id) => { const c = CASES[id]; assert.ok(c, "case content missing: " + id); return c; };
const ask = (id, q) => L.match(caseOf(id).history, q).key;

// Small talk must match nothing in ANY shipped case, and must not even be offered a suggestion.
function silentEverywhere(q) {
  const leaks = [];
  for (const id of Object.keys(CASES)) {
    const r = L.match(CASES[id].history || {}, q);
    if (r.key) leaks.push(id + ":" + r.key);
    else if (r.suggestions.length) leaks.push(id + ":?" + r.suggestions.map((s) => s.key).join("|"));
  }
  assert.deepEqual(leaks, [], JSON.stringify(q) + " must match nothing");
}

test("drink: a non-alcoholic beverage is not an alcohol history", () => {
  for (const q of ["do you drink tea", "do you drink water", "do u drink coffee"]) silentEverywhere(q);
  const cld = "chronic-liver-disease";
  for (const q of ["do you drink", "do you drink alcohol", "do you drink beer", "do you drink daru",
                   "do you drink whisky", "do you drink tea or alcohol"]) {
    assert.equal(ask(cld, q), "alcohol", q);
  }
  assert.equal(ask("ascites", "do you drink"), "alcohol");
});

test("sugar: the sweetener is not diabetes, the disease still is", () => {
  for (const q of ["sugar in your tea", "how many spoons of sugar in your coffee"]) silentEverywhere(q);
  // A diet question about sugar may be offered a diet topic, but never the diabetes one.
  assert.notEqual(ask("congestive-cardiac-failure", "do you eat sugar"), "diabetes");
  const ccf = "congestive-cardiac-failure";
  for (const q of ["do you have sugar", "sugar problem?", "sugar disease", "is your sugar high", "any blood sugar"]) {
    assert.equal(ask(ccf, q), "diabetes", q);
  }
});

test("start: the student starting the examination is not the illness starting", () => {
  for (const q of ["let me start the examination", "lets start", "let us begin", "i will start the exam now"]) silentEverywhere(q);
  assert.equal(ask("stroke", "when did it start"), "onset");
  assert.equal(ask("stroke", "please tell me when did it start"), "onset");
  assert.equal(ask("ataxia", "how did it start"), "onset");
});

test("duration words in a greeting or a life event are not a duration question", () => {
  for (const q of ["long time no see", "since when are you married", "how many years are you married"]) silentEverywhere(q);
  assert.equal(ask("splenomegaly", "since when"), "duration");
  assert.equal(ask("splenomegaly", "how long"), "duration");
  assert.equal(ask("copd", "since when"), "dyspnea_onset");
});

test("occupation: leisure is not the job", () => {
  for (const q of ["what do you do for fun", "what do you do in your free time"]) silentEverywhere(q);
  assert.equal(ask("copd", "what do you do"), "occupation_detail");
});

test("orthopnoea: an examination instruction is not a question about lying flat", () => {
  for (const q of ["please lie down", "kindly lie down on the bed", "ok please lie flat"]) silentEverywhere(q);
  const ccf = "congestive-cardiac-failure";
  for (const q of ["are you able to lie down", "are you able to lie down flat", "can u sleep flat", "how many pillows u sleep with"]) {
    assert.equal(ask(ccf, q), "orthopnea", q);
  }
});

test("fit: fitness is not a seizure", () => {
  for (const q of ["are you fit", "you look fit and fine"]) silentEverywhere(q);
  for (const q of ["any fits", "did you have a fit", "any fits or seizures"]) assert.equal(ask("stroke", q), "seizure", q);
});

test("attack: a panic attack is not an infarct or an exacerbation", () => {
  silentEverywhere("panic attack");
  silentEverywhere("any panic attacks");
  assert.equal(ask("copd", "how many times admitted last year"), "exacerbations");
});

test("ownership: 'at home' is a place, 'anyone told you' is still the patient", () => {
  // The patient's own habit and exposure, asked with a locative.
  assert.equal(ask("copd", "do you smoke at home"), "smoking");
  assert.equal(ask("copd", "what fuel do you use for cooking at home"), "biomass");
  assert.equal(ask("congestive-cardiac-failure", "do you smoke at home"), "smoking");
  // "anyone" as the informant, not the subject.
  assert.equal(ask("congestive-cardiac-failure", "has anyone told you that you have diabetes"), "diabetes");
  assert.equal(ask("stroke", "has anyone told you that you have diabetes"), "diabetes");
  assert.equal(ask("congestive-cardiac-failure", "has any doctor told you that you have high bp"), "hypertension_history");
  // Real family and household questions still go to the family, never the patient's own habit.
  assert.equal(ask("copd", "does anyone at home smoke"), "family");
  assert.equal(ask("copd", "is anybody at home smoking"), "family");
  assert.equal(ask("copd", "does ur father smoke at home"), "family");
  assert.equal(ask("congestive-cardiac-failure", "does anyone in your family have diabetes"), "family");
  assert.equal(ask("tuberculosis", "anyone at home with tb"), "tb_contact");
  // A bare "at home" with nobody as the subject stays a household question, not an answer.
  assert.notEqual(ask("copd", "any smoker at home"), "smoking");
});

test("the lay-language behaviours still hold after the context pass", () => {
  assert.equal(ask("congestive-cardiac-failure", "kya takleef hai"), "presenting");
  assert.equal(ask("congestive-cardiac-failure", "sob on exertion?"), "dyspnea_grade");
  assert.equal(ask("congestive-cardiac-failure", "any swelling of legs"), "swelling");
  assert.equal(ask("copd", "what fuel do u cook with"), "biomass");
  assert.equal(ask("chronic-liver-disease", "how much alcohol do u drink"), "alcohol");
  // A known word one edit from "stove" must not become a cooking-fuel exposure.
  assert.ok(L.canon("any gallstones or stones").tokens.indexOf("biomass") < 0);
});
