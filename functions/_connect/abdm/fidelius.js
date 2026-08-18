// functions/_connect/abdm/fidelius.js — ABDM "Fidelius" E2E crypto (spec §4). WebCrypto only; Node+Workers parity.
export class FideliusError extends Error {}
const subtle = globalThis.crypto.subtle;

export function randomBytes(n) { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }

export async function generateKeyPair() {
  let kp, raw;
  try {
    kp = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    raw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  } catch (e) { throw new FideliusError("keygen failed: " + e.message); }
  if (raw.length !== 32) throw new FideliusError("unexpected X25519 public key length");
  return { privateKey: kp.privateKey, publicKeyRaw: raw };
}

export async function sharedSecret(privateKey, peerPublicRaw) {
  if (!(peerPublicRaw instanceof Uint8Array) || peerPublicRaw.length !== 32) throw new FideliusError("peer public key must be 32 bytes");
  let pub;
  try { pub = await subtle.importKey("raw", peerPublicRaw, { name: "X25519" }, false, []); }
  catch (e) { throw new FideliusError("invalid peer public key: " + e.message); }
  let bits;
  try { bits = new Uint8Array(await subtle.deriveBits({ name: "X25519", public: pub }, privateKey, 256)); }
  catch (e) { throw new FideliusError("ECDH failed: " + e.message); }
  // RFC 7748 contributory behaviour: a low-order peer point yields an all-zero secret — reject it.
  if (bits.every((b) => b === 0)) throw new FideliusError("low-order/all-zero shared secret rejected");
  return bits;
}

export function nonce() { return randomBytes(32); }

// ── ABDM wire codec for public keys ───────────────────────────────────────────────────────────────
// ABDM's "Curve25519" is the SHORT-WEIERSTRASS named curve (BouncyCastle's `curve25519`), so a wire
// public key is base64(0x04 || X(32) || Y(32)) BIG-endian - 65 bytes - not the bare 32-byte
// little-endian Montgomery u that WebCrypto X25519 exports. Confirmed against the official swagger
// example (see docs/connect/abdm/V3-SPEC-RECONCILIATION.md D4): that point satisfies the Weierstrass
// equation y^2 = x^3 + ax + b, and maps onto the Montgomery curve exactly via u = x - A/3 (mod P).
// The spec also accepts an x509PublicKey encoding; uncompressed is the documented recommendation.
const P = 57896044618658097711785492504343953926634992332820282019728792003956564819949n; // 2^255-19
const A_OVER_3 = 19298681539552699237261830834781317975544997444273427339909597334652188435537n; // 486662/3 mod P
const W_A = 19298681539552699237261830834781317975544997444273427339909597334573241639236n;
const W_B = 55751746669818908907645289078257140818241103727901012315294400837956729358436n;

const beToBig = (u8) => u8.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
function bigToBe32(n) {
  const o = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { o[i] = Number(n & 0xffn); n >>= 8n; }
  return o;
}
// P ≡ 5 (mod 8): candidate = a^((P+3)/8), corrected by 2^((P-1)/4) when it squares to -a.
function sqrtModP(a) {
  let x = powMod(a, (P + 3n) / 8n);
  if ((x * x - a) % P !== 0n) x = (x * powMod(2n, (P - 1n) / 4n)) % P;
  return ((x * x - a) % P === 0n) ? x : null;
}
function powMod(b, e) { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; } return r; }

/** ABDM wire public key (base64, 65-byte uncompressed point) -> 32-byte little-endian X25519 raw. */
export function abdmKeyToX25519(b64OrBytes) {
  const raw = (b64OrBytes instanceof Uint8Array) ? b64OrBytes : unb64(String(b64OrBytes).trim());
  if (raw.length === 32) return raw;                     // already an X25519 raw key - pass through
  if (raw.length !== 65 || raw[0] !== 0x04) throw new FideliusError("unsupported ABDM public key encoding");
  const x = beToBig(raw.subarray(1, 33)), y = beToBig(raw.subarray(33, 65));
  if ((y * y - (x * x % P * x % P + W_A * x + W_B)) % P !== 0n) throw new FideliusError("ABDM public key is not on curve25519");
  return bigToBe32((x - A_OVER_3 + P) % P).reverse();     // Weierstrass x -> Montgomery u, LE for WebCrypto
}

/** 32-byte little-endian X25519 raw -> ABDM wire public key (base64, 65-byte uncompressed point). */
export function x25519KeyToAbdm(raw32) {
  if (!(raw32 instanceof Uint8Array) || raw32.length !== 32) throw new FideliusError("X25519 raw key must be 32 bytes");
  const u = beToBig(Uint8Array.from(raw32).reverse());    // LE -> BE
  const x = (u + A_OVER_3) % P;
  const y = sqrtModP((x * x % P * x % P + W_A * x + W_B) % P);
  if (y === null) throw new FideliusError("no valid Y for derived Weierstrass X");
  // Either root is correct on the wire: (x,-y) = -(x,y), and k·(-Point) = -(k·Point), which shares the
  // same x - so the ECDH result the peer derives is identical whichever root we publish.
  const out = new Uint8Array(65); out[0] = 0x04; out.set(bigToBe32(x), 1); out.set(bigToBe32(y), 33);
  return b64(out);
}

