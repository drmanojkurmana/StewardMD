/* functions/_wardsynq/verification.js — who approved what, and in what order, kept forever.
 *
 * THE SHAPE, FROM DANPHE. Of everything read across OpenMRS, Bahmni and Danphe in this audit, this
 * is the one design worth taking wholesale: an approval is never a flag on the thing being
 * approved. It is its own record, pointing at the one before it, so the chain of who decided what,
 * at which level, in which order, is always reconstructable. A boolean `approved` field cannot
 * answer "who approved it, when, and was it later withdrawn", and by the time anybody asks, the
 * answer is gone. This is the same discipline stock.js already keeps for counts - the state is
 * derived from the events, never stored beside them.
 *
 * THE HOLE IT WAS BUILT TO CLOSE. formulary.js blocks a restricted drug until it is handed an
 * approval reference, which is exactly right, and then accepted ANY non-empty string as that
 * reference - `approvalRef` came off the request body and was never checked against anything. A
 * prescriber blocked by antimicrobial stewardship at 2am could type a single character and be
 * through. The block read as a real control and was a formality. Now the reference has to name an
 * approval that actually exists, is for this drug, is approved, and has not been withdrawn.
 *
 * LEVELS. A hospital decides how many approvals a thing needs, the same way it already decides who
 * may write a note - org config, not a table in here. One level is the common case (the
 * microbiologist says yes). Two is for the things that should need two people. A chain is approved
 * only when it holds at least that many distinct approvers, and nothing can approve its own
 * request: the person who asked is not one of the people who may say yes.
 *
 * NOTHING IS EVER OVERWRITTEN. A withdrawal is a new record saying "withdrawn", appended after the
 * approval it withdraws. The approval stays on the record, because it happened, and because a
 * hospital investigating a death needs to see that it was given before it was taken back.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");
const lower = (v) => str(v).toLowerCase();

const DECISIONS = Object.freeze(["approved", "rejected", "withdrawn"]);
const SUBJECT_TYPES = Object.freeze([
  "RestrictedMedication", "PurchaseOrder", "StockRequisition", "Discharge", "Invoice", "Incident",
]);

/** A stable id for a request, so the same ask twice does not open two chains. */
function verificationIdFor(subjectType, subjectId, at) {
  const t = lower(subjectType).replace(/[^a-z0-9]+/g, "-");
  const s = lower(subjectId).replace(/[^a-z0-9]+/g, "-");
  const m = str(at).replace(/[^0-9a-zA-Z]+/g, "");
  return t && s && m ? `wsq-verif-${t}-${s}-${m}` : null;
}

/**
 * Reads a chain of verification records and says where it stands. The ONLY place the meaning of a
 * chain is decided; nothing stores "approved" anywhere.
 *
 * @param {Array} records  every Verification for one subject, any order.
 * @param {number} requiredLevels  how many distinct approvers this hospital wants.
 */
function chainState(records, requiredLevels) {
  const need = Number.isFinite(requiredLevels) && requiredLevels > 0 ? Math.floor(requiredLevels) : 1;
  const rows = (Array.isArray(records) ? records : [])
    .filter((r) => r && str(r.id))
    // Oldest first. Order is what makes a withdrawal mean anything.
    .sort((a, b) => str(a.at).localeCompare(str(b.at)) || str(a.id).localeCompare(str(b.id)));

  const request = rows.find((r) => lower(r.kind) === "request") || null;
  if (!request) return { state: "none", approvals: 0, required: need, approvers: [], withdrawn: false };

  /* A withdrawal cancels the approval it names, not the whole chain: two approvers, one of whom
   * later withdraws, leaves one standing approval, which is the honest count. */
  const withdrawn = new Set();
  for (const r of rows) {
    if (lower(r.decision) === "withdrawn" && str(r.withdraws)) withdrawn.add(str(r.withdraws));
  }

  const rejected = rows.find((r) => lower(r.decision) === "rejected" && !withdrawn.has(str(r.id)));
  const approvals = rows.filter((r) => lower(r.decision) === "approved" && !withdrawn.has(str(r.id)));

  // Distinct people. Two approvals from one person are one person agreeing with themselves.
  const approvers = [...new Set(approvals.map((r) => str(r.by)).filter(Boolean))];

  let state;
  if (rejected) state = "rejected";
  else if (approvers.length >= need) state = "approved";
  else state = "pending";

  return {
    state, approvals: approvers.length, required: need, approvers,
    withdrawn: withdrawn.size > 0,
    requestedBy: str(request.by) || null,
    subjectType: str(request.subjectType) || null,
    subjectId: str(request.subjectId) || null,
    reason: str(request.reason) || null,
    ...(rejected ? { rejectedBy: str(rejected.by), rejectedReason: str(rejected.reason) || null } : {}),
  };
}

