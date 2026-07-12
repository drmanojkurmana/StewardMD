/* StewardMD — native device-token store + dispatcher (APNs iOS + FCM Android).
 * Lives alongside the web-push store (_webpush.js) in the same KV. Web push handles
 * PWA / desktop browsers; this handles the native Capacitor apps where Web Push is
 * unavailable (notably iOS, where Web Push does not work inside a WKWebView).
 *
 * Token record: { token, platform: "ios"|"android", uid|null, ts }
 */
import { pushKv } from "./_webpush.js";
import { apnsConfigured, sendApns } from "./_apns.js";
import { fcmConfigured, sendFcm } from "./_fcm.js";

const NAT_PREFIX = "push:native:";

export function nativePushEnabled(env) { return !!(pushKv(env) && (apnsConfigured(env) || fcmConfigured(env))); }

async function tokenId(token) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function saveNativeToken(env, rec) {
  const store = pushKv(env);
  if (!store || !rec || !rec.token || !rec.platform) return false;
  await store.put(NAT_PREFIX + (await tokenId(rec.token)),
    JSON.stringify({ token: rec.token, platform: rec.platform, uid: rec.uid || null, workspaces: Array.isArray(rec.workspaces) ? rec.workspaces : [], ts: Date.now() }));
  return true;
}
export async function deleteNativeToken(env, token) {
  const store = pushKv(env);
  if (!store || !token) return;
  await store.delete(NAT_PREFIX + (await tokenId(token)));
}
export async function listNativeTokens(env) {
  const store = pushKv(env);
  if (!store || !store.list) return [];
  const out = []; let cursor;
  do {
    const r = await store.list({ prefix: NAT_PREFIX, cursor });
    for (const k of r.keys) { const v = await store.get(k.name, "json"); if (v && v.token) out.push({ key: k.name, ...v }); }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

/* Fan a single alert out to every stored native token. Prunes dead tokens.
 * msg = { title, body, url, tag }. opts.uid targets one user's devices; opts.workspace
 * targets subscribers of that workspace (legacy tokens with no workspaces = all). */
export async function sendNativeToAll(env, msg, opts) {
  if (!nativePushEnabled(env)) return { sent: 0, total: 0, disabled: true };
  msg = msg || {};
  let toks = await listNativeTokens(env);
  if (opts && opts.uid) toks = toks.filter((t) => t.uid === opts.uid);
  if (opts && opts.workspace) toks = toks.filter((t) => !t.workspaces || !t.workspaces.length || t.workspaces.indexOf(opts.workspace) >= 0);
  const store = pushKv(env);
  let sent = 0;
  await Promise.all(toks.map(async (t) => {
    try {
      let r;
      if (t.platform === "ios") { if (!apnsConfigured(env)) return; r = await sendApns(env, t.token, msg); }
      else if (t.platform === "android") { if (!fcmConfigured(env)) return; r = await sendFcm(env, t.token, msg); }
      else return;
      if (r && r.ok) sent++;
      else if (r && r.prune) await store.delete(t.key);
    } catch (e) { /* skip this token */ }
  }));
  return { sent, total: toks.length };
}
