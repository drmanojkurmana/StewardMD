/* StewardMD — per-patient quota meters (FollowCare/MAiTRI "care" credits + MaiK Scribe consults).
 *
 * WHY: FollowCare (7 SMS over 7 days) and a MAiTRI recovery call each cost us ₹10, so they share ONE
 * wallet: 1 patient credit = one MAiTRI call OR one 7-day FollowCare SMS course. A Scribe consult
 * costs us ₹3-5. Both are real rupees per use, so they are metered rather than "unlimited".
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

export const FEATURES = ["care", "scribe"];

export function quotaOn(env) { try { return String(env && env.QUOTA_METERS_ON) === "1"; } catch (e) { return false; } }

export function quotaKv(env) { return (env && (env.MAIK_KV || env.CASES_KV || env.GHIS_KV || env.UPDATES_KV)) || null; }

export function monthKey(now) { return new Date(now || Date.now()).toISOString().slice(0, 7); }

// Monthly included allowance by pricing role. Owner-confirmed 2026-09-18: only Physician and
// Physician Pro get any; every lower tier gets zero (whether they may use the feature AT ALL is the
// separate ROLE_GATES_ON matrix, not this file). env-overridable for comps/experiments.
export function includedFor(env, role, feature) {
  const r = String(role || "").trim().toLowerCase();
  if (r !== "physician" && r !== "physician_pro") return 0;
  const n = (k, d) => { const v = Number(env && env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
  return feature === "care" ? n("QUOTA_CARE_INCLUDED", 5) : n("QUOTA_SCRIBE_INCLUDED", 50);
}

// ---- top-up packs (App Store Connect product ids are authoritative; see docs/IOS-IAP-PRODUCTS.md) ----
export function quotaPacks(env) {
  const P = (k, d) => cfgPrice(env, k, d);   // live KV price override > env > default, same as plans()
  return {
    "care.25": { feature: "care", units: 25, amount: P("PACK_CARE_25", 109900), label: "25 patient credits", product: "in.stewardmd.care.25" },
    "care.100": { feature: "care", units: 100, amount: P("PACK_CARE_100", 349900), label: "100 patient credits", product: "in.stewardmd.care.100", popular: true },
    "scribe.50": { feature: "scribe", units: 50, amount: P("PACK_SCRIBE_50", 99900), label: "50 Scribe consults", product: "in.stewardmd.scribe.50" },
    "scribe.250": { feature: "scribe", units: 250, amount: P("PACK_SCRIBE_250", 399900), label: "250 Scribe consults", product: "in.stewardmd.scribe.250", popular: true },
  };
}
// Selection key "pack:care.25" -> "care.25". Mirrors tokenPackFor() in _credits.js.
export function quotaPackFor(planKey) {
  const m = /^pack:((?:care|scribe)\.\d+)$/.exec(String(planKey || ""));
  return m ? m[1] : null;
}
// iOS product id -> selection key. "in.stewardmd.care.25" -> "pack:care.25".
export function packKeyForProduct(productId) {
  const m = /^in\.stewardmd\.(care|scribe)\.(\d+)$/.exec(String(productId || ""));
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
  const included = includedFor(env, opts && opts.role, feature);
  if (!kv || !uid) return { included, usedThisMonth: 0, purchasedBalance: 0, remaining: included, meter: false };
  const mon = monthKey(opts && opts.now);
  const m = await rd(kv, mKey(feature, uid, mon));
  const b = await rd(kv, bKey(feature, uid));
  const used = Math.max(0, (m && +m.used) || 0);
  const bal = Math.max(0, (b && +b.bal) || 0);
  return { included, usedThisMonth: used, purchasedBalance: bal, remaining: Math.max(0, included - used) + bal, meter: true };
}

/* Spend one unit. Returns {ok:true, remaining} or {ok:false, remaining:0, reason:"quota-exhausted"}.
   Fail-open when there is no KV or no uid. */
export async function consume(env, kv, uid, feature, opts) {
  const st = await state(env, kv, uid, feature, opts);
  if (!st.meter) return { ok: true, remaining: st.remaining, reason: null, state: st };
  const n = Math.max(1, (opts && +opts.units) || 1);
  if (st.remaining < n) return { ok: false, remaining: 0, reason: "quota-exhausted", state: st };
  const mon = monthKey(opts && opts.now);
  const fromIncluded = Math.min(n, Math.max(0, st.included - st.usedThisMonth));
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
    price: "₹44 per patient. One patient who comes back pays for 15 follow-ups.",
    expiry: "Credits never expire.",
  };
}

/* The 402 body every refusing route returns. The client renders the top-up sheet straight off it. */
export function quotaRefusal(env, feature, opts) {
  return {
    error: "quota-exhausted",
    feature,
    remaining: 0,
    packs: packsForFeature(env, feature),
    copy: quotaCopy(feature, opts),
  };
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
