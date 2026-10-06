/* PrepNucleus Arena battle core: protocol validation, matchmaking, rate limit and the battle state machine.
 * Plain module (no Workers runtime) so node tests drive it with a fake clock. Plan: vault/plans/PrepNucleus-Arena.md 4.
 *
 * Battle state is a plain JSON object (the BattleRoom Durable Object stores it between alarms). battleEvent(state,
 * event, now) mutates it and returns the messages to send as [{to: 0|1, msg}]; wakeAt(state) is when the next tick is
 * due. Time comes only from `now`, so tests control the clock.
 */
import { elo } from "../../functions/_prep-arena.js";

export const N_ROUNDS = 7, ROUND_SECS = 20;
export const LEAD_MS = 3000;          // match screen before the first question
export const GAP_MS = 2500;           // round result before the next question
export const GRACE_MS = 10e3;         // disconnect grace, then forfeit
export const WIDEN_MS = 15e3, NOBODY_MS = 30e3, NEAR = 200;
export const QUEUE_PER_MIN = 10;

/* ---------- protocol ---------- */
/* parseClient(raw) -> {t:"queue"} | {t:"a", i, k} | null. Anything else (bad JSON, extra types, out-of-range or
 * non-integer numbers, oversized frames, binary) is junk and returns null. */
export function parseClient(raw) {
  if (typeof raw !== "string" || raw.length > 200) return null;
  let m; try { m = JSON.parse(raw); } catch (e) { return null; }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  if (m.t === "queue") return { t: "queue" };
  if (m.t === "a" && Number.isInteger(m.i) && m.i >= 0 && m.i < N_ROUNDS && Number.isInteger(m.k) && m.k >= 0 && m.k <= 3) return { t: "a", i: m.i, k: m.k };
  return null;
}
/* The Firebase token from `Sec-WebSocket-Protocol: smd-arena, <token>` (browsers cannot set headers on a WebSocket). */
export function tokenFromProtocol(h) {
  const parts = String(h || "").split(",").map((s) => s.trim());
  return parts.length === 2 && parts[0] === "smd-arena" && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(parts[1]) ? parts[1] : null;
}

/* ---------- rate limit: sliding minute, per uid ---------- */
export function allowQueue(log, uidh, now, limit = QUEUE_PER_MIN) {
  const l = (log[uidh] || []).filter((t) => now - t < 60e3);
  if (l.length >= limit) { log[uidh] = l; return false; }
  l.push(now); log[uidh] = l; return true;
}

/* ---------- matchmaking ---------- */
/* waiting: [{uidh, rating, at}] in arrival order. Pairs the oldest waiter with the nearest rating: within NEAR points
 * while both have waited under 15 s, anyone after that. Returns { pairs: [[a, b]], nobody: [uidh] } and removes them;
 * nobody = waited 30 s with no opponent (no bots). */
export function matchQueue(waiting, now) {
  const pairs = [], nobody = [];
  for (let i = 0; i < waiting.length; i++) {
    const a = waiting[i];
    let best = -1, bestD = Infinity;
    for (let j = i + 1; j < waiting.length; j++) {
      const b = waiting[j], d = Math.abs(a.rating - b.rating);
      const wide = now - a.at >= WIDEN_MS || now - b.at >= WIDEN_MS;
      if ((wide || d <= NEAR) && d < bestD) { best = j; bestD = d; }
    }
    if (best >= 0) { pairs.push([a, waiting[best]]); waiting.splice(best, 1); waiting.splice(i, 1); i--; }
  }
  for (let i = waiting.length - 1; i >= 0; i--) if (now - waiting[i].at >= NOBODY_MS) nobody.unshift(waiting.splice(i, 1)[0].uidh);
  return { pairs, nobody };
}
// Next moment the queue needs a look (a widen or a timeout), or null when empty.
export function queueWakeAt(waiting, now) {
  let t = null;
  for (const w of waiting) for (const x of [w.at + WIDEN_MS, w.at + NOBODY_MS]) if (x > now && (t === null || x < t)) t = x;
  return t;
}

/* ---------- battle ---------- */
/* players: [{uidh, name, rating}, {..}]; items: [{id, q, o, a}] (N_ROUNDS of them). */
export function newBattle({ id, exam, players, items, now }) {
  return {
    id, exam, n: Math.min(N_ROUNDS, items.length), secs: ROUND_SECS,
    items: items.slice(0, N_ROUNDS).map((it) => ({ id: it.id, q: it.q, o: it.o, a: it.a })),
    p: players.map((x) => ({ uidh: x.uidh, name: x.name, rating: x.rating, gone: null })),
    phase: "new", i: -1, at: now, deadline: 0, next: 0,
    ans: [[], []], pts: [[], []], score: [0, 0], result: null,
  };
}
// Points for a right answer: 10 + up to 10 for speed, linear in the time left. Wrong or blank: 0.
export function points(right, answeredAt, deadline, secs = ROUND_SECS) {
  if (!right) return 0;
  return 10 + Math.round(10 * Math.max(0, Math.min(1, (deadline - answeredAt) / (secs * 1000))));
}

