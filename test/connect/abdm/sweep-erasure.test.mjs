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
  putTxn, attachTransactionId, getTxnByRequestId, bufferEntry, bufferIndexPut, listBuffered, tryJoin,
} from "../../../functions/_connect/abdm/state.js";
import { verifyConsentArtifact, linkConsentId, getConsentReqByConsentId } from "../../../functions/_connect/abdm/consent.js";

const HMAC_ENV = { CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64") };
const sealStub = { seal: async (s) => "S:" + s, open: async (s) => s.slice(2) };
const NOW = "2026-07-31T00:00:00Z";
const ISO_NOW = "2026-07-31T12:00:00Z";
const S6_FUT = "2026-08-30T00:00:00Z";
const erasedEvents = (db) => (db._tables.connect_audit_event || []).filter((e) => e.action === "data.erased");
// Paginate an R2 list across ALL pages (the mock models real R2 truncation when constructed with a small pageSize).
const listAll = async (r2, prefix = "") => {
  const keys = []; let cursor;
  do { const r = (await r2.list({ prefix, cursor })) || {}; for (const o of (r.objects || [])) keys.push(o.key); cursor = r.truncated ? r.cursor : undefined; } while (cursor);
  return keys;
};
// FIX-1's crown assertion: NO buffer object survives under ANY key anywhere in the store (across ALL pages).
const assertR2Empty = async (r2) =>
  assert.equal((await listAll(r2)).length, 0, "R2 store must be GLOBALLY empty after erasure");

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

// ───────────────────────── FIX-1 (round-2): REAL orphan-buffer close via consent_id attach ─────────────────────────
// PROD-FAITHFUL: the consent_req row (reqC) and the txn row (reqD) carry DISTINCT internal request_ids — hiu.js
// mints reqC in requestConsent and a FRESH reqD in requestHealthInformation; they join ONLY by consent_id. An
// out-of-order data-push carries transactionId + consentId but NO requestId (mock-gateway.mjs). Round-1 attached
// by corr.requestId (=reqC) → `UPDATE ... WHERE request_id=reqC` matched 0 txn rows (txn is reqD) → NO-OP → the
// R2 buffer stayed a PERMANENT orphan (the round-1 test masked this by seeding both tables with the SAME id).
// Round-2 attaches by CONSENT_ID, which finds the txn's own row (reqD) and stamps its transaction_id, so the erase
// reaches and deletes the buffer. CROWN assertion: the R2 store is GLOBALLY empty after erasure.
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
// A pending txn row keyed by its OWN request_id (reqD), DISTINCT from the consent row's reqC — as in prod.
const pendingTxnRow = (o = {}) => ({
  request_id: o.request_id ?? "reqD", transaction_id: null, tenant_id: o.tenant_id ?? "t1", consent_id: o.consent_id ?? "cid-1",
  eph_privkey_sealed: "S:x", eph_pub_raw: "P", our_nonce: "N", ack_claimed: 0,
  status: "REQUESTED", expires_at: o.expires_at ?? "2026-12-31T00:00:00Z", created_at: ING_NOW, updated_at: ING_NOW,
});
// The out-of-order push the real gateway sends: transactionId + consentId, NO requestId.
const outOfOrderPush = (o = {}) => ({
  db: o.db, r2: o.r2, kv: makeMockKv(),
  payload: { type: "data-push", transactionId: o.transactionId ?? "txn-1", consentId: o.consentId ?? "cid-1",
    entries: [{ careContextReference: "cc-A", content: "CIPHER", checksum: "chk-1" }] },
});

// A push is out-of-order when the txn's transaction_id is NOT yet attached; the fix must NOT stamp it (that would
// break the buffer-then-join deferral). It records a consent-scoped INDEX so the erase can still find the buffer.
const bufidxKeys = async (r2, consentId) => listAll(r2, `abdm/bufidx/${consentId}/`);

test("FIX-1 round-2: out-of-order push (reqC≠reqD, no requestId) → indexed, deferral preserved; zero orphan after REVOKE", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "reqC", consent_id: "cid-1", status: "GRANTED", expires_at: "2026-12-31T00:00:00Z" })],
    connect_abdm_txn: [pendingTxnRow({ request_id: "reqD", consent_id: "cid-1" })],
  });
  const r2 = makeR2();
  const res = await handleIngress(ING_ENV, ingDeps(outOfOrderPush({ db, r2, transactionId: "txn-1", consentId: "cid-1" })),
    ingRequest({ "REQUEST-ID": "r1", TIMESTAMP: ING_NOW, "X-HIU-ID": "t1" }));
  assert.equal(res.status, 202);
  assert.equal((await listBuffered(r2, "txn-1")).length, 1, "entry buffered under txn-1");
  // DEFERRAL PRESERVED: the txn row (reqD) is NOT stamped, so tryJoin stays not-ready until on-request lands.
  assert.equal((await getTxnByRequestId(db, "reqD")).transaction_id, null, "txn row NOT stamped (buffer-then-join deferral intact)");
  assert.equal((await tryJoin(db, r2, ING_ENV, "txn-1")).ready, false, "tryJoin still defers (no-txn) — not consumed early");
  // But a consent-scoped index pointer WAS written, so the erase can find the (otherwise orphan) buffer.
  assert.deepEqual(await bufidxKeys(r2, "cid-1"), ["abdm/bufidx/cid-1/txn-1"], "consent→tid index recorded");

  await updateConsentStatus(db, "reqC", "REVOKED", ISO_NOW);   // REVOKE lands on the consent row (reqC)
  const counts = await sweep(db, r2, ING_ENV, ISO_NOW);
  assert.equal(counts.buffersDeleted, 1, "the (round-1-orphaned) buffer is deleted via the consent index");
  assert.equal(await getTxnByRequestId(db, "reqD"), null, "txn row + sealed key gone");
  assert.deepEqual(await bufidxKeys(r2, "cid-1"), [], "index pointer retired");
  await assertR2Empty(r2); // CROWN: no object under ANY key
});

