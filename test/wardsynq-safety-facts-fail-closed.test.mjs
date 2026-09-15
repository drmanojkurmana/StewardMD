/* An unreadable allergy or medication list must never be checked as an empty one: order entry reports
 * checked:false and the bedside hook carries SAFETY_CHECK_UNAVAILABLE (functions/_wardsynq/migrate-emar.js). */
import test from "node:test";
import assert from "node:assert/strict";
import { orderEntrySafety, bedsideSafetyCheck } from "../functions/_wardsynq/migrate-emar.js";
import { emptyRulePack } from "../wardsynq/wardsynq-safety.js";

// A real (empty) pack, so the engine itself runs: only the failed read can make the check unavailable.
const pack = emptyRulePack();

const failing = (type) => ({
  byPatient: async (t) => { if (t === type) throw new Error("storage read failed"); return []; },
});
const order = { id: "o1", patientId: "p1", drug: "Amoxicillin", genericName: "amoxicillin" };

for (const type of ["AllergyIntolerance", "MedicationOrder"]) {
  test(`order entry: ${type} read failure gives checked:false, never a clean check`, async () => {
    const v = await orderEntrySafety(failing(type), pack, order, []);
    assert.equal(v.checked, false);
    assert.equal(v.code, "SAFETY_CHECK_UNAVAILABLE");
  });

  test(`bedside hook: ${type} read failure says the check was unavailable`, async () => {
    const v = await bedsideSafetyCheck(failing(type), pack)({ order, patient: {} });
    assert.ok(v.warnings.some((w) => w.code === "SAFETY_CHECK_UNAVAILABLE"), JSON.stringify(v));
  });
}
