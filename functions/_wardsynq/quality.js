/* functions/_wardsynq/quality.js — measures, computed from the record, about the SYSTEM.
 *
 * ward-metrics.js answers "what is outstanding on this ward right now". That is the charge nurse's
 * question and it is a snapshot. This answers a different one, over a period: IS THE SAFETY
 * MACHINERY ACTUALLY WORKING. A ward can have nothing outstanding this minute and still have
 * acknowledged half its critical results four hours late all month.
 *
 * A MEASURE IS ABOUT A SYSTEM, NEVER ABOUT A PERSON. Nothing here aggregates by clinician, for the
 * same reason override-analytics.js does not: the moment a number can be attributed to an individual
 * it stops measuring the process and starts managing the staff, and the immediate effect is that
 * people work to the number. No actor id appears in any output of this file.
 *
 * A RATE WITH A TINY DENOMINATOR IS NOT EVIDENCE, and the commonest way a quality dashboard lies is
 * by printing "100%" over a denominator of one. Every measure carries its numerator and denominator
 * as first-class numbers, and one computed over fewer than MIN_DENOMINATOR cases is flagged as
 * `underpowered` rather than quietly shown as a percentage.
 *
 * A MEASURE THAT CANNOT BE COMPUTED SAYS SO, WITH THE REASON. It is not omitted, because a missing
 * row on a dashboard reads as "nothing to report", and it is not estimated. Returning a measure with
 * `computable: false` and the reason is the whole point: it names the record deficiency that has to
 * be fixed before the number can exist.
 *
 * IT IS COMPUTED, NEVER STORED. Same reason as the ward metrics: a stored measure is a stale measure,
 * and one that lags the record is worse than none.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** Below this, a rate is reported but flagged: three of three is not evidence of anything. */
const MIN_DENOMINATOR = 20;

/** PURE. One measure. `rate` is null when there is nothing to divide by - never 0, never 100. */
function measure(id, title, numerator, denominator, extra) {
  const n = Number(numerator) || 0, d = Number(denominator) || 0;
  return {
    id, title, numerator: n, denominator: d,
    /* Null, not zero. "0%" over no cases reads as a failing ward; "no cases in this period" reads as
     * what it is. The distinction is the difference between a dashboard and a rumour. */
    rate: d > 0 ? Math.round((n / d) * 1000) / 1000 : null,
    ...(d > 0 && d < MIN_DENOMINATOR ? { underpowered: true, note: `${d} case${d === 1 ? "" : "s"} in this period. Too few to read as a rate.` } : {}),
    computable: true,
    ...(extra || {}),
  };
}

/** PURE. A measure the record cannot support, named with the reason rather than left off. */
function notComputable(id, title, reason) {
  return { id, title, numerator: null, denominator: null, rate: null, computable: false, reason };
}

const inPeriod = (t, fromMs, toMs) => {
  const ms = Date.parse(str(t));
  return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
};

/**
 * PURE. The measures, from records already read. Everything is an input so the read policy stays in
 * the caller, where the actor's scope is applied.
 *
 * input: { loops, administrations, encounters, summaries, fromMs, toMs, ackWindowMinutes }
 */
