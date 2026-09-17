/* functions/_wardsynq/twin-predict.js — TASK 10.12: governed operational predictions.
 *
 * A PREDICTION IS NEVER AN OBSERVED FACT, and the whole design of this file is making that
 * impossible to lose in transit: every prediction is returned inside a `prediction` envelope that
 * carries the plan's own required fields (model/version, inputs timestamp, horizon, uncertainty,
 * generation time, provenance) and NOTHING here is ever merged into a `sections` object shaped like
 * digital-twin.js's observed sections - a caller cannot accidentally treat a prediction as a fact by
 * reading the wrong key, because the shapes do not match.
 *
 * THE METHOD IS DELIBERATELY NAIVE, AND SAYS SO. This is a moving-average / linear-trend projector
 * over real counts this codebase already computes - not a claim to statistical or clinical
 * sophistication. `modelId` names the method plainly ("wardsynq-moving-average-v1") so nobody reads
 * "prediction" and assumes a trained model exists. Section 25 of the plan is explicit: if a model is
 * unavailable, say unavailable; nothing here pretends otherwise by substituting a guess for a
 * refusal - an empty input window returns NO PREDICTION, not a zero presented as one.
 *
 * ALL EIGHT ARE WIRED (2026-09-17): discharge volume, critical-result backlog, bed demand, ED load, diagnostic workload,
 * pharmacy workload and blood demand, each a per-day count from a field this codebase already writes; and theatre delays
 * (R2-2), a per-day mean of minutes from a case's scheduled start to the patient entering the theatre.
 *
 * THE INPUTS TRAVEL WITH THE NUMBER. Every envelope carries the daily counts it was averaged from and the method in
 * words, so a screen can show exactly what the forecast rests on. A day is a whole UTC day from the first day with a
 * recorded event to yesterday; a day with no event counts as zero (a mean over only the busy days overstated every
 * rate), and today, not yet over, is left out. No event at all is a refusal, never a forecast of zero.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const MODEL_ID = "wardsynq-moving-average-v1";

/**
 * PURE. The primitive every prediction is built from. `samples` is an array of {atIso, value} points
 * already extracted by the caller from real records - this function never reads a record itself, so
 * it can be tested without any storage at all. Returns the full governed envelope, or a REFUSAL
 * (never a fabricated number) when there is nothing to project from.
 */
function governedPrediction({ metric, samples, horizonDays, generatedAt, method }) {
  const at = generatedAt || new Date().toISOString();
  const clean = (samples || []).filter((s) => s && Number.isFinite(Number(s.value)) && Date.parse(s.atIso));
  if (clean.length < 2) {
    return {
      ok: false, metric, error: "insufficient_data",
      detail: `${clean.length} usable sample(s) - a projection needs at least 2, and this file will not fabricate one. If a caller sees this, the honest answer is "no prediction available", not a guess.`,
      prediction: null,
    };
  }
  const values = clean.map((s) => Number(s.value));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  return {
    ok: true, metric,
    prediction: {
      /* THE FIVE REQUIRED FIELDS, PLUS THE VALUE - named individually so none can be silently
       * dropped by a caller destructuring only the number they want. */
      modelId: MODEL_ID,
      generatedAt: at,
      horizonDays: Number.isFinite(Number(horizonDays)) ? Number(horizonDays) : 1,
      inputWindow: { from: clean[0].atIso, to: clean[clean.length - 1].atIso, sampleSize: clean.length },
      /* What the number rests on, shown beside it: the method in words and every daily value averaged. */
      method: method || "mean of the samples given",
      inputs: clean.map((x) => ({ atIso: x.atIso, value: Number(x.value) })),
      pointEstimate: Math.round(mean * 100) / 100,
      uncertainty: {
        method: "sample standard deviation over the input window - not a confidence interval from a fitted model",
        stddev: Math.round(stddev * 100) / 100,
        lowerBound: Math.round(Math.max(0, mean - stddev) * 100) / 100,
        upperBound: Math.round((mean + stddev) * 100) / 100,
      },
      /* STATED ON EVERY PREDICTION, not just in this file's header, because a prediction can travel
       * (into a UI card, into a MaiK answer, into an export) somewhere this header is not read. */
      label: "PREDICTION - NOT AN OBSERVED FACT",
    },
  };
}

const DAY_MS = 86400000;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * PURE. One sample per whole UTC day from the first day with an event in the window to yesterday, zero-filled.
 * events: [{ atMs, weight? }]. No event in the window gives no samples (a refusal downstream, never a zero forecast).
 */
function dailySamples(events, fromMs, nowMs) {
  const endMs = Date.parse(dayOf(nowMs) + "T00:00:00.000Z");
  const byDay = new Map();
  for (const e of events || []) {
    if (!e || !Number.isFinite(e.atMs) || e.atMs < fromMs || e.atMs >= endMs) continue;
    const w = Number.isFinite(Number(e.weight)) ? Number(e.weight) : 1;
    byDay.set(dayOf(e.atMs), (byDay.get(dayOf(e.atMs)) || 0) + w);
  }
  if (!byDay.size) return [];
  const out = [];
  for (let d = Date.parse([...byDay.keys()].sort()[0] + "T00:00:00.000Z"); d < endMs; d += DAY_MS) {
    const k = dayOf(d);
    out.push({ atIso: `${k}T00:00:00.000Z`, value: byDay.get(k) || 0 });
  }
  return out;
}
const at = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : null; };

