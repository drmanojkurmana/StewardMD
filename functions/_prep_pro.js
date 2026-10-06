/* functions/_prep_pro.js - PrepNucleus Pro (prep_pro) entitlement, quote, referral, win-back offer.
 *
 * Owner decision 2026-10-06 (vault/decisions/Decisions.md "PrepNucleus pricing, free tier and social").
 * State lives on the existing per-person entitlement doc entitlements/{uid} (server-only Firestore):
 *   prepProExp, prepProSource             the entitlement (ms epoch; extended, never reset)
 *   prepPaidRefs[], prepFirstPaidAt       payment refs already fulfilled (retry idempotency) + first paid time
 *   prepReferrer, prepReferralCredited    referee side of a referral (referrer uid; credited once)
 *   prepCheckoutAt                        last PrepNucleus order created while unpaid (win-back "abandon")
 *   prepOfferShownAt, prepOfferEnded      win-back offer: first shown time; ended by dismiss/use
 * Every read-modify-write is guarded on the doc's updateTime (or exists:false) and retried, so two
 * webhook deliveries of one payment cannot both extend or both pay the referral.
 * All IO is deps-injectable (fsGet / fsCommit / getUserClaims), same style as _entitlements.js. */
import * as FS from "./_fbfirestore.js";
import { getUserClaims } from "./_fbadmin.js";
import { cfgPrice, cfgFlag } from "./_billingcfg.js";
import { normalizeSmdId } from "./_entitlements.js";

const DAY = 86400000, HOUR = 3600000, MIN = 60000;
const COLL = "entitlements/";

// The ONE config object. Every value is overridable live (KV billing:cfg via /api/billing/admin/config)
// or by env var of the same name; the right-hand side is the default. One plan only: a year.
// Store ids are PLACEHOLDERS until the owner creates the products (App Store Connect / Play Console).
export function prepCfg(env) {
  const P = (k, d) => cfgPrice(env, k, d);
  const S = (k, d) => { const v = cfgFlag(env, k); return v == null || v === "" ? d : String(v); };
  return {
    listPaise: P("PREP_LIST_PRICE", 599900),          // Rs 5,999 / year: the real price, charged from year 2
    // Rs 1,499 first year IS the launch price, until PREP_LAUNCH_ENDS (server clock). After it the
    // first year costs PREP_INTRO_AFTER_LAUNCH (default = list, i.e. no intro).
    launchPaise: P("PREP_LAUNCH_PRICE", 149900),
    launchEndsAt: Date.parse(S("PREP_LAUNCH_ENDS", "2027-03-31T23:59:00+05:30")) || 0,
    introAfterLaunchPaise: P("PREP_INTRO_AFTER_LAUNCH", 599900),
    days: P("PREP_DAYS_YEAR", 365),
    studentDiscountPct: Math.min(90, P("PREP_STUDENT_DISCOUNT_PCT", 20)),   // off the LIST price
    referralDays: P("PREP_REFERRAL_DAYS", 30),
    store: {
      productId: S("PREP_IAP_PRODUCT", "in.stewardmd.prep.annual"),         // iOS auto-renewable sub (intro offer set in ASC)
      iosWinbackOfferId: S("PREP_IOS_WINBACK_OFFER", "prep_winback_999"),  // iOS promotional offer / offer code id
      playBasePlanId: S("PREP_PLAY_BASE_PLAN", "prep-annual"),
      playIntroOfferId: S("PREP_PLAY_INTRO_OFFER", "prep-launch-1499"),
      androidPackage: S("PREP_ANDROID_PACKAGE", (env && env.GOOGLE_PLAY_PACKAGE) || "in.stewardmd.app"),
      playWinbackOfferId: S("PREP_PLAY_WINBACK_OFFER", "prep-winback-999"),
    },
    winback: {
      paise: P("PREP_WINBACK_PRICE", 99900),
      afterMs: P("PREP_WINBACK_DELAY_MIN", 60) * MIN,     // a later visit, not the same one
      validMs: P("PREP_WINBACK_HOURS", 48) * HOUR,       // from first shown
    },
  };
}

