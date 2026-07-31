// test/connect/abdm/sweep-erasure.test.mjs — Stage-6 Task-2 erasure-completeness FIX (dual-adversarial remediation).
// The base T2 erasure suite lives in state.test.mjs (the crown-jewel invariant tests). THIS file adds the five
// dual-adversarial gap fixes the two reviewers found, each proven against the live code:
//   FIX-1  a REVOKE-surviving ORPHAN R2 buffer (out-of-order push buffers under a tid the correlation row does
//          not yet know) — fixed AT THE SOURCE in ingress.js (attach tid at buffer time). Crown assertion: the
//          R2 store is GLOBALLY empty after erasure (no object under ANY key).
//   FIX-2  `data_erase_at` had NO writer → the dataEraseAt + care-context erasure was DEAD in prod; wired in
//          consent.js#persistGranted, DISTINCT from consent-validity `expires_at`. Proven end-to-end (real
//          verifyConsentArtifact write → sweep past the deadline erases derived state + care-contexts).
//   FIX-3  over-retention of raw SIGNED scope on the retained REVOKED row — scrubbed; anti-replay still intact.
//   FIX-4  pass-1-precedence under-audit — every erasure emits EXACTLY ONE `data.erased`, even when pass-1
//          pre-empted the txns; idempotent (a second sweep emits none).
//   FIX-5  age-backstop when BOTH expires_at and created_at are garbled (fall back to updated_at / force-sweep an
//          anchorless row); tenant belt on the pass-2 txn join (defense-in-depth).
// DPDP §8: a single residual sealed key / R2 buffer object / raw scope row after REVOKE or a passed dataEraseAt is
// a breach. Flags OFF; mock-safe SQL only; node --test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { handleIngress } from "../../../functions/_connect/abdm/ingress.js";
import { ingestEvent } from "../../../functions/_connect/engine.js";
import {
  sweep, putConsentReq, updateConsentStatus, getConsentReq,
  putTxn, attachTransactionId, getTxnByRequestId, bufferEntry, listBuffered,
} from "../../../functions/_connect/abdm/state.js";
import { verifyConsentArtifact, linkConsentId, getConsentReqByConsentId } from "../../../functions/_connect/abdm/consent.js";

const HMAC_ENV = { CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64") };
const sealStub = { seal: async (s) => "S:" + s, open: async (s) => s.slice(2) };
const NOW = "2026-07-31T00:00:00Z";
const ISO_NOW = "2026-07-31T12:00:00Z";
const S6_FUT = "2026-08-30T00:00:00Z";
const erasedEvents = (db) => (db._tables.connect_audit_event || []).filter((e) => e.action === "data.erased");
// FIX-1's crown assertion: NO buffer object survives under ANY key anywhere in the store.
const assertR2Empty = async (r2) =>
  assert.equal((await r2.list({ prefix: "" })).objects.length, 0, "R2 store must be GLOBALLY empty after erasure");

// A retained-scope-bearing consent row (a real GRANTED-then-REVOKED consent keeps its signed scope until erased).
function scopedConsentRow(o = {}) {
  return {
    request_id: o.request_id ?? "rq", tenant_id: o.tenant_id ?? "t1", actor: "dr-a",
    patient_abha_hash: o.patient_abha_hash ?? "HMAC-P", status: o.status ?? "REVOKED", consent_id: o.consent_id ?? "cid",
    hi_types: o.hi_types ?? JSON.stringify(["OPConsultation"]),
    care_contexts: o.care_contexts ?? JSON.stringify([{ careContextReference: "cc-raw-1" }]),
    purpose: o.purpose ?? JSON.stringify({ code: "CAREMGT" }),
    date_range: o.date_range ?? JSON.stringify({ from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }),
    created_at: NOW, updated_at: NOW, expires_at: o.expires_at ?? S6_FUT, data_erase_at: o.data_erase_at ?? null,
  };
}
async function addLiveTxn(db, r2, { requestId, consentId, txnId, tenantId = "t1", status = "RECEIVING", expiresAt = S6_FUT }) {
  await putTxn(db, sealStub, {
    requestId, tenantId, consentId, ephPrivKeyB64: "cGsxMjM=", ephPubRaw: "PUB", ourNonce: "N",
    status, expiresAt, now: NOW,
  });
  await attachTransactionId(db, requestId, txnId, NOW);
  await bufferEntry(r2, HMAC_ENV, txnId, "cc-ref-1", "CIPHER", "chk-1", NOW);
}

// ───────────────────────── FIX-1: orphan R2 buffer survives REVOKE (CRITICAL, Adversary A) ─────────────────────────
// Drive the REAL ingress data-push in the out-of-order window: the correlation txn row exists but its
// transaction_id is still NULL (the on-request attach has not landed). Pre-fix, the push buffers under the tid
// while the row stays NULL → a later REVOKE-erase skips the buffer (row.transaction_id null) → PERMANENT orphan.
// Post-fix, the push ATTACHES the tid at buffer time, so the erase reaches and deletes the buffer.
const ING_NOW = "2026-07-31T10:00:00.000Z";
const ING_ENV = { CONNECT_FLAG: "1", CONNECT_HMAC_SALT: HMAC_ENV.CONNECT_HMAC_SALT };
function ingRequest(headers) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v]));
  return {
    method: "POST", url: "https://x/api/connect/ingress/abdm",
    headers: { get: (k) => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) },
    text: async () => "VALID",
  };
}
function ingDeps({ db, r2, kv, payload }) {
  return {
    db, r2, kv, jwks: { keys: [{ kid: "k1", kty: "RSA" }] },
    verifyJws: async (token) => (token === "VALID" ? { ok: true, payload } : { ok: false, payload: null }),
    ingestEvent: async (env, bound, ev) => ingestEvent(env, bound, ev),
    now: () => ING_NOW,
  };
}

