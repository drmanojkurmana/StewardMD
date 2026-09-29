import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const C = createRequire(import.meta.url)("../specialty-core.js");

// Reference values from ts-fsrs 5.4.2 fsrs(generatorParameters()).next_state(...) (FSRS-6 defaults).
// A 5,000-case random comparison against the library showed zero difference; these pin it.
const GOLD = [[null,0,1,6.4133,0.212],[[7.5643,70.2718],377,3,7.551964,237.741512],[[7.1606,207.8552],0,2,8.100302,207.8552],[[7.3711,15.1463],233,4,6.477873,151.176046],[[8.2667,25.3088],344,3,8.253662,106.007748],[[6.1969,331.4587],167,4,4.91131,692.269431],[[3.9903,18.2647],147,4,1.967367,263.981542],[[6.0163,256.1772],0,2,7.340663,256.1772],[[6.0457,85.8723],0,4,4.709586,115.797044],[[1.4939,50.4057],462,3,1.487634,485.670316],[null,0,2,5.112171,1.2931],[[4.8156,70.8261],116,4,3.068443,373.75294]];

test("FSRS-6 next state matches ts-fsrs", () => {
  for (const [m, t, g, d, s] of GOLD) {
    const r = C.nextState(m ? { d: m[0], s: m[1] } : null, t, g);
    assert.equal(+r.d.toFixed(6), d, `d for ${JSON.stringify([m, t, g])}`);
    assert.equal(+r.s.toFixed(6), s, `s for ${JSON.stringify([m, t, g])}`);
  }
  assert.equal(C.retrievability(10, 5), 0.84588465);
  assert.equal(C.retrievability(0, 5), 1);
});

test("a lapse never raises stability; a pass never lowers it", () => {
  const mem = { d: 5, s: 20 };
  assert.ok(C.nextState(mem, 30, C.AGAIN).s <= 20);
  assert.ok(C.nextState(mem, 30, C.GOOD).s > 20);
  assert.ok(C.nextState(mem, 30, C.EASY).s > C.nextState(mem, 30, C.GOOD).s);
});

test("dayNum flips at local midnight", () => {
  const ist = -330; // getTimezoneOffset() for IST
  const before = Date.UTC(2026, 8, 27, 18, 29); // 23:59 IST
  const after = Date.UTC(2026, 8, 27, 18, 31); // 00:01 IST next day
  assert.equal(C.dayNum(after, ist) - C.dayNum(before, ist), 1);
});

const deck = {
  id: "t", options: ["A", "B", "R"],
  items: [
    ...Array.from({ length: 40 }, (_, i) => ({ id: "a" + i, a: "A" })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: "b" + i, a: "B" })),
    { id: "r0", a: "R" }, { id: "r1", a: "R" },
  ],
};
const seeded = (seed = 1) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("new items are class-balanced so a rare class appears", () => {
  const s = C.buildSession(deck, C.emptyStore(), 100, { size: 20, newCap: 9, rnd: seeded() });
  assert.equal(s.length, 9);
  const n = (a) => s.filter((x) => x.a === a).length;
  assert.equal(n("R"), 2);
  assert.ok(Math.abs(n("A") - n("B")) <= 1);
});

test("due reviews come first, least retrievable first, and respect size", () => {
  const st = C.emptyStore();
  C.review(st, "t", "a0", C.GOOD, 90);          // due 90 + interval
  C.review(st, "t", "a1", C.AGAIN, 99);          // due 100
  st.cards["t:a0"][3] = 100;                      // force both due today
  const s = C.buildSession(deck, st, 100, { size: 5, newCap: 10, rnd: seeded(3) });
  assert.equal(s.length, 5);
  // a1 failed yesterday (s=0.212, R=0.766) is less retrievable than a0 passed 10 days ago (s=2.3065, R=0.774)
  assert.deepEqual(s.slice(0, 2).map((x) => x.id), ["a1", "a0"]);
  assert.ok(!s.slice(2).some((x) => x.id === "a0" || x.id === "a1"));
});

test("review schedules Again for tomorrow and counts lapses only on seen cards", () => {
  const st = C.emptyStore();
  let c = C.review(st, "t", "a5", C.AGAIN, 50);
  assert.equal(c[3], 51); assert.equal(c[4], 1); assert.equal(c[5], 0);
  c = C.review(st, "t", "a5", C.GOOD, 51);
  assert.ok(c[3] >= 52);
  c = C.review(st, "t", "a5", C.AGAIN, c[3]);
  assert.equal(c[5], 1);
  assert.equal(C.counts(deck, st, 200).seen, 1);
});

test("class stats report accuracy and the commonest confusion", () => {
  const st = C.emptyStore();
  C.recordAnswer(st, "t", "A", "A"); C.recordAnswer(st, "t", "A", "B"); C.recordAnswer(st, "t", "A", "B"); C.recordAnswer(st, "t", "A", "R");
  const [a, b] = C.classStats(st, "t", ["A", "B"]);
  assert.equal(a.n, 4); assert.equal(a.acc, 0.25); assert.equal(a.confusedWith, "B");
  assert.equal(b.acc, null);
});

test("streak counts consecutive study days ending today or yesterday", () => {
  const st = C.emptyStore();
  st.days = { 10: 3, 11: 1, 12: 5, 14: 2 };
  assert.equal(C.streak(st, 14), 1);
  assert.equal(C.streak(st, 13), 3);
  assert.equal(C.streak(st, 16), 0);
});

test("recall reports predicted retrievability of seen cards only", () => {
  const st = C.emptyStore();
  assert.deepEqual(C.recall(st, "oct.f", 100), { seen: 0, meanR: null, strong: 0 });
  C.review(st, "oct.f", "a", C.GOOD, 90); // stable, reviewed 10 days ago
  C.review(st, "oct.f", "b", C.AGAIN, 99); // reviewed yesterday, low stability
  C.review(st, "disc.f", "x", C.GOOD, 90); // different deck key, must not count
  const r = C.recall(st, "oct.f", 100);
  assert.equal(r.seen, 2);
  assert.ok(r.meanR > 0 && r.meanR < 1);
  assert.equal(r.strong, C.retrievability(10, st.cards["oct.f:a"][1]) >= 0.9 ? 1 : 0);
});

test("forecast buckets due counts by day, overdue folds into today, prefix filters", () => {
  const st = C.emptyStore();
  C.review(st, "oct.f", "a", C.GOOD, 90);
  st.cards["oct.f:a"][3] = 95; // overdue relative to today=100
  C.review(st, "oct.f", "b", C.AGAIN, 100);
  st.cards["oct.f:b"][3] = 101;
  C.review(st, "disc.f", "x", C.GOOD, 100);
  st.cards["disc.f:x"][3] = 102;
  const f = C.forecast(st, 100, 7);
  assert.equal(f.length, 7);
  assert.equal(f[0], 1); // the overdue oct.f:a
  assert.equal(f[1], 1); // oct.f:b due day 101
  assert.equal(f[2], 1); // disc.f:x due day 102
  const octOnly = C.forecast(st, 100, 7, "oct.f:");
  assert.equal(octOnly[2], 0);
});

test("recordSim counts attempts, right answers, error types and the day", () => {
  const st = C.emptyStore();
  C.recordSim(st, "retino", true, null, 20);
  C.recordSim(st, "retino", false, "wd", 20);
  const r = C.recordSim(st, "retino", false, "wd", 21);
  assert.deepEqual(r, { n: 3, ok: 1, err: { wd: 2 }, last: 21 });
  assert.deepEqual(st.days, { 20: 2, 21: 1 });
  assert.equal(C.streak(st, 21), 2);
});
