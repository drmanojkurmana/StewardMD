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
import { entitlementFor, grantPro, revokePro, promoUntil } from "../../_entitlement.js";
import { lookupUidByEmail, lookupUserByUid } from "../../_fbadmin.js";
import { emailProConfirmation } from "../../_email.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const rawUid = (id) => (typeof id === "string" && id.indexOf("fb:") === 0 ? id.slice(3) : id);

// Plans — amounts in PAISE (₹1 = 100). Placeholders; override via env before launch.
function plans(env) {
  return {
    monthly: { months: 1, amount: +(env.PRO_PRICE_MONTHLY || 49900), label: "Monthly" },
    annual: { months: 12, amount: +(env.PRO_PRICE_ANNUAL || 399900), label: "Annual" },
  };
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
    if (method === "GET" && seg === "status") {
      const uid = rawUid(await identify(request, env));
      const state = await entitlementFor(env, uid);
      return json(Object.assign({ signedIn: !!uid, promoUntil: promoUntil(env) }, state));
    }
    if (method === "GET" && seg === "plans") {
      return json({ currency: "INR", plans: plans(env), promoUntil: promoUntil(env) });
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
      const P = plans(env); const plan = P[body.plan] ? body.plan : "monthly";
      const r = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Authorization": "Basic " + btoa(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET), "Content-Type": "application/json" },
        body: JSON.stringify({ amount: P[plan].amount, currency: "INR", notes: { uid, plan, months: P[plan].months }, receipt: "pro-" + uid.slice(0, 20) + "-" + plan }),
      });
      const o = await r.json();
      if (!r.ok || !o.id) return json({ error: "order-failed", detail: (o && o.error) || null }, 502);
      return json({ orderId: o.id, amount: o.amount, currency: o.currency, keyId: env.RAZORPAY_KEY_ID, plan });
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
        const months = Math.max(1, +notes.months || 1);
        if (uid) { try { await grantPro(env, uid, { months, source: "razorpay" }); } catch (e) {} }
      }
      return json({ ok: true });   // always 200 so Razorpay doesn't retry-storm
    }

    // ---- PhonePe Standard Checkout v2 (web / off-Play Android) ----
    if (method === "POST" && seg === "phonepe" && sub === "pay") {
      if (!env.PHONEPE_CLIENT_ID || !env.PHONEPE_CLIENT_SECRET) return json({ error: "phonepe-not-configured" }, 501);
      const uid = rawUid(await identify(request, env));
      if (!uid) return json({ error: "signin-required" }, 401);
      let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
      const P = plans(env); const plan = P[body.plan] ? body.plan : "monthly";
      const token = await phonepeToken(env);
      const cfg = phonepeCfg(env);
      const merchantOrderId = "SMDPRO" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      const redirectUrl = env.PRO_REDIRECT_URL || "https://stewardmd.in/?pro=return";
      // uid + months ride in metaInfo (echoed back by the status API) so the webhook grants the
      // right account for the right duration — no client-supplied entitlement is trusted.
      const r = await fetch(cfg.pg + "/checkout/v2/pay", {
        method: "POST",
        headers: { "Authorization": "O-Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantOrderId, amount: P[plan].amount,
          metaInfo: { udf1: uid, udf2: String(P[plan].months), udf3: plan },
          paymentFlow: { type: "PG_CHECKOUT", merchantUrls: { redirectUrl } },
        }),
      });
      const o = await r.json();
      if (!r.ok || !o.redirectUrl) return json({ error: "pay-failed", detail: o || null }, 502);
      return json({ redirectUrl: o.redirectUrl, merchantOrderId, orderId: o.orderId, plan });
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
            const months = Math.max(1, +mi.udf2 || 1);
            if (uid) await grantPro(env, uid, { months, source: "phonepe" });
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

    return json({ error: "bad-request", seg, sub, method }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