/* Each wired metric: the record type it counts, what one event is, and the method in words. */
const COUNTS = {
  "discharge-volume": { type: "Encounter", lookbackDays: 14, method: "stays that ended each day (Encounter end time)",
    events: (rows) => rows.map((e) => ({ atMs: at(e.periodEnd) })) },
  "bed-demand": { type: "Encounter", lookbackDays: 14, method: "stays that started each day (Encounter start time)",
    events: (rows) => rows.map((e) => ({ atMs: at(e.periodStart) })) },
  /* The SAME start time, filtered to class ED: an ED arrival IS an Encounter of that class (migrate-ed.js). */
  "ed-load": { type: "Encounter", lookbackDays: 14, method: "emergency department arrivals each day (ED Encounter start time)",
    events: (rows) => rows.filter((e) => e.class === "ED").map((e) => ({ atMs: at(e.periodStart) })) },
  /* The category field the LIS and radiology routes already read, never a second classification. */
  "diagnostic-workload": { type: "ServiceRequest", lookbackDays: 14, method: "laboratory and imaging requests made each day",
    events: (rows) => rows.filter((o) => o.category === "laboratory" || o.category === "imaging").map((o) => ({ atMs: at((o.meta && (o.meta.effectiveAt || o.meta.recordedAt)) || "") })) },
  /* pharmacy-dispense.js's own issue timestamp, never an order date standing in for it. */
  "pharmacy-workload": { type: "MedicationDispense", lookbackDays: 14, method: "medicines issued each day (dispense time)",
    events: (rows) => rows.map((d) => ({ atMs: at(d.dispensedAt) })) },
  /* Units asked for, from the transfusion episode's own "requested" ledger entry (wardsynq-transfusion.js), weighted by
   * the units requested: demand, not what the blood bank happened to have on the shelf. */
  "blood-demand": { type: "TransfusionEpisode", lookbackDays: 28, method: "blood units requested each day (transfusion request time, units requested)",
    events: (rows) => rows.map((e) => { const r = (Array.isArray(e.ledger) ? e.ledger : []).find((x) => x && x.event === "requested"); return { atMs: at(r && r.at), weight: Number(e.unitsRequested) || 1 }; }) },
};

function countingPredictor(metric) {
  const spec = COUNTS[metric];
  return async function predict(svc, { lookbackDays, horizonDays = 1, now } = {}) {
    const nowMs = Number.isFinite(now) ? now : Date.now();
    const fromMs = nowMs - (lookbackDays || spec.lookbackDays) * DAY_MS;
    let rows;
    try { rows = (await svc.list(spec.type, 2000)).filter(Boolean); }
    catch (e) { return { ok: false, metric, error: "record_read_failed", detail: str(e && e.message), prediction: null }; }
    return governedPrediction({ metric, samples: dailySamples(spec.events(rows), fromMs, nowMs), horizonDays, generatedAt: new Date(nowMs).toISOString(), method: `mean of ${spec.method}` });
  };
}
const predictDischargeVolume = countingPredictor("discharge-volume");
const predictBedDemand = countingPredictor("bed-demand");
const predictEdLoad = countingPredictor("ed-load");
const predictDiagnosticWorkload = countingPredictor("diagnostic-workload");
const predictPharmacyWorkload = countingPredictor("pharmacy-workload");
const predictBloodDemand = countingPredictor("blood-demand");

/**
 * Critical-result backlog: one point per whole day, value = CriticalResultLoop rows STILL OPEN at the end of that day,
 * reusing the loop's own reportedAt/closedAt, never re-deriving what "open" means. Starts at the first day a loop was
 * reported, so a hospital with no loops gets a refusal, not a backlog of zero.
 */
