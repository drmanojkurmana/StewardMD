// PrepNucleus MaiK buddy (prep-buddy.js): what he does after each answer and at the end of a set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const G = {};
const src = require("node:fs").readFileSync(new URL("../prep-buddy.js", import.meta.url), "utf8");
// Under node there is no window, so the IIFE binds to `this`: run it with this = G.
new Function(src).call(G);
const P = G.PREP_BUDDY._pure;

const mk = (n, mod) => Array.from({ length: n }, (_, i) => ({ id: "q" + i, a: 0, o: ["a", "b", "c", "d"], _s: "med", _m: mod ? mod(i) : "m1" }));
function play(seq, mod) {
  const r = { items: mk(seq.length, mod), ans: [] }, out = [];
  [...seq].forEach((c, i) => { r.ans[i] = c === "y" ? 0 : 1; out.push(P.decide(r, i, { rnd: 0.9, topic: "Cardiology" })); });
  return out;
}

test("three right in a row is a streak; 5 and 10 too", () => {
  const o = play("yyyyyyyyyy");
  assert.equal(o[2].kind, "streak"); assert.equal(o[2].n, 3); assert.match(o[2].say, /Three/);
  assert.equal(o[4].kind, "streak"); assert.equal(o[4].n, 5);
  assert.equal(o[9].kind, "streak"); assert.equal(o[9].n, 10); assert.match(o[9].say, /10/);
  assert.equal(o[0].kind, "right"); assert.equal(o[3].kind, "right");
});

test("a plain right answer does not speak every time, never stays silent three times running", () => {
  const o = play("yynyynyynyy").filter((d) => d.kind === "right");
  let quiet = 0;
  for (const d of o) { if (d.say) quiet = 0; else quiet++; assert.ok(quiet <= 2); }
  assert.ok(o.some((d) => !d.say));
});

test("a wrong answer is sad and speaks on the first miss", () => {
  const o = play("yn");
  assert.equal(o[1].kind, "wrong"); assert.ok(o[1].say.length > 0);
});

test("three wrong in a row offers revising the topic, once per topic", () => {
  const o = play("nnnnnn");
  assert.equal(o[2].kind, "slump"); assert.equal(o[2].revise, true); assert.match(o[2].say, /Cardiology/);
  assert.equal(o[5].kind, "wrong");
});

test("three wrong in one topic (not in a row) also offers revising it", () => {
  const o = play("nynyn");
  assert.equal(o[4].kind, "slump");
});

test("different topics do not add up to one slump", () => {
  const o = play("nynyn", (i) => "m" + i);
  assert.equal(o[4].kind, "wrong");
});

test("a right answer after two or more misses is the comeback", () => {
  const o = play("ynny");
  assert.equal(o[3].kind, "back");
});

test("end of set: perfect, high, mid, low", () => {
  assert.equal(P.doneLine(5, 5, 0).kind, "perfect");
  const hi = P.doneLine(9, 10, 0); assert.equal(hi.n, 90); assert.match(hi.say, /90%/);
  assert.equal(P.doneLine(6, 10, 0).n, 60);
  assert.match(P.doneLine(2, 10, 0).say, /20%/);
});

test("no em-dash or hyphen-dash in any line", () => {
  for (const list of Object.values(P.lines)) for (const l of list) assert.doesNotMatch(l, /—|–| - /);
});

test("late hours", () => {
  assert.equal(P.lateNow(new Date(2026, 0, 1, 23, 30)), true);
  assert.equal(P.lateNow(new Date(2026, 0, 1, 15, 0)), false);
});

test("clock tension: a clock per question", () => {
  // 60 s a question: tense at 15 s left, panic at 5 s.
  assert.equal(P.tension(40, 60, true), 0);
  assert.equal(P.tension(15, 60, true), 1);
  assert.equal(P.tension(5, 60, true), 2);
  assert.equal(P.tension(0, 60, true), 2);
  // 20 s a question: tense from 6 s, panic from 3 s.
  assert.equal(P.tension(7, 20, true), 0);
  assert.equal(P.tension(6, 20, true), 1);
  assert.equal(P.tension(3, 20, true), 2);
});

test("clock tension: the whole test", () => {
  // 1 hour: tense in the last 5 min, panic in the last minute.
  assert.equal(P.tension(301, 3600, false), 0);
  assert.equal(P.tension(300, 3600, false), 1);
  assert.equal(P.tension(60, 3600, false), 2);
  // 10 min: tense in the last 60 s, panic in the last 18 s.
  assert.equal(P.tension(61, 600, false), 0);
  assert.equal(P.tension(60, 600, false), 1);
  assert.equal(P.tension(18, 600, false), 2);
  // no clock
  assert.equal(P.tension(null, 0, false), 0);
});
