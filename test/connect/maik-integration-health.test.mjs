// test/connect/maik-integration-health.test.mjs — Part 4: Enterprise Integration-Health analytics.
//
// computeIntegrationHealth() folds the PHI-free Connect audit trail into operational health metrics
// (per-connector success/failure, per-action outcome counts, overall roll-up, recent failures, warning
// signals). It is PURE, DETERMINISTIC, bounded, and NEVER throws. These tests pin: correct per-connector
// totals/failureRate + overall okRate + perAction counts; recentFailures ordering + cap; warning aggregation;
// empty/malformed input => safe zero result; the PHI-EXCLUSION guarantee (patientRefHash / careContextHash /
// consentId / transactionId values, and any PHI-shaped scope.reason, NEVER appear in the output); and the
// thin reader is flag-gated + fail-closed RBAC (connector:read) + strictly tenant-scoped (no cross-tenant).
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIntegrationHealth, readTenantIntegrationHealth } from "../../functions/_connect/maik/integration-health.js";
import { onRequest, flagOnboardOn } from "../../functions/api/connect/onboard/[[path]].js";
import { AuthError, PermissionError } from "../../functions/_connect/permission.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

// A synthetic audit stream: 3 connectors, mixed outcomes, a couple carrying warning/unmapped signals.
// (Shape = the buildAuditEvent camelCase form; the reader path additionally exercises the D1 snake_case form.)
function stream() {
  return [
    { action: "context", connectorId: "fhir-r4", outcome: "ok", ts: "2026-08-01T10:00:00.000Z" },
    { action: "context", connectorId: "fhir-r4", outcome: "ok", ts: "2026-08-01T10:05:00.000Z" },
    { action: "context", connectorId: "fhir-r4", outcome: "error", ts: "2026-08-01T10:10:00.000Z", scope: { reason: "upstream_timeout" } },
    { action: "ingest.hl7", connectorId: "hl7v2", outcome: "ok", ts: "2026-08-01T09:00:00.000Z", resourceCounts: { observations: 3, warnings: 2 } },
    { action: "ingest.hl7", connectorId: "hl7v2", outcome: "failed", ts: "2026-08-01T09:30:00.000Z", resourceCounts: { unmapped: 1 } },
    { action: "ingest.file", connectorId: "file", outcome: "denied", ts: "2026-08-01T08:00:00.000Z", scope: { reason: "scope_not_granted" } },
    { action: "ingest.file", connectorId: "file", outcome: "ok", ts: "2026-08-01T08:30:00.000Z" },
  ];
}

// ---- per-connector / overall / per-action ------------------------------------------------------------------

test("per-connector totals + failureRate are correct", () => {
  const h = computeIntegrationHealth(stream());
  const by = Object.fromEntries(h.perConnector.map((c) => [c.connectorId, c]));

  assert.deepEqual({ total: by["fhir-r4"].total, ok: by["fhir-r4"].ok, failed: by["fhir-r4"].failed }, { total: 3, ok: 2, failed: 1 });
  assert.ok(Math.abs(by["fhir-r4"].failureRate - 1 / 3) < 1e-9);
  assert.deepEqual({ total: by["hl7v2"].total, ok: by["hl7v2"].ok, failed: by["hl7v2"].failed }, { total: 2, ok: 1, failed: 1 });
  assert.equal(by["hl7v2"].failureRate, 0.5);
  assert.deepEqual({ total: by["file"].total, ok: by["file"].ok, failed: by["file"].failed }, { total: 2, ok: 1, failed: 1 });   // denied counts as a failure
  assert.equal(by["file"].failureRate, 0.5);
});

test("perConnector is sorted by failureRate desc, then connectorId asc", () => {
  const h = computeIntegrationHealth(stream());
  const order = h.perConnector.map((c) => c.connectorId);
  // hl7v2 (0.5) and file (0.5) tie above fhir-r4 (0.333); the tie breaks by id asc => file before hl7v2.
  assert.deepEqual(order, ["file", "hl7v2", "fhir-r4"]);
});

