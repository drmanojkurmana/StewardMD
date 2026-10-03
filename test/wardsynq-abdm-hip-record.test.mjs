// test/wardsynq-abdm-hip-record.test.mjs - the WardSynQ inpatient record as an ABDM HIP source (functions/_wardsynq/abdm-hip.js).
//
// The bundle contract is the NRCES NDHM FHIR R4 implementation guide, package ndhm.in 6.5.0:
//   https://nrces.in/ndhm/fhir/r4/
// Profiles pinned here: DischargeSummaryRecord, PrescriptionRecord, DiagnosticReportRecord, ImmunizationRecord,
// InvoiceRecord; Patient identifier types from CodeSystem ndhm-identifier-type-code; invoice codes from
// ndhm-billing-codes and ndhm-price-components.
//
// HIP-initiated linking follows ABDM M2 document v2.7 (12-08-2025) section 4.3:
//   https://sandboxcms.abdm.gov.in/uploads/M2_Document_12_08_2025_68d7081f79.pdf
//
// No network: every gateway call goes to a stubbed fetch or a recording gateway.
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  careContextsForStay, parseWardsynqRef, projectStayRecord, wardsynqHipSource, hipSourceFor,
  registerContexts, linkStayCareContexts, linkPendingAfterToken, SOURCE_ID,
} from "../functions/_wardsynq/abdm-hip.js";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { CONNECTOR_TYPE } from "../functions/_wardsynq/connectors.js";
import { dischargeSummaryIdFor } from "../functions/_wardsynq/migrate-discharge.js";
import { openInvoice } from "../wardsynq/wardsynq-invoice.js";
import { serializeNdhm, validateNdhmDoc, facilitySystemFor } from "../functions/_connect/connectors/abdm/serialize.js";
import { filterRecordByDateRange } from "../functions/_connect/abdm/hip.js";
import { assertDataBlind } from "../functions/_connect/abdm/carecontext.js";
import { putToken, getCachedToken } from "../functions/_connect/abdm/linktoken.js";
import { NDHM_BILLING, NDHM_PRICE } from "../functions/_connect/abdm/hip-sources/clinic-billing.js";
import { hmacPseudonym } from "../functions/_connect/audit.js";
import { makeAbdmDb } from "../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../functions/_connect/testkit.js";
// The v3 router imports cleanly under node (no Firestore at import time), so no module mocks are needed.
import { onGenerateToken } from "../functions/api/v3/[[path]].js";

const TENANT = "t1";
const HIP = "IN2810006668";
const ABHA = "ramesh@sbx";
const PID = "pat-1";
const ENC = "enc-ipd-1";
const NOW = "2026-09-16T10:00:00.000Z";
const FACILITY = { hfrId: HIP, name: "Sandbox General Hospital" };
const SNOMED = "http://snomed.info/sct";
const LOINC = "http://loinc.org";
const PROFILE = (n) => "https://nrces.in/ndhm/fhir/r4/StructureDefinition/" + n;
const NDHM_ID_TYPE = "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-identifier-type-code";
const HEALTH_ID = "https://healthid.ndhm.gov.in";
const GATEWAY = "https://dev.abdm.gov.in";

const ENV = Object.freeze({
  CONNECT_HMAC_SALT: Buffer.from("wardsynq-hip-record-test-salt-01").toString("base64"),
  CONNECT_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  ABDM_CLIENT_SECRET: "test-bridge-secret",
});

/* ---- the stay ---------------------------------------------------------------------------------------- */

const rec = (resourceType, body) => ({ resourceType, version: 1, patientId: PID, ...body });

function stayRecords(enc = ENC) {
  const encounter = rec("Encounter", { id: enc, class: "IPD", status: "finished", periodStart: "2026-09-01T08:00:00.000Z", periodEnd: "2026-09-10T10:00:00.000Z" });
  const patient = { resourceType: "Patient", id: PID, version: 1, name: "Ramesh Kumar", sex: "male", dob: "1980-05-02", mrn: "MRN-001",
    identifiers: [{ system: "abha-number", value: "91234567890123" }, { system: "abha-address", value: ABHA }] };
  const summary = rec("ClinicalNote", { id: dischargeSummaryIdFor(enc), encounterId: enc, noteType: "discharge-summary", signedBy: "doc-1",
    sections: { hospitalCourse: "Treated with antibiotics, improved.", dischargeAdvice: "Review in one week." } });
  const order = rec("MedicationOrder", { id: "mo-1", encounterId: enc, status: "active", drug: "Paracetamol", dose: { value: 500, unit: "mg" },
    route: "oral", frequency: "TDS", drugCode: "387517004", drugCodeSystem: "snomed" });
  const hb = rec("Observation", { id: "obs-hb", encounterId: enc, code: "718-7", codeSystem: "loinc", display: "Hemoglobin", value: 13.5, unit: "g/dL", category: "laboratory", effectiveAt: "2026-09-02T06:00:00.000Z" });
  const wbc = rec("Observation", { id: "obs-wbc", encounterId: enc, code: "6690-2", codeSystem: LOINC, display: "Leukocytes", value: 7.2, unit: "10*3/uL", category: "laboratory", effectiveAt: "2026-09-02T06:00:00.000Z" });
  const cbc = rec("DiagnosticReport", { id: "dr-cbc", encounterId: enc, status: "final", code: "Complete blood count", category: "laboratory", reportedAt: "2026-09-02T09:00:00.000Z", resultObservationIds: ["obs-hb", "obs-wbc"] });
  const crp = rec("Observation", { id: "obs-crp", encounterId: enc, code: "1988-5", codeSystem: "loinc", display: "C reactive protein", value: 42, unit: "mg/L", category: "laboratory", effectiveAt: "2026-09-03T06:00:00.000Z" });
  const crpReport = rec("DiagnosticReport", { id: "dr-crp", encounterId: enc, status: "corrected", code: "CRP", category: "laboratory", reportedAt: "2026-09-03T09:00:00.000Z", resultObservationIds: ["obs-crp"] });
  const prelim = rec("DiagnosticReport", { id: "dr-prelim", encounterId: enc, status: "preliminary", code: "Blood culture", reportedAt: "2026-09-04T09:00:00.000Z", resultObservationIds: [] });
  const imm = rec("Immunization", { id: "imm-1", encounterId: enc, status: "completed", vaccine: "Tetanus toxoid", vaccineCode: "333621002", vaccineCodeSystem: "snomed", occurredOn: "2026-09-02" });
  const invoice = rec("Invoice", openInvoice({ id: "inv-1", patientId: PID, encounterId: enc, currency: "INR", actorId: "cashier-1", at: "2026-09-10T09:00:00.000Z",
    lines: [{ code: "BED", display: "Ward bed", quantity: 3, amount: 1500, line: 4500 }] }));
  const condition = rec("Condition", { id: "cond-1", encounterId: enc, display: "Community acquired pneumonia", clinicalStatus: "active" });
  const allergy = rec("AllergyIntolerance", { id: "alg-1", substance: "Penicillin", criticality: "high" });
  return { encounter, patient, summary, orders: [order], observations: [hb, wbc, crp], reports: [cbc, crpReport, prelim], immunizations: [imm], invoices: [invoice], conditions: [condition], allergies: [allergy] };
}

