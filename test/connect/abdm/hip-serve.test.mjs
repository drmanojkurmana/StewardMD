// test/connect/abdm/hip-serve.test.mjs — Stage-5 Task-4: serveTransfer orchestration (guard -> load ->
// serialize -> seal -> push).
//
// serveTransfer sequences the already-built Stage-1..5 primitives in the SERVE direction:
//   assertServeAllowed (R5, Task-5) -> source.loadRecord (Task-1) -> serializeNdhm/validateNdhmDoc (Task-2)
//   -> sealEntries (Task-3, ONE fresh keyMaterial per page, prod path / no io) -> POST to a validated
//   (https + host-allow-listed + no-userinfo) dataPushUrl. The NDHM plaintext is request-scoped and sealed
//   immediately: the pushed body carries CIPHERTEXT + the HIP keyMaterial only, never the plaintext.
// The R5 guard now binds to D1-AUTHORITATIVE consent state: serveTransfer passes req.consentId and the guard
// RELOADS the consent row FRESH from D1 (status + persisted scope + patient_abha_hash) and binds every served
// careContext against its connect_abdm_carecontext registration. So each test seeds BOTH the consent_req row and
// the carecontext rows (via makeAbdmDb) instead of passing a trusted consent object.
// This suite uses the REAL followcareSource + REAL fidelius crypto + REAL hmacPseudonym end-to-end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serveTransfer, OverShareError, PushUrlError } from "../../../functions/_connect/abdm/hip.js";
import { followcareSource } from "../../../functions/_connect/abdm/hip-sources/followcare.js";
import { hmacPseudonym } from "../../../functions/_connect/audit.js";
import { generateKeyPair, nonce, sharedSecret, openEntry } from "../../../functions/_connect/abdm/fidelius.js";
import { makeAbdmDb } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { makeReader } from "./fixtures/hip-followcare-synthetic.mjs";

const TENANT = "t-hip";
const SALT = Buffer.from("connect-hip-test-hmac-salt-value").toString("base64");
const NOW = () => new Date("2026-07-21T00:00:00Z");
const envOf = (over = {}) => ({ CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", CONNECT_HMAC_SALT: SALT, CONNECT_HIP_PUSH_HOSTS: "hiu.example.org", ...over });

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function makeHiu() {
  const kp = await generateKeyPair();
  const n = nonce();
  return { privateKey: kp.privateKey, nonce: n, keyMaterial: { dhPublicKey: b64(kp.publicKeyRaw), nonce: b64(n) } };
}
function makeCapturingFetch(resp = { ok: true, status: 202 }) {
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ...resp, json: async () => ({}) }; };
  return { fetch, calls };
}
function makeAudit() { const events = []; return { fn: async (e) => { events.push(e); }, events }; }

// A synthetic FollowCare discharge episode for a given patient hash + a distinctive dx string.
function episode(ref, patientAbhaHash, dx, patientId = "fc-pat-A") {
  return {
    careContextRef: ref, patientAbhaHash, hiType: "DischargeSummary",
    display: "Discharge summary", dischargeDate: "2026-07-20",
    patient: { id: patientId, gender: "female", birthDate: "1972-05-14", name: { text: "Synthetic Patient" } },
    diagnoses: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "J18.9", display: dx }],
    medications: [{ text: "Azithromycin 500 mg once daily" }],
    observations: [{ category: "vital-signs", system: "http://loinc.org", code: "8867-4", display: "Heart rate", value: 78, unit: "beats/min" }],
    summary: { title: "Discharge summary", text: dx + " treated and discharged stable." },
  };
}

// Seed the authoritative D1 state the guard reloads: the ONE consent_req row (consent_id + status + persisted
// scope + patient_abha_hash) PLUS the connect_abdm_carecontext registration rows served refs bind against.
function seedServeDb(patientAbhaHash, { consentId = "consent-1", careContexts = ["cc-A-1", "cc-A-2"], hiTypes = ["DischargeSummary"], status = "GRANTED", ccRows } = {}) {
  const carecontext = ccRows || careContexts.map((ref) => ({
    id: ref, tenant_id: TENANT, patient_abha_hash: patientAbhaHash, source: "followcare",
    ref, hi_type: "DischargeSummary", display: "cc " + ref, linked_at: "2026-01-01T00:00:00Z",
  }));
  return makeAbdmDb({
    connect_abdm_consent_req: [{
      request_id: consentId, consent_id: consentId, tenant_id: TENANT, actor: null,
      patient_abha_hash: patientAbhaHash, status, hi_types: JSON.stringify(hiTypes),
      care_contexts: JSON.stringify(careContexts), purpose: JSON.stringify({ code: "CAREMGT", text: "Care Management" }),
      date_range: JSON.stringify({ from: "2026-01-01T00:00:00Z", to: "2026-12-31T23:59:59Z" }),
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", expires_at: "2026-12-31T23:59:59Z",
    }],
    connect_abdm_carecontext: carecontext,
  });
}
const depsWith = (db, fetch, audit, followcare, source = followcareSource) =>
  ({ db, secrets: null, gateway: null, fetch, audit, now: NOW, source, jwks: null, followcare });

