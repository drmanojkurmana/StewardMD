import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, sharedSecret, randomBytes, FideliusError, nonce, deriveKeyIv } from "../../../functions/_connect/abdm/fidelius.js";

test("generateKeyPair yields a 32-byte raw public key + a deriving private key", async () => {
  const kp = await generateKeyPair();
  assert.equal(kp.publicKeyRaw.length, 32);
  assert.ok(kp.privateKey);
});

test("ECDH shared secret agrees both directions (32 bytes)", async () => {
  const a = await generateKeyPair(), b = await generateKeyPair();
  const ab = await sharedSecret(a.privateKey, b.publicKeyRaw);
  const ba = await sharedSecret(b.privateKey, a.publicKeyRaw);
  assert.equal(ab.length, 32);
  assert.deepEqual([...ab], [...ba]);   // ECDH symmetry
});

test("peer public key of wrong length is rejected", async () => {
  const a = await generateKeyPair();
  await assert.rejects(() => sharedSecret(a.privateKey, randomBytes(31)), FideliusError);
});

test("all-zero (low-order) shared secret is rejected (contributory check)", async () => {
  const a = await generateKeyPair();
  // The all-zero X25519 base points produce an all-zero shared secret → must be rejected.
  await assert.rejects(() => sharedSecret(a.privateKey, new Uint8Array(32)), FideliusError);
});

test("randomBytes returns the requested length and varies", () => {
  const x = randomBytes(32), y = randomBytes(32);
  assert.equal(x.length, 32);
  assert.notDeepEqual([...x], [...y]);
});

test("nonce is 32 CSPRNG bytes", () => { assert.equal(nonce().length, 32); });

test("deriveKeyIv is symmetric (both parties derive the same key material) and iv is 12 bytes", async () => {
  const a = await generateKeyPair(), b = await generateKeyPair();
  const nA = nonce(), nB = nonce();
  const secA = await sharedSecret(a.privateKey, b.publicKeyRaw);
  const secB = await sharedSecret(b.privateKey, a.publicKeyRaw);
  const kiA = await deriveKeyIv(secA, nA, nB);   // "our" = A, "their" = B
  const kiB = await deriveKeyIv(secB, nB, nA);   // "our" = B, "their" = A  (XOR is order-independent)
  assert.equal(kiA.iv.length, 12);
  assert.deepEqual([...kiA.iv], [...kiB.iv]);
  // Prove the KEYS match by cross-encrypt/decrypt (raw AES-GCM here; seal/open come in Task 3):
  const iv = kiA.iv, msg = new TextEncoder().encode("ping");
  const ct = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, kiA.key, msg);
  const pt = new TextDecoder().decode(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, kiB.key, ct));
  assert.equal(pt, "ping");
});

test("deriveKeyIv rejects a non-32-byte nonce in either position (fail-closed)", async () => {
  // Dummy 32-byte "secret" — the guard fires on nonce length before the secret is used, so all-zero is fine here.
  await assert.rejects(() => deriveKeyIv(new Uint8Array(32), randomBytes(31), nonce()), FideliusError);
  await assert.rejects(() => deriveKeyIv(new Uint8Array(32), nonce(), randomBytes(31)), FideliusError);
});

test("deriveKeyIv rejects a shared secret that is not exactly 32 bytes (fail-closed)", async () => {
  await assert.rejects(() => deriveKeyIv(new Uint8Array(31), nonce(), nonce()), FideliusError);
});

test("deriveKeyIv rejects a non-Uint8Array secret (fail-closed)", async () => {
  await assert.rejects(() => deriveKeyIv("not-a-uint8array", nonce(), nonce()), FideliusError);
});

// test/connect/abdm/fidelius.test.mjs  (append)
import { sealBundle, openEntry } from "../../../functions/_connect/abdm/fidelius.js";

async function pair() {
  const a = await generateKeyPair(), b = await generateKeyPair();
  return { a, b, nA: nonce(), nB: nonce(),
    secA: await sharedSecret(a.privateKey, b.publicKeyRaw),
    secB: await sharedSecret(b.privateKey, a.publicKeyRaw) };
}

