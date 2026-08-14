/* ONCQIS Phase J-b: Knowledge Center REVIEW/APPROVAL side (onco-protocol-review.js, J7-J14).
 * PURE + deterministic. Proves the HARD SAFETY RULES:
 *   - a Proposed Protocol Version never mutates the ACTIVE source (deepEqual before/after)
 *   - accept/reject/edit/verify each append exactly one audit entry (and never mutate the input draft)
 *   - activation requires BOTH approvals + supersedes vN; AI can never activate
 *   - an existing plan on vN is unchanged after vN+1 activates (gets UPDATE AVAILABLE only)
 *   - the audit trail is append-only + immutable
 */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const R = require(join(HERE, "..", "onco-protocol-review.js"));

// ---- fixtures ---------------------------------------------------------------------------------
function activeFixture() {
  return {
    id: "folfox-6", name: "FOLFOX-6", disease: "colorectal cancer", diseaseId: "colorectal-cancer",
    protocolVersion: "1.0", status: "ACTIVE", clinicalApprovalStatus: "approved", verifyFields: [],
    supersededBy: null, supersedes: null,
    regimen: { drugs: [{ id: "oxaliplatin", name: "oxaliplatin", dosePerUnit: 85, unit: "mg/m2" }], cycleLengthDays: 14, cycles: 12 },
    evidence: { core: [{ layer: "core", source: "DeVita 12e" }] },
    review: { lastReviewedAt: "2026-01-10", nextReviewAt: "2026-06-10", reviewDue: false }
  };
}
function reportFixture() {
  return {
    kind: "onco-update-impact-report", guideline: { title: "NCCN Colon v3.2026", org: "NCCN", version: "3.2026" },
    protocols: [{
      protocolId: "folfox-6", name: "FOLFOX-6", status: "EVIDENCE DIVERGENCE",
      relevantChanges: [
        { category: "dose_change", drug: "oxaliplatin", from: "85 mg/m2", to: "100 mg/m2", sourceLocation: "p.42, Table 3" },
        { category: "new_treatment_option", drug: "bevacizumab", to: "add 5 mg/kg", sourceLocation: "VERIFY" }
      ]
    }]
  };
}

// ================================================================================================
test("J8: proposedVersion is a NEW DRAFT and NEVER mutates the ACTIVE source", () => {
  const active = activeFixture();
  const snapshot = structuredClone(active);
  const draft = R.proposedVersion(active, reportFixture(), null, { actor: { id: "author1", role: "oncqis_protocol_author" } });
  // ACTIVE untouched, byte-for-byte.
  assert.deepEqual(active, snapshot);
  // Fresh DRAFT, bumped version, distinct nested objects.
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.protocolVersion, "1.1");
  assert.equal(draft.supersedes, "1.0");
  assert.notEqual(draft.regimen, active.regimen);
  // Change Records carry type/old/proposed/sourceLocation.
  assert.equal(draft.changeRecords.length, 2);
  assert.equal(draft.changeRecords[0].type, "dose_change");
  assert.equal(draft.changeRecords[0].old, "85 mg/m2");
  assert.equal(draft.changeRecords[0].proposed, "100 mg/m2");
  assert.equal(draft.changeRecords[0].sourceLocation, "p.42, Table 3");
  // AI fills nothing it cannot source: an unsourced change (sourceLocation VERIFY) is BLOCKING even
  // when the model emitted target text - verify:true keeps it out of an activatable draft.
  assert.equal(draft.changeRecords[1].sourceLocation, "VERIFY");
  assert.equal(draft.changeRecords[1].verify, true);
  assert.ok(draft.verifyFields.length >= 1);
  // Mutating the draft still cannot reach the source.
  draft.regimen.drugs[0].dosePerUnit = 999;
  assert.equal(active.regimen.drugs[0].dosePerUnit, 85);
});

