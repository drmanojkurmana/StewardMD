/* test/wardsynq-abdm-chart-routes.test.mjs - ABDM on a patient's chart, through the real router.
 *
 * Routes: GET "/ward/abdm-records", POST "/ward/abdm-link-stay", POST "/ward/abdm-consent-request",
 * POST "/ward/abdm-fetch" (functions/_wardsynq/abdm-chart.js). The only substitution is the socket:
 * globalThis.fetch answers as the ABDM sandbox gateway would. No real network.
 *
 * NO_COLOR=1 node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-abdm-chart-routes.test.mjs
 */
import { as, seed, docs, H, ENV, T, ORG_ID, OTHER, ADMIN, NURSE, HR, DOCTOR, OTHER_ADMIN, writesNow, withFetch } from "./wardsynq-connectors-harness.mjs";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb } from "../functions/_connect/abdm/abdm-testkit.js";
import { hmacPseudonym } from "../functions/_connect/audit.js";

const HFR = "IN2810006668";
const ABHA = "ramesh@sbx";
const GW = "https://dev.abdm.gov.in";
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const ORIGINAL_DB = ENV.CONNECT_DB;

afterEach(() => { ENV.CONNECT_DB = ORIGINAL_DB; delete ENV.CONNECT_ABDM_DATA_PUSH_URL; });

/* The socket. Records every call; the session answers a token, every other gateway post is accepted. */
function gateway() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    let body = null; try { body = init && init.body ? JSON.parse(init.body) : null; } catch { body = null; }
    calls.push({ url: String(url), headers: (init && init.headers) || {}, body });
    if (String(url) === GW + "/api/hiecm/gateway/v3/sessions") return new Response(JSON.stringify({ accessToken: "gw", expiresIn: 600 }), { status: 200 });
    return new Response("{}", { status: 202 });
  };
  return { calls, fetchImpl };
}

const consentRows = () => (ENV.CONNECT_DB._tables.connect_abdm_consent_req || []).length;

/** A hospital with (optionally) a linked ABDM profile, one patient with an ABHA on the record and one without. */
async function setup({ link = true } = {}) {
  seed();
  docs.get(`q_orgs/${ORG_ID}`).fields.regionProfile = { hfrId: HFR };
  ENV.CONNECT_DB = makeAbdmDb({ connect_tenant: [
    { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: ORG_ID } }) },
    { id: "tenant-other", name: "Other", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: OTHER } }) },
  ] });
  ENV.ABDM_CLIENT_SECRET = "bridge-secret";
  ENV.CONNECT_HMAC_SALT = Buffer.from("connect-test-hmac-salt-key-1234").toString("base64");
  ENV.CONNECT_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
  if (link) {
    const PROFILE = (s) => ({ orgId: ORG_ID, kind: "abdm", provider: "shared-bridge", settings: { hfrFacilityId: HFR, status: "draft", ...s } });
    for (const s of [{}, { status: "submitted" }, { status: "sandbox-linked", hipId: HFR, hiuId: HFR }]) {
      const r = await as(ADMIN, "/ward/connector-save", "POST", PROFILE(s));
      assert.equal(r.__status, 200, r.__text);
    }
  }
  const admit = async (name, mobile) => {
    const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name, mobile, gender: "female", ageYears: 40 });
    assert.equal(reg.__status, 200, reg.__text);
    const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: mobile.slice(-1) });
    assert.equal(adm.__status, 200, adm.__text);
    return adm;
  };
  const withAbha = await admit("Abha Person", "9876500021");
  const noAbha = await admit("No Abha Person", "9876500022");
  const p = await H.RECORD.latest(T, "Patient", withAbha.patientId);
  await H.RECORD.append(T, [{ ...p, version: p.version + 1, identifiers: [...(p.identifiers || []), { system: "abha-address", value: ABHA }] }]);
  /* Admission starts the stay-link hook after the response (router abdmStayHook, waitUntil). The harness does not
   * await it, so let it finish here rather than have its reads land inside a later assertion. */
  for (let n = -1; n !== writesNow();) { n = writesNow(); await new Promise((r) => setTimeout(r, 20)); }
  return { withAbha, noAbha };
}

