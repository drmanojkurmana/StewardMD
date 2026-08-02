// test/connect/onboard/consents.test.mjs — Consent Dashboard (Increment 1): a tenant-scoped, PHI-free READ of
// the tenant's own connect_abdm_consent_req rows, plus a LOCAL revoke that our own data-request gate enforces.
// Pins: cross-tenant isolation (never another tenant's rows/hash), most-recent-first ordering, the exact
// client-safe allow-list projection (careContextCount is a COUNT, never the raw care-context list; the
// patient hash is truncated; actor is dropped entirely), fail-closed RBAC (read=connector:read,
// revoke=connector:write), empty binding => empty list, the local-revoke monotonic contract (GRANTED/INITIATED
// -> REVOKED, already-REVOKED is an idempotent no-op, EXPIRED/DENIED refuse), cross-tenant IDOR on revoke, and
// the provider factory (ABDM/HIP flag off => local; on but unwired => not-supported, never a silent success).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readTenantConsents, revokeTenantConsent, toConsentRow, getConsentProvider } from "../../../functions/_connect/onboard/consents.js";
import { consentFlagOn } from "../../../functions/_connect/onboard/consent-flags.js";
import { AuthError, PermissionError } from "../../../functions/_connect/permission.js";
import { OnboardError } from "../../../functions/_connect/onboard/errors.js";
import { makeMockDb } from "../../../functions/_connect/testkit.js";
import { makeOnboardDb } from "./onboard-db.mjs";

const idFn = (id, guest = false) => async () => ({ id, guest });

// The exact client-safe allow-list toConsentRow projects onto -- pinned so a future edit can't silently widen it.
const ALLOW = ["careContextCount", "consentId", "createdAt", "dataEraseAt", "dateRange", "expiresAt", "hiTypes",
  "patientRefHash", "purpose", "ref", "revocable", "status", "updatedAt"].sort();

