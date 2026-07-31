// test/connect/abdm/audit-sink-persist.test.mjs — Stage-6 Task-4 (R14, carry-forward from Stage-4 T8).
// buildAuditEvent already ALLOW-lists consentId/transactionId/careContextHash, but makeAuditSink's D1
// INSERT dropped them at persist. These tests pin: the three ids now round-trip into their D1 columns;
// a raw careContextReference / raw ABHA / decrypted content is still structurally dropped by
// buildAuditEvent and never reaches a persisted column; and the sink fails closed on a write error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAuditSink } from "../../../functions/_connect/audit.js";

// A tiny capturing D1 mock that reads INSERTs back BY COLUMN NAME (parses the INSERT column list),
// so assertions verify the persisted column value rather than a brittle positional bind.
function makeCapturingDb() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      let binds = [];
      const stmt = {
        bind: (...args) => { binds = args; return stmt; },
        run: async () => {
          const cols = sql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]*)\)/i)[1].split(",").map((c) => c.trim());
          const row = {};
          cols.forEach((c, i) => { row[c] = binds[i]; });
          rows.push(row);
          return { success: true };
        },
      };
      return stmt;
    },
  };
}

test("makeAuditSink PERSISTS consentId/transactionId/careContextHash to D1 columns (R14)", async () => {
  const db = makeCapturingDb();
  await makeAuditSink({}, db)({ action: "data.received", tenantId: "t1", consentId: "consent-1", transactionId: "txn-1", careContextHash: "cc-hmac-abc" });
  assert.equal(db.rows.length, 1);
  const row = db.rows[0];
  assert.equal(row.consent_id, "consent-1");
  assert.equal(row.transaction_id, "txn-1");
  assert.equal(row.care_context_hash, "cc-hmac-abc");
  assert.equal(row.action, "data.received");   // sanity: existing columns still bound
});

test("makeAuditSink NEVER persists a raw careContextReference or raw ABHA (only the HMAC) (R14)", async () => {
  const db = makeCapturingDb();
  await makeAuditSink({}, db)({ action: "data.received", careContextReference: "hospital-A/opd/2026/ctx-77", abha: "ramesh1985@sbx", careContextHash: "cc-hmac-abc" });
  const row = db.rows[0];
  assert.equal(row.care_context_hash, "cc-hmac-abc");                   // only the HMAC survives
  const dump = JSON.stringify(row);
  assert.equal(dump.includes("hospital-A/opd/2026/ctx-77"), false);    // raw reference never persisted
  assert.equal(dump.includes("ramesh1985@sbx"), false);                // raw ABHA never persisted
  assert.equal("careContextReference" in row, false);
  assert.equal("abha" in row, false);
});

test("makeAuditSink with none of the three ids persists NULL columns, no error (R14)", async () => {
  const db = makeCapturingDb();
  await makeAuditSink({}, db)({ action: "consent.denied", tenantId: "t1", outcome: "ok" });
  const row = db.rows[0];
  assert.equal(row.consent_id, null);
  assert.equal(row.transaction_id, null);
  assert.equal(row.care_context_hash, null);
});

test("no regression: a Phase-0 audit row still inserts and still drops PHI", async () => {
  const db = makeCapturingDb();
  await makeAuditSink({}, db)({ tenantId: "t1", actor: "u1", action: "context", outcome: "ok", patientName: "LEAK" });
  const row = db.rows[0];
  assert.equal(row.tenant_id, "t1");
  assert.equal(row.outcome, "ok");
  assert.equal(JSON.stringify(row).includes("LEAK"), false);           // PHI still dropped by buildAuditEvent
});

test("makeAuditSink FAILS CLOSED when the D1 write errors (rejects, matching the sink convention)", async () => {
  const db = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("d1 down"); } }) }) };
  await assert.rejects(() => makeAuditSink({}, db)({ action: "data.received", consentId: "c1" }), /d1 down/);
});
