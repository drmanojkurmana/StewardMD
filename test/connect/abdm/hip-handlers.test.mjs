// test/connect/abdm/hip-handlers.test.mjs — the M2 HIP callback handlers.
//
// Every outbound body asserted here is checked against ABDM's OWN Milestone-2 Postman collection
// (16-02-2026) and the Scan-and-Share collection (14-08-2025). The point of the suite is that we answer
// the gateway in the shape it published, on the endpoint it published, with response.requestId echoed -
// because a wrong shape fails silently at the far end, which is how D1-D6 all happened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { hmacPseudonym } from "../../../functions/_connect/audit.js";
import {
  HIP_HANDLERS, resolveHipTenant, abhaOf, HipHandlerError,
} from "../../../functions/_connect/abdm/hip-handlers.js";
import { OTP_TTL_SEC } from "../../../functions/_connect/abdm/otp.js";

const NOW = "2026-08-19T00:00:00.000Z";
const HIP_ID = "IN2810006668";
const ABHA = "ramesh@sbx";
const ENV = {
  CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", ABDM_ENV: "sandbox",
  ABDM_HIP_ID: HIP_ID, ABDM_TENANT_ID: "t1",
  CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64"),
};
const headers = (o = {}) => ({ requestId: o.requestId || "req-1", timestamp: NOW, entityId: o.entityId ?? HIP_ID });

// A gateway that records what we posted instead of calling ABDM.
function mockGateway() {
  const calls = [];
  return { calls, post: async (key, body) => { calls.push({ key, body }); return { status: 202, body: {} }; } };
}
const ccRow = (o = {}) => ({
  id: o.id, tenant_id: "t1", patient_abha_hash: o.hash, source: "consented-store",
  ref: o.ref, hi_type: o.hiType || "OPConsultation", display: o.display || "OPD visit 3 March 2026", linked_at: NOW,
});

async function baseDeps(over = {}) {
  const db = makeAbdmDb(over.tables || {});
  return {
    db, r2: makeR2(), kv: makeMockKv(), gateway: mockGateway(),
    now: () => new Date(NOW), audit: async () => {},
    ...over,
  };
}
const hashFor = (abha = ABHA) => hmacPseudonym(ENV, "t1", abha);

// ── tenant resolution ───────────────────────────────────────────────────────────────────────────────
test("the X-HIP-ID header selects the tenant, and an unknown id fails CLOSED", async () => {
  const deps = await baseDeps();
  assert.equal(await resolveHipTenant(ENV, deps, HIP_ID), "t1");
  await assert.rejects(() => resolveHipTenant(ENV, deps, "IN9999999999"), HipHandlerError,
    "an unregistered HIP id must never fall back to a default tenant");
  await assert.rejects(() => resolveHipTenant(ENV, deps, ""), HipHandlerError);
});

test("a per-tenant connector row wins over the single-tenant env fallback", async () => {
  const deps = await baseDeps({ tables: {
    connect_connector_config: [{ tenant_id: "hospital-b", connector_id: "abdm", config: JSON.stringify({ hipId: "IN2810006668_1" }) }],
  } });
  assert.equal(await resolveHipTenant(ENV, deps, "IN2810006668_1"), "hospital-b");
  assert.equal(await resolveHipTenant(ENV, deps, HIP_ID), "t1", "the env facility still resolves");
});

test("abhaOf reads whichever field ABDM used, and refuses a blank", () => {
  assert.equal(abhaOf({ abhaAddress: "a@sbx" }), "a@sbx");
  assert.equal(abhaOf({ id: "b@sbx" }), "b@sbx");
  assert.equal(abhaOf({ healthId: "c@sbx" }), "c@sbx");
  for (const bad of [null, {}, { abhaAddress: "  " }, { id: 7 }]) assert.equal(abhaOf(bad), null);
});

