/* functions/_wardsynq/critical-results.js — the closed loop on a critical result.
 *
 * `DiagnosticReport.critical` has been on the canonical model since P0 with a comment saying it
 * "gates closed-loop critical-value escalation", and wardsynq-simulation.js asserts the invariant
 * "No critical result loop was closed without an acknowledgement" — against a world nothing in the
 * record path ever populated. The flag was captured and then nothing happened to it. This is the
 * loop it was always supposed to gate.
 *
 * WHY THIS AND NOT SOMETHING ELSE: a critical result that reaches a chart nobody reads is the
 * oldest preventable death in hospital medicine. The lab is not the failure point - the lab
 * measured it correctly and flagged it. The failure is that no named human ever said "I have seen
 * this and here is what I did." So that acknowledgement is the ONLY thing that closes a loop here,
 * and it is the only thing that can.
 *
 * THE RULES, AND WHY EACH ONE IS ABSOLUTE
 *
 * 1. THE LAB'S OWN FLAG ALWAYS WINS. If the analyser or the pathologist marked a result critical,
 *    it is critical, whatever this file's table says. The table can only ever ADD. Software that
 *    can talk a laboratory out of its own critical flag is not a safety feature.
 *
 * 2. THE LIMITS ARE A DEFAULT, NOT A STANDARD. `DEFAULT_CRITICAL_LIMITS` are common adult values
 *    and every one of them is wrong for someone: a neonate, a dialysis patient with a chronically
 *    high potassium, an oncology patient living at a platelet count that would alarm anyone else.
 *    They are org-configurable and a site is expected to replace them with its own laboratory's
 *    agreed limits. `basis` records which source flagged a result so a reader can always tell a
 *    lab's flag from this table's opinion.
 *
 * 3. ACKNOWLEDGING IS NOT RESOLVING. It records that a named clinician saw the result and what they
 *    did. It does not say the patient is better, and it never closes anything on its own.
 *
 * 4. NOTHING AUTOMATIC EVER ACKNOWLEDGES. Not a timer, not a rule, not AI. An acknowledgement with
 *    no human behind it is worse than an open loop, because an open loop still looks open.
 *
 * 5. AN UNACKNOWLEDGED LOOP IS NEVER SILENTLY CLOSED. It stays open, it is listed, and the longer
 *    it stays open the louder it gets. Escalation is computed from elapsed time, never stored as a
 *    fact that could go stale.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { numericValue } from "../../wardsynq/wardsynq-model.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** The states the simulation invariant already names. `closed` requires an acknowledgement. */
const STATES = Object.freeze(["open", "acknowledged", "closed"]);

/* Adult critical limits, keyed by the LOINC codes LAB_CODE_SEED already produces so there is no
 * second vocabulary to drift. `low`/`high` are the OUTSIDE-OF bounds: a value <= low or >= high is
 * critical. `unit` is what the bound is expressed in, and a result reported in anything else is NOT
 * compared - see `classify`.
 *
 * SOURCED, NOT INVENTED, and deliberately conservative. These are the widely published adult
 * critical-value ranges; they are a STARTING POINT that a site's own laboratory must review and
 * replace. Nothing here is a regulatory threshold and this file does not claim one. */
const DEFAULT_CRITICAL_LIMITS = Object.freeze({
  "2823-3": Object.freeze({ display: "Potassium", unit: "mmol/L", low: 2.8, high: 6.2 }),
  "2951-2": Object.freeze({ display: "Sodium", unit: "mmol/L", low: 120, high: 160 }),
  "2345-7": Object.freeze({ display: "Glucose", unit: "mg/dL", low: 45, high: 450 }),
  "718-7": Object.freeze({ display: "Haemoglobin", unit: "g/dL", low: 6.5, high: null }),
  "777-3": Object.freeze({ display: "Platelets", unit: "10*3/uL", low: 20, high: null }),
  "6690-2": Object.freeze({ display: "Leukocytes", unit: "10*3/uL", low: 1, high: 50 }),
  "6301-6": Object.freeze({ display: "INR", unit: "{INR}", low: null, high: 5 }),
  "2524-7": Object.freeze({ display: "Lactate", unit: "mmol/L", low: null, high: 4 }),
  "2160-0": Object.freeze({ display: "Creatinine", unit: "mg/dL", low: null, high: 7 }),
  "1975-2": Object.freeze({ display: "Bilirubin total", unit: "mg/dL", low: null, high: 15 }),
});

/** How long an open loop may sit before it is called overdue, by how loud it already is. */
const DEFAULT_ESCALATION = Object.freeze({ acknowledgeWithinMinutes: 30, escalateAfterMinutes: 60 });

