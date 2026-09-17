/* StewardMD — per-patient quota meters (FollowCare/MAiTRI "care" credits + MaiK Scribe consults).
 *
 * ONE CREDIT = ONE PATIENT EPISODE (owner-decided 2026-09-18). An episode is BOUNDED, not open-ended:
 *   day 0  the 7-day FollowCare SMS / WhatsApp check-in course
 *   day 3  a MAiTRI call ONLY if the patient has not responded to the check-in
 *   day 7  a MAiTRI call ONLY if there is still no response
 * and, in the same credit, feedback capture, the ambulance alert by WhatsApp/SMS, the doctor-app alert,
 * and in-app patient messaging. So at most TWO calls per episode, both conditional on non-response.
 *
 * THE EPISODE IS CHARGED ONCE, AT ENROL, AND NEVER AGAIN. Every later event in it - scheduler call,
 * doctor-initiated call, alert, message - belongs to an episode already paid for and must NOT deduct.
 * `followcare/enroll` is therefore the ONLY care deduction point in the codebase; test/quota-meters
 * asserts that, because a second deduction inside one episode is double-charging a doctor.
 *
 * COST (worst case per episode): SMS ₹10 + up to two calls at ₹10 + ~₹2 of alerts = ~₹32; ~₹19 typical.
 * A Scribe consult costs ₹3-5. Both are real rupees per use, so they are metered rather than "unlimited".
 *
 * FLAG: everything here is inert unless env QUOTA_METERS_ON === "1". With the flag off quotaOn()
 * is false, every call site skips the meter, and behaviour is byte-for-byte as before.
 *
 * MODEL
 *   included       — monthly allowance from the subscription, resets on the calendar month, does NOT
 *                    roll over. Physician / Physician Pro only: 5 care credits + 50 Scribe consults.
 *   purchasedBalance — top-up packs. NEVER expires, never resets, never decreases on purchase.
 *   spend order    — included first, then purchased (so the free allowance is never stranded).
 *
 * KEYS (KV, same convention as functions/_usage.js which uses maik:m:<id>:<YYYY-MM>):
 *   quota:<feature>:<uid>:<YYYY-MM>  -> { used }      monthly included-allowance counter (TTL ~2 months)
 *   quota:<feature>:<uid>:bal        -> { bal }       purchased balance, NO TTL (never expires)
 *
 * CONCURRENCY CEILING — read honestly: KV has no compare-and-swap, so consume() is a non-atomic
 * read-modify-write exactly like maik:u / maik:m in _usage.js and the credits ledger in _credits.js.
 * Two truly simultaneous spends by the SAME doctor can both read the same counter and one increment
 * is lost, i.e. at worst one extra unit is granted per concurrent burst. That is bounded (a doctor
 * enrolling two patients in the same millisecond) and costs us ₹10, so it is accepted rather than
 * paid for with a Durable Object. ponytail: best-effort counter; move to a per-uid Durable Object or
 * a D1 atomic UPSERT (see addDailyCostInr in _usage.js) if over-grant is ever measured in practice.
 *
 * FAIL-OPEN: no KV binding -> the meter allows the action. A doctor is never blocked from clinical
 * work because storage is missing; the money risk is smaller than the workflow risk.
 */

import { cfgPrice } from "./_billingcfg.js";

export const FEATURES = ["care", "scribe", "msg"];

export function quotaOn(env) { try { return String(env && env.QUOTA_METERS_ON) === "1"; } catch (e) { return false; } }

export function quotaKv(env) { return (env && (env.MAIK_KV || env.CASES_KV || env.GHIS_KV || env.UPDATES_KV)) || null; }

export function monthKey(now) { return new Date(now || Date.now()).toISOString().slice(0, 7); }

