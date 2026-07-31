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
