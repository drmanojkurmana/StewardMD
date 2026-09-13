/* test/wardsynq-pathology-report.test.mjs - cultures, histopathology and the stewardship review, through the REAL routes. Harness copied from wardsynq-inpatient-emar.test.mjs.
 *
 * No actor is the org owner, so every 403 below is the role's own capabilities refusing it.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-pathology-report.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

/* Import order matters: a static import is hoisted, so anything reaching _fbfirestore.js must be
 * loaded with dynamic import() AFTER mock.module or the real Firestore is linked. */
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

const { MemoryRepository, VersionConflictError } = await import("../functions/_wardsynq/repository.js");
const { resetMemory: resetRateLimits } = await import("../functions/_wardsynq/rate-limit.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
let RECORD = new MemoryRepository();
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
// A SECOND hospital, for the isolation tests: same repository object, different tenant, and nothing
// one may see of the other. Added 2026-09-08 with the FHIR exchange.
const TENANT_ROW2 = { id: "tenant-two", name: "Other Hospital", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-two" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : String(a[0]) === TENANT_ROW2.id ? { ...TENANT_ROW2 } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    /* claimsFn carries the prescriber's medical registration number, which is the ONLY source of a
     * signing credential (actor.js:151). The doctor has one, as a registered prescriber does; the
     * nurse and the pharmacist do not, because they do not sign prescriptions. Returning {} for
     * everyone would have left the doctor credential-less and the order unsignable - a property of
     * the harness, not of the product, and one that would have hidden the real separation below. */
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

/* ---- the hospital and its staff --------------------------------------------------------------- */
const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test", LABTECH = "lab@example.test";
/* A doctor with no verified registration - a PIN session, a locum whose registration is not on file.
 * Holds emr.treat, so writes a note perfectly well, and cannot sign one. This is the ordinary case
 * co-signature exists for, and the harness has to contain one or the whole flow is untestable. */
const LOCUM = "locum@example.test";
const ENV = {
  QUEUE_ENABLED: "1",
  QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"),
  CONNECT_DB: tenantDb,
};

/* The hospital's own order sets. ORG content, exactly as they are in production: a caller who could
 * pass a set could hand themselves any order they liked with a set's name on it. */
const ORDER_SETS = [{
  id: "cap-admission", name: "Community-acquired pneumonia, admission", version: "3",
  items: [
    { key: "amox", kind: "medication", drug: "Amoxicillin", dose: { value: 1, unit: "g" }, route: "iv", frequency: "TDS" },
    { key: "fluids", kind: "medication", drug: "Sodium chloride 0.9%", dose: { value: 1000, unit: "mL" }, route: "iv", frequency: "OD", defaultSelected: false },
    { key: "cxr", kind: "investigation", code: "CXR", display: "Chest X-ray" },
  ],
}];

/* The hospital's own note templates. ORG content, exactly as the order sets are: headings, never
 * content. */
const NOTE_TEMPLATES = [{
  id: "ward-round", name: "Ward round note", version: "2", noteType: "progress",
  sections: [
    { key: "impression", title: "Impression", required: true },
    { key: "plan", title: "Plan", required: true },
  ],
}];

function seedHospital(mode = "wardsynq", region) {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  /* A new hospital starts with a fresh per-minute throttle. The limiter's memory store outlives each
   * test, so DOCTOR's writes from every earlier test in this file counted against the later ones,
   * and a test far down the file failed with "too many requests" whenever one above it grew. */
  resetRateLimits();
  // ownerUid is nobody on this ward: an owner resolves to `admin` and holds every capability, which
  // would make every separation assertion below vacuous.
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode, ...(region ? { region } : {}), connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { orderSets: ORDER_SETS, noteTemplates: NOTE_TEMPLATES } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"], [LABTECH, "lab"], [LOCUM, "doctor"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  // TASK 7 STEP 1: this file's own FHIR/HL7 inbound tests push as DOCTOR, claiming a real feed
  // (partner-his/mirror/his-genhosp/lab-genhosp) - these are the LEGITIMATE, already-onboarded
  // cases fhir-inbound.js's SourceSystemGrant now requires. Seeded directly into the repository,
  // the same way an admin would have registered them ahead of time through /ward/source-grant -
  // this is test fixture setup, not a bypass: the real authorizedSourceSystem() check still runs
  // on every push below and is what actually finds these rows. The adversarial "ROGUE"/impersonation
  // cases are proven separately, in test/wardsynq-source-system-grant.test.mjs, precisely because
  // pre-seeding every legitimate case here would make a vulnerability regression invisible.
  seedGrants();
}
function seedGrants() {
  for (const system of ["partner-his", "mirror", "his-genhosp", "lab-genhosp"]) {
    RECORD.append(TENANT_ROW.id, [{ resourceType: "SourceSystemGrant", id: `test-grant-${idFor(DOCTOR)}-${system}`, version: 1, actorId: idFor(DOCTOR), sourceSystem: system, active: true, grantedBy: "test-fixture", grantedAt: "2026-01-01T00:00:00.000Z" }]);
  }
}

async function as(email, path, method, body) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET",
      headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

const DUE = "2026-09-07T09:00:00.000Z";
const MRN = "SMD-WARD01-00001";

/** Registers, admits, and writes the order. Returns everything the bedside needs. */
async function admittedPatientOnDrug(drug = "Paracetamol 500mg") {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Ward Testcase", mobile: "9876500011", gender: "female", ageYears: 54 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "12", admittedAt: "2026-09-07T08:00:00.000Z" });
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG,
    order: { patientId: adm.patientId, encounterId: adm.encounterId, drug, dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TID" },
  });
  // The ward weighs the patient. Paracetamol carries an mg/kg ceiling, and the safety engine
  // correctly refuses a weight-based drug for a patient with no recorded weight.
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { weight: "68" } });
  const patient = { id: adm.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn };
  const scan = { patientBarcode: reg.mrn, drugBarcode: drug, dose: { value: 500, unit: "mg" }, route: "oral" };
  return { reg, adm, ord, patient, scan };
}
async function orderTest(adm, code = "Renal profile", id = "wsq-sr-1") {
  await RECORD.append(TENANT_ROW.id, [{
    resourceType: "ServiceRequest", id, version: 1, patientId: adm.patientId, encounterId: adm.encounterId,
    code, display: code, status: "active", requesterId: "cfa:dr",
    meta: { recordedAt: "2026-09-07T08:30:00.000Z", effectiveAt: "2026-09-07T08:30:00.000Z" },
  }], { actor: "test" });
  return id;
}

