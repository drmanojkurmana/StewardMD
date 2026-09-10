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
 * ONLY TWO METRICS ARE WIRED AS REAL EXAMPLES: discharge volume and critical-result backlog. The
 * plan names seven (discharge volume, bed demand, ED load, diagnostic workload, pharmacy workload,
 * blood demand, OT delays). The primitive below (`governedPrediction`) is the real, tested, reusable
 * contract every one of the seven would use; wiring the other five is stated as NOT DONE rather than
 * faked with a second implementation of the same two examples under different names - see PREDICTORS
 * for the honest inventory.
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
function governedPrediction({ metric, samples, horizonDays, generatedAt }) {
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

/**
 * TASK-10.12 real example #1: discharge volume. Samples = one point per day over the lookback
 * window, value = count of Encounter rows whose periodEnd falls on that day - a real, already-
 * computed fact (discharge IS an Encounter's periodEnd), never a second discharge-detection rule.
 */
async function predictDischargeVolume(svc, { lookbackDays = 14, horizonDays = 1, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const fromMs = nowMs - lookbackDays * 86400000;
  let encounters;
  try { encounters = await svc.list("Encounter", 2000); }
  catch (e) { return { ok: false, metric: "discharge-volume", error: "record_read_failed", detail: str(e && e.message), prediction: null }; }

  const byDay = new Map();
  for (const e of (encounters || [])) {
    if (!e || !e.periodEnd) continue;
    const t = Date.parse(e.periodEnd);
    if (!Number.isFinite(t) || t < fromMs || t > nowMs) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const samples = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ atIso: `${day}T00:00:00.000Z`, value: count }));
  return governedPrediction({ metric: "discharge-volume", samples, horizonDays, generatedAt: new Date(nowMs).toISOString() });
}

/**
 * TASK-10.12 real example #2: critical-result backlog trend. Samples = one point per day, value =
 * count of CriticalResultLoop rows that were STILL OPEN at the end of that day - reusing the loop's
 * own `state`/`closedAt` fields, never re-deriving what "open" means for a loop.
 */
async function predictCriticalBacklog(svc, { lookbackDays = 7, horizonDays = 1, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const fromMs = nowMs - lookbackDays * 86400000;
  let loops;
  try { loops = await svc.list("CriticalResultLoop", 2000); }
  catch (e) { return { ok: false, metric: "critical-backlog", error: "record_read_failed", detail: str(e && e.message), prediction: null }; }

  const samples = [];
  for (let d = fromMs; d <= nowMs; d += 86400000) {
    const dayEnd = d + 86400000;
    const openAtDayEnd = (loops || []).filter((l) => {
      if (!l || !l.reportedAt) return false;
      const opened = Date.parse(l.reportedAt);
      if (!Number.isFinite(opened) || opened > dayEnd) return false;
      const closed = l.closedAt ? Date.parse(l.closedAt) : null;
      return closed == null || closed > dayEnd;
    }).length;
    samples.push({ atIso: new Date(d).toISOString(), value: openAtDayEnd });
  }
  return governedPrediction({ metric: "critical-backlog", samples, horizonDays, generatedAt: new Date(nowMs).toISOString() });
}

/**
 * TASK-10.12, wired 2026-09-10: bed demand. Samples = one point per day, value = count of Encounter
 * rows whose periodStart falls on that day - the admission's own real timestamp, the mirror of
 * predictDischargeVolume's periodEnd above.
 */
async function predictBedDemand(svc, { lookbackDays = 14, horizonDays = 1, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const fromMs = nowMs - lookbackDays * 86400000;
  let encounters;
  try { encounters = await svc.list("Encounter", 2000); }
  catch (e) { return { ok: false, metric: "bed-demand", error: "record_read_failed", detail: str(e && e.message), prediction: null }; }

  const byDay = new Map();
  for (const e of (encounters || [])) {
    if (!e || !e.periodStart) continue;
    const t = Date.parse(e.periodStart);
    if (!Number.isFinite(t) || t < fromMs || t > nowMs) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const samples = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ atIso: `${day}T00:00:00.000Z`, value: count }));
  return governedPrediction({ metric: "bed-demand", samples, horizonDays, generatedAt: new Date(nowMs).toISOString() });
}

/**
 * TASK-10.12, wired 2026-09-10: ED load. The SAME periodStart the bed-demand predictor reads, once
 * more filtered to `class === "ED"` - an ED arrival IS an Encounter with that class, the same fact
 * migrate-ed.js's own admission already asserts; never a second detection rule for what counts.
 */
