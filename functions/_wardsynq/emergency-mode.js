/* functions/_wardsynq/emergency-mode.js — TASK 4.15: a governed, hospital-wide emergency mode.
 *
 * break-glass.js already solved the same problem for ONE patient's chart: an emergency that cannot
 * be declared inside the system gets worked around outside it, and every workaround leaves no name.
 * This is that same discipline at hospital scale - mass casualty, disaster, evacuation, surge,
 * network outage - and it borrows break-glass.js's shape deliberately: append-only, time-boxed,
 * reason-mandatory, human-only, its own accountability surface.
 *
 * WHAT IT IS NOT: "do not create an unrestricted admin bypass" is the plan's own text. This file
 * grants NOTHING by itself - EmergencyActivation is a DECLARATION, not a capability, and nothing in
 * actor.js's grant logic reads it. `relaxations` is a plain, hospital-supplied list of NAMED things
 * this incident temporarily eases (the hospital's own words, the same "ships structure, the
 * hospital supplies content" idiom chart-completion.js/note-templates.js/risk-assessment.js already
 * use) - a list a screen can display and a reviewer can audit, never a blanket capability grant.
 * Nothing in this codebase reads `relaxations` automatically; a route that wants to honour one
 * checks `emergencyStatus()` and `isRelaxed()` explicitly, by name, the same way it would check any
 * other org config - wiring up a SPECIFIC relaxation (e.g. a particular bed rule, a particular
 * cosign window) is a clinical/operational policy decision for a later, explicitly scoped task, not
 * something this file invents on the hospital's behalf.
 *
 * "RECONCILE ACTIONS AFTER RECOVERY" is deliberately NOT built here. Nothing in this codebase
 * reconciles what happened on a downtime-pack's paper once systems return (confirmed: no such
 * mechanism exists anywhere), and building one is a real design decision - a re-entry workflow, a
 * matching/dedup rule against records written during the outage - the same kind of decision TASK
 * 4.14 declined to make unilaterally for bed override. This file's `log()` and `status()` give a
 * reconciliation effort its raw material (who declared what, when, and what was relaxed); the
 * workflow itself is future, explicitly scoped work.
 *
 * ITS OWN DOOR, like break-glass.js: not wired into resolveClinicalActor. Declaring or deactivating
 * is its own explicit action a caller asks for by name, never an implicit side effect of anything
 * else.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "EmergencyActivation";

const SCOPE_LEVELS = Object.freeze(["org", "ward", "dept"]);
const DEFAULT_MINUTES = 240;   // a hospital emergency defaults to a working shift, not an hour
const MAX_MINUTES = 1440;      // one day; a longer emergency is a re-declaration, never a silent extension

function EmergencyActivation(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    scope: {
      level: SCOPE_LEVELS.includes(i.scope && i.scope.level) ? i.scope.level : "org",
      units: Array.isArray(i.scope && i.scope.units) ? [...i.scope.units].map(str).filter(Boolean) : [],
    },
    kind: i.kind || "other",         // free label: mass-casualty | disaster | downtime | evacuation | surge | network-outage | other
    reason: i.reason || null,
    // A closed, hospital-named list - structure only. See file header: nothing here grants anything.
    relaxations: Array.isArray(i.relaxations) ? [...i.relaxations].map(str).filter(Boolean) : [],
    declaredBy: i.declaredBy,
    declaredAt: i.declaredAt || null,
    expiresAt: i.expiresAt || null,
    revokedAt: i.revokedAt || null,
    revokedBy: i.revokedBy || null,
    revokedReason: i.revokedReason || null,
    source: { system: "wardsynq-native", sourceId: `emergency:${i.id}` },
  };
}

function activationIdFor(orgId, at) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const o = slug(orgId), t = slug(at);
  return o && t ? `wsq-emergency-${o}-${t}` : null;
}

/** PURE. Usable right now? Computed, never stored - the same reason break-glass.js's own isActive()
 * gives: a stored "active" is a fact that goes stale the moment the clock, or a revocation, moves. */
function isActive(activation, nowMs) {
  if (!activation || activation.revokedAt) return false;
  const exp = Date.parse(activation.expiresAt || "");
  if (!Number.isFinite(exp)) return false;
  return (nowMs || Date.now()) < exp;
}

