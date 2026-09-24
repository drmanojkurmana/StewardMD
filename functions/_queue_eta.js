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
export const STATUS = ["registered", "waiting", "called", "in_consultation", "at_diagnostics", "investigation", "followup", "completed", "cancelled", "no_show"];
const NEXT = {
  registered:      ["waiting", "called", "in_consultation", "cancelled", "no_show"],
  waiting:         ["called", "in_consultation", "cancelled", "no_show"],
  called:          ["in_consultation", "waiting", "no_show", "cancelled"],
  in_consultation: ["completed", "investigation", "followup", "cancelled", "waiting", "at_diagnostics"],
  // Sent for tests mid-consult: out of the room (not queued, like in_consultation) so the doctor can
  // call the next patient. Tests done returns them to the waiting hall, or straight back in.
  at_diagnostics:  ["waiting", "called", "in_consultation", "cancelled"],
  investigation:   ["waiting", "called", "in_consultation", "completed", "followup", "cancelled"],
  followup:        ["completed", "cancelled"],
  completed:       [],
  cancelled:       [],
  // D13 (2026-09-14): a patient marked no-show who then turns up is recalled with the SAME token, back to
  // waiting or straight to called. Only through recallNoShow (_queue_engine.js), which requires a reason,
  // the queue-management capability, and the recall window below; setStatus refuses it.
  no_show:         ["waiting", "called"]
};
export function canTransition(from, to) { return STATUS.indexOf(to) >= 0 && (NEXT[from] || []).indexOf(to) >= 0; }
// no_show is no longer terminal (D13): the patient link keeps working so a recalled patient still sees
// their place. It is still not queued (no position, no ETA) until recalled.
export function isTerminal(s) { return s === "completed" || s === "cancelled"; }
export const NO_SHOW_RECALL_MS = 4 * 3600e3;
/* PURE (D13). Why this no-show cannot be recalled now, or null. The window is 4 hours from being marked
 * no-show, or the end of the OPD session, whichever comes first: after that the number has been skipped
 * for long enough that calling it again would confuse the hall more than it helps the patient. */
export function recallRefusal(ticket, session, nowMs) {
  if (!ticket || ticket.status !== "no_show") return "not_no_show";
  if (session && (session.status === "finished" || (session.expiresAt && nowMs > session.expiresAt))) return "session_ended";
  if (!ticket.noShowAt || nowMs - ticket.noShowAt > NO_SHOW_RECALL_MS) return "recall_window_passed";
  return null;
}
// Tickets still waiting for the doctor (get a position + ETA). in_consultation/investigation/terminal excluded.
/* Plan item 12: priority follows a stated reason, never a bare number. The reason decides the level
 * (an emergency goes above everyone, the others above the ordinary queue), so two desks give the same
 * patient the same place, and "clear" is itself a reason: taking priority away is an override too.
 * "other" needs words. Returns null when no acceptable reason was given. */
export const PRIORITY_LEVEL = { emergency: 2, senior: 1, pregnant: 1, disability: 1, child: 1, results: 1, other: 1, clear: 0 };
export function priorityRule(reason, note) {
  const r = String(reason || "").trim().toLowerCase();
  const n = String(note || "").trim().slice(0, 100);
  if (!Object.prototype.hasOwnProperty.call(PRIORITY_LEVEL, r)) return null;
  if (r === "other" && n.length < 3) return null;
  return { priority: PRIORITY_LEVEL[r], reason: r, note: n };
}
export function isQueued(s) { return s === "registered" || s === "waiting" || s === "called"; }

// ---- ordering: emergency/priority first, then MANUAL order, then arrival --------------------
// A ticket's ordering key is its manual `seq` (set by a staff reorder) when present, else its arrival
// time — so nothing changes until someone reorders. Priority still sorts first, so a manual move
// reorders WITHIN a priority band (emergencies stay on top — medically correct).
function seqKey(t) { return (t && t.seq != null && isFinite(t.seq)) ? t.seq : (t && t.registeredAt) || 0; }
export function orderQueue(tickets) {
  return (tickets || [])
    .filter((t) => isQueued(t.status))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || seqKey(a) - seqKey(b));
}
// A room's display order: the patient in consultation pinned on top (▶), then the waiting queue in true
// order. orderQueue alone drops in_consultation, so the nurse board needs this to show reorders/priority.
// Patients sent for tests ride at the end: out of the room but still this doctor's open work, with their
// "Tests Done" action, so they are never invisible while at the lab.
export function orderRoomView(tickets) {
  const t = tickets || [];
  return t.filter((x) => x.status === "in_consultation").concat(orderQueue(t), t.filter((x) => x.status === "at_diagnostics"));
}

