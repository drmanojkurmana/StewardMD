import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chainState, mayDecide, requestRecord, decisionRecord, approvalCovers, verificationIdFor,
} from "../functions/_wardsynq/verification.js";

const REQ = requestRecord({
  id: "v1", subjectType: "RestrictedMedication", subjectId: "meropenem",
  by: "dr.a", reason: "resistant organism", at: "2026-09-12T10:00:00Z",
});
const dec = (id, by, decision, at, extra = {}) => decisionRecord({
  id, requestId: "v1", subjectType: "RestrictedMedication", subjectId: "meropenem",
  by, decision, at, ...extra,
});

test("a request on its own is pending, never approved", () => {
  const s = chainState([REQ], 1);
  assert.equal(s.state, "pending");
  assert.equal(s.approvals, 0);
  assert.equal(s.requestedBy, "dr.a");
});

test("one approval satisfies a one-level hospital", () => {
  const s = chainState([REQ, dec("v2", "micro.b", "approved", "2026-09-12T10:05:00Z")], 1);
  assert.equal(s.state, "approved");
  assert.deepEqual(s.approvers, ["micro.b"]);
});

test("one approval does not satisfy a two-level hospital", () => {
  const s = chainState([REQ, dec("v2", "micro.b", "approved", "2026-09-12T10:05:00Z")], 2);
  assert.equal(s.state, "pending");
  assert.equal(s.required, 2);
});

test("two approvals from the SAME person are one person agreeing with themselves", () => {
  const s = chainState([
    REQ,
    dec("v2", "micro.b", "approved", "2026-09-12T10:05:00Z"),
    dec("v3", "micro.b", "approved", "2026-09-12T10:06:00Z"),
  ], 2);
  assert.equal(s.state, "pending");
  assert.equal(s.approvals, 1);
});

test("a rejection stands, and a later approval cannot paper over it", () => {
  const s = chainState([
    REQ,
    dec("v2", "micro.b", "rejected", "2026-09-12T10:05:00Z", { reason: "narrow spectrum will do" }),
  ], 1);
  assert.equal(s.state, "rejected");
  assert.equal(s.rejectedBy, "micro.b");
  assert.equal(mayDecide(s, "micro.c", "approved").ok, false);
  assert.equal(mayDecide(s, "micro.c", "approved").reason, "already_rejected");
});

test("a withdrawal cancels the approval it names, and the approval stays on the record", () => {
  const rows = [
    REQ,
    dec("v2", "micro.b", "approved", "2026-09-12T10:05:00Z"),
    dec("v3", "micro.b", "withdrawn", "2026-09-12T11:00:00Z", { withdraws: "v2" }),
  ];
  const s = chainState(rows, 1);
  assert.equal(s.state, "pending");
  assert.equal(s.approvals, 0);
  assert.equal(s.withdrawn, true);
  // Nothing was deleted. The approval that happened is still there to read.
  assert.ok(rows.some((r) => r.id === "v2" && r.decision === "approved"));
});

test("withdrawing one of two approvals leaves the other standing", () => {
  const s = chainState([
    REQ,
    dec("v2", "micro.b", "approved", "2026-09-12T10:05:00Z"),
    dec("v3", "micro.c", "approved", "2026-09-12T10:06:00Z"),
    dec("v4", "micro.b", "withdrawn", "2026-09-12T11:00:00Z", { withdraws: "v2" }),
  ], 1);
  assert.equal(s.state, "approved");
  assert.deepEqual(s.approvers, ["micro.c"]);
});

test("the person who asked cannot be the person who approves", () => {
  const s = chainState([REQ], 1);
  const r = mayDecide(s, "dr.a", "approved");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "cannot_approve_own_request");
});

test("the person who asked may still reject or withdraw their own request", () => {
  const s = chainState([REQ], 1);
  assert.equal(mayDecide(s, "dr.a", "withdrawn").ok, true);
});

test("approving twice is refused", () => {
  const s = chainState([REQ, dec("v2", "micro.b", "approved", "2026-09-12T10:05:00Z")], 2);
  assert.equal(mayDecide(s, "micro.b", "approved").reason, "already_approved_by_you");
});

test("an approval for one drug does not cover a different drug", () => {
  const s = chainState([REQ, dec("v2", "micro.b", "approved", "2026-09-12T10:05:00Z")], 1);
  assert.equal(approvalCovers(s, "RestrictedMedication", "meropenem"), true);
  assert.equal(approvalCovers(s, "RestrictedMedication", "vancomycin"), false);
  assert.equal(approvalCovers(s, "PurchaseOrder", "meropenem"), false);
});

test("a pending or rejected chain covers nothing", () => {
  assert.equal(approvalCovers(chainState([REQ], 1), "RestrictedMedication", "meropenem"), false);
  const rej = chainState([REQ, dec("v2", "b", "rejected", "2026-09-12T10:05:00Z")], 1);
  assert.equal(approvalCovers(rej, "RestrictedMedication", "meropenem"), false);
});

test("a chain with no request at all is 'none', not 'approved'", () => {
  const s = chainState([dec("v2", "micro.b", "approved", "2026-09-12T10:05:00Z")], 1);
  assert.equal(s.state, "none");
  assert.equal(mayDecide(s, "x", "approved").reason, "no_such_request");
});

test("records are read oldest-first regardless of the order they arrive in", () => {
  const s = chainState([
    dec("v3", "micro.b", "withdrawn", "2026-09-12T11:00:00Z", { withdraws: "v2" }),
    dec("v2", "micro.b", "approved", "2026-09-12T10:05:00Z"),
    REQ,
  ], 1);
  assert.equal(s.state, "pending");
});

test("an unknown decision is refused rather than ignored", () => {
  const s = chainState([REQ], 1);
  assert.equal(mayDecide(s, "x", "maybe").reason, "unknown_decision");
});

test("ids are stable and readable, and refuse to be built from nothing", () => {
  assert.equal(
    verificationIdFor("RestrictedMedication", "Meropenem", "2026-09-12T10:00:00Z"),
    "wsq-verif-restrictedmedication-meropenem-20260912T100000Z",
  );
  assert.equal(verificationIdFor("", "x", "y"), null);
});

test("a hospital that asks for no levels still needs one approver", () => {
  const s = chainState([REQ, dec("v2", "micro.b", "approved", "2026-09-12T10:05:00Z")], 0);
  assert.equal(s.required, 1);
  assert.equal(s.state, "approved");
});