/** PURE. Is a named relaxation actually in force right now, under an active activation? The one
 * function a consumer route is expected to call by name - never "is emergency mode on", always
 * "is THIS specific thing relaxed". */
function isRelaxed(activations, relaxationName, nowMs) {
  const name = str(relaxationName);
  if (!name) return false;
  return (activations || []).some((a) => isActive(a, nowMs) && (a.relaxations || []).includes(name));
}

function minutesFor(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MINUTES;
  return Math.min(Math.round(n), MAX_MINUTES);
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

function summary(a, nowMs) {
  return {
    activationId: a.id, scope: a.scope, kind: a.kind, reason: a.reason, relaxations: a.relaxations,
    declaredBy: a.declaredBy, declaredAt: a.declaredAt, expiresAt: a.expiresAt,
    revokedAt: a.revokedAt || null, revokedBy: a.revokedBy || null, revokedReason: a.revokedReason || null,
    active: isActive(a, nowMs), version: a.version,
  };
}

/**
 * Declares a hospital emergency. ctx: { migration, kind?, scope?, reason, relaxations?, minutes?,
 * actorDeps, recordDeps }
 */
async function declareEmergency(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const reason = str(ctx.reason);
  // A REASON IS MANDATORY, in the declarer's own words - the same accountability rule break-glass.js
  // states for the same purpose: a log with no reason cannot tell a real emergency from a habit.
  if (reason.length < 10) {
    return { ...base, ok: false, status: 422, error: "reason_required", detail: "say what the emergency is, in your own words - a declaration with no reason is unauditable", written: 0 };
  }
  const scopeLevel = SCOPE_LEVELS.includes(ctx.scope && ctx.scope.level) ? ctx.scope.level : "org";
  if (scopeLevel !== "org" && !(ctx.scope && Array.isArray(ctx.scope.units) && ctx.scope.units.length)) {
    return { ...base, ok: false, status: 422, error: "scope_units_required", detail: `a ${scopeLevel}-level emergency must name which ${scopeLevel}(s) it covers - "everywhere" is the org level, stated explicitly, not a default`, written: 0 };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  // NOTHING AUTOMATIC EVER DECLARES ONE - the same rule break-glass.js states for the same reason:
  // an emergency is declared by a person prepared to have their name on it.
  if (resolved.actor && resolved.actor.kind === "ai") {
    return { ...base, ok: false, status: 403, error: "human_required", detail: "an emergency is declared by a person who is prepared to have their name on it", written: 0 };
  }

  const declaredAt = new Date().toISOString();
  const minutes = minutesFor(ctx.minutes);
  const id = activationIdFor((mig && mig.tenantId) || "", declaredAt);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const activation = EmergencyActivation({
    id, kind: str(ctx.kind) || "other", scope: { level: scopeLevel, units: (ctx.scope && ctx.scope.units) || [] },
    reason, relaxations: ctx.relaxations || [],
    declaredBy: resolved.actor.id, declaredAt, expiresAt: new Date(Date.parse(declaredAt) + minutes * 60000).toISOString(),
  });
  try {
    const out = await svc.put(activation, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...activation, version: out.record.version }, Date.parse(declaredAt)), minutes };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

/**
 * Ends an emergency before it would otherwise expire. Deactivation is itself named and reasoned -
 * "stood down" is as much a fact for the record as "declared". ctx: { migration, activationId,
 * reason, actorDeps, recordDeps }
 */
async function deactivateEmergency(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const id = str(ctx.activationId);
  if (!id) return { ...base, ok: false, status: 422, error: "activation_required", written: 0 };
  const reason = str(ctx.reason);
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why this emergency is being stood down", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "activation_not_found", written: 0 };
  if (current.revokedAt) return { ...base, ok: true, written: 0, skipped: "already_deactivated", ...summary(current, Date.now()) };

  const revokedAt = new Date().toISOString();
  const next = EmergencyActivation({ ...current, revokedAt, revokedBy: resolved.actor.id, revokedReason: reason });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }, Date.parse(revokedAt)) };
  } catch (e) {
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

/**
 * THE VISIBLE-STATUS SURFACE. Any role that can read the org may ask "is anything active right
 * now" - a banner needs this to be cheap and universally readable, not buried behind an admin-only
 * accountability log. ctx: { migration, actorDeps, recordDeps }
 */
async function emergencyStatus(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", active: [], any: false };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, active: [], any: false };

  let rows;
  try { rows = await svc.list(TYPE, 200); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), active: [], any: false }; }

  const nowMs = Date.now();
  const active = (rows || []).filter(Boolean).map((a) => summary(a, nowMs)).filter((a) => a.active)
    .sort((a, b) => String(b.declaredAt || "").localeCompare(String(a.declaredAt || "")));
  return { ...base, ok: true, active, any: active.length > 0 };
}