test("lastOutcome / lastTs reflect the most recent event per connector", () => {
  const h = computeIntegrationHealth(stream());
  const by = Object.fromEntries(h.perConnector.map((c) => [c.connectorId, c]));
  assert.equal(by["fhir-r4"].lastTs, "2026-08-01T10:10:00.000Z");
  assert.equal(by["fhir-r4"].lastOutcome, "error");
  assert.equal(by["file"].lastTs, "2026-08-01T08:30:00.000Z");
  assert.equal(by["file"].lastOutcome, "ok");
});

test("overall roll-up: totals, okRate, failedCount, activeConnectors", () => {
  const h = computeIntegrationHealth(stream());
  assert.equal(h.overall.totalEvents, 7);
  assert.equal(h.generatedFromCount, 7);
  assert.equal(h.overall.failedCount, 3);            // fhir error + hl7 failed + file denied
  assert.ok(Math.abs(h.overall.okRate - 4 / 7) < 1e-9);
  assert.equal(h.overall.activeConnectors, 3);
});

test("perAction counts events by outcome", () => {
  const h = computeIntegrationHealth(stream());
  assert.equal(h.perAction["context"].total, 3);
  assert.deepEqual(h.perAction["context"].byOutcome, { ok: 2, error: 1 });
  assert.deepEqual(h.perAction["ingest.hl7"].byOutcome, { ok: 1, failed: 1 });
  assert.deepEqual(h.perAction["ingest.file"].byOutcome, { denied: 1, ok: 1 });
});

test("warnings aggregate resourceCounts.warnings + unmapped (counts only)", () => {
  const h = computeIntegrationHealth(stream());
  assert.deepEqual(h.warnings, { total: 3, warnings: 2, unmapped: 1 });
  const by = Object.fromEntries(h.perConnector.map((c) => [c.connectorId, c]));
  assert.equal(by["hl7v2"].warningCount, 3);         // 2 warnings + 1 unmapped, both on hl7v2 events
  assert.equal(by["fhir-r4"].warningCount, 0);
});

// ---- recent failures: ordering + cap + reason ---------------------------------------------------------------

test("recentFailures are ts-desc, carry a short scope reason, and never include ok events", () => {
  const h = computeIntegrationHealth(stream());
  assert.deepEqual(h.recentFailures.map((f) => f.ts), [
    "2026-08-01T10:10:00.000Z",   // fhir-r4 error (latest failure)
    "2026-08-01T09:30:00.000Z",   // hl7v2 failed
    "2026-08-01T08:00:00.000Z",   // file denied (oldest failure)
  ]);
  assert.ok(h.recentFailures.every((f) => f.outcome !== "ok"));
  assert.equal(h.recentFailures[0].reason, "upstream_timeout");
  assert.equal(h.recentFailures[2].reason, "scope_not_granted");
  assert.deepEqual(Object.keys(h.recentFailures[1]).sort(), ["action", "connectorId", "outcome", "ts"]);  // no reason when scope has none
});

test("recentFailures respects the maxRecent cap", () => {
  const many = [];
  for (let i = 0; i < 50; i++) many.push({ action: "context", connectorId: "c", outcome: "error", ts: "2026-08-01T00:00:" + String(i % 60).padStart(2, "0") + ".000Z" });
  const h = computeIntegrationHealth(many, { maxRecent: 5 });
  assert.equal(h.recentFailures.length, 5);
});

test("determinism: shuffled input yields identical output (stable ordering, no wall clock)", () => {
  const a = JSON.stringify(computeIntegrationHealth(stream()));
  const shuffled = stream().reverse();
  const b = JSON.stringify(computeIntegrationHealth(shuffled));
  assert.equal(a, b);
});

test("bounded: maxEvents slices the input before aggregating", () => {
  const h = computeIntegrationHealth(stream(), { maxEvents: 3 });
  assert.equal(h.overall.totalEvents, 3);
  assert.equal(h.generatedFromCount, 3);
});

// ---- empty / malformed => safe zero result, never throws ----------------------------------------------------

