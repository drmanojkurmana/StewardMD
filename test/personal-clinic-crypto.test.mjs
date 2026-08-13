/* test/personal-clinic-crypto.test.mjs — My Clinic Drive backup encryption (AES-GCM + PBKDF2).
 * The Drive file must be unreadable without the clinic password. node --test test/personal-clinic-crypto.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const CLINIC = require("../personal-clinic.js");

test("encrypt -> decrypt round-trips with the right password; PHI never in ciphertext", async () => {
  const plain = JSON.stringify({ patients: [{ name: "Ravi Kumar", note: "TOPSECRET-PHI-STRING" }] });
  const env = await CLINIC.encryptBackup(plain, "clinic-pass-123");
  const e = JSON.parse(env);
  assert.equal(e.smd_enc, 1);
  assert.equal(e.alg, "AES-GCM");
  assert.ok(e.salt && e.iv && e.ct, "envelope has salt+iv+ciphertext");
  assert.ok(env.indexOf("TOPSECRET-PHI-STRING") === -1, "plaintext PHI must NOT appear in the encrypted envelope");
  const back = await CLINIC.decryptBackup(env, "clinic-pass-123");
  assert.equal(back, plain, "decrypts back to the exact original");
});

test("wrong password cannot decrypt", async () => {
  const env = await CLINIC.encryptBackup("secret data", "right-password");
  await assert.rejects(CLINIC.decryptBackup(env, "wrong-password"));
});

test("random salt/iv per encryption (two runs differ)", async () => {
  const a = await CLINIC.encryptBackup("same input", "pw");
  const b = await CLINIC.encryptBackup("same input", "pw");
  assert.notEqual(JSON.parse(a).ct, JSON.parse(b).ct, "ciphertext differs run-to-run (fresh iv/salt)");
});

test("decrypt rejects a non-StewardMD envelope", async () => {
  await assert.rejects(CLINIC.decryptBackup('{"foo":1}', "x"));
  await assert.rejects(CLINIC.decryptBackup("not json", "x"));
});
