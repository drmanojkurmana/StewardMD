// ABDM wire public-key codec. Pins the finding in docs/connect/abdm/V3-SPEC-RECONCILIATION.md D4:
// an ABDM "Curve25519" public key is base64(0x04 || X(32) || Y(32)) on the SHORT-WEIERSTRASS curve,
// not the bare 32-byte little-endian Montgomery u that WebCrypto X25519 exports.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPair, sharedSecret, abdmKeyToX25519, x25519KeyToAbdm,
  montgomeryUToWeierstrassX, FideliusError,
} from "../../../functions/_connect/abdm/fidelius.js";

// Verbatim from the official ABDM swagger (consent_management_data_flow / hiu_request keyMaterial example).
const ABDM_EXAMPLE_KEY =
  "BFN7KTdOT0jIAExG2A8Jg+01wMPWxptiGqwHRVvtiVEsUq2FR7P2UdqZxJyPJSeR6muai21iQhasNxnhh8I5M+g=";
// u = X - A/3 mod (2^255-19), little-endian, computed independently.
const EXPECTED_U_LE_HEX = "db2cdc42b19a5c0170b7f01b2c19168b42d95e642d9ca1551d9ea4a38c7ed028";

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const unb64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));

test("the official ABDM example key is a 65-byte uncompressed point, not a 32-byte X25519 key", () => {
  const raw = unb64(ABDM_EXAMPLE_KEY);
  assert.equal(raw.length, 65, "ABDM publishes 65-byte uncompressed points");
  assert.equal(raw[0], 0x04, "uncompressed EC points carry the 0x04 prefix");
});

test("decoding the official example yields the expected Montgomery u (known answer)", () => {
  const u = abdmKeyToX25519(ABDM_EXAMPLE_KEY);
  assert.equal(u.length, 32);
  assert.equal(hex(u), EXPECTED_U_LE_HEX);
});

test("a 32-byte X25519 key passes through unchanged", async () => {
  const kp = await generateKeyPair();
  assert.deepEqual([...abdmKeyToX25519(kp.publicKeyRaw)], [...kp.publicKeyRaw]);
});

test("encode -> decode round-trips any X25519 public key", async () => {
  for (let i = 0; i < 5; i++) {
    const kp = await generateKeyPair();
    const wire = x25519KeyToAbdm(kp.publicKeyRaw);
    const back = unb64(wire);
    assert.equal(back.length, 65);
    assert.equal(back[0], 0x04);
    assert.deepEqual([...abdmKeyToX25519(wire)], [...kp.publicKeyRaw]);
  }
});

test("our encoding preserves the X coordinate of a real ABDM key", () => {
  // Re-encoding the example must reproduce its X. Y may be the other square root, which is
  // cryptographically equivalent: (x,-y) = -(x,y) and k·(-P) = -(k·P), so the ECDH x is identical.
  const original = unb64(ABDM_EXAMPLE_KEY);
  const reencoded = unb64(x25519KeyToAbdm(abdmKeyToX25519(ABDM_EXAMPLE_KEY)));
  assert.deepEqual([...reencoded.subarray(1, 33)], [...original.subarray(1, 33)]);
});

test("ECDH still agrees when the peer key crosses the wire in ABDM form", async () => {
  const hip = await generateKeyPair(), hiu = await generateKeyPair();
  const hiuOnWire = x25519KeyToAbdm(hiu.publicKeyRaw);            // as ABDM would send it
  const hipOnWire = x25519KeyToAbdm(hip.publicKeyRaw);
  const hipSide = await sharedSecret(hip.privateKey, abdmKeyToX25519(hiuOnWire));
  const hiuSide = await sharedSecret(hiu.privateKey, abdmKeyToX25519(hipOnWire));
  assert.deepEqual([...hipSide], [...hiuSide]);
});

test("a 65-byte blob that is not on curve25519 is rejected", () => {
  const bad = unb64(ABDM_EXAMPLE_KEY);
  bad[64] ^= 0x01;                                                 // perturb Y
  assert.throws(() => abdmKeyToX25519(bad), FideliusError);
});

test("unsupported encodings are rejected rather than guessed at", () => {
  assert.throws(() => abdmKeyToX25519(new Uint8Array(48)), FideliusError);
  assert.throws(() => x25519KeyToAbdm(new Uint8Array(65)), FideliusError);
});

test("the Montgomery->Weierstrass shared-secret shim is exact (A/3 offset)", () => {
  // Guards the constant. Feeding u = 0 must return exactly A/3 mod P, big-endian.
  const A_OVER_3_BE_HEX = "2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad2451";
  assert.equal(hex(montgomeryUToWeierstrassX(new Uint8Array(32))), A_OVER_3_BE_HEX);
});
