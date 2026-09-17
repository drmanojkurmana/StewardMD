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
  quotaRefusal, quotaCopy, consumeScribeSession, quotaOn, webUpsellSms,
} from "../functions/_quota.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const src = (rel) => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");
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
  assert.equal(r.copy.price, "₹100 per patient, or ₹90 in the 100 pack. One patient who comes back pays for the pack.");
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

/* This sentence tells a clinician they neglected patients. A wrong number is worse than no sentence,
   so anything that is not a real positive integer must produce NO sentence rather than a guess.
   NOTHING computes unheardCount today (2026-09-18 decision note) so it never renders in production. */
test("only a real positive integer renders the unheard-patients line", () => {
  const line = (v) => quotaCopy("care", { unheardCount: v }).lines.join(" | ");
  for (const v of [undefined, null, 0, -1, -3, "", " ", "abc", "12 or so", "5", NaN, Infinity, -Infinity, 2.7, 0.4, {}, [], true, "7 patients"]) {
    assert.ok(!/have not heard from you/.test(line(v)), "must not render for: " + String(v));
  }
  for (const v of [1, 7, 250]) {
    assert.match(line(v), /have not heard from you/, "must render for: " + v);
  }
  const l = quotaCopy("care", { unheardCount: 1 }).lines;
  assert.equal(l[0], "1 patients discharged this month have not heard from you.");
  assert.equal(l.filter((x) => /have not heard from you/.test(x)).length, 1, "rendered exactly once");
});

