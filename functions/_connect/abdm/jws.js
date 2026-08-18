// functions/_connect/abdm/jws.js — ABDM pinned JWS / signature verifier (Stage-4 Task-2, R4).
// SECURITY PRIMITIVE. Shared by Task 4 (ingress body-signature) and Task 5 (artifact JWS). WebCrypto only;
// Node+Workers parity. Dependency-injected (fetch/kv). No env/global Date reads inside verifyJws.
//
// Invariant (R4): keys come ONLY from the pinned JWKS host; `alg:none` and RSA/HMAC key-confusion are
// STRUCTURALLY impossible (the alg allow-list is asymmetric-only and gated BEFORE any key is imported);
// a token-embedded key locator (`jku`/`x5u`, or a `kid` that looks like a URL) is NEVER dereferenced
// (verifyJws performs zero network I/O — it takes no fetch dep); an unavailable JWKS is a HARD fail-closed
// (getPinnedJwks throws — there is no "skip verification" path).
export class JwsError extends Error {}
const subtle = globalThis.crypto.subtle;

// ── The ONLY algorithms this verifier will EVER accept. Asymmetric-only by construction, so `alg:none`
//    and the whole HMAC family (HS256/384/512) can never be selected — an RSA-public-key-as-HMAC-secret
//    confusion attack is rejected at the gate, before a key is ever touched. Adding an HMAC entry here
//    would reintroduce the confusion class, so DON'T.
const ALG = Object.freeze({
  RS256: { kty: "RSA", importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verifyParams: { name: "RSASSA-PKCS1-v1_5" } }, // VERIFY: ABDM signs its gateway/artifact JWS with RS256 (owner must confirm; research WAF-blocked)
  ES256: { kty: "EC", crv: "P-256", importParams: { name: "ECDSA", namedCurve: "P-256" }, verifyParams: { name: "ECDSA", hash: "SHA-256" } },
});

const b64urlToBytes = (s) => {
  if (typeof s !== "string") throw new JwsError("segment not a string");
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4;
  return Uint8Array.from(atob(pad ? t + "=".repeat(4 - pad) : t), (c) => c.charCodeAt(0));
};
const b64urlToStr = (s) => new TextDecoder().decode(b64urlToBytes(s));

// Pull only the cryptographic members into a clean public JWK for import. Never trust the token's alg;
// we validate alg/kty/crv against the SELECTED jwk separately, and hand WebCrypto only {kty,n,e}/{kty,crv,x,y}
// so a stray `use`/`key_ops`/`alg` member on the pinned JWKS can't perturb the import.
function publicJwk(jwk, spec) {
  return spec.kty === "RSA"
    ? { kty: "RSA", n: jwk.n, e: jwk.e }
    : { kty: "EC", crv: jwk.crv, x: jwk.x, y: jwk.y };
}

/**
 * verifyJws(token, { jwks, allowedAlgs }) -> { ok, payload|null, reason? }
 * Never throws; any parse/alg/key/verify failure resolves to { ok:false, payload:null, reason }.
 * Keys are selected BY `kid` ONLY within the SUPPLIED `jwks`; embedded locators are never dereferenced.
 */
export async function verifyJws(token, { jwks, allowedAlgs } = {}) {
  try {
    if (typeof token !== "string") return fail("malformed-token");
    const parts = token.split(".");
    if (parts.length !== 3) return fail("malformed-token");
    const [h64, p64, s64] = parts;
    if (!h64 || !p64) return fail("malformed-token");

    let header;
    try { header = JSON.parse(b64urlToStr(h64)); } catch { return fail("bad-header"); }
    if (!header || typeof header !== "object") return fail("bad-header");

    const alg = header.alg;
    if (alg === "none") return fail("alg-none");                 // explicit, though the allow-list also blocks it
    // Effective allow-list = (caller's list or the full pinned set) INTERSECT the asymmetric-only ALG table.
    // HS*/none can never survive this intersection even if a caller names them → confusion is structural.
    const requested = Array.isArray(allowedAlgs) && allowedAlgs.length ? allowedAlgs : Object.keys(ALG);
    const effective = requested.filter((a) => Object.prototype.hasOwnProperty.call(ALG, a));
    if (typeof alg !== "string" || effective.indexOf(alg) === -1) return fail("alg-not-allowed");
    const spec = ALG[alg];

    if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) return fail("no-jwks");
    const kid = header.kid;
    if (typeof kid !== "string" || !kid) return fail("no-kid");
    // Select BY kid, ONLY within the supplied JWKS. `jku`/`x5u` and a URL-looking kid are just ignored
    // here (opaque string match) — no dereference happens because this function has no network access.
    const candidates = jwks.keys.filter((k) => k && k.kid === kid);
    if (candidates.length === 0) return fail("kid-not-in-jwks");
    // Among same-kid keys pick one compatible with the header alg (kty, curve, and any declared jwk.alg).
    const jwk = candidates.find((k) =>
      k.kty === spec.kty &&
      (spec.kty !== "EC" || k.crv === spec.crv) &&
      (k.alg == null || k.alg === alg));
    if (!jwk) return fail("kty-mismatch");

    let key;
    try { key = await subtle.importKey("jwk", publicJwk(jwk, spec), spec.importParams, false, ["verify"]); }
    catch { return fail("import-failed"); }

    let sig;
    try { sig = b64urlToBytes(s64 || ""); } catch { return fail("bad-signature"); }
    if (sig.length === 0) return fail("bad-signature");

    const data = new TextEncoder().encode(h64 + "." + p64);
    let good;
    try { good = await subtle.verify(spec.verifyParams, key, sig, data); }
    catch { return fail("verify-error"); }
    if (!good) return fail("bad-signature");

    let payload;
    try { payload = JSON.parse(b64urlToStr(p64)); } catch { payload = b64urlToStr(p64); }
    return { ok: true, payload };
  } catch (e) {
    return fail("exception:" + (e && e.message));   // absolute fail-closed backstop — NEVER "valid"
  }
}
function fail(reason) { return { ok: false, payload: null, reason }; }