/** The shape readStay returns, built directly for the pure parts. */
function stayOf(r = stayRecords()) {
  return { encounter: r.encounter, patient: r.patient, orders: r.orders, reports: r.reports, observations: r.observations, requests: [],
    notes: [r.summary], conditions: r.conditions, allergies: r.allergies, immunizations: r.immunizations, invoices: r.invoices, summary: r.summary };
}
const allRows = (r) => [r.patient, r.encounter, r.summary, ...r.orders, ...r.observations, ...r.reports, ...r.immunizations, ...r.invoices, ...r.conditions, ...r.allergies];

const CLINICAL_WORDS = ["paracetamol", "13.5", "7.2", "42", "hemoglobin", "pneumonia", "penicillin", "tetanus", "blood count", "4500", "antibiotics"];

async function serializeAll(s) {
  const out = {};
  for (const c of await careContextsForStay(s)) {
    const parsed = parseWardsynqRef(c.ref);
    assert.ok(parsed, "every offered ref parses back: " + c.ref);
    const record = await projectStayRecord(s, parsed, { tenantId: TENANT, now: () => NOW });
    assert.ok(record, "every offered context projects to a record: " + c.ref);
    const doc = serializeNdhm({ facility: FACILITY, envName: "sandbox", now: () => new Date(NOW) }, record);
    const v = validateNdhmDoc(doc);
    assert.deepEqual(v.errors, [], c.ref + " validates");
    assert.equal(v.ok, true);
    (out[c.kind] = out[c.kind] || []).push({ ctx: c, record, doc });
  }
  return out;
}
const comp = (doc) => doc.entry[0].resource;
const byType = (doc, t) => doc.entry.map((e) => e.resource).filter((r) => r.resourceType === t);
const resolve = (doc, ref) => (doc.entry.find((e) => e.fullUrl === ref.reference) || {}).resource;

/* ---- care contexts ----------------------------------------------------------------------------------- */