// ── discover ────────────────────────────────────────────────────────────────────────────────────────
test("discover: an ABHA-address hit answers on-discover with care contexts grouped by hiType", async () => {
  const hash = await hashFor();
  const deps = await baseDeps({ tables: { connect_abdm_carecontext: [
    ccRow({ id: "c1", hash, ref: "OPD:1", hiType: "OPConsultation", display: "OPD visit 3 March 2026" }),
    ccRow({ id: "c2", hash, ref: "OPD:2", hiType: "OPConsultation", display: "OPD visit 9 March 2026" }),
    ccRow({ id: "c3", hash, ref: "RX:1", hiType: "Prescription", display: "Prescription 3 March 2026" }),
  ] } });
  await HIP_HANDLERS.discover({ env: ENV, deps, headers: headers(), body: { transactionId: "tx-1", patient: { id: ABHA } } });

  assert.equal(deps.gateway.calls.length, 1);
  const { key, body } = deps.gateway.calls[0];
  assert.equal(key, "onDiscover");
  assert.equal(body.transactionId, "tx-1");
  assert.deepEqual(body.response, { requestId: "req-1" }, "the gateway matches our reply on response.requestId alone");
  assert.deepEqual(body.matchedBy, ["ABHA_ADDRESS"]);
  const byType = Object.fromEntries(body.patient.map((p) => [p.hiType, p]));
  assert.deepEqual(Object.keys(byType).sort(), ["OPConsultation", "Prescription"]);
  assert.equal(byType.OPConsultation.count, 2);
  assert.deepEqual(byType.OPConsultation.careContexts.map((c) => c.referenceNumber), ["OPD:1", "OPD:2"]);
  // The patient reference we publish is a pseudonym, never the raw ABHA - it crosses the wire to the CM.
  assert.equal(byType.OPConsultation.referenceNumber, hash);
  assert.ok(!JSON.stringify(body).includes(ABHA), "the raw ABHA must never appear in an on-discover body");
});

test("discover: no match answers with an EMPTY patient list rather than omitting the reply", async () => {
  const deps = await baseDeps();
  await HIP_HANDLERS.discover({ env: ENV, deps, headers: headers(), body: { transactionId: "tx-2", patient: { id: "nobody@sbx" } } });
  const { body } = deps.gateway.calls[0];
  assert.deepEqual(body.patient, []);
  assert.deepEqual(body.matchedBy, []);
  assert.deepEqual(body.response, { requestId: "req-1" });
});

test("discover: a demographic-only probe matches NOTHING while no demographic index is wired", async () => {
  const hash = await hashFor();
  const deps = await baseDeps({ tables: { connect_abdm_carecontext: [ccRow({ id: "c1", hash, ref: "OPD:1" })] } });
  await HIP_HANDLERS.discover({ env: ENV, deps, headers: headers(),
    body: { transactionId: "tx-3", patient: { name: "Ramesh", gender: "M", yearOfBirth: 1980,
      verifiedIdentifiers: [{ type: "MOBILE", value: "9999999999" }] } } });
  assert.deepEqual(deps.gateway.calls[0].body.patient, [],
    "without an exact identifier we must answer no-match, never guess a patient");
});

test("discover: a demographic match publishes that patient's care contexts and reports matchedBy", async () => {
  const hash = await hashFor();
  const deps = await baseDeps({
    tables: { connect_abdm_carecontext: [ccRow({ id: "c1", hash, ref: "OPD:1" })] },
    // The matcher answers in matchDemographics' real shape: a LOCAL patient ref plus how it matched.
    demographicMatch: async () => ({ matched: true, patientRef: "P-1", matchedBy: ["MOBILE"], reason: "unique" }),
  });
  await HIP_HANDLERS.discover({ env: ENV, deps, headers: headers(),
    body: { transactionId: "tx-4", patient: { id: ABHA, name: "Ramesh", gender: "M", yearOfBirth: 1980 } } });
  const { body } = deps.gateway.calls[0];
  assert.deepEqual(body.matchedBy, ["ABHA_ADDRESS"], "the ABHA arm wins when it hits - the flowchart is ordered");
  assert.equal(body.patient[0].referenceNumber, hash);
});

