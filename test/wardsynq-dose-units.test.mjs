/* test/wardsynq-dose-units.test.mjs - CLIN-01 (audit B1): a dose ceiling must not be skipped because the
 * order is written in a different unit from the limit. Digoxin 2.5 mg against a ceiling in mcg, and
 * paracetamol 1.5 g against one in mg, used to pass with no finding at all. A unit that cannot be
 * converted is a finding the prescriber sees, never a silent pass.
 *
 * node --test test/wardsynq-dose-units.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SafetyEngine } from "../wardsynq/wardsynq-safety.js";
import { loadStewardMDRulePack } from "../wardsynq/adapters/wardsynq-rules-stewardmd.js";
import { MedicationOrder } from "../wardsynq/wardsynq-model.js";

const pack = await loadStewardMDRulePack();
const codes = (drug, value, unit, frequency, clinical) => new SafetyEngine({ rulePack: pack })
  .evaluate({ order: MedicationOrder({ patientId: "p1", drug, dose: { value, unit }, frequency, route: "oral", prescriberId: "dr-1" }), ...clinical })
  .findings.map((f) => f.code).sort();

test("CLIN-01: the same overdose is caught whatever mass unit it is written in", () => {
  assert.deepEqual(codes("Digoxin", 2.5, "mg", "OD"), codes("Digoxin", 2500, "mcg", "OD"));
  assert.deepEqual(codes("Digoxin", 2.5, "mg", "OD"), ["DOSE_ABSOLUTE_CEILING"]);
  assert.deepEqual(codes("Colchicine", 5, "mg", "OD"), ["DOSE_ABSOLUTE_CEILING"]);
  assert.deepEqual(codes("Paracetamol", 1.5, "g", "QID", { weightKg: 60 }), ["DOSE_ABSOLUTE_CEILING", "DOSE_ABSOLUTE_CEILING_DAILY"]);
  assert.deepEqual(codes("Paracetamol", 1.5, "gm", "QID", { weightKg: 60 }), ["DOSE_ABSOLUTE_CEILING", "DOSE_ABSOLUTE_CEILING_DAILY"]);
  assert.deepEqual(codes("Paracetamol", 1, "g", "QID", { weightKg: 10 }), ["DOSE_ABOVE_MG_PER_KG"], "1 g for a 10 kg child is 100 mg/kg");
  assert.deepEqual(codes("Digoxin", 0.0025, "g", "OD"), ["DOSE_ABSOLUTE_CEILING"]);
  assert.deepEqual(codes("Digoxin", 2500000, "ng", "OD"), ["DOSE_ABSOLUTE_CEILING"]);
  assert.deepEqual(codes("Digoxin", 2500, "microgram", "OD"), ["DOSE_ABSOLUTE_CEILING"]);
});

test("CLIN-01: a dose within the ceiling in another unit stays clean", () => {
  assert.deepEqual(codes("Digoxin", 0.25, "mg", "OD"), []);
  assert.deepEqual(codes("Paracetamol", 1, "g", "QID", { weightKg: 70 }), []);
});

test("CLIN-01: a unit that cannot be compared is said, not passed", () => {
  const v = new SafetyEngine({ rulePack: pack }).evaluate({ order: MedicationOrder({ patientId: "p1", drug: "Digoxin", dose: { value: 2, unit: "tab" }, frequency: "OD", route: "oral", prescriberId: "dr-1" }) });
  assert.deepEqual(v.findings.map((f) => f.code), ["DOSE_UNIT_UNCHECKED"]);
  assert.equal(v.findings[0].disposition, "overridable", "the prescriber has to see and answer it");
  assert.deepEqual(codes("Paracetamol", 10, "ml", "QID", { weightKg: 10 }), ["DOSE_UNIT_UNCHECKED"], "a syrup volume cannot be read against mg/kg");
});
