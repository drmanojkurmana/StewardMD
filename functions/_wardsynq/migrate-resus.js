/* functions/_wardsynq/migrate-resus.js — the missing adapter for wardsynq-emergency.js's
 * EmergencyBundle: a real, tested, time-critical Code Sepsis / Code Blue / Code STEMI state
 * machine (STATUS in that file's own header: "IMPLEMENTED and TESTED. NOT clinically validated
 * and NOT clinically approved") that was reachable by nobody - no route, no UI, imported by its
 * own tests and nothing else. This is the join, and it introduces no second bundle model: every
 * rule about time zero, element ordering and breach is enforced by that file, unchanged, by
 * running the SAME class here.
 *
 * WHY A CLASS INSTANCE NEEDS HYDRATING, NOT JUST STORING. EmergencyBundle is a mutable object
 * with real methods (.complete(), .void(), .status()) that a resuscitation needs to CALL again on
 * every element marked, not just read back. serializeBundle()/hydrateBundle() below are the whole
 * adapter: serialize copies out every field the constructor sets; hydrate builds a fresh instance
 * via the SAME prototype (Object.create(EmergencyBundle.prototype)) and copies them back in,
 * skipping the constructor (which would re-validate time zero against "now" on every reload) so
 * every later call to .complete()/.void() runs the file's own real validation, not a re-check of
 * facts that were already true when the bundle was opened.
 */

import { EmergencyBundle } from "../../wardsynq/wardsynq-emergency.js";
// wardsynq-obstetrics.js's own header: "Passed as `definition` to EmergencyBundle, so these inherit
// every timing guarantee already built and tested there rather than growing a second clock." Task
// 2.4 is what actually does the passing - EmergencyBundle's own BUNDLES registry has never heard of
// "code-pph"/"code-eclampsia", so starting either without this would fail UNKNOWN_CODE.
import { OBSTETRIC_BUNDLES } from "../../wardsynq/wardsynq-obstetrics.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const RESUS_TYPE = "ResusBundle";
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Deterministic on (patient, code, time zero): retrying "start" with the same time zero is
 *  idempotent; a bundle re-opened after a void gets a new one because it has a new time zero. */
function bundleIdFor(patientId, code, timeZero) {
  const p = slug(patientId), c = slug(code), t = slug(timeZero);
  return p && c && t ? `wsq-resus-${p}-${c}-${t}` : null;
}

function serializeBundle(b) {
  return {
    resourceType: RESUS_TYPE, id: b._id,
    patientId: b.patientId, encounterId: b.encounterId,
    code: b.code, label: b.label, startedBy: b.startedBy, timeZero: b.timeZero, openedAt: b.openedAt,
    evidence: b.evidence, state: b.state, voidReason: b.voidReason, supersededBy: b.supersededBy,
    elements: b.elements, ledger: b.ledger,
  };
}
/** Rebuilds a real, fully-functional EmergencyBundle from a stored record - see file header. */
function hydrateBundle(stored) {
  const b = Object.create(EmergencyBundle.prototype);
  Object.assign(b, {
    code: stored.code, label: stored.label, patientId: stored.patientId, encounterId: stored.encounterId,
    startedBy: stored.startedBy, timeZero: stored.timeZero, openedAt: stored.openedAt,
    evidence: stored.evidence, state: stored.state, voidReason: stored.voidReason,
    supersededBy: stored.supersededBy, elements: stored.elements, ledger: stored.ledger,
  });
  b._id = stored.id; b._version = stored.version;
  return b;
}