const { normaliseCulture, isPositiveBloodCulture, stewardshipReview } = await import("../functions/_wardsynq/pathology-report.js");

test("PURE: an untested antibiotic is dropped, never S; results are S/I/R/SDD only; breakpoint standard is never defaulted", () => {
  const n = normaliseCulture({ stage: "final", specimen: { type: "Blood" }, organisms: [{ name: "E. coli", susceptibilities: [
    { antibiotic: "Amoxicillin", result: "r" }, { antibiotic: "Meropenem", result: "" }, { antibiotic: "Ceftriaxone", result: "SDD", mic: "<=1", micUnit: "mg/L" },
  ] }] });
  assert.deepEqual(n.culture.organisms[0].susceptibilities.map((s) => s.antibiotic + ":" + s.result), ["Amoxicillin:R", "Ceftriaxone:SDD"]);
  assert.equal(n.culture.organisms[0].breakpointStandard, null);
  assert.equal(normaliseCulture({ stage: "final", specimen: { type: "Urine" }, organisms: [{ name: "x", susceptibilities: [{ antibiotic: "A", result: "sensitive" }] }] }).error, "bad_susceptibility");
  assert.equal(normaliseCulture({ stage: "no-growth", specimen: { type: "Urine" } }).error, "no_growth_hours_required");
  assert.equal(normaliseCulture({ stage: "final", specimen: { type: "Urine" } }).error, "final_needs_outcome");
  assert.equal(isPositiveBloodCulture({ stage: "growth-detected", specimen: { type: "Blood" }, organisms: [] }), true);
  assert.equal(isPositiveBloodCulture({ stage: "identification", specimen: { type: "Urine" }, organisms: [{ name: "x" }] }), false);
  assert.equal(isPositiveBloodCulture({ stage: "no-growth", specimen: { type: "Blood" }, organisms: [] }), false);
  const flags = stewardshipReview([{ reportId: "c1", status: "final", organisms: [{ name: "E. coli", susceptibilities: [{ antibiotic: "Piperacillin-tazobactam", result: "R" }, { antibiotic: "Meropenem", result: "S" }] }] }],
    [{ id: "m1", status: "active", drug: "Piperacillin/Tazobactam 4.5 g" }, { id: "m2", status: "active", drug: "Meropenem 1 g" }, { id: "m3", status: "cancelled", drug: "Meropenem" }, { id: "m4", status: "active", drug: "Paracetamol" }]);
  assert.deepEqual(flags.map((f) => f.orderId + ":" + (f.flag || "")), ["m1:reported resistant - review", "m2:"]);
});

