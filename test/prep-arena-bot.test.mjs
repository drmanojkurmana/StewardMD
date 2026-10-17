/* Arena practice opponent: a player who finds nobody real is matched with an opponent that reads as an ordinary
 * doctor; real players always pair first; the first practice battle goes to the player, the second to the opponent.
 * Pure core only (prep-arena-worker/src/core.js), driven with a fake clock. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchQueue, queueWakeAt, botFor, botWinsFor, botPlan, newBattle, battleEvent, wakeAt, BOT_MIN_MS, N_ROUNDS } from "../prep-arena-worker/src/core.js";

const mk = (i) => ({ id: "q" + i, q: "Question " + i + " about a clinical vignette that is long enough", o: ["A", "B", "C", "D"], a: i % 4 });
const items = Array.from({ length: N_ROUNDS }, (_, i) => mk(i));
const W = (uidh, at, extra = {}) => ({ uidh, rating: 1200, at, botAt: at + 10e3, ...extra });

test("a lone public waiter gets a practice opponent after its botAt, and never before", () => {
  const q = [W("a", 0)];
  assert.deepEqual(matchQueue(q, 9e3, { bots: true }).bots, []);
  const r = matchQueue(q, 10e3, { bots: true });
  assert.equal(r.bots.length, 1); assert.equal(r.bots[0].uidh, "a"); assert.equal(r.nobody.length, 0); assert.equal(q.length, 0);
});
test("without the bots option the queue behaves exactly as before (nobody after 30 s)", () => {
  const q = [W("a", 0)];
  assert.equal(matchQueue(q, 20e3).bots, undefined);
  assert.deepEqual(matchQueue(q, 30e3).nobody, ["a"]);
});
test("a real opponent always wins the pairing, even at the moment the bot would have started", () => {
  const q = [W("a", 0), W("b", 9500)];
  const r = matchQueue(q, 10e3, { bots: true });
  assert.equal(r.pairs.length, 1); assert.equal(r.bots.length, 0);
});
test("a friend challenge (room) never gets a practice opponent", () => {
  const q = [W("a", 0, { room: "ROOMCODE" })];
  assert.deepEqual(matchQueue(q, 60e3, { bots: true }).bots, []);
  assert.equal(queueWakeAt([W("a", 0, { room: "R" })], 1, { bots: true }), 180e3);
});
test("queueWakeAt wakes at the bot moment", () => {
  assert.equal(queueWakeAt([W("a", 0)], 1, { bots: true }), 10e3);
  assert.equal(queueWakeAt([W("a", 0)], 1), 15e3);
});
test("the practice opponent looks like a doctor: a person's name, a rating near the player's, nothing that says bot", () => {
  for (let i = 0; i < 50; i++) {
    const b = botFor("battle-" + i, 1300);
    assert.match(b.name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
    assert.ok(Math.abs(b.rating - 1300) <= 60, "rating " + b.rating);
    assert.ok(!/\b(bot|test|practice|ai)\b/i.test(b.name));
  }
  assert.deepEqual(botFor("x", 1200), botFor("x", 1200), "deterministic per battle");
  assert.notEqual(botFor("x", 1200).name, botFor("y", 1200).name + "!");
});
test("the first practice battle goes to the player, the second to the opponent, then alternating", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(botWinsFor), [false, true, false, true, false]);
});

// Plays a whole battle against the practice opponent. The player answers right after userMs every round.
function play(userMs, botWins, id = "b1") {
  let t = 1e6;
  const s = newBattle({ id, exam: "neet-pg", players: [{ uidh: "u", name: "You", rating: 1200 }, botFor(id, 1200)], items, now: t, bot: { wins: botWins } });
  let end = null;
  const take = (out) => { for (const o of out) if (o.msg.t === "end" && o.to === 0) end = o.msg; };
  take(battleEvent(s, { type: "start" }, t));
  let guard = 0;
  while (!end && guard++ < 400) {
    const nxt = wakeAt(s); assert.ok(nxt, "a wake time while the battle runs");
    // the player answers userMs after the question went out
    if (s.phase === "q" && !s.ans[0][s.i] && s.qAt === undefined) s.qAt = t;
    const userAt = s.phase === "q" && !s.ans[0][s.i] ? (s.deadline - s.secs * 1000) + userMs : Infinity;
    if (userAt < nxt && userAt > t) { t = userAt; take(battleEvent(s, { type: "answer", side: 0, i: s.i, k: items[s.i].a }, t)); continue; }
    t = Math.max(t, nxt); take(battleEvent(s, { type: "tick" }, t));
  }
  assert.ok(end, "battle ended");
  return { end, s };
}
test("a practice battle the player must win: they win when they answer right and fast", () => {
  for (let i = 0; i < 12; i++) { const r = play(2500, false, "w" + i); assert.equal(r.end.result, "win", "battle w" + i + " " + r.end.score); }
});
test("a practice battle the opponent must win: it wins against an ordinary right-answering player", () => {
  for (let i = 0; i < 12; i++) { const r = play(9000, true, "l" + i); assert.equal(r.end.result, "loss", "battle l" + i + " " + r.end.score); }
});
test("the opponent answers inside every round and the battle always ends", () => {
  for (const wins of [true, false]) for (let i = 0; i < 6; i++) {
    const { s } = play(5000, wins, "e" + wins + i);
    assert.equal(s.phase, "end");
    for (let r = 0; r < s.n; r++) assert.ok(s.ans[1][r] === undefined || s.ans[1][r].at <= s.deadline + 25e3);
  }
});
test("a player who answers nothing is never handed a win they did not play for", () => {
  let t = 1e6; const id = "idle";
  const s = newBattle({ id, exam: "neet-pg", players: [{ uidh: "u", name: "You", rating: 1200 }, botFor(id, 1200)], items, now: t, bot: { wins: false } });
  const out = []; battleEvent(s, { type: "start" }, t);
  let guard = 0, end = null;
  while (s.phase !== "end" && guard++ < 400) { t = Math.max(t, wakeAt(s)); for (const o of battleEvent(s, { type: "tick" }, t)) if (o.msg.t === "end" && o.to === 0) end = o.msg; }
  assert.notEqual(end.result, "win", "score " + end.score);
});
test("botPlan stays within the round", () => {
  const s = newBattle({ id: "p", exam: "neet-pg", players: [{ uidh: "u", name: "You", rating: 1200 }, botFor("p", 1200)], items, now: 0, bot: { wins: true } });
  s.i = 0; for (let k = 0; k < 40; k++) { s.id = "p" + k; const p = botPlan(s, 0); assert.ok(p.at >= 3000 && p.at <= s.secs * 1000 - 2500 + 1); assert.ok(p.k >= 0 && p.k <= 3); }
});
