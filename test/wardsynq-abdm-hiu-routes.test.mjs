/* test/wardsynq-abdm-hiu-routes.test.mjs — the ABDM HIU doors that START an exchange.
 *
 * WHAT THIS CLOSES. requestConsent and requestHealthInformation existed, with real consent binding,
 * real X25519 key minting and a real state machine - and NOTHING CALLED THEM. fetchConsentArtifact,
 * the step that learns WHAT a granted consent covers, had no caller either. A hospital could receive
 * an ABDM callback and had no way to ask for anything in the first place.
 *
 * Every test here drives the REAL route (functions/api/connect/[[path]].js onRequest) - the real
 * composition root, the real gateway client with its real session token and REQUEST-ID headers, the
 * real ingress with RS256-signed webhook bodies verified against a pinned JWKS, and real Fidelius
 * crypto. The only substitution is the socket: globalThis.fetch answers as the CM/gateway would, and
 * hands each call to the mock's own state machine.
 *
 * The loop is proven once, in test 1: ask for consent -> the patient grants -> the artifact is
 * fetched AUTOMATICALLY -> its signed scope is verified and persisted -> ask for the data -> the HIP
 * pushes it encrypted -> the composition root decrypts it with the key it minted and acknowledges
 * the HIP. The last step, filing those documents onto the chart, is proven through the same real
 * ingress in wardsynq-abdm-landing.test.mjs - the route builds its record store from the D1 binding,
 * so observing that here would mean adding a seam to production for a test's benefit.
 *
 * NOT VERIFIED and not claimed anywhere: the real ABDM sandbox, a real gateway, a real CM, or a
 * registered HIU/HIP identity. None exists in this environment, and the wire-shape seams the ABDM
 * modules themselves mark "// VERIFY" remain unverified.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-abdm-hiu-routes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { onRequest } from "../functions/api/connect/[[path]].js";
import { ENDPOINTS } from "../functions/_connect/abdm/gateway.js";
import { makeAbdmDb, makeR2 } from "../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../functions/_connect/testkit.js";
import { getConsentReq, getTxnByRequestId } from "../functions/_connect/abdm/state.js";
import { makeHiuMockGateway } from "./connect/abdm/mock-gateway.mjs";

/* THE REAL CLOCK, deliberately. The composition root injects `() => new Date().toISOString()`, and
 * both the webhook freshness window and the consent's own date-range gate are checked against it -
 * so a fixture pinned to a fabricated date would be rejected as stale by the very guards this test
 * exists to exercise. The consent window is built AROUND now for the same reason. */
const T0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const DAY = 86400000;
const ABHA = "ramesh1985@sbx";
const TENANT = "t1";
const EMAIL = "doctor@example.test";
/* identify() keys an actor as "cfa:" + the FIRST 24 HEX CHARACTERS of the email's SHA-256
 * (functions/_usage.js sha256hex). Recomputed here rather than imported so this test would notice if
 * that key ever changed shape - it is the id every membership and every audit row is written under. */
const ACTOR = "cfa:" + createHash("sha256").update(EMAIL).digest("hex").slice(0, 24);
const OUTSIDER = "outsider@example.test";

const SCOPE = {
  purpose: { code: "CAREMGT", text: "Care Management" },
  hiTypes: ["OPConsultation"],
  dateRange: { from: iso(T0 - 30 * DAY), to: iso(T0 + 30 * DAY) },
  dataEraseAt: iso(T0 + 365 * DAY),
  expiry: iso(T0 + 365 * DAY),
  careContexts: ["cc-0"],
};

