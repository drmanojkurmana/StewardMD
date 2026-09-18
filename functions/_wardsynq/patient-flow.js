/* functions/_wardsynq/patient-flow.js — TASK 4.4: the hospital-wide patient flow command center.
 *
 * IT COUNTS, IT DOES NOT JUDGE - the exact discipline ward-metrics.js already states and enforces.
 * Every number here is derived live from a real record; nothing is stored, nothing is scored.
 *
 * NOT BUILT, STATED - not silent gaps:
 *   - NO predicted discharge date. The EXPECTED discharge date shown here is the one the treating
 *     team stated (expected-discharge.js, 2026-09-16), and "overdue" means that date has passed with
 *     the stay still open - a calendar fact. Nothing estimates when a patient should leave.
 *     "Discharge candidates" below means stays with ZERO open items right now
 *     (migrate-discharge.js's own pendingItems(), unchanged) - a fact, never a prediction.
 *   - NO bottleneck-severity/escalation algorithm. "Bottlenecks" is a plain ranking of counts this
 *     file already computes (most unplaced patients, longest ED wait) - never a traffic light or a
 *     threshold nobody configured.
 *   - Transfer requests (transfer-request.js, 2026-09-16) are their own records now; the open ones
 *     are listed as pendingTransfers. "recentTransfers" is still the moves that HAPPENED - the
 *     movedAt/movedFrom/moveReason every real transfer writes to the Encounter.
 *
 * LINKS, DOES NOT REBUILD: listEd() (migrate-ed.js), bedBoard() (migrate-inpatient.js) and
 * admissionWaitingList() (admission-request.js) are called unchanged for ED/bed/waiting-list
 * counts. Only the discharge-candidate / open-items / recent-transfer aggregation is new, because
 * no existing function reads pendingItems() across every open stay at once.
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, ListCeilingError } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { listEd } from "./migrate-ed.js";
import { bedBoard, ADMISSION_CLASSES, OPEN } from "./migrate-inpatient.js";
import { admissionWaitingList } from "./admission-request.js";
import { pendingItems, lengthOfStayDays } from "./migrate-discharge.js";
import { listBeds } from "../_opd_org_store.js";
import { patientLabels, labelKey } from "./patient-label.js";
import { expectedDischargeMap, eddStatus, hospitalToday } from "./expected-discharge.js";
import { listTransferRequests } from "./transfer-request.js";

const str = (v) => (v == null ? "" : String(v).trim());
const RECENT_TRANSFER_MS = 24 * 60 * 60 * 1000;

/* R5-1: what "still open" means for each companion type, so the flow board reads THROUGHPUT and not
 * history. Each list is the one pendingItems() (migrate-discharge.js) actually selects from:
 *   - an order is outstanding while it is active;
 *   - a dose is outstanding in any pre-given state of the eMAR machine;
 *   - a request is outstanding until it is completed, cancelled or revoked ("unknown" is an inbound
 *     HL7 status nobody has resolved yet, which is not the same as done).
 * Past the open-census ceiling listByStatus refuses rather than answering short: stale open records
 * on that scale are themselves the finding. */
const ORDER_OPEN = ["active"];
const ADMIN_OPEN = ["ordered", "verified", "dispensed", "scanned", "held"];
const SR_OPEN = ["draft", "active", "on-hold", "unknown"];
// The two types that cannot be status-scoped here; stated, and the truncation is shown on screen.
const COMPANION_MAX = 50000;

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

