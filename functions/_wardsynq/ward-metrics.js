/* functions/_wardsynq/ward-metrics.js — what the ward should be worried about, counted.
 *
 * Every safety mechanism in WardSynQ produces an OPEN ITEM when something is unfinished: a critical
 * result nobody acknowledged, a dose still in flight, a home medicine nobody decided about, a
 * handover nobody took. Each of those is visible on its own screen, to whoever happens to open it.
 * Nothing counted them, so nothing could answer the question a charge nurse actually asks at
 * handover: WHAT IS OUTSTANDING ON THIS WARD RIGHT NOW.
 *
 * IT COUNTS, IT DOES NOT JUDGE. Every number here is a plain count of records in a state, derived
 * live. There are no targets, no scores, no traffic lights and no "quality" ratings, because a
 * derived score invites being managed instead of the thing it stands for - and a ward that learns
 * to keep a number green will keep the number green. A count of unacknowledged critical results is
 * a fact somebody can act on; a "safety score of 82" is not.
 *
 * IT IS COMPUTED, NEVER STORED. A stored metric is a stale metric, and a dashboard that quietly
 * lags behind the ward is worse than no dashboard: it says "nothing outstanding" about a ward where
 * something is. Everything here is read at the moment it is asked for.
 *
 * NO PATIENT IS NAMED. This is a count of open items, not a chart, and the safest ward dashboard is
 * one that cannot leak a diagnosis to whoever glances at the screen at the nurses' station. Where a
 * clinician needs to know WHICH patient, they open the ward list, which applies its own access
 * rules. The one exception is a patient identifier on the oldest open critical result, because
 * "something has been unacknowledged for three hours" is not actionable without knowing whose.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { escalationOf } from "./critical-results.js";
import { reconciliationSummary } from "./med-reconciliation.js";

const str = (v) => (v == null ? "" : String(v).trim());
const IPD = "IPD", OPEN_ENC = "in-progress";

/** Administration states that mean a dose was started and never finished. */
const IN_FLIGHT = Object.freeze(["ordered", "verified", "dispensed", "scanned", "held"]);

/**
 * PURE. The ward's open items, from records already read.
 *
 * Takes everything as input so it can be tested exactly, and so the read policy stays in the caller
 * where the actor's scope is applied.
 */