// ---- read-side fixture (makeMockDb: read-only, first-`?`-WHERE-match -- sufficient for reads/projection) -----
function seed() {
  return makeMockDb({
    connect_tenant: [{ id: "t1" }, { id: "t2" }],
    connect_membership: [
      { user_id: "u-admin", tenant_id: "t1", role: "admin" },
      { user_id: "u-clin", tenant_id: "t1", role: "clinician" },
      { user_id: "u-t2", tenant_id: "t2", role: "admin" },
    ],
    connect_abdm_consent_req: [
      {
        request_id: "REQ-1", tenant_id: "t1", actor: "cfa:aaa",
        patient_abha_hash: "91123456789012345",                         // RAW-looking ABHA -- must never leak in full
        status: "GRANTED", consent_id: "CONSENT-1111",
        hi_types: JSON.stringify(["DiagnosticReport", "Observation"]),
        care_contexts: JSON.stringify(["RAW-CARECTX-REF-AAA", "RAW-CARECTX-REF-BBB"]),   // raw refs -- must never leak
        purpose: JSON.stringify({ code: "CAREMGT", text: "Care Management" }),
        date_range: JSON.stringify({ from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T23:59:59.000Z" }),
        created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-08-01T09:00:00.000Z",
        expires_at: "2026-12-31T23:59:59.000Z", data_erase_at: "2027-01-31T23:59:59.000Z",
      },
      {
        request_id: "REQ-2", tenant_id: "t1", actor: "cfa:bbb",
        patient_abha_hash: "77998877665544332",
        status: "REVOKED", consent_id: "CONSENT-2222",
        hi_types: JSON.stringify(["Prescription"]),
        care_contexts: JSON.stringify(["RAW-CARECTX-REF-CCC"]),
        purpose: JSON.stringify("management"),
        date_range: JSON.stringify({ from: "2026-02-01T00:00:00.000Z", to: "2026-06-30T23:59:59.000Z" }),
        created_at: "2026-05-01T00:00:00.000Z", updated_at: "2026-08-01T11:00:00.000Z",
        expires_at: "2026-06-30T23:59:59.000Z", data_erase_at: null,
      },
      {
        // INITIATED, no consent_id linked yet -- ref must fall back to request_id.
        request_id: "REQ-3", tenant_id: "t1", actor: "cfa:ccc",
        patient_abha_hash: null, status: "INITIATED", consent_id: null,
        hi_types: null, care_contexts: null, purpose: null, date_range: null,
        created_at: "2026-08-01T10:00:00.000Z", updated_at: "2026-08-01T10:00:00.000Z",
        expires_at: null, data_erase_at: null,
      },
      // t2 row -- MUST NEVER appear in a t1 read.
      {
        request_id: "REQ-9", tenant_id: "t2", actor: "cfa:zzz",
        patient_abha_hash: "OTHER-TENANT-RAW-ABHA-HASH-999", status: "GRANTED", consent_id: "CONSENT-9999",
        hi_types: JSON.stringify(["Observation"]), care_contexts: JSON.stringify(["OTHER-TENANT-CARECTX-REF"]),
        purpose: JSON.stringify("research"),
        date_range: JSON.stringify({ from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T23:59:59.000Z" }),
        created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-08-01T12:00:00.000Z",
        expires_at: "2026-12-31T23:59:59.000Z", data_erase_at: null,
      },
    ],
  });
}

// ---- cross-tenant isolation + ordering ------------------------------------------------------------------

test("returns only the caller's tenant rows, most-recent-first", async () => {
  const r = await readTenantConsents({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1");
  assert.equal(r.ok, true);
  assert.equal(r.consents.length, 3);
  assert.deepEqual(r.consents.map((c) => c.ref), ["CONSENT-2222", "REQ-3", "CONSENT-1111"]);
  const blob = JSON.stringify(r);
  assert.equal(blob.includes("CONSENT-9999"), false);
  assert.equal(blob.includes("OTHER-TENANT-RAW-ABHA-HASH-999"), false);
  assert.equal(blob.includes("OTHER-TENANT-CARECTX-REF"), false);
});

// ---- PHI-free projection: exact allow-list + never a raw ABHA / raw care-context ref / actor --------------

test("client-safe projection: exact allow-list keys, careContextCount is a number not the raw array", async () => {
  const r = await readTenantConsents({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1");
  for (const c of r.consents) assert.deepEqual(Object.keys(c).sort(), ALLOW);
  const granted = r.consents.find((c) => c.ref === "CONSENT-1111");
  assert.equal(typeof granted.careContextCount, "number");
  assert.equal(granted.careContextCount, 2);
  assert.equal(granted.revocable, true);
  assert.deepEqual(granted.hiTypes, ["DiagnosticReport", "Observation"]);
  assert.deepEqual(granted.dateRange, { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T23:59:59.000Z" });
  const revoked = r.consents.find((c) => c.ref === "CONSENT-2222");
  assert.equal(revoked.revocable, false);
  assert.equal(revoked.purpose, "management");
  const initiated = r.consents.find((c) => c.ref === "REQ-3");
  assert.equal(initiated.consentId, null);
  assert.equal(initiated.careContextCount, 0);
});

test("PHI-free by construction: raw-looking ABHA, raw care-context refs, and actor never appear in the output", async () => {
  const r = await readTenantConsents({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1");
  const blob = JSON.stringify(r);
  for (const forbidden of [
    "91123456789012345", "77998877665544332",                              // raw-looking ABHA (full value)
    "RAW-CARECTX-REF-AAA", "RAW-CARECTX-REF-BBB", "RAW-CARECTX-REF-CCC",    // raw care-context references
    "cfa:aaa", "cfa:bbb", "cfa:ccc",                                        // actor
    "actor", "patient_abha_hash", "care_contexts",
  ]) {
    assert.equal(blob.includes(forbidden), false, "leaked forbidden field/value: " + forbidden);
  }
});

// ---- bounded + truncated (mirrors activity.js's contract) -------------------------------------------------

test("bounded by limit; truncated=true when more rows exist than the limit", async () => {
  const r = await readTenantConsents({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1", { limit: 2 });
  assert.equal(r.consents.length, 2);
  assert.equal(r.truncated, true);
});

test("truncated=false when the limit is not exceeded", async () => {
  const r = await readTenantConsents({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t1", { limit: 50 });
  assert.equal(r.truncated, false);
});

// ---- empty binding => empty list, not an error -------------------------------------------------------------

test("D1 binding absent => empty list, not an error", async () => {
  const r1 = await readTenantConsents({ identifyFn: idFn("u-admin") }, {}, {}, "t1");
  assert.deepEqual(r1, { ok: true, consents: [], truncated: false });
  const r2 = await readTenantConsents({ db: null, identifyFn: idFn("u-admin") }, {}, {}, "t1");
  assert.deepEqual(r2, { ok: true, consents: [], truncated: false });
});

// ---- fail-closed RBAC (read: connector:read) ---------------------------------------------------------------

test("clinician (holds connector:read) may read consents", async () => {
  const r = await readTenantConsents({ db: seed(), identifyFn: idFn("u-clin") }, {}, {}, "t1");
  assert.equal(r.consents.length, 3);
});

test("a member of t1 cannot read t2's consents (cross-tenant => PermissionError)", async () => {
  await assert.rejects(() => readTenantConsents({ db: seed(), identifyFn: idFn("u-admin") }, {}, {}, "t2"), PermissionError);
});

test("a non-member of the tenant is denied (PermissionError)", async () => {
  await assert.rejects(() => readTenantConsents({ db: seed(), identifyFn: idFn("u-stranger") }, {}, {}, "t1"), PermissionError);
});

test("guest / unauthenticated caller is denied (AuthError, fail-closed)", async () => {
  await assert.rejects(() => readTenantConsents({ db: seed(), identifyFn: idFn("ip:x", true) }, {}, {}, "t1"), AuthError);
});

// ---- flag predicate (new file: consent-flags.js) -----------------------------------------------------------

test("consentFlagOn requires smd_connect AND smd_connect_onboard AND smd_connect_consent", () => {
  assert.equal(consentFlagOn({}), false);
  assert.equal(consentFlagOn({ CONNECT_FLAG: "1" }), false);
  assert.equal(consentFlagOn({ CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1" }), false);
  assert.equal(consentFlagOn({ CONNECT_ONBOARD_FLAG: "1", CONNECT_CONSENT_FLAG: "1" }), false);   // base flag missing
  assert.equal(consentFlagOn({ CONNECT_FLAG: "1", CONNECT_ONBOARD_FLAG: "1", CONNECT_CONSENT_FLAG: "1" }), true);
});

// ==== LOCAL REVOKE ==========================================================================================
// GOTCHA (per design): makeMockDb supports INSERT + first-`?`-WHERE-match only -- UPDATE/DELETE are no-ops, so
// it cannot round-trip the revoke's UPDATE ... WHERE request_id=?. Reuse the ALREADY-EXISTING purpose-built
// round-tripping mock (test/connect/onboard/onboard-db.mjs#makeOnboardDb, used throughout onboard-router.test
// and onboard-db tests) instead of writing a new one -- it supports INSERT / SELECT / UPDATE ... SET ... WHERE
// / DELETE for exactly the col=? (ANDed) shape updateConsentStatus/revokeTenantConsent emit. NEVER weaken
// updateConsentStatus (the Stage-3 monotonic guard) to fit a mock.

function seedRevoke() {
  return makeOnboardDb({
    connect_tenant: [{ id: "t1" }, { id: "t2" }],
    connect_membership: [
      { user_id: "u-owner", tenant_id: "t1", role: "owner" },
      { user_id: "u-admin", tenant_id: "t1", role: "admin" },
      { user_id: "u-clin", tenant_id: "t1", role: "clinician" },
      { user_id: "u-t2", tenant_id: "t2", role: "admin" },
    ],
    connect_abdm_consent_req: [
      { request_id: "REQ-G1", tenant_id: "t1", status: "GRANTED", consent_id: "CONSENT-G1", patient_abha_hash: "H1",
        hi_types: null, care_contexts: null, purpose: null, date_range: null,
        created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z", expires_at: "2026-12-31T23:59:59.000Z", data_erase_at: null },
      { request_id: "REQ-I1", tenant_id: "t1", status: "INITIATED", consent_id: null, patient_abha_hash: "H2",
        hi_types: null, care_contexts: null, purpose: null, date_range: null,
        created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z", expires_at: null, data_erase_at: null },
      { request_id: "REQ-R1", tenant_id: "t1", status: "REVOKED", consent_id: "CONSENT-R1", patient_abha_hash: "H3",
        hi_types: null, care_contexts: null, purpose: null, date_range: null,
        created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z", expires_at: "2026-12-31T23:59:59.000Z", data_erase_at: null },
      { request_id: "REQ-E1", tenant_id: "t1", status: "EXPIRED", consent_id: "CONSENT-E1", patient_abha_hash: "H4",
        hi_types: null, care_contexts: null, purpose: null, date_range: null,
        created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", expires_at: "2026-02-01T00:00:00.000Z", data_erase_at: null },
      { request_id: "REQ-D1", tenant_id: "t1", status: "DENIED", consent_id: "CONSENT-D1", patient_abha_hash: "H5",
        hi_types: null, care_contexts: null, purpose: null, date_range: null,
        created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", expires_at: null, data_erase_at: null },
      { request_id: "REQ-T2", tenant_id: "t2", status: "GRANTED", consent_id: "CONSENT-T2", patient_abha_hash: "H6",
        hi_types: null, care_contexts: null, purpose: null, date_range: null,
        created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z", expires_at: "2026-12-31T23:59:59.000Z", data_erase_at: null },
    ],
  });
}

test("owner may revoke a GRANTED consent by consentId ref -> REVOKED, propagated local, and audited", async () => {
  const db = seedRevoke();
  const r = await revokeTenantConsent({ db, identifyFn: idFn("u-owner") }, {}, {}, "t1", "CONSENT-G1");
  assert.deepEqual(r, { ok: true, status: "REVOKED", propagated: "local" });
  const row = db._tables.connect_abdm_consent_req.find((x) => x.request_id === "REQ-G1");
  assert.equal(row.status, "REVOKED");
  const audit = db._tables.connect_audit_event || [];
  assert.equal(audit.some((e) => e.action === "consent.revoked"), true);
});

test("admin may revoke an INITIATED consent by request_id ref (no linked consent_id yet)", async () => {
  const db = seedRevoke();
  const r = await revokeTenantConsent({ db, identifyFn: idFn("u-admin") }, {}, {}, "t1", "REQ-I1");
  assert.deepEqual(r, { ok: true, status: "REVOKED", propagated: "local" });
});

test("clinician (connector:read only, lacks connector:write) cannot revoke -> PermissionError", async () => {
  const db = seedRevoke();
  await assert.rejects(() => revokeTenantConsent({ db, identifyFn: idFn("u-clin") }, {}, {}, "t1", "CONSENT-G1"), PermissionError);
  const row = db._tables.connect_abdm_consent_req.find((x) => x.request_id === "REQ-G1");
  assert.equal(row.status, "GRANTED");   // denied before any write
});

test("a non-member of the tenant cannot revoke -> PermissionError", async () => {
  const db = seedRevoke();
  await assert.rejects(() => revokeTenantConsent({ db, identifyFn: idFn("u-stranger") }, {}, {}, "t1", "CONSENT-G1"), PermissionError);
});

test("guest cannot revoke -> AuthError", async () => {
  const db = seedRevoke();
  await assert.rejects(() => revokeTenantConsent({ db, identifyFn: idFn("ip:x", true) }, {}, {}, "t1", "CONSENT-G1"), AuthError);
});

test("cross-tenant IDOR: a t1 admin cannot revoke t2's consent, even by the right ref (row pool is tenant-scoped)", async () => {
  const db = seedRevoke();
  await assert.rejects(() => revokeTenantConsent({ db, identifyFn: idFn("u-admin") }, {}, {}, "t1", "CONSENT-T2"), OnboardError);
  const row = db._tables.connect_abdm_consent_req.find((x) => x.request_id === "REQ-T2");
  assert.equal(row.status, "GRANTED");   // t2's row untouched
});

test("revoking an already-REVOKED consent is idempotent (noop, no duplicate audit)", async () => {
  const db = seedRevoke();
  const r1 = await revokeTenantConsent({ db, identifyFn: idFn("u-owner") }, {}, {}, "t1", "CONSENT-R1");
  assert.deepEqual(r1, { ok: true, status: "REVOKED", noop: true });
  const auditCountAfterFirst = (db._tables.connect_audit_event || []).length;
  const r2 = await revokeTenantConsent({ db, identifyFn: idFn("u-owner") }, {}, {}, "t1", "CONSENT-R1");
  assert.deepEqual(r2, { ok: true, status: "REVOKED", noop: true });
  assert.equal((db._tables.connect_audit_event || []).length, auditCountAfterFirst);
});

test("an EXPIRED consent refuses revoke (terminal) -> OnboardError", async () => {
  const db = seedRevoke();
  await assert.rejects(() => revokeTenantConsent({ db, identifyFn: idFn("u-owner") }, {}, {}, "t1", "CONSENT-E1"), OnboardError);
  const row = db._tables.connect_abdm_consent_req.find((x) => x.request_id === "REQ-E1");
  assert.equal(row.status, "EXPIRED");
});

test("a DENIED consent refuses revoke (terminal) -> OnboardError", async () => {
  const db = seedRevoke();
  await assert.rejects(() => revokeTenantConsent({ db, identifyFn: idFn("u-owner") }, {}, {}, "t1", "CONSENT-D1"), OnboardError);
});

test("an unresolvable ref -> not-found (OnboardError)", async () => {
  const db = seedRevoke();
  await assert.rejects(() => revokeTenantConsent({ db, identifyFn: idFn("u-owner") }, {}, {}, "t1", "NOPE"), OnboardError);
});

// ==== PROVIDER FACTORY =======================================================================================

test("provider factory: ABDM/HIP flag OFF -> the local provider (revoke actually flips status)", async () => {
  const db = seedRevoke();
  const provider = getConsentProvider({});
  const row = db._tables.connect_abdm_consent_req.find((x) => x.request_id === "REQ-G1");
  const r = await provider.revokeConsent({ db }, {}, row, "2026-08-02T00:00:00.000Z");
  assert.deepEqual(r, { ok: true, status: "REVOKED", propagated: "local" });
  assert.equal(row.status, "REVOKED");
});

test("provider factory: ABDM/HIP flag ON but unwired -> not-supported, no silent success, row unchanged", async () => {
  const db = seedRevoke();
  const env = { CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1" };
  const provider = getConsentProvider(env);
  const row = db._tables.connect_abdm_consent_req.find((x) => x.request_id === "REQ-G1");
  const r = await provider.revokeConsent({ db }, env, row, "2026-08-02T00:00:00.000Z");
  assert.deepEqual(r, { ok: false, reason: "not-supported" });
  assert.equal(row.status, "GRANTED");
});

test("revokeTenantConsent end-to-end: ABDM/HIP flag ON routes through the (unwired) ABDM provider -> not-supported", async () => {
  const db = seedRevoke();
  const env = { CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1" };
  const r = await revokeTenantConsent({ db, identifyFn: idFn("u-owner") }, {}, env, "t1", "CONSENT-G1");
  assert.deepEqual(r, { ok: false, reason: "not-supported" });
  const row = db._tables.connect_abdm_consent_req.find((x) => x.request_id === "REQ-G1");
  assert.equal(row.status, "GRANTED");
});

// ---- toConsentRow unit pins (defensive parsing) --------------------------------------------------------------

test("toConsentRow: null/undefined row -> null; malformed JSON columns degrade safely (never throw)", () => {
  assert.equal(toConsentRow(null), null);
  const row = {
    request_id: "REQ-X", tenant_id: "t1", status: "GRANTED", consent_id: null,
    hi_types: "not-json", care_contexts: "not-json", purpose: "bare-string", date_range: "not-json",
    patient_abha_hash: "short", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    expires_at: null, data_erase_at: null,
  };
  const c = toConsentRow(row);
  assert.deepEqual(c.hiTypes, []);
  assert.equal(c.careContextCount, 0);
  assert.equal(c.dateRange, null);
  assert.equal(c.purpose, "bare-string");    // unparseable JSON falls back to the raw string, never throws
  assert.equal(c.patientRefHash, "short");   // shorter than HASH_VISIBLE -> returned as-is, not truncated
  assert.equal(c.ref, "REQ-X");              // consent_id null -> falls back to request_id
});
