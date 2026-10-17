/* PrepNucleus Arena battle core: protocol validation, matchmaking, rate limit and the battle state machine.
 * Plain module (no Workers runtime) so node tests drive it with a fake clock. Plan: vault/plans/PrepNucleus-Arena.md 4.
 *
 * Battle state is a plain JSON object (the BattleRoom Durable Object stores it between alarms). battleEvent(state,
 * event, now) mutates it and returns the messages to send as [{to: 0|1, msg}]; wakeAt(state) is when the next tick is
 * due. Time comes only from `now`, so tests control the clock.
 */
import { elo } from "../../functions/_prep-arena.js";
import { mulberry32, seedFrom } from "../../functions/_prep-core.js";

export const N_ROUNDS = 7, ROUND_SECS = 20;
export const LEAD_MS = 3000;          // match screen before the first question
export const GAP_MS = 2500;           // round result before the next question
export const GRACE_MS = 10e3;         // disconnect grace, then forfeit
export const WIDEN_MS = 15e3, NOBODY_MS = 30e3, NEAR = 200;
export const BOT_MIN_MS = 9e3, BOT_SPAN_MS = 6e3;   // a lone player waits 9 to 15 s for a real opponent, then gets a practice opponent
export const ROOM_WAIT_MS = 180e3;   // a challenged friend gets 3 minutes to turn up
export const ROOM_RE = /^[A-HJ-NP-Z2-9]{16}$/;   // functions/_prep-social.js randomCode(16)
const roomOf = (w) => w.room || null;
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
/* waiting: [{uidh, rating, at, room?}] in arrival order. Pairs the oldest waiter with the nearest rating: within NEAR
 * points while both have waited under 15 s, anyone after that. Returns { pairs: [[a, b]], nobody: [uidh] } and removes
 * them; nobody = waited 30 s with no opponent (no bots). A room (a friend challenge) pairs only with the same room, at
 * once and at any rating, and waits ROOM_WAIT_MS for the friend; a room-less waiter never pairs into a room. */
export function matchQueue(waiting, now, opts = {}) {
  const pairs = [], nobody = [], bots = [];
  for (let i = 0; i < waiting.length; i++) {
    const a = waiting[i];
    let best = -1, bestD = Infinity;
    for (let j = i + 1; j < waiting.length; j++) {
      const b = waiting[j], d = Math.abs(a.rating - b.rating);
      if (roomOf(a) !== roomOf(b)) continue;
      if (roomOf(a)) { best = j; break; }
      const wide = now - a.at >= WIDEN_MS || now - b.at >= WIDEN_MS;
      if ((wide || d <= NEAR) && d < bestD) { best = j; bestD = d; }
    }
    if (best >= 0) { pairs.push([a, waiting[best]]); waiting.splice(best, 1); waiting.splice(i, 1); i--; }
  }
  // Real players always pair first (above). A public waiter nobody real has joined by its botAt gets a practice
  // opponent (opts.bots); a friend challenge (room) never does, it waits for the friend.
  if (opts.bots) for (let i = waiting.length - 1; i >= 0; i--) if (!roomOf(waiting[i]) && now >= (waiting[i].botAt || waiting[i].at + BOT_MIN_MS)) bots.unshift(waiting.splice(i, 1)[0]);
  for (let i = waiting.length - 1; i >= 0; i--) if (now - waiting[i].at >= (roomOf(waiting[i]) ? ROOM_WAIT_MS : NOBODY_MS)) nobody.unshift(waiting.splice(i, 1)[0].uidh);
  return opts.bots ? { pairs, nobody, bots } : { pairs, nobody };   // the old shape unless practice opponents are on
}
// Next moment the queue needs a look (a widen or a timeout), or null when empty.
export function queueWakeAt(waiting, now, opts = {}) {
  let t = null;
  for (const w of waiting) for (const x of roomOf(w) ? [w.at + ROOM_WAIT_MS] : [w.at + WIDEN_MS, w.at + NOBODY_MS].concat(opts.bots ? [w.botAt || w.at + BOT_MIN_MS] : [])) if (x > now && (t === null || x < t)) t = x;
  return t;
}

/* ---------- practice opponent ----------
 * A player who finds nobody real is matched with a practice opponent that looks like any other doctor: a plausible
 * name and a rating near theirs. Its outcome alternates by design (the first battle the player wins, the second the
 * opponent wins, then they alternate) and it answers like a person: after a few seconds, sometimes wrong. The battle
 * state machine below treats it as an ordinary second player; only botPlan() below knows better. */