test("a finished IPD stay offers DS, RX, one DR per released report, IMM and INV, with data-blind displays", async () => {
  const ctxs = await careContextsForStay(stayOf());
  assert.deepEqual(ctxs.map((c) => c.kind), ["DS", "RX", "DR", "DR", "IMM", "INV"]);
  assert.deepEqual(ctxs.map((c) => c.hiType), ["DischargeSummary", "Prescription", "DiagnosticReport", "DiagnosticReport", "ImmunizationRecord", "Invoice"]);
  assert.equal(ctxs[0].ref, `IPD:${ENC}:DS`);
  assert.equal(ctxs[1].ref, `IPD:${ENC}:RX`);
  for (const c of ctxs) {
    assert.match(c.ref, /^IPD:enc-ipd-1:(DS|RX|IMM|DR-[0-9a-f]{10}|INV-[0-9a-f]{10})$/);
    assert.equal(assertDataBlind(c.display), c.display);
    assert.match(c.display, /^IPD records \(/);
    for (const w of CLINICAL_WORDS) assert.ok(!c.display.toLowerCase().includes(w), `display "${c.display}" leaks "${w}"`);
  }
  assert.equal(new Set(ctxs.map((c) => c.ref)).size, ctxs.length, "refs are unique");
});

test("an unsigned summary offers no DS context and a preliminary report offers no DR context", async () => {
  const r = stayRecords();
  r.summary = { ...r.summary, signedBy: null };
  r.reports = [r.reports[2]];                               // only the preliminary one
  const s = stayOf(r);
  const kinds = (await careContextsForStay(s)).map((c) => c.kind);
  assert.ok(!kinds.includes("DS"));
  assert.ok(!kinds.includes("DR"));
  assert.deepEqual(kinds, ["RX", "IMM", "INV"]);
  assert.equal(await projectStayRecord(s, parseWardsynqRef(`IPD:${ENC}:DS`), { tenantId: TENANT, now: () => NOW }), null, "an unsigned summary is never projected");
});

/* ---- the NRCES bundles ------------------------------------------------------------------------------- */

test("every care context serializes to a valid NRCES document with the profile, fixed type and section codes", async () => {
  const b = await serializeAll(stayOf());
  const profileOf = (k) => comp(b[k][0].doc).meta.profile[0];
  assert.equal(profileOf("DS"), PROFILE("DischargeSummaryRecord"));
  assert.equal(profileOf("RX"), PROFILE("PrescriptionRecord"));
  assert.equal(profileOf("DR"), PROFILE("DiagnosticReportRecord"));
  assert.equal(b.DR.length, 2);
  assert.equal(profileOf("IMM"), PROFILE("ImmunizationRecord"));
  assert.equal(profileOf("INV"), PROFILE("InvoiceRecord"));
  for (const k of Object.keys(b)) assert.equal(b[k][0].doc.type, "document");

  const typeCoding = (k) => comp(b[k][0].doc).type.coding[0];
  assert.deepEqual([typeCoding("DS").system, typeCoding("DS").code], [SNOMED, "373942005"]);
  assert.deepEqual([typeCoding("RX").system, typeCoding("RX").code], [SNOMED, "440545006"]);
  assert.deepEqual([typeCoding("IMM").system, typeCoding("IMM").code], [SNOMED, "41000179103"]);
  assert.deepEqual([typeCoding("DR").system, typeCoding("DR").code], [SNOMED, "721981007"]);
  assert.deepEqual(comp(b.INV[0].doc).type, { text: "Invoice Record" }, "InvoiceRecord fixes type.text only, no coding");

  // Composition.encounter is min=1 on DischargeSummaryRecord and resolves to the inpatient Encounter.
  const ds = b.DS[0].doc;
  const enc = resolve(ds, comp(ds).encounter);
  assert.equal(enc.resourceType, "Encounter");
  assert.equal(enc.class.code, "IMP");
  assert.equal(enc.status, "finished");

  const codeOf = (s) => (s.code ? s.code.coding[0].code : null);
  const dsSections = comp(ds).section;
  assert.deepEqual(dsSections.map(codeOf), ["1003642006", "722446000", null]);
  assert.deepEqual(dsSections.map((s) => s.title), ["Medical History", "Allergies", "Medications"]);
  // The DS DocumentReference section (373942005) is emitted only for a second, byte-carrying document; the signed
  // summary itself is the Composition narrative, so it is absent here.
  assert.ok(!dsSections.some((s) => codeOf(s) === "373942005"));
  assert.match(comp(ds).text.div, /Hospital Course: Treated with antibiotics/);
  assert.equal(resolve(ds, dsSections[0].entry[0]).resourceType, "Condition");
  assert.equal(resolve(ds, dsSections[1].entry[0]).resourceType, "AllergyIntolerance");

  const rx = comp(b.RX[0].doc).section;
  assert.equal(rx.length, 1);
  assert.equal(codeOf(rx[0]), "440545006");
  assert.equal(resolve(b.RX[0].doc, rx[0].entry[0]).resourceType, "MedicationRequest");

  const imm = comp(b.IMM[0].doc).section;
  assert.equal(imm.length, 1);
  assert.equal(codeOf(imm[0]), "41000179103");
  const immRes = resolve(b.IMM[0].doc, imm[0].entry[0]);
  assert.equal(immRes.resourceType, "Immunization");
  assert.equal(immRes.vaccineCode.coding[0].system, SNOMED);
  assert.equal(immRes.vaccineCode.coding[0].code, "333621002");
});

test("Patient carries HIN, ABHA and MR identifiers typed per ndhm-identifier-type-code", async () => {
  const b = await serializeAll(stayOf());
  for (const k of Object.keys(b)) {
    const [p] = byType(b[k][0].doc, "Patient");
    const typed = (code) => p.identifier.filter((i) => i.type.coding[0].code === code);
    const [hin] = typed("HIN");
    assert.ok(hin, k + " has HIN");
    assert.equal(hin.type.coding[0].system, NDHM_ID_TYPE);
    assert.equal(hin.system, HEALTH_ID);
    assert.equal(hin.value, "91-2345-6789-0123");
    const [abha] = typed("ABHA");
    assert.ok(abha, k + " has ABHA");
    assert.equal(abha.type.coding[0].system, NDHM_ID_TYPE);
    assert.equal(abha.system, HEALTH_ID);
    assert.equal(abha.value, ABHA);
    const [mr] = typed("MR");
    assert.ok(mr, k + " has MR");
    assert.equal(mr.value, "MRN-001");
    assert.equal(p.gender, "male");
    assert.equal(p.birthDate, "1980-05-02");
  }
});

test("custodian, author and attester all resolve to ONE HFR facility Organization", async () => {
  assert.equal(facilitySystemFor("sandbox"), "https://facilitysbx.ndhm.gov.in");
  const b = await serializeAll(stayOf());
  for (const k of Object.keys(b)) {
    const doc = b[k][0].doc, c = comp(doc);
    const orgs = byType(doc, "Organization");
    assert.equal(orgs.length, 1, k + " has exactly one Organization");
    assert.equal(byType(doc, "Device").length, 0, "a hospital's own record is not authored by the StewardMD device");
    const orgUrl = doc.entry.find((e) => e.resource === orgs[0]).fullUrl;
    assert.equal(c.custodian.reference, orgUrl);
    assert.equal(c.author.length, 1);
    assert.equal(c.author[0].reference, orgUrl);
    assert.ok(c.attester.length >= 1);
    for (const a of c.attester) assert.equal(a.party.reference, orgUrl);
    const id = orgs[0].identifier[0];
    assert.equal(id.system, "https://facilitysbx.ndhm.gov.in");
    assert.equal(id.value, HIP);
    assert.equal(id.type.coding[0].code, "PRN");
    assert.equal(orgs[0].name, FACILITY.name);
  }
});

test("DiagnosticReportRecord: observations are LOINC-coded; the report is final or corrected", async () => {
  const b = await serializeAll(stayOf());
  const statuses = [];
  for (const { doc } of b.DR) {
    const [dr] = byType(doc, "DiagnosticReport");
    statuses.push(dr.status);
    const obs = byType(doc, "Observation");
    assert.ok(obs.length >= 1, "the report's observations are in the bundle");
    for (const o of obs) assert.equal(o.code.coding[0].system, LOINC);
    // Every DiagnosticReport.result reference resolves inside the document.
    assert.equal((dr.result || []).length, obs.length);
    for (const r of dr.result) assert.equal(resolve(doc, r).resourceType, "Observation");
  }
  assert.deepEqual(statuses.sort(), ["corrected", "final"]);
});

test("InvoiceRecord: ndhm-billing-codes 02 type and ndhm-price-components 01 on every price component", async () => {
  assert.equal(NDHM_BILLING, "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-billing-codes");
  assert.equal(NDHM_PRICE, "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components");
  const b = await serializeAll(stayOf());
  const [inv] = byType(b.INV[0].doc, "Invoice");
  assert.equal(inv.type.coding[0].system, NDHM_BILLING);
  assert.equal(inv.type.coding[0].code, "02");
  assert.equal(inv.identifier[0].value, "inv-1");
  assert.equal(inv.status, "issued");
  assert.deepEqual(inv.totalNet, { value: 4500, currency: "INR" });
  assert.deepEqual(inv.totalGross, { value: 4500, currency: "INR" });
  assert.equal(inv.lineItem.length, 1);
  for (const li of inv.lineItem) for (const pc of li.priceComponent) {
    assert.equal(pc.code.coding[0].system, NDHM_PRICE);
    assert.equal(pc.code.coding[0].code, "01");
    assert.equal(pc.amount.currency, "INR");
  }
});

/* ---- the HIP source over a record store ------------------------------------------------------------- */

async function seededRepo(r = stayRecords(), connected = true) {
  const repo = new MemoryRepository();
  await repo.append(TENANT, allRows(r), {});
  if (connected) {
    await repo.append(TENANT, [{ resourceType: CONNECTOR_TYPE, id: "abdm", version: 1, active: true,
      settings: { hfrFacilityId: HIP, hipId: HIP, status: "sandbox-linked" } }], {});
  }
  return repo;
}
const depsOf = (repository) => ({ repository, pseudonym: async () => "pseudo" });

test("loadRecord serves the stay's record keyed by the ABHA address pseudonym, and refuses once the ABHA is gone", async () => {
  const r = stayRecords();
  const repo = await seededRepo(r, false);
  const source = wardsynqHipSource({ recordDepsFor: () => depsOf(repo), facilityFor: async () => FACILITY });
  assert.equal(source.id, SOURCE_ID);
  const ref = `IPD:${ENC}:DS`;
  const out = await source.loadRecord(ENV, {}, { tenantId: TENANT, careContextRef: ref });
  assert.equal(out.patientAbhaHash, await hmacPseudonym(ENV, TENANT, ABHA));
  assert.equal(out.hiType, "DischargeSummary");
  assert.equal(out.recordType, "DischargeSummaryRecord");
  assert.deepEqual(out.record.facility, FACILITY);
  const doc = serializeNdhm({ facility: out.record.facility, envName: "sandbox" }, out.record);
  assert.equal(validateNdhmDoc(doc).ok, true);
  assert.equal(comp(doc).meta.profile[0], PROFILE("DischargeSummaryRecord"));

  await assert.rejects(source.loadRecord(ENV, {}, { tenantId: TENANT, careContextRef: "OPD:visit-1" }), /not a WardSynQ care context/);

  // The patient's ABHA address is withdrawn from the record: a new Patient version without it.
  await repo.append(TENANT, [{ ...r.patient, version: 2, identifiers: [{ system: "abha-number", value: "91234567890123" }] }], {});
  await assert.rejects(source.loadRecord(ENV, {}, { tenantId: TENANT, careContextRef: ref }), /ABHA address/);
});

test("hipSourceFor routes a wardsynq-record context to the record and everything else to the fallback", async () => {
  const wsCalls = [], fbCalls = [];
  const wardsynq = { id: SOURCE_ID, hiTypes: ["DischargeSummary"], listCareContexts: async () => [], loadRecord: async (_e, _d, a) => { wsCalls.push(a.careContextRef); return { from: "wardsynq" }; } };
  const fallback = { id: "fb", hiTypes: ["OPConsultation"], listCareContexts: async () => [], loadRecord: async (_e, _d, a) => { fbCalls.push(a.careContextRef); return { from: "fallback" }; } };
  const db = makeAbdmDb({ connect_abdm_carecontext: [
    { id: "c1", tenant_id: TENANT, patient_abha_hash: "h", source: SOURCE_ID, ref: `IPD:${ENC}:DS`, hi_type: "DischargeSummary", display: "IPD records" },
    { id: "c2", tenant_id: TENANT, patient_abha_hash: "h", source: "consented-store", ref: "OPD:visit-9", hi_type: "OPConsultation", display: "OPD records" },
  ] });
  const composite = hipSourceFor(wardsynq, fallback);
  assert.deepEqual(composite.hiTypes.sort(), ["DischargeSummary", "OPConsultation"]);
  assert.deepEqual(await composite.loadRecord(ENV, { db }, { tenantId: TENANT, careContextRef: `IPD:${ENC}:DS` }), { from: "wardsynq" });
  assert.deepEqual(await composite.loadRecord(ENV, { db }, { tenantId: TENANT, careContextRef: "OPD:visit-9" }), { from: "fallback" });
  assert.deepEqual(await composite.loadRecord(ENV, { db }, { tenantId: TENANT, careContextRef: "OPD:unregistered" }), { from: "fallback" });
  // A wardsynq-shaped ref registered under ANOTHER tenant is not this tenant's record.
  assert.deepEqual(await composite.loadRecord(ENV, { db }, { tenantId: "t2", careContextRef: `IPD:${ENC}:DS` }), { from: "fallback" });
  assert.deepEqual(wsCalls, [`IPD:${ENC}:DS`]);
  assert.deepEqual(fbCalls, ["OPD:visit-9", "OPD:unregistered", `IPD:${ENC}:DS`]);
});

/* ---- linking ------------------------------------------------------------------------------------------ */

function stubFetch() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (url === GATEWAY + "/api/hiecm/gateway/v3/sessions") return new Response(JSON.stringify({ accessToken: "gw-session", expiresIn: 600 }), { status: 200 });
    return new Response("{}", { status: 202 });
  };
  return { calls, fetchImpl };
}
const envWith = (db, kv) => ({ ...ENV, CONNECT_DB: db, MAIK_KV: kv });

