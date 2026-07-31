// test/connect/abdm/hiu-flow.test.mjs — Stage-4 Task-9: the END-TO-END HIU consume proof vs the adversarial mock.
// Drives the WHOLE chain with real crypto + real state, exercising the composed invariants of Tasks 4-8:
//   requestConsent → (GRANT notify) → fetchConsentArtifact → (on-fetch → verifyConsentArtifact) →
//   requestHealthInformation → (on-request) → (data-push) → consumeTransfer (per-entry decrypt + exactly-once
//   ack) → engine tail (normalizeNdhm → validateBundle → scope-filter) → buildMaikContext.
// The consent notify / on-fetch / data-push / junk-push webhooks all flow through the REAL handleIngress (verify
// body-signature → replay → correlate-before-buffer → route). The CM/HIP mock double-signs (outer webhook body +
// inner consent artifact) with an RS256 key it publishes as the pinned JWKS, so verifyConsentArtifact and the
// ingress body-verify both run their REAL getPinnedJwks → verifyJws path — no verify stubs anywhere.
//
// KEY DEPENDENCE ON THE TASK-9 WIRING: the data request omits `req.consent`, so revalidateForRequest can only
// pass off the scope columns that the on-fetch → verifyConsentArtifact route PERSISTED onto the reconciled row.
// Without the on-fetch wiring those columns stay null and the data request is refused — the happy path is red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestConsent, requestHealthInformation, consumeTransfer } from "../../../functions/_connect/abdm/hiu.js";
import { fetchConsentArtifact, getConsentReqByConsentId } from "../../../functions/_connect/abdm/consent.js";
import { handleIngress } from "../../../functions/_connect/abdm/ingress.js";
import { ingestEvent } from "../../../functions/_connect/engine.js";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { getConsentReq, getTxnByRequestId, getTxnByTransactionId, listBuffered, sweep } from "../../../functions/_connect/abdm/state.js";
import { normalizeNdhm } from "../../../functions/_connect/connectors/abdm/normalize.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { enforceScope, PermissionError } from "../../../functions/_connect/permission.js";
import { RESOURCE_KEYS } from "../../../functions/_connect/canonical/model.js";
import { buildMaikContext, assertEgressAllowed, EgressBlocked } from "../../../functions/_connect/maik-context.js";
import { buildAuditEvent, ALLOW } from "../../../functions/_connect/audit.js";
import { makeCtx } from "../../../functions/_connect/interfaces.js";
import { makeHiuMockGateway } from "./mock-gateway.mjs";

const NOW = "2026-07-15T00:00:00.000Z";
const LATER = "2027-01-01T00:00:00.000Z";                 // past `expiry` → GC sweep retires the terminal txn
const ABHA = "ramesh1985@sbx";                            // RAW ABHA — must never touch D1 / audit / buffer
const PHI_NAME = "PHI-PATIENT-MARKER-XYZ";                // decrypted-only patient name; must never land at rest
const ENV = {
  CONNECT_FLAG: "1",
  CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64"),
  CONNECT_ABDM_DATA_PUSH_URL: "https://stewardmd.in/api/connect/abdm/hiu/data",
  ABDM_JWKS_URL: "https://healthidsbx.abdm.gov.in/certs",   // allow-listed host → getPinnedJwks resolves the mock JWKS
};

// The consent scope the CM SIGNS into the artifact (→ persisted onto the reconciled row by verifyConsentArtifact).
const SCOPE = {
  careContexts: ["cc-A", "cc-B"],
  hiTypes: ["OPConsultation", "DiagnosticReport"],
  purpose: { code: "CAREMGT", text: "Care Management" },
  dateRange: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" },
  dataEraseAt: "2027-06-30T00:00:00.000Z",
  expiry: "2026-12-31T00:00:00.000Z",
};

