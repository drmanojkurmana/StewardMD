/* P1.1 configuration-driven clinical forms (wardsynq/wardsynq-forms.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDefinition, evaluateResponse, applicabilityProblem, publish } from "../wardsynq/wardsynq-forms.js";

const TRIAGE = {
  key: "ed_triage", title: "Emergency triage", roles: ["nurse", "doctor"], departments: ["ED"],
  sections: [
    { title: "Vitals", fields: [
      { key: "weight_kg", label: "Weight (kg)", type: "number", min: 0.3, max: 400 },
      { key: "height_cm", label: "Height (cm)", type: "number", min: 20, max: 260 },
      { key: "bmi", label: "BMI", type: "calculated", calc: { op: "bmi", fields: ["weight_kg", "height_cm"] } },
      { key: "gcs", label: "GCS", type: "integer", min: 3, max: 15, required: true, code: { system: "http://loinc.org", code: "9269-2" } },
    ] },
    { title: "Chest pain", fields: [
      { key: "chest_pain", label: "Chest pain", type: "boolean", required: true },
      { key: "pain_onset", label: "Onset", type: "datetime", required: true, showWhen: { field: "chest_pain", op: "eq", value: true } },
      { key: "radiates", label: "Radiates to", type: "multi_choice", options: [{ value: "arm", label: "Arm" }, { value: "jaw", label: "Jaw" }], showWhen: { field: "chest_pain", op: "eq", value: true } },
    ] },
  ],
};

test("MALFORMED CONFIGURATION FAILS VISIBLY: every problem named, and nothing can be published or answered", () => {
  const bad = {
    key: "Bad Key", title: "",
    sections: [{ title: "S", fields: [
      { key: "a", label: "A", type: "slider" },
      { key: "b", label: "B", type: "text", showWhen: { field: "nope", op: "eq", value: 1 } },
      { key: "c", label: "C", type: "calculated", calc: { op: "sum", fields: ["c", "missing"] } },
      { key: "a", label: "Dup", type: "text" },
      { key: "d", label: "D", type: "single_choice" },
    ] }],
  };
  const p = validateDefinition(bad);
  for (const re of [/form key/, /needs a title/, /unknown type "slider"/, /depending on "nope"/, /refers to itself/, /uses "missing"/, /appears twice/, /choice with no options/]) assert.ok(p.some((x) => re.test(x)), "expected problem " + re);
  assert.throws(() => publish(bad, 1, "t"), /fix these problems/);
  assert.throws(() => evaluateResponse(bad, {}), /cannot be answered/);
  assert.deepEqual(validateDefinition(TRIAGE), []);
});

test("required, types and ranges are checked; hidden fields are not required and their stale values are dropped", () => {
  const r = evaluateResponse(TRIAGE, { gcs: "16", chest_pain: false, pain_onset: "2026-09-13T10:00", radiates: ["arm"] });
  assert.equal(r.valid, false);
  assert.match(r.errors.gcs, /at most 15/);
  assert.ok(!("pain_onset" in r.errors), "onset is hidden when there is no chest pain, so not required");
  assert.ok(!("pain_onset" in r.answers) && !("radiates" in r.answers), "a hidden field's old value is not stored");

  const r2 = evaluateResponse(TRIAGE, { gcs: 14, chest_pain: true });
  assert.match(r2.errors.pain_onset, /Onset is required/);
  const r3 = evaluateResponse(TRIAGE, { gcs: 14.5, chest_pain: true, pain_onset: "2026-09-13T10:00", radiates: ["leg"] });
  assert.match(r3.errors.gcs, /whole number/);
  assert.match(r3.errors.radiates, /listed options/);
});

test("calculated fields are computed on the server, never taken from the client, and absent without their inputs", () => {
  const r = evaluateResponse(TRIAGE, { weight_kg: 70, height_cm: 175, bmi: 99, gcs: 15, chest_pain: false });
  assert.equal(r.valid, true);
  assert.equal(r.answers.bmi, 22.9);
  const noHeight = evaluateResponse(TRIAGE, { weight_kg: 70, bmi: 99, gcs: 15, chest_pain: false });
  assert.ok(!("bmi" in noHeight.answers), "no height, no BMI - never a guess and never the client's number");
});

test("a form applies only when published, in force, and for the right role and department", () => {
  const pub = publish(TRIAGE, 3, "2026-09-13T00:00:00Z");
  assert.equal(pub.version, 3);
  assert.equal(applicabilityProblem(TRIAGE, { role: "nurse", department: "ED", date: "2026-09-13" }), "this form is not published");
  assert.equal(applicabilityProblem(pub, { role: "pharmacy", department: "ED", date: "2026-09-13" }), "this form is not for your role");
  assert.equal(applicabilityProblem(pub, { role: "nurse", department: "OPD", date: "2026-09-13" }), "this form is not used in this department");
  assert.match(applicabilityProblem({ ...pub, effectiveFrom: "2026-10-01" }, { role: "nurse", department: "ED", date: "2026-09-13" }), /in force from/);
  assert.equal(applicabilityProblem(pub, { role: "nurse", department: "ED", date: "2026-09-13" }), null);
});