test("FIX-1: out-of-order push attaches tid at BUFFER time → zero orphan R2 objects survive REVOKE", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "req-1", consent_id: "cid-1", status: "GRANTED", expires_at: "2026-12-31T00:00:00Z" })],
    // The txn row is present (created at hi-request) but its transaction_id is NOT yet attached (on-request pending).
    connect_abdm_txn: [{
      request_id: "req-1", transaction_id: null, tenant_id: "t1", consent_id: "cid-1",
      eph_privkey_sealed: "S:x", eph_pub_raw: "P", our_nonce: "N", ack_claimed: 0,
      status: "REQUESTED", expires_at: "2026-12-31T00:00:00Z", created_at: ING_NOW, updated_at: ING_NOW,
    }],
  });
  const r2 = makeR2();
  const deps = ingDeps({
    db, r2, kv: makeMockKv(),
    payload: { type: "data-push", transactionId: "txn-1", requestId: "req-1",
      entries: [{ careContextReference: "cc-A", content: "CIPHER", checksum: "chk-1" }] },
  });

  const res = await handleIngress(ING_ENV, deps, ingRequest({ "REQUEST-ID": "r1", TIMESTAMP: ING_NOW, "X-HIU-ID": "t1" }));
  assert.equal(res.status, 202);
  // Root-cause fix: the correlation row LEARNED its transaction_id at buffer time (was NULL before the push).
  assert.equal((await getTxnByRequestId(db, "req-1")).transaction_id, "txn-1", "tid attached on the row at buffer time");
  assert.equal((await listBuffered(r2, "txn-1")).length, 1, "the encrypted entry is buffered under txn-1");

  // The consent is later REVOKED; the GC sweep must leave ZERO residual.
  await updateConsentStatus(db, "req-1", "REVOKED", ISO_NOW);
  const counts = await sweep(db, r2, ING_ENV, ISO_NOW);
  assert.equal(counts.buffersDeleted, 1, "the (pre-fix orphanable) buffer is deleted by the erase");
  assert.equal(await getTxnByRequestId(db, "req-1"), null, "txn row + sealed key gone");
  await assertR2Empty(r2); // CROWN: no object under ANY key remains
});

