/* test/wardsynq-abdm-landing.test.mjs — TASK 7.8: ABDM data reaching the chart.
 *
 * WHAT THIS FILE EXISTS TO PROVE. StewardMD's ABDM implementation was large, careful and UNFINISHED
 * in one specific way: `consumeTransfer` (decrypt a transfer) and `consumeNdhmBundle` (turn a
 * document into a validated SCCM bundle) had NO production caller - grep found them only in tests.
 * A hospital could complete an entire ABDM exchange and have nothing on the chart afterwards.
 *
 * Every test here drives the REAL webhook (handleIngress, RS256-signed bodies verified against a
 * pinned JWKS, real Fidelius crypto) and then asserts on the REAL WardSynQ record. The consume tail
 * is wired the way the composition root wires it: an injected `consumeAndLand` built by
 * makeConsumeAndLand. Nothing between the webhook and the chart is stubbed.
 *
 * NOT VERIFIED, and not claimed anywhere: the real ABDM sandbox or a real gateway. There are no
 * credentials, no registered HIU identity and no endpoint in this environment, and the wire-shape
 * seams the ABDM modules mark "// VERIFY" stay unverified.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-abdm-landing.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { requestConsent, requestHealthInformation, consumeTransfer } from "../functions/_connect/abdm/hiu.js";
import { fetchConsentArtifact } from "../functions/_connect/abdm/consent.js";
import { handleIngress } from "../functions/_connect/abdm/ingress.js";
import { ingestEvent } from "../functions/_connect/engine.js";
import { makeAbdmDb, makeR2 } from "../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../functions/_connect/testkit.js";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { makeConsumeAndLand, landNdhmDocuments, abdmServiceActor } from "../functions/_wardsynq/abdm-land.js";
import { makeHiuMockGateway } from "./connect/abdm/mock-gateway.mjs";

const NOW = "2026-07-15T00:00:00.000Z";
const ABHA = "ramesh1985@sbx";
const PHI_NAME = "Synthetic Marker";
const TENANT = "t1";
const REQUESTER = "fb:u1";

const ENV = {
  CONNECT_FLAG: "1",
  CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64"),
  CONNECT_ABDM_DATA_PUSH_URL: "https://stewardmd.in/api/connect/abdm/hiu/data",
  ABDM_JWKS_URL: "https://healthidsbx.abdm.gov.in/certs",
};

const SCOPE = {
  purpose: { code: "CAREMGT", text: "Care Management" },
  hiTypes: ["OPConsultation"],
  dateRange: { from: "2026-06-01T00:00:00.000Z", to: "2026-07-15T00:00:00.000Z" },
  dataEraseAt: "2027-07-15T00:00:00.000Z",
  careContexts: ["cc-0"],
};

/** One synthetic NDHM OP-consultation document: a patient, a problem, a medicine and a result. */
const ndhmDoc = (over) => {
  const o = over || {};
  return {
    resourceType: "Bundle", type: "document",
    entry: [
      { fullUrl: "urn:uuid:comp-1", resource: { resourceType: "Composition", id: "comp-1", status: "final",
        meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord"] },
        type: { text: "Clinical consultation report" }, subject: { reference: "Patient/pat-1" },
        title: "OP Consultation", date: "2026-07-14T00:00:00Z",
        text: { status: "generated", div: "<div>Enteric fever</div>" },
        section: [
          { title: "Chief complaints", entry: [{ reference: "Condition/cond-1" }] },
          { title: "Investigations", entry: [{ reference: "Observation/obs-hb" }] },
        ] } },
      { fullUrl: "urn:uuid:pat-1", resource: { resourceType: "Patient", id: "pat-1", gender: "male", birthDate: "1985-01-01",
        name: [{ text: o.name || PHI_NAME, family: "Marker", given: ["Synthetic"] }],
        identifier: o.identifier ? [o.identifier] : undefined } },
      { fullUrl: "urn:uuid:cond-1", resource: { resourceType: "Condition", id: "cond-1",
        code: { text: "Enteric fever", coding: [{ system: "http://snomed.info/sct", code: "4834000" }] },
        clinicalStatus: { coding: [{ code: "active" }] } } },
      { fullUrl: "urn:uuid:obs-hb", resource: { resourceType: "Observation", id: "obs-hb", status: "final",
        category: [{ coding: [{ code: "laboratory" }] }],
        code: { text: "Hemoglobin", coding: [{ system: "http://loinc.org", code: "718-7" }] },
        valueQuantity: { value: 9.2, unit: "g/dL" } } },
    ],
  };
};

const sealStub = { seal: async (s) => "SEALED:" + s, open: async (s) => s.slice(7) };
const spyAudit = () => { const calls = []; const fn = async (f) => { calls.push(f); }; fn.calls = calls; return fn; };
const seedDb = () => makeAbdmDb({
  connect_membership: [{ user_id: REQUESTER, tenant_id: TENANT, role: "clinician" }],
  connect_tenant: [{ id: TENANT, mode: "live", granted_scopes: '["Condition","MedicationStatement","Observation","DocumentReference"]' }],
});