const ndhmDoc = () => ({
  resourceType: "Bundle", type: "document",
  entry: [
    { fullUrl: "urn:uuid:comp-1", resource: { resourceType: "Composition", id: "comp-1", status: "final",
      meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord"] },
      type: { text: "Clinical consultation report" }, subject: { reference: "Patient/pat-1" },
      title: "OP Consultation", date: "2026-07-14T00:00:00Z",
      text: { status: "generated", div: "<div>Enteric fever</div>" },
      section: [{ title: "Chief complaints", entry: [{ reference: "Condition/cond-1" }] }] } },
    { fullUrl: "urn:uuid:pat-1", resource: { resourceType: "Patient", id: "pat-1", gender: "male", birthDate: "1985-01-01",
      name: [{ text: "Synthetic Marker", family: "Marker", given: ["Synthetic"] }] } },
    { fullUrl: "urn:uuid:cond-1", resource: { resourceType: "Condition", id: "cond-1",
      code: { text: "Enteric fever", coding: [{ system: "http://snomed.info/sct", code: "4834000" }] },
      clinicalStatus: { coding: [{ code: "active" }] } } },
  ],
});

/** The composition root builds its own deps from env, so the harness is an env plus a socket. */
async function setup(over) {
  const o = over || {};
  const db = makeAbdmDb({
    connect_membership: [{ user_id: ACTOR, tenant_id: TENANT, role: "clinician" }],
    connect_tenant: [{ id: TENANT, mode: "live", granted_scopes: '["Condition","MedicationStatement","Observation","DocumentReference"]' }],
  });
  const r2 = makeR2(), kv = makeMockKv();
  const env = {
    CONNECT_FLAG: "1",
    CONNECT_DB: db, CONNECT_R2: r2, MAIK_KV: kv,
    CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64"),
    CONNECT_MASTER_KEY: Buffer.alloc(32, 9).toString("base64"),
    ABDM_JWKS_URL: "https://healthidsbx.abdm.gov.in/certs",
    CONNECT_ABDM_DATA_PUSH_URL: "https://stewardmd.in/api/connect/abdm/hiu/data",
    ABDM_CLIENT_ID: "hiu-client", ABDM_CLIENT_SECRET: "hiu-secret",
    ...(o.noGateway ? {} : { ABDM_GATEWAY_URL: "https://dev.abdm.gov.in", ABDM_HIU_ID: "SMD-HIU-1" }),
  };

  /* The webhooks go through the REAL route, so the artifact-fetch and consume-and-land wiring under
   * test is the composition root's own rather than something this file assembled. */
  const mock = await makeHiuMockGateway({
    /* `deps` is only what the mock needs for the ONE state effect the ingress has no branch for
     * (attaching the transaction id at on-request); every webhook still goes through the real route. */
    env, deps: { db }, tenantId: TENANT, now: () => new Date().toISOString(),
    handleIngress: (e, _d, request) => onRequest({ request, env }),
  });

  /* THE SOCKET, and nothing above it. The real gateway client mints its session token, sets its own
   * REQUEST-ID and TIMESTAMP headers and posts real JSON; this answers as the CM would and hands the
   * body to the mock's state machine, which is what mints the consentId and captures our keyMaterial. */
  const seen = [];
  const byPath = Object.fromEntries(Object.entries(ENDPOINTS).map(([k, v]) => [v, k]));
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.host === "healthidsbx.abdm.gov.in") return mock.jwksFetch();
    let body = null; try { body = init && init.body ? JSON.parse(init.body) : null; } catch { body = null; }
    seen.push({ path: u.pathname, headers: (init && init.headers) || {}, body });
    if (u.pathname === ENDPOINTS.sessions) return json({ accessToken: "gw-token", expiresIn: 600 }, 200);
    const key = byPath[u.pathname];
    if (!key) return json({ error: "unknown endpoint" }, 404);
    if (o.gatewayRefuses && key === o.gatewayRefuses) return json({ error: "refused" }, 400);
    const out = await mock.gateway.post(key, body);
    return json(out.body || {}, out.status);
  };
  return { env, db, r2, kv, mock, seen };
}
const json = (obj, status) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj),
  headers: { get: () => null }, clone() { return this; } });

