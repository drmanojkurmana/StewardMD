/* functions/_wardsynq/break-glass.js — emergency access to a chart, on the record.
 *
 * A hospital EMR that cannot be opened in an emergency is a hospital EMR that gets worked around: a
 * shared login, a borrowed badge, a password on a whiteboard. Every one of those is worse than a
 * front door with an alarm on it, because none of them leave a name. So break-glass is not a
 * loophole in the access model - it IS part of the access model, and its whole value is that it
 * makes the emergency legible afterwards.
 *
 * WHAT IT IS
 *
 *  1. READ ONLY, ALWAYS. Breaking glass to READ a chart in an emergency is defensible: the patient
 *     is in front of you and the alternative is treating them blind. Breaking glass to WRITE is
 *     not, and this file grants no write of any kind. Writing needs the authority you actually
 *     hold, and if you do not hold it the answer is to call someone who does.
 *
 *  2. ONE PATIENT. Not "the chart", not the ward, not a role change: this patient, because of this
 *     emergency. A grant that widened access generally would be a role escalation wearing a
 *     different hat.
 *
 *  3. TIME-BOXED, AND SHORT. It expires on its own and is never extended in place - a second
 *     emergency is a second declaration with its own reason. Access that quietly becomes permanent
 *     is the failure mode that makes break-glass indistinguishable from a privilege grant.
 *
 *  4. A REASON IS MANDATORY AND IS NOT A MENU. Free text, in the clinician's own words, because the
 *     value of the reason is that a human reads it later and can tell a real emergency from a
 *     habit. A dropdown of five options becomes "other" within a month.
 *
 *  5. ONLY A CLINICIAN. An actor with no clinical business with patients at all - a cashier, HR -
 *     cannot break glass. Break-glass widens what a clinician may see in an emergency; it does not
 *     turn a non-clinician into one.
 *
 *  6. NOTHING AUTOMATIC EVER DECLARES ONE. No AI actor, no rule, no retry. An emergency is declared
 *     by a person who is prepared to have their name on it.
 *
 * WHY IT IS ITS OWN DOOR. The obvious implementation is to teach `resolveClinicalActor` about
 * break-glass so every existing route silently widens. That is exactly what this does NOT do: it
 * would put an escalation path inside the function every clinical route depends on, where a future
 * change could widen far more than intended and no single test would notice. Instead this is a
 * separate, explicit endpoint, and a caller has to ASK for the emergency chart by name. The
 * ordinary doors stay exactly as strict as they were.
 */

import { GovernanceError, makeActor, TIER, KIND } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { Dispatcher, NotifyError } from "../../wardsynq/wardsynq-notify.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "BreakGlassGrant";

/** How long an emergency lasts before it has to be declared again. */
const DEFAULT_MINUTES = 60;
const MAX_MINUTES = 240;

/** What a break-glass reader may see. Deliberately enumerated, and deliberately not everything. */
const EMERGENCY_SCOPE = Object.freeze([
  "Patient", "Encounter", "Condition", "AllergyIntolerance", "Observation",
  "MedicationOrder", "MedicationAdministration", "ServiceRequest", "DiagnosticReport",
  "ClinicalNote", "CriticalResultLoop",
]);

function BreakGlassGrant(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    actorId: i.actorId,
    role: i.role || null,
    reason: i.reason || null,
    grantedAt: i.grantedAt || null,
    expiresAt: i.expiresAt || null,
    revokedAt: i.revokedAt || null,
    revokedBy: i.revokedBy || null,
    /* Every read taken under this grant, counted. Not the content - that is in the audit trail -
     * but the count, so "declared and never used" and "declared and read forty times" are visibly
     * different afterwards. */
    reads: Number.isFinite(i.reads) ? i.reads : 0,
    /* Whether, and how, this declaration was told to anybody AT THE TIME, not merely logged for
     * later. {attempted, delivered, channels[], at} on success; {attempted, delivered:false,
     * reason, detail, at} when there was nothing to tell it to or every channel failed. Never
     * gates the grant itself - see declareBreakGlass's own note on why. */
    notification: i.notification || null,
    source: { system: "wardsynq-native", sourceId: `break-glass:${i.id}` },
  };
}