test("J7/J9: accept/reject/edit/verify each append exactly one audit entry (input draft unchanged)", () => {
  const active = activeFixture();
  let draft = R.proposedVersion(active, reportFixture(), null, { actor: { id: "a" } });
  R.DECISIONS.forEach((d) => assert.ok(["accept", "reject", "edit", "verify"].indexOf(d) > -1));

  const startLen = draft.audit.length;
  const before = structuredClone(draft);

  const acc = R.decideChange(draft, "chg_0", "accept", { email: "rev@x", role: "oncqis_clinical_reviewer" });
  assert.equal(acc.draft.audit.length, startLen + 1, "accept appends one audit entry");
  assert.equal(acc.draft.audit[acc.draft.audit.length - 1].action, "review_accept");
  assert.equal(acc.draft.changeRecords[0].reviewState, "accepted");
  assert.equal(acc.draft.changeRecords[0].resolved, "100 mg/m2");
  // The ORIGINAL draft is untouched by the decision.
  assert.deepEqual(draft, before);

  const rej = R.decideChange(draft, "chg_0", "reject", { email: "rev@x" });
  assert.equal(rej.draft.audit.length, startLen + 1);
  assert.equal(rej.draft.changeRecords[0].reviewState, "rejected");
  assert.equal(rej.draft.changeRecords[0].resolved, rej.draft.changeRecords[0].old);

  const edt = R.decideChange(draft, "chg_1", "edit", { email: "rev@x" }, { value: "5 mg/kg (verified p.9)" });
  assert.equal(edt.draft.audit[edt.draft.audit.length - 1].action, "review_edit");
  assert.equal(edt.draft.changeRecords[1].resolved, "5 mg/kg (verified p.9)");
  assert.equal(edt.draft.changeRecords[1].verify, false);

  const ver = R.decideChange(draft, "chg_0", "verify", { email: "rev@x" });
  assert.equal(ver.draft.audit[ver.draft.audit.length - 1].action, "review_verify");
  assert.equal(ver.draft.changeRecords[0].verify, true);
});

test("J9: clinical approval is blocked while a VERIFY is unresolved, then transitions to INSTITUTIONAL_APPROVAL", () => {
  const active = activeFixture();
  let draft = R.proposedVersion(active, reportFixture(), null, { actor: { id: "a" } });
  draft = R.submitForReview(draft, { email: "author@x" });
  assert.equal(draft.status, "R1_REVIEW");
  // chg_1 is an unsourced VERIFY -> approval must be blocked.
  assert.throws(() => R.clinicalApprove(draft, { email: "rev@x" }), /unresolved_verify/);
  // Resolve every change.
  draft = R.decideChange(draft, "chg_0", "accept", { email: "rev@x" }).draft;
  draft = R.decideChange(draft, "chg_1", "edit", { email: "rev@x" }, { value: "5 mg/kg" }).draft;
  assert.equal(R.unresolvedVerify(draft).length, 0);
  const approved = R.clinicalApprove(draft, { email: "rev@x", role: "oncqis_clinical_reviewer" });
  assert.equal(approved.status, "INSTITUTIONAL_APPROVAL");
  assert.equal(approved.clinicalApprovalStatus, "approved");
  assert.equal(R.canActivateVersion(approved), false, "clinical approval alone is NOT enough");
});

test("J10/J11: activation requires BOTH approvals, supersedes vN, and AI can never activate", () => {
  const active = activeFixture();
  let draft = R.proposedVersion(active, reportFixture(), null, { actor: { id: "a" } });
  draft = R.submitForReview(draft, { email: "author@x" });
  draft = R.decideChange(draft, "chg_0", "accept", { email: "rev@x" }).draft;
  draft = R.decideChange(draft, "chg_1", "reject", { email: "rev@x" }).draft;
  const clin = R.clinicalApprove(draft, { email: "rev@x" });

  // Only clinical approval so far -> cannot activate.
  assert.equal(R.canActivateVersion(clin), false);
  assert.throws(() => R.activate(clin, active, { email: "inst@x", role: "oncqis_institutional_approver" }), /not_eligible/);

  const inst = R.institutionalApprove(clin, { email: "inst@x", role: "oncqis_institutional_approver" });
  assert.equal(inst.institutionalApprovalStatus, "approved");
  assert.equal(R.canActivateVersion(inst), true, "both approvals + no VERIFY => eligible");

  // AI can NEVER activate.
  assert.throws(() => R.activate(inst, active, { id: "maik", role: "ai" }), /ai_cannot_activate/);

  const res = R.activate(inst, active, { email: "inst@x", role: "oncqis_institutional_approver" });
  assert.equal(res.activated.status, "ACTIVE");
  assert.equal(res.activated.protocolVersion, "1.1");
  assert.equal(res.superseded.status, "SUPERSEDED");
  assert.equal(res.superseded.supersededBy, "1.1");
  assert.equal(res.activated.audit[res.activated.audit.length - 1].action, "activated");
});

