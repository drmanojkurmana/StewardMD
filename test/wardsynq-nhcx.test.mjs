/* test/wardsynq-nhcx.test.mjs - owner S4, gap-claims-gst A: the NHCX adapter sends for real, and only a verified
 * payer answer changes a record.
 *
 * Contract (mocked fetch, shapes from openapi_hcx.yaml and the NRCeS NHCX profiles, see wardsynq-nhcx-adapter.js):
 * the token call, the protocol call's path and headers, the JWE protected header, and the decrypted bundle's profile
 * and mandatory elements. Keys and certificates are made fresh per run with WebCrypto; nothing secret is committed.
 *
 * Routes: POST /api/queue/ward/connector-save (nhcx), POST /api/queue/ward/connector-test,
 * POST /api/queue/ward/claim-state (submit), POST /api/queue/ward/preauth (requested),
 * POST /api/queue/ward/nhcx-eligibility, POST /api/queue/ward/hcx-status, GET /api/queue/ward/claims,
 * POST /api/queue/nhcx-callback/<orgId>/<resource>/<action>.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-nhcx.test.mjs
 */
import { as, seed, H, ENV, T, ORG_ID, OTHER, ADMIN, NURSE, CASHIER, DOCTOR, OTHER_ADMIN, writesNow, withFetch } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";

const A = await import("../wardsynq/wardsynq-nhcx-adapter.js");
const { EXCHANGE_TYPE, ELIGIBILITY_TYPE } = await import("../functions/_wardsynq/nhcx.js");
const { submitViaAdapter } = await import("../wardsynq/wardsynq-tpa-adapter.js");

const subtle = crypto.subtle;

/* ---- a real X.509 structure around a WebCrypto key (RFC 5280), so the DER walk meets what Node accepts ---- */
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const len = (n) => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]);
const tlv = (tag, ...parts) => { const body = cat(...parts); return cat(new Uint8Array([tag, ...len(body.length)]), body); };
const u8 = (a) => new Uint8Array(a);
const SHA256_RSA = tlv(0x30, u8([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b, 0x05, 0x00]));
const nameOf = (cn) => tlv(0x30, tlv(0x31, tlv(0x30, u8([0x06, 0x03, 0x55, 0x04, 0x03]), tlv(0x0c, new TextEncoder().encode(cn)))));
const pem = (label, der) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;
async function certFor(publicKey, cn) {
  const spki = u8(await subtle.exportKey("spki", publicKey));
  const validity = tlv(0x30, tlv(0x17, new TextEncoder().encode("260101000000Z")), tlv(0x17, new TextEncoder().encode("360101000000Z")));
  const tbs = tlv(0x30, tlv(0xa0, tlv(0x02, u8([2]))), tlv(0x02, u8([1])), SHA256_RSA, nameOf(cn), validity, nameOf(cn), spki);
  const signer = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: u8([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const sig = u8(await subtle.sign("RSASSA-PKCS1-v1_5", signer.privateKey, tbs));
  return { pem: pem("CERTIFICATE", tlv(0x30, tbs, SHA256_RSA, tlv(0x03, u8([0]), sig))), spki };
}
const oaepPair = () => subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: u8([1, 0, 1]), hash: "SHA-1" }, true, ["encrypt", "decrypt"]);
const signPair = () => subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: u8([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);

const payerKeys = await oaepPair(), hospKeys = await oaepPair(), gatewayKeys = await signPair(), rogueKeys = await signPair();
const PAYER_CERT = await certFor(payerKeys.publicKey, "payer"), HOSP_CERT = await certFor(hospKeys.publicKey, "hospital");
const GATEWAY_CERT = await certFor(gatewayKeys.publicKey, "gateway");
const HOSP_PRIVATE = pem("PRIVATE KEY", u8(await subtle.exportKey("pkcs8", hospKeys.privateKey))); // security-scan: allow key generated at test runtime, never committed

async function jwt(keys, claims) {
  const b64 = (o) => A.b64uEncode(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
  return `${input}.${A.b64uEncode(u8(await subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input))))}`;
}
const nowS = () => Math.floor(Date.now() / 1000);
const goodClaims = () => ({ jti: crypto.randomUUID(), iss: "nhcx-gateway", sub: "2000-icici", iat: nowS(), exp: nowS() + 300 });

const GATEWAY = "https://93.184.216.40/api/v0.8";
const SETTINGS = { ref: "icici", gatewayUrl: GATEWAY, senderCode: "1000-hosp", recipientCode: "2000-icici", username: "billing@hosp.test", providerName: "WSQ Ward Hospital" };
const SECRETS = { secret: "nhcx-participant-secret-0001", encryptionCert: PAYER_CERT.pem.replace(/\n/g, ""), signingCert: GATEWAY_CERT.pem, privateKey: HOSP_PRIVATE };

/** A gateway: token, then 202 for any protocol path. Records each call. */
function gateway(seen, over) {
  return async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith("/participant/auth/token/generate")) return new Response(JSON.stringify({ access_token: "gw-access-token", expires_in: 6000 }), { status: 200 });
    if (over) { const r = await over(url, init); if (r) return r; }
    const hdr = A.peekJweHeader(JSON.parse(init.body).payload);
    return new Response(JSON.stringify({ timestamp: "1629057611000", api_call_id: hdr["x-hcx-api_call_id"], correlation_id: hdr["x-hcx-correlation_id"] }), { status: 202 });
  };
}

