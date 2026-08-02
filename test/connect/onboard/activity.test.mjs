// test/connect/onboard/activity.test.mjs — Self-service Activity log (security-center-lite): a tenant-scoped,
// PHI-free, bounded READ of the tenant's own connect_audit_event rows. Pins: cross-tenant isolation
// (never another tenant's rows), most-recent-first ordering, the limit/truncated contract, the client-safe
// projection (ONLY action/outcome/connectorId/ts -- no consent_id/transaction_id/care_context_hash/actor/
// hash/reason field ever appears, even when the seeded rows carry them), empty list when the D1 binding is
// absent (not an error), and fail-closed RBAC (a non-member is denied).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readTenantActivity } from "../../../functions/_connect/onboard/activity.js";
import { AuthError, PermissionError } from "../../../functions/_connect/permission.js";
import { makeMockDb } from "../../../functions/_connect/testkit.js";

const idFn = (id, guest = false) => async () => ({ id, guest });

function seed() {
  return makeMockDb({
    connect_tenant: [{ id: "t1", mode: "sandbox" }, { id: "t2", mode: "sandbox" }],
    connect_membership: [
      { user_id: "u-admin", tenant_id: "t1", role: "admin" },
      { user_id: "u-clin", tenant_id: "t1", role: "clinician" },
      { user_id: "u-t2", tenant_id: "t2", role: "admin" },
    ],
    connect_audit_event: [
      // t1 rows, deliberately seeded OUT of ts order so ordering must come from the reader, not insertion order.
      {
        id: "1", tenant_id: "t1", actor: "cfa:aaa", action: "connect.onboard.saved", connector_id: "fhir-main",
        outcome: "ok", ts: "2026-08-01T09:00:00.000Z",
        // PHI-adjacent / correlation fields that MUST NEVER reach the client, even though the audit sink allows them.
        patient_ref_hash: "SECRET-PATIENT-HASH-1", consent_id: "CONSENT-1111", transaction_id: "TXN-1111",
        care_context_hash: "CARECTX-HASH-1", scope: JSON.stringify({ reason: "some_reason" }),
        resource_counts: JSON.stringify({ observations: 3 }),
      },
      {
        id: "2", tenant_id: "t1", actor: "cfa:bbb", action: "connect.onboard.tested", connector_id: "fhir-main",
        outcome: "ok", ts: "2026-08-01T11:00:00.000Z",
        patient_ref_hash: "SECRET-PATIENT-HASH-2", consent_id: "CONSENT-2222", transaction_id: "TXN-2222",
        care_context_hash: "CARECTX-HASH-2",
      },
      {
        id: "3", tenant_id: "t1", actor: "cfa:ccc", action: "connect.onboard.pulled", connector_id: "fhir-main",
        outcome: "error", ts: "2026-08-01T10:00:00.000Z",
      },
      // t2 row -- MUST NEVER appear in a t1 read.
      {
        id: "9", tenant_id: "t2", actor: "cfa:zzz", action: "connect.onboard.saved", connector_id: "epic",
        outcome: "ok", ts: "2026-08-01T12:00:00.000Z", patient_ref_hash: "OTHER-TENANT-HASH",
      },
    ],
  });
}

// ---- cross-tenant isolation + ordering + projection ----------------------------------------------------