test("FIX-1 round-2: same out-of-order push, erased via patient dataEraseAt instead of REVOKE → zero orphan", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "reqC", consent_id: "cid-1", status: "GRANTED",
      expires_at: "2026-12-31T00:00:00Z", data_erase_at: "2026-07-31T11:00:00Z" /* just before ISO_NOW */ })],
    connect_abdm_txn: [pendingTxnRow({ request_id: "reqD", consent_id: "cid-1" })],
  });
  const r2 = makeR2();
  const res = await handleIngress(ING_ENV, ingDeps(outOfOrderPush({ db, r2, transactionId: "txn-1", consentId: "cid-1" })),
    ingRequest({ "REQUEST-ID": "r1", TIMESTAMP: ING_NOW, "X-HIU-ID": "t1" }));
  assert.equal(res.status, 202);
  assert.equal((await getTxnByRequestId(db, "reqD")).transaction_id, null, "deferral intact (no stamp)");

  const counts = await sweep(db, r2, ING_ENV, ISO_NOW); // ISO_NOW is past data_erase_at
  assert.equal(counts.buffersDeleted, 1);
  assert.equal(await getTxnByRequestId(db, "reqD"), null);
  assert.deepEqual(await bufidxKeys(r2, "cid-1"), [], "index pointer retired");
  await assertR2Empty(r2);
});

test("FIX-1 round-2 HIGH: a LATE push for an already-REVOKED consent is REJECTED (403), nothing buffered", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "reqC", consent_id: "cid-1", status: "REVOKED" })],
    connect_abdm_txn: [pendingTxnRow({ request_id: "reqD", consent_id: "cid-1" })],
  });
  const r2 = makeR2();
  const res = await handleIngress(ING_ENV, ingDeps(outOfOrderPush({ db, r2, transactionId: "txn-late", consentId: "cid-1" })),
    ingRequest({ "REQUEST-ID": "r-late", TIMESTAMP: ING_NOW, "X-HIU-ID": "t1" }));
  assert.equal(res.status, 403, "late push for a terminal consent is refused");
  await assertR2Empty(r2); // NO fresh orphan: nothing was buffered, no index pointer written
  assert.deepEqual(await bufidxKeys(r2, "cid-1"), [], "no index pointer for a rejected late push");
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

// ───────────────────────── round-2 MEDIUM: care-context over-erase guard ─────────────────────────
// One consent's dataEraseAt must NOT drop a care-context that ALSO backs another LIVE consent for the same patient.
const ccReg = (o = {}) => ({ id: o.id, tenant_id: o.tenant_id ?? "t1", patient_abha_hash: o.patient_abha_hash ?? "HMAC-P",
  source: "followcare", ref: o.ref, hi_type: "OPConsultation", display: "Visit", linked_at: NOW });
