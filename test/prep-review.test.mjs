/* PrepNucleus result review filters and saved practice sets (prep.js reviewSplit / reviewDefault / psPack / psPurge /
 * psCap / psList / psDaysLeft / psUnpack), owner 2026-10-09: the result lists every question under All, Wrong,
 * Correct, Skipped or Time up and Bookmarked, Wrong by default when there is any; a set the student makes is kept
 * 7 days as item ids and answers only, reopens from its module files and is purged once expired.
 *
 * node --test test/prep-review.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../prep.js");
const DAY = 864e5;
const it = (id, a, extra) => Object.assign({ id, q: "Q " + id, o: ["a", "b", "c", "d"], a, _s: "anatomy", _m: "ana-m1", exp: "long explanation body" }, extra || {});

test("review split: wrong, right, skipped (time up apart), bookmarked; default Wrong if any else All", () => {
  const items = [it("q1", 0), it("q2", 1), it("q3", 2), it("q4", 3), it("q5", 0)];
  const sp = P.reviewSplit(items, [0, 2, -1, 3, -1], [false, false, true, false, false], { q2: [1], q5: [1] });
  assert.deepEqual(sp.all, [0, 1, 2, 3, 4]);
  assert.deepEqual(sp.right, [0, 3]);
  assert.deepEqual(sp.wrong, [1]);
  assert.deepEqual(sp.skip, [2, 4]);
  assert.deepEqual(sp.out, [2]);
  assert.deepEqual(sp.bm, [1, 4]);
  assert.equal(P.reviewDefault(sp), "wrong");
  assert.equal(P.reviewDefault(P.reviewSplit(items, [0, 1, 2, 3, 0], null, {})), "all", "all right: All");
  assert.equal(P.reviewDefault(P.reviewSplit(items, [0, -1, -1, 3, 0], null, {})), "all", "only skipped: All");
});

test("pack: ids and answers only, modules once, previous-year and deck items left out, 7-day expiry", () => {
  const now = 1_700_000_000_000;
  const items = [it("q1", 0), it("q2", 1, { _m: "ana-m2" }), it("py1", 2, { _py: 1, _s: "pyq" }), it("d1", 0, { _s: "deck", _m: "deck-x" }), it("q3", 2)];
  const e = P.psPack(items, [0, 3, 2, 0, -1], [false, false, false, false, true], { title: "Custom module", kind: "custom", mode: "study" }, now);
  assert.deepEqual(e.m, ["anatomy|ana-m1", "anatomy|ana-m2"]);
  assert.deepEqual(e.q, [[0, "q1"], [1, "q2"], [0, "q3"]]);
  assert.deepEqual(e.a, [0, 3, -1]);
  assert.deepEqual(e.o, [2], "timed-out index in the saved order");
  assert.equal(e.ok, 1); assert.equal(e.n, 3);
  assert.equal(e.c, now); assert.equal(e.x, now + 7 * DAY);
  assert.equal(P.PS_DAYS, 7);
  assert.ok(!JSON.stringify(e).includes("explanation") && !JSON.stringify(e).includes("Q q1"), "no item bodies");
  assert.equal(P.psPack([it("py", 0, { _py: 1 })], [0], null, {}, now), null, "nothing reopenable, nothing saved");
});

test("unpack: questions reload by id in the saved order; a question gone from its module drops with its answer", () => {
  const now = 1_000;
  const items = [it("q1", 0), it("q2", 1, { _m: "ana-m2" }), it("q3", 2)];
  const e = P.psPack(items, [0, -1, 1], [false, true, false], { title: "T" }, now);
  const lists = { "anatomy|ana-m1": [it("q3", 2), it("q1", 0)], "anatomy|ana-m2": [it("q2", 1, { _m: "ana-m2" })] };
  const u = P.psUnpack(e, lists);
  assert.deepEqual(u.items.map((x) => x.id), ["q1", "q2", "q3"]);
  assert.deepEqual(u.ans, [0, -1, 1]);
  assert.deepEqual(u.out, [false, true, false]);
  const v = P.psUnpack(e, { "anatomy|ana-m1": [it("q3", 2)] });
  assert.deepEqual(v.items.map((x) => x.id), ["q3"]); assert.deepEqual(v.ans, [1]);
});

test("expiry: days left, list newest first without expired, purge on load, cap at 20", () => {
  const now = 10 * DAY, map = {};
  map.a = { c: now - 8 * DAY, x: now - DAY, n: 1 };
  map.b = { c: now - 2 * DAY, x: now + 5 * DAY, n: 1 };
  map.c = { c: now - 1 * DAY, x: now + 6 * DAY - 1, n: 1 };
  assert.equal(P.psDaysLeft(map.b, now), 5);
  assert.equal(P.psDaysLeft(map.c, now), 6);
  assert.deepEqual(P.psList(map, now).map((x) => x.id), ["c", "b"]);
  assert.deepEqual(P.psPurge(map, now), ["a"]);
  assert.deepEqual(Object.keys(map).sort(), ["b", "c"]);
  map.bad = null; assert.deepEqual(P.psPurge(map, now), ["bad"]);
  const many = {};
  for (let i = 0; i < 25; i++) many["s" + i] = { c: i, x: now + DAY };
  assert.equal(P.psCap(many, P.PS_MAX).length, 5);
  assert.equal(Object.keys(many).length, 20);
  assert.ok(!many.s0 && many.s24, "the oldest go first");
  assert.deepEqual(P.emptyStore().ps, {});
});

test("small enough to sync: a 30-question set is about a kilobyte", () => {
  const items = Array.from({ length: 30 }, (x, i) => it("rad-" + i + "-abcdef", i % 4, { _s: "ss-radiology", _m: "rad-mixed-" + (i % 3) }));
  const e = P.psPack(items, items.map((x, i) => i % 5 ? x.a : -1), null, { title: "Radiology" }, 0);
  assert.ok(JSON.stringify(e).length < 1500, JSON.stringify(e).length + " bytes");
});
