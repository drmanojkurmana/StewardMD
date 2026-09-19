/* test/wardsynq-advisories.test.mjs — the hospital's own advice. Pure.
 *
 * node --test test/wardsynq-advisories.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileAdvisories, latestValue, evaluateAdvisories } from "../functions/_wardsynq/advisories.js";

/* Shaped as a hospital would write them. The CONTENT is this test's, not clinical guidance. */
const LIST = [
  {
    id: "nephrotoxic-in-aki", level: "warn",
    message: "Creatinine is above 200. Review the dose of this nephrotoxic drug.",
    action: "Discuss with the renal team before the next dose.",
    reference: "Local renal prescribing guideline, 2026",
    when: [{ kind: "drug-any", values: ["Gentamicin", "Vancomycin"] }, { kind: "observation-above", code: "2160-0", value: 200, withinHours: 72 }],
  },
  { id: "cultures-first", message: "Send blood cultures before the first antibiotic dose.", when: [{ kind: "drug", value: "Meropenem" }] },
  { id: "frail-elderly", message: "Patient is over 80. Consider a reduced starting dose.", when: [{ kind: "age-above", value: 80 }] },
  { id: "diabetic", message: "Patient has diabetes.", when: [{ kind: "problem", values: ["E11", "Type 2 diabetes"] }] },
];
const C = compileAdvisories(LIST);
const obs = (value, at) => ({ code: "2160-0", value, meta: { effectiveAt: at || "2026-09-07T06:00:00.000Z" } });
const NOW = Date.parse("2026-09-07T12:00:00.000Z");
const fire = (over) => evaluateAdvisories({ compiled: C, nowMs: NOW, ...(over || {}) });

test("AN ADVISORY CAN NEVER BLOCK, and says so on every one", () => {
  /* A hospital-authored rule is written by somebody who is not a software engineer, in a hospital
   * with no staging environment. A typo in a threshold that could stop prescribing takes the ward
   * offline at 3am with nobody to roll it back. */
  const f = fire({ drug: "Gentamicin", observations: [obs(240)] });
  assert.equal(f.length, 1);
  assert.equal(f[0].blocking, false);
  assert.equal(f[0].level, "warn");
  /* Marked as the hospital's, so a prescriber can tell "your hospital asked me to tell you this"
   * from "this drug will harm this patient". */
  assert.equal(f[0].source, "hospital-advisory");
  assert.equal(f[0].reference, "Local renal prescribing guideline, 2026");
  assert.ok(C.rules.every((r) => r.level === "info" || r.level === "warn"), "there is no blocking level to configure");
});

test("EVERY CONDITION MUST HOLD, and absent data does not fire", () => {
  // The drug matches but the creatinine does not.
  assert.deepEqual(fire({ drug: "Gentamicin", observations: [obs(90)] }).map((f) => f.id), []);
  // The creatinine matches but the drug does not.
  assert.deepEqual(fire({ drug: "Paracetamol", observations: [obs(240)] }).map((f) => f.id), []);

  /* NOT MEASURED IS NOT "BELOW". A rule that fired on absent data would be advising about a patient
   * nobody has measured. */
  assert.deepEqual(fire({ drug: "Gentamicin", observations: [] }).map((f) => f.id), []);
  // A value older than the rule's own window is not used either.
  assert.deepEqual(fire({ drug: "Gentamicin", observations: [obs(240, "2026-08-01T06:00:00.000Z")] }).map((f) => f.id), []);
  // And an age rule needs an age.
  assert.deepEqual(fire({ drug: "Paracetamol" }).map((f) => f.id), []);
  assert.deepEqual(fire({ drug: "Paracetamol", ageYears: 84 }).map((f) => f.id), ["frail-elderly"]);
});

test("a problem condition matches the code OR the hospital's own words, and never a resolved one", () => {
  assert.deepEqual(fire({ drug: "X", problems: [{ code: "E11", clinicalStatus: "active" }] }).map((f) => f.id), ["diabetic"]);
  assert.deepEqual(fire({ drug: "X", problems: [{ code: "text", display: "Type 2 diabetes", clinicalStatus: "active" }] }).map((f) => f.id), ["diabetic"]);
  // A problem somebody resolved is not a problem the patient still has.
  assert.deepEqual(fire({ drug: "X", problems: [{ code: "E11", clinicalStatus: "resolved" }] }).map((f) => f.id), []);
});

test("NOTHING IS MATCHED BY SUBSTRING", () => {
  // Exactly as the formulary does, and for the same reason: a substring match would apply a rule
  // about one drug to a different drug whose name contains it.
  assert.deepEqual(fire({ drug: "Meropenem" }).map((f) => f.id), ["cultures-first"]);
  assert.deepEqual(fire({ drug: "Meropenem 1g" }).map((f) => f.id), []);
  // Case and punctuation are not identity; the words are.
  assert.deepEqual(fire({ drug: "  meropenem " }).map((f) => f.id), ["cultures-first"]);
});

test("A MALFORMED ADVISORY IS REPORTED AND SKIPPED, never partly applied", () => {
  /* One whose condition failed to compile and fired anyway would be showing a hospital's clinicians
   * a message about a patient it never actually looked at. */
  const bad = compileAdvisories([
    ...LIST,
    { message: "no id", when: [{ kind: "always" }] },
    { id: "silent", when: [{ kind: "always" }] },
    { id: "no-when", message: "x" },
    { id: "unknown-kind", message: "x", when: [{ kind: "moon-phase", value: 1 }] },
    { id: "no-threshold", message: "x", when: [{ kind: "observation-above", code: "2160-0" }] },
    { id: "no-drug", message: "x", when: [{ kind: "drug" }] },
  ]);
  assert.deepEqual(bad.problems.map((p) => p.reason),
    ["no_id", "no_message", "no_condition", "unknown_condition", "condition_needs_code_and_number", "condition_needs_value"]);
  assert.equal(bad.rules.length, 4, "the sound rules still stand");
  assert.ok(!evaluateAdvisories({ compiled: bad, drug: "anything", nowMs: NOW }).some((f) => f.id === "unknown-kind"));

  // No advisories configured is simply no advice.
  assert.deepEqual(evaluateAdvisories({ compiled: compileAdvisories(null), drug: "Meropenem" }), []);
  assert.deepEqual(evaluateAdvisories({}), []);
});

test("the most recent value wins, and a non-numeric one is not a value", () => {
  const rows = [obs(90, "2026-09-06T06:00:00.000Z"), obs(240, "2026-09-07T06:00:00.000Z")];
  assert.equal(latestValue(rows, "2160-0", NOW, 72), 240);
  assert.equal(latestValue([obs("Haemolysed")], "2160-0", NOW, 72), null);
  assert.equal(latestValue([], "2160-0", NOW, 72), null);
  // No window means no age limit at all.
  assert.equal(latestValue([obs(240, "2020-01-01T00:00:00.000Z")], "2160-0", NOW, null), 240);
});
