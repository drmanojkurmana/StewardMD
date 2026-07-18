/* StewardMD — Pro billing / entitlement API.
 *
 *   GET  /api/billing/status           -> { pro, source, until, promo, promoUntil }   (signed-in user)
 *   POST /api/billing/grant  {uid,months,source}  -> grant/extend Pro   (OWNER only; comps + testing)
 *   POST /api/billing/revoke {uid}                -> revoke Pro          (OWNER only)
 *
 * Payment-gateway webhooks (Razorpay web/Android, Apple IAP, Google Play / RevenueCat) attach here
 * next — each verifies its receipt/signature then calls grantPro(). Until then, the launch promo
 * (Pro-free-until-15-Sep-2026 in _entitlement.js) unlocks everything, and owners can grant manually.
 */
import { identify } from "../../_fbauth.js";
import { ownerOK } from "../../_adminauth.js";
import { entitlementFor, grantPro, revokePro, promoUntil } from "../../_entitlement.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const rawUid = (id) => (typeof id === "string" && id.indexOf("fb:") === 0 ? id.slice(3) : id);

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const seg = url.pathname.replace(/^\/api\/billing\/?/, "").split("/")[0] || "status";
  const method = request.method;

  try {
    if (method === "GET" && seg === "status") {
      const who = await identify(request, env);
      const uid = rawUid(who);
      // Even signed-out callers get the promo state so the paywall UI can show "Pro free until …".
      const state = await entitlementFor(env, uid);
      return json(Object.assign({ signedIn: !!uid, promoUntil: promoUntil(env) }, state));
    }

    // ---- owner-only management (manual grants for testing / comped accounts) ----
    if (method === "POST" && (seg === "grant" || seg === "revoke")) {
      if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
      let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
      const uid = rawUid(String(body.uid || "").trim());
      if (!uid) return json({ error: "uid-required" }, 400);
      if (seg === "grant") {
        const res = await grantPro(env, uid, { months: body.months, source: body.source || "owner-comp" });
        return json(res);
      }
      const res = await revokePro(env, uid);
      return json(res);
    }

    return json({ error: "bad-request", seg, method }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