test("empty / malformed input => safe zero-filled result, never throws", () => {
  for (const input of [undefined, null, [], {}, 42, "x", [null, undefined, 7, "y", {}], [{ nope: 1 }]]) {
    const h = computeIntegrationHealth(input);
    assert.ok(h && typeof h === "object");
    assert.deepEqual(h.perConnector, []);
    assert.deepEqual(h.recentFailures, []);
    assert.deepEqual(h.warnings, { total: 0, warnings: 0, unmapped: 0 });
    assert.equal(h.overall.totalEvents >= 0, true);
    assert.equal(h.overall.failedCount, 0);
    assert.equal(typeof h.overall.okRate, "number");
    assert.equal(Number.isFinite(h.overall.okRate), true);
  }
  // a purely-empty stream is exactly the zero result
  assert.deepEqual(computeIntegrationHealth([]).overall, { totalEvents: 0, okRate: 0, failedCount: 0, activeConnectors: 0 });
});

// ---- PHI-EXCLUSION guarantee -------------------------------------------------------------------------------

test("PHI-EXCLUSION: patientRefHash / careContextHash / consentId / transactionId values NEVER appear in output", () => {
  const PHI = {
    patientRefHash: "PATIENTREFHASH-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    careContextHash: "CARECONTEXTHASH-cafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
    consentId: "CONSENT-11111111-2222-3333-4444-555555555555",
    transactionId: "TXN-99999999-8888-7777-6666-555555555555",
  };
  const events = [
    { action: "data.received", connectorId: "abdm", outcome: "ok", ts: "2026-08-01T01:00:00.000Z", ...PHI, resourceCounts: { warnings: 1 } },
    { action: "data.failed", connectorId: "abdm", outcome: "error", ts: "2026-08-01T02:00:00.000Z", ...PHI, scope: { consentId: PHI.consentId } },
  ];
  const blob = JSON.stringify(computeIntegrationHealth(events));
  for (const v of Object.values(PHI)) assert.equal(blob.includes(v), false, "PHI value leaked into analytics output: " + v);
  // sanity: the connector + outcomes still aggregated (proves we processed the events, we just excluded the ids)
  assert.equal(JSON.parse(blob).overall.totalEvents, 2);
  assert.equal(JSON.parse(blob).perConnector[0].connectorId, "abdm");
});

test("PHI-EXCLUSION: a PHI-shaped scope.reason is defensively dropped; a short reason code is kept", () => {
  const events = [
    { action: "context", connectorId: "c1", outcome: "error", ts: "2026-08-01T03:00:00.000Z", scope: { reason: "deadbeefdeadbeefdeadbeefdeadbeef" } }, // 32 hex => hash-shaped => dropped
    { action: "context", connectorId: "c2", outcome: "error", ts: "2026-08-01T02:00:00.000Z", scope: { reason: "patient john.doe@example.com" } },       // free text / email => dropped
    { action: "context", connectorId: "c3", outcome: "error", ts: "2026-08-01T01:00:00.000Z", scope: { reason: "rate_limited" } },                        // short code => kept
  ];
  const h = computeIntegrationHealth(events);
  const byConn = Object.fromEntries(h.recentFailures.map((f) => [f.connectorId, f]));
  assert.equal("reason" in byConn["c1"], false);
  assert.equal("reason" in byConn["c2"], false);
  assert.equal(byConn["c3"].reason, "rate_limited");
  const blob = JSON.stringify(h);
  assert.equal(blob.includes("deadbeef"), false);
  assert.equal(blob.includes("john.doe@example.com"), false);
});

// ---- reader: flag-gated + fail-closed RBAC (connector:read) + tenant-scoped --------------------------------

