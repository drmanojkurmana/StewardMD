// test/connect/abdm/ingress.test.mjs — Stage-4 Task-4: inbound HIU webhook (ingress.js#handleIngress).
// The ingress carries NO StewardMD actor — its identity is the verified ABDM body-signature + the
// correlation row our ids match. Strict fail-closed order (R6/R2/R8/R17):
//   (1) verify body-signature → (2) replay-defend (freshness + REQUEST-ID nonce) → (3) correlate → (4) route.
// The invariant: a junk/unknown push NEVER touches R2 (correlate precedes buffer); consent transitions stay
// monotonic; the TENANT is taken from the correlation row, never a header, never the body.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleIngress } from "../../../functions/_connect/abdm/ingress.js";
import { ingestEvent } from "../../../functions/_connect/engine.js";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { getConsentReq, getTxnByTransactionId, listBuffered } from "../../../functions/_connect/abdm/state.js";

const NOW = "2026-07-31T10:00:00.000Z";
const ENV = { CONNECT_FLAG: "1", CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64") };

// A stub verifyJws that returns ok for the sentinel "valid" token and false for anything else, echoing an
// injected payload. This lets a test drive the whole flow WITHOUT real crypto (jws.test.mjs owns the crypto).
function stubVerify(payload, { valid = true } = {}) {
  return async (token) => (valid && token === "VALID" ? { ok: true, payload } : { ok: false, payload: null, reason: "bad" });
}

// Minimal Request-shaped stub: a compact-JWS body (default "VALID") + case-insensitive header .get().
function makeRequest({ body = "VALID", headers = {}, method = "POST" } = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v]));
  return { method, url: "https://x/api/connect/ingress/abdm", headers: { get: (k) => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) }, text: async () => body };
}
const baseHeaders = (over = {}) => ({ "REQUEST-ID": "hdr-req-1", TIMESTAMP: NOW, "X-HIU-ID": "t1", ...over });

// deps with a spy ingestEvent that DELEGATES to the real engine so DB state genuinely changes.
function makeDeps({ db, r2 = makeR2(), kv = makeMockKv(), payload, valid = true } = {}) {
  const ingestCalls = [];
  const deps = {
    db, r2, kv,
    jwks: { keys: [{ kid: "k1", kty: "RSA" }] },      // pinned JWKS is INJECTED; the stub verify ignores it
    verifyJws: stubVerify(payload, { valid }),
    ingestEvent: async (env, bound, ev) => { ingestCalls.push(ev); return ingestEvent(env, bound, ev); },
    now: () => NOW,
  };
  deps.ingestCalls = ingestCalls;
  return deps;
}

function seedConsent(status = "INITIATED", requestId = "req-1", tenantId = "t1") {
  return makeAbdmDb({ connect_abdm_consent_req: [{ request_id: requestId, tenant_id: tenantId, status, consent_id: null, created_at: NOW, updated_at: NOW }] });
}
function seedTxn({ status = "REQUESTED", requestId = "req-1", transactionId = "txn-1", tenantId = "t1" } = {}) {
  return makeAbdmDb({ connect_abdm_txn: [{ request_id: requestId, transaction_id: transactionId, tenant_id: tenantId, status, eph_privkey_sealed: "S:x", ack_claimed: 0, created_at: NOW, updated_at: NOW }] });
}

test("1. valid signed consent-notify → status advances, 202", async () => {
  const db = seedConsent("INITIATED");
  const deps = makeDeps({ db, payload: { type: "consent-notification", requestId: "req-1", status: "GRANTED" } });
  const res = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 202);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal((await getConsentReq(db, "req-1")).status, "GRANTED");
});

test("2. bad signature → 401, NOTHING persisted (no state change)", async () => {
  const db = seedConsent("INITIATED");
  const deps = makeDeps({ db, valid: false, payload: { type: "consent-notification", requestId: "req-1", status: "GRANTED" } });
  const res = await handleIngress(ENV, deps, makeRequest({ body: "TAMPERED", headers: baseHeaders() }));
  assert.equal(res.status, 401);
  assert.equal(deps.ingestCalls.length, 0, "never routed");
  assert.equal((await getConsentReq(db, "req-1")).status, "INITIATED", "unchanged");
});

test("3. replayed REQUEST-ID → idempotent 202 no-op (not re-processed)", async () => {
  const db = seedConsent("INITIATED");
  const deps = makeDeps({ db, payload: { type: "consent-notification", requestId: "req-1", status: "GRANTED" } });
  const r1 = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(r1.status, 202);
  // A second delivery with the SAME REQUEST-ID must be a no-op: ingestEvent is NOT called again.
  const r2 = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(r2.status, 202);
  assert.equal(deps.ingestCalls.length, 1, "replay was deduped — routed exactly once");
});