function summariseWard(input) {
  const i = input || {};
  const nowMs = Number.isFinite(i.nowMs) ? i.nowMs : Date.now();
  const want = str(i.ward).toLowerCase();

  // ED patients are open encounters this ward is responsible for too - excluding them would report
  // zero open critical results and zero in-flight medications for an ED at full capacity.
  const stays = (i.encounters || []).filter((e) => e && (e.class === IPD || e.class === "ED") && e.status === OPEN_ENC)
    .filter((e) => !want || str(e.location && e.location.ward).toLowerCase() === want);
  const patientIds = new Set(stays.map((e) => e.patientId));
  const mine = (r) => !want || patientIds.has(r && r.patientId);

  // Occupancy. `unplaced` is admitted-to-a-ward-without-a-bed, which is a real state and not zero.
  const beds = new Map();
  let unplaced = 0;
  for (const e of stays) {
    const bed = str(e.location && e.location.bed);
    if (!bed) { unplaced += 1; continue; }
    const w = str(e.location && e.location.ward) || "(no ward)";
    beds.set(`${w.toLowerCase()}|${bed.toLowerCase()}`, true);
  }

  const criticals = (i.criticalLoops || []).filter((l) => l && mine(l) && l.state === "open");
  const escalated = criticals.filter((l) => escalationOf(l, nowMs, i.escalationPolicy).level === "escalate");
  // The oldest open one, with its patient, because "unacknowledged for three hours" is not
  // actionable without knowing whose.
  const oldest = criticals.slice().sort((a, b) => String(a.reportedAt || "").localeCompare(String(b.reportedAt || "")))[0] || null;

  const inFlight = (i.administrations || []).filter((a) => a && mine(a) && IN_FLIGHT.includes(str(a.status)));
  const waitingHandovers = (i.handovers || []).filter((h) => h && mine(h) && !h.receivedBy);

  const recs = (i.reconciliations || []).filter((r) => r && mine(r)).map(reconciliationSummary);
  const unreconciled = recs.reduce((n, r) => n + r.undecided, 0);
  // A stay with NO reconciliation at all is its own number: nobody having taken a history is a
  // different failure from a history taken and left undecided, and lumping them hides the first.
  const withRec = new Set(recs.map((r) => r.encounterId));
  const noHistory = stays.filter((e) => !withRec.has(e.id)).length;

  const unverified = (i.orders || []).filter((o) => o && mine(o) && o.status === "active")
    .filter((o) => !(i.verifications || []).some((v) => v && v.orderId === o.id && v.outcome === "verified" && Number(v.orderVersion) === Number(o.version))).length;

  return {
    ward: str(i.ward) || null,
    computedAt: new Date(nowMs).toISOString(),
    patients: stays.length,
    occupiedBeds: beds.size,
    unplaced,
    open: {
      criticalResults: criticals.length,
      criticalResultsEscalated: escalated.length,
      dosesInFlight: inFlight.length,
      handoversWaiting: waitingHandovers.length,
      medicinesUndecided: unreconciled,
      staysWithNoMedicationHistory: noHistory,
      ordersNotPharmacyVerified: unverified,
    },
    // One number a charge nurse can hold in their head, and it is a SUM of the open items above -
    // not a score, not weighted, not normalised. It goes up when something is unfinished and down
    // when somebody finishes it, and it cannot be improved by anything except doing the work.
    openItems: criticals.length + inFlight.length + waitingHandovers.length + unreconciled + noHistory + unverified,
    oldestUnacknowledgedCritical: oldest ? {
      loopId: oldest.id, patientId: oldest.patientId, display: oldest.display,
      reportedAt: oldest.reportedAt, escalation: escalationOf(oldest, nowMs, i.escalationPolicy),
    } : null,
  };
}

async function open(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
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

/** ctx: { migration, ward?, escalationPolicy?, actorDeps, recordDeps } */
async function wardMetrics(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", metrics: null };

  const { svc, error } = await open(request, env, ctx);
  if (error) return { ...base, ...error, metrics: null };

  const read = async (type, limit) => { try { return await svc.list(type, limit || 300); } catch { return null; } };
  const [encounters, criticalLoops, administrations, handovers, reconciliations, orders, verifications] = await Promise.all([
    read("Encounter"), read("CriticalResultLoop"), read("MedicationAdministration"),
    read("ShiftHandover"), read("MedicationReconciliation"), read("MedicationOrder"), read("MedicationVerification"),
  ]);

  /* A type this actor may not read comes back null, and its counts are OMITTED rather than reported
   * as zero. "No unacknowledged critical results" and "you cannot see the critical results" are
   * different facts, and a dashboard that renders the second as the first is precisely the false
   * reassurance every other file here refuses to give. */
  const unreadable = [];
  const orZero = (rows, name) => { if (rows === null) { unreadable.push(name); return []; } return rows; };

  const metrics = summariseWard({
    ward: ctx.ward, escalationPolicy: ctx.escalationPolicy,
    encounters: orZero(encounters, "Encounter"),
    criticalLoops: orZero(criticalLoops, "CriticalResultLoop"),
    administrations: orZero(administrations, "MedicationAdministration"),
    handovers: orZero(handovers, "ShiftHandover"),
    reconciliations: orZero(reconciliations, "MedicationReconciliation"),
    orders: orZero(orders, "MedicationOrder"),
    verifications: orZero(verifications, "MedicationVerification"),
  });
  return { ...base, ok: true, metrics, ...(unreadable.length ? { unreadable, partial: true } : {}) };
}

export { IN_FLIGHT, summariseWard, wardMetrics };