test("round-2 MEDIUM: dataEraseAt on one consent keeps care-contexts still referenced by a LIVE consent", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [
      // consentA is past its dataEraseAt → being erased; it references ref-1 (uniquely) and ref-2 (shared).
      scopedConsentRow({ request_id: "rqA", consent_id: "cidA", status: "GRANTED", data_erase_at: "2026-07-31T11:00:00Z",
        care_contexts: JSON.stringify(["ref-1", "ref-2"]) }),
      // consentB is LIVE (GRANTED, future dataEraseAt); it references ref-2 (shared) and ref-3.
      scopedConsentRow({ request_id: "rqB", consent_id: "cidB", status: "GRANTED", data_erase_at: S6_FUT,
        care_contexts: JSON.stringify(["ref-2", "ref-3"]) }),
    ],
    connect_abdm_carecontext: [
      ccReg({ id: "cc-1", ref: "ref-1" }), ccReg({ id: "cc-2", ref: "ref-2" }), ccReg({ id: "cc-3", ref: "ref-3" }),
    ],
  });
  const r2 = makeR2();
  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW); // ISO_NOW past cidA's dataEraseAt, before cidB's
  assert.equal(counts.careContextsErased, 1, "only the care-context UNIQUELY backed by the erased consent is dropped");
  const left = (db._tables.connect_abdm_carecontext || []).map((c) => c.ref).sort();
  assert.deepEqual(left, ["ref-2", "ref-3"], "ref-2 (shared with live cidB) and ref-3 (live) survive; ref-1 erased");
});

// ───────────────────────── round-2 LOW: dataEraseAt terminalizes the consent status ─────────────────────────
test("round-2 LOW: a dataEraseAt-triggered erase TERMINALIZES the GRANTED row (→ EXPIRED), re-sweep is a no-op", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "rqT", consent_id: "cidT", status: "GRANTED", data_erase_at: "2026-07-31T11:00:00Z" })],
  });
  const r2 = makeR2();
  await addLiveTxn(db, r2, { requestId: "rqT-txn", consentId: "cidT", txnId: "txnT" });

  const first = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(first.consentsErased, 1);
  const row = await getConsentReq(db, "rqT");
  assert.equal(row.status, "EXPIRED", "the GRANTED-but-erased row is terminalized, not left GRANTED");
  // Re-sweep: still selected (EXPIRED) but nothing left → no new erasure, no duplicate audit.
  const second = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(second.consentsErased, 0);
  assert.equal(erasedEvents(db).length, 1, "no duplicate data.erased after terminalize");
});

// ───────────────────────── round-3 FIX-A: buffer/pointer guard symmetry ─────────────────────────
// A buffer must NEVER be written without an erasure path. A push that reaches the buffer branch with NO resolvable
// consentId AND whose transaction_id is not on any txn row is un-erasable → it must be REJECTED, buffering nothing.
test("round-3 FIX-A: a data-push with no resolvable consentId and an unattached tid is REJECTED (no buffer, no pointer)", async () => {
  const db = makeAbdmDb({
    // A consent_req row whose consent_id was never linked (still NULL) → correlate resolves via requestId (branch 2)
    // but corr.consentId is null. No txn row carries the pushed tid → the buffer would be un-erasable.
    connect_abdm_consent_req: [{ request_id: "reqU", tenant_id: "t1", status: "INITIATED", consent_id: null, created_at: ING_NOW, updated_at: ING_NOW }],
  });
  const r2 = makeR2();
  const deps = ingDeps({ db, r2, kv: makeMockKv(),
    payload: { type: "data-push", transactionId: "txn-U", requestId: "reqU", // no consentId; tid not attached anywhere
      entries: [{ careContextReference: "cc-A", content: "CIPHER", checksum: "chk-1" }] } });
  const res = await handleIngress(ING_ENV, deps, ingRequest({ "REQUEST-ID": "rU", TIMESTAMP: ING_NOW, "X-HIU-ID": "t1" }));
  assert.equal(res.status, 403, "un-indexable push (no consentId, no attached txn) is refused");
  assert.equal((await listBuffered(r2, "txn-U")).length, 0, "NO buffer written");
  await assertR2Empty(r2); // and NO pointer either — nothing at all reached R2
});

