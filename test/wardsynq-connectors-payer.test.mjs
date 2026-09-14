/* test/wardsynq-connectors-payer.test.mjs - owner S4: payers and TPAs as per-hospital connectors.
 *
 * One mocked-fetch contract test per payer adapter (fhir-claim, nhcx, manual), and the real routes:
 * POST /api/queue/ward/connector-save (kind payer), GET /api/queue/ward/connectors,
 * POST /api/queue/ward/claim-state and GET /api/queue/ward/claims reading the connector registry.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-connectors-payer.test.mjs
 */
import { as, seed, H, ENV, T, ORG_ID, ADMIN, NURSE, HR, CASHIER, DOCTOR, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { buildNhcxEnvelope, NhcxAdapter, NHCX_MISSING } = await import("../wardsynq/wardsynq-nhcx-adapter.js");
const { FhirClaimAdapter } = await import("../wardsynq/wardsynq-fhir-claim-adapter.js");
const { adapterForPayer, submitViaAdapter } = await import("../wardsynq/wardsynq-tpa-adapter.js");
const { payersFromConnectors, mergePayers } = await import("../functions/_wardsynq/payer-connectors.js");
const { CONNECTOR_TYPE } = await import("../functions/_wardsynq/connectors.js");

const ENDPOINT = "https://93.184.216.34/fhir/Claim";
const TOKEN = "payer-token-must-never-leak-000001";
const CLAIM = { id: "c1", patientId: "pat-1", encounterId: "enc-1", submittedAmount: 15000, codes: [{ code: "I10" }] };

/* ---- contract: one per adapter ------------------------------------------------------------------- */

test("contract fhir-claim: POSTs a FHIR Claim with the opened credential and maps the ClaimResponse", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ resourceType: "ClaimResponse", id: "CR-1", outcome: "queued" }), { status: 201 }); };
  const payer = { id: "star", name: "Star", adapter: "fhir-claim", endpoint: ENDPOINT, auth: { type: "bearer" } };
  const out = await submitViaAdapter(CLAIM, FhirClaimAdapter(payer, { fetch: fetchImpl, authorize: async () => ({ authorization: `Bearer ${TOKEN}` }) }), { use: "claim" });
  assert.equal(out.state, "acknowledged");
  assert.equal(out.payerReference, "CR-1");
  assert.equal(seen[0].url, ENDPOINT);
  assert.equal(seen[0].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(JSON.parse(seen[0].init.body).resourceType, "Claim");
});

test("contract nhcx: builds the verified HCX envelope shape and sends NOTHING, saying exactly what is missing", async () => {
  const payer = { id: "nhcx-icici", name: "ICICI via NHCX", senderCode: "1000-hosp", recipientCode: "2000-payer" };
  const env = buildNhcxEnvelope(CLAIM, payer, { use: "claim", now: "2026-09-14T10:00:00Z" });
  assert.equal(env.path, "/claim/submit");
  assert.equal(env.protectedHeader.alg, "RSA-OAEP");
  assert.equal(env.protectedHeader.enc, "A256GCM");
  for (const h of ["x-hcx-sender_code", "x-hcx-recipient_code", "x-hcx-api_call_id", "x-hcx-correlation_id", "x-hcx-timestamp"]) assert.ok(env.protectedHeader[h], h);
  assert.equal(env.bundle.resourceType, "Bundle");
  assert.equal(env.bundle.type, "collection");
  assert.equal(env.bundle.entry[0].resource.resourceType, "Claim");
  assert.equal(buildNhcxEnvelope(CLAIM, payer, { use: "preauthorization" }).path, "/preauth/submit");

  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response("{}"); };
  const { adapter } = adapterForPayer([{ ...payer, adapter: "nhcx" }], "nhcx-icici", { nhcx: (p) => NhcxAdapter(p, { fetch: fetchImpl }) });
  const out = await submitViaAdapter(CLAIM, adapter, { use: "claim" });
  assert.equal(out.state, "not_configured", "never 'sent'");
  assert.equal(calls, 0, "nothing reaches the network");
  for (const m of NHCX_MISSING) assert.ok(out.note.includes(m), m);
  const bare = await NhcxAdapter({ id: "x" }).submit(CLAIM, {});
  assert.match(bare.note, /Missing configuration: x-hcx-sender_code, x-hcx-recipient_code/);
});

