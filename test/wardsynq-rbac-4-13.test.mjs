/* test/wardsynq-rbac-4-13.test.mjs — TASK 4.13: the two new narrow grants (HIM_ROI,
 * TRANSFUSION_ISSUE), pure - the same style test/wardsynq-radiology-protocol.test.mjs and
 * test/wardsynq-billing-view.test.mjs already use for grantForRole().
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { grantForRole } from "../functions/_wardsynq/actor.js";

test("him: writes and reads ROIRequest only - no clinical write, no staff.admin reach", () => {
  const g = grantForRole("him");
  assert.ok(g, "him resolves to a real grant");
  assert.equal(g.write.includes("ROIRequest"), true);
  assert.equal(g.write.length, 1, "the ONLY thing him.roi grants write to: " + JSON.stringify(g.write));
  // Read is unrestricted (null) because the `him` role ALSO holds EMR_VIEW - a separate authority
  // the role composes explicitly, not something the HIM_ROI branch itself grants.
  assert.equal(g.read, null);
});

test("blood_bank: reads/writes TransfusionEpisode, plus enough read to identify the patient, nothing more", () => {
  const g = grantForRole("blood_bank");
  assert.ok(g, "blood_bank resolves to a real grant");
  assert.deepEqual(g.write.slice().sort(), ["TransfusionEpisode"]);
  assert.equal(g.read.includes("TransfusionEpisode"), true);
  assert.equal(g.read.includes("Patient"), true);
  assert.equal(g.read.includes("Encounter"), true);
  assert.equal(g.read.includes("ClinicalNote"), false, "blood_bank never reaches the chart's notes");
});

test("hr's grant is untouched by TASK 4.13 - still no clinical actor at all", () => {
  assert.equal(grantForRole("hr"), null);
});

test("billing composes from existing caps alone: reads Claim/PreAuthorisation/Invoice, writes nothing", () => {
  const g = grantForRole("billing");
  assert.ok(g);
  assert.deepEqual(g.write, []);
  assert.equal(g.read.includes("Claim"), true);
  assert.equal(g.read.includes("Invoice"), true);
});

test("EMR_TREAT still reaches TransfusionEpisode unrestricted - TRANSFUSION_ISSUE is an addition, never a narrowing", () => {
  const doctor = grantForRole("doctor");
  assert.equal(doctor.write, null, "doctor's write scope is still unrestricted");
});
