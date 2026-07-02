/* StewardMD — Web Push subscription API (Cloudflare Pages Function)
 *
 *   GET  /api/push/status        -> { enabled, publicKey }   (client needs publicKey to subscribe)
 *   POST /api/push/subscribe     body={ subscription }        -> { ok }
 *   POST /api/push/unsubscribe   body={ endpoint }            -> { ok }
 *   POST /api/push/send          (admin token) -> { sent, total }   (manual test blast)
 *
 * Subscribing is open to any user (it's their own device opting in). Sending is
 * gated by the same UPDATES_ADMIN_TOKEN as the notifications API.
 */
import { saveSubscription, deleteSubscription, sendPushToAll, pushEnabled } from "../../_webpush.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
function adminOK(request, env) {
  const want = env.UPDATES_ADMIN_TOKEN || ""; if (!want) return null;
  const got = request.headers.get("X-Admin-Token") || "";
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < got.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const method = request.method;

  if (seg === "status") return json({ enabled: pushEnabled(env), publicKey: env.VAPID_PUBLIC_KEY || null });

  if (method === "POST" && seg === "subscribe") {
    let body = {}; try { body = await request.json(); } catch (e) {}
    const sub = body.subscription || body;
    if (!sub || !sub.endpoint) return json({ error: "no-subscription" }, 400);
    const okSave = await saveSubscription(env, sub);
    return okSave ? json({ ok: true }) : json({ error: "store-unavailable" }, 501);
  }
  if (method === "POST" && seg === "unsubscribe") {
    let body = {}; try { body = await request.json(); } catch (e) {}
    const endpoint = body.endpoint || (body.subscription && body.subscription.endpoint);
    if (endpoint) await deleteSubscription(env, endpoint);
    return json({ ok: true });
  }
  if (method === "POST" && seg === "send") {
    const ok = adminOK(request, env);
    if (ok === null) return json({ error: "admin-not-configured" }, 503);
    if (!ok) return json({ error: "unauthorised" }, 401);
    const res = await sendPushToAll(env);
    return json({ ok: true, ...res });
  }
  return json({ error: "not-found", seg }, 404);
}