test("contract manual: queued for the hospital's own process, nothing sent", async () => {
  let calls = 0;
  const { adapter } = adapterForPayer([{ id: "paper", adapter: "manual" }], "paper", {}, { fetch: async () => { calls++; } });
  const out = await submitViaAdapter(CLAIM, adapter, {});
  assert.equal(out.state, "queued");
  assert.equal(calls, 0);
});

test("registry: connector payers keep the credential sealed and shadow an org payer with the same id", () => {
  const recs = [
    { kind: "payer", provider: "fhir-claim", active: true, name: "Star Health", settings: { ref: "star", endpoint: ENDPOINT, authType: "header", headerName: "X-Api-Key", timelyFilingDays: "30" }, secretsEnc: { token: "SEALED" } },
    { kind: "payer", provider: "manual", active: false, settings: { ref: "off" } },
  ];
  const payers = payersFromConnectors(recs);
  assert.equal(payers.length, 1, "a turned-off connector is not a payer");
  assert.deepEqual(payers[0].auth, { type: "header", headerName: "X-Api-Key", connectorSecret: "SEALED" });
  assert.deepEqual(payers[0].rules, { timelyFilingDays: 30 });
  const merged = mergePayers(payers, [{ id: "star", adapter: "manual" }, { id: "legacy", adapter: "manual" }]);
  assert.deepEqual(merged.map((p) => [p.id, p.adapter]), [["star", "fhir-claim"], ["legacy", "manual"]]);
});

/* ---- routes ----------------------------------------------------------------------------------------- */

const PAYER = { kind: "payer", provider: "fhir-claim", name: "Star Health", settings: { ref: "star", endpoint: ENDPOINT, authType: "bearer", currency: "INR" }, secrets: { token: TOKEN } };
const savePayer = (who, over) => as(who, "/ward/connector-save", "POST", { orgId: ORG_ID, ...PAYER, ...(over || {}) });

test("negative authorization for payer connectors: no session 401, hr and nurse 403 with nothing written, another hospital 403", async () => {
  seed();
  const before = writesNow();
  assert.equal((await savePayer(null)).__status, 401);
  for (const who of [HR, NURSE, CASHIER]) assert.equal((await savePayer(who)).__status, 403, who);
  assert.equal((await savePayer(OTHER_ADMIN)).__status, 403);
  assert.equal(writesNow(), before);
});

