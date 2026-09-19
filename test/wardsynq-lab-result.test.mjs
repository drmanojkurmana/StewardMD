/* test/wardsynq-lab-result.test.mjs — WardSynQ resulting a test it ordered. Pure half.
 *
 * node --test test/wardsynq-lab-result.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORY, LOCAL_SYSTEM, STATUSES, codeForTest, reportIdFor, observationIdFor, observationsFrom } from "../functions/_wardsynq/lab-result.js";

const of = (tests) => observationsFrom({ tests, patientId: "pat", reportId: "wsq-dr-req-1", reportedAt: "2026-09-07T09:00:00.000Z" });

test("a known test gets its real LOINC; an unknown one keeps its own name, never a guessed code", () => {
  assert.deepEqual(codeForTest("Potassium"), { code: "2823-3", codeSystem: "http://loinc.org", display: "Potassium" });
  assert.equal(codeForTest("  SODIUM  ").code, "2951-2", "case and spacing are not identity");
  // A guessed LOINC on a result survives every export afterwards and a receiver cannot tell it from
  // a real one, so an unmapped assay is honestly local instead.
  const local = codeForTest("Hospital-specific panel X");
  assert.equal(local.codeSystem, LOCAL_SYSTEM);
  assert.equal(local.code, "Hospital-specific panel X");
  assert.ok(!local.codeSystem.includes("loinc"));
});

test("a value that is not a number is kept AS TEXT, never coerced", () => {
  const { observations } = of([
    { test: "Potassium", value: 7.4, unit: "mmol/L" },
    { test: "Blood culture", value: "No growth at 48h" },
    { test: "Troponin", value: "<0.01", unit: "ng/mL" },
    { test: "Haemoglobin", value: "Haemolysed" },
  ]);
  assert.equal(observations.length, 4);
  assert.equal(observations[0].value, 7.4);
  assert.equal(observations[0].nonNumeric, undefined);
  // Every one of these is a real laboratory answer and every one of them means something. Extracting
  // a number from "<0.01" would produce a value the laboratory never reported.
  for (const i of [1, 2, 3]) {
    assert.equal(typeof observations[i].value, "string");
    assert.equal(observations[i].nonNumeric, true);
  }
  assert.equal(observations[2].value, "<0.01");
});

test("nothing is interpreted: the range is as reported, and no normal/abnormal is computed", () => {
  const { observations } = of([{ test: "Potassium", value: 7.4, unit: "mmol/L", range: "3.5-5.1", low: 3.5, high: 5.1 }]);
  const o = observations[0];
  assert.deepEqual(o.referenceRange, { text: "3.5-5.1", low: 3.5, high: 5.1 });
  // No interpretation field, no flag this file decided for itself. critical-results.js is the one
  // thing that acts on a value, and it has its own rules.
  assert.equal(o.interpretation, undefined);
  assert.equal(o.abnormal, undefined);
  assert.equal(o.sourceCritical, undefined, "and it did not decide 7.4 was critical by itself");
  // A test with no range carries none rather than an invented one.
  assert.equal(of([{ test: "Potassium", value: 4.0 }]).observations[0].referenceRange, undefined);
});

test("the LABORATORY's own critical flag is carried through untouched", () => {
  const { observations } = of([
    { test: "Potassium", value: 4.2, unit: "mmol/L", critical: true },
    { test: "Sodium", value: 118, unit: "mmol/L" },
  ]);
  // A normal-looking value the lab flagged is still flagged: nothing here talks a laboratory out of
  // its own call, and critical-results.js then treats that flag as final.
  assert.equal(observations[0].sourceCritical, true);
  assert.equal(observations[1].sourceCritical, undefined, "and a flag is never added for it");
});

test("a row with no test name or no value is reported, never recorded as a blank result", () => {
  const { observations, rejected } = of([
    { test: "", value: 5 },
    { test: "Potassium" },
    { test: "Sodium", value: "" },
    { test: "Potassium", value: 4.1 },
    { test: "potassium", value: 4.2 },     // the same analyte twice in one report
  ]);
  assert.equal(observations.length, 1);
  assert.deepEqual(rejected.map((r) => r.reason), ["no_test_name", "no_value", "no_value", "duplicate"]);
  assert.equal(observations[0].value, 4.1, "the first one stands; the duplicate does not overwrite it");
});

test("every observation is a LABORATORY observation, and the ids are deterministic", () => {
  const { observations } = of([{ test: "Potassium", value: 4.1 }]);
  assert.equal(observations[0].category, CATEGORY);
  assert.equal(observations[0].id, observationIdFor("wsq-dr-req-1", "2823-3"));
  assert.equal(reportIdFor("opd-order-x"), "wsq-dr-opd-order-x");
  assert.equal(reportIdFor(""), null);
  assert.equal(observationIdFor("r", ""), null);
  // A re-release of the same report produces the same observation ids, so it is a new VERSION of
  // each value rather than a second copy of the result.
  assert.equal(of([{ test: "Potassium", value: 9.9 }]).observations[0].id, observations[0].id);
});

test("a result with no report or patient is not a result", () => {
  assert.deepEqual(observationsFrom({ tests: [{ test: "K", value: 1 }], patientId: "", reportId: "r" }).rejected, [{ reason: "report_required" }]);
  assert.deepEqual(observationsFrom({ tests: [{ test: "K", value: 1 }], patientId: "p", reportId: "" }).observations, []);
  assert.deepEqual(STATUSES, ["preliminary", "final", "corrected"]);
});
