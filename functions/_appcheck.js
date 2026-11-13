/* functions/_appcheck.js — Firebase App Check JWT verification (shared).
 *
 * Reads X-Firebase-AppCheck, verifies RS256 against Google's App Check JWKS, and checks
 * iss / aud / exp for this Firebase project. WebCrypto only — no new dependency.
 *
 * Project number comes from env FIREBASE_PROJECT_NUMBER (GCM_SENDER_ID in
 * ios/App/App/GoogleService-Info.plist = 911280405587).
 */
const JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks";
const JWKS_TTL_MS = 6 * 3600 * 1000;
const PROJECT_NUMBER_DEFAULT = "911280405587";

function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function b64urlToString(s) { return new TextDecoder().decode(b64urlToBytes(s)); }

let _mem = null;   // { map, exp }

/** Test hook — drop the isolate cache between cases. */
export function resetAppCheckJwksCache() { _mem = null; _lastForced = 0; }

function projectNumber(env) {
  const n = env && (env.FIREBASE_PROJECT_NUMBER || env.APPCHECK_PROJECT_NUMBER);
  return String(n || PROJECT_NUMBER_DEFAULT).trim();
}

async function getJwks(skipEdge) {
  const now = Date.now();
  if (_mem && now < _mem.exp) return _mem.map;

  const edge = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (edge && !skipEdge) {
    try {
      const hit = await edge.match(JWKS_URL);
      if (hit) {
        const data = await hit.clone().json();
        const map = {};
        for (const k of (data.keys || [])) if (k && k.kid) map[k.kid] = k;
        _mem = { map, exp: now + JWKS_TTL_MS };
        return map;
      }
    } catch (e) { /* fall through to network */ }
  }

  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error("appcheck-jwks-fetch-failed");
  const data = await r.json();
  const map = {};
  for (const k of (data.keys || [])) if (k && k.kid) map[k.kid] = k;
  _mem = { map, exp: now + JWKS_TTL_MS };

  if (edge) {
    try {
      const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + Math.floor(JWKS_TTL_MS / 1000) };
      await edge.put(JWKS_URL, new Response(JSON.stringify(data), { headers }));
    } catch (e) { /* best effort */ }
  }
  return map;
}

function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64urlToString(parts[0]));
    const payload = JSON.parse(b64urlToString(parts[1]));
    // Reject alg:none and anything that is not RS256 before touching crypto.
    if (!header || header.alg !== "RS256" || !header.kid || !payload || typeof payload !== "object") return null;
    return { parts, header, payload };
  } catch (e) { return null; }
}

let _lastForced = 0;
async function signatureOk(jwt) {
  let jwk = (await getJwks())[jwt.header.kid];
  // Google rotates App Check keys: an unknown kid refetches the JWKS, at most once a minute per isolate.
  if (!jwk && Date.now() - _lastForced > 60000) { _lastForced = Date.now(); _mem = null; jwk = (await getJwks(true))[jwt.header.kid]; }
  if (!jwk) return false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlToBytes(jwt.parts[2]),
      new TextEncoder().encode(jwt.parts[0] + "." + jwt.parts[1])
    );
  } catch (e) { return false; }
}

function audContains(aud, want) {
  const list = Array.isArray(aud) ? aud : [aud];
  return list.some((a) => a === want);
}

/**
 * Verify the App Check token on this request.
 * @returns {Promise<object|null>} verified payload, or null when missing/invalid
 */
export async function verifyAppCheck(request, env) {
  try {
    const token = request && request.headers && request.headers.get("X-Firebase-AppCheck");
    if (!token) return null;
    const jwt = parseJwt(token);
    if (!jwt) return null;
    const num = projectNumber(env);
    const p = jwt.payload;
    const now = Math.floor(Date.now() / 1000);
    if (p.iss !== "https://firebaseappcheck.googleapis.com/" + num) return null;
    if (!audContains(p.aud, "projects/" + num)) return null;
    if (!(typeof p.exp === "number" && p.exp > now)) return null;
    return (await signatureOk(jwt)) ? p : null;
  } catch (e) {
    return null;
  }
}

export const APPCHECK_JWKS_URL = JWKS_URL;
export const APPCHECK_PROJECT_NUMBER_DEFAULT = PROJECT_NUMBER_DEFAULT;
