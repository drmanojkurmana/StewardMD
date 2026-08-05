// test/kb-crypto.test.mjs — the native-only lock crypto interop: the build-time Node encrypt (encrypt-kb.mjs)
// must decrypt with the SAME WebCrypto AES-GCM path kb-loader.js uses at runtime, and GCM must reject a wrong
// key / tampered bytes. This is the make-or-break piece for Phase 2b.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptBuffer } from "../scripts/encrypt-kb.mjs";

// EXACT mirror of kb-loader.js's runtime decrypt (Node 26 provides global crypto.subtle).
async function webcryptoDecrypt(encBytes, keyBytes) {
  const data = new Uint8Array(encBytes);
  const iv = data.slice(0, 12);
  const body = data.slice(12);   // ciphertext || GCM tag
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, body);
  return new TextDecoder().decode(pt);
}

test("Node-encrypt <-> WebCrypto-decrypt round-trip (build/runtime interop)", async () => {
  const key = randomBytes(32);
  const kb = 'window.KB={diseases:[{id:"sepsis",name:"Sepsis"}]};window.dispatchEvent(new Event("x"));';
  const enc = encryptBuffer(kb, key);
  assert.ok(enc.length > kb.length + 12);              // iv(12) + ct + tag(16) overhead
  assert.equal(await webcryptoDecrypt(enc, key), kb);  // decrypts back to the exact source
});

test("a wrong key cannot decrypt (GCM auth) -> the KB is useless without the server key", async () => {
  const enc = encryptBuffer("window.KB={};", randomBytes(32));
  await assert.rejects(webcryptoDecrypt(enc, randomBytes(32)));
});

test("tampered ciphertext is rejected (GCM integrity)", async () => {
  const key = randomBytes(32);
  const enc = encryptBuffer("window.KB={};", key);
  enc[18] ^= 0xff;   // flip a byte inside the ciphertext
  await assert.rejects(webcryptoDecrypt(enc, key));
});

test("key must be 32 bytes (AES-256)", () => {
  assert.throws(() => encryptBuffer("x", randomBytes(16)));
});