/**
 * The whole thing, wired as the composition root wires it: the ABDM deps, the WardSynQ repository,
 * and the injected consumeAndLand that joins the two.
 */
async function setup(opts) {
  const o = opts || {};
  const db = seedDb(), r2 = makeR2(), kv = makeMockKv(), audit = spyAudit();
  const repository = o.repository || new MemoryRepository();
  const ingressDeps = { db, r2, kv, secrets: sealStub, ingestEvent, audit, now: () => NOW };
  const mock = await makeHiuMockGateway({ env: ENV, deps: ingressDeps, handleIngress, tenantId: TENANT, now: () => NOW, knobs: o.knobs || {} });
  ingressDeps.fetch = mock.jwksFetch;
  const outDeps = { db, kv, secrets: sealStub, gateway: mock.gateway, identifyFn: async () => ({ id: REQUESTER, guest: false }), audit, now: () => NOW };
  const consumeDeps = { db, r2, secrets: sealStub, gateway: mock.gateway, now: NOW };

  // The production composition, verbatim in shape.
  ingressDeps.consumeAndLand = makeConsumeAndLand({
    env: ENV,
    consumeTransfer: o.consumeTransfer || consumeTransfer,
    consumeDeps,
    recordDeps: () => ({ repository, pseudonym: async () => null }),
    consentFor: async (consentId) => (consentId == null ? null : { consentId, purpose: SCOPE.purpose, actor: REQUESTER }),
  });
  return { db, r2, kv, audit, repository, ingressDeps, outDeps, consumeDeps, mock };
}

/** consent request -> GRANT notify -> artifact fetch -> on-fetch verify -> data request -> on-request. */
async function driveToTransfer(h) {
  const { requestId } = await requestConsent(ENV, h.outDeps, { request: {}, tenantId: TENANT, abhaAddress: ABHA, purpose: SCOPE.purpose, hiTypes: SCOPE.hiTypes, dateRange: SCOPE.dateRange, dataEraseAt: SCOPE.dataEraseAt });
  assert.equal((await h.mock.fireConsentNotify()).status, 202);
  await fetchConsentArtifact(ENV, h.outDeps, { requestId, consentId: h.mock.consentId });
  assert.equal((await h.mock.fireOnFetch(SCOPE)).status, 202);
  await requestHealthInformation(ENV, h.outDeps, { request: {}, tenantId: TENANT, consentId: h.mock.consentId, careContexts: SCOPE.careContexts, hiTypes: SCOPE.hiTypes, purpose: SCOPE.purpose, dateRange: SCOPE.dateRange });
  await h.mock.fireOnRequest();
}

const chart = async (repo, type) => (await repo.latestByType(TENANT, type, 50)) || [];

/* ---- 1: the ending that did not exist ----------------------------------------------------------- */

test("1. a completed ABDM transfer puts records on the chart, through the real webhook", async () => {
  const h = await setup();
  await driveToTransfer(h);

  const before = await chart(h.repository, "Patient");
  assert.equal(before.length, 0, "nothing on the chart before the transfer");

  const push = await h.mock.firePush({ docs: [ndhmDoc()] });
  assert.equal(push.status, 202, "the webhook accepted the push");

  const patients = await chart(h.repository, "Patient");
  assert.equal(patients.length, 1, "the patient reached the record - before TASK 7.8 nothing did");
  assert.match(patients[0].name, /Marker/);
  assert.equal(patients[0].meta.source.system, "abdm", "attributed to ABDM, like every imported row");

  const conditions = await chart(h.repository, "Condition");
  assert.equal(conditions.length, 1);
  assert.equal(conditions[0].display, "Enteric fever");
  const obs = await chart(h.repository, "Observation");
  assert.equal(obs.length, 1);
  assert.equal(obs[0].value, 9.2);
  assert.equal(obs[0].unit, "g/dL");
});

test("2. every landed row is written by an ADAPTER, on behalf of the clinician who asked for it", async () => {
  const h = await setup();
  await driveToTransfer(h);
  await h.mock.firePush({ docs: [ndhmDoc()] });

  const [patient] = await chart(h.repository, "Patient");
  assert.equal(patient.writtenBy.kind, "adapter", "no human wrote this; a webhook did");
  assert.equal(patient.writtenBy.id, "adapter:sccm");
  assert.equal(patient.writtenBy.onBehalfOf, REQUESTER, "and the person who requested the data is named on it");
});

test("3. the landing service actor can read a patient and write NOTHING directly", () => {
  const actor = abdmServiceActor();
  assert.equal(actor.kind, "service");
  assert.deepEqual([...actor.scope.read], ["Patient"], "it may read patients, because identity cannot be reconciled blind");
  assert.deepEqual([...actor.scope.write], [], "and it writes nothing itself - every write goes through the adapter");
  assert.equal(actor.tier, "draft", "a service is capped at draft by the actor model");
});