test("4. unknown correlation id → 403, R2 UNTOUCHED", async () => {
  const db = seedTxn({ transactionId: "txn-known" });
  const deps = makeDeps({ db, payload: { type: "data-push", transactionId: "txn-UNKNOWN", entries: [{ careContextReference: "cc1", content: "CIPHER", checksum: "sum1" }] } });
  const res = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 403);
  assert.equal(deps.ingestCalls.length, 0, "never routed");
  assert.deepEqual(await listBuffered(deps.r2, "txn-UNKNOWN"), [], "nothing buffered for the unknown txn");
  assert.deepEqual(await listBuffered(deps.r2, "txn-known"), [], "nothing buffered for the known txn either");
});

test("5. header-tenant ≠ correlation-row tenant → 403 (tenant only from the row)", async () => {
  const db = seedConsent("INITIATED", "req-1", "t1");
  const deps = makeDeps({ db, payload: { type: "consent-notification", requestId: "req-1", status: "GRANTED" } });
  const res = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders({ "X-HIU-ID": "t2" }) }));
  assert.equal(res.status, 403);
  assert.equal(deps.ingestCalls.length, 0);
  assert.equal((await getConsentReq(db, "req-1")).status, "INITIATED", "unchanged");
});

test("6. replayed older GRANTED after REVOKED → stays REVOKED (monotonic, 202)", async () => {
  const db = seedConsent("REVOKED");
  const deps = makeDeps({ db, payload: { type: "consent-notification", requestId: "req-1", status: "GRANTED" } });
  const res = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 202);                          // accepted at the edge, but the transition is refused
  assert.equal((await getConsentReq(db, "req-1")).status, "REVOKED", "monotonic — never un-revoked");
});

test("7. correlated data-push → entries buffered + txn RECEIVING", async () => {
  const db = seedTxn({ status: "REQUESTED", requestId: "req-1", transactionId: "txn-1" });
  const deps = makeDeps({ db, payload: { type: "data-push", transactionId: "txn-1", entries: [
    { careContextReference: "cc1", content: "CIPHER1", checksum: "sum1" },
    { careContextReference: "cc2", content: "CIPHER2", checksum: "sum2" },
  ] } });
  const res = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 202);
  const buffered = await listBuffered(deps.r2, "txn-1");
  assert.equal(buffered.length, 2, "both encrypted entries buffered (only AFTER correlation)");
  assert.ok(buffered.every((b) => b.contentB64 && b.checksum && b.careContextHash), "ciphertext + checksum + HMAC'd ref stored");
  assert.ok(!JSON.stringify(buffered).includes("cc1"), "raw careContextReference never lands in R2");
  assert.equal((await getTxnByTransactionId(db, "txn-1")).status, "RECEIVING", "FSM advanced");
});

test("8. flag OFF → 404 (no existence leak, no side effects)", async () => {
  const db = seedConsent("INITIATED");
  const deps = makeDeps({ db, payload: { type: "consent-notification", requestId: "req-1", status: "GRANTED" } });
  const res = await handleIngress({ CONNECT_FLAG: "0" }, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 404);
  assert.equal(deps.ingestCalls.length, 0);
  assert.equal((await getConsentReq(db, "req-1")).status, "INITIATED");
});

test("9. stale TIMESTAMP → 401 (freshness window, R6), nothing routed", async () => {
  const db = seedConsent("INITIATED");
  const deps = makeDeps({ db, payload: { type: "consent-notification", requestId: "req-1", status: "GRANTED" } });
  const stale = "2026-07-31T09:00:00.000Z";               // 1h before NOW — outside the freshness window
  const res = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders({ TIMESTAMP: stale }) }));
  assert.equal(res.status, 401);
  assert.equal(deps.ingestCalls.length, 0);
  assert.equal((await getConsentReq(db, "req-1")).status, "INITIATED");
});

test("10. errors are sanitized — never echo the raw body/signature/PHI", async () => {
  const db = seedConsent("INITIATED");
  const deps = makeDeps({ db, valid: false, payload: null });
  const res = await handleIngress(ENV, deps, makeRequest({ body: "SECRET.SIGNATURE.PAYLOAD", headers: baseHeaders() }));
  assert.equal(res.status, 401);
  const text = await res.text();
  assert.ok(!text.includes("SECRET"), "raw signed body not echoed");
  assert.deepEqual(JSON.parse(text), { error: "bad_signature" });
});
