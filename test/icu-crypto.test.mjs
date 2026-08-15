/* test/icu-crypto.test.mjs — ICU collaboration per-group key derivation (server side).
 * Proves deriveGroupKey is deterministic, distinct per (secret, gid), yields a real AES-256 key,
 * and that a client-style AES-GCM envelope round-trips under the derived key. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveGroupKey } from "../functions/_icu_crypto.js";

const SECRET = "test-icu-secret-value";

function b64ToBytes(s) { const bin = Buffer.from(s, "base64"); return new Uint8Array(bin); }

test("deriveGroupKey is deterministic per (secret, gid)", async () => {
  const a = await deriveGroupKey(SECRET, "grp-123");
  const b = await deriveGroupKey(SECRET, "grp-123");
  assert.equal(a, b);
});

test("deriveGroupKey differs per gid and per secret", async () => {
  const g1 = await deriveGroupKey(SECRET, "grp-1");
  const g2 = await deriveGroupKey(SECRET, "grp-2");
  const s2 = await deriveGroupKey("other-secret", "grp-1");
  assert.notEqual(g1, g2);
  assert.notEqual(g1, s2);
});

test("deriveGroupKey yields a 32-byte (AES-256) key", async () => {
  const k = await deriveGroupKey(SECRET, "grp-x");
  assert.equal(b64ToBytes(k).length, 32);
});

test("deriveGroupKey throws without a secret", async () => {
  await assert.rejects(() => deriveGroupKey("", "grp-1"));
});

test("derived key round-trips a client-style AES-GCM envelope", async () => {
  const keyB64 = await deriveGroupKey(SECRET, "grp-rt");
  const key = await crypto.subtle.importKey("raw", b64ToBytes(keyB64), "AES-GCM", false, ["encrypt", "decrypt"]);
  const payload = { name: "Ramesh", dx: "Sepsis", bed: "ICU-4", state: { patient: { name: "Ramesh" }, vitals: { hr: 110 } } };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  const back = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)));
  assert.deepEqual(back, payload);
});

test("a DIFFERENT group's key cannot decrypt another group's ciphertext", async () => {
  const kA = await crypto.subtle.importKey("raw", b64ToBytes(await deriveGroupKey(SECRET, "grpA")), "AES-GCM", false, ["encrypt", "decrypt"]);
  const kB = await crypto.subtle.importKey("raw", b64ToBytes(await deriveGroupKey(SECRET, "grpB")), "AES-GCM", false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kA, new TextEncoder().encode("secret"));
  await assert.rejects(() => crypto.subtle.decrypt({ name: "AES-GCM", iv }, kB, ct));
});
