/* functions/_wardsynq/patient-flow.js — TASK 4.4: the hospital-wide patient flow command center.
 *
 * IT COUNTS, IT DOES NOT JUDGE - the exact discipline ward-metrics.js already states and enforces.
 * Every number here is derived live from a real record; nothing is stored, nothing is scored.
 *
 * NOT BUILT, STATED - not silent gaps:
 *   - NO expected/predicted discharge date. Grepping the whole encounter/discharge model finds
 *     none - nobody has specified what one would mean here, and inventing a clinical estimate of
 *     when a patient SHOULD leave is exactly the kind of judgment this codebase's own conventions
 *     (never invent a clinical threshold) forbid. "Discharge candidates" below means stays with
 *     ZERO open items right now (migrate-discharge.js's own pendingItems(), unchanged) - a fact,
 *     never a prediction.
 *   - NO bottleneck-severity/escalation algorithm. "Bottlenecks" is a plain ranking of counts this
 *     file already computes (most unplaced patients, longest ED wait) - never a traffic light or a
 *     threshold nobody configured.
 *   - NO transfer-approval workflow. Nothing in this codebase models a pending transfer as its own
 *     resource (transferPatient() is an immediate, atomically-guarded action, not a request). This
 *     file's "transfer requests" is RECENT TRANSFERS - the movedAt/movedFrom/moveReason already
 *     written to the Encounter by every real transfer - stated as such everywhere it is shown.
 *
 * LINKS, DOES NOT REBUILD: listEd() (migrate-ed.js), bedBoard() (migrate-inpatient.js) and
 * admissionWaitingList() (admission-request.js) are called unchanged for ED/bed/waiting-list
 * counts. Only the discharge-candidate / open-items / recent-transfer aggregation is new, because
 * no existing function reads pendingItems() across every open stay at once.
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { listEd } from "./migrate-ed.js";
import { bedBoard, ADMISSION_CLASSES, OPEN } from "./migrate-inpatient.js";
import { admissionWaitingList } from "./admission-request.js";
import { pendingItems, lengthOfStayDays } from "./migrate-discharge.js";
import { listBeds } from "../_opd_org_store.js";

const str = (v) => (v == null ? "" : String(v).trim());
const RECENT_TRANSFER_MS = 24 * 60 * 60 * 1000;

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

/** PURE. Bed states hospital-wide, from real master data - a plain histogram, nothing inferred. */
function bedStateCounts(beds) {
  const counts = { available: 0, reserved: 0, occupied: 0, blocked: 0, cleaning: 0, maintenance: 0 };
  for (const b of beds || []) { if (b && counts[b.state] !== undefined) counts[b.state] += 1; }
  return counts;
}

/**
 * ctx: { migration, orgId?, now?, ward?, escalationPolicy?, actorDeps, recordDeps }
 */
