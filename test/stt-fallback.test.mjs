/* test/stt-fallback.test.mjs — dictation credits for the cloud speech-to-text fallback (owner, 2026-09-26):
 * shown only as credits (1 credit = 10 paise of our cost, Rs 10 = 100 credits), Free 100 (mobile verified
 * only), Pro accounts 500, Clinician / Clinician Pro 1,000 a month, then bought "dict" packs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DICT_CREDITS, sttFallbackOn, planClass, monthlyCredits, paisePerSec, chargeSeconds, chargeCredits,
  signinBody, MAX_CHARGE_SEC, MAX_BYTES_PER_SEC
} from "../functions/_stt_fallback.js";
import { quotaPacks, quotaPackFor, packKeyForProduct, state, consume, credit, quotaRefusal, quotaCopy } from "../functions/_quota.js";

function kv() {
  const m = new Map();
  return { m, async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } };
}
const NOW = Date.parse("2026-09-26T10:00:00Z");
const RUPEE = /₹|Rs\.?\s?\d|rupee|paise/i;

test("owner amounts in credits: free 100, pro 500, clinician 1,000 (Rs 10 = 100 credits)", () => {
  assert.deepEqual(DICT_CREDITS, { none: 0, free: 100, pro: 500, clinician: 1000 });
  assert.equal(monthlyCredits({}, "free"), 100);
  assert.equal(monthlyCredits({}, "pro"), 500);
  assert.equal(monthlyCredits({}, "clinician"), 1000);
  assert.equal(monthlyCredits({}, "none"), 0);
  assert.equal(monthlyCredits({ DICT_CREDITS_PRO: "700" }, "pro"), 700);
});

test("plan class: tier first, pro claim second, free only when the mobile number is verified", () => {
  assert.equal(planClass("physician", false, true, false), "clinician");
  assert.equal(planClass("physicianpro", false, true, false), "clinician");
  assert.equal(planClass("ultimate", false, true, false), "clinician");
  assert.equal(planClass("pro", false, true, false), "pro");
  assert.equal(planClass("trainee", false, true, false), "pro");
  assert.equal(planClass("coresident", false, true, false), "pro");
  assert.equal(planClass("free", true, true, false), "pro");
  assert.equal(planClass(null, false, true, true), "free");
  assert.equal(planClass(null, false, true, false), "none");
  assert.equal(planClass("physician", true, false, true), "none");   // no uid
});

test("kill switch defaults ON, '0' turns the meter off", () => {
  assert.equal(sttFallbackOn({}), true);
  assert.equal(sttFallbackOn({ STT_FALLBACK_CREDITS_ON: "0" }), false);
});

// 2026-10-02: Rs 0.004/s = Vertex gemini-2.5-flash audio (32 tokens/s at $1.00 per 1M + transcript), was Rs 0.02/s.
test("charge: max(client duration, byte floor); a 5-minute recording costs 12 credits", () => {
  assert.equal(paisePerSec({}), 0.4);
  assert.equal(chargeSeconds(0, 0), 1);
  assert.equal(chargeSeconds(0, 300000), 300);
  const b64For = (bytes) => Math.ceil(bytes * 4 / 3);
  assert.equal(chargeSeconds(b64For(MAX_BYTES_PER_SEC * 60), 1000), 60);   // under-reported: bytes win
  assert.equal(chargeSeconds(0, 10 * 3600 * 1000), MAX_CHARGE_SEC);
  assert.equal(chargeCredits({}, 0, 300000), 12);
  assert.equal(chargeCredits({}, 0, 1), 1);
});

test("dict packs: 300 and 1,000 credits, store products, no per-credit rupee line", () => {
  const p = quotaPacks({});
  assert.equal(p["dict.300"].units, 300);
  assert.equal(p["dict.300"].amount, 19900);
  assert.equal(p["dict.1000"].units, 1000);
  assert.equal(p["dict.1000"].amount, 69900);
  assert.equal(p["dict.300"].perUnit, 0);
  assert.equal(p["dict.1000"].perUnit, 0);
  assert.equal(quotaPackFor("pack:dict.300"), "dict.300");
  assert.equal(packKeyForProduct("in.stewardmd.dict.1000"), "pack:dict.1000");
});

test("copy and refusal never show rupees for dictation credits", () => {
  const c = quotaCopy("dict");
  [c.headline, c.price, c.expiry].concat(c.lines).forEach((t) => { assert.ok(!RUPEE.test(t), t); assert.ok(!/—/.test(t), t); });
  const r = quotaRefusal({}, "dict");
  assert.equal(r.error, "quota-exhausted");
  assert.equal(r.feature, "dict");
  assert.equal(r.packs.length, 2);
  assert.ok(!RUPEE.test(JSON.stringify(r.copy)));
  assert.ok(!RUPEE.test(signinBody().message));
});

test("meter: monthly credits first, then bought credits; next month resets the monthly part", async () => {
  const store = kv(), uid = "u1";
  let st = await state({}, store, uid, "dict", { included: 100, now: NOW });
  assert.equal(st.remaining, 100);
  await consume({}, store, uid, "dict", { units: 60, included: 100, now: NOW });
  st = await state({}, store, uid, "dict", { included: 100, now: NOW });
  assert.equal(st.remaining, 40);                       // a second 5-minute fallback (60) will not fit
  await credit({}, store, uid, "dict", 300);
  st = await state({}, store, uid, "dict", { included: 100, now: NOW });
  assert.equal(st.remaining, 340);
  await consume({}, store, uid, "dict", { units: 60, included: 100, now: NOW });
  st = await state({}, store, uid, "dict", { included: 100, now: NOW });
  assert.equal(st.remaining, 280);
  assert.equal(st.purchasedBalance, 280);               // 40 monthly + 20 bought were spent
  const next = Date.parse("2026-10-01T00:00:01Z");
  st = await state({}, store, uid, "dict", { included: 100, now: next });
  assert.equal(st.remaining, 380);
});