test("discover: the demographic arm runs ONLY when the ABHA arm missed", async () => {
  const hash = await hashFor("someone-else@sbx");
  let ran = 0;
  const deps = await baseDeps({
    tables: { connect_abdm_carecontext: [ccRow({ id: "c1", hash, ref: "OPD:1" })] },
    demographicMatch: async () => { ran++; return { matched: true, patientRef: "P-1", matchedBy: ["MOBILE"], reason: "unique" }; },
  });
  await HIP_HANDLERS.discover({ env: ENV, deps, headers: headers(),
    body: { transactionId: "tx", patient: { id: "someone-else@sbx", name: "Ramesh", gender: "M", yearOfBirth: 1980 } } });
  assert.equal(ran, 0, "an ABHA hit must not also run the demographic arm");

  const deps2 = await baseDeps({ demographicMatch: async () => { ran++; return { matched: false, reason: "no-match" }; } });
  await HIP_HANDLERS.discover({ env: ENV, deps: deps2, headers: headers(),
    body: { transactionId: "tx", patient: { id: "nobody@sbx", name: "Ramesh", gender: "M", yearOfBirth: 1980 } } });
  assert.equal(ran, 1, "an ABHA miss must fall through to the demographic arm");
  assert.deepEqual(deps2.gateway.calls[0].body.patient, []);
});

test("discover: an AMBIGUOUS demographic result is published exactly like a plain miss", async () => {
  // Two patients both fit. The reply must be byte-identical to "nobody fits", or it becomes an oracle
  // for probing who is registered here.
  const deps = await baseDeps({ demographicMatch: async () => ({ matched: false, patientRef: null, matchedBy: [], reason: "ambiguous" }) });
  await HIP_HANDLERS.discover({ env: ENV, deps, headers: headers(),
    body: { transactionId: "tx", patient: { id: "nobody@sbx", name: "Ramesh", gender: "M", yearOfBirth: 1980 } } });
  const ambiguous = deps.gateway.calls[0].body;

  const deps2 = await baseDeps({ demographicMatch: async () => ({ matched: false, patientRef: null, matchedBy: [], reason: "no-match" }) });
  await HIP_HANDLERS.discover({ env: ENV, deps: deps2, headers: headers(),
    body: { transactionId: "tx", patient: { id: "nobody@sbx", name: "Ramesh", gender: "M", yearOfBirth: 1980 } } });
  assert.deepEqual(ambiguous, deps2.gateway.calls[0].body, "ambiguous and no-match must be indistinguishable");
});

test("discover: a demographic match with no care contexts publishes NOTHING", async () => {
  const deps = await baseDeps({
    demographicMatch: async () => ({ matched: true, patientRef: "P-1", matchedBy: ["MR"], reason: "unique" }),
  });
  await HIP_HANDLERS.discover({ env: ENV, deps, headers: headers(),
    body: { transactionId: "tx", patient: { id: "nobody@sbx", name: "Ramesh", gender: "M", yearOfBirth: 1980 } } });
  assert.deepEqual(deps.gateway.calls[0].body.patient, [],
    "matching a patient we hold no records for must not fabricate an entry");
});

test("discover: a care-context display carrying a clinical result is REFUSED, not sent to the CM", async () => {
  const hash = await hashFor();
  const deps = await baseDeps({ tables: { connect_abdm_carecontext: [
    ccRow({ id: "c1", hash, ref: "OPD:1", display: "Blood sugar 240 mg/dL, started insulin" }),
  ] } });
  await assert.rejects(
    () => HIP_HANDLERS.discover({ env: ENV, deps, headers: headers(), body: { transactionId: "tx-5", patient: { id: ABHA } } }),
    "the HIE-CM is data-blind: a display with a result must throw rather than be published");
  assert.equal(deps.gateway.calls.length, 0, "nothing may reach the gateway on a data-blind violation");
});

test("discover: the HIP flag OFF answers nothing at all", async () => {
  const deps = await baseDeps();
  await HIP_HANDLERS.discover({ env: { ...ENV, CONNECT_HIP_FLAG: "0" }, deps, headers: headers(), body: { patient: { id: ABHA } } });
  assert.equal(deps.gateway.calls.length, 0);
});

// ── link init / confirm ─────────────────────────────────────────────────────────────────────────────
// A tenant with a real OTP channel configured. Without ABDM_OTP_TEMPLATE and a provider, delivery
// correctly reports not_configured - see otp.test.mjs for that path in full.
const ENV_OTP = { ...ENV, ABDM_OTP_TEMPLATE: "SMD_ABDM_OTP", FOLLOWCARE_SMS_PROVIDER: "twofactor",
  TWOFACTOR_API_KEY: "k", TWOFACTOR_SENDER: "STWRDM", TWOFACTOR_TEMPLATE_CHECKIN: "t" };

