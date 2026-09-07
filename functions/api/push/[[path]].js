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
import { saveNativeToken, deleteNativeToken, sendNativeToAll, nativePushEnabled, listNativeTokens } from "../../_nativepush.js";
import { identify } from "../../_fbauth.js";
import { ownerOK } from "../../_adminauth.js";
import { escalateOverdueTask, sweepOverdue, isGroupMember, notifyNewInstruction, notifyCriticalValue, remindTask } from "../../_taskpush.js";
import { saveReceipt, listReceipts } from "../../_wardsynq_receipts.js";

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
    // Device identity, captured for IDENTIFICATION ONLY. Nothing below changes who a push is sent
    // to: fan-out is still every active token for the account. This exists so a human can later
    // look at a list and say which handset a registration belongs to, which was impossible before -
    // six iOS tokens on one account were indistinguishable from six different iPhones, so nothing
    // could be safely pruned.
    const okSave = await saveNativeToken(env, {
      token: body.token, platform: body.platform, uid,
      workspaces: cleanWorkspaces(body.workspaces),
      device: body.device,
    });
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
  // Critical value recorded → alert the WHOLE unit immediately (Tier-1, bypasses prefs). Member-triggered.
  if (method === "POST" && seg === "critical") {
    if (!nativePushEnabled(env)) return json({ error: "push-disabled" }, 501);
    const uid = await identify(request, env);
    if (!uid) return json({ error: "auth-required" }, 401);
    let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
    const { gid, pid } = body;
    if (!gid || !pid) return json({ error: "bad-args" }, 400);
    if (!(await isGroupMember(env, gid, uid))) return json({ error: "not-a-member" }, 403);
    const res = await notifyCriticalValue(env, gid, pid, uid, { label: body.label, value: body.value, unit: body.unit, bed: body.bed, reason: body.reason });
    return json(res || { error: "failed" });
  }
  // ── WardSynQ escalation channel (HAZ-DET-01) ────────────────────────────────────────────────
  // Additive: nothing above this block changes. A WardSynQ notice is pushed to the caller's OWN
  // registered devices, and the handset posts back a receipt so "delivered" can mean a phone
  // actually has it rather than a gateway having accepted bytes.
  if (method === "POST" && seg === "wardsynq-alert") {
    if (!nativePushEnabled(env)) return json({ error: "push-disabled" }, 501);
    const uid = await identify(request, env);
    if (!uid) return json({ error: "auth-required" }, 401);
    let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
    if (!body.title) return json({ error: "bad-args" }, 400);
    const data = body.data || {};
    if (!data.noticeId) return json({ error: "no-notice-id" }, 400);
    // Scoped to the caller's own devices. Fanning a clinical alert to a whole unit is a policy
    // decision that belongs to the escalation ladder, not to a transport endpoint.
    const res = await sendNativeToAll(env, {
      title: String(body.title).slice(0, 200),
      body: String(body.body || "").slice(0, 500),
      data,
    }, { uid });
    // `sent` counts gateway acceptances. It is reported as such and the client turns it into SENT,
    // never DELIVERED.
    return json({ sent: res.sent || 0, total: res.total || 0 });
  }
  // The caller's OWN registered devices. Read-only, and deliberately so: this exists to make the
  // registrations identifiable, not to remove them. The token itself is never returned - it is a
  // device credential, and an 8-character fingerprint is enough to tell two rows apart.
  if (method === "GET" && seg === "devices") {
    const uid = await identify(request, env);
    if (!uid) return json({ error: "auth-required" }, 401);
    const all = await listNativeTokens(env);
    const mine = all.filter((t) => t.uid === uid).map((t) => ({
      fingerprint: String(t.token || "").slice(0, 8),
      platform: t.platform,
      apnsEnv: t.apnsEnv || null,
      lastSeen: t.ts ? new Date(t.ts).toISOString() : null,
      firstSeen: (t.device && t.device.firstSeen) || null,
      label: (t.device && t.device.label) || null,
      model: (t.device && t.device.model) || null,
      osVersion: (t.device && t.device.osVersion) || null,
      appVersion: (t.device && t.device.appVersion) || null,
      installId: (t.device && t.device.installId) || null,
      // Registrations made before identity was captured. Stated rather than left as blanks, so a
      // reader does not mistake "we never recorded this" for "this device reported nothing".
      identified: !!(t.device && t.device.installId),
    })).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
    return json({ devices: mine, total: mine.length });
  }
  // The handset confirming what actually happened to it: received, opened, acknowledged.
  if (method === "POST" && seg === "wardsynq-receipt") {
    const uid = await identify(request, env);
    if (!uid) return json({ error: "auth-required" }, 401);
    let body = {}; try { body = (await request.json()) || {}; } catch (e) {}
    const out = await saveReceipt(env, uid, body);
    return json(out, out.ok ? 200 : 400);
  }
  // The workstation that raised the alert, polling those receipts back.
  if (method === "GET" && seg === "wardsynq-receipts") {
    const uid = await identify(request, env);
    if (!uid) return json({ error: "auth-required" }, 401);
    const since = new URL(request.url).searchParams.get("since") || null;
    return json({ receipts: await listReceipts(env, uid, since) });
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