/** PURE. One grant per (actor, patient, declaration instant). */
function grantIdFor(actorId, patientId, at) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const a = slug(actorId), p = slug(patientId), t = slug(at);
  return a && p && t ? `wsq-bg-${a}-${p}-${t}` : null;
}

/** PURE. Is this grant usable right now? Expiry is COMPUTED; a stored "active" would go stale. */
function isActive(grant, nowMs) {
  if (!grant || grant.revokedAt) return false;
  const exp = Date.parse(grant.expiresAt || "");
  if (!Number.isFinite(exp)) return false;
  return (nowMs || Date.now()) < exp;
}

/** PURE. Minutes requested, clamped. A caller cannot ask for a week. */
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

function summary(g, nowMs) {
  return {
    grantId: g.id, patientId: g.patientId, actorId: g.actorId, role: g.role || null,
    reason: g.reason, grantedAt: g.grantedAt, expiresAt: g.expiresAt,
    revokedAt: g.revokedAt || null, revokedBy: g.revokedBy || null,
    reads: g.reads || 0, active: isActive(g, nowMs), version: g.version,
    // On the REVIEW surface too, not only the declaration's own response: whoever reads the log
    // afterwards can tell "declared and paged" from "declared and told nobody" without cross-
    // referencing anything else.
    notification: g.notification || null,
  };
}

/**
 * Declares an emergency and opens a time-boxed read of ONE patient.
 * ctx: { migration, patientId, reason, minutes?, actorDeps, recordDeps }
 */
async function declareBreakGlass(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  const reason = str(ctx.reason);
  /* A REASON IS MANDATORY. It is the entire accountability of the mechanism: without it a
   * break-glass log is a list of names with no way to tell an emergency from a habit. */
  if (reason.length < 10) {
    return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why this chart must be opened now, in your own words", written: 0 };
  }

  /* Declaring is a WRITE of the grant record, so it resolves as a writer - but note what that does
   * NOT mean: the grant it writes carries no write authority of any kind. See openEmergencyChart. */
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  /* NOTHING AUTOMATIC DECLARES AN EMERGENCY. Refused by name, with a reason a human can read,
   * rather than as a generic governance error further down. */
  if (resolved.actor && resolved.actor.kind === "ai") {
    return { ...base, ok: false, status: 403, error: "human_required", detail: "an emergency is declared by a person who is prepared to have their name on it", written: 0 };
  }

  const grantedAt = new Date().toISOString();
  const minutes = minutesFor(ctx.minutes);
  const id = grantIdFor(resolved.actor.id, patientId, grantedAt);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  /* REAL-TIME NOTIFICATION, added 2026-09-10. THE ACCOUNTABILITY SURFACE this file's own header
   * describes was entirely pull-based: the log exists and somebody must choose to read it. That is
   * real accountability, but it is weaker than it looks for the one thing break-glass exists to
   * bound - an emergency-access grant being used as cover for ordinary browsing, or genuinely
   * abused - because nobody is told AT THE MOMENT it happens. A hospital's compliance/security
   * function finding out a week later, on a routine review, is not the same control as being told
   * now, while the grant is still live and the reader can decide whether to act.
   *
   * THE SAME PRIMITIVE critical-results.js ALREADY USES, wired the same way: attempted BEFORE the
   * grant is written, and the outcome is RECORDED ON THE GRANT ITSELF rather than in a second
   * system - so "declared and told nobody" and "declared and the on-call officer was paged" are
   * visibly different on the one record that already exists for the accountability surface. A site
   * that has wired no channel gets NO_CHANNEL recorded, never a silent "sent" - the same honesty
   * critical-results.js already insists on, and the declaration is NEVER blocked by a failed or
   * absent notification: the clinician is mid-emergency, and refusing the read because a pager did
   * not answer would be the worse failure. */
  let notification;
  try {
    const dispatcher = new Dispatcher(ctx.notifyDeps || {});
    const sent = await dispatcher.send({ grantId: id, patientId, actorId: resolved.actor.id, role: resolved.role || null, reason, expiresAt: new Date(Date.parse(grantedAt) + minutes * 60000).toISOString() });
    notification = { attempted: true, delivered: sent.delivered, channels: sent.attempts.map((a) => ({ channel: a.channel, delivered: a.delivered, detail: a.detail })), at: grantedAt };
  } catch (e) {
    notification = { attempted: true, delivered: false, reason: e instanceof NotifyError ? e.code : "NOTIFY_ERROR", detail: str(e && e.message), at: grantedAt };
  }

  const grant = BreakGlassGrant({
    id, patientId, actorId: resolved.actor.id, role: resolved.role || null,
    reason, grantedAt, expiresAt: new Date(Date.parse(grantedAt) + minutes * 60000).toISOString(),
    notification,
  });
  try {
    const out = await svc.put(grant, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...grant, version: out.record.version }, Date.parse(grantedAt)), minutes, notification };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

