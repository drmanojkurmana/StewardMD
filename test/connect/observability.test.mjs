// test/connect/observability.test.mjs — tenant-scoped audit + PHI-free metrics (spec §3.6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readAudit, metrics } from "../../functions/_connect/enterprise/observability.js";
import { PermissionError } from "../../functions/_connect/permission.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

const idFn = (id) => async () => ({ id, guest: false });
function seed() {
  return makeMockDb({
    connect_tenant: [{ id: "t1", mode: "sandbox" }, { id: "t2", mode: "sandbox" }],
    connect_membership: [{ user_id: "u-owner", tenant_id: "t1", role: "owner" }, { user_id: "u-aud", tenant_id: "t1", role: "auditor" }, { user_id: "u-clin", tenant_id: "t1", role: "clinician" }],
    connect_audit_event: [
      { id: "1", tenant_id: "t1", action: "context", outcome: "ok", latency_ms: 10, patient_ref_hash: "SECRET-HASH-A" },
      { id: "2", tenant_id: "t1", action: "context", outcome: "denied", latency_ms: 5, patient_ref_hash: "SECRET-HASH-B" },
      { id: "3", tenant_id: "t1", action: "ratelimit.block", outcome: "denied", latency_ms: 1 },
      { id: "9", tenant_id: "t2", action: "context", outcome: "ok", latency_ms: 99, patient_ref_hash: "OTHER-TENANT" },
    ],
  });
}

test("auditor reads their tenant's audit rows (tenant-scoped), pseudonym redacted", async () => {
  const rows = await readAudit({ db: seed(), identifyFn: idFn("u-aud") }, {}, {}, "t1");
  assert.equal(rows.length, 3);                          // t1 rows only, never t2
  assert.ok(rows.every((r) => r.tenant_id === "t1"));
  assert.ok(rows.every((r) => !("patient_ref_hash" in r)));   // per-row HMAC pseudonym stripped from auditor view
  assert.equal(JSON.stringify(rows).includes("SECRET-HASH"), false);
});

test("owner of t1 cannot read t2's audit (non-member -> denied)", async () => {
  await assert.rejects(() => readAudit({ db: seed(), identifyFn: idFn("u-owner") }, {}, {}, "t2"), PermissionError);
});

test("clinician cannot read audit or metrics", async () => {
  await assert.rejects(() => readAudit({ db: seed(), identifyFn: idFn("u-clin") }, {}, {}, "t1"), PermissionError);
  await assert.rejects(() => metrics({ db: seed(), identifyFn: idFn("u-clin") }, {}, {}, "t1"), PermissionError);
});

test("metrics are aggregates only and contain NO patient_ref_hash", async () => {
  const m = await metrics({ db: seed(), identifyFn: idFn("u-owner") }, {}, {}, "t1");
  assert.equal(m.total, 3);                              // t1 only
  assert.equal(m.byAction.context, 2);
  assert.equal(m.ratelimitBlocks, 1);
  assert.equal(m.byOutcome.ok, 1);
  assert.equal(m.byOutcome.denied, 2);
  const blob = JSON.stringify(m);
  assert.equal(blob.includes("SECRET-HASH"), false);     // no pseudonym leaks into aggregates
  assert.equal("patient_ref_hash" in m, false);
});