test("J10: separation of duties - the clinical reviewer cannot also give institutional approval", () => {
  const active = activeFixture();
  let draft = R.proposedVersion(active, reportFixture(), null, { actor: { id: "a" } });
  draft = R.submitForReview(draft, { email: "author@x" });
  draft = R.decideChange(draft, "chg_0", "accept", { email: "rev@x" }).draft;
  draft = R.decideChange(draft, "chg_1", "reject", { email: "rev@x" }).draft;
  const clin = R.clinicalApprove(draft, { email: "rev@x" });
  assert.throws(() => R.institutionalApprove(clin, { email: "rev@x" }), /same_actor_both_gates/);
  // A DIFFERENT approver is fine.
  assert.equal(R.institutionalApprove(clin, { email: "inst@x" }).institutionalApprovalStatus, "approved");
});

test("J12: an existing plan on vN is NOT auto-modified when vN+1 activates (UPDATE AVAILABLE only)", () => {
  const active = activeFixture();
  const plan = {
    planId: "p1", sourceProtocolId: "folfox-6", lockedVersion: "1.0",
    lockedTemplate: { name: "FOLFOX-6", protocolVersion: "1.0", regimen: { drugs: [{ name: "oxaliplatin" }] } }
  };
  const planSnapshot = structuredClone(plan);

  // Activate v1.1.
  let draft = R.proposedVersion(active, reportFixture(), null, { actor: { id: "a" } });
  draft = R.submitForReview(draft, { email: "author@x" });
  draft = R.decideChange(draft, "chg_0", "accept", { email: "rev@x" }).draft;
  draft = R.decideChange(draft, "chg_1", "reject", { email: "rev@x" }).draft;
  draft = R.clinicalApprove(draft, { email: "rev@x" });
  draft = R.institutionalApprove(draft, { email: "inst@x" });
  const newActive = R.activate(draft, active, { email: "inst@x", role: "oncqis_institutional_approver" }).activated;

  // The plan is byte-for-byte unchanged.
  assert.deepEqual(plan, planSnapshot);
  // It only surfaces UPDATE AVAILABLE.
  assert.equal(R.planNeedsUpdate(plan, newActive), true);
  const html = R.renderPlanUpdateAvailable(plan, newActive);
  assert.match(html, /UPDATE AVAILABLE/);
  // A plan already on the new version needs nothing.
  const current = Object.assign({}, plan, { lockedVersion: "1.1" });
  assert.equal(R.planNeedsUpdate(current, newActive), false);
});

test("J14: the audit trail is append-only and immutable", () => {
  const ev1 = R.auditEvent("draft_created", { email: "a@x" }, { object: "folfox-6", version: "1.1", before: "1.0", after: "1.1" });
  const log0 = [];
  const log1 = R.appendAudit(log0, ev1);
  assert.equal(log0.length, 0, "input log never mutated");
  assert.equal(log1.length, 1);
  // Events are frozen: before/after cannot be silently rewritten.
  assert.throws(() => { "use strict"; ev1.after = "hacked"; }, TypeError);
  assert.equal(ev1.after, "1.1");
  const ev2 = R.auditEvent("activated", { email: "b@x" }, { object: "folfox-6", version: "1.1" });
  const log2 = R.appendAudit(log1, ev2);
  assert.equal(log2.length, 2);
  assert.equal(log1.length, 1, "appending again never mutated the earlier log");
});

test("J13: review-due surfaces protocols by nextReviewAt/reviewDue (REVIEW DUE != invalid)", () => {
  const overdue = activeFixture(); overdue.id = "p-old"; overdue.review = { lastReviewedAt: "2024-01-01", nextReviewAt: "2025-01-01" };
  const fresh = activeFixture(); fresh.id = "p-fresh"; fresh.review = { lastReviewedAt: "2026-06-01", nextReviewAt: "2027-06-01" };
  const rows = R.reviewRows([fresh, overdue], Date.parse("2026-08-14"));
  const byId = {}; rows.forEach((r) => (byId[r.id] = r));
  assert.equal(byId["p-old"].reviewDue, true);
  assert.equal(byId["p-fresh"].reviewDue, false);
  // Due protocols sort first.
  assert.equal(rows[0].id, "p-old");
  // Still ACTIVE (due != invalid).
  assert.equal(byId["p-old"].status, "ACTIVE");
});