/* Cancel anytime. Razorpay (and PhonePe) purchases are ONE-TIME orders in this codebase (no Razorpay
 * subscriptions exist): nothing renews, so nothing to cancel; renewal is a new purchase at list price.
 * Store subscriptions auto-renew and are cancelled in the store, so we return its manage link. */
export function prepProView(rec, now, env) {
  now = now || Date.now();
  const until = +(rec && rec.prepProExp) || 0;
  const source = (rec && rec.prepProSource) || null, plat = rec && rec.prepProPlatform;
  const st = prepCfg(env).store;
  const manageUrl = source !== "iap" ? null : plat === "ios" ? "https://apps.apple.com/account/subscriptions"
    : "https://play.google.com/store/account/subscriptions?sku=" + encodeURIComponent(st.productId) + "&package=" + encodeURIComponent(st.androidPackage);
  return { active: until > now, until: until || null, source, autoRenews: source === "iap", manageUrl };
}

// Pure win-back state. eligible = may be shown now; active = shown and inside its window.
export function offerState(rec, cfg, now) {
  now = now || Date.now();
  const w = cfg.winback, r = rec || {};
  if (r.prepOfferEnded || r.prepFirstPaidAt) return { status: "none" };
  const shown = +r.prepOfferShownAt || 0;
  if (shown) return now < shown + w.validMs ? { status: "active", expiresAt: shown + w.validMs } : { status: "none" };
  const at = +r.prepCheckoutAt || 0;
  if (at && now - at >= w.afterMs) return { status: "eligible" };
  return { status: "none" };
}

/* Pure quote. THE RULE (owner 2026-10-06): one best single price, never stacked.
 *  First year (no prior paid PrepNucleus purchase), candidates:
 *    launch   = PREP_LAUNCH_PRICE        while the server clock is before PREP_LAUNCH_ENDS
 *    intro    = PREP_INTRO_AFTER_LAUNCH  after it (default = list price, so no intro)
 *    student  = list x (1 - pct)   only for a verified student/intern; the % is off the LIST, not the intro
 *    winback  = PREP_WINBACK_PRICE only while the account's win-back offer is active
 *  -> charge the minimum. Renewal (any later purchase): list, or student if verified ("renewal" / "student").
 *  The referral month is time credited to the REFERRER, not a price, so it never enters this.
 *  offPct / saveRupees are computed from the config prices, never typed. */
export function prepQuote(cfg, opts, now) {
  now = now || Date.now(); opts = opts || {};
  const list = cfg.listPaise;
  const first = !(opts.rec && opts.rec.prepFirstPaidAt);
  const launchLive = cfg.launchEndsAt > now;
  const c = [!first ? { reason: "renewal", paise: list } : launchLive ? { reason: "launch", paise: cfg.launchPaise } : { reason: "intro", paise: cfg.introAfterLaunchPaise }];
  if (opts.studentVerified) c.push({ reason: "student", paise: Math.round(list * (100 - cfg.studentDiscountPct) / 100) });
  if (first && opts.offerExpiresAt) c.push({ reason: "winback", paise: cfg.winback.paise });
  const best = c.reduce((a, b) => (b.paise < a.paise ? b : a));
  const st = cfg.store;
  const out = {
    plan: "year", productId: st.productId, listPaise: list, firstYear: first,
    firstYearPaise: best.paise, renewalPaise: list, priceReason: best.reason,
    offPct: Math.round((list - best.paise) * 100 / list), saveRupees: Math.round((list - best.paise) / 100),
    studentVerified: !!opts.studentVerified, referralCreditDays: cfg.referralDays,
    store: {
      iosOfferId: best.reason === "winback" ? st.iosWinbackOfferId : null,   // intro is automatic on iOS
      playBasePlanId: st.playBasePlanId,
      playOfferId: best.reason === "winback" ? st.playWinbackOfferId : best.reason === "launch" ? st.playIntroOfferId : null,
    },
  };
  if (opts.offerExpiresAt) out.offerExpiresAt = opts.offerExpiresAt;
  if (launchLive) out.launchEndsAt = cfg.launchEndsAt;
  return out;
}

