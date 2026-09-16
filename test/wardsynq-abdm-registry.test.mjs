/* test/wardsynq-abdm-registry.test.mjs - the HFR/HPR registry adapter (functions/_wardsynq/abdm-registry.js), its route
 * POST "/ward/abdm-registry-check", and the callback routing a saved profile projects (abdm-connect.js projectHipRouting).
 *
 * MOCKED-FETCH CONTRACT. What is pinned and how sure it is, as the adapter itself says:
 *   facility search   POST https://apihspsbx.abdm.gov.in/v4/int/FacilityManagement/v1.5/facility/search,
 *                     body { facilityId, page, resultsPerPage }. Body and response fields: NHA "Register Professional
 *                     HPR V2" guide, section 8 "Search For Facility API". The V4 host prefix is UNCONFIRMED against a
 *                     live call (from NHA's Milestone 4 Postman export as copied by integrators).
 *   professional      POST https://apihspsbx.abdm.gov.in/v4/int/apis/v1/doctors/fetch-professional-info,
 *                     body { practitioner: { id } }. Path from the same export; body and response UNCONFIRMED, so only an
 *                     answer carrying the very HPR ID asked about counts as verified.
 * No real network: the socket is replaced, everything above it is real.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-abdm-registry.test.mjs
 */
import { as, seed, docs, H, ENV, T, ORG_ID, ADMIN, NURSE, HR, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { makeAbdmDb } = await import("../functions/_connect/abdm/abdm-testkit.js");
const { makeMockKv } = await import("../functions/_connect/testkit.js");
const { checkFacility, checkProfessional, REGISTRY } = await import("../functions/_wardsynq/abdm-registry.js");
const { CONNECTOR_TYPE } = await import("../functions/_wardsynq/connectors.js");
const { resolveHipTenant, HipHandlerError } = await import("../functions/_connect/abdm/hip-handlers.js");

const HFR = "IN2810006668";
const HPR = "71234567890123";
const FACILITY_URL = "https://apihspsbx.abdm.gov.in/v4/int/FacilityManagement/v1.5/facility/search";
const PROFESSIONAL_URL = "https://apihspsbx.abdm.gov.in/v4/int/apis/v1/doctors/fetch-professional-info";
const SESSION_URL = "https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions";
const CONN = { connected: true, envName: "sandbox", hipId: HFR, hiuId: HFR };
const BASE_ENV = { ABDM_CLIENT_SECRET: "bridge-secret" };

const reply = (obj, status) => new Response(obj === undefined ? "not json" : JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
/** A registry socket: the session answers, the registry answers `registry(url, body)`. */
function socket(registry) {
  const calls = [];
  const f = async (url, init) => {
    const i = init || {};
    let body = null; try { body = i.body ? JSON.parse(i.body) : null; } catch { body = null; }
    calls.push({ url: String(url), method: i.method || "GET", headers: i.headers || {}, body });
    if (String(url) === SESSION_URL) return reply({ accessToken: "session-token-1", expiresIn: 600 });
    return registry(String(url), body);
  };
  f.calls = calls;
  f.registryCalls = () => calls.filter((c) => c.url !== SESSION_URL);
  return f;
}
const opts = (f) => ({ fetchImpl: f, kv: makeMockKv() });

/* ---- the adapter: facility --------------------------------------------------------------------------------- */

test("facility contract: POST facility/search with the session bearer, REQUEST-ID, TIMESTAMP, X-CM-ID sbx and { facilityId, page, resultsPerPage }", async () => {
  assert.equal(REGISTRY.sandbox.host + REGISTRY.sandbox.facilitySearch, FACILITY_URL);
  const f = socket(() => reply({ facilities: [{ facilityId: HFR, facilityName: "Sandbox General Hospital", facilityStatus: "Approved" }] }));
  const r = await checkFacility(BASE_ENV, CONN, HFR, opts(f));
  const [call] = f.registryCalls();
  assert.equal(call.url, FACILITY_URL);
  assert.equal(call.method, "POST");
  assert.equal(call.headers.authorization, "Bearer session-token-1");
  assert.match(call.headers["REQUEST-ID"], /^[0-9a-f-]{36}$/i);
  assert.ok(Number.isFinite(Date.parse(call.headers.TIMESTAMP)));
  assert.equal(call.headers["X-CM-ID"], "sbx");
  assert.deepEqual(call.body, { facilityId: HFR, page: 1, resultsPerPage: 10 });
  assert.equal(f.calls[0].url, SESSION_URL, "the gateway session is opened first");
  assert.deepEqual([r.status, r.facilityStatus, r.facilityName, r.httpStatus], ["verified", "Approved", "Sandbox General Hospital", 200]);
});

test("facility answers: an empty list is not-found; a 500, an unknown shape, no JSON, no network or no session is never a yes; a bad ID is not sent", async () => {
  const empty = await checkFacility(BASE_ENV, CONN, HFR, opts(socket(() => reply({ facilities: [] }))));
  assert.equal(empty.status, "not-found");
  const other = await checkFacility(BASE_ENV, CONN, HFR, opts(socket(() => reply({ facilities: [{ facilityId: "IN9999999999", facilityStatus: "Approved" }] }))));
  assert.equal(other.status, "not-found", "a different facility in the list is not this one");
  assert.equal((await checkFacility(BASE_ENV, CONN, HFR, opts(socket(() => reply({ error: "down" }, 500))))).status, "unverified");
  const shape = await checkFacility(BASE_ENV, CONN, HFR, opts(socket(() => reply({ facility: { facilityId: HFR } }))));
  assert.deepEqual([shape.status, shape.reason], ["unverified", "unknown_shape"]);
  assert.equal((await checkFacility(BASE_ENV, CONN, HFR, opts(socket(() => reply(undefined))))).status, "unverified");
  assert.equal((await checkFacility(BASE_ENV, CONN, HFR, opts(socket(() => { throw new Error("offline"); })))).reason, "network");
  const noSession = socket(() => reply({ facilities: [] }));
  const refused = async (url, init) => (String(url) === SESSION_URL ? reply({ error: "no" }, 401) : noSession(url, init));
  assert.deepEqual([(await checkFacility(BASE_ENV, CONN, HFR, opts(refused))).status, (await checkFacility(BASE_ENV, CONN, HFR, opts(refused))).reason], ["unverified", "session"]);
  const bad = socket(() => reply({ facilities: [] }));
  const r = await checkFacility(BASE_ENV, CONN, "IN 123", opts(bad));
  assert.deepEqual([r.status, r.reason], ["unverified", "bad_format"]);
  assert.equal(bad.calls.length, 0, "a malformed ID reaches nobody");
});

/* ---- the adapter: professional ----------------------------------------------------------------------------- */

test("professional contract: POST fetch-professional-info { practitioner: { id } }; verified only when the answer carries the same HPR ID", async () => {
  assert.equal(REGISTRY.sandbox.host + REGISTRY.sandbox.professional, PROFESSIONAL_URL);
  const f = socket(() => reply({ hprIdNumber: HPR, name: "Dr Registry" }));
  const r = await checkProfessional(BASE_ENV, CONN, "71-2345-6789-0123", opts(f));
  const [call] = f.registryCalls();
  assert.equal(call.url, PROFESSIONAL_URL);
  assert.equal(call.headers.authorization, "Bearer session-token-1");
  assert.equal(call.headers["X-CM-ID"], "sbx");
  assert.deepEqual(call.body, { practitioner: { id: HPR } });
  assert.deepEqual([r.status, r.name], ["verified", "Dr Registry"]);

  const nested = await checkProfessional(BASE_ENV, CONN, HPR, opts(socket(() => reply({ practitioner: { id: HPR, fullName: "Dr Nested" } }))));
  assert.equal(nested.status, "verified");
  const someoneElse = await checkProfessional(BASE_ENV, CONN, HPR, opts(socket(() => reply({ hprIdNumber: "79999999999999", name: "Other" }))));
  assert.deepEqual([someoneElse.status, someoneElse.reason], ["unverified", "unknown_shape"], "another professional's record is not a yes");
  assert.equal((await checkProfessional(BASE_ENV, CONN, HPR, opts(socket(() => reply({ status: "ok" }))))).status, "unverified");
  assert.equal((await checkProfessional(BASE_ENV, CONN, HPR, opts(socket(() => reply({ error: "x" }, 500))))).status, "unverified");
  assert.equal((await checkProfessional(BASE_ENV, CONN, HPR, opts(socket(() => reply({}, 404))))).status, "not-found");
  const bad = socket(() => reply({}));
  assert.equal((await checkProfessional(BASE_ENV, CONN, "123", opts(bad))).reason, "bad_format");
  assert.equal(bad.calls.length, 0);
});

/* ---- the route --------------------------------------------------------------------------------------------- */

function setup() {
  seed();
  docs.get(`q_orgs/${ORG_ID}`).fields.regionProfile = { hfrId: HFR };
  ENV.CONNECT_DB = makeAbdmDb({ connect_tenant: [
    { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: ORG_ID } }) },
    { id: "tenant-other", name: "Other", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-other" } }) },
  ] });
  ENV.ABDM_CLIENT_SECRET = "bridge-secret";
}
const saveProfile = (settings) => as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "abdm", provider: "shared-bridge", settings: { hfrFacilityId: HFR, status: "draft", ...(settings || {}) } });
const check = (who, body) => as(who, "/ward/abdm-registry-check", "POST", { orgId: ORG_ID, ...body });
const profileRecord = () => H.RECORD.latest(T, CONNECTOR_TYPE, "abdm");
async function withSocket(f, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = f;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}