/* ---- unit contract ---------------------------------------------------------------------------------- */

test("the DER walk takes the SubjectPublicKeyInfo Node itself reads from the certificate, pasted with or without newlines", async () => {
  const x = new X509Certificate(PAYER_CERT.pem);
  const nodeSpki = x.publicKey.export({ type: "spki", format: "der" });
  assert.deepEqual(Buffer.from(A.spkiFromPem(PAYER_CERT.pem)), nodeSpki);
  assert.deepEqual(Buffer.from(A.spkiFromPem(PAYER_CERT.pem.replace(/\n/g, ""))), nodeSpki, "a password field drops newlines");
  assert.throws(() => A.spkiFromPem("not a pem"));
  assert.throws(() => A.spkiFromPem(HOSP_PRIVATE), /not a certificate/);
});

test("JWE compact: RSA-OAEP + A256GCM round trip, protected header authenticated, tampering refused", async () => {
  const jwe = await A.encryptJwe({ "x-hcx-correlation_id": "c-1" }, { resourceType: "Bundle" }, await A.importEncryptionKey(HOSP_CERT.pem));
  assert.equal(jwe.split(".").length, 5);
  const key = await A.importDecryptionKey(HOSP_PRIVATE);
  const out = await A.decryptJwe(jwe, key);
  assert.deepEqual(out.header, { "x-hcx-correlation_id": "c-1", alg: "RSA-OAEP", enc: "A256GCM" });
  assert.deepEqual(out.payload, { resourceType: "Bundle" });
  const parts = jwe.split(".");
  const forged = A.b64uEncode(new TextEncoder().encode(JSON.stringify({ ...out.header, "x-hcx-correlation_id": "c-2" })));
  await assert.rejects(A.decryptJwe([forged, ...parts.slice(1)].join("."), key), "a changed header fails the GCM tag");
  await assert.rejects(A.decryptJwe(jwe, (await oaepPair()).privateKey), "another key cannot open it");
});

test("RS256 bearer: good, bad signature, expired, future iat, wrong algorithm", async () => {
  assert.equal((await A.verifyJwtRs256(await jwt(gatewayKeys, goodClaims()), GATEWAY_CERT.pem)).ok, true);
  assert.equal((await A.verifyJwtRs256(await jwt(rogueKeys, goodClaims()), GATEWAY_CERT.pem)).reason, "signature");
  assert.equal((await A.verifyJwtRs256(await jwt(gatewayKeys, { ...goodClaims(), exp: nowS() - 3600 }), GATEWAY_CERT.pem)).reason, "expired");
  assert.equal((await A.verifyJwtRs256(await jwt(gatewayKeys, { ...goodClaims(), iat: nowS() + 3600 }), GATEWAY_CERT.pem)).reason, "issued_in_future");
  const none = `${A.b64uEncode(new TextEncoder().encode('{"alg":"none"}'))}.${A.b64uEncode(new TextEncoder().encode("{}"))}.`;
  assert.equal((await A.verifyJwtRs256(none, GATEWAY_CERT.pem)).reason, "algorithm");
});