// ───────────────────────── round-3 FIX-B: R2 cursor-loop pagination (erasure complete at scale) ─────────────────────────
// A consent with MANY buffered objects + pointers must be fully erased across R2 `list` pages (real R2 truncates
// a single list at 1000 keys). The mock is constructed with pageSize:2 so the sweep MUST page through to be complete.
test("round-3 FIX-B: erasure is complete across R2 list PAGES (>pageSize buffers + pointers under one consent)", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "reqP", consent_id: "cid-P", status: "REVOKED", tenant_id: "t1" })],
  });
  const r2 = makeR2({ pageSize: 2 }); // model R2 truncation: at most 2 keys per list call
  // 5 orphan txns (pointer only, tid never on a txn row), each with 3 buffered objects → 5 pointers + 15 buffers,
  // all under cid-P. With pageSize 2 the sweep must cursor-loop the pointer list AND each per-txn buffer list.
  for (let i = 1; i <= 5; i++) {
    await bufferIndexPut(r2, "cid-P", "T" + i);
    for (let j = 0; j < 3; j++) await bufferEntry(r2, HMAC_ENV, "T" + i, "ref-" + j, "CIPHER", "chk-" + j, NOW);
  }
  assert.equal((await listAll(r2)).length, 20, "seeded 15 buffers + 5 pointers");

  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal(counts.buffersDeleted, 15, "every buffered object across all pages is deleted");
  await assertR2Empty(r2); // CROWN at scale: nothing left on any page (buffers AND pointers)
});

// ───────────────────────── round-3 FIX-C: care-context parse fail-safe (retain on unparseable live scope) ─────────────────────────
// If a LIVE consent's care_contexts is present but UNPARSEABLE, we cannot enumerate what it protects → we must
// fail safe toward RETENTION and not over-erase the patient's care-contexts.
test("round-3 FIX-C: an unparseable LIVE consent scope protects the patient's care-contexts (no over-erase)", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [
      // cidA is being erased (past its dataEraseAt); it references ref-1.
      scopedConsentRow({ request_id: "rqA", consent_id: "cidA", status: "GRANTED", data_erase_at: "2026-07-31T11:00:00Z",
        care_contexts: JSON.stringify(["ref-1"]) }),
      // cidB is LIVE (future dataEraseAt) but its care_contexts is GARBLED (present, unparseable).
      scopedConsentRow({ request_id: "rqB", consent_id: "cidB", status: "GRANTED", data_erase_at: S6_FUT,
        care_contexts: "{{not-valid-json" }),
    ],
    connect_abdm_carecontext: [ccReg({ id: "cc-1", ref: "ref-1" })],
  });
  const r2 = makeR2();
  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW); // past cidA's dataEraseAt
  assert.equal(counts.careContextsErased, 0, "an unparseable live scope is treated as protecting → nothing erased");
  assert.equal((db._tables.connect_abdm_carecontext || []).length, 1, "the care-context is RETAINED (fail-safe, no data-loss)");
});

// ───────────── consented-store purge: the record goes with the registration it backs ─────────────
// deleteForPatient/deleteCareContext existed but NOTHING in production called them, so a care context
// could be erased while its sealed consented-store blob survived - orphaned PHI under a reference
// nothing can reach, and a DPDP erasure-completeness violation. The sweep now erases the store record
// for exactly the refs it drops, and only those.
const sha256hex = async (s) => {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const consentedRow = async (ref, o = {}) => ({
  tenant_id: o.tenant_id ?? "t1", patient_abha_hash: o.patient_abha_hash ?? "HMAC-P",
  care_context_ref: ref, ref_hash: await sha256hex(ref), hi_type: "OPConsultation",
  r2_key: "abdm/consented/t1/HMAC-P/" + (await sha256hex(ref)), created_at: NOW,
});

test("consented-store: erasing a care-context also erases its sealed record, and ONLY that one", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [
      scopedConsentRow({ request_id: "rqA", consent_id: "cidA", status: "GRANTED", data_erase_at: "2026-07-31T11:00:00Z",
        care_contexts: JSON.stringify(["ref-1", "ref-2"]) }),
      scopedConsentRow({ request_id: "rqB", consent_id: "cidB", status: "GRANTED", data_erase_at: S6_FUT,
        care_contexts: JSON.stringify(["ref-2"]) }),
    ],
    connect_abdm_carecontext: [ccReg({ id: "cc-1", ref: "ref-1" }), ccReg({ id: "cc-2", ref: "ref-2" })],
    connect_abdm_consented_record: [await consentedRow("ref-1"), await consentedRow("ref-2")],
  });
  const r2 = makeR2();
  for (const ref of ["ref-1", "ref-2"]) await r2.put("abdm/consented/t1/HMAC-P/" + (await sha256hex(ref)), "sealed-bytes");

  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);   // past cidA's dataEraseAt, before cidB's

  assert.equal(counts.careContextsErased, 1, "only ref-1 is uniquely backed by the erased consent");
  const refsLeft = (db._tables.connect_abdm_consented_record || []).map((r) => r.care_context_ref);
  assert.deepEqual(refsLeft, ["ref-2"], "ref-1's consented record is erased with its registration");
  // The crown assertion: no sealed blob survives for an erased care context.
  const blobs = await listAll(r2, "abdm/consented/");
  assert.deepEqual(blobs, ["abdm/consented/t1/HMAC-P/" + (await sha256hex("ref-2"))],
    "ref-1's sealed blob is gone; ref-2's (still backed by LIVE cidB) survives");
});

