/* functions/_wardsynq/incidents.js — TASK 5.14: reaching the incident ledger from the record.
 *
 * wardsynq-incidents.js has held a careful report -> triage -> RCA -> CAPA -> close lifecycle since
 * it was written: near-miss as a first-class report, severity kept apart from culpability, an RCA
 * that refuses "human error" as a root cause, a CAPA that refuses education-only actions, a close
 * that refuses to fake either. NOTHING CALLED IT. Like NEWS2 before news2-view.js, the hard half was
 * finished and unreachable: an incident filed on this build went nowhere, because nothing persisted
 * it, audited it, or gated who could file one from who could close it.
 *
 * THIS FILE COMPUTES NOTHING CLINICAL. Every judgement below - what counts as a valid root cause,
 * whether a CAPA is weak, whether a SAC score requires RCA before close - belongs to the engine.
 * This is the adapter: it resolves an actor, loads the persisted incident, calls the engine's own
 * mutator, and writes the result back through the SAME append-only RecordService every other
 * WardSynQ resource goes through - an investigation's earlier conclusions cannot be edited away
 * after the fact, because a "close" is a new version, never a rewrite of the "reported" one.
 *
 * FILING IS BROAD; INVESTIGATING IS NOT. INCIDENT_REPORT (doctor/nurse/supervisor/intern/resident/
 * admin) files a report. INCIDENT_INVESTIGATE (safety_officer/admin) triages, records the RCA, adds
 * and completes CAPAs, and closes. Both resolve to read/write on the ONE IncidentReport type (see
 * actor.js) - which of the two a request may actually DO is gated at the route, the same shape
 * EMERGENCY_DECLARE's declare/deactivate already establish for one shared resource scope.
 *
 * ANONYMITY SURVIVES THE WIRE. An anonymous report is filed with reportedBy: null, exactly as the
 * engine returns it - this file does not backfill the filing actor's id "for audit", because doing
 * so would defeat the one property anonymous filing exists to have. The ordinary audit row this
 * write already produces (actor.js's _audit(), the same as every other write) still names who
 * SUBMITTED the request; it does not appear on the incident's own reportedBy field.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import {
  SEVERITY, LIKELIHOOD, STATE, IncidentError,
  report, triage, recordRCA, addCAPA, completeCAPA, close, reportingHealth,
} from "../../wardsynq/wardsynq-incidents.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "IncidentReport";

function incidentIdFor(orgId, at, salt) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const o = slug(orgId), t = slug(at), s = slug(salt || "");
  return o && t ? `wsq-incident-${o}-${t}${s ? "-" + s : ""}` : null;
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

/** Runs one of the engine's mutators against the persisted record, and writes the result back. */
async function mutate(request, env, ctx, mutator) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const id = str(ctx.incidentId);
  if (!id) return { ...base, ok: false, status: 422, error: "incident_required", written: 0 };

  const { svc, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "incident_not_found", written: 0 };

  let next, extra;
  try {
    // The engine mutates its plain object in place; a shallow copy keeps `current` (and the version
    // this write is conditioned on) intact if the mutator throws partway through.
    const draft = { ...current, capas: (current.capas || []).map((c) => ({ ...c })), history: [...(current.history || [])] };
    extra = mutator(draft);
    next = draft;
  } catch (e) {
    if (e instanceof IncidentError) return { ...base, ok: false, status: 409, error: e.code, detail: e.message, written: 0 };
    return { ...base, ok: false, status: 502, error: "mutation_failed", detail: str(e && e.message), written: 0 };
  }

  try {
    const out = await svc.put({ ...next, resourceType: TYPE }, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, incident: { ...next, version: out.record.version }, ...(extra ? { result: extra } : {}) };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

/**
 * Files an incident. ctx: { migration, what, when?, severity, anonymous?, reportedBy?, patientId?,
 * likelihood?, contributingFactors?, actorDeps, recordDeps }
 */
async function reportIncident(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const at = new Date().toISOString();
  let draft;
  try {
    draft = report({
      what: ctx.what, when: ctx.when, severity: ctx.severity,
      anonymous: !!ctx.anonymous,
      // A named report defaults to the actor filing it; a caller may name someone else (e.g. a
      // supervisor filing on a colleague's behalf) but never invents a name where anonymous:true
      // was asked for - the engine itself refuses a named report with no reporter.
      reportedBy: ctx.anonymous ? null : (str(ctx.reportedBy) || resolved.actor.id),
      patientId: ctx.patientId || null, likelihood: ctx.likelihood || null,
      contributingFactors: ctx.contributingFactors || [], now: at,
    });
  } catch (e) {
    if (e instanceof IncidentError) return { ...base, ok: false, status: 422, error: e.code, detail: e.message, written: 0 };
    throw e;
  }

  const id = incidentIdFor((mig && mig.tenantId) || "", at, draft.id);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };
  draft.id = id;

  try {
    const out = await svc.put({ ...draft, resourceType: TYPE }, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, incident: { ...draft, version: out.record.version } };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

/** ctx: { migration, incidentId, likelihood, triagedBy, actorDeps, recordDeps } */
async function triageIncident(request, env, ctx) {
  return mutate(request, env, ctx, (draft) => triage(draft, { likelihood: ctx.likelihood, triagedBy: str(ctx.triagedBy), now: new Date().toISOString() }));
}

/** ctx: { migration, incidentId, rootCause, contributingFactors?, method?, conductedBy, actorDeps, recordDeps } */
async function recordIncidentRCA(request, env, ctx) {
  return mutate(request, env, ctx, (draft) => recordRCA(draft, {
    rootCause: ctx.rootCause, contributingFactors: ctx.contributingFactors, method: ctx.method,
    conductedBy: str(ctx.conductedBy), now: new Date().toISOString(),
  }));
}

/** ctx: { migration, incidentId, action, owner, dueBy, strength?, actorDeps, recordDeps } */
async function addIncidentCAPA(request, env, ctx) {
  return mutate(request, env, ctx, (draft) => addCAPA(draft, {
    action: ctx.action, owner: str(ctx.owner), dueBy: ctx.dueBy, strength: ctx.strength, now: new Date().toISOString(),
  }));
}

/** ctx: { migration, incidentId, capaId, by, evidence, actorDeps, recordDeps } */
async function completeIncidentCAPA(request, env, ctx) {
  return mutate(request, env, ctx, (draft) => completeCAPA(draft, ctx.capaId, { by: str(ctx.by), evidence: ctx.evidence, now: new Date().toISOString() }));
}

/** ctx: { migration, incidentId, by, actorDeps, recordDeps } */
async function closeIncident(request, env, ctx) {
  return mutate(request, env, ctx, (draft) => close(draft, { by: str(ctx.by), now: new Date().toISOString() }));
}

/**
 * THE LEDGER. ctx: { migration, state?, actorDeps, recordDeps }
 */
async function incidentLog(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", incidents: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, incidents: [] };

  let rows;
  try { rows = await svc.list(TYPE, 200); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), incidents: [] }; }

  let incidents = (rows || []).filter(Boolean);
  if (ctx.state && STATE[String(ctx.state).toUpperCase().replace(/-/g, "_")]) {
    incidents = incidents.filter((i) => i.state === ctx.state);
  }
  incidents.sort((a, b) => String(b.reportedAt || "").localeCompare(String(a.reportedAt || "")));

  return { ...base, ok: true, incidents, health: reportingHealth(incidents) };
}

export {
  SEVERITY, LIKELIHOOD, STATE,
  incidentIdFor, reportIncident, triageIncident, recordIncidentRCA, addIncidentCAPA, completeIncidentCAPA, closeIncident, incidentLog,
};