const PAYER = { id: "icici", name: "ICICI Lombard", adapter: "nhcx", endpoint: GATEWAY, senderCode: "1000-hosp", recipientCode: "2000-icici", username: "billing@hosp.test", providerName: "WSQ Ward Hospital", connectorId: "payer-icici" };
const CLAIM = { id: "claim-1", patientId: "pat-1", encounterId: "enc-1", submittedAmount: 15000, policyNumber: "POL-9", codes: [{ code: "I10" }], dischargedAt: "2026-09-15T10:00:00Z" };

test("contract nhcx submit: token, then POST /claim/submit with the JWE; the decrypted ClaimBundle carries the profiles and every mandatory element; 202 is sent, never acknowledged", async () => {
  const seen = [], before = [];
  const adapter = A.NhcxAdapter(PAYER, { fetch: gateway(seen), openSecrets: async () => SECRETS, beforeSend: async (ex, ctx) => { before.push({ ex, ctx, callsSoFar: seen.length }); } });
  const out = await submitViaAdapter(CLAIM, adapter, { use: "claim" });
  assert.equal(out.state, "sent");
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, `${GATEWAY}/participant/auth/token/generate`);
  assert.equal(seen[0].init.headers["content-type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(seen[0].init.body)), { username: "billing@hosp.test", participant_code: "1000-hosp", secret: "nhcx-participant-secret-0001" });
  assert.equal(seen[1].url, `${GATEWAY}/claim/submit`);
  assert.equal(seen[1].init.method, "POST");
  assert.equal(seen[1].init.headers.authorization, "Bearer gw-access-token");
  assert.equal(seen[1].init.headers["content-type"], "application/json");
  const body = JSON.parse(seen[1].init.body);
  assert.deepEqual(Object.keys(body), ["payload"]);
  assert.equal(before.length, 1, "the correlation record is written before the request leaves");
  assert.equal(before[0].callsSoFar, 1, "after the token, before the protocol call");

  const { header, payload } = await A.decryptJwe(body.payload, payerKeys.privateKey);
  assert.equal(header.alg, "RSA-OAEP"); assert.equal(header.enc, "A256GCM");
  assert.equal(header["x-hcx-sender_code"], "1000-hosp");
  assert.equal(header["x-hcx-recipient_code"], "2000-icici");
  assert.match(header["x-hcx-api_call_id"], /^[0-9a-f-]{36}$/);
  assert.equal(header["x-hcx-correlation_id"], out.exchange.correlationId);
  assert.match(header["x-hcx-timestamp"], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/, "ISO 8601, as the gateway parses it");
  assert.ok(Math.abs(Date.parse(header["x-hcx-timestamp"]) - Date.now()) < 60000, "the moment of sending, not the record's date");

  assert.equal(payload.resourceType, "Bundle");
  assert.equal(payload.type, "collection");
  assert.deepEqual(payload.meta.profile, ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/ClaimBundle"]);
  const claim = payload.entry.find((e) => e.resource.resourceType === "Claim").resource;
  assert.deepEqual(claim.meta.profile, ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Claim"]);
  for (const k of ["identifier", "status", "type", "use", "patient", "created", "insurer", "provider", "priority", "diagnosis", "insurance", "item"]) assert.ok(claim[k] != null && (!Array.isArray(claim[k]) || claim[k].length), k);
  assert.equal(claim.use, "claim");
  assert.equal(claim.type.coding[0].code, "737481003");
  assert.deepEqual(claim.diagnosis[0].diagnosisCodeableConcept.coding[0].code, "I10");
  assert.equal(claim.diagnosis[0].type[0].coding[0].code, "89100005", "final diagnosis because the record has a discharge");
  assert.deepEqual(claim.insurance[0], { sequence: 1, focal: true, coverage: { reference: "Coverage/coverage" } });
  const byRef = (r) => payload.entry.find((e) => e.fullUrl === r.reference).resource;
  assert.equal(byRef(claim.insurance[0].coverage).subscriberId, "POL-9");
  assert.equal(byRef(claim.insurer).identifier[0].value, "2000-icici");
  assert.equal(byRef(claim.provider).identifier[0].value, "1000-hosp");
  assert.equal(byRef(claim.patient).resourceType, "Patient");
  assert.ok(!JSON.stringify(payload).includes("name\":\"Nhcx"), "no patient name travels");
  assert.ok(claim.item[0].productOrService);

  // pre-authorisation goes to /preauth/submit with use preauthorization
  const seen2 = [];
  const pre = await A.NhcxAdapter(PAYER, { fetch: gateway(seen2), openSecrets: async () => SECRETS })
    .submit({ id: "pa-1", patientId: "pat-1", treatment: "PTCA", requestedAmount: 50000, policyNumber: "POL-9", codes: [{ code: "I21.9" }] }, { use: "preauthorization" });
  assert.equal(pre.state, "sent");
  assert.equal(seen2[1].url, `${GATEWAY}/preauth/submit`);
  const preBundle = (await A.decryptJwe(JSON.parse(seen2[1].init.body).payload, payerKeys.privateKey)).payload;
  assert.equal(preBundle.entry[0].resource.use, "preauthorization");
  assert.equal(preBundle.entry[0].resource.diagnosis[0].type[0].coding[0].code, "148006");
});

test("contract nhcx refusals: missing configuration is not_configured naming each piece, a record without a mandatory element sends nothing, a non-202 is failed", async () => {
  let calls = 0;
  const count = async () => { calls++; return new Response("{}", { status: 500 }); };
  const bare = await A.NhcxAdapter({ id: "x", adapter: "nhcx" }, { fetch: count, openSecrets: async () => ({}) }).submit(CLAIM, {});
  assert.equal(bare.state, "not_configured");
  for (const m of ["the NHCX gateway URL", "this hospital's participant code", "the payer's participant code", "the NHCX user name", "the NHCX participant secret", "the payer's encryption certificate"]) assert.ok(bare.note.includes(m), m);
  const noDx = await A.NhcxAdapter(PAYER, { fetch: count, openSecrets: async () => SECRETS }).submit({ ...CLAIM, codes: [], policyNumber: "" }, {});
  assert.equal(noDx.state, "failed");
  assert.match(noDx.note, /diagnosis code \(Claim.diagnosis\), the policy number/);
  assert.equal(calls, 0, "nothing reached the network for either");
  const seen = [];
  const refused = await A.NhcxAdapter(PAYER, { fetch: gateway(seen, async (url) => (url.endsWith("/claim/submit") ? new Response(JSON.stringify({ error: { code: "ERR_INVALID_ENCRYPTION", message: "bad payload" } }), { status: 400 }) : null)), openSecrets: async () => SECRETS }).submit(CLAIM, {});
  assert.equal(refused.state, "failed");
  assert.match(refused.note, /HTTP 400\): bad payload/);
  const tokenNo = await A.NhcxAdapter(PAYER, { fetch: async () => new Response("{}", { status: 401 }), openSecrets: async () => SECRETS }).submit(CLAIM, {});
  assert.equal(tokenNo.state, "failed");
  assert.match(tokenNo.note, /refused the token request \(HTTP 401\)\. Nothing was sent/);
});

test("responses: ClaimResponse and CoverageEligibilityResponse are read as the payer stated them", () => {
  const cr = A.parseNhcxResponse({ resourceType: "Bundle", entry: [{ resource: { resourceType: "ClaimResponse", id: "CR-1", outcome: "complete", disposition: "Approved", preAuthRef: "PA-77",
    total: [{ category: { coding: [{ code: "submitted" }] }, amount: { value: 50000 } }, { category: { coding: [{ code: "benefit" }] }, amount: { value: 42000 } }] } }] });
  assert.deepEqual([cr.kind, cr.outcome, cr.preAuthRef, cr.adjudication.approved], ["claim", "complete", "PA-77", 42000]);
  const er = A.parseNhcxResponse({ resourceType: "CoverageEligibilityResponse", outcome: "complete", insurance: [{ inforce: true, item: [{ benefit: [{ type: { text: "benefit" }, allowedMoney: { value: 500000 } }] }] }] });
  assert.deepEqual([er.kind, er.inforce, er.benefits[0].allowed], ["eligibility", true, 500000]);
  assert.equal(A.parseNhcxResponse({ resourceType: "Patient" }).kind, null);
});

/* ---- routes ------------------------------------------------------------------------------------------ */

const saveNhcx = (who, over) => as(who, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "payer", provider: "nhcx", name: "ICICI Lombard", settings: SETTINGS, secrets: SECRETS, ...(over || {}) });

async function admitWithProblem(mobile) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name: "Nhcx Person", mobile, gender: "female", ageYears: 40 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: mobile.slice(-2) });
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG_ID, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "I10", display: "Essential hypertension" } });
  return adm;
}