const records = (who, patientId, orgId) => as(who, `/ward/abdm-records?orgId=${orgId || ORG_ID}&patientId=${patientId}`);
const consentBody = (patientId, over) => ({ orgId: ORG_ID, patientId, purpose: "CAREMGT", hiTypes: ["OPConsultation", "Prescription"],
  from: iso(Date.now() - 365 * DAY), to: iso(Date.now() - DAY), expiresOn: iso(Date.now() + 30 * DAY), ...(over || {}) });

/* ---- who may call ----------------------------------------------------------------------------------- */

test("negative authorization on all four routes: no session 401, hr 403, nurse 403 on the POSTs, another hospital 403 (404 from its own org); nothing written, nothing sent", async () => {
  const { withAbha } = await setup();
  const gw = gateway();
  const before = writesNow(), rowsBefore = consentRows();
  const pid = withAbha.patientId;
  const calls = [
    ["GET", `/ward/abdm-records?orgId=${ORG_ID}&patientId=${pid}`, null],
    ["POST", "/ward/abdm-link-stay", { orgId: ORG_ID, patientId: pid, encounterId: withAbha.encounterId }],
    ["POST", "/ward/abdm-consent-request", consentBody(pid)],
    ["POST", "/ward/abdm-fetch", { orgId: ORG_ID, patientId: pid, requestId: "req-x" }],
  ];
  await withFetch(gw.fetchImpl, async () => {
    for (const [method, path, body] of calls) {
      const who = [[null, 401], [HR, 403], [OTHER_ADMIN, 403], ...(method === "POST" ? [[NURSE, 403]] : [])];
      for (const [email, status] of who) {
        const r = await as(email, path, method, body);
        assert.equal(r.__status, status, `${email} ${path}: ${r.__text}`);
        assert.ok(!r.__text.includes(ABHA));
      }
    }
    assert.equal(writesNow(), before, "no refused call wrote a record or an audit row");
    /* Another hospital's admin, on their own hospital, naming this hospital's patient: the patient is not found
     * there. That lookup is an authorised read in THEIR tenant (audited there); nothing lands in this one. */
    const auditBefore = H.RECORD.audit.length;
    const cross = await records(OTHER_ADMIN, pid, OTHER);
    assert.equal(cross.__status, 404, cross.__text);
    assert.equal(cross.error, "patient_not_found");
    assert.ok(!cross.__text.includes(ABHA) && !cross.__text.includes("Abha Person"));
    for (const [path, body] of [["/ward/abdm-consent-request", { ...consentBody(pid), orgId: OTHER }],
      ["/ward/abdm-link-stay", { orgId: OTHER, patientId: pid, encounterId: withAbha.encounterId }], ["/ward/abdm-fetch", { orgId: OTHER, patientId: pid, requestId: "req-x" }]]) {
      const r = await as(OTHER_ADMIN, path, "POST", body);
      assert.equal(r.__status, 404, `${path}: ${r.__text}`);
    }
    const added = H.RECORD.audit.slice(auditBefore);
    assert.ok(added.every((a) => a.tenantId === "tenant-other"), "nothing written under this hospital");
    assert.equal(H.RECORD._rows.filter((r) => r.tenantId === "tenant-other").length, 0, "and no record written anywhere");
  });
  assert.equal(consentRows(), rowsBefore, "no consent request row");
  assert.equal(gw.calls.length, 0, "nothing went to ABDM");
});

/* ---- refusals before the gateway --------------------------------------------------------------------- */

test("not connected: the three POSTs answer 409 abdm_not_connected and the view says so; no gateway call", async () => {
  const { withAbha } = await setup({ link: false });
  const gw = gateway();
  ENV.CONNECT_ABDM_DATA_PUSH_URL = "https://stewardmd.in/api/connect/abdm/hiu/data";
  const pid = withAbha.patientId;
  await withFetch(gw.fetchImpl, async () => {
    for (const [path, body] of [["/ward/abdm-link-stay", { orgId: ORG_ID, patientId: pid, encounterId: withAbha.encounterId }],
      ["/ward/abdm-consent-request", consentBody(pid)], ["/ward/abdm-fetch", { orgId: ORG_ID, patientId: pid, requestId: "req-x" }]]) {
      const r = await as(DOCTOR, path, "POST", body);
      assert.equal(r.__status, 409, `${path}: ${r.__text}`);
      assert.equal(r.error, "abdm_not_connected");
      assert.equal(r.code, "not_set_up");
    }
    const v = await records(DOCTOR, pid);
    assert.equal(v.__status, 200, v.__text);
    assert.deepEqual(v.connection, { connected: false, code: "not_set_up", reason: v.connection.reason });
  });
  assert.equal(gw.calls.length, 0);
  assert.equal(consentRows(), 0);
});

