/* test/ai-scribe-caps.test.mjs — MaiK Scribe TIME budget (30 min/day, 1 h/week defaults), the Pro
 * entitlement's cost guard. node --test test/ai-scribe-caps.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scribeCaps, checkScribeTime, addScribeTime } from "../functions/_ai_usage.js";

function fakeStore() {
  const m = new Map();
  return { _m: m, get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null), put: (k, v) => { m.set(k, v); return Promise.resolve(); } };
}
const NOW = Date.parse("2026-08-12T09:00:00Z");   // a fixed Wednesday

test("scribeCaps: defaults 1800s/day + 3600s/week; env overrides", () => {
  assert.deepEqual(scribeCaps({}), { day: 1800, week: 3600 });
  assert.deepEqual(scribeCaps({ SCRIBE_SEC_DAY: "600", SCRIBE_SEC_WEEK: "1200" }), { day: 600, week: 1200 });
});

test("fail-open with no store or no uid (never block mid-consult on infra gaps)", async () => {
  assert.equal((await checkScribeTime(null, "u1", NOW, scribeCaps({}))).ok, true);
  assert.equal((await checkScribeTime(fakeStore(), "", NOW, scribeCaps({}))).ok, true);
});

test("daily cap: allows under budget, blocks at/over", async () => {
  const s = fakeStore(), caps = scribeCaps({});
  assert.equal((await checkScribeTime(s, "u1", NOW, caps)).ok, true);   // 0 used
  await addScribeTime(s, "u1", 1740, NOW);                              // 29 min
  assert.equal((await checkScribeTime(s, "u1", NOW, caps)).ok, true);   // still under 30
  await addScribeTime(s, "u1", 120, NOW);                              // -> 31 min, over the daily cap
  const over = await checkScribeTime(s, "u1", NOW, caps);
  assert.equal(over.ok, false);
  assert.equal(over.reason, "scribe-daily");
});

test("weekly cap binds even when a single day is under 30 min", async () => {
  const s = fakeStore(), caps = scribeCaps({});
  // spread 4 days x 15 min = 60 min across the SAME ISO week (each day under the 30-min daily cap)
  const day = 86400000;
  for (let i = 0; i < 4; i++) await addScribeTime(s, "u1", 900, NOW + i * day);   // Wed..Sat, same ISO week
  const wed = await checkScribeTime(s, "u1", NOW + 3 * day, caps);                // that day: only 15 min used
  assert.equal(wed.ok, false, "weekly total 60min >= 1h should block");
  assert.equal(wed.reason, "scribe-weekly");
});

test("caps isolate per doctor", async () => {
  const s = fakeStore(), caps = scribeCaps({});
  await addScribeTime(s, "u1", 2000, NOW);                              // u1 over daily
  assert.equal((await checkScribeTime(s, "u1", NOW, caps)).ok, false);
  assert.equal((await checkScribeTime(s, "u2", NOW, caps)).ok, true);   // u2 untouched
});
