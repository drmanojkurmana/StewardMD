/* test/token-purchase.test.mjs — ₹499 -> 750,000 MaiK Tokens -> wallet -> spent by AI.
 *
 * Drives the REAL chain with the real modules: selectAmount() builds the order exactly as the
 * checkout route does, its `key`/`months` ride in a genuine Razorpay `payment.captured` payload, and
 * fulfilPurchase() consumes that payload. Then the AI cost gate (checkCostCap, the same one
 * gateAndCount calls) spends the balance down, proving the tokens are actually usable.
 *
 * What this canNOT cover: Razorpay taking real money, and the webhook signature check (crypto.subtle
 * HMAC, exercised by the live route). Everything between the payment and the doctor's balance is here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectAmount, fulfilPurchase } from "../functions/api/billing/[[path]].js";
import { getCredits, checkCostCap, inrToMt, mtToInr } from "../functions/_credits.js";

function fakeKv(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { m, async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const EMAIL = "doc@hospital.in", UID = "fbuid-123", KEY = "em:" + EMAIL;
const DAY = "2026-08-25", NOW = Date.parse(DAY + "T10:00:00Z");
const deps = (kv) => ({ kv, lookupUser: async () => ({ uid: UID, email: EMAIL, name: "Dr A" }), grantPro: async (_e, uid, o) => ({ granted: true, uid, months: o.months }) });

// The exact payload Razorpay POSTs, built from what our own order route put in `notes`.
function razorpayCaptured(sel, uid) {
  return { event: "payment.captured", payload: { payment: { entity: { notes: { uid, plan: sel.key, months: sel.months } } } } };
}

test("the Power pack is priced at ₹499 for 750,000 tokens", () => {
  const sel = selectAmount({}, { pack: "power" });
  assert.equal(sel.amount, 49900, "₹499 in paise");
  assert.equal(sel.mt, 750000);
  assert.equal(sel.key, "tokens:power");
  assert.equal(sel.months, 0, "a token pack buys no subscription months");
});

test("₹499 captured -> 750,000 MaiK Tokens in the wallet", async () => {
  const kv = fakeKv();
  const sel = selectAmount({}, { pack: "power" });
  const evt = razorpayCaptured(sel, UID);
  const notes = evt.payload.payment.entity.notes;

  const r = await fulfilPurchase({}, notes.uid, notes.plan, notes.months, "razorpay", deps(kv));
  assert.equal(r.ok, true);
  assert.equal(r.tokens, 750000, "the advertised pack size is what is credited");
  assert.equal(r.email, EMAIL, "credited against the email the AI meter keys on");
  assert.equal(inrToMt(await getCredits(kv, KEY)), 750000, "wallet reads back 750k MT");
  // ₹499 paid buys ₹375 of AI at our internal cost — a 75% payout, vs the 50% that CREDIT_CONVERSION
  // applies to a raw rupee top-up. That gap is a PRICING decision (owner to confirm), not a bug: the
  // advertised pack size is deliberately what the doctor receives.
  assert.equal(await getCredits(kv, KEY), 375, "…which is ₹375 of AI allowance");
});

test("THE REGRESSION: a token pack must not grant Pro months", async () => {
  const kv = fakeKv();
  let granted = false;
  const d = Object.assign({}, deps(kv), { grantPro: async () => { granted = true; return {}; } });
  const sel = selectAmount({}, { pack: "power" });
  await fulfilPurchase({}, UID, sel.key, sel.months, "razorpay", d);
  assert.equal(granted, false, "grantPro must never fire for a token pack (it used to, for 1 month)");
  assert.equal(inrToMt(await getCredits(kv, KEY)), 750000);
});

test("a subscription purchase still grants Pro, and credits nothing", async () => {
  const kv = fakeKv();
  const sel = selectAmount({}, { tier: "pro", cycle: "annual" });
  assert.equal(sel.key, "pro:annual");
  const r = await fulfilPurchase({}, UID, sel.key, sel.months, "razorpay", deps(kv));
  assert.equal(r.granted, true);
  assert.equal(r.months, 12);
  assert.equal(await getCredits(kv, KEY), 0, "no tokens minted by a subscription");
});

test("a tampered note cannot mint tokens — the size comes from the server table", async () => {
  const kv = fakeKv();
  // An attacker replays the webhook with a forged pack name.
  const bad = await fulfilPurchase({}, UID, "tokens:infinite", 0, "razorpay", deps(kv));
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "unknown-pack");
  assert.equal(await getCredits(kv, KEY), 0);
});

test("no email on the account -> no silent loss: fulfilment reports the failure", async () => {
  const kv = fakeKv();
  const d = Object.assign({}, deps(kv), { lookupUser: async () => ({ uid: UID, email: "" }) });
  const r = await fulfilPurchase({}, UID, "tokens:power", 0, "razorpay", d);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-email");
});

test("the bought tokens are then SPENT by AI usage, and run out honestly", async () => {
  const kv = fakeKv();
  const env = { AI_COST_CAP_ON: "1" };
  const sel = selectAmount({}, { pack: "power" });
  await fulfilPurchase({}, UID, sel.key, sel.months, "razorpay", deps(kv));
  assert.equal(inrToMt(await getCredits(kv, KEY)), 750000);

  const cap = 2;                                  // ₹2/day free allowance
  const spend = (inr) => kv.m.set("aiu:doc:" + KEY + ":" + DAY, JSON.stringify({ cost: inr }));

  // Under the free cap: nothing is taken from the wallet.
  spend(1.5);
  let c = await checkCostCap(env, kv, KEY, cap, NOW);
  assert.equal(c.ok, true);
  assert.equal(inrToMt(await getCredits(kv, KEY)), 750000, "free allowance is used first");

  // Over the cap by ₹10: exactly ₹10 (20,000 MT) comes out of the wallet.
  spend(12);
  c = await checkCostCap(env, kv, KEY, cap, NOW);
  assert.equal(c.ok, true);
  assert.equal(c.onCredits, true, "AI keeps working, now on the wallet");
  assert.equal(inrToMt(await getCredits(kv, KEY)), 750000 - 20000, "the deduction is the over-cap spend, to the token");
  assert.equal(c.creditsMt, 730000, "and the sheet is told the balance in tokens");

  // Spend the whole pack: balance floors at zero and AI is blocked, not negative.
  spend(2 + mtToInr(750000) + 5);
  c = await checkCostCap(env, kv, KEY, cap, NOW);
  assert.equal(await getCredits(kv, KEY), 0);
  assert.equal(c.ok, false);
  assert.equal(c.reason, "ai-cost-cap");
  assert.equal(c.creditsMt, 0);
  assert.ok(c.resetAt > NOW, "and it says when the free allowance returns");
});

test("double-charging is impossible within a day (chargedToday tally)", async () => {
  const kv = fakeKv();
  const env = { AI_COST_CAP_ON: "1" };
  await fulfilPurchase({}, UID, "tokens:power", 0, "razorpay", deps(kv));
  kv.m.set("aiu:doc:" + KEY + ":" + DAY, JSON.stringify({ cost: 12 }));
  for (let i = 0; i < 5; i++) await checkCostCap(env, kv, KEY, 2, NOW);   // 5 gate calls, same spend
  assert.equal(inrToMt(await getCredits(kv, KEY)), 750000 - 20000, "the same ₹10 overage is charged once, not five times");
});