function computeMeasures(input) {
  const i = input || {};
  const fromMs = Number(i.fromMs), toMs = Number(i.toMs);
  const out = [];

  /* 1. CRITICAL RESULTS ACKNOWLEDGED WITHIN THE WINDOW.
   *
   * The denominator is every loop OPENED in the period, not every loop acknowledged in it. Counting
   * only the acknowledged ones would drop exactly the failures the measure exists to find: a result
   * nobody ever acknowledged would leave the calculation entirely and the rate would read 100%. */
  const window = Number(i.ackWindowMinutes);
  const loops = (i.loops || []).filter((l) => l && inPeriod(l.reportedAt || l.openedAt, fromMs, toMs));
  if (!Number.isFinite(window) || window <= 0) {
    out.push(notComputable(
      "critical-ack-within-window", "Critical results acknowledged within the escalation window",
      "This hospital has configured no escalation window, so there is no threshold to measure against. Set wardsynq.criticalEscalation on the organisation.",
    ));
  } else {
    let onTime = 0, never = 0;
    for (const l of loops) {
      const opened = Date.parse(str(l.reportedAt || l.openedAt));
      const acked = Date.parse(str(l.acknowledgedAt));
      if (!Number.isFinite(acked)) { never++; continue; }
      if (Number.isFinite(opened) && (acked - opened) <= window * 60000) onTime++;
    }
    out.push(measure(
      "critical-ack-within-window", "Critical results acknowledged within the escalation window",
      onTime, loops.length,
      {
        windowMinutes: window,
        // Counted separately and shown, because "acknowledged late" and "never acknowledged at all"
        // are different failures and only one of them is still happening.
        neverAcknowledged: never,
      },
    ));
  }

  /* 2. DOSES GIVEN ON TIME. Needs the time the dose was DUE, which the administration record began
   * carrying on 2026-09-07; anything written before that has no dueAt and is excluded from BOTH
   * halves rather than counted as late. Excluding from the denominator too is the honest choice: a
   * record that cannot answer the question is not evidence of a late dose. */
  const graceMinutes = Number.isFinite(Number(i.graceMinutes)) ? Number(i.graceMinutes) : 60;
  const given = (i.administrations || []).filter((a) => a && a.status === "administered" && inPeriod(a.administeredAt, fromMs, toMs));
  const dated = given.filter((a) => str(a.dueAt) && Number.isFinite(Date.parse(str(a.dueAt))));
  if (!given.length) {
    out.push(measure("dose-on-time", "Scheduled doses given within the grace period", 0, 0, { graceMinutes }));
  } else if (!dated.length) {
    out.push(notComputable(
      "dose-on-time", "Scheduled doses given within the grace period",
      `None of the ${given.length} doses given in this period record when they were due, so lateness cannot be computed. Administration records written before 2026-09-07 do not carry dueAt.`,
    ));
  } else {
    let onTime = 0;
    for (const a of dated) {
      const late = Date.parse(str(a.administeredAt)) - Date.parse(str(a.dueAt));
      // Early is not late. A dose given before it was due is a different question, and folding it in
      // here would hide lateness behind it.
      if (late <= graceMinutes * 60000) onTime++;
    }
    out.push(measure("dose-on-time", "Scheduled doses given within the grace period", onTime, dated.length, {
      graceMinutes,
      ...(dated.length < given.length ? { excludedNoDueTime: given.length - dated.length } : {}),
    }));
  }

  /* 3. A SIGNED DISCHARGE SUMMARY FOR EVERY CLOSED STAY. The denominator is stays that ENDED in the
   * period; a stay still open is not late, it is ongoing, and counting it would make the measure a
   * function of how busy the ward is. */
  const closed = (i.encounters || []).filter((e) => e && e.class === "IPD" && e.status === "finished" && inPeriod(e.periodEnd, fromMs, toMs));
  /* The summary is a ClinicalNote with noteType "discharge-summary" - it is not its own resource
   * type. Filtering on the note type matters: counting every signed note against a stay would report
   * a discharge summary wherever anybody had signed a ward round entry. */
  const signedFor = new Set((i.summaries || [])
    .filter((s) => s && s.noteType === "discharge-summary" && s.signedBy)
    .map((s) => str(s.encounterId)));
  out.push(measure(
    "discharge-summary-signed", "Discharges with a signed summary",
    closed.filter((e) => signedFor.has(str(e.id))).length, closed.length,
  ));

  /* 4. ALLERGY STATUS DOCUMENTED. Deliberately NOT computed, and this is the useful part.
   *
   * WardSynQ has no way to record "asked, and there are none". A patient with no AllergyIntolerance
   * is indistinguishable from one nobody asked, so any number here would be a guess dressed as a
   * measure - and it would guess in the dangerous direction, reporting good documentation for a ward
   * that never asks. The fix is a record change, not a calculation. */
  out.push(notComputable(
    "allergy-status-documented", "Admissions with an allergy status documented",
    "WardSynQ cannot record \"asked, and there are none\", so a patient with no allergy record is indistinguishable from one nobody asked. Any rate here would report good documentation for a ward that never asks. This needs a no-known-allergies record, not a calculation.",
  ));

  return out;
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

/** ctx: { migration, days?, now?, ackWindowMinutes?, graceMinutes?, actorDeps, recordDeps } */
async function qualityReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", measures: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, measures: [] };

  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const days = Math.min(365, Math.max(1, Number(ctx.days) || 30));
  const fromMs = nowMs - days * 86400000;

  let loops, administrations, encounters, summaries;
  try {
    [loops, administrations, encounters, summaries] = await Promise.all([
      svc.list("CriticalResultLoop", 1000),
      svc.list("MedicationAdministration", 1000),
      svc.list("Encounter", 1000),
      svc.list("ClinicalNote", 1000),
    ]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), measures: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), measures: [] };
  }

  const measures = computeMeasures({
    loops, administrations, encounters, summaries,
    fromMs, toMs: nowMs,
    ackWindowMinutes: ctx.ackWindowMinutes, graceMinutes: ctx.graceMinutes,
  });

  return {
    ...base, ok: true,
    period: { days, from: new Date(fromMs).toISOString(), to: new Date(nowMs).toISOString() },
    measures,
    // Counted, so a dashboard cannot look complete while half of it is unavailable.
    notComputable: measures.filter((m) => !m.computable).length,
    note: "These measure the SYSTEM, over a period. No clinician is named or counted, and a measure "
      + "the record cannot support is shown with its reason rather than left off.",
  };
}


