/* Topic-diverse question selection (owner 2026-10-13): the N questions of a module session cover as many
 * DISTINCT concepts as possible. Covers prep.js conceptKeyOf/conceptKeys/diversePick/diverseOrder/customDraw and the
 * blueprint-bucket path (prep-assess.js assemble with diverse:true).
 *
 * node --test test/prep-diverse.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../prep.js");
const A = require("../prep-assess.js");

const seq = (s) => { let seed = s; return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); };
// A pool with `concepts` concepts, `per` paraphrases each: same answer entity + same rare stem word per concept.
function pool(concepts, per, opts = {}) {
  const out = [];
  for (let c = 0; c < concepts; c++) {
    for (let i = 0; i < per; i++) {
      out.push({
        id: `c${c}-${i}`,
        q: `Rareword${c} case ${i}: a stem with shared filler words about illness and care plan ${i}`,
        o: [`Remedy${c} cure`, "Wrong one here", "Another wrong option", "Fourth wrong choice"],
        a: 0, exp: "", t: "m1", d: 1 + ((c + i) % 3), ...(opts.extra || {}),
      });
    }
  }
  return out;
}
// Pool-context concept of each picked id (keys are pool-relative via rarity: count with the pool's own map).
function keyMap(p) {
  const ks = P.conceptKeys(p);
  const m = {};
  p.forEach((it, i) => { m[it.id] = ks[i]; });
  return m;
}
const distinct = (ids, m) => new Set(ids.map((id) => m[id])).size;
const counts = (ids, m) => {
  const c = {};
  ids.forEach((id) => { const k = m[id]; c[k] = (c[k] || 0) + 1; });
  return Object.values(c);
};
const adjacentSame = (ids, m) => {
  let n = 0;
  for (let i = 1; i < ids.length; i++) if (m[ids[i]] === m[ids[i - 1]]) n++;
  return n;
};

test("concept keys: paraphrases share a key, different answers differ, links win", () => {
  const p = pool(4, 3);
  const m = keyMap(p);
  assert.equal(distinct(p.map((x) => x.id), m), 4, "4 concepts in a 4x3 pool");
  for (let c = 0; c < 4; c++) assert.equal(distinct([`c${c}-0`, `c${c}-1`, `c${c}-2`], m), 1, "paraphrases agree");
  const link = { id: "l1", q: "Rareword0 case with links", o: ["Remedy0 cure", "b", "c", "d"], a: 0, x: { links: { kb_ids: ["Foo_Bar"] } } };
  assert.equal(P.conceptKeyOf(link, {}, null), "kb:foo_bar", "x.links first");
  const over = { id: "l1b", q: "Rareword0 case with links", o: ["Remedy0 cure", "b", "c", "d"], a: 0, x: { links: { kb: "Foo_Bar" } } };
  assert.equal(P.conceptKeyOf(over, {}, { l1b: "Other Thing" }), "kb:other_thing", "caller links map first");
  const nolink = { id: "l1c", q: "Rareword0 case with links", o: ["Remedy0 cure", "b", "c", "d"], a: 0 };
  assert.ok(P.conceptKeyOf(nolink, {}, null).startsWith("t:"), "text fallback namespaced");
});

test("30-question session over 40 concepts: 30 distinct, max one per concept", () => {
  const p = pool(40, 5);
  const m = keyMap(p);
  const out = P.diversePick(p, 30, { seed: "s1" });
  assert.equal(out.length, 30);
  assert.equal(distinct(out.map((x) => x.id), m), 30);
  assert.ok(counts(out.map((x) => x.id), m).every((c) => c <= 1));
  assert.equal(adjacentSame(out.map((x) => x.id), m), 0, "round-robin output is already interleaved");
});

test("shortage repeats concepts as evenly as possible", () => {
  const p = pool(10, 20);
  const m = keyMap(p);
  const ids = P.diversePick(p, 30, { seed: "s1" }).map((x) => x.id);
  const c = counts(ids, m);
  assert.equal(c.length, 10);
  assert.ok(Math.max(...c) - Math.min(...c) <= 1, "even repeats, got " + c.join(","));
  const tiny = pool(3, 4);
  const m2 = keyMap(tiny);
  const ids2 = P.diversePick(tiny, 30, { seed: "s1" }).map((x) => x.id);
  assert.equal(ids2.length, 12, "capped by the pool");
  assert.ok(Math.max(...counts(ids2, m2)) - Math.min(...counts(ids2, m2)) <= 1);
});

test("deterministic per seed", () => {
  const p = pool(40, 5);
  const a = P.diversePick(p, 30, { seed: "k" }).map((x) => x.id);
  const b = P.diversePick(p, 30, { seed: "k" }).map((x) => x.id);
  const c = P.diversePick(p, 30, { seed: "other" }).map((x) => x.id);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(P.diverseOrder(a.map((id) => p.find((x) => x.id === id)), "z").map((x) => x.id),
    P.diverseOrder(a.map((id) => p.find((x) => x.id === id)), "z").map((x) => x.id));
});

test("within a concept: unseen first, then previously wrong, then oldest-seen", () => {
  const one = (id, extra) => ({ id, q: "Rareword solo stem about illness", o: ["Remedy cure", "b", "c", "d"], a: 0, d: 2, t: "m", ...extra });
  const items = [one("u1"), one("w1"), one("s-old"), one("s-new")];
  const cards = {
    "p:m:w1": [2, 1.2, 90, 120, 3, 2],       // lapses: wrong before
    "p:m:s-old": [2, 1.5, 80, 120, 3, 0],    // seen, older
    "p:m:s-new": [2, 1.5, 95, 120, 3, 0],    // seen, newer
  };
  const first = P.diversePick(items, 1, { cards, dk: "p:m", today: 100, mt: {}, seed: "h" });
  assert.equal(first.length, 1);
  // one concept only: the single take is the unseen item
  const onlySeen = [one("w1"), one("s-old"), one("s-new")];
  assert.equal(P.diversePick(onlySeen, 1, { cards, dk: "p:m", today: 100, mt: {}, seed: "h" })[0].id, "w1", "wrong before seen");
  const twoSeen = [one("s-old"), one("s-new")];
  assert.equal(P.diversePick(twoSeen, 1, { cards, dk: "p:m", today: 100, mt: {}, seed: "h" })[0].id, "s-old", "oldest seen first");
  // mistake-store wrong counts too
  const mtCards = { "p:m:s-old": [2, 1.5, 80, 120, 3, 0], "p:m:s-new": [2, 1.5, 70, 120, 3, 0] };
  assert.equal(P.diversePick(twoSeen, 1, { cards: mtCards, dk: "p:m", today: 100, mt: { "s-new": 1 }, seed: "h" })[0].id, "s-new", "mt wrong first even when newer");
  // across concepts the unseen round comes first
  const two = [...pool(2, 1), ...pool(2, 1).map((x) => ({ ...x, id: x.id + "x" }))];
  const seenCards = {};
  two.slice(0, 2).forEach((x) => { seenCards["p:m:" + x.id] = [2, 1.5, 90, 120, 2, 0]; });
  const got = P.diversePick(two, 2, { cards: seenCards, dk: "p:m", today: 100, mt: {}, seed: "h" }).map((x) => x.id);
  assert.ok(!seenCards["p:m:" + got[0]] && !seenCards["p:m:" + got[1]], "unseen round first");
});

test("difficulty target kept inside each concept; exam draw stays random", () => {
  const items = [1, 2, 3, 4].map((d) => ({ id: "d" + d, q: "Rareword solo stem", o: ["Remedy cure", "b", "c", "d"], a: 0, d, t: "m" }));
  assert.deepEqual(P.diversePick(items, 3, { target: 4, seed: "t" }).map((x) => x.d), [4, 3, 2], "nearest very hard first");
  const p = pool(20, 5);
  const got = P.diversePick(p, 30, { target: 1, seed: "t" });
  const d1 = got.filter((x) => x.d === 1).length;
  assert.ok(d1 >= 10, "target difficulty favoured, got " + d1 + " easy of 30");
});

test("edge cases: empty, tiny, n = 0, duplicate ids", () => {
  assert.deepEqual(P.diversePick([], 30, { seed: "e" }), []);
  assert.deepEqual(P.diversePick(pool(2, 2), 0, { seed: "e" }), []);
  const tiny = P.diversePick(pool(1, 2), 10, { seed: "e" });
  assert.equal(tiny.length, 2);
  const dup = [...pool(5, 2), ...pool(5, 2)];
  const ids = P.diversePick(dup, 30, { seed: "e" }).map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, "never the same item twice");
});

test("weights put exam-important concepts first", () => {
  const p = pool(6, 3);
  const m = keyMap(p);
  const keyOf5 = m["c5-0"];
  const out = P.diversePick(p, 6, { seed: "w", weights: { [keyOf5]: 10 } }).map((x) => x.id);
  assert.equal(m[out[0]], keyOf5, "weighted concept leads every round");
});

test("diverseOrder: same items, minimal adjacent repeats, deterministic", () => {
  const p = pool(2, 1);
  const mk = (c, i) => ({ id: `o${c}-${i}`, q: `Rareword${c} stem`, o: [`Remedy${c} cure`, "b", "c", "d"], a: 0, d: 2 });
  const list = [...Array(7)].map((_, i) => mk(0, i)).concat([...Array(3)].map((_, i) => mk(1, i)));
  const m = keyMap(list);
  const a = P.diverseOrder(list, "q").map((x) => x.id);
  const b = P.diverseOrder(list, "q").map((x) => x.id);
  assert.deepEqual(a, b);
  assert.deepEqual(new Set(a), new Set(list.map((x) => x.id)), "composition kept");
  // 7 vs 3: at least 7-3-1 = 3 same-concept adjacencies are unavoidable; greedy hits the minimum
  assert.equal(adjacentSame(a, m), 3);
  assert.deepEqual(P.diverseOrder(list.slice(0, 2), "q").map((x) => x.id), list.slice(0, 2).map((x) => x.id), "tiny lists untouched");
});

test("customDraw keeps the module spread and evens concepts", () => {
  const mod = (tag, concepts, per) => pool(concepts, per).map((x) => ({ ...x, id: tag + x.id }));
  const l1 = mod("a", 2, 10), l2 = mod("b", 2, 10);
  const out = P.customDraw([l1, l2, []], 12, 0, seq(7));
  assert.equal(out.length, 12);
  assert.equal(out.filter((x) => x.id[0] === "a").length, 6, "even module spread kept");
  assert.equal(new Set(out.map((x) => x.id)).size, 12);
  const m = keyMap([...l1, ...l2]);
  const c = counts(out.map((x) => x.id), m);
  assert.ok(Math.max(...c) - Math.min(...c) <= 1, "concepts even inside the take");
  assert.equal(l1.length, 20, "inputs untouched");
});

test("Quick practice Mix: quotas exact, concepts covered, deterministic", () => {
  const S = require("../prep-setup.js");
  const one = [];
  for (let c = 0; c < 40; c++) for (let i = 0; i < 5; i++) {
    one.push({ id: `q${c}-${i}`, q: `Rareword${c} case ${i}: a stem with shared filler words about illness and care plan ${i}`, o: [`Remedy${c} cure`, "Wrong one here", "Another wrong option", "Fourth wrong choice"], a: 0, d: 1 + ((c + i) % 3), _m: "m1", t: "m1" });
  }
  const ctx = { cards: {}, today: 100, mt: {}, bm: {} };
  const m = keyMap(one);
  const buckets = (ids) => ids.map((id) => S.bucketOf(one.find((x) => x.id === id), ctx)).sort().join(",");
  const a = S.draw([one], { n: 30 }, ctx, seq(7));
  const b = S.draw([one], { n: 30 }, ctx, seq(7));
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id), "deterministic");
  assert.equal(a.length, 30);
  assert.equal(distinct(a.map((x) => x.id), m), 30, "Mix quotas still cover 30 concepts");
  assert.equal(adjacentSame(a.map((x) => x.id), m), 0, "interleaved");
  // diversifySwap alone preserves every quota bucket exactly
  const swapped = S.diversifySwap(a, one, ctx, seq(11));
  assert.deepEqual(buckets(swapped.map((x) => x.id)), buckets(a.map((x) => x.id)), "swap keeps every quota bucket");
  assert.equal(new Set(swapped.map((x) => x.id)).size, 30, "no repeats from the swap");
  assert.ok(distinct(swapped.map((x) => x.id), m) >= distinct(a.map((x) => x.id), m), "swap never loses concepts");
});

test("concept keys are memoised on the item (computed once per module load)", () => {
  const p = pool(10, 5);
  assert.ok(p.every((x) => !x._ckw), "no memo before");
  P.conceptKeys(p);
  assert.ok(p.every((x) => x._ckw && x._ckw.words.length > 0), "token memo cached");
  const again = P.conceptKeys(p);
  assert.deepEqual(again, P.conceptKeys(p), "stable across calls");
});

test("performance: 3,000-item module selects 30 well under a phone budget", () => {
  const p = pool(60, 50);
  const t0 = Date.now();
  const out = P.diversePick(p, 30, { seed: "perf" });
  const ms = Date.now() - t0;
  assert.equal(out.length, 30);
  console.log(`    diversePick 3000 items -> ${ms} ms`);
  assert.ok(ms < 100, `selector took ${ms} ms (budget 100 ms in node; measured well under the 30 ms phone target)`);
  assert.equal(distinct(out.map((x) => x.id), keyMap(p)), 30);
});

test("blueprint buckets: diversity inside each quota, quotas unchanged", () => {
  // 2 subjects x 2 modules x 8 concepts x 10 items; subject_mini with an explicit count
  const bank = [];
  for (const s of ["anatomy", "physiology"]) {
    for (let mi = 0; mi < 2; mi++) {
      const items = [];
      for (let c = 0; c < 8; c++) for (let i = 0; i < 10; i++) {
        items.push({ id: `${s}.${mi}.${c}.${i}`, q: `Rareword${s}${mi}${c} vignette number ${i} with enough words`, o: [`Remedy${s}${mi}${c}`, "x", "y", "z"], a: 0, d: 1 + (i % 3), _s: s, _m: `${s}-m${mi}` });
      }
      bank.push({ s, m: `${s}-m${mi}`, items });
    }
  }
  const PG = A.profile("neet-pg");
  const base = A.assemble(PG, "subject_mini", { seed: "dq", count: 40 }, bank);
  const div = A.assemble(PG, "subject_mini", { seed: "dq", count: 40, diverse: true }, bank);
  assert.equal(div.ok, true);
  assert.deepEqual(div.actual, base.actual, "blueprint quotas unchanged");
  assert.equal(div.count, base.count);
  const all = bank.flatMap((l) => l.items);
  const m = keyMap(all);
  const dBase = distinct(base.items.map((x) => x.id), m);
  const dDiv = distinct(div.items.map((x) => x.id), m);
  console.log(`    distinct concepts per take: legacy ${dBase}, diverse ${dDiv}`);
  assert.ok(dDiv >= dBase, "never worse");
  assert.equal(dDiv, 32, "every concept in both buckets (16 per subject x 2)");
  // mistake-scoped takes keep the legacy order path
  const only = {};
  all.slice(0, 30).forEach((x) => { only[x.id] = 1; });
  const rev = A.assemble(PG, "subject_mini", { seed: "dq", count: 40, diverse: true, only }, bank);
  assert.ok(rev.items.every((x) => only[x.id]), "mistake scope untouched in composition");
});