// ── getPinnedJwks: fetch (+cache) the JWKS from the CONFIGURED, allow-listed ABDM host over TLS only ─────
// VERIFY: ABDM JWKS URL (owner must confirm; research WAF-blocked). Empty by default → verification cannot
// proceed until the owner sets env.ABDM_JWKS_URL (or pins this constant) to an allow-listed https URL.
export const ABDM_JWKS_URL = "";
// The ONLY hosts a JWKS may EVER be fetched from. A configured URL whose host is not here is refused
// (defence-in-depth over env config).
// CONFIRMED live 2026-08-18: the V3 JWKS is GET /api/hiecm/gateway/v3/certs on the gateway host -
// dev.abdm.gov.in in sandbox, apis.abdm.gov.in in production. It returns a standard JWKS (RS256 +
// RS512 RSA keys, use:sig, with kids that match the token headers).
export const ABDM_JWKS_HOSTS = Object.freeze([
  "healthidsbx.abdm.gov.in",
  "dev.abdm.gov.in",        // sandbox gateway
  "apis.abdm.gov.in",       // production gateway
  "sbx.abdm.gov.in",
  "abdm.gov.in",
]);
const JWKS_KV_KEY = "connect:abdm:jwks";   // NON-PHI: public verification keys only (R16)
const JWKS_TTL_SEC = 3600;                 // cache public keys 1h; KV TTL governs rotation

/**
 * getPinnedJwks(env, { fetch, kv }) -> jwks
 * Fail-closed: throws JwsError if the URL is unset, not https, off the host allow-list, unreachable,
 * non-2xx, or empty. Never returns a partial/empty JWKS the caller could mistake for "no keys, proceed".
 */
export async function getPinnedJwks(env, deps = {}) {
  const { fetch: fetchImpl, kv } = deps;
  const raw = (env && env.ABDM_JWKS_URL) || ABDM_JWKS_URL;
  if (!raw) throw new JwsError("ABDM JWKS URL not configured (fail-closed)");
  let u;
  try { u = new URL(raw); } catch { throw new JwsError("ABDM JWKS URL invalid"); }
  if (u.protocol !== "https:") throw new JwsError("ABDM JWKS must be https (TLS only)");
  if (!ABDM_JWKS_HOSTS.includes(u.hostname)) throw new JwsError("ABDM JWKS host not allow-listed: " + u.hostname);

  if (kv) {
    try {
      const cached = await kv.get(JWKS_KV_KEY);
      if (cached) { const c = JSON.parse(cached); if (c && Array.isArray(c.keys) && c.keys.length) return c; }
    } catch { /* corrupt cache → refetch below */ }
  }

  if (typeof fetchImpl !== "function") throw new JwsError("no fetch available for JWKS (fail-closed)");
  let res;
  // The V3 /certs endpoint needs no bearer, but REQUEST-ID / TIMESTAMP / X-CM-ID are MANDATORY:
  // verified live 2026-08-18 - omitting them returns 401, sending them returns 200.
  const headers = {
    accept: "application/json",
    "REQUEST-ID": crypto.randomUUID(),
    TIMESTAMP: new Date().toISOString(),
    "X-CM-ID": (env && (env.ABDM_CM_ID || (String(env.ABDM_ENV || "sandbox").toLowerCase() === "production" ? "abdm" : "sbx"))) || "sbx",
  };
  try { res = await fetchImpl(u.toString(), { method: "GET", headers }); }
  catch (e) { throw new JwsError("JWKS fetch failed: " + (e && e.message)); }
  if (!res || !res.ok) throw new JwsError("JWKS HTTP " + (res ? res.status : "no-response"));
  let jwks;
  try { jwks = await res.json(); } catch { throw new JwsError("JWKS not JSON"); }
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) throw new JwsError("JWKS has no keys");
  if (kv) { try { await kv.put(JWKS_KV_KEY, JSON.stringify(jwks), { expirationTtl: JWKS_TTL_SEC }); } catch { /* best-effort */ } }
  return jwks;
}
