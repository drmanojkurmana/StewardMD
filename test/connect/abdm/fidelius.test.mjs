import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, sharedSecret, randomBytes, FideliusError } from "../../../functions/_connect/abdm/fidelius.js";

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
