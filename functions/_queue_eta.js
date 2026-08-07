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
  registered:      ["waiting", "called", "cancelled", "no_show"],
  waiting:         ["called", "cancelled", "no_show"],
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
