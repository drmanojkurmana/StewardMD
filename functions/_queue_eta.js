/* functions/_queue_eta.js — PURE queue logic: status state-machine, ordering, deterministic multi-factor
 * ETA + confidence, and per-doctor consult-duration learning (Welford). No I/O, no deps → unit-tested in
 * isolation (test/queue-eta.test.mjs). The engine (_queue_engine.js) does the Firestore reads/writes and
 * delegates every decision here, so the untestable surface is thin.
 *
 * "Intelligent ETA" (owner spec) is a learned, multi-factor STATISTICAL model — NOT an LLM (LLMs are
 * unreliable at time arithmetic): per-doctor mean consult duration by visit type + current-consult
 * elapsed + emergency pad + queue length, with a variance-driven confidence %.
 */

export const DEFAULT_CONSULT_MIN = 12;

// ---- status state machine ----------------------------------------------------------------
export const STATUS = ["registered", "waiting", "called", "in_consultation", "investigation", "followup", "completed", "cancelled", "no_show"];
const NEXT = {
  registered:      ["waiting", "called", "in_consultation", "cancelled", "no_show"],
  waiting:         ["called", "in_consultation", "cancelled", "no_show"],
  called:          ["in_consultation", "waiting", "no_show", "cancelled"],
  in_consultation: ["completed", "investigation", "followup", "cancelled"],
  investigation:   ["waiting", "called", "in_consultation", "completed", "followup", "cancelled"],
  followup:        ["completed", "cancelled"],
  completed:       [],
  cancelled:       [],
  no_show:         []
};
export function canTransition(from, to) { return STATUS.indexOf(to) >= 0 && (NEXT[from] || []).indexOf(to) >= 0; }
export function isTerminal(s) { return s === "completed" || s === "cancelled" || s === "no_show"; }
// Tickets still waiting for the doctor (get a position + ETA). in_consultation/investigation/terminal excluded.
export function isQueued(s) { return s === "registered" || s === "waiting" || s === "called"; }

// ---- ordering: emergency/priority first, then arrival order -------------------------------
export function orderQueue(tickets) {
  return (tickets || [])
    .filter((t) => isQueued(t.status))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.registeredAt || 0) - (b.registeredAt || 0));
}

// ---- learned consult duration -------------------------------------------------------------
export function meanFor(stats, visitType) {
  const bv = stats && stats.byVisitType && stats.byVisitType[visitType];
  if (bv && bv.n > 0 && isFinite(bv.mean)) return bv.mean;
  if (stats && stats.n > 0 && isFinite(stats.mean)) return stats.mean;
  return DEFAULT_CONSULT_MIN;
}
// Welford online mean/variance, overall + per visit type. Returns a NEW stats object (pure).
export function updateStats(stats, durationMin, visitType) {
  const s = clone(stats) || { n: 0, mean: 0, m2: 0, sd: 0, byVisitType: {} };
  s.byVisitType = s.byVisitType || {};
  bump(s, durationMin);
  s.byVisitType[visitType] = bump(s.byVisitType[visitType] || { n: 0, mean: 0, m2: 0, sd: 0 }, durationMin);
  return s;
}
function bump(acc, x) {
  acc.n += 1;
  const d = x - acc.mean; acc.mean += d / acc.n;
  const d2 = x - acc.mean; acc.m2 += d * d2;
  acc.sd = acc.n > 1 ? Math.sqrt(acc.m2 / (acc.n - 1)) : 0;
  return acc;
}
function clone(o) { return o ? JSON.parse(JSON.stringify(o)) : o; }

// variance-driven confidence: tighter with low relative variance + a short queue ahead.
export function confidence(stats, aheadIdx) {
  const mean = (stats && stats.n > 2 && isFinite(stats.mean)) ? stats.mean : DEFAULT_CONSULT_MIN;
  const sd = (stats && isFinite(stats.sd)) ? stats.sd : mean * 0.5;
  const cv = mean > 0 ? sd / mean : 0.5;
  const c = 100 - 30 * cv * Math.sqrt((aheadIdx || 0) + 1);
  return Math.max(40, Math.min(99, Math.round(c)));
}

