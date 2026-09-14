// test/connect/abdm/hiu-consent.test.mjs — Stage-4 Task-1: HIU consent-request builder (hiu.js requestConsent).
// The RAW ABHA (abhaAddress) may live ONLY in the outbound POST body; it is HMAC'd before it touches D1/KV/
// audit and must never appear in a persisted or audited field. Identity+tenant are SERVER-derived (a
// non-member tenantId => PermissionError, and NO gateway call). Gateway 202 => persist INITIATED + audit;
// gateway non-202 => fail-closed throw with NO consent_req row written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestConsent, CONSENT_FIELDS } from "../../../functions/_connect/abdm/hiu.js";
import { getConsentReq } from "../../../functions/_connect/abdm/state.js";
import { hmacPseudonym, ALLOW, buildAuditEvent } from "../../../functions/_connect/audit.js";
import { PermissionError } from "../../../functions/_connect/permission.js";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { GATEWAY_MANDATORY, ACCESS_MODES, STRICTER_THAN_GATEWAY } from "./fixtures/sandbox-probes.mjs";

const ABHA = "ramesh1985@sbx";                       // RAW ABHA — must never be persisted/audited/logged
const HITYPES = ["OPConsultation", "DiagnosticReport"];
const NOW = "2026-07-31T10:00:00.000Z";
const ENV = { CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64"),
              ABDM_HIU_ID: "IN2810006668" };
// The doctor asking. Certification pins requester.identifier to the medical registration number, which the
// NMC verification gate already collects.
const REQUESTER = { name: "Dr A Rao", identifier: { type: "REGNO", value: "AP12345", system: "https://www.mciindia.org" } };

// Call-recording gateway stub — records (endpointKey, body) and returns a canned { status, body }.
function spyGateway(status = 202) {
  const calls = [];
  return { post: async (endpointKey, body) => { calls.push({ endpointKey, body }); return { status, body: {} }; }, calls };
}
function spyAudit() {
  const calls = [];
  const fn = async (fields) => { calls.push(fields); };
  fn.calls = calls;
  return fn;
}
function seedDb() {
  return makeAbdmDb({
    connect_membership: [{ user_id: "fb:u1", tenant_id: "t1", role: "clinician" }],
    connect_tenant: [{ id: "t1", mode: "sandbox", granted_scopes: '["Patient"]' }],
  });
}
const identifyUser = async () => ({ id: "fb:u1", guest: false });
const makeReq = (over = {}) => ({
  request: {}, tenantId: "t1", abhaAddress: ABHA,
  purpose: { text: "Care Management", code: "CAREMGT" },
  hiTypes: HITYPES, dateRange: { from: "2020-01-01", to: "2026-07-31" },
  dataEraseAt: "2026-12-31T00:00:00.000Z", requester: REQUESTER, ...over,
});
const makeDeps = (over = {}) => ({
  db: seedDb(), kv: null, secrets: null, gateway: spyGateway(), audit: spyAudit(),
  identifyFn: identifyUser, now: () => NOW, ...over,
});

test("1. builds the consentInit body through the FIELDS seam — RAW ABHA only in the POST body", async () => {
  const deps = makeDeps();
  const { requestId, status } = await requestConsent(ENV, deps, makeReq());
  assert.equal(status, "INITIATED");
  assert.equal(deps.gateway.calls.length, 1);
  const { endpointKey, body } = deps.gateway.calls[0];
  assert.equal(endpointKey, "consentInit");
  // Read the body THROUGH the seam (not hardcoded key names) so the test tracks the ADR-2H field seam.
  const consent = body[CONSENT_FIELDS.consent];
  assert.equal(consent[CONSENT_FIELDS.patient][CONSENT_FIELDS.patientId], ABHA);   // raw ABHA lives here
  assert.equal(body[CONSENT_FIELDS.requestId], requestId);
  assert.deepEqual(consent[CONSENT_FIELDS.hiTypes], HITYPES);

  // Everything the M3 collection marks on a consent init. These are not decoration: hiu.id is how the
  // gateway routes the grant back, and requester is what the patient's consent screen shows.
  assert.deepEqual(consent[CONSENT_FIELDS.hiu], { id: "IN2810006668" });
  assert.deepEqual(consent[CONSENT_FIELDS.requester], REQUESTER);
  assert.equal(consent[CONSENT_FIELDS.hip], null, "any HIP - an explicit null, not an omission");
  assert.equal(consent[CONSENT_FIELDS.careContexts], null);
  const perm = consent[CONSENT_FIELDS.permission];
  assert.equal(perm[CONSENT_FIELDS.accessMode], "VIEW");
  assert.deepEqual(perm[CONSENT_FIELDS.frequency], { unit: "HOUR", value: 0, repeats: 0 });
});

test("1b. a consent request with no medical registration number is REFUSED", async () => {
  const deps = makeDeps();
  await assert.rejects(() => requestConsent(ENV, deps, makeReq({ requester: null })), PermissionError,
    "a consent the patient cannot attribute to a named doctor is not informed consent");
  await assert.rejects(() => requestConsent(ENV, deps, makeReq({ requester: { name: "Dr A Rao" } })), PermissionError);
  assert.equal(deps.gateway.calls.length, 0, "nothing may reach the gateway");
});

test("1c. an unconfigured HIU id fails closed rather than sending an unroutable request", async () => {
  const deps = makeDeps();
  await assert.rejects(() => requestConsent({ ...ENV, ABDM_HIU_ID: "" }, deps, makeReq()));
  assert.equal(deps.gateway.calls.length, 0);
});

