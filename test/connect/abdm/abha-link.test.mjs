// The mandatory M1 certification rule: one ABHA number <-> one local patient id.
// Test case TAGGING_UNIQUEPATIENTID_UNIQUEABHANUMBER.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLink, linkAbhaToPatient, findLink, abhaHashFor, abhaLinkRow, openLinkAddress, AbhaLinkError,
} from "../../../functions/_connect/abdm/abha-link.js";
import { makeSecrets } from "../../../functions/_connect/secrets.js";

// CONNECT_HMAC_SALT must be 32 raw bytes, base64.
const ENV = {
  CONNECT_HMAC_SALT: Buffer.alloc(32, 7).toString("base64"),
  CONNECT_MASTER_KEY: Buffer.alloc(32, 9).toString("base64"),
};

/** Minimal D1 stand-in backed by a Map, so the real SQL path is exercised in-process. */
function fakeDb() {
  const rows = [];
  const db = {
    rows,
    prepare(sql) {
      const q = { sql, args: [] };
      q.bind = (...a) => { q.args = a; return q; };
      q.first = async () => {
        if (/FROM connect_abha_link/.test(sql)) {
          const [tenantId, hash] = q.args;
          return rows.find((r) => r.tenant_id === tenantId && r.patient_abha_hash === hash) || null;
        }
        return null;
      };
      q.run = async () => {
        if (/^INSERT INTO connect_abha_link/m.test(sql.trim())) {
          const [tenant_id, patient_abha_hash, abha_last4, abha_address_sealed, patient_ref, created_at, updated_at] = q.args;
          rows.push({ tenant_id, patient_abha_hash, abha_last4, abha_address_sealed, patient_ref, created_at, updated_at });
        } else if (/^UPDATE connect_abha_link/.test(sql.trim())) {
          const [sealed, updated_at, tenant_id, hash] = q.args;
          const r = rows.find((x) => x.tenant_id === tenant_id && x.patient_abha_hash === hash);
          if (r) { r.abha_address_sealed = sealed; r.updated_at = updated_at; }
        }
        return { success: true };
      };
      return q;
    },
  };
  return db;
}
const deps = (db) => ({ db, env: ENV, secrets: makeSecrets(ENV), now: () => "2026-08-18T00:00:00.000Z" });

const ABHA_A = "91-1783-8617-6531";
const ABHA_B = "91178386176532";

// ── the pure rule ───────────────────────────────────────────────────────────────────────────────────
test("a new ABHA creates the binding", () => {
  assert.deepEqual(resolveLink(null, "MRN-1"), { action: "create", patientRef: "MRN-1" });
});

test("the same ABHA for the same patient is a reuse, not a duplicate", () => {
  assert.deepEqual(resolveLink({ patient_ref: "MRN-1" }, "MRN-1"), { action: "reuse", patientRef: "MRN-1" });
});

test("the same ABHA for a DIFFERENT patient id is refused, naming the existing record", () => {
  try {
    resolveLink({ patient_ref: "MRN-1" }, "MRN-2");
    assert.fail("should have refused");
  } catch (e) {
    assert.ok(e instanceof AbhaLinkError);
    assert.equal(e.code, "abha_already_linked");
    assert.match(e.message, /MRN-1/);       // the operator is told where to go
  }
});

test("a missing local patient reference is refused", () => {
  assert.throws(() => resolveLink(null, ""), AbhaLinkError);
});

// ── the stored form ─────────────────────────────────────────────────────────────────────────────────
test("the row keeps only the hash, last 4 and a SEALED address - never a raw ABHA", () => {
  const row = abhaLinkRow({
    tenantId: "t1", abhaHash: "deadbeef", abhaLast4: "6531",
    sealedAddress: "OPAQUE-CIPHERTEXT", patientRef: "MRN-1", now: "T",
  });
  const raw = JSON.stringify(row);
  assert.ok(!raw.includes("91178386176531"));
  assert.ok(!raw.includes("1783"));
  assert.ok(!raw.includes("hina@sbx"), "the address must not be stored in plaintext");
  assert.equal(row.abha_last4, "6531");
  assert.equal(row.abha_address_sealed, "OPAQUE-CIPHERTEXT");
});

test("the stored address is real ciphertext, and opens back to the original", async () => {
  const db = fakeDb();
  await linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_A, abhaAddress: "hina@sbx", patientRef: "MRN-1" });
  const stored = db.rows[0].abha_address_sealed;
  assert.ok(stored && !stored.includes("hina"), "plaintext handle must not be in the column");
  assert.equal(await openLinkAddress(deps(db), db.rows[0]), "hina@sbx");
});

