/* test/assessment-extract.test.mjs — LLM assessment-narrative output safety.
 * The prompt/model are exercised live server-side; what MUST be bullet-proof is the whitelist:
 * only 5 narrative text fields ever reach the app, no injected keys, no non-text values, no invention.
 * node --test test/assessment-extract.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessmentExtractPrompt, sanitizeAssessmentFields, ASSESSMENT_FIELDS } from "../functions/api/ai/_assessment-extract.js";

test("keeps only the five known narrative fields; drops injected keys", () => {
  const out = sanitizeAssessmentFields({
    cc: "fever and cough x3 days", presentHx: "worse at night", pastHx: "diabetic",
    provisionalDx: "viral fever", managementPlan: "symptomatic care",
    // things the model must NOT be able to smuggle in:
    Temp: "101", BP_SYS: "100", vitals: { hr: 88 }, diagnosisConfidence: 0.9, findings: ["pneumonia"]
  });
  assert.deepEqual(Object.keys(out).sort(), ["cc", "managementPlan", "pastHx", "presentHx", "provisionalDx"]);
  assert.equal(out.cc, "fever and cough x3 days");
  assert.equal(out.Temp, undefined);
  assert.equal(out.vitals, undefined);
  assert.equal(out.findings, undefined);
});

test("rejects non-text values (arrays/objects/booleans/null), coerces numbers, drops empties", () => {
  const out = sanitizeAssessmentFields({
    cc: ["a", "b"],            // array -> dropped
    presentHx: { x: 1 },       // object -> dropped
    pastHx: 42,                // number -> coerced to "42"
    provisionalDx: "   ",      // whitespace-only -> dropped
    managementPlan: true       // boolean -> dropped
  });
  assert.deepEqual(out, { pastHx: "42" });
});

test("caps very long values", () => {
  const out = sanitizeAssessmentFields({ presentHx: "x".repeat(5000) });
  assert.equal(out.presentHx.length, 2000);
});

test("non-object input is safe", () => {
  assert.deepEqual(sanitizeAssessmentFields(null), {});
  assert.deepEqual(sanitizeAssessmentFields("nope"), {});
  assert.deepEqual(sanitizeAssessmentFields(undefined), {});
});

test("prompt carries the hard safety rules + only the five keys", () => {
  const p = assessmentExtractPrompt("patient with fever");
  assert.match(p, /Never infer/i);
  assert.match(p, /NEVER generate a diagnosis/i);
  assert.match(p, /Do NOT put vitals or physical-examination findings/i);
  ASSESSMENT_FIELDS.forEach((k) => assert.ok(p.includes(k), "prompt mentions " + k));
  assert.match(p, /=== TRANSCRIPT ===\npatient with fever$/);
});
