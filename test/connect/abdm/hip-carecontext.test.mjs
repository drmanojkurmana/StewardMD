// test/connect/abdm/hip-carecontext.test.mjs — Stage-5 Task-8: care-context REGISTRATION + HIP consent store.
//
// linkCareContext registers a care-context row StewardMD HOLDS (a FollowCare episode) so discovery/serve can find
// it. It must: server-DERIVE the actor+tenant (a non-member => PermissionError BEFORE any write); HMAC the raw ABHA
// (POST-body only) to patient_abha_hash so no raw ABHA lands in any persisted/audited field; be IDEMPOTENT on
// (tenant, patient, ref); and audit hip.linked with metadata only.
// putHipConsent/getHipConsent store/read a HIP-side consent via the MONOTONIC updateConsentStatus (R6): a replayed
// OLDER status is refused and never regresses the row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkCareContext, getServableCareContexts, putHipConsent, getHipConsent } from "../../../functions/_connect/abdm/hip.js";
import { hmacPseudonym } from "../../../functions/_connect/audit.js";
import { PermissionError, AuthError } from "../../../functions/_connect/permission.js";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";

const TENANT = "t-hip";
const SALT = Buffer.from("connect-hip-cc-test-hmac-salt").toString("base64");
const NOW = "2026-07-31T00:00:00Z";
const envOf = (over = {}) => ({ CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", CONNECT_HMAC_SALT: SALT, ...over });
const makeAudit = () => { const events = []; return { fn: async (e) => { events.push(e); }, events }; };
const identify = async () => ({ id: "fb:u1", guest: false });
// A tenant of which fb:u1 IS a member.
const memberDb = () => makeAbdmDb({
  connect_membership: [{ user_id: "fb:u1", tenant_id: TENANT, role: "clinician" }],
  connect_tenant: [{ id: TENANT, mode: "sandbox" }],
});

test("linkCareContext inserts a row keyed by the HMAC; raw ABHA absent from every persisted + audited field", async () => {
  const env = envOf();
  const db = memberDb();
  const audit = makeAudit();
  const { id } = await linkCareContext(env, { db, audit: audit.fn, identify }, {
    request: {}, tenantId: TENANT, abhaAddress: "PATIENT-A@sbx", ref: "cc-A-1", hiType: "DischargeSummary", display: "Discharge A", source: "followcare", now: NOW,
  });
  assert.ok(id, "returns a stable id");
  const rows = db._tables.connect_abdm_carecontext;
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.patient_abha_hash, await hmacPseudonym(env, TENANT, "PATIENT-A@sbx"), "keyed by the per-tenant HMAC");
  assert.equal(row.tenant_id, TENANT);
  assert.equal(row.source, "followcare");
  assert.equal(row.ref, "cc-A-1");
  assert.equal(row.linked_at, NOW);
  // raw ABHA is POST-body-only: it must not appear in ANY persisted column...
  for (const v of Object.values(row)) assert.notEqual(v, "PATIENT-A@sbx");
  assert.equal(JSON.stringify(row).includes("PATIENT-A@sbx"), false, "no raw ABHA in the persisted row");
  // ...nor anywhere in the audit event.
  const ev = audit.events.find((e) => e.action === "hip.linked");
  assert.ok(ev, "audits hip.linked");
  assert.equal(ev.actor, "fb:u1");
  assert.equal(JSON.stringify(audit.events).includes("PATIENT-A@sbx"), false, "no raw ABHA in the audit");
});

test("non-member tenant -> PermissionError BEFORE any write (no row inserted)", async () => {
  const env = envOf();
  // fb:u1 is a member of t-other, NOT of TENANT — but TENANT is a real tenant with real rows.
  const db = makeAbdmDb({
    connect_membership: [{ user_id: "fb:u1", tenant_id: "t-other", role: "clinician" }],
    connect_tenant: [{ id: "t-other", mode: "sandbox" }, { id: TENANT, mode: "sandbox" }],
  });
  const audit = makeAudit();
  await assert.rejects(() => linkCareContext(env, { db, audit: audit.fn, identify }, {
    request: {}, tenantId: TENANT, abhaAddress: "PATIENT-A@sbx", ref: "cc-A-1", now: NOW,
  }), PermissionError);
  assert.equal((db._tables.connect_abdm_carecontext || []).length, 0, "a refused caller writes NO row");
  assert.equal(audit.events.some((e) => e.action === "hip.linked"), false);
});

test("a guest actor -> AuthError before any write", async () => {
  const env = envOf();
  const db = memberDb();
  const guest = async () => ({ id: "ip:1", guest: true });
  await assert.rejects(() => linkCareContext(env, { db, audit: (async () => {}), identify: guest }, {
    request: {}, tenantId: TENANT, abhaAddress: "PATIENT-A@sbx", ref: "cc-A-1", now: NOW,
  }), AuthError);
  assert.equal((db._tables.connect_abdm_carecontext || []).length, 0);
});

test("getServableCareContexts returns only the linked tenant+patient's rows (never another patient's/tenant's)", async () => {
  const env = envOf();
  const db = memberDb();
  await linkCareContext(env, { db, audit: (async () => {}), identify }, { request: {}, tenantId: TENANT, abhaAddress: "PATIENT-A@sbx", ref: "cc-A-1", now: NOW });
  const hashA = await hmacPseudonym(env, TENANT, "PATIENT-A@sbx");
  const hashB = await hmacPseudonym(env, TENANT, "PATIENT-B@sbx");
  assert.equal((await getServableCareContexts(db, TENANT, hashA)).length, 1, "the linked patient's row is servable");
  assert.equal((await getServableCareContexts(db, TENANT, hashB)).length, 0, "a different patient's lookup finds nothing");
  assert.equal((await getServableCareContexts(db, "t-other", hashA)).length, 0, "a different tenant finds nothing");
});

test("a second identical link (same tenant, patient, ref) is IDEMPOTENT (stable id, no duplicate row)", async () => {
  const env = envOf();
  const db = memberDb();
  const args = { request: {}, tenantId: TENANT, abhaAddress: "PATIENT-A@sbx", ref: "cc-A-1", hiType: "DischargeSummary", display: "D", source: "followcare", now: NOW };
  const r1 = await linkCareContext(env, { db, audit: (async () => {}), identify }, args);
  const r2 = await linkCareContext(env, { db, audit: (async () => {}), identify }, { ...args, now: "2026-08-01T00:00:00Z", display: "D-again" });
  assert.equal(r1.id, r2.id, "the id is stable across identical links");
  assert.equal(db._tables.connect_abdm_carecontext.length, 1, "no duplicate row");
  // a DIFFERENT ref for the same patient IS a distinct row.
  const r3 = await linkCareContext(env, { db, audit: (async () => {}), identify }, { ...args, ref: "cc-A-2" });
  assert.notEqual(r3.id, r1.id);
  assert.equal(db._tables.connect_abdm_carecontext.length, 2);
});

test("putHipConsent stores a GRANTED HIP consent; getHipConsent reads it; a replayed OLDER status is refused (monotonic R6)", async () => {
  const db = makeAbdmDb({});
  const granted = await putHipConsent(db, { requestId: "hc-1", tenantId: TENANT, patientAbhaHash: "HMAC-x", hiTypes: ["DischargeSummary"], expiresAt: "2026-12-31T00:00:00Z", status: "GRANTED", now: NOW });
  assert.deepEqual(granted, { ok: true, status: "GRANTED" });
  const got = await getHipConsent(db, "hc-1");
  assert.equal(got.status, "GRANTED");
  assert.equal(got.patient_abha_hash, "HMAC-x");           // only the HMAC is stored, never a raw ABHA
  for (const k of ["patient_abha", "abha", "abhaAddress"]) assert.ok(!(k in got), `unexpected raw-ABHA field: ${k}`);
  // a NEWER revoke is accepted...
  assert.deepEqual(await putHipConsent(db, { requestId: "hc-1", status: "REVOKED", now: NOW }), { ok: true, status: "REVOKED" });
  // ...and a replayed OLDER grant is refused and does NOT un-revoke the row.
  const replay = await putHipConsent(db, { requestId: "hc-1", status: "GRANTED", now: NOW });
  assert.equal(replay.ok, false);
  assert.equal(replay.status, "REVOKED");
  assert.equal((await getHipConsent(db, "hc-1")).status, "REVOKED");
  assert.equal(await getHipConsent(db, "nope"), null);
});