test("route negative authorization: no session 401; nurse and hr 403; another hospital's admin 403; nothing written or sent", async () => {
  setup();
  assert.equal((await saveProfile()).__status, 200);
  const f = socket(() => reply({ facilities: [{ facilityId: HFR, facilityStatus: "Approved" }] }));
  const before = writesNow(), version = (await profileRecord()).version;
  await withSocket(f, async () => {
    assert.equal((await check(null, { target: "facility" })).__status, 401);
    for (const who of [NURSE, HR, OTHER_ADMIN]) {
      const r = await check(who, { target: "facility" });
      assert.equal(r.__status, 403, `${who}: ${r.__text}`);
    }
  });
  assert.equal(f.calls.length, 0, "no registry call");
  assert.equal(writesNow(), before);
  assert.equal((await profileRecord()).version, version);
  assert.equal((await profileRecord()).registry, undefined);
});

test("route: no profile is 409; a facility check is stored as a new version, audited, turns the checklist item verified, and survives a later save", async () => {
  setup();
  const f = socket(() => reply({ facilities: [{ facilityId: HFR, facilityName: "Sandbox General Hospital", facilityStatus: "Approved" }] }));
  await withSocket(f, async () => {
    const none = await check(ADMIN, { target: "facility" });
    assert.equal(none.__status, 409, none.__text);
    assert.equal(none.code, "not_set_up");
    assert.equal(f.calls.length, 0);

    assert.equal((await saveProfile()).__status, 200);
    const before = await as(ADMIN, `/ward/abdm-profile?orgId=${ORG_ID}`);
    assert.equal(before.checklist.find((i) => i.key === "hfr").status, "entered");
    const v1 = (await profileRecord()).version;

    const r = await check(ADMIN, { target: "facility" });
    assert.equal(r.__status, 200, r.__text);
    assert.equal(r.result.status, "verified");
    assert.ok(!r.__text.includes("session-token-1"), "the session token is never returned");
    const rec = await profileRecord();
    assert.equal(rec.version, v1 + 1, "a new version");
    assert.equal(rec.registry.facility.status, "verified");
    assert.equal(rec.registry.facility.hfrFacilityId, HFR);
    const audit = H.RECORD.audit.filter((a) => a.action === "abdm.registry.check");
    assert.equal(audit.length, 1);
    assert.deepEqual([audit[0].scope.target, audit[0].scope.hfrFacilityId, audit[0].scope.status], ["facility", HFR, "verified"]);
    assert.ok(!JSON.stringify(H.RECORD.audit).includes("session-token-1"));

    const after = await as(ADMIN, `/ward/abdm-profile?orgId=${ORG_ID}`);
    assert.equal(after.__status, 200, after.__text);
    const hfr = after.checklist.find((i) => i.key === "hfr");
    assert.equal(hfr.status, "verified");
    assert.match(hfr.detail, /registry status Approved/);
    assert.equal(after.checklist.find((i) => i.key === "session").status, "verified");

    // A later settings change keeps what the registry answered.
    assert.equal((await saveProfile({ status: "submitted" })).__status, 200);
    const kept = await profileRecord();
    assert.equal(kept.settings.status, "submitted");
    assert.equal(kept.registry.facility.status, "verified");
    assert.equal((await as(ADMIN, `/ward/abdm-profile?orgId=${ORG_ID}`)).checklist.find((i) => i.key === "hfr").status, "verified");

    // An unknown target writes nothing.
    const n = writesNow();
    assert.equal((await check(ADMIN, { target: "everything" })).__status, 422);
    assert.equal(writesNow(), n);
  });
});

