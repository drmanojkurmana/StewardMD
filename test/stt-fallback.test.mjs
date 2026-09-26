/* test/stt-fallback.test.mjs — the cloud speech-to-text fallback credit (owner, 2026-09-26):
 * Free Rs 10, Pro accounts Rs 50, Clinician / Clinician Pro Rs 100 a month, cut per second of audio. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STT_FALLBACK_PAISE, sttFallbackOn, planClass, allowancePaise, paisePerSec, chargeSeconds,
  checkFallback, spendFallback, walletKey, exhaustedBody, MAX_CHARGE_SEC, MAX_BYTES_PER_SEC
} from "../functions/_stt_fallback.js";

function kv() {
  const m = new Map();
  return { m, async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } };
}
const NOW = Date.parse("2026-09-26T10:00:00Z");

test("owner amounts: free 10, pro 50, clinician 100 (paise)", () => {
  assert.deepEqual(STT_FALLBACK_PAISE, { free: 1000, pro: 5000, clinician: 10000 });
  assert.equal(allowancePaise({}, "free"), 1000);
  assert.equal(allowancePaise({}, "pro"), 5000);
  assert.equal(allowancePaise({}, "clinician"), 10000);
  assert.equal(allowancePaise({}, "nonsense"), 1000);
  assert.equal(allowancePaise({ STT_FALLBACK_PAISE_PRO: "7000" }, "pro"), 7000);
});

test("plan class: tier first, pro claim second, guests always free", () => {
  assert.equal(planClass("physician", false, true), "clinician");
  assert.equal(planClass("physicianpro", false, true), "clinician");
  assert.equal(planClass("ultimate", false, true), "clinician");
  assert.equal(planClass("pro", false, true), "pro");
  assert.equal(planClass("trainee", false, true), "pro");
  assert.equal(planClass("coresident", false, true), "pro");
  assert.equal(planClass("free", true, true), "pro");      // Pro claim without a tier record
  assert.equal(planClass(null, false, true), "free");
  assert.equal(planClass("physician", true, false), "free"); // no uid: launch promo must not widen a guest
});

test("kill switch defaults ON, '0' turns the meter off", () => {
  assert.equal(sttFallbackOn({}), true);
  assert.equal(sttFallbackOn({ STT_FALLBACK_CREDITS_ON: "0" }), false);
  assert.equal(sttFallbackOn({ STT_FALLBACK_CREDITS_ON: "1" }), true);
});

test("rate: Rs 0.02/s default, env override", () => {
  assert.equal(paisePerSec({}), 2);
  assert.equal(paisePerSec({ AI_COST_PER_AUDIO_SEC_INR: "0.05" }), 5);
});

test("charged seconds: max(client duration, byte floor), 1 s minimum, 15 min cap", () => {
  assert.equal(chargeSeconds(0, 0), 1);
  assert.equal(chargeSeconds(0, 300000), 300);                      // 5 min measured
  const b64For = (bytes) => Math.ceil(bytes * 4 / 3);
  assert.equal(chargeSeconds(b64For(MAX_BYTES_PER_SEC * 60), 1000), 60); // client under-reports: bytes win
  assert.equal(chargeSeconds(0, 10 * 3600 * 1000), MAX_CHARGE_SEC);
  assert.equal(chargeSeconds(0, "junk"), 1);
});

test("a 5-minute fallback costs Rs 6; Free gets one, the second is refused", async () => {
  const store = kv(), id = "fb:u1", cost = chargeSeconds(0, 300000) * paisePerSec({});
  assert.equal(cost, 600);
  const c1 = await checkFallback({}, store, id, "free", cost, NOW);
  assert.equal(c1.ok, true);
  await spendFallback(store, id, cost, NOW);
  const c2 = await checkFallback({}, store, id, "free", cost, NOW);
  assert.equal(c2.ok, false);
  assert.equal(c2.spent, 600);
  assert.equal(c2.remaining, 400);
  const body = exhaustedBody(c2, NOW);
  assert.equal(body.error, "stt-fallback-exhausted");
  assert.equal(body.allowanceInr, 10);
  assert.equal(body.resetMonth, "2026-09");
  assert.ok(!/—/.test(body.message), "no em-dash in app-facing text");
});

test("wallet is per month and per identity", async () => {
  const store = kv();
  await spendFallback(store, "fb:u1", 1000, NOW);
  assert.equal((await checkFallback({}, store, "fb:u1", "free", 1, NOW)).ok, false);
  assert.equal((await checkFallback({}, store, "fb:u2", "free", 1, NOW)).ok, true);
  const next = Date.parse("2026-10-01T00:00:01Z");
  assert.equal((await checkFallback({}, store, "fb:u1", "free", 1, next)).ok, true);
  assert.equal(walletKey("fb:u1", NOW), "stt:fb:fb:u1:2026-09");
});

test("clinician wallet takes about sixteen 5-minute fallbacks", async () => {
  const store = kv(), id = "fb:doc";
  let n = 0;
  while ((await checkFallback({}, store, id, "clinician", 600, NOW)).ok) { await spendFallback(store, id, 600, NOW); n++; }
  assert.equal(n, 16);
});

test("no KV or no id: fail open, unmetered", async () => {
  const c = await checkFallback({}, null, "fb:u1", "free", 99999, NOW);
  assert.equal(c.ok, true);
  assert.equal(c.metered, false);
  assert.equal(await spendFallback(null, "x", 1, NOW), null);
});
