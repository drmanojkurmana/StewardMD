/* StewardMD — Web Push (VAPID) shared helper.
 * Used by /api/push (subscribe/unsubscribe/status) and /api/updates (send on publish).
 *
 * Payloadless push: we send a VAPID-signed POST with NO body to each subscription's
 * endpoint. The service worker's 'push' handler then fetches /api/updates and shows
 * the newest item. This avoids RFC-8291 aes128gcm payload encryption entirely while
 * still delivering a real OS banner. Works on iOS 16.4+ installed PWAs.
 *
 * Config (Cloudflare env):
 *   VAPID_PUBLIC_KEY   base64url of the uncompressed P-256 public key (0x04||x||y)
 *   VAPID_PRIVATE_JWK  JSON JWK of the matching private key ({kty,crv,d,x,y}) — SECRET
 *   VAPID_SUBJECT      optional mailto: (default mailto:admin@stewardmd.in)
 *   Subscriptions live in PUSH_KV (falls back to UPDATES_KV/GHIS_KV/CASES_KV).
 */
const SUB_PREFIX = "push:sub:";

export function pushKv(env) { return env.PUSH_KV || env.UPDATES_KV || env.GHIS_KV || env.CASES_KV || null; }
export function pushEnabled(env) { return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK && pushKv(env)); }

function b64u(buf) { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64uStr(str) { return b64u(new TextEncoder().encode(str)); }

async function endpointId(endpoint) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function saveSubscription(env, sub) {
  const store = pushKv(env);
  if (!store || !sub || !sub.endpoint) return false;
  await store.put(SUB_PREFIX + (await endpointId(sub.endpoint)),
    JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys || null, ts: Date.now() }));
  return true;
}
export async function deleteSubscription(env, endpoint) {
  const store = pushKv(env);
  if (!store || !endpoint) return;
  await store.delete(SUB_PREFIX + (await endpointId(endpoint)));
}
async function listSubscriptions(env) {
  const store = pushKv(env);
  if (!store || !store.list) return [];
  const out = []; let cursor;
  do {
    const r = await store.list({ prefix: SUB_PREFIX, cursor });
    for (const k of r.keys) { const v = await store.get(k.name, "json"); if (v && v.endpoint) out.push({ key: k.name, ...v }); }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

async function importVapidKey(env) {
  const jwk = typeof env.VAPID_PRIVATE_JWK === "string" ? JSON.parse(env.VAPID_PRIVATE_JWK) : env.VAPID_PRIVATE_JWK;
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}
async function vapidJwt(env, audience) {
  const key = await importVapidKey(env);
  const now = Math.floor(Date.now() / 1000);
  const input = b64uStr(JSON.stringify({ typ: "JWT", alg: "ES256" })) + "." +
    b64uStr(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@stewardmd.in" }));
  // WebCrypto ECDSA returns the IEEE-P1363 (raw r||s) signature ES256/JWT expects.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return input + "." + b64u(sig);
}

// Send a payloadless VAPID push to every stored subscription. Prunes dead ones (404/410).
export async function sendPushToAll(env) {
  if (!pushEnabled(env)) return { sent: 0, total: 0, disabled: true };
  const subs = await listSubscriptions(env);
  const store = pushKv(env);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const jwt = await vapidJwt(env, new URL(s.endpoint).origin);
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: { "Authorization": "vapid t=" + jwt + ", k=" + env.VAPID_PUBLIC_KEY, "TTL": "86400" },
      });
      if (res.status === 404 || res.status === 410) { await store.delete(s.key); }
      else if (res.ok || res.status === 201 || res.status === 202) sent++;
    } catch (e) { /* skip this endpoint */ }
  }));
  return { sent, total: subs.length };
}