test("link-init: mints an OTP, holds the offered scope, and answers on-init in the pinned shape", async () => {
  const sent = [];
  const deps = await baseDeps({
    send: async (channel, payload) => { sent.push({ channel, payload }); return { ok: true }; },
    mintOtp: () => "123456",
    resolvePatientMobile: async () => "9876543210",
  });
  await HIP_HANDLERS["link-init"]({ env: ENV_OTP, deps, headers: headers(),
    body: { transactionId: "tx-l1", patient: { referenceNumber: "PSEUDO-1", careContexts: [{ referenceNumber: "OPD:1" }] } } });

  const { key, body } = deps.gateway.calls[0];
  assert.equal(key, "onLinkInit");
  assert.equal(body.transactionId, "tx-l1");
  assert.equal(body.link.meta.communicationMedium, "MOBILE");
  assert.equal(body.link.meta.communicationHint, "OTP");
  assert.equal(body.link.meta.communicationExpiry, new Date(Date.parse(NOW) + OTP_TTL_SEC * 1000).toISOString());
  assert.ok(body.link.referenceNumber, "a link reference is required to correlate the confirm");
  assert.deepEqual(body.response, { requestId: "req-1" });

  // Delivered for real, through the app's existing sender.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, "sms");
  assert.ok(sent[0].payload.body.includes("123456"), "the OTP is in the message");
  assert.ok(!/PSEUDO-1|OPD:1/.test(sent[0].payload.body), "an SMS is not a private channel: no refs in it");

  // The held state is NON-PHI: an OTP hash, a pseudonym and opaque references. No OTP in the clear.
  const held = JSON.parse(await deps.kv.get("connect:abdm:linkotp:" + body.link.referenceNumber));
  assert.deepEqual(held.refs, ["OPD:1"]);
  assert.equal(held.patientRef, "PSEUDO-1");
  assert.equal(held.attempts, 0);
  assert.ok(!JSON.stringify(held).includes("123456"), "the OTP itself must never be stored");
  assert.ok(!JSON.stringify(held).includes("9876543210"), "nor the mobile");
});

test("link-init: with nothing able to deliver, we do NOT claim to have sent one", async () => {
  const seen = [];
  const deps = await baseDeps({ mintOtp: () => "123456", resolvePatientMobile: async () => "9876543210" });
  deps.audit = async (e) => { seen.push(e); };
  // ENV (not ENV_OTP): no ABDM_OTP_TEMPLATE, so no channel is usable.
  await HIP_HANDLERS["link-init"]({ env: ENV, deps, headers: headers(), body: { transactionId: "tx", patient: {} } });
  const rec = seen.find((e) => e.action === "abdm.link.init");
  assert.equal(rec.outcome, "failed");
  assert.equal(rec.scope.delivered, false);
  assert.equal(rec.scope.reason, "not_configured");
});

test("link-init: no mobile on file means no delivery, and it says so", async () => {
  const seen = [];
  const deps = await baseDeps({ send: async () => ({ ok: true }), mintOtp: () => "123456",
                                resolvePatientMobile: async () => null });
  deps.audit = async (e) => { seen.push(e); };
  await HIP_HANDLERS["link-init"]({ env: ENV_OTP, deps, headers: headers(), body: { transactionId: "tx", patient: {} } });
  const rec = seen.find((e) => e.action === "abdm.link.init");
  assert.equal(rec.scope.delivered, false);
  assert.equal(rec.scope.reason, "bad_number");
});

test("link-init: past the send budget we answer an ERROR, not a link nobody can satisfy", async () => {
  const deps = await baseDeps({ send: async () => ({ ok: true }), mintOtp: () => "123456",
                                resolvePatientMobile: async () => "9876543210" });
  const body = { transactionId: "tx", patient: { referenceNumber: "PSEUDO-1" } };
  for (let i = 0; i < 3; i++) await HIP_HANDLERS["link-init"]({ env: ENV_OTP, deps, headers: headers(), body });
  await HIP_HANDLERS["link-init"]({ env: ENV_OTP, deps, headers: headers(), body });
  const last = deps.gateway.calls[deps.gateway.calls.length - 1].body;
  assert.ok(last.error, "a refused mint has no reference to offer");
  assert.equal(last.link, undefined);
  assert.deepEqual(last.response, { requestId: "req-1" });
});

