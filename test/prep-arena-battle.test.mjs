/* PrepNucleus Arena battle core (prep-arena-worker/src/core.js): protocol validation, matchmaking, the queue rate
 * limit and the battle state machine, driven by a fake clock. What must hold: junk frames are rejected; players pair by
 * nearest rating, widen after 15 s and get "nobody" at 30 s; 7 rounds of 20 s with 10 + speed points; late answers are
 * ignored; a 10 s disconnect forfeits; the key reaches a client only in the round result; Elo K=24 at the end.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-arena-battle.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../prep-arena-worker/src/core.js";

test("protocol: only queue and in-range integer answers parse; junk is null", () => {
  assert.deepEqual(C.parseClient('{"t":"queue"}'), { t: "queue" });
  assert.deepEqual(C.parseClient('{"t":"a","i":6,"k":3,"extra":1}'), { t: "a", i: 6, k: 3 });
  for (const junk of ["", "x", "null", "[]", "42", '"queue"', '{"t":"QUEUE"}', '{"t":"a","i":7,"k":0}', '{"t":"a","i":0,"k":4}', '{"t":"a","i":-1,"k":0}',
    '{"t":"a","i":0.5,"k":0}', '{"t":"a","i":"0","k":0}', '{"t":"a","i":0}', '{"t":"end"}', '{"t":"queue"' , JSON.stringify({ t: "queue", pad: "x".repeat(300) })]) {
    assert.equal(C.parseClient(junk), null, junk.slice(0, 40));
  }
  assert.equal(C.parseClient(new ArrayBuffer(8)), null);
  assert.equal(C.tokenFromProtocol("smd-arena, aaa.bbb.ccc"), "aaa.bbb.ccc");
  for (const h of [null, "", "smd-arena", "other, aaa.bbb.ccc", "smd-arena, nojwt", "smd-arena, a.b.c, x"]) assert.equal(C.tokenFromProtocol(h), null, String(h));
});

test("rate limit: 10 queue joins a minute per player", () => {
  const log = {};
  for (let i = 0; i < 10; i++) assert.equal(C.allowQueue(log, "u", 1000 + i), true);
  assert.equal(C.allowQueue(log, "u", 2000), false);
  assert.equal(C.allowQueue(log, "v", 2000), true, "per player");
  assert.equal(C.allowQueue(log, "u", 61000), true, "the window slides");
});

test("matchmaking: nearest rating, widen after 15 s, nobody after 30 s", () => {
  const w = [{ uidh: "a", rating: 1200, at: 0 }, { uidh: "far", rating: 1600, at: 0 }, { uidh: "b", rating: 1350, at: 1000 }, { uidh: "c", rating: 1250, at: 2000 }];
  let r = C.matchQueue(w, 3000);
  assert.deepEqual(r.pairs.map((p) => p.map((x) => x.uidh)), [["a", "c"]], "a takes the nearest (c, 50) over b (150)");
  assert.deepEqual(w.map((x) => x.uidh), ["far", "b"]);
  r = C.matchQueue(w, 14999);
  assert.deepEqual(r.pairs, [], "250 apart: not before 15 s");
  assert.equal(C.queueWakeAt(w, 14999), 15000);
  r = C.matchQueue(w, 15000);
  assert.deepEqual(r.pairs.map((p) => p.map((x) => x.uidh)), [["far", "b"]], "widened");
  const lone = [{ uidh: "z", rating: 1200, at: 0 }];
  assert.deepEqual(C.matchQueue(lone, 29999), { pairs: [], nobody: [] });
  assert.deepEqual(C.matchQueue(lone, 30000), { pairs: [], nobody: ["z"] });
  assert.equal(lone.length, 0);
  assert.equal(C.queueWakeAt([], 0), null);
});

const ITEMS = Array.from({ length: 7 }, (_, i) => ({ id: "q" + i, q: "Question " + i, o: ["A", "B", "C", "D"], a: i % 4 }));
const PLAYERS = [{ uidh: "ua", name: "Asha", rating: 1200 }, { uidh: "ub", name: "Bilal", rating: 1200 }];
const mk = (now = 0) => C.newBattle({ id: "m1", exam: "neet-pg", players: PLAYERS, items: ITEMS, now });
const to = (out, side) => out.filter((o) => o.to === side).map((o) => o.msg);
// Run the clock forward through every wake-up until `until`, collecting messages.
function run(s, until, clock) { const out = []; for (let t = C.wakeAt(s); t !== null && t <= until; t = C.wakeAt(s)) { clock.now = t; out.push(...C.battleEvent(s, { type: "tick" }, t)); } clock.now = Math.max(clock.now, until); return out; }

test("battle: match, 7 rounds of 20 s, speed points, key only in the round result, Elo at the end", () => {
  const clock = { now: 0 }, s = mk();
  const m = C.battleEvent(s, { type: "start" }, 0);
  assert.deepEqual(to(m, 0), [{ t: "match", id: "m1", opp: { name: "Bilal", rating: 1200 }, n: 7, secs: 20 }]);
  assert.equal(C.wakeAt(s), C.LEAD_MS);
  const all = [];
  for (let i = 0; i < 7; i++) {
    const q = run(s, C.wakeAt(s), clock);
    const qa = to(q, 0)[0];
    assert.deepEqual(Object.keys(qa).sort(), ["deadline", "i", "o", "q", "t"], "no key in a question");
    assert.equal(qa.deadline, clock.now + 20000);
    const t0 = clock.now;
    // a answers right at once (20 pts); b answers wrong after 5 s (0) in even rounds, right after 15 s in odd ones
    assert.deepEqual(C.battleEvent(s, { type: "answer", side: 0, i, k: ITEMS[i].a }, t0), []);
    assert.deepEqual(C.battleEvent(s, { type: "answer", side: 0, i, k: (ITEMS[i].a + 1) % 4 }, t0 + 1), [], "second answer ignored");
    const r = C.battleEvent(s, { type: "answer", side: 1, i, k: i % 2 ? ITEMS[i].a : (ITEMS[i].a + 1) % 4 }, t0 + (i % 2 ? 15000 : 5000));
    all.push(...r);
    const ra = to(r, 0)[0], rb = to(r, 1)[0];
    assert.equal(ra.t, "r"); assert.equal(ra.a, ITEMS[i].a);
    assert.deepEqual(ra.you, { k: ITEMS[i].a, pts: 20 });
    assert.equal(rb.you.pts, i % 2 ? 13 : 0, "10 + round(10 * 5/20)");
    assert.deepEqual(rb.score, [ra.score[1], ra.score[0]], "each side sees its own score first");
  }
  const end = all.filter((o) => o.msg.t === "end");
  assert.equal(end.length, 2);
  assert.deepEqual(to(end, 0)[0], { t: "end", score: [140, 39], result: "win", rating: { before: 1200, after: 1212 } });
  assert.deepEqual(to(end, 1)[0], { t: "end", score: [39, 140], result: "loss", rating: { before: 1200, after: 1188 } });
  assert.equal(s.phase, "end"); assert.equal(C.wakeAt(s), null);
  assert.deepEqual(C.battleEvent(s, { type: "answer", side: 0, i: 6, k: 0 }, clock.now), [], "nothing after the end");
});

test("battle: deadline closes a round with no answers; late and stale answers are ignored", () => {
  const clock = { now: 0 }, s = mk();
  C.battleEvent(s, { type: "start" }, 0);
  run(s, C.LEAD_MS, clock);
  const dl = s.deadline;
  assert.deepEqual(C.battleEvent(s, { type: "answer", side: 0, i: 1, k: 0 }, dl - 100), [], "wrong round");
  assert.deepEqual(C.battleEvent(s, { type: "answer", side: 0, i: 0, k: ITEMS[0].a }, dl + 1), [], "after the deadline");
  assert.deepEqual(C.battleEvent(s, { type: "answer", side: 2, i: 0, k: 0 }, dl - 100), [], "no such side");
  assert.deepEqual(C.battleEvent(s, { type: "tick" }, dl), [], "not before the deadline passes");
  const r = run(s, dl + 1, clock);
  assert.deepEqual(to(r, 0)[0], { t: "r", i: 0, a: 0, you: { k: null, pts: 0 }, opp: { k: null, pts: 0 }, score: [0, 0] });
  assert.equal(s.phase, "gap");
  // a right answer exactly at the deadline still counts, with no speed bonus
  run(s, C.wakeAt(s), clock);
  C.battleEvent(s, { type: "answer", side: 1, i: 1, k: ITEMS[1].a }, s.deadline);
  const r2 = run(s, s.deadline + 1, clock);
  assert.equal(to(r2, 1)[0].you.pts, 10);
  // nobody answers the rest: a 10:0 win for b at the end
  const rest = run(s, 10 * 60e3, clock);
  const e = to(rest, 1).find((m) => m.t === "end");
  assert.deepEqual([e.result, e.score.join(":")], ["win", "10:0"]);
});

test("battle: 10 s disconnect forfeits; a reconnect inside the grace resumes the open question", () => {
  const clock = { now: 0 }, s = mk();
  C.battleEvent(s, { type: "start" }, 0);
  run(s, C.LEAD_MS, clock);
  C.battleEvent(s, { type: "disconnect", side: 0 }, 4000);
  assert.equal(C.wakeAt(s), 14000);
  const back = C.battleEvent(s, { type: "reconnect", side: 0 }, 9000);
  assert.deepEqual(to(back, 0).map((m) => m.t), ["match", "q"]);
  assert.equal(to(back, 0)[0].resume, true);
  assert.ok(!("a" in to(back, 0)[1]), "no key on resume");
  assert.deepEqual(back.filter((o) => o.to === 1), [], "the opponent sees nothing");
  assert.deepEqual(C.battleEvent(s, { type: "tick" }, 14000), [], "grace cleared");

  C.battleEvent(s, { type: "answer", side: 1, i: 0, k: ITEMS[0].a }, 10000);
  C.battleEvent(s, { type: "disconnect", side: 1 }, 11000);
  assert.deepEqual(C.battleEvent(s, { type: "tick" }, 20999), []);
  const f = C.battleEvent(s, { type: "tick" }, 21000);
  assert.deepEqual(to(f, 0)[0], { t: "end", score: [0, 0], result: "win", rating: { before: 1200, after: 1212 }, forfeit: "opp" }, "the round in progress is not scored");
  assert.equal(to(f, 1)[0].forfeit, "you");
  assert.equal(to(f, 1)[0].result, "loss");
  assert.deepEqual(s.result.after, [1212, 1188]);
});

test("battle: both gone is a draw; an even score is a draw", () => {
  const s = mk();
  C.battleEvent(s, { type: "start" }, 0);
  C.battleEvent(s, { type: "disconnect", side: 0 }, 100);
  C.battleEvent(s, { type: "disconnect", side: 1 }, 200);
  const f = C.battleEvent(s, { type: "tick" }, 10200);
  assert.deepEqual(f.map((o) => o.msg.result), ["draw", "draw"]);
  const clock = { now: 0 }, s2 = mk();
  C.battleEvent(s2, { type: "start" }, 0);
  const out = run(s2, 10 * 60e3, clock);
  assert.deepEqual(to(out, 0).find((m) => m.t === "end"), { t: "end", score: [0, 0], result: "draw", rating: { before: 1200, after: 1200 } });
  assert.equal(out.filter((o) => o.msg.t === "q").length, 14);
});

test("points: 10 + up to 10 for speed, linear in time left; wrong is 0", () => {
  assert.equal(C.points(true, 0, 20000), 20);
  assert.equal(C.points(true, 10000, 20000), 15);
  assert.equal(C.points(true, 20000, 20000), 10);
  assert.equal(C.points(true, 25000, 20000), 10);
  assert.equal(C.points(false, 0, 20000), 0);
});
