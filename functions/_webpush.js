/* StewardMD — Web Push (VAPID) shared helper.
 * Used by /api/push (subscribe/unsubscribe/status) and /api/updates (send on publish).
 *
 * When a message is supplied, the title/body are delivered in an encrypted aes128gcm
 * payload (RFC-8291) so the banner shows the real update title. Subscriptions without keys
 * (or sends without a message) fall back to a payloadless POST, and the service worker then
 * fetches /api/updates for the newest item. Works on iOS 16.4+ installed PWAs.
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
function b64uToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function concatBytes(...arrs) {
  let n = 0; for (const a of arrs) n += a.length;
  const o = new Uint8Array(n); let p = 0;
  for (const a of arrs) { o.set(a, p); p += a.length; }
  return o;
}
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

// RFC-8291 (Web Push message encryption) + RFC-8188 (aes128gcm content encoding).
// Encrypts `plaintext` (Uint8Array) for a subscription's keys → the request body bytes.
export async function encryptPayload(sub, plaintext) {
  const uaPub = b64uToBytes(sub.keys.p256dh);       // 65-byte UA public key
  const auth = b64uToBytes(sub.keys.auth);          // 16-byte auth secret
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey)); // 65 bytes
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const enc = new TextEncoder();
  const keyInfo = concatBytes(enc.encode("WebPush: info"), new Uint8Array([0]), uaPub, asPub);
  const ikm = await hkdf(auth, shared, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concatBytes(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concatBytes(enc.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concatBytes(plaintext, new Uint8Array([2]));   // 0x02 padding delimiter, single record
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, record));
  const rs = new Uint8Array([0, 0, 0x10, 0x00]);                // record size = 4096
  return concatBytes(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// Notification content from an update item — shared by web + native so both match.
export function buildMsg(item) {
  if (!item) return null;
  const body = (item.body && String(item.body).trim())
    ? String(item.body).trim().slice(0, 140)
    : ((item.source ? item.source + " · " : "") + (item.category || "update"));
  return { title: item.title || "StewardMD", body, url: item.url || "/", tag: item.id ? "smd-" + item.id : "smd-update" };
}

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

// Send a VAPID push to every stored subscription. When `msg` is given and the subscription
// has keys, the title/body ride along in an encrypted aes128gcm payload so the banner shows
// the real update title (the service worker reads e.data). Otherwise falls back to payloadless
// (the SW fetches /api/updates). Prunes dead subscriptions (404/410).
export async function sendPushToAll(env, msg) {
  if (!pushEnabled(env)) return { sent: 0, total: 0, disabled: true };
  const subs = await listSubscriptions(env);
  const store = pushKv(env);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const jwt = await vapidJwt(env, new URL(s.endpoint).origin);
      const headers = { "Authorization": "vapid t=" + jwt + ", k=" + env.VAPID_PUBLIC_KEY, "TTL": "86400" };
      let body;
      if (msg && s.keys && s.keys.p256dh && s.keys.auth) {
        body = await encryptPayload(s, new TextEncoder().encode(JSON.stringify(msg)));
        headers["Content-Encoding"] = "aes128gcm";
        headers["Content-Type"] = "application/octet-stream";
      }
      const res = await fetch(s.endpoint, { method: "POST", headers, body });
      if (res.status === 404 || res.status === 410) { await store.delete(s.key); }
      else if (res.ok || res.status === 201 || res.status === 202) sent++;
    } catch (e) { /* skip this endpoint */ }
  }));
  return { sent, total: subs.length };
}
