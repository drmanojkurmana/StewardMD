/* StewardMD — Web Push subscription API (Cloudflare Pages Function)
 *
 *   GET  /api/push/status        -> { enabled, publicKey }   (client needs publicKey to subscribe)
 *   POST /api/push/subscribe        body={ subscription }             -> { ok }        (web push)
 *   POST /api/push/unsubscribe      body={ endpoint }                 -> { ok }        (web push)
 *   POST /api/push/register-native  body={ token, platform, uid? }    -> { ok }        (native app: APNs/FCM)
 *   POST /api/push/unregister-native body={ token }                   -> { ok }        (native app)
 *   POST /api/push/send             (admin token) -> { web, native }  (manual test blast — both channels)
 *
 * Subscribing/registering is open to any user (it's their own device opting in). Sending is
 * gated by the same UPDATES_ADMIN_TOKEN as the notifications API.
 */
import { saveSubscription, deleteSubscription, sendPushToAll, pushEnabled } from "../../_webpush.js";
import { saveNativeToken, deleteNativeToken, sendNativeToAll, nativePushEnabled } from "../../_nativepush.js";
import { identify } from "../../_fbauth.js";
import { ownerOK } from "../../_adminauth.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});
const WORKSPACES = ["internal_medicine", "surgery", "ent", "ophthalmology", "obstetrics_gynaecology", "urology", "dentistry_omfs", "paediatrics"];
function cleanWorkspaces(v) { return Array.isArray(v) ? v.filter((w) => WORKSPACES.indexOf(w) >= 0) : []; }
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

  if (seg === "status") return json({ enabled: pushEnabled(env), publicKey: env.VAPID_PUBLIC_KEY || null, native: nativePushEnabled(env) });

  if (method === "POST" && seg === "subscribe") {
    let body = {}; try { body = await request.json(); } catch (e) {}
    const sub = body.subscription || body;
    if (!sub || !sub.endpoint) return json({ error: "no-subscription" }, 400);
    const uid = await identify(request, env);                       // null for guests
    const okSave = await saveSubscription(env, sub, { uid, workspaces: cleanWorkspaces(body.workspaces) });
    return okSave ? json({ ok: true }) : json({ error: "store-unavailable" }, 501);
  }
  if (method === "POST" && seg === "unsubscribe") {
    let body = {}; try { body = await request.json(); } catch (e) {}
    const endpoint = body.endpoint || (body.subscription && body.subscription.endpoint);
    if (endpoint) await deleteSubscription(env, endpoint);
    return json({ ok: true });
  }
  if (method === "POST" && seg === "register-native") {
    let body = {}; try { body = await request.json(); } catch (e) {}
    if (!body.token || !body.platform) return json({ error: "no-token" }, 400);
    // Owner comes from the VERIFIED Firebase ID token (Authorization: Bearer …), never
    // from a client-supplied uid — otherwise a device could register under someone
    // else's account and receive their patients' lab alerts. Guests get uid=null
    // (broadcast updates only, never per-patient alerts).
    const uid = await identify(request, env);
    const okSave = await saveNativeToken(env, { token: body.token, platform: body.platform, uid, workspaces: cleanWorkspaces(body.workspaces) });
    return okSave ? json({ ok: true, scoped: !!uid }) : json({ error: "store-unavailable" }, 501);
  }
  if (method === "POST" && seg === "unregister-native") {
    let body = {}; try { body = await request.json(); } catch (e) {}
    if (body.token) await deleteNativeToken(env, body.token);
    return json({ ok: true });
  }
  if (method === "POST" && seg === "send") {
    if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);
    let msg = {}; try { msg = (await request.json()) || {}; } catch (e) {}
    const web = await sendPushToAll(env);
    const native = await sendNativeToAll(env, {
      title: msg.title || "StewardMD", body: msg.body || "New medical update", url: msg.url || "/", tag: msg.tag,
    });
    return json({ ok: true, web, native });
  }
  return json({ error: "not-found", seg }, 404);
}