// A PUBLIC waiting-room screen shows the ticket's TOKEN and never a name, MRN or phone: the token is what
// the hall calls out, so a patient recognises their turn without anyone else learning who they are. A
// ticket registered before tokens existed has none and is shown as "" (the screen draws a blank, not a name).
const wallToken = (t) => String((t && t.token) || "");
// D7: the department each token was issued in, aligned with the token arrays. A department name names no
// patient. Shown beside a token when it differs from the room's own (a patient moved between departments
// keeps the number they already heard).
const wallDept = (t) => String((t && t.department) || "");
// Project the nurse board (boardForOrg output) to a login-free wall display: room-centric, PHI-free.
// Tickets are already priority/seq-ordered by boardForOrg (orderRoomView), so `calling`/`upcoming`
// reflect true order. `calling` = summoned-not-yet-entered (the attention state); `serving` = in room.
export function displayBoard(org, board) {
  const rooms = (board.rooms || []).filter((rm) => rm.doctorUid).map((rm) => {
    const ts = rm.tickets || [];
    const waiting = ts.filter((t) => t.status === "registered" || t.status === "waiting");
    const calling = ts.filter((t) => t.status === "called"), serving = ts.filter((t) => t.status === "in_consultation")[0];
    return {
      name: (rm.room && rm.room.name) || "Room", number: (rm.room && rm.room.number) || "",
      department: (rm.room && rm.room.department) || "", status: rm.status,
      calling: calling.map(wallToken), callingDepartments: calling.map(wallDept),
      serving: serving ? wallToken(serving) : "", servingDepartment: serving ? wallDept(serving) : "",
      waiting: waiting.length, upcoming: waiting.slice(0, 3).map(wallToken), upcomingDepartments: waiting.slice(0, 3).map(wallDept),
    };
  });
  const scope = org && org.tokens && org.tokens.scope === "department" ? "department" : "hospital";
  return { ok: true, org: { name: (org && org.name) || "OPD", code: (org && org.code) || "" }, tokenScope: scope, rooms: rooms };
}