test("a row with no address opens to an empty string rather than throwing", async () => {
  const db = fakeDb();
  await linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_A, patientRef: "MRN-1" });
  assert.equal(await openLinkAddress(deps(db), db.rows[0]), "");
});

test("sealing fails closed when no master key is configured - never silently plaintext", async () => {
  const db = fakeDb();
  const noKey = { db, env: ENV, secrets: makeSecrets({}), now: () => "T" };
  await assert.rejects(
    () => linkAbhaToPatient(noKey, { tenantId: "t1", abhaNumber: ABHA_A, abhaAddress: "hina@sbx", patientRef: "MRN-1" }));
  assert.equal(db.rows.length, 0);
});

test("the pseudonym is tenant-scoped, stable, and separator-insensitive", async () => {
  const a = await abhaHashFor(ENV, "t1", ABHA_A);
  const b = await abhaHashFor(ENV, "t1", "91178386176531");   // same number, no separators
  const c = await abhaHashFor(ENV, "t2", ABHA_A);             // same number, other tenant
  assert.equal(a, b, "separators must not change the hash");
  assert.notEqual(a, c, "tenants must not be able to correlate the same ABHA");
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("hashing requires both a tenant and a number", async () => {
  await assert.rejects(() => abhaHashFor(ENV, "t1", ""), AbhaLinkError);
  await assert.rejects(() => abhaHashFor(ENV, "", ABHA_A), AbhaLinkError);
});

// ── end to end over the SQL path ────────────────────────────────────────────────────────────────────
test("first registration writes one row; re-registering the same pair is idempotent", async () => {
  const db = fakeDb();
  const first = await linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_A, abhaAddress: "hina@sbx", patientRef: "MRN-1" });
  assert.equal(first.action, "create");
  assert.equal(first.created, true);
  assert.equal(db.rows.length, 1);

  const again = await linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_A, abhaAddress: "hina@sbx", patientRef: "MRN-1" });
  assert.equal(again.action, "reuse");
  assert.equal(again.created, false);
  assert.equal(db.rows.length, 1, "must not create a second row");
});

test("the SAME ABHA presented for a second patient id is blocked at the database gate", async () => {
  const db = fakeDb();
  await linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_A, patientRef: "MRN-1" });
  await assert.rejects(
    () => linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_A, patientRef: "MRN-2" }),
    (e) => e instanceof AbhaLinkError && e.code === "abha_already_linked");
  assert.equal(db.rows.length, 1);
});

test("different ABHAs, and the same ABHA in another tenant, are independent", async () => {
  const db = fakeDb();
  await linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_A, patientRef: "MRN-1" });
  await linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_B, patientRef: "MRN-2" });
  await linkAbhaToPatient(deps(db), { tenantId: "t2", abhaNumber: ABHA_A, patientRef: "OTHER-9" });
  assert.equal(db.rows.length, 3);
});

test("a changed preferred ABHA address is refreshed on reuse", async () => {
  const db = fakeDb();
  await linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_A, abhaAddress: "old@sbx", patientRef: "MRN-1" });
  await linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_A, abhaAddress: "new@sbx", patientRef: "MRN-1" });
  assert.equal(await openLinkAddress(deps(db), db.rows[0]), "new@sbx");
  assert.equal(db.rows.length, 1);
});

test("findLink returns null for an unknown ABHA and the row for a known one", async () => {
  const db = fakeDb();
  assert.equal(await findLink(deps(db), { tenantId: "t1", abhaNumber: ABHA_A }), null);
  await linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: ABHA_A, patientRef: "MRN-1" });
  const row = await findLink(deps(db), { tenantId: "t1", abhaNumber: ABHA_A });
  assert.equal(row.patient_ref, "MRN-1");
  assert.equal(row.abha_last4, "6531");
  assert.equal("abha_address" in row, false, "there is no plaintext address column");
});

test("a malformed ABHA or a missing tenant/db fails closed before any write", async () => {
  const db = fakeDb();
  await assert.rejects(() => linkAbhaToPatient(deps(db), { tenantId: "t1", abhaNumber: "12345", patientRef: "M" }), AbhaLinkError);
  await assert.rejects(() => linkAbhaToPatient(deps(db), { abhaNumber: ABHA_A, patientRef: "M" }), AbhaLinkError);
  await assert.rejects(() => linkAbhaToPatient({ env: ENV }, { tenantId: "t1", abhaNumber: ABHA_A, patientRef: "M" }), AbhaLinkError);
  assert.equal(db.rows.length, 0);
});