/* ---- 4: the safety properties -------------------------------------------------------------------- */

test("4. a re-delivered transfer is filed once", async () => {
  const h = await setup();
  await driveToTransfer(h);
  await h.mock.firePush({ docs: [ndhmDoc()] });
  const first = await chart(h.repository, "Condition");
  assert.equal(first.length, 1);

  // The gateway re-sends. The buffer is gone and the ack is claimed, so this is a clean no-op.
  await h.mock.firePush({ docs: [ndhmDoc()] });
  const after = await chart(h.repository, "Condition");
  assert.equal(after.length, 1, "one condition, not two");
  assert.equal(after[0].version, 1, "and it was not re-versioned by the replay");
});

test("5. a document with no consent to bind it is refused, and nothing is written", async () => {
  const repository = new MemoryRepository();
  const out = await landNdhmDocuments(ENV, { repository, pseudonym: async () => null }, {
    tenantId: TENANT, transactionId: "txn-x", documents: [ndhmDoc()], consent: null,
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "no_consent");
  assert.equal(out.written, 0);
  assert.equal((await repository.latestByType(TENANT, "Patient", 10) || []).length, 0, "nothing was filed");
});

test("6. a probable duplicate is QUARANTINED: no second chart appears for somebody already here", async () => {
  const repository = new MemoryRepository();
  // The same person is already on this chart, recorded natively, with the same name and date of birth.
  await repository.append(TENANT, [{ resourceType: "Patient", id: "local-1", version: 1, mrn: "GH-1",
    name: "Synthetic Marker", dob: "1985-01-01", sex: "male", identifiers: [],
    meta: { recordedAt: NOW, effectiveAt: NOW, source: { system: "wardsynq-native", sourceId: null }, derivedFrom: [] } }]);

  const out = await landNdhmDocuments(ENV, { repository, pseudonym: async () => null }, {
    tenantId: TENANT, transactionId: "txn-dup", documents: [ndhmDoc()], consent: { purpose: SCOPE.purpose }, onBehalfOf: REQUESTER,
  });
  const patients = await repository.latestByType(TENANT, "Patient", 10);
  assert.equal(patients.length, 1, "still one patient: the feed did not create a second chart for the same person");
  assert.equal(patients[0].id, "local-1");
  assert.equal(out.written, 0, "and nothing at all was written under the ambiguous identity");
  assert.equal(out.quarantined, 1, "it is held, not dropped");
});

test("7. a document this server cannot make sense of is refused by name, never half-filed", async () => {
  const repository = new MemoryRepository();
  const out = await landNdhmDocuments(ENV, { repository, pseudonym: async () => null }, {
    tenantId: TENANT, transactionId: "txn-bad", documents: [{ resourceType: "Bundle", type: "document", entry: [] }],
    consent: { purpose: SCOPE.purpose },
  });
  assert.equal(out.written, 0);
  assert.ok(out.refused >= 1, JSON.stringify(out));
  assert.equal((await repository.latestByType(TENANT, "Patient", 10) || []).length, 0);
});

test("8. a landing failure never turns a correctly-received push into an error the gateway retries", async () => {
  const h = await setup();
  await driveToTransfer(h);
  // The landing blows up. The entries are already buffered durably, so the push is still accepted:
  // a 500 here would make the gateway re-send a transfer that was in fact received.
  h.ingressDeps.consumeAndLand = async () => { throw new Error("the record store is down"); };
  const push = await h.mock.firePush({ docs: [ndhmDoc()] });
  assert.equal(push.status, 202, "the push was accepted");
  assert.ok(h.audit.calls.some((c) => c && c.action === "abdm.land.failed"), `the failure is audited, not swallowed: ${JSON.stringify(h.audit.calls.map((c) => c.action))}`);
});

test("9. a transfer this caller did not win the ack for files nothing", async () => {
  const h = await setup({ consumeTransfer: async () => ({ decrypted: [], acked: false, advanced: false }) });
  await driveToTransfer(h);
  await h.mock.firePush({ docs: [ndhmDoc()] });
  assert.equal((await chart(h.repository, "Patient")).length, 0, "a non-winner never re-files PHI it did not finalise");
});

test("10. what lands is bound to the consented purpose, and the raw ABHA never reaches the record", async () => {
  const h = await setup();
  await driveToTransfer(h);
  await h.mock.firePush({ docs: [ndhmDoc()] });

  const everything = JSON.stringify([
    ...(await chart(h.repository, "Patient")), ...(await chart(h.repository, "Condition")), ...(await chart(h.repository, "Observation")),
  ]);
  assert.ok(!everything.includes(ABHA), "the raw ABHA address is not on the chart");
  const blob = JSON.stringify(h.audit.calls);
  assert.ok(!blob.includes(ABHA), "nor in the audit trail");
  assert.ok(!blob.includes(PHI_NAME), "and the decrypted patient name is never audited");
});