// ───────────────────────── FIX-2: data_erase_at writer (Adversary B) ─────────────────────────
// Reuse the real verifyConsentArtifact write-path (getPinnedJwks succeeds under an allow-listed host + mock fetch),
// so this is the PROD flow the base suite lacked. The signed permission carries dataEraseAt (2027) DISTINCT from
// expiry (2026): the stored row must keep them in SEPARATE columns, and a sweep past dataEraseAt must then erase.
const JWKS_ENV = { ABDM_JWKS_URL: "https://healthidsbx.abdm.gov.in/certs", CONNECT_HMAC_SALT: HMAC_ENV.CONNECT_HMAC_SALT };
const CONSENT_NOW = "2026-06-01T00:00:00.000Z";
const DATA_ERASE_AT = "2027-01-01T00:00:00.000Z";   // the erasure bound
const CONSENT_EXPIRY = "2026-12-31T00:00:00.000Z";  // the (earlier, distinct) validity bound
function kvMock() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, String(v)) }; }
function jwksFetch() { return async () => ({ ok: true, status: 200, json: async () => ({ keys: [{ kid: "k1", kty: "RSA" }] }) }); }
const signedDetail = () => ({
  consentId: "consent-e2", status: "GRANTED",
  careContexts: [{ careContextReference: "cc-A" }, { careContextReference: "cc-B" }],
  hiTypes: ["OPConsultation"], purpose: { code: "CAREMGT", text: "Care Management" },
  permission: { dateRange: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" }, dataEraseAt: DATA_ERASE_AT, frequency: null },
  expiry: CONSENT_EXPIRY,
});
function verifyDeps(db) {
  return {
    db, kv: kvMock(), fetch: jwksFetch(), audit: async () => {}, now: () => CONSENT_NOW,
    verifyJws: async () => ({ ok: true, payload: signedDetail() }),
  };
}

test("FIX-2: persistGranted writes data_erase_at DISTINCT from expires_at (prod flow)", async () => {
  const db = makeAbdmDb({});
  await putConsentReq(db, { requestId: "req-e2", tenantId: "t1", actor: "fb:u1", patientAbhaHash: "HMAC-P", now: CONSENT_NOW });
  await linkConsentId(db, "req-e2", "consent-e2", CONSENT_NOW);

  const r = await verifyConsentArtifact(JWKS_ENV, verifyDeps(db), { signature: "h.p.s" });
  assert.equal(r.ok, true);
  assert.equal(r.persisted, true);
  const row = await getConsentReqByConsentId(db, "consent-e2");
  assert.equal(row.data_erase_at, DATA_ERASE_AT, "data_erase_at is populated from the signed dataEraseAt");
  assert.equal(row.expires_at, CONSENT_EXPIRY, "expires_at keeps the DISTINCT validity bound (not conflated)");
  assert.notEqual(row.data_erase_at, row.expires_at, "the two bounds are stored separately");
});

test("FIX-2: a sweep PAST the written data_erase_at erases derived state AND care-contexts", async () => {
  const db = makeAbdmDb({});
  await putConsentReq(db, { requestId: "req-e2", tenantId: "t1", actor: "fb:u1", patientAbhaHash: "HMAC-P", now: CONSENT_NOW });
  await linkConsentId(db, "req-e2", "consent-e2", CONSENT_NOW);
  await verifyConsentArtifact(JWKS_ENV, verifyDeps(db), { signature: "h.p.s" });
  // Derived state + a patient care-context registration for this GRANTED consent.
  const r2 = makeR2();
  await addLiveTxn(db, r2, { requestId: "rq-e2-txn", consentId: "consent-e2", txnId: "txn-e2", expiresAt: "2027-12-31T00:00:00Z" });
  db._tables.connect_abdm_carecontext = [{ id: "cc-e2", tenant_id: "t1", patient_abha_hash: "HMAC-P", source: "followcare", ref: "r1", hi_type: "OPConsultation", display: "Visit", linked_at: CONSENT_NOW }];

  // now is PAST dataEraseAt (2027-01-01) though the consent is still GRANTED and not past `expires_at` semantics.
  const counts = await sweep(db, r2, JWKS_ENV, "2027-06-01T00:00:00Z");
  assert.equal(counts.txnsSwept, 1, "the dataEraseAt trigger erased the derived txn (was DEAD pre-fix)");
  assert.equal(counts.careContextsErased, 1, "the patient's care-context is erased on the patient-level dataEraseAt");
  assert.equal(counts.consentsErased, 1);
  assert.equal(await getTxnByRequestId(db, "rq-e2-txn"), null);
  assert.equal((db._tables.connect_abdm_carecontext || []).length, 0);
  assert.equal(erasedEvents(db).length, 1, "the erasure is audited once");
  await assertR2Empty(r2);
});

// ───────────────────────── FIX-3: over-retained raw scope on the REVOKED row (Adversary B) ─────────────────────────
test("FIX-3: REVOKE-erase NULLs the retained row's raw scope; anti-replay stays intact", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "rq-3", consent_id: "cid-3", status: "REVOKED" })],
  });
  const r2 = makeR2();
  await addLiveTxn(db, r2, { requestId: "rq3-txn", consentId: "cid-3", txnId: "txn-3" });

  await sweep(db, r2, HMAC_ENV, ISO_NOW);

  const row = await getConsentReq(db, "rq-3");
  // Raw signed scope scrubbed off the RETAINED row (no patient-linkable careContextReference lingers).
  assert.equal(row.care_contexts, null, "care_contexts nulled");
  assert.equal(row.hi_types, null, "hi_types nulled");
  assert.equal(row.purpose, null, "purpose nulled");
  assert.equal(row.date_range, null, "date_range nulled");
  // The anti-replay skeleton survives.
  assert.equal(row.status, "REVOKED", "status retained for anti-replay");
  assert.equal(row.consent_id, "cid-3", "consent_id retained (the anti-replay join key)");
  assert.equal(row.request_id, "rq-3", "request_id retained");
  // A replayed GRANT for this consent_id is STILL refused (the monotonic guard reads status, never the nulled scope).
  const replay = await updateConsentStatus(db, "rq-3", "GRANTED", ISO_NOW);
  assert.equal(replay.ok, false, "replayed GRANT refused");
  assert.equal(replay.status, "REVOKED");
  assert.equal((await getConsentReq(db, "rq-3")).status, "REVOKED", "still REVOKED — never un-revoked");
});