test("CULTURE: stages are versions, a positive blood culture opens ONE critical loop, final changes are corrections, and the chart flags an antibiotic reported resistant", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug("Amoxicillin 500mg");
  const sr = await orderTest(adm, "Blood culture", "wsq-sr-bc");
  const spec = { type: "Blood", site: "Left antecubital" };

  // Server-side authorization: a nurse and a pharmacist cannot report a culture.
  for (const who of [NURSE, PHARM]) {
    assert.equal((await as(who, "/ward/culture-report", "POST", { orgId: ORG, serviceRequestId: sr, stage: "received", specimen: spec })).__status, 403);
    assert.equal((await as(who, `/ward/cultures-in-progress?orgId=${ORG}`)).__status, 403);
  }
  assert.equal((await as(PHARM, `/ward/pathology-reports?orgId=${ORG}&patientId=${adm.patientId}`)).__status, 403, "pharmacy does not read the chart");

  const received = await as(LABTECH, "/ward/culture-report", "POST", { orgId: ORG, serviceRequestId: sr, stage: "received", specimen: spec, collectedAt: "2026-09-07T08:40:00.000Z", receivedAt: "2026-09-07T09:00:00.000Z" });
  assert.equal(received.__status, 200, JSON.stringify(received));
  assert.equal(received.status, "preliminary");
  assert.equal(received.criticalCheck, undefined, "received is not positive");

  const growth = await as(LABTECH, "/ward/culture-report", "POST", { orgId: ORG, serviceRequestId: sr, stage: "growth-detected", specimen: spec, gramStain: "Gram negative bacilli" });
  assert.equal(growth.__status, 200, JSON.stringify(growth));
  assert.equal(growth.version, 2, "a stage is a new version of the same report");
  assert.equal(growth.criticalCheck.checked, true);
  assert.equal(growth.criticalCheck.opened, 1);
  assert.equal(growth.criticalCheck.loops[0].value, "Gram negative bacilli");

  const inProgress = await as(LABTECH, `/ward/cultures-in-progress?orgId=${ORG}`);
  assert.equal(inProgress.__status, 200);
  assert.deepEqual(inProgress.cultures.map((c) => c.stage), ["growth-detected"]);

  const organisms = [{ name: "Escherichia coli", quantity: "Growth in 1 of 2 bottles", breakpointStandard: "CLSI M100 (as reported)",
    susceptibilities: [{ antibiotic: "Amoxicillin", result: "R", mic: ">=32", micUnit: "mg/L", method: "VITEK 2" }, { antibiotic: "Meropenem", result: "S" }, { antibiotic: "Colistin", result: "" }] }];
  const fin = await as(LABTECH, "/ward/culture-report", "POST", { orgId: ORG, serviceRequestId: sr, stage: "final", specimen: spec, organisms });
  assert.equal(fin.__status, 200, JSON.stringify(fin));
  assert.equal(fin.status, "final");
  assert.equal(fin.criticalCheck.opened, 0, "the final finds the loop growth opened; it does not open a second");
  const loops = await as(DOCTOR, `/ward/criticals?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(loops.loops.filter((l) => l.reportId === fin.reportId).length, 1);

  assert.equal((await as(LABTECH, "/ward/culture-report", "POST", { orgId: ORG, serviceRequestId: sr, stage: "final", specimen: spec, organisms })).error, "already_final");
  const corr = await as(LABTECH, "/ward/culture-report", "POST", { orgId: ORG, serviceRequestId: sr, stage: "final", specimen: spec, organisms, correction: true, comment: "Organism identity re-checked" });
  assert.equal(corr.status, "corrected");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "DiagnosticReport", fin.reportId)).version, 4);

  const chart = await as(DOCTOR, `/ward/pathology-reports?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(chart.__status, 200, JSON.stringify(chart));
  assert.equal(chart.cultures[0].organisms[0].susceptibilities.length, 2, "colistin was not tested and is not stored");
  const abx = (chart.antibioticOrders || []).find((o) => /Amoxicillin/.test(o.drug));
  assert.ok(abx, JSON.stringify(chart.antibioticOrders));
  assert.equal(abx.flag, "reported resistant - review");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "MedicationOrder", abx.orderId)).status, "active", "advisory only: the order is untouched");
});

