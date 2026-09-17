/* functions/_wardsynq/digital-twin.js — TASK 10: the hospital's own state, fused from what already
 * computes it, and never a second copy of any of it.
 *
 * NOT NAMED "COMMAND CENTER". That name is already three different things in this codebase:
 * patient-flow.js is documented as "the hospital-wide patient flow command center" (Task 4.4),
 * functions/api/followcare/[[path]].js has its own unrelated "command-center analytics" for
 * post-discharge risk, and the Code Blue Apple Watch feature opens its own "Command Center" on a
 * resuscitation. A fourth thing calling itself the same name would be a collision, not a feature.
 * This is the Hospital Digital Twin: a fused, freshness-aware view OVER those existing systems,
 * built to satisfy Task 10's plan without inventing a rival to any of them.
 *
 * WHAT THIS FILE DOES NOT DO, STATED BECAUSE IT WOULD BE THE OBVIOUS SHORTCUT: it does not compute
 * census, occupancy, ED load, critical-result state, pharmacy stock, billing totals, claims state or
 * chart completeness. Every one of those numbers is a real function call into the file that already
 * owns that number - patient-flow.js, ward-metrics.js, reports.js, emergency-mode.js, blackout.js,
 * critical-results.js, stock.js, specimen.js. This file's only real work is FUSION:
 *
 *   1. Call each existing aggregator with the SAME request/actor every other ward route uses, so
 *      authorization, tenant isolation and the patient-compartment rule are inherited, not
 *      re-implemented.
 *   2. Isolate failure PER SECTION. One subsystem being down must not take the rest of the hospital
 *      state off the screen - and must never be silently omitted either. A section that fails is
 *      reported UNAVAILABLE, by name, with why.
 *   3. Say what was NOT built, rather than leaving a gap a reader could mistake for zero. There is
 *      no blood-product inventory module and no hospital-wide radiology-queue aggregator anywhere
 *      in this codebase; a twin that quietly reported "0" for either would be inventing a fact.
 *   4. Carry PROVENANCE: which existing report produced each section, and when.
 *
 * FRESHNESS IS COMPUTED, NEVER STORED, matching this codebase's own stated convention
 * ("IT COUNTS, IT DOES NOT JUDGE" - ward-metrics.js, patient-flow.js). A section is LIVE if it was
 * read just now and succeeded, DELAYED if the read itself took unusually long, and UNAVAILABLE if it
 * failed. There is no persisted "twin state" to go stale in the usual sense, because there is no twin
 * STORE - every call rebuilds from RecordService at request time. What CAN go stale is a client
 * holding an old snapshot; `generatedAt` is stamped so any consumer (the UI, MaiK, a simulation) can
 * compute that staleness itself, using the same freshnessOf() function, rather than trusting a number
 * this file cannot see change after the response leaves it.
 */

import { dataProtection, RESTORE_TYPE } from "./security-review.js";
import { RUN_TYPE as BACKUP_RUN_TYPE } from "./backup-run.js";
import { patientFlowReport, clinicalOperationsReport, billingReport, claimsReport, pharmacyReport, himReport } from "./reports.js";
import { emergencyStatus, emergencyLog } from "./emergency-mode.js";
import { listBlackouts } from "./blackout.js";
import { listCriticalLoops } from "./critical-results.js";
import { isOutstanding } from "./specimen.js";
import { resourceSchedule } from "./resource-booking.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { drillList, DRILL_CAP } from "./patient-flow.js";
import { OPEN } from "./migrate-inpatient.js";
import { isVasoactive } from "./icu-care.js";
import { isPendingImaging } from "./dicom.js";
import { listSessions, listTickets } from "../_queue_engine.js";
import * as ROSTER_STORE from "../_roster_store.js";
import { span as shiftSpan, addDays } from "../_roster.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** How stale a section is, computed at read time and re-computable by any consumer later. Never a
 *  score, never persisted - the same discipline this codebase already applies to every other count
 *  here. Matches the plan's own vocabulary (section 21); DEGRADED and RECOVERING are compositions a
 *  consumer derives from these four (e.g. "degraded" = at least one section UNAVAILABLE while others
 *  are LIVE), not a fifth state this file invents and could get out of step with the real one. */
const FRESHNESS = Object.freeze({ LIVE: "live", DELAYED: "delayed", STALE: "stale", UNAVAILABLE: "unavailable" });

