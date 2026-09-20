/* test/ai-scribe-caps.test.mjs — MaiK Scribe TIME budget (30 min/day, 1 h/week defaults), the Pro
 * entitlement's cost guard. node --test test/ai-scribe-caps.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scribeCaps, checkScribeTime, addScribeTime, scribeChargeSec, isScribeKind, SCRIBE_CALL_SEC, SCRIBE_SEC_MAX_CALL } from "../functions/_ai_usage.js";

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

/* ── what ONE call charges (the cadence-constant defect) ─────────────────────────────────────────
 * Before: a flat 120s per call, calibrated to the old one-refine-per-120s cadence. The refine loop
 * now runs roughly every 45s, so the SAME ten minutes of dictation charged ~2.3x what it used to and
 * the doctor's recording was stopped mid-consult by their own quota. */

test("scribeChargeSec: the client's body.sec delta is what gets charged", () => {
  assert.equal(scribeChargeSec("opd-scribe", 45), 45);
  assert.equal(scribeChargeSec("opd-scribe", 132.5), 132.5);
  assert.equal(scribeChargeSec("translate", 8), 8);
});

test("scribeChargeSec: one call can never spend more than SCRIBE_SEC_MAX_CALL", () => {
  assert.equal(scribeChargeSec("opd-scribe", 5000), SCRIBE_SEC_MAX_CALL);
  assert.equal(SCRIBE_SEC_MAX_CALL, 300);
});

test("scribeChargeSec: a missing / junk body.sec is SAFE - falls back, never NaN, never negative", () => {
  for (const bad of [undefined, null, "", 0, -30, "abc", NaN, {}, []]) {
    const got = scribeChargeSec("opd-scribe", bad);
    assert.equal(got, SCRIBE_CALL_SEC["opd-scribe"], "fallback for " + JSON.stringify(bad));
    assert.ok(Number.isFinite(got) && got >= 0);
  }
  assert.equal(scribeChargeSec("not-a-scribe-kind", undefined), 0);
  assert.equal(isScribeKind("opd-scribe"), true);
  assert.equal(isScribeKind("reasoning"), false);
});

test("the fallback can only UNDER-charge: never more than the client's minimum gap between calls", () => {
  // gatedRefine (opd-emr.js) will not run two background refines closer than 45s apart, so 45 is the
  // floor of the audio any charged opd-scribe call covers. Over-charging is the failure that ends a
  // consultation; under-charging only loosens a cost bound.
  assert.ok(SCRIBE_CALL_SEC["opd-scribe"] <= 45);
  // assessment's only call site runs inside the SAME ambient session as the opd-scribe refine and
  // re-reads the SAME audio - charging it again would double-charge those minutes.
  assert.equal(SCRIBE_CALL_SEC.assessment, 0);
});

test("SAME minutes recorded => SAME quota spent, whatever the refine cadence", async () => {
  // A 10-minute consult, metered end to end through the real KV counters.
  const caps = scribeCaps({});
  const spend = async (calls, secPerCall) => {
    const s = fakeStore();
    for (let i = 0; i < calls; i++) await addScribeTime(s, "u1", scribeChargeSec("opd-scribe", secPerCall), NOW);
    return Number(await s.get("aiu:sec:u1:scribe:2026-08-12")) || 0;
  };
  const oldCadence = await spend(5, 120);    // one refine every 120s
  const newCadence = await spend(14, 600 / 14); // one refine every ~43s, same 600s of audio
  assert.equal(oldCadence, 600, "600 seconds of dictation charges 600 seconds");
  assert.ok(Math.abs(newCadence - 600) < 1, "and still 600 after the cadence change (got " + newCadence + ")");
  assert.ok(oldCadence < caps.day && newCadence < caps.day, "a 10-min consult must not be a third of nothing");

  // What the defect did: 14 calls x the old flat 120s constant.
  const before = await spend(14, undefined) / SCRIBE_CALL_SEC["opd-scribe"] * 120;
  assert.equal(before, 1680, "the regression charged 1680s of a 1800s daily cap for 600s of audio");
  assert.ok(before > caps.day * 0.9);
});

test("a legacy client that sends no body.sec stays well inside the cap for the same consult", async () => {
  const s = fakeStore(), caps = scribeCaps({});
  for (let i = 0; i < 14; i++) await addScribeTime(s, "u1", scribeChargeSec("opd-scribe", undefined), NOW);
  const used = Number(await s.get("aiu:sec:u1:scribe:2026-08-12")) || 0;
  assert.equal(used, 630, "14 background refines x the 45s floor");
  assert.equal((await checkScribeTime(s, "u1", NOW, caps)).ok, true, "a 10-minute consult must not trip the cap");
});

test("caps isolate per doctor", async () => {
  const s = fakeStore(), caps = scribeCaps({});
  await addScribeTime(s, "u1", 2000, NOW);                              // u1 over daily
  assert.equal((await checkScribeTime(s, "u1", NOW, caps)).ok, false);
  assert.equal((await checkScribeTime(s, "u2", NOW, caps)).ok, true);   // u2 untouched
});
