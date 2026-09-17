/* test/clinic-messaging.test.mjs — Clinic Messaging: the metered OPD queue notifications.
 *
 * Drives the REAL modules: functions/_quota.js for the meter (included allowance, the two
 * subscription tiers, the never-expiring pack, and the one-charge-per-visit rule), and the billing
 * route's selectAmount() / fulfilPurchase() for both payment paths.
 *
 * The money invariants asserted here, in plain words:
 *   - a patient's 3 to 5 queue messages cost ONE unit, not five;
 *   - spend order is included, then the subscription's allowance, then the purchased pack;
 *   - the purchased balance never expires and no purchase, on either payment path, ever reduces it;
 *   - the iOS bundle never renders a web price.
 *
 * Not covered here: the live HTTP routes (Firebase auth + KV bindings), the store taking money, and
 * the rendered sheet — that is test/run-quota-topup-ui.mjs on a real browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  state, consume, consumeVisit, credit, includedFor, quotaPacks, quotaPackFor, packKeyForProduct,
  quotaRefusal, quotaCopy, msgTiers, msgTierFromPlanKey, msgTierKeyForProduct, msgPurchasePatch,
  effectiveMsgTier, msgTierUnits, COMPARE, compareLine, FEATURES,
} from "../functions/_quota.js";
import { selectAmount, fulfilPurchase } from "../functions/api/billing/[[path]].js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const src = (rel) => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");

function fakeKv(seed = {}) {
  const m = new Map(Object.entries(seed)), ttl = new Map();
  return {
    m, ttl,
    async get(k, t) { const v = m.has(k) ? m.get(k) : null; return t === "json" && v != null ? JSON.parse(v) : v; },
    async put(k, v, o) { m.set(k, v); ttl.set(k, (o && o.expirationTtl) || null); },
    async delete(k) { m.delete(k); },
  };
}
const UID = "fbuid-msg-1";
const AUG = Date.parse("2026-08-25T10:00:00Z"), SEP = Date.parse("2026-09-02T10:00:00Z");
const env = {};
const PRO = { role: "pro" };
const withTier = (t, exp) => ({ role: "pro", msgTier: t, msgTierExp: exp });

// ---------------- included allowance ----------------
test("20 queue patients a month are included on pro, physician and physician pro, and on nothing below", () => {
  for (const r of ["pro", "physician", "physicianpro", "physician_pro"]) assert.equal(includedFor(env, r, "msg"), 20);
  for (const r of ["student", "resident", "co_resident", "intern", null, undefined, ""]) assert.equal(includedFor(env, r, "msg"), 0);
});

test("the included allowance is env-overridable, like care and scribe", () => {
  assert.equal(includedFor({ QUOTA_MSG_INCLUDED: 50 }, "pro", "msg"), 50);
  assert.equal(includedFor({ QUOTA_MSG_INCLUDED: 0 }, "pro", "msg"), 0);
  assert.equal(includedFor({ QUOTA_MSG_INCLUDED: "nonsense" }, "pro", "msg"), 20);   // garbage falls back
});

test("msg is a first-class feature of the same meter, not a parallel system", () => {
  assert.ok(FEATURES.includes("msg"));
});

// ---------------- the subscription tiers stack on top ----------------
test("a Clinic Messaging subscription ADDS its allowance to the included one", async () => {
  const kv = fakeKv();
  const FUT = Date.now() + 86400000;
  const small = await state(env, kv, UID, "msg", withTier("small", FUT));
  assert.equal(small.included, 20);
  assert.equal(small.tierUnits, 150);
  assert.equal(small.remaining, 170);
  const big = await state(env, kv, UID, "msg", withTier("big", FUT));
  assert.equal(big.tierUnits, 600);
  assert.equal(big.remaining, 620);
});

test("an EXPIRED subscription grants nothing, and the included allowance survives it", async () => {
  const kv = fakeKv();
  const st = await state(env, kv, UID, "msg", { role: "pro", msgTier: "big", msgTierExp: AUG - 1, now: AUG });
  assert.equal(st.tierUnits, 0);
  assert.equal(st.msgTier, null);
  assert.equal(st.remaining, 20);
  assert.equal(effectiveMsgTier({ msgTier: "big", msgTierExp: AUG - 1 }, AUG), null);
  assert.equal(effectiveMsgTier({ msgTier: "big", msgTierExp: AUG + 1 }, AUG), "big");
  assert.equal(msgTierUnits(env, { msgTier: "small", msgTierExp: null }, AUG), 150);   // null expiry = comp, forever
});

test("the tier allowance belongs to msg alone: care and scribe never pick it up", async () => {
  const kv = fakeKv();
  const care = await state(env, kv, UID, "care", { role: "physician", msgTier: "big", msgTierExp: Date.now() + 86400000 });
  assert.equal(care.tierUnits, 0);
  assert.equal(care.remaining, 5);
});

// ---------------- spend order + the month boundary ----------------
test("spend order is included, then the subscription allowance, then the purchased pack", async () => {
  const kv = fakeKv();
  await credit(env, kv, UID, "msg", 100);                       // a pack bought earlier
  const o = () => ({ role: "pro", msgTier: "small", msgTierExp: AUG + 30 * 86400000, now: AUG });
  // 170 monthly units first. Nothing touches the purchased balance until they are gone.
  for (let i = 0; i < 170; i++) assert.equal((await consume(env, kv, UID, "msg", o())).ok, true);
  let st = await state(env, kv, UID, "msg", o());
  assert.equal(st.usedThisMonth, 170);
  assert.equal(st.purchasedBalance, 100, "the pack is untouched while monthly units remain");
  assert.equal(st.remaining, 100);
  // Only now does it spend the pack.
  assert.equal((await consume(env, kv, UID, "msg", o())).ok, true);
  st = await state(env, kv, UID, "msg", o());
  assert.equal(st.purchasedBalance, 99);
  assert.equal(st.usedThisMonth, 170, "the monthly counter does not run past the monthly allowance");
});

test("the monthly allowance resets on the calendar month and does NOT roll over", async () => {
  const kv = fakeKv();
  const aug = { role: "pro", msgTier: "small", msgTierExp: SEP + 30 * 86400000, now: AUG };
  const sep = Object.assign({}, aug, { now: SEP });
  for (let i = 0; i < 170; i++) await consume(env, kv, UID, "msg", aug);
  assert.equal((await state(env, kv, UID, "msg", aug)).remaining, 0, "August is spent");
  const s = await state(env, kv, UID, "msg", sep);
  assert.equal(s.usedThisMonth, 0);
  assert.equal(s.remaining, 170, "September starts full again, and August's leftovers do not carry");
});

test("running out refuses rather than going negative, and the refusal names the feature", async () => {
  const kv = fakeKv();
  const o = () => ({ role: "student", now: AUG });   // no included allowance at all
  const r = await consume(env, kv, UID, "msg", o());
  assert.equal(r.ok, false);
  assert.equal(r.reason, "quota-exhausted");
  assert.equal((await state(env, kv, UID, "msg", o())).remaining, 0);
});

// ---------------- ONE PATIENT PER VISIT ----------------
test("a patient's five queue messages cost ONE unit, not five", async () => {
  const kv = fakeKv();
  const o = () => ({ role: "pro", now: AUG });
  const first = await consumeVisit(env, kv, UID, "ticket-abc", o());
  assert.equal(first.ok, true);
  assert.equal(first.charged, true);
  for (let i = 0; i < 4; i++) {
    const again = await consumeVisit(env, kv, UID, "ticket-abc", o());
    assert.equal(again.ok, true);
    assert.equal(again.charged, false, "message " + (i + 2) + " of the same visit must be free");
  }
  assert.equal((await state(env, kv, UID, "msg", o())).usedThisMonth, 1);
});

test("a different patient, and the same patient's next visit, each cost their own unit", async () => {
  const kv = fakeKv();
  const o = () => ({ role: "pro", now: AUG });
  await consumeVisit(env, kv, UID, "ticket-1", o());
  await consumeVisit(env, kv, UID, "ticket-2", o());
  await consumeVisit(env, kv, UID, "ticket-3", o());   // the same patient tomorrow is a new ticket
  assert.equal((await state(env, kv, UID, "msg", o())).usedThisMonth, 3);
});

test("the visit marker is NOT written when the charge is refused, so a top-up resumes that visit", async () => {
  const kv = fakeKv();
  const o = () => ({ role: "student", now: AUG });   // zero allowance
  const refused = await consumeVisit(env, kv, UID, "ticket-x", o());
  assert.equal(refused.ok, false);
  assert.equal(refused.charged, false);
  assert.equal([...kv.m.keys()].some((k) => k.includes(":v:ticket-x")), false, "no marker for an uncharged visit");
  await credit(env, kv, UID, "msg", 5);
  const after = await consumeVisit(env, kv, UID, "ticket-x", o());
  assert.equal(after.charged, true, "the visit is chargeable again once the doctor tops up");
});

test("the meter FAILS OPEN: no KV, no uid or no visit id never blocks a patient message", async () => {
  for (const args of [[null, UID, "t1"], [fakeKv(), "", "t1"], [fakeKv(), UID, ""]]) {
    const r = await consumeVisit(env, args[0], args[1], args[2], { role: "student" });
    assert.equal(r.ok, true);
    assert.equal(r.charged, false);
  }
});

// ---------------- the pack never expires ----------------
test("the purchased balance is written with NO ttl, so it never expires", async () => {
  const kv = fakeKv();
  await credit(env, kv, UID, "msg", 100);
  const balKey = [...kv.m.keys()].find((k) => k.endsWith(":bal"));
  assert.equal(balKey, "quota:msg:" + UID + ":bal");
  assert.equal(kv.ttl.get(balKey), null, "a ttl here would silently delete money the doctor paid for");
});

test("a month boundary does not touch the purchased balance", async () => {
  const kv = fakeKv();
  await credit(env, kv, UID, "msg", 100);
  await consume(env, kv, UID, "msg", { role: "student", now: AUG });   // no included: spends the pack
  assert.equal((await state(env, kv, UID, "msg", { role: "student", now: SEP })).purchasedBalance, 99);
});

// ---------------- products, prices and both payment paths ----------------
test("the three App Store product ids are the owner's, on the server and in the client bundle", () => {
  const p = quotaPacks(env), t = msgTiers(env);
  assert.equal(p["msg.100"].product, "in.stewardmd.msg.100");
  assert.equal(t.small.product, "in.stewardmd.msg.small.monthly");
  assert.equal(t.big.product, "in.stewardmd.msg.big.monthly");
  const iap = src("iap.js");
  for (const id of ["in.stewardmd.msg.100", "in.stewardmd.msg.small.monthly", "in.stewardmd.msg.big.monthly"]) {
    assert.ok(iap.includes(id), "SMD_IAP.PRODUCTS must carry " + id);
  }
});

test("owner prices: 749 / 2999 a month, a 599 pack, and the allowances that go with them", () => {
  const t = msgTiers(env), p = quotaPacks(env);
  assert.equal(t.small.amount, 74900); assert.equal(t.small.units, 150);
  assert.equal(t.big.amount, 299900); assert.equal(t.big.units, 600);
  assert.equal(p["msg.100"].amount, 59900); assert.equal(p["msg.100"].units, 100);
  // Web (Razorpay) prices, ~12% lower, funded by the store fee we avoid.
  assert.equal(t.small.webAmount, 65900);
  assert.equal(t.big.webAmount, 264900);
  assert.equal(p["msg.100"].webAmount, 54900);
  for (const x of [t.small, t.big, p["msg.100"]]) assert.ok(x.webAmount < x.amount, "the web price must be the lower one");
});

test("selection keys map both ways, and a subscription is never mistaken for a pack", () => {
  assert.equal(selectAmount(env, { msgTier: "small" }).key, "msgtier:small");
  assert.equal(selectAmount(env, { msgTier: "big" }).amount, 299900);
  assert.equal(selectAmount(env, { msgTier: "big" }).months, 1);
  assert.equal(quotaPackFor("pack:msg.100"), "msg.100");
  assert.equal(packKeyForProduct("in.stewardmd.msg.100"), "pack:msg.100");
  assert.equal(packKeyForProduct("in.stewardmd.msg.small.monthly"), null, "a subscription is not a pack");
  assert.equal(msgTierKeyForProduct("in.stewardmd.msg.small.monthly"), "msgtier:small");
  assert.equal(msgTierKeyForProduct("in.stewardmd.msg.100"), null);
  assert.equal(msgTierFromPlanKey("msgtier:big"), "big");
  for (const k of ["pack:msg.100", "tokens:plus", "addon:onco", "pro:monthly", "physicianpro:annual", ""]) {
    assert.equal(msgTierFromPlanKey(k), null);
  }
});

test("the pack credits the same balance on BOTH payment paths, and never reduces it", async () => {
  const kv = fakeKv();
  await credit(env, kv, UID, "msg", 40);
  // Razorpay/PhonePe webhook path: the server-issued selection key.
  const web = await fulfilPurchase(env, UID, "pack:msg.100", 0, "razorpay", { kv });
  assert.equal(web.ok, true);
  assert.equal(web.feature, "msg");
  assert.equal(web.units, 100);
  assert.equal(web.purchasedBalance, 140);
  // StoreKit path: the product id resolves to the SAME key, so it grants the same thing.
  const iap = await fulfilPurchase(env, UID, packKeyForProduct("in.stewardmd.msg.100"), 0, "iap-ios", { kv });
  assert.equal(iap.purchasedBalance, 240, "a purchase is additive on every path; it can never reduce a balance");
});

test("buying a pack does not spend this month's included allowance", async () => {
  const kv = fakeKv();
  const o = { role: "pro", now: AUG };
  await consume(env, kv, UID, "msg", o);
  await fulfilPurchase(env, UID, "pack:msg.100", 0, "razorpay", { kv });
  const st = await state(env, kv, UID, "msg", o);
  assert.equal(st.usedThisMonth, 1);
  assert.equal(st.purchasedBalance, 100);
  assert.equal(st.remaining, 119);
});

test("a subscription purchase writes msgTier + msgTierExp and grants no Pro", async () => {
  let written = null, granted = false;
  const deps = {
    getEntitlement: async () => null,
    writeEntitlement: async (_e, _u, patch) => { written = patch; return patch; },
    grantPro: async () => { granted = true; return {}; },
  };
  const r = await fulfilPurchase(env, UID, "msgtier:small", 1, "razorpay", deps);
  assert.equal(r.ok, true);
  assert.equal(r.msgTier, "small");
  assert.equal(written.msgTier, "small");
  assert.ok(written.msgTierExp > Date.now());
  assert.equal(granted, false, "Clinic Messaging buys an allowance, not a plan");
});

test("a subscription purchase may upgrade and extend, but never downgrade or shorten", () => {
  const now = AUG, month = 30 * 86400000;
  const fresh = msgPurchasePatch(null, "msgtier:small", 1, now);
  assert.equal(fresh.msgTier, "small");
  assert.equal(fresh.msgTierExp, now + month);
  // Renewal extends from the existing expiry, not from today.
  const rec = { msgTier: "small", msgTierExp: now + month };
  assert.equal(msgPurchasePatch(rec, "msgtier:small", 1, now).msgTierExp, now + 2 * month);
  // Upgrade wins; a replayed small purchase must not knock a live big tier back down.
  assert.equal(msgPurchasePatch(rec, "msgtier:big", 1, now).msgTier, "big");
  assert.equal(msgPurchasePatch({ msgTier: "big", msgTierExp: now + month }, "msgtier:small", 1, now).msgTier, "big");
  assert.equal(msgPurchasePatch(null, "pack:msg.100", 0, now), null);
});

// ---------------- copy ----------------
test("the owner-approved Clinic Messaging copy is what the refusal carries", () => {
  const c = quotaCopy("msg");
  assert.equal(c.headline, "Patients who know where they stand do not crowd your desk.");
  assert.equal(c.price, "₹5 a patient. Less than the chai they drink while they wait.");
  assert.equal(c.alert, "Your queue has gone quiet for patients. Keep them informed.");
  assert.equal(c.expiry, "100 patients. Never expires.");
  assert.ok(c.lines.includes("Improves follow-up. Builds clinic trust. Runs itself."));
  assert.ok(c.lines.includes("A clinic that keeps people informed is the clinic they recommend."));
  assert.ok(c.lines.includes("Fewer no-shows. A calmer waiting room. A front desk that answers fewer calls."));
  const tiers = msgTiers(env);
  assert.equal(tiers.small.line, "For a clinic seeing up to 6 patients a day.");
  assert.equal(tiers.big.line, "For a busy OPD, up to 24 patients a day.");
});

test("the copy invents no statistic, no testimonial and no countdown, and carries no em-dash", () => {
  const c = quotaCopy("msg");
  const all = [c.headline, c.price, c.alert, c.expiry, ...c.lines, msgTiers(env).small.line, msgTiers(env).big.line].join(" | ");
  assert.ok(!/—/.test(all), "no em-dash in app-facing copy");
  assert.ok(!/\d+\s?%|\bper cent|\bpercent/i.test(all), "no percentage claim");
  assert.ok(!/\b(study|studies|research|survey|proven|clinically proven)\b/i.test(all), "no invented evidence");
  assert.ok(!/\b(said|says|told us|doctors love|rated)\b/i.test(all), "no testimonial");
  assert.ok(!/\b(hurry|today only|expires in|last chance|limited time)\b/i.test(all), "no countdown or urgency");
  assert.ok(!/readmis|mortalit|complication|recovery rate/i.test(all), "no clinical outcome claim");
  // The only numbers allowed are the price and the stated per-day capacities the owner signed off.
  assert.ok(!/\b\d+% fewer|\b\d+ fewer no-?shows/i.test(all));
});

test("every price on the ladder carries exactly one everyday-spend comparison, edited in one place", () => {
  assert.deepEqual(Object.keys(COMPARE).sort(), ["care.100", "care.25", "msg.100", "msg.big", "msg.small", "scribe.250", "scribe.50"]);
  assert.equal(COMPARE["msg.small"], "Less than a day of tea and snacks for the waiting room.");
  assert.equal(COMPARE["msg.big"], "Less than a week of a receptionist's salary.");
  assert.equal(COMPARE["msg.100"], "Less than dinner for two.");
  assert.equal(COMPARE["care.25"], "Less than one family dinner out.");
  assert.equal(COMPARE["care.100"], "Less than a new phone.");
  assert.equal(COMPARE["scribe.50"], "Less than one hour of a locum.");
  assert.equal(COMPARE["scribe.250"], "Less than a weekend away.");
  for (const [k, line] of Object.entries(COMPARE)) {
    assert.equal(line.split(".").filter((x) => x.trim()).length, 1, k + " must be ONE sentence");
    assert.ok(!/—/.test(line), k + " must carry no em-dash");
    assert.ok(!/\d/.test(line), k + " must carry no number of its own");
  }
  assert.equal(compareLine("nothing.here"), "", "a price with no line renders nothing rather than an invented one");
  // The packs carry their line on the wire, which is what the sheet renders.
  const packs = quotaPacks(env);
  for (const k of ["msg.100", "care.25", "care.100", "scribe.50", "scribe.250"]) assert.equal(packs[k].compare, COMPARE[k]);
  const r = quotaRefusal(env, "msg");
  assert.equal(r.tiers.find((t) => t.key === "small").compare, COMPARE["msg.small"]);
  assert.equal(r.tiers.find((t) => t.key === "big").compare, COMPARE["msg.big"]);
  // "One patient who comes back pays for the pack." stays on the care deck.
  assert.ok(quotaCopy("care").price.includes("One patient who comes back pays for the pack."));
});

test("the refusal offers both subscriptions and the pack, and only the msg ones", () => {
  const r = quotaRefusal(env, "msg");
  assert.equal(r.error, "quota-exhausted");
  assert.equal(r.feature, "msg");
  assert.deepEqual(r.packs.map((p) => p.key), ["msg.100"]);
  assert.deepEqual(r.tiers.map((t) => t.key), ["small", "big"]);
  assert.equal(quotaRefusal(env, "care").tiers, undefined, "only Clinic Messaging offers subscriptions");
});

// ---------------- anti-steering ----------------
test("the iOS bundle can never render a web price for Clinic Messaging", () => {
  const pw = src("pro-paywall.js");
  // The sheet computes ONE gate and uses it for both the packs and the subscription tiers.
  assert.ok(/var webOk = plat\(\) !== "ios";/.test(pw));
  assert.ok(/webOk && t\.webAmount > 0 && t\.webAmount < t\.amount/.test(pw), "the tier cards must go through the same gate");
  assert.ok(/webOk && p\.webAmount > 0 && p\.webAmount < p\.amount/.test(pw), "the pack cards must go through the same gate");
  // No purchase URL or hard-coded web price anywhere in what ships.
  assert.ok(!/stewardmd\.in\/billing/.test(pw));
  for (const paise of ["65900", "264900", "54900"]) assert.ok(!pw.includes(paise), "no hard-coded web price in the bundle");
});

test("the outbound web-price nudge exists for the queue pack and stays server-side", () => {
  // webUpsellSms lives in functions/, which scripts/build-www.sh excludes from the app bundle.
  const build = src("scripts/build-www.sh");
  assert.ok(!/\bcp -R? ?functions\b/.test(build), "functions/ must not be copied into www/");
  // It may be NAMED in the bundle's anti-steering comment; what must not happen is the bundle importing it.
  assert.ok(!/import[^\n]*_quota\.js/.test(src("pro-paywall.js")), "the client never imports the server meter");
});

// ---------------- the one real spend point ----------------
test("the queue charges at the send sites and nowhere else", () => {
  const notify = src("functions/_queue_notify.js");
  assert.equal((notify.match(/await chargeVisit\(/g) || []).length, 2, "exactly the two outbound send sites charge");
  assert.equal((notify.match(/consumeVisit\(/g) || []).length, 1);
  // The charge is per VISIT (the ticket id), never per message.
  assert.ok(/consumeVisit\(env, kv, uid, ticket\.id/.test(notify));
  // Nothing else in functions/ deducts msg units.
  const engine = src("functions/_queue_engine.js");
  assert.ok(!/consumeVisit|"msg"/.test(engine), "the engine must not meter; the send sites do");
});

test("an exhausted allowance pauses the messages without marking the stage, so a top-up resumes them", () => {
  const notify = src("functions/_queue_notify.js");
  // The refusal returns BEFORE the stage/bool marking block, exactly like the no-phone case.
  const at = notify.indexOf('return { skipped: true, reason: "quota-exhausted" };', notify.indexOf("export async function notifyTicket"));
  const marks = notify.indexOf("patch.n_stage = stageNum");
  assert.ok(at > 0 && at < marks, "the skip must precede the stage marking");
});

test("the queue keeps running when the messages stop: the refusal rides along on an ordinary 200", () => {
  const route = src("functions/api/queue/[[path]].js");
  assert.ok(/msgRefusalIfOut\(env, sess\.doctorUid,/.test(route), "the route reads the entitlement so a subscriber is not told they are out");
  const at = route.indexOf("msgRefusalIfOut(env, sess.doctorUid,");
  assert.ok(!/402/.test(route.slice(at - 600, at + 600)), "the queue must never refuse itself over a messaging balance");
  assert.ok(/catch \(e\) \{ msgQuota = null; \}/.test(route), "a failed balance lookup never breaks the queue view");
  const pw = src("pro-paywall.js");
  assert.ok(/d\.msgQuota && d\.msgQuota\.error === "quota-exhausted"/.test(pw), "the client opens the sheet off it");
});

// ---------------- WhatsApp first, SMS fallback ----------------
test("queue messages try WhatsApp first and fall back to SMS", () => {
  const notify = src("functions/_queue_notify.js");
  assert.ok(/QUEUE_MSG_CHANNEL \|\| env\.FOLLOWCARE_MSG_CHANNEL\)\) \|\| "whatsapp"/.test(notify), "WhatsApp is the queue default");
  assert.ok(/if \(queueChannel\(env\) === "whatsapp" && waConfigured\(env\)\)/.test(notify));
  assert.ok(/waFellBack: true/.test(notify), "a failed WhatsApp send still reaches the patient by SMS");
});

// ---------------- the flag ----------------
test("everything is inert unless QUOTA_METERS_ON is 1", () => {
  const notify = src("functions/_queue_notify.js");
  assert.ok(/if \(!quotaOn\(env\)\) return true;/.test(notify), "the meter is the first thing the charge checks");
  const billing = src("functions/api/billing/[[path]].js");
  assert.ok(/if \(quotaOn\(env\) && uid\)/.test(billing), "status reports the balances only behind the flag");
});