test("2. gateway 202 persists a connect_abdm_consent_req row keyed by patient_abha_hash (raw ABHA absent)", async () => {
  const deps = makeDeps();
  const { requestId } = await requestConsent(ENV, deps, makeReq());
  const row = await getConsentReq(deps.db, requestId);
  assert.ok(row, "consent_req row persisted");
  assert.equal(row.status, "INITIATED");
  const expectedHash = await hmacPseudonym(ENV, "t1", ABHA);
  assert.equal(row.patient_abha_hash, expectedHash);     // the HMAC, not the raw ABHA
  assert.notEqual(row.patient_abha_hash, ABHA);
  assert.ok(!JSON.stringify(row).includes(ABHA), "raw ABHA absent from every persisted field");
});

test("3. audit consent.requested carries ONLY ALLOW-listed keys + the patient HMAC (no raw ABHA)", async () => {
  const deps = makeDeps();
  await requestConsent(ENV, deps, makeReq());
  assert.equal(deps.audit.calls.length, 1);
  const fields = deps.audit.calls[0];
  assert.equal(fields.action, "consent.requested");
  // Every top-level key is ALLOW-listed <=> buildAuditEvent (which structurally drops non-ALLOW keys) drops nothing.
  assert.deepEqual(new Set(Object.keys(buildAuditEvent(fields))), new Set(Object.keys(fields)));
  for (const k of Object.keys(fields)) assert.ok(ALLOW.includes(k), `audit key ${k} not ALLOW-listed`);
  const expectedHash = await hmacPseudonym(ENV, "t1", ABHA);
  assert.equal(fields.patientRefHash, expectedHash);          // patient_abha_hash conveyed as patientRefHash
  assert.equal(fields.resourceCounts.hiTypes, HITYPES.length); // metadata: hiTypes COUNT, not the list
  assert.ok(!JSON.stringify(fields).includes(ABHA), "raw ABHA absent from the audit event");
});

test("4. gateway non-202 fails closed — throws, NO consent_req row, NO audit", async () => {
  const deps = makeDeps({ gateway: spyGateway(500) });
  await assert.rejects(() => requestConsent(ENV, deps, makeReq()));
  assert.equal(deps.gateway.calls.length, 1, "gateway was called");
  assert.equal((deps.db._tables.connect_abdm_consent_req || []).length, 0, "no row written");
  assert.equal(await getConsentReq(deps.db, "any-id"), null);
  assert.equal(deps.audit.calls.length, 0, "no audit on a failed request");
});

test("5. non-member tenantId => PermissionError and NO gateway call (server-derived, never trust the body)", async () => {
  const deps = makeDeps();
  await assert.rejects(() => requestConsent(ENV, deps, makeReq({ tenantId: "t2" })), PermissionError);
  assert.equal(deps.gateway.calls.length, 0, "no gateway call for a non-member tenant");
  assert.equal((deps.db._tables.connect_abdm_consent_req || []).length, 0, "no row written");
});

test("6. no ephemeral keypair is minted at consent-request time (that is the data-request, R17/ADR-2D)", async () => {
  // The consent request must not seal/store any ephemeral key: only secrets.seal would do so, and requestConsent
  // is handed secrets:null here — proving it never touches the key-sealing path at consent-request time.
  const deps = makeDeps({ secrets: null });
  const { status } = await requestConsent(ENV, deps, makeReq());
  assert.equal(status, "INITIATED");
  assert.equal((deps.db._tables.connect_abdm_txn || []).length, 0, "no txn/eph-key row at consent-request time");
});

// ── pinned against the LIVE sandbox, 2026-08-19 (see fixtures/sandbox-probes.mjs) ────────────────────
// Each field below was removed from our body and posted to the real gateway. These are not inferred
// from a collection: they are what dev.abdm.gov.in answered.
test("9. every field the LIVE gateway calls mandatory is present in our body", async () => {
  const deps = makeDeps();
  await requestConsent(ENV, deps, makeReq());
  const consent = deps.gateway.calls[0].body[CONSENT_FIELDS.consent];
  const perm = consent[CONSENT_FIELDS.permission];
  const present = {
    hiu: consent[CONSENT_FIELDS.hiu],
    accessMode: perm[CONSENT_FIELDS.accessMode],
    frequency: perm[CONSENT_FIELDS.frequency],
    hiTypes: consent[CONSENT_FIELDS.hiTypes],
    purpose: consent[CONSENT_FIELDS.purpose],
  };
  for (const f of GATEWAY_MANDATORY) {
    assert.ok(present[f] != null, "the sandbox refuses a consent init without " + f);
  }
  // The gateway enumerated the legal accessMode values in its own rejection message.
  assert.ok(ACCESS_MODES.includes(perm[CONSENT_FIELDS.accessMode]),
    "accessMode must be one of " + ACCESS_MODES.join(", "));
});

test("10. we are deliberately STRICTER than the gateway about the requester", async () => {
  // The live sandbox accepts a consent init with no requester (it answered "User not found", i.e. the
  // body passed). We refuse it anyway: certification pins requester.identifier to the doctor's medical
  // registration number, and the patient's consent screen shows who is asking. A gateway that tolerates
  // an anonymous request is not a reason to send one.
  assert.deepEqual(STRICTER_THAN_GATEWAY, ["requester"]);
  const deps = makeDeps();
  await assert.rejects(() => requestConsent(ENV, deps, makeReq({ requester: null })), PermissionError);
  assert.equal(deps.gateway.calls.length, 0);
});
