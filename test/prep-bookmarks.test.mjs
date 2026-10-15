/* PrepNucleus bookmarks Phase 1 (prep.js): one-tap toggle core.
 * What must hold: bookmarking keys by stable question ID (never display index); no duplicates;
 * the stored triple stays [subject, module, savedAtMs]; a JSON round-trip (the save/load path)
 * loses nothing; helpers are exported for the browser toggle.
 *
 * node --test test/prep-bookmarks.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../prep.js");

test("bmToggle adds by stable id and reports added", () => {
  const bm = {};
  assert.equal(P.bmToggle(bm, "q-abc-123", "anatomy", "ana-limb", 1700000000000), true);
  assert.deepEqual(bm, { "q-abc-123": ["anatomy", "ana-limb", 1700000000000] });
});

test("bmToggle removes on second tap and reports removed", () => {
  const bm = { "q-abc-123": ["anatomy", "ana-limb", 1700000000000] };
  assert.equal(P.bmToggle(bm, "q-abc-123", "anatomy", "ana-limb", 1700000001000), false);
  assert.deepEqual(bm, {});
});

test("no duplicates: re-adding keeps one entry keyed by id", () => {
  const bm = {};
  P.bmToggle(bm, "q1", "physio", "phy-fluid", 1000);
  P.bmToggle(bm, "q2", "physio", "phy-fluid", 1001);
  assert.equal(Object.keys(bm).length, 2);
  assert.ok(P.bmHas(bm, "q1") && P.bmHas(bm, "q2"));
});

test("bookmarks survive a save/load round-trip with nothing lost", () => {
  const s = P.emptyStore();
  P.bmToggle(s.bm, "q9", "biochem", "bio-vitamins", 1700000002000);
  const back = JSON.parse(JSON.stringify(s));
  assert.deepEqual(back.bm, { q9: ["biochem", "bio-vitamins", 1700000002000] });
});

test("emptyStore ships an empty bookmark map", () => {
  assert.deepEqual(P.emptyStore().bm, {});
});

test("bmSortedIds orders newest first; undated entries sort last", () => {
  const bm = { old: ["a", "m", 1000], new: ["a", "m", 3000], undated: ["a", "m"] };
  assert.deepEqual(P.bmSortedIds(bm), ["new", "old", "undated"]);
  assert.deepEqual(P.bmSortedIds(null), []);
});

test("bmPairs groups one pair per module and caps files per page", () => {
  const bm = { q1: ["a", "m1", 1], q2: ["a", "m1", 2], q3: ["a", "m2", 3], q4: ["b", "m3", 4] };
  const r = P.bmPairs(bm, ["q1", "q2", "q3", "q4"], 2);
  assert.deepEqual(r.pairs, [{ s: "a", m: "m1" }, { s: "a", m: "m2" }]);
  assert.deepEqual(r.want, { q1: 1, q2: 1, q3: 1, q4: 1 }, "want keeps every id even past the file cap");
});

test("bmStats counts total, incorrect-before and fresh", () => {
  const bm = { q1: ["a", "m", 1000], q2: ["a", "m", 2000] };
  const mt = { q2: ["a", "m", null, 2001, "preview"] };
  assert.deepEqual(P.bmStats(bm, mt, 2000 + 6 * 864e5), { total: 2, wrong: 1, fresh: 2 });
  assert.deepEqual(P.bmStats(bm, mt, 2000 + 8 * 864e5).fresh, 0, "older than a week is not fresh");
});

test("bmStem truncates long stems and collapses whitespace", () => {
  assert.equal(P.bmStem("  What  is\n X?  "), "What is X?");
  assert.equal(P.bmStem("x".repeat(200)).length <= 140, true);
  assert.ok(P.bmStem("x".repeat(200)).endsWith("…"));
  assert.equal(P.bmStem(null), "");
  assert.equal(P.bmStem({ en: "hello" }), "hello");
});