const post = (env, path, body, email) => onRequest({
  request: new Request("https://x/api/connect" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(email === null ? {} : { "Cf-Access-Authenticated-User-Email": email || EMAIL }) },
    body: JSON.stringify(body || {}),
  }),
  env,
});
const read = async (res) => { const j = await res.json().catch(() => ({})); j.__status = res.status; return j; };

const consentBody = (over) => ({ tenantId: TENANT, abhaAddress: ABHA, purpose: SCOPE.purpose, hiTypes: SCOPE.hiTypes,
  dateRange: SCOPE.dateRange, dataEraseAt: SCOPE.dataEraseAt, ...(over || {}) });
const dataBody = (consentId, over) => ({ tenantId: TENANT, consentId, careContexts: SCOPE.careContexts,
  hiTypes: SCOPE.hiTypes, purpose: SCOPE.purpose, dateRange: SCOPE.dateRange, ...(over || {}) });

const called = (mock, key) => mock.calls.filter((c) => c.endpointKey === key);

/* ---- 1: the whole loop, through the real doors ---------------------------------------------------- */

test("1. a hospital can now ASK: consent request -> grant -> artifact fetched automatically -> data request -> the transfer is decrypted and acknowledged", async () => {
  const h = await setup();

  // (a) The door that did not exist. It reaches the gateway through the real client.
  const c = await read(await post(h.env, "/abdm/hiu/consent-request", consentBody()));
  assert.equal(c.__status, 200, JSON.stringify(c));
  assert.equal(c.status, "INITIATED");
  assert.ok(c.requestId, "the caller is given the correlation id to follow this consent by");
  assert.equal(called(h.mock, "consentInit").length, 1, "the consent request really reached the gateway");
  assert.ok(h.seen.some((r) => r.path === ENDPOINTS.sessions), "and it authenticated first, through the real gateway client");

  // The lifecycle row exists, under this hospital and this clinician, with the ABHA hashed.
  const row = await getConsentReq(h.db, c.requestId);
  assert.ok(row, "a consent request row was written");
  assert.equal(row.tenant_id, TENANT);
  assert.equal(row.actor, ACTOR, "the actor is server-derived, never taken from the body");
  assert.equal(row.status, "INITIATED");
  assert.ok(row.patient_abha_hash && row.patient_abha_hash !== ABHA, "the raw ABHA never reaches storage");

  // (b) The patient grants it. The artifact fetch is the protocol's own next step, and it happens.
  assert.equal((await h.mock.fireConsentNotify()).status, 202);
  assert.equal(called(h.mock, "consentFetch").length, 1, "the signed artifact was asked for automatically - nobody pressed a button");

  // (c) The CM delivers the signed artifact; its scope is verified and persisted.
  assert.equal((await h.mock.fireOnFetch(SCOPE)).status, 202);

  // (d) The second door that did not exist.
  const d = await read(await post(h.env, "/abdm/hiu/data-request", dataBody(h.mock.consentId)));
  assert.equal(d.__status, 200, JSON.stringify(d));
  assert.equal(d.status, "REQUESTED");
  const hiReq = called(h.mock, "hiRequest");
  assert.equal(hiReq.length, 1, "the data request really reached the gateway");
  const txn = await getTxnByRequestId(h.db, d.requestId);
  assert.ok(txn, "a transaction row was written, keyed by the data-request id");
  /* The private half of the key minted for THIS transfer is stored SEALED with the deployment's
   * master key - never the raw scalar, which is the one secret that could decrypt the patient's
   * records off the wire. */
  assert.ok(txn.eph_privkey_sealed, "the ephemeral private key is stored");
  assert.notEqual(txn.eph_privkey_sealed, txn.eph_pub_raw);
  assert.ok(txn.eph_privkey_sealed.length > 40, "and it is sealed rather than the bare 32-byte scalar");

  /* (e) The HIP answers. The push goes through the real ingress, and the composition root's own
   * consume tail joins it, decrypts it with the key minted at step (d) and acknowledges the HIP.
   *
   * WHAT THIS ASSERTION STOPS AT, and why. The ack is the proof that the transfer was really
   * consumed by the wiring under test: consumeTransfer claims it only after every entry has been
   * decrypted and checksum-verified with our own sealed key. The FILING of those documents onto the
   * chart is the step after it, and the route builds its record store from the deployment's D1
   * binding - so it cannot be observed from here without handing production a test-only seam. That
   * step is proven end to end, through the same real ingress, in wardsynq-abdm-landing.test.mjs. */
  await h.mock.fireOnRequest();
  assert.equal((await h.mock.firePush({ docs: [ndhmDoc()] })).status, 202);
  assert.equal(h.mock.acks.length, 1, "the transfer this hospital ASKED FOR was decrypted and acknowledged exactly once");
  assert.equal(h.mock.acks[0].transactionId, h.mock.transactionId, "and acknowledged under the transaction it started");
});