/** PURE. Units that mean the same thing, so a result is not skipped over a spelling. */
const UNIT_ALIASES = Object.freeze({
  "mmol/l": "mmol/L", "mmol/L": "mmol/L",
  "mg/dl": "mg/dL", "mg/dL": "mg/dL",
  "g/dl": "g/dL", "g/dL": "g/dL", "gm/dl": "g/dL", "gm%": "g/dL", "g%": "g/dL",
  "10*3/ul": "10*3/uL", "10*3/uL": "10*3/uL", "10^3/ul": "10*3/uL", "x103/ul": "10*3/uL",
  "/ul": "10*3/uL_raw", "cells/ul": "10*3/uL_raw", "/cumm": "10*3/uL_raw", "/cmm": "10*3/uL_raw",
  "{inr}": "{INR}", "": "{INR}_bare",
});
function canonUnit(u) {
  const k = str(u);
  return UNIT_ALIASES[k] || UNIT_ALIASES[k.toLowerCase()] || k;
}

/** PURE. The site's limits, with any org override applied per analyte. */
function limitsFor(overrides) {
  const out = { ...DEFAULT_CRITICAL_LIMITS };
  const o = overrides && typeof overrides === "object" ? overrides : {};
  for (const code of Object.keys(o)) {
    const v = o[code];
    if (!v || typeof v !== "object") continue;
    const low = v.low == null ? null : Number(v.low);
    const high = v.high == null ? null : Number(v.high);
    // A limit with neither bound, or with non-numeric ones, would silently switch that analyte off.
    // Fall back to the default rather than to no limit at all.
    const lowOk = low === null || Number.isFinite(low);
    const highOk = high === null || Number.isFinite(high);
    if (!lowOk || !highOk || (low === null && high === null)) continue;
    out[code] = Object.freeze({
      display: str(v.display) || (out[code] && out[code].display) || code,
      unit: str(v.unit) || (out[code] && out[code].unit) || null,
      low, high,
    });
  }
  return out;
}

/**
 * PURE. Is this observation critical, and on whose authority?
 *
 * Returns null when it is not, else { critical: true, basis, code, display, value, unit, bound }.
 *
 * `basis` is "lab" when the laboratory flagged it and "limit" when this file's table did. That
 * distinction is kept all the way to the screen: a reader must always be able to tell a laboratory's
 * own critical flag from a threshold somebody configured.
 */
function classify(obs, limits) {
  if (!obs) return null;
  const table = limits || DEFAULT_CRITICAL_LIMITS;

  // 1. The lab said so. Nothing here can talk it out of that, including a missing or odd unit.
  if (obs.sourceCritical === true || obs.critical === true) {
    return { critical: true, basis: "lab", code: obs.code, display: obs.display || obs.code, value: obs.value, unit: obs.unit || null, bound: null };
  }

  const spec = table[str(obs.code)];
  if (!spec) return null;

  const value = numericValue(obs.value);
  // A result that is not plainly one number is NOT compared and NOT flagged. "Haemolysed", "<0.01"
  // and "see report" are real lab answers, and guessing a number out of one to test it against a
  // threshold would produce both false alarms and, far worse, false silence.
  if (value === null) return null;

  // A value in unknown or mismatched units is not comparable. Reporting it as within limits would
  // be a false reassurance, so it is reported as UNCOMPARABLE instead of as normal.
  const want = canonUnit(spec.unit), got = canonUnit(obs.unit);
  if (spec.unit && got !== want) {
    return { critical: false, uncomparable: true, basis: "unit-mismatch", code: obs.code, display: spec.display, value: obs.value, unit: obs.unit || null, expectedUnit: spec.unit };
  }

  if (spec.low !== null && value <= spec.low) {
    return { critical: true, basis: "limit", code: obs.code, display: spec.display, value, unit: obs.unit || spec.unit, bound: { side: "low", limit: spec.low } };
  }
  if (spec.high !== null && value >= spec.high) {
    return { critical: true, basis: "limit", code: obs.code, display: spec.display, value, unit: obs.unit || spec.unit, bound: { side: "high", limit: spec.high } };
  }
  return null;
}

/** PURE. One loop per (report, analyte): a re-ingested result reopens nothing and duplicates nothing. */
function loopIdFor(reportId, code) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const r = slug(reportId), c = slug(code);
  return r && c ? `wsq-crit-${r}-${c}` : null;
}

/**
 * PURE. How overdue an open loop is. COMPUTED, never stored: a stored "overdue" becomes a lie the
 * moment the clock moves past it, and this is exactly the fact that must not be able to go stale.
 */