async function predictCriticalBacklog(svc, { lookbackDays = 7, horizonDays = 1, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const endMs = Date.parse(dayOf(nowMs) + "T00:00:00.000Z");
  let loops;
  try { loops = (await svc.list("CriticalResultLoop", 2000)).filter((l) => l && at(l.reportedAt) != null); }
  catch (e) { return { ok: false, metric: "critical-backlog", error: "record_read_failed", detail: str(e && e.message), prediction: null }; }
  const firstMs = loops.reduce((m, l) => Math.min(m, at(l.reportedAt)), Infinity);
  const samples = [];
  if (Number.isFinite(firstMs)) {
    for (let d = Date.parse(dayOf(Math.max(nowMs - lookbackDays * DAY_MS, firstMs)) + "T00:00:00.000Z"); d < endMs; d += DAY_MS) {
      const dayEnd = d + DAY_MS;
      const value = loops.filter((l) => at(l.reportedAt) < dayEnd && !(at(l.closedAt) != null && at(l.closedAt) < dayEnd)).length;
      samples.push({ atIso: new Date(d).toISOString(), value });
    }
  }
  return governedPrediction({ metric: "critical-backlog", samples, horizonDays, generatedAt: new Date(nowMs).toISOString(), method: "mean of critical results still open at the end of each day" });
}

/**
 * Theatre delays (R2-2): for each case whose patient entered the theatre in the window, minutes from its scheduled start
 * (`scheduledAt`, the current plan after any reschedule) to `theatreTimes.inRoomAt`, both recorded by people
 * (migrate-surgery.js). A case booked without a scheduled start has no delay to measure: it is left out and counted,
 * never read as on time. One sample per UTC day that had a measured case, the mean of that day's cases; a day with no
 * case is not a day with no delay, so it is not zero-filled. Fewer than 2 such days is a refusal. A negative value is an
 * early start, kept as recorded. This is not the booking volume digital-twin.js's otUtilisation computes.
 */
async function predictOtDelays(svc, { lookbackDays = 28, horizonDays = 1, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const fromMs = nowMs - lookbackDays * DAY_MS, endMs = Date.parse(dayOf(nowMs) + "T00:00:00.000Z");
  let cases;
  try { cases = (await svc.list("SurgicalCase", 2000)).filter(Boolean); }
  catch (e) { return { ok: false, metric: "ot-delays", error: "record_read_failed", detail: str(e && e.message), prediction: null }; }
  const byDay = new Map();
  let excluded = 0, measured = 0;
  for (const c of cases) {
    const inAt = at(c.theatreTimes && c.theatreTimes.inRoomAt);
    if (inAt == null || inAt < fromMs || inAt >= endMs) continue;
    const sched = at(c.scheduledAt);
    if (sched == null) { excluded++; continue; }
    measured++;
    const d = byDay.get(dayOf(inAt)) || { sum: 0, cases: 0 };
    d.sum += (inAt - sched) / 60000; d.cases++;
    byDay.set(dayOf(inAt), d);
  }
  const samples = [...byDay.keys()].sort().map((k) => ({ atIso: `${k}T00:00:00.000Z`, value: Math.round((byDay.get(k).sum / byDay.get(k).cases) * 10) / 10 }));
  const r = governedPrediction({ metric: "ot-delays", samples, horizonDays, generatedAt: new Date(nowMs).toISOString(),
    method: "mean, over the days with a measured case, of each day's mean minutes from a case's scheduled start to the patient entering the theatre" });
  const counts = { casesMeasured: measured, casesWithoutScheduledStart: excluded };
  if (!r.ok) return { ...r, ...counts };
  r.prediction.unit = "minutes";
  r.prediction.inputs = r.prediction.inputs.map((x) => ({ ...x, cases: byDay.get(x.atIso.slice(0, 10)).cases }));
  return { ...r, ...counts };
}

/** The honest inventory. Every key the plan names; only the ones with a real function are wired. */
const PREDICTORS = Object.freeze({
  "discharge-volume": { wired: true, fn: predictDischargeVolume },
  "critical-backlog": { wired: true, fn: predictCriticalBacklog },
  "bed-demand": { wired: true, fn: predictBedDemand },
  "ed-load": { wired: true, fn: predictEdLoad },
  "diagnostic-workload": { wired: true, fn: predictDiagnosticWorkload },
  "pharmacy-workload": { wired: true, fn: predictPharmacyWorkload },
  "blood-demand": { wired: true, fn: predictBloodDemand },
  "ot-delays": { wired: true, fn: predictOtDelays },
});

/**
 * Route-shaped wrapper, doing its own actor resolution exactly as every other ward route handler
 * does - the router dispatches to this, it never resolves an actor itself.
 * ctx: { migration, metric, lookbackDays?, horizonDays?, actorDeps, recordDeps }
 */
async function predictMetric(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const metric = str(ctx.metric);
  const entry = PREDICTORS[metric];
  if (!entry) return { ...base, ok: false, status: 422, error: "unknown_metric", detail: `"${metric}" is not a metric this file predicts. Known: ${Object.keys(PREDICTORS).join(", ")}` };
  if (!entry.wired) return { ...base, ok: false, status: 501, error: "not_built", detail: entry.reason };

  let resolved;
  try { resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps); }
  catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) };
  }
  const svc = new RecordService({
    repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
    tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
  });
  const r = await entry.fn(svc, { lookbackDays: ctx.lookbackDays, horizonDays: ctx.horizonDays });
  /* "Not enough data to predict" is a legitimate answer to a well-formed request, not a server
   * fault - the caller asked a fair question and got a fair "no prediction available", which is
   * exactly what plan section 25 asks for over a guess. Without this, the route's generic
   * ok-false-falls-back-to-502 would report a 5xx for what is really a 200 with an empty result. */
  if (!r.ok && r.error === "insufficient_data") return { ...base, ...r, status: 200 };
  return { ...base, ...r };
}

export { MODEL_ID, governedPrediction, dailySamples, predictDischargeVolume, predictCriticalBacklog, predictBedDemand, predictEdLoad, predictDiagnosticWorkload, predictPharmacyWorkload, predictBloodDemand, predictOtDelays, PREDICTORS, predictMetric };