const idFn = (id, guest = false) => async () => ({ id, guest });
function seed() {
  return makeMockDb({
    connect_tenant: [{ id: "t1", mode: "sandbox" }, { id: "t2", mode: "sandbox" }],
    connect_membership: [
      { user_id: "u-admin", tenant_id: "t1", role: "admin" },
      { user_id: "u-aud", tenant_id: "t1", role: "auditor" },
      { user_id: "u-t2", tenant_id: "t2", role: "admin" },
    ],
    connect_audit_event: [
      // t1 rows — snake_case D1 shape; resource_counts stored as a JSON STRING (as D1 does).
      { id: "1", tenant_id: "t1", action: "context", connector_id: "fhir-r4", outcome: "ok", ts: "2026-08-01T10:00:00.000Z", patient_ref_hash: "SECRET-HASH-A" },
      { id: "2", tenant_id: "t1", action: "context", connector_id: "fhir-r4", outcome: "error", ts: "2026-08-01T10:05:00.000Z", patient_ref_hash: "SECRET-HASH-B", scope: JSON.stringify({ reason: "upstream_5xx" }) },
      { id: "3", tenant_id: "t1", action: "ingest.hl7", connector_id: "hl7v2", outcome: "ok", ts: "2026-08-01T09:00:00.000Z", resource_counts: JSON.stringify({ warnings: 4 }) },
      // t2 row — MUST NEVER appear in a t1 read.
      { id: "9", tenant_id: "t2", action: "context", connector_id: "epic", outcome: "ok", ts: "2026-08-01T11:00:00.000Z", patient_ref_hash: "OTHER-TENANT" },
    ],
  });
}

test("reader: admin (connector:read) gets tenant-scoped, PHI-free health from real D1 rows", async () => {
  const h = await readTenantIntegrationHealth({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1");
  assert.equal(h.overall.totalEvents, 3);                                  // t1 only, never t2
  const ids = h.perConnector.map((c) => c.connectorId).sort();
  assert.deepEqual(ids, ["fhir-r4", "hl7v2"]);                             // never "epic" (t2)
  assert.equal(h.warnings.warnings, 4);                                    // JSON-string resource_counts parsed
  assert.equal(h.recentFailures[0].reason, "upstream_5xx");               // JSON-string scope parsed
  const blob = JSON.stringify(h);
  assert.equal(blob.includes("SECRET-HASH"), false);                       // per-row pseudonym never surfaces
  assert.equal(blob.includes("OTHER-TENANT"), false);                      // cross-tenant row never surfaces
  assert.equal(blob.includes("epic"), false);
});

test("reader: auditor may READ health (connector:read is read-only)", async () => {
  const h = await readTenantIntegrationHealth({ db: seed(), identifyFn: idFn("u-aud") }, {}, {}, "t1");
  assert.equal(h.overall.totalEvents, 3);
});

test("reader: member of t1 cannot read t2 (cross-tenant => PermissionError)", async () => {
  await assert.rejects(() => readTenantIntegrationHealth({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t2"), PermissionError);
});

test("reader: guest / unauthenticated => AuthError (fail-closed)", async () => {
  await assert.rejects(() => readTenantIntegrationHealth({ db: seed(), identifyFn: idFn("ip:x", true) }, {}, {}, "t1"), AuthError);
});

// ---- endpoint: flag gate (requires BOTH smd_connect and smd_connect_onboard) --------------------------------

test("flagOnboardOn requires BOTH master (smd_connect) and surface (smd_connect_onboard) flags", () => {
  assert.equal(flagOnboardOn({}), false);
  assert.equal(flagOnboardOn({ CONNECT_FLAG: "1" }), false);                       // master only
  assert.equal(flagOnboardOn({ CONNECT_ONBOARD_FLAG: "1" }), false);              // surface only
  assert.equal(flagOnboardOn({ CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1" }), true);
});

test("endpoint: flag OFF => 404 (no existence leak)", async () => {
  const req = new Request("https://x/api/connect/onboard/health?tenant=t1");
  const res = await onRequest({ request: req, env: {} });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not_found" });
});

test("endpoint: flag ON + unauthenticated => 401 (sanitized), never a 200", async () => {
  const req = new Request("https://x/api/connect/onboard/health?tenant=t1");
  const res = await onRequest({ request: req, env: { CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_DB: seed() } });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "auth" });
});
