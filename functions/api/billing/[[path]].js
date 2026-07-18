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

    // ---- owner-only management (comps / testing) ----
    if (method === "POST" && (seg === "grant" || seg === "revoke")) {
      if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
      let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
      const uid = rawUid(String(body.uid || "").trim());
      if (!uid) return json({ error: "uid-required" }, 400);
      return json(seg === "grant" ? await grantPro(env, uid, { months: body.months, source: body.source || "owner-comp" })
                                  : await revokePro(env, uid));
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
