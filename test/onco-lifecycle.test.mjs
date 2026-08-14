/* ONCQIS Phase I: the Standard Protocol status lifecycle (onco-protocol-lifecycle.js) + the ONCQIS
 * capability separation in functions/_queue_roles.js. Pure, deterministic, no I/O. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const L = require(join(HERE, "..", "onco-protocol-lifecycle.js"));
import { CAPS, ROLE_CAPS, ONCQIS_CAPS, can, capsFor } from "../functions/_queue_roles.js";

test("valid forward transitions through the full lifecycle", () => {
  assert.equal(L.validTransition("DRAFT", "R1_REVIEW"), true);
  assert.equal(L.validTransition("R1_REVIEW", "INSTITUTIONAL_APPROVAL"), true);
  assert.equal(L.validTransition("INSTITUTIONAL_APPROVAL", "ACTIVE"), true);
  assert.equal(L.validTransition("ACTIVE", "SUPERSEDED"), true);
  assert.equal(L.validTransition("ACTIVE", "RETIRED"), true);
  assert.equal(L.validTransition("SUPERSEDED", "RETIRED"), true);
});

test("allowed side moves (revise / kick-back)", () => {
  assert.equal(L.validTransition("R1_REVIEW", "DRAFT"), true);
  assert.equal(L.validTransition("INSTITUTIONAL_APPROVAL", "R1_REVIEW"), true);
});

test("invalid transitions are rejected - ACTIVE is immutable, no jumps", () => {
  assert.equal(L.validTransition("ACTIVE", "DRAFT"), false);      // ACTIVE never edits back to DRAFT
  assert.equal(L.validTransition("ACTIVE", "R1_REVIEW"), false);
  assert.equal(L.validTransition("DRAFT", "ACTIVE"), false);      // no skipping review/approval
  assert.equal(L.validTransition("DRAFT", "INSTITUTIONAL_APPROVAL"), false);
  assert.equal(L.validTransition("RETIRED", "ACTIVE"), false);    // terminal
  assert.equal(L.validTransition("SUPERSEDED", "ACTIVE"), false);
  assert.equal(L.validTransition("bogus", "ACTIVE"), false);
});

test("newDraftVersion does NOT mutate the ACTIVE source", () => {
  const active = {
    id: "folfox-6", name: "FOLFOX-6", protocolVersion: "1.0", status: "ACTIVE",
    clinicalApprovalStatus: "approved", supersededBy: null, verifyFields: [],
    regimen: { drugs: [{ id: "oxaliplatin", dosePerUnit: 85 }], cycleLengthDays: 14, cycles: 12 }
  };
  const snapshot = structuredClone(active);
  const draft = L.newDraftVersion(active);
  // Source untouched, byte-for-byte.
  assert.deepEqual(active, snapshot);
  // Draft is a distinct object, not aliasing nested structures.
  assert.notEqual(draft, active);
  assert.notEqual(draft.regimen, active.regimen);
  // Fresh DRAFT with bumped version + reset governance.
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.protocolVersion, "1.1");
  assert.equal(draft.clinicalApprovalStatus, null);
  assert.equal(draft.supersedes, "1.0");
  assert.equal(draft.supersededBy, null);
  // Mutating the draft still does not reach the source.
  draft.regimen.drugs[0].dosePerUnit = 999;
  assert.equal(active.regimen.drugs[0].dosePerUnit, 85);
});

test("bumpVersion is deterministic", () => {
  assert.equal(L.bumpVersion("1.0"), "1.1");
  assert.equal(L.bumpVersion("2.9"), "2.10");
  assert.equal(L.bumpVersion("3"), "3.1");
});

test("canActivate requires clinical approval AND no unresolved VERIFY", () => {
  assert.equal(L.canActivate({ clinicalApprovalStatus: "approved", verifyFields: [] }), true);
  // Blocked without clinical approval.
  assert.equal(L.canActivate({ clinicalApprovalStatus: null, verifyFields: [] }), false);
  assert.equal(L.canActivate({ clinicalApprovalStatus: "pending", verifyFields: [] }), false);
  // Blocked with an unresolved VERIFY even when clinically approved.
  assert.equal(L.canActivate({ clinicalApprovalStatus: "approved", verifyFields: ["regimen.drugs.0.dosePerUnit"] }), false);
  assert.equal(L.canActivate(null), false);
});

test("canActivateImplementation requires HOSPITAL approval (and clinical when base given)", () => {
  const approvedImpl = { hospitalId: "HOSPITAL-A", hospitalApprovalStatus: { approved: true } };
  const unapprovedImpl = { hospitalId: "HOSPITAL-A", hospitalApprovalStatus: { approved: false } };
  assert.equal(L.canActivateImplementation(approvedImpl), true);
  assert.equal(L.canActivateImplementation(unapprovedImpl), false);
  assert.equal(L.canActivateImplementation({ hospitalId: "X" }), false); // no approval object
  // When the base protocol is supplied it must ALSO be clinically approved.
  const okBase = { clinicalApprovalStatus: "approved", verifyFields: [] };
  const badBase = { clinicalApprovalStatus: null, verifyFields: [] };
  assert.equal(L.canActivateImplementation(approvedImpl, okBase), true);
  assert.equal(L.canActivateImplementation(approvedImpl, badBase), false);
});

test("ONCQIS caps exist and roles are separated", () => {
  assert.equal(CAPS.ONCQIS_PROTOCOL_AUTHOR, "oncqis.protocol.author");
  assert.equal(CAPS.ONCQIS_CLINICAL_REVIEWER, "oncqis.clinical.reviewer");
  assert.equal(CAPS.ONCQIS_INSTITUTIONAL_APPROVER, "oncqis.institutional.approver");
  assert.ok(can("oncqis_protocol_author", CAPS.ONCQIS_PROTOCOL_AUTHOR));
  assert.ok(can("oncqis_clinical_reviewer", CAPS.ONCQIS_CLINICAL_REVIEWER));
  assert.ok(can("oncqis_institutional_approver", CAPS.ONCQIS_INSTITUTIONAL_APPROVER));
  // No ONCQIS role holds another ONCQIS cap (strict separation).
  assert.equal(can("oncqis_protocol_author", CAPS.ONCQIS_CLINICAL_REVIEWER), false);
  assert.equal(can("oncqis_clinical_reviewer", CAPS.ONCQIS_INSTITUTIONAL_APPROVER), false);
  assert.equal(can("oncqis_institutional_approver", CAPS.ONCQIS_PROTOCOL_AUTHOR), false);
});

test("Doctor/Nurse consume protocols but never author/approve them", () => {
  assert.ok(can("doctor", CAPS.EMR_TREAT));
  assert.ok(can("nurse", CAPS.EMR_VITALS));
  ONCQIS_CAPS.forEach((cap) => {
    assert.equal(can("doctor", cap), false);
    assert.equal(can("nurse", cap), false);
  });
});

test("System Admin cap set EXCLUDES all clinical/hospital approval caps", () => {
  const adminCaps = capsFor("admin");
  ONCQIS_CAPS.forEach((cap) => assert.equal(adminCaps.indexOf(cap), -1, "admin must not hold " + cap));
  // Admin still keeps its operational/technical caps.
  assert.ok(can("admin", CAPS.STAFF_ADMIN));
});