// A synthetic NDHM-FHIR document Bundle (Condition + MedicationRequest + a laboratory Observation) → so the MaiK
// context carries problems + meds + labs. NEVER real PHI; the patient name is a decrypted-only leak sentinel.
const NDHM_DOC = {
  resourceType: "Bundle", type: "document",
  entry: [
    { fullUrl: "urn:uuid:comp-1", resource: { resourceType: "Composition", id: "comp-1", status: "final",
      meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord"] },
      type: { text: "Clinical consultation report" }, subject: { reference: "Patient/pat-1" },
      title: "OP Consultation", date: "2026-07-14T00:00:00Z",
      text: { status: "generated", div: "<div>Enteric fever; amoxicillin; Hb 9.2 g/dL</div>" },
      section: [
        { title: "Chief complaints", entry: [{ reference: "Condition/cond-1" }] },
        { title: "Medications", entry: [{ reference: "MedicationRequest/mr-1" }] },
        { title: "Investigations", entry: [{ reference: "Observation/obs-hb" }] },
      ] } },
    { fullUrl: "urn:uuid:pat-1", resource: { resourceType: "Patient", id: "pat-1", gender: "male", birthDate: "1985-01-01",
      name: [{ text: PHI_NAME, family: "Marker", given: ["Synthetic"] }] } },
    { fullUrl: "urn:uuid:cond-1", resource: { resourceType: "Condition", id: "cond-1",
      code: { text: "Enteric fever", coding: [{ system: "http://snomed.info/sct", code: "4834000" }] },
      clinicalStatus: { coding: [{ code: "active" }] } } },
    { fullUrl: "urn:uuid:mr-1", resource: { resourceType: "MedicationRequest", id: "mr-1", status: "active", intent: "order",
      medicationCodeableConcept: { text: "Amoxicillin 500mg" }, dosageInstruction: [{ text: "1 tablet three times a day for 5 days" }] } },
    { fullUrl: "urn:uuid:obs-hb", resource: { resourceType: "Observation", id: "obs-hb", status: "final",
      category: [{ coding: [{ code: "laboratory" }] }],
      code: { text: "Hemoglobin", coding: [{ system: "http://loinc.org", code: "718-7" }] },
      valueQuantity: { value: 9.2, unit: "g/dL" } } },
  ],
};
const NDHM_DOC_2 = { ...NDHM_DOC, entry: NDHM_DOC.entry.map((e) => ({ ...e })) };   // a distinct 2nd doc for partial

// consumeTransfer only ever OPENS (unseal) / putTxn only ever SEALS — this stub round-trips the sealed scalar.
const sealStub = { seal: async (s) => "SEALED:" + s, open: async (s) => s.slice(7) };
const spyAudit = () => { const calls = []; const fn = async (f) => { calls.push(f); }; fn.calls = calls; return fn; };
const identifyUser = async () => ({ id: "fb:u1", guest: false });
const seedDb = () => makeAbdmDb({
  connect_membership: [{ user_id: "fb:u1", tenant_id: "t1", role: "clinician" }],
  connect_tenant: [{ id: "t1", mode: "live", granted_scopes: '["Condition","MedicationStatement","Observation","DocumentReference"]' }],
});

// The engine §8 permission scope-filter, mirrored verbatim (engine.js is used-not-imported for this inline step).
const SCOPE_TO_KEY = { Encounter: "encounters", Condition: "conditions", MedicationStatement: "medications", AllergyIntolerance: "allergies", Observation: "observations", DiagnosticReport: "diagnosticReports", DocumentReference: "documents" };
function scopeFilter(bundle, scope) {
  for (const key of RESOURCE_KEYS) { const type = Object.keys(SCOPE_TO_KEY).find((t) => SCOPE_TO_KEY[t] === key); if (type && !scope.includes(type)) bundle[key] = []; }
  return bundle;
}

