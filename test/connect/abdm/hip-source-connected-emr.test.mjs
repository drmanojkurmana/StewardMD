// The connected-EMR HIP source - hospitals that already run an EMR. Records are fetched through the
// connector at request time, never copied. The things that matter: we only ever share ONE encounter, an
// upstream failure is never reported as "no records", and the subject comes from our correlation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectedEmrSource, hiTypesForEncounter, sliceBundleToEncounter, EmrUnavailable, NoPatientBinding,
} from "../../../functions/_connect/abdm/hip-sources/connected-emr.js";

const HASH_A = "a".repeat(64);

// A whole-patient bundle as a connector would normalize it: two encounters, resources tagged by encounter.
const FULL = {
  patient: { id: "MRN-1", name: null },
  encounters: [
    { id: "enc-1", class: { code: "AMB" }, period: { start: "2026-03-03" } },
    { id: "enc-2", class: { code: "IMP" }, period: { start: "2026-04-01" } },
  ],
  conditions: [{ id: "c1", encounter: "enc-2" }],
  medications: [{ id: "m1", encounter: "enc-1" }],
  observations: [{ id: "o1", encounter: "enc-2" }],
  diagnosticReports: [],
  documents: [{ id: "d1", encounter: "enc-1" }],
  meta: { sourceConnector: "ghis" },
};

const TENANT = { id: "t1", mode: "sandbox", connectorId: "ghis", granted_scopes: '["Patient","Encounter"]' };

function depsFor({ bundle = FULL, patientRef = "MRN-1", failFetch = false } = {}) {
  return {
    db: {
      prepare: () => ({
        bind: () => ({
          first: async () => (patientRef ? { tenant_id: "t1", patient_abha_hash: HASH_A, patient_ref: patientRef } : null),
        }),
      }),
    },
    connectors: {
      ghis: {
        fetchPatient: async () => { if (failFetch) throw new Error("upstream 503"); return { raw: true }; },
        normalize: async () => bundle,
      },
    },
    fetch: async () => ({ ok: true }),
    tenant: TENANT,
    patientAbhaHash: HASH_A,
    now: () => new Date("2026-08-18T00:00:00Z"),
  };
}

// loadConnectorConfig reads the db; stub it by making the db return a config row for that query too.
function depsWithConfig(over = {}) {
  const d = depsFor(over);
  const patientRow = { tenant_id: "t1", patient_abha_hash: HASH_A, patient_ref: over.patientRef ?? "MRN-1" };
  d.db = {
    prepare: (sql) => ({
      bind: () => ({
        // the ABHA binding is read with .first()
        first: async () => (/connect_abha_link/.test(sql) && over.patientRef !== null ? patientRow : null),
        // loadConnectorConfig reads connect_connector_config with .all()
        all: async () => ({ results: [{ connector_id: "ghis", secret_ref: null, tenant_id: "t1" }] }),
      }),
    }),
  };
  return d;
}

const ENV = { CONNECT_MASTER_KEY: Buffer.alloc(32, 3).toString("base64") };

// ── pure helpers ────────────────────────────────────────────────────────────────────────────────────
test("HI types are judged per encounter, not per patient", () => {
  assert.deepEqual(hiTypesForEncounter(FULL, "enc-1"), ["OPConsultation", "Prescription"]);
  assert.deepEqual(hiTypesForEncounter(FULL, "enc-2"), ["OPConsultation", "DiagnosticReport"]);
  assert.deepEqual(hiTypesForEncounter({ encounters: [] }, "enc-9"), []);
});

test("slicing keeps ONLY the requested encounter's resources - no over-sharing", () => {
  const s = sliceBundleToEncounter(FULL, "enc-1");
  assert.deepEqual(s.encounters.map((e) => e.id), ["enc-1"]);
  assert.deepEqual(s.medications.map((m) => m.id), ["m1"]);
  assert.deepEqual(s.documents.map((d) => d.id), ["d1"]);
  assert.deepEqual(s.conditions, [], "enc-2's condition must not leak into an enc-1 request");
  assert.deepEqual(s.observations, [], "enc-2's observation must not leak into an enc-1 request");
});

