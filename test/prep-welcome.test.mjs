// PrepNucleus welcome (prep-welcome.js): the warm-up draw, one question per subject first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const W = require("../prep-welcome.js");
const seq = () => { let i = 0; return () => ((i++ * 0.37) % 1); };

test("pickPairs spreads across subjects, skips empty ones, fills from the rest", () => {
  const ixs = { a: { topics: [{ id: "a1", count: 3 }, { id: "a2", count: 0 }, { id: "a3", count: 2 }] }, b: { topics: [{ id: "b1", count: 0 }] }, c: { topics: [{ id: "c1", count: 5 }] } };
  const p = W.pickPairs(["a", "b", "c", "z"], ixs, 3, seq());
  assert.equal(p.length, 3);
  assert.deepEqual(p.slice(0, 2).map((x) => x.s).sort(), ["a", "c"], "one per subject first");
  assert.ok(p.every((x) => ["a1", "a3", "c1"].includes(x.m)), "only modules with questions");
  assert.deepEqual(W.pickPairs(["b"], ixs, 5), []);
});

test("pickItems takes one per module in turn, no repeats", () => {
  const lists = [{ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }, { items: [{ id: 4 }] }, { items: [] }];
  assert.deepEqual(W.pickItems(lists, 3).map((x) => x.id), [1, 4, 2]);
  assert.deepEqual(W.pickItems(lists, 10).map((x) => x.id), [1, 4, 2, 3]);
  assert.deepEqual(W.pickItems([{ items: [{ id: 7 }] }, { items: [{ id: 7 }] }], 5).map((x) => x.id), [7]);
});