test("no ABHA 409, bad purpose, no HI types and bad or reversed dates 422; nothing reaches ABDM", async () => {
  const { withAbha, noAbha } = await setup();
  const gw = gateway();
  await withFetch(gw.fetchImpl, async () => {
    const r1 = await as(DOCTOR, "/ward/abdm-consent-request", "POST", consentBody(noAbha.patientId));
    assert.equal(r1.__status, 409, r1.__text);
    assert.equal(r1.error, "no_abha");
    const r2 = await as(DOCTOR, "/ward/abdm-link-stay", "POST", { orgId: ORG_ID, patientId: noAbha.patientId, encounterId: noAbha.encounterId });
    assert.equal(r2.__status, 409, r2.__text);
    assert.equal(r2.error, "no_abha");
    const pid = withAbha.patientId;
    for (const [over, code] of [
      [{ purpose: "MARKETING" }, "purpose_required"],
      [{ purpose: "" }, "purpose_required"],
      [{ hiTypes: [] }, "hi_types_required"],
      [{ hiTypes: ["NotAType"] }, "hi_types_required"],
      [{ from: "not a date" }, "date_range_required"],
      [{ to: "" }, "date_range_required"],
      [{ from: iso(Date.now() - DAY), to: iso(Date.now() - 10 * DAY) }, "date_range_required"],
    ]) {
      const r = await as(DOCTOR, "/ward/abdm-consent-request", "POST", consentBody(pid, over));
      assert.equal(r.__status, 422, `${JSON.stringify(over)}: ${r.__text}`);
      assert.equal(r.error, code);
    }
    const unknown = await as(DOCTOR, "/ward/abdm-consent-request", "POST", consentBody("no-such-patient"));
    assert.equal(unknown.__status, 404, unknown.__text);
  });
  assert.equal(gw.calls.length, 0, "not one refused request reached the gateway");
  assert.equal(consentRows(), 0);
});

/* ---- the consent request, then the chart ------------------------------------------------------------- */