/* ================================================================== P1.14: quality and safety measures
 *
 * One report, each measure with its numerator, denominator, period and the CASE LIST behind it
 * (record ids and patient ids, never a clinician). Definitions and their sources:
 *
 *   - Inpatient mortality, 30-day readmission, sepsis bundle compliance: the UNAPPROVED seed
 *     definitions in wardsynq/wardsynq-quality.js (MEASURES), reused unchanged through computeMeasure,
 *     so their exclusions are counted by reason and a denominator under 20 is not shown as a rate.
 *   - Length of stay, bed-days, bed utilisation: Encounter periodStart/periodEnd
 *     (wardsynq/wardsynq-model.js), inpatient classes as functions/_wardsynq/migrate-inpatient.js.
 *   - Falls, pressure injuries, medication errors, HAI: CONFIRMED incidents only, by the category list
 *     in wardsynq/wardsynq-incidents.js (CATEGORY). A signal nobody has confirmed is not counted.
 *     Pressure injuries count confirmed incidents; hospital-acquired stage 2+ pressure wound records
 *     (functions/_wardsynq/wound.js) are reported BESIDE the rate, not added to it, because a wound and
 *     an incident about the same wound would otherwise be counted twice.
 *   - Antibiotic days of therapy: one patient receiving one listed drug on one calendar day (UTC) is one
 *     day of therapy, from administered MedicationAdministration records. The list is the hospital's
 *     (wsqCfg.antibiotics); with none configured the measure is not computable, never 0.
 *   - Lab and radiology turnaround: ServiceRequest time to DiagnosticReport reportedAt
 *     (functions/_wardsynq/lab-result.js, radiology-report.js). Only items with BOTH timestamps are
 *     measured; the rest are counted as exclusions.
 */
import { MEASURES as SEED, computeMeasure, withEvidence } from "../../wardsynq/wardsynq-quality.js";
import { CATEGORY, stageOf } from "../../wardsynq/wardsynq-incidents.js";
import { hydrateBundle } from "./migrate-resus.js";
import { provenanceReport } from "../../wardsynq/wardsynq-bundle-binding.js";

const DAY = 86400000;
const INPATIENT = new Set(["IPD", "ICU", "MATERNITY", "PEDIATRICS", "NICU"]);
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };
const round = (v, dp) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const median = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const DEATH = /\b(died|death|deceased|expired|dead)\b/i;

