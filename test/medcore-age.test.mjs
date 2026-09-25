/* test/medcore-age.test.mjs — HAZ-ML-04. `dob` is an age, and must never be read as a date.
 *
 * GHIS sends age in years as a string ("45"). Parsed as a date it yields a patient born in the
 * year 45, so the adapter records `ageYears` and leaves `dob` as the sentinel `0000-00-00`, which
 * deliberately does not parse. Age drives weight-based paediatric dosing and every paediatric
 * refusal (PEWS under 16, the 70 kg default in icu.js), so this is a dosing hazard rather than a
 * display bug, and the same family of bug has bitten before (vault/modules/Insulin.md).
 *
 * The control is negative: there is no date-of-birth arithmetic anywhere in Medical Core. These
 * tests are what makes adding some fail.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildState, fromIcuState, readAge } from "../medcore/medcore-state.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPS = {
  unitTable: JSON.parse(readFileSync(join(ROOT, "medcore/data/units.json"), "utf8")),
  freshness: JSON.parse(readFileSync(join(ROOT, "medcore/data/freshness.json"), "utf8"))
};
const NOW = Date.parse("2026-09-19T10:04:00Z");

function stateWith(patient) {
  return buildState(DEPS, {
    asOf: NOW, patient: patient,
    observations: [{ param: "hr", value: 88, at: NOW - 600000, source: "icu-state" }]
  });
}

test("age: the sentinel dob yields no age at all, never an age near 1981", () => {
  const s = stateWith({ dob: "0000-00-00", sex: "M" });
  assert.equal(s.demographics.ageYears, null);
  assert.equal(s.demographics.ageSource, "unknown");
});

test("age: a real-looking dob is still not read - only ageYears is", () => {
  const s = stateWith({ dob: "1961-03-04", sex: "F" });
  assert.equal(s.demographics.ageYears, null, "a date of birth must not become an age here");
  const withAge = stateWith({ dob: "1961-03-04", ageYears: 65 });
  assert.equal(withAge.demographics.ageYears, 65);
  assert.equal(withAge.demographics.ageSource, "reported");
});

test("age: GHIS sends the age as a string, and that is the field that is read", () => {
  assert.deepEqual(readAge({ ageYears: "45" }), { ageYears: 45, ageSource: "reported" });
  assert.deepEqual(readAge({ age: "45" }), { ageYears: 45, ageSource: "reported" });
  assert.deepEqual(readAge({ ageYears: 0 }), { ageYears: 0, ageSource: "reported" }, "a neonate is age 0, not missing");
  assert.deepEqual(readAge({ ageYears: 6.5 }), { ageYears: 6, ageSource: "reported" });
});

test("age: a value that cannot be an age is dropped, not clamped", () => {
  for (const bad of [-1, 121, 1961, "1961-03-04", "abc", NaN, Infinity, {}, []]) {
    const r = readAge({ ageYears: bad });
    assert.equal(r.ageYears, null, JSON.stringify(bad) + " must not become an age");
    assert.equal(r.ageSource, "unknown");
  }
  assert.deepEqual(readAge(null), { ageYears: null, ageSource: "unknown" });
  assert.deepEqual(readAge({}), { ageYears: null, ageSource: "unknown" });
});

test("age: the ICU adapter reads patient.age and ignores any dob beside it", () => {
  const s = fromIcuState(DEPS, {
    patient: { age: 7, dob: "0000-00-00", weightKg: 22 },
    vitals: [{ ts: NOW - 300000, hr: 120 }]
  }, { asOf: NOW });
  assert.equal(s.demographics.ageYears, 7);
  assert.equal(s.demographics.weightKg, 22);
});

test("age: no Medical Core module performs date-of-birth arithmetic", () => {
  // Comments may DISCUSS dob; code may not compute with it. Strip comments, then look for any use
  // of a dob identifier at all - there is no legitimate one in this layer.
  const dir = join(ROOT, "medcore");
  const offenders = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const code = readFileSync(join(dir, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (/\bdob\b|dateOfBirth|birthDate/i.test(code)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], "dob must not appear in Medical Core code: " + offenders.join(", "));
});