const DX1 = "Community-acquired pneumonia";
const DX2 = "Acute pyelonephritis";

test("happy path: N care-contexts -> N pages, each pushed with a DISTINCT keyMaterial, hip.served audited", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const hiu = await makeHiu();
  const { fetch, calls } = makeCapturingFetch();
  const audit = makeAudit();
  const reader = makeReader([episode("cc-A-1", HASH_A, DX1), episode("cc-A-2", HASH_A, DX2)]);
  const db = seedServeDb(HASH_A, { careContexts: ["cc-A-1", "cc-A-2"] });
  const deps = depsWith(db, fetch, audit.fn, reader);
  const req = { tenantId: TENANT, consentId: "consent-1", careContexts: ["cc-A-1", "cc-A-2"], hiuKeyMaterial: hiu.keyMaterial, dataPushUrl: "https://hiu.example.org/abdm/push", transactionId: "txn-1" };

  const out = await serveTransfer(env, deps, req);
  assert.equal(out.pages, 2);
  assert.equal(out.pushed, true);
  assert.equal(out.outcome, "SERVED");
  assert.equal(calls.length, 2, "one push per care-context");

  // pairwise-distinct keyMaterial (fresh HIP ephemeral per page) — the R1 nonce-safety surfaced at the wire.
  const pubs = calls.map((c) => c.body.keyMaterial.dhPublicKey);
  assert.notEqual(pubs[0], pubs[1], "each pushed page must carry its OWN fresh keyMaterial");
  const nonces = calls.map((c) => c.body.keyMaterial.nonce);
  assert.notEqual(nonces[0], nonces[1]);

  // hip.served audited (metadata only): consentId, transactionId, page count — no ABHA.
  const served = audit.events.find((e) => e.action === "hip.served");
  assert.ok(served, "hip.served audited");
  assert.equal(served.consentId, "consent-1");
  assert.equal(served.transactionId, "txn-1");
  assert.equal(JSON.stringify(audit.events).includes("@sbx"), false, "no raw ABHA in the audit trail");
});

test("the pushed body is CIPHERTEXT + keyMaterial only (plaintext dx ABSENT), and decrypts back to the NDHM doc", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const hiu = await makeHiu();
  const { fetch, calls } = makeCapturingFetch();
  const reader = makeReader([episode("cc-A-1", HASH_A, DX1), episode("cc-A-2", HASH_A, DX2)]);
  const db = seedServeDb(HASH_A, { careContexts: ["cc-A-1", "cc-A-2"] });
  const deps = depsWith(db, fetch, makeAudit().fn, reader);
  const req = { tenantId: TENANT, consentId: "consent-1", careContexts: ["cc-A-1", "cc-A-2"], hiuKeyMaterial: hiu.keyMaterial, dataPushUrl: "https://hiu.example.org/abdm/push", transactionId: "txn-1" };

  await serveTransfer(env, deps, req);

  for (const c of calls) {
    const raw = JSON.stringify(c.body);
    assert.equal(raw.includes(DX1), false, "plaintext dx must be ABSENT from the pushed body");
    assert.equal(raw.includes(DX2), false);
    assert.equal(raw.includes("Azithromycin"), false, "plaintext med must be ABSENT from the pushed body");
    assert.ok(c.body.keyMaterial && c.body.keyMaterial.dhPublicKey && c.body.keyMaterial.nonce, "carries the HIP public keyMaterial");
    assert.ok(c.body.entries[0].content && c.body.entries[0].checksum, "carries ciphertext + checksum");
  }
  // The mock HIU decrypts page 0 with its OWN private key -> the real NDHM Bundle (round-trip proof).
  const p0 = calls[0].body;
  const secret = await sharedSecret(hiu.privateKey, unb64(p0.keyMaterial.dhPublicKey));
  const pt = await openEntry(secret, hiu.nonce, unb64(p0.keyMaterial.nonce), p0.entries[0].content, p0.entries[0].checksum);
  const doc = JSON.parse(pt);
  assert.equal(doc.resourceType, "Bundle");
  assert.equal(doc.type, "document");
  assert.ok(pt.includes(DX1), "the DECRYPTED page carries the plaintext dx (only recoverable with the HIU key)");
});