// One shared harness: ONE db/r2/kv/audit across the whole flow; the ingress deps ARE what the mock delivers into.
async function setup({ env = ENV, knobs = {} } = {}) {
  const db = seedDb(), r2 = makeR2(), kv = makeMockKv(), audit = spyAudit();
  const ingressDeps = { db, r2, kv, secrets: sealStub, ingestEvent, audit, now: () => NOW };
  const mock = await makeHiuMockGateway({ env, deps: ingressDeps, handleIngress, tenantId: "t1", now: () => NOW, knobs });
  ingressDeps.fetch = mock.jwksFetch;   // getPinnedJwks (body-verify + verifyConsentArtifact) resolves the CM JWKS
  const outDeps = { db, kv, secrets: sealStub, gateway: mock.gateway, identifyFn: identifyUser, audit, now: () => NOW };
  const consumeDeps = { db, r2, secrets: sealStub, gateway: mock.gateway, now: NOW };
  return { env, db, r2, kv, audit, ingressDeps, outDeps, consumeDeps, mock };
}

const consentReq = () => ({ request: {}, tenantId: "t1", abhaAddress: ABHA, purpose: SCOPE.purpose, hiTypes: SCOPE.hiTypes, dateRange: SCOPE.dateRange, dataEraseAt: SCOPE.dataEraseAt });
// NOTE: no `consent` field — the data request MUST revalidate off the DB row the on-fetch route persisted.
const dataReq = (consentId) => ({ request: {}, tenantId: "t1", consentId, careContexts: ["cc-A"], hiTypes: ["OPConsultation"], purpose: { code: "CAREMGT" }, dateRange: { from: "2026-06-01T00:00:00.000Z", to: "2026-07-15T00:00:00.000Z" } });

// Consent-request → GRANT notify → fetch → on-fetch(verify). Returns the reconciled requestId + the consentId.
async function driveConsentGranted(h) {
  const { requestId } = await requestConsent(h.env, h.outDeps, consentReq());
  const n = await h.mock.fireConsentNotify();                       assert.equal(n.status, 202, "GRANT notify accepted");
  await fetchConsentArtifact(h.env, h.outDeps, { requestId, consentId: h.mock.consentId });
  const f = await h.mock.fireOnFetch(SCOPE);                        assert.equal(f.status, 202, "on-fetch accepted + verified");
  return { requestId, consentId: h.mock.consentId };
}
const dataRequest = (h, consentId) => requestHealthInformation(h.env, h.outDeps, dataReq(consentId));

// Assert every collected audit event is PHI-free-by-construction: only ALLOW-listed keys survive buildAuditEvent,
// and no raw ABHA / decrypted patient name / raw careContextReference appears anywhere in the trail.
function assertAuditPhiFree(audit) {
  assert.ok(audit.calls.length >= 3, "consent.requested + consent.verified + data.requested all audited");
  for (const ev of audit.calls) {
    assert.deepEqual(new Set(Object.keys(buildAuditEvent(ev))), new Set(Object.keys(ev)), "audit event carries ONLY ALLOW-listed keys");
    for (const k of Object.keys(ev)) assert.ok(ALLOW.includes(k), `audit key ${k} not ALLOW-listed`);
  }
  const blob = JSON.stringify(audit.calls);
  assert.ok(!blob.includes(ABHA), "raw ABHA never audited");
  assert.ok(!blob.includes(PHI_NAME), "decrypted PHI never audited");
  assert.ok(!blob.includes("cc-A"), "raw careContextReference never audited");
}

