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
