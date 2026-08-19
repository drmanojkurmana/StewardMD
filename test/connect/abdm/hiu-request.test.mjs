// test/connect/abdm/hiu-request.test.mjs — Stage-4 Task-6: the DATA REQUEST (hiu.js requestHealthInformation).
// Per-request consent-binding (R3 mode:live gate) + ONE fresh ephemeral X25519 keypair per data-request (ADR-2D)
// whose private scalar is stored SEALED only (never plaintext, never logged); the txn is keyed by the
// DATA-REQUEST requestId (R17). Server-derived identity+tenant (a non-member => PermissionError, NO gateway
// call). The consent is re-validated FRESH from D1: the MUTABLE, revocation-sensitive fields D1 persists
// (status, hiTypes, expiry) are authoritative — so a since-REVOKED or a narrowed grant is refused HERE, never
// trusted from a cached fetch-time status. Gateway 202 => sealed txn row + status REQUESTED; non-202 =>
// fail-closed throw with NO txn row (the minted key is discarded, never sealed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestHealthInformation, HIREQUEST_FIELDS } from "../../../functions/_connect/abdm/hiu.js";
import { getTxnByRequestId } from "../../../functions/_connect/abdm/state.js";
import { ALLOW, buildAuditEvent } from "../../../functions/_connect/audit.js";
import { PermissionError } from "../../../functions/_connect/permission.js";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";

const NOW = "2026-07-15T00:00:00.000Z";
const CONSENT_ID = "c1";
const GRANTED_HITYPES = ["OPConsultation", "DiagnosticReport"];
const ENV = {
  CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64"),
  CONNECT_ABDM_DATA_PUSH_URL: "https://stewardmd.in/api/connect/abdm/hiu/data",
};
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// Seal stub: putTxn only ever SEALS. Wrap so the stored eph_privkey_sealed is provably NOT the plaintext scalar.
const sealStub = { seal: async (s) => "SEALED:" + s, open: async (s) => s.slice(7) };

// Call-recording gateway — records (endpointKey, body); returns a canned { status }. 202 by default.
function spyGateway(status = 202) {
  const calls = [];
  return { post: async (endpointKey, body) => { calls.push({ endpointKey, body }); return { status, body: {} }; }, calls };
}
function spyAudit() { const calls = []; const fn = async (f) => { calls.push(f); }; fn.calls = calls; return fn; }
const identifyUser = async () => ({ id: "fb:u1", guest: false });

