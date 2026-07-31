// test/connect/abdm/hip-ingress.test.mjs — Stage-5 Task-7: HIP inbound routing on the ABDM ingress.
//
// StewardMD as a Health Information PROVIDER. The HIP surface REUSES the Stage-4 ingress spine UNCHANGED
// (verify body-signature -> replay-defend -> correlate) and adds, AFTER it, a HIP branch gated on the SECOND
// flag `hipFlagOn` (BOTH smd_connect AND smd_connect_hip, default OFF). Invariants under test:
//   * a HIP event with the HIP flag OFF -> 404 (never leaks that the HIP surface exists);
//   * discovery does its OWN care-context correlation (no consent row) and still runs off `corr==null`;
//   * hip-hi-request / hip-consent-notify bind to the CORRELATION ROW — tenant is ALWAYS the row's, never the
//     body; unknown correlation -> 403, no serve;
//   * the Stage-4 HIU consume path is UNAFFECTED by smd_connect_hip (zero regression).
// The HIP handlers (handleDiscovery/serveTransfer/putHipConsent) are INJECTED as spies (mirroring how the suite
// injects verifyJws/ingestEvent) so a test can assert exactly WHAT the ingress hands each handler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleIngress } from "../../../functions/_connect/abdm/ingress.js";
import { ingestEvent } from "../../../functions/_connect/engine.js";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { listBuffered } from "../../../functions/_connect/abdm/state.js";

const NOW = "2026-07-31T10:00:00.000Z";
const SALT = Buffer.from("connect-hip-ingress-test-hmac-salt").toString("base64");
const ENV = { CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", CONNECT_HMAC_SALT: SALT };

// A stub verifyJws: ok for the sentinel "VALID" token, false otherwise; echoes the injected payload (the whole
// crypto is owned by jws.test.mjs — here we drive the routing without real signatures).
function stubVerify(payload, { valid = true } = {}) {
  return async (token) => (valid && token === "VALID" ? { ok: true, payload } : { ok: false, payload: null, reason: "bad" });
}
// Minimal Request-shaped stub: a compact-JWS body (default "VALID") + case-insensitive header .get().
function makeRequest({ body = "VALID", headers = {}, method = "POST" } = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v]));
  return { method, url: "https://x/api/connect/ingress/abdm", headers: { get: (k) => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) }, text: async () => body };
}
const baseHeaders = (over = {}) => ({ "REQUEST-ID": "hdr-req-1", TIMESTAMP: NOW, "X-HIU-ID": "t1", ...over });

// deps with SPY HIP handlers (+ a real-delegating ingestEvent so the HIU regression test genuinely mutates D1).
function makeDeps({ db, r2 = makeR2(), kv = makeMockKv(), payload, valid = true } = {}) {
  const calls = { discovery: [], serve: [], putConsent: [], ingest: [] };
  const deps = {
    db, r2, kv,
    jwks: { keys: [{ kid: "k1", kty: "RSA" }] },
    verifyJws: stubVerify(payload, { valid }),
    ingestEvent: async (env, bound, ev) => { calls.ingest.push(ev); return ingestEvent(env, bound, ev); },
    handleDiscovery: async (env, d, args) => { calls.discovery.push({ env, deps: d, args }); return { matched: true, careContexts: [{ referenceNumber: "cc-1", display: "d" }] }; },
    serveTransfer: async (env, d, req) => { calls.serve.push({ env, deps: d, req }); return { pushed: true, pages: 1, outcome: "SERVED", warnings: [] }; },
    putHipConsent: async (dbArg, args) => { calls.putConsent.push(args); return { ok: true, status: args.status }; },
    source: { id: "followcare" },       // real serveTransfer is spied, so the source is inert here
    now: () => NOW,
  };
  deps.calls = calls;
  return deps;
}

const consentRow = (over = {}) => ({ request_id: "req-9", consent_id: "consent-xyz", tenant_id: "t-row", status: "GRANTED", created_at: NOW, updated_at: NOW, ...over });