async function openService(request, env, ctx, need) {
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
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
/** EmergencyBundle throws its own EmergencyError (NO_PATIENT, NO_STARTER, ALREADY_DONE,
 *  BEFORE_TIME_ZERO, WRONG_EVENT, ...) - shown verbatim, the same rule every refusal in this app
 *  already keeps, never paraphrased into a generic failure. */
function bundleRefusal(base, e, extra) {
  return { ...base, ok: false, status: e && e.code === "UNKNOWN_CODE" ? 422 : 409, error: "resus_refused", code: (e && e.code) || null, detail: str(e && e.message), ...extra };
}

/** Starts a bundle. ctx: { migration, patientId, encounterId?, code, evidence?, timeZero?,
 *  actorDeps, recordDeps } */
async function startResusBundle(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const now = new Date().toISOString();
  let bundle;
  try {
    bundle = new EmergencyBundle({
      code: str(ctx.code), patientId, encounterId: str(ctx.encounterId) || null,
      startedBy: resolved.actor.id, timeZero: str(ctx.timeZero) || undefined,
      evidence: ctx.evidence || null, now,
      definition: OBSTETRIC_BUNDLES[str(ctx.code)] || undefined,
    });
  } catch (e) { return bundleRefusal(base, e, { written: 0 }); }

  const id = bundleIdFor(patientId, bundle.code, bundle.timeZero);
  if (!id) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  bundle._id = id; bundle._version = undefined;

  let current;
  try { current = await svc.get(RESUS_TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (current) return { ...base, ok: true, written: 0, skipped: "unchanged", bundleId: id, status: hydrateBundle(current).status(now) };

  try {
    const out = await svc.put(serializeBundle(bundle), { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, bundleId: id, status: hydrateBundle(out.record).status(now), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { bundleId: id, written: 0, actor: resolved.actor.id }) };
  }
}

async function loadBundle(svc, bundleId) {
  const rec = await svc.get(RESUS_TYPE, bundleId);
  return rec ? hydrateBundle(rec) : null;
}

/** ctx: { migration, bundleId, key, event, at?, detail?, actorDeps, recordDeps } */
async function markResusElement(request, env, ctx) {
  return mutateBundle(request, env, ctx, (bundle, resolved, at) =>
    bundle.complete(str(ctx.key), { event: str(ctx.event), at, by: resolved.actor.id, detail: str(ctx.detail) || undefined }));
}
/** ctx: { migration, bundleId, key, reason, at?, actorDeps, recordDeps } */
async function waiveResusElement(request, env, ctx) {
  return mutateBundle(request, env, ctx, (bundle, resolved, at) =>
    bundle.notApplicable(str(ctx.key), { by: resolved.actor.id, reason: str(ctx.reason), at }));
}
/** ctx: { migration, bundleId, reason, actorDeps, recordDeps } */
async function voidResusBundle(request, env, ctx) {
  return mutateBundle(request, env, ctx, (bundle, resolved) => bundle.void(resolved.actor.id, str(ctx.reason)));
}

async function mutateBundle(request, env, ctx, apply) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const bundleId = str(ctx.bundleId);
  if (!bundleId) return { ...base, ok: false, status: 422, error: "bundle_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let bundle;
  try { bundle = await loadBundle(svc, bundleId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!bundle) return { ...base, ok: false, status: 404, error: "bundle_not_found", bundleId, written: 0 };

  const now = new Date().toISOString();
  try { apply(bundle, resolved, str(ctx.at) || now); }
  catch (e) { return bundleRefusal(base, e, { bundleId, written: 0 }); }

  try {
    const out = await svc.put(serializeBundle(bundle), { expectedVersion: bundle._version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, bundleId, status: hydrateBundle(out.record).status(now), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { bundleId, written: 0, actor: resolved.actor.id }) };
  }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function listResusBundles(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", bundles: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", bundles: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, bundles: [] };

  let rows;
  try { rows = await svc.byPatient(RESUS_TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), bundles: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), bundles: [] };
  }
  const now = new Date().toISOString();
  const bundles = (rows || []).map((r) => ({ bundleId: r.id, ...hydrateBundle(r).status(now) }))
    .sort((a, b) => String(b.timeZero).localeCompare(String(a.timeZero)));
  return { ...base, ok: true, bundles };
}

export { RESUS_TYPE, bundleIdFor, serializeBundle, hydrateBundle, startResusBundle, markResusElement, waiveResusElement, voidResusBundle, listResusBundles };