/**
 * Whether a decision may be appended to this chain, and why not when it may not.
 * Pure - it decides nothing about permissions, which stay with the record engine and the route.
 */
function mayDecide(state, actorId, decision) {
  const who = str(actorId);
  if (!who) return { ok: false, reason: "no_actor" };
  if (DECISIONS.indexOf(lower(decision)) < 0) return { ok: false, reason: "unknown_decision" };
  if (!state || state.state === "none") return { ok: false, reason: "no_such_request" };

  /* ASKING IS NOT APPROVING. The single rule that makes the whole thing worth having: the person
   * who needs the approval cannot supply it. Without this, the chain is an audit trail of people
   * approving themselves, which is what the free-text reference already was. */
  if (lower(decision) === "approved" && state.requestedBy && str(state.requestedBy) === who) {
    return { ok: false, reason: "cannot_approve_own_request" };
  }
  if (lower(decision) === "approved" && state.approvers.indexOf(who) >= 0) {
    return { ok: false, reason: "already_approved_by_you" };
  }
  if (state.state === "rejected" && lower(decision) === "approved") {
    return { ok: false, reason: "already_rejected" };
  }
  return { ok: true };
}

/** The record a request appends. Shape only - the caller writes it through RecordService. */
function requestRecord({ id, subjectType, subjectId, by, reason, at, context }) {
  return {
    resourceType: "Verification", id, kind: "request",
    subjectType: str(subjectType), subjectId: str(subjectId),
    by: str(by), reason: str(reason) || null, at: str(at),
    ...(context && typeof context === "object" ? { context } : {}),
  };
}

/** The record a decision appends. Points at the request; never replaces it. */
function decisionRecord({ id, requestId, subjectType, subjectId, by, decision, reason, at, withdraws }) {
  return {
    resourceType: "Verification", id, kind: "decision",
    parentVerificationId: str(requestId),
    subjectType: str(subjectType), subjectId: str(subjectId),
    by: str(by), decision: lower(decision), reason: str(reason) || null, at: str(at),
    ...(str(withdraws) ? { withdraws: str(withdraws) } : {}),
  };
}

/**
 * Does this approval reference actually approve this thing?
 *
 * This is what formulary.js now asks before it lets a restricted drug through, and the answer is
 * deliberately narrow: the reference must name a chain that is approved, AND that chain must be
 * about this very drug. A valid approval for vancomycin is not an approval for meropenem, and
 * before this check existed it would not have mattered what the string said at all.
 */
function approvalCovers(state, subjectType, subjectId) {
  if (!state || state.state !== "approved") return false;
  if (lower(state.subjectType) !== lower(subjectType)) return false;
  return lower(state.subjectId) === lower(subjectId);
}

/* ---------------------------------------------------------------------------------------------
 * The routes. Everything above is pure and decides nothing about who may do what; everything below
 * goes through the same door every other WardSynQ write goes through, so an approval is governed,
 * versioned and audited exactly like a clinical record.
 * ------------------------------------------------------------------------------------------- */

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/** Every record belonging to one chain: the request, plus every decision pointing back at it. */
async function chainRows(svc, requestId) {
  const all = await svc.list("Verification", 500);
  return (all || []).filter((r) => r && (str(r.id) === requestId || str(r.parentVerificationId) === requestId));
}