test("HISTOPATHOLOGY: final needs a diagnosis, a signed report takes addenda only, second-person verification reuses verify-result", async () => {
  seedHospital();
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...org.fields.wardsynq, labVerification: { mode: "second-person" } };
  const LAB2 = "lab2@example.test";
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(LAB2))}`, { fields: { orgId: ORG, identity: idFor(LAB2), role: "lab", active: true }, updateTime: "t1" });
  const { adm } = await admittedPatientOnDrug();
  const sr = await orderTest(adm, "Histopathology", "wsq-sr-hp");
  const body = { orgId: ORG, serviceRequestId: sr, specimen: "Appendix", clinicalDetails: "RIF pain", macroscopic: "Appendix 60 mm", microscopic: "Transmural neutrophils" };

  assert.equal((await as(NURSE, "/ward/histopathology-report", "POST", { ...body, status: "preliminary" })).__status, 403);
  assert.equal((await as(LABTECH, "/ward/histopathology-report", "POST", { ...body, status: "final" })).error, "diagnosis_required");
  const r = await as(LABTECH, "/ward/histopathology-report", "POST", { ...body, status: "final", diagnosis: "Acute appendicitis" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.status, "preliminary");
  assert.equal(r.awaitingVerification, true);
  assert.equal((await as(LABTECH, "/ward/histopathology-addendum", "POST", { orgId: ORG, reportId: r.reportId, text: "x" })).error, "not_signed");
  assert.equal((await as(LABTECH, "/ward/verify-result", "POST", { orgId: ORG, reportId: r.reportId, decision: "verify" })).error, "cannot_verify_own");
  assert.ok((await as(LAB2, `/ward/results-to-verify?orgId=${ORG}`)).results.some((x) => x.reportId === r.reportId));
  assert.equal((await as(LAB2, "/ward/verify-result", "POST", { orgId: ORG, reportId: r.reportId, decision: "verify" })).status, "final");

  assert.equal((await as(LABTECH, "/ward/histopathology-report", "POST", { ...body, status: "final", diagnosis: "Changed" })).error, "signed_use_addendum");
  assert.equal((await as(NURSE, "/ward/histopathology-addendum", "POST", { orgId: ORG, reportId: r.reportId, text: "x" })).__status, 403);
  const add = await as(LAB2, "/ward/histopathology-addendum", "POST", { orgId: ORG, reportId: r.reportId, text: "Enterobius vermicularis also seen." });
  assert.equal(add.__status, 200, JSON.stringify(add));
  const chart = await as(DOCTOR, `/ward/pathology-reports?orgId=${ORG}&patientId=${adm.patientId}`);
  const h = chart.histopathology[0];
  assert.equal(h.diagnosis, "Acute appendicitis", "the signed text is untouched");
  assert.equal(h.addenda.length, 1);
  assert.equal(h.addenda[0].by, idFor(LAB2));
});