/** PURE. `ageMs` is how long ago the thing was read (or how long the read itself took, for a
 *  just-fetched section). Thresholds are explicit and passable, never a hidden constant a caller
 *  cannot see or override for their own hospital's expectations. */
function freshnessOf(ageMs, thresholds) {
  const t = thresholds || { delayedMs: 3000, staleMs: 30000 };
  if (ageMs == null || !Number.isFinite(ageMs)) return FRESHNESS.UNAVAILABLE;
  if (ageMs < 0) return FRESHNESS.UNAVAILABLE; // a negative age is a clock problem, not a live read
  if (ageMs <= t.delayedMs) return FRESHNESS.LIVE;
  if (ageMs <= t.staleMs) return FRESHNESS.DELAYED;
  return FRESHNESS.STALE;
}

/** Sections that were never built. Named individually, with WHY - the same discipline patient-flow.js
 *  already applies to "no expected discharge date" and "no bottleneck-severity algorithm". A reader
 *  must never be able to mistake "we didn't build this" for "we checked, and it's zero".
 *
 *  otUtilisation MOVED OUT of this list on 2026-09-10: resource-booking.js's ResourceBooking rows
 *  carry a real `kind` ("theatre" among them) and a real committed duration, which is enough to
 *  compute utilisation honestly - see the otUtilisation section below. radiologyQueue moved out on
 *  2026-09-13 (P1.13): the backlog is imaging ServiceRequests with no DiagnosticReport. bloodBank
 *  remain here because no such data exists anywhere in this codebase to compute from; ResourceBooking
 *  covers rooms/theatres/equipment BOOKINGS, never a blood-product count or an imaging backlog. */
const NOT_BUILT = Object.freeze({
  bloodBank: "no blood-product inventory module exists in this codebase - migrate-transfusion.js records transfusions given, not units held.",
});

/* ---- P1.13 command-center helpers. PURE, exported for tests. -------------------------------------- */

const LIST_CAP = 1000;
const HOUR = 3600000;