/** Bed-days a stay contributed inside [fromMs, toMs]. An open stay runs to toMs. */
function overlapDays(e, fromMs, toMs) {
  const a = ms(e.periodStart); if (a == null) return 0;
  const b = ms(e.periodEnd) == null ? toMs : ms(e.periodEnd);
  return Math.max(0, Math.min(b, toMs) - Math.max(a, fromMs)) / DAY;
}

/** A per-1000-bed-days rate: null (with reason) when there are no bed-days to divide by. */
function perThousand(id, title, cases, bedDays, extra) {
  return {
    id, title, computable: true, numerator: cases.length, denominator: round(bedDays, 1), unit: "per 1000 bed-days",
    rate: bedDays > 0 ? round((cases.length / bedDays) * 1000, 2) : null,
    ...(bedDays > 0 ? {} : { note: "No occupied bed-days in this period, so there is no rate." }),
    cases, ...(extra || {}),
  };
}

/** A seed-definition result, reshaped to this report's row. */
function seedRow(result, cases, extra) {
  return {
    id: result.measureId, title: result.label, version: result.version, computable: true,
    numerator: result.numerator, denominator: result.denominator, rate: result.rate,
    underpowered: result.suppressed, note: result.suppressed ? result.suppressionReason : null,
    excluded: result.excluded, exclusionsByReason: result.exclusionsByReason, reading: result.reading,
    cases, ...(extra || {}), source: "wardsynq/wardsynq-quality.js",
  };
}

/**
 * PURE. input: { encounters, patients, bundles, incidents, wounds, administrations, requests, reports,
 * beds, antibiotics, fromMs, toMs, unreadable: {Type: reason} }
 */
