/* StewardMD — Apple Push Notification service (APNs) sender.
 * Token-based (.p8 auth key) provider JWT (ES256) + HTTP/2 POST to APNs.
 * Used by _nativepush.js for iOS device tokens from @capacitor/push-notifications.
 *
 * Config (Cloudflare env / secrets):
 *   APNS_KEY_P8     the .p8 file CONTENTS (PEM, "-----BEGIN PRIVATE KEY----- …") — SECRET
 *   APNS_KEY_ID     the 10-char Key ID of that .p8 key
 *   APNS_TEAM_ID    your 10-char Apple Developer Team ID
 *   APNS_BUNDLE_ID  the app bundle id / apns-topic (default in.stewardmd.app)
 *   APNS_ENV        "production" (default) or "sandbox" (development builds / TestFlight debug)
 *
 * Cloudflare Workers egress negotiates HTTP/2, which APNs requires. Apple returns
 * 200 on success; 410 (Unregistered) / 400 BadDeviceToken → prune the token.
 */
export function apnsConfigured(env) {
  return !!(env.APNS_KEY_P8 && env.APNS_KEY_ID && env.APNS_TEAM_ID);
}
export function apnsBundleId(env) { return env.APNS_BUNDLE_ID || "in.stewardmd.app"; }
function apnsHost(env) {
  return (env.APNS_ENV === "sandbox" || env.APNS_ENV === "development")
    ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
}

function b64u(buf) {
  let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uStr(str) { return b64u(new TextEncoder().encode(str)); }

// PEM ("-----BEGIN … -----") → DER ArrayBuffer.
function pemToDer(pem) {
  const body = String(pem).replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const raw = atob(body); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

async function importP8(env) {
  return crypto.subtle.importKey("pkcs8", pemToDer(env.APNS_KEY_P8),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

// Provider tokens are valid up to 60 min; cache per isolate and refresh well inside that.
let _tok = null, _tokAt = 0;
async function providerJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_tok && (now - _tokAt) < 45 * 60) return _tok;
  const key = await importP8(env);
  const input = b64uStr(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID })) + "." +
    b64uStr(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  _tok = input + "." + b64u(sig); _tokAt = now;
  return _tok;
}

/* Send one alert to one iOS device token.
 * Returns { ok } on success or { prune } when Apple says the token is dead. */
export async function sendApns(env, deviceToken, msg) {
  const jwt = await providerJwt(env);
  const body = JSON.stringify({
    aps: {
      alert: { title: msg.title || "StewardMD", body: msg.body || "" },
      sound: "default",
      "thread-id": msg.tag || "smd",
    },
    url: msg.url || "/",
  });
  const res = await fetch(apnsHost(env) + "/3/device/" + deviceToken, {
    method: "POST",
    headers: {
      "authorization": "bearer " + jwt,
      "apns-topic": apnsBundleId(env),
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body,
  });
  if (res.ok) return { ok: true };
  let reason = ""; try { reason = (await res.json()).reason || ""; } catch (e) {}
  // 410 Unregistered, or 400 BadDeviceToken/DeviceTokenNotForTopic → stop sending to it.
  const prune = res.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic";
  return { ok: false, status: res.status, reason, prune };
}