test("a saved payer connector submits claims with its sealed token, and the claims screen never sees the token", async () => {
  seed({ payers: [{ id: "star", name: "Old entry", adapter: "manual" }] });
  const saved = await savePayer(ADMIN);
  assert.equal(saved.__status, 200, saved.__text);
  assert.equal(saved.connector.id, "payer-star");
  assert.ok(!saved.__text.includes(TOKEN));
  assert.ok(!(await H.RECORD.latest(T, CONNECTOR_TYPE, "payer-star")).secretsEnc.token.includes(TOKEN));
  assert.equal(H.RECORD.audit.filter((a) => a.action === "connector.create" && a.scope.kind === "payer").length, 1);

  const seen = [];
  ENV.WSQ_TPA_FETCH = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ resourceType: "ClaimResponse", id: "CR-77", outcome: "queued" }), { status: 200 }); };
  try {
    const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name: "Payer Connector Person", mobile: "9876500022", gender: "male", ageYears: 61 });
    const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: "2" });
    await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG_ID, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "I10", display: "Essential hypertension" } });
    const claim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG_ID, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "star" });
    assert.equal(claim.__status, 200, claim.__text);
    const sub = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG_ID, claimId: claim.claimId, action: "submit", submittedAmount: 15000 });
    assert.equal(sub.__status, 200, sub.__text);
    assert.equal(sub.claim.adapter.state, "acknowledged", "the connector's fhir-claim adapter, not the shadowed manual org entry");
    assert.equal(sub.claim.payerReference, "CR-77");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].init.headers.authorization, `Bearer ${TOKEN}`, "the sealed token opened at send time");
    assert.ok(!sub.__text.includes(TOKEN));

    const claims = await as(CASHIER, `/ward/claims?orgId=${ORG_ID}&patientId=${adm.patientId}`);
    assert.equal(claims.__status, 200, claims.__text);
    const star = claims.payers.find((p) => p.id === "star");
    assert.equal(star.adapter, "fhir-claim");
    assert.equal(star.credentialConfigured, true);
    assert.ok(!claims.__text.includes(TOKEN) && !claims.__text.includes("connectorSecret"), "neither the token nor its seal reaches the claims screen");

    // Turned off: the org entry answers again, and it says it is manual.
    const off = await savePayer(ADMIN, { secrets: undefined, active: false });
    assert.equal(off.__status, 200, off.__text);
    const claim2 = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG_ID, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "star", now: "2026-09-14T11:00:00Z" });
    const sub2 = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG_ID, claimId: claim2.claimId, action: "submit", submittedAmount: 100 });
    assert.equal(sub2.claim.adapter.state, "queued");
    assert.equal(seen.length, 1, "nothing more was sent");
  } finally { delete ENV.WSQ_TPA_FETCH; }
});

test("payer connector refusals: a named header without a name, a bad currency, a private endpoint, and a missing token write nothing", async () => {
  seed();
  const before = writesNow();
  const noHeader = await savePayer(ADMIN, { settings: { ...PAYER.settings, authType: "header" } });
  assert.equal(noHeader.__status, 422); assert.match(noHeader.message, /header needs its name/);
  const cur = await savePayer(ADMIN, { settings: { ...PAYER.settings, currency: "rupees" } });
  assert.equal(cur.__status, 422);
  const inside = await savePayer(ADMIN, { settings: { ...PAYER.settings, endpoint: "https://192.168.1.10/claim" } });
  assert.equal(inside.__status, 422); assert.equal(inside.error, "url_refused");
  const noTok = await savePayer(ADMIN, { secrets: undefined });
  assert.equal(noTok.__status, 422); assert.match(noTok.message, /needs the token/);
  const noRef = await savePayer(ADMIN, { settings: { ...PAYER.settings, ref: "" } });
  assert.equal(noRef.__status, 422);
  assert.equal(writesNow(), before);
});

test("an nhcx payer can be saved and a claim to it records not_configured with the missing pieces", async () => {
  seed();
  const saved = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "payer", provider: "nhcx", name: "ICICI Lombard",
    settings: { ref: "icici", gatewayUrl: "https://93.184.216.40/hcx", senderCode: "1000-hosp", recipientCode: "2000-icici" } });
  assert.equal(saved.__status, 200, saved.__text);
  const list = await as(ADMIN, `/ward/connectors?orgId=${ORG_ID}&kind=payer`);
  assert.deepEqual(list.catalogue.map((k) => k.kind), ["payer"]);
  assert.deepEqual(list.catalogue[0].providers.map((p) => p.id), ["fhir-claim", "nhcx", "manual"]);
  let calls = 0;
  ENV.WSQ_TPA_FETCH = async () => { calls++; return new Response("{}"); };
  try {
    const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name: "Nhcx Person", mobile: "9876500033", gender: "female", ageYears: 40 });
    const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: "3" });
    await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG_ID, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "I10", display: "Essential hypertension" } });
    const claim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG_ID, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "icici" });
    const sub = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG_ID, claimId: claim.claimId, action: "submit", submittedAmount: 900 });
    assert.equal(sub.__status, 200, sub.__text);
    assert.equal(sub.claim.adapter.state, "not_configured");
    assert.match(sub.claim.adapter.note, /JWE encryption/);
    assert.equal(calls, 0);
  } finally { delete ENV.WSQ_TPA_FETCH; }
});