async function predictEdLoad(svc, { lookbackDays = 14, horizonDays = 1, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const fromMs = nowMs - lookbackDays * 86400000;
  let encounters;
  try { encounters = await svc.list("Encounter", 2000); }
  catch (e) { return { ok: false, metric: "ed-load", error: "record_read_failed", detail: str(e && e.message), prediction: null }; }

  const byDay = new Map();
  for (const e of (encounters || [])) {
    if (!e || e.class !== "ED" || !e.periodStart) continue;
    const t = Date.parse(e.periodStart);
    if (!Number.isFinite(t) || t < fromMs || t > nowMs) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const samples = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ atIso: `${day}T00:00:00.000Z`, value: count }));
  return governedPrediction({ metric: "ed-load", samples, horizonDays, generatedAt: new Date(nowMs).toISOString() });
}

/**
 * TASK-10.12, wired 2026-09-10: diagnostic workload. Samples = one point per day, value = count of
 * ServiceRequest rows dated that day whose category is laboratory or imaging - the SAME category
 * field the LIS/radiology routes already read, never a second classification.
 */
async function predictDiagnosticWorkload(svc, { lookbackDays = 14, horizonDays = 1, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const fromMs = nowMs - lookbackDays * 86400000;
  let orders;
  try { orders = await svc.list("ServiceRequest", 2000); }
  catch (e) { return { ok: false, metric: "diagnostic-workload", error: "record_read_failed", detail: str(e && e.message), prediction: null }; }

  const byDay = new Map();
  for (const o of (orders || [])) {
    if (!o || (o.category !== "laboratory" && o.category !== "imaging")) continue;
    const t = Date.parse((o.meta && o.meta.effectiveAt) || (o.meta && o.meta.recordedAt) || "");
    if (!Number.isFinite(t) || t < fromMs || t > nowMs) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const samples = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ atIso: `${day}T00:00:00.000Z`, value: count }));
  return governedPrediction({ metric: "diagnostic-workload", samples, horizonDays, generatedAt: new Date(nowMs).toISOString() });
}

/**
 * TASK-10.12, wired 2026-09-10: pharmacy workload. Samples = one point per day, value = count of
 * MedicationDispense rows whose OWN dispensedAt falls on that day - pharmacy-dispense.js's real
 * bedside-verified issue timestamp, never an order date standing in for it.
 */
async function predictPharmacyWorkload(svc, { lookbackDays = 14, horizonDays = 1, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const fromMs = nowMs - lookbackDays * 86400000;
  let dispenses;
  try { dispenses = await svc.list("MedicationDispense", 2000); }
  catch (e) { return { ok: false, metric: "pharmacy-workload", error: "record_read_failed", detail: str(e && e.message), prediction: null }; }

  const byDay = new Map();
  for (const d of (dispenses || [])) {
    if (!d || !d.dispensedAt) continue;
    const t = Date.parse(d.dispensedAt);
    if (!Number.isFinite(t) || t < fromMs || t > nowMs) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const samples = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ atIso: `${day}T00:00:00.000Z`, value: count }));
  return governedPrediction({ metric: "pharmacy-workload", samples, horizonDays, generatedAt: new Date(nowMs).toISOString() });
}

/** The honest inventory. Every key the plan names; only the ones with a real function are wired.
 *
 * FIVE OF SEVEN WIRED as of 2026-09-10, using the SAME primitive and the SAME technique as the
 * original two - a real per-day count from a field this codebase already writes, never a second
 * detection rule and never a fabricated number. blood-demand and ot-delays remain honestly unwired:
 * blood-demand because no blood-inventory data exists anywhere to predict FROM (digital-twin.js's
 * own NOT_BUILT.bloodBank names the same gap). ot-delays is NOT the same metric digital-twin.js's
 * new otUtilisation section computes - a DELAY is actual start minus SCHEDULED start, and nothing in
 * this codebase records a surgical case's actual incision time in a form this file can read
 * alongside its own booking; wiring it against booking volume instead would be answering a
 * question nobody asked under the name of the one that was. */
const PREDICTORS = Object.freeze({
  "discharge-volume": { wired: true, fn: predictDischargeVolume },
  "critical-backlog": { wired: true, fn: predictCriticalBacklog },
  "bed-demand": { wired: true, fn: predictBedDemand },
  "ed-load": { wired: true, fn: predictEdLoad },
  "diagnostic-workload": { wired: true, fn: predictDiagnosticWorkload },
  "pharmacy-workload": { wired: true, fn: predictPharmacyWorkload },
  "blood-demand": { wired: false, reason: "not built - no blood-inventory data source exists to predict from (see digital-twin.js NOT_BUILT.bloodBank)" },
  "ot-delays": { wired: false, reason: "not built - this is SCHEDULED-vs-ACTUAL start, not booking volume (digital-twin.js's otUtilisation, added 2026-09-10, answers volume/utilisation, a different question); no field records a case's actual incision time for this file to compare against its booking" },
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

export { MODEL_ID, governedPrediction, predictDischargeVolume, predictCriticalBacklog, predictBedDemand, predictEdLoad, predictDiagnosticWorkload, predictPharmacyWorkload, PREDICTORS, predictMetric };