test("seal→open round-trips a FHIR bundle string across the two parties", async () => {
  const p = await pair();
  const bundle = JSON.stringify({ resourceType: "Bundle", type: "document", id: "synthetic-1" });
  const entry = await sealBundle(p.secA, p.nA, p.nB, bundle);   // A (HIP) encrypts
  const out = await openEntry(p.secB, p.nB, p.nA, entry.content, entry.checksum);  // B (HIU) decrypts+verifies
  assert.equal(out, bundle);
});

test("openEntry rejects a tampered ciphertext (GCM auth) — fails closed", async () => {
  const p = await pair();
  const entry = await sealBundle(p.secA, p.nA, p.nB, "hello");
  const bad = [...atob(entry.content)]; bad[bad.length - 1] = String.fromCharCode(bad[bad.length - 1].charCodeAt(0) ^ 1);
  await assert.rejects(() => openEntry(p.secB, p.nB, p.nA, btoa(bad.join("")), entry.checksum), FideliusError);
});

test("openEntry rejects a checksum mismatch (defence-in-depth)", async () => {
  const p = await pair();
  const entry = await sealBundle(p.secA, p.nA, p.nB, "hello");
  await assert.rejects(() => openEntry(p.secB, p.nB, p.nA, entry.content, "00".repeat(32)), FideliusError);
});

test("seal→open round-trips a LARGE (~600 KB) plaintext without overflowing the call stack (b64 chunking)", async () => {
  const p = await pair();
  const big = "x".repeat(600000);
  const entry = await sealBundle(p.secA, p.nA, p.nB, big);
  const out = await openEntry(p.secB, p.nB, p.nA, entry.content, entry.checksum);
  assert.equal(out, big);
  assert.equal(out.length, 600000);
});

// test/connect/abdm/fidelius.test.mjs  (append)
import { KAT } from "./vectors/fidelius-kat.mjs";
import { importRawPrivate } from "../../../functions/_connect/abdm/fidelius.js";
const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));

test("known-answer vector: fixed keys+nonces+plaintext reproduce the recorded ciphertext & checksum", async () => {
  const aPriv = await importRawPrivate(hexToBytes(KAT.aPrivHex));
  const bPriv = await importRawPrivate(hexToBytes(KAT.bPrivHex));
  const secA = await sharedSecret(aPriv.privateKey, bPriv.publicKeyRaw);
  const entry = await sealBundle(secA, hexToBytes(KAT.aNonceHex), hexToBytes(KAT.bNonceHex), KAT.plaintext);
  assert.equal(entry.checksum, KAT.checksum);
  assert.equal(entry.content, KAT.content);
  // and it decrypts back with B's side
  const secB = await sharedSecret(bPriv.privateKey, aPriv.publicKeyRaw);
  const out = await openEntry(secB, hexToBytes(KAT.bNonceHex), hexToBytes(KAT.aNonceHex), entry.content, entry.checksum);
  assert.equal(out, KAT.plaintext);
});

test("R1: two plaintexts NEVER share a derived (key, iv) — no batch/multi-entry-per-key API exists", async () => {
  // The module intentionally exposes only sealBundle(single plaintext). Assert there is no batch export
  // and that encrypting a second bundle requires deriving fresh key material (different nonce) → different iv.
  const mod = await import("../../../functions/_connect/abdm/fidelius.js");
  assert.equal(typeof mod.sealBundle, "function");
  assert.equal("sealBundles" in mod, false);   // no batch form
  assert.equal("sealMany" in mod, false);
  const a = await generateKeyPair(), b = await generateKeyPair();
  const sec = await sharedSecret(a.privateKey, b.publicKeyRaw);
  const ki1 = await deriveKeyIv(sec, hexToBytes(KAT.aNonceHex), hexToBytes(KAT.bNonceHex));
  const ki2 = await deriveKeyIv(sec, nonce(), hexToBytes(KAT.bNonceHex));   // fresh our-nonce
  assert.notDeepEqual([...ki1.iv], [...ki2.iv]);   // a new keyMaterial exchange yields a new iv
});