test("returns only the caller's tenant rows, most-recent-first", async () => {
  const r = await readTenantActivity({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1");
  assert.equal(r.ok, true);
  assert.equal(r.events.length, 3);
  assert.deepEqual(r.events.map((e) => e.ts), [
    "2026-08-01T11:00:00.000Z",   // tested (latest)
    "2026-08-01T10:00:00.000Z",   // pulled
    "2026-08-01T09:00:00.000Z",   // saved (oldest)
  ]);
  const blob = JSON.stringify(r);
  assert.equal(blob.includes("epic"), false);               // t2 connector never appears
  assert.equal(blob.includes("OTHER-TENANT-HASH"), false);
});

test("client-safe projection: ONLY action/outcome/connectorId/ts, never a hash/id/reason field", async () => {
  const r = await readTenantActivity({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1");
  for (const e of r.events) {
    assert.deepEqual(Object.keys(e).sort(), ["action", "connectorId", "outcome", "ts"]);
  }
  const blob = JSON.stringify(r);
  for (const forbidden of [
    "SECRET-PATIENT-HASH-1", "SECRET-PATIENT-HASH-2", "CONSENT-1111", "CONSENT-2222",
    "TXN-1111", "TXN-2222", "CARECTX-HASH-1", "CARECTX-HASH-2", "some_reason",
    "cfa:aaa", "cfa:bbb", "cfa:ccc",                          // actor never surfaces either
    "patient_ref_hash", "consent_id", "transaction_id", "care_context_hash", "patientRefHash", "consentId", "transactionId", "careContextHash",
  ]) {
    assert.equal(blob.includes(forbidden), false, "leaked forbidden field/value: " + forbidden);
  }
  assert.equal(r.events[0].action, "connect.onboard.tested");
  assert.equal(r.events[0].outcome, "ok");
  assert.equal(r.events[0].connectorId, "fhir-main");
});

// ---- bounded + truncated -------------------------------------------------------------------------------

test("bounded by limit; truncated=true when more rows exist than the limit", async () => {
  const r = await readTenantActivity({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1", { limit: 2 });
  assert.equal(r.events.length, 2);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.events.map((e) => e.ts), ["2026-08-01T11:00:00.000Z", "2026-08-01T10:00:00.000Z"]);
});

test("truncated=false when the limit is not exceeded", async () => {
  const r = await readTenantActivity({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1", { limit: 50 });
  assert.equal(r.events.length, 3);
  assert.equal(r.truncated, false);
});

test("limit is clamped to the hard max (200) and to a minimum of 1; non-numeric falls back to default", async () => {
  const db = seed();
  const r1 = await readTenantActivity({ db, identifyFn: idFn("u-admin") }, {}, {}, "t1", { limit: 100000 });
  assert.equal(r1.truncated, false);   // clamped to 200, still >= the 3 seeded rows
  const r2 = await readTenantActivity({ db, identifyFn: idFn("u-admin") }, {}, {}, "t1", { limit: 0 });
  assert.equal(r2.events.length, 1);   // clamped to a minimum of 1
  const r3 = await readTenantActivity({ db, identifyFn: idFn("u-admin") }, {}, {}, "t1", { limit: "not-a-number" });
  assert.equal(r3.events.length, 3);   // falls back to the default (50), which covers all 3 seeded rows
});

// ---- empty binding => empty list, not an error ---------------------------------------------------------

test("D1 binding absent => empty list, not an error", async () => {
  const r1 = await readTenantActivity({ identifyFn: idFn("u-admin") }, {}, {}, "t1");   // no db key at all
  assert.deepEqual(r1, { ok: true, events: [], truncated: false });
  const r2 = await readTenantActivity({ db: null, identifyFn: idFn("u-admin") }, {}, {}, "t1");
  assert.deepEqual(r2, { ok: true, events: [], truncated: false });
});

// ---- fail-closed RBAC -----------------------------------------------------------------------------------

test("clinician (holds connector:read) may read activity", async () => {
  const r = await readTenantActivity({ db: seed(), identifyFn: idFn("u-clin") }, {}, {}, "t1");
  assert.equal(r.events.length, 3);
});

test("a member of t1 cannot read t2's activity (cross-tenant => PermissionError)", async () => {
  await assert.rejects(() => readTenantActivity({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t2"), PermissionError);
});

test("a non-member of the tenant is denied (PermissionError)", async () => {
  await assert.rejects(() => readTenantActivity({ db: seed(), identifyFn: idFn("u-stranger") }, {}, {}, "t1"), PermissionError);
});

test("guest / unauthenticated caller is denied (AuthError, fail-closed)", async () => {
  await assert.rejects(() => readTenantActivity({ db: seed(), identifyFn: idFn("ip:x", true) }, {}, {}, "t1"), AuthError);
});
