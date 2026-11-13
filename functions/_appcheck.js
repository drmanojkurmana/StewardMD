/* functions/_appcheck.js — Firebase App Check token verification for Pages Functions.
 *
 * Interface (agreed with sec-ota-lock / content-key):
 *   verifyAppCheck(request, env) -> Promise<{ ok: boolean, appId?: string, reason?: string }>
 *
 * Reads header X-Firebase-AppCheck (JWT). Verifies RS256 against Google's App Check JWKS when
 * env.FIREBASE_PROJECT_ID (or default) is set. Returns { ok:false } rather than throwing.
 *
 * STUB NOTE (sec-encrypt-data 2026-11-13): the parallel sec-ota-lock job was expected to land the
 * authoritative helper; it was not on that branch yet. This file implements the same interface so
 * /api/content-key can call it. When sec-ota-lock merges a richer verifier, replace this module
 * (keep the export name and return shape).
 *
 * Soft-fail when App Check is not configured (no project / JWKS unreachable): { ok:false, reason }.
 * Callers that accept ID token OR App Check should treat ok:false as "try the other gate".
 */
const FB_PROJECT_DEFAULT = "stewardmd-498ec";
const JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks";

function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

const _jwks = { map: null, exp: 0 };
async function getJwks() {
  const now = Date.now();
  if (_jwks.map && now < _jwks.exp) return _jwks.map;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error("jwks " + r.status);
  const data = await r.json();
  const map = {};
  for (const k of (data.keys || [])) map[k.kid] = k;
  const cc = r.headers.get("Cache-Control") || "", m = cc.match(/max-age=(\d+)/);
  _jwks.map = map;
  _jwks.exp = now + (m ? parseInt(m[1], 10) * 1000 : 3600 * 1000);
  return map;
}

function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64urlToString(parts[0]));
    const payload = JSON.parse(b64urlToString(parts[1]));
    if (header.alg !== "RS256" || !header.kid || !payload || typeof payload !== "object") return null;
    return { parts, header, payload };
  } catch (e) { return null; }
}

async function signatureOk(jwt) {
  const jwk = (await getJwks())[jwt.header.kid];
  if (!jwk) return false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(jwt.parts[2]),
      new TextEncoder().encode(jwt.parts[0] + "." + jwt.parts[1]));
  } catch (e) { return false; }
}

/**
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<{ ok: boolean, appId?: string, reason?: string }>}
 */
export async function verifyAppCheck(request, env) {
  try {
    const h = request && request.headers;
    const token = (h && (h.get("X-Firebase-AppCheck") || h.get("X-Firebase-AppCheck-Token"))) || "";
    if (!token) return { ok: false, reason: "missing" };

    // Test escape hatch used by unit tests only (never set in production Workers).
    if (globalThis.__SMD_TEST_APPCHECK_OK === true) {
      return { ok: true, appId: "test-app" };
    }
    if (typeof globalThis.__SMD_TEST_APPCHECK_OK === "string" && token === globalThis.__SMD_TEST_APPCHECK_OK) {
      return { ok: true, appId: "test-app" };
    }

    const project = (env && env.FIREBASE_PROJECT_ID) || FB_PROJECT_DEFAULT;
    const jwt = parseJwt(token);
    if (!jwt) return { ok: false, reason: "malformed" };
    const p = jwt.payload;
    const now = Math.floor(Date.now() / 1000);
    if (!(typeof p.exp === "number" && p.exp > now)) return { ok: false, reason: "expired" };
    // App Check tokens use aud like "projects/<projectId>" (sometimes an array).
    const aud = p.aud;
    const audOk = Array.isArray(aud)
      ? aud.some((a) => String(a).indexOf(project) >= 0)
      : (typeof aud === "string" && aud.indexOf(project) >= 0);
    if (!audOk) return { ok: false, reason: "aud" };
    if (!(await signatureOk(jwt))) return { ok: false, reason: "sig" };
    const appId = typeof p.app_id === "string" ? p.app_id
      : (typeof p.sub === "string" ? p.sub : undefined);
    return { ok: true, appId: appId };
  } catch (e) {
    return { ok: false, reason: "error" };
  }
}