test("positive: a doctor asks for records; the gateway gets the hospital's HIU ID and the doctor's REGNO; the row is pseudonymous; the chart lists it INITIATED; fetch is refused until granted", async () => {
  const { withAbha, noAbha } = await setup();
  const gw = gateway();
  const pid = withAbha.patientId;
  const res = await withFetch(gw.fetchImpl, () => as(DOCTOR, "/ward/abdm-consent-request", "POST", consentBody(pid)));
  assert.equal(res.__status, 200, res.__text);
  assert.equal(res.status, "INITIATED");
  assert.ok(res.requestId);
  assert.ok(!res.__text.includes(ABHA), "the ABHA is not echoed");

  assert.equal(gw.calls[0].url, GW + "/api/hiecm/gateway/v3/sessions", "the bridge session first");
  const init = gw.calls.filter((c) => c.url === GW + "/api/hiecm/consent/v3/request/init");
  assert.equal(init.length, 1);
  assert.equal(init[0].headers["X-HIU-ID"], HFR, "this hospital's own HIU ID");
  assert.equal(init[0].headers.authorization, "Bearer gw");
  const c = init[0].body.consent;
  assert.deepEqual(c.requester.identifier, { type: "REGNO", value: "TSMC-2019-44821", system: "https://www.mciindia.org" });
  assert.equal(c.hiu.id, HFR);
  assert.deepEqual(c.purpose, { code: "CAREMGT", text: "Care Management" });
  assert.equal(c.patient.id, ABHA, "the raw ABHA goes in the POST body to ABDM, the one place it belongs");
  assert.deepEqual(c.hiTypes, ["OPConsultation", "Prescription"]);
  assert.equal(c.permission.accessMode, "VIEW");

  const rows = ENV.CONNECT_DB._tables.connect_abdm_consent_req;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].request_id, res.requestId);
  assert.equal(rows[0].tenant_id, T);
  assert.equal(rows[0].status, "INITIATED");
  assert.equal(rows[0].patient_abha_hash, await hmacPseudonym(ENV, T, ABHA));
  assert.ok(!JSON.stringify(ENV.CONNECT_DB._tables).includes(ABHA), "the raw address is stored nowhere");

  for (const who of [DOCTOR, NURSE]) {
    const v = await records(who, pid);
    assert.equal(v.__status, 200, `${who}: ${v.__text}`);
    assert.equal(v.connection.connected, true);
    assert.equal(v.connection.hiuId, HFR);
    assert.equal(v.abha.onRecord, true);
    assert.ok(Array.isArray(v.unreadableTypes));
    assert.equal(v.requests.length, 1);
    assert.equal(v.requests[0].requestId, res.requestId);
    assert.equal(v.requests[0].status, "INITIATED");
    assert.equal(v.requests[0].consentGranted, false);
    assert.ok(!v.__text.includes(ABHA));
  }
  const other = await records(DOCTOR, noAbha.patientId);
  assert.equal(other.__status, 200, other.__text);
  assert.deepEqual([other.abha.onRecord, other.requests], [false, []], "another patient's chart does not show this request");

  const fetchBody = (patientId, requestId) => ({ orgId: ORG_ID, patientId, requestId });
  const n = gw.calls.length;
  await withFetch(gw.fetchImpl, async () => {
    const noReceiver = await as(DOCTOR, "/ward/abdm-fetch", "POST", fetchBody(pid, res.requestId));
    assert.equal(noReceiver.__status, 409, noReceiver.__text);
    assert.equal(noReceiver.error, "receiver_not_configured");
    ENV.CONNECT_ABDM_DATA_PUSH_URL = "https://stewardmd.in/api/connect/abdm/hiu/data";
    const notGranted = await as(DOCTOR, "/ward/abdm-fetch", "POST", fetchBody(pid, res.requestId));
    assert.equal(notGranted.__status, 409, notGranted.__text);
    assert.equal(notGranted.error, "consent_not_granted");
    const wrongPatient = await as(DOCTOR, "/ward/abdm-fetch", "POST", fetchBody(noAbha.patientId, res.requestId));
    assert.equal(wrongPatient.__status, 404, wrongPatient.__text);
    assert.equal(wrongPatient.error, "request_not_found");
    // A granted request of another hospital, for the same ABHA pseudonym, is not this hospital's to fetch.
    ENV.CONNECT_DB._tables.connect_abdm_consent_req.push({ request_id: "req-other-tenant", tenant_id: "tenant-other", actor: "x",
      patient_abha_hash: rows[0].patient_abha_hash, status: "GRANTED", consent_id: "consent-other", care_contexts: '["cc-1"]' });
    const otherTenant = await as(DOCTOR, "/ward/abdm-fetch", "POST", fetchBody(pid, "req-other-tenant"));
    assert.equal(otherTenant.__status, 404, otherTenant.__text);
    const missing = await as(DOCTOR, "/ward/abdm-fetch", "POST", fetchBody(pid, "no-such-request"));
    assert.equal(missing.__status, 404, missing.__text);
  });
  assert.equal(gw.calls.length, n, "no refused fetch reached ABDM");
  assert.equal(ENV.CONNECT_DB._tables.connect_abdm_consent_req.find((r) => r.request_id === res.requestId).status, "INITIATED");
  assert.equal((ENV.CONNECT_DB._tables.connect_abdm_txn || []).length, 0, "no transaction, no key minted");
});

/* ---- linking a stay -------------------------------------------------------------------------------------- */