// ───────────────────────── FIX-4: pass-1-precedence under-audit (Adversary A+B, G3) ─────────────────────────
test("FIX-4: REVOKED consent whose only txn is ALREADY terminal → still ONE data.erased; re-sweep none", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "rq-4", consent_id: "cid-4", status: "REVOKED" })],
  });
  const r2 = makeR2();
  // A TERMINAL (TRANSFERRED) txn → PASS 1 (txn-TTL GC) erases it and emits NO data.erased. PASS 2 must still audit.
  await addLiveTxn(db, r2, { requestId: "rq4-txn", consentId: "cid-4", txnId: "txn-4", status: "TRANSFERRED", expiresAt: S6_FUT });

  const first = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(first.txnsSwept, 1, "pass-1 pre-empted the terminal txn");
  assert.equal(first.consentsErased, 1, "pass-2 still records the consent erasure");
  assert.equal(erasedEvents(db).length, 1, "exactly one data.erased despite pass-1 pre-emption");
  assert.equal(await getTxnByRequestId(db, "rq4-txn"), null);
  await assertR2Empty(r2);

  const second = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(second.consentsErased, 0, "idempotent — nothing left to erase");
  assert.equal(erasedEvents(db).length, 1, "no duplicate data.erased on re-sweep");
});

test("FIX-4: pass-1 pre-emption audits even a NULL-scope consent (pass1 belt, not just scope)", async () => {
  // A REVOKED consent with NO retained scope but a terminal txn → hadScope is false, so the audit relies on the
  // pass1ErasedConsents belt to still emit exactly one data.erased.
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "rq-4b", consent_id: "cid-4b", status: "REVOKED",
      care_contexts: null, hi_types: null, purpose: null, date_range: null })],
  });
  const r2 = makeR2();
  await addLiveTxn(db, r2, { requestId: "rq4b-txn", consentId: "cid-4b", txnId: "txn-4b", status: "FAILED", expiresAt: S6_FUT });

  const first = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(first.txnsSwept, 1);
  assert.equal(first.consentsErased, 1, "pass1 belt records the erasure even with no retained scope");
  assert.equal(erasedEvents(db).length, 1);
  const second = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(second.consentsErased, 0);
  assert.equal(erasedEvents(db).length, 1, "no duplicate on re-sweep");
});