// ---- IO helpers ----
function io(deps) {
  deps = deps || {};
  return { get: deps.fsGet || FS.fsGet, commit: deps.fsCommit || FS.fsCommit, claims: deps.getUserClaims || getUserClaims };
}
// Guarded patch: unchanged since read (updateTime) or still absent.
function guarded(env, uid, doc, fields) {
  const w = FS.wUpdate(env, COLL + uid, Object.assign({ uid, updatedAt: Date.now() }, fields), doc ? { updateTime: doc.updateTime } : {});
  if (!doc) w.currentDocument = { exists: false };
  return w;
}
// Read -> decide -> guarded commit, retried on a lost race. decide(doc, fields) returns
// { writes, result } or { result } (nothing to write).
async function rmw(env, uid, deps, decide) {
  const x = io(deps);
  for (let i = 0; i < 4; i++) {
    const d = await x.get(env, COLL + uid);
    const r = await decide(d, (d && d.fields) || {}, x);
    if (!r.writes || !r.writes.length) return r.result;
    try { await x.commit(env, r.writes); return r.result; }
    catch (e) { if (!e || e.code !== "precondition") throw e; }
  }
  throw Object.assign(new Error("prep_contention"), { code: "contention" });
}

export async function getPrepRecord(env, uid, deps) {
  const d = await io(deps).get(env, COLL + uid);
  return (d && d.fields) || {};
}
export async function studentVerified(env, uid, deps) {
  try { const c = (await io(deps).claims(env, uid)) || {}; return c.traineeVerified === true; } catch (e) { return false; }
}

// Quote for a signed-in caller (also what the order route charges). Does NOT mark the offer shown.
export async function quoteFor(env, uid, deps, now) {
  now = now || Date.now();
  const cfg = prepCfg(env);
  const rec = uid ? await getPrepRecord(env, uid, deps) : {};
  const sv = uid ? await studentVerified(env, uid, deps) : false;
  const o = offerState(rec, cfg, now);
  return prepQuote(cfg, { studentVerified: sv, rec, offerExpiresAt: o.status === "active" ? o.expiresAt : null }, now);
}

// GET prep-offer: first GET that finds the account eligible starts the window.
export async function getOffer(env, uid, deps, now) {
  now = now || Date.now();
  const cfg = prepCfg(env);
  return rmw(env, uid, deps, (d, rec) => {
    const s = offerState(rec, cfg, now);
    if (s.status === "none") return { result: { offer: null } };
    const expiresAt = s.status === "active" ? s.expiresAt : now + cfg.winback.validMs;
    // basePaise = the first-year price the user walked away from (launch / intro), so saveRupees is honest.
    const base = cfg.launchEndsAt > now ? cfg.launchPaise : cfg.introAfterLaunchPaise, fin = cfg.winback.paise;
    const result = { offer: { kind: "winback", finalPaise: fin, basePaise: base, listPaise: cfg.listPaise, saveRupees: Math.round((base - fin) / 100), expiresAt,
      productId: cfg.store.productId, iosOfferId: cfg.store.iosWinbackOfferId, playOfferId: cfg.store.playWinbackOfferId } };
    return s.status === "active" ? { result } : { result, writes: [guarded(env, uid, d, { prepOfferShownAt: now })] };
  });
}
export async function dismissOffer(env, uid, deps) {
  return rmw(env, uid, deps, (d, rec) => (rec.prepOfferEnded ? { result: { ok: true } } : { result: { ok: true }, writes: [guarded(env, uid, d, { prepOfferEnded: true })] }));
}
// Order created for a first purchase: remember it as a pending checkout (abandon = still unpaid later).
export async function markCheckout(env, uid, deps, now) {
  now = now || Date.now();
  return rmw(env, uid, deps, (d, rec) => (rec.prepFirstPaidAt || rec.prepCheckoutAt || rec.prepOfferShownAt || rec.prepOfferEnded
    ? { result: null } : { result: null, writes: [guarded(env, uid, d, { prepCheckoutAt: now })] }));
}

