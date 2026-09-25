/* StewardMD — Firebase ID-token and Cloudflare Access JWT verification (shared).
 * RS256 verification against the issuer's public JWK set. Returns the caller's stable
 * per-user id, or null if unauthenticated. Used to scope per-user data (saved cases,
 * push tokens, lab-watch alerts) so one account can never receive another's alerts.
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

// JWK sets by URL (Google securetoken for Firebase, the team's /cdn-cgi/access/certs for Access),
// cached per the response's max-age.
const _jwks = new Map();
async function getJwks(url) {
  const now = Date.now(), hit = _jwks.get(url);
  if (hit && now < hit.exp) return hit.map;
  const r = await fetch(url);
  const data = await r.json();
  const map = {};
  for (const k of (data.keys || [])) map[k.kid] = k;
  const cc = r.headers.get("Cache-Control") || "", m = cc.match(/max-age=(\d+)/);
  _jwks.set(url, { map, exp: now + (m ? parseInt(m[1], 10) * 1000 : 3600 * 1000) });
  return map;
}

// A compact RS256 JWT as { parts, header, payload }, or null when it is not one.
function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64urlToString(parts[0])), payload = JSON.parse(b64urlToString(parts[1]));
    return (header.alg === "RS256" && header.kid && payload && typeof payload === "object") ? { parts, header, payload } : null;
  } catch (e) { return null; }
}
// The RS256 signature check, against the kid's key in the JWK set at jwksUrl.
async function signatureOk(jwt, jwksUrl) {
  const jwk = (await getJwks(jwksUrl))[jwt.header.kid];
  if (!jwk) return false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(jwt.parts[2]),
      new TextEncoder().encode(jwt.parts[0] + "." + jwt.parts[1]));
  } catch (e) { return false; }
}

/* The verified token payload — uid PLUS the custom claims (name, regNo, verified) that say who the
 * prescriber is. Identical checks to verifyFirebaseToken, which is now a thin wrapper over this.
 *
 * Split out because returning only `sub` let a caller that wanted the claims fail SILENTLY instead
 * of loudly: a bare uid string carries the legacy String.prototype.sub method, so a
 * `if (!claims.sub) reject` guard sees a function, happily passes, and every claim then reads as
 * undefined. functions/api/rx/issue.js recorded prescriptions with a blank prescriber that way.
 */
export async function verifyFirebaseClaims(token, env) {
  const project = env.FIREBASE_PROJECT_ID || FB_PROJECT_DEFAULT;
  const jwt = parseJwt(token);
  if (!jwt) return null;
  const payload = jwt.payload, now = Math.floor(Date.now() / 1000);
  if (payload.aud !== project) return null;
  if (payload.iss !== "https://securetoken.google.com/" + project) return null;
  if (!payload.sub) return null;
  if (!(typeof payload.exp === "number" && payload.exp > now)) return null;
  if (typeof payload.iat === "number" && payload.iat > now + 300) return null;
  return (await signatureOk(jwt, JWK_URL)) ? payload : null;
}

/* The uid alone — what _features.js, _adminauth.js and _entitlement.js have always wanted. Kept as
 * a string return so those callers are untouched by the split above. */
export async function verifyFirebaseToken(token, env) {
  const claims = await verifyFirebaseClaims(token, env);
  return claims ? claims.sub : null;
}

/* Verified Firebase claims for THIS request's bearer token, memoised per Request object so the
 * several gates one request passes through (authorise, identify, owner, entitlement) verify the token
 * once, not five times. null when there is no token or it does not verify; never throws (a JWKS
 * fetch failure is "not verified", and callers fall through to their unauthenticated path). */
const _claimsMemo = new WeakMap();
export function verifiedClaimsFor(request, env) {
  if (!request || typeof request !== "object") return Promise.resolve(null);
  let p = _claimsMemo.get(request);
  if (!p) {
    const tok = ((request.headers && request.headers.get("Authorization")) || "").replace(/^Bearer\s+/i, "");
    p = tok ? verifyFirebaseClaims(tok, env).catch(() => null) : Promise.resolve(null);
    _claimsMemo.set(request, p);
  }
  return p;
}

/* The Cloudflare Access email, from a VERIFIED Cf-Access-Jwt-Assertion; "" otherwise.
 *
 * Neither Cf-Access header proves anything by being present: on a route Cloudflare Access does not
 * front, both are strings any client can send. The email header alone used to be trusted by ~25
 * routes (and after T28, any value in the assertion header was enough). So the assertion is verified
 * like a Firebase token: RS256 against the team's /cdn-cgi/access/certs, iss = the team domain, aud =
 * one of the Access application AUD tags, unexpired. The email comes from the verified claims; the
 * Cf-Access-Authenticated-User-Email header is never read.
 *
 * Config (both required; unset means Access identity is OFF and callers fall through to Firebase):
 *   CF_ACCESS_TEAM_DOMAIN  e.g. "<team>.cloudflareaccess.com"
 *   CF_ACCESS_AUD          the Access application's AUD tag (comma-separated for several apps)
 * Memoised per Request, like verifiedClaimsFor. Never throws.
 *
 * Tests: test/helpers/trust-cf-access-header.mjs sets globalThis.__SMD_TEST_TRUST_CF_ACCESS_HEADER so
 * the in-process suites keep using the email header as their identity. Nothing under functions/ sets
 * it, and a request cannot reach a Worker's globals. */
const _accessMemo = new WeakMap();
export function cfAccessEmail(request, env) {
  const h = request && typeof request === "object" && request.headers;
  if (!h) return Promise.resolve("");
  if (globalThis.__SMD_TEST_TRUST_CF_ACCESS_HEADER === true) return Promise.resolve(String(h.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase());
  let p = _accessMemo.get(request);
  if (!p) {
    p = verifyAccessJwt(h.get("Cf-Access-Jwt-Assertion"), env || {}).catch(() => "");
    _accessMemo.set(request, p);
  }
  return p;
}

async function verifyAccessJwt(token, env) {
  const team = String(env.CF_ACCESS_TEAM_DOMAIN || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const auds = String(env.CF_ACCESS_AUD || "").split(",").map((a) => a.trim()).filter(Boolean);
  if (!team || !auds.length || !token) return "";
  const jwt = parseJwt(token);
  if (!jwt) return "";
  const p = jwt.payload, now = Math.floor(Date.now() / 1000);
  if (p.iss !== "https://" + team) return "";
  if (!(Array.isArray(p.aud) ? p.aud : [p.aud]).some((a) => auds.indexOf(a) >= 0)) return "";
  if (!(typeof p.exp === "number" && p.exp > now)) return "";
  if (typeof p.nbf === "number" && p.nbf > now + 300) return "";
  if (typeof p.email !== "string" || !p.email) return "";   // a service token carries no email: not a user
  return (await signatureOk(jwt, "https://" + team + "/cdn-cgi/access/certs")) ? p.email.toLowerCase() : "";
}

// Stable, namespaced per-user id — or null if the caller is not authenticated.
// Access only when its JWT verifies (cfAccessEmail), else a verified Firebase token.
export async function identify(request, env) {
  const email = await cfAccessEmail(request, env);
  if (email) return "cfa:" + email;
  const fb = await verifiedClaimsFor(request, env);
  return fb && fb.sub ? "fb:" + fb.sub : null;
}
