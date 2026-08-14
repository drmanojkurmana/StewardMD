// test/clinic-crypto.test.mjs — Shared Clinic EMR delta crypto (Phase 6 adapter): AES-256-GCM with a
// cached PBKDF2-derived clinic key. Round-trip, wrong-key rejection, opacity, cross-instance interop,
// and a real-crypto sync round-trip. WebCrypto runs in Node. node --test test/clinic-crypto.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const C = require(join(HERE, "..", "clinic-crypto.js"));
const S = require(join(HERE, "..", "clinic-store.js"));
const SYNC = require(join(HERE, "..", "clinic-sync.js"));

test("round-trip: encrypt then decrypt returns the original", async () => {
  const cr = C.create("clinic-secret-123");
  const blob = await cr.encrypt('{"name":"Asha","dose":"500 mg"}');
  assert.notEqual(blob, '{"name":"Asha","dose":"500 mg"}', "blob is not plaintext");
  const out = await cr.decrypt(blob);
  assert.equal(out, '{"name":"Asha","dose":"500 mg"}');
});

test("wrong secret cannot decrypt (AES-GCM auth fails)", async () => {
  const a = C.create("secret-A");
  const blob = await a.encrypt("phi payload");
  const b = C.create("secret-B", a.salt);   // same salt, different secret
  await assert.rejects(() => b.decrypt(blob), "decrypt with the wrong key must reject");
});

test("ciphertext is opaque — no plaintext leaks into the blob", async () => {
  const cr = C.create("k");
  const blob = await cr.encrypt("SecretPatientName 9998887777");
  assert.ok(!blob.includes("SecretPatientName"), "name not readable");
  assert.ok(!blob.includes("9998887777"), "phone not readable");
});

test("cross-instance interop: same secret + salt decrypts a peer's ciphertext", async () => {
  const owner = C.create("clinic-secret");
  const salt = owner.salt;
  const member = C.create("clinic-secret", salt);   // another device enrolled with the same secret+salt
  const blob = await owner.encrypt("shared delta");
  assert.equal(await member.decrypt(blob), "shared delta");
});

test("integration: sync engine with REAL crypto — two devices converge on encrypted deltas", async () => {
  const files = {};
  const tx = { list: () => Object.keys(files), get: (n) => Promise.resolve(files[n]), put: (n, b) => { files[n] = b; return Promise.resolve(); } };
  const secret = "clinic-XYZ", salt = C.newSalt();
  const cryptoA = C.create(secret, salt), cryptoB = C.create(secret, salt);
  let ta = 1000, tb = 5000;
  const A = S.create({ deviceId: "devA", clinicId: "C1", clock: () => (ta += 10) });
  const B = S.create({ deviceId: "devB", clinicId: "C1", clock: () => (tb += 10) });
  const sa = SYNC.create({ store: A, transport: tx, crypto: cryptoA, deviceId: "devA", clinicId: "C1", state: { batch: 0, cursor: {} } });
  const sb = SYNC.create({ store: B, transport: tx, crypto: cryptoB, deviceId: "devB", clinicId: "C1", state: { batch: 0, cursor: {} } });

  const p = A.put("patient", { name: "Asha", allergy: "penicillin" });
  await sa.push();
  // the delta on the wire is real ciphertext
  const wire = files[Object.keys(files)[0]];
  assert.ok(!wire.includes("Asha") && !wire.includes("penicillin"), "PHI encrypted on the transport");
  await sb.pull();
  assert.equal(B.get(p.id).data.allergy, "penicillin", "B decrypted + converged");
});
