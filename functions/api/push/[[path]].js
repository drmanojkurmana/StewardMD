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
import { escalateOverdueTask, sweepOverdue, isGroupMember, notifyNewInstruction, remindTask } from "../../_taskpush.js";

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
  // ── ICU overdue-task escalation → push the whole unit ──────────────────────────────────────────
  // Member-triggered (an open app's heartbeat noticed one of its unit's tasks go overdue). The caller
  // must be a member of the unit; the task must be genuinely overdue + not already escalated (server
  // re-checks, so a client can't fabricate a blast). Pushes every member's devices once.
  if (method === "POST" && seg === "task-overdue") {
    if (!nativePushEnabled(env)) return json({ error: "push-disabled" }, 501);
    const uid = await identify(request, env);
    if (!uid) return json({ error: "auth-required" }, 401);
    let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
    const { gid, pid, taskId } = body;
    if (!gid || !pid || !taskId) return json({ error: "bad-args" }, 400);
    if (!(await isGroupMember(env, gid, uid))) return json({ error: "not-a-member" }, 403);
    const res = await escalateOverdueTask(env, gid, pid, taskId);
    return json(res || { error: "failed" });
  }
  // Self-test: push ONLY the caller's own devices so a solo tester can verify delivery in one tap.
  // The response reveals whether a device token is even registered (total) vs delivered (sent).
  if (method === "POST" && seg === "test") {
    if (!nativePushEnabled(env)) return json({ error: "push-disabled" }, 501);
    const uid = await identify(request, env);
    if (!uid) return json({ error: "auth-required" }, 401);
    const r = await sendNativeToAll(env, { title: "🔔 StewardMD test", body: "Push notifications are working on this device.", tag: "smd-test", url: "https://stewardmd.in/" }, { uid });
    return json({ ok: true, sent: (r && r.sent) || 0, total: (r && r.total) || 0 });
  }
  // New instruction issued → notify the unit IMMEDIATELY (not just when overdue). Member-triggered.
  if (method === "POST" && seg === "instruction") {
    if (!nativePushEnabled(env)) return json({ error: "push-disabled" }, 501);
    const uid = await identify(request, env);
    if (!uid) return json({ error: "auth-required" }, 401);
    let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
    const { gid, pid } = body;
    if (!gid || !pid) return json({ error: "bad-args" }, 400);
    if (!(await isGroupMember(env, gid, uid))) return json({ error: "not-a-member" }, 403);
    const res = await notifyNewInstruction(env, gid, pid, uid, { text: body.text, priority: body.priority, count: body.count, kind: body.kind });
    return json(res || { error: "failed" });
  }
  // On-demand "nudge": re-push a task's reminder to the unit's executor roles. Member-triggered;
  // remindTask enforces that the caller holds an instructing role.
  if (method === "POST" && seg === "task-remind") {
    if (!nativePushEnabled(env)) return json({ error: "push-disabled" }, 501);
    const uid = await identify(request, env);
    if (!uid) return json({ error: "auth-required" }, 401);
    let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
    const { gid, pid, taskId } = body;
    if (!gid || !pid || !taskId) return json({ error: "bad-args" }, 400);
    if (!(await isGroupMember(env, gid, uid))) return json({ error: "not-a-member" }, 403);
    const res = await remindTask(env, gid, pid, taskId, uid, !!body.redo);
    return json(res || { error: "failed" });
  }
  // Cron sweep (X-Admin-Token): scans ALL units for overdue tasks — covers the case where no member's
  // app is open. Wire an external scheduler to POST this (see docs/ICU_OVERDUE_PUSH.md).
  if (method === "POST" && seg === "task-overdue-run") {
    if (adminOK(request, env) !== true) return json({ error: "unauthorised" }, 401);
    const res = await sweepOverdue(env);
    return json(res || { error: "failed" });
  }
  return json({ error: "not-found", seg }, 404);
}