// ── 1. HAPPY PATH — the whole chain green: MaiK carries problems/meds/labs, exactly one ack, buffer+key gone. ──
test("1. happy path → verify-persist → data-request → decrypt → engine tail → MaiK context; one ack; buffer+key gone", async () => {
  const h = await setup();
  const { requestId: reqC, consentId } = await driveConsentGranted(h);

  // the on-fetch route persisted the FULL signed scope onto the ONE reconciled row (keyed by consent_id).
  const row = await getConsentReqByConsentId(h.db, consentId);
  assert.equal(row.status, "GRANTED");
  assert.equal(row.request_id, reqC, "reconciled onto the internal consent request_id (no orphan row)");
  assert.deepEqual(JSON.parse(row.care_contexts), SCOPE.careContexts, "signed scope persisted by verifyConsentArtifact");

  // data request revalidates off that DB row (NO cached artifact), mints + seals a fresh ephemeral key.
  const { requestId: reqD, status } = await dataRequest(h, consentId);
  assert.equal(status, "REQUESTED");

  await h.mock.fireOnRequest();                                          // attaches transaction_id
  const p = await h.mock.firePush({ docs: [NDHM_DOC] });                 assert.equal(p.status, 202, "correlated data-push buffered");
  const buffered = await listBuffered(h.r2, h.mock.transactionId);
  assert.equal(buffered.length, 1);
  assert.ok(buffered[0].careContextHash && !JSON.stringify(buffered).includes("cc-0"), "raw careContextReference HMAC'd, never stored raw");
  assert.equal((await getTxnByTransactionId(h.db, h.mock.transactionId)).status, "RECEIVING", "FSM advanced to RECEIVING");

  const ct = await consumeTransfer(h.env, h.consumeDeps, { transactionId: h.mock.transactionId, hipKeyMaterial: h.mock.hipKeyMaterial, sessionStatus: "TRANSFERRED" });
  assert.equal(ct.acked, true);
  assert.equal(ct.advanced, true, "RECEIVING → TRANSFERRED surfaced");
  assert.equal(ct.decrypted.length, 1, "the single pushed entry decrypted");
  assert.equal(h.mock.acks.length, 1, "EXACTLY one hiNotify ack");

  // engine tail (the reused pull tail): normalize → validate → scope-filter → MaiK context.
  const bundle = normalizeNdhm(makeCtx({ tenant: { id: "t1", mode: "live" } }), JSON.parse(ct.decrypted[0]));
  assert.equal(validateBundle(bundle).ok, true, "the ABDM-normalized bundle passes the SAME validator as the pull side");
  const scope = enforceScope(["Condition", "MedicationStatement", "Observation", "DocumentReference"], ["Condition", "MedicationStatement", "Observation"]);
  scopeFilter(bundle, scope);
  const maik = buildMaikContext(bundle);
  assert.deepEqual(maik.problems.map((p) => p.label), ["Enteric fever"]);
  assert.deepEqual(maik.medications.map((m) => m.label), ["Amoxicillin 500mg"]);
  assert.deepEqual(maik.labs.map((l) => l.label), ["Hemoglobin"]);
  assert.equal(JSON.stringify(maik).includes("sourceConnector"), false, "MaiK context is SCCM-only (no vendor/source ids)");

  // R7: a mode:live bundle NEVER opens LLM egress on mode alone — only the no-retention BAA/DPA flag does.
  assert.throws(() => assertEgressAllowed(bundle, { mode: "live" }), EgressBlocked);
  assert.doesNotThrow(() => assertEgressAllowed(bundle, { mode: "live", egressBaaOk: true }));

  // buffer retired on the winning ack; the sealed key + txn retired by the GC sweep at expiry.
  assert.equal((await listBuffered(h.r2, h.mock.transactionId)).length, 0, "buffer deleted on the winning ack");
  await sweep(h.db, h.r2, ENV, LATER);
  assert.equal(await getTxnByRequestId(h.db, reqD), null, "sealed key + txn retired by the sweep");

  // PHI-free at rest: neither the decrypted patient name nor the raw ABHA ever landed in D1; audit trail is clean.
  assert.ok(!JSON.stringify(h.db._tables).includes(PHI_NAME), "decrypted PHI never persisted to D1");
  assert.ok(!JSON.stringify(h.db._tables).includes(ABHA), "raw ABHA never persisted to D1");
  assertAuditPhiFree(h.audit);
});

