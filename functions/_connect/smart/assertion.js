// functions/_connect/smart/assertion.js — SMART private_key_jwt client-assertion signer (DUAL-ADVERSARIAL).
// Sign-side mirror of abdm/jws.js: asymmetric-ONLY, frozen alg table -> alg:none and the whole HMAC family
// can NEVER be selected (structural). aud === the token endpoint the caller will POST to; exp <= now+300;
// jti a fresh UUID; the private key JWK is used only to importKey and never logged/returned/embedded.
export class AssertionError extends Error {}

export const SIGN_ALG = Object.freeze({
  RS384: { importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" }, signParams: { name: "RSASSA-PKCS1-v1_5" } },
  ES384: { importParams: { name: "ECDSA", namedCurve: "P-384" }, signParams: { name: "ECDSA", hash: "SHA-384" } },
  // // VERIFY: some servers accept RS256/ES256 — additions stay in this table (asymmetric-only, never HMAC/none).
});

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

export async function signClientAssertion(deps, { clientId, tokenEndpoint, privateKeyJwk, kid, alg, jti, ttlSec }) {
  const spec = SIGN_ALG[alg];
  if (!spec) throw new AssertionError("unsupported alg (asymmetric-only): " + String(alg));   // before any key touch
  if (!clientId || !tokenEndpoint || !privateKeyJwk || !kid) throw new AssertionError("clientId, tokenEndpoint, privateKeyJwk, kid required");
  const nowMs = deps && typeof deps.now === "function" ? deps.now() : Date.now();              // injected clock
  const iat = Math.floor(nowMs / 1000);
  const header = { alg, kid, typ: "JWT" };
  const claims = { iss: clientId, sub: clientId, aud: tokenEndpoint, iat, nbf: iat, exp: iat + Math.min(ttlSec || 300, 300), jti: jti || (crypto.randomUUID ? crypto.randomUUID() : String(iat) + "-" + Math.random().toString(36).slice(2)) };
  const data = b64urlStr(JSON.stringify(header)) + "." + b64urlStr(JSON.stringify(claims));
  let key;
  try { key = await crypto.subtle.importKey("jwk", privateKeyJwk, spec.importParams, false, ["sign"]); }
  catch (e) { throw new AssertionError("invalid private key jwk"); }                            // no key material in the message
  const sig = await crypto.subtle.sign(spec.signParams, key, new TextEncoder().encode(data));
  return data + "." + b64url(sig);
}