/* ---- 2: the doors refuse what cannot work --------------------------------------------------------- */

test("2. a consent that could never be USED is refused at the door, and nothing is asked of the gateway", async () => {
  const h = await setup();
  for (const [over, code] of [
    [{ abhaAddress: "" }, "abha_address_required"],
    [{ purpose: null }, "purpose_required"],
    [{ hiTypes: [] }, "hi_types_required"],
    [{ dateRange: null }, "date_range_required"],
    [{ dataEraseAt: null }, "data_erase_at_required"],
  ]) {
    const r = await read(await post(h.env, "/abdm/hiu/consent-request", consentBody(over)));
    assert.equal(r.__status, 422, JSON.stringify(r));
    assert.equal(r.error, code);
  }
  assert.equal(called(h.mock, "consentInit").length, 0, "not one of them reached the gateway");
  assert.equal(h.seen.length, 0, "nothing was sent at all");
});

test("3. a caller who is not a member of that hospital is refused before any gateway call or any write", async () => {
  const h = await setup();
  const r = await read(await post(h.env, "/abdm/hiu/consent-request", consentBody(), OUTSIDER));
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(called(h.mock, "consentInit").length, 0, "an outsider's request never reached the gateway");
  assert.equal((h.db._tables.connect_abdm_consent_req || []).length, 0, "and wrote nothing");
});

test("4. a gateway that does not accept is an UPSTREAM failure, and no consent row is written", async () => {
  const h = await setup({ gatewayRefuses: "consentInit" });
  const r = await read(await post(h.env, "/abdm/hiu/consent-request", consentBody()));
  assert.equal(r.__status, 502, JSON.stringify(r), "not 400: the caller got its own request right");
  assert.equal(r.error, "abdm");
  assert.equal((h.db._tables.connect_abdm_consent_req || []).length, 0, "fail-closed: nothing was persisted");
});

test("5. with no gateway configured the doors are not there at all", async () => {
  const h = await setup({ noGateway: true });
  assert.equal((await read(await post(h.env, "/abdm/hiu/consent-request", consentBody()))).__status, 404);
  assert.equal((await read(await post(h.env, "/abdm/hiu/data-request", dataBody("consent-x")))).__status, 404);
});

/* ---- 6: the data request is bound to the consent -------------------------------------------------- */

test("6. a data request before the consent is granted is refused, and mints no key and no transaction", async () => {
  const h = await setup();
  const c = await read(await post(h.env, "/abdm/hiu/consent-request", consentBody()));
  // The consent exists but is only INITIATED: no grant, no verified scope.
  const r = await read(await post(h.env, "/abdm/hiu/data-request", dataBody("consent-" + c.requestId)));
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(called(h.mock, "hiRequest").length, 0, "nothing was asked of the HIP");
  assert.equal((h.db._tables.connect_abdm_txn || []).length, 0, "and no ephemeral key was minted or stored");
});