test("linkStayCareContexts: a hospital that is not connected links nothing and calls nobody", async () => {
  const repo = await seededRepo(stayRecords(), false);
  const db = makeAbdmDb(), kv = makeMockKv(), f = stubFetch();
  const out = await linkStayCareContexts(envWith(db, kv), { tenantId: TENANT, encounterId: ENC, recordDeps: depsOf(repo), trigger: "discharge", fetchImpl: f.fetchImpl, kv });
  assert.equal(out.state, "not-connected");
  assert.equal(out.reason, "not_set_up");
  assert.equal(f.calls.length, 0);
  assert.equal((db._tables.connect_abdm_carecontext || []).length, 0);
});

test("linkStayCareContexts without a cached token registers the contexts and requests a token by ABHA address only", async () => {
  const repo = await seededRepo();
  const db = makeAbdmDb(), kv = makeMockKv(), f = stubFetch();
  const out = await linkStayCareContexts(envWith(db, kv), { tenantId: TENANT, encounterId: ENC, recordDeps: depsOf(repo), trigger: "discharge", fetchImpl: f.fetchImpl, kv });
  assert.equal(out.state, "token-requested", JSON.stringify(out));
  assert.equal(out.registered, 6);
  const hash = await hmacPseudonym(ENV, TENANT, ABHA);
  const rows = db._tables.connect_abdm_carecontext;
  assert.equal(rows.length, 6);
  for (const row of rows) {
    assert.equal(row.source, SOURCE_ID);
    assert.equal(row.tenant_id, TENANT);
    assert.equal(row.patient_abha_hash, hash);
  }

  const gen = f.calls.filter((c) => c.url === GATEWAY + "/api/hiecm/v3/token/generate-token");
  assert.equal(gen.length, 1);
  assert.equal(gen[0].headers["X-HIP-ID"], HIP);
  assert.deepEqual(gen[0].body, { abhaAddress: ABHA, name: "Ramesh Kumar", gender: "M", yearOfBirth: 1980 });
  assert.ok(!("abhaNumber" in gen[0].body), "the token is requested without the ABHA number (FAQ Q32)");
  assert.equal(f.calls.filter((c) => /link\/carecontext/.test(c.url)).length, 0, "nothing is linked before the token arrives");

  const audits = db._tables.connect_audit_event || [];
  const req = audits.filter((a) => a.action === "abdm.hip.linktoken.requested");
  assert.equal(req.length, 1);
  assert.equal(req[0].patient_ref_hash, hash);
  assert.ok(!JSON.stringify(audits).includes(ABHA), "no raw ABHA reaches the audit table");

  // Registration is idempotent: a second run adds no rows.
  await linkStayCareContexts(envWith(db, kv), { tenantId: TENANT, encounterId: ENC, recordDeps: depsOf(repo), trigger: "summary-signed", fetchImpl: f.fetchImpl, kv });
  assert.equal(db._tables.connect_abdm_carecontext.length, 6);
});