/** The payer's answer as the gateway delivers it. */
async function answer({ correlationId, resource, sender = "2000-icici", recipient = "1000-hosp", keys = gatewayKeys, claims, apiCallId, status }) {
  const header = { "x-hcx-sender_code": sender, "x-hcx-recipient_code": recipient, "x-hcx-api_call_id": apiCallId || crypto.randomUUID(), "x-hcx-correlation_id": correlationId,
    "x-hcx-timestamp": new Date().toISOString(), ...(status ? { "x-hcx-status": status } : {}) };
  const payload = await A.encryptJwe(header, { resourceType: "Bundle", type: "collection", entry: [{ resource }] }, await A.importEncryptionKey(HOSP_CERT.pem));
  return { body: { payload }, headers: { authorization: `Bearer ${await jwt(keys, claims || goodClaims())}` }, apiCallId: header["x-hcx-api_call_id"] };
}
const deliver = (path, a, org) => as(null, `/nhcx-callback/${org || ORG_ID}/${path}`, "POST", a.body, a.headers);
const claimResponse = (over) => ({ resourceType: "ClaimResponse", id: "CR-9", status: "active", use: "claim", outcome: "complete", disposition: "Adjudicated",
  total: [{ category: { coding: [{ code: "benefit" }] }, amount: { value: 12000, currency: "INR" } }], ...(over || {}) });

