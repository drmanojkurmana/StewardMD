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