// Monthly included allowance by pricing role. Owner-confirmed 2026-09-18: only Physician and
// Physician Pro get any; every lower tier gets zero (whether they may use the feature AT ALL is the
// separate ROLE_GATES_ON matrix, not this file). env-overridable for comps/experiments.
export function includedFor(env, role, feature) {
  const r = String(role || "").trim().toLowerCase();
  const n = (k, d) => { const v = Number(env && env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
  // Clinic Messaging is included one tier lower than care/scribe (owner-confirmed 2026-09-18): Pro and
  // up, because the OPD queue is a Pro feature. "physicianpro" and "physician_pro" are the same thing
  // (the role list spells it with an underscore, the plan/tier key without), so both are accepted.
  if (feature === "msg") {
    const flat = r.replace(/[^a-z]/g, "");
    if (flat !== "pro" && flat !== "physician" && flat !== "physicianpro") return 0;
    return n("QUOTA_MSG_INCLUDED", 20);
  }
  if (r !== "physician" && r !== "physician_pro") return 0;
  return feature === "care" ? n("QUOTA_CARE_INCLUDED", 5) : n("QUOTA_SCRIBE_INCLUDED", 50);
}

/* ---- Clinic Messaging subscription tiers -----------------------------------------------------
 * Auto-renewable subscriptions in their OWN App Store subscription group ("Clinic Messaging"), which
 * is why a doctor can hold one ALONGSIDE a base plan instead of having to swap into it. They buy a
 * bigger MONTHLY allowance; they are not a plan tier and grant no other feature. Recorded on the
 * entitlement as msgTier / msgTierExp, deliberately the same shape as tier / tierExp.
 *
 * Each queue patient costs us about ₹0.40 x 3 to 5 messages, so ~₹2 a patient: ₹749 for 150 and
 * ₹2,999 for 600 both hold their margin. webAmount is the Razorpay price (~12% lower, funded by the
 * store fee we avoid) and is subject to the same anti-steering gate as the packs below. */
export function msgTiers(env) {
  const P = (k, d) => cfgPrice(env, k, d);
  return {
    small: { units: 150, amount: P("MSG_SMALL_MONTHLY", 74900), webAmount: P("MSG_SMALL_MONTHLY_WEB", 65900), label: "Clinic Messaging, Small", line: "For a clinic seeing up to 6 patients a day.", product: "in.stewardmd.msg.small.monthly" },
    big: { units: 600, amount: P("MSG_BIG_MONTHLY", 299900), webAmount: P("MSG_BIG_MONTHLY_WEB", 264900), label: "Clinic Messaging, Big", line: "For a busy OPD, up to 24 patients a day.", popular: true, product: "in.stewardmd.msg.big.monthly" },
  };
}
const MSG_TIER_RANK = { small: 1, big: 2 };
// "msgtier:small" -> "small". Add-ons, packs and plan tiers all return null.
export function msgTierFromPlanKey(planKey) {
  const m = /^msgtier:(small|big)$/.exec(String(planKey || "").trim().toLowerCase());
  return m ? m[1] : null;
}
// iOS product id -> selection key. "in.stewardmd.msg.small.monthly" -> "msgtier:small".
export function msgTierKeyForProduct(productId) {
  const m = /^in\.stewardmd\.msg\.(small|big)\.monthly$/.exec(String(productId || ""));
  return m ? "msgtier:" + m[1] : null;
}
// The tier that is actually live right now. An expired msgTierExp is no tier at all.
export function effectiveMsgTier(record, now) {
  const t = String((record && record.msgTier) || "").trim().toLowerCase();
  if (!MSG_TIER_RANK[t]) return null;
  const e = record && record.msgTierExp;
  if (e != null && +e <= (now || Date.now())) return null;
  return t;
}
export function msgTierUnits(env, record, now) {
  const t = effectiveMsgTier(record, now);
  return t ? (msgTiers(env)[t] || {}).units || 0 : 0;
}
/* Pure: what buying a Clinic Messaging subscription changes on the entitlement. Mirrors
 * purchasePatch() for tier/tierExp: a purchase may UPGRADE and may EXTEND, never downgrade an active
 * bigger tier nor shorten an existing expiry (a replayed or out-of-order webhook must not cost the
 * doctor what they already hold). Returns null for any key that is not a msg subscription. */
export function msgPurchasePatch(record, planKey, months, now) {
  const bought = msgTierFromPlanKey(planKey);
  if (!bought) return null;
  now = now || Date.now();
  const ms = Math.max(1, Math.round((+months || 1) * 30)) * 86400000;
  const cur = effectiveMsgTier(record, now);
  const msgTier = MSG_TIER_RANK[bought] >= (MSG_TIER_RANK[cur] || 0) ? bought : cur;
  return { msgTier, msgTierExp: Math.max(+(record && record.msgTierExp) || 0, now) + ms };
}

/* ---- Everyday-spend comparison, one line per purchasable thing (owner-approved 2026-09-18).
 * ONE sentence, no em-dash, and no number other than the price itself, so it never turns into an
 * invented statistic. Keyed here so the whole ladder is edited in one place; a key with no line
 * renders nothing rather than getting one invented for it. */
export const COMPARE = {
  "msg.small": "Less than a day of tea and snacks for the waiting room.",
  "msg.big": "Less than a week of a receptionist's salary.",
  "msg.100": "Less than dinner for two.",
  "care.25": "Less than one family dinner out.",
  "care.100": "Less than a new phone.",
  "scribe.50": "Less than one hour of a locum.",
  "scribe.250": "Less than a weekend away.",
};
export function compareLine(key) { return COMPARE[String(key || "")] || ""; }

/* ---- top-up packs (App Store Connect product ids are authoritative; see docs/IOS-IAP-PRODUCTS.md) ----
 *
 * PRICES verified live in App Store Connect 2026-09-18: care.25 ₹2,499, care.100 ₹8,999 (Scribe
 * unchanged). An episode costs us ~₹32 worst case and ~₹19 typical, so ₹100 per patient holds 55%
 * margin even for a patient who needs both calls.
 *
 * `amount` is the STORE price. `webAmount` is the web (Razorpay) price, lower because Razorpay costs
 * us ~2% against Apple's 15%: the discount is funded by the fee we save, not out of margin.
 *
 * ANTI-STEERING (compliance, not preference): the web price and any stewardmd.in purchase link must
 * NEVER be rendered inside the iOS app - no banner, no hint, no link, on any screen including the
 * top-up sheet. In the India storefront that is a straight App Store rejection, and this app is
 * mid-submission. Apple's 2021 anti-steering settlement permits telling users about other payment
 * methods OUTSIDE the app, with consent, which is why webUpsellSms() below lives in functions/ (never
 * bundled into www/ - see scripts/build-www.sh, which excludes functions/) and the client gates on
 * plat() !== "ios". Both halves are asserted by tests. */
export function quotaPacks(env) {
  const P = (k, d) => cfgPrice(env, k, d);   // live KV price override > env > default, same as plans()
  const per = (amount, units) => Math.round(amount / 100 / units);   // "₹100 per patient", derived so it cannot drift
  const pack = (o) => Object.assign(o, { perUnit: per(o.amount, o.units), compare: compareLine(o.key) });
  return {
    "care.25": pack({ key: "care.25", feature: "care", units: 25, amount: P("PACK_CARE_25", 249900), webAmount: P("PACK_CARE_25_WEB", 219900), label: "25 patient credits", product: "in.stewardmd.care.25" }),
    "care.100": pack({ key: "care.100", feature: "care", units: 100, amount: P("PACK_CARE_100", 899900), webAmount: P("PACK_CARE_100_WEB", 799900), label: "100 patient credits", product: "in.stewardmd.care.100", popular: true }),
    "scribe.50": pack({ key: "scribe.50", feature: "scribe", units: 50, amount: P("PACK_SCRIBE_50", 99900), label: "50 Scribe consults", product: "in.stewardmd.scribe.50" }),
    "scribe.250": pack({ key: "scribe.250", feature: "scribe", units: 250, amount: P("PACK_SCRIBE_250", 399900), label: "250 Scribe consults", product: "in.stewardmd.scribe.250", popular: true }),
    // Clinic Messaging queue pack. Consumable, and the balance NEVER expires - which is the whole
    // point of offering it next to a subscription: a clinic with a busy week buys once, not forever.
    "msg.100": pack({ key: "msg.100", feature: "msg", units: 100, amount: P("PACK_MSG_100", 59900), webAmount: P("PACK_MSG_100_WEB", 54900), label: "100 patients", product: "in.stewardmd.msg.100" }),
  };
}
// Selection key "pack:care.25" -> "care.25". Mirrors tokenPackFor() in _credits.js.
export function quotaPackFor(planKey) {
  const m = /^pack:((?:care|scribe|msg)\.\d+)$/.exec(String(planKey || ""));
  return m ? m[1] : null;
}
// iOS product id -> selection key. "in.stewardmd.care.25" -> "pack:care.25".
export function packKeyForProduct(productId) {
  const m = /^in\.stewardmd\.(care|scribe|msg)\.(\d+)$/.exec(String(productId || ""));
  return m ? "pack:" + m[1] + "." + m[2] : null;
}
export function packsForFeature(env, feature) {
  const all = quotaPacks(env), out = [];
  for (const k of Object.keys(all)) if (all[k].feature === feature) out.push(Object.assign({ key: k }, all[k]));
  return out;
}

// ---- KV helpers (injectable store so the money path is testable without Cloudflare) ----
const mKey = (f, uid, mon) => "quota:" + f + ":" + uid + ":" + mon;
const bKey = (f, uid) => "quota:" + f + ":" + uid + ":bal";
async function rd(kv, k) { try { return (await kv.get(k, "json")) || null; } catch (e) { return null; } }
async function wr(kv, k, v, ttl) { try { await kv.put(k, JSON.stringify(v), ttl ? { expirationTtl: ttl } : undefined); } catch (e) {} }
const MON_TTL = 60 * 60 * 24 * 70;   // ~2 months: long enough to read last month, short enough to self-clean

export async function state(env, kv, uid, feature, opts) {
  const o = opts || {};
  const included = includedFor(env, o.role, feature);
  /* The Clinic Messaging subscription stacks ON TOP of the included allowance. Both reset on the
   * calendar month and neither rolls over, so ONE monthly counter spends them in the right order by
   * construction: `used` eats the included allowance first and only then the tier's, which is exactly
   * "included, then tier allowance, then purchased". They are reported separately so a doctor can see
   * what their subscription bought. Only `msg` has tiers today; every other feature gets 0. */
  const tierUnits = feature === "msg" ? msgTierUnits(env, o, o.now) : 0;
  const monthly = included + tierUnits;
  const msgTier = feature === "msg" ? effectiveMsgTier(o, o.now) : null;
  if (!kv || !uid) return { included, tierUnits, msgTier, usedThisMonth: 0, purchasedBalance: 0, remaining: monthly, meter: false };
  const mon = monthKey(o.now);
  const m = await rd(kv, mKey(feature, uid, mon));
  const b = await rd(kv, bKey(feature, uid));
  const used = Math.max(0, (m && +m.used) || 0);
  const bal = Math.max(0, (b && +b.bal) || 0);
  return { included, tierUnits, msgTier, usedThisMonth: used, purchasedBalance: bal, remaining: Math.max(0, monthly - used) + bal, meter: true };
}

/* Spend one unit. Returns {ok:true, remaining} or {ok:false, remaining:0, reason:"quota-exhausted"}.
   Fail-open when there is no KV or no uid. */
export async function consume(env, kv, uid, feature, opts) {
  const st = await state(env, kv, uid, feature, opts);
  if (!st.meter) return { ok: true, remaining: st.remaining, reason: null, state: st };
  const n = Math.max(1, (opts && +opts.units) || 1);
  if (st.remaining < n) return { ok: false, remaining: 0, reason: "quota-exhausted", state: st };
  const mon = monthKey(opts && opts.now);
  const fromIncluded = Math.min(n, Math.max(0, st.included + (st.tierUnits || 0) - st.usedThisMonth));
  if (fromIncluded) await wr(kv, mKey(feature, uid, mon), { used: st.usedThisMonth + fromIncluded }, MON_TTL);
  const fromPurchased = n - fromIncluded;
  if (fromPurchased) await wr(kv, bKey(feature, uid), { bal: st.purchasedBalance - fromPurchased });   // no TTL: purchased credits never expire
  return { ok: true, remaining: st.remaining - n, reason: null, state: st };
}

/* Credit a purchased pack. ADDITIVE ONLY — a purchase can never reduce an existing balance, and the
   monthly used counter is untouched, so buying does not consume this month's included allowance. */
export async function credit(env, kv, uid, feature, units) {
  const n = Math.max(0, Math.floor(+units || 0));
  if (!kv || !uid || !n) return { ok: false, reason: "bad-credit" };
  const b = await rd(kv, bKey(feature, uid));
  const bal = Math.max(0, (b && +b.bal) || 0) + n;
  await wr(kv, bKey(feature, uid), { bal });   // deliberately no expirationTtl
  return { ok: true, feature, added: n, purchasedBalance: bal };
}

/* ---- Copy (owner-approved 2026-09-18). Value framing, never a bare balance.
   HARD RULES: no clinical outcome claims (readmissions / recovery / complications / mortality), no
   invented statistics, no em-dash. The "have not heard from you" line renders ONLY with a real
   number from a meter; pass opts.unheardCount and it is omitted for 0/undefined. */
export function quotaCopy(feature, opts) {
  const o = opts || {};
  /* Clinic Messaging. The benefit claims here are QUALITATIVE on purpose and must stay that way: no
   * "30% fewer no-shows", no invented survey, no testimonial, no countdown. We have no such number,
   * and a made-up one on a billing screen is the kind of thing a doctor forwards to a regulator.
   * The per-patient price line is arithmetic, not a claim. */
  if (feature === "msg") {
    return {
      headline: "Patients who know where they stand do not crowd your desk.",
      lines: [
        "Improves follow-up. Builds clinic trust. Runs itself.",
        "A clinic that keeps people informed is the clinic they recommend.",
        "Fewer no-shows. A calmer waiting room. A front desk that answers fewer calls.",
      ],
      alert: "Your queue has gone quiet for patients. Keep them informed.",
      price: "\u20b95 a patient. Less than the chai they drink while they wait.",
      expiry: "100 patients. Never expires.",
    };
  }
  if (feature === "scribe") {
    /* Scribe returns the EMR fields PLUS suggestions.ddx and suggestions.investigations (see
     * functions/api/ai/_opd-scribe.js), so the copy sells the second-pair-of-eyes, doctor-final
     * frame. FORBIDDEN, permanently: "never misses" / "catches what you miss" / any promise of
     * diagnostic completeness or accuracy. It is false (the prompt forbids inventing a diagnosis and
     * labels ddx a consideration), it contradicts the App Store "not a diagnostic device" listing,
     * it invites CDSCO/FDA medical-device regulation, and a clinician who believes the AI cannot
     * miss checks less carefully. That last one is a patient-safety failure mode. */
    return {
      headline: "Not just a note. A second pair of eyes.",
      lines: [
        "It hears the whole consult and gives you the note, the differentials worth considering, and the tests worth ordering.",
        "Patient number 40 on a long day: it is still listening as carefully as it did at patient one.",
        "You decide. It just makes sure nothing went unsaid.",
        "Finish your notes before the patient leaves the room.",
        "Go home on time.",
      ],
      price: "₹20 a consult. Four minutes back, and a checklist you did not have to write.",
      expiry: "Consults never expire.",
    };
  }
  const lines = [
    "Your patient hears from you on day 3. They remember that.",
    "Follow-up is what turns a visit into a patient for life.",
    "Every recovery call comes back to you as a summary you can act on.",
    "Cheaper than an hour of staff time. It never forgets a patient.",
  ];
  /* A real positive integer or nothing. Infinity, NaN and "12 or so" are not counts, and this line
   * tells a clinician they neglected patients: a wrong number here is worse than no line at all.
   * NOTHING computes unheardCount today (see the 2026-09-18 decision note) so it never renders. */
  const n = o.unheardCount;   // no coercion: Number.isInteger rejects "5", true, null, NaN and Infinity outright
  if (Number.isInteger(n) && n > 0) lines.unshift(n + " patients discharged this month have not heard from you.");
  return {
    headline: "The clinic that calls is the clinic they come back to.",
    lines,
    price: "₹100 per patient, or ₹90 in the 100 pack. One patient who comes back pays for the pack.",
    expiry: "Credits never expire.",
  };
}

/* Outbound web-price nudge for SMS / WhatsApp / email. SERVER SIDE ONLY, and that placement is the
 * compliance boundary, not a convenience: scripts/build-www.sh excludes functions/ from the app
 * bundle, so this copy physically cannot reach an iOS screen. Sending it outside the app is what
 * Apple's 2021 anti-steering settlement permits; rendering it inside the app is what gets the India
 * storefront build rejected. Consent-gated at the send site, like every other outbound message.
 * Returns null for a pack with no web price (Scribe: store price only). */
export function webUpsellSms(env, packKey) {
  const p = quotaPacks(env)[String(packKey || "")];
  if (!p || !(p.webAmount > 0) || p.webAmount >= p.amount) return null;
  const inr = (paise) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");
  return {
    packKey, amount: p.webAmount,
    text: "StewardMD: " + p.units + " patient credits are " + inr(p.webAmount) + " on stewardmd.in, against "
      + inr(p.amount) + " in the app. Credits never expire. Reply STOP to opt out.",
    url: "https://stewardmd.in/billing?pack=" + packKey,
  };
}

/* The 402 body every refusing route returns. The client renders the top-up sheet straight off it. */
export function quotaRefusal(env, feature, opts) {
  const body = {
    error: "quota-exhausted",
    feature,
    remaining: 0,
    packs: packsForFeature(env, feature),
    copy: quotaCopy(feature, opts),
  };
  // Clinic Messaging is the one feature where a SUBSCRIPTION is the better answer than a pack for a
  // clinic that runs out every month, so the refusal offers both.
  if (feature === "msg") {
    const t = msgTiers(env);
    body.tiers = Object.keys(t).map((k) => Object.assign({ key: k, compare: compareLine("msg." + k) }, t[k]));
  }
  return body;
}

/* ONE CLINIC MESSAGING UNIT = ONE PATIENT, ONE VISIT. The OPD queue sends a patient 3 to 5 messages
 * across a visit (token issued, five ahead, two ahead, you are next, summary link); charging per
 * message would bill a doctor up to five times for one patient. The visit ticket id IS the natural
 * idempotency key: one ticket is one patient's one visit, it is already unique, and it is already in
 * hand at every send site. So the first message of a visit consumes one unit and marks
 * quota:msg:<uid>:v:<ticketId>; messages 2 to 5 read that marker and cost nothing.
 *
 * The marker is written only AFTER a successful consume, so a doctor who tops up mid-visit gets the
 * rest of that visit on the unit they just bought rather than having it silently skipped.
 * TTL is a couple of days (env QUOTA_MSG_VISIT_TTL_SEC): an OPD visit is a single day and a ticket id
 * is never reused, so expiry only reclaims the key.
 *
 * FAIL-OPEN like the rest of this file: no KV, no uid, no ticket id means the message goes out free. */
export async function consumeVisit(env, kv, uid, visitId, opts) {
  const o = opts || {};
  if (!kv || !uid || !visitId) return { ok: true, charged: false, remaining: null, reason: "no-meter" };
  const ttl = (function () { const v = Number(env && env.QUOTA_MSG_VISIT_TTL_SEC); return Number.isFinite(v) && v > 0 ? v : 172800; })();
  const key = "quota:msg:" + uid + ":v:" + visitId;
  const seen = await rd(kv, key);
  if (seen) return { ok: true, charged: false, remaining: null, alreadyCharged: true };
  const r = await consume(env, kv, uid, "msg", o);
  if (!r.ok) return Object.assign({ charged: false }, r);
  await wr(kv, key, { t: o.now || Date.now() }, ttl);
  return Object.assign({ charged: true }, r);
}

/* The refusal body to hand the client when a doctor's messaging allowance is gone. Returns null when
 * the meter is off or there is anything left, so a caller can attach it unconditionally. The queue
 * itself is NEVER blocked by this: the doctor keeps seeing patients, only the outbound patient
 * messages pause, and this is what offers the tiers and the pack. */
export async function msgRefusalIfOut(env, uid, opts) {
  if (!quotaOn(env) || !uid) return null;
  const kv = quotaKv(env);
  if (!kv) return null;
  let st = null;
  try { st = await state(env, kv, uid, "msg", opts); } catch (e) { return null; }
  if (!st || !st.meter || st.remaining > 0) return null;
  return quotaRefusal(env, "msg", opts);
}

/* One "Scribe consult" = one dictation SESSION, not one API call. The OPD scribe refine loop calls
 * /api/ai/extract every ~120s, so charging per call would bill a single consultation many times over.
 * A rolling KV marker (quota:scribe:<uid>:sess) opens on the first call and is refreshed by every
 * later call in the same window, which are then free. That is also the "never a mid-consultation hard
 * stop" guarantee: once a session is open it is never refused, even at zero remaining.
 *
 * ponytail: server-side time window because no client currently sends a session id. Pass
 * opts.session and this becomes exact. Ceilings, honestly: two short consultations inside one window
 * count as one consult (in the doctor's favour), and a consultation longer than the window is
 * charged twice. Window: env QUOTA_SCRIBE_SESSION_SEC, default 2700 (45 min). */
export async function consumeScribeSession(env, kv, uid, opts) {
  const o = opts || {};
  if (!kv || !uid) return { ok: true, remaining: null, open: false };
  const win = (function () { const v = Number(env && env.QUOTA_SCRIBE_SESSION_SEC); return Number.isFinite(v) && v > 0 ? v : 2700; })();
  const key = "quota:scribe:" + uid + ":sess" + (o.session ? ":" + o.session : "");
  const open = await rd(kv, key);
  if (open) { await wr(kv, key, { t: o.now || Date.now() }, win); return { ok: true, remaining: null, open: true }; }
  const r = await consume(env, kv, uid, "scribe", o);
  if (!r.ok) return r;
  await wr(kv, key, { t: o.now || Date.now() }, win);
  return Object.assign({ open: false }, r);
}