test("a serialize/validate failure on ONE record -> that page skipped + warned, the rest served (PARTIAL)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const hiu = await makeHiu();
  const { fetch, calls } = makeCapturingFetch();
  const audit = makeAudit();
  const reader = makeReader([episode("cc-A-1", HASH_A, DX1), episode("cc-A-2", HASH_A, DX2)]);
  // a source that corrupts ONLY cc-A-2's record so validateNdhmDoc fails (no Composition.subject) for it.
  const source = {
    id: "followcare", hiTypes: followcareSource.hiTypes,
    listCareContexts: followcareSource.listCareContexts,
    async loadRecord(e, d, args) {
      const loaded = await followcareSource.loadRecord(e, d, args);
      if (args.careContextRef === "cc-A-2") loaded.record.patient = null; // -> serialize has no subject -> validate fails
      return loaded;
    },
  };
  const db = seedServeDb(HASH_A, { careContexts: ["cc-A-1", "cc-A-2"] });
  const deps = depsWith(db, fetch, audit.fn, reader, source);
  const req = { tenantId: TENANT, consentId: "consent-1", careContexts: ["cc-A-1", "cc-A-2"], hiuKeyMaterial: hiu.keyMaterial, dataPushUrl: "https://hiu.example.org/abdm/push", transactionId: "txn-1" };

  const out = await serveTransfer(env, deps, req);
  assert.equal(out.outcome, "PARTIAL");
  assert.equal(out.pages, 1, "only the healthy record is served");
  assert.equal(out.warnings.length, 1, "the failing record is warned, not dropped silently");
  assert.equal(out.warnings[0].careContextRef, "cc-A-2");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.careContextReference, "cc-A-1");
  assert.ok(audit.events.some((e) => e.action === "hip.served"));
});

test("anti-SSRF: a non-https / off-allow-list / userinfo dataPushUrl -> refuse (PushUrlError), NO push", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const hiu = await makeHiu();
  for (const badUrl of [
    "http://hiu.example.org/push",           // not https
    "https://evil.example.com/push",         // off the host allow-list
    "https://user:pass@hiu.example.org/push",// userinfo present
    "https://attacker@hiu.example.org/push", // userinfo present (no password)
    "ftp://hiu.example.org/push",            // wrong scheme
    "not-a-url",                              // unparseable
  ]) {
    const { fetch, calls } = makeCapturingFetch();
    const reader = makeReader([episode("cc-A-1", HASH_A, DX1)]);
    const db = seedServeDb(HASH_A, { careContexts: ["cc-A-1"] });
    const deps = depsWith(db, fetch, makeAudit().fn, reader);
    const req = { tenantId: TENANT, consentId: "consent-1", careContexts: ["cc-A-1"], hiuKeyMaterial: hiu.keyMaterial, dataPushUrl: badUrl, transactionId: "txn-1" };
    await assert.rejects(() => serveTransfer(env, deps, req), PushUrlError, "must refuse dataPushUrl: " + badUrl);
    assert.equal(calls.length, 0, "NOTHING is pushed to a rejected dataPushUrl: " + badUrl);
  }
});

test("anti-SSRF: an empty / unconfigured host allow-list fails CLOSED (refuse all)", async () => {
  const env = envOf({ CONNECT_HIP_PUSH_HOSTS: "" });
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const hiu = await makeHiu();
  const { fetch, calls } = makeCapturingFetch();
  const reader = makeReader([episode("cc-A-1", HASH_A, DX1)]);
  const db = seedServeDb(HASH_A, { careContexts: ["cc-A-1"] });
  const deps = depsWith(db, fetch, makeAudit().fn, reader);
  const req = { tenantId: TENANT, consentId: "consent-1", careContexts: ["cc-A-1"], hiuKeyMaterial: hiu.keyMaterial, dataPushUrl: "https://hiu.example.org/abdm/push", transactionId: "txn-1" };
  await assert.rejects(() => serveTransfer(env, deps, req), PushUrlError);
  assert.equal(calls.length, 0);
});