// The FRESH D1 consent_req row — EXACTLY what Task-5 persistGranted writes: status GRANTED, consent_id,
// hi_types (JSON), expires_at. No extra scope columns (the thin schema). Overridable per test.
function seedDb(consentOver = {}) {
  return makeAbdmDb({
    connect_membership: [{ user_id: "fb:u1", tenant_id: "t1", role: "clinician" }],
    connect_tenant: [{ id: "t1", mode: "sandbox" }],
    connect_abdm_consent_req: [{
      request_id: CONSENT_ID, consent_id: CONSENT_ID, tenant_id: null, actor: null, patient_abha_hash: null,
      status: "GRANTED", hi_types: JSON.stringify(GRANTED_HITYPES),
      created_at: NOW, updated_at: NOW, expires_at: "2026-12-31T00:00:00.000Z",
      ...consentOver,
    }],
  });
}
// The fetch-time JWS-verified grant (immutable SIGNED scope: careContexts/permission.dateRange/purpose).
const boundConsent = (over = {}) => ({
  id: CONSENT_ID, consentId: CONSENT_ID, status: "GRANTED",   // status here is the STALE cached copy — D1 wins
  careContexts: ["cc-A", "cc-B"], hiTypes: GRANTED_HITYPES, purpose: { code: "CAREMGT" },
  permission: { dateRange: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" } },
  expiry: "2026-12-31T00:00:00.000Z", ...over,
});
const makeReq = (over = {}) => ({
  request: {}, tenantId: "t1", consentId: CONSENT_ID, consent: boundConsent(),
  careContexts: ["cc-A"], hiTypes: ["OPConsultation"], purpose: { code: "CAREMGT" },
  dateRange: { from: "2026-06-01T00:00:00.000Z", to: "2026-07-15T00:00:00.000Z" }, ...over,
});
const makeDeps = (db, over = {}) => ({
  db, kv: null, secrets: sealStub, gateway: spyGateway(), audit: spyAudit(),
  identifyFn: identifyUser, now: () => NOW, ...over,
});
const km = (body) => body[HIREQUEST_FIELDS.hiRequest][HIREQUEST_FIELDS.keyMaterial];

test("1. happy path → hiRequest carries a 65-byte b64 dhPublicKey + 32-byte nonce, a sealed txn row, status REQUESTED", async () => {
  const db = seedDb();
  const deps = makeDeps(db);
  const out = await requestHealthInformation(ENV, deps, makeReq());
  assert.equal(out.status, "REQUESTED");
  assert.ok(out.requestId, "our correlation requestId returned");

  assert.equal(deps.gateway.calls.length, 1);
  const { endpointKey, body } = deps.gateway.calls[0];
  assert.equal(endpointKey, "hiRequest");
  // Read the body THROUGH the seam (not hardcoded names) so the test tracks the ADR-2H field seam.
  assert.equal(km(body)[HIREQUEST_FIELDS.cryptoAlg], "ECDH");
  assert.equal(km(body)[HIREQUEST_FIELDS.curve], "Curve25519");
  // 65-byte uncompressed EC point (0x04||X||Y), NOT the bare 32-byte X25519 key: Fidelius picks its
  // decoder by base64 length, so a 44-char key is unparseable at the HIP and it can never encrypt for us.
  const dhPub = unb64(km(body)[HIREQUEST_FIELDS.dhPublicKey]);
  assert.equal(dhPub.length, 65, "dhPublicKey is a 65-byte uncompressed EC point");
  assert.equal(dhPub[0], 0x04, "uncompressed points start with 0x04");
  assert.equal(km(body)[HIREQUEST_FIELDS.dhPublicKey].length, 88, "…which is 88 base64 chars - what Fidelius routes to decodePoint()");
  assert.equal(unb64(km(body)[HIREQUEST_FIELDS.nonce]).length, 32, "nonce is 32 bytes");
  const hi = body[HIREQUEST_FIELDS.hiRequest];
  assert.equal(hi[HIREQUEST_FIELDS.consent][HIREQUEST_FIELDS.consentId], CONSENT_ID);
  assert.equal(hi[HIREQUEST_FIELDS.dataPushUrl], ENV.CONNECT_ABDM_DATA_PUSH_URL);
  assert.deepEqual(hi[HIREQUEST_FIELDS.dateRange], makeReq().dateRange);

  // sealed txn row exists, keyed by the DATA-REQUEST requestId (R17); transaction_id attached later (Task 4).
  const txn = await getTxnByRequestId(db, out.requestId);
  assert.ok(txn, "txn row persisted");
  assert.equal(txn.status, "REQUESTED");
  assert.equal(txn.consent_id, CONSENT_ID);
  assert.equal(txn.transaction_id, null, "transaction_id is attached later at on-request");
});

test("2. the ephemeral private key is stored SEALED — never the plaintext scalar (ADR-2D)", async () => {
  const db = seedDb();
  const deps = makeDeps(db);
  const { requestId } = await requestHealthInformation(ENV, deps, makeReq());
  const txn = await getTxnByRequestId(db, requestId);
  const sealed = txn.eph_privkey_sealed;
  assert.ok(sealed && sealed.startsWith("SEALED:"), "stored key is the sealed wrapper");
  const plain = await sealStub.open(sealed);                 // the raw b64 scalar, unsealed
  assert.notEqual(sealed, plain, "the stored column is NOT the plaintext scalar");
  assert.equal(unb64(plain).length, 32, "unseals to a 32-byte X25519 private scalar");
  // No persisted COLUMN holds the plaintext scalar verbatim — it is sealed at rest (ADR-2D).
  for (const [k, v] of Object.entries(txn)) assert.notEqual(v, plain, `column ${k} must not store the plaintext scalar`);
});

test("3. two data requests mint TWO DISTINCT ephemeral keypairs — no key reuse (ADR-2D/R3)", async () => {
  const db1 = seedDb(), db2 = seedDb();
  const d1 = makeDeps(db1), d2 = makeDeps(db2);
  const r1 = await requestHealthInformation(ENV, d1, makeReq());
  const r2 = await requestHealthInformation(ENV, d2, makeReq());
  const pub1 = km(d1.gateway.calls[0].body)[HIREQUEST_FIELDS.dhPublicKey];
  const pub2 = km(d2.gateway.calls[0].body)[HIREQUEST_FIELDS.dhPublicKey];
  assert.notEqual(pub1, pub2, "a fresh dhPublicKey per request (no reuse)");
  const s1 = (await getTxnByRequestId(db1, r1.requestId)).eph_privkey_sealed;
  const s2 = (await getTxnByRequestId(db2, r2.requestId)).eph_privkey_sealed;
  assert.notEqual(s1, s2, "a distinct sealed private key per request");
});

test("4. non-member tenantId => PermissionError, NO gateway call, NO txn row (server-derived, never trust the body)", async () => {
  const db = seedDb();
  const deps = makeDeps(db);
  await assert.rejects(() => requestHealthInformation(ENV, deps, makeReq({ tenantId: "t2" })), PermissionError);
  assert.equal(deps.gateway.calls.length, 0, "no gateway call for a non-member tenant");
  assert.equal((db._tables.connect_abdm_txn || []).length, 0, "no txn row");
});

test("5. since-REVOKED in D1 (even though the cached artifact still says GRANTED) => refused, no gateway, no txn", async () => {
  // The FRESH D1 row is REVOKED; req.consent (cached) deliberately still says GRANTED. The fresh D1 status MUST
  // win — this is the R3 revocation catch: a since-REVOKED consent can never be re-requested.
  const db = seedDb({ status: "REVOKED" });
  const deps = makeDeps(db);
  await assert.rejects(() => requestHealthInformation(ENV, deps, makeReq()), PermissionError);
  assert.equal(deps.gateway.calls.length, 0, "no gateway call once revalidation fails (fail-closed)");
  assert.equal((db._tables.connect_abdm_txn || []).length, 0, "no txn row on a refused request");
  assert.equal(deps.audit.calls.length, 0, "no data.requested audit on a refused request");
});

test("6. hiType scope-widening vs the FRESH D1 grant => refused (hiTypes taken fresh from D1, not the cached copy)", async () => {
  // The fresh D1 grant is narrowed to just OPConsultation; the cached artifact still lists both. A request that
  // asks for DiagnosticReport too must fail against the FRESH grant — proving hiTypes come from D1.
  const db = seedDb({ hi_types: JSON.stringify(["OPConsultation"]) });
  const deps = makeDeps(db);
  await assert.rejects(
    () => requestHealthInformation(ENV, deps, makeReq({ hiTypes: ["OPConsultation", "DiagnosticReport"] })),
    PermissionError);
  assert.equal(deps.gateway.calls.length, 0, "no gateway call on a scope-widening request");
  assert.equal((db._tables.connect_abdm_txn || []).length, 0, "no txn row");
});

test("7. a requested careContext outside the granted scope => refused (fail-closed)", async () => {
  const db = seedDb();
  const deps = makeDeps(db);
  await assert.rejects(() => requestHealthInformation(ENV, deps, makeReq({ careContexts: ["cc-Z"] })), PermissionError);
  assert.equal(deps.gateway.calls.length, 0);
  assert.equal((db._tables.connect_abdm_txn || []).length, 0);
});

test("8. gateway non-202 => fail-closed throw, NO txn row, NO audit (key minted but never sealed)", async () => {
  const db = seedDb();
  const deps = makeDeps(db, { gateway: spyGateway(500) });
  await assert.rejects(() => requestHealthInformation(ENV, deps, makeReq()));
  assert.equal(deps.gateway.calls.length, 1, "gateway was called");
  assert.equal((db._tables.connect_abdm_txn || []).length, 0, "no txn row on a non-202");
  assert.equal(deps.audit.calls.length, 0, "no audit on a failed request");
});

test("9. audit data.requested carries ONLY ALLOW-listed metadata (consentId + counts, no PHI)", async () => {
  const db = seedDb();
  const deps = makeDeps(db);
  await requestHealthInformation(ENV, deps, makeReq());
  const ev = deps.audit.calls.find((f) => f.action === "data.requested");
  assert.ok(ev, "a data.requested audit was emitted");
  // Every top-level key is ALLOW-listed <=> buildAuditEvent (which structurally drops non-ALLOW keys) drops nothing.
  assert.deepEqual(new Set(Object.keys(buildAuditEvent(ev))), new Set(Object.keys(ev)));
  for (const k of Object.keys(ev)) assert.ok(ALLOW.includes(k), `audit key ${k} not ALLOW-listed`);
  assert.equal(ev.consentId, CONSENT_ID);
  assert.equal(ev.resourceCounts.hiTypes, 1);            // metadata: COUNT, not the list
  assert.equal(ev.outcome, "ok");
});
