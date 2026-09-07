/* StewardMD — Pro billing / entitlement API.
 *
 *   GET  /api/billing/status              -> { pro, source, until, promo, promoUntil }
 *   GET  /api/billing/plans               -> { plans, currency }        (for the paywall UI)
 *   POST /api/billing/grant  {uid,months} -> grant/extend Pro           (OWNER only; comps/testing)
 *   POST /api/billing/revoke {uid}        -> revoke Pro                  (OWNER only)
 *   POST /api/billing/razorpay/order {plan}   -> { orderId, amount, currency, keyId }   (WEB checkout)
 *   POST /api/billing/razorpay/webhook        -> verify sig -> grantPro                 (Razorpay -> us)
 *   POST /api/billing/apple/notify            -> App Store Server Notifications v2       (scaffold)
 *   POST /api/billing/google/rtdn             -> Play Real-time Developer Notifications  (scaffold)
 *
 * Entitlement is server truth (Firebase `pro` claim). The webhook — NOT the client success callback —
 * is what grants Pro, so a tampered client can't self-grant. Placeholder prices (env-overridable);
 * set the real amounts before launch. iOS/Android use native IAP (StoreKit/Play Billing); those
 * webhooks are scaffolded here and finish once the store products + credentials exist.
 */
import { identify } from "../../_fbauth.js";
import { ownerOK } from "../../_adminauth.js";
import { entitlementFor, grantPro, revokePro, promoUntil, promoActive } from "../../_entitlement.js";
import { markFirstSeen } from "../../_lifecycle.js";
import { reconcileVerifiedClaim } from "../../_verify_claim.js";
import { verifyPurchase, daysFromExpiry, iapConfigured } from "../../_iap.js";
import { lookupUidByEmail, lookupUserByUid } from "../../_fbadmin.js";
import { emailProConfirmation } from "../../_email.js";
import { createCoupon, redeemCoupon, revokeCoupon, listCoupons } from "../../_coupons.js";
import { identify as usageIdentify, usageKeyFor, usageKv } from "../../_usage.js";
import { getCredits, dailyCostCap, adminSetCredits, addCredits, setUserCostCap, costCapOn, foundingDailyCap, grantFoundingPool, addTokens, inrToMt, MT_PER_INR, tokenPackFor } from "../../_credits.js";
import { getEntitlement, clinicLimit, deviceLimit } from "../../_entitlements.js";
import { deviceLockOn } from "../../_devices.js";
import { cfgPrice, warmBillingCfg, getBillingCfg, setBillingCfg } from "../../_billingcfg.js";

const json = (obj, status = 200, cache = "no-store") => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": cache },
});
const rawUid = (id) => (typeof id === "string" && id.indexOf("fb:") === 0 ? id.slice(3) : id);