test("linkStayCareContexts with a cached token links with X-LINK-TOKEN, one patient entry per HI type (M2 v2.7 4.3)", async () => {
  const repo = await seededRepo();
  const db = makeAbdmDb(), kv = makeMockKv(), f = stubFetch();
  const hash = await hmacPseudonym(ENV, TENANT, ABHA);
  await putToken({ kv, now: () => new Date().toISOString() }, { hipId: HIP, abhaHash: hash, token: "link-tok-1" });
  const out = await linkStayCareContexts(envWith(db, kv), { tenantId: TENANT, encounterId: ENC, recordDeps: depsOf(repo), trigger: "discharge", fetchImpl: f.fetchImpl, kv });
  assert.equal(out.state, "linked-requested", JSON.stringify(out));
  assert.equal(f.calls.filter((c) => /generate-token/.test(c.url)).length, 0);

  const link = f.calls.filter((c) => c.url === GATEWAY + "/api/hiecm/hip/v3/link/carecontext");
  assert.equal(link.length, 1);
  assert.equal(link[0].headers["X-LINK-TOKEN"], "link-tok-1");
  assert.equal(link[0].headers["X-HIP-ID"], HIP);
  const body = link[0].body;
  assert.deepEqual(Object.keys(body).sort(), ["abhaAddress", "patient"]);
  assert.equal(body.abhaAddress, ABHA);
  assert.ok(!JSON.stringify(body).includes("abhaNumber"));
  const hiTypes = body.patient.map((p) => p.hiType);
  assert.equal(new Set(hiTypes).size, hiTypes.length, "exactly one entry per hiType");
  assert.deepEqual([...hiTypes].sort(), ["DiagnosticReport", "DischargeSummary", "ImmunizationRecord", "Invoice", "Prescription"]);
  for (const p of body.patient) {
    assert.deepEqual(Object.keys(p).sort(), ["careContexts", "count", "display", "hiType", "referenceNumber"]);
    assert.equal(p.referenceNumber, hash);
    assert.equal(p.count, p.careContexts.length);
    for (const cc of p.careContexts) {
      assert.deepEqual(Object.keys(cc).sort(), ["display", "referenceNumber"]);
      assertDataBlind(cc.display);
    }
  }
  assert.equal(body.patient.find((p) => p.hiType === "DiagnosticReport").count, 2);
  assert.equal(body.patient.reduce((n, p) => n + p.count, 0), 6);
  assert.equal((db._tables.connect_audit_event || []).filter((a) => a.action === "abdm.hip.link.requested").length, 1);
});