test("1. signed discovery, HIP flag ON -> handleDiscovery runs (200); the probe is threaded through", async () => {
  const db = makeAbdmDb({});                          // discovery needs NO consent row — it self-correlates
  const deps = makeDeps({ db, payload: { type: "discovery", probe: { tenantId: "t1", abhaAddress: "A@sbx" }, sourceId: "hiu-1" } });
  const res = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(deps.calls.discovery.length, 1, "handleDiscovery invoked");
  assert.deepEqual(deps.calls.discovery[0].args.probe, { tenantId: "t1", abhaAddress: "A@sbx" });
  assert.equal(deps.calls.discovery[0].args.sourceId, "hiu-1");
});

test("2. the SAME discovery event with the HIP flag OFF -> 404 (no existence leak), handler NOT run", async () => {
  const db = makeAbdmDb({});
  const deps = makeDeps({ db, payload: { type: "discovery", probe: { tenantId: "t1", abhaAddress: "A@sbx" }, sourceId: "hiu-1" } });
  const res = await handleIngress({ ...ENV, CONNECT_HIP_FLAG: "0" }, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 404);
  assert.deepEqual(JSON.parse(await res.text()), { error: "not_found" });
  assert.equal(deps.calls.discovery.length, 0, "no discovery when the HIP flag is off");
});

test("3. hip-hi-request -> serveTransfer with the ROW's tenant + the carried consentId (body tenant IGNORED)", async () => {
  const db = makeAbdmDb({ connect_abdm_consent_req: [consentRow()] });   // consentId 'consent-xyz' -> tenant 't-row'
  const deps = makeDeps({ db, payload: {
    type: "hip-hi-request", consentId: "consent-xyz", transactionId: "txn-hi-1",
    careContexts: ["cc-1", "cc-2"], keyMaterial: { dhPublicKey: "PUB", nonce: "N" },
    dataPushUrl: "https://hiu.example.org/push",
    tenantId: "t-EVIL-body",                                             // a body-supplied tenant that MUST be ignored
  } });
  // X-HIU-ID is left at the default 't1' (a mismatch): the HIP path takes tenant from the ROW, never a header.
  const res = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 202);
  assert.equal(deps.calls.serve.length, 1, "serveTransfer invoked");
  const req = deps.calls.serve[0].req;
  assert.equal(req.tenantId, "t-row", "tenant from the correlation ROW");
  assert.notEqual(req.tenantId, "t-EVIL-body", "the body-supplied tenant is ignored");
  assert.equal(req.consentId, "consent-xyz", "the carried consentId is threaded to serveTransfer");
  assert.deepEqual(req.careContexts, ["cc-1", "cc-2"]);
  assert.deepEqual(req.hiuKeyMaterial, { dhPublicKey: "PUB", nonce: "N" });
  assert.equal(req.dataPushUrl, "https://hiu.example.org/push");
  assert.equal(req.transactionId, "txn-hi-1");
});

test("4. hip-hi-request with an UNKNOWN consentId -> 403, serveTransfer NOT called (no serve on unknown correlation)", async () => {
  const db = makeAbdmDb({ connect_abdm_consent_req: [] });
  const deps = makeDeps({ db, payload: {
    type: "hip-hi-request", consentId: "consent-UNKNOWN", transactionId: "txn-x",
    careContexts: ["cc-1"], keyMaterial: { dhPublicKey: "P", nonce: "N" }, dataPushUrl: "https://hiu.example.org/push",
  } });
  const res = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 403);
  assert.deepEqual(JSON.parse(await res.text()), { error: "unknown_correlation" });
  assert.equal(deps.calls.serve.length, 0, "nothing served for an uncorrelated request");
});