test("route: a professional check updates that doctor's hprRegistry; unknown member 404, no HPR ID 422", async () => {
  setup();
  assert.equal((await saveProfile()).__status, 200);
  const v = await as(ADMIN, `/ward/abdm-profile?orgId=${ORG_ID}`);
  const doc = v.doctors.find((d) => d.role === "doctor");
  assert.ok(doc, JSON.stringify(v.doctors));
  assert.equal(doc.hprRegistry, null);
  const f = socket((url, body) => reply(url === PROFESSIONAL_URL && body.practitioner.id === HPR ? { hprIdNumber: HPR, name: "Dr Test" } : { error: "?" }, url === PROFESSIONAL_URL ? 200 : 500));
  await withSocket(f, async () => {
    const noHpr = await check(ADMIN, { target: "professional", identity: doc.identity });
    assert.equal(noHpr.__status, 422, noHpr.__text);
    assert.equal((await check(ADMIN, { target: "professional", identity: "cfa:nobody" })).__status, 404);
    assert.equal(f.calls.length, 0);

    assert.equal((await as(ADMIN, "/member", "POST", { orgId: ORG_ID, identity: doc.identity, regionProfile: { hprId: HPR } })).__status, 200);
    const r = await check(ADMIN, { target: "professional", identity: doc.identity });
    assert.equal(r.__status, 200, r.__text);
    assert.equal(r.result.status, "verified");
  });
  const rec = await profileRecord();
  assert.equal(rec.registry.professionals[doc.identity].hprId, HPR);
  const view = await as(ADMIN, `/ward/abdm-profile?orgId=${ORG_ID}`);
  const d2 = view.doctors.find((d) => d.identity === doc.identity);
  assert.equal(d2.hprRegistry.status, "verified");
  assert.match(view.checklist.find((i) => i.key === "doctors").detail, /1 found in the Health Professional Registry/);
  // The answer is about that HPR ID only: a changed ID is unchecked again.
  assert.equal((await as(ADMIN, "/member", "POST", { orgId: ORG_ID, identity: doc.identity, regionProfile: { hprId: "79999999999999" } })).__status, 200);
  assert.equal((await as(ADMIN, `/ward/abdm-profile?orgId=${ORG_ID}`)).doctors.find((d) => d.identity === doc.identity).hprRegistry, null);
});

