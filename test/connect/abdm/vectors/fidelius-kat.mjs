// test/connect/abdm/vectors/fidelius-kat.mjs — self-consistent Fidelius KAT (synthetic; regenerate if the scheme changes).
// Fixed 32-byte raw X25519 private scalars (hex), fixed 32-byte nonces (hex), a fixed plaintext, and the
// content/checksum THIS implementation produces. Values are filled in Step 3 after the first run.
export const KAT = {
  aPrivHex: "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",  // RFC 7748 test scalar (Alice)
  bPrivHex: "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",  // RFC 7748 test scalar (Bob)
  aNonceHex: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  bNonceHex: "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100",
  plaintext: "{\"resourceType\":\"Bundle\",\"type\":\"document\",\"id\":\"kat-1\"}",
  content: "OwkS1mBGpRIWmVpt+gOhMFReaXpEwSMYMXUadFW22DtD6A+zUB0wb/gev39+5MqIiQbXymeGGOhG2ydHbuuIJZrxJyKbYaC2",
  checksum: "8b266a05493166ee42812a1d620c32a51592766fb293e3118167db027abaab22",
};
