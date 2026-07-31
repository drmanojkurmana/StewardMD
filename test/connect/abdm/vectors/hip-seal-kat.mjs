// test/connect/abdm/vectors/hip-seal-kat.mjs — deterministic HIP "seal for HIU" known-answer vector.
//
// Cross-anchored to the already-committed fidelius KAT (vectors/fidelius-kat.mjs): with the SAME inputs
// (ephemeral scalar = RFC 7748 "Alice", HIU peer scalar = "Bob", the same nonces + plaintext) sealForHiu()
// MUST reproduce byte-for-byte the SAME `content`/`checksum` fidelius's own sealBundle produces — so these
// values are trustworthy independent of hip-crypto.js. Regenerate ONLY if the Fidelius scheme changes.
//
// Roles here: the HIP mints the EPHEMERAL half per entry (io injects it deterministically for this vector);
// the HIU supplies its public { dhPublicKey, nonce } (base64). Expected outputs are the sealed page.
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

  plaintext: "{\"resourceType\":\"Bundle\",\"type\":\"document\",\"id\":\"kat-1\"}",

  // Expected sealed page (identical to fidelius-kat's content/checksum — the cross-anchor).
  content:  "OwkS1mBGpRIWmVpt+gOhMFReaXpEwSMYMXUadFW22DtD6A+zUB0wb/gev39+5MqIiQbXymeGGOhG2ydHbuuIJZrxJyKbYaC2",
  checksum: "8b266a05493166ee42812a1d620c32a51592766fb293e3118167db027abaab22",

  // Expected returned public keyMaterial for the injected ephemeral.
  keyMaterial: {
    cryptoAlg:   "ECDH",
    curve:       "Curve25519",
    dhPublicKey: "hSDwCYkwp1R0i33ctD73Wg2/Og0mOBr066SpjqqbTmo=",
    nonce:       "ABEiM0RVZneImaq7zN3u/wARIjNEVWZ3iJmqu8zd7v8=",
  },
};