/** How many distinct approvers this hospital wants. Org config, the same way note writers are. */
function levelsFor(ctx, subjectType, amountPaise) {
  const cfg = ctx && ctx.wsqCfg && ctx.wsqCfg.approvalLevels;
  const n = cfg && typeof cfg === "object" ? cfg[str(subjectType)] : null;
  /* ponytail: no amount thresholds yet. The only amount available here would be the one the requester
   * typed, which they could leave out to need fewer approvers; thresholds wait for server-held values
   * (a purchase order total, an invoice balance) on the subject itself. */
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}
/** The hospital's approval policy for a subject type: { approverRoles?, expiresHours? }. */
function policyFor(ctx, subjectType) {
  const all = ctx && ctx.wsqCfg && ctx.wsqCfg.approvalPolicy;
  const p = all && typeof all === "object" ? all[str(subjectType)] : null;
  return p && typeof p === "object" ? p : {};
}
const amountOf = (row) => { const a = row && row.context && Number(row.context.amountPaise); return Number.isFinite(a) ? a : undefined; };

/** Asks for an approval. Creates the chain; approves nothing. */
async function requestVerification(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const subjectType = str(ctx.subjectType), subjectId = str(ctx.subjectId);
  if (!subjectType || !subjectId) return { ...base, ok: false, status: 422, error: "subject_required", written: 0 };
  if (SUBJECT_TYPES.indexOf(subjectType) < 0) {
    // Refused rather than accepted loosely: an approval for a subject nothing ever checks is a
    // record that looks like a control and is not one.
    return { ...base, ok: false, status: 422, error: "unknown_subject_type", detail: "Approvals are kept for: " + SUBJECT_TYPES.join(", ") + ".", written: 0 };
  }
  const reason = str(ctx.reason);
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "Say why this is needed. An approval nobody can see the reason for cannot be judged later.", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = verificationIdFor(subjectType, subjectId, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  try {
    const rec = requestRecord({ id, subjectType, subjectId, by: resolved.actor.id, reason, at, context: ctx.context });
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, verificationId: id, subjectType, subjectId,
      state: "pending", required: levelsFor(ctx, subjectType, amountOf({ context: ctx.context })), version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** Approves, rejects or withdraws. Appends - never edits what is already there. */
async function recordVerification(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const requestId = str(ctx.verificationId);
  const decision = lower(ctx.decision);
  if (!requestId) return { ...base, ok: false, status: 422, error: "verification_required", written: 0 };
  if (DECISIONS.indexOf(decision) < 0) return { ...base, ok: false, status: 422, error: "unknown_decision", detail: "A decision is one of: " + DECISIONS.join(", ") + ".", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let rows;
  try { rows = await chainRows(svc, requestId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  const reqRow = rows.find((r) => lower(r.kind) === "request") || rows[0] || null;
  const subjectTypeOf = reqRow ? reqRow.subjectType : "";
  const before = chainState(rows, levelsFor(ctx, subjectTypeOf, amountOf(reqRow)));
  const policy = policyFor(ctx, subjectTypeOf);
  /* ROLE-BASED APPROVERS (P1.3): when the hospital names the roles that may approve this kind of thing,
   * anyone else may reject or withdraw their own decision, but not approve. */
  if (decision === "approved" && Array.isArray(policy.approverRoles) && policy.approverRoles.length && policy.approverRoles.indexOf(resolved.role) < 0) {
    return { ...base, ok: false, status: 403, error: "not_an_approver_role", detail: "Your role cannot approve this. It needs: " + policy.approverRoles.join(", ") + ".", written: 0 };
  }
  /* EXPIRY (P1.3): a request still pending past the hospital's time limit cannot be approved; it is
   * resubmitted as a fresh request, so a months-old reason is never quietly rubber-stamped. */
  if (decision === "approved" && Number.isFinite(policy.expiresHours) && reqRow && before.state === "pending"
      && Date.parse(reqRow.at) + policy.expiresHours * 3600e3 < Date.parse(str(ctx.at) || new Date().toISOString())) {
    return { ...base, ok: false, status: 409, error: "request_expired", detail: `This request is older than ${policy.expiresHours} hours. Ask again with a fresh request.`, written: 0 };
  }
  const allowed = mayDecide(before, resolved.actor.id, decision);
  if (!allowed.ok) {
    /* Each of these is a different thing to do about it, so each says so plainly rather than all
     * arriving as one flat refusal. */
    const detail = {
      no_such_request: "There is no approval request with that reference.",
      cannot_approve_own_request: "You asked for this approval, so you cannot also be the one who grants it.",
      already_approved_by_you: "You have already approved this. It needs somebody else.",
      already_rejected: "This was already turned down. A fresh request is the way, not another approval.",
      unknown_decision: "That is not a decision this keeps.",
      no_actor: "Could not tell who you are.",
    }[allowed.reason] || "That decision cannot be recorded.";
    return { ...base, ok: false, status: allowed.reason === "no_such_request" ? 404 : 409, error: allowed.reason, detail, written: 0 };
  }

  const at = str(ctx.at) || new Date().toISOString();
  const id = requestId + "-d-" + str(at).replace(/[^0-9a-zA-Z]+/g, "");
  const withdraws = str(ctx.withdraws);
  if (decision === "withdrawn" && !withdraws) {
    return { ...base, ok: false, status: 422, error: "withdraws_required", detail: "Say which approval is being taken back.", written: 0 };
  }

  try {
    const rec = decisionRecord({ id, requestId, subjectType: before.subjectType, subjectId: before.subjectId,
      by: resolved.actor.id, decision, reason: ctx.reason, at, withdraws });
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    const after = chainState([...rows, rec], levelsFor(ctx, before.subjectType, amountOf(reqRow)));
    return { ...base, ok: true, written: 1, verificationId: requestId, decisionId: id,
      state: after.state, approvals: after.approvals, required: after.required, approvers: after.approvers,
      version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e), written: 0 };
  }
}

/** The chains, and where each one stands. Reading only. */
async function listVerifications(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", verifications: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, verifications: [] };

  let all;
  try { all = await svc.list("Verification", 500); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), verifications: [] }; }

  const byRequest = new Map();
  for (const r of all || []) {
    if (!r) continue;
    const key = str(r.parentVerificationId) || str(r.id);
    if (!key) continue;
    if (!byRequest.has(key)) byRequest.set(key, []);
    byRequest.get(key).push(r);
  }

  const wantSubject = str(ctx.subjectId);
  const verifications = [...byRequest.entries()]
    .map(([id, rows]) => ({ verificationId: id, ...chainState(rows, levelsFor(ctx, rows[0] && rows[0].subjectType, amountOf(rows.find((r) => lower(r.kind) === "request")))),
      history: rows.slice().sort((a, b) => str(a.at).localeCompare(str(b.at)))
        .map((r) => ({ id: str(r.id), kind: str(r.kind), decision: lower(r.decision) || null, by: str(r.by), at: str(r.at), reason: str(r.reason) || null })) }))
    .filter((v) => v.state !== "none")
    .filter((v) => !wantSubject || lower(v.subjectId) === lower(wantSubject))
    .sort((a, b) => str(b.verificationId).localeCompare(str(a.verificationId)));

  return { ...base, ok: true, verifications };
}

function writeFailure(e) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code) };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message) };
}

export {
  DECISIONS, SUBJECT_TYPES, verificationIdFor, chainState, mayDecide,
  requestRecord, decisionRecord, approvalCovers,
  requestVerification, recordVerification, listVerifications,
};
