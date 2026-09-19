/* functions/_wardsynq/med-reconciliation.js — medicines reconciled on the way in and on the way out.
 *
 * The best-evidenced medication harm in hospital medicine is not a wrong dose. It is a HOME MEDICINE
 * THAT QUIETLY STOPPED: the anticoagulant nobody re-prescribed, the antiepileptic omitted for three
 * days, the levothyroxine that never made it onto the chart. Nothing dramatic happens at the moment
 * it is lost, which is exactly why it is lost.
 *
 * WardSynQ could prescribe, schedule, verify and administer, and had no idea what a patient was
 * taking before they arrived. This closes that.
 *
 * UNRECONCILED IS THE DEFAULT, AND IT IS LOUD. Every home medicine starts with NO decision, and the
 * whole point of the record is that it says how many are still undecided. A reconciliation that
 * defaulted to "continued" would be worse than none: it would put an assurance on the chart that
 * nobody actually gave.
 *
 * NOTHING IS EVER DECIDED AUTOMATICALLY, and in particular NOTHING IS MATCHED BY NAME. The obvious
 * feature is to mark a home medicine "continued" when something similar appears among the inpatient
 * orders. That would mark warfarin continued because enoxaparin is on the list, or amlodipine
 * continued because a different calcium blocker is - and it would do it silently, on the exact
 * medicines this file exists to protect. A human decides each one, or it stays undecided.
 *
 * STOPPING AND CHANGING NEED A REASON. Continuing does not. This asymmetry is deliberate: the
 * decisions that cause the harm are the ones that remove or alter a medicine the patient was
 * already stable on, and a reason is what lets the next clinician tell a deliberate stop from an
 * oversight. Requiring one for "continued" would only produce "continued" typed a thousand times.
 *
 * IT DOES NOT PRESCRIBE. Deciding to continue a home medicine records the DECISION; the inpatient
 * order is still written through the ordering path, with its own authority and its own safety
 * checks. A reconciliation that quietly created orders would bypass every control the eMAR has.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "MedicationReconciliation";

/** When reconciliation happens. Both matter, and they are different questions. */
const STAGES = Object.freeze(["admission", "discharge"]);

/** What can be decided about a home medicine. `undecided` is the state everything starts in. */
const DECISIONS = Object.freeze(["undecided", "continued", "stopped", "changed", "held"]);
/** The decisions that remove or alter a medicine the patient was stable on. */
const NEEDS_REASON = Object.freeze(["stopped", "changed", "held"]);

/** Where the list of home medicines came from. Recorded because it changes how much to trust it. */
const SOURCES = Object.freeze(["patient", "carer", "gp-record", "repeat-prescription", "pharmacy", "other"]);

function MedicationReconciliation(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    stage: STAGES.includes(i.stage) ? i.stage : "admission",
    source: SOURCES.includes(i.historySource) ? i.historySource : "other",
    medicines: Array.isArray(i.medicines) ? i.medicines : [],
    startedBy: i.startedBy || null,
    startedAt: i.startedAt || null,
    completedBy: i.completedBy || null,
    completedAt: i.completedAt || null,
  };
}

/** PURE. One reconciliation per (encounter, stage): admission and discharge are separate records. */
function reconciliationIdFor(encounterId, stage) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const e = slug(encounterId), s = slug(stage);
  return e && STAGES.includes(s) ? `wsq-medrec-${e}-${s}` : null;
}

