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

export { MIN_DENOMINATOR, measure, notComputable, computeMeasures, qualityReport };
