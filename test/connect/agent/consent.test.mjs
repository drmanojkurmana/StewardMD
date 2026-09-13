// test/connect/agent/consent.test.mjs - Server-owned consent records and verification for agent broker.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_SCOPES,
  CONSENT_POLICY_VERSION,
  CONSENT_DEFAULT_TTL_MS,
  normalizeScope,
  recordConsent,
  verifyConsentRow,
  assertConsent,
  revokeConsent,
  consentView,
} from "../../../functions/_connect/agent/consent.js";
import { makeAgentDb } from "./agent-db.mjs";

const SIGNING_KEY = "test-consent-signing-key-32bytes-secret";
const ENV = { CONNECT_CONSENT_SIGNING_KEY: SIGNING_KEY };

test("signing key missing fails closed", async () => {
  const db = makeAgentDb();
  const deps = { db, now: () => 1000000 };

  await assert.rejects(
    () => recordConsent(deps, {}, { tenantId: "t1", actorId: "a1", deploymentId: "d1", scope: ["emr:session"] }),
    { name: "OnboardError", klass: "not-configured" }
  );

  await assert.rejects(
    () => verifyConsentRow({}, { id: "c1" }),
    { name: "OnboardError", klass: "not-configured" }
  );
});

test("normalizeScope validates, deduplicates and sorts valid scopes", () => {
  assert.deepEqual(normalizeScope(["emr:read", "emr:session"]), ["emr:read", "emr:session"]);
  assert.deepEqual(normalizeScope(["emr:read", "emr:session", "emr:read"]), ["emr:read", "emr:session"]);
  assert.deepEqual(normalizeScope(["emr:discover"]), ["emr:discover"]);

  // Empty scope array rejected
  assert.throws(() => normalizeScope([]), { name: "OnboardError", klass: "invalid" });
  assert.throws(() => normalizeScope(null), { name: "OnboardError", klass: "invalid" });

  // Unknown or privileged scopes rejected (read-only by construction)
  assert.throws(() => normalizeScope(["emr:write"]), { name: "OnboardError", klass: "invalid" });
  assert.throws(() => normalizeScope(["emr:admin"]), { name: "OnboardError", klass: "invalid" });
  assert.throws(() => normalizeScope(["emr:order"]), { name: "OnboardError", klass: "invalid" });
});

test("recordConsent writes server-owned record with keyed HMAC and TTL", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };

  const row = await recordConsent(deps, ENV, {
    tenantId: "tenant-1",
    actorId: "actor-doc-1",
    deploymentId: "dep-1",
    scope: ["emr:session", "emr:read"],
    now: nowMs,
  });

  assert.match(row.id, /^con_/);
  assert.equal(row.tenant_id, "tenant-1");
  assert.equal(row.actor_id, "actor-doc-1");
  assert.equal(row.deployment_id, "dep-1");
  assert.deepEqual(JSON.parse(row.scope), ["emr:read", "emr:session"]);
  assert.equal(row.policy_version, CONSENT_POLICY_VERSION);
  assert.equal(row.expires_at, nowMs + CONSENT_DEFAULT_TTL_MS);
  assert.match(row.receipt_hmac, /^[0-9a-f]{64}$/);

  // Custom TTL is respected
  const customRow = await recordConsent(deps, ENV, {
    tenantId: "tenant-1",
    actorId: "actor-doc-1",
    deploymentId: "dep-1",
    scope: ["emr:session"],
    ttlMs: 3600000,
    now: nowMs,
  });
  assert.equal(customRow.expires_at, nowMs + 3600000);
});

test("verifyConsentRow verifies valid signature and detects tampering", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };

  const row = await recordConsent(deps, ENV, {
    tenantId: "tenant-1",
    actorId: "actor-doc-1",
    deploymentId: "dep-1",
    scope: ["emr:session", "emr:read"],
    now: nowMs,
  });

  // Valid verification
  assert.equal(await verifyConsentRow(ENV, row, { requiredScope: ["emr:read"], now: nowMs + 1000 }), true);

  // Tampered scope
  const tamperedScope = Object.assign({}, row, { scope: JSON.stringify(["emr:read", "emr:session", "emr:discover"]) });
  await assert.rejects(
    () => verifyConsentRow(ENV, tamperedScope, { now: nowMs }),
    { name: "OnboardError", klass: "forbidden" }
  );

  // Tampered actor_id
  const tamperedActor = Object.assign({}, row, { actor_id: "actor-doc-2" });
  await assert.rejects(
    () => verifyConsentRow(ENV, tamperedActor, { now: nowMs }),
    { name: "OnboardError", klass: "forbidden" }
  );

  // Tampered tenant_id
  const tamperedTenant = Object.assign({}, row, { tenant_id: "tenant-2" });
  await assert.rejects(
    () => verifyConsentRow(ENV, tamperedTenant, { now: nowMs }),
    { name: "OnboardError", klass: "forbidden" }
  );

  // Wrong key fails
  await assert.rejects(
    () => verifyConsentRow({ CONNECT_CONSENT_SIGNING_KEY: "wrong-signing-key" }, row, { now: nowMs }),
    { name: "OnboardError", klass: "forbidden" }
  );
});

