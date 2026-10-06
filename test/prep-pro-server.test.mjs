/* test/prep-pro-server.test.mjs - PrepNucleus Pro server: quote, entitlement, referral, win-back, launch.
 * Real _prep_pro.js logic over an in-memory Firestore that honours the updateTime / exists guards
 * (so the retry + atomic referral credit paths are exercised). The order route test drives the real
 * /api/billing/razorpay/order handler with identify + the store mocked and fetch stubbed. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import * as FS from "../functions/_fbfirestore.js";
import * as realAuth from "../functions/_fbauth.js";
import * as P from "../functions/_prep_pro.js";

const DAY = 86400000, HOUR = 3600000;
const NOW = Date.parse("2026-10-06T10:00:00Z");
const ENV = {};

function fakeStore(seed) {
  const docs = new Map(); let tick = 0; const commits = [];
  const put = (path, fields) => docs.set(FS.fsDocName(ENV, path), { fields, updateTime: "t" + (++tick) });
  Object.keys(seed || {}).forEach((k) => put(k, seed[k]));
  const deps = {
    claims: {},
    fsGet: async (env, path) => { const d = docs.get(FS.fsDocName(env, path)); return d ? { fields: Object.assign({}, d.fields), updateTime: d.updateTime } : null; },
    fsCommit: async (env, writes) => {
      for (const w of writes) {   // all-or-nothing: check every guard first
        const cur = docs.get(w.update.name), g = w.currentDocument || {};
        if (g.exists === false && cur) throw { code: "precondition" };
        if (g.updateTime && (!cur || cur.updateTime !== g.updateTime)) throw { code: "precondition" };
      }
      for (const w of writes) {
        const cur = docs.get(w.update.name);
        docs.set(w.update.name, { fields: Object.assign({}, cur && cur.fields, FS.decodeFields(w.update.fields)), updateTime: "t" + (++tick) });
      }
      commits.push(writes.length);
      return { ok: true };
    },
    getUserClaims: async (env, uid) => deps.claims[uid] || {},
  };
  return { deps, commits, rec: (uid) => { const d = docs.get(FS.fsDocName(ENV, "entitlements/" + uid)); return d ? d.fields : {}; } };
}
const dir = (smd, uid) => ({ ["doctorDirectory/" + smd]: { uid } });

const LAUNCH_END = Date.parse("2027-03-31T23:59:00+05:30");
const AFTER = LAUNCH_END + 1;

test("quote: launch price before the end date, list after it (injected clock)", async () => {
  const s = fakeStore();
  const q = await P.quoteFor(ENV, "u1", s.deps, NOW);
  assert.deepEqual([q.plan, q.listPaise, q.firstYearPaise, q.renewalPaise, q.priceReason, q.offPct, q.saveRupees, q.launchEndsAt, q.firstYear],
    ["year", 599900, 149900, 599900, "launch", 75, 4500, LAUNCH_END, true]);
  assert.equal(q.productId, "in.stewardmd.prep.annual");
  assert.equal(q.store.playOfferId, "prep-launch-1499");
  assert.equal(q.referralCreditDays, 30);
  const a = await P.quoteFor(ENV, "u1", s.deps, AFTER);
  assert.deepEqual([a.firstYearPaise, a.priceReason, a.offPct, a.launchEndsAt], [599900, "intro", 0, undefined]);
  const custom = P.prepQuote(P.prepCfg({ PREP_LAUNCH_ENDS: "2026-10-01T00:00:00Z", PREP_INTRO_AFTER_LAUNCH: "299900" }), {}, NOW);
  assert.deepEqual([custom.firstYearPaise, custom.priceReason], [299900, "intro"]);
});

test("quote: student 20% is off the LIST price and never stacks on launch", async () => {
  const s = fakeStore();
  s.deps.claims.u1 = { traineeVerified: true };
  const before = await P.quoteFor(ENV, "u1", s.deps, NOW);
  assert.deepEqual([before.firstYearPaise, before.priceReason, before.studentVerified], [149900, "launch", true], "launch 1,499 beats student 4,799; never 1,199");
  const after = await P.quoteFor(ENV, "u1", s.deps, AFTER);
  assert.deepEqual([after.firstYearPaise, after.priceReason, after.offPct], [479920, "student", 20]);
  s.deps.claims.u1 = { verified: true };   // a registered doctor is not a student
  assert.equal((await P.quoteFor(ENV, "u1", s.deps, AFTER)).priceReason, "intro");
});

test("quote: renewal (already paid once) is list, or the student price; never launch or win-back", () => {
  const cfg = P.prepCfg({});
  const r = P.prepQuote(cfg, { rec: { prepFirstPaidAt: 1 }, offerExpiresAt: NOW + HOUR }, NOW);
  assert.deepEqual([r.firstYearPaise, r.priceReason, r.firstYear], [599900, "renewal", false]);
  const rs = P.prepQuote(cfg, { rec: { prepFirstPaidAt: 1 }, studentVerified: true }, NOW);
  assert.deepEqual([rs.firstYearPaise, rs.priceReason], [479920, "student"]);
});

test("quote: every combination picks the single lowest price, never a stacked one", () => {
  const cfg = P.prepCfg({}), o = NOW + HOUR;
  const cases = [
    [{}, NOW, 149900, "launch"],
    [{ studentVerified: true }, NOW, 149900, "launch"],
    [{ offerExpiresAt: o }, NOW, 99900, "winback"],
    [{ offerExpiresAt: o, studentVerified: true }, NOW, 99900, "winback"],
    [{}, AFTER, 599900, "intro"],
    [{ studentVerified: true }, AFTER, 479920, "student"],
    [{ offerExpiresAt: o, studentVerified: true }, AFTER, 99900, "winback"],
  ];
  for (const [opts, now, paise, reason] of cases) {
    const q = P.prepQuote(cfg, opts, now);
    assert.deepEqual([q.firstYearPaise, q.priceReason], [paise, reason], JSON.stringify(opts));
    const singles = [149900, 599900, 479920, 99900];
    assert.ok(singles.includes(q.firstYearPaise), "a stacked price would not be one of the single prices");
  }
  const big = P.prepQuote(P.prepCfg({ PREP_STUDENT_DISCOUNT_PCT: "90" }), { studentVerified: true, offerExpiresAt: o }, NOW);
  assert.deepEqual([big.firstYearPaise, big.priceReason], [59990, "student"], "a config change can make student the best");
});

test("config: env overrides discount, referral days and list price", () => {
  const env = { PREP_STUDENT_DISCOUNT_PCT: "30", PREP_REFERRAL_DAYS: "45", PREP_LIST_PRICE: "500000" };
  const q = P.prepQuote(P.prepCfg(env), { studentVerified: true }, AFTER);
  assert.deepEqual([q.listPaise, q.firstYearPaise, q.referralCreditDays, q.offPct], [500000, 350000, 45, 30]);
});

test("grant then renewal extends expiry (never resets); replay of one payment is a no-op", async () => {
  const s = fakeStore();
  const a = await P.fulfilPrep(ENV, "u1", "prep:year:launch", { ref: "rzp:o1", source: "razorpay", now: NOW }, s.deps);
  assert.equal(a.ok, true); assert.equal(a.prepPro.until, NOW + 365 * DAY);
  const r = await P.fulfilPrep(ENV, "u1", "prep:year:launch", { ref: "rzp:o1", now: NOW }, s.deps);
  assert.equal(r.already, true); assert.equal(s.rec("u1").prepProExp, NOW + 365 * DAY);
  const b = await P.fulfilPrep(ENV, "u1", "prep:year:renewal", { ref: "rzp:o2", now: NOW + 10 * DAY }, s.deps);
  assert.equal(b.prepPro.until, NOW + 730 * DAY, "stacks on the remaining time");
  assert.deepEqual(P.prepProView(s.rec("u1"), NOW), { active: true, until: NOW + 730 * DAY, source: "razorpay", autoRenews: false, manageUrl: null });
  assert.deepEqual(P.prepProView({}, NOW), { active: false, until: null, source: null, autoRenews: false, manageUrl: null });
  assert.equal((await P.fulfilPrep(ENV, "u1", "pro:monthly", { ref: "x" }, s.deps)).ok, false);
  assert.equal((await P.fulfilPrep(ENV, "u1", "prep:year", {}, s.deps)).reason, "ref-required");
});

test("referral record: unknown, self, already paid, once per referee", async () => {
  const s = fakeStore(Object.assign(dir("SMD-AAA111", "ref1"), dir("SMD-BBB222", "ref2"), dir("SMD-ME0001", "u1")));
  assert.equal((await P.recordReferral(ENV, "u1", "SMD-ZZZ999", s.deps)).error, "unknown-code");
  assert.equal((await P.recordReferral(ENV, "u1", "", s.deps)).error, "code-required");
  assert.equal((await P.recordReferral(ENV, "u1", "smd-me0001", s.deps)).error, "self-referral");
  assert.deepEqual(await P.recordReferral(ENV, "u1", "aaa111", s.deps), { ok: true }, "bare 6-char id normalises");
  assert.equal(s.rec("u1").prepReferrer, "ref1");
  assert.equal((await P.recordReferral(ENV, "u1", "SMD-AAA111", s.deps)).already, true);
  assert.equal((await P.recordReferral(ENV, "u1", "SMD-BBB222", s.deps)).error, "already-referred");
  await P.fulfilPrep(ENV, "u2", "prep:year", { ref: "p", now: NOW }, s.deps);
  assert.equal((await P.recordReferral(ENV, "u2", "SMD-AAA111", s.deps)).error, "already-paid");
});

test("referral credit: once, atomically, on the first paid purchase only; idempotent on retries", async () => {
  const s = fakeStore(dir("SMD-AAA111", "ref1"));
  await P.recordReferral(ENV, "u1", "SMD-AAA111", s.deps);
  const f = await P.fulfilPrep(ENV, "u1", "prep:year", { ref: "rzp:o1", now: NOW }, s.deps);
  assert.deepEqual(f.referralCredit, { referrer: "ref1", days: 30, until: NOW + 30 * DAY });
  assert.equal(s.commits[s.commits.length - 1], 2, "referee + referrer in ONE commit");
  assert.deepEqual(P.prepProView(s.rec("ref1"), NOW), { active: true, until: NOW + 30 * DAY, source: "referral", autoRenews: false, manageUrl: null });
  // webhook retry (payment.captured then order.paid for the same order)
  assert.equal((await P.fulfilPrep(ENV, "u1", "prep:year", { ref: "rzp:o1", now: NOW }, s.deps)).already, true);
  // second purchase (renewal): no new credit
  const g = await P.fulfilPrep(ENV, "u1", "prep:year:renewal", { ref: "rzp:o2", now: NOW + DAY }, s.deps);
  assert.equal(g.referralCredit, null);
  assert.equal(s.rec("ref1").prepProExp, NOW + 30 * DAY);
});

test("referral credit survives a lost race: concurrent deliveries credit once", async () => {
  const s = fakeStore(dir("SMD-AAA111", "ref1"));
  await P.recordReferral(ENV, "u1", "SMD-AAA111", s.deps);
  const [a, b] = await Promise.all([
    P.fulfilPrep(ENV, "u1", "prep:year", { ref: "rzp:o1", now: NOW }, s.deps),
    P.fulfilPrep(ENV, "u1", "prep:year", { ref: "rzp:o1", now: NOW }, s.deps),
  ]);
  assert.equal([a, b].filter((x) => x.referralCredit).length, 1);
  assert.equal(s.rec("u1").prepProExp, NOW + 365 * DAY);
  assert.equal(s.rec("ref1").prepProExp, NOW + 30 * DAY);
});

test("win-back: eligible only on a later visit (>= 1 h after the abandoned checkout)", async () => {
  const s = fakeStore();
  assert.deepEqual(await P.getOffer(ENV, "u1", s.deps, NOW), { offer: null }, "no checkout, no offer");
  await P.markCheckout(ENV, "u1", s.deps, NOW);
  assert.deepEqual(await P.getOffer(ENV, "u1", s.deps, NOW + 10 * 60000), { offer: null }, "same visit");
  assert.equal(s.rec("u1").prepOfferShownAt, undefined, "not shown, clock not started");
  const o = await P.getOffer(ENV, "u1", s.deps, NOW + HOUR);
  assert.deepEqual(o.offer, { kind: "winback", finalPaise: 99900, basePaise: 149900, listPaise: 599900, saveRupees: 500, expiresAt: NOW + HOUR + 48 * HOUR,
    productId: "in.stewardmd.prep.annual", iosOfferId: "prep_winback_999", playOfferId: "prep-winback-999" });
  const again = await P.getOffer(ENV, "u1", s.deps, NOW + 5 * HOUR);
  assert.equal(again.offer.expiresAt, NOW + 49 * HOUR, "window starts at FIRST shown");
  const q = await P.quoteFor(ENV, "u1", s.deps, NOW + 5 * HOUR);
  assert.deepEqual([q.priceReason, q.firstYearPaise, q.offerExpiresAt, q.renewalPaise, q.store.iosOfferId], ["winback", 99900, NOW + 49 * HOUR, 599900, "prep_winback_999"]);
});

test("win-back: 48 h expiry, never again; dismiss ends it; one per account ever", async () => {
  const s = fakeStore();
  await P.markCheckout(ENV, "u1", s.deps, NOW);
  await P.getOffer(ENV, "u1", s.deps, NOW + HOUR);
  assert.deepEqual(await P.getOffer(ENV, "u1", s.deps, NOW + 49 * HOUR), { offer: null }, "expired");
  await P.markCheckout(ENV, "u1", s.deps, NOW + 50 * HOUR);   // a new abandoned checkout
  assert.deepEqual(await P.getOffer(ENV, "u1", s.deps, NOW + 60 * HOUR), { offer: null }, "never re-offered");

  const t = fakeStore();
  await P.markCheckout(ENV, "u2", t.deps, NOW);
  assert.ok((await P.getOffer(ENV, "u2", t.deps, NOW + 2 * HOUR)).offer);
  assert.deepEqual(await P.dismissOffer(ENV, "u2", t.deps), { ok: true });
  assert.deepEqual(await P.getOffer(ENV, "u2", t.deps, NOW + 3 * HOUR), { offer: null });
  assert.equal((await P.quoteFor(ENV, "u2", t.deps, NOW + 3 * HOUR)).priceReason, "launch");

  const u = fakeStore();   // used: paid with the offer, then a new abandon never revives it
  await P.markCheckout(ENV, "u3", u.deps, NOW);
  await P.getOffer(ENV, "u3", u.deps, NOW + 2 * HOUR);
  await P.fulfilPrep(ENV, "u3", "prep:year:winback", { ref: "o", now: NOW + 3 * HOUR }, u.deps);
  assert.deepEqual(await P.getOffer(ENV, "u3", u.deps, NOW + 30 * DAY), { offer: null });
});

test("cancel anytime: store subscriptions return the manage link; Razorpay is one-time (autoRenews false)", async () => {
  const s = fakeStore();
  await P.fulfilPrep(ENV, "i1", "prep:year", { ref: "iap:a", source: "iap", platform: "ios", now: NOW }, s.deps);
  const v = P.prepProView(s.rec("i1"), NOW);
  assert.deepEqual([v.source, v.autoRenews, v.manageUrl], ["iap", true, "https://apps.apple.com/account/subscriptions"]);
  await P.fulfilPrep(ENV, "a1", "prep:year", { ref: "iap:b", source: "iap", platform: "android", now: NOW }, s.deps);
  assert.equal(P.prepProView(s.rec("a1"), NOW).manageUrl, "https://play.google.com/store/account/subscriptions?sku=in.stewardmd.prep.annual&package=in.stewardmd.app");
});

test("IAP product ids map to prep plan keys", () => {
  assert.equal(P.prepPlanKeyForProduct({}, "in.stewardmd.prep.annual"), "prep:year");
  assert.equal(P.prepPlanKeyForProduct({}, "in.stewardmd.pro.annual"), null);
});

test("order route: amount is the server quote; client amount/price/plan fields are ignored", async () => {
  const s = fakeStore();
  s.deps.claims.u1 = { traineeVerified: true };
  mock.module("../functions/_fbauth.js", { namedExports: Object.assign({}, realAuth, { identify: async () => "fb:u1" }) });
  mock.module("../functions/_prep_pro.js", { namedExports: Object.assign({}, P, {
    quoteFor: (env, uid) => P.quoteFor(env, uid, s.deps, AFTER),
    markCheckout: (env, uid) => P.markCheckout(env, uid, s.deps, AFTER),
  }) });
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: "order_1", amount: JSON.parse(init.body).amount, currency: "INR" }), { status: 200 }); };
  try {
    const { onRequest } = await import("../functions/api/billing/[[path]].js?prep-route");
    const req = new Request("https://stewardmd.in/api/billing/razorpay/order", { method: "POST", body: JSON.stringify({ prepPlan: "year", amount: 100, firstYearPaise: 100, priceReason: "winback", plan: "annual", tier: "pro" }) });
    const res = await onRequest({ request: req, env: { RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "test-only" } });
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.amount, 479920, "Rs 5,999 less the 20% student discount (after launch), computed server-side");
    assert.equal(sent[0].body.notes.plan, "prep:year:student");
    assert.equal(out.plan, "prep:year:student");
    assert.equal(s.rec("u1").prepCheckoutAt, AFTER, "pending checkout recorded");
  } finally { globalThis.fetch = realFetch; }
});