const FIRST = ["Aarav", "Ananya", "Rohit", "Kavya", "Vikram", "Priya", "Arjun", "Sneha", "Karthik", "Meera", "Rahul", "Divya", "Nikhil", "Isha", "Siddharth", "Neha", "Aditya", "Pooja", "Harsh", "Riya", "Varun", "Shruti", "Manish", "Tanvi", "Abhishek", "Lakshmi", "Gaurav", "Swathi", "Deepak", "Nandini", "Sanjay", "Aparna", "Mohan", "Fatima", "Imran", "Gurpreet", "Joseph", "Anjali", "Suresh", "Bhavna"];
const LAST = ["Sharma", "Reddy", "Nair", "Iyer", "Patel", "Menon", "Gupta", "Rao", "Kulkarni", "Singh", "Das", "Pillai", "Joshi", "Mehta", "Banerjee", "Chatterjee", "Verma", "Naidu", "Kapoor", "Bhat", "Shetty", "Agarwal", "Thomas", "Khan", "Desai", "Hegde", "Mishra", "Yadav", "Jain", "Krishnan"];
export function botFor(seed, userRating) {
  const r = mulberry32(seedFrom("bot:" + seed));
  const name = FIRST[Math.floor(r() * FIRST.length)] + " " + LAST[Math.floor(r() * LAST.length)];
  const rating = Math.max(800, Math.round((Number(userRating) || 1200) + (r() * 120 - 60)));
  return { uidh: "bot:" + seedFrom("u" + seed).toString(16), name, rating, bot: true };
}
/* Which way a practice battle should go: n = this player's earlier practice battles. 0: the player wins, 1: the
 * opponent wins, then alternating. */
export const botWinsFor = (n) => n % 2 === 1;
/* The bot's answer to the question just sent: { k, at }. It reads the score so far: when it must win it answers right
 * and fast unless comfortably ahead (then now and then it slips); when it must lose it answers right only while it is
 * well behind, and wrong when answering right could lift it level. Always inside the round, after a human-looking
 * pause. */
export function botPlan(s, now) {
  const r = mulberry32(seedFrom(s.id + ":" + s.i));
  const it = s.items[s.i], remaining = s.n - s.i, b = s.score[1], u = s.score[0], lead = b - u;
  const wrong = () => { let k = Math.floor(r() * 3); if (k >= it.a) k++; return k; };
  const secs = s.secs * 1000;
  let correct, delay;
  if (s.bot.wins) {
    correct = lead > 20 + 4 * remaining ? r() > 0.3 : true;
    delay = 3000 + r() * 5500;
  } else {
    const last = remaining === 1;
    correct = !last && b + 14 <= u * 0.85 + 6 && r() > 0.12;
    delay = 6000 + r() * 8000;
  }
  delay = Math.min(delay, secs - 2500);
  return { k: correct ? it.a : wrong(), at: now + Math.round(delay) };
}

/* ---------- battle ---------- */
/* players: [{uidh, name, rating}, {..}]; items: [{id, q, o, a}] (N_ROUNDS of them). */
export function newBattle({ id, exam, players, items, now, bot }) {
  return {
    id, exam, n: Math.min(N_ROUNDS, items.length), secs: ROUND_SECS,
    items: items.slice(0, N_ROUNDS).map((it) => ({ id: it.id, q: it.q, o: it.o, a: it.a })),
    p: players.map((x) => ({ uidh: x.uidh, name: x.name, rating: x.rating, gone: null, ...(x.bot ? { bot: true } : {}) })),
    ...(bot ? { bot: { side: 1, wins: !!bot.wins, plan: null } } : {}),
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
  if (s.bot) s.bot.plan = botPlan(s, now);
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
    if (s.bot && s.phase === "q" && s.bot.plan && !s.ans[s.bot.side][s.i] && now >= s.bot.plan.at && now <= s.deadline) {
      s.ans[s.bot.side][s.i] = { k: s.bot.plan.k, at: now };
      if (s.ans[0][s.i] && s.ans[1][s.i]) { closeRound(s, now, out); return out; }
    }
    if ((s.phase === "lead" || s.phase === "gap") && now >= s.next) sendQ(s, now, out);
    else if (s.phase === "q" && now > s.deadline) closeRound(s, now, out);
  }
  return out;
}
// When the room must tick next (alarm time), or null when the battle is over.
export function wakeAt(s) {
  if (s.phase === "end" || s.phase === "new") return null;
  const ts = [s.phase === "q" ? s.deadline + 1 : s.next];
  if (s.bot && s.phase === "q" && s.bot.plan && !s.ans[s.bot.side][s.i]) ts.push(s.bot.plan.at);
  for (const x of s.p) if (x.gone !== null) ts.push(x.gone + GRACE_MS);
  return Math.min(...ts);
}
export const sideOf = (s, uidh) => (s.p[0].uidh === uidh ? 0 : s.p[1].uidh === uidh ? 1 : -1);