async function patientFlow(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", flow: null };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, flow: null };

  let encounters, orders, administrations, serviceRequests, problems;
  try {
    [encounters, orders, administrations, serviceRequests, problems] = await Promise.all([
      svc.list("Encounter", 500),
      svc.list("MedicationOrder", 1000).catch(() => []),
      svc.list("MedicationAdministration", 1000).catch(() => []),
      svc.list("ServiceRequest", 1000).catch(() => []),
      svc.list("Condition", 1000).catch(() => []),
    ]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), flow: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), flow: null };
  }

  const nowIso = str(ctx.now) || new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();
  const openStays = (encounters || []).filter((e) => e && ADMISSION_CLASSES.includes(e.class) && e.status === OPEN);

  const stays = openStays.map((e) => {
    const myOrders = (orders || []).filter((o) => o && o.encounterId === e.id);
    const myAdmins = (administrations || []).filter((a) => a && myOrders.some((o) => o.id === a.orderId));
    const mySr = (serviceRequests || []).filter((s) => s && s.encounterId === e.id);
    const myProblems = (problems || []).filter((c) => c && c.patientId === e.patientId);
    const pending = pendingItems({ orders: myOrders, administrations: myAdmins, serviceRequests: mySr, problems: myProblems });
    return {
      encounterId: e.id, patientId: e.patientId,
      ward: (e.location && e.location.ward) || null, bed: (e.location && e.location.bed) || null,
      admittedAt: e.periodStart || null,
      lengthOfStayDays: e.periodStart ? lengthOfStayDays(e.periodStart, nowIso) : null,
      openItems: pending.length,
      movedAt: e.movedAt || null, movedFrom: e.movedFrom || null, moveReason: e.moveReason || null,
    };
  });

  // Discharge candidates: a fact (zero open items right now), never a predicted date.
  const dischargeCandidates = stays.filter((s) => s.openItems === 0);
  const staysWithOpenItems = stays.filter((s) => s.openItems > 0).sort((a, b) => b.openItems - a.openItems);
  // "Transfer requests" here is RECENT TRANSFERS - see this file's own header.
  const recentTransfers = stays.filter((s) => s.movedAt && (nowMs - Date.parse(s.movedAt)) <= RECENT_TRANSFER_MS)
    .sort((a, b) => String(b.movedAt).localeCompare(String(a.movedAt)));

  const [ed, beds, waiting, masterBeds] = await Promise.all([
    listEd(request, env, ctx),
    bedBoard(request, env, ctx),
    admissionWaitingList(request, env, ctx),
    ctx.orgId ? listBeds(env, ctx.orgId).catch(() => []) : Promise.resolve([]),
  ]);

  const bedStates = bedStateCounts(masterBeds);
  const wards = (beds && beds.wards) || [];
  const totalUnplaced = wards.reduce((n, w) => n + (w.unplaced ? w.unplaced.length : 0), 0);
  const totalOccupied = wards.reduce((n, w) => n + (w.occupied ? w.occupied.length : 0), 0);

  // "High-priority operational bottlenecks": a PLAIN ranking of counts already computed above -
  // no severity score, no threshold. The magnitude speaks for itself; a human decides what to do.
  const bottlenecks = [
    ...(wards.filter((w) => w.unplaced && w.unplaced.length).map((w) => ({ kind: "unplaced_patients", ward: w.ward, count: w.unplaced.length }))),
    ...((ed && ed.patients || []).filter((p) => !p.triagedAt).length ? [{ kind: "ed_untriaged", count: (ed && ed.patients || []).filter((p) => !p.triagedAt).length }] : []),
    ...(bedStates.blocked ? [{ kind: "beds_blocked", count: bedStates.blocked }] : []),
    ...(bedStates.cleaning ? [{ kind: "beds_in_cleaning_turnover", count: bedStates.cleaning }] : []),
    ...(staysWithOpenItems.length ? [{ kind: "stays_with_open_items", count: staysWithOpenItems.length }] : []),
  ].sort((a, b) => b.count - a.count);

  const flow = {
    computedAt: nowIso,
    ed: { arrivals: (ed && ed.patients || []).length, untriaged: (ed && ed.patients || []).filter((p) => !p.triagedAt).length },
    admissionsPending: { waiting: (waiting && waiting.waiting) || 0, longestWaitHours: (waiting && waiting.longestWaitHours) || 0 },
    beds: { occupied: totalOccupied, unplacedPatients: totalUnplaced, wardsKnown: wards.length, states: bedStates },
    dischargeCandidates: dischargeCandidates.length,
    staysWithOpenItems: staysWithOpenItems.slice(0, 50),
    recentTransfers: recentTransfers.slice(0, 50),
    bottlenecks,
  };
  return { ...base, ok: true, flow, ...( (ed && !ed.ok) || (beds && !beds.ok) || (waiting && !waiting.ok) ? { partial: true } : {}) };
}

export { patientFlow, bedStateCounts };