function computeQualitySafety(input) {
  const i = input || {};
  const fromMs = Number(i.fromMs), toMs = Number(i.toMs);
  const bad = i.unreadable || {};
  const blocked = (types) => types.find((t) => bad[t]);
  const out = [];
  const inP = (t) => { const v = ms(t); return v != null && v >= fromMs && v <= toMs; };

  const stays = (i.encounters || []).filter((e) => e && INPATIENT.has(e.class) && e.status !== "cancelled");
  const bedDays = stays.reduce((n, e) => n + overlapDays(e, fromMs, toMs), 0);
  const closed = stays.filter((e) => e.status === "finished" && inP(e.periodEnd) && ms(e.periodStart) != null);
  const encBlocked = blocked(["Encounter"]);

  // LENGTH OF STAY, over stays that ENDED in the period.
  if (encBlocked) out.push(notComputable("length-of-stay", "Length of stay", `Encounter records could not be read: ${bad.Encounter}`));
  else {
    const days = closed.map((e) => (ms(e.periodEnd) - ms(e.periodStart)) / DAY);
    out.push({
      id: "length-of-stay", title: "Length of stay (days, stays ended in the period)", computable: true,
      numerator: round(days.reduce((a, b) => a + b, 0), 1), denominator: closed.length, unit: "days",
      rate: null, mean: closed.length ? round(days.reduce((a, b) => a + b, 0) / closed.length, 1) : null,
      median: round(median(days), 1),
      cases: closed.map((e) => ({ id: e.id, patientId: e.patientId || null })),
    });
  }

  // MORTALITY and READMISSION: the seed definitions, fed the facts the record has.
  if (encBlocked || blocked(["Patient"])) {
    const why = `Records could not be read: ${bad.Encounter || bad.Patient}`;
    out.push(notComputable(SEED.INPATIENT_MORTALITY.id, SEED.INPATIENT_MORTALITY.label, why));
    out.push(notComputable(SEED.READMISSION_30D.id, SEED.READMISSION_30D.label, why));
  } else {
    const deceasedAt = new Map((i.patients || []).filter((p) => p && p.deceased && p.deceased.at).map((p) => [str(p.id), ms(p.deceased.at)]));
    const died = (e) => {
      const d = deceasedAt.get(str(e.patientId));
      if (d != null && d >= ms(e.periodStart) && d <= ms(e.periodEnd) + DAY) return true;
      if (DEATH.test(str(e.disposition))) return true;
      // No disposition and no death record: we cannot tell, which is counted as data missing.
      return str(e.disposition) ? false : null;
    };
    const cases = closed.map((e) => {
      const end = ms(e.periodEnd);
      const back = stays.some((o) => o !== e && str(o.patientId) === str(e.patientId) && ms(o.periodStart) > end && ms(o.periodStart) <= end + 30 * DAY);
      return {
        id: e.id, patientId: e.patientId || null, encounterClass: "IPD", dischargedAt: e.periodEnd, died: died(e),
        readmittedWithin30Days: back ? true : end + 30 * DAY > toMs ? undefined : false,
      };
    });
    const ids = (pred) => cases.filter(pred).map((c) => ({ id: c.id, patientId: c.patientId }));
    out.push(seedRow(computeMeasure(SEED.INPATIENT_MORTALITY, cases), ids((c) => c.died === true),
      { note2: "Deaths are read from a recorded death (Patient.deceased) or a discharge disposition. A stay with neither is excluded as data missing, and counted." }));
    out.push(seedRow(computeMeasure(SEED.READMISSION_30D, cases), ids((c) => c.readmittedWithin30Days === true),
      { note2: "The record has no planned-readmission flag, so every readmission is counted as unplanned." }));
  }

  // SEPSIS BUNDLE COMPLIANCE: code-sepsis bundles started in the period. A running bundle is not yet
  // compliant or breached, so it is held out of the seed measure and counted.
  if (blocked(["ResusBundle"])) out.push(notComputable(SEED.SEPSIS_BUNDLE.id, SEED.SEPSIS_BUNDLE.label, `ResusBundle records could not be read: ${bad.ResusBundle}`));
  else {
    const now = new Date(toMs).toISOString();
    const hyd = (i.bundles || []).filter((b) => b && b.code === "code-sepsis" && inP(b.timeZero || b.openedAt))
      .map((b) => { try { return { rec: b, h: hydrateBundle(b) }; } catch (e) { return null; } }).filter(Boolean);
    const withStatus = hyd.map((x) => ({ ...x, s: x.h.status(now) }));
    const decided = withStatus.filter((x) => x.s.state !== "running");
    const cases = decided.map((x) => ({ id: x.rec.id, patientId: x.rec.patientId || null, sepsisBundle: { state: x.s.state, compliant: x.s.compliant } }));
    let row = computeMeasure(SEED.SEPSIS_BUNDLE, cases);
    try { row = withEvidence(row, provenanceReport(decided.map((x) => x.h), now)); } catch (e) { row = { ...row, evidence: null }; }
    out.push(seedRow(row, cases.filter((c) => c.sepsisBundle.compliant).map((c) => ({ id: c.id, patientId: c.patientId })), {
      stillRunning: withStatus.length - decided.length, evidence: row.evidence || null,
      allCases: cases.map((c) => ({ id: c.id, patientId: c.patientId, state: c.sepsisBundle.state })),
    }));
  }

  // INCIDENT-BASED RATES: confirmed incidents by category, dated by when the event happened.
  const confirmed = (i.incidents || []).filter((x) => x && x.confirmation && x.confirmation.outcome === "confirmed" && inP(x.when || x.reportedAt));
  const byCat = (c) => confirmed.filter((x) => x.category === c).map((x) => ({ id: x.id, patientId: x.patientId || null, severity: x.severity }));
  const incBlocked = blocked(["IncidentReport"]);
  const rateRow = (id, title, cat, extra) => (incBlocked || encBlocked
    ? notComputable(id, title, `Records could not be read: ${bad.IncidentReport || bad.Encounter}`)
    : perThousand(id, title, byCat(cat), bedDays, { source: "confirmed incidents, category " + cat, ...(extra ? extra() : {}) }));
  out.push(rateRow("falls", "Falls per 1000 bed-days", CATEGORY.FALL));
  out.push(rateRow("pressure-injuries", "Pressure injuries per 1000 bed-days", CATEGORY.PRESSURE_INJURY, () => {
    if (bad.WoundAssessment) return { woundRecords: null, woundRecordsReason: `Wound records could not be read: ${bad.WoundAssessment}` };
    const seen = new Map();
    for (const w of i.wounds || []) {
      if (!w || w.kind !== "pressure" || w.origin !== "acquired-here" || !inP(w.assessedAt)) continue;
      const st = str(w.worstStage || w.stage);
      if (["2", "3", "4", "unstageable", "deep-tissue"].includes(st)) seen.set(str(w.woundId || w.id), { id: w.woundId || w.id, patientId: w.patientId || null, stage: st });
    }
    return { woundRecords: seen.size, woundCases: [...seen.values()], woundNote: "Hospital-acquired pressure wounds at stage 2 or worse recorded in the period, shown beside the rate and not added to it." };
  }));
  out.push(rateRow("medication-errors", "Medication error incidents per 1000 bed-days", CATEGORY.MEDICATION_ERROR));
  out.push(rateRow("hai", "Healthcare-associated infections per 1000 bed-days", CATEGORY.HAI));

  // ANTIBIOTIC DAYS OF THERAPY.
  const abx = (Array.isArray(i.antibiotics) ? i.antibiotics : []).map((a) => str(a).toLowerCase()).filter(Boolean);
  if (!abx.length) out.push(notComputable("antibiotic-dot", "Antibiotic days of therapy per 1000 bed-days", "antibiotic list not configured. Set wardsynq.antibiotics on the organisation to the drug names or codes this hospital counts."));
  else if (blocked(["MedicationAdministration", "Encounter"])) out.push(notComputable("antibiotic-dot", "Antibiotic days of therapy per 1000 bed-days", "Administration or encounter records could not be read."));
  else {
    const days = new Map();
    for (const a of i.administrations || []) {
      if (!a || a.status !== "administered" || !inP(a.administeredAt)) continue;
      const drug = str(a.drug).toLowerCase(), code = str(a.drugCode).toLowerCase();
      if (!abx.some((x) => x === code || (drug && (drug === x || drug.startsWith(x + " "))))) continue;
      const key = `${str(a.patientId)}|${drug || code}|${str(a.administeredAt).slice(0, 10)}`;
      if (!days.has(key)) days.set(key, { id: a.id, patientId: a.patientId || null, drug: a.drug || a.drugCode, day: str(a.administeredAt).slice(0, 10) });
    }
    out.push(perThousand("antibiotic-dot", "Antibiotic days of therapy per 1000 bed-days", [...days.values()], bedDays, { antibioticList: abx }));
  }

  // TURNAROUND TIMES.
  const reqAt = new Map((i.requests || []).filter(Boolean).map((r) => [str(r.id), r.authoredOn || r.requestedAt || r.orderedAt || (r.meta && r.meta.recordedAt) || null]));
  const tat = (id, title, pick) => {
    if (blocked(["DiagnosticReport", "ServiceRequest"])) return notComputable(id, title, "Report or request records could not be read.");
    const items = (i.reports || []).filter((r) => r && pick(r) && inP(r.reportedAt));
    const measured = [], excluded = [];
    for (const r of items) {
      const a = ms(reqAt.get(str(r.serviceRequestId))), b = ms(r.reportedAt);
      if (a == null || b == null || b < a) excluded.push({ id: r.id, patientId: r.patientId || null });
      else measured.push({ id: r.id, patientId: r.patientId || null, minutes: Math.round((b - a) / 60000) });
    }
    const mins = measured.map((m) => m.minutes);
    return {
      id, title, computable: true, unit: "minutes", numerator: null, denominator: measured.length, rate: null,
      median: median(mins), mean: mins.length ? Math.round(mins.reduce((x, y) => x + y, 0) / mins.length) : null,
      excludedMissingTimestamp: excluded.length, excludedCases: excluded, cases: measured,
    };
  };
  out.push(tat("lab-tat", "Laboratory turnaround (request to result)", (r) => r.category !== "imaging"));
  out.push(tat("radiology-tat", "Radiology turnaround (request to report)", (r) => r.category === "imaging"));

  // BED UTILISATION from the configured beds.
  const bedCount = i.beds && typeof i.beds === "object" ? Object.values(i.beds).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0) : 0;
  if (!bedCount) out.push(notComputable("bed-utilisation", "Bed utilisation", "No beds are configured for this hospital (wardsynq.beds), so there is no available bed-days denominator."));
  else if (encBlocked) out.push(notComputable("bed-utilisation", "Bed utilisation", `Encounter records could not be read: ${bad.Encounter}`));
  else {
    const available = bedCount * ((toMs - fromMs) / DAY);
    out.push({
      id: "bed-utilisation", title: "Bed utilisation (occupied / available bed-days)", computable: true,
      numerator: round(bedDays, 1), denominator: round(available, 1), rate: available > 0 ? round(bedDays / available, 3) : null,
      configuredBeds: bedCount, note: "Available beds are the configured bed list; blocked or closed beds are not subtracted.",
      cases: stays.filter((e) => overlapDays(e, fromMs, toMs) > 0).map((e) => ({ id: e.id, patientId: e.patientId || null, bedDays: round(overlapDays(e, fromMs, toMs), 2) })),
    });
  }

  return { measures: out, bedDays: encBlocked ? null : round(bedDays, 1) };
}