async function initThenConfirm(deps, { otp = "123456", token = "123456", refs = ["OPD:1"], patientRef } = {}) {
  await HIP_HANDLERS["link-init"]({ env: ENV_OTP, deps, headers: headers({ requestId: "req-init" }),
    body: { transactionId: "tx-l1", patient: { referenceNumber: patientRef, careContexts: refs.map((r) => ({ referenceNumber: r })) } } });
  const linkRef = deps.gateway.calls[0].body.link.referenceNumber;
  await HIP_HANDLERS["link-confirm"]({ env: ENV_OTP, deps, headers: headers({ requestId: "req-conf" }),
    body: { confirmation: { linkRefNumber: linkRef, token } } });
  return { linkRef, confirm: deps.gateway.calls[deps.gateway.calls.length - 1] };
}

test("link-confirm: the right OTP links exactly what link-init offered", async () => {
  const hash = await hashFor();
  const deps = await baseDeps({
    tables: { connect_abdm_carecontext: [
      ccRow({ id: "c1", hash, ref: "OPD:1" }),
      ccRow({ id: "c2", hash, ref: "OPD:2" }),          // NOT offered at init
    ] },
    send: async () => ({ ok: true }), mintOtp: () => "123456", resolvePatientMobile: async () => "9876543210",
  });
  const { confirm, linkRef } = await initThenConfirm(deps, { patientRef: hash, refs: ["OPD:1"] });
  assert.equal(confirm.key, "onLinkConfirm");
  assert.deepEqual(confirm.body.response, { requestId: "req-conf" });
  const refs = confirm.body.patient.flatMap((p) => p.careContexts.map((c) => c.referenceNumber));
  assert.deepEqual(refs, ["OPD:1"], "confirm can never link a care context init did not offer");
  assert.equal(await deps.kv.get("connect:abdm:linkotp:" + linkRef), null, "the OTP is single-use");
});

test("link-confirm: a wrong OTP links nothing, and three wrong tries destroy the reference", async () => {
  const hash = await hashFor();
  const deps = await baseDeps({
    tables: { connect_abdm_carecontext: [ccRow({ id: "c1", hash, ref: "OPD:1" })] },
    send: async () => ({ ok: true }), mintOtp: () => "123456", resolvePatientMobile: async () => "9876543210",
  });
  await HIP_HANDLERS["link-init"]({ env: ENV_OTP, deps, headers: headers(),
    body: { transactionId: "tx", patient: { referenceNumber: hash, careContexts: [{ referenceNumber: "OPD:1" }] } } });
  const linkRef = deps.gateway.calls[0].body.link.referenceNumber;
  const key = "connect:abdm:linkotp:" + linkRef;

  for (let i = 0; i < 3; i++) {
    await HIP_HANDLERS["link-confirm"]({ env: ENV_OTP, deps, headers: headers(), body: { confirmation: { linkRefNumber: linkRef, token: "000000" } } });
    assert.deepEqual(deps.gateway.calls[deps.gateway.calls.length - 1].body.patient, []);
  }
  assert.equal(await deps.kv.get(key), null, "past the attempt cap the reference is destroyed, not ground down");

  // …and the now-dead reference still answers identically, so it is no oracle.
  await HIP_HANDLERS["link-confirm"]({ env: ENV_OTP, deps, headers: headers(), body: { confirmation: { linkRefNumber: linkRef, token: "123456" } } });
  assert.deepEqual(deps.gateway.calls[deps.gateway.calls.length - 1].body.patient, []);
});

test("link-confirm: an unknown link reference is indistinguishable from a wrong OTP", async () => {
  const deps = await baseDeps();
  await HIP_HANDLERS["link-confirm"]({ env: ENV_OTP, deps, headers: headers(), body: { confirmation: { linkRefNumber: "never-issued", token: "123456" } } });
  const { key, body } = deps.gateway.calls[0];
  assert.equal(key, "onLinkConfirm");
  assert.deepEqual(body.patient, []);
});