test("linkPendingAfterToken links only the contexts that were waiting for the token", async () => {
  const r = stayRecords();
  const repo = await seededRepo(r);
  const db = makeAbdmDb(), kv = makeMockKv(), f = stubFetch();
  const env = envWith(db, kv);
  const first = await linkStayCareContexts(env, { tenantId: TENANT, encounterId: ENC, recordDeps: depsOf(repo), trigger: "discharge", fetchImpl: f.fetchImpl, kv });
  assert.equal(first.state, "token-requested");
  const pendingRefs = db._tables.connect_abdm_carecontext.map((row) => row.ref).sort();

  // A second stay's summary is registered later WITHOUT going through the pending list.
  const ENC2 = "enc-ipd-2";
  const s2 = { ...stayOf(r), encounter: { ...r.encounter, id: ENC2, periodStart: "2026-09-12T08:00:00.000Z", periodEnd: "2026-09-14T08:00:00.000Z" },
    summary: { ...r.summary, id: dischargeSummaryIdFor(ENC2), encounterId: ENC2 } };
  const hash = await hmacPseudonym(ENV, TENANT, ABHA);
  const c2 = await careContextsForStay(s2);
  assert.deepEqual(c2.map((c) => c.ref), [`IPD:${ENC2}:DS`]);
  assert.deepEqual(await registerContexts(env, db, { tenantId: TENANT, patientHash: hash, contexts: c2, now: NOW }), [`IPD:${ENC2}:DS`]);
  assert.equal(db._tables.connect_abdm_carecontext.length, 7);

  const posts = [];
  const gateway = { post: async (key, body, headers) => { posts.push({ key, body, headers }); return { status: 202, body: {}, requestId: "rq-1" }; } };
  const audits = [];
  const deps = { db, kv, gateway, audit: async (e) => { audits.push(e); } };
  const out = await linkPendingAfterToken(env, deps, { tenantId: TENANT, hipId: HIP, abhaAddress: ABHA, token: "lt-2" });
  assert.deepEqual(out, { linked: 6 });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].key, "linkCareContext");
  assert.deepEqual(posts[0].headers, { "X-LINK-TOKEN": "lt-2" });
  const linkedRefs = posts[0].body.patient.flatMap((p) => p.careContexts.map((c) => c.referenceNumber)).sort();
  assert.deepEqual(linkedRefs, pendingRefs);
  assert.ok(!linkedRefs.includes(`IPD:${ENC2}:DS`));
  for (const p of posts[0].body.patient) assert.equal(p.count, p.careContexts.length);
  assert.equal(audits.filter((a) => a.action === "abdm.hip.link.requested").length, 1);

  // The pending list is consumed: the same token again links nothing.
  assert.deepEqual(await linkPendingAfterToken(env, deps, { tenantId: TENANT, hipId: HIP, abhaAddress: ABHA, token: "lt-2" }), { linked: 0 });
  assert.equal(posts.length, 1);
});