function escalationOf(loop, nowMs, policy) {
  const p = { ...DEFAULT_ESCALATION, ...(policy || {}) };
  if (!loop || loop.state !== "open") return { level: "none", minutesOpen: 0 };
  const since = Date.parse(loop.reportedAt || loop.openedAt || "");
  if (!Number.isFinite(since)) return { level: "none", minutesOpen: 0 };
  const mins = Math.max(0, Math.round(((nowMs || Date.now()) - since) / 60000));
  if (mins >= p.escalateAfterMinutes) return { level: "escalate", minutesOpen: mins, after: p.escalateAfterMinutes };
  if (mins >= p.acknowledgeWithinMinutes) return { level: "overdue", minutesOpen: mins, after: p.acknowledgeWithinMinutes };
  return { level: "due", minutesOpen: mins, within: p.acknowledgeWithinMinutes };
}

/* A critical result loop, as a record. Not a canonical FHIR resource: there is no FHIR type for
 * "somebody must look at this", and inventing a clinical resource for a workflow fact would put a
 * process artefact into the clinical record where a reader would mistake it for one. It is stored
 * under its own type, versioned like everything else, so the whole life of the loop is on the
 * record and an acknowledgement can never be edited away. */
function CriticalResultLoop(input) {
  const i = input || {};
  return {
    resourceType: "CriticalResultLoop",
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    reportId: i.reportId || null,
    observationId: i.observationId || null,
    code: i.code, display: i.display || i.code,
    value: i.value == null ? null : i.value, unit: i.unit || null,
    basis: i.basis,                       // "lab" | "limit" — whose authority flagged this
    bound: i.bound || null,
    state: STATES.includes(i.state) ? i.state : "open",
    reportedAt: i.reportedAt || null,     // when the RESULT was reported: the clock the loop runs on
    openedAt: i.openedAt || null,
    acknowledgedBy: i.acknowledgedBy || null,
    acknowledgedAt: i.acknowledgedAt || null,
    action: i.action || null,             // what the clinician did about it, in their words
    closedBy: i.closedBy || null,
    closedAt: i.closedAt || null,
    source: i.source || { system: "wardsynq-native", sourceId: `critical:${i.id}` },
  };
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

/**
 * Opens a loop for every critical value on a report. Idempotent: re-ingesting the same result finds
 * the same loop id and, crucially, does NOT reopen one a clinician has already acknowledged.
 *
 * ctx: { migration, reportId, observations?, limits?, actorDeps, recordDeps }
 */
async function openCriticalLoops(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", opened: 0, loops: [] };

  const reportId = str(ctx.reportId);
  if (!reportId) return { ...base, ok: false, status: 422, error: "report_required", opened: 0, loops: [] };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, opened: 0, loops: [] };

  let report;
  try { report = await svc.get("DiagnosticReport", reportId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), opened: 0, loops: [] }; }
  if (!report) return { ...base, ok: false, status: 404, error: "report_not_found", reportId, opened: 0, loops: [] };

  let observations = Array.isArray(ctx.observations) ? ctx.observations : null;
  if (!observations) {
    const ids = report.resultObservationIds || [];
    observations = [];
    for (const id of ids) {
      try { const o = await svc.get("Observation", id); if (o) observations.push(o); } catch { /* a missing row is reported below, never guessed at */ }
    }
  }

  const table = limitsFor(ctx.limits);
  const reportedAt = report.reportedAt || (report.meta && report.meta.effectiveAt) || new Date().toISOString();
  const out = [], uncomparable = [];
  let opened = 0;

  /* A report the LAB flagged critical, whose individual rows carry no flag we can attribute, still
   * gets a loop. Dropping it because the row-level detail is thinner than the header would be
   * exactly the silent failure this whole file exists to prevent. */
  const anyRowCritical = observations.some((o) => classify(o, table) && classify(o, table).critical);
  const rows = observations.slice();
  if (report.critical && !anyRowCritical) {
    rows.push({ code: report.code, display: report.code, value: null, unit: null, sourceCritical: true, id: null });
  }

  for (const obs of rows) {
    const hit = classify(obs, table);
    if (!hit) continue;
    if (hit.uncomparable) { uncomparable.push(hit); continue; }

    const id = loopIdFor(reportId, hit.code);
    if (!id) continue;
    let current;
    try { current = await svc.get("CriticalResultLoop", id); }
    catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), opened, loops: out }; }
    // Already known. An acknowledged or closed loop is NEVER reopened by a re-ingest: that would
    // discard a clinician's acknowledgement because a message arrived twice.
    if (current) { out.push(summary(current)); continue; }

    const loop = CriticalResultLoop({
      id, patientId: report.patientId, encounterId: report.encounterId || null,
      reportId, observationId: obs.id || null,
      code: hit.code, display: hit.display, value: hit.value, unit: hit.unit,
      basis: hit.basis, bound: hit.bound, state: "open",
      reportedAt, openedAt: new Date().toISOString(),
    });
    try {
      const res = await svc.put(loop, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:${id}` : null });
      opened += 1;
      out.push(summary({ ...loop, version: res.record.version }));
    } catch (e) {
      return { ...base, ...writeFailure(e, { loopId: id, opened, loops: out, actor: resolved.actor.id }) };
    }
  }
  return {
    ...base, ok: true, reportId, opened, loops: out,
    // Never silently dropped: a value nobody could compare is reported as uncomparable, not normal.
    ...(uncomparable.length ? { uncomparable } : {}),
  };
}

function summary(l, nowMs, policy) {
  return {
    loopId: l.id, patientId: l.patientId, encounterId: l.encounterId || null,
    reportId: l.reportId, observationId: l.observationId || null,
    code: l.code, display: l.display, value: l.value, unit: l.unit,
    basis: l.basis, bound: l.bound || null, state: l.state,
    reportedAt: l.reportedAt, openedAt: l.openedAt,
    acknowledgedBy: l.acknowledgedBy || null, acknowledgedAt: l.acknowledgedAt || null,
    action: l.action || null, closedBy: l.closedBy || null, closedAt: l.closedAt || null,
    version: l.version,
    escalation: escalationOf(l, nowMs, policy),
  };
}

/**
 * A named clinician acknowledges a critical result and says what they did about it.
 *
 * ctx: { migration, loopId, action, close?, actorDeps, recordDeps }
 */
async function acknowledgeCritical(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const loopId = str(ctx.loopId);
  if (!loopId) return { ...base, ok: false, status: 422, error: "loop_required", written: 0 };
  const action = str(ctx.action);
  // An acknowledgement with no action recorded is a tick-box. The whole value of closing this loop
  // is the sentence saying what was done, so it is required rather than optional.
  if (!action) return { ...base, ok: false, status: 422, error: "action_required", detail: "say what was done about this result", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  /* NOTHING AUTOMATIC ACKNOWLEDGES. An AI actor is capped below EXECUTE by kind and would be
   * refused by the store anyway, but this refuses it here, by name and with a reason a human can
   * read, rather than letting it surface as a generic governance error. */
  if (resolved.actor && resolved.actor.kind === "ai") {
    return { ...base, ok: false, status: 403, error: "human_required", detail: "a critical result is acknowledged by a clinician, never by an automated actor", written: 0 };
  }

  let current;
  try { current = await svc.get("CriticalResultLoop", loopId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "loop_not_found", loopId, written: 0 };
  if (current.state === "closed") {
    return { ...base, ok: false, status: 409, error: "already_closed", detail: "this loop is closed; a further note is a new clinical entry, not a second acknowledgement", loopId, version: current.version, written: 0 };
  }

  const now = new Date().toISOString();
  const next = CriticalResultLoop({
    ...current,
    // The FIRST acknowledgement is the one that counts, and it is never overwritten: it is the
    // record of who saw this and when, which is the whole point of the loop.
    acknowledgedBy: current.acknowledgedBy || resolved.actor.id,
    acknowledgedAt: current.acknowledgedAt || now,
    action: current.action ? `${current.action}\n${action}` : action,
    state: ctx.close ? "closed" : "acknowledged",
    closedBy: ctx.close ? resolved.actor.id : null,
    closedAt: ctx.close ? now : null,
  });
  try {
    const res = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...next, version: res.record.version }), actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { loopId, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * The open critical results, loudest first. This is the list a ward has to be able to see.
 * ctx: { migration, patientId?, state?, now?, policy?, actorDeps, recordDeps }
 */
async function listCriticalLoops(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", loops: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, loops: [] };

  let rows;
  try {
    rows = str(ctx.patientId)
      ? await svc.byPatient("CriticalResultLoop", str(ctx.patientId))
      : await svc.list("CriticalResultLoop", 200);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), loops: [] }; }

  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const want = str(ctx.state);
  const RANK = { escalate: 0, overdue: 1, due: 2, none: 3 };
  const loops = (rows || []).filter(Boolean)
    // Default is what is NOT finished. A ward list that showed closed loops by default would bury
    // the open ones, which is the failure mode this list exists to prevent.
    .filter((l) => (want ? l.state === want : l.state !== "closed"))
    .map((l) => summary(l, nowMs, ctx.policy))
    .sort((a, b) => (RANK[a.escalation.level] - RANK[b.escalation.level])
      || String(a.reportedAt || "").localeCompare(String(b.reportedAt || "")));
  return { ...base, ok: true, loops, open: loops.filter((l) => l.state === "open").length };
}

export {
  STATES, DEFAULT_CRITICAL_LIMITS, DEFAULT_ESCALATION, CriticalResultLoop,
  canonUnit, limitsFor, classify, loopIdFor, escalationOf,
  openCriticalLoops, acknowledgeCritical, listCriticalLoops,
};
