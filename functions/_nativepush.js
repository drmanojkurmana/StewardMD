/* StewardMD — native device-token store + dispatcher (APNs iOS + FCM Android).
 * Lives alongside the web-push store (_webpush.js) in the same KV. Web push handles
 * PWA / desktop browsers; this handles the native Capacitor apps where Web Push is
 * unavailable (notably iOS, where Web Push does not work inside a WKWebView).
 *
 * Token record: { token, platform: "ios"|"android"|"watch", uid|null, ts }
 */
import { pushKv } from "./_webpush.js";
import { apnsConfigured, sendApns, apnsWatchBundleId, apnsDefaultEnvName } from "./_apns.js";
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
  const key = NAT_PREFIX + (await tokenId(rec.token));
  // Keep any APNs environment already LEARNED for this token. Re-registering on app launch must not
  // throw away the knowledge that this handset is a sandbox build, or every launch would re-run the
  // discovery and send one doomed push first.
  let apnsEnv = (rec.apnsEnv === "sandbox" || rec.apnsEnv === "production") ? rec.apnsEnv : null;
  if (!apnsEnv) { try { const prev = await store.get(key, "json"); if (prev && prev.apnsEnv) apnsEnv = prev.apnsEnv; } catch (e) {} }
  await store.put(key,
    JSON.stringify({ token: rec.token, platform: rec.platform, uid: rec.uid || null, workspaces: Array.isArray(rec.workspaces) ? rec.workspaces : [], apnsEnv, ts: Date.now() }));
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

/* Sends to one APNs token in the environment that token actually belongs to.
 *
 * WHY THIS EXISTS. A device token is only valid against the environment its BUILD was signed for.
 * APNS_ENV picks one host for the whole deployment, which is correct for the shipped app and wrong
 * for any development or TestFlight-debug handset registered against the same deployment. Those got
 * BadDeviceToken and were PRUNED, so the device silently stopped receiving anything and the symptom
 * looked like a broken push system rather than a build-environment mismatch.
 *
 * The deployment default is UNCHANGED and is tried first, so nothing about production sending moves:
 * a normal App Store token succeeds on the first attempt exactly as before. Only a token Apple has
 * explicitly rejected as not-valid-here triggers one retry against the other host, and a token that
 * succeeds there has its environment REMEMBERED, so it costs one wasted push per device, once.
 *
 * A 410 Unregistered still prunes immediately: that means the app was uninstalled, which is true on
 * both hosts and is not an environment question. */
async function sendApnsResolvingEnv(env, store, t, msg, topic) {
  const preferred = t.apnsEnv || apnsDefaultEnvName(env);
  let r = await sendApns(env, t.token, msg, topic, preferred);
  if (r && r.ok) return r;
  if (!r || !r.wrongEnvironment) return r;   // a real failure, or already dead: leave it alone

  const other = preferred === "sandbox" ? "production" : "sandbox";
  const r2 = await sendApns(env, t.token, msg, topic, other);
  if (r2 && r2.ok) {
    // Learned. Persist it so this device never pays the wasted first attempt again.
    try { await store.put(t.key, JSON.stringify({ ...t, key: undefined, apnsEnv: other, ts: t.ts || Date.now() })); } catch (e) {}
    return r2;
  }
  // Rejected by BOTH hosts. Now, and only now, is the token genuinely dead.
  if (r2 && (r2.wrongEnvironment || r2.prune)) return { ...r2, prune: true };
  return r2 || r;
}

/* Fan a single alert out to every stored native token. Prunes dead tokens.
 * msg = { title, body, url, tag }. opts.uid targets one user's devices; opts.workspace
 * targets subscribers of that workspace (legacy tokens with no workspaces = all);
 * opts.platform restricts to one platform ("ios"|"watch"|"android"). */
export async function sendNativeToAll(env, msg, opts) {
  if (!nativePushEnabled(env)) return { sent: 0, total: 0, disabled: true };
  msg = msg || {};
  let toks = await listNativeTokens(env);
  if (opts && opts.uid) toks = toks.filter((t) => t.uid === opts.uid);
  if (opts && opts.workspace) toks = toks.filter((t) => !t.workspaces || !t.workspaces.length || t.workspaces.indexOf(opts.workspace) >= 0);
  if (opts && opts.platform) toks = toks.filter((t) => t.platform === opts.platform);
  const store = pushKv(env);
  let sent = 0;
  await Promise.all(toks.map(async (t) => {
    try {
      let r;
      if (t.platform === "ios" || t.platform === "watch") {
        if (!apnsConfigured(env)) return;
        const topic = t.platform === "watch" ? apnsWatchBundleId(env) : undefined;
        r = await sendApnsResolvingEnv(env, store, t, msg, topic);
      }
      else if (t.platform === "android") { if (!fcmConfigured(env)) return; r = await sendFcm(env, t.token, msg); }
      else return;
      if (r && r.ok) sent++;
      else if (r && r.prune) await store.delete(t.key);
    } catch (e) { /* skip this token */ }
  }));
  return { sent, total: toks.length };
}
