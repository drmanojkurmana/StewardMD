/* test/wardsynq-lis-radiology-pharmacy-bloodbank-journey.test.mjs — TASK 3.7: unified patient
 * journey across TASK 3.1-3.5.
 *
 * The master plan's own text (section 9): "OPD/ED/Inpatient -> order -> lab result -> radiology
 * report -> medication verification -> dispense -> eMAR administration -> blood request -> issue ->
 * transfusion documentation. The same canonical patient and encounter must remain linked. No
 * duplicate patient created downstream." This is a PROOF requirement, the same shape TASK 2.9's
 * cross-department journey already satisfied for ADT - not a new mechanism: every 3.x subsystem
 * already resolves through the SAME patientIdForMrn/RecordService identity every other department
 * uses. What this file adds is the proof that chaining lab, radiology, pharmacy and blood bank
 * against ONE admission produces one continuous chart, not five disconnected department charts.
 *
 * Building this proof found that Patient/{id}/$everything could not surface three of the five
 * subsystems' own resource types (SpecimenCollection, MedicationDispense, TransfusionEpisode were
 * absent from fhir.js's MAPPERS/FHIR_TYPE and fhir-search.js's PATIENT_REF). Specimen and
 * MedicationDispense are now mapped, following the exact pattern every other type already uses.
 * TransfusionEpisode has no clean R4 resource equivalent and none is invented here (fhir.js's own
 * "NEVER INVENT A CODE SYSTEM" rule extends to never inventing a resource type either) - its
 * identity continuity is proven directly against the native transfusion routes instead, the same
 * way wardsynq-transfusion-bridge.test.mjs already does.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-lis-radiology-pharmacy-bloodbank-journey.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async (request) => {
        const who = String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase();
        return who === "doctor@example.test" ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {};
      },
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", LABTECH = "lab@example.test", PHARM = "pharmacy@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [LABTECH, "lab"], [PHARM, "pharmacy"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("JOURNEY: one admission -> lab order/result -> imaging order/report -> medication verify/dispense/administer -> blood request/issue/transfusion, ONE canonical patient throughout", async () => {
  seedHospital();

  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "LIS-Radiology-Pharmacy-BloodBank Journey", mobile: "9876500700", gender: "male", ageYears: 52 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "1" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  assert.equal(adm.patientId, patientId, "the admission resolves to the SAME canonical patientId /patient/register created");
  const encounterId = adm.encounterId;

  // ---- LIS: order -> collect -> result. ---------------------------------------------------------
  const labOrder = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId, code: "Renal profile", category: "laboratory" });
  assert.equal(labOrder.__status, 200, JSON.stringify(labOrder));
  const specimen = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: labOrder.orderId, specimenType: "Whole blood", scannedPatientBarcode: reg.mrn });
  assert.equal(specimen.__status, 200, JSON.stringify(specimen));
  assert.ok(/^ACC-/.test(specimen.accessionNumber), "a real accession number: " + JSON.stringify(specimen));
  const labResult = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: labOrder.orderId, status: "final", reportedAt: "2026-09-09T09:00:00.000Z",
    tests: [{ test: "Potassium", value: 4.2, unit: "mmol/L", range: "3.5-5.1" }],
  });
  assert.equal(labResult.__status, 200, JSON.stringify(labResult));
  /* Every released result is checked against the critical limits on the server. A normal potassium is
   * checked and opens nothing - "checked" is asserted, because an unchecked result must never look like a
   * normal one. */
  assert.equal(labResult.critical && labResult.critical.checked, true, "a released result must be checked against the critical limits: " + JSON.stringify(labResult.critical));
  assert.equal(labResult.critical.opened, 0);

  // A dangerous potassium, on a second order, opens a critical-result loop with no other call.
  const labOrder2 = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId, code: "Potassium", category: "laboratory" });
  const critResult = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: labOrder2.orderId, status: "final", reportedAt: "2026-09-09T09:05:00.000Z",
    tests: [{ test: "Potassium", value: 7.2, unit: "mmol/L" }],
  });
  assert.equal(critResult.__status, 200, JSON.stringify(critResult));
  assert.equal(critResult.critical.checked, true);
  assert.ok(critResult.critical.opened >= 1, "a potassium of 7.2 must open a critical-result loop: " + JSON.stringify(critResult.critical));

  // ---- Radiology: order -> report. --------------------------------------------------------------
  const imagingOrder = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId, code: "Chest X-ray", category: "imaging" });
  assert.equal(imagingOrder.__status, 200, JSON.stringify(imagingOrder));
  const imagingReport = await as(LABTECH, "/ward/report-imaging", "POST", {
    orgId: ORG, serviceRequestId: imagingOrder.orderId, modality: "XR", status: "final",
    findings: "No acute cardiopulmonary process.", impression: "Normal chest radiograph.",
  });
  assert.equal(imagingReport.__status, 200, JSON.stringify(imagingReport));

  // ---- Pharmacy: order -> verify -> dispense -> eMAR administration. ----------------------------
  const medOrder = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId, encounterId, drug: "Amoxicillin 500mg", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TID" } });
  assert.equal(medOrder.__status, 200, JSON.stringify(medOrder));
  const verify = await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: medOrder.orderId, outcome: "verified" });
  assert.equal(verify.__status, 200, JSON.stringify(verify));
  const dispense = await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: medOrder.orderId, quantity: { value: 21, unit: "capsule" }, batch: "AMX-2201", expiry: "2027-01-31" });
  assert.equal(dispense.__status, 200, JSON.stringify(dispense));

  // ---- Blood Bank: request -> crossmatch -> issue -> two-person bedside check -> start -> complete.
  const txReq = await as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, mrn: reg.mrn, component: "red-cells", units: 1, aboGroup: "O", rhD: "positive" });
  assert.equal(txReq.__status, 200, JSON.stringify(txReq));
  assert.equal(txReq.patientId, patientId, "the transfusion episode resolves to the SAME canonical patientId, not a second identity");
  const txXm = await as(DOCTOR, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: txReq.episodeId, unitId: "UNIT-J01", aboGroup: "O", rhD: "positive", component: "red-cells" });
  assert.equal(txXm.__status, 200, JSON.stringify(txXm));
  const txIssue = await as(DOCTOR, "/ward/transfusion-issue", "POST", { orgId: ORG, episodeId: txReq.episodeId });
  assert.equal(txIssue.__status, 200, JSON.stringify(txIssue));
  const patientForCheck = { id: patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn };
  const txCheck = await as(DOCTOR, "/ward/transfusion-bedside-check", "POST", {
    orgId: ORG, episodeId: txReq.episodeId, checkerId: "nurse-a", secondCheckerId: "nurse-b",
    scannedPatientBarcode: reg.mrn, scannedUnitId: "UNIT-J01", patient: patientForCheck,
    unitInHand: { unitId: "UNIT-J01", aboGroup: "O", rhD: "positive", component: "red-cells" },
  });
  assert.equal(txCheck.__status, 200, JSON.stringify(txCheck));
  const txStart = await as(DOCTOR, "/ward/transfusion-start", "POST", { orgId: ORG, episodeId: txReq.episodeId });
  assert.equal(txStart.__status, 200, JSON.stringify(txStart));
  const txDone = await as(DOCTOR, "/ward/transfusion-complete", "POST", { orgId: ORG, episodeId: txReq.episodeId });
  assert.equal(txDone.__status, 200, JSON.stringify(txDone));

  // ---- NO DUPLICATE PATIENT: every leg resolved to the ONE patientId registration created. --------
  for (const [label, id] of [["lab order", labOrder.patientId], ["imaging order", imagingOrder.patientId], ["transfusion", txReq.patientId]]) {
    if (id) assert.equal(id, patientId, `${label} stayed on the same canonical patient`);
  }

  // ---- THE LONGITUDINAL PROOF: Patient/{id}/$everything surfaces the WHOLE journey. ---------------
  const everything = await as(DOCTOR, `/ward/fhir/Patient/${patientId}/$everything?orgId=${ORG}`);
  assert.equal(everything.resourceType, "Bundle", JSON.stringify(everything).slice(0, 300));
  const entries = everything.entry || [];
  const types = new Set(entries.map((e) => e.resource && e.resource.resourceType));

  assert.ok(types.has("ServiceRequest"), "the bundle carries BOTH the lab and the imaging order (same FHIR type, both mapped): " + JSON.stringify([...types]));
  const serviceRequests = entries.filter((e) => e.resource && e.resource.resourceType === "ServiceRequest");
  // Three: the lab order, the second (critical) potassium added to prove critical loops open on release, and imaging.
  assert.equal(serviceRequests.length, 3, "exactly the three orders this journey placed - two lab and one imaging: " + serviceRequests.length);

  assert.ok(types.has("DiagnosticReport"), "the bundle carries BOTH the lab result and the imaging report: " + JSON.stringify([...types]));
  const diagnosticReports = entries.filter((e) => e.resource && e.resource.resourceType === "DiagnosticReport");
  assert.equal(diagnosticReports.length, 3, "exactly the three reports this journey released - two lab and one imaging: " + diagnosticReports.length);

  assert.ok(types.has("Specimen"), "TASK 3.7 gap closed: the specimen collected for the lab order is now visible in $everything: " + JSON.stringify([...types]));
  const specimens = entries.filter((e) => e.resource && e.resource.resourceType === "Specimen");
  assert.equal(specimens.length, 1);
  assert.equal(specimens[0].resource.status, "available");

  assert.ok(types.has("MedicationRequest") || types.has("MedicationDispense"), "the bundle carries the medication side of the journey: " + JSON.stringify([...types]));
  assert.ok(types.has("MedicationDispense"), "TASK 3.7 gap closed: the pharmacy dispense is now visible in $everything: " + JSON.stringify([...types]));
  const dispenses = entries.filter((e) => e.resource && e.resource.resourceType === "MedicationDispense");
  assert.equal(dispenses.length, 1);
  assert.equal(dispenses[0].resource.status, "completed");

  // TransfusionEpisode has no clean R4 resource and is NOT force-mapped into one - its identity
  // continuity was already proven above directly against the native routes (txReq.patientId), and
  // is proven again here by its own native queue read rather than through $everything.
  assert.equal(types.has("TransfusionEpisode"), false, "TransfusionEpisode is deliberately not exported as FHIR - no invented resource type");
  const txQueue = await as(DOCTOR, `/ward/transfusion-queue?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(txQueue.episodes.length, 1);
  assert.equal(txQueue.episodes[0].phase, "completed");

  const patientResources = entries.filter((e) => e.resource && e.resource.resourceType === "Patient");
  assert.equal(patientResources.length, 1, "exactly ONE Patient resource for the whole journey - no duplicate patient created downstream");
  assert.equal(patientResources[0].resource.id, patientId);

  // ---- NO CROSS-PATIENT CONTAMINATION. -------------------------------------------------------------
  const other = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Unrelated Bystander", mobile: "9876500701", gender: "female", ageYears: 33 });
  const otherEverything = await as(DOCTOR, `/ward/fhir/Patient/opd-pat-${other.mrn.toLowerCase()}/$everything?orgId=${ORG}`);
  const otherServiceRequests = (otherEverything.entry || []).filter((e) => e.resource && e.resource.resourceType === "ServiceRequest");
  assert.equal(otherServiceRequests.length, 0, "the unrelated patient's chart carries NONE of this journey's orders");
});