test("the refusal body carries the count as a bare number and no patient identifier", () => {
  const body = quotaRefusal({}, "care", { unheardCount: 4, doctorUid: "fbuid-123" });
  assert.equal(body.copy.lines[0], "4 patients discharged this month have not heard from you.");
  const json = JSON.stringify(body);
  // Nothing that could identify a patient (or leak the doctor's uid) may ride the payload.
  /* Phone/mobile are matched as JSON FIELD NAMES, not as the word: the everyday-spend comparison
     line on the 100 pack is "Less than a new phone.", which is copy, not a patient identifier. */
  for (const leak of [/fbuid-123/, /\bmrn\b/i, /episodeId/, /patientKeyHash/, /"(phone|mobile)[A-Za-z]*"\s*:/i, /encMobile/i, /\b\d{10}\b/]) {
    assert.ok(!leak.test(json), "refusal payload leaks: " + leak);
  }
  assert.deepEqual(Object.keys(body).sort(), ["copy", "error", "feature", "packs", "remaining"]);
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

// ---------------- one credit = one bounded episode ----------------

/* Owner-decided 2026-09-18: a credit buys an EPISODE (7-day check-in course, plus a day-3 and a day-7
   MAiTRI call only if the patient has not responded, plus alerts, feedback and in-app messaging), and
   the episode is charged ONCE at enrol. Charging again for a call inside it is double-charging. */
test("an episode deducts once at enrol; the day-3 and day-7 calls inside it never deduct again", async () => {
  const kv = fakeKv();
  const at = (now) => ({ role: "physician", now });
  const day0 = Date.parse("2026-09-02T09:00:00Z");

  // enrol: the one and only deduction for this episode
  const enrol = await consume(env, kv, UID, "care", at(day0));
  assert.equal(enrol.ok, true);
  assert.equal((await state(env, kv, UID, "care", at(day0))).usedThisMonth, 1);

  /* The two in-episode calls are placed by the scheduler / the doctor-initiated voice route, and
     NEITHER touches the meter. Proven structurally rather than by re-running the meter: a KV spy
     cannot see a call that never happens, so assert the call sites instead. */
  const before = new Map(kv.m);
  const route = src("functions/api/followcare/[[path]].js");
  const sites = (route.match(/await careCredit\(/g) || []).length;
  assert.equal(sites, 1, "exactly one care deduction site must exist in the FollowCare router");
  assert.ok(/seg === "enroll"[\s\S]{0,1400}?await careCredit\(/.test(route), "the one deduction site is enroll");
  assert.ok(!/isVoice && seg === "call"[\s\S]{0,900}?await careCredit\(/.test(route),
    "the doctor-initiated MAiTRI call must NOT deduct: it belongs to an episode already paid for");
  const dispatch = src("functions/_followcare_dispatch.js");
  assert.ok(!/_quota|consume\(/.test(dispatch), "the scheduler dispatch path must never import or call the meter");

  // a second and a third call inside the same episode leave the wallet exactly where enrol left it
  assert.deepEqual([...kv.m], [...before], "no meter write happened for the in-episode calls");
  assert.equal((await state(env, kv, UID, "care", at(day0))).usedThisMonth, 1, "still one credit spent");

  // a NEW episode for the same patient next month is a new credit, on the new month's counter
  const oct = Date.parse("2026-10-02T09:00:00Z");
  assert.equal((await state(env, kv, UID, "care", at(oct))).usedThisMonth, 0, "the month counter reset");
  const again = await consume(env, kv, UID, "care", at(oct));
  assert.equal(again.ok, true);
  assert.equal((await state(env, kv, UID, "care", at(oct))).usedThisMonth, 1, "next month's episode deducts");
  assert.equal((await state(env, kv, UID, "care", at(day0))).usedThisMonth, 1, "September is untouched");
});

// ---------------- prices (App Store Connect verified 2026-09-18) + web pricing ----------------
test("care packs are ₹2,499 / ₹8,999 in the store and ₹2,199 / ₹7,999 on the web; Scribe unchanged", () => {
  const p = quotaPacks({});
  assert.equal(p["care.25"].amount, 249900);
  assert.equal(p["care.100"].amount, 899900);
  assert.equal(p["care.25"].webAmount, 219900);
  assert.equal(p["care.100"].webAmount, 799900);
  assert.equal(p["scribe.50"].amount, 99900);
  assert.equal(p["scribe.250"].amount, 399900);
  // Scribe has no web price, so nothing can advertise a discount that does not exist.
  assert.equal(p["scribe.50"].webAmount, undefined);
  assert.equal(p["scribe.250"].webAmount, undefined);
  // Per-patient figures are derived from the amount so they cannot drift out of step with it.
  assert.equal(p["care.25"].perUnit, 100, "₹100 per patient");
  assert.equal(p["care.100"].perUnit, 90, "₹90 per patient in the bigger pack");
  for (const k of Object.keys(p)) assert.ok(!p[k].webAmount || p[k].webAmount < p[k].amount, "a web price is never dearer: " + k);
});

/* ANTI-STEERING. The iOS app is mid-submission in the India storefront, where a "cheaper on the web"
   hint on any screen is a straight rejection. Two independent guarantees, both asserted here:
   (1) the outbound copy lives in functions/, which scripts/build-www.sh excludes from the app bundle,
   (2) the sheet renderer gates every web price on plat() !== "ios". */
test("no web price and no stewardmd.in purchase URL can render inside the iOS app", () => {
  // (1) the web-price copy is server-side only and never reaches www/
  const build = src("scripts/build-www.sh");
  assert.match(build, /functions/, "build-www.sh must account for functions/");
  const nudge = webUpsellSms({}, "care.25");
  assert.match(nudge.text, /stewardmd\.in/);
  assert.match(nudge.url, /^https:\/\/stewardmd\.in\//);
  assert.equal(nudge.amount, 219900);
  assert.equal(webUpsellSms({}, "scribe.50"), null, "no web nudge for a pack with no web price");
  assert.equal(webUpsellSms({}, "nope"), null);

  // (2) nothing the iOS sheet is fed can carry the pitch: the refusal copy names no web price or URL
  const body = quotaRefusal({}, "care");
  const rendered = [body.copy.headline, body.copy.price, body.copy.expiry].concat(body.copy.lines).join(" ");
  for (const banned of [/stewardmd\.in/i, /on the web/i, /cheaper (on|at|via|in your browser)/i, /2,199/, /7,999/, /website/i, /browser/i]) {
    assert.ok(!banned.test(rendered), "steering copy present in the in-app sheet: " + banned);
  }

  // (3) the renderer itself: every web price is behind plat() !== "ios", and the bundle has no buy URL
  const paywall = src("pro-paywall.js");
  assert.match(paywall, /var webOk = plat\(\) !== "ios";/, "the web price must be gated on the platform");
  assert.ok(/webOk && p\.webAmount/.test(paywall), "webAmount may only be read through that gate");
  assert.ok(!/stewardmd\.in\/billing/.test(paywall), "no purchase URL may ship in the app bundle");
});

// ---------------- pack purchase: BOTH payment paths ----------------
test("pack prices and product ids match App Store Connect", () => {
  const p = quotaPacks(env);
  assert.equal(p["care.25"].amount, 249900);
  assert.equal(p["care.100"].amount, 899900);
  assert.equal(p["scribe.50"].amount, 99900);
  assert.equal(p["scribe.250"].amount, 399900);
  assert.equal(p["care.25"].product, "in.stewardmd.care.25");
  assert.equal(p["scribe.250"].product, "in.stewardmd.scribe.250");
});

test("Razorpay path: selectAmount -> captured note -> fulfilPurchase credits the pack", async () => {
  const kv = fakeKv();
  const sel = selectAmount(env, { quotaPack: "care.100" });
  assert.equal(sel.amount, 899900);
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