// ── 2. outOfOrder — the data-push lands BEFORE on-request → buffer-then-join → correct final decrypt. ─────────
test("2. push before on-request → buffered (via the consent_id join) then not-ready → on-request → ready → decrypt", async () => {
  const h = await setup({ knobs: { outOfOrder: true } });
  const { consentId } = await driveConsentGranted(h);
  await dataRequest(h, consentId);

  // push arrives FIRST (transaction_id not yet attached): correlates via the durable consent_id join → buffered.
  const p = await h.mock.firePush({ docs: [NDHM_DOC] });               assert.equal(p.status, 202, "out-of-order push still buffered");
  assert.equal((await listBuffered(h.r2, h.mock.transactionId)).length, 1);

  // consume now → the txn half is missing → not ready → pure no-op, buffer retained.
  const early = await consumeTransfer(h.env, h.consumeDeps, { transactionId: h.mock.transactionId, hipKeyMaterial: h.mock.hipKeyMaterial, sessionStatus: "TRANSFERRED" });
  assert.deepEqual(early, { decrypted: [], acked: false, advanced: false });
  assert.equal((await listBuffered(h.r2, h.mock.transactionId)).length, 1, "buffer retained for a later join");
  assert.equal(h.mock.acks.length, 0, "no ack on a not-ready join");

  // on-request attaches our half → the join is now satisfiable → decrypt.
  await h.mock.fireOnRequest();
  const ct = await consumeTransfer(h.env, h.consumeDeps, { transactionId: h.mock.transactionId, hipKeyMaterial: h.mock.hipKeyMaterial, sessionStatus: "TRANSFERRED" });
  assert.equal(ct.acked, true);
  assert.equal(ct.decrypted.length, 1, "correct final decrypt after the buffer-then-join");
  assert.equal(JSON.parse(ct.decrypted[0]).entry.length, NDHM_DOC.entry.length);
  assert.equal(h.mock.acks.length, 1, "exactly one ack across the two consume attempts");
});

// ── 3. duplicate — the same push delivered twice → one buffered object → one decrypt. ─────────────────────────
test("3. duplicate push → deduped to one buffered object → exactly one decrypt + one ack", async () => {
  const h = await setup({ knobs: { duplicate: true } });
  const { consentId } = await driveConsentGranted(h);
  await dataRequest(h, consentId);
  await h.mock.fireOnRequest();

  await h.mock.firePush({ docs: [NDHM_DOC] });
  await h.mock.firePush({ docs: [NDHM_DOC] });                          // same (careContextRef, checksum) → same R2 key
  assert.equal((await listBuffered(h.r2, h.mock.transactionId)).length, 1, "duplicate push deduped to ONE object");

  const ct = await consumeTransfer(h.env, h.consumeDeps, { transactionId: h.mock.transactionId, hipKeyMaterial: h.mock.hipKeyMaterial, sessionStatus: "TRANSFERRED" });
  assert.equal(ct.decrypted.length, 1, "one object → one decrypt");
  assert.equal(ct.acked, true);
  assert.equal(h.mock.acks.length, 1);
});

// ── 4. partial — one tampered entry fails closed, its sibling decrypts → PARTIAL ack, decrypted subset surfaced. ─
test("4. partial → tampered entry fails closed, sibling decrypts → PARTIAL, subset surfaced, one ack", async () => {
  const h = await setup({ knobs: { partial: true } });
  const { consentId } = await driveConsentGranted(h);
  await dataRequest(h, consentId);
  await h.mock.fireOnRequest();
  await h.mock.firePush({ docs: [NDHM_DOC, NDHM_DOC_2] });   // partial knob (set via setup) → entry 0 tampered (GCM auth fails)

  const ct = await consumeTransfer(h.env, h.consumeDeps, { transactionId: h.mock.transactionId, hipKeyMaterial: h.mock.hipKeyMaterial, sessionStatus: "PARTIAL" });
  assert.equal(ct.decrypted.length, 1, "only the intact entry surfaced (no sibling poisoning)");
  assert.equal(ct.acked, true);
  assert.equal((await getTxnByTransactionId(h.db, h.mock.transactionId)).status, "PARTIAL", "outcome persisted as PARTIAL");
  assert.equal(h.mock.acks.length, 1);
});

