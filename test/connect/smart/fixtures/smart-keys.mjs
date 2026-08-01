// test/connect/smart/fixtures/smart-keys.mjs — SYNTHETIC, test-only SMART keypairs (never real, never shipped).
// Generated fresh per test run via WebCrypto (deterministic within a run) — asymmetric only (RS384 + ES384),
// matching SMART Backend Services' allowed client-authentication signing algs. The private JWKs are handed to
// the signer under test; the public JWKS is what the adversarial mock token endpoint verifies against.
const KID_RS = "rs384-test-kid";
const KID_ES = "es384-test-kid";

const rsa = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-384" },
  true, ["sign", "verify"]);
const ec = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);

const tag = (jwk, kid) => Object.assign(jwk, { alg: jwk.kty === "RSA" ? "RS384" : "ES384", kid, use: "sig" });

export const RS384_PRIVATE_JWK = tag(await crypto.subtle.exportKey("jwk", rsa.privateKey), KID_RS);
export const RS384_PUBLIC_JWK = tag(await crypto.subtle.exportKey("jwk", rsa.publicKey), KID_RS);
export const ES384_PRIVATE_JWK = tag(await crypto.subtle.exportKey("jwk", ec.privateKey), KID_ES);
export const ES384_PUBLIC_JWK = tag(await crypto.subtle.exportKey("jwk", ec.publicKey), KID_ES);

// The JWKS a real SMART authorization server would fetch from the client's registered jwks_url.
export const JWKS = { keys: [RS384_PUBLIC_JWK, ES384_PUBLIC_JWK] };

export const b64urlToBytes = (s) => {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad), (c) => c.charCodeAt(0));
};

// Verify a compact JWS (h.p.s) against the JWKS, selecting the key by `kid` and enforcing the header alg.
// This is what the mock token endpoint uses so a broken/again-symmetric signer is caught here.
export async function verifyCompactJws(jws, jwks = JWKS) {
  const parts = String(jws || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "not-3-parts" };
  let header; try { header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))); } catch { return { ok: false, reason: "bad-header" }; }
  if (header.alg !== "RS384" && header.alg !== "ES384") return { ok: false, reason: "alg-not-allowed:" + header.alg };
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid && k.alg === header.alg);
  if (!jwk) return { ok: false, reason: "no-key-for-kid" };
  const importParams = header.alg === "RS384" ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" } : { name: "ECDSA", namedCurve: "P-384" };
  const verifyParams = header.alg === "RS384" ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-384" };
  const key = await crypto.subtle.importKey("jwk", jwk, importParams, false, ["verify"]);
  const data = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const ok = await crypto.subtle.verify(verifyParams, key, b64urlToBytes(parts[2]), data);
  if (!ok) return { ok: false, reason: "bad-signature" };
  let claims; try { claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))); } catch { return { ok: false, reason: "bad-claims" }; }
  return { ok: true, header, claims };
}
