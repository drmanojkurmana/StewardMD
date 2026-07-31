// functions/_connect/abdm/fidelius.js — ABDM "Fidelius" E2E crypto (spec §4). WebCrypto only; Node+Workers parity.
export class FideliusError extends Error {}
const subtle = globalThis.crypto.subtle;

export function randomBytes(n) { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }

export async function generateKeyPair() {
  const kp = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
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

function xor(a, b) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] ^ b[i]; return o; }

export async function deriveKeyIv(secret, ourNonce, theirNonce) {
  if (ourNonce.length !== 32 || theirNonce.length !== 32) throw new FideliusError("nonces must be 32 bytes");
  const x = xor(ourNonce, theirNonce);
  const salt = x.slice(0, 20);      // Fidelius: first 20 bytes
  const iv = x.slice(20, 32);       // Fidelius: last 12 bytes
  const ikm = await subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new Uint8Array() },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { key, iv };
}

// functions/_connect/abdm/fidelius.js  (append)
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

export async function sealBundle(secret, ourNonce, theirNonce, plaintextStr) {
  const { key, iv } = await deriveKeyIv(secret, ourNonce, theirNonce);
  const pt = new TextEncoder().encode(plaintextStr);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  // R1: exactly one entry per derived (key, iv). No batch form exists — a second seal needs a fresh keyMaterial.
  return { content: b64(ct), checksum: await sha256hex(pt) };
}

// Import a raw 32-byte X25519 private scalar as a CryptoKey (for deterministic test vectors). PKCS8-wraps the raw key.
export async function importRawPrivate(rawScalar) {
  if (rawScalar.length !== 32) throw new FideliusError("raw private scalar must be 32 bytes");
  const prefix = Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x6e,0x04,0x22,0x04,0x20]);
  const pkcs8 = new Uint8Array(prefix.length + 32); pkcs8.set(prefix, 0); pkcs8.set(rawScalar, prefix.length);
  const privateKey = await subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, true, ["deriveBits"]);
  // derive the matching public key by exporting the pair is not possible from a private import; compute via JWK round-trip:
  const jwk = await subtle.exportKey("jwk", privateKey);
  const pubKey = await subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, { name: "X25519" }, true, []);
  const publicKeyRaw = new Uint8Array(await subtle.exportKey("raw", pubKey));
  return { privateKey, publicKeyRaw };
}

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
