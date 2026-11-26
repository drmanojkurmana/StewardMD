/* Home hero greetings (home-greetings.js): every minute of the day maps to a window, picks are
 * stable within a day + window, the night-owl line stays in the 00:00-04:30 pool, specials only
 * join on their days, and no app-facing string carries an em-dash. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const G = require("../home-greetings.js");

test("every minute maps to a known window with a non-empty pool", () => {
  for (let m = 0; m < 1440; m++) {
    const w = G.windowFor(m);
    assert.ok(G.POOL[w] && G.POOL[w].length, "minute " + m);
  }
  assert.equal(G.windowFor(0), "night");
  assert.equal(G.windowFor(270), "night");
  assert.equal(G.windowFor(271), "dawn");
  assert.equal(G.windowFor(1439), "late");
});

test("pick is stable within a day + window and varies across days", () => {
  const a = G.pick(new Date(2026, 10, 27, 2, 57)), b = G.pick(new Date(2026, 10, 27, 4, 10));
  assert.deepEqual(a, b);
  assert.equal(a.window, "night");
  const seen = new Set();
  for (let d = 1; d <= 28; d++) seen.add(G.pick(new Date(2026, 1, d, 1, 0)).note);
  assert.ok(seen.size >= 3, "night pool should rotate across days, saw " + seen.size);
});

test("night pool keeps the original night-owl line", () => {
  assert.ok(G.POOL.night.some(p => p[0] === "Hi night owl," && /too early to say good morning/.test(p[1])));
});

test("specials join only on their days", () => {
  const mon = G.poolFor("morning", 1).map(p => p[0]), tue = G.poolFor("morning", 2).map(p => p[0]);
  assert.ok(mon.includes("Happy Monday,"));
  assert.ok(!tue.includes("Happy Monday,"));
  assert.ok(G.poolFor("evening", 5).some(p => p[0] === "Happy Friday,"));
});

test("strings are short and have no em-dash", () => {
  const all = Object.values(G.POOL).flat().concat(G.SPECIALS.map(s => s.pair));
  for (const [line, note] of all) {
    assert.ok(!/[—–]/.test(line + note), line + " " + note);
    assert.ok(line.length <= 18, "line too long: " + line);
    assert.ok(note.length <= 42, "note too long: " + note);
    assert.ok(/,$/.test(line), "line should end with a comma: " + line);
  }
});