/** PURE. A stable key for one home medicine within a reconciliation. */
function medicineKey(drug) {
  return str(drug).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * PURE. The home-medicine list as it goes on the record. Every entry starts UNDECIDED.
 *
 * A drug with no name is refused rather than recorded as a blank row: an unnamed medicine on a
 * reconciliation list is an item nobody can ever decide, and it would sit there as permanent noise.
 */
function medicinesFrom(rows) {
  const out = [], rejected = [];
  const seen = new Set();
  for (let i = 0; i < (rows || []).length; i++) {
    const r = rows[i] || {};
    const drug = str(r.drug);
    if (!drug) { rejected.push({ index: i, reason: "no_drug_name" }); continue; }
    const key = medicineKey(drug);
    if (seen.has(key)) { rejected.push({ index: i, reason: "duplicate", drug }); continue; }
    seen.add(key);
    out.push({
      key, drug,
      dose: str(r.dose) || null, route: str(r.route) || null, frequency: str(r.frequency) || null,
      // Recorded as reported. This is what the patient or their GP record SAYS, not a verified fact.
      decision: "undecided", reason: null, decidedBy: null, decidedAt: null,
    });
  }
  return { medicines: out, rejected };
}

/** PURE. What a ward needs to see at a glance, and what a discharge summary needs to refuse to hide. */
function reconciliationSummary(rec) {
  const meds = (rec && rec.medicines) || [];
  const counts = {};
  for (const d of DECISIONS) counts[d] = 0;
  for (const m of meds) counts[m.decision] = (counts[m.decision] || 0) + 1;
  return {
    reconciliationId: rec.id, patientId: rec.patientId, encounterId: rec.encounterId || null,
    stage: rec.stage, source: rec.source,
    medicines: meds, counts,
    undecided: counts.undecided || 0,
    /* COMPLETE MEANS EVERY MEDICINE HAS A DECISION - not that somebody pressed a button. A stored
     * "complete" flag would let a reconciliation be declared finished with items still open, which
     * is the precise failure this whole file exists to prevent. */
    complete: meds.length > 0 && (counts.undecided || 0) === 0,
    empty: meds.length === 0,
    startedBy: rec.startedBy || null, startedAt: rec.startedAt || null,
    completedBy: rec.completedBy || null, completedAt: rec.completedAt || null,
    version: rec.version,
  };
}

/**
 * PURE. The lines a discharge summary carries. Undecided medicines are named OUTRIGHT rather than
 * omitted: a summary that listed only the decided ones would read as a complete reconciliation.
 */
function reconciliationForSummary(rec) {
  if (!rec || !(rec.medicines || []).length) return null;
  const by = (d) => rec.medicines.filter((m) => m.decision === d);
  const line = (m) => `${m.drug}${m.dose ? ` ${m.dose}` : ""}${m.frequency ? `, ${m.frequency}` : ""}${m.reason ? ` - ${m.reason}` : ""}`;
  const parts = [];
  const cont = by("continued"); if (cont.length) parts.push(`Continued:\n${cont.map(line).join("\n")}`);
  const chg = by("changed"); if (chg.length) parts.push(`Changed:\n${chg.map(line).join("\n")}`);
  const stop = by("stopped"); if (stop.length) parts.push(`Stopped:\n${stop.map(line).join("\n")}`);
  const held = by("held"); if (held.length) parts.push(`Held:\n${held.map(line).join("\n")}`);
  const open = by("undecided");
  if (open.length) parts.push(`NOT RECONCILED - no decision was recorded for these:\n${open.map(line).join("\n")}`);
  return parts.join("\n\n");
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

/**
 * Records the home-medicine list and opens the reconciliation. Every entry starts undecided.
 * ctx: { migration, encounterId, stage, medicines, historySource?, actorDeps, recordDeps }
 */
async function startReconciliation(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId);
  const stage = str(ctx.stage) || "admission";
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (!STAGES.includes(stage)) return { ...base, ok: false, status: 400, error: "unknown_stage", detail: `stage must be one of ${STAGES.join(", ")}`, written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let encounter;
  try { encounter = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };

  const { medicines, rejected } = medicinesFrom(ctx.medicines);
  const id = reconciliationIdFor(encounterId, stage);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  /* Re-stating the list KEEPS decisions already made about medicines still on it. A second pass
   * (the pharmacist arrives with the GP record after the nurse took a history) must not wipe the
   * work already done - and a medicine that has DISAPPEARED from the list is dropped, because it
   * was not something the patient takes. */
  const prior = new Map(((current && current.medicines) || []).map((m) => [m.key, m]));
  const merged = medicines.map((m) => {
    const was = prior.get(m.key);
    return was ? { ...m, decision: was.decision, reason: was.reason, decidedBy: was.decidedBy, decidedAt: was.decidedAt } : m;
  });

  const rec = MedicationReconciliation({
    id, patientId: encounter.patientId, encounterId, stage,
    historySource: str(ctx.historySource),
    medicines: merged,
    startedBy: (current && current.startedBy) || resolved.actor.id,
    startedAt: (current && current.startedAt) || new Date().toISOString(),
  });
  try {
    const out = await svc.put(rec, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...reconciliationSummary({ ...rec, version: out.record.version }), ...(rejected.length ? { rejected } : {}), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { reconciliationId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * Records one decision about one home medicine.
 * ctx: { migration, encounterId, stage, key, decision, reason?, actorDeps, recordDeps }
 */
async function decideMedicine(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const stage = str(ctx.stage) || "admission";
  const id = reconciliationIdFor(str(ctx.encounterId), stage);
  if (!id) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };

  const decision = str(ctx.decision).toLowerCase();
  if (!DECISIONS.includes(decision) || decision === "undecided") {
    return { ...base, ok: false, status: 400, error: "unknown_decision", detail: `decision must be one of ${DECISIONS.filter((d) => d !== "undecided").join(", ")}`, written: 0 };
  }
  const reason = str(ctx.reason);
  /* STOPPING AND CHANGING NEED A REASON; CONTINUING DOES NOT. The decisions that cause the harm are
   * the ones that remove or alter a medicine the patient was already stable on, and the reason is
   * what lets the next clinician tell a deliberate stop from an oversight. */
  if (NEEDS_REASON.includes(decision) && !reason) {
    return { ...base, ok: false, status: 422, error: "reason_required", detail: `say why this medicine was ${decision}`, written: 0 };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "reconciliation_not_found", detail: "record the home medicines first", reconciliationId: id, written: 0 };

  const key = medicineKey(ctx.key || ctx.drug);
  const idx = (current.medicines || []).findIndex((m) => m.key === key);
  // A decision about a medicine that is not on the list is refused, never appended: it would create
  // an entry nobody took a history for.
  if (idx < 0) return { ...base, ok: false, status: 404, error: "medicine_not_on_list", detail: "this medicine is not on the reconciliation list", key, written: 0 };

  const now = new Date().toISOString();
  const medicines = current.medicines.map((m, i) => (i === idx
    ? { ...m, decision, reason: reason || null, decidedBy: resolved.actor.id, decidedAt: now }
    : m));
  const rec = MedicationReconciliation({
    ...current, medicines, historySource: current.source,
    // Completion is derived from the medicines, never set: see reconciliationSummary.
    completedBy: medicines.every((m) => m.decision !== "undecided") ? resolved.actor.id : null,
    completedAt: medicines.every((m) => m.decision !== "undecided") ? now : null,
  });
  try {
    const out = await svc.put(rec, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...reconciliationSummary({ ...rec, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { reconciliationId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/** Reads one, or both stages. ctx: { migration, encounterId, stage?, actorDeps, recordDeps } */
async function readReconciliation(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", reconciliations: [] };

  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", reconciliations: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, reconciliations: [] };

  const want = STAGES.includes(str(ctx.stage)) ? [str(ctx.stage)] : STAGES;
  const out = [];
  for (const stage of want) {
    const id = reconciliationIdFor(encounterId, stage);
    try { const r = await svc.get(TYPE, id); if (r) out.push(reconciliationSummary(r)); } catch { /* absent is absent */ }
  }
  return {
    ...base, ok: true, encounterId, reconciliations: out,
    // The number a ward acts on, across both stages.
    undecided: out.reduce((n, r) => n + r.undecided, 0),
  };
}

export {
  TYPE, STAGES, DECISIONS, NEEDS_REASON, SOURCES, MedicationReconciliation,
  reconciliationIdFor, medicineKey, medicinesFrom, reconciliationSummary, reconciliationForSummary,
  startReconciliation, decideMedicine, readReconciliation,
};