// ── consent notify ──────────────────────────────────────────────────────────────────────────────────
test("consent-notify GRANTED: stores the artefact and acknowledges in the pinned shape", async () => {
  const deps = await baseDeps();
  await HIP_HANDLERS["consent-notify"]({ env: ENV, deps, headers: headers(), body: { notification: {
    status: "GRANTED", consentId: "cid-1",
    consentDetail: { patient: { id: ABHA }, hiTypes: ["OPConsultation"], permission: { dataEraseAt: "2027-01-01T00:00:00Z" } },
  } } });
  const { key, body } = deps.gateway.calls[0];
  assert.equal(key, "consentHipOnNotify");
  assert.deepEqual(body.acknowledgement, { status: "SUCCESS", consentId: "cid-1" });
  assert.deepEqual(body.response, { requestId: "req-1" });

  const row = (deps.db._tables.connect_abdm_consent_req || [])[0];
  assert.equal(row.status, "GRANTED");
  assert.equal(row.patient_abha_hash, await hashFor(), "the ABHA is pseudonymised before it reaches D1");
  assert.ok(!JSON.stringify(row).includes(ABHA), "no raw ABHA anywhere on the persisted row");
});

test("consent-notify REVOKED: deletes the patient's consented records immediately, not at the next sweep", async () => {
  const hash = await hashFor();
  const refHash = await sha256hex("OPD:1");
  const r2key = "abdm/consented/t1/" + hash + "/" + refHash;
  const deps = await baseDeps({ tables: {
    connect_abdm_consent_req: [{ request_id: "cid-1", consent_id: "cid-1", tenant_id: "t1", status: "GRANTED",
      patient_abha_hash: hash, created_at: NOW, updated_at: NOW }],
    connect_abdm_consented_record: [{ tenant_id: "t1", patient_abha_hash: hash, care_context_ref: "OPD:1",
      ref_hash: refHash, hi_type: "OPConsultation", r2_key: r2key, created_at: NOW }],
  } });
  await deps.r2.put(r2key, "sealed");

  await HIP_HANDLERS["consent-notify"]({ env: ENV, deps, headers: headers(), body: { notification: {
    status: "REVOKED", consentId: "cid-1", consentDetail: { patient: { id: ABHA } },
  } } });

  assert.equal((deps.db._tables.connect_abdm_consented_record || []).length, 0, "the index row is gone");
  assert.equal(await deps.r2.get(r2key), null, "and the sealed blob with it");
  assert.equal(deps.gateway.calls[0].body.acknowledgement.status, "SUCCESS");
});

test("consent-notify: a replayed GRANTED can never resurrect a REVOKED consent", async () => {
  const hash = await hashFor();
  const deps = await baseDeps({ tables: { connect_abdm_consent_req: [
    { request_id: "cid-1", consent_id: "cid-1", tenant_id: "t1", status: "REVOKED", patient_abha_hash: hash,
      created_at: NOW, updated_at: NOW },
  ] } });
  await HIP_HANDLERS["consent-notify"]({ env: ENV, deps, headers: headers(), body: { notification: {
    status: "GRANTED", consentId: "cid-1", consentDetail: { patient: { id: ABHA } },
  } } });
  assert.equal(deps.db._tables.connect_abdm_consent_req[0].status, "REVOKED", "putHipConsent is monotonic");
});

test("consent-notify without a consentId is refused rather than stored under a guess", async () => {
  const deps = await baseDeps();
  await assert.rejects(() => HIP_HANDLERS["consent-notify"]({ env: ENV, deps, headers: headers(),
    body: { notification: { status: "GRANTED" } } }), HipHandlerError);
});

