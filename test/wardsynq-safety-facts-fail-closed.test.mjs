/* An unreadable allergy or medication list must never be checked as an empty one: order entry reports
 * checked:false and the bedside hook REFUSES with SAFETY_CHECK_UNAVAILABLE (functions/_wardsynq/migrate-emar.js).
 * Codex F5 (2 Oct 2026): the hook used to come back allowed with a warning; it continues only with an attributed reason. */
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

  test(`bedside hook: ${type} read failure refuses, and continues only with an attributed reason`, async () => {
    const v = await bedsideSafetyCheck(failing(type), pack)({ order, patient: {} });
    assert.equal(v.allowed, false, JSON.stringify(v));
    assert.ok(v.blocks.some((b) => b.code === "SAFETY_CHECK_UNAVAILABLE" && b.checkNotRun), JSON.stringify(v));
    const noOne = await bedsideSafetyCheck(failing(type), pack, { continuation: { reason: "urgent" } })({ order, patient: {} });
    assert.equal(noOne.allowed, false, "a reason nobody is named for is not a continuation");
    const c = await bedsideSafetyCheck(failing(type), pack, { continuation: { reason: "urgent, doctor at bedside", by: "cfa:rn" } })({ order, patient: {} });
    assert.equal(c.allowed, true);
    assert.ok(c.warnings.some((w) => w.code === "SAFETY_CHECK_UNAVAILABLE"), "still said as not checked");
    assert.deepEqual([c.notRun.code, c.notRun.reason, c.notRun.by], ["SAFETY_CHECK_UNAVAILABLE", "urgent, doctor at bedside", "cfa:rn"]);
  });
}

test("bedside hook: no rule pack refuses, never allowed", async () => {
  const v = await bedsideSafetyCheck(failing("none"), null)({ order, patient: {} });
  assert.equal(v.allowed, false);
  assert.equal(v.blocks[0].code, "NO_RULE_PACK");
});