test("pending-link tokens never look like a mobile number, and tokens parked in the old sha10 form still link", async () => {
  // sha10("IPD:enc-ipd-286:DS") is "9268680427": 10 digits from 6-9, which the KV PHI guard (MOBILE_EMBED) refuses.
  // Before the letter-mapped token, this stay's /ward/abdm-link-stay failed (502).
  const PHONE_ENC = "enc-ipd-286";
  const oldTok = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].slice(0, 5).map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await oldTok(`IPD:${PHONE_ENC}:DS`), "9268680427");

  const repo = await seededRepo(stayRecords(PHONE_ENC));
  const db = makeAbdmDb(), kv = makeMockKv(), f = stubFetch();
  const env = envWith(db, kv);
  const out = await linkStayCareContexts(env, { tenantId: TENANT, encounterId: PHONE_ENC, recordDeps: depsOf(repo), trigger: "discharge", fetchImpl: f.fetchImpl, kv });
  assert.equal(out.state, "token-requested", JSON.stringify(out));
  const hash = await hmacPseudonym(ENV, TENANT, ABHA);
  const key = `connect:abdm:linkpending:${HIP}:${hash}`;
  const parked = JSON.parse(await kv.get(key));
  assert.equal(parked.length, 6);
  for (const t of parked) assert.match(t, /^[a-p]{10}$/, "no digit survives, so no token reads as a phone number");

  const posts = [];
  const deps = { db, kv, gateway: { post: async (k, body, headers) => { posts.push({ k, body, headers }); return { status: 202, body: {}, requestId: "rq-1" }; } } };
  assert.deepEqual(await linkPendingAfterToken(env, deps, { tenantId: TENANT, hipId: HIP, abhaAddress: ABHA, token: "lt-1" }), { linked: 6 });

  // A pending list written before this change holds raw sha10 tokens; they still link.
  const refs = db._tables.connect_abdm_carecontext.map((row) => row.ref);
  await kv.put(key, JSON.stringify(await Promise.all(refs.map(oldTok))));
  assert.deepEqual(await linkPendingAfterToken(env, deps, { tenantId: TENANT, hipId: HIP, abhaAddress: ABHA, token: "lt-2" }), { linked: 6 });
  assert.equal(posts.length, 2);
});

/* ---- the on-generate-token callback ------------------------------------------------------------------ */

test("onGenerateToken caches the token under the tenant's pseudonym of the address and hands it to onLinkToken", async () => {
  const kv = makeMockKv();
  const db = makeAbdmDb({ connect_connector_config: [{ tenant_id: TENANT, connector_id: "abdm", config: JSON.stringify({ hipId: HIP }) }] });
  const seen = [], audits = [];
  const deps = { db, kv, now: () => NOW, audit: async (e) => { audits.push(e); }, onLinkToken: async (...a) => { seen.push(a); } };
  await onGenerateToken({ env: ENV, deps, headers: { entityId: HIP }, body: { abhaAddress: ` ${ABHA} `, linkToken: "lt-cb", response: { requestId: "rq-9" } } });
  const hash = await hmacPseudonym(ENV, TENANT, ABHA);
  assert.equal(await getCachedToken({ kv, now: () => NOW }, { hipId: HIP, abhaHash: hash }), "lt-cb");
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0][2], { tenantId: TENANT, hipId: HIP, abhaAddress: ABHA, token: "lt-cb" });
  assert.equal(audits.length, 0);

  // An unknown HIP ID resolves to no tenant: nothing is cached, nothing is linked, and it is audited as uncorrelated.
  const kv2 = makeMockKv();
  const deps2 = { ...deps, kv: kv2 };
  await onGenerateToken({ env: ENV, deps: deps2, headers: { entityId: "IN0000000000" }, body: { abhaAddress: ABHA, linkToken: "lt-x" } });
  assert.equal(await getCachedToken({ kv: kv2, now: () => NOW }, { hipId: "IN0000000000", abhaHash: hash }), null);
  assert.equal(seen.length, 1);
  assert.deepEqual(audits.map((a) => a.action), ["abdm.linktoken.uncorrelated"]);
});

/* ---- documents and medications carry a CLINICAL date, so the consent date window can place them -------- */

const MS = (iso) => Date.parse(iso);
const proj = (r, ref) => projectStayRecord(stayOf(r), parseWardsynqRef(ref), { tenantId: TENANT, now: () => NOW });

/** A stay whose summary was signed, order authored and invoice opened on known dates (9 and 10 Sep 2026). */
function datedStay() {
  const r = stayRecords();
  r.summary = { ...r.summary, signedAt: "2026-09-10T09:30:00.000Z" };
  r.orders = [{ ...r.orders[0], authoredAt: "2026-09-02T07:00:00.000Z" }];
  return r;
}

test("DS: the document is dated by the summary's signed time and the medication by its authored time, never the export instant", async () => {
  const rec = await proj(datedStay(), `IPD:${ENC}:DS`);
  assert.equal(rec.documents[0].date, "2026-09-10T09:30:00.000Z");
  assert.deepEqual(rec.documents[0].coversDates, ["2026-09-10T09:30:00.000Z"]);
  assert.equal(rec.medications[0].authoredOn, "2026-09-02T07:00:00.000Z");
  assert.notEqual(rec.documents[0].date, NOW, "NOW is the export instant");
  // a window that covers the stay keeps everything; the documents and medications are present in the filtered record
  const kept = filterRecordByDateRange(rec, MS("2026-09-01T00:00:00Z"), MS("2026-09-30T00:00:00Z"));
  assert.deepEqual([kept.record.documents.length, kept.record.medications.length, kept.anyKept], [1, 1, true]);
});

test("DS: a window that ends before the summary was signed drops the document, though the order was in it", async () => {
  const rec = await proj(datedStay(), `IPD:${ENC}:DS`);
  const { record } = filterRecordByDateRange(rec, MS("2026-09-01T00:00:00Z"), MS("2026-09-05T00:00:00Z"));
  assert.deepEqual(record.documents, []);
  assert.deepEqual(record.medications.map((m) => m.id), ["mo-1"]);
  assert.deepEqual(record.encounters, [], "the stay ended 10 Sep, so its encounter is out too");
});

