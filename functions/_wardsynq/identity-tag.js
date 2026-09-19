/* functions/_wardsynq/identity-tag.js — TASK 6.14: reaching the tag lifecycle from the record.
 *
 * wardsynq-identity-tag.js's engine computes the state machine; this file resolves an actor, loads
 * whatever is already on record for a patient, calls the engine, and writes the result back through
 * the same append-only RecordService every other WardSynQ resource uses. It adds exactly one thing
 * the pure engine cannot: the QUERY that makes "never silently reassign an active tag" real. The
 * engine's assignTag() has no memory of a patient's other tags - it is pure - so THIS file is where
 * an assignment is refused when an active tag of the same type already exists, and where replaceTag
 * writes BOTH the ended old record and the new active one, or neither.
 *
 * EMR_VITALS, the same capability DeviceAssociation already uses (migrate-device.js's own comment:
 * "scanning a wristband and a device tag onto a patient is the nurse's own bedside act"). No new
 * capability was needed - a wristband is exactly that same kind of bedside act.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import {
  TAG_TYPES, STATUS, IdentityTagError,
  assignTag, verifyTag, deactivateTag, reportLost, replaceTag,
} from "../../wardsynq/wardsynq-identity-tag.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "PatientTag";

function tagIdFor(patientId, tagType, at, salt) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const p = slug(patientId), t = slug(tagType), a = slug(at), s = slug(salt || "");
  return p && t && a ? `wsq-tag-${p}-${t}-${a}${s ? "-" + s : ""}` : null;
}

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

function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  if (e instanceof IdentityTagError) return { ok: false, status: 422, error: e.code, detail: e.message, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/** Every tag ever issued to this patient, oldest first - the chain a reader needs to see. */
async function tagsForPatient(svc, patientId) {
  const rows = await svc.byPatient(TYPE, patientId);
  return (rows || []).filter(Boolean).sort((a, b) => String(a.assignedAt || "").localeCompare(String(b.assignedAt || "")));
}

/**
 * Assigns a new tag. Refuses when this patient already holds an ACTIVE tag of the SAME type -
 * replaceTag or deactivateTag must end that one first. ctx: { migration, patientId, tagType, code,
 * actorDeps, recordDeps }
 */
async function assignPatientTag(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let realPatient;
  try { realPatient = await svc.get("Patient", patientId); }
  catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  if (!realPatient) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };

  let existing;
  try { existing = await tagsForPatient(svc, patientId); }
  catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  const activeSameType = existing.find((t) => t.tagType === ctx.tagType && t.status === STATUS.ACTIVE);
  if (activeSameType) {
    return { ...base, ok: false, status: 409, error: "active_tag_exists", detail: `this patient already holds an active ${ctx.tagType} tag (${activeSameType.id}) - replace or deactivate it first, a second active tag is never assigned silently`, written: 0, tag: activeSameType };
  }

  let draft;
  try { draft = assignTag({ patientId, tagType: ctx.tagType, code: ctx.code, assignedBy: resolved.actor.id, now: new Date().toISOString() }); }
  catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  const id = tagIdFor(patientId, ctx.tagType, draft.assignedAt, draft.id);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };
  draft.id = id;

  try {
    const out = await svc.put({ ...draft, resourceType: TYPE }, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, tag: { ...draft, version: out.record.version } };
  } catch (e) {
    return { ...base, ...writeFailure(e, { written: 0 }) };
  }
}

/** Checks a scanned code against a patient's currently active tag of one type. Read-only - this is
 * a CHECK, never a write, and it never mutates anything the bedside comparators themselves rely on.
 * ctx: { migration, patientId, tagType, scannedCode, actorDeps, recordDeps } */
async function verifyPatientTag(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", matches: false };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", matches: false };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, matches: false };

  let existing;
  try { existing = await tagsForPatient(svc, patientId); }
  catch (e) { return { ...base, ...writeFailure(e, { matches: false }) }; }
  const active = existing.find((t) => t.tagType === ctx.tagType && t.status === STATUS.ACTIVE) || null;
  const result = verifyTag(active, ctx.scannedCode);
  return { ...base, ok: true, ...result, tagId: active ? active.id : null };
}

/** Ends an active tag deliberately (discharge, damaged, policy). Deactivate/lost share this shape.
 * ctx: { migration, tagId, reason, actorDeps, recordDeps } */
async function endPatientTag(engineFn, request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const tagId = str(ctx.tagId);
  if (!tagId) return { ...base, ok: false, status: 422, error: "tag_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, tagId); }
  catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  if (!current) return { ...base, ok: false, status: 404, error: "tag_not_found", written: 0 };

  let draft;
  try {
    draft = { ...current, history: [...(current.history || [])] };
    engineFn(draft, { by: resolved.actor.id, reason: ctx.reason, now: new Date().toISOString() });
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }

  try {
    const out = await svc.put({ ...draft, resourceType: TYPE }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, tag: { ...draft, version: out.record.version } };
  } catch (e) {
    return { ...base, ...writeFailure(e, { written: 0 }) };
  }
}

async function deactivatePatientTag(request, env, ctx) { return endPatientTag(deactivateTag, request, env, ctx); }
async function reportPatientTagLost(request, env, ctx) { return endPatientTag(reportLost, request, env, ctx); }

/**
 * Ends the current tag and issues a new one, writing both or neither. ctx: { migration, tagId,
 * newCode, reason, actorDeps, recordDeps }
 */
async function replacePatientTag(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const tagId = str(ctx.tagId);
  if (!tagId) return { ...base, ok: false, status: 422, error: "tag_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, tagId); }
  catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  if (!current) return { ...base, ok: false, status: 404, error: "tag_not_found", written: 0 };

  let old, next;
  try {
    const draft = { ...current, history: [...(current.history || [])] };
    const result = replaceTag(draft, { newCode: ctx.newCode, by: resolved.actor.id, reason: ctx.reason, now: new Date().toISOString() });
    old = result.old; next = result.next;
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }

  const nextId = tagIdFor(next.patientId, next.tagType, next.assignedAt, next.id);
  if (!nextId) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };
  next.id = nextId; next.replacesTagId = old.id;

  // Write the ENDED old tag first: if the second write fails, the record shows a correctly-ended
  // tag and no active one - refusable and re-triable. The reverse order could leave two tags
  // reading active at once, which is the exact failure this file exists to prevent.
  try {
    const outOld = await svc.put({ ...old, resourceType: TYPE }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey ? ctx.idempotencyKey + ":old" : null });
    const outNext = await svc.put({ ...next, resourceType: TYPE }, { idempotencyKey: ctx.idempotencyKey ? ctx.idempotencyKey + ":new" : null });
    return { ...base, ok: true, written: 2, old: { ...old, version: outOld.record.version }, tag: { ...next, version: outNext.record.version } };
  } catch (e) {
    return { ...base, ...writeFailure(e, { written: 0 }) };
  }
}

/** Every tag ever issued to a patient, oldest first. ctx: { migration, patientId, actorDeps, recordDeps } */
async function patientTagLog(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", tags: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", tags: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, tags: [] };

  let tags;
  try { tags = await tagsForPatient(svc, patientId); }
  catch (e) { return { ...base, ...writeFailure(e, { tags: [] }) }; }
  return { ...base, ok: true, tags, active: tags.filter((t) => t.status === STATUS.ACTIVE) };
}

export {
  TAG_TYPES, STATUS,
  tagIdFor, assignPatientTag, verifyPatientTag, deactivatePatientTag, reportPatientTagLost, replacePatientTag, patientTagLog,
};
