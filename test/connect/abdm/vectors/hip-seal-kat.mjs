// test/connect/abdm/vectors/hip-seal-kat.mjs — deterministic HIP "seal for HIU" known-answer vector.
//
// Cross-anchored to the already-committed fidelius KAT (vectors/fidelius-kat.mjs): with the SAME inputs
// (ephemeral scalar = RFC 7748 "Alice", HIU peer scalar = "Bob", the same nonces + plaintext) sealForHiu()
// MUST reproduce byte-for-byte the SAME `content`/`checksum` fidelius's own sealBundle produces — so these
// values are trustworthy independent of hip-crypto.js. Regenerate ONLY if the Fidelius scheme changes.
//
// Roles here: the HIP mints the EPHEMERAL half per entry (io injects it deterministically for this vector);
// the HIU supplies its public { dhPublicKey, nonce } (base64). Expected outputs are the sealed page.
//
// RE-RECORDED 2026-08-19 after the Fidelius IKM correction (docs/connect/abdm/FIDELIUS-RESOLVED.md):
// HKDF is fed the WEIERSTRASS x, not the Montgomery u, so the AES key - and therefore `content` -
// changed. `checksum` did NOT change: it is sha256(plaintext), independent of the key. These bytes are
// self-recorded; the external proof that they are right is test/connect/abdm/fidelius-abdm-kat.test.mjs,
// which reproduces BouncyCastle's ECDH from an independent BigInt oracle.
export const KAT = {
  // Injected HIP ephemeral (io.scalar / io.nonce) — DETERMINISTIC KAT ONLY (production uses the CSPRNG path).
  ephScalarHex: "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a", // RFC 7748 scalar (Alice)
  ephNonceHex:  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",

  // Fixed HIU peer keyMaterial (base64). dhPublicKey is pub(RFC 7748 "Bob"); nonce is the fixed peer nonce.
  hiuKeyMaterial: {
    dhPublicKey: "3p7bfXt9wbTTW2HC7OQ1Nz+DQ8hbeGdNrfx+FG+IK08=",
    nonce:       "/+7dzLuqmYh3ZlVEMyIRAP/u3cy7qpmId2ZVRDMiEQA=",
  },
  // The bare peer scalar (hex) so the test can re-derive the shared secret + decrypt the sealed page.
  hiuScalarHex: "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb", // RFC 7748 scalar (Bob)

  // EXTERNAL ANCHOR (not self-referential): with these RFC 7748 scalars the ECDH shared secret is the
  // PUBLISHED RFC 7748 §6.1 value K = X25519(Alice_priv, Bob_pub). Pinning it proves the KAT's crypto
  // matches an independent standards-body vector, not just fidelius's own output.
  sharedSecretHex: "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742", // RFC 7748 §6.1 K

  plaintext: "{\"resourceType\":\"Bundle\",\"type\":\"document\",\"id\":\"kat-1\"}",

  // Expected sealed page (identical to fidelius-kat's content/checksum — the cross-anchor).
  content:  "6xdNsr+2dvqDn/h9UUZ7fHLK7UHGxK5EOer2yVqQAe5e3DeePip5lv8tA51MH94SRLz224SSenbSB/+ljPi9ubUDG4HayXWc",
  checksum: "8b266a05493166ee42812a1d620c32a51592766fb293e3118167db027abaab22",

  // Expected returned public keyMaterial for the injected ephemeral.
  // dhPublicKey is the { expiry, parameters, keyValue } OBJECT ABDM specifies (Milestone-2/-3 Postman
  // collections, 16-02-2026), NOT a bare base64 string. `expiry` is clock-derived, so the deterministic
  // KAT injects a fixed clock (io.now) to keep it reproducible.
  katNow: "2026-08-19T00:00:00.000Z",
  keyMaterial: {
    cryptoAlg:   "ECDH",
    curve:       "Curve25519",
    dhPublicKey: {
      expiry:     "2026-08-20T00:00:00.000Z",
      parameters: "Curve25519/32byte random key",
      keyValue:   "BBT5RlU5VE+WnsTi0LflabgFoelfhyg2Hv9R2zO0nUTpKMkk101f7zPFtiT0Hypa2bIgFGXW/ja0xfd0088AC1s=",
    },
    nonce:       "ABEiM0RVZneImaq7zN3u/wARIjNEVWZ3iJmqu8zd7v8=",
  },
};
