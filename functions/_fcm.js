/* StewardMD — Firebase Cloud Messaging (FCM HTTP v1) sender for Android device tokens.
 * @capacitor/push-notifications on Android returns an FCM registration token; we send
 * to it via the FCM HTTP v1 API, authorised with a Google service-account OAuth token.
 *
 * Config (Cloudflare env / secrets):
 *   FCM_SERVICE_ACCOUNT  the service-account JSON (as a string) from Firebase console →
 *                        Project settings → Service accounts → Generate new private key. SECRET.
 *                        Must contain client_email, private_key, project_id.
 *
 * The existing app already uses Firebase project stewardmd-498ec, so this reuses it.
 */
export function fcmConfigured(env) { return !!env.FCM_SERVICE_ACCOUNT; }

function svcAccount(env) {
  return typeof env.FCM_SERVICE_ACCOUNT === "string" ? JSON.parse(env.FCM_SERVICE_ACCOUNT) : env.FCM_SERVICE_ACCOUNT;
}

function b64u(buf) {
  let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uStr(str) { return b64u(new TextEncoder().encode(str)); }
function pemToDer(pem) {
  const body = String(pem).replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const raw = atob(body); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

// OAuth2 access token (JWT-bearer grant, RS256), cached per isolate (~1h validity).
let _at = null, _atExp = 0;
async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_at && now < _atExp - 120) return _at;
  const sa = svcAccount(env);
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const claim = {
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  };
  const input = b64uStr(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64uStr(JSON.stringify(claim));
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(input));
  const assertion = input + "." + b64u(sig);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + encodeURIComponent(assertion),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("fcm-oauth-failed");
  _at = j.access_token; _atExp = now + (j.expires_in || 3600);
  return _at;
}

/* Send one alert to one Android FCM token.
 * Returns { ok } or { prune } when FCM reports the token is unregistered/invalid. */
export async function sendFcm(env, token, msg) {
  const at = await accessToken(env);
  const sa = svcAccount(env);
  const body = JSON.stringify({
    message: {
      token,
      notification: { title: msg.title || "StewardMD", body: msg.body || "" },
      data: { url: msg.url || "/", tag: msg.tag || "smd" },
      android: { priority: "high" },
    },
  });
  const res = await fetch("https://fcm.googleapis.com/v1/projects/" + sa.project_id + "/messages:send", {
    method: "POST", headers: { "authorization": "Bearer " + at, "Content-Type": "application/json" }, body,
  });
  if (res.ok) return { ok: true };
  let err = {}; try { err = (await res.json()).error || {}; } catch (e) {}
  const status = err.status || "";
  const prune = res.status === 404 || status === "NOT_FOUND" || status === "UNREGISTERED" || status === "INVALID_ARGUMENT";
  return { ok: false, httpStatus: res.status, status, prune };
}
