/* StewardMD — Firebase ID-token verification (shared).
 * RS256 verification against Google's public JWK set. Returns the caller's stable
 * per-user id, or null if unauthenticated. Used to scope per-user data (saved cases,
 * push tokens, lab-watch alerts) so one account can never receive another's alerts.
 *
 * (Logic mirrors functions/api/cases/[[path]].js so both stay consistent.)
 */
const FB_PROJECT_DEFAULT = "stewardmd-498ec";
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function b64urlToString(s) { return new TextDecoder().decode(b64urlToBytes(s)); }

let _jwks = null, _jwksExp = 0;
async function getJwks() {
  const now = Date.now();
  if (_jwks && now < _jwksExp) return _jwks;
  const r = await fetch(JWK_URL);
  const data = await r.json();
  const map = {};
  for (const k of (data.keys || [])) map[k.kid] = k;
  const cc = r.headers.get("Cache-Control") || "", m = cc.match(/max-age=(\d+)/);
  _jwksExp = now + (m ? parseInt(m[1], 10) * 1000 : 3600 * 1000);
  _jwks = map;
  return map;
}

export async function verifyFirebaseToken(token, env) {
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = JSON.parse(b64urlToString(parts[0])); payload = JSON.parse(b64urlToString(parts[1])); }
  catch (e) { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== project) return null;
  if (payload.iss !== "https://securetoken.google.com/" + project) return null;
  if (!payload.sub) return null;
  if (!(typeof payload.exp === "number" && payload.exp > now)) return null;
  if (typeof payload.iat === "number" && payload.iat > now + 300) return null;
  const jwk = (await getJwks())[header.kid];
  if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]));
    return ok ? payload.sub : null;
  } catch (e) { return null; }
}

// Stable, namespaced per-user id — or null if the caller is not authenticated.
export async function identify(request, env) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (email) return "cfa:" + email.toLowerCase();
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (tok) { const uid = await verifyFirebaseToken(tok, env); if (uid) return "fb:" + uid; }
  return null;
}