// POST prep-referral {code}: code = the referrer's StewardMD ID.
export async function recordReferral(env, uid, code, deps) {
  const x = io(deps);
  const id = normalizeSmdId(code);
  if (!id) return { ok: false, error: "code-required", status: 400 };
  const dir = await x.get(env, "doctorDirectory/" + id);
  const refUid = dir && dir.fields && dir.fields.uid;
  if (!refUid) return { ok: false, error: "unknown-code", status: 404 };
  if (refUid === uid) return { ok: false, error: "self-referral", status: 400 };
  return rmw(env, uid, deps, (d, rec) => {
    if (rec.prepFirstPaidAt) return { result: { ok: false, error: "already-paid", status: 409 } };
    if (rec.prepReferrer) return { result: rec.prepReferrer === refUid ? { ok: true, already: true } : { ok: false, error: "already-referred", status: 409 } };
    return { result: { ok: true }, writes: [guarded(env, uid, d, { prepReferrer: refUid, prepReferrerCode: id })] };
  });
}

// Fulfil one verified PrepNucleus payment. planKey "prep:year[:<priceReason>]" (one year of prep_pro).
// ref = the payment's stable id (Razorpay order id / store transaction hash): a replay is a no-op.
// The referee's FIRST paid purchase credits the referrer in the SAME atomic commit.
export async function fulfilPrep(env, uid, planKey, opts, deps) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const cfg = prepCfg(env);
  const parts = String(planKey || "").toLowerCase().split(":");
  if (parts[0] !== "prep" || parts[1] !== "year") return { ok: false, reason: "unknown-prep-plan" };
  const days = +opts.days > 0 ? +opts.days : cfg.days;
  const ref = String(opts.ref || "").slice(0, 120);
  if (!ref) return { ok: false, reason: "ref-required" };
  return rmw(env, uid, deps, async (d, rec, x) => {
    const refs = Array.isArray(rec.prepPaidRefs) ? rec.prepPaidRefs : [];
    if (refs.indexOf(ref) >= 0) return { result: Object.assign({ ok: true, already: true }, { prepPro: prepProView(rec, now, env) }) };
    const exp = Math.max(+rec.prepProExp || 0, now) + days * DAY;
    const patch = { prepProExp: exp, prepProSource: opts.source || "razorpay", prepProPlatform: opts.platform || null, prepPaidRefs: refs.concat(ref).slice(-20), prepFirstPaidAt: rec.prepFirstPaidAt || now };
    patch.prepOfferEnded = true;   // one offer ever; a paying account never sees it again
    const writes = [];
    let credited = null;
    if (!rec.prepFirstPaidAt && rec.prepReferrer && !rec.prepReferralCredited && rec.prepReferrer !== uid) {
      patch.prepReferralCredited = true;
      const rd = await x.get(env, COLL + rec.prepReferrer);
      const rr = (rd && rd.fields) || {};
      const rexp = Math.max(+rr.prepProExp || 0, now) + cfg.referralDays * DAY;
      // Keep the referrer's paid source label if they hold paid time; otherwise it is referral time.
      writes.push(guarded(env, rec.prepReferrer, rd, { prepProExp: rexp, prepProSource: (+rr.prepProExp || 0) > now ? (rr.prepProSource || "referral") : "referral" }));
      credited = { referrer: rec.prepReferrer, days: cfg.referralDays, until: rexp };
    }
    writes.unshift(guarded(env, uid, d, patch));
    return { writes, result: { ok: true, prepPro: prepProView(Object.assign({}, rec, patch), now, env), referralCredit: credited } };
  });
}

// Store product id -> prep plan key (null when not the PrepNucleus subscription).
export function prepPlanKeyForProduct(env, productId) {
  return productId && String(productId) === prepCfg(env).store.productId ? "prep:year" : null;
}