// ── hi-request ──────────────────────────────────────────────────────────────────────────────────────
test("hi-request: acknowledges FIRST, then serves, then notifies the outcome", async () => {
  const served = [];
  const deps = await baseDeps({
    tables: { connect_abdm_consent_req: [{ request_id: "r", consent_id: "cid-1", tenant_id: "t1", status: "GRANTED",
      care_contexts: JSON.stringify(["OPD:1", "OPD:2"]), created_at: NOW, updated_at: NOW }] },
    serveTransfer: async (env, d, req) => { served.push(req); return { pushed: true, pages: 2, outcome: "SERVED", warnings: [] }; },
  });
  await HIP_HANDLERS["hi-request"]({ env: ENV, deps, headers: headers(), body: {
    transactionId: "tx-hi", hiRequest: { consent: { id: "cid-1" }, dataPushUrl: "https://hiu.example.org/push",
      keyMaterial: { cryptoAlg: "ECDH", curve: "Curve25519", dhPublicKey: { keyValue: "K" }, nonce: "N" } },
  } });

  assert.deepEqual(deps.gateway.calls.map((c) => c.key), ["hiHipOnRequest", "hiNotify"],
    "the ack must precede the transfer: ABDM treats a late ack as a failed delivery (FAQ Q36)");
  const ack = deps.gateway.calls[0].body;
  assert.deepEqual(ack.hiRequest, { transactionId: "tx-hi", sessionStatus: "ACKNOWLEDGED" });
  assert.deepEqual(ack.response, { requestId: "req-1" });

  // The served scope comes from the consent row, never the request body.
  assert.deepEqual(served[0].careContexts, ["OPD:1", "OPD:2"]);
  assert.equal(served[0].transactionId, "tx-hi");
  assert.equal(served[0].hipId, HIP_ID);

  const n = deps.gateway.calls[1].body.notification;
  assert.equal(n.consentId, "cid-1");
  assert.equal(n.transactionId, "tx-hi");
  assert.deepEqual(n.notifier, { type: "HIP", id: HIP_ID });
  assert.equal(n.statusNotification.sessionStatus, "TRANSFERRED");
  assert.deepEqual(n.statusNotification.statusResponses.map((s) => s.careContextReference), ["OPD:1", "OPD:2"]);
  assert.ok(n.statusNotification.statusResponses.every((s) => s.hiStatus === "OK"));
});

test("hi-request: a failed serve still sends the receipt, marked ERRORED", async () => {
  const deps = await baseDeps({
    tables: { connect_abdm_consent_req: [{ request_id: "r", consent_id: "cid-1", tenant_id: "t1", status: "GRANTED",
      care_contexts: JSON.stringify(["OPD:1"]), created_at: NOW, updated_at: NOW }] },
    serveTransfer: async () => { throw new Error("over-share refused"); },
  });
  await HIP_HANDLERS["hi-request"]({ env: ENV, deps, headers: headers(), body: {
    transactionId: "tx-hi", hiRequest: { consent: { id: "cid-1" } } } });

  assert.deepEqual(deps.gateway.calls.map((c) => c.key), ["hiHipOnRequest", "hiNotify"],
    "a silent failure looks to the HIU like a transfer still in flight");
  const n = deps.gateway.calls[1].body.notification;
  assert.equal(n.statusNotification.sessionStatus, "FAILED");
  assert.equal(n.statusNotification.statusResponses[0].hiStatus, "ERRORED");
});

test("hi-request: a PARTIAL serve is reported as PARTIAL, not as success", async () => {
  const deps = await baseDeps({
    tables: { connect_abdm_consent_req: [{ request_id: "r", consent_id: "cid-1", tenant_id: "t1", status: "GRANTED",
      care_contexts: JSON.stringify(["OPD:1"]), created_at: NOW, updated_at: NOW }] },
    serveTransfer: async () => ({ pushed: true, pages: 1, outcome: "PARTIAL", warnings: [{}] }),
  });
  await HIP_HANDLERS["hi-request"]({ env: ENV, deps, headers: headers(), body: {
    transactionId: "tx", hiRequest: { consent: { id: "cid-1" } } } });
  const n = deps.gateway.calls[1].body.notification;
  assert.equal(n.statusNotification.sessionStatus, "PARTIAL");
  assert.equal(n.statusNotification.statusResponses[0].hiStatus, "PARTIAL");
});

