/* PrepNucleus play (prep-play.js) pure helpers, owner 2026-10-30.
 * What must hold: the spot of the day is the same for everyone on a day, with the right diagnosis and three others;
 * voice answers parse letters, ordinals and option words and ignore noise; freezes are earned with 50 extra answers,
 * capped at 2, and cover only a gap right before today when the streak stood before it; specialty-core streak() treats
 * a frozen day as a link without counting it; boss picks hard questions first; Wrapped counts only the store.
 * node --test test/prep-play.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = require("../prep-play.js");
const CORE = require("../specialty-core.js");

const POOL = [];
for (let i = 0; i < 12; i++) POOL.push({ img: "i" + i + ".webp", dx: "Dx " + (i % 6), deck: i < 6 ? "OCT" : "Fundus", set: "eye" });

test("spot: one pick a day, the same for everyone, four distinct options with the answer among them", () => {
  const a = P.spotPick(POOL, "2026-10-30"), b = P.spotPick(POOL, "2026-10-30");
  assert.deepEqual(a, b);
  assert.equal(a.o.length, 4);
  assert.equal(new Set(a.o).size, 4);
  assert.equal(a.o[a.a], a.item.dx);
  const days = new Set(); for (let d = 1; d <= 28; d++) days.add(P.spotPick(POOL, "2026-11-" + String(d).padStart(2, "0")).item.img);
  assert.ok(days.size > 4, "the image changes across days");
  assert.equal(P.spotPick([], "x"), null);
  assert.equal(P.istDay(Date.parse("2026-10-30T19:00:00Z")), "2026-10-31", "IST rolls over at 18:30 UTC");
});

test("voice: letters, words, ordinals, option text, commands; noise gives null", () => {
  const o = ["Insulin glargine", "Metformin", "Glibenclamide", "Acarbose"];
  for (const [t, k] of [["B", 1], ["option c", 2], ["answer is dee", 3], ["the second", 1], ["I think it's Metformin", 1], ["acarbose please", 3], ["ay", 0]]) assert.deepEqual(P.parseVoice(t, o), { k }, t);
  assert.deepEqual(P.parseVoice("skip this one", o), { cmd: "skip" });
  assert.deepEqual(P.parseVoice("please repeat", o), { cmd: "repeat" });
  assert.deepEqual(P.parseVoice("stop", o), { cmd: "stop" });
  assert.equal(P.parseVoice("hmm let me think about the kidney", o), null);
  assert.equal(P.parseVoice("", o), null);
  assert.equal(P.parseVoice("e", o), null, "E is not an option of four");
});

test("freezes: earned with 50 beyond the goal once a day, at most 2", () => {
  const s = { days: { 100: 79 }, goal: 30 };
  assert.equal(P.earnFreeze(s, 100, 30), false);
  s.days[100] = 80;
  assert.equal(P.earnFreeze(s, 100, 30), true);
  assert.equal(P.earnFreeze(s, 100, 30), false, "once a day");
  s.days[101] = 200; P.earnFreeze(s, 101, 30);
  s.days[102] = 200;
  assert.equal(P.earnFreeze(s, 102, 30), false, "bank full at 2");
  assert.equal(s.frz.bank, 2);
});

test("freezes: cover a gap before today only when the streak stood before it and the bank is enough", () => {
  const s = { days: { 95: 5, 96: 5, 97: 5 }, frz: { bank: 2, used: [] } };
  // today 100: 98 and 99 missed, 97 studied -> both covered
  assert.equal(P.applyFreezes(s, 100), 2);
  assert.deepEqual(s.frz.used, [99, 98]);
  assert.equal(s.frz.bank, 0);
  assert.equal(CORE.streak(s, 100), 3, "frozen days link without counting");
  s.days[100] = 4;
  assert.equal(CORE.streak(s, 100), 4);
  // a gap longer than the bank: nothing used
  const t = { days: { 90: 1 }, frz: { bank: 1, used: [] } };
  assert.equal(P.applyFreezes(t, 100), 0);
  assert.equal(t.frz.bank, 1);
  // no streak before the gap (a new student): nothing used
  const u = { days: {}, frz: { bank: 2, used: [] } };
  assert.equal(P.applyFreezes(u, 100), 0);
  // studied yesterday: nothing to cover
  const v = { days: { 99: 3 }, frz: { bank: 1, used: [] } };
  assert.equal(P.applyFreezes(v, 100), 0);
  assert.equal(CORE.streak({ days: { 99: 1, 98: 1 } }, 100), 2, "streak() unchanged without freezes");
});

test("boss: hard questions first, then medium, 20 at most; lives count wrong answers", () => {
  const items = [];
  for (let i = 0; i < 30; i++) items.push({ id: "q" + i, d: i < 8 ? 3 : i < 25 ? 2 : 1, vh: i === 3 });
  const b = P.bossPick(items, "seed");
  assert.equal(b.length, P.BOSS_N);
  assert.ok(b.slice(0, 8).every((x) => x.d === 3), "the 8 hard ones lead");
  assert.ok(b.every((x) => x.d >= 2), "no easy ones");
  const r = { items: [{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }], ans: [0, 0, 0, -1] };
  assert.equal(P.livesLeft(r), P.BOSS_LIVES - 2);
});

test("wrapped: the month's counts, best run, top subject, persona, extras", () => {
  const dayNum = (ms) => CORE.dayNum(ms, new Date(ms).getTimezoneOffset());
  const d0 = dayNum(new Date(2026, 9, 1, 12).getTime());
  const s = { days: { [d0]: 10, [d0 + 1]: 20, [d0 + 2]: 5, [d0 + 5]: 7, [d0 - 1]: 99 }, wm: { "2026-10": { anatomy: 30, physiology: 12 } },
    mod: { m1: { t: 40, ok: 30 }, m2: { t: 25, ok: 24 }, m3: { t: 5, ok: 5 } }, hr: Object.assign(new Array(24).fill(0), { 23: 30, 1: 10, 9: 5 }),
    boss: { anatomy: { won: new Date(2026, 9, 12).getTime() } }, spoth: { "2026-10-03": 1, "2026-10-04": 0, "2026-09-30": 1 }, fxm: { "2026-10": 75 } };
  const subj = { m1: "anatomy", m2: "physiology", m3: "biochemistry" };
  const w = P.wrapped(s, "2026-10", dayNum, (m) => subj[m]);
  assert.equal(w.n, 42); assert.equal(w.active, 4); assert.equal(w.days, 31); assert.equal(w.best, 3);
  assert.equal(w.top, "anatomy"); assert.equal(w.topN, 30);
  assert.equal(w.strong, "physiology", "best accuracy with 20 or more answers"); assert.equal(w.strongPct, 96);
  assert.equal(w.persona.name, "Night owl"); assert.equal(w.persona.peak, 23);
  assert.equal(w.bosses, 1); assert.equal(w.spot, 1); assert.equal(w.focus, 75);
  assert.equal(P.persona([1, 2]), null, "under 20 answers: no persona");
});

test("firstSentence keeps one sentence, capped", () => {
  assert.equal(P.firstSentence("Axillary nerve. It winds round the neck."), "Axillary nerve.");
  assert.equal(P.firstSentence("no full stop here"), "no full stop here");
  assert.equal(P.firstSentence("x".repeat(400), 50).length, 50);
});

test("feed rhythm: a pearl after every third question, only from questions already passed; an image after every fifth", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: "q" + i, kp: i === 1 || i === 7 || i === 9 ? "pearl " + i : undefined, _s: "anatomy" }));
  const seen = {};
  const cards = P.feedCards(items, [{ img: "x", dx: "d" }], seen);
  assert.deepEqual(cards.map((c) => c.kind === "q" ? c.it.id : c.kind).join(","), "q0,q1,q2,pearl,q3,q4,img,q5,q6,q7,q8,pearl,q9,img");
  assert.deepEqual(cards.filter((c) => c.kind === "pearl").map((c) => c.text), ["pearl 1", "pearl 7"], "q9's pearl waits: its question is the last card");
  assert.deepEqual(Object.keys(seen).sort(), ["q1", "q7"]);
  assert.equal(P.feedCards(items.slice(0, 7), [], seen).filter((c) => c.kind !== "q").length, 0, "seen pearls and no images: questions only");
});