// ── discovery ───────────────────────────────────────────────────────────────────────────────────────
test("each EMR encounter becomes one care context, OP and IP labelled correctly", async () => {
  const ccs = await connectedEmrSource.listCareContexts(ENV, depsWithConfig(), { tenantId: "t1", patientAbhaHash: HASH_A });
  assert.equal(ccs.length, 2);
  assert.equal(ccs[0].referenceNumber, "OPD:enc-1");
  assert.match(ccs[0].display, /^OPD records \(Consultation, Prescription\) from 3 March 2026$/);
  assert.equal(ccs[1].referenceNumber, "IPD:enc-2");
  assert.match(ccs[1].display, /^IPD records/);
});

test("a patient we hold no ABHA binding for yields [] - not an error, we just do not know them here", async () => {
  const ccs = await connectedEmrSource.listCareContexts(ENV, depsWithConfig({ patientRef: null }), { tenantId: "t1", patientAbhaHash: HASH_A });
  assert.deepEqual(ccs, []);
});

test("no pseudonym or no tenant context yields [] rather than a blind fetch", async () => {
  assert.deepEqual(await connectedEmrSource.listCareContexts(ENV, depsWithConfig(), { tenantId: "t1" }), []);
  assert.deepEqual(await connectedEmrSource.listCareContexts(ENV, { db: {} }, { tenantId: "t1", patientAbhaHash: HASH_A }), []);
});

test("an encounter with nothing attached is not advertised", async () => {
  const bundle = { ...FULL, encounters: [{ id: "empty-1", class: { code: "AMB" }, period: { start: "2026-03-03" } }],
    conditions: [], medications: [], observations: [], diagnosticReports: [], documents: [] };
  const ccs = await connectedEmrSource.listCareContexts(ENV, depsWithConfig({ bundle }), { tenantId: "t1", patientAbhaHash: HASH_A });
  assert.deepEqual(ccs, []);
});

test("an EMR that is down raises EmrUnavailable - never an empty list", async () => {
  // Reporting [] here would tell the patient "this hospital has no records for me", which is false.
  await assert.rejects(
    () => connectedEmrSource.listCareContexts(ENV, depsWithConfig({ failFetch: true }), { tenantId: "t1", patientAbhaHash: HASH_A }),
    (e) => e instanceof EmrUnavailable && /upstream 503/.test(e.message));
});

// ── loading ─────────────────────────────────────────────────────────────────────────────────────────
test("loadRecord returns only the requested encounter, bound to our own subject", async () => {
  const out = await connectedEmrSource.loadRecord(ENV, depsWithConfig(), { tenantId: "t1", careContextRef: "OPD:enc-1" });
  assert.equal(out.patientAbhaHash, HASH_A);
  assert.equal(out.hiType, "OPConsultation");
  assert.deepEqual(out.record.encounters.map((e) => e.id), ["enc-1"]);
  assert.deepEqual(out.record.conditions, []);
});

test("the subject is never taken from the request - only from our correlation", async () => {
  const d = depsWithConfig();
  delete d.patientAbhaHash;
  await assert.rejects(
    () => connectedEmrSource.loadRecord(ENV, d, { tenantId: "t1", careContextRef: "OPD:enc-1" }),
    /no subject pseudonym/);
});

test("an encounter that has vanished from the EMR is reported, not served empty", async () => {
  await assert.rejects(
    () => connectedEmrSource.loadRecord(ENV, depsWithConfig(), { tenantId: "t1", careContextRef: "OPD:gone-9" }),
    (e) => e instanceof EmrUnavailable && /no longer present/.test(e.message));
});

test("an unparseable reference is refused", async () => {
  await assert.rejects(
    () => connectedEmrSource.loadRecord(ENV, depsWithConfig(), { tenantId: "t1", careContextRef: "garbage" }),
    /unparseable care context/);
});

test("a patient with no binding cannot be loaded even if a reference is guessed", async () => {
  await assert.rejects(
    () => connectedEmrSource.loadRecord(ENV, depsWithConfig({ patientRef: null }), { tenantId: "t1", careContextRef: "OPD:enc-1" }),
    (e) => e instanceof NoPatientBinding);
});

test("an unregistered connector is a configuration failure, not a silent empty serve", async () => {
  const d = depsWithConfig();
  d.connectors = {};
  await assert.rejects(
    () => connectedEmrSource.loadRecord(ENV, d, { tenantId: "t1", careContextRef: "OPD:enc-1" }),
    (e) => e instanceof EmrUnavailable && /not registered/.test(e.message));
});