const DRILL_CAP = 50;
/** PURE. The ids behind a count: at most DRILL_CAP rows, with the true total and a stated `truncated`. */
function drillList(rows) {
  const all = (rows || []).filter(Boolean);
  return {
    total: all.length, truncated: all.length > DRILL_CAP,
    items: all.slice(0, DRILL_CAP).map((r) => ({ patientId: r.patientId || null, encounterId: r.encounterId || null, ward: r.ward || null, bed: r.bed || null, at: r.arrivedAt || r.admittedAt || null })),
  };
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

  let encounters, orders, administrations, serviceRequests, problemsGot, reportsGot;
  try {
    [encounters, orders, administrations, serviceRequests, problemsGot, reportsGot] = await Promise.all([
      // R4-1: the open stays, however much closed history is on record (was the oldest 500 of every encounter).
      svc.listByStatus("Encounter", [OPEN]),
      /* R5-1: each companion read is now scoped to what "open" means for its own type, and NONE of them
       * is `.catch(() => [])` any more. The oldest 1,000 with a swallowed failure meant the open-items
       * count for a current patient read 0 once the hospital passed 1,000 of any of these - wrong
       * clinical data on the flow board, silently, from about day one for MedicationOrder. */
      svc.listByStatus("MedicationOrder", ORDER_OPEN),
      svc.listByStatus("MedicationAdministration", ADMIN_OPEN),
      svc.listByStatus("ServiceRequest", SR_OPEN),
      /* Condition carries clinicalStatus, not status, so the status-scoped page cannot select it
       * (pageByType filters body.status). Read whole with a stated ceiling and the truncation surfaced.
       * ponytail: a clinicalStatus predicate in the port would narrow this; R5-3 owns repository*.js. */
      svc.listAll("Condition", { max: COMPANION_MAX }),
      /* A test with a released result is not open (LT-31): the report decides, as on the discharge
       * summary - so the released ones are needed too, which is why this is not status-scoped. */
      svc.listAll("DiagnosticReport", { max: COMPANION_MAX }),
    ]);
  } catch (e) {
    if (e instanceof ListCeilingError) return { ...base, ok: false, status: 503, error: "too_many_open", detail: str(e.message), flow: null };
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), flow: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), flow: null };
  }

  /* Truncation is NOT a smaller answer here, it is an unknown one: a missing DiagnosticReport makes a
   * resulted test look outstanding, and a missing Condition hides an unconfirmed problem. Every stay's
   * openItems then reads false (unknown), exactly as expectedDischarge already does. */
  const problems = problemsGot.rows, reports = reportsGot.rows;
  const openItemsUnknown = [
    ...(problemsGot.truncated ? ["Condition"] : []),
    ...(reportsGot.truncated ? ["DiagnosticReport"] : []),
  ];

  const nowIso = str(ctx.now) || new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();
  // false = the stated dates could not be read: overdue is then unknown, never zero.
  const edds = await expectedDischargeMap(svc).catch(() => false);
  const today = hospitalToday(nowMs, ctx.clock);
  const openStays = (encounters || []).filter((e) => e && ADMISSION_CLASSES.includes(e.class) && e.status === OPEN);

  const stays = openStays.map((e) => {
    const myOrders = (orders || []).filter((o) => o && o.encounterId === e.id);
    /* By PATIENT, not by a join onto myOrders: the orders read is now the active ones only, and a dose
     * still waiting against an order that has since been completed is still a dose waiting. Every
     * administration here is already in a pre-given state (ADMIN_OPEN). */
    const myAdmins = (administrations || []).filter((a) => a && a.patientId === e.patientId);
    const mySr = (serviceRequests || []).filter((s) => s && s.encounterId === e.id);
    const myProblems = (problems || []).filter((c) => c && c.patientId === e.patientId);
    const pending = pendingItems({ orders: myOrders, administrations: myAdmins, serviceRequests: mySr, problems: myProblems, reports });
    return {
      encounterId: e.id, patientId: e.patientId,
      ward: (e.location && e.location.ward) || null, bed: (e.location && e.location.bed) || null,
      admittedAt: e.periodStart || null,
      lengthOfStayDays: e.periodStart ? lengthOfStayDays(e.periodStart, nowIso) : null,
      // false = could not be counted (a companion read was truncated), never 0. Same convention as expectedDischarge.
      openItems: openItemsUnknown.length ? false : pending.length,
      movedAt: e.movedAt || null, movedFrom: e.movedFrom || null, moveReason: e.moveReason || null,
      expectedDischarge: edds === false ? false : eddStatus(edds.get(e.id) || null, today),
    };
  });

  // Discharge candidates: a fact (zero open items right now), never a predicted date.
  const dischargeCandidates = stays.filter((s) => s.openItems === 0);
  const staysWithOpenItems = stays.filter((s) => s.openItems > 0).sort((a, b) => b.openItems - a.openItems);
  // "Transfer requests" here is RECENT TRANSFERS - see this file's own header.
  const recentTransfers = stays.filter((s) => s.movedAt && (nowMs - Date.parse(s.movedAt)) <= RECENT_TRANSFER_MS)
    .sort((a, b) => String(b.movedAt).localeCompare(String(a.movedAt)));

  const overdueDischarges = edds === false ? null : stays.filter((s) => s.expectedDischarge && s.expectedDischarge.overdue)
    .sort((a, b) => a.expectedDischarge.date.localeCompare(b.expectedDischarge.date));

  const [ed, beds, waiting, masterBeds, transfers] = await Promise.all([
    listEd(request, env, ctx),
    bedBoard(request, env, ctx),
    admissionWaitingList(request, env, ctx),
    // R5-1: null = the bed master could not be read. [] would count every state as zero, which reads
    // as "no bed is blocked and none is in cleaning" - the opposite of what an unread list means.
    ctx.orgId ? listBeds(env, ctx.orgId).catch(() => null) : Promise.resolve([]),
    listTransferRequests(request, env, { ...ctx, ward: "", encounterId: "" }),
  ]);

  // null = the bed master was not read; never a histogram of zeros.
  const bedStates = masterBeds ? bedStateCounts(masterBeds) : null;
  const wards = (beds && beds.wards) || [];
  const totalUnplaced = wards.reduce((n, w) => n + (w.unplaced ? w.unplaced.length : 0), 0);
  const totalOccupied = wards.reduce((n, w) => n + (w.occupied ? w.occupied.length : 0), 0);

  // "High-priority operational bottlenecks": a PLAIN ranking of counts already computed above -
  // no severity score, no threshold. The magnitude speaks for itself; a human decides what to do.
  const bottlenecks = [
    ...(wards.filter((w) => w.unplaced && w.unplaced.length).map((w) => ({ kind: "unplaced_patients", ward: w.ward, count: w.unplaced.length }))),
    ...((ed && ed.patients || []).filter((p) => !p.triagedAt).length ? [{ kind: "ed_untriaged", count: (ed && ed.patients || []).filter((p) => !p.triagedAt).length }] : []),
    ...(bedStates && bedStates.blocked ? [{ kind: "beds_blocked", count: bedStates.blocked }] : []),
    ...(bedStates && bedStates.cleaning ? [{ kind: "beds_in_cleaning_turnover", count: bedStates.cleaning }] : []),
    ...(staysWithOpenItems.length ? [{ kind: "stays_with_open_items", count: staysWithOpenItems.length }] : []),
  ].sort((a, b) => b.count - a.count);

  /* LT-39: the discharge list named no patient ("5 open items · Cardiology Ward · bed CAR-08"). Each row now carries
   * the patient's name and MRN, read once per patient through the caller's own governed service (patient-label.js),
   * so a role that may not read a patient gets nulls, never another patient's name. Ward and bed are already the
   * stay's current location. Only when asked (ctx.withPatients, the command center's own route): the digital twin
   * reuses this computation at executive level, where no name or MRN belongs. */
  const dischargeRows = [...staysWithOpenItems.slice(0, 50), ...dischargeCandidates.slice(0, DRILL_CAP)];
  const labels = ctx.withPatients ? await patientLabels(svc, [...dischargeRows, ...(overdueDischarges || [])].map((s) => ({ patientId: s.patientId }))) : null;
  const named = (s) => { if (!labels) return s; const l = labels.get(labelKey({ patientId: s.patientId })) || {}; return { ...s, name: l.name || null, mrn: l.mrn || null }; };
  const candidatesDrill = drillList(dischargeCandidates);
  if (labels) candidatesDrill.items = candidatesDrill.items.map((it) => { const n = named(it); return { ...n, label: [n.name, n.mrn].filter(Boolean).join(" · ") || null }; });

  const flow = {
    computedAt: nowIso,
    ed: { arrivals: (ed && ed.patients || []).length, untriaged: (ed && ed.patients || []).filter((p) => !p.triagedAt).length },
    admissionsPending: { waiting: (waiting && waiting.waiting) || 0, longestWaitHours: (waiting && waiting.longestWaitHours) || 0 },
    beds: { occupied: totalOccupied, unplacedPatients: totalUnplaced, wardsKnown: wards.length, states: bedStates },
    // null = not counted, never 0: "nothing outstanding" is a clinical claim and must not be guessed.
    dischargeCandidates: openItemsUnknown.length ? null : dischargeCandidates.length,
    // The types whose read was truncated, so the screen can say WHY the count is missing. [] = all read.
    openItemsUnknown,
    staysWithOpenItems: staysWithOpenItems.slice(0, 50).map(named),
    recentTransfers: recentTransfers.slice(0, 50),
    // null = could not be read (never an empty list). Names only on the command center's own route.
    overdueDischarges: overdueDischarges ? overdueDischarges.slice(0, 50).map(named) : null,
    pendingTransfers: transfers && transfers.ok ? transfers.requests.slice(0, 50).map((q) => ({
      requestId: q.id, encounterId: q.encounterId, status: q.status, urgency: q.urgency, from: q.from, to: q.to,
      requestedAt: q.requestedAt, ...(ctx.withPatients ? { name: q.name, mrn: q.mrn } : {}),
    })) : null,
    bottlenecks,
    /* P1.13 drill-down: the patients BEHIND each headline count, capped and saying so. */
    drill: {
      edArrivals: drillList((ed && ed.patients) || []),
      edUntriaged: drillList(((ed && ed.patients) || []).filter((p) => !p.triagedAt)),
      occupied: drillList(wards.flatMap((w) => (w.occupied || []).map((o) => ({ ...o, ward: w.ward })))),
      unplaced: drillList(wards.flatMap((w) => (w.unplaced || []).map((o) => ({ ...o, ward: w.ward })))),
      dischargeCandidates: openItemsUnknown.length ? null : candidatesDrill,
    },
  };
  return { ...base, ok: true, flow, ...( (ed && !ed.ok) || (beds && !beds.ok) || (waiting && !waiting.ok) ? { partial: true } : {}) };
}

export { patientFlow, bedStateCounts, drillList, DRILL_CAP };