// Plans — amounts in PAISE (₹1 = 100), env-overridable. See docs/PRICING_PACKAGING.md. `monthly`/`annual`
// stay as the Pro back-compat keys the current paywall renders; `tiers`/`addons`/`founding` carry the full set.
function plans(env) {
  const P = (k, d) => cfgPrice(env, k, d);   // live KV price override > env > default
  return {
    monthly: { months: 1, amount: P("PRO_PRICE_MONTHLY", 59900), label: "Pro Monthly" },
    annual: { months: 12, amount: P("PRO_PRICE_ANNUAL", 499900), label: "Pro Annual" },
    tiers: {
      student: { months: 1, amount: P("STUDENT_PRICE_MONTHLY", 19900), annual: P("STUDENT_PRICE_ANNUAL", 199900), regular: P("STUDENT_REGULAR", 39900), label: "Trainee", requiresVerify: true },
      coresident: { months: 1, amount: P("CORESIDENT_PRICE_MONTHLY", 29900), annual: P("CORESIDENT_PRICE_ANNUAL", 299900), regular: P("CORESIDENT_REGULAR", 99900), seats: 2, label: "Co-Resident" },
      pro: { months: 1, amount: P("PRO_PRICE_MONTHLY", 59900), annual: P("PRO_PRICE_ANNUAL", 499900), regular: P("PRO_REGULAR", 99900), label: "Pro", popular: true },
      physician: { months: 1, amount: P("PHYSICIAN_PRICE_MONTHLY", 149900), annual: P("PHYSICIAN_PRICE_ANNUAL", 1499900), regular: P("PHYSICIAN_REGULAR", 249900), label: "Physician" },
      physicianpro: { months: 1, amount: P("PHYSICIANPRO_PRICE_MONTHLY", 249900), annual: P("PHYSICIANPRO_PRICE_ANNUAL", 2499900), regular: P("PHYSICIANPRO_REGULAR", 399900), label: "Physician Pro", premium: true },
    },
    addons: {
      onco: { amount: P("ONCO_ADDON_MONTHLY", 8900), label: "Physician Onco" },
      clinic: { amount: P("CLINIC_ADDON_MONTHLY", 13900), label: "Extra clinic" },
    },
    tokens: {
      boost: { mt: 50000, amount: P("TOKENS_BOOST", 4900), label: "Boost" },
      plus: { mt: 250000, amount: P("TOKENS_PLUS", 19900), regular: P("TOKENS_PLUS_REGULAR", 24500), label: "Plus", popular: true },
      power: { mt: 750000, amount: P("TOKENS_POWER", 49900), regular: P("TOKENS_POWER_REGULAR", 73500), label: "Power" },
    },
    founding: { amount: P("FOUNDING_PRICE_YEAR", 39900), months: 12, seats: P("FOUNDING_SEATS", 500), label: "Founding Doctor (year)" },
  };
}

// Resolve what the client is buying -> { amount(paise), months, key, label, mt? }. Accepts the new
// { tier, cycle } and { pack } / { addon }, and the legacy { plan:"monthly|annual" } (Pro). The `key`
// rides in the payment metaInfo/notes so the webhook grants the right thing.
export function selectAmount(env, body) {
  const P = plans(env); const b = body || {};
  if (b.tier && P.tiers[b.tier]) {
    const t = P.tiers[b.tier], annual = b.cycle === "annual" && t.annual;
    return { amount: annual ? t.annual : t.amount, months: annual ? 12 : 1, key: b.tier + ":" + (annual ? "annual" : "monthly"), label: t.label };
  }
  if (b.pack && P.tokens[b.pack]) { const k = P.tokens[b.pack]; return { amount: k.amount, months: 0, mt: k.mt, key: "tokens:" + b.pack, label: k.label + " tokens" }; }
  if (b.addon && P.addons[b.addon]) { const a = P.addons[b.addon]; return { amount: a.amount, months: 1, key: "addon:" + b.addon, label: a.label }; }
  const plan = P[b.plan] ? b.plan : "monthly";
  return { amount: P[plan].amount, months: P[plan].months, key: "pro:" + plan, label: P[plan].label };
}

