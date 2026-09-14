// The ABDM consented-records store. This is what lets a local-first clinic answer ABDM when the
// doctor's phone is off. Three things are load-bearing: the boundary (only consented patients), sealed
// at rest, and erasure that actually removes the bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  putRecord, getRecord, listForPatient, deleteForPatient, deleteCareContext, objectKeyFor,
  consentedStoreSource, ConsentedStoreError, MAX_RECORD_BYTES, CONSENTED_TABLE,
} from "../../../functions/_connect/abdm/consented-store.js";
import { makeSecrets } from "../../../functions/_connect/secrets.js";

const ENV = { CONNECT_MASTER_KEY: Buffer.alloc(32, 5).toString("base64") };
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const RECORD = { recordType: "OPConsultRecord", documents: [{ id: "d1", text: "seen in OPD" }] };

/** In-memory R2 + D1 doubles that honour the real call shapes. */
function stores() {
  const r2map = new Map();
  const rows = [];
  const r2 = {
    map: r2map,
    put: async (k, v) => { r2map.set(k, v); },
    get: async (k) => (r2map.has(k) ? { text: async () => r2map.get(k) } : null),
    delete: async (k) => { r2map.delete(k); },
  };
  const db = {
    rows,
    prepare(sql) {
      const q = { args: [] };
      q.bind = (...a) => { q.args = a; return q; };
      q.first = async () => {
        if (/SELECT patient_abha_hash, hi_type, r2_key/.test(sql)) {
          const [t, rh] = q.args; return rows.find((r) => r.tenant_id === t && r.ref_hash === rh) || null;
        }
        if (/SELECT r2_key FROM/.test(sql)) {
          const [t, rh] = q.args; return rows.find((r) => r.tenant_id === t && r.ref_hash === rh) || null;
        }
        return null;
      };
      q.all = async () => {
        if (/SELECT care_context_ref/.test(sql)) {
          const [t, h] = q.args;
          return { results: rows.filter((r) => r.tenant_id === t && r.patient_abha_hash === h) };
        }
        if (/SELECT r2_key FROM/.test(sql)) {
          const [t, h] = q.args;
          return { results: rows.filter((r) => r.tenant_id === t && r.patient_abha_hash === h) };
        }
        return { results: [] };
      };
      q.run = async () => {
        if (/^INSERT INTO/.test(sql.trim())) {
          const [tenant_id, patient_abha_hash, ref_hash, care_context_ref, hi_type, r2_key, bytes, source, created_at, updated_at] = q.args;
          const i = rows.findIndex((r) => r.tenant_id === tenant_id && r.ref_hash === ref_hash);
          const row = { tenant_id, patient_abha_hash, ref_hash, care_context_ref, hi_type, r2_key, bytes, source, created_at, updated_at };
          if (i >= 0) rows[i] = row; else rows.push(row);
        } else if (/^DELETE FROM/.test(sql.trim())) {
          if (/ref_hash = \?/.test(sql)) {
            const [t, rh] = q.args;
            for (let i = rows.length - 1; i >= 0; i--) if (rows[i].tenant_id === t && rows[i].ref_hash === rh) rows.splice(i, 1);
          } else {
            const [t, h] = q.args;
            for (let i = rows.length - 1; i >= 0; i--) if (rows[i].tenant_id === t && rows[i].patient_abha_hash === h) rows.splice(i, 1);
          }
        }
        return { success: true };
      };
      return q;
    },
  };
  return { r2, db, deps: { r2, db, secrets: makeSecrets(ENV), now: () => "2026-08-19T00:00:00.000Z" } };
}

// ── the object key ──────────────────────────────────────────────────────────────────────────────────
test("the object key carries the pseudonym and a HASH of the reference, never the reference", async () => {
  const { key } = await objectKeyFor({ tenantId: "t1", patientAbhaHash: HASH_A, ref: "OPD:tkt-1" });
  assert.match(key, /^abdm\/consented\/t1\/a{64}\/[0-9a-f]{64}$/);
  assert.ok(!key.includes("OPD:tkt-1"), "a careContextReference must never appear in an object key");
});

test("an incomplete key request is refused", async () => {
  await assert.rejects(() => objectKeyFor({ tenantId: "t1", patientAbhaHash: HASH_A }), ConsentedStoreError);
  await assert.rejects(() => objectKeyFor({ patientAbhaHash: HASH_A, ref: "OPD:1" }), ConsentedStoreError);
});

// ── round trip ──────────────────────────────────────────────────────────────────────────────────────
test("a record round-trips, and is CIPHERTEXT at rest", async () => {
  const { r2, deps } = stores();
  await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:tkt-1", hiType: "OPConsultation", record: RECORD, source: "local-clinic" });

  const stored = [...r2.map.values()][0];
  assert.ok(!stored.includes("seen in OPD"), "the narrative must not be readable in R2");
  assert.ok(!stored.includes("OPConsultRecord"));

  const got = await getRecord(ENV, deps, { tenantId: "t1", careContextRef: "OPD:tkt-1" });
  assert.deepEqual(got.record, RECORD);
  assert.equal(got.patientAbhaHash, HASH_A);
  assert.equal(got.hiType, "OPConsultation");
});