test("7. a data request for a care context the patient did not consent to is refused", async () => {
  const h = await setup();
  await post(h.env, "/abdm/hiu/consent-request", consentBody());
  await h.mock.fireConsentNotify();
  await h.mock.fireOnFetch(SCOPE);
  const r = await read(await post(h.env, "/abdm/hiu/data-request", dataBody(h.mock.consentId, { careContexts: ["cc-0", "cc-SOMEBODY-ELSE"] })));
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(called(h.mock, "hiRequest").length, 0);
});

test("8. the window actually asked of the HIP is CLAMPED to the window the patient granted", async () => {
  const h = await setup();
  await post(h.env, "/abdm/hiu/consent-request", consentBody());
  await h.mock.fireConsentNotify();
  await h.mock.fireOnFetch(SCOPE);

  // The caller asks for two years. The consent covers six weeks.
  const r = await read(await post(h.env, "/abdm/hiu/data-request",
    dataBody(h.mock.consentId, { dateRange: { from: iso(T0 - 2000 * DAY), to: iso(T0 + 2000 * DAY) } })));
  assert.equal(r.__status, 200, JSON.stringify(r));
  const sent = called(h.mock, "hiRequest")[0].body.hiRequest.dateRange;
  assert.deepEqual(sent, SCOPE.dateRange, "the HIP is asked for exactly what was consented, not what was requested");

  /* And a request that names NO window means "everything consented" - which is the consented window
   * itself, never an unbounded ask. */
  const h2 = await setup();
  await post(h2.env, "/abdm/hiu/consent-request", consentBody());
  await h2.mock.fireConsentNotify();
  await h2.mock.fireOnFetch(SCOPE);
  const r2 = await read(await post(h2.env, "/abdm/hiu/data-request", dataBody(h2.mock.consentId, { dateRange: undefined })));
  assert.equal(r2.__status, 200, JSON.stringify(r2));
  assert.deepEqual(called(h2.mock, "hiRequest")[0].body.hiRequest.dateRange, SCOPE.dateRange);
});

test("9. a window entirely outside the consented one is refused rather than sent as an empty ask", async () => {
  const h = await setup();
  await post(h.env, "/abdm/hiu/consent-request", consentBody());
  await h.mock.fireConsentNotify();
  await h.mock.fireOnFetch(SCOPE);
  const r = await read(await post(h.env, "/abdm/hiu/data-request",
    dataBody(h.mock.consentId, { dateRange: { from: iso(T0 - 900 * DAY), to: iso(T0 - 800 * DAY) } })));
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.equal(called(h.mock, "hiRequest").length, 0);
});

test("10. a data request missing what the consent gate compares against is named, not generically refused", async () => {
  const h = await setup();
  for (const [over, code] of [
    [{ consentId: undefined }, "consent_id_required"],
    [{ careContexts: [] }, "care_contexts_required"],
    [{ hiTypes: [] }, "hi_types_required"],
    [{ purpose: null }, "purpose_required"],
  ]) {
    const r = await read(await post(h.env, "/abdm/hiu/data-request", dataBody("consent-x", over)));
    assert.equal(r.__status, 422, JSON.stringify(r));
    assert.equal(r.error, code);
  }
  assert.equal(called(h.mock, "hiRequest").length, 0);
});

/* ---- 11: what must never leak --------------------------------------------------------------------- */

test("11. the raw ABHA goes to the gateway and nowhere else", async () => {
  const h = await setup();
  const c = await read(await post(h.env, "/abdm/hiu/consent-request", consentBody()));
  assert.ok(!JSON.stringify(c).includes(ABHA), "it is not echoed back to the caller");
  const stored = JSON.stringify(h.db._tables);
  assert.ok(!stored.includes(ABHA), "it is not in the database");
  const toGateway = h.seen.filter((r) => r.path === ENDPOINTS.consentInit);
  assert.equal(toGateway.length, 1);
  assert.ok(JSON.stringify(toGateway[0].body).includes(ABHA), "the one place it appears is the POST body to the gateway, which is the point of the call");
});