// ---- ETA for a whole ordered queue --------------------------------------------------------
// opts = { nowMs, stats, defaultConsultMin?, inFlightRemainingMin?, emergencyPadMin? }
// Returns [{ id, position, etaStart, etaEnd, etaConfidence }] aligned to `ordered`.
export function computeEtas(ordered, opts) {
  opts = opts || {};
  const now = typeof opts.nowMs === "number" ? opts.nowMs : 0;
  const def = opts.defaultConsultMin || DEFAULT_CONSULT_MIN;
  let acc = (opts.inFlightRemainingMin || 0) + (opts.emergencyPadMin || 0);   // minutes until the doctor is free
  const out = [];
  (ordered || []).forEach((t, i) => {
    const dur = meanFor(opts.stats, t.visitType) || def;
    const etaStart = now + acc * 60000;
    const etaEnd = etaStart + dur * 60000;
    out.push({ id: t.id, position: i + 1, etaStart, etaEnd, etaConfidence: confidence(opts.stats, i) });
    acc += dur;
  });
  return out;
}

// ---- per-doctor settings (q_config) -------------------------------------------------------
export const CONFIG_DEFAULTS = {
  early: 5, prep: 2,                 // notification thresholds (patients-ahead)
  noShowTimeoutMin: 10,              // minutes after "called" before auto no-show is offered
  defaultConsultMin: 12,             // ETA fallback before any learning
  etaLearning: true,                 // learn consult durations
  smsEnabled: true, waEnabled: false,// notification channels
  lateArrivalSlots: 3                // slots a late arrival drops
};
export function mergeConfig(saved) {
  const c = Object.assign({}, CONFIG_DEFAULTS, saved || {});
  c.early = Math.max(1, +c.early || CONFIG_DEFAULTS.early);
  c.prep = Math.min(c.early, Math.max(1, +c.prep || CONFIG_DEFAULTS.prep));
  c.defaultConsultMin = Math.max(1, +c.defaultConsultMin || CONFIG_DEFAULTS.defaultConsultMin);
  c.noShowTimeoutMin = Math.max(1, +c.noShowTimeoutMin || CONFIG_DEFAULTS.noShowTimeoutMin);
  c.etaLearning = !!c.etaLearning; c.smsEnabled = !!c.smsEnabled; c.waEnabled = !!c.waEnabled;
  return c;
}

// ---- PURE analytics over a session's tickets ----------------------------------------------
export function aggregate(tickets, nowMs) {
  tickets = tickets || [];
  let waiting = 0, completed = 0, noShow = 0, cancelled = 0, waitSum = 0, waitN = 0, conSum = 0, conN = 0, etaHit = 0, etaN = 0;
  const hours = {};
  const min = (ms) => Math.round(ms / 60000);
  tickets.forEach((t) => {
    if (t.status === "completed") completed++;
    else if (t.status === "no_show") noShow++;
    else if (t.status === "cancelled") cancelled++;
    else if (t.status === "registered" || t.status === "waiting" || t.status === "called") waiting++;
    if (t.consultStartAt && t.registeredAt) { waitSum += (t.consultStartAt - t.registeredAt); waitN++; }
    if (t.consultEndAt && t.consultStartAt) { conSum += (t.consultEndAt - t.consultStartAt); conN++; }
    if (t.consultStartAt && t.etaStart) { etaN++; if (Math.abs(t.consultStartAt - t.etaStart) <= 10 * 60000) etaHit++; }
    if (t.registeredAt) { const h = new Date(t.registeredAt).getHours(); hours[h] = (hours[h] || 0) + 1; }
  });
  const peak = []; for (let h = 0; h < 24; h++) if (hours[h]) peak.push({ h, count: hours[h] });
  return {
    total: tickets.length, waiting, completed, noShow, cancelled,
    avgWaitMin: waitN ? min(waitSum / waitN) : 0,
    avgConsultMin: conN ? min(conSum / conN) : 0,
    etaAccuracyPct: etaN ? Math.round((etaHit / etaN) * 100) : null,   // % of predictions within 10 min
    peakHours: peak
  };
}