/** PURE. Nearest-rank percentile of a numeric list; null for an empty list, never 0. */
function percentile(values, p) {
  const v = (values || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

/** PURE. Request-to-report turnaround over lab reports released in [fromMs, toMs]. Only real timestamps:
 *  a request with no meta.recordedAt, or a report timed before its request, is EXCLUDED and counted by
 *  reason, never guessed. */
function labTurnaround(requests, reports, fromMs, toMs) {
  const byId = new Map((requests || []).filter((r) => r && r.id).map((r) => [r.id, r]));
  const excluded = { requestNotReadable: 0, requestTimeMissing: 0, reportTimeMissing: 0, negative: 0 };
  const rows = [];
  for (const d of reports || []) {
    if (!d || !d.serviceRequestId) continue;
    const sr = byId.get(d.serviceRequestId);
    if (sr && sr.category === "imaging") continue;
    const end = Date.parse(d.reportedAt || "");
    if (!Number.isFinite(end)) { excluded.reportTimeMissing += 1; continue; }
    if (end < fromMs || end > toMs) continue;
    if (!sr) { excluded.requestNotReadable += 1; continue; }
    const start = Date.parse((sr.meta && sr.meta.recordedAt) || "");
    if (!Number.isFinite(start)) { excluded.requestTimeMissing += 1; continue; }
    if (end < start) { excluded.negative += 1; continue; }
    rows.push({ patientId: sr.patientId || null, encounterId: sr.encounterId || null, serviceRequestId: sr.id, label: sr.display || sr.code || null, minutes: Math.round((end - start) / 60000) });
  }
  const mins = rows.map((r) => r.minutes);
  rows.sort((a, b) => b.minutes - a.minutes);
  return {
    sampleSize: rows.length, medianMinutes: percentile(mins, 50), p90Minutes: percentile(mins, 90),
    excluded, excludedTotal: Object.values(excluded).reduce((a, b) => a + b, 0),
    drill: { slowest: { total: rows.length, truncated: rows.length > DRILL_CAP, items: rows.slice(0, DRILL_CAP) } },
  };
}

/** PURE. Imaging orders still on the worklist (dicom.js isPendingImaging) with no report against them;
 *  the oldest is judged from real order times only, and orders with no time are counted. */
function radiologyBacklog(requests, reports, nowMs) {
  const reported = new Set((reports || []).filter((r) => r && r.serviceRequestId).map((r) => r.serviceRequestId));
  const waiting = (requests || []).filter(isPendingImaging).filter((o) => !reported.has(o.id));
  let timeMissing = 0;
  const rows = waiting.map((o) => {
    const t = Date.parse((o.meta && o.meta.recordedAt) || "");
    if (!Number.isFinite(t)) timeMissing += 1;
    return { patientId: o.patientId || null, encounterId: o.encounterId || null, serviceRequestId: o.id, label: o.display || o.code || null,
      at: Number.isFinite(t) ? new Date(t).toISOString() : null, waitingHours: Number.isFinite(t) ? Math.round(((nowMs - t) / HOUR) * 10) / 10 : null };
  }).sort((a, b) => ((a.at ? 0 : 1) - (b.at ? 0 : 1)) || String(a.at).localeCompare(String(b.at)));
  const oldest = rows.find((r) => r.at) || null;
  return {
    waiting: rows.length, oldestWaitingSince: oldest ? oldest.at : null, oldestWaitingHours: oldest ? oldest.waitingHours : null,
    orderTimeMissing: timeMissing,
    drill: { waiting: { total: rows.length, truncated: rows.length > DRILL_CAP, items: rows.slice(0, DRILL_CAP) } },
  };
}

/** PURE. Staffing NOW: who the roster has on duty, against the minimum of every shift running at this
 *  instant. Yesterday's coverage rows are passed in so a night shift crossing midnight is not missed. */
function staffingNow(nowMs, utcOffsetMinutes, shifts, coverageRows, onDuty) {
  const local = Math.floor((nowMs + (Number(utcOffsetMinutes) || 0) * 60000) / 60000);
  const running = (coverageRows || []).filter((row) => {
    const def = shifts[row.shiftId];
    if (!def) return false;
    const [a, b] = shiftSpan(row.date, def);
    return a <= local && local < b;
  });
  const required = running.reduce((n, r) => n + Object.values((shifts[r.shiftId] || {}).minimum || {}).reduce((x, y) => x + (Number(y) || 0), 0), 0);
  const gaps = running.flatMap((r) => (r.gaps || []).map((g) => ({ shift: r.shift, unit: r.unit || null, role: g.role, need: g.need, have: g.have, short: g.short })));
  const duty = onDuty || [];
  return {
    shiftsRunning: running.length, onDutyNow: duty.length, requiredNow: running.length ? required : null, gaps,
    drill: { onDuty: { total: duty.length, truncated: duty.length > DRILL_CAP, items: duty.slice(0, DRILL_CAP).map((a) => ({ identity: a.identity, shift: a.shift, unit: a.unit || null })) } },
  };
}

/** The roster read behind staffingNow(), shared by the twin and the hospital-group summary so the two
 *  cannot disagree about what "short now" means. The caller decides who may see it. */
async function rosterStaffing(env, orgId, wsqCfg, listMembers, nowMs) {
  const offset = (wsqCfg && wsqCfg.utcOffsetMinutes != null) ? wsqCfg.utcOffsetMinutes : 330;
  const today = new Date(nowMs + offset * 60000).toISOString().slice(0, 10);
  const [shiftsR, members] = await Promise.all([ROSTER_STORE.listShifts(env, orgId), listMembers ? listMembers(env, orgId) : []]);
  const shifts = {}; for (const sh of (shiftsR && shiftsR.shifts) || []) shifts[sh.id] = sh;
  if (!Object.keys(shifts).length) return { ok: true, generatedAt: new Date().toISOString(), rosterConfigured: false, onDutyNow: null, requiredNow: null, gaps: [], reason: "no shifts are set up in the roster" };
  const roleOf = (id) => (((members || []).find((m) => m.identity === id) || {}).role || "");
  const [cov, duty] = await Promise.all([ROSTER_STORE.coverageFor(env, orgId, addDays(today, -1), today, roleOf), ROSTER_STORE.onDuty(env, orgId, "", offset)]);
  if (!cov.ok) return cov;
  return { ok: true, generatedAt: new Date().toISOString(), rosterConfigured: true, partial: !!(cov.partial || duty.partial), ...staffingNow(nowMs, offset, shifts, cov.coverage, duty.onDuty) };
}

/**
 * Runs one existing aggregator and wraps its answer with freshness/provenance, catching failure
 * INSTEAD OF letting one dead subsystem blank the whole twin. `label` and `dataSource` are for the
 * provenance list; `fn` is called with the caller's own (request, env, ctx) so it re-authorises
 * itself exactly as it does when reached directly as a route - this file grants nothing of its own.
 */
async function section(label, dataSource, fn, request, env, ctx) {
  const startedAt = Date.now();
  try {
    const result = await fn(request, env, ctx);
    const elapsedMs = Date.now() - startedAt;
    if (!result || result.ok !== true) {
      return {
        status: "unavailable", freshness: FRESHNESS.UNAVAILABLE, label, dataSource,
        error: (result && result.error) || "unknown", detail: (result && result.detail) || null,
        data: null,
      };
    }
    return {
      status: "ok", freshness: freshnessOf(elapsedMs, ctx.thresholds), elapsedMs, label, dataSource,
      generatedAt: result.generatedAt || new Date().toISOString(),
      data: result,
    };
  } catch (e) {
    return {
      status: "unavailable", freshness: FRESHNESS.UNAVAILABLE, label, dataSource,
      error: (e && typeof e.code === "string" && e.code) || "threw", detail: str(e && e.message) || "the read failed", data: null,
    };
  }
}

/**
 * Builds the fused hospital-state snapshot. ctx: { migration, ward?, escalationPolicy?, actorDeps,
 * recordDeps, thresholds?, includeFinance? }. Every underlying call is the SAME function the ward
 * router already exposes as its own route - see the header. `includeFinance` defaults to false: the
 * executive/clinical view does not need billing/claims by default, and the plan is explicit that
 * financial intelligence must never blend into or alter a clinical read (section 15) - so it is a
 * name-it-to-get-it section, not folded into the default response.
 */
async function buildTwinSnapshot(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", twin: null };

  const generatedAt = new Date().toISOString();

  const [flow, clinicalOps, criticals, emergency, blackouts, pharmacy, him] = await Promise.all([
    section("flow", ["Encounter", "MedicationOrder", "MedicationAdministration", "ServiceRequest", "Condition"], patientFlowReport, request, env, ctx),
    section("clinicalOps", ["Encounter", "CriticalResultLoop", "MedicationAdministration", "ShiftHandover", "MedicationReconciliation", "MedicationOrder", "MedicationVerification"], clinicalOperationsReport, request, env, ctx),
    section("criticals", ["CriticalResultLoop"], async (rq, e, c) => {
      const r = await listCriticalLoops(rq, e, { ...c, policy: c.escalationPolicy });
      if (!r || !r.ok) return r;
      const open = (r.loops || []).filter((l) => l.state === "open");
      const items = drillList(open);
      items.items = items.items.map((it, i) => ({ ...it, loopId: open[i].loopId, label: open[i].display || open[i].code || null }));
      return { ...r, drill: { open: items } };
    }, request, env, ctx),
    section("emergency", ["EmergencyActivation"], emergencyStatus, request, env, ctx),
    section("blackouts", ["Blackout"], listBlackouts, request, env, ctx),
    section("pharmacy", ["Movement", "MedicationDispense", "MedicationOrder", "MedicationVerification"], pharmacyReport, request, env, ctx),
    section("him", ["Encounter", "ClinicalNote", "CriticalResultLoop", "MedicationReconciliation", "PatientConsent", "SurgicalCase", "ROIRequest"], himReport, request, env, ctx),
  ]);

  /* The specimen backlog reuses SpecimenCollection's own OUTSTANDING classification (isOutstanding),
   * never re-derives which states count as pending - the same reuse discipline as every other
   * section, just without an existing hospital-wide route to call, since collectionList() is
   * deliberately per-patient. Wrapped through `section()` like everything else so a read failure
   * here is UNAVAILABLE, never a silent zero. */
  const lis = await section("lis", ["SpecimenCollection"], async (rq, e, c) => {
    const resolved = await resolveClinicalActor(rq, e, c.migration.tenantId, "record:read", c.actorDeps);
    const svc = new RecordService({
      repository: c.recordDeps.repository, pseudonym: c.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    const rows = await svc.list("SpecimenCollection", 1000);
    const outstanding = (rows || []).filter(Boolean).filter(isOutstanding);
    return { ok: true, generatedAt: new Date().toISOString(), outstanding: outstanding.length, checked: (rows || []).length,
      drill: { outstanding: drillList(outstanding.map((x) => ({ patientId: x.patientId, encounterId: x.encounterId }))) } };
  }, request, env, ctx);

  /* OT UTILISATION, real, from resource-booking.js's own ResourceBooking rows - reused, never
   * recomputed. "Configured" and "no bookings" are kept visibly apart: a hospital that has not
   * entered its theatres in wsqCfg.resources must never read the same as one with three idle
   * theatres, and an org that HAS theatres but genuinely booked none in the window is a real,
   * honest zero - not the same thing as either. A committed booking counts ("booked" or
   * "completed"); a cancelled one does not, because it never occupied the theatre. The window is
   * the trailing 24h ending now, a live operational snapshot rather than a historical report. */
  const otUtilisation = await section("otUtilisation", ["ResourceBooking"], async (rq, e, c) => {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 3600000);
    const r = await resourceSchedule(rq, e, { ...c, resourceId: "", from: from.toISOString(), to: to.toISOString() });
    if (!r.ok) return r;
    const theatres = (r.resources || []).filter((res) => res.kind === "theatre");
    const windowMinutes = (to.getTime() - from.getTime()) / 60000;
    const perTheatre = theatres.map((t) => {
      const bookedMinutes = (t.bookings || []).filter((b) => b.state === "booked" || b.state === "completed")
        .reduce((sum, b) => sum + (Number(b.minutes) || 0), 0);
      return { resourceId: t.id, name: t.name, bookedMinutes, utilisation: windowMinutes > 0 ? Math.min(1, bookedMinutes / windowMinutes) : null };
    });
    const totalBooked = perTheatre.reduce((s, t) => s + t.bookedMinutes, 0);
    return {
      ok: true, generatedAt: new Date().toISOString(),
      theatresConfigured: theatres.length,
      windowFrom: from.toISOString(), windowTo: to.toISOString(),
      perTheatre,
      overallUtilisation: theatres.length > 0 ? Math.min(1, totalBooked / (windowMinutes * theatres.length)) : null,
    };
  }, request, env, ctx);

  const openSvc = async (rq, e, c) => {
    const resolved = await resolveClinicalActor(rq, e, c.migration.tenantId, "record:read", c.actorDeps);
    return new RecordService({ repository: c.recordDeps.repository, pseudonym: c.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
  };
  const nowMs = Date.now();

  /* ICU: occupancy from open ICU encounters. Ventilation = an IcuRecord ventilator entry in the last
   * 12h; vasopressors = an active MedicationOrder whose drug icu-care.js calls vasoactive. Both are
   * "recorded" counts: no record means not known, never "not on one". */
  const icu = await section("icu", ["Encounter", "IcuRecord", "MedicationOrder"], async (rq, e, c) => {
    const svc = await openSvc(rq, e, c);
    // R4-1: the open stays only, read whole (a census past the ceiling throws and the section says unavailable).
    const encounters = (await svc.listByStatus("Encounter", [OPEN])) || [];
    const open = encounters.filter((x) => x && x.class === "ICU" && x.status === OPEN);
    const ids = new Set(open.map((x) => x.id));
    const [icuRecords, orders] = await Promise.all([svc.list("IcuRecord", LIST_CAP), svc.list("MedicationOrder", LIST_CAP)]);
    const ventIds = new Set((icuRecords || []).filter((r) => r && r.kind === "ventilator" && ids.has(r.encounterId) && nowMs - Date.parse(r.at || "") <= 12 * HOUR).map((r) => r.encounterId));
    const pressorIds = new Set((orders || []).filter((o) => o && o.status === "active" && ids.has(o.encounterId) && isVasoactive(o.drug || o.display || o.code)).map((o) => o.encounterId));
    const rowsOf = (set) => open.filter((x) => set.has(x.id)).map((x) => ({ patientId: x.patientId, encounterId: x.id, ward: x.location && x.location.ward, bed: x.location && x.location.bed }));
    return {
      ok: true, generatedAt: new Date().toISOString(),
      occupied: open.length,
      ventilatedRecorded: ventIds.size, vasopressorsRecorded: pressorIds.size,
      recordsCapped: (icuRecords || []).length >= LIST_CAP || (orders || []).length >= LIST_CAP,
      drill: { occupied: drillList(rowsOf(ids)), ventilated: drillList(rowsOf(ventIds)), vasopressors: drillList(rowsOf(pressorIds)) },
    };
  }, request, env, ctx);

  /* OPD queue: today's (UTC date, the same day the OPD board uses) waiting and in-consultation tickets
   * across every session of this hospital. queue.view is checked by the router and passed in. */
  const opdQueue = await section("opdQueue", ["q_sessions", "q_tickets"], async (rq, e, c) => {
    if (!c.canViewQueue) return { ok: false, error: "not_permitted", detail: "reading the OPD queue needs queue.view" };
    const date = new Date(nowMs).toISOString().slice(0, 10);
    const sessions = await listSessions(e, c.orgId, date);
    let waiting = 0, inConsultation = 0;
    for (const sess of sessions) {
      for (const t of await listTickets(e, sess.id)) {
        if (t.status === "waiting" || t.status === "called") waiting += 1;
        else if (t.status === "in_consultation") inConsultation += 1;
      }
    }
    return { ok: true, generatedAt: new Date().toISOString(), date, sessions: sessions.length, sessionsCapped: sessions.length >= 200, waiting, inConsultation,
      drillNotAvailable: "OPD tickets are not ward records; open the OPD board to see who is waiting." };
  }, request, env, ctx);

  const staffing = await section("staffing", ["q_roster_shifts", "q_roster_assign"], async (rq, e, c) => {
    if (!c.canViewQueue) return { ok: false, error: "not_permitted", detail: "reading the roster needs queue.view" };
    return rosterStaffing(e, c.orgId, c.wsqCfg, c.listMembers, nowMs);
  }, request, env, ctx);

  /* Lab TAT and the radiology backlog share one read of requests and reports. */
  const diagRead = (async () => {
    const svc = await openSvc(request, env, ctx);
    const [requests, reports] = await Promise.all([svc.list("ServiceRequest", LIST_CAP), svc.list("DiagnosticReport", LIST_CAP)]);
    return { requests: requests || [], reports: reports || [] };
  })();
  diagRead.catch(() => {});
  const labTat = await section("labTat", ["ServiceRequest", "DiagnosticReport"], async () => {
    const d = await diagRead;
    return { ok: true, generatedAt: new Date().toISOString(), windowDays: 7, capped: d.requests.length >= LIST_CAP || d.reports.length >= LIST_CAP,
      ...labTurnaround(d.requests, d.reports, nowMs - 7 * 24 * HOUR, nowMs) };
  }, request, env, ctx);
  const radiology = await section("radiology", ["ServiceRequest", "DiagnosticReport"], async () => {
    const d = await diagRead;
    return { ok: true, generatedAt: new Date().toISOString(), capped: d.requests.length >= LIST_CAP || d.reports.length >= LIST_CAP, ...radiologyBacklog(d.requests, d.reports, nowMs) };
  }, request, env, ctx);

  const sections = { flow, clinicalOps, criticals, emergency, blackouts, pharmacy, him, lis, otUtilisation, icu, opdQueue, staffing, labTat, radiology };

  if (ctx.includeFinance) {
    const [billing, claims] = await Promise.all([
      section("billing", ["Invoice"], billingReport, request, env, ctx),
      section("claims", ["Claim"], claimsReport, request, env, ctx),
    ]);
    sections.billing = billing;
    sections.claims = claims;
  }

  const provenance = Object.entries(sections)
    .filter(([, s]) => s.status === "ok")
    .map(([key, s]) => ({ section: key, dataSource: s.dataSource, generatedAt: s.generatedAt }));

  const unavailable = Object.entries(sections).filter(([, s]) => s.status !== "ok").map(([key]) => key);

  return {
    ...base, ok: true,
    twin: {
      generatedAt, ward: str(ctx.ward) || null,
      sections,
      provenance,
      unavailable,
      notBuilt: NOT_BUILT,
      /* A live count nobody should mistake for a subtler judgement: how many of the sections above
       * actually answered. A reader who sees 6/8 knows two things failed before reading a single
       * number - the same "counted, never judged" property the rest of this codebase holds. */
      ...(ctx.financeWithheld ? { financeWithheld: ctx.financeWithheld } : {}),
      sectionsOk: Object.values(sections).filter((s) => s.status === "ok").length,
      sectionsTotal: Object.keys(sections).length,
    },
  };
}

/**
 * Bounded point-in-time reconstruction (plan section 19: "what did WardSynQ believe the hospital
 * state was at time T, and why"). NOT a universal twin-at-time-T: it reconstructs the small,
 * genuinely operational, append-only types a Digital Twin cares about - EmergencyActivation,
 * Blackout, CriticalResultLoop - by walking each record's own version history and keeping the latest
 * version at or before `atIso`. Full clinical-record-as-of-a-time already exists per record via the
 * ordinary chart/history routes; reinventing that universally here would be exactly the duplicate
 * source of truth the plan forbids. This is stated as a bound, not hidden as a gap.
 */
async function reconstructTwinAsOf(request, env, ctx, atIso) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", reconstruction: null };

  const atMs = Date.parse(str(atIso));
  if (!Number.isFinite(atMs)) return { ...base, ok: false, status: 422, error: "at_required", detail: "a reconstruction needs a valid ISO timestamp" };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) };
  }
  const svc = new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
  });

  /* Each type's OWN timestamp field is what "at or before T" is judged against - not a universal
   * system-recorded-at, because none of these three record shapes carry a `meta` object at all (they
   * are workflow facts, not clinical resources with the canonical meta envelope). Using each type's
   * real, already-existing field is reuse; inventing a synthetic write-time for them would be a
   * second, competing notion of "when" this file has no business creating. */
  const AS_OF_FIELD = { EmergencyActivation: "declaredAt", Blackout: "createdAt", CriticalResultLoop: "reportedAt" };
  const RECONSTRUCTED_TYPES = Object.keys(AS_OF_FIELD);
  const asOf = {};
  for (const type of RECONSTRUCTED_TYPES) {
    let ids;
    try { ids = (await svc.list(type, 500)) || []; }
    catch { asOf[type] = { status: "unavailable" }; continue; }
    const rows = [];
    let unreadable = 0;
    for (const current of ids) {
      if (!current || !current.id) continue;
      let history;
      /* Counted, not skipped silently: a dropped history made the as-of count too low with nothing saying so. */
      try { history = (await svc.history(type, current.id)) || []; }
      catch { unreadable += 1; continue; }
      /* The latest version that itself already existed at or before the requested instant. A version
       * whose own timestamp is after T did not exist yet, whatever the current record now shows. */
      const asOfVersion = history
        .filter((v) => v && Date.parse(v[AS_OF_FIELD[type]] || "") <= atMs)
        .sort((a, b) => (b.version || 0) - (a.version || 0))[0];
      if (asOfVersion) rows.push(asOfVersion);
    }
    asOf[type] = unreadable
      ? { status: "partial", count: rows.length, unreadable, records: rows }
      : { status: "ok", count: rows.length, ...(ids.length >= 500 ? { status: "partial", capped: true } : {}), records: rows };
  }

  return {
    ...base, ok: true,
    reconstruction: {
      at: new Date(atMs).toISOString(), reconstructedAt: new Date().toISOString(),
      types: RECONSTRUCTED_TYPES, notReconstructed: Object.keys(NOT_BUILT).concat(["Encounter", "MedicationOrder", "and every other clinical resource type - reconstruct those via the ordinary chart/history routes"]),
      state: asOf,
    },
  };
}