test("last resorts are the record's own meta: order effectiveAt/recordedAt, summary recordedAt; with none the item is undated and dropped", async () => {
  const r = stayRecords();
  r.orders = [{ ...r.orders[0], id: "mo-eff", meta: { effectiveAt: "2026-09-03T00:00:00.000Z", recordedAt: "2026-09-04T00:00:00.000Z" } },
              { ...r.orders[0], id: "mo-rec", meta: { recordedAt: "2026-09-04T00:00:00.000Z" } },
              { ...r.orders[0], id: "mo-none" }];
  r.summary = { ...r.summary, meta: { recordedAt: "2026-09-10T11:00:00.000Z" } };
  const rec = await proj(r, `IPD:${ENC}:DS`);
  assert.deepEqual(rec.medications.map((m) => [m.id, m.authoredOn]), [["mo-eff", "2026-09-03T00:00:00.000Z"], ["mo-rec", "2026-09-04T00:00:00.000Z"], ["mo-none", null]]);
  assert.equal(rec.documents[0].date, "2026-09-10T11:00:00.000Z");
  const { record } = filterRecordByDateRange(rec, MS("2026-09-01T00:00:00Z"), MS("2026-09-30T00:00:00Z"));
  assert.deepEqual(record.medications.map((m) => m.id), ["mo-eff", "mo-rec"], "an undated order is dropped, not served on the export time");
  // an unsigned-time, unrecorded summary is undated and dropped too
  const bare = await proj({ ...stayRecords() }, `IPD:${ENC}:DS`);
  assert.equal(bare.documents[0].date, null);
  assert.deepEqual(filterRecordByDateRange(bare, MS("2026-09-01T00:00:00Z"), MS("2026-09-30T00:00:00Z")).record.documents, []);
});

test("RX: the prescription narrative lists every order, so it is dropped when any listed order is outside the window; in-range orders stay", async () => {
  const r = stayRecords();
  r.orders = [{ ...r.orders[0], id: "mo-a", authoredAt: "2026-09-02T00:00:00.000Z" }, { ...r.orders[0], id: "mo-b", drug: "Amoxicillin", authoredAt: "2026-09-08T00:00:00.000Z" }];
  const rec = await proj(r, `IPD:${ENC}:RX`);
  assert.equal(rec.documents[0].date, "2026-09-08T00:00:00.000Z", "dated by the latest order it lists");
  const whole = filterRecordByDateRange(rec, MS("2026-09-01T00:00:00Z"), MS("2026-09-30T00:00:00Z")).record;
  assert.deepEqual([whole.documents.length, whole.medications.length], [1, 2]);
  const part = filterRecordByDateRange(rec, MS("2026-09-05T00:00:00Z"), MS("2026-09-30T00:00:00Z")).record;
  assert.deepEqual(part.medications.map((m) => m.id), ["mo-b"]);
  assert.deepEqual(part.documents, [], "the narrative also names mo-a, which is outside, so it is not served");
  assert.ok(!JSON.stringify(part.medications).includes("Paracetamol"));
});

test("DR, IMM, INV: each narrative is dated by its own clinical date (report time, vaccination day, invoice opening), not the export instant", async () => {
  const r = datedStay();
  const drRefs = (await careContextsForStay(stayOf(r))).filter((c) => c.kind === "DR").map((c) => c.ref);   // cbc, then crp (report order)
  for (const [ref, when] of [[drRefs[0], "2026-09-02T09:00:00.000Z"], [drRefs[1], "2026-09-03T09:00:00.000Z"]]) {
    assert.equal((await proj(r, ref)).documents[0].date, when);
  }
  assert.equal((await proj(r, `IPD:${ENC}:IMM`)).documents[0].date, "2026-09-02T00:00:00.000Z");
  const invRef = (await careContextsForStay(stayOf(r))).find((c) => c.kind === "INV").ref;
  assert.equal((await proj(r, invRef)).documents[0].date, "2026-09-10T09:00:00.000Z");
  // every kind, end to end through the real builder AND the real serializer, still validates with the filter applied
  for (const c of await careContextsForStay(stayOf(r))) {
    const rec = await proj(r, c.ref);
    const { record, anyKept } = filterRecordByDateRange(rec, MS("2026-09-01T00:00:00Z"), MS("2026-09-30T00:00:00Z"));
    assert.equal(anyKept, true, c.ref);
    assert.ok(record.documents.length === 1, c.ref + " keeps its dated narrative");
    const v = validateNdhmDoc(serializeNdhm({ facility: FACILITY, envName: "sandbox", now: () => new Date(NOW) }, record));
    assert.deepEqual(v.errors, [], c.ref);
  }
});

test("an ED visit: the consultation narrative is dated by its notes, and an out-of-window note drops it", async () => {
  const r = stayRecords();
  r.encounter = { ...r.encounter, class: "ED", id: "enc-ed-1" };
  const s = { ...stayOf(r), notes: [rec("ClinicalNote", { id: "n1", encounterId: "enc-ed-1", noteType: "ed-note", sections: { hpi: "Chest pain" }, signedAt: "2026-09-02T08:00:00.000Z" }),
                                    rec("ClinicalNote", { id: "n2", encounterId: "enc-ed-1", noteType: "ed-note", sections: { hpi: "Better" }, meta: { recordedAt: "2026-09-09T08:00:00.000Z" } })],
              orders: [], conditions: [] };
  const record = await projectStayRecord(s, parseWardsynqRef("OPD:enc-ed-1:OPC"), { tenantId: TENANT, now: () => NOW });
  assert.equal(record.documents[0].date, "2026-09-09T08:00:00.000Z");
  assert.equal(filterRecordByDateRange(record, MS("2026-09-01T00:00:00Z"), MS("2026-09-30T00:00:00Z")).record.documents.length, 1);
  assert.deepEqual(filterRecordByDateRange(record, MS("2026-09-05T00:00:00Z"), MS("2026-09-30T00:00:00Z")).record.documents, []);
});
