// test/connect/abdm/hiu-handlers.test.mjs — the M3 HIU callback handlers + the 14-day re-consent rule.
//
// The invariant that matters on this side is authority: a callback may move our consent row's STATUS, but
// only a signature-verified artefact may write SCOPE. Everything else is correlation plumbing, and the
// plumbing is where a mismatched id silently loses a patient's records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";
import {
  HIU_HANDLERS, HiuHandlerError, withinRefetchWindow, REFETCH_WINDOW_DAYS,
} from "../../../functions/_connect/abdm/hiu-handlers.js";

const NOW = "2026-08-19T00:00:00.000Z";
const ENV = { CONNECT_FLAG: "1", ABDM_ENV: "sandbox", ABDM_HIU_ID: "IN2810006668" };
const headers = (o = {}) => ({ requestId: o.requestId || "cb-1", timestamp: NOW, entityId: "IN2810006668" });

function mockGateway() {
  const calls = [];
  return { calls, post: async (key, body) => { calls.push({ key, body }); return { status: 202, body: {} }; } };
}
const row = (o = {}) => ({
  request_id: o.requestId || "our-req-1", tenant_id: "t1", actor: "dr-a", patient_abha_hash: "HASH",
  status: o.status || "INITIATED", consent_id: o.consentId ?? null, consent_request_id: o.consentRequestId ?? null,
  created_at: NOW, updated_at: NOW, last_fetched_at: o.lastFetchedAt ?? null,
});
function deps(over = {}) {
  return {
    db: makeAbdmDb(over.tables || {}), gateway: mockGateway(), kv: null,
    now: () => NOW, audit: async () => {}, ...over,
  };
}
const consentRow = (d) => (d.db._tables.connect_abdm_consent_req || [])[0];

// ── on-init ─────────────────────────────────────────────────────────────────────────────────────────
test("on-init records the CM's consent-REQUEST id, which is NOT the artefact id", async () => {
  const d = deps({ tables: { connect_abdm_consent_req: [row()] } });
  await HIU_HANDLERS["consent-on-init"]({ env: ENV, deps: d, headers: headers(),
    body: { consentRequest: { id: "cm-req-99" }, response: { requestId: "our-req-1" } } });
  const r = consentRow(d);
  assert.equal(r.consent_request_id, "cm-req-99");
  assert.equal(r.consent_id, null, "the artefact id does not exist until the patient grants");
  assert.equal(d.gateway.calls.length, 0, "nothing is owed back on an on-init");
});

test("on-init carrying an error marks the request DENIED rather than leaving the doctor waiting", async () => {
  const d = deps({ tables: { connect_abdm_consent_req: [row()] } });
  await HIU_HANDLERS["consent-on-init"]({ env: ENV, deps: d, headers: headers(),
    body: { error: { code: 1000, message: "invalid purpose" }, response: { requestId: "our-req-1" } } });
  assert.equal(consentRow(d).status, "DENIED");
});

test("on-init with no correlation is refused rather than written against a guess", async () => {
  const d = deps({ tables: { connect_abdm_consent_req: [row()] } });
  await assert.rejects(() => HIU_HANDLERS["consent-on-init"]({ env: ENV, deps: d, headers: headers(),
    body: { consentRequest: { id: "cm-req-99" } } }), HiuHandlerError);
});

