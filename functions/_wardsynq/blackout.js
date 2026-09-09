/* functions/_wardsynq/blackout.js — TASK 4.5: a clinician or a resource is unavailable, on purpose.
 *
 * scheduling.js and resource-booking.js already refuse a slot two bookings would collide on. This
 * is the OTHER reason a slot cannot be offered: nobody is trying to double-book it, the hospital has
 * simply said this clinician is on leave, or this theatre is closed for the afternoon, for this
 * whole period. A BLACKOUT IS A REFUSAL, NEVER AN OVERRIDE - unlike an appointment clash (which a
 * human may deliberately overbook and say why), a blackout is the hospital's own decision that the
 * slot does not exist right now, so there is nothing to override.
 *
 * ONE RECORD PER SUBJECT (a clinicianId or a resourceId), NEVER BOTH AT ONCE - a blackout blocks
 * exactly the diary it names, so a theatre closure never silently also blocks every clinician who
 * happens to operate there.
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "Blackout";
const STATES = Object.freeze(["active", "cancelled"]);

function Blackout(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    clinicianId: i.clinicianId || null,
    resourceId: i.resourceId || null,
    from: i.from || null, to: i.to || null,
    reason: i.reason || null,
    state: STATES.includes(i.state) ? i.state : "active",
    createdBy: i.createdBy || null, createdAt: i.createdAt || null,
    cancelledBy: i.cancelledBy || null, cancelledAt: i.cancelledAt || null,
    source: { system: "wardsynq-native", sourceId: `blackout:${i.id}` },
  };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function blackoutIdFor(subjectId, from, to) {
  const s = slug(subjectId), f = slug(from), t = slug(to);
  return s && f && t ? `wsq-blackout-${s}-${f}-${t}` : null;
}

/** PURE. Does this candidate slot (subjectId + startAt/minutes) fall inside an active blackout? */
function blackedOutBy(blackouts, subjectId, candidate) {
  const s = str(subjectId);
  const cs = Date.parse(candidate && candidate.startAt);
  const cm = Number(candidate && candidate.minutes);
  if (!s || !Number.isFinite(cs) || !Number.isFinite(cm)) return null;
  const ce = cs + cm * 60000;
  return (blackouts || []).find((b) => {
    if (!b || b.state !== "active") return false;
    if (str(b.clinicianId) !== s && str(b.resourceId) !== s) return false;
    const bs = Date.parse(b.from), be = Date.parse(b.to);
    if (!Number.isFinite(bs) || !Number.isFinite(be)) return false;
    return cs < be && bs < ce;
  }) || null;
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
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
function summary(b) {
  return { blackoutId: b.id, clinicianId: b.clinicianId, resourceId: b.resourceId, from: b.from, to: b.to, reason: b.reason, state: b.state, createdBy: b.createdBy, createdAt: b.createdAt, version: b.version };
}

/** ctx: { migration, clinicianId?, resourceId?, from, to, reason, actorDeps, recordDeps } */
async function blockPeriod(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const clinicianId = str(ctx.clinicianId), resourceId = str(ctx.resourceId);
  const subjectId = clinicianId || resourceId;
  const from = str(ctx.from), to = str(ctx.to), reason = str(ctx.reason);
  if (clinicianId && resourceId) return { ...base, ok: false, status: 422, error: "one_subject_only", detail: "a blackout names a clinician OR a resource, never both", written: 0 };
  if (!subjectId) return { ...base, ok: false, status: 422, error: "subject_required", detail: "a blackout needs a clinicianId or a resourceId", written: 0 };
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(to) <= Date.parse(from)) {
    return { ...base, ok: false, status: 422, error: "bad_period", detail: "from/to must be a real period, to after from", written: 0 };
  }
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why this period is blocked", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = blackoutIdFor(subjectId, from, to);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); } catch { current = null; }
  if (current && current.state === "active") return { ...base, ok: true, written: 0, skipped: "already_blocked", ...summary(current) };

  const rec = Blackout({
    id, clinicianId: clinicianId || null, resourceId: resourceId || null, from, to, reason, state: "active",
    createdBy: resolved.actor.id, createdAt: new Date().toISOString(),
  });
  try {
    const out = await svc.put(rec, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...rec, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { blackoutId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/** ctx: { migration, blackoutId, reason?, actorDeps, recordDeps } */
async function cancelBlackout(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const blackoutId = str(ctx.blackoutId);
  if (!blackoutId) return { ...base, ok: false, status: 422, error: "blackout_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, blackoutId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "blackout_not_found", written: 0 };
  if (current.state !== "active") return { ...base, ok: true, written: 0, skipped: "already_cancelled", ...summary(current) };

  const next = Blackout({ ...current, state: "cancelled", cancelledBy: resolved.actor.id, cancelledAt: new Date().toISOString() });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { blackoutId, written: 0, actor: resolved.actor.id }) };
  }
}

/** ctx: { migration, clinicianId?, resourceId?, actorDeps, recordDeps } */
async function listBlackouts(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", blackouts: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, blackouts: [] };

  let rows;
  try { rows = (await svc.list(TYPE, 500)) || []; }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), blackouts: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), blackouts: [] };
  }
  const clinicianId = str(ctx.clinicianId), resourceId = str(ctx.resourceId);
  const blackouts = rows.filter(Boolean).filter((b) => b.state === "active")
    .filter((b) => !clinicianId || b.clinicianId === clinicianId)
    .filter((b) => !resourceId || b.resourceId === resourceId)
    .map(summary).sort((a, b) => String(a.from).localeCompare(String(b.from)));
  return { ...base, ok: true, blackouts };
}

export { TYPE, STATES, Blackout, blackoutIdFor, blackedOutBy, blockPeriod, cancelBlackout, listBlackouts };
