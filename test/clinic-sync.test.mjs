// test/clinic-sync.test.mjs — Shared Clinic EMR sync engine (Phase 6): incremental encrypted delta
// batches over a shared transport (the ONE clinic Drive), cursor-tracked, conflict-safe, offline-
// resilient. Uses the real clinic-store + clinic-model with an in-memory transport + reversible mock
// crypto. node --test test/clinic-sync.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const S = require(join(HERE, "..", "clinic-store.js"));
const SYNC = require(join(HERE, "..", "clinic-sync.js"));

// ONE shared clinic Drive: both devices read/write the same file map.
function mkTransport() {
  const files = {};
  return {
    files,
    list: () => Object.keys(files),
    get: (name) => Promise.resolve(files[name]),
    put: (name, blob) => { files[name] = blob; return Promise.resolve(); }
  };
}
// Reversible mock crypto (base64) — proves the transport only ever holds opaque, non-plaintext blobs.
const crypto = {
  encrypt: (s) => Promise.resolve(Buffer.from(String(s)).toString("base64")),
  decrypt: (b) => Promise.resolve(Buffer.from(String(b), "base64").toString())
};
function mkStore(dev) { let t = 1000; return S.create({ deviceId: dev, clinicId: "C1", clock: () => (t += 10) }); }
function mkSync(store, dev, tx, state) { return SYNC.create({ store, transport: tx, crypto, deviceId: dev, clinicId: "C1", state }); }

test("push: writes one encrypted batch, clears pending, increments batch #", async () => {
  const tx = mkTransport(), st = mkStore("devA"), sync = mkSync(st, "devA", tx);
  st.put("patient", { name: "Asha" });
  st.put("encounter", { bp: "120/80" });
  const r = await sync.push();
  assert.equal(r.pushed, 2);
  assert.equal(r.batch, 1);
  assert.equal(st.pendingCount(), 0, "pending cleared after push");
  assert.equal(tx.list().length, 1, "one delta file written");
  assert.ok(tx.list()[0].endsWith("devA.1.smddelta"));
});

test("PHI never hits the transport in plaintext (ciphertext-only)", async () => {
  const tx = mkTransport(), st = mkStore("devA"), sync = mkSync(st, "devA", tx);
  st.put("patient", { name: "SecretName", phone: "9999911111" });
  await sync.push();
  const blob = tx.files[tx.list()[0]];
  assert.ok(!blob.includes("SecretName"), "patient name is not readable in the delta");
  assert.ok(!blob.includes("9999911111"), "phone is not readable in the delta");
});

test("two-device round-trip: A pushes, B pulls, B converges", async () => {
  const tx = mkTransport();
  const A = mkStore("devA"), B = mkStore("devB");
  const sa = mkSync(A, "devA", tx), sb = mkSync(B, "devB", tx);
  const p = A.put("patient", { name: "Asha" });
  A.update(p.id, { name: "Asha Rao" });
  await sa.push();
  const r = await sb.pull();
  assert.equal(r.conflicts, 0);
  assert.equal(B.get(p.id).data.name, "Asha Rao", "B has A's latest via sync");
  // now B adds one and A pulls
  const q = B.put("patient", { name: "Ravi" });
  await sb.push();
  await sa.pull();
  assert.equal(A.get(q.id).data.name, "Ravi");
  assert.equal(A.list("patient").length, 2);
});

test("incremental cursor: a peer's already-consumed batch is not re-pulled", async () => {
  const tx = mkTransport();
  const A = mkStore("devA"), B = mkStore("devB");
  const stateB = { batch: 0, cursor: {} };
  const sa = mkSync(A, "devA", tx), sb = mkSync(B, "devB", tx, stateB);
  A.put("patient", { name: "one" }); await sa.push();      // batch 1
  let r1 = await sb.pull();
  assert.equal(r1.batches, 1);
  assert.equal(stateB.cursor.devA, 1);
  let r2 = await sb.pull();                                 // nothing new
  assert.equal(r2.batches, 0, "no re-consume");
  A.put("patient", { name: "two" }); await sa.push();       // batch 2
  let r3 = await sb.pull();
  assert.equal(r3.batches, 1, "only the new batch");
  assert.equal(stateB.cursor.devA, 2);
  assert.equal(B.list("patient").length, 2);
});

test("conflict through sync: concurrent edits from the same base -> parked, not overwritten", async () => {
  const tx = mkTransport();
  const A = mkStore("devA"), B = mkStore("devB");
  const sa = mkSync(A, "devA", tx), sb = mkSync(B, "devB", tx);
  const p = A.put("patient", { name: "P", dose: "500 mg" });
  await sa.push(); await sb.pull();                         // both at v1
  A.update(p.id, { name: "P", dose: "500 mg" });           // A v2 (dose kept)
  B.update(p.id, { name: "P", dose: "450 mg" });           // B v2 (dose changed)
  await sa.push(); await sb.push();
  await sa.pull();                                          // A ingests B's conflicting batch
  assert.equal(A.conflictCount(), 1);
  assert.equal(A.get(p.id).data.dose, "500 mg", "A's local edit preserved");
  assert.ok(A.conflicts()[0].fields.includes("dose"));
});

test("offline resilience: an undecryptable batch is skipped + retried (cursor not advanced)", async () => {
  const tx = mkTransport();
  const A = mkStore("devA"), B = mkStore("devB");
  const badCrypto = { encrypt: crypto.encrypt, decrypt: () => Promise.reject(new Error("bad key")) };
  const sa = mkSync(A, "devA", tx);
  const sbBad = SYNC.create({ store: B, transport: tx, crypto: badCrypto, deviceId: "devB", clinicId: "C1", state: { batch: 0, cursor: {} } });
  const p = A.put("patient", { name: "x" }); await sa.push();
  const r = await sbBad.pull();
  assert.equal(r.failed, 1);
  assert.equal(r.applied, 0);
  assert.equal(sbBad.state().cursor.devA || 0, 0, "cursor NOT advanced -> will retry");
  // fix the key (good crypto) and it recovers
  const sbGood = mkSync(B, "devB", tx, sbBad.state());
  const r2 = await sbGood.pull();
  assert.equal(r2.applied, 1);
  assert.equal(B.get(p.id).data.name, "x");
});

test("syncOnce: pull-then-push in one cycle keeps two devices converged", async () => {
  const tx = mkTransport();
  const A = mkStore("devA"), B = mkStore("devB");
  const sa = mkSync(A, "devA", tx), sb = mkSync(B, "devB", tx);
  A.put("patient", { name: "A1" });
  B.put("patient", { name: "B1" });
  await sa.syncOnce(); await sb.syncOnce(); await sa.syncOnce();
  assert.equal(A.list("patient").length, 2);
  assert.equal(B.list("patient").length, 2);
});