test("re-storing the same care context updates in place rather than duplicating", async () => {
  const { db, deps } = stores();
  const args = { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:tkt-1", hiType: "OPConsultation", record: RECORD };
  await putRecord(ENV, deps, args);
  await putRecord(ENV, deps, { ...args, record: { ...RECORD, v: 2 } });
  assert.equal(db.rows.length, 1);
  assert.equal((await getRecord(ENV, deps, { tenantId: "t1", careContextRef: "OPD:tkt-1" })).record.v, 2);
});

test("an unknown care context reads as null, not as an empty record", async () => {
  const { deps } = stores();
  assert.equal(await getRecord(ENV, deps, { tenantId: "t1", careContextRef: "OPD:nope" }), null);
});

test("an index row whose blob has vanished is reported, never served as empty", async () => {
  const { r2, deps } = stores();
  await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:tkt-1", record: RECORD });
  r2.map.clear();                                   // blob lost, index intact
  await assert.rejects(() => getRecord(ENV, deps, { tenantId: "t1", careContextRef: "OPD:tkt-1" }),
    (e) => e instanceof ConsentedStoreError && /no stored object/.test(e.message));
});

test("storing without a sealing key is refused - never a plaintext fallback", async () => {
  const { deps } = stores();
  const noKey = { ...deps, secrets: makeSecrets({}) };
  await assert.rejects(() => putRecord(ENV, noKey, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:1", record: RECORD }));
});

test("missing bindings are refused rather than silently skipped", async () => {
  const { deps } = stores();
  await assert.rejects(() => putRecord(ENV, { ...deps, r2: null }, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:1", record: RECORD }), ConsentedStoreError);
  await assert.rejects(() => putRecord(ENV, { ...deps, db: null }, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:1", record: RECORD }), ConsentedStoreError);
});

// ── the storage policy: structure, not renderings ───────────────────────────────────────────────────
test("an oversized record is refused, so an embedded PDF cannot creep in", async () => {
  const { deps } = stores();
  const fat = { recordType: "OPConsultRecord", blob: "x".repeat(MAX_RECORD_BYTES + 1) };
  await assert.rejects(
    () => putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:1", record: fat }),
    (e) => e instanceof ConsentedStoreError && /render on demand/.test(e.message));
});

test("a normal structured record is comfortably inside the cap", async () => {
  const { deps } = stores();
  const r = await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:1", record: RECORD });
  assert.ok(r.bytes < 4096, "a consultation should be kilobytes, got " + r.bytes);
});

// ── the boundary ────────────────────────────────────────────────────────────────────────────────────
test("listing is scoped to one patient at one tenant", async () => {
  const { deps } = stores();
  await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:1", record: RECORD });
  await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_B, careContextRef: "OPD:2", record: RECORD });
  await putRecord(ENV, deps, { tenantId: "t2", patientAbhaHash: HASH_A, careContextRef: "OPD:3", record: RECORD });

  const mine = await listForPatient(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A });
  assert.deepEqual(mine.map((r) => r.care_context_ref), ["OPD:1"]);
  assert.deepEqual(await listForPatient(ENV, deps, { tenantId: "t1" }), []);
});

// ── erasure (HIP_INIT_REVOKE / EXPIRE / ABHA_OPTOUT) ────────────────────────────────────────────────
test("erasing a patient removes the index rows AND the bytes", async () => {
  const { r2, db, deps } = stores();
  await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:1", record: RECORD });
  await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:2", record: RECORD });
  await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_B, careContextRef: "OPD:3", record: RECORD });

  const out = await deleteForPatient(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A });
  assert.equal(out.rows, 2);
  assert.equal(out.blobs, 2);
  assert.equal(r2.map.size, 1, "only the other patient's blob should remain");
  assert.deepEqual(db.rows.map((r) => r.care_context_ref), ["OPD:3"]);
});

test("erasing one care context leaves the patient's others intact", async () => {
  const { r2, deps } = stores();
  await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:1", record: RECORD });
  await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:2", record: RECORD });
  assert.deepEqual(await deleteCareContext(ENV, deps, { tenantId: "t1", careContextRef: "OPD:1" }), { deleted: true });
  assert.equal(r2.map.size, 1);
  assert.ok(await getRecord(ENV, deps, { tenantId: "t1", careContextRef: "OPD:2" }));
  assert.deepEqual(await deleteCareContext(ENV, deps, { tenantId: "t1", careContextRef: "OPD:gone" }), { deleted: false });
});

// ── the HipSource face ──────────────────────────────────────────────────────────────────────────────
test("it answers as a HipSource, which is what serves when the doctor's device is off", async () => {
  const { deps } = stores();
  await putRecord(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A, careContextRef: "OPD:tkt-1", hiType: "Prescription", record: RECORD, source: "local-clinic" });

  const ccs = await consentedStoreSource.listCareContexts(ENV, deps, { tenantId: "t1", patientAbhaHash: HASH_A });
  assert.deepEqual(ccs, [{ referenceNumber: "OPD:tkt-1", hiType: "Prescription" }]);

  const out = await consentedStoreSource.loadRecord(ENV, deps, { tenantId: "t1", careContextRef: "OPD:tkt-1" });
  assert.equal(out.patientAbhaHash, HASH_A);
  assert.equal(out.hiType, "Prescription");
  assert.equal(out.recordType, "OPConsultRecord");
});

test("the source advertises nothing without a pseudonym, and refuses an unknown reference", async () => {
  const { deps } = stores();
  assert.deepEqual(await consentedStoreSource.listCareContexts(ENV, deps, { tenantId: "t1" }), []);
  await assert.rejects(
    () => consentedStoreSource.loadRecord(ENV, deps, { tenantId: "t1", careContextRef: "OPD:nope" }),
    (e) => e instanceof ConsentedStoreError);
});

test("the table name is the one the schema creates", () => {
  assert.equal(CONSENTED_TABLE, "connect_abdm_consented_record");
});