/**
 * Weierstrass x of the shared point, given the Montgomery u that X25519 returns.
 * NOT WIRED IN YET - see D4. BouncyCastle's ECDHBasicAgreement returns the x-coordinate on the curve
 * it operates on (Weierstrass x), whereas X25519 deriveBits returns the Montgomery u; they differ by
 * exactly A/3. If that is what Fidelius feeds to HKDF, sealBundle/openEntry must apply this first or
 * every decryption fails with no useful error. MUST be settled with known-answer vectors from
 * github.com/mgrmtech/fidelius-cli (or a live sandbox round-trip) before enabling the HIP serve path.
 */
export function montgomeryUToWeierstrassX(secret32) {
  if (!(secret32 instanceof Uint8Array) || secret32.length !== 32) throw new FideliusError("shared secret must be 32 bytes");
  return bigToBe32((beToBig(secret32) + A_OVER_3) % P);
}

function xor(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] ^ b[i]; return o; }

export async function deriveKeyIv(secret, ourNonce, theirNonce) {
  if (ourNonce.length !== 32 || theirNonce.length !== 32) throw new FideliusError("nonces must be 32 bytes");
  if (!(secret instanceof Uint8Array) || secret.length !== 32) throw new FideliusError("shared secret must be 32 bytes");
  const x = xor(ourNonce, theirNonce);
  const salt = x.slice(0, 20);      // Fidelius: first 20 bytes
  const iv = x.slice(20, 32);       // Fidelius: last 12 bytes
  let ikm, key;
  try {
    ikm = await subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
    key = await subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info: new Uint8Array() },
      ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  } catch (e) { throw new FideliusError("key derivation failed: " + e.message); }
  return { key, iv };
}

function b64(bytes) {
  const u = new Uint8Array(bytes); let s = "";
  const CH = 0x8000;                         // 32k chunk, safe for String.fromCharCode.apply
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function sha256hex(bytes) {
  const h = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return [...h].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Encrypt ONE plaintext under the (key,iv) derived from (secret, ourNonce, theirNonce).
 * CALLER CONTRACT (critical): NEVER call sealBundle twice with the same (secret, ourNonce, theirNonce) —
 * the iv is deterministic, so a second call reuses the AES-GCM (key,iv), which is catastrophic
 * (keystream + GHASH-key recovery). A fresh (key,iv) needs fresh keyMaterial (a fresh peer keypair + nonce),
 * or a distinct per-entry IV. There is intentionally no batch/multi-entry API here.
 * LIVE PROTOCOL (reconciled with the as-built consume side, hiu.js#consumeTransfer): the exchange is ONE
 * keyMaterial per transfer PAGE, and a well-behaved page carries EXACTLY ONE entry — so per-page == per-entry
 * and this single-entry seal IS the whole page. consumeTransfer derives ONE (secret, ourNonce, hipNonce) per
 * page and opens the page's entries under it; it tolerates a HOSTILE multi-entry-under-one-keyMaterial page
 * ONLY because it checksum-verifies EACH entry post-decrypt (a reused-(key,iv) sibling can never be smuggled
 * past that per-entry check). The Stage-5 HIP-encrypt owns fresh per-page keyMaterial + a multi-entry
 * known-answer vector.
 * // VERIFY: confirm against the ABDM /health-information/transfer wire-shape (one keyMaterial per page, one entry per page)
 */
export async function sealBundle(secret, ourNonce, theirNonce, plaintextStr) {
  const { key, iv } = await deriveKeyIv(secret, ourNonce, theirNonce);
  const pt = new TextEncoder().encode(plaintextStr);
  let ct;
  try { ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, pt); }
  catch (e) { throw new FideliusError("AES-GCM encrypt failed: " + e.message); }
  // R1: exactly one entry per derived (key, iv). No batch form exists — a second seal needs a fresh keyMaterial.
  return { content: b64(ct), checksum: await sha256hex(pt) };
}

// Import a raw 32-byte X25519 private scalar as a CryptoKey (for deterministic test vectors); PKCS8-wraps the raw key.
export async function importRawPrivate(rawScalar) {
  if (rawScalar.length !== 32) throw new FideliusError("raw private scalar must be 32 bytes");
  const prefix = Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x6e,0x04,0x22,0x04,0x20]);
  const pkcs8 = new Uint8Array(prefix.length + 32); pkcs8.set(prefix, 0); pkcs8.set(rawScalar, prefix.length);
  const privateKey = await subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, true, ["deriveBits"]);
  // Exporting the public key directly from a private-only import isn't possible; derive it via a JWK round-trip instead:
  const jwk = await subtle.exportKey("jwk", privateKey);
  const pubKey = await subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, { name: "X25519" }, true, []);
  const publicKeyRaw = new Uint8Array(await subtle.exportKey("raw", pubKey));
  return { privateKey, publicKeyRaw };
}

// CALLER CONTRACT: pass the same (secret, ourNonce, theirNonce) roles the sealer used (swapped our/their) — never reuse a (key,iv) to seal a NEW entry.
export async function openEntry(secret, ourNonce, theirNonce, contentB64, expectedChecksum) {
  const { key, iv } = await deriveKeyIv(secret, ourNonce, theirNonce);
  let ptBytes;
  try { ptBytes = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv }, key, unb64(contentB64))); }
  catch (e) { throw new FideliusError("AES-GCM decrypt/auth failed: " + e.message); }
  if (expectedChecksum != null) {
    const got = await sha256hex(ptBytes);
    if (got !== String(expectedChecksum).toLowerCase()) throw new FideliusError("entry checksum mismatch");
  }
  return new TextDecoder().decode(ptBytes);
}