/* ---- callback routing ---------------------------------------------------------------------------------------- */

test("projectHipRouting: a sandbox-linked profile is routable by its HIP ID; suspending it removes the row and the callback fails closed", async () => {
  setup();
  const db = ENV.CONNECT_DB;
  const rows = () => (db._tables.connect_connector_config || []).filter((r) => r.connector_id === "abdm");
  const draft = await saveProfile();
  assert.equal(draft.__status, 200);
  assert.deepEqual(draft.hipRouting, { ok: true, routed: false });
  assert.equal(rows().length, 0, "a draft routes nothing");
  assert.equal((await saveProfile({ status: "submitted" })).__status, 200);
  const linked = await saveProfile({ status: "sandbox-linked", hipId: HFR, hiuId: HFR });
  assert.equal(linked.__status, 200, linked.__text);
  assert.deepEqual(linked.hipRouting, { ok: true, routed: true });
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].tenant_id, "tenant-wsq");
  assert.equal(JSON.parse(rows()[0].config).hipId, HFR);
  assert.equal(await resolveHipTenant({}, { db }, HFR), "tenant-wsq");

  const suspended = await saveProfile({ status: "suspended", hipId: HFR, hiuId: HFR });
  assert.equal(suspended.__status, 200, suspended.__text);
  assert.deepEqual(suspended.hipRouting, { ok: true, routed: false });
  assert.equal(rows().length, 0);
  await assert.rejects(() => resolveHipTenant({}, { db }, HFR), HipHandlerError);
});