// Fulfil ONE paid purchase. Every payment path (Razorpay webhook, PhonePe webhook, StoreKit verify)
// routes through here, because they all had the same bug: they read `months` and granted Pro, so a
// MaiK Token top-up silently delivered a month of Pro and zero tokens.
//
// planKey is the server-issued selection key ("tokens:plus", "pro:monthly", "student:annual", …).
// The token amount is re-read from the server price table — never from the payment note — so a
// tampered note can't mint tokens. Credits are keyed by EMAIL (em:<email>), the same key the AI meter
// uses, so a uid-only webhook must resolve the address first.
//
// `deps` is injectable ONLY so this money path is testable without Firebase/KV (test/token-purchase
// .test.mjs drives a real Razorpay webhook payload through it). Production passes nothing.
export async function fulfilPurchase(env, uid, planKey, months, source, deps) {
  const lookupUser = (deps && deps.lookupUser) || lookupUserByUid;
  const kv = (deps && deps.kv) || usageKv(env);
  const grant = (deps && deps.grantPro) || grantPro;
  const pack = tokenPackFor(planKey);
  if (pack) {
    const p = plans(env).tokens[pack];
    if (!p || !p.mt) return { ok: false, reason: "unknown-pack" };
    const u = await lookupUser(env, uid);
    if (!u || !u.email) return { ok: false, reason: "no-email" };
    const r = await addTokens(kv, "em:" + u.email, p.mt);
    return { ok: true, tokens: p.mt, balanceInr: r.balance, email: u.email };
  }
  const g = await grant(env, uid, { months: Math.max(1, +months || 1), source });
  return Object.assign({ ok: true }, g);
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
async function sha256Hex(msg) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// PhonePe Standard Checkout v2 (OAuth). Prod vs sandbox by env.PHONEPE_ENV.
function phonepeCfg(env) {
  const prod = String(env.PHONEPE_ENV || "prod").toLowerCase() !== "sandbox";
  return prod
    ? { oauth: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token", pg: "https://api.phonepe.com/apis/pg" }
    : { oauth: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token", pg: "https://api-preprod.phonepe.com/apis/pg-sandbox" };
}
let _ppTok = { token: null, exp: 0 };
async function phonepeToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_ppTok.token && now < _ppTok.exp - 60) return _ppTok.token;
  const cfg = phonepeCfg(env);
  const body = new URLSearchParams({
    client_id: env.PHONEPE_CLIENT_ID, client_secret: env.PHONEPE_CLIENT_SECRET,
    client_version: String(env.PHONEPE_CLIENT_VERSION || "1"), grant_type: "client_credentials",
  });
  const r = await fetch(cfg.oauth, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error("phonepe-auth-failed");
  _ppTok = { token: d.access_token, exp: +d.expires_at || (now + 1200) };
  return d.access_token;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/billing\/?/, "").split("/").filter(Boolean);
  const seg = parts[0] || "status";
  const sub = parts[1] || "";
  const method = request.method;

  try {
    try { await warmBillingCfg(usageKv(env)); } catch (e) {}   // load live price/flag overrides (cached 30s)

    // ---- owner: read / write the live price + flag overrides (KV; no redeploy) ----
    if (seg === "admin" && sub === "config") {
      if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
      if (method === "GET") return json({ cfg: await getBillingCfg(usageKv(env)), effective: plans(env), promoUntil: promoUntil(env) });
      if (method === "POST") {
        let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
        const next = await setBillingCfg(usageKv(env), { prices: body.prices || {}, flags: body.flags || {} });
        return json({ ok: true, cfg: next, effective: plans(env), promoUntil: promoUntil(env) });
      }
    }

    if (method === "GET" && seg === "status") {
      const uid = rawUid(await identify(request, env));
      /* BEFORE the entitlement is computed, not after: a doctor whose KV record says verified but
       * whose claim never landed was told every Pro feature "needs a verified registration" while
       * the verification screen showed a green tick. Reconciling here means Pro returns on the next
       * app open rather than only if they happen to open that screen. */
      try { await reconcileVerifiedClaim(env, uid); } catch (e) {}
      const state = await entitlementFor(env, uid);
      /* Give every UNVERIFIED account a lifecycle record, so the day-7 sweep can actually see it.
       *
       * markFirstSeen() was only ever called from /api/welcome, which fires exclusively for
       * genuinely NEW accounts (welcome-email.js checks creationTime ~= lastSignInTime). Every
       * account that existed before this therefore had no record at all, and the deletion sweep
       * filters on `firstSeen` - so "delete unverified accounts after 7 days" would have quietly
       * applied to nobody who had already signed up. A feature that silently does nothing is the
       * exact class of bug this whole change set is about.
       *
       * markFirstSeen is IDEMPOTENT: an existing record keeps its original firstSeen, so nobody's
       * clock is reset or backdated. An account with no record starts its 7 days from now, warned
       * by email at day 5. Verified accounts are skipped - they have no deletion clock to run.
       * Best-effort: /billing/status must never fail because a KV write did. */
      try {
        if (uid && !state.verified) await markFirstSeen(env, uid, {});
      } catch (e) {}
      // AI credits + daily cost cap for THIS user (keyed the same as the AI meter: em:<email>).
      let credits = 0, costCap = 0, role = null;
      try {
        const who = await usageIdentify(request, env);
        if (who && who.email) { const kv = usageKv(env); credits = await getCredits(kv, usageKeyFor(who)); }
      } catch (e) {}
      try { const ent = uid ? await getEntitlement(env, uid) : null; role = ent && ent.role; } catch (e) {}
      try { const who = await usageIdentify(request, env); if (who && who.email) costCap = await dailyCostCap(env, usageKv(env), who.email, role); } catch (e) {}
      return json(Object.assign({
        signedIn: !!uid, promoUntil: promoUntil(env), credits, costCap, costCapOn: costCapOn(env),
        tokens: inrToMt(credits), costCapMt: inrToMt(costCap), mtPerInr: MT_PER_INR,   // MaiK Tokens = what the UI shows
        role: role || null, clinicLimit: clinicLimit(env, role), deviceLimit: deviceLimit(env, role), deviceLockOn: deviceLockOn(env),
      }, state));
    }
    // ---- owner billing overview: provider config (booleans, never secrets) + flags + founding + plans ----
    if (method === "GET" && seg === "admin" && sub === "overview") {
      if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
      const cps = await listCoupons(env);
      const founding = cps.filter((c) => c.type === "founding");
      const foundingUsed = founding.reduce((n, c) => n + ((c.redeemedBy || []).length), 0);
      const seats = +(env.FOUNDING_SEATS || 500);
      return json({
        providers: {
          phonepe: !!(env.PHONEPE_CLIENT_ID && env.PHONEPE_CLIENT_SECRET),
          razorpay: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
          apple: iapConfigured(env, "apple"),
          google: iapConfigured(env, "google"),
        },
        flags: {
          promoActive: promoActive(env), promoUntil: promoUntil(env),
          costCapOn: costCapOn(env), deviceLockOn: deviceLockOn(env),
          enforceCaps: String(env.MAIK_ENFORCE_CAPS) === "1", featuresOn: String(env.FEATURES_ON) === "1",
        },
        founding: { seats, used: foundingUsed, left: Math.max(0, seats - foundingUsed), codes: founding.length },
        coupons: { total: cps.length, active: cps.filter((c) => !c.revoked).length },
        plans: plans(env),
      });
    }
    if (method === "GET" && seg === "plans") {
      // Public, user-identical pricing for the paywall. Safe to cache; changes rarely.
      return json({ currency: "INR", plans: plans(env), promoUntil: promoUntil(env), mtPerInr: MT_PER_INR }, 200, "public, max-age=600");
    }

    // ---- native IAP: the app POSTs a verified Play/App Store subscription purchase -> we confirm it with
    // the store SERVER-side (functions/_iap.js) and grantPro into the SAME entitlement store. 501 until the
    // owner wires store credentials; a purchase is NEVER trusted from the client. ----
    if (method === "POST" && seg === "iap" && sub === "verify") {
      const uid = rawUid(await identify(request, env));
      if (!uid) return json({ error: "signin-required" }, 401);
      let body = {}; try { body = await request.json(); } catch (e) {}
      const platform = body.platform, tok = body.purchaseToken || body.receipt;
      if (!platform || !tok) return json({ error: "platform-and-token-required" }, 400);
      const v = await verifyPurchase(env, { platform: platform, productId: body.productId, purchaseToken: tok });
      if (!v.configured) return json({ error: "iap-not-configured", platform: platform, reason: v.reason }, 501);
      if (!v.valid) return json({ ok: false, valid: false, reason: v.reason || "invalid" }, 402);
      // Consumable MaiK Token packs (in.stewardmd.tokens.<pack>) are NOT subscriptions: they have no
      // expiry, so the days-from-expiry grant below would have handed out Pro instead of tokens.
      const iapPack = /^in\.stewardmd\.tokens\.([a-z]+)$/.exec(String(body.productId || ""));
      if (iapPack) {
        const f = await fulfilPurchase(env, uid, "tokens:" + iapPack[1], 0, "iap-" + platform);
        if (!f.ok) return json({ ok: false, valid: true, reason: f.reason }, 502);
        return json({ ok: true, valid: true, platform: platform, tokens: f.tokens, balanceMt: inrToMt(f.balanceInr) });
      }
      const g = await grantPro(env, uid, { days: daysFromExpiry(v.expiresAt), source: "iap-" + platform });
      return json(Object.assign({ ok: true, valid: true, platform: platform, expiresAt: v.expiresAt || null }, g));
    }

    // ---- owner-only Pro management: grant (forever / months / days / 7-day trial), revoke, lookup ----
    if (method === "POST" && (seg === "grant" || seg === "revoke" || seg === "lookup")) {
      if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
      let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
      // Resolve the target by email (preferred — what an admin knows) or a raw uid.
      let uid = rawUid(String(body.uid || "").trim()), email = String(body.email || "").trim().toLowerCase(), name = "";
      if (!uid && email) {
        const u = await lookupUidByEmail(env, email);
        if (!u) return json({ error: "user-not-found", email }, 404);
        uid = u.uid; email = u.email; name = u.name;
      }
      if (!uid) return json({ error: "uid-or-email-required" }, 400);
      // Granted by uid (or email lookup returned no address): resolve the email so the confirmation
      // email always has a recipient. Uses accounts:lookup by localId (the known-good query).
      if (uid && !email) { try { const u = await lookupUserByUid(env, uid); if (u) { email = u.email; if (!name) name = u.name; } } catch (e) {} }

      if (seg === "lookup") { const st = await entitlementFor(env, uid); return json(Object.assign({ uid, email, name }, st)); }
      if (seg === "revoke") { const r = await revokePro(env, uid); return json(Object.assign({ uid, email }, r)); }

      // grant — mode: forever | trial (7d) | days:<n> | months:<n> (default 1 month)
      const mode = String(body.mode || "").toLowerCase();
      let opts = { source: body.source || "owner-comp" }, trial = false;
      if (mode === "forever") opts.forever = true;
      else if (mode === "trial") { opts.days = 7; opts.source = "trial"; trial = true; }
      else if (mode === "days") opts.days = Math.max(1, +body.days || 7);
      else opts.months = Math.max(1, +body.months || 1);
      const res = await grantPro(env, uid, opts);
      const untilStr = res.proExp ? new Date(res.proExp).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
      if (email) { try { await emailProConfirmation(env, { email, name, until: untilStr, forever: !!res.forever, trial }); } catch (e) {} }
      return json(Object.assign({ uid, email, emailed: !!email, trial }, res));
    }

    // ---- Razorpay (web / off-Play Android) ----
    if (method === "POST" && seg === "razorpay" && sub === "order") {
      if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return json({ error: "razorpay-not-configured" }, 501);
      const uid = rawUid(await identify(request, env));
      if (!uid) return json({ error: "signin-required" }, 401);
      let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
      const sel = selectAmount(env, body);
      const r = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Authorization": "Basic " + btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET), "Content-Type": "application/json" },
        body: JSON.stringify({ amount: sel.amount, currency: "INR", notes: { uid, plan: sel.key, months: sel.months }, receipt: "smd-" + uid.slice(0, 18) + "-" + Date.now().toString(36) }),
      });
      const o = await r.json();
      if (!r.ok || !o.id) return json({ error: "order-failed", detail: (o && o.error) || null }, 502);
      return json({ orderId: o.id, amount: o.amount, currency: o.currency, keyId: env.RAZORPAY_KEY_ID, plan: sel.key, label: sel.label });
    }
    if (method === "POST" && seg === "razorpay" && sub === "webhook") {
      const raw = await request.text();
      const sig = request.headers.get("X-Razorpay-Signature") || "";
      const secret = env.RAZORPAY_WEBHOOK_SECRET;
      if (!secret) return json({ error: "webhook-not-configured" }, 501);
      const expected = await hmacSha256Hex(secret, raw);
      if (!timingEqual(expected, sig)) return json({ error: "bad-signature" }, 401);
      let evt = {}; try { evt = JSON.parse(raw); } catch (e) {}
      const event = evt.event || "";
      // Grant on a captured payment (one-time Pro purchase). Renewals/refunds can extend this later.
      if (event === "payment.captured" || event === "order.paid") {
        const pay = (evt.payload && ((evt.payload.payment && evt.payload.payment.entity) || (evt.payload.order && evt.payload.order.entity))) || {};
        const notes = pay.notes || {};
        const uid = rawUid(String(notes.uid || ""));
        if (uid) { try { await fulfilPurchase(env, uid, notes.plan, notes.months, "razorpay"); } catch (e) {} }
      }
      return json({ ok: true });   // always 200 so Razorpay doesn't retry-storm
    }

    // ---- PhonePe Standard Checkout v2 (web / off-Play Android) ----
    if (method === "POST" && seg === "phonepe" && sub === "pay") {
      if (!env.PHONEPE_CLIENT_ID || !env.PHONEPE_CLIENT_SECRET) return json({ error: "phonepe-not-configured" }, 501);
      const uid = rawUid(await identify(request, env));
      if (!uid) return json({ error: "signin-required" }, 401);
      let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
      const sel = selectAmount(env, body);
      const token = await phonepeToken(env);
      const cfg = phonepeCfg(env);
      const merchantOrderId = "SMDPRO" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      const redirectUrl = env.PRO_REDIRECT_URL || "https://stewardmd.in/?pro=return";
      // uid + months + selection key ride in metaInfo (echoed back by the status API) so the webhook
      // grants the right thing for the right duration — no client-supplied entitlement is trusted.
      const r = await fetch(cfg.pg + "/checkout/v2/pay", {
        method: "POST",
        headers: { "Authorization": "O-Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantOrderId, amount: sel.amount,
          metaInfo: { udf1: uid, udf2: String(sel.months), udf3: sel.key },
          paymentFlow: { type: "PG_CHECKOUT", merchantUrls: { redirectUrl } },
        }),
      });
      const o = await r.json();
      if (!r.ok || !o.redirectUrl) return json({ error: "pay-failed", detail: o || null }, 502);
      return json({ redirectUrl: o.redirectUrl, merchantOrderId, orderId: o.orderId, plan: sel.key, label: sel.label });
    }
    if (method === "POST" && seg === "phonepe" && sub === "webhook") {
      const user = env.PHONEPE_WEBHOOK_USERNAME, pass = env.PHONEPE_WEBHOOK_PASSWORD;
      if (!user || !pass) return json({ error: "webhook-not-configured" }, 501);
      const auth = (request.headers.get("Authorization") || "").trim().toLowerCase();
      const expected = (await sha256Hex(user + ":" + pass)).toLowerCase();
      if (!timingEqual(auth, expected)) return json({ error: "bad-auth" }, 401);
      let evt = {}; try { evt = (await request.json()) || {}; } catch (e) {}
      const p = evt.payload || {};
      const merchantOrderId = p.merchantOrderId || p.orderId || "";
      const event = String(evt.event || evt.type || "");
      // Re-verify against the status API (source of truth) before granting.
      if (merchantOrderId && (event.indexOf("completed") >= 0 || String(p.state).toUpperCase() === "COMPLETED")) {
        try {
          const token = await phonepeToken(env);
          const cfg = phonepeCfg(env);
          const sr = await fetch(cfg.pg + "/checkout/v2/order/" + encodeURIComponent(merchantOrderId) + "/status", { headers: { "Authorization": "O-Bearer " + token } });
          const s = await sr.json();
          if (sr.ok && String(s.state).toUpperCase() === "COMPLETED") {
            const mi = s.metaInfo || {};
            const uid = rawUid(String(mi.udf1 || ""));
            if (uid) await fulfilPurchase(env, uid, mi.udf3, mi.udf2, "phonepe");
          }
        } catch (e) {}
      }
      return json({ ok: true });   // always 200 so PhonePe doesn't retry-storm
    }

    // ---- Apple App Store Server Notifications v2 (native iOS IAP) — scaffold ----
    // Finish once the App Store Connect subscription product + issuer key exist: verify the signed
    // JWS payload, then on SUBSCRIBED/DID_RENEW -> grantPro(uid, months); EXPIRED/REFUND -> revokePro.
    if (method === "POST" && seg === "apple" && sub === "notify") {
      if (!env.APPLE_IAP_ENABLED) return json({ error: "apple-not-configured" }, 501);
      // TODO: decode+verify signedPayload (JWS), map original_transaction_id -> uid, grant/revoke.
      return json({ ok: true, todo: "verify JWS + map to uid" });
    }
    // ---- Google Play Real-time Developer Notifications (native Android IAP) — scaffold ----
    if (method === "POST" && seg === "google" && sub === "rtdn") {
      if (!env.PLAY_IAP_ENABLED) return json({ error: "play-not-configured" }, 501);
      // TODO: decode Pub/Sub message, call Play Developer API to verify the subscription, grant/revoke.
      return json({ ok: true, todo: "verify via Play Developer API + map to uid" });
    }

    // ---- institution coupons: owner issues/lists/revokes; any signed-in doctor redeems ----
    if (seg === "coupon") {
      if (method === "POST" && sub === "redeem") {
        const uid = rawUid(await identify(request, env));
        if (!uid) return json({ error: "signin-required" }, 401);
        let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
        const r = await redeemCoupon(env, body.code, uid);
        // Founding-Doctor SKU: apply the fixed annual AI pool + ~0 daily cap (keyed by email, like the meter).
        if (r.ok && r.founding && !r.already) {
          try {
            const who = await usageIdentify(request, env);
            if (who && who.email) { const kv = usageKv(env); await setUserCostCap(kv, who.email, foundingDailyCap(env)); await grantFoundingPool(env, kv, usageKeyFor(who)); }
          } catch (e) {}
        }
        return json(r, r.ok ? 200 : (r.reason === "signin-required" ? 401 : 404));
      }
      // owner-only management
      if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
      if (method === "GET" && (sub === "list" || !sub)) return json({ coupons: await listCoupons(env) });
      let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
      if (method === "POST" && sub === "create") return json({ ok: true, coupon: await createCoupon(env, body) });
      if (method === "POST" && sub === "revoke") return json(await revokeCoupon(env, body.code));
      return json({ error: "bad-coupon-request", sub, method }, 400);
    }

    // ---- AI credits + per-user daily cost cap (owner-managed). Metering key = em:<email>. ----
    // The paid "buy credits" flow (₹50 -> ₹25 allowance) is granted by the payment webhook calling
    // addCredits once the credits product + payment creds exist; owner can also grant/adjust here.
    if (seg === "credits" || seg === "costcap") {
      if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
      let body = {}; if (method === "POST") { try { body = (await request.json()) || {}; } catch (e) {} }
      const email = String(body.email || url.searchParams.get("email") || "").trim().toLowerCase();
      if (!email) return json({ error: "email-required" }, 400);
      const kv = usageKv(env), key = "em:" + email;
      if (seg === "credits") {
        if (method === "POST" && sub === "add") return json(Object.assign({ email }, await addCredits(env, kv, key, body.purchaseInr)));   // simulate a ₹purchaseInr top-up
        if (method === "POST" && (sub === "set" || !sub)) return json(Object.assign({ email }, await adminSetCredits(kv, key, body.inr)));  // set absolute balance (revoke = 0)
        if (method === "GET") return json({ email, credits: await getCredits(kv, key) });
      }
      if (seg === "costcap" && method === "POST") return json({ email, ok: await setUserCostCap(kv, email, body.inr) });   // inr null/"" clears → env/role default
      return json({ error: "bad-request", seg, sub, method }, 400);
    }

    // ---- co-resident shared AI pool (owner-linked): both accounts of the ₹299 pair meter as one. ----
    if (seg === "pool") {
      if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
      let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return json({ error: "email-required" }, 400);
      const kv = usageKv(env);
      if (method === "POST" && sub === "link") {
        const owner = String(body.poolEmail || "").trim().toLowerCase();
        if (!owner || owner === email) return json({ error: "poolEmail-required" }, 400);
        try { await kv.put("ai:pool:em:" + email, "em:" + owner); } catch (e) { return json({ error: "kv" }, 502); }
        return json({ ok: true, email, pooledTo: owner });
      }
      if (method === "POST" && sub === "unlink") { try { await kv.delete("ai:pool:em:" + email); } catch (e) {} return json({ ok: true, email }); }
      return json({ error: "bad-request", seg, sub, method }, 400);
    }

    return json({ error: "bad-request", seg, sub, method }, 400);
  } catch (e) {
    { try { console.warn("[api] server error", String((e && e.message) || e).slice(0, 200)); } catch (_e) {} return json({ error: "server_error" }, 500); }
  }
}
