/* test/medcore-units.test.mjs — HAZ-ML-03. The unit table, and every way a value must be refused.
 *
 * The assertions that matter are the refusals. A conversion that works is easy; a conversion that
 * declines to happen is the control.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createUnits, normaliseKey, REFUSAL } from "../medcore/medcore-units.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TABLE = JSON.parse(readFileSync(join(ROOT, "medcore/data/units.json"), "utf8"));
const U = createUnits(TABLE);

test("units: the table declares a canonical unit and plausible bounds for every parameter", () => {
  assert.equal(TABLE.schema, "medcore-units/1");
  assert.equal(TABLE.approvalStatus, "unapproved", "clinical content ships unapproved until signed");
  for (const p of U.params()) {
    assert.ok(U.canonicalUnit(p), p + " needs a canonical unit");
    const b = U.plausible(p);
    assert.ok(Array.isArray(b) && b.length === 2 && b[0] < b[1], p + " needs ordered plausible bounds");
    assert.ok(Object.keys(TABLE.params[p].units).length > 0, p + " needs at least one accepted unit");
  }
});

test("units: an unlisted unit is refused, never guessed", () => {
  const r = U.normalise({ param: "creat", value: "2.1", unit: "umol/l?" });
  assert.equal(r.ok, false);
  assert.equal(r.refusal, REFUSAL.UNIT_UNKNOWN);
  assert.equal(r.value, null);
  // Rule 4: the raw survives, so the mapping error is recoverable from the record.
  assert.equal(r.sourceValue, "2.1");
  assert.equal(r.sourceUnit, "umol/l?");
});

test("units: a real conversion is exact and lands in the canonical unit", () => {
  const r = U.normalise({ param: "creat", value: 180, unit: "umol/L" });
  assert.equal(r.ok, true);
  assert.equal(r.unit, "mg/dL");
  assert.ok(Math.abs(r.value - 2.0362) < 0.001, "180 umol/L is about 2.04 mg/dL, got " + r.value);
  assert.equal(U.normalise({ param: "temp", value: 98.6, unit: "F" }).value, 37);
  assert.equal(U.normalise({ param: "glucose", value: 5, unit: "mmol/L" }).value, 90.091);
  assert.equal(U.normalise({ param: "pao2", value: 10, unit: "kPa" }).value, 75.0062);
});

test("units: the second net catches a value whose LABEL is in the table but whose magnitude is not", () => {
  // The dangerous case: creatinine measured in umol/L and reported as mg/dL. The label passes the
  // allow-list, so only plausibility stops it.
  const r = U.normalise({ param: "creat", value: 180, unit: "mg/dL" });
  assert.equal(r.ok, false);
  assert.equal(r.refusal, REFUSAL.IMPLAUSIBLE);
  assert.deepEqual(r.plausible, [0.1, 25]);
  assert.equal(r.converted, 180, "the refusal says what it would have been");
  // A detached lead reading a pulse of 4 is refused the same way.
  assert.equal(U.normalise({ param: "hr", value: 4, unit: "bpm" }).refusal, REFUSAL.IMPLAUSIBLE);
});

test("units: an unlabelled value is read only from a source whose convention is written down", () => {
  const trusted = U.normalise({ param: "k", value: 5.2, source: "icu-state" });
  assert.equal(trusted.ok, true);
  assert.equal(trusted.value, 5.2);
  assert.equal(trusted.unitAssumed, true, "an assumption must be visible downstream");

  const adapter = U.normalise({ param: "k", value: 5.2, source: "ghis-adapter" });
  assert.equal(adapter.ok, false);
  assert.equal(adapter.refusal, REFUSAL.UNIT_REQUIRED);

  const nosource = U.normalise({ param: "k", value: 5.2 });
  assert.equal(nosource.refusal, REFUSAL.UNIT_REQUIRED);
});

test("units: a genuinely unitless parameter is not an assumption", () => {
  const r = U.normalise({ param: "gcs", value: 12 });
  assert.equal(r.ok, true);
  assert.equal(r.unitAssumed, false);
  assert.equal(U.normalise({ param: "ph", value: 7.2 }).ok, true);
});

test("units: blank is absence, not zero", () => {
  for (const v of ["", "   ", null, undefined]) {
    const r = U.normalise({ param: "hr", value: v, unit: "bpm" });
    assert.equal(r.refusal, REFUSAL.NOT_A_NUMBER, JSON.stringify(v) + " must not become a number");
    assert.equal(r.value, null);
  }
  assert.equal(U.normalise({ param: "hr", value: "abc", unit: "bpm" }).refusal, REFUSAL.NOT_A_NUMBER);
  assert.equal(U.normalise({ param: "hr", value: NaN, unit: "bpm" }).refusal, REFUSAL.NOT_A_NUMBER);
  // A real zero that is inside the bounds is still a value.
  assert.equal(U.normalise({ param: "uop", value: 0, unit: "mL/h" }).ok, true);
});

test("units: an unknown parameter is refused rather than passed through", () => {
  const r = U.normalise({ param: "procalcitonin", value: 3, unit: "ng/mL" });
  assert.equal(r.refusal, REFUSAL.UNKNOWN_PARAM);
  assert.equal(U.has("procalcitonin"), false);
});

test("units: case, spacing and the micro sign are presentation, not meaning", () => {
  assert.equal(normaliseKey("  mmol/L "), "mmol/l");
  assert.equal(normaliseKey("µmol/L"), "umol/l");
  assert.equal(normaliseKey("μmol/L"), "umol/l");
  assert.equal(normaliseKey("°C"), "degc");
  assert.equal(U.normalise({ param: "creat", value: 180, unit: "µMOL/L" }).ok, true);
});

test("units: mEq/L and mmol/L are the same number for a monovalent ion, and only for one", () => {
  assert.equal(U.normalise({ param: "na", value: 138, unit: "mmol/L" }).value, 138);
  assert.equal(U.normalise({ param: "na", value: 138, unit: "mEq/L" }).value, 138);
  // Bilirubin is not monovalent arithmetic; mmol/L is not an accepted unit for it at all.
  assert.equal(U.normalise({ param: "bili", value: 20, unit: "mmol/L" }).refusal, REFUSAL.UNIT_UNKNOWN);
});

test("units: the module is pure - no table of its own, no I/O", () => {
  const src = readFileSync(join(ROOT, "medcore/medcore-units.js"), "utf8");
  assert.ok(!/readFileSync|fetch\(|require\(|document\.|localStorage|Date\.now|new Date/.test(src),
    "the normaliser must not read a file, the network, the DOM or a clock");
  assert.throws(() => createUnits(null), /unit table is required/);
});