// ── hiu notify ──────────────────────────────────────────────────────────────────────────────────────
test("notify GRANTED links every artefact, FETCHES each, and acknowledges with an ARRAY", async () => {
  const d = deps({ tables: { connect_abdm_consent_req: [row({ consentRequestId: "cm-req-99" })] } });
  await HIU_HANDLERS["consent-hiu-notify"]({ env: ENV, deps: d, headers: headers(),
    body: { notification: { status: "GRANTED", consentRequestId: "cm-req-99",
      consentArtefacts: [{ id: "art-1" }, { id: "art-2" }] } } });

  const fetches = d.gateway.calls.filter((c) => c.key === "consentFetch");
  assert.deepEqual(fetches.map((c) => c.body.consentId), ["art-1", "art-2"],
    "each artefact must be fetched: the notify carries no signed scope");

  const ack = d.gateway.calls.find((c) => c.key === "consentHiuOnNotify");
  assert.ok(Array.isArray(ack.body.acknowledgement),
    "the HIU acknowledgement is an ARRAY (the HIP-side equivalent is a bare object)");
  assert.deepEqual(ack.body.acknowledgement.map((a) => a.consentId), ["art-1", "art-2"]);
  assert.deepEqual(ack.body.response, { requestId: "cb-1" });
  assert.equal(consentRow(d).status, "GRANTED");
});

test("notify GRANTED persists NO scope: only a verified artefact may do that", async () => {
  const d = deps({ tables: { connect_abdm_consent_req: [row({ consentRequestId: "cm-req-99" })] } });
  await HIU_HANDLERS["consent-hiu-notify"]({ env: ENV, deps: d, headers: headers(),
    body: { notification: { status: "GRANTED", consentRequestId: "cm-req-99", consentArtefacts: [{ id: "art-1" }],
      consentDetail: { hiTypes: ["OPConsultation"], careContexts: ["cc-1"] } } } });
  const r = consentRow(d);
  assert.ok(r.hi_types == null, "an unsigned notify must never write scope");
  assert.ok(r.care_contexts == null);
});

test("notify REVOKED moves the row terminal, and a replayed GRANT cannot resurrect it", async () => {
  const d = deps({ tables: { connect_abdm_consent_req: [row({ consentRequestId: "cm-req-99", status: "GRANTED" })] } });
  await HIU_HANDLERS["consent-hiu-notify"]({ env: ENV, deps: d, headers: headers(),
    body: { notification: { status: "REVOKED", consentRequestId: "cm-req-99", consentArtefacts: [] } } });
  assert.equal(consentRow(d).status, "REVOKED");

  await HIU_HANDLERS["consent-hiu-notify"]({ env: ENV, deps: d, headers: headers(),
    body: { notification: { status: "GRANTED", consentRequestId: "cm-req-99", consentArtefacts: [{ id: "art-1" }] } } });
  assert.equal(consentRow(d).status, "REVOKED", "updateConsentStatus is monotonic");
});

test("a notify for a request we never made is refused", async () => {
  const d = deps();
  await assert.rejects(() => HIU_HANDLERS["consent-hiu-notify"]({ env: ENV, deps: d, headers: headers(),
    body: { notification: { status: "GRANTED", consentRequestId: "not-ours" } } }), HiuHandlerError);
});

// ── on-fetch ────────────────────────────────────────────────────────────────────────────────────────
test("on-fetch hands the artefact to the signature verifier and answers nothing", async () => {
  const seen = [];
  const d = deps({ verifyConsentArtifact: null });
  const artefact = { status: "GRANTED", consentDetail: {}, signature: "sig" };
  // The handler calls the real verifyConsentArtifact, which fails closed without a JWKS - the point here
  // is that it is CALLED with the unwrapped artefact and that nothing is posted back.
  await HIU_HANDLERS["consent-on-fetch"]({ env: ENV, deps: { ...d, audit: async (e) => seen.push(e) },
    headers: headers(), body: { consent: artefact, response: { requestId: "our-req-1" } } });
  assert.equal(d.gateway.calls.length, 0);
  // verifyConsentArtifact emits its own consent.denied first, so look the record up by action.
  const rec = seen.find((e) => e.action === "abdm.hiu.consent.fetch");
  assert.ok(rec, "the fetch outcome must be recorded");
  assert.equal(rec.outcome, "denied", "an artefact that cannot be verified is denied, never trusted");
});

