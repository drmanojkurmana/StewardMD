// test/connect/agent/hmac.test.mjs - HMAC and cryptographic helpers for agent broker.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  b64url,
  fromB64url,
  utf8b64url,
  b64urlUtf8,
  hmacHex,
  sha256hex,
  equalHex,
} from "../../../functions/_connect/agent/hmac.js";

test("sha256hex computes correct digests and is deterministic", async () => {
  // Empty string standard NIST SHA-256 test vector
  const emptyHash = await sha256hex("");
  assert.equal(emptyHash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

  // Output format is lowercase 64-character hex
  assert.match(emptyHash, /^[0-9a-f]{64}$/);

  const hash1 = await sha256hex("test-message-1");
  const hash2 = await sha256hex("test-message-1");
  const hash3 = await sha256hex("test-message-2");

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
});

test("hmacHex signs correctly, detects tampering and rejects wrong keys", async () => {
  const key1 = "test-secret-key-1";
  const key2 = "test-secret-key-2";
  const msg1 = "canonical-consent-payload";
  const msg2 = "canonical-consent-payload-tampered";

  const sig1 = await hmacHex(key1, msg1);
  const sig1Again = await hmacHex(key1, msg1);

  // Deterministic signing
  assert.equal(sig1, sig1Again);
  assert.match(sig1, /^[0-9a-f]{64}$/);

  // Wrong key produces different signature
  const sigWrongKey = await hmacHex(key2, msg1);
  assert.notEqual(sig1, sigWrongKey);

  // Tampered message produces different signature
  const sigTampered = await hmacHex(key1, msg2);
  assert.notEqual(sig1, sigTampered);
});

test("equalHex performs safe hex string comparison", () => {
  const hexA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const hexB = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const hexC = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856"; // last char diff

  assert.equal(equalHex(hexA, hexB), true);
  assert.equal(equalHex(hexA, hexC), false);

  // Different length
  assert.equal(equalHex(hexA, hexA.slice(0, 32)), false);

  // Empty string or missing inputs fail-closed
  assert.equal(equalHex("", ""), false);
  assert.equal(equalHex(null, hexA), false);
  assert.equal(equalHex(hexA, undefined), false);
  assert.equal(equalHex(null, null), false);
});

test("b64url and fromB64url roundtrip byte arrays without URL-unsafe characters", () => {
  // Test across byte spectrum (0 to 255)
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;

  const encoded = b64url(bytes);
  assert.doesNotMatch(encoded, /[+/=]/);

  const decoded = fromB64url(encoded);
  assert.deepEqual(decoded, bytes);
});

test("utf8b64url and b64urlUtf8 roundtrip JSON strings and unicode text", () => {
  const samples = [
    "simple string",
    JSON.stringify({ tenantId: "t1", actorId: "a1", scope: ["emr:session", "emr:read"] }),
    "Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?",
    "Multibyte: नमस्ते 你好 éàî",
  ];

  for (const sample of samples) {
    const encoded = utf8b64url(sample);
    assert.doesNotMatch(encoded, /[+/=]/);
    const decoded = b64urlUtf8(encoded);
    assert.equal(decoded, sample);
  }
});