/**
 * THE ACCOUNTABILITY LOG. Every activation ever declared, active or not - the same reasoning
 * break-glass.js's own listBreakGlass() gives: the point of the mechanism is that this list exists
 * and somebody reads it. ctx: { migration, activeOnly?, actorDeps, recordDeps }
 */
async function emergencyLog(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", activations: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, activations: [] };

  let rows;
  try { rows = await svc.list(TYPE, 200); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), activations: [] }; }

  const nowMs = Date.now();
  const activations = (rows || []).filter(Boolean).map((a) => summary(a, nowMs))
    .filter((a) => (ctx.activeOnly ? a.active : true))
    .sort((a, b) => String(b.declaredAt || "").localeCompare(String(a.declaredAt || "")));
  return { ...base, ok: true, activations, active: activations.filter((a) => a.active).length };
}

/**
 * RECOVERY RECONCILIATION. The plan's own requirement this file's header once deferred as "future,
 * explicitly scoped work" - and it is small enough to do honestly now: not a re-entry workflow for
 * paper records (that remains genuinely out of scope, a real design decision this file still does
 * not make unilaterally), but the raw material every such workflow needs and does not yet have -
 * every real override an emergency declaration actually authorised, computed live from the SAME
 * `emergencyOverride` field migrate-inpatient.js's own admitPatient/transferPatient already write
 * on the Encounter's own append-only version history. Nothing here is stored twice: this reads what
 * already happened, the same "IT COUNTS, IT DOES NOT JUDGE" discipline ward-metrics.js states -
 * a human reviews the list and decides whether each override was legitimate; this file only says
 * what occurred, never whether it should have.
 *
 * ctx: { migration, activationId, actorDeps, recordDeps }
 */
async function emergencyReconciliation(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", overrides: [] };

  const activationId = str(ctx.activationId);
  if (!activationId) return { ...base, ok: false, status: 422, error: "activation_required", overrides: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, overrides: [] };

  let activation;
  try { activation = await svc.get(TYPE, activationId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), overrides: [] }; }
  if (!activation) return { ...base, ok: false, status: 404, error: "activation_not_found", overrides: [] };

  // Every resource type an override could ever be recorded on. Today that is Encounter alone
  // (admission/transfer's own bed-assignment-conflict-override) - a second relaxation on a second
  // type extends this list, not the shape of what it returns.
  let encounters;
  try { encounters = await svc.list("Encounter", 500); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), overrides: [] }; }

  const overrides = (encounters || []).filter(Boolean)
    .filter((e) => e.emergencyOverride && e.emergencyOverride.activationId === activationId)
    .map((e) => ({
      sourceType: "Encounter", sourceId: e.id, patientId: e.patientId,
      relaxation: e.emergencyOverride.relaxation, overriddenState: e.emergencyOverride.overriddenState,
      by: e.emergencyOverride.by, at: e.emergencyOverride.at,
      location: e.location || null, currentStatus: e.status,
    }))
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));

  return {
    ...base, ok: true, activationId,
    activation: summary(activation, Date.now()),
    overrides, count: overrides.length,
    note: overrides.length
      ? `${overrides.length} real override${overrides.length > 1 ? "s" : ""} were authorised under this declaration. Each is a fact, not a judgement - review that the emergency genuinely required each one.`
      : "No override was actually used under this declaration - the emergency was declared but the relaxation was never invoked.",
  };
}

export {
  TYPE, SCOPE_LEVELS, DEFAULT_MINUTES, MAX_MINUTES, EmergencyActivation,
  activationIdFor, isActive, isRelaxed, minutesFor,
  declareEmergency, deactivateEmergency, emergencyStatus, emergencyLog, emergencyReconciliation,
};
