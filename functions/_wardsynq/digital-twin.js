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

import { patientFlowReport, clinicalOperationsReport, billingReport, claimsReport, pharmacyReport, himReport } from "./reports.js";
import { emergencyStatus, emergencyLog } from "./emergency-mode.js";
import { listBlackouts } from "./blackout.js";
import { listCriticalLoops } from "./critical-results.js";
import { isOutstanding } from "./specimen.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

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
 *  must never be able to mistake "we didn't build this" for "we checked, and it's zero". */
const NOT_BUILT = Object.freeze({
  bloodBank: "no blood-product inventory module exists in this codebase - migrate-transfusion.js records transfusions given, not units held.",
  radiologyQueue: "no hospital-wide radiology/PACS backlog aggregator exists - radiology-protocol.js works per-study, and building a second queue model here would duplicate whatever the real one turns out to need.",
  otUtilisation: "no theatre-utilisation aggregator exists - resource-booking.js records individual bookings and would need its own utilisation logic; that belongs in that file, not invented here as a shortcut.",
});

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
      error: "threw", detail: str(e && e.message) || "the read failed", data: null,
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
    section("criticals", ["CriticalResultLoop"], (rq, e, c) => listCriticalLoops(rq, e, { ...c, policy: c.escalationPolicy }), request, env, ctx),
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
    return { ok: true, generatedAt: new Date().toISOString(), outstanding: outstanding.length, checked: (rows || []).length };
  }, request, env, ctx);

  const sections = { flow, clinicalOps, criticals, emergency, blackouts, pharmacy, him, lis };

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
    for (const current of ids) {
      if (!current || !current.id) continue;
      let history;
      try { history = (await svc.history(type, current.id)) || []; }
      catch { continue; }
      /* The latest version that itself already existed at or before the requested instant. A version
       * whose own timestamp is after T did not exist yet, whatever the current record now shows. */
      const asOfVersion = history
        .filter((v) => v && Date.parse(v[AS_OF_FIELD[type]] || "") <= atMs)
        .sort((a, b) => (b.version || 0) - (a.version || 0))[0];
      if (asOfVersion) rows.push(asOfVersion);
    }
    asOf[type] = { status: "ok", count: rows.length, records: rows };
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

export { FRESHNESS, NOT_BUILT, freshnessOf, buildTwinSnapshot, reconstructTwinAsOf };