// ───────────────────────── FIX-5a: age-backstop when created_at is ALSO garbled ─────────────────────────
test("FIX-5a: garbled expires_at AND garbled created_at → aged out via updated_at fallback (no forever-leak)", async () => {
  const db = makeAbdmDb({
    connect_abdm_txn: [
      // Fully-garbled expiry AND creation stamps, but an OLD valid updated_at → past the 7-day backstop → force-swept.
      { request_id: "rq-old", transaction_id: "txn-old", tenant_id: "t1", consent_id: "cZ",
        eph_privkey_sealed: "S:x", ack_claimed: 0, status: "RECEIVING",
        expires_at: "not-a-date", created_at: "garbage", updated_at: "2026-01-01T00:00:00Z" },
      // Same corruption but a RECENT updated_at → NOT past the backstop → retained + surfaced as an anomaly.
      { request_id: "rq-new", transaction_id: "txn-new", tenant_id: "t1", consent_id: "cW",
        eph_privkey_sealed: "S:x", ack_claimed: 0, status: "RECEIVING",
        expires_at: "not-a-date", created_at: "garbage", updated_at: ISO_NOW },
    ],
  });
  const r2 = makeR2();
  await bufferEntry(r2, HMAC_ENV, "txn-old", "cc-ref-1", "CIPHER", "chk-1", "2026-01-01T00:00:00Z");

  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(counts.txnsSwept, 1, "only the aged (updated_at) row is force-swept");
  assert.equal(counts.anomalies, 1, "the recent-updated_at corrupt row stays surfaced");
  assert.equal(await getTxnByRequestId(db, "rq-old"), null, "aged corrupt row erased (no lingering sealed key)");
  assert.ok(await getTxnByRequestId(db, "rq-new"), "recent corrupt row retained pending the backstop");
});

test("FIX-5a: a fully anchorless corrupt txn (no parseable timestamp anywhere) is force-swept", async () => {
  const db = makeAbdmDb({
    connect_abdm_txn: [{ request_id: "rq-corrupt", transaction_id: "txn-corrupt", tenant_id: "t1", consent_id: "cV",
      eph_privkey_sealed: "S:x", ack_claimed: 0, status: "RECEIVING",
      expires_at: "nope", created_at: "nope", updated_at: "nope" }],
  });
  const r2 = makeR2();
  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(counts.txnsSwept, 1, "an irredeemably-corrupt non-terminal row cannot be pinned as a permanent anomaly");
  assert.equal(counts.anomalies, 0);
  assert.equal(await getTxnByRequestId(db, "rq-corrupt"), null);
});

// ───────────────────────── FIX-5b: tenant belt on the pass-2 txn join ─────────────────────────
test("FIX-5b: pass-2 txn join is tenant-scoped — a same-consent_id txn under ANOTHER tenant is not reached", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "rq-5b", consent_id: "cid-5b", status: "REVOKED", tenant_id: "t1" })],
    connect_abdm_txn: [
      // The consent's OWN-tenant txn → erased.
      { request_id: "rq5b-own", transaction_id: "txn-own", tenant_id: "t1", consent_id: "cid-5b",
        eph_privkey_sealed: "S:own", ack_claimed: 0, status: "RECEIVING", expires_at: S6_FUT, created_at: NOW, updated_at: NOW },
      // A cross-tenant collision on the same consent_id (synthetic; consent_id is globally unique) → NOT reached.
      { request_id: "rq5b-other", transaction_id: "txn-other", tenant_id: "t2", consent_id: "cid-5b",
        eph_privkey_sealed: "S:other", ack_claimed: 0, status: "RECEIVING", expires_at: S6_FUT, created_at: NOW, updated_at: NOW },
    ],
  });
  const r2 = makeR2();
  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(counts.txnsSwept, 1, "only the own-tenant txn is erased under the consent's tenant belt");
  assert.equal(await getTxnByRequestId(db, "rq5b-own"), null, "own-tenant txn erased");
  const other = await getTxnByRequestId(db, "rq5b-other");
  assert.ok(other && other.eph_privkey_sealed === "S:other", "the other tenant's txn is NOT collateral-erased");
});