test("positive: linking a stay with a record to share registers its care context and asks ABDM for a link token", async () => {
  const { withAbha } = await setup();
  const at = new Date().toISOString();
  await H.RECORD.append(T, [{ resourceType: "MedicationOrder", id: "mo-abdm-1", version: 1, patientId: withAbha.patientId, encounterId: withAbha.encounterId,
    drug: "Paracetamol", status: "active", meta: { recordedAt: at }, writtenBy: { id: "t", kind: "human", at } }]);
  const gw = gateway();
  const r = await withFetch(gw.fetchImpl, () => as(DOCTOR, "/ward/abdm-link-stay", "POST", { orgId: ORG_ID, patientId: withAbha.patientId, encounterId: withAbha.encounterId }));
  assert.equal(r.__status, 200, r.__text);
  assert.equal(r.state, "token-requested");
  assert.equal(r.contexts, 1);
  assert.equal(r.registered, 1);
  const tok = gw.calls.filter((c) => c.url === GW + "/api/hiecm/v3/token/generate-token");
  assert.equal(tok.length, 1, "a link token was asked for");
  assert.equal(tok[0].headers["X-HIP-ID"], HFR);
  const ctx = ENV.CONNECT_DB._tables.connect_abdm_carecontext;
  assert.equal(ctx.length, 1);
  assert.equal(ctx[0].ref, `IPD:${withAbha.encounterId}:RX`);
  assert.equal(ctx[0].patient_abha_hash, await hmacPseudonym(ENV, T, ABHA));

  const v = await records(DOCTOR, withAbha.patientId);
  assert.equal(v.__status, 200, v.__text);
  const stay = v.stays.find((s) => s.encounterId === withAbha.encounterId);
  assert.deepEqual(stay.records.map((x) => [x.hiType, x.registered]), [["Prescription", true]]);
});

test("a stay that is not this patient's is refused 404 before anything is registered or sent", async () => {
  const { withAbha, noAbha } = await setup();
  const at = new Date().toISOString();
  await H.RECORD.append(T, [{ resourceType: "MedicationOrder", id: "mo-abdm-other", version: 1, patientId: noAbha.patientId, encounterId: noAbha.encounterId,
    drug: "Paracetamol", status: "active", meta: { recordedAt: at }, writtenBy: { id: "t", kind: "human", at } }]);
  const gw = gateway();
  for (const encounterId of [noAbha.encounterId, "enc-does-not-exist"]) {
    const r = await withFetch(gw.fetchImpl, () => as(DOCTOR, "/ward/abdm-link-stay", "POST", { orgId: ORG_ID, patientId: withAbha.patientId, encounterId }));
    assert.equal(r.__status, 404, r.__text);
    assert.equal(r.error, "encounter_not_found");
  }
  assert.equal(gw.calls.length, 0);
  assert.equal((ENV.CONNECT_DB._tables.connect_abdm_carecontext || []).length, 0);
});

test("a stay with nothing final to share reports nothing-to-link and sends nothing", async () => {
  const { withAbha } = await setup();
  const gw = gateway();
  const r = await withFetch(gw.fetchImpl, () => as(DOCTOR, "/ward/abdm-link-stay", "POST", { orgId: ORG_ID, patientId: withAbha.patientId, encounterId: withAbha.encounterId }));
  assert.equal(r.__status, 200, r.__text);
  assert.equal(r.state, "nothing-to-link");
  assert.equal(gw.calls.length, 0);
});

/* ---- what arrived ---------------------------------------------------------------------------------------- */

test("records received through ABDM are listed under received; the hospital's own are not", async () => {
  const { withAbha } = await setup();
  const at = new Date().toISOString();
  await H.RECORD.append(T, [
    { resourceType: "Condition", id: "cond-abdm-1", version: 1, patientId: withAbha.patientId, display: "Enteric fever", clinicalStatus: "active", status: "draft",
      meta: { recordedAt: at, source: { system: "abdm", id: "cond-1" } }, writtenBy: { id: "t", kind: "service", at } },
    { resourceType: "Condition", id: "cond-own-1", version: 1, patientId: withAbha.patientId, display: "Hypertension", clinicalStatus: "active",
      meta: { recordedAt: at }, writtenBy: { id: "t", kind: "human", at } },
  ]);
  const v = await records(DOCTOR, withAbha.patientId);
  assert.equal(v.__status, 200, v.__text);
  assert.deepEqual(v.received.map((x) => [x.type, x.id, x.what]), [["Condition", "cond-abdm-1", "Enteric fever"]]);
});