test("5. bad signature -> 401, no HIP handler runs (verify precedes routing)", async () => {
  const db = makeAbdmDb({ connect_abdm_consent_req: [consentRow()] });
  const deps = makeDeps({ db, valid: false, payload: { type: "hip-hi-request", consentId: "consent-xyz" } });
  const res = await handleIngress(ENV, deps, makeRequest({ body: "TAMPERED", headers: baseHeaders() }));
  assert.equal(res.status, 401);
  assert.equal(deps.calls.serve.length, 0);
  assert.equal(deps.calls.discovery.length, 0);
});

test("6. replayed REQUEST-ID -> idempotent no-op (serveTransfer runs exactly once)", async () => {
  const db = makeAbdmDb({ connect_abdm_consent_req: [consentRow()] });
  const kv = makeMockKv();
  const payload = { type: "hip-hi-request", consentId: "consent-xyz", transactionId: "txn-1", careContexts: ["cc-1"], keyMaterial: { dhPublicKey: "P", nonce: "N" }, dataPushUrl: "https://hiu.example.org/push" };
  const deps = makeDeps({ db, kv, payload });
  const r1 = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(r1.status, 202);
  const r2 = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));   // SAME REQUEST-ID
  assert.equal(r2.status, 202);
  assert.equal(deps.calls.serve.length, 1, "the replay was deduped by the spine — served exactly once");
});

test("7. base smd_connect OFF -> 404 even with smd_connect_hip ON (no HIP surface without the base flag)", async () => {
  const db = makeAbdmDb({});
  const deps = makeDeps({ db, payload: { type: "discovery", probe: { tenantId: "t1", abhaAddress: "A@sbx" } } });
  const res = await handleIngress({ CONNECT_FLAG: "0", CONNECT_HIP_FLAG: "1" }, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 404);
  assert.equal(deps.calls.discovery.length, 0, "the base-flag gate fires first");
});

test("8. Stage-4 HIU data-push STILL works with smd_connect_hip OFF (zero regression on the HIU consume path)", async () => {
  const db = makeAbdmDb({ connect_abdm_txn: [{ request_id: "req-1", transaction_id: "txn-1", tenant_id: "t1", status: "REQUESTED", eph_privkey_sealed: "S:x", ack_claimed: 0, created_at: NOW, updated_at: NOW }] });
  const deps = makeDeps({ db, payload: { type: "data-push", transactionId: "txn-1", entries: [{ careContextReference: "cc1", content: "CIPHER", checksum: "sum1" }] } });
  const res = await handleIngress({ CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "0", CONNECT_HMAC_SALT: SALT }, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 202);
  assert.equal(deps.calls.ingest.length, 1, "the HIU data-push routed normally");
  assert.equal(deps.calls.serve.length, 0, "the HIP path was never touched");
  const buffered = await listBuffered(deps.r2, "txn-1");
  assert.equal(buffered.length, 1, "the encrypted entry was buffered on the HIU path (HIP flag off is irrelevant)");
});

test("9. hip-consent-notify -> putHipConsent (monotonic) keyed on the ROW's requestId + tenant (body ignored)", async () => {
  const db = makeAbdmDb({ connect_abdm_consent_req: [consentRow({ request_id: "req-cn", consent_id: "consent-cn", tenant_id: "t-row", status: "INITIATED" })] });
  const deps = makeDeps({ db, payload: {
    type: "hip-consent-notify", consentId: "consent-cn", status: "GRANTED",
    patientAbhaHash: "HASH", hiTypes: ["DischargeSummary"], expiresAt: "2026-12-31T00:00:00Z",
    tenantId: "t-EVIL",                                    // body tenant must be ignored
  } });
  const res = await handleIngress(ENV, deps, makeRequest({ headers: baseHeaders() }));
  assert.equal(res.status, 202);
  assert.equal(deps.calls.putConsent.length, 1, "putHipConsent invoked");
  assert.equal(deps.calls.putConsent[0].tenantId, "t-row", "tenant from the ROW, never the body");
  assert.equal(deps.calls.putConsent[0].requestId, "req-cn", "keyed on the correlation row's requestId");
  assert.equal(deps.calls.putConsent[0].status, "GRANTED");
});