function sendQ(s, now, out) {
  s.i++; s.phase = "q"; s.deadline = now + s.secs * 1000;
  const it = s.items[s.i];
  for (const to of [0, 1]) out.push({ to, msg: { t: "q", i: s.i, q: it.q, o: it.o, deadline: s.deadline } });
}
function closeRound(s, now, out) {
  const it = s.items[s.i];
  for (const side of [0, 1]) {
    const a = s.ans[side][s.i];
    const pts = a ? points(a.k === it.a, a.at, s.deadline, s.secs) : 0;
    s.pts[side][s.i] = pts; s.score[side] += pts;
  }
  for (const to of [0, 1]) {
    const o = 1 - to, mine = s.ans[to][s.i], theirs = s.ans[o][s.i];
    out.push({ to, msg: { t: "r", i: s.i, a: it.a, you: { k: mine ? mine.k : null, pts: s.pts[to][s.i] }, opp: { k: theirs ? theirs.k : null, pts: s.pts[o][s.i] }, score: [s.score[to], s.score[o]] } });
  }
  if (s.i + 1 >= s.n) finish(s, now, null, out);
  else { s.phase = "gap"; s.next = now + GAP_MS; }
}
/* forfeit: the side that left (null = played out). Draw only on equal score with no forfeit, or both gone. */
function finish(s, now, forfeit, out) {
  let sa;   // result for side 0
  if (forfeit === "both") sa = 0.5;
  else if (forfeit === 0 || forfeit === 1) sa = forfeit === 0 ? 0 : 1;
  else sa = s.score[0] > s.score[1] ? 1 : s.score[0] < s.score[1] ? 0 : 0.5;
  const before = [s.p[0].rating, s.p[1].rating], after = elo(before[0], before[1], sa);
  s.phase = "end"; s.result = { sa, before, after, forfeit, at: now };
  const word = (x) => (x === 1 ? "win" : x === 0 ? "loss" : "draw");
  for (const to of [0, 1]) {
    const mine = to === 0 ? sa : 1 - sa;
    out.push({ to, msg: { t: "end", score: [s.score[to], s.score[1 - to]], result: word(mine), rating: { before: before[to], after: after[to] }, ...(forfeit !== null ? { forfeit: forfeit === to ? "you" : forfeit === "both" ? "both" : "opp" } : {}) } });
  }
}

/* event: {type:"start"} | {type:"answer", side, i, k} | {type:"disconnect", side} | {type:"reconnect", side} | {type:"tick"} */
export function battleEvent(s, ev, now) {
  const out = [];
  if (s.phase === "end") return out;
  const t = ev && ev.type;
  if (t === "start" && s.phase === "new") {
    for (const to of [0, 1]) { const o = s.p[1 - to]; out.push({ to, msg: { t: "match", id: s.id, opp: { name: o.name, rating: o.rating }, n: s.n, secs: s.secs } }); }
    s.phase = "lead"; s.next = now + LEAD_MS;
    return out;
  }
  if (t === "answer") {
    const side = ev.side;
    if ((side !== 0 && side !== 1) || s.phase !== "q" || ev.i !== s.i || s.ans[side][s.i] || now > s.deadline) return out;   // late, stale, repeat: ignored
    if (!Number.isInteger(ev.k) || ev.k < 0 || ev.k > 3) return out;
    s.ans[side][s.i] = { k: ev.k, at: now };
    if (s.ans[0][s.i] && s.ans[1][s.i]) closeRound(s, now, out);
    return out;
  }
  if (t === "disconnect" && (ev.side === 0 || ev.side === 1)) { if (!s.p[ev.side].gone) s.p[ev.side].gone = now; return out; }
  if (t === "reconnect" && (ev.side === 0 || ev.side === 1)) {
    // back within the grace: the match header again (with the score so far) and the open question, if unanswered
    const to = ev.side, o = s.p[1 - to], it = s.items[s.i];
    s.p[to].gone = null;
    out.push({ to, msg: { t: "match", id: s.id, opp: { name: o.name, rating: o.rating }, n: s.n, secs: s.secs, resume: true, score: [s.score[to], s.score[1 - to]] } });
    if (s.phase === "q" && !s.ans[to][s.i]) out.push({ to, msg: { t: "q", i: s.i, q: it.q, o: it.o, deadline: s.deadline } });
    return out;
  }
  if (t === "tick") {
    // disconnect grace first: a player gone for 10 s forfeits (both gone: a draw)
    const g0 = s.p[0].gone !== null && now - s.p[0].gone >= GRACE_MS, g1 = s.p[1].gone !== null && now - s.p[1].gone >= GRACE_MS;
    if (g0 || g1) { finish(s, now, g0 && g1 ? "both" : g0 ? 0 : 1, out); return out; }
    if ((s.phase === "lead" || s.phase === "gap") && now >= s.next) sendQ(s, now, out);
    else if (s.phase === "q" && now > s.deadline) closeRound(s, now, out);
  }
  return out;
}
// When the room must tick next (alarm time), or null when the battle is over.
export function wakeAt(s) {
  if (s.phase === "end" || s.phase === "new") return null;
  const ts = [s.phase === "q" ? s.deadline + 1 : s.next];
  for (const x of s.p) if (x.gone !== null) ts.push(x.gone + GRACE_MS);
  return Math.min(...ts);
}
export const sideOf = (s, uidh) => (s.p[0].uidh === uidh ? 0 : s.p[1].uidh === uidh ? 1 : -1);