// ── patient share (scan-and-share) ──────────────────────────────────────────────────────────────────
const SHARE_BODY = {
  intent: "PROFILE_SHARE",
  metaData: { hipId: HIP_ID, context: "1", hprId: "testhpr@hpr.abdm", latitude: "-38.670", longitude: "58.498" },
  profile: { patient: { abhaNumber: "91234567890123", abhaAddress: ABHA, name: "Ramesh Kumar", gender: "M",
    dayOfBirth: "1*", monthOfBirth: "0*", yearOfBirth: "19**",
    address: { line: "12 MG Road", district: null, state: null, pinCode: null }, phoneNumber: "9876543210" } },
};

test("patient-share: we issue the OPD queue token and answer on-share in the pinned shape", async () => {
  const issued = [];
  const deps = await baseDeps({
    issueQueueToken: async (env, d, a) => { issued.push(a); return { tokenNumber: 15, expirySec: 1800 }; },
  });
  await HIP_HANDLERS["patient-share"]({ env: ENV, deps, headers: headers(), body: SHARE_BODY });

  const { key, body } = deps.gateway.calls[0];
  assert.equal(key, "patientShareOnShare");
  assert.deepEqual(body.acknowledgement.profile, { context: "1", tokenNumber: "15", expiry: "1800" },
    "tokenNumber and expiry are STRINGS on the wire, and expiry is in seconds");
  assert.equal(body.acknowledgement.status, "SUCCESS");
  assert.equal(body.acknowledgement.abhaAddress, ABHA, "ABDM keys its own reply on the address it sent");
  assert.deepEqual(body.response, { requestId: "req-1" });

  // The verified demographics reach the queue - that is the whole point of scan-and-share.
  assert.equal(issued[0].patient.name, "Ramesh Kumar");
  assert.equal(issued[0].patient.mobile, "9876543210");
  assert.equal(issued[0].context, "1");
  assert.equal(issued[0].hprId, "testhpr@hpr.abdm");
});

test("patient-share: with no queue bridge bound we report FAILURE, never a token we did not issue", async () => {
  const deps = await baseDeps();                                  // no issueQueueToken
  await HIP_HANDLERS["patient-share"]({ env: ENV, deps, headers: headers(), body: SHARE_BODY });
  const { body } = deps.gateway.calls[0];
  assert.equal(body.acknowledgement.status, "FAILURE");
  assert.equal(body.acknowledgement.profile, undefined,
    "a patient holding a token number that does not exist is worse than an honest failure");
});

test("patient-share: an unknown HIP id is refused before any token is issued", async () => {
  const issued = [];
  const deps = await baseDeps({ issueQueueToken: async () => { issued.push(1); return { tokenNumber: 1 }; } });
  await assert.rejects(() => HIP_HANDLERS["patient-share"]({ env: ENV, deps, headers: headers({ entityId: "IN0000000000" }),
    body: { ...SHARE_BODY, metaData: { ...SHARE_BODY.metaData, hipId: "IN0000000000" } } }), HipHandlerError);
  assert.equal(issued.length, 0);
});

// ── acknowledgement-only callbacks ──────────────────────────────────────────────────────────────────
test("link-result / context-notify / sms-notify are recorded and answer NOTHING back to the gateway", async () => {
  for (const kind of ["link-result", "context-notify-ack", "sms-notify-ack"]) {
    const seen = [];
    const deps = await baseDeps();
    deps.audit = async (e) => { seen.push(e); };
    await HIP_HANDLERS[kind]({ env: ENV, deps, headers: headers(), body: { acknowledgement: { status: "SUCCESS" } } });
    assert.equal(deps.gateway.calls.length, 0, kind + " must not answer an on-* with an on-*");
    assert.equal(seen.length, 1, kind + " must be recorded so a failure is visible");
    assert.equal(seen[0].outcome, "ok");
  }
});

test("an error body on an acknowledgement-only callback is recorded as a failure", async () => {
  const seen = [];
  const deps = await baseDeps();
  deps.audit = async (e) => { seen.push(e); };
  await HIP_HANDLERS["link-result"]({ env: ENV, deps, headers: headers(),
    body: { error: { code: 3403, message: "care context already linked" } } });
  assert.equal(seen[0].outcome, "failed");
  assert.equal(seen[0].scope.code, "3403");
});

async function sha256hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