test("consented-store: a sweep that erases nothing leaves every record and blob intact", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "rqB", consent_id: "cidB", status: "GRANTED",
      data_erase_at: S6_FUT, care_contexts: JSON.stringify(["ref-2"]) })],
    connect_abdm_carecontext: [ccReg({ id: "cc-2", ref: "ref-2" })],
    connect_abdm_consented_record: [await consentedRow("ref-2")],
  });
  const r2 = makeR2();
  const key = "abdm/consented/t1/HMAC-P/" + (await sha256hex("ref-2"));
  await r2.put(key, "sealed-bytes");
  await sweep(db, r2, HMAC_ENV, ISO_NOW);
  assert.equal((db._tables.connect_abdm_consented_record || []).length, 1, "a live consent's record is never touched");
  assert.deepEqual(await listAll(r2, "abdm/consented/"), [key]);
});

// ───────────── erasure must reach the DISCOVERY index, not just the records ─────────────
// Erasing a patient's records while leaving them in the demographic index would keep answering
// "yes, we have this patient" to a discovery probe about someone whose data we just destroyed.
// That is both a leak and a lie, so the sweep unindexes them too.
test("consented-store + discovery index: a patient-level erase leaves NOTHING findable", async () => {
  const hash = await sha256hex("HMAC-P-DEMO");   // stand-in for the patient's ABHA pseudonym
  const refHash = await sha256hex("OPD:9");
  const r2key = "abdm/consented/t1/" + hash + "/" + refHash;
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "rqD", consent_id: "cidD", status: "GRANTED",
      patient_abha_hash: hash, data_erase_at: "2026-07-31T11:00:00Z", care_contexts: JSON.stringify(["OPD:9"]) })],
    connect_abdm_carecontext: [ccReg({ id: "cc-9", ref: "OPD:9", patient_abha_hash: hash })],
    connect_abdm_consented_record: [{ tenant_id: "t1", patient_abha_hash: hash, care_context_ref: "OPD:9",
      ref_hash: refHash, hi_type: "OPConsultation", r2_key: r2key, created_at: NOW, updated_at: NOW }],
    // The ABHA link is what ties the pseudonym to the tenant's own patient ref.
    connect_abha_link: [{ tenant_id: "t1", patient_abha_hash: hash, abha_last4: "0123",
      patient_ref: "P-DEMO", created_at: NOW, updated_at: NOW }],
    connect_abdm_demographic: [{ tenant_id: "t1", patient_ref: "P-DEMO", mobile_hash: "MH", mrn_hash: "RH",
      name_hash: "NH", gender: "M", year_of_birth: 1985, created_at: NOW, updated_at: NOW }],
  });
  const r2 = makeR2();
  await r2.put(r2key, "sealed-bytes");

  const counts = await sweep(db, r2, HMAC_ENV, ISO_NOW);

  assert.equal(counts.careContextsErased, 1);
  assert.equal(counts.demographicsErased, 1, "the patient is unindexed as well as un-served");
  assert.equal((db._tables.connect_abdm_demographic || []).length, 0, "no discovery index row survives");
  assert.equal((db._tables.connect_abdm_consented_record || []).length, 0, "no record index row survives");
  await assertR2Empty(r2);                       // and NO sealed blob anywhere in the store
});

test("a sweep that erases nothing leaves the discovery index intact", async () => {
  const db = makeAbdmDb({
    connect_abdm_consent_req: [scopedConsentRow({ request_id: "rqL", consent_id: "cidL", status: "GRANTED",
      patient_abha_hash: "HMAC-LIVE", data_erase_at: S6_FUT, care_contexts: JSON.stringify(["OPD:1"]) })],
    connect_abha_link: [{ tenant_id: "t1", patient_abha_hash: "HMAC-LIVE", patient_ref: "P-LIVE",
      created_at: NOW, updated_at: NOW }],
    connect_abdm_demographic: [{ tenant_id: "t1", patient_ref: "P-LIVE", mobile_hash: "MH", mrn_hash: null,
      name_hash: "NH", gender: "M", year_of_birth: 1985, created_at: NOW, updated_at: NOW }],
  });
  const counts = await sweep(db, makeR2(), HMAC_ENV, ISO_NOW);
  assert.equal(counts.demographicsErased, 0);
  assert.equal((db._tables.connect_abdm_demographic || []).length, 1, "a live patient stays discoverable");
});
