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
/// The watchOS app's own APNs topic (its bundle id). Defaults to the phone
/// bundle id + ".watchkitapp" — the watch target's id — so a watch token is
/// pushed on its own topic, not the phone's.
export function apnsWatchBundleId(env) { return env.APNS_WATCH_BUNDLE_ID || (apnsBundleId(env) + ".watchkitapp"); }
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

/* The two APNs hosts, addressable per token rather than only per deployment.
 *
 * A token is only valid against the environment the BUILD was signed for: a Debug or development
 * build registers a sandbox token, a TestFlight or App Store build a production one. APNS_ENV picks
 * one host for the whole deployment, so a development device on a production deployment gets
 * BadDeviceToken and, worse, gets PRUNED - which reads exactly like "push is broken" rather than
 * "wrong environment for this build". Callers can now name the host for one token. */
const APNS_HOSTS = Object.freeze({
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
});

/** The deployment default, unchanged: whatever APNS_ENV says, production unless told otherwise. */
export function apnsDefaultEnvName(env) {
  return (env.APNS_ENV === "sandbox" || env.APNS_ENV === "development") ? "sandbox" : "production";
}

/* Send one alert to one iOS device token.
 * Returns { ok } on success or { prune } when Apple says the token is dead.
 * `apnsEnv` ("production" | "sandbox") overrides the deployment default for THIS token only. */
export async function sendApns(env, deviceToken, msg, topic, apnsEnv) {
  const jwt = await providerJwt(env);
  const payload = {
    aps: {
      alert: { title: msg.title || "StewardMD", body: msg.body || "" },
      sound: "default",
      "thread-id": msg.tag || "smd",
    },
    url: msg.url || "/",
  };
  if (msg.route) payload.route = msg.route;   // watch deep-link target (e.g. "tasks")
  const body = JSON.stringify(payload);
  const host = APNS_HOSTS[apnsEnv] || apnsHost(env);
  const res = await fetch(host + "/3/device/" + deviceToken, {
    method: "POST",
    headers: {
      "authorization": "bearer " + jwt,
      "apns-topic": topic || apnsBundleId(env),
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body,
  });
  if (res.ok) return { ok: true, apnsEnv: apnsEnv || apnsDefaultEnvName(env) };
  let reason = ""; try { reason = (await res.json()).reason || ""; } catch (e) {}
  // 410 Unregistered means the app was uninstalled: dead on BOTH hosts, prune it.
  const unregistered = res.status === 410 || reason === "Unregistered";
  // These two mean "not valid HERE", which is a different claim and is the one that used to destroy
  // a perfectly good development token. It is reported separately so the caller can try the other
  // host before deciding the device is gone.
  const wrongEnvironment = reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic";
  return { ok: false, status: res.status, reason, prune: unregistered, wrongEnvironment };
}
