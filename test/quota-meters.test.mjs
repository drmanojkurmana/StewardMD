/* test/quota-meters.test.mjs — per-patient quota meters + top-up packs.
 *
 * Drives the REAL modules: functions/_quota.js for the meter, and the billing route's selectAmount()
 * / fulfilPurchase() for both payment paths (a genuine Razorpay payment.captured note, and the
 * product-id mapping the /api/billing/iap/verify branch uses).
 *
 * Not covered here: the live HTTP routes (Firebase auth + KV bindings) and the store taking money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  state, consume, credit, includedFor, quotaPacks, quotaPackFor, packKeyForProduct,
  quotaRefusal, quotaCopy, consumeScribeSession, quotaOn,
} from "../functions/_quota.js";
import { selectAmount, fulfilPurchase } from "../functions/api/billing/[[path]].js";

function fakeKv(seed = {}) {
  const m = new Map(Object.entries(seed)), ttl = new Map();
  return {
    m, ttl,
    async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; },
    async put(k, v, o) { m.set(k, v); ttl.set(k, (o && o.expirationTtl) || null); },
    async delete(k) { m.delete(k); },
  };
}
const UID = "fbuid-123";
const AUG = Date.parse("2026-08-25T10:00:00Z"), SEP = Date.parse("2026-09-02T10:00:00Z");
const PHYS = { role: "physician" };
const env = {};

// ---------------- included allowance ----------------
test("Physician and Physician Pro get 5 care credits + 50 Scribe consults; nobody else gets any", () => {
  for (const r of ["physician", "physician_pro"]) {
    assert.equal(includedFor(env, r, "care"), 5);
    assert.equal(includedFor(env, r, "scribe"), 50);
  }
  for (const r of ["pro", "resident", "student", "co_resident", null, undefined, ""]) {
    assert.equal(includedFor(env, r, "care"), 0, "lower tier gets no care credits: " + r);
    assert.equal(includedFor(env, r, "scribe"), 0);
  }
});

test("the included allowance is spendable and then refuses", async () => {
  const kv = fakeKv();
  for (let i = 1; i <= 5; i++) {
    const r = await consume(env, kv, UID, "care", Object.assign({ now: AUG }, PHYS));
    assert.equal(r.ok, true, "credit " + i + " allowed");
    assert.equal(r.remaining, 5 - i);
  }
  const over = await consume(env, kv, UID, "care", Object.assign({ now: AUG }, PHYS));
  assert.equal(over.ok, false);
  assert.equal(over.reason, "quota-exhausted");
  assert.equal(over.remaining, 0);
});

// ---------------- month rollover ----------------
test("the monthly allowance resets on the calendar month and does NOT roll over", async () => {
  const kv = fakeKv();
  for (let i = 0; i < 3; i++) await consume(env, kv, UID, "care", Object.assign({ now: AUG }, PHYS));
  const aug = await state(env, kv, UID, "care", Object.assign({ now: AUG }, PHYS));
  assert.equal(aug.usedThisMonth, 3);
  assert.equal(aug.remaining, 2, "2 of 5 left in August");

  const sep = await state(env, kv, UID, "care", Object.assign({ now: SEP }, PHYS));
  assert.equal(sep.usedThisMonth, 0, "September starts clean");
  assert.equal(sep.remaining, 5, "full allowance, NOT 5 + the 2 unused (no roll-over)");
});

// ---------------- purchased credits ----------------
test("purchased credits never expire: written with no TTL, and survive the month roll", async () => {
  const kv = fakeKv();
  await credit(env, kv, UID, "care", 25);
  const balKey = "quota:care:" + UID + ":bal";
  assert.equal(kv.ttl.get(balKey), null, "no expirationTtl on the purchased-balance key");

  const sep = await state(env, kv, UID, "care", Object.assign({ now: SEP }, PHYS));
  assert.equal(sep.purchasedBalance, 25);
  assert.equal(sep.remaining, 30, "5 included (fresh month) + 25 purchased");

  // spend order: included first, purchased untouched until it is needed
  for (let i = 0; i < 5; i++) await consume(env, kv, UID, "care", Object.assign({ now: SEP }, PHYS));
  let st = await state(env, kv, UID, "care", Object.assign({ now: SEP }, PHYS));
  assert.equal(st.purchasedBalance, 25, "included allowance is spent before purchased credits");
  await consume(env, kv, UID, "care", Object.assign({ now: SEP }, PHYS));
  st = await state(env, kv, UID, "care", Object.assign({ now: SEP }, PHYS));
  assert.equal(st.purchasedBalance, 24);
  assert.equal(kv.ttl.get(balKey), null, "still no TTL after a spend");
});

test("a purchase NEVER reduces an existing balance", async () => {
  const kv = fakeKv();
  await credit(env, kv, UID, "care", 25);
  await credit(env, kv, UID, "care", 100);
  const st = await state(env, kv, UID, "care", { now: AUG, role: "pro" });
  assert.equal(st.purchasedBalance, 125, "packs add, never replace");
  assert.equal(st.usedThisMonth, 0, "buying does not consume this month's included allowance");
  // a zero/garbage credit is a no-op, not a wipe
  await credit(env, kv, UID, "care", 0);
  await credit(env, kv, UID, "care", "nonsense");
  assert.equal((await state(env, kv, UID, "care", { now: AUG })).purchasedBalance, 125);
});

test("a doctor with no included allowance can still spend purchased credits", async () => {
  const kv = fakeKv();
  const before = await consume(env, kv, UID, "care", { now: AUG, role: "pro" });
  assert.equal(before.ok, false, "no allowance, no purchase -> refused");
  await credit(env, kv, UID, "care", 2);
  assert.equal((await consume(env, kv, UID, "care", { now: AUG, role: "pro" })).ok, true);
  assert.equal((await consume(env, kv, UID, "care", { now: AUG, role: "pro" })).ok, true);
  assert.equal((await consume(env, kv, UID, "care", { now: AUG, role: "pro" })).ok, false);
});

test("fail-open: no KV binding never blocks the doctor", async () => {
  const r = await consume(env, null, UID, "care", Object.assign({ now: AUG }, PHYS));
  assert.equal(r.ok, true);
});

// ---------------- refusal payload shape + copy ----------------
test("the refusal payload is a renderable 402 body carrying the packs and the value copy", () => {
  const r = quotaRefusal(env, "care");
  assert.equal(r.error, "quota-exhausted");
  assert.equal(r.feature, "care");
  assert.equal(r.remaining, 0);
  assert.equal(r.packs.length, 2, "both care packs offered");
  assert.deepEqual(r.packs.map((p) => p.key).sort(), ["care.100", "care.25"]);
  assert.ok(r.packs.every((p) => p.amount > 0 && p.units > 0 && p.product.startsWith("in.stewardmd.care.")));
  // owner-approved benefit headline + price line, verbatim
  assert.equal(r.copy.headline, "The clinic that calls is the clinic they come back to.");
  assert.equal(r.copy.price, "₹44 per patient. One patient who comes back pays for 15 follow-ups.");
  assert.equal(r.copy.expiry, "Credits never expire.");
});

test("the Scribe refusal carries the Scribe headline and price line", () => {
  const r = quotaRefusal(env, "scribe");
  assert.equal(r.feature, "scribe");
  assert.deepEqual(r.packs.map((p) => p.key).sort(), ["scribe.250", "scribe.50"]);
  assert.equal(r.copy.headline, "Not just a note. A second pair of eyes.");
  assert.equal(r.copy.price, "₹20 a consult. Four minutes back, and a checklist you did not have to write.");
  assert.ok(r.copy.lines.includes("Finish your notes before the patient leaves the room."));
  assert.ok(r.copy.lines.some((l) => /differentials worth considering/.test(l)), "sells ddx + investigations, not just dictation");
});

test("Scribe copy never promises diagnostic completeness or accuracy", () => {
  const c = quotaCopy("scribe", {});
  const all = [c.headline, c.price, c.expiry].concat(c.lines).join(" ").toLowerCase();
  const forbidden = [
    /never miss/, /won'?t miss/, /can'?t miss/, /cannot miss/, /nothing gets missed/,
    /catches what you miss/, /catch what you miss/, /doesn'?t miss/, /misses nothing/,
    /diagnos(e|es|is|tic)/, /more accurate/, /confirms/,
  ];
  for (const f of forbidden) assert.ok(!f.test(all), "forbidden Scribe phrasing present: " + f);
  assert.ok(/you decide/.test(all), "keeps the doctor-final frame");
});

test('the "have not heard from you" line is absent unless a real count is supplied', () => {
  const none = quotaCopy("care", {}).lines.join(" | ");
  assert.ok(!/have not heard from you/.test(none), "no count -> line omitted");
  assert.ok(!/have not heard from you/.test(quotaCopy("care", { unheardCount: 0 }).lines.join(" | ")), "0 -> omitted");
  assert.ok(!/have not heard from you/.test(quotaCopy("care", { unheardCount: null }).lines.join(" | ")));
  const five = quotaCopy("care", { unheardCount: 5 }).lines;
  assert.equal(five[0], "5 patients discharged this month have not heard from you.");
});

test("no clinical outcome claims and no em-dash in any quota copy", () => {
  const all = ["care", "scribe"].map((f) => {
    const c = quotaCopy(f, { unheardCount: 5 });
    return [c.headline, c.price, c.expiry].concat(c.lines).join(" ");
  }).join(" ");
  assert.ok(!/—/.test(all), "no em-dash in app-facing text");
  for (const banned of [/readmis/i, /mortalit/i, /complication/i, /recovery rate/i, /outcome/i, /% more/i, /trusted by \d/i]) {
    assert.ok(!banned.test(all), "banned claim pattern present: " + banned);
  }
});

// ---------------- pack purchase: BOTH payment paths ----------------
test("pack prices and product ids match App Store Connect", () => {
  const p = quotaPacks(env);
  assert.equal(p["care.25"].amount, 109900);
  assert.equal(p["care.100"].amount, 349900);
  assert.equal(p["scribe.50"].amount, 99900);
  assert.equal(p["scribe.250"].amount, 399900);
  assert.equal(p["care.25"].product, "in.stewardmd.care.25");
  assert.equal(p["scribe.250"].product, "in.stewardmd.scribe.250");
});

test("Razorpay path: selectAmount -> captured note -> fulfilPurchase credits the pack", async () => {
  const kv = fakeKv();
  const sel = selectAmount(env, { quotaPack: "care.100" });
  assert.equal(sel.amount, 349900);
  assert.equal(sel.months, 0, "a pack buys no subscription months");
  assert.equal(sel.key, "pack:care.100");
  assert.equal(quotaPackFor(sel.key), "care.100");

  // the exact note our order route writes, echoed back by Razorpay
  const notes = { uid: UID, plan: sel.key, months: sel.months };
  const r = await fulfilPurchase(env, notes.uid, notes.plan, notes.months, "razorpay", { kv });
  assert.equal(r.ok, true);
  assert.equal(r.feature, "care");
  assert.equal(r.units, 100);
  assert.equal((await state(env, kv, UID, "care", { now: AUG })).purchasedBalance, 100);
});

test("StoreKit path: the iOS product id maps to the same fulfilment", async () => {
  const kv = fakeKv();
  assert.equal(packKeyForProduct("in.stewardmd.scribe.250"), "pack:scribe.250");
  assert.equal(packKeyForProduct("in.stewardmd.tokens.power"), null, "token packs stay on their own path");
  assert.equal(packKeyForProduct("in.stewardmd.pro.monthly"), null, "subscriptions are not packs");

  const r = await fulfilPurchase(env, UID, packKeyForProduct("in.stewardmd.scribe.250"), 0, "iap-apple", { kv });
  assert.equal(r.ok, true);
  assert.equal(r.feature, "scribe");
  assert.equal(r.units, 250);
  assert.equal((await state(env, kv, UID, "scribe", { now: AUG })).purchasedBalance, 250);
});

test("a tampered plan note cannot mint an unknown pack", async () => {
  const kv = fakeKv();
  const r = await fulfilPurchase(env, UID, "pack:care.99999", 0, "razorpay", { kv, grantPro: async () => ({ granted: true }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-pack");
  assert.equal((await state(env, kv, UID, "care", { now: AUG })).purchasedBalance, 0);
});

// ---------------- Scribe session window ----------------
test("one Scribe consult = one session: refine calls inside the window are free and never refused", async () => {
  const kv = fakeKv();
  const opts = Object.assign({ now: AUG }, PHYS);
  const first = await consumeScribeSession(env, kv, UID, opts);
  assert.equal(first.ok, true);
  assert.equal(first.open, false, "first call opens the session and charges it");
  assert.equal((await state(env, kv, UID, "scribe", opts)).usedThisMonth, 1);

  for (let i = 0; i < 5; i++) {
    const again = await consumeScribeSession(env, kv, UID, opts);
    assert.equal(again.ok, true);
    assert.equal(again.open, true, "a refine inside the window is free");
  }
  assert.equal((await state(env, kv, UID, "scribe", opts)).usedThisMonth, 1, "still one consult charged");
});

test("an already-open Scribe session is never hard-stopped mid-consultation at zero remaining", async () => {
  const kv = fakeKv();
  const opts = Object.assign({ now: AUG }, PHYS);
  await consumeScribeSession(env, kv, UID, opts);            // opens the session, 1 of 50
  await consume(env, kv, UID, "scribe", { now: AUG, role: "physician", units: 49 });   // burn the rest
  assert.equal((await state(env, kv, UID, "scribe", opts)).remaining, 0);
  const mid = await consumeScribeSession(env, kv, UID, opts);
  assert.equal(mid.ok, true, "work already started is never refused");
  const next = await consumeScribeSession(env, kv, UID, { now: AUG, role: "physician", session: "other-patient" });
  assert.equal(next.ok, false, "a NEW session is refused once the quota is gone");
  assert.equal(next.reason, "quota-exhausted");
});

// ---------------- flag ----------------
test("the flag is off by default and only '1' turns it on", () => {
  assert.equal(quotaOn({}), false);
  assert.equal(quotaOn({ QUOTA_METERS_ON: "0" }), false);
  assert.equal(quotaOn({ QUOTA_METERS_ON: "true" }), false);
  assert.equal(quotaOn({ QUOTA_METERS_ON: "1" }), true);
});