// ── on-status ───────────────────────────────────────────────────────────────────────────────────────
test("on-status moves the row's status but grants no authority of its own", async () => {
  const d = deps({ tables: { connect_abdm_consent_req: [row({ consentRequestId: "cm-req-99" })] } });
  await HIU_HANDLERS["consent-on-status"]({ env: ENV, deps: d, headers: headers(),
    body: { consentRequest: { id: "cm-req-99", status: "EXPIRED" }, response: { requestId: "our-req-1" } } });
  const r = consentRow(d);
  assert.equal(r.status, "EXPIRED");
  assert.ok(r.hi_types == null, "a poll answer is not a grant");
  assert.equal(d.gateway.calls.length, 0);
});

// ── hi on-request ───────────────────────────────────────────────────────────────────────────────────
test("hi/on-request attaches the transactionId - without it a push can never find its key", async () => {
  const d = deps({ tables: { connect_abdm_txn: [{ request_id: "our-req-1", tenant_id: "t1", consent_id: "art-1",
    transaction_id: null, status: "CONSENT_GRANTED", eph_privkey_sealed: "S:k", eph_pub_raw: "P", our_nonce: "N",
    ack_claimed: 0, created_at: NOW, updated_at: NOW }] } });
  await HIU_HANDLERS["hi-on-request"]({ env: ENV, deps: d, headers: headers(),
    body: { hiRequest: { transactionId: "txn-77", sessionStatus: "ACKNOWLEDGED" }, response: { requestId: "our-req-1" } } });
  const txn = d.db._tables.connect_abdm_txn[0];
  assert.equal(txn.transaction_id, "txn-77");
  assert.equal(txn.status, "REQUESTED");
  assert.equal(d.gateway.calls.length, 0);
});

test("hi/on-request with no transactionId is refused rather than silently dropped", async () => {
  const d = deps();
  await assert.rejects(() => HIU_HANDLERS["hi-on-request"]({ env: ENV, deps: d, headers: headers(),
    body: { hiRequest: { sessionStatus: "ACKNOWLEDGED" }, response: { requestId: "our-req-1" } } }), HiuHandlerError);
});

// ── flag gate ───────────────────────────────────────────────────────────────────────────────────────
test("every HIU handler is inert with the Connect flag off", async () => {
  for (const [kind, fn] of Object.entries(HIU_HANDLERS)) {
    const d = deps();
    await fn({ env: { CONNECT_FLAG: "0" }, deps: d, headers: headers(), body: {} });
    assert.equal(d.gateway.calls.length, 0, kind + " must be inert");
  }
});

// ── the 14-day re-consent window ────────────────────────────────────────────────────────────────────
const at = (days) => new Date(Date.parse(NOW) - days * 86400000).toISOString();

test("a consent never fetched under may always be fetched", () => {
  assert.deepEqual(withinRefetchWindow({ last_fetched_at: null }, NOW), { ok: true });
  assert.deepEqual(withinRefetchWindow({}, NOW), { ok: true });
  assert.deepEqual(withinRefetchWindow(null, NOW), { ok: true });
});

test("a re-fetch inside 14 days is allowed, and past it needs fresh consent", () => {
  assert.equal(withinRefetchWindow({ last_fetched_at: at(1) }, NOW).ok, true);
  assert.equal(withinRefetchWindow({ last_fetched_at: at(REFETCH_WINDOW_DAYS) }, NOW).ok, true, "the boundary is inclusive");
  const out = withinRefetchWindow({ last_fetched_at: at(REFETCH_WINDOW_DAYS + 0.01) }, NOW);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "refetch-window-expired");
});

test("the window fails CLOSED on a bad clock or a garbled timestamp", () => {
  assert.deepEqual(withinRefetchWindow({ last_fetched_at: at(1) }, "not-a-date"), { ok: false, reason: "no-clock" });
  assert.deepEqual(withinRefetchWindow({ last_fetched_at: "garbled" }, NOW), { ok: false, reason: "unparseable-last-fetch" });
  // A clock that has gone backwards must not silently reopen the window.
  assert.deepEqual(withinRefetchWindow({ last_fetched_at: at(-1) }, NOW), { ok: false, reason: "last-fetch-in-the-future" });
});
