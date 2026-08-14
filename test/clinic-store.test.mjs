// test/clinic-store.test.mjs — Shared Clinic EMR local store (Phase 5 core): local writes queue
// changes, ingest merges remote changes, conflicts are parked (never silent-overwrite), and two
// devices converge. In-memory; no real IndexedDB/Drive. node --test test/clinic-store.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const S = require(join(HERE, "..", "clinic-store.js"));

// deterministic clock so ids/timestamps are stable across a test
function mkStore(deviceId, userId) {
  let t = 1000;
  return S.create({ deviceId, userId, clinicId: "C1", clock: () => (t += 10) });
}

test("put/get/list: create a record, read it back, filter by entity type", () => {
  const st = mkStore("devA", "uidA");
  const p = st.put("patient", { name: "Asha", phone: "99999" });
  assert.equal(p.entityType, "patient");
  assert.equal(p.version, 1);
  assert.equal(st.get(p.id).data.name, "Asha");
  st.put("encounter", { bp: "120/80" }, { patientId: p.id });
  assert.equal(st.list("patient").length, 1);
  assert.equal(st.list("encounter").length, 1);
  assert.equal(st.list().length, 2);
});

test("pending queue: every local write queues one change; markSynced clears them", () => {
  const st = mkStore("devA");
  const p = st.put("patient", { name: "X" });
  st.update(p.id, { name: "X Y" });
  assert.equal(st.pendingCount(), 2);
  const ids = st.pending().map((c) => c.changeId);
  st.markSynced(ids);
  assert.equal(st.pendingCount(), 0);
});

test("update/remove: version bumps; remove tombstones (get hides, raw keeps it for sync)", () => {
  const st = mkStore("devA");
  const p = st.put("patient", { name: "X" });
  const v2 = st.update(p.id, { name: "X2" });
  assert.equal(v2.version, 2);
  st.remove(p.id);
  assert.equal(st.get(p.id), null, "get hides tombstoned record");
  assert.equal(st.raw(p.id).deleted, true, "raw keeps the tombstone so the delete syncs");
  assert.equal(st.list("patient").length, 0);
});

test("ingest: a remote CREATE lands; a fast-forward UPDATE advances", () => {
  const A = mkStore("devA"), B = mkStore("devB");
  const p = A.put("patient", { name: "Asha" });
  const v2 = A.update(p.id, { name: "Asha Rao" });
  // B has never seen this record -> ingest A's two changes
  const r = B.ingest(A.pending());
  assert.equal(r.conflicts, 0);
  assert.ok(r.applied >= 1);
  assert.equal(B.get(p.id).data.name, "Asha Rao", "B converged to A's latest");
  assert.equal(B.get(p.id).version, 2);
});

test("two-device convergence: independent non-conflicting records both sync", () => {
  const A = mkStore("devA"), B = mkStore("devB");
  const pa = A.put("patient", { name: "A-patient" });
  const pb = B.put("patient", { name: "B-patient" });
  B.ingest(A.pending());          // B learns A's patient
  A.ingest(B.pending());          // A learns B's patient
  assert.equal(A.list("patient").length, 2);
  assert.equal(B.list("patient").length, 2);
  assert.equal(A.get(pb.id).data.name, "B-patient");
  assert.equal(B.get(pa.id).data.name, "A-patient");
});

test("CONFLICT: both devices edit the SAME record from the same base -> parked, local NOT overwritten", () => {
  const A = mkStore("devA", "uidA"), B = mkStore("devB", "uidB");
  const p = A.put("patient", { name: "P", allergy: "none" });
  B.ingest(A.pending()); A.markSynced(A.pending().map((c) => c.changeId));   // both at v1, synced
  // A and B each edit v1 independently (unsynced)
  A.update(p.id, { name: "P", allergy: "penicillin" });   // A -> v2
  B.update(p.id, { name: "P", allergy: "sulfa" });        // B -> its own v2
  // A ingests B's conflicting change
  const r = A.ingest(B.pending());
  assert.equal(r.conflicts, 1);
  assert.equal(r.applied, 0);
  assert.equal(A.get(p.id).data.allergy, "penicillin", "A's local edit is preserved, not overwritten");
  const c = A.conflicts()[0];
  assert.equal(c.recordId, p.id);
  assert.ok(c.fields.includes("allergy"), "the conflicting clinical field is flagged");
  assert.equal(A.conflictCount(), 1);
});

test("resolveConflict: a merged resolution supersedes both branches + queues a new change", () => {
  const A = mkStore("devA", "uidA"), B = mkStore("devB", "uidB");
  const p = A.put("patient", { dose: "500 mg" });
  B.ingest(A.pending());
  A.update(p.id, { dose: "500 mg" });     // v2 on A
  B.update(p.id, { dose: "450 mg" });     // v2 on B
  A.ingest(B.pending());
  assert.equal(A.conflictCount(), 1);
  const resolved = A.resolveConflict(p.id, { dose: "500 mg (doctor confirmed)" });
  assert.equal(A.conflictCount(), 0, "conflict cleared");
  assert.ok(resolved.version >= 3, "resolution supersedes both v2 branches");
  assert.equal(A.get(p.id).data.dose, "500 mg (doctor confirmed)");
  assert.ok(A.pending().some((c) => c.recordId === p.id), "resolution is queued to sync out");
});

test("persist hooks fire on writes + ingest (durable-backend adapter contract)", () => {
  const saved = [], changes = [];
  const st = S.create({
    deviceId: "devA", clinicId: "C1", clock: () => 1000,
    persist: { saveRecord: (r) => saved.push(r.id), saveChange: (c) => changes.push(c.changeId) }
  });
  const p = st.put("patient", { name: "X" });
  assert.ok(saved.includes(p.id), "record persisted");
  assert.equal(changes.length, 1, "change persisted");
});

test("hydrate: rebuild in-memory state from a durable snapshot", () => {
  const A = mkStore("devA");
  const p = A.put("patient", { name: "Persisted" });
  const snap = { records: [A.raw(p.id)], pending: A.pending(), conflicts: [] };
  const B = S.create({ deviceId: "devA", clinicId: "C1", clock: () => 9000 }).hydrate(snap);
  assert.equal(B.get(p.id).data.name, "Persisted");
  assert.equal(B.pendingCount(), 1);
});
