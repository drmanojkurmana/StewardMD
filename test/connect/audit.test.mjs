// test/connect/audit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditEvent, hmacPseudonym, makeAuditSink } from "../../functions/_connect/audit.js";
import { makeMockDb } from "../../functions/_connect/testkit.js";

const salt = "c2FsdA=="; // "salt"

test("buildAuditEvent keeps ONLY allow-listed keys (PHI-free by construction)", () => {
  const e = buildAuditEvent({ tenantId: "t1", actor: "u1", action: "context", patientName: "John Doe", birthDate: "1975-01-01" });
  assert.equal(e.tenantId, "t1");
  assert.equal("patientName" in e, false);
  assert.equal("birthDate" in e, false);
});

test("hmacPseudonym is per-tenant (same ref, different tenant -> different hash)", async () => {
  const a = await hmacPseudonym({ CONNECT_HMAC_SALT: salt }, "hospA", "MRN123");
  const b = await hmacPseudonym({ CONNECT_HMAC_SALT: salt }, "hospB", "MRN123");
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("sink inserts an allow-listed row and never a raw patient field", async () => {
  const db = makeMockDb({});
  const sink = makeAuditSink({ CONNECT_HMAC_SALT: salt }, db);
  await sink({ tenantId: "t1", actor: "u1", action: "context", outcome: "ok", patientName: "LEAK" });
  const rows = db._tables.connect_audit_event;
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows[0]).includes("LEAK"), false);
});