/**
 * Reads one patient's chart under an active grant. READ ONLY, and only what EMERGENCY_SCOPE lists.
 * ctx: { migration, patientId, actorDeps, recordDeps }
 */
async function openEmergencyChart(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", chart: null };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", chart: null };

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, chart: null };

  let grants;
  try { grants = await svc.byPatient(TYPE, patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), chart: null }; }

  const nowMs = Date.now();
  const mine = (grants || []).filter((g) => g && g.actorId === resolved.actor.id && isActive(g, nowMs));
  if (!mine.length) {
    return { ...base, ok: false, status: 403, error: "no_active_grant", detail: "declare the emergency first; a break-glass read is never implicit", patientId, chart: null };
  }
  const grant = mine.sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt))[0];

  /* The emergency reader. Built HERE, for this one request and this one patient, rather than by
   * widening the actor every other route resolves - which would put an escalation path inside the
   * function all clinical access depends on. READ tier: this actor cannot write anything, and its
   * write scope is empty rather than merely unused. */
  const reader = makeActor({
    id: resolved.actor.id, kind: KIND.HUMAN, tier: TIER.READ,
    scope: { read: [...EMERGENCY_SCOPE], write: [] },
    onBehalfOf: null,
  });
  const emergency = new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: resolved.tenant, actor: reader, role: resolved.role, roleSource: "break-glass",
  });

  const chart = {};
  for (const type of EMERGENCY_SCOPE) {
    try { chart[type] = type === "Patient" ? [await emergency.get("Patient", patientId)].filter(Boolean) : await emergency.byPatient(type, patientId); }
    catch { chart[type] = []; }
  }

  // Count the read on the grant, so "declared and never used" and "declared and read forty times"
  // are visibly different afterwards. A failure to count never blocks the read: the clinician is
  // mid-emergency, and the audit trail has the access regardless.
  try { await svc.put(BreakGlassGrant({ ...grant, reads: (grant.reads || 0) + 1 }), { expectedVersion: grant.version }); } catch { /* counted best-effort */ }

  return {
    ...base, ok: true, patientId, chart,
    // The reader is always told what they are holding and under what.
    underGrant: { grantId: grant.id, reason: grant.reason, expiresAt: grant.expiresAt, declaredAt: grant.grantedAt },
    scope: [...EMERGENCY_SCOPE],
    readOnly: true,
  };
}

/**
 * Who has broken glass, on whom, and why. THE ACCOUNTABILITY SURFACE: the point of the mechanism is
 * that this list exists and somebody reads it. Visible to the ward, not only to an administrator.
 * ctx: { migration, patientId?, activeOnly?, actorDeps, recordDeps }
 */
async function listBreakGlass(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", grants: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, grants: [] };

  let rows;
  try {
    rows = str(ctx.patientId) ? await svc.byPatient(TYPE, str(ctx.patientId)) : await svc.list(TYPE, 200);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), grants: [] }; }

  const nowMs = Date.now();
  const grants = (rows || []).filter(Boolean).map((g) => summary(g, nowMs))
    .filter((g) => (ctx.activeOnly ? g.active : true))
    // Most recent first: an emergency declared ten minutes ago is the one somebody asks about.
    .sort((a, b) => String(b.grantedAt || "").localeCompare(String(a.grantedAt || "")));
  return { ...base, ok: true, grants, active: grants.filter((g) => g.active).length };
}

export {
  TYPE, DEFAULT_MINUTES, MAX_MINUTES, EMERGENCY_SCOPE, BreakGlassGrant,
  grantIdFor, isActive, minutesFor,
  declareBreakGlass, openEmergencyChart, listBreakGlass,
};