/** PURE. Safety pipeline counts from the incident ledger. */
function safetyCounts(incidents) {
  const all = (incidents || []).filter(Boolean);
  const confirmed = all.filter((x) => x.confirmation && x.confirmation.outcome === "confirmed");
  const capas = confirmed.flatMap((x) => x.capas || []);
  return {
    signals: all.filter((x) => stageOf(x) === "signal").length,
    confirmed: confirmed.length,
    rejected: all.filter((x) => stageOf(x) === "rejected").length,
    withRootCause: confirmed.filter((x) => x.rca).length,
    capasOpen: capas.filter((c) => c.state !== "complete").length,
    capasCompleted: capas.filter((c) => c.state === "complete").length,
  };
}

const QS_TYPES = ["Encounter", "Patient", "ResusBundle", "IncidentReport", "WoundAssessment", "MedicationAdministration", "ServiceRequest", "DiagnosticReport"];

/** ctx: { migration, days?, now?, beds?, antibiotics?, actorDeps, recordDeps } */
async function qualitySafetyReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", measures: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, measures: [] };

  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const days = Math.min(365, Math.max(1, Number(ctx.days) || 30));
  const fromMs = nowMs - days * DAY;
  /* Read each type on its own: one type this actor cannot read makes the measures that need it
   * null with the reason, not the whole report a failure and not a row of zeros. */
  const unreadable = {}, rows = {};
  await Promise.all(QS_TYPES.map(async (t) => {
    try { rows[t] = await svc.list(t, 1000); }
    catch (e) { unreadable[t] = e instanceof GovernanceError ? "not readable with this role" : str(e && e.message) || "read failed"; rows[t] = []; }
  }));
  const r = computeQualitySafety({
    encounters: rows.Encounter, patients: rows.Patient, bundles: rows.ResusBundle, incidents: rows.IncidentReport,
    wounds: rows.WoundAssessment, administrations: rows.MedicationAdministration, requests: rows.ServiceRequest,
    reports: rows.DiagnosticReport, beds: ctx.beds, antibiotics: ctx.antibiotics, fromMs, toMs: nowMs, unreadable,
  });
  return {
    ...base, ok: true,
    period: { days, from: new Date(fromMs).toISOString(), to: new Date(nowMs).toISOString() },
    bedDays: r.bedDays, measures: r.measures,
    safety: unreadable.IncidentReport ? null : safetyCounts(rows.IncidentReport),
    unreadable: Object.keys(unreadable),
    notComputable: r.measures.filter((m) => !m.computable).length,
    note: "Measures of the system over a period. Case lists name records and patients, never a clinician.",
  };
}

export { MIN_DENOMINATOR, INPATIENT, DEATH, measure, notComputable, computeMeasures, qualityReport, computeQualitySafety, safetyCounts, qualitySafetyReport };