// PURE: the new `seq` to give `moveId` so it lands at visible index `toIndex` in the CURRENT ordered
// queue. Returns { seq } to persist, or null for a no-op/invalid move. Midpoint indexing => only the
// moved ticket changes (concurrency-friendly, no full renumber).
export function reorderSeq(orderedQueued, moveId, toIndex) {
  const q = (orderedQueued || []);
  const from = q.findIndex((t) => t.id === moveId);
  if (from < 0) return null;
  const without = q.filter((t) => t.id !== moveId);
  const to = Math.max(0, Math.min(without.length, toIndex | 0));
  if (to === from) return null;
  const above = to > 0 ? without[to - 1] : null;
  const below = to < without.length ? without[to] : null;
  const GAP = 1000;
  let seq;
  if (!above && !below) return null;
  else if (!above) seq = seqKey(below) - GAP;              // to the very top of its band
  else if (!below) seq = seqKey(above) + GAP;              // to the very bottom
  else seq = (seqKey(above) + seqKey(below)) / 2;          // between two neighbours (midpoint)
  return { seq: seq };
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

/* ---- THE OPD PULSE: what the desk and the owner act on, hospital-wide -------------------------------
 *
 * aggregate() above answers "how did that doctor's session go". This answers the question a hospital
 * actually asks at 11am: IS THE OPD RUNNING, AND IF NOT, WHERE IS IT STUCK. Three deliberate choices:
 *
 * MEDIAN AND P90, NEVER THE AVERAGE. One patient waiting three hours moves an average by a few minutes
 * and then hides behind it. p90 is the patient who is about to complain at the desk, and it is the
 * number that changes behaviour.
 *
 * THE WAIT IS SPLIT IN TWO. Door to called is the DESK (registration, paperwork, the queue itself);
 * called to seen is the DOCTOR (running late, long consults). One combined number blames everybody and
 * tells nobody what to fix; these two say which half of the building to walk to.
 *
 * WAITING NOW IS MEASURED LIVE, not from finished visits. Everything else here is history; the only
 * figure that can still be acted on today is how long the people sitting in the hall have been there,
 * which is why longestMin and the over-30/over-60 counts are computed against nowMs.
 */
function percentileMin(list, p) {
  if (!list.length) return null;
  const s = list.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Math.round(s[i] / 60000);
}
/* Plan item 15: the owner's day close, PURE over the day's tickets. The pulse for the whole OPD, then each room
 * (who saw how many, how long a consult took, how long patients waited for that doctor), then the day's
 * exceptions an owner asks about: patients put ahead of the queue by reason, and check-ins taken offline.
 * `roomOf` maps a sessionId to { room, doctor }. Counts and durations only: it names no patient. */
export function dayClose(tickets, nowMs, roomOf) {
  const by = {};
  tickets.forEach((t) => { const k = t.sessionId || ""; (by[k] = by[k] || []).push(t); });
  const rooms = Object.keys(by).map((k) => {
    const p = opdPulse(by[k], nowMs), r = (roomOf && roomOf[k]) || {};
    return { room: r.room || "", doctor: r.doctor || "", registered: p.registered, seen: p.seen, noShow: p.noShow,
      consultMedianMin: p.consult.medianMin, doorToDoctorMedianMin: p.doorToDoctor.medianMin };
  }).sort((a, b) => b.seen - a.seen || b.registered - a.registered);
  const priority = {};
  tickets.forEach((t) => { if ((t.priority || 0) > 0) { const r = t.priorityReason || "unstated"; priority[r] = (priority[r] || 0) + 1; } });
  return { pulse: opdPulse(tickets, nowMs), rooms, priority, offline: tickets.filter((t) => t.offline).length };
}
export function opdPulse(tickets, nowMs) {
  const rows = tickets || [], now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const WAIT = ["registered", "waiting", "called"];
  const doorToSeen = [], doorToCalled = [], calledToSeen = [], consults = [], waitingNow = [];
  let waiting = 0, inConsultation = 0, completed = 0, noShow = 0, cancelled = 0, recalls = 0, held = 0, syncFailed = 0, resultsBack = 0;

  for (const t of rows) {
    if (!t) continue;
    if (t.status === "completed") completed++;
    else if (t.status === "no_show") noShow++;
    else if (t.status === "cancelled") cancelled++;
    else if (t.status === "in_consultation") inConsultation++;
    else if (WAIT.indexOf(t.status) > -1) waiting++;
    // Waiting on a result, at the lab, or booked back: still the hospital's open work, counted apart from the hall.
    else if (t.status === "investigation" || t.status === "followup" || t.status === "at_diagnostics") held++;
    recalls += Number(t.recallCount) || 0;
    if (t.encounterSync === "failed") syncFailed++;   // seen or queued, but the visit is not in the clinical record
    if (t.resultReadyAt && WAIT.indexOf(t.status) > -1) resultsBack++;   // plan item 10: back from a test, result ready

    if (t.registeredAt && t.consultStartAt) doorToSeen.push(t.consultStartAt - t.registeredAt);
    if (t.registeredAt && t.calledAt) doorToCalled.push(t.calledAt - t.registeredAt);
    if (t.calledAt && t.consultStartAt && t.consultStartAt >= t.calledAt) calledToSeen.push(t.consultStartAt - t.calledAt);
    if (t.consultStartAt && t.consultEndAt) consults.push(t.consultEndAt - t.consultStartAt);
    if (WAIT.indexOf(t.status) > -1 && t.registeredAt) waitingNow.push(now - t.registeredAt);
  }

  const finished = completed + noShow;
  return {
    at: now,
    registered: rows.length,
    waiting, inConsultation, completed, noShow, cancelled, held, recalls, syncFailed, resultsBack,
    seen: completed + inConsultation,
    // History: how long it took the people already seen.
    doorToDoctor: { medianMin: percentileMin(doorToSeen, 50), p90Min: percentileMin(doorToSeen, 90), n: doorToSeen.length },
    deskWait: { medianMin: percentileMin(doorToCalled, 50), p90Min: percentileMin(doorToCalled, 90), n: doorToCalled.length },
    doctorWait: { medianMin: percentileMin(calledToSeen, 50), p90Min: percentileMin(calledToSeen, 90), n: calledToSeen.length },
    consult: { medianMin: percentileMin(consults, 50), p90Min: percentileMin(consults, 90), n: consults.length },
    // Live: the hall as it stands right now, the half somebody can still do something about.
    waitingNow: {
      longestMin: waitingNow.length ? Math.round(Math.max.apply(null, waitingNow) / 60000) : 0,
      medianMin: percentileMin(waitingNow, 50),
      over30: waitingNow.filter((ms) => ms >= 30 * 60000).length,
      over60: waitingNow.filter((ms) => ms >= 60 * 60000).length,
    },
    // null, not 0: nobody has finished yet is not the same as nobody abandoned.
    abandonedPct: finished ? Math.round((noShow / finished) * 100) : null,
  };
}