test("guard refusal at serve level: a cross-patient record -> OverShareError, nothing sealed/pushed, hip.denied audited", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const HASH_B = await hmacPseudonym(env, TENANT, "B@sbx");
  const hiu = await makeHiu();
  const { fetch, calls } = makeCapturingFetch();
  const audit = makeAudit();
  const reader = makeReader([episode("cc-A-1", HASH_A, DX1), episode("cc-B-1", HASH_B, "Appendicitis", "fc-pat-B")]);
  // The consent row is patient A; the transfer includes cc-B-1 whose record subject is B AND whose registration
  // is under B -> the whole transfer is refused (D1-authoritative subject bind).
  const db = seedServeDb(HASH_A, {
    careContexts: ["cc-A-1", "cc-B-1"],
    ccRows: [
      { id: "cc-A-1", tenant_id: TENANT, patient_abha_hash: HASH_A, source: "followcare", ref: "cc-A-1", hi_type: "DischargeSummary", display: "A", linked_at: "x" },
      { id: "cc-B-1", tenant_id: TENANT, patient_abha_hash: HASH_B, source: "followcare", ref: "cc-B-1", hi_type: "DischargeSummary", display: "B", linked_at: "x" },
    ],
  });
  const deps = depsWith(db, fetch, audit.fn, reader);
  const req = { tenantId: TENANT, consentId: "consent-1", careContexts: ["cc-A-1", "cc-B-1"], hiuKeyMaterial: hiu.keyMaterial, dataPushUrl: "https://hiu.example.org/abdm/push", transactionId: "txn-1" };

  await assert.rejects(() => serveTransfer(env, deps, req), OverShareError);
  assert.equal(calls.length, 0, "not even the in-scope A record is pushed once a cross-patient record is present");
  assert.ok(audit.events.some((e) => e.action === "hip.denied"), "hip.denied audited");
  assert.ok(!audit.events.some((e) => e.action === "hip.served"), "hip.served must NOT be audited on a refusal");
});

test("a push failure -> stop + hip.failed audited, error propagates (fail-closed)", async () => {
  const env = envOf();
  const HASH_A = await hmacPseudonym(env, TENANT, "A@sbx");
  const hiu = await makeHiu();
  const audit = makeAudit();
  const calls = [];
  const fetch = async (url, opts) => { calls.push(url); return { ok: false, status: 500, json: async () => ({}) }; };
  const reader = makeReader([episode("cc-A-1", HASH_A, DX1)]);
  const db = seedServeDb(HASH_A, { careContexts: ["cc-A-1"] });
  const deps = depsWith(db, fetch, audit.fn, reader);
  const req = { tenantId: TENANT, consentId: "consent-1", careContexts: ["cc-A-1"], hiuKeyMaterial: hiu.keyMaterial, dataPushUrl: "https://hiu.example.org/abdm/push", transactionId: "txn-1" };
  await assert.rejects(() => serveTransfer(env, deps, req));
  assert.ok(audit.events.some((e) => e.action === "hip.failed"), "hip.failed audited on a push error");
  assert.ok(!audit.events.some((e) => e.action === "hip.served"));
});

test("flag OFF -> no-op (DISABLED): neither smd_connect nor the HIP flag serve", async () => {
  const HASH_A = await hmacPseudonym(envOf(), TENANT, "A@sbx");
  const hiu = await makeHiu();
  const baseReq = (env) => {
    const { fetch, calls } = makeCapturingFetch();
    const reader = makeReader([episode("cc-A-1", HASH_A, DX1)]);
    const deps = depsWith(seedServeDb(HASH_A, { careContexts: ["cc-A-1"] }), fetch, makeAudit().fn, reader);
    const req = { tenantId: TENANT, consentId: "consent-1", careContexts: ["cc-A-1"], hiuKeyMaterial: hiu.keyMaterial, dataPushUrl: "https://hiu.example.org/abdm/push", transactionId: "txn-1" };
    return { env, deps, req, calls };
  };
  for (const env of [envOf({ CONNECT_HIP_FLAG: "0" }), envOf({ CONNECT_FLAG: "0" }), envOf({ CONNECT_HIP_FLAG: undefined })]) {
    const { deps, req, calls } = baseReq(env);
    const out = await serveTransfer(env, deps, req);
    assert.equal(out.outcome, "DISABLED");
    assert.equal(out.pages, 0);
    assert.equal(out.pushed, false);
    assert.equal(calls.length, 0, "flag OFF pushes nothing");
  }
});

test("empty care-contexts -> EMPTY no-op (nothing loaded, guarded, sealed, or pushed)", async () => {
  const env = envOf();
  const hiu = await makeHiu();
  const { fetch, calls } = makeCapturingFetch();
  const deps = depsWith(null, fetch, makeAudit().fn, makeReader([]));
  const req = { tenantId: TENANT, consentId: "consent-1", careContexts: [], hiuKeyMaterial: hiu.keyMaterial, dataPushUrl: "https://hiu.example.org/abdm/push", transactionId: "txn-1" };
  const out = await serveTransfer(env, deps, req);
  assert.equal(out.outcome, "EMPTY");
  assert.equal(out.pages, 0);
  assert.equal(calls.length, 0);
});
