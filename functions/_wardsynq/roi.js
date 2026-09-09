/* functions/_wardsynq/roi.js — TASK 4.9: the RecordService bridge for wardsynq-roi.js.
 *
 * Every write is a phase transition on the SAME ROIRequest record, one version per transition,
 * exactly the append-only shape every other bridge in this session already uses. Gated on
 * staff.admin: Health Information Management is a records-custody function, not ordinary clinical
 * or billing work, and this codebase has no dedicated HIM capability yet - a real site that wants a
 * narrower HIM-only role is a role-design decision this task does not make unilaterally, the same
 * restraint TASK 3.5/4.5/4.7/4.8 already state about their own authorization boundaries.
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { TYPE, requestROI, authorize, deny, cancel, fulfill, roiIdFor, RoiRefusalError } from "../../wardsynq/wardsynq-roi.js";
import { permits } from "./consent.js";

const str = (v) => (v == null ? "" : String(v).trim());

async function open_(request, env, ctx, need) {
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
function writeFailure(e, extra) {
  if (e instanceof RoiRefusalError) return { ok: false, status: 409, error: "roi_refused", code: e.code, detail: e.message, ...extra };
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
function summary(req) {
  return {
    roiId: req.id, patientId: req.patientId, requester: req.requester, purpose: req.purpose,
    authorizationBasis: req.authorizationBasis, scope: req.scope, recipient: req.recipient,
    state: req.state, requestedBy: req.requestedBy, requestedAt: req.requestedAt,
    decidedBy: req.decidedBy, decidedAt: req.decidedAt, decisionReason: req.decisionReason,
    fulfilledBy: req.fulfilledBy, fulfilledAt: req.fulfilledAt, disclosure: req.disclosure,
    history: req.history, version: req.version,
  };
}

/** ctx: { migration, patientId, requester, purpose, authorizationBasis?, scope, recipient, at?, actorDeps, recordDeps } */
async function requestRelease(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = roiIdFor(patientId, ctx.requester && ctx.requester.name, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const current = await svc.get(TYPE, id).catch(() => null);
  if (current) return { ...base, ok: true, written: 0, skipped: "already_requested", ...summary(current) };

  let req;
  try {
    req = requestROI({
      id, patientId, requester: ctx.requester, purpose: ctx.purpose, authorizationBasis: ctx.authorizationBasis,
      scope: ctx.scope, recipient: ctx.recipient, requestedBy: resolved.actor.id, requestedAt: at,
    });
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
  req.resourceType = TYPE;

  try {
    const out = await svc.put(req, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...req, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** Shared phase-transition runner, the same shape every other bridge in this session uses. */
async function transition(request, env, ctx, run) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const roiId = str(ctx.roiId);
  if (!roiId) return { ...base, ok: false, status: 422, error: "roi_required", written: 0 };

  const { svc, resolved, error } = await open_(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const current = await svc.get(TYPE, roiId).catch(() => null);
  if (!current) return { ...base, ok: false, status: 404, error: "roi_not_found", roiId, written: 0 };

  try { run(current, resolved.actor.id); }
  catch (e) { return { ...base, ...writeFailure(e, { roiId, written: 0, actor: resolved.actor.id }) }; }

  try {
    const out = await svc.put({ ...current, resourceType: TYPE }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...current, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { roiId, written: 0, actor: resolved.actor.id }) }; }
}

const at_ = (ctx) => str(ctx.at) || new Date().toISOString();

/** ctx: { migration, roiId, authorizationBasis?, reason?, actorDeps, recordDeps } */
async function authorizeRelease(request, env, ctx) { return transition(request, env, ctx, (req, actorId) => authorize(req, { by: actorId, at: at_(ctx), authorizationBasis: ctx.authorizationBasis, reason: ctx.reason })); }
/** ctx: { migration, roiId, reason, actorDeps, recordDeps } */
async function denyRelease(request, env, ctx) { return transition(request, env, ctx, (req, actorId) => deny(req, { by: actorId, at: at_(ctx), reason: ctx.reason })); }
/** ctx: { migration, roiId, reason, actorDeps, recordDeps } */
async function cancelRelease(request, env, ctx) { return transition(request, env, ctx, (req, actorId) => cancel(req, { by: actorId, at: at_(ctx), reason: ctx.reason })); }
/** ctx: { migration, roiId, deliveredStatus?, resourceCounts, note?, actorDeps, recordDeps } */
async function fulfillRelease(request, env, ctx) { return transition(request, env, ctx, (req, actorId) => fulfill(req, { by: actorId, at: at_(ctx), deliveredStatus: ctx.deliveredStatus, resourceCounts: ctx.resourceCounts, note: ctx.note })); }

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function readRoi(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", roi: null };
  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, roi: null };
  const roiId = str(ctx.roiId);
  if (!roiId) return { ...base, ok: false, status: 422, error: "roi_required", roi: null };
  const req = await svc.get(TYPE, roiId).catch(() => null);
  if (!req) return { ...base, ok: false, status: 404, error: "roi_not_found", roi: null };
  return { ...base, ok: true, roi: summary(req) };
}

/** ctx: { migration, patientId, actorDeps, recordDeps } - every ROI request for one patient, plus
 *  the patient's own share-external consent status, since it is one common valid authorization
 *  basis a HIM officer would want to see alongside the request - shown, never enforced here. */
async function roiRequestsForPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", requests: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", requests: [] };
  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, requests: [] };

  let rows, consents;
  try {
    [rows, consents] = await Promise.all([svc.byPatient(TYPE, patientId), svc.byPatient("PatientConsent", patientId).catch(() => [])]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), requests: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), requests: [] };
  }
  const requests = (rows || []).filter(Boolean).map(summary).sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
  return { ...base, ok: true, patientId, requests, shareExternalConsent: permits(consents || [], "share-external") };
}

export { TYPE, requestRelease, authorizeRelease, denyRelease, cancelRelease, fulfillRelease, readRoi, roiRequestsForPatient };