test("an nhcx payer connector: saved with its four sealed values (none returned), relabelled, tested by a token call; missing values refused", async () => {
  seed();
  const before = writesNow();
  const partial = await saveNhcx(ADMIN, { secrets: { secret: "x" } });
  assert.equal(partial.__status, 422);
  assert.match(partial.message, /encryption certificate.*signing certificate.*private key/);
  assert.equal(writesNow(), before, "nothing saved");
  const saved = await saveNhcx(ADMIN);
  assert.equal(saved.__status, 200, saved.__text);
  assert.deepEqual(saved.connector.secretsSet, ["encryptionCert", "privateKey", "secret", "signingCert"]);
  assert.ok(!saved.__text.includes("BEGIN") && !saved.__text.includes("nhcx-participant-secret"));
  const list = await as(ADMIN, `/ward/connectors?orgId=${ORG_ID}&kind=payer`);
  const prov = list.catalogue[0].providers.find((p) => p.id === "nhcx");
  assert.equal(prov.label, "NHCX (National Health Claims Exchange)");
  assert.equal(prov.testable, true);
  const seen = [];
  const t = await withFetch(gateway(seen), () => as(ADMIN, "/ward/connector-test", "POST", { orgId: ORG_ID, id: "payer-icici" }));
  assert.equal(t.__status, 200, t.__text);
  assert.equal(t.test.passed, true, t.__text);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${GATEWAY}/participant/auth/token/generate`);
  const bad = await withFetch(async () => new Response("{}", { status: 401 }), () => as(ADMIN, "/ward/connector-test", "POST", { orgId: ORG_ID, id: "payer-icici" }));
  assert.equal(bad.test.passed, false);
});

test("claim to NHCX end to end: submit is sent with a correlation record; only a verified callback acknowledges it; every forged or misaddressed answer changes nothing", async () => {
  seed();
  assert.equal((await saveNhcx(ADMIN)).__status, 200);
  const seen = [];
  ENV.WSQ_TPA_FETCH = gateway(seen);
  try {
    const adm = await admitWithProblem("9876500041");
    const claim = await as(CASHIER, "/ward/claim", "POST", { orgId: ORG_ID, patientId: adm.patientId, encounterId: adm.encounterId, codes: ["I10"], payerId: "icici", policyNumber: "POL-1" });
    assert.equal(claim.__status, 200, claim.__text);
    const sub = await as(CASHIER, "/ward/claim-state", "POST", { orgId: ORG_ID, claimId: claim.claimId, action: "submit", submittedAmount: 15000 });
    assert.equal(sub.__status, 200, sub.__text);
    assert.equal(sub.claim.adapter.state, "sent", "a 202 is sent, never acknowledged");
    const corr = sub.claim.adapter.exchange.correlationId;
    assert.equal(seen.filter((s) => s.url === `${GATEWAY}/claim/submit`).length, 1);
    const ex = await H.RECORD.latest(T, EXCHANGE_TYPE, `nhcx-${corr}`);
    assert.deepEqual([ex.kind, ex.recordType, ex.recordId, ex.connectorId], ["claim", "Claim", claim.claimId, "payer-icici"]);
    assert.ok(!JSON.stringify(ex).includes("POL-1") && !JSON.stringify(ex).includes("I10"), "the correlation record holds ids only");

    const claimNow = async () => (await as(CASHIER, `/ward/claims?orgId=${ORG_ID}&patientId=${adm.patientId}`)).claims.find((c) => c.id === claim.claimId);
    const stateBefore = JSON.stringify(await claimNow());
    const expectNothing = async (label, res, status) => {
      assert.equal(res.__status, status, `${label}: ${res.__text}`);
      assert.ok(res.error && res.error.code, label);
      assert.equal(JSON.stringify(await claimNow()), stateBefore, `${label}: the claim is unchanged`);
    };
    const nhcxAudit = () => H.RECORD.audit.filter((a) => a.connectorId === "wardsynq-nhcx").length;
    const quiet = [H.RECORD._rows.length, nhcxAudit()];
    await expectNothing("no bearer", await deliver("claim/on_submit", { ...(await answer({ correlationId: corr, resource: claimResponse() })), headers: {} }), 401);
    await expectNothing("bad signature", await deliver("claim/on_submit", await answer({ correlationId: corr, resource: claimResponse(), keys: rogueKeys })), 401);
    await expectNothing("expired", await deliver("claim/on_submit", await answer({ correlationId: corr, resource: claimResponse(), claims: { ...goodClaims(), exp: nowS() - 3600, iat: nowS() - 7200 } })), 401);
    await expectNothing("other hospital", await deliver("claim/on_submit", await answer({ correlationId: corr, resource: claimResponse() }), OTHER), 404);
    await expectNothing("unknown sender", await deliver("claim/on_submit", await answer({ correlationId: corr, resource: claimResponse(), sender: "9999-else" })), 404);
    await expectNothing("not a callback path", await deliver("claim/submit", await answer({ correlationId: corr, resource: claimResponse() })), 404);
    assert.deepEqual([H.RECORD._rows.length, nhcxAudit()], quiet, "an unverified caller writes nothing, not even an audit row");

    await expectNothing("wrong recipient", await deliver("claim/on_submit", await answer({ correlationId: corr, resource: claimResponse(), recipient: "1000-someone-else" })), 403);
    await expectNothing("unknown correlation", await deliver("claim/on_submit", await answer({ correlationId: crypto.randomUUID(), resource: claimResponse() })), 404);
    await expectNothing("wrong kind for the correlation", await deliver("preauth/on_submit", await answer({ correlationId: corr, resource: claimResponse() })), 404);
    assert.equal(H.RECORD.audit.filter((a) => a.action === "nhcx.callback.refused").length, 3, "verified-but-refused answers are audited");

    const good = await answer({ correlationId: corr, resource: claimResponse() });
    const ok = await deliver("claim/on_submit", good);
    assert.equal(ok.__status, 202, ok.__text);
    assert.deepEqual([ok.correlation_id, ok.api_call_id], [corr, good.apiCallId]);
    const after = await claimNow();
    assert.equal(after.adapter.state, "acknowledged");
    assert.equal(after.adapter.outcome, "complete");
    assert.equal(after.approvedAmount, 12000, "the payer's figure");
    assert.equal(after.payerReference, "CR-9");
    assert.equal(after.state, "submitted", "the claim's lifecycle is still a person's act");
    const w = H.RECORD._rows.length;
    assert.equal((await deliver("claim/on_submit", good)).__status, 202, "a retried answer is accepted");
    assert.equal(H.RECORD._rows.length, w, "and writes nothing");

    // status poll: the Task goes to /hcx/status under the SAME correlation id, and is recorded on the claim
    const denied = await as(NURSE, "/ward/hcx-status", "POST", { orgId: ORG_ID, recordKind: "claim", recordId: claim.claimId });
    assert.equal(denied.__status, 403);
    const st = await as(CASHIER, "/ward/hcx-status", "POST", { orgId: ORG_ID, recordKind: "claim", recordId: claim.claimId });
    assert.equal(st.__status, 200, st.__text);
    const call = seen.filter((s) => s.url === `${GATEWAY}/hcx/status`)[0];
    const task = await A.decryptJwe(JSON.parse(call.init.body).payload, payerKeys.privateKey);
    assert.equal(task.header["x-hcx-correlation_id"], corr);
    assert.equal(task.payload.resourceType, "Task");
    assert.equal(task.payload.focus.identifier.value, claim.claimId);
    assert.equal((await claimNow()).statusChecks.length, 1);
    const onStatus = await deliver("hcx/on_status", await answer({ correlationId: corr, resource: claimResponse({ outcome: "partial" }) }));
    assert.equal(onStatus.__status, 202, onStatus.__text);
    assert.equal((await claimNow()).adapter.outcome, "partial");
  } finally { delete ENV.WSQ_TPA_FETCH; }
});

test("pre-authorisation to NHCX: diagnoses must be on the problem list; an approving answer approves it with the payer's amount", async () => {
  seed();
  assert.equal((await saveNhcx(ADMIN)).__status, 200);
  const seen = [];
  ENV.WSQ_TPA_FETCH = gateway(seen);
  try {
    const adm = await admitWithProblem("9876500042");
    const before = writesNow();
    const refused = await as(CASHIER, "/ward/preauth", "POST", { orgId: ORG_ID, patientId: adm.patientId, treatment: "PTCA", state: "requested", payerId: "icici", requestedAmount: 50000, policyNumber: "POL-2", codes: ["I21.9"] });
    assert.equal(refused.__status, 422, refused.__text);
    assert.equal(refused.code, "UNSUPPORTED_DIAGNOSIS");
    assert.equal(seen.length, 0, "an undocumented diagnosis never reaches a payer");
    assert.ok(writesNow() - before <= 1, "at most the read audit of the problem list");
    const pa = await as(CASHIER, "/ward/preauth", "POST", { orgId: ORG_ID, patientId: adm.patientId, treatment: "PTCA", state: "requested", payerId: "icici", requestedAmount: 50000, policyNumber: "POL-2", codes: ["I10"] });
    assert.equal(pa.__status, 200, pa.__text);
    assert.equal(pa.preAuth.adapter.state, "sent");
    assert.equal(seen.filter((s) => s.url === `${GATEWAY}/preauth/submit`).length, 1);
    const ok = await deliver("preauth/on_submit", await answer({ correlationId: pa.preAuth.adapter.exchange.correlationId, resource: claimResponse({ use: "preauthorization", preAuthRef: "PA-55", total: [{ category: { coding: [{ code: "benefit" }] }, amount: { value: 45000 } }] }) }));
    assert.equal(ok.__status, 202, ok.__text);
    const list = await as(CASHIER, `/ward/claims?orgId=${ORG_ID}&patientId=${adm.patientId}`);
    const got = list.preAuthorisations.find((p) => p.id === pa.preAuthId);
    assert.deepEqual([got.state, got.authorizedAmount, got.payerReference, got.adapter.state], ["approved", 45000, "PA-55", "acknowledged"]);
  } finally { delete ENV.WSQ_TPA_FETCH; }
});

test("eligibility: negative authorization writes and sends nothing; a check is sent, recorded append-only, and answered only by a verified on_check", async () => {
  seed();
  assert.equal((await saveNhcx(ADMIN)).__status, 200);
  const seen = [];
  ENV.WSQ_TPA_FETCH = gateway(seen);
  try {
    const adm = await admitWithProblem("9876500043");
    const req = { orgId: ORG_ID, patientId: adm.patientId, payerId: "icici", policyNumber: "POL-3" };
    const before = writesNow();
    assert.equal((await as(null, "/ward/nhcx-eligibility", "POST", req)).__status, 401);
    assert.equal((await as(NURSE, "/ward/nhcx-eligibility", "POST", req)).__status, 403);
    assert.equal((await as(OTHER_ADMIN, "/ward/nhcx-eligibility", "POST", req)).__status, 403);
    assert.equal(writesNow(), before, "nothing written");
    assert.equal(seen.length, 0, "nothing sent");

    const noPolicy = await as(CASHIER, "/ward/nhcx-eligibility", "POST", { ...req, policyNumber: "" });
    assert.equal(noPolicy.__status, 422);
    assert.match(noPolicy.message, /policy number/);
    assert.equal(seen.length, 0);

    const r = await as(CASHIER, "/ward/nhcx-eligibility", "POST", req);
    assert.equal(r.__status, 200, r.__text);
    assert.equal(r.check.state, "sent");
    const call = seen.find((s) => s.url === `${GATEWAY}/coverageeligibility/check`);
    const { payload } = await A.decryptJwe(JSON.parse(call.init.body).payload, payerKeys.privateKey);
    assert.deepEqual(payload.meta.profile, ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/CoverageEligibilityRequestBundle"]);
    const cer = payload.entry[0].resource;
    assert.deepEqual(cer.meta.profile, ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/CoverageEligibilityRequest"]);
    for (const k of ["identifier", "status", "priority", "purpose", "patient", "created", "enterer", "provider", "insurer", "facility", "insurance"]) assert.ok(cer[k] != null, k);
    assert.ok(cer.insurance[0].coverage);

    const corr = r.check.adapter.exchange.correlationId;
    assert.equal((await deliver("claim/on_submit", await answer({ correlationId: corr, resource: claimResponse() }))).__status, 404, "an eligibility exchange is not a claim");
    const ans = await deliver("coverageeligibility/on_check", await answer({ correlationId: corr, resource: { resourceType: "CoverageEligibilityResponse", outcome: "complete", disposition: "Policy in force",
      insurance: [{ inforce: true, item: [{ benefit: [{ type: { text: "Sum insured" }, allowedMoney: { value: 500000 } }] }] }] } }));
    assert.equal(ans.__status, 202, ans.__text);
    const list = await as(CASHIER, `/ward/claims?orgId=${ORG_ID}&patientId=${adm.patientId}`);
    const check = list.eligibilityChecks.find((c) => c.id === r.eligibilityId);
    assert.deepEqual([check.state, check.response.inforce, check.response.benefits[0].allowed], ["answered", true, 500000]);
    const hist = await H.RECORD.history(T, ELIGIBILITY_TYPE, r.eligibilityId);
    assert.ok(hist.length >= 2, "the answer is a new version; the sent version stays");
    assert.equal(list.payers.find((p) => p.id === "icici").nhcxConnected, true);
  } finally { delete ENV.WSQ_TPA_FETCH; }
});

test("not connected: a payer that is not NHCX, or no connector at all, sends nothing and says so", async () => {
  seed({ payers: [{ id: "paper", name: "Paper TPA", adapter: "manual" }] });
  const adm = await admitWithProblem("9876500044");
  const r = await as(CASHIER, "/ward/nhcx-eligibility", "POST", { orgId: ORG_ID, patientId: adm.patientId, payerId: "paper", policyNumber: "P" });
  assert.equal(r.__status, 422);
  assert.equal(r.error, "not_an_nhcx_payer");
  const list = await as(CASHIER, `/ward/claims?orgId=${ORG_ID}&patientId=${adm.patientId}`);
  assert.ok(!list.payers.some((p) => p.nhcxConnected));
  assert.deepEqual(list.eligibilityChecks, []);
});