test("expiry and scope checks fail-closed", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };

  const row = await recordConsent(deps, ENV, {
    tenantId: "tenant-1",
    actorId: "actor-doc-1",
    deploymentId: "dep-1",
    scope: ["emr:session", "emr:read"],
    ttlMs: 5000,
    now: nowMs,
  });

  // Exactly at expiry or past expiry -> expired
  await assert.rejects(
    () => verifyConsentRow(ENV, row, { now: nowMs + 5000 }),
    { name: "OnboardError", klass: "expired" }
  );
  await assert.rejects(
    () => verifyConsentRow(ENV, row, { now: nowMs + 10000 }),
    { name: "OnboardError", klass: "expired" }
  );

  // Missing required scope
  await assert.rejects(
    () => verifyConsentRow(ENV, row, { requiredScope: ["emr:discover"], now: nowMs }),
    { name: "OnboardError", klass: "forbidden" }
  );
});

test("revocation marks row and verify fails closed", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };

  const row = await recordConsent(deps, ENV, {
    tenantId: "tenant-1",
    actorId: "actor-doc-1",
    deploymentId: "dep-1",
    scope: ["emr:session", "emr:read"],
    now: nowMs,
  });

  // Revoke consent
  const revRes = await revokeConsent(deps, ENV, {
    tenantId: "tenant-1",
    consentId: row.id,
    now: nowMs + 1000,
  });
  assert.equal(revRes.ok, true);

  // Verification now fails with revoked
  const revokedRow = await db.prepare("SELECT * FROM connect_agent_consent WHERE tenant_id=? AND id=?").bind("tenant-1", row.id).first();
  await assert.rejects(
    () => verifyConsentRow(ENV, revokedRow, { now: nowMs + 2000 }),
    { name: "OnboardError", klass: "revoked" }
  );

  // Revoking non-existent consent throws not-found
  await assert.rejects(
    () => revokeConsent(deps, ENV, { tenantId: "tenant-1", consentId: "con_nonexistent", now: nowMs }),
    { name: "OnboardError", klass: "not-found" }
  );
});

test("assertConsent resolves active consent and ignores expired or revoked rows", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };

  // 1. Create a shorter consent that will be expired
  await recordConsent(deps, ENV, {
    tenantId: "t1",
    actorId: "doc1",
    deploymentId: "dep1",
    scope: ["emr:session", "emr:read"],
    ttlMs: 1000,
    now: nowMs,
  });

  // 2. Create a longer valid consent
  const active = await recordConsent(deps, ENV, {
    tenantId: "t1",
    actorId: "doc1",
    deploymentId: "dep1",
    scope: ["emr:session", "emr:read"],
    ttlMs: 100000,
    now: nowMs,
  });

  // Asserting consent at nowMs + 5000: active one is selected
  const resolved = await assertConsent(deps, ENV, {
    tenantId: "t1",
    actorId: "doc1",
    deploymentId: "dep1",
    requiredScope: ["emr:read"],
    now: nowMs + 5000,
  });
  assert.equal(resolved.id, active.id);

  // When active is revoked, assertConsent fails closed
  await revokeConsent(deps, ENV, { tenantId: "t1", consentId: active.id, now: nowMs + 6000 });
  await assert.rejects(
    () => assertConsent(deps, ENV, {
      tenantId: "t1",
      actorId: "doc1",
      deploymentId: "dep1",
      requiredScope: ["emr:read"],
      now: nowMs + 7000,
    })
  );
});

test("consentView projects safe client fields without secrets or HMAC", async () => {
  const db = makeAgentDb();
  const nowMs = 1700000000000;
  const deps = { db, now: () => nowMs };

  const row = await recordConsent(deps, ENV, {
    tenantId: "t1",
    actorId: "doc1",
    deploymentId: "dep1",
    scope: ["emr:session", "emr:read"],
    now: nowMs,
  });

  const view = consentView(row);
  assert.equal(view.consentId, row.id);
  assert.deepEqual(view.scope, ["emr:read", "emr:session"]);
  assert.equal(view.policyVersion, CONSENT_POLICY_VERSION);
  assert.equal(view.expiresAt, row.expires_at);
  assert.equal(view.revokedAt, null);

  // Verify internal columns are omitted
  assert.equal("receipt_hmac" in view, false);
  assert.equal("tenant_id" in view, false);
  assert.equal("actor_id" in view, false);
});