/**
 * TASK 10 observability pass, 2026-09-10: the application-side SLO/health contract, over what this
 * codebase ALREADY DURABLY RECORDS.
 *
 * THIS IS NOT A SECOND DATASTORE, and the distinction matters: observability.js emits transient,
 * PHI-free lines for Cloudflare's own log capture to hold (request errors, latency) - correctly NOT
 * re-persisted here, because a second store of THAT is exactly the duplicate infrastructure this
 * codebase refuses to invent. What follows is different: MaiKInteraction, BreakGlassGrant and
 * CriticalResultLoop are ALREADY governed clinical records, written once, for their own reasons, and
 * this composes real ratios OVER them - the same fusion discipline buildTwinSnapshot() already
 * applies to census and criticals, extended to "is the service itself healthy" rather than "what is
 * the hospital state". Nothing here is a new field, a new write, or a new resource type.
 *
 * EVERY NUMBER NAMES ITS OWN SAMPLE SIZE. A 0% delivery rate over zero notifications is not the same
 * fact as 0% over five hundred, and collapsing them would be the exact "counted vs. judged" mistake
 * the rest of this file already refuses to make.
 */
async function operationalHealthReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", health: null };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) };
  }
  const svc = new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
  });

  const rate = (numerator, denominator) => ({
    count: denominator,
    // null, never 0/0 presented as a healthy zero: "no sample" and "sampled and perfect" must not
    // read the same to whoever is watching this number.
    rate: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : null,
  });

  /* AI RELIABILITY, over MaiKInteraction rows this codebase already writes for accountability. A
   * routing refusal (no approved model, MaiK disabled) is NEVER recorded - maik-interaction.js's own
   * header states why: "there is nothing to record" - so this counts what IS recorded: an output the
   * security screen withheld, and an injection signal a retrieved document tripped. Both are real
   * near-misses this file did not invent a category for; they were always on the record. */
  let ai = { status: "unavailable", error: null };
  try {
    const interactions = (await svc.list("MaiKInteraction", 1000)) || [];
    const withheld = interactions.filter((i) => i && i.security && i.security.released === false).length;
    const injectionSignals = interactions.reduce((n, i) => n + ((i && i.security && i.security.injectionFindings) || []).length, 0);
    ai = { status: "ok", interactionsSampled: interactions.length, withheldRate: rate(withheld, interactions.length), injectionSignalsObserved: injectionSignals };
  } catch (e) { ai = { status: "unavailable", error: str(e && e.message) }; }

  /* NOTIFICATION RELIABILITY, over the SAME `notification` shape wardsynq-notify.js's Dispatcher
   * already stamps onto BreakGlassGrant and CriticalResultLoop - never re-derived, the exact object
   * each write already recorded before this report ever ran. */
  let notifications = { status: "unavailable", error: null };
  try {
    const [grants, loops] = await Promise.all([
      svc.list("BreakGlassGrant", 500).catch(() => []),
      svc.list("CriticalResultLoop", 500).catch(() => []),
    ]);
    const attempts = [...grants, ...loops].filter((r) => r && r.notification && r.notification.attempted);
    const delivered = attempts.filter((r) => r.notification.delivered === true).length;
    notifications = { status: "ok", ...rate(delivered, attempts.length) };
  } catch (e) { notifications = { status: "unavailable", error: str(e && e.message) }; }

  /* DIGITAL TWIN FRESHNESS, from a REAL live twin read taken for this report - not a cached number,
   * because there is no twin store to cache from (see this file's own header). sectionsOk/Total are
   * already the twin's own counted-not-judged health figure; this just names it as one. */
  let twin = { status: "unavailable", error: null };
  try {
    const snap = await buildTwinSnapshot(request, env, ctx);
    twin = snap.ok && snap.twin
      ? { status: "ok", sectionsOk: snap.twin.sectionsOk, sectionsTotal: snap.twin.sectionsTotal, unavailable: snap.twin.unavailable }
      : { status: "unavailable", error: snap.error || "twin_unavailable" };
  } catch (e) { twin = { status: "unavailable", error: str(e && e.message) }; }

  /* P2.15: DATA PROTECTION, from the same receipts the security review reads. Green only when a
   * backup meets its objective AND a successful restore test is recorded; never inferred. */
  let dataProtectionStatus = { status: "unavailable", error: null };
  try {
    const [runs, tests] = await Promise.all([svc.list(BACKUP_RUN_TYPE, 50), svc.list(RESTORE_TYPE, 200)]);
    dataProtectionStatus = dataProtection(runs, tests, ctx.rpoMinutes, new Date().toISOString());
  } catch (e) { dataProtectionStatus = { status: "unavailable", error: str(e && e.message) }; }

  return {
    ...base, ok: true,
    health: {
      generatedAt: new Date().toISOString(),
      ai, notifications, twin, dataProtection: dataProtectionStatus,
      /* WHAT THIS DOES NOT COVER, stated rather than left silent: request-level error rate and
       * latency across the whole router are emitted by observability.js as transient log lines
       * (Cloudflare's own capture, not a second store) and are NOT aggregated back into this report
       * - doing so would mean this application re-implementing the log platform it already sits on.
       * A hospital's Ops team consuming Cloudflare Logpush/Analytics Engine gets that half; this
       * report is the half computed from WardSynQ's own governed records. */
      excludedFromThisReport: ["request-error-rate", "request-latency"],
    },
  };
}

export { FRESHNESS, NOT_BUILT, freshnessOf, percentile, labTurnaround, radiologyBacklog, staffingNow, rosterStaffing, buildTwinSnapshot, reconstructTwinAsOf, operationalHealthReport };