// ── 5. retryAfterAck — a second consume after the winning ack is a pure no-op (no 2nd ack, no re-decrypt). ─────
test("5. retry after ack → no second ack, no re-decrypt (exactly-once holds end-to-end)", async () => {
  const h = await setup({ knobs: { retryAfterAck: true } });
  const { consentId } = await driveConsentGranted(h);
  await dataRequest(h, consentId);
  await h.mock.fireOnRequest();
  await h.mock.firePush({ docs: [NDHM_DOC] });

  const arg = { transactionId: h.mock.transactionId, hipKeyMaterial: h.mock.hipKeyMaterial, sessionStatus: "TRANSFERRED" };
  const first = await consumeTransfer(h.env, h.consumeDeps, arg);
  const retry = await consumeTransfer(h.env, h.consumeDeps, arg);       // buffer already gone → ready:false
  assert.equal(first.acked, true);
  assert.deepEqual(retry, { decrypted: [], acked: false, advanced: false }, "retry re-decrypts NOTHING");
  assert.equal(h.mock.acks.length, 1, "exactly one ack survived the retry");
});

// ── 6. junk push (unknown correlation) → 403, R2 untouched (correlate precedes buffer). ───────────────────────
test("6. junk push (unknown correlation) → 403, R2 untouched", async () => {
  const h = await setup();
  const { consentId } = await driveConsentGranted(h);
  await dataRequest(h, consentId);
  await h.mock.fireOnRequest();

  // an unknown transactionId AND no consent_id join → correlate returns null → 403 BEFORE any R2 write.
  const res = await h.mock.firePush({ docs: [NDHM_DOC], transactionId: "txn-JUNK-UNKNOWN", includeConsentId: false });
  assert.equal(res.status, 403);
  assert.deepEqual(await listBuffered(h.r2, "txn-JUNK-UNKNOWN"), [], "nothing buffered for the junk txn");
  assert.deepEqual(await listBuffered(h.r2, h.mock.transactionId), [], "the real txn's buffer is untouched too");
});

// ── 7. replayed older GRANTED after REVOKE → stays REVOKED (monotonic) → the data request is refused. ─────────
test("7. replayed GRANTED after REVOKE stays REVOKED → data request refused (monotonic consent-binding)", async () => {
  const h = await setup();
  const { requestId: reqC, consentId } = await driveConsentGranted(h);

  // REVOKE (echoing only the consentId — the durable join), then a replayed older GRANTED notify.
  const revoke = await h.mock.fireConsentNotify({ status: "REVOKED", requestId: undefined });
  assert.equal(revoke.status, 202);
  assert.equal((await getConsentReq(h.db, reqC)).status, "REVOKED");
  const replay = await h.mock.fireConsentNotify({ status: "GRANTED" });   // stale replay
  assert.equal(replay.status, 202, "accepted at the edge, but the transition is refused");
  assert.equal((await getConsentReq(h.db, reqC)).status, "REVOKED", "monotonic — never un-revoked");

  // the data request reloads the reconciled row FRESH → status REVOKED → fail-closed, no gateway hiRequest, no txn.
  await assert.rejects(() => dataRequest(h, consentId), PermissionError);
  assert.ok(!h.mock.calls.some((c) => c.endpointKey === "hiRequest"), "no hiRequest on a revoked consent");
  assert.equal((h.db._tables.connect_abdm_txn || []).length, 0, "no txn row on a refused data request");
});

// ── 8. flag OFF anywhere → the ingress 404s and mutates nothing. ──────────────────────────────────────────────
test("8. flag OFF → ingress 404, no side effects", async () => {
  const h = await setup({ env: { ...ENV, CONNECT_FLAG: "0" } });
  const { requestId } = await requestConsent(h.env, h.outDeps, consentReq());   // outbound isn't flag-gated here
  assert.equal((await getConsentReq(h.db, requestId)).status, "INITIATED");
  const n = await h.mock.fireConsentNotify();
  assert.equal(n.status, 404, "flag OFF → do not leak existence");
  assert.equal((await getConsentReq(h.db, requestId)).status, "INITIATED", "notify had no effect");
});
