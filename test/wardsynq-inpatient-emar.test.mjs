/* test/wardsynq-inpatient-emar.test.mjs — the inpatient vertical, through the REAL routes.
 *
 * admission -> ward list -> ward vitals -> inpatient medication order -> medication round ->
 * verify -> dispense -> scan -> administer -> MedicationAdministration in the record.
 *
 * THREE ACTORS, none of them the org owner. That matters: an owner resolves to `admin`, which holds
 * every capability, and a separation test run as the owner proves nothing. Here the doctor, the
 * nurse and the pharmacist hold exactly the capabilities their roles hold, so "a nurse cannot
 * prescribe" and "a doctor cannot administer" are demonstrated rather than asserted.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-inpatient-emar.test.mjs
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

function seedHospital(mode = "wardsynq") {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  // ownerUid is nobody on this ward: an owner resolves to `admin` and holds every capability, which
  // would make every separation assertion below vacuous.
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode, connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { orderSets: ORDER_SETS, noteTemplates: NOTE_TEMPLATES } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"], [LABTECH, "lab"], [LOCUM, "doctor"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
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

/* ---- the vertical ------------------------------------------------------------------------------ */

test("the whole inpatient vertical: admit, ward vitals, order, and a governed administration", async () => {
  seedHospital();
  const { reg, adm, ord, patient, scan } = await admittedPatientOnDrug();

  // 1. ADMISSION -> an IPD Encounter with a real location.
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  assert.equal(adm.written, 1);
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(enc.class, "IPD", "an admission is an inpatient encounter, not an OPD visit");
  assert.equal(enc.status, "in-progress");
  assert.deepEqual({ ward: enc.location.ward, bed: enc.location.bed }, { ward: "Medical A", bed: "12" });
  assert.equal(enc.patientId, adm.patientId, "and it is the SAME patient identity registration created");
  assert.equal(adm.patientId, "opd-pat-" + reg.mrn.toLowerCase());

  // Re-admitting the identical admission writes no second version.
  const again = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "12", admittedAt: "2026-09-07T08:00:00.000Z" });
  assert.equal(again.written, 0);
  assert.equal(again.skipped, "unchanged");

  // 2. THE WARD LIST is a query over the record, and the nurse can see it.
  const list = await as(NURSE, `/ward/list?orgId=${ORG}&ward=Medical A`);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.patients.length, 1);
  assert.deepEqual(
    { encounterId: list.patients[0].encounterId, bed: list.patients[0].bed },
    { encounterId: adm.encounterId, bed: "12" },
  );

  // 3. WARD VITALS, by the nurse, coded exactly as the OPD path codes them.
  const vit = await as(NURSE, "/ward/vitals", "POST", {
    orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId,
    vitals: { sbp: "126", dbp: "82", pulse: "90", temp: "99.4", tempUnit: "F", spo2: "96", rr: "18", weight: "68" },
  });
  assert.equal(vit.__status, 200, JSON.stringify(vit));
  assert.equal(vit.written, 7);
  const obs = await RECORD.byPatient(TENANT_ROW.id, "Observation", adm.patientId);
  assert.equal(obs.find((o) => o.code === "8480-6").value, 126, "systolic recorded as reported");
  assert.ok(obs.every((o) => o.encounterId === adm.encounterId), "every ward reading is anchored to the admission");

  // 4. THE ORDER, by the doctor, carrying a real dose the bedside can check against.
  assert.equal(ord.__status, 200, JSON.stringify(ord));
  const order = await RECORD.latest(TENANT_ROW.id, "MedicationOrder", ord.orderId);
  assert.deepEqual(order.dose, { value: 500, unit: "mg" });
  assert.equal(order.status, "active");
  assert.equal(order.encounterId, adm.encounterId);

  // 5. THE ROUND shows it as due, and not yet started.
  const round = await as(NURSE, `/ward/round?orgId=${ORG}&patientId=${adm.patientId}&dueAt=${encodeURIComponent(DUE)}`);
  assert.equal(round.__status, 200, JSON.stringify(round));
  assert.equal(round.due.length, 1);
  assert.equal(round.due[0].orderId, ord.orderId);
  assert.equal(round.due[0].status, null, "nothing has happened to this dose yet");

  // 6. THE CLOSED LOOP. Pharmacy releases it; the nurse scans and gives it.
  const mar = (email, action, extra) => as(email, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: DUE, patient, ...extra });
  const verified = await mar(NURSE, "verify");
  assert.equal(verified.__status, 200, JSON.stringify(verified));
  assert.equal(verified.to, "verified");
  const dispensed = await mar(NURSE, "dispense");
  assert.equal(dispensed.to, "dispensed");
  const scanned = await mar(NURSE, "scan", { scan });
  assert.equal(scanned.__status, 200, JSON.stringify(scanned));
  assert.equal(scanned.to, "scanned", "the five rights passed");
  const given = await mar(NURSE, "administer");
  assert.equal(given.__status, 200, JSON.stringify(given));
  assert.equal(given.to, "administered");

  // 7. THE ADMINISTRATION IS IN THE RECORD, as its own resource, naming who gave it.
  const rec = await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", given.administrationId);
  assert.equal(rec.resourceType, "MedicationAdministration");
  assert.equal(rec.status, "administered");
  assert.equal(rec.orderId, ord.orderId, "linked to the order it was given against");
  assert.equal(rec.patientId, adm.patientId);
  assert.equal(rec.administeredBy, idFor(NURSE), "the record names the nurse who gave it, not the prescriber");
  assert.ok(rec.administeredAt);

  // ORDER AND ADMINISTRATION REMAIN TWO RESOURCES.
  assert.notEqual(rec.id, order.id);
  assert.equal(order.status, "active", "giving a dose does not consume or close the order");

  // The lifecycle is the resource's own append-only history, not an overwritten column.
  const history = await RECORD.history(TENANT_ROW.id, "MedicationAdministration", given.administrationId);
  assert.deepEqual(history.map((h) => h.status), ["verified", "dispensed", "scanned", "administered"]);

  // And the round now reflects it.
  const after = await as(NURSE, `/ward/round?orgId=${ORG}&patientId=${adm.patientId}&dueAt=${encodeURIComponent(DUE)}`);
  assert.equal(after.due[0].status, "administered");
  assert.equal(after.due[0].administeredBy, idFor(NURSE));
});

/* ---- the refusals ------------------------------------------------------------------------------ */

test("a nurse may give a dose and may NOT write the order for it", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const attempt = await as(NURSE, "/ward/medication-order", "POST", {
    orgId: ORG,
    order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Morphine 10mg", dose: { value: 10, unit: "mg" }, route: "iv" },
  });
  assert.equal(attempt.__status, 403, "prescribing needs emr.treat, which a nurse does not hold");
  assert.equal(await RECORD.latest(TENANT_ROW.id, "MedicationOrder", "wsq-rx-" + String(adm.encounterId).toLowerCase() + "-morphine-10mg"), null);
});

test("a doctor may write the order and may NOT administer it", async () => {
  seedHospital();
  const { ord, patient, scan } = await admittedPatientOnDrug();
  const mar = (email, action, extra) => as(email, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: DUE, patient, ...extra });
  await mar(NURSE, "verify"); await mar(NURSE, "dispense");
  const scanned = await mar(DOCTOR, "scan", { scan });
  assert.equal(scanned.__status, 403, "the bedside needs med.administer, which the doctor role does not hold");
});

/* RBAC on the routes ward.js's golden-path UI newly calls (admit, beds, flowsheet, news2,
 * transfer). Every one of these already holds a capability requirement in [[path]].js; what was
 * untested is the REFUSAL side. Nurse is not a valid negative case for most of these - the role
 * matrix (functions/_queue_roles.js) grants nurse QUEUE_ADD, QUEUE_VIEW and EMR_VIEW outright, so
 * a nurse succeeding on admit/beds/flowsheet/news2 is correct, not a gap. Pharmacy is the real
 * boundary: it holds none of QUEUE_ADD, EMR_VIEW or MED_ADMINISTER. */
test("RBAC: admission, transfer, the flowsheet and NEWS2 are clinical/administrative acts pharmacy does not hold", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "RBAC Testcase", mobile: "9876500055", gender: "male", ageYears: 60 });
  const badAdmit = await as(PHARM, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "19", admittedAt: "2026-09-07T08:00:00.000Z" });
  assert.equal(badAdmit.__status, 403, "admitting is queue.add, which pharmacy does not hold");

  const { adm } = await admittedPatientOnDrug();
  const badTransfer = await as(PHARM, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "ICU", bed: "1" });
  assert.equal(badTransfer.__status, 403, "moving a patient is queue.add too");

  const badFlow = await as(PHARM, `/ward/flowsheet?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(badFlow.__status, 403, "the flowsheet is emr.view - pharmacy dispenses against the order, not the chart");
  const badNews2 = await as(PHARM, `/ward/news2?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(badNews2.__status, 403);

  // And the doctor/nurse who legitimately hold these still succeed - the refusal above is the
  // capability boundary, not a route that has quietly stopped working.
  assert.equal((await as(DOCTOR, "/ward/flowsheet?orgId=" + ORG + "&patientId=" + adm.patientId)).__status, 200);
  assert.equal((await as(NURSE, "/ward/news2?orgId=" + ORG + "&patientId=" + adm.patientId)).__status, 200);
});

/* The bed board (queue.view) is held by essentially every real role - the actual boundary is org
 * membership, not role. A person authenticated but not on this hospital's staff list is refused,
 * which is the negative case that route actually has. */
test("RBAC: the bed board is refused to somebody who is not on this hospital's staff list at all", async () => {
  seedHospital();
  const stranger = "not-on-staff@example.test";
  const r = await as(stranger, `/ward/beds?orgId=${ORG}`);
  assert.ok(r.__status === 403 || r.__status === 404, "a non-member gets no bed board, whatever the exact refusal code: " + r.__status);
});

/* THE GAP THIS TEST ONCE DOCUMENTED IS CLOSED (migrate-inpatient.js: the bed-occupancy check +
 * claimBed()). admitPatient() now refuses a busy bed the same way transferPatient() always has -
 * SEQUENTIAL admissions to an occupied bed are refused via the ordinary list-scan (the fast path);
 * the test after this one proves the TRUE concurrent case, which the list-scan alone cannot. */
test("wrong-patient / bed-safety: /ward/admit refuses a bed another open admission already occupies, sequentially", async () => {
  seedHospital();
  const regA = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Bed Claimant A", mobile: "9876500061", gender: "female", ageYears: 30 });
  const regB = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Bed Claimant B", mobile: "9876500062", gender: "male", ageYears: 45 });
  const admA = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regA.mrn, ward: "Medical A", bed: "31", admittedAt: "2026-09-07T08:00:00.000Z" });
  assert.equal(admA.__status, 200, JSON.stringify(admA));
  const board = await as(DOCTOR, `/ward/beds?orgId=${ORG}`);
  const row = board.wards.find((w) => w.ward === "Medical A");
  assert.ok(row && row.occupied.some((o) => o.bed === "31" && o.patientId === admA.patientId), "the board (what the UI's bed-picker reads) correctly shows bed 31 taken");

  // A second, different patient admitted to the SAME bed via the raw route - not through the UI,
  // which would never have offered bed 31 - to test the SERVER's own guard in isolation.
  const admB = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regB.mrn, ward: "Medical A", bed: "31", admittedAt: "2026-09-08T08:00:00.000Z" });
  assert.equal(admB.__status, 409, JSON.stringify(admB));
  assert.equal(admB.error, "bed_occupied");
  assert.equal(admB.written, 0, "nothing lands for the second patient - not a partial admission, not a silent overwrite");
  assert.equal(await as(DOCTOR, `/ward/list?orgId=${ORG}&ward=Medical A`).then((r) => r.patients.length), 1, "the ward list still shows exactly the one real admission");

  // The bed frees the moment its occupant is discharged, exactly as it does for transfer.
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: admA.encounterId, dischargedAt: "2026-09-08T09:00:00.000Z" });
  const admB2 = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regB.mrn, ward: "Medical A", bed: "31", admittedAt: "2026-09-08T10:00:00.000Z" });
  assert.equal(admB2.__status, 200, JSON.stringify(admB2));

  // Case and spacing are not identity here either, matching transfer's own rule.
  const regC = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Bed Claimant C", mobile: "9876500063", gender: "male", ageYears: 50 });
  const admC = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regC.mrn, ward: "medical a", bed: "31", admittedAt: "2026-09-08T11:00:00.000Z" });
  assert.equal(admC.error, "bed_occupied");

  // A ward named with no bed cannot collide with anything - a patient can be admitted awaiting one.
  const regD = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Bed Claimant D", mobile: "9876500064", gender: "female", ageYears: 22 });
  const admD = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regD.mrn, ward: "Medical A", admittedAt: "2026-09-08T12:00:00.000Z" });
  assert.equal(admD.__status, 200, JSON.stringify(admD));
});

/* Two admissions fired together via Promise.all. In THIS harness (one Node process, a
 * MemoryRepository with no real I/O latency) request A's whole chain typically completes -
 * including its own claimBed() - before request B's list-scan even runs, so B is usually refused
 * by the ordinary FAST PATH (the plain list-scan, same as transfer's own check), not by
 * claimBed()'s VersionConflictError. That is still a real, useful guarantee (exactly one request
 * ever lands, whichever path catches the second one) - it is just not, on its own, proof of the
 * atomic path. The test after this one forces the two requests to actually reach claimBed()
 * without having seen each other, which is the case this test cannot reliably manufacture. */
test("wrong-patient / bed-safety, CONCURRENT: two admissions racing for the same bed at once - exactly one lands, whichever guard catches the second", async () => {
  seedHospital();
  const regA = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Race Claimant A", mobile: "9876500071", gender: "female", ageYears: 40 });
  const regB = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Race Claimant B", mobile: "9876500072", gender: "male", ageYears: 41 });

  const [a, b] = await Promise.all([
    as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regA.mrn, ward: "ICU", bed: "5", admittedAt: "2026-09-07T08:00:00.000Z" }),
    as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regB.mrn, ward: "ICU", bed: "5", admittedAt: "2026-09-07T08:00:01.000Z" }),
  ]);

  const outcomes = [a, b];
  const winners = outcomes.filter((r) => r.__status === 200 && r.written === 1);
  const losers = outcomes.filter((r) => r.__status === 409 && r.error === "bed_occupied");
  assert.equal(winners.length, 1, "exactly one of the two concurrent admissions landed: " + JSON.stringify(outcomes));
  assert.equal(losers.length, 1, "and the other was refused as a bed conflict, not silently dropped or double-written: " + JSON.stringify(outcomes));

  // The chart agrees with the response: one real Encounter in that bed, not two, not zero.
  const board = await as(DOCTOR, `/ward/beds?orgId=${ORG}`);
  const row = board.wards.find((w) => w.ward === "ICU");
  const occupants = (row.occupied || []).filter((o) => o.bed === "5");
  assert.equal(occupants.length, 1, "the record itself has exactly one occupant of ICU bed 5: " + JSON.stringify(occupants));
});

/* THE ACTUAL ATOMICITY PROOF, forced. The test above cannot reliably make BOTH requests reach
 * claimBed() without having seen each other's Encounter - request A usually finishes first and B's
 * OWN list-scan then sees A's already-written admission, so B is refused by the ordinary fast path
 * and claimBed()'s VersionConflictError is never reached. This test closes that gap directly: it
 * holds BOTH requests' Encounter list-scan at a rendezvous barrier (a monkey-patch on RECORD's own
 * read method, restored in `finally`) until both have arrived, so NEITHER can see the other's
 * write - both see the bed as free, both proceed to claimBed(), and it is claimBed()'s own
 * append()-level (tenant, resourceType, id, version) uniqueness, not the list-scan, that decides
 * the winner. This is the path a genuinely simultaneous pair of requests on a live, slower-than-
 * single-process server (real network latency between the read and the write) would actually take. */
test("wrong-patient / bed-safety, THE ATOMIC PATH ITSELF: forced to race inside claimBed(), the loser genuinely hits VersionConflictError", async () => {
  seedHospital();
  const regA = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Barrier Claimant A", mobile: "9876500073", gender: "female", ageYears: 42 });
  const regB = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Barrier Claimant B", mobile: "9876500074", gender: "male", ageYears: 43 });

  const realLatestByType = RECORD.latestByType.bind(RECORD);
  const realAppend = RECORD.append.bind(RECORD);
  let arrived = 0, releaseGate, claimConflicts = 0;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  RECORD.latestByType = async (tenantId, resourceType, limit) => {
    if (resourceType === "Encounter") {
      arrived += 1;
      if (arrived === 2) releaseGate();          // both callers have now asked "who is here" -
      await gate;                                // neither has seen the other's answer yet.
    }
    return realLatestByType(tenantId, resourceType, limit);
  };
  // Instrumented, not assumed: this is the SAME evidence a prior review demanded before trusting
  // this test's own claim - proof the bed-claim row itself, not the ordinary list-scan, is what
  // decided the loser.
  RECORD.append = async (tenantId, records, ctx) => {
    try { return await realAppend(tenantId, records, ctx); }
    catch (e) { if (e instanceof VersionConflictError && records.some((r) => r.resourceType === "_wardsynq_bed_claim")) claimConflicts += 1; throw e; }
  };

  let a, b;
  try {
    [a, b] = await Promise.all([
      as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regA.mrn, ward: "ICU", bed: "6", admittedAt: "2026-09-07T08:00:00.000Z" }),
      as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regB.mrn, ward: "ICU", bed: "6", admittedAt: "2026-09-07T08:00:01.000Z" }),
    ]);
  } finally { RECORD.latestByType = realLatestByType; RECORD.append = realAppend; }

  assert.equal(arrived, 2, "both requests genuinely reached the list-scan before either was released - the race was real, not assumed");
  assert.equal(claimConflicts, 1, "claimBed()'s own append() genuinely threw VersionConflictError for the loser - the atomic path, not the list-scan, decided this");
  const outcomes = [a, b];
  assert.equal(outcomes.filter((r) => r.__status === 200 && r.written === 1).length, 1, "exactly one landed even with neither request able to see the other's Encounter: " + JSON.stringify(outcomes));
  assert.equal(outcomes.filter((r) => r.__status === 409 && r.error === "bed_occupied").length, 1, JSON.stringify(outcomes));
  const board = await as(DOCTOR, `/ward/beds?orgId=${ORG}`);
  assert.equal((board.wards.find((w) => w.ward === "ICU").occupied || []).filter((o) => o.bed === "6").length, 1, "and the record still has exactly one real occupant");
});

/* DUPLICATE ADMISSION: the SAME request retried (a lost response, a doubled click) is idempotent,
 * exactly as every other write in this system is, and is NOT itself treated as a bed conflict - a
 * patient re-admitting themselves to their own bed is a no-op, not a collision with themselves. */
test("wrong-patient / bed-safety: a genuinely duplicate admission (same mrn, same admittedAt) is a no-op, not a bed conflict", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Duplicate Claimant", mobile: "9876500081", gender: "female", ageYears: 35 });
  const body = { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "40", admittedAt: "2026-09-07T08:00:00.000Z" };
  const first = await as(DOCTOR, "/ward/admit", "POST", body);
  assert.equal(first.__status, 200); assert.equal(first.written, 1);
  const [again1, again2] = await Promise.all([as(DOCTOR, "/ward/admit", "POST", body), as(DOCTOR, "/ward/admit", "POST", body)]);
  for (const r of [again1, again2]) {
    assert.equal(r.__status, 200, JSON.stringify(r));
    assert.equal(r.written, 0); assert.equal(r.skipped, "unchanged", "the SAME admission again is recognised as itself, never as a conflict with itself");
  }
  assert.equal((await RECORD.history(TENANT_ROW.id, "Encounter", first.encounterId)).length, 1, "still exactly one version - the duplicates wrote nothing");
});

test("a dose cannot jump to administered, and cannot be given twice", async () => {
  seedHospital();
  const { ord, patient, scan } = await admittedPatientOnDrug();
  const mar = (email, action, extra) => as(email, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: DUE, patient, ...extra });

  // Straight to administer, with no record started at all.
  const jump = await mar(NURSE, "administer");
  assert.equal(jump.__status, 409);
  assert.equal(jump.error, "dose_not_started");

  await mar(NURSE, "verify"); await mar(NURSE, "dispense");
  // Administering without the bedside scan is refused by the state machine's own transition table.
  const unscanned = await mar(NURSE, "administer");
  assert.equal(unscanned.__status, 409);
  assert.equal(unscanned.error, "refused");

  await mar(NURSE, "scan", { scan });
  const first = await mar(NURSE, "administer");
  assert.equal(first.to, "administered");

  // The same dose again lands on the same record, which has no legal transition out.
  const second = await mar(NURSE, "administer");
  assert.equal(second.__status, 409, "a duplicate dose is refused");
  assert.equal(second.error, "refused");
  const history = await RECORD.history(TENANT_ROW.id, "MedicationAdministration", first.administrationId);
  assert.equal(history.filter((h) => h.status === "administered").length, 1, "and only ONE administration is on the record");
});

test("HOLD, ROUTE LEVEL: a dose cannot be held with no reason, through the real /ward/mar door", async () => {
  seedHospital();
  const { ord, patient } = await admittedPatientOnDrug();
  const mar = (action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: DUE, patient, ...extra });
  const noReason = await mar("hold");
  assert.equal(noReason.__status, 409);
  assert.equal(noReason.error, "refused");
  assert.ok(noReason.reasons.some((r) => r.code === "NO_REASON"), JSON.stringify(noReason.reasons));
  const withReason = await mar("hold", { reason: "Awaiting BP recheck before this dose." });
  assert.equal(withReason.to, "held");
});

/* REFUSE and CANCEL, unlike HOLD, do not throw on a missing reason - refuse() defaults to "patient
 * declined" and cancel() to a null reason (wardsynq-meds.js). That is a deliberate difference, not
 * an oversight this task should silently patch: a refusal is what a bedside nurse types in the
 * moment a patient says no, and "patient declined" is itself a real, honest reason rather than a
 * placeholder. These two tests pin down the CURRENT behaviour so a future change to it is a visible
 * diff, not a silent one. */
test("REFUSE/CANCEL, ROUTE LEVEL: a missing reason does not throw - refuse defaults to 'patient declined', cancel to no reason, and both are on the record as such", async () => {
  seedHospital();
  const { adm, ord: ord1 } = await admittedPatientOnDrug("Paracetamol 500mg");
  const ord2 = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Ibuprofen 400mg", dose: { value: 400, unit: "mg" }, route: "oral", frequency: "TID" } });
  const patient = { id: adm.patientId, mrn: adm.patientId.replace("opd-pat-", "").toUpperCase(), wristbandBarcode: adm.patientId.replace("opd-pat-", "").toUpperCase() };

  // refuse() is only a legal transition from dispensed/scanned/held (wardsynq-meds.js) - a patient
  // declines a dose that has actually reached them, not one nobody has touched yet.
  await as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: "verify", orderId: ord1.orderId, dueAt: DUE, patient });
  await as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: "dispense", orderId: ord1.orderId, dueAt: DUE, patient });
  const refused = await as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: "refuse", orderId: ord1.orderId, dueAt: DUE, patient });
  assert.equal(refused.__status, 200, JSON.stringify(refused));
  assert.equal(refused.to, "refused");
  // The reason lands on the audit trail entry for this transition, not a top-level field.
  const refRec = await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", refused.administrationId);
  const refAudit = refRec.audit[refRec.audit.length - 1];
  assert.equal(refAudit.to, "refused");
  assert.equal(refAudit.reason, "patient declined", "a reason nobody typed is still a real, honest reason on the record - never blank");

  await as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: "verify", orderId: ord2.orderId, dueAt: DUE, patient });
  const cancelled = await as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: "cancel", orderId: ord2.orderId, dueAt: DUE, patient });
  assert.equal(cancelled.__status, 200, JSON.stringify(cancelled));
  assert.equal(cancelled.to, "cancelled");
  const cxRec = await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", cancelled.administrationId);
  const cxAudit = cxRec.audit[cxRec.audit.length - 1];
  assert.equal(cxAudit.to, "cancelled");
  assert.equal(cxAudit.reason, null, "cancel with no reason records no reason - it is not invented, unlike refuse's honest default");
});

test("the five rights are enforced: a wrong-drug scan is refused", async () => {
  seedHospital();
  const { ord, patient, scan } = await admittedPatientOnDrug();
  const mar = (email, action, extra) => as(email, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: DUE, patient, ...extra });
  await mar(NURSE, "verify"); await mar(NURSE, "dispense");

  const wrongDrug = await mar(NURSE, "scan", { scan: { ...scan, drugBarcode: "Morphine 10mg" } });
  assert.equal(wrongDrug.__status, 409);
  assert.ok(wrongDrug.reasons.some((r) => r.code === "FIVE_RIGHTS_DRUG"), JSON.stringify(wrongDrug.reasons));

  const wrongDose = await mar(NURSE, "scan", { scan: { ...scan, dose: { value: 1000, unit: "mg" } } });
  assert.ok(wrongDose.reasons.some((r) => r.code === "FIVE_RIGHTS_DOSE"));

  const noScan = await mar(NURSE, "scan", { scan: {} });
  assert.ok(noScan.reasons.some((r) => r.code === "FIVE_RIGHTS_PATIENT"), "no wristband scanned is not a pass");
});

test("wrong-patient: an order belonging to someone else is refused before any state moves", async () => {
  seedHospital();
  const a = await admittedPatientOnDrug();
  const regB = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Other Testcase", mobile: "9876500022", gender: "male", ageYears: 61 });
  const admB = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regB.mrn, ward: "Medical A", bed: "13", admittedAt: "2026-09-07T08:10:00.000Z" });

  // Patient B presented against patient A's order.
  const wrong = await as(NURSE, "/ward/mar", "POST", {
    orgId: ORG, action: "verify", orderId: a.ord.orderId, dueAt: DUE,
    patient: { id: admB.patientId, mrn: regB.mrn, wristbandBarcode: regB.mrn },
  });
  assert.equal(wrong.__status, 409);
  assert.equal(wrong.error, "wrong_patient");
  assert.equal(await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", wrong.administrationId || "none"), null,
    "nothing is written for a wrong-patient attempt");
});

test("an AI actor cannot administer a dose", async () => {
  seedHospital();
  const { ord, patient, scan } = await admittedPatientOnDrug();
  const mar = (action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: DUE, patient, ...extra });
  await mar("verify"); await mar("dispense"); await mar("scan", { scan });

  // The record API is the only door that accepts an `origin`, and an AI-kind actor is capped at
  // DRAFT by its kind — it can never reach the EXECUTE a committed administration requires.
  const { handle } = await import("../functions/api/wardsynq/[[path]].js");
  const res = await handle(new Request(`https://x/api/wardsynq/${TENANT_ROW.id}/record`, {
    method: "POST",
    headers: { "Cf-Access-Authenticated-User-Email": NURSE, "Content-Type": "application/json" },
    body: JSON.stringify({
      entity: {
        resourceType: "MedicationAdministration", id: "wsq-mar-ai-probe", orderId: ord.orderId,
        patientId: patient.id, status: "administered", administeredBy: "ai:maik",
        source: { system: "wardsynq-native", sourceId: "probe" },
      },
      origin: { kind: "ai", id: "maik" },
    }),
  }), { ...ENV, WARDSYNQ_RECORD: "1" }, {
    db: tenantDb, identifyFn: identify, claimsFn: async () => ({}), staffSession: verifyStaffSession,
    orgForTenant, authorizeOrg, repository: RECORD, pseudonym: async () => null,
  });
  assert.equal(res.status, 403, "an AI may draft, never commit a dose as given");
  assert.equal(await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", "wsq-mar-ai-probe"), null);
});

/* Found while building this vertical, and kept because it is the control working: paracetamol
 * carries an mg/kg ceiling, and the engine refuses a weight-based drug for a patient the ward has
 * never weighed rather than passing it. The weight comes from the patient's own recorded vitals, not
 * from the request body - a client-supplied weight is a number that can be typed to clear a ceiling. */
test("a weight-based drug is refused at the bedside until the ward has actually weighed the patient", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Unweighed Testcase", mobile: "9876500033", gender: "female", ageYears: 44 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "14", admittedAt: "2026-09-07T08:20:00.000Z" });
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Paracetamol 500mg", dose: { value: 500, unit: "mg" }, route: "oral" },
  });
  const patient = { id: adm.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn };
  const scan = { patientBarcode: reg.mrn, drugBarcode: "Paracetamol 500mg", dose: { value: 500, unit: "mg" }, route: "oral" };
  const mar = (action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: DUE, patient, ...extra });
  await mar("verify"); await mar("dispense");

  const unweighed = await mar("scan", { scan });
  assert.equal(unweighed.__status, 409, "no recorded weight means the ceiling cannot be checked");
  assert.ok(unweighed.reasons.some((r) => r.code === "DOSE_WEIGHT_MISSING"), JSON.stringify(unweighed.reasons));

  // Weigh the patient on the ward, and the same scan now passes.
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { weight: "62" } });
  const weighed = await mar("scan", { scan });
  assert.equal(weighed.__status, 200, JSON.stringify(weighed));
  assert.equal(weighed.to, "scanned");
});

test("the ward is refused outright for a hospital that is not wardsynq-native", async () => {
  seedHospital("native");
  const r = await as(DOCTOR, "/ward/list?orgId=" + ORG);
  assert.equal(r.__status, 409);
  assert.equal(r.error, "not_a_wardsynq_hospital");
  const admit = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: "X", ward: "Medical A" });
  assert.equal(admit.__status, 409, "and nothing can be admitted into it");
});

test("an order with no dose cannot be created, because the bedside could never check it", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const noDose = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Paracetamol 500mg", route: "oral" },
  });
  assert.equal(noDose.__status, 422);
  assert.equal(noDose.error, "order_incomplete");
});

/* ---- discharge ---------------------------------------------------------------------------------
 *
 * The auto maker is an ASSEMBLER: every line it writes is copied from a resource already in the
 * record. What is asserted below is not that it produces nice prose but that it cannot produce a
 * clinical claim nobody recorded, and that an empty section says so out loud rather than vanishing.
 */

test("discharge closes the stay, and a discharged patient leaves the ward list", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const before = await as(NURSE, `/ward/list?orgId=${ORG}&ward=Medical A`);
  assert.equal(before.patients.length, 1);

  const out = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, dischargedAt: "2026-09-08T11:00:00.000Z", disposition: "home" });
  assert.equal(out.__status, 200, JSON.stringify(out));
  assert.equal(out.status, "finished");

  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(enc.status, "finished");
  assert.equal(enc.periodEnd, "2026-09-08T11:00:00.000Z", "a discharged stay has a real end");
  assert.equal(enc.location.ward, "Medical A", "and keeps where it happened");

  const after = await as(NURSE, `/ward/list?orgId=${ORG}&ward=Medical A`);
  assert.equal(after.patients.length, 0, "the ward list is open admissions only");

  const again = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(again.written, 0);
  assert.equal(again.skipped, "already_discharged");
  assert.deepEqual((await RECORD.history(TENANT_ROW.id, "Encounter", adm.encounterId)).map((h) => h.status), ["in-progress", "finished"]);
});

/* THE LONGITUDINAL RECORD IS NOT A LEDGER THAT CLOSES. Discharge ends the STAY (the Encounter);
 * it must never make the clinical facts recorded during it unreadable. This is the one thing no
 * existing discharge test asserts directly - they exercise the discharge SUMMARY's own read (which
 * proves the summary generator can see the stay), not the ward's own chart-read routes a
 * clinician would open on a returning patient (flowsheet, problem list, vitals, the order/eMAR
 * history) after that stay has closed. */
test("a discharged stay's full record - vitals, the order, its administration, a note and a problem - all remain readable through the real chart-read routes", async () => {
  seedHospital();
  const { adm, ord, patient, scan } = await admittedPatientOnDrug();
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { sbp: "122", pulse: "76" } });
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, display: "Community-acquired pneumonia" } });
  const mar = (action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: DUE, patient, ...extra });
  await mar("verify"); await mar("dispense"); await mar("scan", { scan }); const given = await mar("administer");
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, dischargedAt: "2026-09-08T11:00:00.000Z" });
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(enc.status, "finished", "the stay really is closed - the reads below are of a CLOSED stay, not an open one");

  const flow = await as(DOCTOR, `/ward/flowsheet?orgId=${ORG}&patientId=${adm.patientId}&hours=168`);
  assert.equal(flow.__status, 200, JSON.stringify(flow));
  assert.ok(flow.grid.rows.some((r) => (r.cells || []).some((c) => !c.empty)), "the vitals charted during the stay are still on the flowsheet after discharge");

  const probs = await as(DOCTOR, `/ward/problems?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(probs.__status, 200);
  assert.ok(probs.problems.some((p) => p.display === "Community-acquired pneumonia"), "the problem recorded during the stay is still on the list");

  const order = await RECORD.latest(TENANT_ROW.id, "MedicationOrder", ord.orderId);
  assert.ok(order, "the order itself is still a real record");
  const administration = await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", given.administrationId);
  assert.equal(administration.status, "administered", "the eMAR history for a closed stay is not erased, hidden, or reset");

  // Reading a closed stay's chart WRITES NOTHING - discharge is not a trigger for silent
  // side-effects on the very record these reads just proved is still intact.
  assert.equal((await RECORD.history(TENANT_ROW.id, "Encounter", adm.encounterId)).length, 2, "still exactly admit + discharge, nothing appended by these reads");
});

test("discharge reports doses still in flight rather than silently closing over them", async () => {
  seedHospital();
  const { ord, patient, adm } = await admittedPatientOnDrug();
  await as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: "verify", orderId: ord.orderId, dueAt: DUE, patient });

  const out = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(out.__status, 200, "an unfinished dose is a hospital's policy call, not a refusal invented here");
  assert.equal(out.dosesInFlight.length, 1);
  assert.equal(out.dosesInFlight[0].status, "verified");
});

test("the auto maker assembles the summary from the record and invents nothing", async () => {
  seedHospital();
  const { ord, patient, adm } = await admittedPatientOnDrug();
  const mar = (action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: DUE, patient, ...extra });
  await mar("verify"); await mar("dispense");
  await mar("scan", { scan: { patientBarcode: patient.mrn, drugBarcode: "Paracetamol 500mg", dose: { value: 500, unit: "mg" }, route: "oral" } });
  await mar("administer");
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, dischargedAt: "2026-09-09T08:00:00.000Z" });

  const draft = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(draft.__status, 200, JSON.stringify(draft));
  const s = draft.sections;

  assert.match(s.admission, /Ward: Medical A, bed 12/);
  assert.match(s.admission, /Length of stay: 2 days/);
  assert.match(s.vitals, /Body weight|Systolic blood pressure/, "vitals are the recorded ones");
  assert.match(s.medications, /Paracetamol 500mg - 500 mg, oral/);
  assert.match(s.medications, /doses administered on this admission: 1/, "what was GIVEN, counted from administrations");
  assert.match(s.provenance, /Nothing here is generated or inferred/);

  // A section with no data says so; it does not disappear and it is not filled in.
  assert.equal(s.assessment, "Not recorded.", "no assessment was written on this stay, and the summary says so");
  assert.equal(s.investigations, "Not recorded.");
  assert.equal(s.allergies, "None documented on this admission.");

  assert.equal(draft.signed, false);
  const note = await RECORD.latest(TENANT_ROW.id, "ClinicalNote", draft.noteId);
  assert.equal(note.noteType, "discharge-summary");
  assert.equal(note.signedBy, null, "unsigned until a clinician signs it");
  assert.equal(note.aiDrafted, false, "assembled from the record, not generated");
});

/* A feed's MedicationOrder/MedicationAdministration/ServiceRequest can land on this patient's chart
 * (fhir-inbound.js) with the same patientId as this admission - and, by coincidence or forgery, the
 * same encounterId too, which is the one case the encounterId filter alone does not catch. It must
 * never be read as this hospital's own: not in the discharge summary, and not as a dose this ward
 * left mid-flight. */
test("a fed-in Medication*/ServiceRequest record never appears as this admission's own, in the discharge summary or the in-flight dose check", async () => {
  seedHospital();
  const { ord, patient, adm } = await admittedPatientOnDrug();
  const mar = (action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: DUE, patient, ...extra });
  await mar("verify"); await mar("dispense");
  await mar("scan", { scan: { patientBarcode: patient.mrn, drugBarcode: "Paracetamol 500mg", dose: { value: 500, unit: "mg" }, route: "oral" } });
  await mar("administer");

  const EXT = { system: "fhir-partner-his", sourceId: "ext-1", importedAt: "2026-09-07T09:00:00.000Z" };
  await RECORD.append(TENANT_ROW.id, [{
    resourceType: "MedicationOrder", id: "ext-rx-1", version: 1, patientId: adm.patientId, encounterId: adm.encounterId,
    drug: "Warfarin 5mg", status: "active", dose: { value: 5, unit: "mg" }, route: "oral", frequency: "OD",
    meta: { recordedAt: EXT.importedAt, effectiveAt: EXT.importedAt, source: EXT },
  }], { actor: "test" });
  await RECORD.append(TENANT_ROW.id, [{
    resourceType: "MedicationAdministration", id: "ext-mar-1", version: 1, patientId: adm.patientId, encounterId: adm.encounterId,
    orderId: "ext-rx-1", status: "verified",
    meta: { recordedAt: EXT.importedAt, effectiveAt: EXT.importedAt, source: EXT },
  }], { actor: "test" });
  await RECORD.append(TENANT_ROW.id, [{
    resourceType: "ServiceRequest", id: "ext-sr-1", version: 1, patientId: adm.patientId, encounterId: adm.encounterId,
    display: "MRI Brain", code: "MRI Brain", status: "active",
    meta: { recordedAt: EXT.importedAt, effectiveAt: EXT.importedAt, source: EXT },
  }], { actor: "test" });

  const out = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, dischargedAt: "2026-09-09T08:00:00.000Z" });
  assert.equal(out.__status, 200, JSON.stringify(out));
  assert.equal(out.dosesInFlight.length, 0, "the feed's own unfinished dose is not this hospital's to report");

  const draft = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(draft.__status, 200, JSON.stringify(draft));
  assert.doesNotMatch(draft.sections.medications, /Warfarin/, "a fed-in order is not this hospital's medication list");
  assert.doesNotMatch(draft.sections.investigations, /MRI Brain/, "nor a fed-in service request its investigation list");
  assert.match(draft.sections.medications, /Paracetamol 500mg/, "the real order is still there");
  assert.match(draft.sections.medications, /doses administered on this admission: 1/, "and its count is not inflated by the feed's administration");

  const read = await as(NURSE, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(read.__status, 200, JSON.stringify(read));
  assert.doesNotMatch(read.assembled.medications, /Warfarin/);
  assert.doesNotMatch(read.assembled.investigations, /MRI Brain/);
});

test("a discharge summary is signed as its own version, and a signed one is not redrafted", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  const draft = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });

  assert.equal((await as(NURSE, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId })).__status, 403);
  assert.equal((await as(NURSE, "/ward/sign-discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId })).__status, 403);

  const signed = await as(DOCTOR, "/ward/sign-discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(signed.__status, 200, JSON.stringify(signed));
  assert.equal(signed.signed, true);
  const note = await RECORD.latest(TENANT_ROW.id, "ClinicalNote", draft.noteId);
  assert.ok(note.signedBy, "the signature names the signer");
  assert.deepEqual((await RECORD.history(TENANT_ROW.id, "ClinicalNote", draft.noteId)).map((h) => !!h.signedBy), [false, true],
    "draft then signature, as two versions");

  const redraft = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(redraft.__status, 409);
  assert.equal(redraft.error, "already_signed");
});

test("a clinician's corrections survive, and only an inpatient stay can be discharged", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  const edited = await as(DOCTOR, "/ward/discharge-summary", "POST", {
    orgId: ORG, encounterId: adm.encounterId,
    sections: { assessment: "Community-acquired pneumonia, resolved.", plan: "Oral amoxicillin 5 days, review in clinic." },
  });
  assert.equal(edited.sections.assessment, "Community-acquired pneumonia, resolved.", "the clinician's words are kept verbatim");
  assert.match(edited.sections.admission, /Ward: Medical A/, "and the assembled sections they did not touch survive");

  /* AND THEY SURVIVE A RE-DRAFT. This is the one that matters: the assembler re-reads the record on
   * every draft, so without this a clinician's correction is silently reverted to the assembled text
   * the next time anybody opens the summary - including by the screen simply loading it. A
   * correction that a refresh can undo is not a correction. */
  const again = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(again.sections.assessment, "Community-acquired pneumonia, resolved.", "a re-draft does not revert the clinician");
  assert.equal(again.sections.plan, "Oral amoxicillin 5 days, review in clinic.");
  assert.match(again.sections.admission, /Ward: Medical A/, "and the untouched sections still refresh from the record");

  // The record says WHICH sections a clinician wrote, so a reader can tell those apart from the
  // assembled ones. Nothing else can distinguish them: the stored note is just text.
  assert.deepEqual([...(again.editedSections || [])].sort(), ["assessment", "plan"]);

  // An OPD ticket encounter is not an admission.
  const S = await as(DOCTOR, `/session?hospitalId=${ORG}`);
  const T = await as(DOCTOR, "/ticket", "POST", { sessionId: S.session.id, name: "OPD Testcase", mobile: "9876500099", mrn: "SMD-WARD01-00099", visitType: "new" });
  const opdEnc = "opd-enc-" + String(T.ticket.id).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const bad = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: opdEnc });
  assert.equal(bad.__status, 409);
  assert.equal(bad.error, "not_an_admission");
});

test("the summary can be READ without writing one, and it reports what is still outstanding", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, display: "Query sepsis" } });

  const read = await as(NURSE, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(read.__status, 200, JSON.stringify(read));
  assert.equal(read.stored, null, "no draft exists yet, and reading did not create one");
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "ClinicalNote", adm.patientId)).length, 0, "reading WRITES NOTHING");
  assert.match(read.assembled.admission, /Ward: Medical A/, "but the record's own account is available to show");
  assert.equal(read.encounter.status, "in-progress");

  // Outstanding items are surfaced BEFORE anyone signs, not discovered afterwards.
  const kinds = read.pending.map((p) => p.kind);
  assert.ok(kinds.includes("medication"), "an active order is a decision somebody has to have made");
  assert.ok(read.pending.some((p) => p.kind === "problem" && p.display === "Query sepsis"), "an unconfirmed diagnosis is unfinished business");
  assert.ok(read.pending.some((p) => p.kind === "medication" && p.id === ord.orderId));

  // A dose left mid-flight is outstanding too.
  await as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: "verify", orderId: ord.orderId, dueAt: DUE, patient: { id: adm.patientId } });
  const again = await as(NURSE, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.ok(again.pending.some((p) => p.kind === "dose" && p.status === "verified"), "a started, unfinished dose");
});

test("the read shows a clinician's words BESIDE the record's, so the two can never be confused", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  await as(DOCTOR, "/ward/discharge-summary", "POST", {
    orgId: ORG, encounterId: adm.encounterId, sections: { plan: "Review in clinic in one week." },
  });

  const read = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(read.stored.sections.plan, "Review in clinic in one week.", "what will be signed");
  assert.equal(read.assembled.plan, "Not recorded.", "and what the record itself says, unchanged");
  assert.deepEqual(read.stored.editedSections, ["plan"], "named, so a reader is never left to guess which is which");
  assert.equal(read.stored.signed, false);
  assert.equal(read.stored.signedBy, null);

  // A correction can be TAKEN BACK: matching the assembled text again returns the section to
  // tracking the record, rather than freezing it at a value that only happens to agree today.
  const reverted = await as(DOCTOR, "/ward/discharge-summary", "POST", {
    orgId: ORG, encounterId: adm.encounterId, sections: { plan: "Not recorded." },
  });
  assert.deepEqual(reverted.editedSections, [], "agreement is not an override");
});

test("a signed summary is immutable, keeps its provenance, and cannot be redrafted", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId, sections: { plan: "Discharge on oral antibiotics." } });
  const signed = await as(DOCTOR, "/ward/sign-discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(signed.__status, 200, JSON.stringify(signed));
  assert.deepEqual(signed.editedSections, ["plan"], "signing does not erase whose words these were");

  const read = await as(NURSE, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(read.stored.signed, true);
  assert.ok(read.stored.signedBy, "and it names who signed it");
  assert.deepEqual(read.stored.editedSections, ["plan"]);

  // A correction to a signed document is a new signed version, never a quiet redraft of this one.
  const redraft = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId, sections: { plan: "Something else." } });
  assert.equal(redraft.__status, 409);
  assert.equal(redraft.error, "already_signed");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "ClinicalNote", read.stored.noteId)).sections.plan, "Discharge on oral antibiotics.", "the signed text did not move");
});

test("a nurse may read the summary and may NOT author or sign one", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const read = await as(NURSE, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(read.__status, 200);
  assert.equal(read.canAuthor, false, "and the screen is told, so it never offers her a Sign button that must fail");
  assert.equal((await as(NURSE, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId })).__status, 403);
  assert.equal((await as(NURSE, "/ward/sign-discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId })).__status, 403);
  assert.equal((await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`)).canAuthor, true);

  // Identity is on the document, and an unmerged trauma record is never silently confirmed.
  assert.equal(read.patient.name, "Ward Testcase");
  assert.ok(read.patient.mrn);
  assert.equal(read.patient.provisional, false);
});

/* ---- problem list -------------------------------------------------------------------------------
 *
 * Condition had ZERO write paths before this: diagnoses existed only as prose inside an assessment
 * note, which is why the discharge summary's diagnoses section could never say anything.
 */

test("a diagnosis is recorded as a coded problem, updated in place, and resolved as a new version", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const p = (problem) => as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, ...problem } });

  const first = await p({ code: "J18.9", codeSystem: "ICD-10", display: "Pneumonia, unspecified organism", onsetDate: "2026-09-06" });
  assert.equal(first.__status, 200, JSON.stringify(first));
  assert.equal(first.verificationStatus, "provisional", "a new diagnosis is a claim, not a fact");
  assert.equal(first.clinicalStatus, "active");

  // The same concept again is an UPDATE of the one entry, not a duplicate.
  const confirmed = await p({ code: "J18.9", codeSystem: "ICD-10", display: "Pneumonia, unspecified organism", verificationStatus: "confirmed" });
  assert.equal(confirmed.problemId, first.problemId, "one problem per coded concept");
  assert.equal(confirmed.updated, true);
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "Condition", adm.patientId)).length, 1, "the list does not grow a duplicate");

  // Unchanged input writes nothing.
  assert.equal((await p({ code: "J18.9", codeSystem: "ICD-10", display: "Pneumonia, unspecified organism", verificationStatus: "confirmed" })).written, 0);

  // Resolving is a new version; the prior claim stays on the record.
  const resolved = await p({ code: "J18.9", codeSystem: "ICD-10", display: "Pneumonia, unspecified organism", verificationStatus: "confirmed", clinicalStatus: "resolved" });
  assert.equal(resolved.clinicalStatus, "resolved");
  const hist = await RECORD.history(TENANT_ROW.id, "Condition", first.problemId);
  assert.deepEqual(hist.map((h) => `${h.verificationStatus}/${h.clinicalStatus}`),
    ["provisional/active", "confirmed/active", "confirmed/resolved"], "the whole claim history survives");

  // The list reads active-first and hides resolved unless asked.
  await p({ code: "E11.9", codeSystem: "ICD-10", display: "Type 2 diabetes mellitus" });
  const active = await as(NURSE, `/ward/problems?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.deepEqual(active.problems.map((x) => x.display), ["Type 2 diabetes mellitus"]);
  const all = await as(NURSE, `/ward/problems?orgId=${ORG}&patientId=${adm.patientId}&includeInactive=1`);
  assert.equal(all.problems.length, 2);
  assert.equal(all.problems[0].clinicalStatus, "active", "active first, because that is how it is read");
});

test("an uncoded problem is recorded honestly as text, and a nurse cannot assert a diagnosis", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  const text = await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, display: "Query connective tissue disorder" } });
  assert.equal(text.__status, 200, JSON.stringify(text));
  assert.equal(text.codeSystem, "text", "no code to hand is recorded as text, not forced into a code nobody chose");

  // Asserting a diagnosis is emr.treat. A nurse may READ the list and not write to it.
  const nurseWrite = await as(NURSE, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, display: "Sepsis" } });
  assert.equal(nurseWrite.__status, 403);
  assert.equal((await as(NURSE, `/ward/problems?orgId=${ORG}&patientId=${adm.patientId}`)).__status, 200, "but she can read it");
});

test("the discharge summary now carries the problem list instead of an empty assessment", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "J18.9", codeSystem: "ICD-10", display: "Pneumonia, unspecified organism", verificationStatus: "confirmed" } });
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, code: "E11.9", codeSystem: "ICD-10", display: "Type 2 diabetes mellitus", clinicalStatus: "resolved" } });
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });

  const draft = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.match(draft.sections.diagnoses, /Active:/);
  assert.match(draft.sections.diagnoses, /Pneumonia, unspecified organism \[J18\.9\] - confirmed/);
  assert.match(draft.sections.diagnoses, /Resolved or inactive:[\s\S]*Type 2 diabetes/);
  // Still assembled, still not invented: a patient with no problems says so.
  assert.equal(draft.sections.provenance.includes("Nothing here is generated or inferred"), true);
});

/* ---- MAR scheduling ----------------------------------------------------------------------------
 *
 * Until this existed nothing computed what was due, so the ward screen had to ask the nurse to pick
 * a round time and say out loud that the system was not asserting anything.
 */

test("the round is computed from the frequency the doctor already wrote, and a given dose shows as given", async () => {
  seedHospital();
  const { adm, patient, scan } = await admittedPatientOnDrug();   // TID, ordered 2026-09-07

  const sched = await as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${adm.patientId}&from=2026-09-09T18:30:00.000Z&to=2026-09-10T18:30:00.000Z`);
  assert.equal(sched.__status, 200, JSON.stringify(sched));
  // TID on the default Indian ward round: 08:00, 14:00, 22:00 IST.
  assert.deepEqual(sched.due.map((d) => d.dueAt),
    ["2026-09-10T02:30:00.000Z", "2026-09-10T08:30:00.000Z", "2026-09-10T16:30:00.000Z"]);
  assert.equal(sched.due[0].drug, "Paracetamol 500mg");
  assert.deepEqual(sched.due.map((d) => d.status), [null, null, null], "nothing is started, and nothing pretends to be");
  assert.deepEqual(sched.prn, []);
  assert.deepEqual(sched.unscheduled, []);

  // NOTHING WAS WRITTEN. A schedule is derived; the administration record still only exists once a
  // nurse acts. Pre-created rows would put doses on the chart that nobody gave.
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "MedicationAdministration", adm.patientId)).length, 0);

  // Give the first one through the real eMAR, then the schedule reports it as given.
  const dueAt = sched.due[0].dueAt;
  const step = (action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: sched.due[0].orderId, dueAt, patient, ...(extra || {}) });
  await step("verify"); await step("dispense"); await step("scan", { scan });
  const given = await step("administer");
  assert.equal(given.__status, 200, JSON.stringify(given));

  const after = await as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${adm.patientId}&from=2026-09-09T18:30:00.000Z&to=2026-09-10T18:30:00.000Z`);
  assert.equal(after.due[0].status, "administered");
  assert.equal(after.due[0].administrationId, given.administrationId, "the slot and the record are the same dose");
  assert.equal(after.due[0].overdue, false, "a given dose is never chased");
  assert.equal(after.due[1].status, null);
});

test("a PRN drug never appears on the round, and an unreadable frequency is reported rather than dropped", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const order = (drug, frequency) => as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug, dose: { value: 5, unit: "mg" }, route: "oral", frequency },
  });
  await order("Morphine", "PRN");
  await order("Enoxaparin", "alternate days after dialysis");
  await order("Digoxin", "");

  const s = await as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${adm.patientId}&from=2026-09-09T18:30:00.000Z&to=2026-09-10T18:30:00.000Z`);
  assert.equal(s.__status, 200);
  assert.ok(!s.due.some((d) => d.drug === "Morphine"), "an as-needed drug is not due at a time");
  assert.deepEqual(s.prn.map((p) => p.drug), ["Morphine"], "but the ward can still see it and give one deliberately");
  assert.deepEqual(s.unscheduled.map((u) => [u.drug, u.reason]).sort(),
    [["Digoxin", "no_frequency"], ["Enoxaparin", "frequency_not_understood"]],
    "named, because a ward that cannot see the order has no way to know a dose is missing");
});

test("a finished course stops appearing, and the window is bounded", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG,
    order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Ceftriaxone", dose: { value: 1, unit: "g" }, route: "iv", frequency: "OD", stopAt: "2026-09-08T00:00:00.000Z" },
  });
  const s = await as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${adm.patientId}&from=2026-09-09T18:30:00.000Z&to=2026-09-10T18:30:00.000Z`);
  assert.ok(!s.due.some((d) => d.drug === "Ceftriaxone"), "a course that ended is not still being given");

  assert.equal((await as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${adm.patientId}`)).__status, 422, "a schedule needs a window");
  const wide = await as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${adm.patientId}&from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z`);
  assert.equal(wide.__status, 422);
  assert.equal(wide.error, "window_too_wide");
});

test("reading the round is a view, and it grants nothing: it cannot move a dose", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const q = `?orgId=${ORG}&patientId=${adm.patientId}&from=2026-09-09T18:30:00.000Z&to=2026-09-10T18:30:00.000Z`;
  // The doctor and the pharmacist can both READ what is due.
  assert.equal((await as(DOCTOR, "/ward/schedule" + q)).__status, 200);
  assert.equal((await as(PHARM, "/ward/schedule" + q)).__status, 200);
  // And the pharmacist still cannot administer: the view capability is not an administration one.
  const s = await as(NURSE, "/ward/schedule" + q);
  const bad = await as(PHARM, "/ward/mar", "POST", { orgId: ORG, action: "verify", orderId: s.due[0].orderId, dueAt: s.due[0].dueAt, patient: { id: adm.patientId } });
  assert.equal(bad.__status, 403);
});

/* ---- the discharge screen, end to end -----------------------------------------------------------
 *
 * The real discharge.js rendered against the REAL server payload, on a patient who was actually
 * admitted, treated and discharged through these routes. A screen tested only against a fixture is
 * tested against my idea of the contract rather than the contract.
 */

test("the discharge screen renders the real record, start to finish", async () => {
  seedHospital();
  const { reg, adm, ord, patient, scan } = await admittedPatientOnDrug();

  // A real stay: a diagnosis, an allergy, doses given, then discharge.
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "J18.9", codeSystem: "ICD-10", display: "Pneumonia, unspecified organism", verificationStatus: "confirmed" } });
  const step = (a, x) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: a, orderId: ord.orderId, dueAt: DUE, patient, ...(x || {}) });
  await step("verify"); await step("dispense"); await step("scan", { scan }); await step("administer");
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, disposition: "home" });

  // 1. The screen opens by READING. Nothing is written by looking at a patient.
  const read = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(read.__status, 200, JSON.stringify(read));
  assert.equal(read.stored, null);
  assert.equal(read.canAuthor, true);

  // Render the REAL ui against the REAL payload, exactly as the screen's load() does.
  const SRC = readFileSync(new URL("../discharge.js", import.meta.url), "utf8");
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  const D = win.DISCHARGE;
  const stateFor = (r, over) => ({
    orgId: ORG, encounterId: adm.encounterId, patientId: r.patientId,
    patient: r.patient, encounter: r.encounter, assembled: r.assembled,
    sections: r.stored ? r.stored.sections : r.assembled,
    edited: r.stored ? r.stored.editedSections : [],
    signed: !!(r.stored && r.stored.signed), signedBy: r.stored && r.stored.signedBy,
    version: r.stored && r.stored.version, recordedAt: r.stored && r.stored.recordedAt,
    hasDraft: !!r.stored, pending: r.pending, canAuthor: r.canAuthor,
    editing: "", compare: {}, busy: false, loaded: true, err: "", note: "", refusal: null, ...(over || {}),
  });
  const view = (r, over) => D._render(stateFor(r, over));

  const html = view(read);
  assert.match(html, /Ward Testcase/, "the patient is named on the document");
  assert.match(html, new RegExp(reg.mrn), "with their MRN");
  assert.match(html, /Discharged/);
  assert.match(html, /Medical A, bed 12/);
  assert.match(html, /Pneumonia, unspecified organism/, "the diagnosis reached the summary from the problem list");
  assert.match(html, /Paracetamol 500mg/, "and the medication from the orders");
  assert.match(html, /doses administered on this admission: 1/, "with what was actually GIVEN, not just ordered");
  assert.match(html, /Nothing here is generated or inferred/);
  assert.match(html, /From record/);
  assert.ok(!/Clinician edited/.test(html), "nothing has been edited yet");

  // 2. The clinician corrects one section. The others keep tracking the record.
  const edited = await as(DOCTOR, "/ward/discharge-summary", "POST", {
    orgId: ORG, encounterId: adm.encounterId,
    sections: { plan: "Oral amoxicillin for five days. Review in clinic in one week." },
  });
  assert.equal(edited.__status, 200, JSON.stringify(edited));
  const read2 = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  const html2 = view(read2);
  assert.match(html2, /Clinician edited/);
  assert.match(html2, /Review in clinic in one week\./);
  assert.match(html2, /Corrected by a clinician: plan and follow-up/);
  assert.match(html2, /Pneumonia, unspecified organism/, "and the untouched sections still carry the record");
  assert.match(html2, /data-d-act="compare:plan"/, "with the record's own version one tap away");
  // Expanded, both texts are on screen and attributed.
  assert.match(view(read2, { compare: { plan: true } }), /Assembled from the record/);

  // 3. Sign. The document becomes immutable and every edit affordance disappears.
  const signed = await as(DOCTOR, "/ward/sign-discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(signed.__status, 200, JSON.stringify(signed));
  const read3 = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  const state3 = stateFor(read3); const html3 = D._render(state3);
  assert.match(html3, /Signed off/);
  assert.ok(!/data-d-act="edit:/.test(html3), "no edit controls on a signed summary");
  assert.ok(!/data-d-act="sign"/.test(html3), "and it cannot be signed again");
  assert.match(html3, /Clinician edited/, "signing kept the provenance");
  assert.match(html3, /Review in clinic in one week\./, "and the clinician's words");

  // 4. The printed artifact carries the whole document and is marked as signed.
  const paper = D._printable(state3);
  assert.match(paper, /Discharge summary/);
  assert.match(paper, /Ward Testcase/);
  assert.match(paper, /Review in clinic in one week\./);
  assert.match(paper, /clinician edited/, "the paper says which words were the clinician's too");
  assert.match(paper, /Signed by/);
  assert.ok(!/UNSIGNED DRAFT/.test(paper));

  // 5. A nurse opening the same signed summary reads it and is offered nothing to change.
  const nurseView = view(await as(NURSE, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`));
  assert.match(nurseView, /Signed off/);
  assert.ok(!/data-d-act="edit:/.test(nurseView));
  assert.match(nurseView, /data-d-act="print"/, "but can still print it");
});

test("an unsigned summary is marked as a draft ON PAPER, so it cannot be mistaken for the real thing", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  const read = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);

  const SRC = readFileSync(new URL("../discharge.js", import.meta.url), "utf8");
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  const draftState = {
    patient: read.patient, encounter: read.encounter, assembled: read.assembled, sections: read.assembled,
    edited: [], pending: read.pending, canAuthor: true, signed: false, compare: {}, loaded: true,
  };
  win.DISCHARGE._render(draftState);
  const paper = win.DISCHARGE._printable(draftState);
  assert.match(paper, /UNSIGNED DRAFT - not a final discharge summary\./);
  assert.ok(!/Signed by/.test(paper));
});

/* ---- the critical result loop -------------------------------------------------------------------
 *
 * DiagnosticReport.critical carried a comment saying it gated a closed-loop escalation, and
 * wardsynq-simulation.js asserted "No critical result loop was closed without an acknowledgement"
 * against a world nothing ever populated. This is the loop.
 */

/** Puts a lab report with structured values straight onto the record, as an ingest would. */
async function labReport(adm, rows, opts) {
  const o = opts || {};
  const reportId = o.reportId || "wsq-dr-lab-1";
  const obsIds = [];
  for (const r of rows) {
    const id = `${reportId}-${r.code}`;
    obsIds.push(id);
    await RECORD.append(TENANT_ROW.id, [{
      resourceType: "Observation", id, version: 1, patientId: adm.patientId, encounterId: adm.encounterId,
      category: "laboratory", code: r.code, codeSystem: "http://loinc.org", value: r.value, unit: r.unit,
      sourceCritical: !!r.sourceCritical,
      meta: { recordedAt: "2026-09-07T09:00:00.000Z", effectiveAt: "2026-09-07T09:00:00.000Z" },
    }], { actor: "test" });
  }
  await RECORD.append(TENANT_ROW.id, [{
    resourceType: "DiagnosticReport", id: reportId, version: 1, patientId: adm.patientId,
    encounterId: adm.encounterId, code: o.code || "Renal profile", status: "final",
    critical: !!o.critical, resultObservationIds: obsIds,
    reportedAt: o.reportedAt || "2026-09-07T09:00:00.000Z",
    meta: { recordedAt: "2026-09-07T09:00:00.000Z", effectiveAt: "2026-09-07T09:00:00.000Z" },
  }], { actor: "test" });
  return reportId;
}

test("a critical result opens a loop, is acknowledged by a named clinician, and only then closes", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const reportId = await labReport(adm, [
    { code: "2823-3", value: 7.4, unit: "mmol/L" },      // potassium, critical by limit
    { code: "2951-2", value: 138, unit: "mmol/L" },      // sodium, normal
  ]);

  const opened = await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId });
  assert.equal(opened.__status, 200, JSON.stringify(opened));
  assert.equal(opened.opened, 1, "one loop, for the one critical analyte");
  assert.equal(opened.loops[0].code, "2823-3");
  assert.equal(opened.loops[0].basis, "limit");
  assert.equal(opened.loops[0].state, "open");
  assert.equal(opened.loops[0].acknowledgedBy, null);

  // The ward can SEE it without being able to act on it.
  const list = await as(NURSE, `/ward/criticals?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.open, 1);
  assert.equal(list.loops[0].display, "Potassium");
  assert.equal(list.loops[0].value, 7.4);

  // A nurse cannot acknowledge: it is a clinical decision recorded against a named clinician.
  const nurseAck = await as(NURSE, "/ward/acknowledge", "POST", { orgId: ORG, loopId: opened.loops[0].loopId, action: "seen" });
  assert.equal(nurseAck.__status, 403);

  // An acknowledgement with no action is a tick-box, and is refused.
  const empty = await as(DOCTOR, "/ward/acknowledge", "POST", { orgId: ORG, loopId: opened.loops[0].loopId, action: "  " });
  assert.equal(empty.__status, 422);
  assert.equal(empty.error, "action_required");

  const ack = await as(DOCTOR, "/ward/acknowledge", "POST", {
    orgId: ORG, loopId: opened.loops[0].loopId, action: "Seen. ECG done, calcium gluconate and insulin-dextrose given, repeat K in 1 hour.",
  });
  assert.equal(ack.__status, 200, JSON.stringify(ack));
  assert.equal(ack.state, "acknowledged");
  assert.ok(ack.acknowledgedBy, "and it names who saw it");
  assert.match(ack.action, /calcium gluconate/);
  assert.equal(ack.escalation.level, "none", "an acknowledged loop is no longer chased");

  // Closing keeps the acknowledgement; the invariant is that nothing closes without one.
  const closed = await as(DOCTOR, "/ward/acknowledge", "POST", { orgId: ORG, loopId: opened.loops[0].loopId, action: "Repeat K 4.9, resolved.", close: true });
  assert.equal(closed.state, "closed");
  assert.equal(closed.acknowledgedBy, ack.acknowledgedBy, "the FIRST acknowledgement is never overwritten");
  assert.match(closed.action, /calcium gluconate[\s\S]*Repeat K 4\.9/, "both entries survive");

  // The whole life of the loop is on the record, and an acknowledgement cannot be edited away.
  const hist = await RECORD.history(TENANT_ROW.id, "CriticalResultLoop", opened.loops[0].loopId);
  assert.deepEqual(hist.map((h) => h.state), ["open", "acknowledged", "closed"]);
  assert.equal(hist[0].acknowledgedBy, null);
  assert.ok(hist[1].acknowledgedBy);

  // Closed loops leave the default list rather than burying the open ones.
  assert.equal((await as(NURSE, `/ward/criticals?orgId=${ORG}&patientId=${adm.patientId}`)).loops.length, 0);
  assert.equal((await as(NURSE, `/ward/criticals?orgId=${ORG}&patientId=${adm.patientId}&state=closed`)).loops.length, 1);
});

test("a re-ingested result never reopens a loop a clinician already acknowledged", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const reportId = await labReport(adm, [{ code: "2823-3", value: 7.4, unit: "mmol/L" }]);
  const opened = await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId });
  await as(DOCTOR, "/ward/acknowledge", "POST", { orgId: ORG, loopId: opened.loops[0].loopId, action: "Treated." });

  // The same report arrives again, as an interface replay does.
  const again = await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId });
  assert.equal(again.opened, 0, "nothing new");
  assert.equal(again.loops[0].state, "acknowledged", "and the acknowledgement is not discarded because a message arrived twice");
  assert.equal((await RECORD.history(TENANT_ROW.id, "CriticalResultLoop", opened.loops[0].loopId)).length, 2);
});

test("a laboratory's own flag opens a loop even when the value looks fine, and even with no rows", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  // A normal-looking potassium the LAB flagged. Nothing here may talk the laboratory out of it.
  const r1 = await labReport(adm, [{ code: "2823-3", value: 4.2, unit: "mmol/L", sourceCritical: true }], { reportId: "wsq-dr-lab-a" });
  const a = await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId: r1 });
  assert.equal(a.opened, 1);
  assert.equal(a.loops[0].basis, "lab");

  // A report flagged critical at the header whose rows carry nothing we can attribute still opens a
  // loop. Dropping it because the row detail is thinner than the header is the silent failure.
  const r2 = await labReport(adm, [{ code: "2951-2", value: 139, unit: "mmol/L" }], { reportId: "wsq-dr-lab-b", critical: true, code: "Blood culture" });
  const b = await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId: r2 });
  assert.equal(b.opened, 1, "the header flag is not lost");
  assert.equal(b.loops[0].basis, "lab");
  assert.equal(b.loops[0].code, "Blood culture");
});

test("a value nobody could compare is reported as uncomparable, never as normal", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const reportId = await labReport(adm, [
    { code: "2823-3", value: 7.4, unit: "mg/dL" },       // right analyte, wrong unit
    { code: "718-7", value: "haemolysed", unit: "g/dL" }, // not a number at all
  ]);
  const r = await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId });
  assert.equal(r.opened, 0, "neither is flagged, because neither could be compared");
  assert.equal(r.uncomparable.length, 1);
  assert.equal(r.uncomparable[0].code, "2823-3");
  assert.equal(r.uncomparable[0].expectedUnit, "mmol/L");
});

test("an open loop gets louder, and the ward list puts the loudest first", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await labReport(adm, [{ code: "2823-3", value: 7.4, unit: "mmol/L" }], { reportId: "wsq-dr-old", reportedAt: "2026-09-07T08:00:00.000Z" });
  await labReport(adm, [{ code: "2951-2", value: 118, unit: "mmol/L" }], { reportId: "wsq-dr-new", reportedAt: "2026-09-07T09:50:00.000Z" });
  await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId: "wsq-dr-old" });
  await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId: "wsq-dr-new" });

  const list = await as(NURSE, `/ward/criticals?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(list.loops.length, 2);
  /* The older potassium outranks the newer sodium, whatever order they were written in. The exact
   * escalation LEVEL is deliberately not asserted here: it is a function of the wall clock, so a
   * test that pinned it would pass or fail depending on when it ran. The pure test covers the
   * thresholds exactly; this covers the ordering, which is the property the ward depends on. */
  assert.equal(list.loops[0].display, "Potassium");
  assert.equal(list.loops[1].display, "Sodium");
  const RANK = { escalate: 0, overdue: 1, due: 2, none: 3 };
  assert.ok(RANK[list.loops[0].escalation.level] <= RANK[list.loops[1].escalation.level], "loudest first");
  assert.ok(list.loops[0].escalation.minutesOpen >= list.loops[1].escalation.minutesOpen);
});

test("the ward list is visible to the ward, and a stranger's hospital is not", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const reportId = await labReport(adm, [{ code: "2823-3", value: 7.4, unit: "mmol/L" }]);
  await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId });

  // Seeing is not gated behind the authority to act: a ward that cannot see its open critical
  // results is the exact failure this path exists to prevent. Both clinical roles can look.
  for (const who of [DOCTOR, NURSE]) {
    assert.equal((await as(who, `/ward/criticals?orgId=${ORG}`)).__status, 200, who);
  }
  // Without a patient it is the whole ward's list, which is how a shift picks it up.
  assert.equal((await as(NURSE, `/ward/criticals?orgId=${ORG}`)).open, 1);

  /* THE PHARMACIST CAN SEE THIS TOO, since order.verify existed. This assertion previously recorded
   * the opposite as a known gap: the pharmacy role held no EMR capability at all, so a pharmacist
   * verifying a dose could not see the critical potassium they were meant to be checking against,
   * and the only lever available - emr.view - would have handed them the whole chart. The narrow
   * ORDER_VERIFY grant closed it. Reading the list is an alternative authority here, not a
   * widening: order.verify opens no other ward route. */
  assert.equal((await as(PHARM, `/ward/criticals?orgId=${ORG}`)).__status, 200);
  // Seeing a critical result still confers nothing else: it is a read, not a way in. Acknowledging
  // one is a clinical decision and stays with the treating clinician.
  assert.equal((await as(PHARM, "/ward/acknowledge", "POST", { orgId: ORG, loopId: "x", action: "seen" })).__status, 403);
  assert.equal((await as(PHARM, `/ward/vitals?orgId=${ORG}`)).__status, 403, "and no chart-writing route is open to them");
  /* The ward roster is refused too. Pharmacy holds queue.view, which opens the ROUTE, but has no
   * read scope on Encounter - so the record layer says no. It used to say so as a 502, which told
   * the caller the server was broken when it had simply refused; it is now the 403 it always was. */
  const roster = await as(PHARM, `/ward/list?orgId=${ORG}`);
  assert.equal(roster.__status, 403);
  assert.deepEqual(roster.reasons, ["READ_SCOPE_DENIED"]);
});

/* ---- transfer and the bed board -----------------------------------------------------------------
 *
 * A ward you can admit to and discharge from but not move within is not a ward.
 */

/* Another admitted patient, so a bed can actually be contended for. Each one gets its OWN mobile:
 * registration is keyed on it, and reusing one silently returns no MRN, which then surfaces much
 * later as an unrelated "no_patient_identity" on the admission. */
let nthPatient = 0;
async function secondPatient(ward = "Medical A", bed = "14") {
  const n = ++nthPatient;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: `Ward Testcase ${n + 1}`, mobile: `98765001${String(n).padStart(2, "0")}`, gender: "male", ageYears: 61 });
  assert.ok(reg.mrn, `registration ${n} produced no MRN: ${JSON.stringify(reg)}`);
  return as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward, bed, admittedAt: "2026-09-07T08:30:00.000Z" });
}

test("a transfer is a NEW VERSION of the same stay, and the history is the movement history", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  const moved = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "HDU", bed: "3", reason: "Rising oxygen requirement" });
  assert.equal(moved.__status, 200, JSON.stringify(moved));
  assert.deepEqual(moved.from, { ward: "Medical A", bed: "12" });
  assert.deepEqual(moved.to, { ward: "HDU", bed: "3" });

  // ONE encounter, not two: the stay is one stay.
  const hist = await RECORD.history(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.deepEqual(hist.map((h) => `${h.location.ward}/${h.location.bed}`), ["Medical A/12", "HDU/3"]);
  assert.equal(hist[1].movedBy, hist[1].movedBy && hist[1].movedBy, "and it names who moved them");
  assert.ok(hist[1].movedBy);
  assert.equal(hist[1].moveReason, "Rising oxygen requirement");
  assert.deepEqual(hist[1].movedFrom, { ward: "Medical A", bed: "12" });
  // The admission itself is untouched: same id, same start, still open.
  assert.equal(hist[1].periodStart, hist[0].periodStart);
  assert.equal(hist[1].status, "in-progress");

  // The ward list follows them.
  assert.equal((await as(NURSE, `/ward/list?orgId=${ORG}&ward=Medical A`)).patients.length, 0);
  const hdu = await as(NURSE, `/ward/list?orgId=${ORG}&ward=HDU`);
  assert.equal(hdu.patients.length, 1);
  assert.equal(hdu.patients[0].bed, "3");

  // Moving to where they already are writes nothing.
  assert.equal((await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "HDU", bed: "3" })).written, 0);
});

test("TWO PATIENTS CANNOT OCCUPY ONE BED, and the refusal names the occupant", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();          // Medical A, bed 12
  const other = await secondPatient("Medical A", "14");

  // A chart that puts two people in bed 12 is a chart that will hand one of them the other's drugs.
  const clash = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: other.encounterId, ward: "Medical A", bed: "12" });
  assert.equal(clash.__status, 409);
  assert.equal(clash.error, "bed_occupied");
  assert.equal(clash.occupiedBy.encounterId, adm.encounterId, "the ward is told WHAT the conflict is, not just no");
  assert.equal(clash.written, 0);

  // Case and spacing are not identity: "medical a" bed "12" is the same bed.
  assert.equal((await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: other.encounterId, ward: "medical a", bed: "12" })).error, "bed_occupied");

  // The bed frees the moment its occupant leaves it, by transfer or by discharge.
  await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "HDU", bed: "3" });
  assert.equal((await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: other.encounterId, ward: "Medical A", bed: "12" })).__status, 200);

  // A ward with no bed named cannot collide: a patient can be on a ward awaiting a bed.
  const third = await secondPatient("Medical A", "16");
  assert.equal((await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: third.encounterId, ward: "Medical A" })).__status, 200);
});

test("a closed stay is not transferred, and neither is an OPD visit", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  const gone = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "HDU", bed: "3" });
  assert.equal(gone.__status, 409);
  assert.equal(gone.error, "not_admitted", "re-opening the stay to accommodate the request would be far worse than refusing");

  // A discharged patient's bed is free for the next admission.
  const next = await secondPatient("Ward B", "1");
  assert.equal((await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: next.encounterId, ward: "Medical A", bed: "12" })).__status, 200);

  const missing = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: "wsq-adm-nobody", ward: "HDU", bed: "1" });
  assert.equal(missing.__status, 404);
  // A move to nowhere is not a transfer: blanking the location would lose the bed.
  assert.equal((await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: next.encounterId, bed: "9" })).error, "ward_required");
});

test("the bed board says who is where, and never confuses 'no free beds' with 'we do not know'", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();          // Medical A, bed 12
  await secondPatient("Medical A", "14");

  // With no bed list configured it reports the occupied beds and SAYS it cannot know what is free.
  const unknown = await as(NURSE, `/ward/beds?orgId=${ORG}`);
  assert.equal(unknown.__status, 200, JSON.stringify(unknown));
  assert.equal(unknown.bedsConfigured, false);
  const medA = unknown.wards.find((w) => w.ward === "Medical A");
  assert.equal(medA.occupied.length, 2);
  assert.equal(medA.bedsKnown, false, "a ward would read 0 free as full");
  assert.deepEqual(medA.free, []);
  assert.ok(medA.occupied.some((o) => o.encounterId === adm.encounterId));

  // A patient admitted to a ward with no bed yet is on the board, but not in a bed.
  const third = await secondPatient("Medical A", "");
  assert.equal(third.__status, 200, JSON.stringify(third));
  const withUnplaced = await as(NURSE, `/ward/beds?orgId=${ORG}&ward=Medical A`);
  assert.equal(withUnplaced.wards[0].unplaced.length, 1);
});

/* ---- the care plan -------------------------------------------------------------------------------------
 *
 * `CarePlan` has been in the model and the record service's allowed types since P0 and NOTHING HAS
 * EVER WRITTEN ONE - the same pattern `Condition` had before the problem list.
 */

test("a plan needs measurable goals, and progress is recorded rather than computed", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  // An absent plan is STATED, not returned as an empty one: "no plan has been written" and "a plan
  // with no goals" are different, and the first is what a ward acts on.
  const none = await as(NURSE, `/ward/plan?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(none.__status, 200, JSON.stringify(none));
  assert.equal(none.exists, false);
  assert.equal(none.plan, null);

  // A plan of wishes is refused.
  const wishes = await as(NURSE, "/ward/care-plan", "POST", { orgId: ORG, encounterId: adm.encounterId, goals: [{ title: "Improve mobility" }] });
  assert.equal(wishes.__status, 422);
  assert.equal(wishes.error, "no_goals");

  const plan = await as(NURSE, "/ward/care-plan", "POST", {
    orgId: ORG, encounterId: adm.encounterId, title: "Recovery from pneumonia",
    reviewBy: "2026-09-09T00:00:00.000Z",
    goals: [
      { title: "Mobilise", measure: "Walk to the bathroom with one assistant, by Friday" },
      { title: "Oxygen", measure: "Saturations above 94% on air for 24 hours" },
    ],
  });
  assert.equal(plan.__status, 200, JSON.stringify(plan));
  assert.equal(plan.activeGoals, 2);
  assert.ok(plan.goals.every((g) => g.setBy), "each goal names who set it");

  // Progress is somebody's decision, with their name and the date on it.
  const met = await as(NURSE, "/ward/progress", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "mobilise", state: "met" });
  assert.equal(met.__status, 200, JSON.stringify(met));
  assert.equal(met.counts.met, 1);
  assert.ok(met.goals.find((g) => g.key === "mobilise").decidedBy);

  // "Not met" is a real outcome and needs a reason - it is the one somebody asks about later.
  assert.equal((await as(NURSE, "/ward/progress", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "oxygen", state: "not-met" })).error, "note_required");
  const notMet = await as(NURSE, "/ward/progress", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "oxygen", state: "not-met", note: "Still needs 2L via nasal cannulae." });
  assert.equal(notMet.counts["not-met"], 1);

  // A decision about a goal that is not on the plan is refused, never appended.
  assert.equal((await as(NURSE, "/ward/progress", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "nutrition", state: "met" })).error, "goal_not_on_plan");
});

test("a second pass keeps the progress already recorded, and a stale plan says so", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const goals = [{ title: "Mobilise", measure: "Walk to the bathroom by Friday" }];
  await as(NURSE, "/ward/care-plan", "POST", { orgId: ORG, encounterId: adm.encounterId, goals, reviewBy: "2020-01-01T00:00:00.000Z" });
  await as(NURSE, "/ward/progress", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "mobilise", state: "met" });

  /* The night shift adds a goal. What the day shift decided must not reset - and a goal that has
   * DISAPPEARED from the list is dropped, because somebody removed it deliberately. */
  const second = await as(NURSE, "/ward/care-plan", "POST", {
    orgId: ORG, encounterId: adm.encounterId,
    goals: [...goals, { title: "Nutrition", measure: "Eating half of each meal by Monday" }],
  });
  assert.equal(second.counts.met, 1, "the decision survived the second pass");
  assert.equal(second.counts.active, 1);

  // A plan nobody has reviewed says it is stale rather than looking current.
  const read = await as(DOCTOR, `/ward/plan?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(read.plan.review.state, "stale");
  assert.ok(read.plan.review.overdueDays > 0);

  // Reviewing it is its own act, with a name and a date, and that is what makes "stale" mean anything.
  const reviewed = await as(NURSE, "/ward/progress", "POST", { orgId: ORG, encounterId: adm.encounterId, review: true, reviewBy: "2030-01-01T00:00:00.000Z" });
  assert.equal(reviewed.reviewed, true);
  assert.ok(reviewed.lastReviewedBy);
  assert.equal((await as(DOCTOR, `/ward/plan?orgId=${ORG}&encounterId=${adm.encounterId}`)).plan.review.state, "current");
});

test("care planning is nursing work, and the plan orders nothing", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const body = { orgId: ORG, encounterId: adm.encounterId, goals: [{ title: "Mobilise", measure: "Walk by Friday" }] };
  assert.equal((await as(NURSE, "/ward/care-plan", "POST", body)).__status, 200);
  assert.equal((await as(DOCTOR, "/ward/care-plan", "POST", body)).__status, 200);
  assert.equal((await as(PHARM, "/ward/care-plan", "POST", body)).__status, 403);
  assert.equal((await as(LABTECH, `/ward/plan?orgId=${ORG}&encounterId=${adm.encounterId}`)).__status, 403);
  // A plan says what is being aimed at; it writes no order of any kind.
  const orders = await RECORD.byPatient(TENANT_ROW.id, "ServiceRequest", adm.patientId);
  assert.equal(orders.length, 0);
  assert.equal((await as(NURSE, "/ward/progress", "POST", { orgId: ORG, encounterId: adm.encounterId })).error, "nothing_to_record");
});

/* ---- scheduling --------------------------------------------------------------------------------------
 *
 * Every discharge summary this system writes can say "review in clinic in one week", and until now
 * that sentence went nowhere.
 */

test("TWO PATIENTS CANNOT HOLD ONE SLOT, and overbooking says it is overbooking", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const other = await secondPatient("Medical A", "40");
  const slot = { clinicianId: "cfa:dr-clinic", startAt: "2026-09-14T09:00:00.000Z", minutes: 15 };

  const first = await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: adm.patientId, ...slot, reason: "Post-discharge review" });
  assert.equal(first.__status, 200, JSON.stringify(first));
  assert.equal(first.state, "booked");
  assert.equal(first.overbooked, false);

  // A clash is refused with the appointment in the way NAMED, so the desk can offer another time
  // rather than being told "no".
  const clash = await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: other.patientId, ...slot });
  assert.equal(clash.__status, 409);
  assert.equal(clash.error, "slot_taken");
  assert.equal(clash.clashesWith.patientId, adm.patientId);

  // Overlapping, not just identical, times clash.
  assert.equal((await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: other.patientId, clinicianId: slot.clinicianId, startAt: "2026-09-14T09:10:00.000Z", minutes: 15 })).error, "slot_taken");
  // Back to back is fine.
  assert.equal((await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: other.patientId, clinicianId: slot.clinicianId, startAt: "2026-09-14T09:15:00.000Z", minutes: 15 })).__status, 200);

  /* Overbooking is ALLOWED - real clinics overbook, and a system that refuses gets worked around -
   * but it must say why, or it is indistinguishable from the double-book this refuses. */
  assert.equal((await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: other.patientId, ...slot, overbook: true })).error, "overbook_reason_required");
  const over = await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: other.patientId, ...slot, overbook: true, overbookReason: "Urgent review, consultant agreed." });
  assert.equal(over.__status, 200, JSON.stringify(over));
  assert.equal(over.overbooked, true);
  assert.match(over.overbookReason, /consultant agreed/);

  // An appointment with no length cannot be checked for collision, so it is refused outright.
  assert.equal((await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: adm.patientId, clinicianId: "cfa:x", startAt: "2026-09-15T09:00:00.000Z" })).error, "minutes_required");
});

test("A PROMISED FOLLOW-UP STAYS OUTSTANDING UNTIL SOMEBODY BOOKS IT", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const req = await as(DOCTOR, "/ward/follow-up", "POST", {
    orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId,
    reason: "Review chest film and repeat CRP", dueBy: "2026-09-14T00:00:00.000Z",
  });
  assert.equal(req.__status, 200, JSON.stringify(req));
  assert.equal(req.state, "open");
  assert.match(req.note, /Nothing is booked until somebody books it/);

  /* NOTHING WAS BOOKED. Auto-booking would put an appointment in a diary nobody agreed to, at a time
   * nobody offered the patient - and would make the promise look kept when nobody had spoken to
   * them. */
  const before = await as(NURSE, `/ward/diary?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.deepEqual(before.appointments, []);
  assert.equal(before.unbookedRecalls, 1);
  assert.equal(before.recalls[0].reason, "Review chest film and repeat CRP");

  // Booking against the recall closes it, which is the point of the link.
  const booked = await as(DOCTOR, "/ward/book", "POST", {
    orgId: ORG, patientId: adm.patientId, clinicianId: "cfa:dr-clinic",
    startAt: "2026-09-12T10:00:00.000Z", minutes: 20, requestId: req.requestId,
  });
  assert.equal(booked.__status, 200, JSON.stringify(booked));
  assert.equal(booked.recall.state, "booked");
  const after = await as(NURSE, `/ward/diary?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(after.unbookedRecalls, 0);
  assert.equal(after.appointments.length, 1);
  assert.equal(after.appointments[0].requestId, req.requestId);
});

test("cancelling frees the slot and keeps the history; a closed appointment is not reopened", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const other = await secondPatient("Medical A", "41");
  const slot = { clinicianId: "cfa:dr-clinic", startAt: "2026-09-14T11:00:00.000Z", minutes: 15 };
  const a = await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: adm.patientId, ...slot });

  // Cancelling and marking a DNA both need a reason: they are the two a patient may later ask about.
  assert.equal((await as(DOCTOR, "/ward/appointment", "POST", { orgId: ORG, appointmentId: a.appointmentId, state: "cancelled" })).error, "reason_required");
  const gone = await as(DOCTOR, "/ward/appointment", "POST", { orgId: ORG, appointmentId: a.appointmentId, state: "cancelled", reason: "Patient rang to cancel." });
  assert.equal(gone.__status, 200, JSON.stringify(gone));
  assert.equal(gone.slotFreed, true);

  // The slot is genuinely free for somebody else.
  assert.equal((await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: other.patientId, ...slot })).__status, 200);

  /* "They cancelled" and "they never had one" are different facts, and the second is what a
   * complaint turns on. Both versions stay on the record. */
  const hist = await RECORD.history(TENANT_ROW.id, "Appointment", a.appointmentId);
  assert.deepEqual(hist.map((h) => h.state), ["booked", "cancelled"]);
  assert.match(hist[1].changeReason, /rang to cancel/);

  // A closed appointment is not reopened: a completed visit going back to "booked" would put a slot
  // in a diary for a consultation that already happened.
  assert.equal((await as(DOCTOR, "/ward/appointment", "POST", { orgId: ORG, appointmentId: a.appointmentId, state: "arrived" })).error, "already_closed");
});

test("the diary is the front desk's; promising a follow-up is clinical", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const slot = { orgId: ORG, patientId: adm.patientId, clinicianId: "cfa:dr-clinic", startAt: "2026-09-16T09:00:00.000Z", minutes: 15 };
  // Booking is the same administrative act as registering a walk-in, so the nurse at the desk can.
  assert.equal((await as(NURSE, "/ward/book", "POST", slot)).__status, 200);
  // Deciding the patient needs to be seen again is clinical.
  assert.equal((await as(NURSE, "/ward/follow-up", "POST", { orgId: ORG, patientId: adm.patientId, reason: "Review" })).__status, 403);
  assert.equal((await as(DOCTOR, "/ward/follow-up", "POST", { orgId: ORG, patientId: adm.patientId, reason: "Review" })).__status, 200);
  // A follow-up with no reason is not a follow-up.
  assert.equal((await as(DOCTOR, "/ward/follow-up", "POST", { orgId: ORG, patientId: adm.patientId })).error, "reason_required");
  // The laboratory has no business in the diary.
  assert.equal((await as(LABTECH, `/ward/diary?orgId=${ORG}`)).__status, 403);
});

/* ---- consent -----------------------------------------------------------------------------------------
 *
 * Break-glass answered "who looked at this chart in an emergency". Consent answers the prior
 * question: whether this patient permitted it at all, and for what.
 */

test("A REFUSAL IS RECORDED AS LOUDLY AS A GRANT, and survives being asked again", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  // Nothing recorded is NOT a refusal, and the answer says which it is.
  const cold = await as(NURSE, `/ward/consents?orgId=${ORG}&patientId=${adm.patientId}&scope=share-registry`);
  assert.equal(cold.__status, 200, JSON.stringify(cold));
  assert.equal(cold.status, "not-recorded");
  assert.equal(cold.permitted, false);

  const no = await as(NURSE, "/ward/consent", "POST", {
    orgId: ORG, patientId: adm.patientId, scope: "share-registry", decision: "refused",
    givenBy: "patient", capacity: true,
  });
  assert.equal(no.__status, 200, JSON.stringify(no));
  assert.equal(no.status, "refused");

  const asked = await as(DOCTOR, `/ward/consents?orgId=${ORG}&patientId=${adm.patientId}&scope=share-registry`);
  assert.equal(asked.status, "refused", "the next person to ask is told the patient already said no");
  assert.equal(asked.permitted, false);
  assert.equal(asked.consent.givenBy, "patient");
  assert.equal(asked.consent.capacity, true);

  // On the whole-patient view a refusal is counted and sorted to the top, never buried among grants.
  await as(NURSE, "/ward/consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "treatment", decision: "granted" });
  const all = await as(DOCTOR, `/ward/consents?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(all.refused, 1);
  assert.equal(all.consents[0].status, "refused");
  assert.equal(all.consents[0].scopeLabel, "Sharing with a registry or exchange");
});

test("consent is withdrawable, and the original grant stays on the record", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const yes = await as(NURSE, "/ward/consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "research", decision: "granted", capacity: true });
  assert.equal(yes.status, "granted");

  const gone = await as(NURSE, "/ward/withdraw-consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "research", reason: "Patient changed their mind." });
  assert.equal(gone.__status, 200, JSON.stringify(gone));
  assert.equal(gone.status, "withdrawn");
  assert.equal(gone.previousDecision, "granted");
  assert.equal((await as(DOCTOR, `/ward/consents?orgId=${ORG}&patientId=${adm.patientId}&scope=research`)).permitted, false);

  /* "They consented and later withdrew" and "they never consented" are different histories, and only
   * one of them is true. The grant survives as a version. */
  const hist = await RECORD.history(TENANT_ROW.id, "PatientConsent", yes.consentId);
  assert.deepEqual(hist.map((h) => h.decision), ["granted", "withdrawn"]);
  assert.ok(hist[1].withdrawalReason);

  // Withdrawing twice is a no-op; withdrawing something never granted says so rather than writing a
  // withdrawal of nothing.
  assert.equal((await as(NURSE, "/ward/withdraw-consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "research", reason: "again" })).skipped, "already_withdrawn");
  assert.equal((await as(NURSE, "/ward/withdraw-consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "photography", reason: "x" })).error, "no_consent_recorded");
});

test("a vague consent is refused, and consent does not gate care", async () => {
  seedHospital();
  const { adm, ord, patient, scan } = await admittedPatientOnDrug();
  // "Other" and "a specific procedure" mean nothing without saying which.
  assert.equal((await as(NURSE, "/ward/consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "procedure", decision: "granted" })).error, "detail_required");
  assert.equal((await as(NURSE, "/ward/consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "other", decision: "granted" })).error, "detail_required");
  assert.equal((await as(NURSE, "/ward/consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "telepathy", decision: "granted" })).error, "unknown_scope");
  // Withdrawal has its own path, so "withdrawn" is not a decision that can be recorded directly.
  assert.equal((await as(NURSE, "/ward/consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "research", decision: "withdrawn" })).error, "unknown_decision");

  /* IT DOES NOT ENFORCE, and that is deliberate. A generic gate refusing writes on a missing
   * tick-box would be wrong in an emergency and wrong for an unconscious patient - exactly the
   * moments it would fire. A refused treatment consent does not stop the ward giving a dose. */
  await as(NURSE, "/ward/consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "treatment", decision: "refused" });
  const step = (a, x) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: a, orderId: ord.orderId, dueAt: DUE, patient, ...(x || {}) });
  await step("verify"); await step("dispense"); await step("scan", { scan });
  assert.equal((await step("administer")).__status, 200, "the record informs; it does not block");

  // Two procedures are two consents, so the second cannot overwrite the first.
  await as(NURSE, "/ward/consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "procedure", decision: "granted", detail: "Right total hip replacement" });
  await as(NURSE, "/ward/consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "procedure", decision: "refused", detail: "Left total knee replacement" });
  const list = await as(DOCTOR, `/ward/consents?orgId=${ORG}&patientId=${adm.patientId}`);
  const procs = list.consents.filter((c) => c.scope === "procedure");
  assert.equal(procs.length, 2);
  assert.deepEqual(procs.map((p) => p.decision).sort(), ["granted", "refused"]);
});

/* ---- order sets -------------------------------------------------------------------------------------
 *
 * An order set applies a lot of clinical decisions very fast, which is what makes it useful and what
 * makes it dangerous. The whole design turns on one rule.
 */

test("APPLYING A SET IS APPLYING EACH ORDER THROUGH THE ORDINARY PATH", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  const sets = await as(NURSE, `/ward/order-sets?orgId=${ORG}`);
  assert.equal(sets.__status, 200, JSON.stringify(sets));
  assert.equal(sets.sets[0].id, "cap-admission");
  assert.equal(sets.sets[0].items.length, 3, "a clinician sees exactly what the set would order");

  const prep = await as(DOCTOR, "/ward/prepare-set", "POST", {
    orgId: ORG, setId: "cap-admission", patientId: adm.patientId, encounterId: adm.encounterId,
  });
  assert.equal(prep.__status, 200, JSON.stringify(prep));
  // Only the set's own defaults; the fluids were not pre-selected and are named as not ordered.
  assert.deepEqual(prep.requests.map((r) => r.key).sort(), ["amox", "cxr"]);
  assert.deepEqual(prep.deselected, ["fluids"]);
  assert.match(prep.note, /order REQUESTS, not orders/);

  /* NOTHING WAS ORDERED BY PREPARING. This is the property the whole design rests on: a set that
   * wrote orders directly would be a hole straight through every control in this system, and the
   * orders would look exactly like ordinary ones. */
  const before = await RECORD.byPatient(TENANT_ROW.id, "MedicationOrder", adm.patientId);
  assert.ok(!before.some((o) => /Amoxicillin/i.test(o.drug)), "preparing wrote no order");

  // The caller applies each request through the ORDINARY route, which is where the checks live.
  const med = prep.requests.find((r) => r.kind === "medication");
  const placed = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: med.order });
  assert.equal(placed.__status, 200, JSON.stringify(placed));
  assert.equal(placed.written, 1);

  const rec = await as(DOCTOR, "/ward/applied-set", "POST", {
    orgId: ORG, setId: prep.setId, setName: prep.setName, setVersion: prep.setVersion,
    patientId: adm.patientId, encounterId: adm.encounterId,
    applied: [{ key: "amox", orderId: placed.orderId }], failed: [], deselected: prep.deselected,
  });
  assert.equal(rec.__status, 200, JSON.stringify(rec));
  assert.equal(rec.setVersion, "3", "which set and which version, so a bad set's patients can be found");
  assert.equal(rec.appliedCount, 1);
  assert.equal(rec.partial, undefined);
});

test("PARTIAL APPLICATION IS LOUD: seven of eight is the dangerous case", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const rec = await as(DOCTOR, "/ward/applied-set", "POST", {
    orgId: ORG, setId: "cap-admission", setName: "CAP", setVersion: "3",
    patientId: adm.patientId, encounterId: adm.encounterId,
    applied: [{ key: "cxr", orderId: "sr-1" }],
    failed: [{ key: "amox", reason: "governance", detail: "refused: documented penicillin allergy" }],
  });
  assert.equal(rec.__status, 200, JSON.stringify(rec));
  // The missing one is invisible in a chart full of new orders unless the record says so.
  assert.equal(rec.partial, true);
  assert.equal(rec.failedCount, 1);
  assert.match(rec.failed[0].detail, /penicillin allergy/);
  const stored = await RECORD.byPatient(TENANT_ROW.id, "OrderSetApplication", adm.patientId);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].failed.map((f) => f.key), ["amox"]);
});

test("an item the clinician never saw is refused, and the sets are ORG content", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const bad = await as(DOCTOR, "/ward/prepare-set", "POST", {
    orgId: ORG, setId: "cap-admission", patientId: adm.patientId, encounterId: adm.encounterId,
    select: ["amox", "vancomycin"],
  });
  assert.equal(bad.__status, 409);
  assert.equal(bad.error, "not_in_set");
  assert.deepEqual(bad.unknown, ["vancomycin"]);
  assert.deepEqual(bad.requests, [], "and nothing at all is prepared");

  /* A caller cannot bring their own set. One who could would be handing themselves any order they
   * liked with a set's name and a set's authority on it. */
  const smuggled = await as(DOCTOR, "/ward/prepare-set", "POST", {
    orgId: ORG, setId: "mine", patientId: adm.patientId, encounterId: adm.encounterId,
    sets: [{ id: "mine", name: "Mine", items: [{ key: "m", kind: "medication", drug: "Morphine", dose: { value: 100, unit: "mg" } }] }],
  });
  assert.equal(smuggled.__status, 404);
  assert.equal(smuggled.error, "set_not_found");

  // Seeing a set is emr.view; applying one is ordering, so it is emr.treat.
  assert.equal((await as(NURSE, `/ward/order-sets?orgId=${ORG}`)).__status, 200);
  assert.equal((await as(NURSE, "/ward/prepare-set", "POST", { orgId: ORG, setId: "cap-admission", patientId: adm.patientId, encounterId: adm.encounterId })).__status, 403);
  assert.equal((await as(LABTECH, `/ward/order-sets?orgId=${ORG}`)).__status, 403);
});

/* ---- CDSS override analytics -----------------------------------------------------------------------
 *
 * The safety engine always REQUIRED a reason to override a warning, and then discarded it. Alert
 * fatigue is the characteristic failure of decision support, and a system that cannot see its own
 * override rate cannot know it has the problem.
 */

test("an override is recorded against the RULE, and the report names no clinician", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const safety = {
    rulePackVersion: "rx-2026.09",
    warnings: [{ code: "interaction", ruleId: "ddi-warfarin-nsaid", severity: "major", overridden: true }],
    overrides: [{ code: "interaction", targetId: "ddi-warfarin-nsaid", reasonCode: "benefit-outweighs-risk", rationale: "Single dose, INR checked today.", actorId: "cfa:dr" }],
  };
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, safety,
    order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Ibuprofen", dose: { value: 400, unit: "mg" }, route: "oral", frequency: "TDS" },
  });
  assert.equal(ord.__status, 200, JSON.stringify(ord));
  assert.equal(ord.overridesRecorded.written, 1, "the override is no longer thrown away");

  const rep = await as(NURSE, `/ward/overrides?orgId=${ORG}`);
  assert.equal(rep.__status, 200, JSON.stringify(rep));
  assert.equal(rep.report.totalOverrides, 1);
  assert.equal(rep.report.rules[0].targetId, "ddi-warfarin-nsaid");
  assert.equal(rep.report.rules[0].topReason, "benefit-outweighs-risk");
  /* This verdict carries no `findings`, so nothing counted what fired and there is no denominator.
   * The report says so rather than inventing one. The test below sends a full verdict and gets a
   * real rate. */
  assert.equal(rep.report.rules[0].overrideRate, null);
  assert.equal(rep.report.evaluationsRecorded, 0);
  assert.match(rep.report.note2, /numerators without a denominator/);
  // NO CLINICIAN IS NAMED. The report is evidence about rules; naming people would stop them
  // writing honest rationales, which is the only data that makes a rule fixable.
  assert.ok(!JSON.stringify(rep.report).includes("cfa:dr"));
  // The actor IS on the stored record, because a clinical decision needs an author.
  const stored = await RECORD.byPatient(TENANT_ROW.id, "SafetyOverride", adm.patientId);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].actorId, "cfa:dr");
  assert.equal(stored[0].rulePackVersion, "rx-2026.09");
});

test("THE OVERRIDE RATE GETS ITS DENOMINATOR: a rule respected twice and overridden once reads 0.33", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const RULE = { code: "interaction", ruleId: "ddi-warfarin-nsaid", disposition: "overridable", severity: "major" };
  const order = (drug, safety) => as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, safety,
    order: { patientId: adm.patientId, encounterId: adm.encounterId, drug, dose: { value: 400, unit: "mg" }, route: "oral", frequency: "TDS" },
  });

  /* Twice the rule fires and the prescriber respects it. THIS is the case that has to reach the
   * denominator: counting only the orders where somebody overrode something would make every rule in
   * the pack read as overridden 100% of the time. */
  const respected = { rulePackVersion: "rx-2026.09", findings: [RULE], warnings: [], overrides: [] };
  const a = await order("Ibuprofen", respected);
  assert.equal(a.__status, 200, JSON.stringify(a));
  assert.deepEqual(a.overridesRecorded.fired.keys, ["interaction:ddi-warfarin-nsaid"]);
  assert.equal(a.overridesRecorded.written, 0, "nothing was overridden, and nothing pretends it was");
  await order("Naproxen", respected);

  // The third time, the prescriber overrides it.
  const overridden = {
    ...respected,
    warnings: [{ ...RULE, overridden: true }],
    overrides: [{ code: "interaction", targetId: "ddi-warfarin-nsaid", reasonCode: "benefit-outweighs-risk", rationale: "Single dose, INR checked today.", actorId: "cfa:dr" }],
  };
  const c = await order("Diclofenac", overridden);
  assert.equal(c.overridesRecorded.written, 1);

  const rep = await as(NURSE, `/ward/overrides?orgId=${ORG}`);
  assert.equal(rep.__status, 200, JSON.stringify(rep));
  assert.equal(rep.report.evaluationsRecorded, 3);
  const rule = rep.report.rules.find((r) => r.targetId === "ddi-warfarin-nsaid");
  assert.equal(rule.fired, 3, "three orders, three alerts");
  assert.equal(rule.overridden, 1);
  assert.equal(rule.overrideRate, 0.33, "the number that says whether this rule is worth keeping");
  assert.equal(rep.report.note2, undefined, "and no caveat, because the denominator is real");

  // A retried identical order is the same evaluation, not a second alert. Inflating the denominator
  // would quietly lower the rate, which is the direction that hides a bad rule.
  await order("Diclofenac", overridden);
  const again = await as(NURSE, `/ward/overrides?orgId=${ORG}`);
  assert.equal(again.report.evaluationsRecorded, 3);
  assert.equal(again.report.rules.find((r) => r.targetId === "ddi-warfarin-nsaid").fired, 3);

  // The denominator comes from the RECORD, not from whoever reads the report.
  const firings = await RECORD.byPatient(TENANT_ROW.id, "SafetyFiring", adm.patientId);
  assert.equal(firings.length, 3);
  assert.ok(firings.every((f) => f.rulePackVersion === "rx-2026.09"));
});

test("AN ANALYTICS FAILURE NEVER COSTS A PATIENT THEIR MEDICINE", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  // A verdict whose override cannot be attributed: the analytics row is refused, and the ORDER is
  // still written. The order and the prescriber's safety decision are the clinical act.
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG,
    safety: { warnings: [{ code: "dose", overridden: true }], overrides: [] },
    order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Codeine", dose: { value: 30, unit: "mg" }, route: "oral", frequency: "QDS" },
  });
  assert.equal(ord.__status, 200, JSON.stringify(ord));
  assert.equal(ord.written, 1, "the order is written regardless");
  assert.ok(await RECORD.latest(TENANT_ROW.id, "MedicationOrder", ord.orderId));
  assert.equal(ord.overridesRecorded.written, 0);
  assert.deepEqual(ord.overridesRecorded.rejected.map((r) => r.reason), ["override_not_attributable"]);

  // An order with no safety verdict at all records nothing and says nothing about overrides.
  const plain = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Senna", dose: { value: 15, unit: "mg" }, route: "oral", frequency: "ON" },
  });
  assert.equal(plain.__status, 200);
  assert.equal(plain.overridesRecorded, undefined);
});

/* ---- identity: two records, one person -------------------------------------------------------------
 *
 * The harm of a duplicate is not the duplication. It is that half the clinical picture is invisible
 * from whichever record you happen to open.
 */

test("A MERGE MOVES NOTHING AND DESTROYS NOTHING, and it can be taken back", async () => {
  seedHospital();
  const { reg, adm } = await admittedPatientOnDrug();
  const dupe = await secondPatient("Medical A", "30");
  const before = {
    survivor: (await RECORD.byPatient(TENANT_ROW.id, "Observation", adm.patientId)).length,
    dupe: (await RECORD.byPatient(TENANT_ROW.id, "Encounter", dupe.patientId)).length,
  };
  assert.ok(before.survivor > 0 && before.dupe > 0);

  // A merge is a claim, and it needs a reason that says what establishes it.
  const bare = await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: adm.patientId, mergedId: dupe.patientId, reason: "same" });
  assert.equal(bare.__status, 422);
  assert.equal(bare.error, "reason_required");
  // And a record cannot absorb itself.
  assert.equal((await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: adm.patientId, mergedId: adm.patientId, reason: "Same date of birth and phone number." })).error, "same_patient");

  const merged = await as(DOCTOR, "/ward/merge", "POST", {
    orgId: ORG, survivorId: adm.patientId, mergedId: dupe.patientId,
    reason: "Same date of birth and mobile; confirmed with the patient at the desk.",
  });
  assert.equal(merged.__status, 200, JSON.stringify(merged));
  assert.equal(merged.state, "merged");
  assert.equal(merged.clinicalRecordsMoved, 0);

  /* NOTHING MOVED. Both Patient records and every clinical row under them are exactly as they were,
   * which is what makes the claim retractable at all. */
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "Observation", adm.patientId)).length, before.survivor);
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "Encounter", dupe.patientId)).length, before.dupe);
  assert.ok(await RECORD.latest(TENANT_ROW.id, "Patient", dupe.patientId), "the duplicate record still exists");

  // Resolving now returns every id whose records belong to this person.
  const id = await as(NURSE, `/ward/identity?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(id.__status, 200, JSON.stringify(id));
  assert.deepEqual(id.identity.absorbed, [dupe.patientId]);
  assert.deepEqual(id.identity.allIds.sort(), [adm.patientId, dupe.patientId].sort());

  /* A READ OF THE MERGED RECORD STILL WORKS AND SAYS SO. A clinician who followed a link here needs
   * to be told where the rest of the picture is, not handed an empty chart or a 404. */
  const other = await as(NURSE, `/ward/identity?orgId=${ORG}&patientId=${dupe.patientId}`);
  assert.equal(other.__status, 200);
  assert.equal(other.identity.isMerged, true);
  assert.equal(other.identity.mergedInto, adm.patientId);
  assert.match(other.notice, /merged into/);

  // AND IT IS REVERSIBLE. An irreversible merge is worse than a duplicate.
  const undone = await as(DOCTOR, "/ward/unmerge", "POST", {
    orgId: ORG, survivorId: adm.patientId, mergedId: dupe.patientId, reason: "Different people with the same name; the phone number was mistyped.",
  });
  assert.equal(undone.__status, 200, JSON.stringify(undone));
  assert.equal(undone.state, "unmerged");
  assert.equal(undone.mergedBy, merged.mergedBy, "who made the original claim is not erased by undoing it");
  assert.deepEqual((await as(NURSE, `/ward/identity?orgId=${ORG}&patientId=${adm.patientId}`)).identity.absorbed, []);
  // The whole life of the claim is on the record.
  assert.deepEqual((await RECORD.history(TENANT_ROW.id, "PatientLink", merged.linkId)).map((h) => h.state), ["merged", "unmerged"]);
  assert.ok(reg.mrn);
});

test("a merge is refused where it would create an identity by side effect or a chain", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const b = await secondPatient("Medical A", "31");
  const c = await secondPatient("Medical A", "32");
  const reason = "Same date of birth and mobile; confirmed at the desk.";

  // Merging into a record nobody has ever seen would create an identity by side effect.
  assert.equal((await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: "opd-pat-nobody", mergedId: b.patientId, reason })).error, "survivor_not_found");
  assert.equal((await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: adm.patientId, mergedId: "opd-pat-nobody", reason })).error, "merged_not_found");

  await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: adm.patientId, mergedId: b.patientId, reason });
  // Chaining identities silently is how a merge becomes impossible to unpick.
  const chained = await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: c.patientId, mergedId: b.patientId, reason });
  assert.equal(chained.__status, 409);
  assert.equal(chained.error, "already_merged");
  assert.equal(chained.into, adm.patientId, "and it names the link that is in the way");
  // Repeating the SAME merge is idempotent, not an error.
  assert.equal((await as(DOCTOR, "/ward/merge", "POST", { orgId: ORG, survivorId: adm.patientId, mergedId: b.patientId, reason })).written, 0);
});

test("resolving identity is the registration authority, and nothing automatic does it", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const b = await secondPatient("Medical A", "33");
  const body = { orgId: ORG, survivorId: adm.patientId, mergedId: b.patientId, reason: "Same date of birth and mobile; confirmed at the desk." };
  // Reception registers patients, so reception resolves duplicates: it is the same act.
  assert.equal((await as(DOCTOR, "/ward/merge", "POST", body)).__status, 200);
  // A laboratory and a pharmacist have no business deciding who a patient is.
  assert.equal((await as(LABTECH, "/ward/merge", "POST", body)).__status, 403);
  assert.equal((await as(PHARM, "/ward/merge", "POST", body)).__status, 403);
  // But any clinician can SEE the resolution, because a merged record must never look like an
  // empty one to whoever opens it.
  assert.equal((await as(NURSE, `/ward/identity?orgId=${ORG}&patientId=${b.patientId}`)).__status, 200);
});

/* ---- the laboratory -------------------------------------------------------------------------------
 *
 * WardSynQ could ORDER a test and could INGEST a result from GHIS, and could not produce one itself.
 * This is the piece that makes the critical-value loop reachable natively.
 */

/** An investigation ordered on this admission, straight onto the record. */
async function orderTest(adm, code = "Renal profile", id = "wsq-sr-1") {
  await RECORD.append(TENANT_ROW.id, [{
    resourceType: "ServiceRequest", id, version: 1, patientId: adm.patientId, encounterId: adm.encounterId,
    code, display: code, status: "active", requesterId: "cfa:dr",
    meta: { recordedAt: "2026-09-07T08:30:00.000Z", effectiveAt: "2026-09-07T08:30:00.000Z" },
  }], { actor: "test" });
  return id;
}

test("ORDER -> RESULT -> CRITICAL LOOP, natively, end to end", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const sr = await orderTest(adm);

  // The laboratory sees what was asked for.
  const pending = await as(LABTECH, `/ward/pending-tests?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(pending.__status, 200, JSON.stringify(pending));
  assert.deepEqual(pending.pending.map((p) => p.serviceRequestId), [sr]);

  const rel = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: sr, status: "final", reportedAt: "2026-09-07T10:00:00.000Z",
    tests: [
      { test: "Potassium", value: 7.4, unit: "mmol/L", range: "3.5-5.1" },
      { test: "Sodium", value: 138, unit: "mmol/L" },
      { test: "Blood culture", value: "No growth at 48h" },
    ],
  });
  assert.equal(rel.__status, 200, JSON.stringify(rel));
  assert.equal(rel.status, "final");
  assert.equal(rel.unsolicited, false, "it answers the request it was asked against");
  assert.ok(rel.releasedBy, "and it names who released it");
  // The known analytes are LOINC; the free-text one is honestly local.
  const k = rel.observations.find((o) => o.display === "Potassium");
  assert.equal(k.codeSystem, "http://loinc.org");
  assert.equal(rel.observations.find((o) => o.display === "Blood culture").codeSystem, "wardsynq-lab-local");

  // It is now on the chart, and the critical loop opens off it - natively, with no GHIS anywhere.
  const opened = await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId: rel.reportId });
  assert.equal(opened.opened, 1);
  assert.equal(opened.loops[0].display, "Potassium");
  assert.equal(opened.loops[0].basis, "limit", "flagged by the site's limits, not by the lab");
  assert.equal(opened.loops[0].value, 7.4);

  // And the request drops off the pending list, because it has been answered.
  assert.deepEqual((await as(LABTECH, `/ward/pending-tests?orgId=${ORG}&patientId=${adm.patientId}`)).pending, []);
});

test("A FINAL RESULT IS CORRECTED, NEVER OVERWRITTEN", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const sr = await orderTest(adm);
  const first = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: sr, status: "final", tests: [{ test: "Potassium", value: 7.4, unit: "mmol/L" }],
  });
  assert.equal(first.__status, 200);

  // Re-releasing over a final result must SAY it is a correction. Amending a result somebody has
  // already acted on is the most dangerous thing a laboratory system does.
  const quiet = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: sr, status: "final", tests: [{ test: "Potassium", value: 4.1, unit: "mmol/L" }],
  });
  assert.equal(quiet.__status, 409);
  assert.equal(quiet.error, "already_final");

  const fixed = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: sr, status: "corrected", tests: [{ test: "Potassium", value: 4.1, unit: "mmol/L" }],
  });
  assert.equal(fixed.__status, 200, JSON.stringify(fixed));
  assert.equal(fixed.corrected, true);

  // THE OLD VALUE SURVIVES. It is the one case where a reader must be able to see what was acted on.
  const hist = await RECORD.history(TENANT_ROW.id, "Observation", first.observations[0].id);
  assert.deepEqual(hist.map((h) => h.value), [7.4, 4.1]);
  assert.deepEqual((await RECORD.history(TENANT_ROW.id, "DiagnosticReport", first.reportId)).map((h) => h.status), ["final", "corrected"]);

  // A preliminary result, by contrast, may simply be superseded.
  const sr2 = await orderTest(adm, "Troponin", "wsq-sr-2");
  await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr2, status: "preliminary", tests: [{ test: "Troponin", value: "<0.01" }] });
  assert.equal((await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr2, status: "final", tests: [{ test: "Troponin", value: 0.9, unit: "ng/mL" }] })).__status, 200);
});

test("an add-on with no request is recorded as UNSOLICITED, not attached to the nearest one", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await orderTest(adm);
  const addon = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, patientId: adm.patientId, panel: "Add-on magnesium", reportedAt: "2026-09-07T11:00:00.000Z",
    tests: [{ test: "Magnesium", value: 0.4, unit: "mmol/L" }],
  });
  assert.equal(addon.__status, 200, JSON.stringify(addon));
  assert.equal(addon.unsolicited, true, "attaching it to whatever request looked closest is how a result lands on the wrong test");
  assert.equal(addon.serviceRequestId, null);
  // The real request is still pending: an add-on did not answer it.
  assert.equal((await as(LABTECH, `/ward/pending-tests?orgId=${ORG}&patientId=${adm.patientId}`)).pending.length, 1);

  // A result naming neither a patient nor a request is refused.
  assert.equal((await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, tests: [{ test: "K", value: 1 }] })).error, "patient_required");
  // And one with no usable values is not a result.
  const empty = await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, patientId: adm.patientId, tests: [{ test: "K" }] });
  assert.equal(empty.__status, 422);
  assert.equal(empty.error, "nothing_to_release");
});

test("THE LAB'S AUTHORITY IS ITS OWN: it results, and it does nothing else", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();
  const sr = await orderTest(adm);
  const result = { orgId: ORG, serviceRequestId: sr, tests: [{ test: "Potassium", value: 4.1, unit: "mmol/L" }] };

  // Only the laboratory results. A clinician orders; a nurse gives; neither releases a result.
  assert.equal((await as(LABTECH, "/ward/release-result", "POST", result)).__status, 200);
  assert.equal((await as(DOCTOR, "/ward/release-result", "POST", result)).__status, 403);
  assert.equal((await as(NURSE, "/ward/release-result", "POST", result)).__status, 403);
  assert.equal((await as(PHARM, "/ward/release-result", "POST", result)).__status, 403);

  // And the laboratory does nothing else: no chart, no orders, no doses, no diagnoses.
  assert.equal((await as(LABTECH, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`)).__status, 403);
  assert.equal((await as(LABTECH, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, display: "Sepsis" } })).__status, 403);
  assert.equal((await as(LABTECH, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "X", dose: { value: 1, unit: "mg" } } })).__status, 403);
  assert.equal((await as(LABTECH, "/ward/mar", "POST", { orgId: ORG, action: "administer", orderId: ord.orderId, dueAt: DUE, patient: { id: adm.patientId } })).__status, 403);
  assert.equal((await as(LABTECH, `/ward/criticals?orgId=${ORG}`)).__status, 403, "and not the ward's critical list");

  /* THE ROUTE ALWAYS STAMPS "laboratory", and it is no longer the only thing standing there: the
   * grant now carries a category allow-list, so the raw record API refuses a lab actor a vital sign
   * even if it never reaches this route. See the scope test below. */
  const obs = await RECORD.byPatient(TENANT_ROW.id, "Observation", adm.patientId);
  const fromLab = obs.filter((o) => o.codeSystem === "http://loinc.org" && o.code === "2823-3");
  assert.ok(fromLab.length >= 1);
  assert.ok(fromLab.every((o) => o.category === "laboratory"));
});

test("A LABORATORY MAY NOT WRITE A VITAL SIGN, AND A NURSE MAY NOT WRITE A RESULT", async () => {
  seedHospital();
  const { grantForRole } = await import("../functions/_wardsynq/actor.js");

  /* One resource type, four unrelated clinical meanings. Both directions matter and both were open:
   * the eMAR reads a vital sign to check a weight-based dose, and the critical-value loop believes
   * anything categorised `laboratory`. */
  const lab = grantForRole("lab");
  assert.deepEqual(lab.writeCategories, { Observation: ["laboratory"] });
  assert.ok(lab.write.includes("Observation"), "still the same type scope as before");

  const nurse = grantForRole("nurse");
  // "device" joined 2026-09-08 (Task 2.2, ICU): a device reading reaches the chart through the
  // same bedside authority as a vital sign or a fluid entry. "labour" joined the same day
  // (Task 2.4): a partogram's raw data is the midwife's own bedside charting, same authority.
  // "neonatal" joined 2026-09-08 (Task 2.5): the same bedside authority, for a NICU cot.
  assert.deepEqual(nurse.writeCategories, { Observation: ["vital-signs", "fluid-balance", "device", "labour", "neonatal"] });

  // A doctor writes every type, so no category constraint applies: an unconstrained scope cannot be
  // partly constrained, and leaving one attached would refuse the one type it names while
  // permitting every other.
  assert.equal(grantForRole("doctor").write, null);
  assert.equal(grantForRole("doctor").writeCategories, null);

  // The nurse's real work is unaffected, which is the point of listing fluid-balance beside vitals.
  const { adm } = await admittedPatientOnDrug();
  assert.equal((await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { sbp: "120", dbp: "80" } })).written, 2);
  const fluid = await as(NURSE, "/ward/fluid", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, entries: [{ direction: "intake", kind: "oral", value: 200, at: "2026-09-07T09:00:00.000Z" }] });
  assert.equal(fluid.__status, 200, JSON.stringify(fluid));
});

test("the ward metrics count what every other mechanism left open, from the real record", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();
  // Leave one of each kind of open item behind.
  const reportId = await labReport(adm, [{ code: "2823-3", value: 7.4, unit: "mmol/L" }]);
  await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId });
  await as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: "verify", orderId: ord.orderId, dueAt: DUE, patient: { id: adm.patientId } });
  await as(NURSE, "/ward/handover", "POST", { orgId: ORG, encounterId: adm.encounterId, sbar: { situation: "Stable." } });
  await as(NURSE, "/ward/med-history", "POST", { orgId: ORG, encounterId: adm.encounterId, medicines: [{ drug: "Warfarin", dose: "3 mg" }] });

  const m = await as(NURSE, `/ward/metrics?orgId=${ORG}`);
  assert.equal(m.__status, 200, JSON.stringify(m).slice(0, 300));
  assert.equal(m.metrics.patients, 1);
  assert.equal(m.metrics.open.criticalResults, 1);
  assert.equal(m.metrics.open.dosesInFlight, 1, "verified is started and not finished");
  assert.equal(m.metrics.open.handoversWaiting, 1);
  assert.equal(m.metrics.open.medicinesUndecided, 1);
  assert.equal(m.metrics.open.ordersNotPharmacyVerified, 1);
  assert.equal(m.metrics.openItems, 5);
  assert.equal(m.metrics.oldestUnacknowledgedCritical.display, "Potassium");

  // Finishing the work is the only thing that moves it.
  await as(DOCTOR, "/ward/acknowledge", "POST", { orgId: ORG, loopId: m.metrics.oldestUnacknowledgedCritical.loopId, action: "Treated." });
  await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: ord.orderId, outcome: "verified" });
  const after = await as(NURSE, `/ward/metrics?orgId=${ORG}`);
  assert.equal(after.metrics.open.criticalResults, 0);
  assert.equal(after.metrics.open.ordersNotPharmacyVerified, 0);
  assert.equal(after.metrics.openItems, 3);
  assert.equal(after.metrics.oldestUnacknowledgedCritical, null);
});

/* ---- medicines reconciliation ---------------------------------------------------------------------
 *
 * The best-evidenced medication harm in hospital medicine is not a wrong dose. It is a home medicine
 * that quietly stopped.
 */

test("a home medicine with no decision is NAMED, and reaches the discharge summary as unreconciled", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const hx = await as(NURSE, "/ward/med-history", "POST", {
    orgId: ORG, encounterId: adm.encounterId, stage: "admission", source: "gp-record",
    medicines: [
      { drug: "Warfarin", dose: "3 mg", frequency: "OD" },
      { drug: "Levothyroxine", dose: "75 mcg", frequency: "OM" },
    ],
  });
  assert.equal(hx.__status, 200, JSON.stringify(hx));
  assert.equal(hx.undecided, 2, "nothing is assumed continued");
  assert.equal(hx.complete, false);

  // Deciding is the treating clinician's act, not the history-taker's.
  assert.equal((await as(NURSE, "/ward/med-decide", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "warfarin", decision: "continued" })).__status, 403);
  // And STOPPING needs a reason: it is the decision that causes the harm.
  const bare = await as(DOCTOR, "/ward/med-decide", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "warfarin", decision: "stopped" });
  assert.equal(bare.__status, 422);
  assert.equal(bare.error, "reason_required");

  const stopped = await as(DOCTOR, "/ward/med-decide", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "warfarin", decision: "stopped", reason: "Held pre-operatively, restart per haematology." });
  assert.equal(stopped.__status, 200, JSON.stringify(stopped));
  assert.equal(stopped.undecided, 1, "the levothyroxine is still open");
  assert.equal(stopped.complete, false);

  // THE SUMMARY NAMES THE ONE NOBODY DECIDED. A summary listing only the decided medicines would
  // read as a completed reconciliation, and the undecided one is exactly the one that gets lost.
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  const draft = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.match(draft.sections.homeMedicines, /Stopped:\nWarfarin 3 mg, OD - Held pre-operatively/);
  assert.match(draft.sections.homeMedicines, /NOT RECONCILED[\s\S]*Levothyroxine/);

  // Finish it, and the summary stops saying so.
  await as(DOCTOR, "/ward/med-decide", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "levothyroxine", decision: "continued" });
  const rec = await as(NURSE, `/ward/med-reconciliation?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(rec.undecided, 0);
  assert.equal(rec.reconciliations[0].complete, true);
  assert.ok(rec.reconciliations[0].completedBy);
});

test("a second history pass keeps the decisions already made", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const put = (medicines) => as(NURSE, "/ward/med-history", "POST", { orgId: ORG, encounterId: adm.encounterId, stage: "admission", medicines });
  await put([{ drug: "Warfarin", dose: "3 mg" }, { drug: "Amlodipine", dose: "5 mg" }]);
  await as(DOCTOR, "/ward/med-decide", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "warfarin", decision: "continued" });

  /* The pharmacist arrives with the GP record after the nurse took a history. The work already done
   * must not be wiped, and a medicine that has DISAPPEARED from the list is dropped - it was not
   * something the patient takes. */
  const second = await put([{ drug: "Warfarin", dose: "3 mg" }, { drug: "Ramipril", dose: "5 mg" }]);
  assert.equal(second.__status, 200, JSON.stringify(second));
  const warf = second.medicines.find((m) => m.key === "warfarin");
  assert.equal(warf.decision, "continued", "the decision survived the second pass");
  assert.ok(warf.decidedBy);
  assert.ok(!second.medicines.some((m) => m.key === "amlodipine"), "a medicine no longer on the list is dropped");
  assert.equal(second.medicines.find((m) => m.key === "ramipril").decision, "undecided");
  assert.equal(second.undecided, 1);
});

test("NOTHING IS MATCHED BY NAME, and a decision cannot invent a medicine", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();     // already on Paracetamol as an inpatient
  await as(NURSE, "/ward/med-history", "POST", {
    orgId: ORG, encounterId: adm.encounterId, stage: "admission",
    medicines: [{ drug: "Warfarin", dose: "3 mg" }],
  });
  const rec = await as(NURSE, `/ward/med-reconciliation?orgId=${ORG}&encounterId=${adm.encounterId}`);
  /* The inpatient Paracetamol order does NOT mark anything reconciled, and nothing was auto-decided
   * from a similar-looking drug. Marking warfarin continued because an anticoagulant appears on the
   * chart is precisely the silent failure this refuses to risk. */
  assert.equal(rec.reconciliations[0].undecided, 1);
  assert.equal(rec.reconciliations[0].medicines.length, 1);

  // A decision about a medicine that is not on the list is refused, never appended.
  const ghost = await as(DOCTOR, "/ward/med-decide", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "digoxin", decision: "continued" });
  assert.equal(ghost.__status, 404);
  assert.equal(ghost.error, "medicine_not_on_list");
  // And "undecided" is not a decision anyone can record.
  assert.equal((await as(DOCTOR, "/ward/med-decide", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "warfarin", decision: "undecided" })).__status, 400);

  // IT DOES NOT PRESCRIBE: continuing a home medicine records the decision, and writes no order.
  await as(DOCTOR, "/ward/med-decide", "POST", { orgId: ORG, encounterId: adm.encounterId, key: "warfarin", decision: "continued" });
  const orders = await RECORD.byPatient(TENANT_ROW.id, "MedicationOrder", adm.patientId);
  assert.ok(!orders.some((o) => /warfarin/i.test(o.drug)), "no order appeared: the eMAR's controls are not bypassed");
});

/* ---- FHIR export ----------------------------------------------------------------------------------
 *
 * How a hospital gets its own data OUT: into a national exchange, a research extract, a successor
 * system, or a regulator's hands. Read only.
 */

test("the whole stay exports as a FHIR bundle, from the real record", async () => {
  seedHospital();
  const { reg, adm, ord, patient, scan } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "J18.9", codeSystem: "ICD-10", display: "Pneumonia", verificationStatus: "provisional" } });
  const step = (a, x) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: a, orderId: ord.orderId, dueAt: DUE, patient, ...(x || {}) });
  await step("verify"); await step("dispense"); await step("scan", { scan }); await step("administer");

  const b = await as(DOCTOR, `/ward/fhir?orgId=${ORG}&patient=${adm.patientId}`);
  assert.equal(b.__status, 200, JSON.stringify(b).slice(0, 300));
  assert.equal(b.resourceType, "Bundle");
  assert.equal(b.type, "searchset");
  const byType = {};
  for (const e of b.entry) (byType[e.resource.resourceType] ||= []).push(e.resource);

  assert.equal(byType.Patient[0].name[0].text, "Ward Testcase");
  assert.equal(byType.Patient[0].identifier[0].value, reg.mrn);
  assert.equal(byType.Encounter[0].class.code, "IMP", "an admission is an inpatient encounter");
  // The diagnosis keeps its ICD-10 coding AND its provisional status across the boundary.
  assert.deepEqual(byType.Condition[0].code.coding, [{ system: "http://hl7.org/fhir/sid/icd-10", code: "J18.9", display: "Pneumonia" }]);
  assert.equal(byType.Condition[0].verificationStatus.coding[0].code, "provisional");
  // The order is a MedicationRequest; the dose that was actually given is a completed
  // MedicationAdministration pointing back at it.
  assert.equal(byType.MedicationRequest[0].dosageInstruction[0].doseAndRate[0].doseQuantity.value, 500);
  assert.equal(byType.MedicationAdministration[0].status, "completed");
  // The order's canonical id is longer than R4 allows, so the reference carries its hashed FHIR id and the
  // MedicationRequest itself is exported under that same id with the canonical one as an identifier.
  assert.match(byType.MedicationAdministration[0].request.reference, /^MedicationRequest\/wsq-[0-9a-f]{48}$/);
  assert.equal(`MedicationRequest/${byType.MedicationRequest[0].id}`, byType.MedicationAdministration[0].request.reference);
  assert.ok(byType.MedicationRequest[0].identifier.some((i) => i.system === "urn:stewardmd:record-id" && i.value === ord.orderId));
  // The vitals are LOINC-coded observations, because those genuinely are LOINC.
  assert.ok(byType.Observation.some((o) => o.code.coding && o.code.coding[0].system === "http://loinc.org"));

  // One resource by id, and a type WardSynQ does not export is a 404 OperationOutcome rather than
  // something approximate.
  const one = await as(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}?orgId=${ORG}`);
  assert.equal(one.resourceType, "Encounter");
  const nope = await as(DOCTOR, `/ward/fhir/Practitioner/abc?orgId=${ORG}`);
  assert.equal(nope.__status, 404);
  assert.equal(nope.resourceType, "OperationOutcome", "a FHIR client parses OperationOutcome, not our error shape");
});

test("the FHIR door is not a way around the record's own access rules", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  // An export door easier to open than the chart would be the way around every other control.
  assert.equal((await as(PHARM, `/ward/fhir?orgId=${ORG}&patient=${adm.patientId}`)).__status, 403);
  const nurse = await as(NURSE, `/ward/fhir?orgId=${ORG}&patient=${adm.patientId}`);
  assert.equal(nurse.__status, 200, "a clinician exports what a clinician can already read");

  // The CapabilityStatement is public to any clinician and advertises read and search only.
  const cap = await as(NURSE, `/ward/fhir/metadata?orgId=${ORG}`);
  assert.equal(cap.resourceType, "CapabilityStatement");
  const codes = new Set(cap.rest[0].resource.flatMap((r) => r.interaction.map((i) => i.code)));
  // Widened 2026-09-08 when vread and history were implemented. Still nothing that writes.
  assert.deepEqual([...codes].sort(), ["history-instance", "read", "search-type", "vread"]);

  // And with inbound FHIR off (the default), a POST is a 404 OperationOutcome - the existence of a
  // write door is not leaked - and nothing is written.
  const write = await as(DOCTOR, "/ward/fhir", "POST", { orgId: ORG, resourceType: "Patient", id: "smuggled" });
  assert.equal(write.__status, 404);
  assert.equal(write.resourceType, "OperationOutcome");
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Patient", "smuggled"), null);
});

test("_type narrows the bundle without inventing anything", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const b = await as(DOCTOR, `/ward/fhir?orgId=${ORG}&patient=${adm.patientId}&_type=AllergyIntolerance,MedicationRequest`);
  assert.equal(b.__status, 200);
  const types = new Set(b.entry.map((e) => e.resource.resourceType));
  assert.ok(!types.has("Observation"), "the ward vitals are not in a bundle that did not ask for them");
  assert.ok(types.has("MedicationRequest"));
  // A patient with nothing of a requested type yields an empty bundle, not a fabricated resource.
  const empty = await as(DOCTOR, `/ward/fhir?orgId=${ORG}&patient=${adm.patientId}&_type=DiagnosticReport`);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.entry, []);
  // No patient at all is a 400 OperationOutcome, not an export of the whole hospital.
  const all = await as(DOCTOR, `/ward/fhir?orgId=${ORG}`);
  assert.equal(all.__status, 400);
  assert.equal(all.resourceType, "OperationOutcome");
});

/* ---- break-glass ---------------------------------------------------------------------------------
 *
 * An EMR that cannot be opened in an emergency gets worked around: a shared login, a borrowed badge,
 * a password on a whiteboard. Every one of those is worse than a front door with an alarm on it,
 * because none of them leave a name.
 */

test("BREAK-GLASS IS READ ONLY, one patient, and never implicit", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const other = await secondPatient("Medical A", "20");

  // A break-glass read is NEVER implicit: the emergency has to be declared first, by name.
  const cold = await as(NURSE, `/ward/emergency-chart?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(cold.__status, 403);
  assert.equal(cold.error, "no_active_grant");

  // And a reason is mandatory. It is the whole accountability of the mechanism.
  const noReason = await as(NURSE, "/ward/break-glass", "POST", { orgId: ORG, patientId: adm.patientId, reason: "urgent" });
  assert.equal(noReason.__status, 422);
  assert.equal(noReason.error, "reason_required");

  const g = await as(NURSE, "/ward/break-glass", "POST", {
    orgId: ORG, patientId: adm.patientId, reason: "Found unresponsive on the ward, treating team unreachable.",
  });
  assert.equal(g.__status, 200, JSON.stringify(g));
  assert.equal(g.active, true);
  assert.equal(g.reads, 0);
  assert.ok(g.expiresAt > g.grantedAt, "it is time-boxed");

  const chart = await as(NURSE, `/ward/emergency-chart?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(chart.__status, 200, JSON.stringify(chart));
  assert.equal(chart.readOnly, true);
  assert.ok(chart.chart.MedicationOrder.length >= 1, "the clinician can see what the patient is on");
  assert.ok(Array.isArray(chart.chart.AllergyIntolerance));
  // The reader is always told what they are holding and under what.
  assert.match(chart.underGrant.reason, /Found unresponsive/);
  assert.equal(chart.underGrant.grantId, g.grantId);

  // ONE PATIENT. The grant does not become a general widening.
  const spill = await as(NURSE, `/ward/emergency-chart?orgId=${ORG}&patientId=${other.patientId}`);
  assert.equal(spill.__status, 403);
  assert.equal(spill.error, "no_active_grant");

  // READ ONLY. Breaking glass grants no write of any kind - a nurse still cannot prescribe or
  // diagnose, and the emergency does not become an authority she did not have.
  assert.equal((await as(NURSE, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, display: "Sepsis" } })).__status, 403);
  assert.equal((await as(NURSE, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "X", dose: { value: 1, unit: "mg" } } })).__status, 403);
  assert.equal((await as(NURSE, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`)).__status, 200, "her ordinary access is unchanged either way");
});

test("THE ACCOUNTABILITY SURFACE: every declaration is on the record, with its reason and its use", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const g = await as(NURSE, "/ward/break-glass", "POST", {
    orgId: ORG, patientId: adm.patientId, reason: "Cardiac arrest call, need the allergy list now.",
  });
  await as(NURSE, `/ward/emergency-chart?orgId=${ORG}&patientId=${adm.patientId}`);
  await as(NURSE, `/ward/emergency-chart?orgId=${ORG}&patientId=${adm.patientId}`);

  // The list is the point of the mechanism, and the WARD can see it - not only an administrator.
  const log = await as(DOCTOR, `/ward/break-glass-log?orgId=${ORG}`);
  assert.equal(log.__status, 200, JSON.stringify(log));
  assert.equal(log.grants.length, 1);
  assert.equal(log.active, 1);
  assert.match(log.grants[0].reason, /Cardiac arrest call/);
  assert.ok(log.grants[0].actorId, "with a name on it");
  // "Declared and never used" and "declared and read twice" are visibly different afterwards.
  assert.equal(log.grants[0].reads, 2);

  // It is append-only: the whole life of the grant survives, so it cannot be tidied away later.
  const hist = await RECORD.history(TENANT_ROW.id, "BreakGlassGrant", g.grantId);
  assert.ok(hist.length >= 2);
  assert.equal(hist[0].reads, 0);
  assert.match(hist[0].reason, /Cardiac arrest call/);
});

test("ONLY A CLINICIAN, AND ONLY A HUMAN, may declare an emergency", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const reason = "Patient collapsed in the corridor, no identification.";
  // A pharmacist has clinical business with medicines, not with opening charts in an emergency.
  assert.equal((await as(PHARM, "/ward/break-glass", "POST", { orgId: ORG, patientId: adm.patientId, reason })).__status, 403);
  // Both clinical roles can. Break-glass widens what a clinician may SEE; it never makes one.
  assert.equal((await as(NURSE, "/ward/break-glass", "POST", { orgId: ORG, patientId: adm.patientId, reason })).__status, 200);
  assert.equal((await as(DOCTOR, "/ward/break-glass", "POST", { orgId: ORG, patientId: adm.patientId, reason })).__status, 200);

  // Each clinician's grant is their own: the doctor's declaration does not open the chart for anyone
  // else, which is what keeps the log a list of individuals rather than of doors left ajar.
  const log = await as(DOCTOR, `/ward/break-glass-log?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(log.grants.length, 2);
  assert.equal(new Set(log.grants.map((x) => x.actorId)).size, 2);
});

/* ---- pharmacy verification ----------------------------------------------------------------------
 *
 * The eMAR's `verify` step required MED_ADMINISTER - the NURSE's authority - because granting it to
 * pharmacy would have meant granting write on MedicationAdministration, and a role that can write
 * that could post a fabricated "administered" row without going near a bedside. This is the narrow
 * authority that note said the problem wanted.
 */

test("a pharmacist verifies the ORDER, and never touches the administration", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();

  const q = await as(PHARM, `/ward/verification-queue?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(q.__status, 200, JSON.stringify(q));
  assert.equal(q.orders.length, 1);
  assert.equal(q.orders[0].state, "unverified");
  assert.equal(q.unverified, 1);

  const v = await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: ord.orderId, outcome: "verified" });
  assert.equal(v.__status, 200, JSON.stringify(v));
  assert.equal(v.outcome, "verified");
  assert.ok(v.verifiedBy);
  assert.equal((await as(PHARM, `/ward/verification-queue?orgId=${ORG}&patientId=${adm.patientId}`)).orders[0].state, "verified");

  /* VERIFYING IS NOT GIVING. Nothing above wrote a MedicationAdministration, and the pharmacist
   * still cannot: that is the whole reason this is its own resource. */
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "MedicationAdministration", adm.patientId)).length, 0);
  const give = await as(PHARM, "/ward/mar", "POST", { orgId: ORG, action: "administer", orderId: ord.orderId, dueAt: DUE, patient: { id: adm.patientId } });
  assert.equal(give.__status, 403, "a pharmacist still cannot administer, or claim to have");

  // Re-recording the same conclusion on the same version of the order writes nothing.
  assert.equal((await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: ord.orderId, outcome: "verified" })).written, 0);
});

test("A VERIFICATION IS OF ONE VERSION: change the order and it is no longer verified", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();
  await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: ord.orderId, outcome: "verified" });
  assert.equal((await as(PHARM, `/ward/verification-queue?orgId=${ORG}&patientId=${adm.patientId}`)).orders[0].state, "verified");

  // The prescriber doubles the dose after the pharmacist checked it.
  const changed = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Paracetamol 500mg", dose: { value: 1000, unit: "mg" }, route: "oral", frequency: "TID" },
  });
  assert.equal(changed.__status, 200, JSON.stringify(changed));

  const q = await as(PHARM, `/ward/verification-queue?orgId=${ORG}&patientId=${adm.patientId}`);
  const row = q.orders.find((o) => o.orderId === ord.orderId);
  // Presenting this as "verified" would be a false reassurance about the exact thing verification
  // is for: the dose that was checked is not the dose the ward is about to give.
  assert.equal(row.state, "stale");
  assert.ok(row.currentVersion > row.verifiedVersion);
  assert.equal(q.unverified, 1);
});

test("A QUERY IS AS FIRST-CLASS AS AN APPROVAL, and must say what it is", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();
  // A system that can only record agreement quietly loses every disagreement.
  const noReason = await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: ord.orderId, outcome: "queried" });
  assert.equal(noReason.__status, 422);
  assert.equal(noReason.error, "reason_required");

  const q = await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: ord.orderId, outcome: "queried", reason: "Creatinine 3.2 - confirm the dose interval for renal impairment." });
  assert.equal(q.__status, 200, JSON.stringify(q));
  const queue = await as(PHARM, `/ward/verification-queue?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(queue.orders[0].state, "queried");
  assert.match(queue.orders[0].verification.reason, /renal impairment/);
  assert.equal((await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: ord.orderId, outcome: "guessed" })).__status, 400);

  /* IT NEVER BLOCKS THE BEDSIDE ON ITS OWN. Whether a queried order may still be given is hospital
   * policy, not this file's: silently refusing would strand every ward with no pharmacist at 3am. */
  const step = (a, x) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: a, orderId: ord.orderId, dueAt: DUE, patient: { id: adm.patientId, mrn: "x", wristbandBarcode: "x" }, ...(x || {}) });
  assert.equal((await step("verify")).__status, 200, "the ward's own eMAR verify is untouched");
});

test("THE NARROW GRANT: a pharmacist can see what a verification needs, and nothing else", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, display: "Chronic kidney disease" } });
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });

  // What they CAN see: the orders, and the allergies that travel with the queue. A pharmacist who
  // has to look allergies up separately is one who sometimes will not.
  const q = await as(PHARM, `/ward/verification-queue?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(q.__status, 200);
  assert.ok(Array.isArray(q.allergies));
  // And the critical results they are supposed to be checking against - the gap this closes.
  const reportId = await labReport(adm, [{ code: "2823-3", value: 7.4, unit: "mmol/L" }]);
  await as(DOCTOR, "/ward/flag-critical", "POST", { orgId: ORG, reportId });
  assert.equal((await as(PHARM, `/ward/criticals?orgId=${ORG}&patientId=${adm.patientId}`)).__status, 200,
    "a pharmacist can now see a critical potassium; before this they held no EMR capability at all");

  // What they still CANNOT see or do: the rest of the chart, and any clinical authorship.
  assert.equal((await as(PHARM, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`)).__status, 403, "not the discharge summary");
  assert.equal((await as(PHARM, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, display: "Sepsis" } })).__status, 403);
  assert.equal((await as(PHARM, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "X", dose: { value: 1, unit: "mg" } } })).__status, 403);
  assert.equal((await as(PHARM, "/ward/fluid", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, entries: [] })).__status, 403);
  // And a nurse does not become a pharmacist by holding the bedside authority.
  assert.equal((await as(NURSE, "/ward/verify-order", "POST", { orgId: ORG, orderId: "x", outcome: "verified" })).__status, 403);
});

/* ---- shift handover -----------------------------------------------------------------------------
 *
 * Handover failure is one of the best-documented causes of harm in hospitals: the information
 * existed, somebody knew it, and it did not survive the change of shift.
 */

test("A HANDOVER IS ONLY COMPLETE WHEN SOMEBODY ELSE HAS TAKEN IT", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  const given = await as(NURSE, "/ward/handover", "POST", {
    orgId: ORG, encounterId: adm.encounterId, givenAt: "2026-09-07T20:00:00.000Z",
    sbar: {
      situation: "Day 2 of community-acquired pneumonia, on IV amoxicillin.",
      background: "Admitted with fever and cough. Type 2 diabetic.",
      assessment: "Afebrile since 14:00, saturations 96% on air.",
      recommendation: "Repeat CRP in the morning. Chase the blood culture.",
    },
  });
  assert.equal(given.__status, 200, JSON.stringify(given));
  assert.equal(given.state, "waiting", "given is not the same as taken");
  assert.ok(given.givenBy);
  assert.equal(given.receivedBy, null);
  assert.match(given.sections.recommendation, /Chase the blood culture/);

  // It sits on the incoming shift's list until somebody takes it. Nothing expires it.
  const waiting = await as(DOCTOR, `/ward/handovers?orgId=${ORG}`);
  assert.equal(waiting.waiting, 1);
  assert.equal(waiting.handovers[0].handoverId, given.handoverId);

  /* THE RECEIVER CANNOT BE THE AUTHOR. Letting the outgoing nurse close her own loop would close it
   * at exactly the moment the information is lost. */
  const self = await as(NURSE, "/ward/receive-handover", "POST", { orgId: ORG, handoverId: given.handoverId });
  assert.equal(self.__status, 409);
  assert.equal(self.error, "same_clinician");

  const taken = await as(DOCTOR, "/ward/receive-handover", "POST", { orgId: ORG, handoverId: given.handoverId, note: "Taken. Will chase the culture at 08:00." });
  assert.equal(taken.__status, 200, JSON.stringify(taken));
  assert.equal(taken.state, "received");
  assert.ok(taken.receivedBy && taken.receivedBy !== taken.givenBy, "two different clinicians, permanently on the record");
  assert.match(taken.readBack, /chase the culture/i);

  // Both names survive as versions: who wrote it and who took it.
  const hist = await RECORD.history(TENANT_ROW.id, "ShiftHandover", given.handoverId);
  assert.deepEqual(hist.map((h) => !!h.receivedBy), [false, true]);
  assert.equal(hist[1].givenBy, given.givenBy, "and it still names the clinician who gave it");

  // Taken handovers leave the waiting list rather than burying the ones that still need somebody.
  assert.equal((await as(DOCTOR, `/ward/handovers?orgId=${ORG}`)).waiting, 0);
  assert.equal((await as(DOCTOR, `/ward/handovers?orgId=${ORG}&state=received`)).handovers.length, 1);
});

test("an empty handover is not a handover, and a taken one is not rewritten", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  // An empty record where the incoming shift expects an account reads as "nothing to say" rather
  // than "nobody wrote it", which is the more dangerous of the two.
  const empty = await as(NURSE, "/ward/handover", "POST", { orgId: ORG, encounterId: adm.encounterId, sbar: { situation: "  " } });
  assert.equal(empty.__status, 422);
  assert.equal(empty.error, "nothing_handed_over");

  const given = await as(NURSE, "/ward/handover", "POST", { orgId: ORG, encounterId: adm.encounterId, givenAt: "2026-09-07T20:00:00.000Z", sbar: { situation: "Stable overnight." } });
  // A section nobody filled in says so, rather than being assembled from the chart: a handover that
  // writes its own background is one nobody actually gave.
  assert.equal(given.sections.background, "Not stated.");
  assert.equal(given.sbarStated, 1);

  // Re-submitting the same shift's handover before it is taken is a correction, not a duplicate.
  const fixed = await as(NURSE, "/ward/handover", "POST", { orgId: ORG, encounterId: adm.encounterId, givenAt: "2026-09-07T20:00:00.000Z", sbar: { situation: "Stable overnight.", recommendation: "Chase potassium." } });
  assert.equal(fixed.handoverId, given.handoverId);
  assert.equal(fixed.sections.recommendation, "Chase potassium.");

  await as(DOCTOR, "/ward/receive-handover", "POST", { orgId: ORG, handoverId: given.handoverId });
  // Once taken it is not rewritten: the receiving clinician acted on what it said.
  const late = await as(NURSE, "/ward/handover", "POST", { orgId: ORG, encounterId: adm.encounterId, givenAt: "2026-09-07T20:00:00.000Z", sbar: { situation: "Actually deteriorating." } });
  assert.equal(late.__status, 409);
  assert.equal(late.error, "already_received");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "ShiftHandover", given.handoverId)).sections.situation, "Stable overnight.");

  // Taking it twice is not an error, and does not change who took it first.
  const twice = await as(DOCTOR, "/ward/receive-handover", "POST", { orgId: ORG, handoverId: given.handoverId });
  assert.equal(twice.written, 0);
  assert.equal(twice.skipped, "already_received");
});

test("a handover never pollutes the discharge summary's clinical notes", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(NURSE, "/ward/handover", "POST", { orgId: ORG, encounterId: adm.encounterId, sbar: { assessment: "Nursing handover assessment, not a medical one." } });
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId });
  const draft = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  /* The summary copies a CLINICIAN'S assessment note. A shift handover is a different document and
   * must not be mistaken for the medical assessment of the admission. It is a separate resource
   * type, which is why this holds structurally rather than by a filter somebody has to remember. */
  assert.equal(draft.sections.assessment, "Not recorded.");
  assert.ok(!/Nursing handover/.test(JSON.stringify(draft.sections)));
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "ClinicalNote", adm.patientId)).filter((n) => n.noteType === "handover").length, 0,
    "a handover is not a ClinicalNote at all");
});

test("a nurse may hand over but still may not author a clinical document", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  // EMR_VITALS was widened to cover ShiftHandover, and that widening must be NARROW: it must not
  // have handed a nurse the ability to write discharge summaries or assessments along with it.
  assert.equal((await as(NURSE, "/ward/handover", "POST", { orgId: ORG, encounterId: adm.encounterId, sbar: { situation: "Stable." } })).__status, 200);
  assert.equal((await as(NURSE, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId })).__status, 403);
  assert.equal((await as(NURSE, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, display: "Sepsis" } })).__status, 403);
  assert.equal((await as(PHARM, "/ward/handover", "POST", { orgId: ORG, encounterId: adm.encounterId, sbar: { situation: "x" } })).__status, 403);
});

/* ---- fluid balance ------------------------------------------------------------------------------
 *
 * The oldest nursing chart there is, and WardSynQ recorded vitals and nothing else a nurse writes.
 */

test("a nurse charts fluid, and the balance shows intake and output rather than a bare net", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const put = (entries) => as(NURSE, "/ward/fluid", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, entries });

  const r = await put([
    { direction: "intake", kind: "oral", value: 200, at: "2026-09-07T09:10:00.000Z" },
    { direction: "intake", kind: "iv", value: 1000, unit: "ml", at: "2026-09-07T09:20:00.000Z" },
    { direction: "output", kind: "urine", value: 450, at: "2026-09-07T09:40:00.000Z" },
  ]);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.written, 3);
  assert.ok(!r.rejected, "nothing was rejected");

  const bal = await as(NURSE, `/ward/balance?orgId=${ORG}&patientId=${adm.patientId}&from=2026-09-07T09:00:00.000Z&to=2026-09-07T10:00:00.000Z`);
  assert.equal(bal.__status, 200, JSON.stringify(bal));
  assert.deepEqual([bal.balance.intake, bal.balance.output, bal.balance.balance], [1200, 450, 750]);
  assert.equal(bal.balance.unit, "mL");
  assert.equal(bal.balance.complete, true, "the whole one-hour window has entries");
  assert.deepEqual(bal.balance.byKind, { "intake.oral": 200, "intake.iv": 1000, "output.urine": 450 });

  // Re-sending the same entries is one entry per kind per minute, not a doubled balance.
  await put([{ direction: "intake", kind: "oral", value: 200, at: "2026-09-07T09:10:00.000Z" }]);
  const again = await as(NURSE, `/ward/balance?orgId=${ORG}&patientId=${adm.patientId}&from=2026-09-07T09:00:00.000Z&to=2026-09-07T10:00:00.000Z`);
  assert.equal(again.balance.intake, 1200, "a retried request does not become a second cup of tea");
});

test("the balance NAMES THE HOURS NOBODY CHARTED rather than handing over a tidy total", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(NURSE, "/ward/fluid", "POST", {
    orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId,
    entries: [{ direction: "output", kind: "urine", value: 100, at: "2026-09-07T08:30:00.000Z" }],
  });
  const bal = await as(NURSE, `/ward/balance?orgId=${ORG}&patientId=${adm.patientId}&from=2026-09-07T08:00:00.000Z&to=2026-09-07T20:00:00.000Z`);
  assert.equal(bal.balance.entries, 1);
  assert.equal(bal.balance.complete, false, "a twelve-hour balance from one entry is not a twelve-hour balance");
  assert.equal(bal.balance.gaps.length, 11);

  // A balance needs a stated period, and is not charted over weeks.
  assert.equal((await as(NURSE, `/ward/balance?orgId=${ORG}&patientId=${adm.patientId}`)).error, "from_required");
  assert.equal((await as(NURSE, `/ward/balance?orgId=${ORG}&patientId=${adm.patientId}&from=2026-01-01T00:00:00.000Z&to=2026-06-01T00:00:00.000Z`)).error, "window_too_wide");
});

test("an unusable entry is reported, never silently dropped and never converted", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const r = await as(NURSE, "/ward/fluid", "POST", {
    orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId,
    entries: [
      { direction: "intake", kind: "iv", value: 1, unit: "L", at: "2026-09-07T09:00:00.000Z" },     // a silent x1000
      { direction: "intake", kind: "oral", value: "a cup", at: "2026-09-07T09:05:00.000Z" },
      { direction: "output", kind: "urine", value: 200, at: "2026-09-07T09:10:00.000Z" },
    ],
  });
  assert.equal(r.written, 1);
  assert.deepEqual(r.rejected.map((x) => x.reason), ["unusable_unit", "not_a_number"]);
  // Nothing was converted: the litre did not become 1000 mL behind the nurse's back.
  const bal = await as(NURSE, `/ward/balance?orgId=${ORG}&patientId=${adm.patientId}&from=2026-09-07T09:00:00.000Z&to=2026-09-07T10:00:00.000Z`);
  assert.equal(bal.balance.intake, 0);
  assert.equal(bal.balance.output, 200);

  // A request where NOTHING is usable is a 422, not a cheerful "wrote 0".
  const none = await as(NURSE, "/ward/fluid", "POST", {
    orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId,
    entries: [{ direction: "intake", kind: "telepathy", value: 100, at: "2026-09-07T09:00:00.000Z" }],
  });
  assert.equal(none.__status, 422);
  assert.equal(none.error, "nothing_recordable");
});

test("charting fluid is the nurse's own record; a pharmacist has no business in it", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const entries = [{ direction: "output", kind: "urine", value: 100, at: "2026-09-07T09:00:00.000Z" }];
  assert.equal((await as(NURSE, "/ward/fluid", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, entries })).__status, 200);
  assert.equal((await as(DOCTOR, "/ward/fluid", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, entries })).__status, 200);
  assert.equal((await as(PHARM, "/ward/fluid", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, entries })).__status, 403);
  assert.equal((await as(PHARM, `/ward/balance?orgId=${ORG}&patientId=${adm.patientId}&from=2026-09-07T09:00:00.000Z`)).__status, 403);
});

test("fluid entries never pollute the vitals the eMAR reads", async () => {
  seedHospital();
  const { adm, ord, patient, scan } = await admittedPatientOnDrug();
  await as(NURSE, "/ward/fluid", "POST", {
    orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId,
    entries: [{ direction: "intake", kind: "oral", value: 68, at: "2026-09-07T09:00:00.000Z" }],
  });
  // A fluid volume of 68 mL must never be mistaken for a body weight of 68 kg by the dose check.
  const step = (a, x) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: a, orderId: ord.orderId, dueAt: DUE, patient, ...(x || {}) });
  await step("verify"); await step("dispense"); await step("scan", { scan });
  assert.equal((await step("administer")).__status, 200, "the weight-based check still uses the recorded weight");
});

/* ---- sending the prescription, and knowing it arrived ------------------------------------------ */

const outbox = (email, q) => as(email, `/ward/outbox?orgId=${ORG}${q || ""}`);

test("QUEUED IS NOT SENT: a prescription is outstanding until the far end says it has it", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();

  const q = await as(DOCTOR, "/ward/transmit", "POST", { orgId: ORG, orderId: ord.orderId, channel: "pharmacy", destination: "City Pharmacy" });
  assert.equal(q.__status, 200, JSON.stringify(q));
  assert.equal(q.state, "queued");
  assert.equal(q.outstanding, true);
  assert.match(q.note, /Nothing has been transmitted yet/);

  /* THE ORDER IS UNTOUCHED. "We sent this" is a statement about a message, not about the treatment;
   * an order quietly moved to completed on transmission would say the patient had their medicine. */
  const order = await RECORD.latest(TENANT_ROW.id, "MedicationOrder", ord.orderId);
  assert.equal(order.status, "active");
  assert.equal(order.version, 1, "and no version was burned on it either");

  // The outbox shows it, and counts it as still needing somebody.
  const box = await outbox(NURSE, `&patientId=${adm.patientId}`);
  assert.equal(box.__status, 200, JSON.stringify(box));
  assert.equal(box.transmissions.length, 1);
  assert.equal(box.outstanding, 1);
  assert.equal(box.transmissions[0].orderVersion, 1, "and it names WHICH version was queued");

  // `sent` is the transport reporting it left. It is still outstanding.
  const sent = await as(NURSE, "/ward/transmit-outcome", "POST", { orgId: ORG, transmissionId: q.transmissionId, state: "sent" });
  assert.equal(sent.__status, 200, JSON.stringify(sent));
  assert.equal(sent.outstanding, true, "left the building is not arrived");
  assert.equal((await outbox(NURSE, "&outstanding=1")).outstanding, 1);

  // `acknowledged` is the far end saying it has it. Only now does it leave the list.
  const ack = await as(NURSE, "/ward/transmit-outcome", "POST", { orgId: ORG, transmissionId: q.transmissionId, state: "acknowledged", reference: "RX-88213" });
  assert.equal(ack.state, "acknowledged");
  assert.equal(ack.reference, "RX-88213", "the far end's own id for it is kept");
  assert.ok(ack.acknowledgedAt && ack.sentAt);
  assert.equal((await outbox(NURSE, "&outstanding=1")).transmissions.length, 0);

  /* ACKNOWLEDGED IS TERMINAL: nothing can un-say that the pharmacy has the prescription. */
  const late = await as(NURSE, "/ward/transmit-outcome", "POST", { orgId: ORG, transmissionId: q.transmissionId, state: "failed", failureReason: "timeout" });
  assert.equal(late.skipped, "already_acknowledged");
  assert.equal(late.state, "acknowledged");
  assert.equal(late.written, 0);
});

test("A FAILURE STAYS LOUD, and resolving it never claims a delivery that did not happen", async () => {
  seedHospital();
  const { ord } = await admittedPatientOnDrug();
  const q = await as(DOCTOR, "/ward/transmit", "POST", { orgId: ORG, orderId: ord.orderId, channel: "pharmacy" });

  // A failure with no reason cannot be acted on, and acting on it is the entire point.
  const mute = await as(NURSE, "/ward/transmit-outcome", "POST", { orgId: ORG, transmissionId: q.transmissionId, state: "failed" });
  assert.equal(mute.__status, 422);
  assert.equal(mute.error, "reason_required");

  const failed = await as(NURSE, "/ward/transmit-outcome", "POST", { orgId: ORG, transmissionId: q.transmissionId, state: "failed", failureReason: "Pharmacy endpoint refused the message." });
  assert.equal(failed.state, "failed");
  const box = await outbox(NURSE);
  assert.equal(box.failed, 1, "an undelivered prescription is a patient told there is nothing for them");
  assert.equal(box.transmissions[0].failureReason, "Pharmacy endpoint refused the message.");

  // It cannot be cleared off the list silently: say what was done instead.
  const silent = await as(NURSE, "/ward/transmit-resolve", "POST", { orgId: ORG, transmissionId: q.transmissionId });
  assert.equal(silent.__status, 422);
  assert.equal(silent.error, "resolution_required");

  const done = await as(NURSE, "/ward/transmit-resolve", "POST", { orgId: ORG, transmissionId: q.transmissionId, resolution: "Printed and handed to the patient." });
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.equal(done.outstanding, false);
  assert.equal(done.state, "failed", "it was never acknowledged, and the record does not say it was");
  assert.equal(done.resolvedBy, idFor(NURSE));
  assert.equal((await outbox(NURSE)).outstanding, 0);
});

test("a CHANGED prescription is a new transmission, and the old one still says what was sent", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();
  const first = await as(DOCTOR, "/ward/transmit", "POST", { orgId: ORG, orderId: ord.orderId, channel: "pharmacy" });
  await as(NURSE, "/ward/transmit-outcome", "POST", { orgId: ORG, transmissionId: first.transmissionId, state: "acknowledged" });

  // The prescriber doubles the dose. The order moves to version 2.
  const amended = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG,
    order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Paracetamol 500mg", dose: { value: 1000, unit: "mg" }, route: "oral", frequency: "TID" },
  });
  assert.equal(amended.orderId, ord.orderId, "the same order, amended");

  const second = await as(DOCTOR, "/ward/transmit", "POST", { orgId: ORG, orderId: ord.orderId, channel: "pharmacy" });
  assert.notEqual(second.transmissionId, first.transmissionId, "a different dose is a different message entirely");
  assert.equal(second.state, "queued");

  /* WHAT WAS SENT IS STILL WHAT WAS SENT. The first transmission's payload is kept verbatim, so the
   * record can answer "what did they get", not "what does the order say now". */
  const old = await RECORD.latest(TENANT_ROW.id, "PrescriptionTransmission", first.transmissionId);
  assert.equal(old.payload.prescription.dose.value, 500);
  assert.equal(old.state, "acknowledged");
  const fresh = await RECORD.latest(TENANT_ROW.id, "PrescriptionTransmission", second.transmissionId);
  assert.equal(fresh.payload.prescription.dose.value, 1000);

  // And the payload carries no clinical history: a dispenser needs to identify a person, not read a chart.
  assert.deepEqual(Object.keys(fresh.payload).sort(), ["patient", "prescription"]);
  assert.deepEqual(Object.keys(fresh.payload.patient).sort(), ["dob", "mrn", "name", "sex"]);

  // Both are on the record, and the outbox counts only the one still needing somebody.
  const box = await outbox(NURSE);
  assert.equal(box.transmissions.length, 2);
  assert.equal(box.outstanding, 1);
});

test("sending is prescribing's business, and nothing unsendable is sent", async () => {
  seedHospital();
  const { ord } = await admittedPatientOnDrug();

  // A nurse may record what the transport reported; a nurse may not decide a prescription goes out.
  const nurseSend = await as(NURSE, "/ward/transmit", "POST", { orgId: ORG, orderId: ord.orderId, channel: "pharmacy" });
  assert.equal(nurseSend.__status, 403, "transmitting needs emr.treat, which a nurse does not hold");

  // An order that does not exist is not quietly queued against a made-up id.
  const ghost = await as(DOCTOR, "/ward/transmit", "POST", { orgId: ORG, orderId: "wsq-rx-nope", channel: "pharmacy" });
  assert.equal(ghost.__status, 404);
  assert.equal(ghost.error, "order_not_found");

  // A channel WardSynQ has no meaning for is refused rather than defaulted into something plausible.
  const bogus = await as(DOCTOR, "/ward/transmit", "POST", { orgId: ORG, orderId: ord.orderId, channel: "carrier-pigeon" });
  assert.equal(bogus.__status, 400);
  assert.equal(bogus.error, "unknown_channel");
});

/* ---- who acted on the number before it was corrected ---------------------------------------------- */

test("A CORRECTION PRODUCES A LIST OF PEOPLE, and a read of the right figure is not on it", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const read = (body) => as(NURSE, "/ward/read", "POST", { orgId: ORG, patientId: adm.patientId, valueId: "fluid-balance-0600", ...body });

  /* A VALUE MERELY RENDERED IS NOT A READ. A page showing a hundred numbers has not shown a clinician
   * a hundred numbers, and logging everything buries the three reads that mattered. */
  const noKind = await read({ version: 1, kind: "rendered" });
  assert.equal(noKind.__status, 400);
  assert.equal(noKind.error, "unknown_kind");
  assert.match(noKind.detail, /merely rendered on a page is not a read/);

  // And a read without a version cannot tell a read of the wrong figure from a read of the right one.
  assert.equal((await read({ kind: "acted-on" })).error, "version_required");

  const acted = await read({ version: 1, value: 400, kind: "acted-on", context: "Prescribed diuresis", at: "2026-09-07T06:12:00.000Z" });
  assert.equal(acted.__status, 200, JSON.stringify(acted));
  // The purpose is stamped on the ROW, so it travels with the data rather than living in a policy
  // document nobody reads before running a query.
  assert.match(acted.purpose, /Not for performance management/);
  const stored = await RECORD.latest(TENANT_ROW.id, "ClinicalRead", acted.readId);
  assert.match(stored.purpose, /told if the value is later found to be wrong/);

  // A second person reads the same wrong figure, and somebody else reads it AFTER the correction.
  await as(DOCTOR, "/ward/read", "POST", { orgId: ORG, patientId: adm.patientId, valueId: "fluid-balance-0600", version: 1, value: 400, kind: "opened", at: "2026-09-07T06:30:00.000Z" });
  await as(DOCTOR, "/ward/read", "POST", { orgId: ORG, patientId: adm.patientId, valueId: "fluid-balance-0600", version: 2, value: 40, kind: "opened", at: "2026-09-07T09:00:00.000Z" });

  const who = await as(NURSE, `/ward/readers?orgId=${ORG}&patientId=${adm.patientId}&valueId=fluid-balance-0600&supersededVersion=1&correctedAt=${encodeURIComponent("2026-09-07T08:00:00.000Z")}&label=${encodeURIComponent("06:00 fluid balance")}&unit=mL`);
  assert.equal(who.__status, 200, JSON.stringify(who));
  /* "Three totals changed" is not actionable. "Dr Shah read the 06:00 balance and it was wrong" is,
   * and the difference is whether anybody does anything. */
  assert.equal(who.people.length, 2);
  const names = who.people.map((p) => p.person).sort();
  assert.deepEqual(names, [idFor(DOCTOR), idFor(NURSE)].sort());
  assert.match(who.note, /Telling them is a human act; nothing here has sent anything/);

  /* READING A VALUE THAT WAS ALREADY CORRECT IS NOT AN INCIDENT. The 09:00 read was of version 2,
   * after the correction, and notifying it would flood the list and teach people this is noise. */
  const v2 = await as(NURSE, `/ward/readers?orgId=${ORG}&patientId=${adm.patientId}&valueId=fluid-balance-0600&supersededVersion=2&correctedAt=${encodeURIComponent("2026-09-07T12:00:00.000Z")}`);
  assert.equal(v2.people.length, 1, "only the version-2 read");

  // An empty list is not "nobody was affected", and it says so.
  const none = await as(NURSE, `/ward/readers?orgId=${ORG}&patientId=${adm.patientId}&valueId=some-other-value&supersededVersion=1&correctedAt=${encodeURIComponent("2026-09-07T08:00:00.000Z")}`);
  assert.deepEqual(none.people, []);
  assert.match(none.note, /not the same as nobody having seen it/);
});

test("THERE IS NO 'WHAT DID THIS PERSON READ' QUERY, and retention is enforced on the answer", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  /* A log of which clinician looked at what is also a management tool for something other than
   * safety, and if it is used that way people stop opening things - which makes the record less safe.
   * The only question the routes answer is "who has to be told about THIS correction". */
  const routes = await Promise.all([
    as(DOCTOR, `/ward/reads?orgId=${ORG}&by=${idFor(NURSE)}`),
    as(DOCTOR, `/ward/read-log?orgId=${ORG}&patientId=${adm.patientId}`),
  ]);
  assert.ok(routes.every((r) => r.__status === 404), "no route lists what a person has read");

  // A read older than the retention window is not returned, even though its row is still there.
  await as(NURSE, "/ward/read", "POST", { orgId: ORG, patientId: adm.patientId, valueId: "old-value", version: 1, kind: "opened", at: "2026-01-01T09:00:00.000Z" });
  const stale = await as(NURSE, `/ward/readers?orgId=${ORG}&patientId=${adm.patientId}&valueId=old-value&supersededVersion=1&correctedAt=${encodeURIComponent("2026-09-07T08:00:00.000Z")}`);
  assert.deepEqual(stale.people, [], "a read log that grows forever becomes a dossier");
  assert.equal(stale.outsideRetention, 1, "and it says how many it would not answer with");
  assert.ok(await RECORD.byPatient(TENANT_ROW.id, "ClinicalRead", adm.patientId), "the row itself is untouched");
});

/* ---- the early warning score ---------------------------------------------------------------------- */

test("AN INCOMPLETE NEWS2 IS NEVER REASSURING, however low the partial total", async () => {
  seedHospital();
  const { reg, adm } = await admittedPatientOnDrug();
  assert.ok(reg.mrn);

  /* admittedPatientOnDrug charts only a weight, so nearly every parameter is missing. A system that
   * scored an absent respiratory rate as zero would produce a reassuring total about a patient
   * nobody has looked at - the single most dangerous way to implement NEWS2. */
  const thin = await as(NURSE, `/ward/news2?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(thin.__status, 200, JSON.stringify(thin));
  assert.equal(thin.score.scorable, false);
  /* The partial total IS returned - hiding it would be its own kind of dishonesty - but there is NO
   * RISK, and the reason says in words that the total must not be read as one. A consumer that read
   * `total` without `scorable` would see a reassuring 0 about a patient nobody has examined. */
  assert.equal(thin.score.risk, null, "a partial total is not a risk assessment");
  assert.ok(thin.score.missing.length > 0);
  assert.match(thin.score.reason, /must not be read as one/);
  assert.ok(thin.note, "and the response repeats it");

  // A full set of observations scores.
  await as(NURSE, "/ward/vitals", "POST", {
    orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId,
    // All six numeric parameters PLUS the two NEWS2 could never record before: supplemental oxygen
    // and level of consciousness. Without them no early warning score can ever complete.
    vitals: { rr: "18", spo2: "97", sbp: "126", pulse: "78", temp: "98.6", tempUnit: "F", o2: false, acvpu: "A" },
  });
  const scored = await as(NURSE, `/ward/news2?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(scored.score.scorable, true, JSON.stringify(scored.score));
  assert.equal(typeof scored.score.total, "number");
  assert.ok(scored.score.risk);

  /* SCALE 2 IS A PRESCRIPTION AND IS NEVER INFERRED. Using Scale 1 on a patient targeted at 88-92%
   * escalates somebody who is at their target; using Scale 2 on anyone else hides real hypoxia. */
  assert.equal(scored.scale, 1);
  assert.match(scored.scaleNote, /never inferred/);
  const two = await as(NURSE, `/ward/news2?orgId=${ORG}&patientId=${adm.patientId}&scale=2`);
  assert.equal(two.scale, 2);
  assert.match(two.scaleNote, /documented target of 88-92%/);

  /* THE ESCALATION POLICY IS UNAPPROVED AND SAYS SO. A response time nobody signed off, presented as
   * fact, is how a system gets trusted for something it has no authority to say. */
  assert.equal(scored.escalationApproved, false);
  assert.match(scored.escalationWarning, /UNAPPROVED seed content/);
  assert.match(scored.monitoring, /Nothing has been paged/);

  // With the hospital's own policy configured, it is theirs and the warning goes.
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...org.fields.wardsynq, criticalEscalation: { high: { responder: "ICU outreach", respondWithinMinutes: 10 }, medium: {}, low: {}, "low-medium": {} } };
  const owned = await as(NURSE, `/ward/news2?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(owned.escalationApproved, true);
  assert.equal(owned.escalationWarning, undefined);

  // A laboratory result is not a NEWS2 parameter and must not reach the scorer.
  const sr = await orderTest(adm, "Potassium", "wsq-sr-news");
  await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr, tests: [{ test: "Potassium", value: 7.4, unit: "mmol/L" }] });
  const after = await as(NURSE, `/ward/news2?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(after.score.total, scored.score.total, "the potassium changed nothing");
  assert.equal(after.tool, "NEWS2", "and the tool is always named");
});

test("A CHILD GETS PEWS, because a refusal with nothing behind it protects them less", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Child Testcase", mobile: "9876500055", gender: "male", ageYears: 4 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Paediatrics", bed: "3", admittedAt: "2026-09-07T08:00:00.000Z" });
  await as(NURSE, "/ward/vitals", "POST", {
    orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId,
    vitals: { rr: "24", spo2: "98", pulse: "110", temp: "98.6", tempUnit: "F", sbp: "95", o2: false, acvpu: "A" },
  });

  const ews = await as(NURSE, `/ward/news2?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(ews.__status, 200, JSON.stringify(ews));
  /* NEWS2 is not validated below 16 and refuses. Leaving it there would remove even the crude signal
   * a child was getting - so PEWS answers instead, and the response NAMES which tool scored it: a
   * PEWS total and a NEWS2 total are different numbers on different scales. */
  assert.equal(ews.tool, "PEWS");
  assert.match(ews.toolNote, /not validated below 16 years/);
  assert.match(ews.toolNote, /UNAPPROVED/, "and its bands are nobody's approved content yet");
});

/* ---- the summary as a document ------------------------------------------------------------------- */

test("A DRAFT SUMMARY IS NOT A DOCUMENT, and a signed one is CDA level 1", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, display: "Community-acquired pneumonia" } });

  // Nothing drafted yet.
  const none = await as(DOCTOR, `/ward/cda?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(none.__status, 404);
  assert.equal(none.error, "summary_not_found");

  // Drafting WRITES, so it is the POST. The GET only reads what is already there.
  const drafted = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId });
  assert.equal(drafted.__status, 200, JSON.stringify(drafted));

  /* THE REFUSAL THAT MATTERS. A receiving hospital reading a draft would be reading something nobody
   * here has agreed to. */
  const draft = await as(DOCTOR, `/ward/cda?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(draft.__status, 409);
  assert.equal(draft.error, "summary_not_signed");
  assert.match(draft.detail, /once a clinician has signed it/);

  await as(DOCTOR, "/ward/sign-discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });

  const cda = await as(DOCTOR, `/ward/cda?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(cda.__status, 200, JSON.stringify(cda));
  assert.ok(cda.document.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(cda.document, /<ClinicalDocument xmlns="urn:hl7-org:v3">/);
  assert.match(cda.document, /code="18842-5"/, "it says it is a discharge summary");
  assert.match(cda.document, /WSQ Ward Hospital/, "and names the custodian");
  // The author is who SIGNED it, not who exported it.
  assert.match(cda.document, new RegExp('<id extension="' + idFor(DOCTOR) + '"/>'));
  assert.match(cda.document, /Community-acquired pneumonia/, "the summary's own words travel");

  /* IT CLAIMS LEVEL 1 AND NO MORE. A templateId would assert conformance to a profile this has never
   * been validated against, and a receiver cannot tell a real claim from an invented one. */
  assert.ok(!cda.document.includes("templateId"));
  assert.ok(!cda.document.includes("<entry>"));
  assert.match(cda.note, /LEVEL 1/);
  assert.match(cda.note, /has not been validated against/);

  // Reading a chart as a document still needs the authority to read a chart.
  assert.equal((await as(PHARM, `/ward/cda?orgId=${ORG}&encounterId=${adm.encounterId}`)).__status, 403);
});

/* ---- the imaging report --------------------------------------------------------------------------- */

test("A FINAL IMPRESSION THAT CHANGED IS FLAGGED, and the preliminary one survives", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const sr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "CT head", category: "imaging", priority: "stat" });
  assert.equal(sr.__status, 200, JSON.stringify(sr));
  const report = (body) => as(LABTECH, "/ward/report-imaging", "POST", { orgId: ORG, serviceRequestId: sr.orderId, ...body });

  /* A REPORT WITH NOTHING SEEN IS NOT A REPORT, and a FINAL one needs the sentence a clinician will
   * act on - releasing it without would leave a ward drawing its own radiological conclusion. */
  assert.equal((await report({ impression: "Normal" })).error, "findings_required");
  const noImpression = await report({ findings: "No acute intracranial abnormality.", status: "final" });
  assert.equal(noImpression.__status, 422);
  assert.equal(noImpression.error, "impression_required");
  assert.match(noImpression.detail, /release it as preliminary/);

  // The registrar at 02:00.
  const prelim = await report({ findings: "Study degraded by motion.", impression: "No intracranial haemorrhage.", status: "preliminary", modality: "CT" });
  assert.equal(prelim.__status, 200, JSON.stringify(prelim));
  assert.equal(prelim.status, "preliminary");
  assert.match(prelim.note, /stays on the record/);

  /* The consultant at 09:00, and the impression has changed. This is the commonest serious event in
   * radiology and it is flagged rather than quietly overwritten. */
  const final = await report({ findings: "Small left frontal contusion.", impression: "Small left frontal contusion. No mass effect.", status: "final" });
  assert.equal(final.__status, 200, JSON.stringify(final));
  assert.equal(final.discrepancy, true);
  assert.equal(final.previousImpression, "No intracranial haemorrhage.");
  // Nothing here decides whether the change matters clinically - it says who to ask.
  assert.match(final.detail, /not this system's call/);
  assert.match(final.detail, /tell the team looking after this patient/);

  /* THE PRELIMINARY READING SURVIVES. A system that kept only the final one would erase what the
   * night team actually saw and decided from. */
  const history = await RECORD.history(TENANT_ROW.id, "DiagnosticReport", final.reportId);
  assert.deepEqual(history.map((h) => h.status), ["preliminary", "final"]);
  assert.equal(history[0].impression, "No intracranial haemorrhage.");
  assert.equal(history[1].discrepancy, true);

  // A final report is CORRECTED, never re-finalised silently.
  const again = await report({ findings: "x", impression: "y", status: "final" });
  assert.equal(again.__status, 409);
  assert.equal(again.error, "already_final");
  assert.equal((await report({ findings: "x", impression: "y", status: "corrected" })).__status, 200);
});

test("reporting a study is the reporter's authority, and it answers a request that exists", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const sr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Chest X-ray", category: "imaging" });

  const ghost = await as(LABTECH, "/ward/report-imaging", "POST", { orgId: ORG, serviceRequestId: "wsq-sr-nope", findings: "x" });
  assert.equal(ghost.__status, 404);
  assert.equal(ghost.error, "request_not_found");

  // A nurse charts, a doctor orders; neither reports the film.
  assert.equal((await as(NURSE, "/ward/report-imaging", "POST", { orgId: ORG, serviceRequestId: sr.orderId, findings: "x" })).__status, 403);
  // The report holds no pixels: DICOM/PACS is out of scope and a study half-living here is worse
  // than one that does not.
  const done = await as(LABTECH, "/ward/report-imaging", "POST", { orgId: ORG, serviceRequestId: sr.orderId, findings: "Clear lung fields.", impression: "Normal chest radiograph.", status: "final" });
  const stored = await RECORD.latest(TENANT_ROW.id, "DiagnosticReport", done.reportId);
  assert.equal(stored.category, "imaging");
  assert.equal(stored.image, undefined);
  assert.deepEqual(stored.resultObservationIds, [], "an imaging report has no values");
});

/* ---- the drip ------------------------------------------------------------------------------------ */

test("AN INFUSION'S VOLUME IS COMPUTED, and it says how much of it is assumption", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Noradrenaline", dose: { value: 4, unit: "mg" }, route: "iv", frequency: "continuous" },
  });
  const chart = (body) => as(NURSE, "/ward/infusion", "POST", { orgId: ORG, orderId: ord.orderId, ...body });

  const started = await chart({ event: "started", ratePerHour: 10, at: "2026-09-07T00:00:00.000Z" });
  assert.equal(started.__status, 200, JSON.stringify(started));
  /* Said on every write. This records what a human says the pump is doing; there is no device
   * integration here and nothing should ever read as having set a rate. */
  assert.match(started.note, /Nothing here has set a rate or controls a device/);

  await chart({ event: "rate-changed", ratePerHour: 20, at: "2026-09-07T01:00:00.000Z" });
  const paused = await chart({ event: "paused", at: "2026-09-07T02:00:00.000Z" });
  // A pause is its own event and its rate is forced to zero: a paused drip charted at 20 would keep
  // counting volume into a patient who is not receiving any.
  assert.equal(paused.ratePerHour, 0);

  const list = await as(NURSE, `/ward/infusions?orgId=${ORG}&patientId=${adm.patientId}&to=2026-09-07T04:00:00.000Z`);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.infusions.length, 1);
  const inf = list.infusions[0];
  assert.equal(inf.volume.ml, 30, "10 for an hour, 20 for an hour, then paused");
  assert.equal(inf.running, true, "paused is not stopped");
  assert.equal(inf.entries, 3);
  assert.match(list.note, /uncharted, not stopped/);

  /* THE CAVEAT. The total assumes the pump ran at the last charted rate for every minute since - and
   * if it occluded at 02:00 and nobody noticed, the fluid balance built on it is wrong. */
  assert.match(inf.volume.assumption, /assumes the pump has run/);
});

test("an infusion is never stopped by silence, and a stopped one is not restarted by a rate change", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Insulin infusion", dose: { value: 50, unit: "unit" }, route: "iv", frequency: "continuous" },
  });
  const chart = (body) => as(NURSE, "/ward/infusion", "POST", { orgId: ORG, orderId: ord.orderId, ...body });

  await chart({ event: "started", ratePerHour: 4, at: "2026-09-07T00:00:00.000Z" });
  // A long silence is FLAGGED rather than treated as a stop: those mean opposite things about the
  // patient - one is no longer receiving a drug, the other is receiving it with nobody looking.
  const late = await as(NURSE, `/ward/infusions?orgId=${ORG}&patientId=${adm.patientId}&to=2026-09-07T18:00:00.000Z`);
  assert.equal(late.infusions[0].running, true);
  assert.equal(late.infusions[0].volume.stale, true);
  assert.equal(late.stale, 1);
  assert.match(late.infusions[0].volume.staleDetail, /Check the pump/);

  await chart({ event: "stopped", at: "2026-09-07T06:00:00.000Z" });
  const stopped = await as(NURSE, `/ward/infusions?orgId=${ORG}&patientId=${adm.patientId}&to=2026-09-07T18:00:00.000Z`);
  assert.equal(stopped.infusions[0].running, false);
  assert.equal(stopped.infusions[0].volume.ml, 24, "six hours at 4, and nothing after the stop");

  /* Restarting is a new prescription decision. Letting a rate entry quietly revive a stopped
   * infusion would put a drug back up with nobody having decided to. */
  const revive = await chart({ event: "rate-changed", ratePerHour: 6, at: "2026-09-07T07:00:00.000Z" });
  assert.equal(revive.__status, 409);
  assert.equal(revive.error, "infusion_stopped");
  assert.match(revive.detail, /a new order, not a rate change/);

  // A running infusion needs a rate: a drip charted as running at nothing cannot be accounted for.
  assert.equal((await chart({ event: "started" })).error, "rate_required");
  // And charting a pump is the bedside's act, not the pharmacy's.
  assert.equal((await as(PHARM, "/ward/infusion", "POST", { orgId: ORG, orderId: ord.orderId, event: "started", ratePerHour: 4 })).__status, 403);
});

/* ---- ordering an investigation from the ward ----------------------------------------------------- */

test("THE WARD CAN ORDER A TEST, and a STAT one is at the top of the list of whoever takes the blood", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const order = (code, body) => as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code, ...(body || {}) });

  const routine = await order("Full blood count");
  assert.equal(routine.__status, 200, JSON.stringify(routine));
  assert.equal(routine.priority, "routine", "the safest default");
  assert.equal(routine.category, "laboratory");
  // No code system is invented: the ward typed a name, and a code it did not give is not guessed at.
  assert.equal((await RECORD.latest(TENANT_ROW.id, "ServiceRequest", routine.orderId)).codeSystem, "wardsynq-order-local");

  const stat = await order("Potassium", { priority: "stat", reason: "Suspected hyperkalaemia" });
  assert.equal(stat.priority, "stat");
  /* Said on every response. `stat` reaches the person who has to take the blood; it does not reach
   * the analyser, and a system implying otherwise gets trusted for something it cannot do. */
  assert.match(stat.priorityNote, /does not make the laboratory faster/);

  /* AND IT ACTUALLY REACHES THEM. A priority that changed nothing downstream would be decoration,
   * and prescribers stop setting it honestly within a week. */
  const list = await as(NURSE, `/ward/collections?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(list.awaitingCollection, 2);
  assert.equal(list.requests[0].code, "Potassium", "the stat order is first");
  assert.equal(list.requests[0].priority, "stat");
  assert.equal(list.requests[1].priority, "routine");

  // A word the system does not know is recorded as routine and SAID, not silently dropped.
  const odd = await order("Magnesium", { priority: "URGENT!!" });
  assert.equal(odd.priority, "routine");
  assert.equal(odd.priorityNotUnderstood, "URGENT!!");
  assert.match(odd.note, /is not a priority this system knows/);

  // Asking for the same test again on the same stay is the SAME order, not a second specimen.
  assert.equal((await order("Full blood count")).skipped, "already_ordered");
});

test("an investigation needs a stay that exists and is open, and is not a nurse's to order", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  // An order against a stay that does not exist is a specimen nobody can match to a patient.
  const ghost = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: "wsq-adm-nope", code: "Potassium" });
  assert.equal(ghost.__status, 404);
  assert.equal(ghost.error, "encounter_not_found");

  assert.equal((await as(NURSE, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Potassium" })).__status, 403,
    "asking for an investigation is a clinical act");

  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, dischargedAt: "2026-09-09T10:00:00.000Z" });
  const closed = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Potassium" });
  assert.equal(closed.__status, 409);
  assert.equal(closed.error, "encounter_closed");
  assert.match(closed.detail, /order it against the current one/);
});

/* ---- the flowsheet, from the real record --------------------------------------------------------- */

test("A CONFIGURED ROW WITH NOTHING IN IT STILL APPEARS, which is the whole point", async () => {
  seedHospital();
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = {
    ...org.fields.wardsynq,
    // The hospital's own rows. Respiratory rate is on the chart and will be charted; SpO2 is on the
    // chart and will NOT be.
    flowsheetRows: [{ code: "8480-6", label: "Systolic BP" }, { code: "9279-1", label: "Resp rate" }, { code: "59408-5", label: "SpO2" }],
  };
  const { adm } = await admittedPatientOnDrug();
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { sbp: "126", rr: "18" } });

  const fs = await as(NURSE, `/ward/flowsheet?orgId=${ORG}&patientId=${adm.patientId}&hours=6`);
  assert.equal(fs.__status, 200, JSON.stringify(fs));
  assert.equal(fs.rowsConfigured, true);
  assert.deepEqual(fs.grid.rows.map((r) => r.code), ["8480-6", "9279-1", "59408-5"]);

  /* THE POINT. A row that vanished because nobody charted it reads as "not part of this chart"
   * rather than "nobody charted it", and those are opposite conclusions. */
  const spo2 = fs.grid.rows.find((r) => r.code === "59408-5");
  assert.equal(spo2.chartedHours, 0);
  assert.equal(spo2.completeness, 0);
  assert.ok(spo2.cells.every((c) => c.empty), "every hour of it is visibly empty");
  assert.equal(spo2.label, "SpO2", "and it is headed by the hospital's own label, not a bare code");

  const sbp = fs.grid.rows.find((r) => r.code === "8480-6");
  assert.equal(sbp.chartedHours, 1);
  assert.equal(sbp.cells.find((c) => !c.empty).value, 126);
  assert.equal(sbp.label, "Systolic BP");

  // A laboratory result is not a flowsheet row: it has its own report and its own critical loop.
  const sr = await orderTest(adm, "Potassium", "wsq-sr-fs");
  await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr, tests: [{ test: "Potassium", value: 4.1, unit: "mmol/L" }] });
  const after = await as(NURSE, `/ward/flowsheet?orgId=${ORG}&patientId=${adm.patientId}&hours=6`);
  assert.deepEqual(after.grid.rows.map((r) => r.code), ["8480-6", "9279-1", "59408-5"], "the potassium did not become a row");

  // With no rows configured the grid shows what was charted, and SAYS it cannot show an omission.
  seedHospital();
  const { adm: adm2 } = await admittedPatientOnDrug();
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm2.encounterId, patientId: adm2.patientId, vitals: { sbp: "130" } });
  const loose = await as(NURSE, `/ward/flowsheet?orgId=${ORG}&patientId=${adm2.patientId}&hours=6`);
  assert.equal(loose.rowsConfigured, false);
  assert.match(loose.note, /cannot show a row nobody filled in/);
  assert.ok(loose.grid.rows.length >= 1);
});

/* ---- the room, the theatre and the scanner ------------------------------------------------------- */

test("A ROOM CANNOT BE OVERBOOKED, and the refusal names what is already there", async () => {
  seedHospital();
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = {
    ...org.fields.wardsynq,
    resources: [{ id: "ct-1", name: "CT scanner", kind: "equipment", location: "Radiology" }, { id: "th-1", name: "Theatre 1", kind: "theatre" }],
  };
  const { adm } = await admittedPatientOnDrug();
  const book = (body) => as(NURSE, "/ward/book-resource", "POST", { orgId: ORG, patientId: adm.patientId, ...body });

  const first = await book({ resourceId: "ct-1", startAt: "2026-09-07T09:00:00.000Z", minutes: 30, purpose: "CT head" });
  assert.equal(first.__status, 200, JSON.stringify(first));
  assert.equal(first.resourceName, "CT scanner");

  /* THE REFUSAL, AND THERE IS NO OVERRIDE. A clinician's diary may be overbooked - real clinics do
   * it. Two patients do not fit inside one CT scanner, and no amount of "deliberate" makes them. */
  const clash = await book({ resourceId: "ct-1", startAt: "2026-09-07T09:15:00.000Z", minutes: 30 });
  assert.equal(clash.__status, 409);
  assert.equal(clash.error, "resource_busy");
  // It names the booking already there: a refusal a scheduler cannot act on is one they replace
  // with a paper list.
  assert.match(clash.detail, /CT scanner is already booked from 2026-09-07T09:00/);
  assert.equal(clash.clashesWith.bookingId, first.bookingId);

  // Touching but not overlapping is fine: 09:00+30 ends exactly as 09:30 begins.
  assert.equal((await book({ resourceId: "ct-1", startAt: "2026-09-07T09:30:00.000Z", minutes: 30 })).__status, 200);
  // A different resource at the same time is not a clash.
  assert.equal((await book({ resourceId: "th-1", startAt: "2026-09-07T09:15:00.000Z", minutes: 60 })).__status, 200);

  /* CANCELLING FREES IT IMMEDIATELY AND KEEPS THE HISTORY. "They cancelled" and "they never had
   * one" are different facts, and the second is what a complaint turns on. */
  const off = await as(NURSE, "/ward/resource-state", "POST", { orgId: ORG, bookingId: first.bookingId, state: "cancelled", reason: "Patient too unwell to move." });
  assert.equal(off.state, "cancelled");
  assert.deepEqual((await RECORD.history(TENANT_ROW.id, "ResourceBooking", first.bookingId)).map((h) => h.state), ["booked", "cancelled"]);
  /* The freed slot is bookable again. 09:15 would NOT be - it still overlaps the 09:30 booking above,
   * which is the rule working rather than a stale one. */
  const stillBusy = await book({ resourceId: "ct-1", startAt: "2026-09-07T09:15:00.000Z", minutes: 30 });
  assert.equal(stillBusy.__status, 409, "cancelling the 09:00 did not free the 09:30");
  const rebooked = await book({ resourceId: "ct-1", startAt: "2026-09-07T09:00:00.000Z", minutes: 30 });
  assert.equal(rebooked.__status, 200, "a cancelled slot is bookable again");
  assert.equal(rebooked.state, "booked");

  const sched = await as(NURSE, `/ward/resource-schedule?orgId=${ORG}&resourceId=ct-1`);
  assert.equal(sched.resourcesConfigured, true);
  assert.equal(sched.resources[0].booked, 2, "two live bookings; the cancelled one is not counted");
});

test("a resource the hospital does not have cannot be booked, and a booking needs a length", async () => {
  seedHospital();
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...org.fields.wardsynq, resources: [{ id: "ct-1", name: "CT scanner" }] };
  const { adm } = await admittedPatientOnDrug();
  const book = (body) => as(NURSE, "/ward/book-resource", "POST", { orgId: ORG, patientId: adm.patientId, ...body });

  /* Accepting a made-up room is how a patient is sent somewhere that does not exist, and nobody
   * finds out until they are standing in a corridor. */
  const ghost = await book({ resourceId: "mri-9", startAt: "2026-09-07T09:00:00.000Z", minutes: 30 });
  assert.equal(ghost.__status, 404);
  assert.equal(ghost.error, "resource_not_found");
  assert.deepEqual(ghost.known, ["ct-1"], "and it says what this hospital does have");

  // A booking with no length has no end, so nothing could ever clash with it - which would silently
  // disable the one rule this file exists for.
  const endless = await book({ resourceId: "ct-1", startAt: "2026-09-07T09:00:00.000Z" });
  assert.equal(endless.__status, 422);
  assert.equal(endless.error, "minutes_required");
  assert.match(endless.detail, /nothing can clash with it/);

  // Cancelling without a reason loses why a slot was given up.
  const bk = await book({ resourceId: "ct-1", startAt: "2026-09-07T09:00:00.000Z", minutes: 30 });
  assert.equal((await as(NURSE, "/ward/resource-state", "POST", { orgId: ORG, bookingId: bk.bookingId, state: "cancelled" })).error, "reason_required");

  // A hospital with nothing configured says so, rather than reading as "no bookings".
  seedHospital();
  const none = await as(NURSE, `/ward/resource-schedule?orgId=${ORG}`);
  assert.equal(none.resourcesConfigured, false);
});

/* ---- the wound, over time ------------------------------------------------------------------------ */

test("A HEALING CATEGORY 4 IS STILL A CATEGORY 4, and where it came from cannot be edited", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const chart = (body) => as(NURSE, "/ward/wound", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, site: "Sacrum", kind: "pressure", ...body });

  const first = await chart({ stage: "4", origin: "acquired-here", lengthCm: 5, widthCm: 4, depthCm: 2, tissue: "Sloughy", assessedAt: "2026-09-01T09:00:00.000Z" });
  assert.equal(first.__status, 200, JSON.stringify(first));
  assert.equal(first.stage, "4");
  assert.equal(first.areaCm2, 20);
  assert.equal(first.comparison.state, "first");

  /* THE RULE. Two weeks later it is granulating and a nurse would reasonably chart it as a 2. The
   * lost tissue has not come back, and a chart that let the stage fall would report less harm than
   * the hospital caused. */
  const later = await chart({ stage: "2", lengthCm: 3, widthCm: 2, tissue: "Granulating", assessedAt: "2026-09-15T09:00:00.000Z" });
  assert.equal(later.__status, 200, JSON.stringify(later));
  assert.equal(later.stage, "2", "what the nurse saw today is recorded faithfully");
  assert.equal(later.worstStage, "4", "and the wound is still a category 4");
  assert.match(later.note, /never reverse-staged/);

  // The area change is reported as a change, never as "healing".
  assert.equal(later.comparison.state, "smaller");
  assert.equal(later.comparison.changeCm2, -14);
  assert.match(later.comparison.note, /not a judgement that the wound is healing/);

  /* WHERE IT CAME FROM IS SET ONCE. A system that let this be edited later is one where a hospital
   * can stop having pressure ulcers. */
  const relabel = await chart({ stage: "2", origin: "present-on-admission", assessedAt: "2026-09-16T09:00:00.000Z" });
  assert.equal(relabel.__status, 200);
  assert.equal(relabel.origin, "acquired-here", "unchanged");
  assert.equal(relabel.originNotChanged, "acquired-here");
  assert.match(relabel.warning, /not editable/);

  const list = await as(NURSE, `/ward/wounds?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(list.wounds.length, 1);
  assert.equal(list.wounds[0].worstStage, "4");
  assert.equal(list.wounds[0].assessments, 3);
  assert.equal(list.acquiredHere, 1, "the number the hospital is accountable for");
});

test("a different site is a different wound, and no image is accepted", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const chart = (body) => as(NURSE, "/ward/wound", "POST", { orgId: ORG, patientId: adm.patientId, site: "Sacrum", ...body });

  await chart({ stage: "2", origin: "acquired-here", assessedAt: "2026-09-01T09:00:00.000Z" });
  await chart({ site: "Left heel", stage: "unstageable", origin: "present-on-admission", assessedAt: "2026-09-01T09:00:00.000Z" });
  const list = await as(NURSE, `/ward/wounds?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(list.wounds.length, 2, "two pressure ulcers on one patient are two problems");
  assert.equal(list.acquiredHere, 1, "and only one of them is the hospital's");
  // unstageable outranks 4: it may conceal full-thickness loss, and treating it as lesser is how a
  // serious ulcer is recorded as a minor one.
  assert.equal(list.wounds.find((w) => w.site === "Left heel").worstStage, "unstageable");

  /* A wound image is identifiable PHI with its own storage, consent and retention problems. Refusing
   * beats silently ignoring a field somebody sent and believing it was saved. */
  const withPhoto = await chart({ stage: "2", photo: "data:image/jpeg;base64,...", assessedAt: "2026-09-02T09:00:00.000Z" });
  assert.equal(withPhoto.__status, 400);
  assert.equal(withPhoto.error, "no_images");

  // A stage outside the recognised vocabulary is refused rather than stored as a word.
  assert.equal((await chart({ stage: "nearly better" })).error, "unknown_stage");
  // And a wound with no site has no identity: two of them would be one record.
  assert.equal((await as(NURSE, "/ward/wound", "POST", { orgId: ORG, patientId: adm.patientId, stage: "2" })).error, "patient_and_site_required");
});

/* ---- the result, going out ----------------------------------------------------------------------- */

test("AN ORU CARRIES ONLY THIS REPORT'S RESULTS, and the lab's own flag", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  // Two separate reports on the same patient.
  const srA = await orderTest(adm, "Potassium", "wsq-sr-oru-a");
  const a = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: srA, panel: "Renal profile",
    tests: [{ test: "Potassium", value: 7.4, unit: "mmol/L", low: 3.5, high: 5.1, critical: true }],
  });
  const srB = await orderTest(adm, "Culture", "wsq-sr-oru-b");
  await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: srB, tests: [{ test: "Culture", value: "No growth at 48h" }],
  });

  const oru = await as(DOCTOR, `/ward/oru?orgId=${ORG}&reportId=${a.reportId}`);
  assert.equal(oru.__status, 200, JSON.stringify(oru));
  /* ONLY THIS REPORT'S. Sending the patient's whole Observation history in one ORU would send a
   * receiver every result the hospital has ever produced, every time. */
  assert.equal(oru.observations, 1);
  assert.ok(!oru.message.includes("No growth at 48h"));

  const segs = oru.message.split("\r");
  assert.ok(segs[0].startsWith("MSH|^~\\&|WardSynQ|SMD-WARD01|"));
  assert.match(segs[0], /ORU\^R01\^ORU_R01/);
  const obx = segs.find((s) => s.startsWith("OBX|")).split("|");
  assert.equal(obx[2], "NM", "a number is NM");
  assert.equal(obx[5], "7.4");
  assert.equal(obx[6], "mmol/L");
  // The LABORATORY's flag, carried through. Nothing here compared 7.4 to the range and decided.
  assert.equal(obx[8], "AA");
  assert.match(oru.note, /not certified/);

  // A report that does not exist is named, not returned as an empty body.
  const ghost = await as(DOCTOR, `/ward/oru?orgId=${ORG}&reportId=wsq-dr-nope`);
  assert.equal(ghost.__status, 404);
  assert.equal(ghost.error, "report_not_found");
  // And reading a chart in another wire format still needs the authority to read a chart.
  assert.equal((await as(PHARM, `/ward/oru?orgId=${ORG}&reportId=${a.reportId}`)).__status, 403);
});

/* ---- the cohort, and who in it is overdue -------------------------------------------------------- */

test("A REGISTRY NAMES PATIENTS, derives them from the problem list, and finds the ones never seen", async () => {
  seedHospital();
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = {
    ...org.fields.wardsynq,
    /* The review test is named by the code THIS hospital's laboratory actually produces. HbA1c is
     * not in the LOINC seed, so lab-result.js records it under a local code rather than guessing
     * one - and a registry has to match the record as it is, not as a standard wishes it were. */
    registries: [{ id: "diabetes", name: "Diabetes register", problemCodes: ["E11"], review: { everyMonths: 12, observationCode: "HbA1c", display: "HbA1c" } }],
  };

  const { adm } = await admittedPatientOnDrug();
  const empty = await as(DOCTOR, `/ward/registries?orgId=${ORG}`);
  assert.equal(empty.__status, 200, JSON.stringify(empty));
  assert.equal(empty.registries[0].total, 0, "nobody has the diagnosis yet");

  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "E11", display: "Type 2 diabetes" } });

  const one = await as(DOCTOR, `/ward/registries?orgId=${ORG}`);
  const reg = one.registries[0];
  assert.equal(reg.total, 1);
  /* NEVER REVIEWED IS THE MOST OVERDUE, not the least. Sorting somebody with no result as though
   * they had just been seen is how a patient goes years without a review. */
  assert.equal(reg.neverReviewed, 1);
  assert.equal(reg.members[0].patientId, adm.patientId);
  assert.equal(reg.members[0].review.state, "never");
  assert.equal(reg.members[0].because, "Type 2 diabetes", "why they are on the list, without opening a chart");
  /* It NAMES them, and that is the point - a registry that could not would be a number nobody can
   * act on. It is the one report in WardSynQ that does. */
  assert.match(one.note, /NAMES PATIENTS/);

  // A qualifying result takes them off the overdue list. A different test would not.
  const sr = await orderTest(adm, "HbA1c", "wsq-sr-hba");
  const rel = await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr, tests: [{ test: "HbA1c", value: 58, unit: "mmol/mol" }] });
  assert.equal(rel.observations[0].codeSystem, "wardsynq-lab-local", "no LOINC is invented for a test the seed does not know");
  const after = await as(DOCTOR, `/ward/registries?orgId=${ORG}`);
  assert.equal(after.registries[0].neverReviewed + after.registries[0].overdue, 0, "reviewed today");
  assert.equal(after.registries[0].members[0].review.state, "current");

  /* MEMBERSHIP IS DERIVED. Resolve the diagnosis and the patient leaves the cohort - no separate
   * registry table to forget to update. */
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "E11", display: "Type 2 diabetes", clinicalStatus: "resolved" } });
  assert.equal((await as(DOCTOR, `/ward/registries?orgId=${ORG}`)).registries[0].total, 0);

  // And a pharmacist, who holds no emr.view, does not get a list of patients beside their diagnoses.
  assert.equal((await as(PHARM, `/ward/registries?orgId=${ORG}`)).__status, 403);
});

/* ---- the patient promised a bed ----------------------------------------------------------------- */

test("A WAITING LIST THAT RESERVES NOTHING AND ADMITS NOBODY", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Waiting Testcase", mobile: "9876500033", gender: "male", ageYears: 61 });

  // A reason is required: an entry nobody can prioritise, review or explain to the patient is not a
  // waiting list, it is a queue.
  const bare = await as(NURSE, "/ward/request-admission", "POST", { orgId: ORG, mrn: reg.mrn, specialty: "Medicine" });
  assert.equal(bare.__status, 422);
  assert.equal(bare.error, "reason_required");

  const req = await as(NURSE, "/ward/request-admission", "POST", {
    orgId: ORG, mrn: reg.mrn, specialty: "Medicine", ward: "Medical A", reason: "Elective cardioversion",
    urgency: "soon", requestedAt: "2026-09-01T09:00:00.000Z",
  });
  assert.equal(req.__status, 200, JSON.stringify(req));
  assert.equal(req.state, "waiting");
  assert.match(req.note, /NO bed is reserved/);

  /* IT RESERVES NOTHING. The bed board is unchanged - a board that showed full while beds stood
   * empty is a board the ward stops reading. */
  const beds = await as(NURSE, `/ward/beds?orgId=${ORG}`);
  assert.equal(beds.__status, 200, JSON.stringify(beds));
  const medical = (beds.wards || []).find((w) => w.ward === "Medical A");
  assert.equal(medical, undefined, "nobody is in Medical A, so it is not on the board at all");

  const list = await as(NURSE, `/ward/waiting-list?orgId=${ORG}`);
  assert.equal(list.waiting, 1);
  assert.ok(list.requests[0].waitingHours >= 24, "how long they have waited is computed");
  assert.match(list.note, /not a bed allocation/);

  // ADMITTING IS A SEPARATE HUMAN ACT. Nothing on the list admits itself.
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "04", admittedAt: "2026-09-07T08:00:00.000Z" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));

  /* AND IT DOES NOT CLOSE THE REQUEST BY GUESSING. A patient may hold two - a medical bed now and a
   * surgical slot next month - so the list REPORTS that they are an inpatient and a human closes the
   * right one. */
  const after = await as(NURSE, `/ward/waiting-list?orgId=${ORG}`);
  assert.equal(after.waiting, 1, "still open");
  assert.equal(after.requests[0].patientAlreadyAdmitted, true);
  assert.match(after.requests[0].detail, /Close this request against their admission/);

  const closed = await as(NURSE, "/ward/close-admission-request", "POST", { orgId: ORG, requestId: req.requestId, state: "admitted", encounterId: adm.encounterId });
  assert.equal(closed.__status, 200, JSON.stringify(closed));
  assert.equal(closed.state, "admitted");
  assert.equal(closed.encounterId, adm.encounterId);
  assert.equal(closed.waitingHours, null, "a closed request has no growing wait");
  assert.equal((await as(NURSE, `/ward/waiting-list?orgId=${ORG}`)).waiting, 0);
});

test("a request is closed AGAINST a real admission, of the RIGHT patient, or with a reason", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Waiting Two", mobile: "9876500044", gender: "female", ageYears: 44 });
  const req = await as(NURSE, "/ward/request-admission", "POST", { orgId: ORG, mrn: reg.mrn, specialty: "Surgery", reason: "Hernia repair", urgency: "elective" });

  // "Admitted" with no encounter is a waiting list that empties itself and a patient nobody can find.
  const hollow = await as(NURSE, "/ward/close-admission-request", "POST", { orgId: ORG, requestId: req.requestId, state: "admitted" });
  assert.equal(hollow.__status, 422);
  assert.equal(hollow.error, "encounter_required");

  // Closing one patient's request with another's admission would put two people in one record.
  const { adm: other } = await admittedPatientOnDrug();
  const wrong = await as(NURSE, "/ward/close-admission-request", "POST", { orgId: ORG, requestId: req.requestId, state: "admitted", encounterId: other.encounterId });
  assert.equal(wrong.__status, 409);
  assert.equal(wrong.error, "wrong_patient");

  /* Cancelling without a reason loses why a patient who was promised a bed did not get one - the
   * single question a complaint about a waiting list asks. */
  const silent = await as(NURSE, "/ward/close-admission-request", "POST", { orgId: ORG, requestId: req.requestId, state: "cancelled" });
  assert.equal(silent.__status, 422);
  assert.equal(silent.error, "reason_required");

  const off = await as(NURSE, "/ward/close-admission-request", "POST", { orgId: ORG, requestId: req.requestId, state: "cancelled", reason: "Patient declined surgery." });
  assert.equal(off.state, "cancelled");
  assert.equal(off.closeReason, "Patient declined surgery.");
  // The history survives: a cancelled promise is still a promise that was made.
  assert.deepEqual((await RECORD.history(TENANT_ROW.id, "AdmissionRequest", req.requestId)).map((h) => h.state), ["waiting", "cancelled"]);
  assert.equal((await as(NURSE, "/ward/close-admission-request", "POST", { orgId: ORG, requestId: req.requestId, state: "cancelled", reason: "again" })).skipped, "already_closed");
});

/* ---- the hospital's own advice ------------------------------------------------------------------ */

test("A HOSPITAL'S OWN ADVISORY APPEARS AND CANNOT BLOCK", async () => {
  seedHospital();
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = {
    ...org.fields.wardsynq,
    advisories: [{
      id: "nephrotoxic-in-aki", level: "warn",
      message: "Creatinine is above 200. Review the dose of this nephrotoxic drug.",
      action: "Discuss with the renal team before the next dose.",
      reference: "Local renal prescribing guideline, 2026",
      when: [{ kind: "drug", value: "Gentamicin" }, { kind: "observation-above", code: "2160-0", value: 200, withinHours: 72 }],
    }],
  };
  const { adm } = await admittedPatientOnDrug();
  const order = (drug) => as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug, dose: { value: 240, unit: "mg" }, route: "iv", frequency: "OD" },
  });

  /* NOT MEASURED IS NOT "BELOW". With no creatinine on file the rule does not fire - advising about
   * a patient nobody has measured is worse than saying nothing. */
  const quiet = await order("Gentamicin");
  assert.equal(quiet.__status, 200, JSON.stringify(quiet));
  assert.equal(quiet.advisories, undefined);

  const sr = await orderTest(adm, "Creatinine", "wsq-sr-adv");
  await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr, tests: [{ test: "Creatinine", value: 240, unit: "umol/L" }] });

  const loud = await order("Gentamicin");
  /* IT CANNOT BLOCK. A hospital-authored rule is written by somebody who is not a software engineer,
   * in a hospital with no staging environment; a typo that could stop prescribing takes the ward
   * offline at 3am with nobody to roll it back. */
  assert.equal(loud.__status, 200, "the order is written regardless");
  assert.equal(loud.written, 1);
  assert.equal(loud.advisories.length, 1);
  assert.equal(loud.advisories[0].blocking, false);
  assert.equal(loud.advisories[0].message, "Creatinine is above 200. Review the dose of this nephrotoxic drug.");
  assert.equal(loud.advisories[0].reference, "Local renal prescribing guideline, 2026");
  /* Marked as the HOSPITAL's, so a prescriber can tell "your hospital asked me to tell you this"
   * from "this drug will harm this patient". */
  assert.equal(loud.advisories[0].source, "hospital-advisory");

  // A different drug on the same patient does not fire it: every condition must hold.
  assert.equal((await order("Paracetamol")).advisories, undefined);
});

/* ---- what this hospital stocks, and what it guards ---------------------------------------------- */

test("OFF-FORMULARY NEVER BLOCKS, and a RESTRICTED drug does - because the hospital said so", async () => {
  seedHospital();
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = {
    ...org.fields.wardsynq,
    formulary: [
      { drug: "Paracetamol 500mg" },
      { drug: "Meropenem", restricted: true, requiresApproval: true, approvedBy: "Microbiology", note: "Carbapenem stewardship." },
      { drug: "Vancomycin", restricted: true, restrictedTo: ["Intensive care"] },
    ],
  };
  const { adm } = await admittedPatientOnDrug();
  const order = (drug, extra) => as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, ...(extra || {}),
    order: { patientId: adm.patientId, encounterId: adm.encounterId, drug, dose: { value: 1, unit: "g" }, route: "iv", frequency: "TDS" },
  });

  /* A drug not on the list is not dangerous - it is not stocked. Refusing on those grounds would
   * teach prescribers that the safety warnings are bureaucratic too, which is how the ones that
   * matter stop being read. */
  const off = await order("Rifaximin");
  assert.equal(off.__status, 200, JSON.stringify(off));
  const stored = await RECORD.latest(TENANT_ROW.id, "MedicationOrder", off.orderId);
  assert.equal(stored.formularyState, "non-formulary", "recorded on the order, which is where pharmacy asks");

  // A RESTRICTED drug blocks, and the refusal names what is missing AND who grants it - one a
  // prescriber cannot act on at 2am is one they will work around.
  const mero = await order("Meropenem");
  assert.equal(mero.__status, 409);
  assert.equal(mero.error, "restricted_drug");
  assert.match(mero.detail, /approval reference from Microbiology/);
  assert.equal(mero.note, "Carbapenem stewardship.");
  /* Said plainly, so nobody reads this as the safety engine having found something clinical. A
   * formulary answers "does this hospital stock this"; the safety engine answers "would this harm
   * this patient". */
  assert.match(mero.basis, /not a clinical safety finding/);
  assert.equal(await RECORD.latest(TENANT_ROW.id, "MedicationOrder", "wsq-rx-" + adm.encounterId.toLowerCase() + "-meropenem"), null, "and nothing was written");

  const approved = await order("Meropenem", { approvalRef: "MICRO-2291" });
  assert.equal(approved.__status, 200, JSON.stringify(approved));
  assert.equal((await RECORD.latest(TENANT_ROW.id, "MedicationOrder", approved.orderId)).restrictionApprovalRef, "MICRO-2291");

  // A specialty restriction is satisfied by the specialty, not by an approval number.
  assert.equal((await order("Vancomycin", { approvalRef: "X" })).__status, 409);
  assert.equal((await order("Vancomycin", { specialty: "Intensive care" })).__status, 200);

  // Nothing is matched fuzzily: "Meropenem 1g" is a different string and is simply off-formulary,
  // not a restriction that was missed.
  const near = await order("Meropenem 1g");
  assert.equal(near.__status, 200);
  assert.equal((await RECORD.latest(TENANT_ROW.id, "MedicationOrder", near.orderId)).formularyState, "non-formulary");
});

test("a hospital MAY require a reason off-formulary, and no formulary is no opinion", async () => {
  seedHospital();
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...org.fields.wardsynq, formulary: [{ drug: "Paracetamol 500mg" }], requireReasonOffFormulary: true };
  const { adm } = await admittedPatientOnDrug();
  const order = (drug, extra) => as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, ...(extra || {}),
    order: { patientId: adm.patientId, encounterId: adm.encounterId, drug, dose: { value: 1, unit: "g" }, route: "iv", frequency: "TDS" },
  });

  const bare = await order("Rifaximin");
  assert.equal(bare.__status, 409);
  assert.equal(bare.error, "formulary_reason_required");
  assert.match(bare.detail, /Say why this drug/);

  // The reason is RECORDED, never adjudicated.
  const withReason = await order("Rifaximin", { formularyReason: "Patient's own supply from home." });
  assert.equal(withReason.__status, 200, JSON.stringify(withReason));
  assert.equal((await RECORD.latest(TENANT_ROW.id, "MedicationOrder", withReason.orderId)).formularyReason, "Patient's own supply from home.");

  // A hospital with no formulary configured has no opinion, and blocks nothing - even with the
  // reason switch on, because there is nothing to be off.
  seedHospital();
  const { adm: adm2 } = await admittedPatientOnDrug();
  const none = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, order: { patientId: adm2.patientId, encounterId: adm2.encounterId, drug: "Meropenem", dose: { value: 1, unit: "g" }, route: "iv", frequency: "TDS" },
  });
  assert.equal(none.__status, 200, JSON.stringify(none));
});

/* ---- "this cannot be the same patient" ---------------------------------------------------------- */

test("A DELTA BREACH FLAGS THE RESULT AND NEVER WITHHOLDS IT", async () => {
  seedHospital();
  /* The thresholds are the hospital's, exactly like the critical limits. Nothing in the code knows
   * what a big change in a creatinine is. */
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = {
    ...org.fields.wardsynq,
    deltaLimits: { "2160-0": { maxAbsolute: 50, maxPercent: 30, withinHours: 72 } },
    autoVerify: { enabled: true, codes: ["2160-0"] },
  };

  const { adm } = await admittedPatientOnDrug();
  const sr1 = await orderTest(adm, "Creatinine", "wsq-sr-cr1");
  const first = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: sr1, reportedAt: "2026-09-06T12:00:00.000Z",
    tests: [{ test: "Creatinine", value: 78, unit: "umol/L", low: 60, high: 110 }],
  });
  assert.equal(first.__status, 200, JSON.stringify(first));
  // A first result has no previous to compare against, and holding every one would hold most of a
  // new admission's bloods for no finding.
  assert.equal(first.observations[0].delta.state, "not-checked");
  assert.equal(first.observations[0].delta.reason, "no_previous_result");
  assert.equal(first.observations[0].autoVerified, true, "in range, no critical flag, no delta to breach");
  assert.equal(first.needsReview, 0);

  const sr2 = await orderTest(adm, "Creatinine", "wsq-sr-cr2");
  const second = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: sr2, reportedAt: "2026-09-07T12:00:00.000Z",
    tests: [{ test: "Creatinine", value: 240, unit: "umol/L", low: 60, high: 110 }],
  });
  assert.equal(second.__status, 200, "the result is RELEASED, not withheld");
  assert.equal(second.deltaBreaches, 1);
  const d = second.observations[0].delta;
  assert.equal(d.state, "breach");
  assert.equal(d.previous.value, 78);
  assert.equal(d.direction, "rise");
  /* The commonest explanation for an impossible change is a mislabelled tube or two swapped samples,
   * and the wording has to make a reader think of that first. */
  assert.match(d.detail, /check the sample identity/);

  // The flag travels ON the observation, not just in the response to whoever released it.
  const stored = (await RECORD.byPatient(TENANT_ROW.id, "Observation", adm.patientId)).filter((o) => o.deltaBreach);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].value, 240);

  // Out of range AND a delta breach: both reasons are reported, because both are work.
  assert.equal(second.observations[0].autoVerified, false);
  assert.deepEqual(second.observations[0].needsReview.sort(), ["above_reference_range", "delta_breach"]);
});

test("AUTOVERIFICATION IS OFF UNLESS THE HOSPITAL ASKS, and never releases what it could not check", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  // No config at all: every result needs a human, and says why.
  const sr = await orderTest(adm, "Creatinine", "wsq-sr-cr3");
  const plain = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: sr, tests: [{ test: "Creatinine", value: 80, unit: "umol/L", low: 60, high: 110 }],
  });
  assert.equal(plain.observations[0].autoVerified, false);
  assert.deepEqual(plain.observations[0].needsReview, ["not_enabled"]);
  assert.equal(plain.needsReview, 1);
  // And with no configured limit, the delta is reported as NOT CHECKED rather than as a pass.
  assert.equal(plain.observations[0].delta.reason, "no_limit_configured");

  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...org.fields.wardsynq, autoVerify: { enabled: true, codes: ["2160-0"] } };

  // A non-numeric result is a sentence somebody wrote. It is never released unread.
  const sr2 = await orderTest(adm, "Creatinine", "wsq-sr-cr4");
  const text = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: sr2, tests: [{ test: "Creatinine", value: "Haemolysed", unit: "umol/L", low: 60, high: 110 }],
  });
  assert.equal(text.observations[0].autoVerified, false);
  assert.ok(text.observations[0].needsReview.includes("non_numeric"));

  // The laboratory's own critical flag always wins, exactly as in the critical-value loop.
  const sr3 = await orderTest(adm, "Creatinine", "wsq-sr-cr5");
  const crit = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: sr3, tests: [{ test: "Creatinine", value: 80, unit: "umol/L", low: 60, high: 110, critical: true }],
  });
  assert.ok(crit.observations[0].needsReview.includes("flagged_critical_by_lab"));

  // NO RANGE IS NOT A PASS: there is nothing to check against, so a human checks.
  const sr4 = await orderTest(adm, "Creatinine", "wsq-sr-cr6");
  const noRange = await as(LABTECH, "/ward/release-result", "POST", {
    orgId: ORG, serviceRequestId: sr4, tests: [{ test: "Creatinine", value: 80, unit: "umol/L" }],
  });
  assert.deepEqual(noRange.observations[0].needsReview, ["no_reference_range"]);
});

/* ---- ADT out ------------------------------------------------------------------------------------- */

test("THE ADT MESSAGE IS BUILT FROM THE RECORD, and a stay it cannot describe is refused", async () => {
  seedHospital();
  const { reg, adm } = await admittedPatientOnDrug();

  const admit = await as(NURSE, `/ward/adt?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(admit.__status, 200, JSON.stringify(admit));
  assert.equal(admit.event, "A01");
  const segs = admit.message.split("\r");
  assert.deepEqual(segs.map((s) => s.slice(0, 3)), ["MSH", "EVN", "PID", "PV1"]);
  assert.ok(admit.message.startsWith("MSH|^~\\&|WardSynQ|SMD-WARD01|"), "the sending facility is the org's own code");
  assert.match(segs[2], new RegExp(reg.mrn + "\\^\\^\\^SMD-WARD01\\^MR"), "PID-3 carries its assigning authority");
  assert.equal(segs[3].split("|")[3], "Medical A^^12", "PV1-3 is ward, room, bed");
  assert.equal(segs[3].split("|")[19], adm.encounterId, "PV1-19 is the visit");
  /* Shaped is not conformant, and the response says so every time rather than letting an integration
   * engineer assume otherwise. */
  assert.match(admit.note, /not certified/);

  // Discharging the patient changes the EVENT, from the record - a message can never announce an
  // admission for a stay that has ended.
  await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, dischargedAt: "2026-09-09T10:00:00.000Z" });
  const out = await as(NURSE, `/ward/adt?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(out.event, "A03");
  assert.match(out.message.split("\r")[0], /ADT\^A03/);

  // An encounter ADT does not describe is NAMED, not returned as an empty body.
  const reg2 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "OPD Only", mobile: "9876500022", gender: "male", ageYears: 40 });
  assert.ok(reg2.mrn);
  const missing = await as(NURSE, `/ward/adt?orgId=${ORG}&encounterId=wsq-adm-nope`);
  assert.equal(missing.__status, 404);
  assert.equal(missing.error, "encounter_not_found");
  // And a pharmacist, who holds no emr.view, does not get the chart in another wire format either.
  assert.equal((await as(PHARM, `/ward/adt?orgId=${ORG}&encounterId=${adm.encounterId}`)).__status, 403);
});

/* ---- the second nurse ---------------------------------------------------------------------------- */

test("A HIGH-ALERT DRUG NEEDS A SECOND NURSE, and the LIST is the hospital's", async () => {
  seedHospital();
  /* The high-alert list is org configuration, never clinical logic in the code: which products need
   * a witness belongs to the hospital formulary. This is the org's list reaching the bedside. */
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...org.fields.wardsynq, highAlertDrugs: ["INSULIN"] };

  const { adm, patient, ord: plain, scan: plainScan } = await admittedPatientOnDrug();
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG,
    order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Insulin glargine", dose: { value: 10, unit: "unit" }, route: "subcutaneous", frequency: "OD" },
  });
  assert.equal(ord.__status, 200, JSON.stringify(ord));
  const step = (a, x) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: a, orderId: ord.orderId, dueAt: DUE, patient, ...(x || {}) });
  await step("verify"); await step("dispense");
  const scanned = await step("scan", { scan: { patientBarcode: patient.mrn, drugBarcode: "Insulin glargine", dose: { value: 10, unit: "unit" }, route: "subcutaneous" } });
  assert.equal(scanned.to, "scanned", JSON.stringify(scanned));

  // Without a witness it is REFUSED, with the reason a nurse can act on.
  const alone = await step("administer");
  assert.equal(alone.__status, 409);
  assert.deepEqual(alone.reasons.map((r) => r.code), ["WITNESS_REQUIRED"]);

  // The witness must be somebody else. A nurse cannot witness herself.
  const self = await step("administer", { witnessId: idFor(NURSE) });
  assert.equal(self.__status, 409);
  assert.deepEqual(self.reasons.map((r) => r.code), ["WITNESS_NOT_INDEPENDENT"]);

  const given = await step("administer", { witnessId: idFor(DOCTOR) });
  assert.equal(given.__status, 200, JSON.stringify(given));
  assert.equal(given.to, "administered");
  // Both names are on the record: who gave it and who watched.
  const rec = await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", given.administrationId);
  assert.equal(rec.administeredBy, idFor(NURSE));
  assert.equal(rec.witnessedBy, idFor(DOCTOR));

  /* AND A DRUG THE HOSPITAL DID NOT LIST NEEDS NO WITNESS. The list is the whole rule - nothing in
   * the code decides that insulin is high-alert, which is why a hospital can add to it. */
  const other = (a, x) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: a, orderId: plain.orderId, dueAt: DUE, patient, ...(x || {}) });
  await other("verify"); await other("dispense"); await other("scan", { scan: plainScan });
  assert.equal((await other("administer")).to, "administered", "paracetamol is not on this hospital's list");
});

/* ---- the sample somebody has to take ----------------------------------------------------------- */

test("ORDER -> COLLECT -> RECEIVE -> RESULT, and an uncollected order is VISIBLY uncollected", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const sr = await orderTest(adm, "Potassium", "wsq-sr-k");

  /* THE STATE THIS WHOLE FEATURE EXISTS FOR. Before it, this order and one whose blood is sitting in
   * the analyser were the same thing on screen: "requested, no result yet". Only one of them has a
   * nurse who still has to go and do something. */
  const before = await as(NURSE, `/ward/collections?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(before.__status, 200, JSON.stringify(before));
  assert.equal(before.awaitingCollection, 1);
  assert.equal(before.requests[0].collection.state, "none");
  assert.match(before.requests[0].collection.detail, /No sample has been taken/);

  const got = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr, specimenType: "Whole blood", container: "Lithium heparin", at: "2026-09-07T09:00:00.000Z" });
  assert.equal(got.__status, 200, JSON.stringify(got));
  assert.equal(got.state, "collected");
  assert.equal(got.collectedBy, idFor(NURSE));
  assert.match(got.note, /laboratory has not received it yet/);

  // COLLECTED IS NOT RECEIVED. A tube in a nurse's pocket and a tube on the bench are different
  // facts, and the space between them is where samples are lost.
  const mid = await as(NURSE, `/ward/collections?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(mid.awaitingCollection, 0);
  assert.equal(mid.inTransit, 1);
  assert.equal(mid.requests[0].collection.state, "collected");

  /* THE LABORATORY says it arrived - the other half of the journey, and its own authority. The nurse
   * holds no lab.result and the lab holds no emr.vitals, so this is the alternative-authority path. */
  const arrived = await as(LABTECH, "/ward/specimen-outcome", "POST", { orgId: ORG, specimenId: got.specimenId, state: "received" });
  assert.equal(arrived.__status, 200, JSON.stringify(arrived));
  assert.equal(arrived.state, "received");
  assert.equal(arrived.receivedBy, idFor(LABTECH));
  assert.equal((await as(NURSE, `/ward/collections?orgId=${ORG}&patientId=${adm.patientId}`)).inTransit, 0);

  // And the result still comes through the laboratory's own route. Collection produced nothing.
  const stored = await RECORD.byPatient(TENANT_ROW.id, "SpecimenCollection", adm.patientId);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].value, undefined, "a specimen record never carries a result");
  assert.equal((await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr, tests: [{ test: "Potassium", value: 4.1, unit: "mmol/L" }] })).__status, 200);
});

test("A FAILED ATTEMPT SENDS THE ORDER BACK TO NEEDING COLLECTION, loudly", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const sr = await orderTest(adm, "Potassium", "wsq-sr-k2");
  const first = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr, specimenType: "Whole blood", at: "2026-09-07T09:00:00.000Z" });

  // A failure with no reason cannot be acted on, and "take it again, differently" is the action.
  const mute = await as(NURSE, "/ward/specimen-outcome", "POST", { orgId: ORG, specimenId: first.specimenId, state: "failed" });
  assert.equal(mute.__status, 422);
  assert.equal(mute.error, "reason_required");

  const failed = await as(NURSE, "/ward/specimen-outcome", "POST", { orgId: ORG, specimenId: first.specimenId, state: "failed", failureReason: "Haemolysed, laboratory rejected it." });
  assert.equal(failed.state, "failed");
  assert.match(failed.note, /still needs taking/);

  /* NEVER 'IN PROGRESS'. A ward that reads a failed draw as in-flight waits forever for a result
   * that is never coming. */
  const list = await as(NURSE, `/ward/collections?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(list.awaitingCollection, 1);
  assert.equal(list.inTransit, 0);
  assert.equal(list.requests[0].collection.state, "failed");
  assert.equal(list.requests[0].collection.reason, "Haemolysed, laboratory rejected it.");

  // The second attempt is a SECOND specimen. The first is not erased: the patient was bled twice,
  // which is exactly what a complaint asks about.
  const second = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr, specimenType: "Whole blood", at: "2026-09-07T09:40:00.000Z" });
  assert.notEqual(second.specimenId, first.specimenId);
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "SpecimenCollection", adm.patientId)).length, 2);
  assert.equal((await as(NURSE, `/ward/collections?orgId=${ORG}&patientId=${adm.patientId}`)).requests[0].collection.state, "collected");

  // Received is terminal: a later failure is a statement about the assay, not the specimen.
  await as(LABTECH, "/ward/specimen-outcome", "POST", { orgId: ORG, specimenId: second.specimenId, state: "received" });
  const late = await as(NURSE, "/ward/specimen-outcome", "POST", { orgId: ORG, specimenId: second.specimenId, state: "failed", failureReason: "clotted" });
  assert.equal(late.skipped, "already_received");
});

test("no sample is taken against an order that does not exist, and a pharmacist takes none at all", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  // An unlabelled tube reaching a laboratory with a request number nobody can match is the failure
  // this refusal prevents.
  const ghost = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: "wsq-sr-nope" });
  assert.equal(ghost.__status, 404);
  assert.equal(ghost.error, "request_not_found");

  const sr = await orderTest(adm, "Potassium", "wsq-sr-k3");
  assert.equal((await as(PHARM, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr })).__status, 403);

  // A specimen with no recorded type is accepted and SAYS it has none rather than acquiring one from
  // the test name.
  const bare = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr, at: "2026-09-07T09:00:00.000Z" });
  assert.equal(bare.__status, 200, JSON.stringify(bare));
  assert.equal(bare.specimenType, null);
  assert.match(bare.warning, /guesses one from the test name/);
});

/* ---- the pharmacy issued it; nobody has taken it ----------------------------------------------- */

test("DISPENSING IS SUPPLY, NOT ADMINISTRATION, and the pharmacy still cannot write a dose", async () => {
  seedHospital();
  const { adm, ord, patient, scan } = await admittedPatientOnDrug();

  const d = await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: ord.orderId, quantity: { value: 21, unit: "tablet" }, destination: "Medical A", at: "2026-09-07T08:30:00.000Z" });
  assert.equal(d.__status, 200, JSON.stringify(d));
  assert.equal(d.state, "issued");
  assert.equal(d.orderVersion, 1, "issued against a version, so an amendment later is visible");
  assert.match(d.note, /No dose has been administered/);
  // No pharmacist verification exists for this order, so it is RECORDED as unverified rather than
  // implying a check that never happened. Not every hospital runs verification, so it is not refused.
  assert.equal(d.unverified, true);
  assert.match(d.warning, /recorded as unverified/);

  /* THE SEPARATION. A dispense writes its own resource and never touches the administration record:
   * a system where "dispensed" drifts into "given" puts doses on charts nobody administered. */
  assert.equal(await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", "wsq-mar-" + ord.orderId.toLowerCase() + "-x"), null);
  const stored = await RECORD.byPatient(TENANT_ROW.id, "MedicationDispense", adm.patientId);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].resourceType, "MedicationDispense");
  assert.equal(stored[0].administeredAt, undefined);

  // And the eMAR is entirely unmoved: the dose has not started.
  const round = await as(NURSE, `/ward/round?orgId=${ORG}&patientId=${adm.patientId}&dueAt=${encodeURIComponent(DUE)}`);
  assert.equal(round.due[0].status, null, "issuing stock did not start a dose");

  /* THE REFUSAL THAT MATTERS. The pharmacy can now write a supply record, and still cannot post an
   * administration - a role that could do both could fabricate a dose through the raw API without
   * going near a patient. */
  const mar = await as(PHARM, "/ward/mar", "POST", { orgId: ORG, action: "scan", orderId: ord.orderId, dueAt: DUE, patient, scan });
  assert.equal(mar.__status, 403);

  // The nurse's own loop is untouched by any of it.
  const step = (a, x) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: a, orderId: ord.orderId, dueAt: DUE, patient, ...(x || {}) });
  await step("verify"); await step("dispense"); await step("scan", { scan });
  assert.equal((await step("administer")).to, "administered");
});

test("A SUPERSEDED VERIFICATION STOPS THE SUPPLY, and a repeat supply is a second record", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();
  const issue = (at, q) => as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: ord.orderId, quantity: q || { value: 21, unit: "tablet" }, at });

  await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: ord.orderId, outcome: "verified" });
  const first = await issue("2026-09-07T08:00:00.000Z");
  assert.equal(first.unverified, false);
  assert.equal(first.verifiedVersion, 1);

  // A second supply the same day is a NEW record. An id keyed only on the order would have
  // overwritten the first, losing the fact that the ward was supplied twice.
  const second = await issue("2026-09-07T20:00:00.000Z");
  assert.notEqual(second.dispenseId, first.dispenseId);
  assert.equal((await as(PHARM, `/ward/dispenses?orgId=${ORG}&patientId=${adm.patientId}`)).dispenses.length, 2);
  // The identical request again is the same dispense, not a third.
  assert.equal((await issue("2026-09-07T20:00:00.000Z")).skipped, "already_dispensed");

  /* The prescriber doubles the dose. The pharmacist's approval was of version 1, so issuing now
   * would put "the pharmacist approved this" against a prescription they never saw. */
  await as(DOCTOR, "/ward/medication-order", "POST", {
    orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Paracetamol 500mg", dose: { value: 1000, unit: "mg" }, route: "oral", frequency: "TID" },
  });
  const stale = await issue("2026-09-08T08:00:00.000Z");
  assert.equal(stale.__status, 409);
  assert.equal(stale.error, "verification_superseded");
  assert.equal(stale.verifiedVersion, 1);
  assert.equal(stale.orderVersion, 2);
  assert.match(stale.detail, /Re-verify before issuing/);

  // Re-verified, it goes out again.
  await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: ord.orderId, outcome: "verified" });
  assert.equal((await issue("2026-09-08T08:00:00.000Z")).__status, 200);
});

test("EXPIRED STOCK IS REFUSED, and a batch nobody recorded is not a batch that was checked", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();
  const issue = (body) => as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: ord.orderId, quantity: { value: 21, unit: "tablet" }, ...body });

  /* THE ONE PLACE THIS FILE BLOCKS ON SOMETHING OTHER THAN THE PRESCRIPTION. Dispensing an expired
   * drug is a recognised harm, and the box says so in the pharmacist's hand. */
  const dead = await issue({ batch: "B-1", expiry: "2026-08", at: "2026-09-07T09:00:00.000Z" });
  assert.equal(dead.__status, 409);
  assert.equal(dead.error, "expired_stock");
  assert.match(dead.detail, /expired on 2026-08/);
  // Said plainly, so nobody reads a stock refusal as the safety engine finding something clinical.
  assert.match(dead.basis, /not a clinical finding/);
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "MedicationDispense", adm.patientId)).length, 0, "and nothing was written");

  // A box marked 09/2026 is usable on 30 September: an expiry is the END of its period.
  const ok = await issue({ batch: "B-2", expiry: "2026-09", at: "2026-09-30T10:00:00.000Z" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.expiryCheck.state, "in-date");
  assert.equal(ok.batch, "B-2");
  // Which batch went to which patient is the first thing a recall asks, and it is on the record.
  assert.equal((await RECORD.latest(TENANT_ROW.id, "MedicationDispense", ok.dispenseId)).batch, "B-2");

  /* AN ABSENT EXPIRY IS NOT A VALID ONE. Not every hospital captures it and refusing everywhere
   * would stop supply, so it goes through - recorded as unchecked, never as "checked and fine". */
  const blind = await issue({ at: "2026-10-01T10:00:00.000Z" });
  assert.equal(blind.__status, 200);
  assert.equal(blind.expiryCheck.state, "unknown");
  assert.match(blind.expiryWarning, /none was checked/);
  const unreadable = await issue({ expiry: "next Tuesday", at: "2026-10-02T10:00:00.000Z" });
  assert.equal(unreadable.expiryCheck.state, "unreadable");
  assert.match(unreadable.expiryWarning, /no expiry was checked/);
});

test("stock that comes back is a RETURN, and the issue is never erased", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnDrug();
  const d = await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: ord.orderId, quantity: { value: 21, unit: "tablet" }, at: "2026-09-07T08:00:00.000Z" });

  // Clearing it off without saying why would lose the reason the ward had medicine it did not use.
  const silent = await as(PHARM, "/ward/dispense-return", "POST", { orgId: ORG, dispenseId: d.dispenseId });
  assert.equal(silent.__status, 422);
  assert.equal(silent.error, "reason_required");

  const back = await as(PHARM, "/ward/dispense-return", "POST", { orgId: ORG, dispenseId: d.dispenseId, reason: "Patient discharged; unused stock returned." });
  assert.equal(back.__status, 200, JSON.stringify(back));
  assert.equal(back.state, "returned");

  /* THE ISSUE HAPPENED. The medicine was on the ward, and a controlled-drug audit asks exactly that,
   * so the return is the next VERSION of the same record rather than a deletion. */
  const history = await RECORD.history(TENANT_ROW.id, "MedicationDispense", d.dispenseId);
  assert.deepEqual(history.map((h) => h.state), ["issued", "returned"]);
  assert.equal(history[0].quantity.value, 21, "and what was issued is still on the record");

  // A quantity nobody stated is refused outright: "we sent some" is not a supply record.
  const vague = await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: ord.orderId, quantity: { value: 21 } });
  assert.equal(vague.__status, 422);
  assert.equal(vague.error, "quantity_required");

  // A nurse does not issue pharmacy stock, and a doctor does not either.
  assert.equal((await as(NURSE, "/ward/dispense", "POST", { orgId: ORG, orderId: ord.orderId, quantity: { value: 1, unit: "tablet" } })).__status, 403);
  assert.ok(adm.patientId);
});

/* ---- measures about the system --------------------------------------------------------------- */

test("A DOSE RECORD NOW SAYS WHEN IT WAS DUE, so the ward can ask whether it was late", async () => {
  seedHospital();
  const { ord, patient, scan } = await admittedPatientOnDrug();
  const step = (a, x) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: a, orderId: ord.orderId, dueAt: DUE, patient, ...(x || {}) });
  await step("verify"); await step("dispense"); await step("scan", { scan });
  const given = await step("administer");
  assert.equal(given.to, "administered");

  /* The due time was in the administration's ID and nowhere else, so the record could say a dose was
   * given and could not say whether it was given late. Recovering it by parsing the id back would be
   * guessing at a slug. */
  const rec = await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", given.administrationId);
  assert.equal(rec.dueAt, DUE);
  assert.ok(rec.administeredAt);
  // Never derived from administeredAt, which would make every dose on time by definition.
  assert.notEqual(rec.dueAt, rec.administeredAt);
});

test("THE QUALITY REPORT MEASURES THE SYSTEM, names nobody, and admits what it cannot compute", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  const rep = await as(NURSE, `/ward/quality?orgId=${ORG}&days=30`);
  assert.equal(rep.__status, 200, JSON.stringify(rep));
  assert.equal(rep.measures.length, 4);
  assert.equal(rep.period.days, 30);

  /* NO CLINICIAN IS NAMED OR COUNTED. The moment a number can be attributed to an individual it
   * stops measuring the process and starts managing the staff. */
  const body = JSON.stringify(rep);
  assert.ok(!body.includes(idFor(NURSE)) && !body.includes(idFor(DOCTOR)));
  assert.match(rep.note, /No clinician is named or counted/);

  // Two measures this hospital's record cannot support, each shown WITH its reason rather than left
  // off - a missing row on a dashboard reads as "nothing to report".
  assert.equal(rep.notComputable, 2);
  const allergy = rep.measures.find((m) => m.id === "allergy-status-documented");
  assert.equal(allergy.computable, false);
  assert.match(allergy.reason, /asked, and there are none/);
  // No escalation window is configured on this org, so that measure is refused rather than scored
  // against a threshold nobody agreed to.
  assert.equal(rep.measures.find((m) => m.id === "critical-ack-within-window").computable, false);

  // A stay that is still open is not a missing discharge summary.
  const dcs = rep.measures.find((m) => m.id === "discharge-summary-signed");
  assert.equal(dcs.denominator, 0);
  assert.equal(dcs.rate, null, "no cases is null, not 0% and not 100%");
  assert.ok(adm.encounterId);

  // A pharmacist holds no emr.view.
  assert.equal((await as(PHARM, `/ward/quality?orgId=${ORG}`)).__status, 403);
});

/* ---- what the ward holds when the system is not there ------------------------------------------ */

test("THE DOWNTIME PACK IS ASSEMBLED FROM THE REAL RECORD, and it writes nothing", async () => {
  seedHospital();
  const { reg, adm, ord } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, display: "Community-acquired pneumonia" } });

  const before = (await RECORD.latestByType(TENANT_ROW.id, "Encounter", 200)).length;
  const pack = await as(NURSE, `/ward/downtime?orgId=${ORG}&ward=Medical A`);
  assert.equal(pack.__status, 200, JSON.stringify(pack));
  assert.equal(pack.count, 1);

  const p = pack.patients[0];
  assert.equal(p.encounterId, adm.encounterId);
  assert.equal(p.mrn, reg.mrn, "enough to identify the right person at a bedside");
  assert.equal(p.bed, "12");
  assert.equal(p.orders.length, 1);
  assert.equal(p.orders[0].drug, "Paracetamol 500mg");
  assert.ok(p.orders[0].due.length >= 3, "and when it is due, so the ward can keep giving it");
  assert.deepEqual(p.problems, [], "nothing on this page is missing");

  /* IT SAYS WHAT IT IS, on the pack. A downtime sheet is dangerous in exactly one way - a clinician
   * trusting it after it has gone stale - so this is printed, not left to a policy document nobody
   * has read at 03:00. */
  assert.match(pack.warning, /point-in-time COPY/);
  assert.match(pack.note, /NOT on this sheet/);
  assert.ok(pack.generatedAt && pack.coversUntil > pack.generatedAt);

  // IT WRITES NOTHING. No flag, no "downtime mode", no record that it was taken. A route that
  // mutated the record in order to prepare for an outage is one more thing to go wrong during one.
  assert.equal((await RECORD.latestByType(TENANT_ROW.id, "Encounter", 200)).length, before);
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId).then((e) => e.version), 1);

  // The ward filter is the ward's own, and an empty ward is an empty pack rather than everybody.
  assert.equal((await as(NURSE, `/ward/downtime?orgId=${ORG}&ward=Surgical B`)).count, 0);

  // A pharmacist holds no emr.view, and the whole ward's chart on one sheet needs it.
  assert.equal((await as(PHARM, `/ward/downtime?orgId=${ORG}`)).__status, 403);
  assert.ok(ord.orderId);
});

/* ---- the note that needs a second name on it --------------------------------------------------- */

async function noteBy(email, adm, sections, at) {
  return as(email, "/ward/note", "POST", {
    orgId: ORG, templateId: "ward-round", encounterId: adm.encounterId,
    sections: sections || { impression: "Improving. Afebrile overnight.", plan: "Continue oral antibiotics." },
    at: at || "2026-09-07T11:00:00.000Z",
  });
}

test("A NOTE THE SYSTEM CANNOT VERIFY IS ROUTED, not left lying unsigned", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  // The locum writes the note perfectly well. emr.treat is a capability; a registration is not.
  const n = await noteBy(LOCUM, adm);
  assert.equal(n.__status, 200, JSON.stringify(n));
  assert.equal(n.signed, false);
  const stored = await RECORD.latest(TENANT_ROW.id, "ClinicalNote", n.noteId);
  assert.equal(stored.authorId, idFor(LOCUM));

  /* They cannot sign it, and they are TOLD WHY. The store would refuse the write anyway; this is
   * the difference between a clinician reading "you hold no verified registration, submit it for a
   * colleague" and being handed a governance code. */
  const cannot = await as(LOCUM, "/ward/note-sign", "POST", { orgId: ORG, noteId: n.noteId });
  assert.equal(cannot.__status, 403);
  assert.equal(cannot.error, "no_credential");
  assert.match(cannot.detail, /verified medical registration/);

  // Nobody countersigns work its author has not declared finished.
  const early = await as(DOCTOR, "/ward/note-sign", "POST", { orgId: ORG, noteId: n.noteId });
  assert.equal(early.__status, 403);
  assert.equal(early.error, "not_submitted");

  // Nor does anyone else declare it finished on the author's behalf.
  const notMine = await as(DOCTOR, "/ward/note-submit", "POST", { orgId: ORG, noteId: n.noteId });
  assert.equal(notMine.__status, 403);
  assert.equal(notMine.error, "not_the_author");

  /* The author's own unfinished note comes back on the same call. Both halves of the loop are one
   * question - what is between me and a signed record - and a screen that could route a note onward
   * but not start it moving would leave the commonest case with nowhere to click. */
  const mine = await as(LOCUM, `/ward/cosign-queue?orgId=${ORG}`);
  assert.equal(mine.unsubmitted, 1);
  assert.equal(mine.mine[0].noteId, n.noteId);
  assert.equal((await as(DOCTOR, `/ward/cosign-queue?orgId=${ORG}`)).unsubmitted, 0, "somebody else's draft is not mine to finish");

  const sub = await as(LOCUM, "/ward/note-submit", "POST", { orgId: ORG, noteId: n.noteId });
  assert.equal(sub.__status, 200, JSON.stringify(sub));
  assert.equal(sub.state, "awaiting");
  assert.match(sub.note, /unsigned until a clinician with a verified registration signs it/);

  // THE WORKLIST. It is the routing: a note nobody can see is a note nobody signs.
  const q = await as(DOCTOR, `/ward/cosign-queue?orgId=${ORG}`);
  assert.equal(q.__status, 200, JSON.stringify(q));
  assert.equal(q.waiting, 1);
  assert.equal(q.notes[0].noteId, n.noteId);
  assert.equal(q.notes[0].authorId, idFor(LOCUM));
  assert.equal(q.canSign, true, "the registered doctor can clear this list");
  // And the locum is told plainly that they cannot, rather than shown a worklist they cannot act on.
  assert.equal((await as(LOCUM, `/ward/cosign-queue?orgId=${ORG}`)).canSign, false);

  const signed = await as(DOCTOR, "/ward/note-sign", "POST", { orgId: ORG, noteId: n.noteId });
  assert.equal(signed.__status, 200, JSON.stringify(signed));
  assert.equal(signed.state, "cosigned");
  assert.equal(signed.coSigned, true);

  /* BOTH NAMES STAY ON THE RECORD. "Who wrote this" and "who is accountable for it" are different
   * questions, and a supervisor's signature must not quietly answer the first one. */
  const after = await RECORD.latest(TENANT_ROW.id, "ClinicalNote", n.noteId);
  assert.equal(after.authorId, idFor(LOCUM), "the locum still wrote it");
  assert.equal(after.signedBy, idFor(DOCTOR));
  assert.ok(after.signedAt);
  // The prior unsigned versions survive: the note was not rewritten, it was appended to.
  const history = await RECORD.history(TENANT_ROW.id, "ClinicalNote", n.noteId);
  assert.equal(history.length, 3, "written, submitted, signed");
  assert.deepEqual(history.map((h) => !!h.signedBy), [false, false, true]);

  assert.equal((await as(DOCTOR, `/ward/cosign-queue?orgId=${ORG}`)).waiting, 0);
});

test("a registered doctor signs their own note, and a signed note is never re-signed", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const n = await noteBy(DOCTOR, adm);

  // No submission step: the author with a registration is already the one saying it is finished.
  const signed = await as(DOCTOR, "/ward/note-sign", "POST", { orgId: ORG, noteId: n.noteId });
  assert.equal(signed.__status, 200, JSON.stringify(signed));
  assert.equal(signed.state, "signed");
  assert.equal(signed.coSigned, false, "signing your own note is not a co-signature");
  assert.equal((await as(DOCTOR, `/ward/cosign-queue?orgId=${ORG}`)).waiting, 0, "and it never entered the queue");

  const again = await as(LOCUM, "/ward/note-sign", "POST", { orgId: ORG, noteId: n.noteId });
  assert.equal(again.__status, 409);
  assert.equal(again.error, "already_signed");

  // A signed note is closed to further saves: a correction is a new note, exactly as elsewhere. The
  // same template at the same time is the same note id, so this is a rewrite attempt, not a new one.
  const rewrite = await noteBy(DOCTOR, adm, { impression: "Actually deteriorating.", plan: "Escalate." });
  assert.equal(rewrite.__status, 409);
  assert.equal(rewrite.error, "already_signed");
});

test("signing is not a nurse's act, and an unfinished note is signed as unfinished rather than refused", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  // Only a section the template asks for, leaving a required one blank.
  const partial = await noteBy(LOCUM, adm, { impression: "Reviewed." });
  assert.equal(partial.incomplete, true);
  assert.deepEqual(partial.missing.map((m) => m.key), ["plan"]);

  const nurse = await as(NURSE, "/ward/note-sign", "POST", { orgId: ORG, noteId: partial.noteId });
  assert.equal(nurse.__status, 403, "signing a clinical document needs emr.treat");

  await as(LOCUM, "/ward/note-submit", "POST", { orgId: ORG, noteId: partial.noteId });
  const q = await as(DOCTOR, `/ward/cosign-queue?orgId=${ORG}`);
  /* The gap travels WITH the note to the person being asked to put their name to it. A signature
   * does not fill in a missing plan, and the signer should know before they sign, not after. */
  assert.deepEqual(q.notes[0].incompleteSections, ["plan"]);

  const signed = await as(DOCTOR, "/ward/note-sign", "POST", { orgId: ORG, noteId: partial.noteId });
  assert.equal(signed.__status, 200, JSON.stringify(signed));
  assert.deepEqual(signed.incompleteSections, ["plan"], "and it is still recorded as incomplete after signing");
});

/* ---- FHIR R4 server core (2026-09-08): media type, meta, search, history, vread ---------------
 *
 * The audit that preceded this found the CapabilityStatement declaring application/fhir+json while
 * the route served application/json, and no search grammar, no versionId, no history. These are the
 * route-level proofs, against the real record, for what a standards-compliant client needs. */

async function asRaw(email, path, method, headers, body) {
  return onRequest({
    request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, ...(headers || {}) }, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) }),
    env: ENV,
  });
}

test("FHIR: every response is application/fhir+json, a read carries an ETag over versionId, and history and vread are real", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();

  const meta = await asRaw(DOCTOR, `/ward/fhir/metadata?orgId=${ORG}`);
  assert.match(meta.headers.get("content-type"), /^application\/fhir\+json/);
  const cs = await meta.json();
  assert.equal(cs.resourceType, "CapabilityStatement");
  assert.ok(cs.rest[0].resource.find((r) => r.type === "Observation").searchParam.some((p) => p.name === "code"));
  assert.ok(!cs.rest[0].resource.find((r) => r.type === "Observation").interaction.some((i) => i.code === "create"), "inbound is off: no write is declared");
  enableInboundFhir();
  const cs2 = await (await asRaw(DOCTOR, `/ward/fhir/metadata?orgId=${ORG}`)).json();
  assert.ok(cs2.rest[0].resource.find((r) => r.type === "Observation").interaction.some((i) => i.code === "create"), "inbound on: create is declared on the clinician's door");
  assert.deepEqual(cs2.rest[0].interaction.map((i) => i.code), ["transaction", "batch"]);

  const one = await asRaw(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}?orgId=${ORG}`);
  assert.match(one.headers.get("content-type"), /^application\/fhir\+json/);
  const enc = await one.json();
  assert.equal(enc.meta.versionId, "1");
  assert.equal(one.headers.get("etag"), 'W/"1"', "the ETag IS the record version");
  assert.ok(one.headers.get("last-modified"));
  assert.equal(enc.meta.source, "urn:stewardmd:source:wardsynq-native");

  // A transfer writes version 2; history shows both, newest first, and vread fetches either.
  const mv = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "Medical B", bed: "3" });
  assert.equal(mv.__status, 200, JSON.stringify(mv).slice(0, 200));
  const hist = await (await asRaw(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}/_history?orgId=${ORG}`)).json();
  assert.equal(hist.resourceType, "Bundle");
  assert.equal(hist.type, "history");
  assert.deepEqual(hist.entry.map((e) => e.resource.meta.versionId), ["2", "1"]);
  assert.equal(hist.entry[0].response.etag, 'W/"2"');
  const v1 = await (await asRaw(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}/_history/1?orgId=${ORG}`)).json();
  assert.equal(v1.meta.versionId, "1");
  assert.equal(v1.location[0].location.display, "Medical A, bed 12", "the OLD ward, because that is what version 1 said");
  const v9 = await asRaw(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}/_history/9?orgId=${ORG}`);
  assert.equal(v9.status, 404);
  assert.equal((await v9.json()).resourceType, "OperationOutcome");
});

test("FHIR: search filters by patient, code and date, pages with links, and refuses an unknown parameter rather than dropping it", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  // Two vitals on different days, and a creatinine via the lab, so code= and date= have something to separate.
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { pulse: "88" }, recordedAt: "2026-09-01T08:00:00.000Z" });
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { pulse: "92" }, recordedAt: "2026-09-05T08:00:00.000Z" });

  const all = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&_count=2`)).json();
  assert.equal(all.resourceType, "Bundle");
  assert.equal(all.type, "searchset");
  assert.ok(all.total >= 3, `total ${all.total}`);
  assert.equal(all.entry.filter((e) => e.search.mode === "match").length, 2, "_count bounds the page");
  const links = Object.fromEntries(all.link.map((l) => [l.relation, l.url]));
  assert.ok(links.next && /_page=1/.test(links.next), "and the next page is linked");
  assert.ok(links.self.startsWith("https://x/api/queue/ward/fhir/Observation?"));

  // Heart rate is LOINC 8867-4 in the vitals migration; a bare code finds both readings.
  const hr = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&code=8867-4`)).json();
  assert.equal(hr.entry.length, 2, JSON.stringify(hr).slice(0, 300));
  const hrLoinc = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&code=http://loinc.org|8867-4&date=ge2026-09-03`)).json();
  assert.equal(hrLoinc.entry.length, 1, "system-qualified code plus a date bound");
  assert.equal(hrLoinc.entry[0].resource.valueQuantity.value, 92);

  // Strict by default: an unsupported parameter is a 400 naming the parameter.
  const bad = await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&performer=Practitioner/x`);
  assert.equal(bad.status, 400);
  const oo = await bad.json();
  assert.equal(oo.resourceType, "OperationOutcome");
  assert.match(oo.issue[0].diagnostics, /^performer:/);
  // Lenient on request: the parameter is dropped AND reported inside the bundle.
  const len = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&performer=Practitioner/x`, "GET", { Prefer: "handling=lenient" })).json();
  assert.equal(len.resourceType, "Bundle");
  assert.ok(len.entry.some((e) => e.search.mode === "outcome" && /performer was ignored/.test(e.resource.issue[0].diagnostics)));

  // The named parameters: status and category with their implicit systems, _summary=count, _elements, _total=none.
  const fin = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&status=final&category=vital-signs`)).json();
  assert.equal(fin.resourceType, "Bundle", JSON.stringify(fin).slice(0, 300));
  assert.ok(fin.total >= 2 && fin.entry.every((e) => e.resource.category[0].coding[0].code === "vital-signs"), "only vital-signs, and the two we wrote are among them");
  assert.equal((await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&category=vital-signs&status:not=final`)).json()).total, 0);
  const cnt = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&_summary=count`)).json();
  assert.ok(cnt.total >= 3 && cnt.entry.length === 0, "count only");
  const els = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&_elements=code&_total=none`)).json();
  assert.equal(els.total, undefined);
  assert.deepEqual(Object.keys(els.entry[0].resource).sort(), ["code", "id", "meta", "resourceType"]);
  assert.ok(els.entry[0].resource.meta.tag.some((t) => t.code === "SUBSETTED"));
  // A single read honours _elements too.
  const one = await (await asRaw(DOCTOR, `/ward/fhir/Observation/${els.entry[0].resource.id}?orgId=${ORG}&_elements=status`)).json();
  assert.deepEqual(Object.keys(one).sort(), ["id", "meta", "resourceType", "status"]);

  // Chaining through the compartment: the patient's own MRN finds their observations, a stranger's finds nothing;
  // _has finds the patient from the observation; a generic _revinclude brings the observations back with the patient.
  const pat = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}?orgId=${ORG}`)).json();
  const mrn = pat.identifier.find((i) => i.system === "urn:stewardmd:mrn").value;
  const chained = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&patient.identifier=urn:stewardmd:mrn|${encodeURIComponent(mrn)}&code=8867-4`)).json();
  assert.equal(chained.total, 2, JSON.stringify(chained).slice(0, 300));
  const strangers = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&patient.identifier=urn:stewardmd:mrn|NOBODY`)).json();
  assert.equal(strangers.total, 0);
  const hasQ = await (await asRaw(DOCTOR, `/ward/fhir/Patient?orgId=${ORG}&_has:Observation:patient:code=8867-4&_revinclude=Observation:subject`)).json();
  assert.equal(hasQ.resourceType, "Bundle", JSON.stringify(hasQ).slice(0, 300));
  assert.deepEqual(hasQ.entry.filter((e) => e.search.mode === "match").map((e) => e.resource.id), [adm.patientId]);
  assert.ok(hasQ.entry.filter((e) => e.search.mode === "include").length >= 3, "their observations ride along");
  assert.equal((await (await asRaw(DOCTOR, `/ward/fhir/Patient?orgId=${ORG}&_has:Observation:patient:code=0000-0`)).json()).total, 0);
  assert.equal((await (await asRaw(DOCTOR, `/ward/fhir/Patient?orgId=${ORG}&identifier=${encodeURIComponent(mrn)}&name:missing=false`)).json()).total, 1, "identifier and name search");

  // With inbound off (the default) a write is a 404 OperationOutcome, and an unknown operation is a 404 one.
  const post = await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}`, "POST");
  assert.equal(post.status, 404);
  assert.equal((await post.json()).resourceType, "OperationOutcome");
  const del = await asRaw(DOCTOR, `/ward/fhir/Observation/x?orgId=${ORG}`, "DELETE");
  assert.equal(del.status, 405, "a method the server never supports is a 405 with Allow");
  assert.ok(/GET/.test(del.headers.get("allow")));
  const op = await asRaw(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}/$bogus?orgId=${ORG}`);
  assert.equal(op.status, 404);
  assert.equal((await op.json()).resourceType, "OperationOutcome");
});

test("FHIR $validate: our own export validates; a partner's resource is judged against R4 base at every path; codes go through the terminology service; it needs no inbound door", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  // GET {Type}/{id}/$validate checks the stored resource's export. Inbound is OFF and that is irrelevant: validation writes nothing.
  const mine = await asRaw(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}/$validate?orgId=${ORG}`);
  const mineText = await mine.text();
  assert.equal(mine.status, 200, mineText);
  const oo = JSON.parse(mineText);
  assert.equal(oo.resourceType, "OperationOutcome");
  assert.equal(oo.issue[0].diagnostics, "All OK");

  // POST {Type}/$validate with a body: conformant is 200, and a LOINC code from the seed is verified silently.
  const good = await asRaw(DOCTOR, `/ward/fhir/Observation/$validate?orgId=${ORG}`, "POST", { "Content-Type": "application/fhir+json" }, { resourceType: "Observation", status: "final", code: { coding: [{ system: "http://loinc.org", code: "2160-0" }] }, subject: { reference: `Patient/${adm.patientId}` }, valueQuantity: { value: 88, unit: "umol/L" } });
  const goodText = await good.text();
  assert.equal(good.status, 200, goodText);
  assert.ok(!/not verified/.test(goodText), "a seed-verified LOINC code raises nothing");
  // Non-conformant is 422 with every issue at its path.
  const bad = await asRaw(DOCTOR, `/ward/fhir/Observation/$validate?orgId=${ORG}`, "POST", { "Content-Type": "application/fhir+json" }, { resourceType: "Observation", status: "done", code: { text: "x" }, valueQuantiy: { value: 1 } });
  assert.equal(bad.status, 422);
  const issues = (await bad.json()).issue;
  assert.ok(issues.some((i) => i.code === "code-invalid" && i.expression[0] === "Observation.status"));
  assert.ok(issues.some((i) => i.code === "structure" && i.expression[0] === "Observation.valueQuantiy"));
  // A body of the wrong type for the URL is refused, and a Bundle validates every entry.
  const wrong = await asRaw(DOCTOR, `/ward/fhir/Condition/$validate?orgId=${ORG}`, "POST", { "Content-Type": "application/fhir+json" }, { resourceType: "Observation", status: "final", code: { text: "x" } });
  assert.equal(wrong.status, 400);
  const bundle = await asRaw(DOCTOR, `/ward/fhir/$validate?orgId=${ORG}`, "POST", { "Content-Type": "application/fhir+json" }, { resourceType: "Bundle", type: "collection", entry: [{ resource: { resourceType: "Patient", id: "p", gender: "F" } }] });
  assert.equal(bundle.status, 422);
  assert.ok((await bundle.json()).issue.some((i) => i.expression[0] === "Bundle.entry[0].resource.gender"));
  // A SNOMED code nobody here verified is an information issue, not an error: "cannot vouch" is not "wrong".
  const sct = await asRaw(DOCTOR, `/ward/fhir/Condition/$validate?orgId=${ORG}`, "POST", { "Content-Type": "application/fhir+json" }, { resourceType: "Condition", subject: { reference: `Patient/${adm.patientId}` }, code: { coding: [{ system: "http://snomed.info/sct", code: "44054006" }] } });
  assert.equal(sct.status, 200);
  assert.ok((await sct.json()).issue.some((i) => i.severity === "information" && /not verified/.test(i.diagnostics)));
  // The whole stay validates, resource by resource.
  const ev = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}/$everything?orgId=${ORG}`)).json();
  for (const e of ev.entry) {
    const r = await asRaw(DOCTOR, `/ward/fhir/${e.resource.resourceType}/$validate?orgId=${ORG}`, "POST", { "Content-Type": "application/fhir+json" }, e.resource);
    const t = await r.text();
    assert.equal(r.status, 200, `${e.resource.resourceType}/${e.resource.id}: ${t}`);
    assert.ok(e.resource.id.length <= 64 && /^[A-Za-z0-9.-]+$/.test(e.resource.id), "every id fits R4");
    assert.ok(e.resource.identifier.some((i) => i.system === "urn:stewardmd:record-id"), "and the canonical id travels as an identifier");
  }
});

test("FHIR terminology: $validate-code answers from the seed, the hospital's own lists and its terminology server; an invalid code on a feed is filed verbatim and marked, never dropped or promoted", async () => {
  seedHospital(); enableInboundFhir();
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...org.fields.wardsynq, terminology: { codeSystems: { "http://loinc.org": { "4548-4": "HbA1c" } }, server: { url: "https://tx.example/fhir", systems: ["snomed"] } } };
  docs.set(`q_orgs/${ORG}`, org);
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url); asked.push(u.href);
    const key = `${u.searchParams.get("url")}|${u.searchParams.get("code")}`;
    const known = { "http://snomed.info/sct|22298006": true, "http://snomed.info/sct|999999": false };
    if (!(key in known)) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify({ resourceType: "Parameters", parameter: [{ name: "result", valueBoolean: known[key] }, { name: "message", valueString: known[key] ? "ok" : "Unknown code" }] }), { status: 200 });
  };
  try {
    const q = (url, code) => asRaw(DOCTOR, `/ward/fhir/CodeSystem/$validate-code?orgId=${ORG}&url=${encodeURIComponent(url)}&code=${code}`);
    const seed = await (await q("http://loinc.org", "2160-0")).json();
    assert.equal(seed.resourceType, "Parameters");
    assert.equal(seed.parameter.find((p) => p.name === "result").valueBoolean, true);
    assert.match(seed.parameter.find((p) => p.name === "message").valueString, /seed/);
    assert.match((await (await q("http://loinc.org", "4548-4")).json()).parameter.find((p) => p.name === "message").valueString, /org/, "the hospital's own list");
    assert.match((await (await q("http://snomed.info/sct", "22298006")).json()).parameter.find((p) => p.name === "message").valueString, /server/);
    const bad = await (await q("http://snomed.info/sct", "999999")).json();
    assert.equal(bad.parameter.find((p) => p.name === "result").valueBoolean, false);
    assert.equal(bad.parameter.find((p) => p.name === "x-wardsynq-status").valueCode, "invalid");
    assert.equal((await (await q("http://www.whocc.no/atc", "A10BA02")).json()).parameter.find((p) => p.name === "x-wardsynq-status").valueCode, "recognised", "a system the server is not configured for is not asked");
    assert.equal((await (await q("http://his.example/codes", "X")).json()).parameter.find((p) => p.name === "x-wardsynq-status").valueCode, "unmapped");
    assert.equal((await q("", "x")).status, 400);
    assert.ok(asked.every((u) => u.startsWith("https://tx.example/fhir/CodeSystem/$validate-code?")), "asked through the configured server only");

    // A feed carrying the invalid SNOMED code: filed, marked invalid, exported under the sender's system with the extension.
    const b = partnerBundle({ patientId: "HIS-PAT-TX", mrn: "HIS-MRN-TX", suffix: "-tx" });
    b.entry.push({ resource: { resourceType: "Condition", id: "HIS-DX-BAD-tx", code: { coding: [{ system: "http://snomed.info/sct", code: "999999", display: "Nonsense" }] }, subject: { reference: "Patient/HIS-PAT-TX" }, clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] } } });
    b.entry.push({ resource: { resourceType: "Condition", id: "HIS-DX-MI-tx", code: { coding: [{ system: "http://snomed.info/sct", code: "22298006", display: "MI" }] }, subject: { reference: "Patient/HIS-PAT-TX" }, clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] } } });
    const res = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, b);
    assert.equal(res.status, 200, await res.text());
    const badRec = await RECORD.latest(TENANT_ROW.id, "Condition", "fhir-partner-his-cond-his-dx-bad-tx");
    assert.ok(badRec, "filed");
    assert.equal(badRec.terminologyStatus, "invalid");
    assert.equal(badRec.code, "999999");
    assert.equal(badRec.sourceCoding.system, "http://snomed.info/sct");
    const miRec = await RECORD.latest(TENANT_ROW.id, "Condition", "fhir-partner-his-cond-his-dx-mi-tx");
    assert.equal(miRec.terminologyStatus, "verified");
    assert.equal(miRec.terminologySource, "server");
    const out = await (await asRaw(DOCTOR, `/ward/fhir/Condition/fhir-partner-his-cond-his-dx-bad-tx?orgId=${ORG}`)).json();
    assert.equal(out.code.coding[0].code, "999999");
    assert.equal(out.code.coding[0].extension[0].valueCode, "invalid");
    assert.equal((await (await asRaw(DOCTOR, `/ward/fhir/Condition/fhir-partner-his-cond-his-dx-mi-tx?orgId=${ORG}`)).json()).code.coding[0].extension, undefined, "a verified code carries no caveat");
  } finally { globalThis.fetch = realFetch; }
});

test("FHIR inbound: a dose given elsewhere, an order placed elsewhere and a consent taken elsewhere are filed through SCCM 1.1, exported conformantly, and never bill, never reach the collection worklist, never match a result here", async () => {
  seedHospital(); enableInboundFhir();
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...org.fields.wardsynq, tariff: { currency: "INR", items: { 6809: { price: 10, display: "Metformin dose" }, "Chest X-ray": { price: 500 } } } };
  docs.set(`q_orgs/${ORG}`, org);
  const b = partnerBundle({ patientId: "HIS-PAT-31", mrn: "HIS-MRN-31", suffix: "-31" });
  b.entry.push(
    { resource: { resourceType: "MedicationAdministration", id: "HIS-MA-1", status: "completed", medicationCodeableConcept: { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "6809", display: "Metformin" }] }, subject: { reference: "Patient/HIS-PAT-31" }, effectiveDateTime: "2026-08-02T08:00:00Z", performer: [{ actor: { display: "Nurse Elsewhere" } }], request: { reference: "MedicationRequest/HIS-RX-1-31" }, dosage: { text: "500 mg oral", dose: { value: 500, unit: "mg" } } } },
    { resource: { resourceType: "ServiceRequest", id: "HIS-SR-1", status: "active", intent: "order", code: { text: "Chest X-ray" }, category: [{ text: "Imaging" }], priority: "routine", subject: { reference: "Patient/HIS-PAT-31" }, authoredOn: "2026-08-01T09:00:00Z", requester: { display: "Dr Elsewhere" } } },
    { resource: { resourceType: "DiagnosticReport", id: "HIS-REP-XR", status: "final", code: { text: "Chest X-ray report" }, subject: { reference: "Patient/HIS-PAT-31" }, basedOn: [{ reference: "ServiceRequest/HIS-SR-1" }], effectiveDateTime: "2026-08-01T12:00:00Z", conclusion: "Clear." } },
    { resource: { resourceType: "Consent", id: "HIS-CON-1", status: "active", scope: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentscope", code: "treatment" }] }, category: [{ text: "General consent" }], patient: { reference: "Patient/HIS-PAT-31" }, dateTime: "2026-08-01T08:00:00Z", performer: [{ display: "The patient" }], provision: { type: "permit" } } },
    { resource: { resourceType: "Consent", id: "HIS-CON-2", status: "proposed", scope: { text: "research" }, category: [{ text: "Research" }], patient: { reference: "Patient/HIS-PAT-31" } } },
  );
  const res = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, b);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const out = JSON.parse(text);
  assert.ok(out.meta.tag.some((t) => /HIS-CON-2/.test(t.display || t.code) || /HIS-CON-2/.test(JSON.stringify(t))), "the undecided consent is named, not filed: " + JSON.stringify(out.meta.tag).slice(0, 300));

  const pid = "fhir-partner-his-pat-his-pat-31";
  const mar = await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", "fhir-partner-his-mar-his-ma-1");
  assert.ok(mar, "the dose is on the chart: " + JSON.stringify(out.entry.map((e) => e.response).filter((r) => !/^20/.test(r.status))).slice(0, 900));
  assert.equal(mar.status, "administered");
  assert.equal(mar.orderId, "fhir-partner-his-rx-his-rx-1-31", "against the feed's own order");
  assert.equal(mar.administeredBy, "external:fhir-partner-his:Nurse Elsewhere");
  assert.equal(mar.meta.source.system, "fhir-partner-his");
  assert.equal(mar.writtenBy.id, "adapter:fhir-partner-his");
  const sr = await RECORD.latest(TENANT_ROW.id, "ServiceRequest", "fhir-partner-his-sr-his-sr-1");
  assert.equal(sr.status, "draft"); assert.equal(sr.category, "imaging"); assert.equal(sr.requesterId, "external:fhir-partner-his");
  const rep = await RECORD.latest(TENANT_ROW.id, "DiagnosticReport", "fhir-partner-his-dr-his-rep-xr");
  assert.equal(rep.serviceRequestId, sr.id);
  const con = await RECORD.latest(TENANT_ROW.id, "PatientConsent", "fhir-partner-his-consent-his-con-1");
  assert.ok(con, "the consent is on the chart");
  assert.equal(con.scope, "treatment"); assert.equal(con.decision, "granted"); assert.equal(con.capacity, null, "capacity is never asserted for a consent taken elsewhere");
  assert.equal(con.recordedBy, "external:fhir-partner-his"); assert.equal(con.meta.source.system, "fhir-partner-his");
  assert.equal(await RECORD.latest(TENANT_ROW.id, "PatientConsent", "fhir-partner-his-consent-his-con-2"), null);

  // Exported, each is a conformant resource pointing at the right things.
  const ev = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${pid}/$everything?orgId=${ORG}`)).json();
  const types = ev.entry.map((e) => e.resource.resourceType);
  assert.ok(types.includes("MedicationAdministration") && types.includes("ServiceRequest") && types.includes("Consent"));
  for (const e of ev.entry) {
    const r = await asRaw(DOCTOR, `/ward/fhir/${e.resource.resourceType}/$validate?orgId=${ORG}`, "POST", { "Content-Type": "application/fhir+json" }, e.resource);
    const t = await r.text();
    assert.equal(r.status, 200, `${e.resource.resourceType}/${e.resource.id}: ${t}`);
  }
  const fm = ev.entry.find((e) => e.resource.resourceType === "MedicationAdministration").resource;
  assert.equal(fm.status, "completed");
  assert.equal(fm.meta.source, "urn:stewardmd:source:fhir-partner-his");
  assert.match(fm.request.reference, /^MedicationRequest\//);
  const fc = ev.entry.find((e) => e.resource.resourceType === "Consent").resource;
  assert.equal(fc.status, "active"); assert.equal(fc.provision.type, "permit");

  // THE GUARDS. Charges: the dose is seen and named as external, never priced. The collection worklist and the
  // pending-results list do not carry the foreign order. A result released here cannot be matched to it.
  const CASHIER = "cash@wsq.test";
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(CASHIER))}`, { fields: { orgId: ORG, identity: idFor(CASHIER), role: "cashier", active: true }, updateTime: "t1" });
  const charges = await as(CASHIER, `/ward/charges?orgId=${ORG}&patientId=${pid}`);
  assert.equal(charges.__status, 200, JSON.stringify(charges).slice(0, 200));
  assert.ok(!charges.items.some((i) => i.sourceId === mar.id), "not an item");
  assert.ok(charges.notCharged.some((s) => s.sourceId === mar.id && s.reason === "external_source" && s.system === "fhir-partner-his"), JSON.stringify(charges.notCharged));
  assert.ok(!charges.items.some((i) => i.sourceId === rep.id), "nor the foreign report");
  const coll = await as(NURSE, `/ward/collections?orgId=${ORG}&patientId=${pid}`);
  assert.equal(coll.__status, 200, JSON.stringify(coll).slice(0, 200));
  assert.ok(!(coll.requests || []).some((r) => r.serviceRequestId === sr.id), "not on this ward's worklist");
  const consents = await as(NURSE, `/ward/consents?orgId=${ORG}&patientId=${pid}`);
  assert.equal(consents.__status, 200);
  const shown = consents.consents.find((c) => c.consentId === con.id);
  assert.ok(shown && shown.recordedBy === "external:fhir-partner-his" && shown.status === "granted", JSON.stringify(consents.consents));
});

test("FHIR inbound: a TRANSACTION is all or nothing, a BATCH is entry by entry, If-None-Exist creates once, and a delete is never done as the nearest thing", async () => {
  seedHospital(); enableInboundFhir();
  const asTx = (b, type = "transaction") => ({ ...b, type, entry: b.entry.map((e) => ({ resource: e.resource, request: { method: "POST", url: e.resource.resourceType } })) });
  // Patient A lands. Then patient B's message reuses one of A's observation ids: a clinical fact moving between
  // people, held as a patient-mismatch conflict. As a transaction that refuses the WHOLE message.
  const a = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, asTx(partnerBundle({ patientId: "HIS-PAT-A", mrn: "HIS-MRN-A", suffix: "-a" })));
  assert.equal(a.status, 200, await a.text());
  const bBundle = partnerBundle({ patientId: "HIS-PAT-B", mrn: "HIS-MRN-B", name: "Other Person", dob: "1990-01-01", abha: "91-9999-9999-9999", suffix: "-b" });
  bBundle.entry.find((e) => e.resource.resourceType === "Observation").resource.id = "HIS-OBS-1-a"; // A's id
  const tx = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, asTx(bBundle));
  const txText = await tx.text();
  assert.equal(tx.status, 409, txText);
  const oo = JSON.parse(txText);
  assert.equal(oo.resourceType, "OperationOutcome");
  assert.match(oo.issue[0].diagnostics, /refused whole.*nothing was written/);
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Patient", "fhir-partner-his-pat-his-pat-b"), null, "B's patient did not land");
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Condition", "fhir-partner-his-cond-his-dx-1-b"), null, "nor B's condition");
  assert.ok((await RECORD.latest(TENANT_ROW.id, "Observation", "fhir-partner-his-obs-his-obs-1-a")).patientId.endsWith("his-pat-a"), "A's observation is untouched");
  assert.ok((await as(DOCTOR, `/ward/fhir-exceptions?orgId=${ORG}`)).open.some((x) => x.reason === "conflict-patient-mismatch"), "and a person is still asked to look");

  // The same message as a BATCH: everything else lands, the one entry is a 409 in a batch-response.
  const batch = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, asTx({ ...bBundle, id: "his-bundle-b-batch" }, "batch"));
  const batchText = await batch.text();
  assert.equal(batch.status, 200, batchText);
  const bb = JSON.parse(batchText);
  assert.equal(bb.type, "batch-response");
  assert.ok(bb.entry.some((e) => /^409/.test(e.response.status)));
  assert.ok(await RECORD.latest(TENANT_ROW.id, "Condition", "fhir-partner-his-cond-his-dx-1-b"), "B's condition landed this time");

  // A transaction whose entries carry no request is not a transaction (bdl-3), refused by the validator.
  const noReq = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, { ...partnerBundle({ patientId: "HIS-PAT-C", mrn: "HIS-MRN-C", suffix: "-c" }), type: "transaction" });
  assert.equal(noReq.status, 422);
  assert.ok((await noReq.json()).issue.some((i) => /bdl-3/.test(i.diagnostics)));
  // A delete is named and refused, never done as the nearest thing.
  const del = asTx(partnerBundle({ patientId: "HIS-PAT-D", mrn: "HIS-MRN-D", suffix: "-d" }));
  del.entry[1].request.method = "DELETE";
  const delRes = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, del);
  const delText = await delRes.text();
  assert.equal(delRes.status, 400, delText);
  assert.match(JSON.parse(delText).issue[0].diagnostics, /DELETE is not supported/);

  // If-None-Exist on a single POST: the first creates, the second finds the first and creates nothing; a condition
  // that matches two is a 412; and a lie in the condition is a 400, not a create.
  const pidA = "fhir-partner-his-pat-his-pat-a";
  const obs = (id, day) => ({ resourceType: "Observation", id, status: "final", category: [{ coding: [{ code: "laboratory" }] }], code: { coding: [{ system: "http://loinc.org", code: "2823-3", display: "Potassium" }] }, subject: { reference: `Patient/${pidA}` }, effectiveDateTime: `2026-08-0${day}T06:00:00Z`, valueQuantity: { value: 4.1, unit: "mmol/L" } });
  const cond = { "If-None-Exist": "code=http://loinc.org|2823-3&date=2026-08-05" };
  const first = await pushFhir(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}`, obs("K-1", 5), cond);
  assert.equal(first.status, 201, await first.text());
  const second = await pushFhir(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}`, obs("K-2", 5), cond);
  const secondText = await second.text();
  assert.equal(second.status, 200, secondText);
  const sb = JSON.parse(secondText);
  assert.match(sb.entry[0].response.location, /Observation\/fhir-partner-his-obs-k-1\/_history\/1$/, "the existing one is the answer");
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Observation", "fhir-partner-his-obs-k-2"), null, "and nothing was created");
  const third = await pushFhir(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}`, obs("K-3", 6));
  assert.equal(third.status, 201);
  const ambiguous = await pushFhir(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}`, obs("K-4", 5), { "If-None-Exist": "code=http://loinc.org|2823-3" });
  assert.equal(ambiguous.status, 412, await ambiguous.text());
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Observation", "fhir-partner-his-obs-k-4"), null);
  const bad = await pushFhir(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}`, obs("K-5", 5), { "If-None-Exist": "performer=x" });
  assert.equal(bad.status, 400);
  // Prefer: return=minimal keeps the resources out of the response.
  const minimal = await pushFhir(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}`, obs("K-6", 7), { Prefer: "return=minimal" });
  assert.equal(minimal.status, 201);
  assert.ok((await minimal.json()).entry.every((e) => !e.resource));
});

test("FHIR ids: a canonical id longer than R4 allows is exported hashed, read back by that hash, searchable by its canonical id, and referenced consistently", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const sr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Renal profile", category: "laboratory" });
  const rep = await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr.orderId, status: "final", reportedAt: "2026-09-07T10:00:00.000Z", tests: [{ test: "Creatinine", value: 88, unit: "umol/L" }] });
  assert.equal(rep.__status, 200, JSON.stringify(rep).slice(0, 200));
  const reports = await (await asRaw(DOCTOR, `/ward/fhir/DiagnosticReport?orgId=${ORG}&patient=${adm.patientId}`)).json();
  const dr = reports.entry[0].resource;
  assert.match(dr.id, /^wsq-[0-9a-f]{48}$/, "the report's canonical id is fourth-generation and too long, so it is hashed");
  const canonical = dr.identifier.find((i) => i.system === "urn:stewardmd:record-id").value;
  assert.ok(canonical.length > 64);
  // Read by the hash, history by the hash, Provenance of it, and the observation it references by the same rule.
  const byHash = await asRaw(DOCTOR, `/ward/fhir/DiagnosticReport/${dr.id}?orgId=${ORG}`);
  assert.equal(byHash.status, 200);
  assert.equal((await byHash.json()).id, dr.id);
  assert.equal((await asRaw(DOCTOR, `/ward/fhir/DiagnosticReport/${dr.id}/_history/1?orgId=${ORG}`)).status, 200);
  const prov = await (await asRaw(DOCTOR, `/ward/fhir/Provenance?orgId=${ORG}&target=DiagnosticReport/${dr.id}`)).json();
  assert.equal(prov.total, 1, JSON.stringify(prov).slice(0, 300));
  assert.ok(prov.entry[0].resource.id.length <= 64);
  assert.equal((await asRaw(DOCTOR, `/ward/fhir/Provenance/${prov.entry[0].resource.id}?orgId=${ORG}`)).status, 200);
  const obsRef = dr.result[0].reference;
  assert.match(obsRef, /^Observation\/wsq-[0-9a-f]{48}$/);
  const inc = await (await asRaw(DOCTOR, `/ward/fhir/DiagnosticReport?orgId=${ORG}&patient=${adm.patientId}&_include=DiagnosticReport:result`)).json();
  assert.ok(inc.entry.some((e) => e.search.mode === "include" && `Observation/${e.resource.id}` === obsRef), "the include resolves the hashed reference");
  // And the canonical id finds it through the identifier search.
  const found = await (await asRaw(DOCTOR, `/ward/fhir/DiagnosticReport?orgId=${ORG}&patient=${adm.patientId}&identifier=urn:stewardmd:record-id|${encodeURIComponent(canonical)}`)).json();
  assert.equal(found.total, 1);
});

test("FHIR: _include pulls the report's observations through the governed read, and $everything is the standard spelling", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const sr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Renal profile", category: "laboratory" });
  assert.equal(sr.__status, 200, JSON.stringify(sr).slice(0, 200));
  const rep = await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr.orderId, status: "final", reportedAt: "2026-09-07T10:00:00.000Z", tests: [{ test: "Creatinine", value: 88, unit: "umol/L" }] });
  assert.equal(rep.__status, 200, JSON.stringify(rep).slice(0, 300));

  const b = await (await asRaw(DOCTOR, `/ward/fhir/DiagnosticReport?orgId=${ORG}&patient=${adm.patientId}&_include=DiagnosticReport:result`)).json();
  assert.equal(b.resourceType, "Bundle", JSON.stringify(b).slice(0, 300));
  const match = b.entry.filter((e) => e.search.mode === "match");
  const inc = b.entry.filter((e) => e.search.mode === "include");
  assert.equal(match.length, 1);
  assert.equal(match[0].resource.resourceType, "DiagnosticReport");
  assert.ok(inc.length >= 1 && inc.every((e) => e.resource.resourceType === "Observation"), "the observations ride along");
  assert.equal(inc[0].resource.code.coding[0].code, "2160-0", "and they are the real LOINC-coded creatinine");

  const ev = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}/$everything?orgId=${ORG}`)).json();
  assert.equal(ev.resourceType, "Bundle");
  assert.equal(ev.type, "searchset");
  assert.equal(ev.entry[0].resource.resourceType, "Patient", "the patient leads");
  assert.ok(ev.entry.some((e) => e.resource.resourceType === "DiagnosticReport"));
  assert.ok(ev.link.some((l) => l.relation === "self" && /\$everything/.test(l.url)));

  // $everything pages, narrows by _type, and _since keeps only what changed at or after that instant.
  const paged = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}/$everything?orgId=${ORG}&_count=2`)).json();
  assert.equal(paged.entry.length, 2);
  assert.ok(paged.link.some((l) => l.relation === "next" && /_page=1/.test(l.url)));
  const typed = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}/$everything?orgId=${ORG}&_type=DiagnosticReport`)).json();
  assert.deepEqual([...new Set(typed.entry.map((e) => e.resource.resourceType))], ["DiagnosticReport"]);
  const future = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}/$everything?orgId=${ORG}&_since=2999-01-01`)).json();
  assert.equal(future.total, 0, "nothing has changed since the far future");
  const recent = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}/$everything?orgId=${ORG}&_since=2000-01-01`)).json();
  assert.equal(recent.total, ev.total);
  const badOp = await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}/$everything?orgId=${ORG}&start=2020-01-01`);
  assert.equal(badOp.status, 400, "start/end are not offered; the parameter is named, not dropped");
  const noOne = await asRaw(DOCTOR, `/ward/fhir/Patient/nobody/$everything?orgId=${ORG}`);
  assert.equal(noOne.status, 404, "no such patient is a 404, not an empty bundle");
});

test("FHIR: Provenance by target shows every version with its real author, Consent exports honestly, and _revinclude rides along", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnDrug();
  const mv = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "Medical B", bed: "3" });
  assert.equal(mv.__status, 200, JSON.stringify(mv).slice(0, 200));

  const prov = await (await asRaw(DOCTOR, `/ward/fhir/Provenance?orgId=${ORG}&target=Encounter/${adm.encounterId}`)).json();
  assert.equal(prov.resourceType, "Bundle", JSON.stringify(prov).slice(0, 300));
  assert.equal(prov.total, 2, "one Provenance per version");
  assert.deepEqual(prov.entry.map((e) => e.resource.activity.coding[0].code), ["UPDATE", "CREATE"], "newest first");
  // Derived from the stamp: the doctor who really wrote it, as an author, not as a display name typed in.
  assert.ok(prov.entry.every((e) => e.resource.agent[0].who.display === idFor(DOCTOR)), JSON.stringify(prov.entry[0].resource.agent));
  assert.ok(prov.entry.every((e) => e.resource.agent[0].type.coding[0].code === "author"));
  assert.equal(prov.entry[1].resource.target[0].reference, `Encounter/${adm.encounterId}/_history/1`);

  const one = await asRaw(DOCTOR, `/ward/fhir/Provenance/en-${adm.encounterId}-v1?orgId=${ORG}`);
  assert.equal(one.status, 200);
  assert.equal((await one.json()).resourceType, "Provenance");
  // A hospital-wide provenance dump is not offered: target is required.
  const bare = await asRaw(DOCTOR, `/ward/fhir/Provenance?orgId=${ORG}`);
  assert.equal(bare.status, 400);
  assert.equal((await bare.json()).resourceType, "OperationOutcome");

  const rev = await (await asRaw(DOCTOR, `/ward/fhir/Encounter?orgId=${ORG}&patient=${adm.patientId}&_revinclude=Provenance:target`)).json();
  const inc = rev.entry.filter((e) => e.search.mode === "include");
  assert.equal(inc.length, 1);
  assert.equal(inc[0].resource.resourceType, "Provenance");
  assert.equal(inc[0].resource.id, `en-${adm.encounterId}-v2`, "the CURRENT version's provenance");

  // A refusal of external sharing exports as a rejected Consent with a deny provision.
  const c = await as(NURSE, "/ward/consent", "POST", { orgId: ORG, patientId: adm.patientId, scope: "share-external", decision: "refused" });
  assert.equal(c.__status, 200, JSON.stringify(c).slice(0, 200));
  const cs = await (await asRaw(DOCTOR, `/ward/fhir/Consent?orgId=${ORG}&patient=${adm.patientId}`)).json();
  assert.equal(cs.resourceType, "Bundle", JSON.stringify(cs).slice(0, 300));
  assert.equal(cs.total, 1);
  assert.equal(cs.entry[0].resource.status, "rejected");
  assert.equal(cs.entry[0].resource.provision.type, "deny");
  assert.equal(cs.entry[0].resource.patient.reference, `Patient/${adm.patientId}`);
});

/* ---- FHIR inbound (2026-09-08): another system's bundle into this record --------------------- */

function enableInboundFhir() {
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...(org.fields.wardsynq || {}), fhir: { inbound: { enabled: true } } };
  docs.set(`q_orgs/${ORG}`, org);
}

/* A realistic bundle from a partner HIS: an MRN the sender assigned, an ABHA, ICD-10 and LOINC
 * codings alongside one local code, an order, an allergy, a report over its observation, a note. */
function partnerBundle(over = {}) {
  const pid = over.patientId || "HIS-PAT-77", mrn = over.mrn || "HIS-MRN-0077", s = over.suffix || "";
  return {
    resourceType: "Bundle", type: "collection", id: over.bundleId || "his-bundle-0001",
    entry: [
      { resource: { resourceType: "Patient", id: pid, identifier: [{ type: { coding: [{ code: "MR" }] }, system: "urn:his:mrn", value: mrn }, { system: "https://healthid.ndhm.gov.in", value: over.abha || "91-1234-5678-9012" }],
        name: [{ text: over.name || "Partner Testcase" }], gender: "female", birthDate: over.dob || "1975-03-09" } },
      { resource: { resourceType: "Encounter", id: `HIS-ENC-1${s}`, status: "finished", class: { code: "IMP" }, subject: { reference: `Patient/${pid}` }, period: { start: "2026-08-01T08:00:00Z", end: "2026-08-04T10:00:00Z" } } },
      { resource: { resourceType: "Condition", id: `HIS-DX-1${s}`, code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "E11.9", display: "Type 2 diabetes" }] }, subject: { reference: `Patient/${pid}` }, clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] } } },
      { resource: { resourceType: "Observation", id: `HIS-OBS-1${s}`, status: "final", category: [{ coding: [{ code: "laboratory" }] }], code: { coding: [{ system: "http://loinc.org", code: "2160-0", display: "Creatinine" }] }, subject: { reference: `Patient/${pid}` }, effectiveDateTime: "2026-08-02T06:00:00Z", valueQuantity: { value: 96, unit: "umol/L" } } },
      { resource: { resourceType: "Observation", id: `HIS-OBS-2${s}`, status: "final", category: [{ coding: [{ code: "laboratory" }] }], code: { coding: [{ system: "http://his.example/local-codes", code: "HBA1C-X", display: "HbA1c (local)" }] }, subject: { reference: `Patient/${pid}` }, effectiveDateTime: "2026-08-02T06:00:00Z", valueQuantity: { value: 7.9, unit: "%" } } },
      { resource: { resourceType: "MedicationRequest", id: `HIS-RX-1${s}`, status: "active", intent: "order", medicationCodeableConcept: { coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "6809", display: "Metformin" }], text: "Metformin 500 mg" }, subject: { reference: `Patient/${pid}` }, dosageInstruction: [{ text: "500 mg twice daily" }] } },
      { resource: { resourceType: "AllergyIntolerance", id: `HIS-ALG-1${s}`, code: { text: "Penicillin" }, patient: { reference: `Patient/${pid}` }, criticality: "high", reaction: [{ manifestation: [{ text: "Anaphylaxis" }], severity: "severe" }] } },
      { resource: { resourceType: "DiagnosticReport", id: `HIS-REP-1${s}`, status: "final", code: { text: "Renal profile" }, subject: { reference: `Patient/${pid}` }, effectiveDateTime: "2026-08-02T06:00:00Z", result: [{ reference: `Observation/HIS-OBS-1${s}` }], conclusion: "Within limits." } },
      { resource: { resourceType: "DocumentReference", id: `HIS-DOC-1${s}`, status: "current", type: { text: "Discharge summary" }, subject: { reference: `Patient/${pid}` }, date: "2026-08-04T10:00:00Z", description: "Admitted with hyperglycaemia; discharged on metformin.", content: [{ attachment: { contentType: "text/plain", title: "Discharge summary" } }] } },
    ],
  };
}

async function pushFhir(email, path, body, headers) {
  return onRequest({ request: new Request("https://x/api/queue" + path, { method: headers && headers.method || "POST", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/fhir+json", "X-Source-System": "partner-his", ...(headers || {}) }, body: JSON.stringify(body) }), env: ENV });
}

test("FHIR inbound: OFF by default, and a write needs emr.treat even when on", async () => {
  seedHospital();
  await admittedPatientOnDrug();
  const off = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, partnerBundle());
  assert.equal(off.status, 404);
  assert.equal((await off.json()).resourceType, "OperationOutcome");
  enableInboundFhir();
  const nurse = await pushFhir(NURSE, `/ward/fhir?orgId=${ORG}`, partnerBundle());
  assert.equal(nurse.status, 403, "a nurse may read the FHIR export but may not push a bundle into the chart");
  const unnamed = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, partnerBundle(), { "X-Source-System": "" });
  assert.equal(unnamed.status, 400, "a feed must name itself");
  assert.match((await unnamed.json()).issue[0].diagnostics, /name the sending system/);
});

test("FHIR inbound: a partner bundle lands through the canonical pipeline with source, provenance and terminology preserved; a replay lands nothing", async () => {
  seedHospital(); enableInboundFhir();
  await admittedPatientOnDrug();
  const res = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, partnerBundle());
  const resText = await res.text();
  assert.equal(res.status, 200, resText);
  assert.match(res.headers.get("content-type"), /^application\/fhir\+json/);
  const b = JSON.parse(resText);
  assert.equal(b.type, "transaction-response");
  const statuses = b.entry.map((e) => e.response.status);
  assert.equal(statuses.filter((s) => s.startsWith("201")).length, 9, JSON.stringify(statuses));
  const pat = b.entry.find((e) => e.resource && e.resource.resourceType === "Patient").resource;
  assert.equal(pat.id, "fhir-partner-his-pat-his-pat-77", "the sender is in the id, so it can never be mistaken for ours");
  assert.equal(pat.meta.source, "urn:stewardmd:source:fhir-partner-his");
  assert.equal(pat.meta.versionId, "1");
  const byType = (code) => pat.identifier.find((i) => i.type && i.type.coding && i.type.coding[0].code === code);
  assert.equal(byType("NI").value, "91-1234-5678-9012", "the ABHA travels, recognised by its NDHM system");
  assert.equal(byType("MR").value, "HIS-MRN-0077", "the sender's MRN keeps its declared type under a system nobody here knows");
  assert.equal(byType("MR").system, "urn:his:mrn");

  // Read it back through the ordinary FHIR door: it is one record, not a second model.
  const cre = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${pat.id}&code=2160-0`)).json();
  assert.equal(cre.total, 1);
  assert.equal(cre.entry[0].resource.valueQuantity.value, 96);
  assert.equal(cre.entry[0].resource.code.coding[0].system, "http://loinc.org", "LOINC stays LOINC");

  // The local code is kept VERBATIM under the sender's system, marked unmapped, and findable only by text.
  const loc = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${pat.id}&code:text=hba1c`)).json();
  assert.equal(loc.total, 1, JSON.stringify(loc).slice(0, 300));
  const lc = loc.entry[0].resource.code.coding[0];
  assert.equal(lc.system, "http://his.example/local-codes");
  assert.equal(lc.code, "HBA1C-X");
  assert.equal(lc.extension[0].valueCode, "unmapped");
  /* A bare code matches any system, so the sender's code IS findable - it is genuinely in the
   * resource, marked unmapped - but qualifying it with a system we vouch for finds nothing. */
  assert.equal((await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${pat.id}&code=HBA1C-X`)).json()).total, 1);
  assert.equal((await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${pat.id}&code=http://loinc.org|HBA1C-X`)).json()).total, 0, "never under LOINC, because it is not LOINC");

  // Provenance: the feed assembled it, ON BEHALF OF the doctor who pushed it, from a named source entity.
  const prov = await (await asRaw(DOCTOR, `/ward/fhir/Provenance?orgId=${ORG}&target=Observation/${cre.entry[0].resource.id}`)).json();
  assert.equal(prov.total, 1);
  const ag = prov.entry[0].resource.agent[0];
  assert.equal(ag.who.display, "adapter:fhir-partner-his");
  assert.equal(ag.type.coding[0].code, "assembler");
  assert.equal(ag.onBehalfOf.display, idFor(DOCTOR), "the clinician is the party acted for, never the author");
  assert.equal(prov.entry[0].resource.entity[0].what.identifier.system, "urn:stewardmd:source:fhir-partner-his");
  assert.equal(prov.entry[0].resource.entity[0].what.identifier.value, "HIS-OBS-1", "the sender's own id is preserved");

  // The report points at its observation and at nothing invented; the allergy arrived unverified.
  const rep = await (await asRaw(DOCTOR, `/ward/fhir/DiagnosticReport?orgId=${ORG}&patient=${pat.id}&_include=DiagnosticReport:result`)).json();
  assert.equal(rep.entry.filter((e) => e.search.mode === "include").length, 1);
  const alg = await (await asRaw(DOCTOR, `/ward/fhir/AllergyIntolerance?orgId=${ORG}&patient=${pat.id}`)).json();
  assert.equal(alg.total, 1);
  assert.equal(alg.entry[0].resource.criticality, "high");
  // The external order is a DRAFT here: no prescriber of ours signed it, and it says who asserted it.
  assert.equal((await RECORD.latest(TENANT_ROW.id, "MedicationOrder", "fhir-partner-his-rx-his-rx-1")).status, "draft");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "MedicationOrder", "fhir-partner-his-rx-his-rx-1")).prescriberId, "external:fhir-partner-his");

  // REPLAY: the same bundle again lands nothing.
  const again = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, partnerBundle());
  assert.equal(again.status, 200);
  const ab = await again.json();
  assert.deepEqual(ab.entry, []);
  assert.equal(ab.meta.tag[0].code, "replayed");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Observation", cre.entry[0].resource.id)).version, 1, "still version 1");
});

test("FHIR inbound: an incoming patient with THIS hospital's MRN links to the local chart and writes no Patient; a look-alike is held", async () => {
  seedHospital(); enableInboundFhir();
  const { reg, adm } = await admittedPatientOnDrug();
  const before = (await RECORD.latest(TENANT_ROW.id, "Patient", adm.patientId)).version;

  // Same MRN as our admitted patient, sent by the partner: the rows go on OUR chart.
  const linked = await (await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, partnerBundle({ patientId: "HIS-PAT-9", mrn: reg.mrn, bundleId: "his-bundle-link" }))).json();
  assert.ok(!linked.entry.some((e) => e.resource && e.resource.resourceType === "Patient"), "no Patient written");
  const onChart = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&code=2160-0`)).json();
  assert.equal(onChart.total, 1, "the creatinine is on the local patient's chart");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Patient", adm.patientId)).version, before, "our demographics are untouched");
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Patient", "fhir-partner-his-pat-his-pat-9"), null);

  // A different MRN but the same name and date of birth as our patient: PROBABLE, held whole.
  const reg2 = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}?orgId=${ORG}`)).json();
  const held = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, partnerBundle({ patientId: "HIS-PAT-10", mrn: "HIS-MRN-10", abha: "00-0000-0000-0010", name: reg2.name[0].text, dob: reg2.birthDate, bundleId: "his-bundle-prob", suffix: "-p10" }));
  const heldText = await held.text();
  assert.equal(held.status, 202, heldText);
  const hb = JSON.parse(heldText);
  assert.ok(hb.entry.every((e) => e.response.status.startsWith("202")));
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Patient", "fhir-partner-his-pat-his-pat-10"), null, "nothing was filed");
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Observation", "fhir-partner-his-obs-his-obs-1-p10"), null, "not even the observations: the bundle is held WHOLE");
  const q = await as(DOCTOR, `/ward/fhir-exceptions?orgId=${ORG}`);
  assert.equal(q.__status, 200);
  assert.equal(q.open.length, 1);
  assert.equal(q.open[0].reason, "identity-probable-duplicate");
  assert.equal(q.open[0].candidates[0].id, adm.patientId);
});

test("FHIR inbound: a feed never overwrites what this hospital authored; a PUT needs If-Match and refuses a stale one", async () => {
  seedHospital(); enableInboundFhir();
  const { adm } = await admittedPatientOnDrug();
  const enc = await (await asRaw(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}?orgId=${ORG}`)).json();

  // An update to OUR encounter from a feed: refused, and an exception names both sides.
  const clash = await pushFhir(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}?orgId=${ORG}`, { ...enc, id: adm.encounterId, status: "finished" }, { method: "PUT", "If-Match": enc.meta.versionId });
  assert.equal(clash.status, 409, await clash.text());
  const q = await as(DOCTOR, `/ward/fhir-exceptions?orgId=${ORG}`);
  assert.ok(q.open.some((x) => x.reason === "conflict-local-authoritative" && x.conflict.id === adm.encounterId), JSON.stringify(q.open));
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId)).version, 1, "untouched");

  // The feed's OWN observation: created, then updated with the right If-Match, refused with a stale one, refused with none.
  const obs = { resourceType: "Observation", id: "HIS-OBS-5", status: "final", category: [{ coding: [{ code: "laboratory" }] }], code: { coding: [{ system: "http://loinc.org", code: "2160-0" }] }, subject: { reference: `Patient/${adm.patientId}` }, effectiveDateTime: "2026-08-02T06:00:00Z", valueQuantity: { value: 90, unit: "umol/L" } };
  const created = await pushFhir(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}`, obs);
  assert.equal(created.status, 201, await created.text());
  assert.match(created.headers.get("location"), /\/Observation\/fhir-partner-his-obs-his-obs-5\/_history\/1$/);
  assert.equal(created.headers.get("etag"), 'W/"1"');
  const cid = "fhir-partner-his-obs-his-obs-5";

  const noMatch = await pushFhir(DOCTOR, `/ward/fhir/Observation/${cid}?orgId=${ORG}`, { ...obs, valueQuantity: { value: 91, unit: "umol/L" } }, { method: "PUT" });
  assert.equal(noMatch.status, 412, "an update that does not say which version it read is a guess");
  const stale = await pushFhir(DOCTOR, `/ward/fhir/Observation/${cid}?orgId=${ORG}`, { ...obs, valueQuantity: { value: 91, unit: "umol/L" } }, { method: "PUT", "If-Match": 'W/"7"' });
  assert.equal(stale.status, 409);
  const good = await pushFhir(DOCTOR, `/ward/fhir/Observation/${cid}?orgId=${ORG}`, { ...obs, valueQuantity: { value: 91, unit: "umol/L" } }, { method: "PUT", "If-Match": 'W/"1"' });
  assert.equal(good.status, 200, await good.text());
  assert.equal(good.headers.get("etag"), 'W/"2"');
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Observation", cid)).value, 91);
  const hist = await (await asRaw(DOCTOR, `/ward/fhir/Observation/${cid}/_history?orgId=${ORG}`)).json();
  assert.equal(hist.total, 2, "an update is a new version; the old one survives");

  // A single resource whose subject is nobody here cannot be filed - and no placeholder patient is created.
  const orphan = await pushFhir(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}`, { ...obs, id: "HIS-OBS-6", subject: { reference: "Patient/nobody-here" } });
  assert.equal(orphan.status, 422);
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Patient", "fhir-partner-his-pat-nobody-here"), null);
});

/* ---- Resolving what was held (2026-09-08): a person decides, by name, once ------------------- */

const resolveAs = (email, body) => as(email, "/ward/fhir-exception-resolve", "POST", { orgId: ORG, ...body });
const openExceptions = async () => (await as(DOCTOR, `/ward/fhir-exceptions?orgId=${ORG}`)).open;

test("FHIR exceptions: LINK files the held bundle on the chosen chart, records the decision, and the same source patient is never held again", async () => {
  seedHospital(); enableInboundFhir();
  const { adm } = await admittedPatientOnDrug();
  const local = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}?orgId=${ORG}`)).json();
  const lookalike = (over) => partnerBundle({ patientId: "HIS-PAT-20", mrn: "HIS-MRN-20", abha: "00-0000-0000-0020", name: local.name[0].text, dob: local.birthDate, ...over });

  const held = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, lookalike({ bundleId: "b-hold-1", suffix: "-h1" }));
  assert.equal(held.status, 202);
  const [ex] = await openExceptions();
  assert.equal(ex.reason, "identity-probable-duplicate");
  assert.equal(ex.candidates[0].id, adm.patientId);

  // Guard rails on the decision itself.
  assert.equal((await resolveAs(NURSE, { exceptionId: ex.id, resolution: "link", localPatientId: adm.patientId, reason: "same person" })).__status, 403, "deciding is emr.treat");
  assert.equal((await resolveAs(DOCTOR, { exceptionId: ex.id, resolution: "link", localPatientId: adm.patientId })).__status, 422, "a reason is required");
  assert.equal((await resolveAs(DOCTOR, { exceptionId: ex.id, resolution: "accept-feed", reason: "x" })).__status, 400, "a conflict resolution does not fit an identity exception");
  assert.equal((await resolveAs(DOCTOR, { exceptionId: ex.id, resolution: "link", localPatientId: "nobody", reason: "x" })).__status, 404, "a link to a patient who does not exist is a typo, not a decision");

  const r = await resolveAs(DOCTOR, { exceptionId: ex.id, resolution: "link", localPatientId: adm.patientId, reason: "Same person - confirmed by phone with the partner ward." });
  assert.equal(r.__status, 200, JSON.stringify(r).slice(0, 300));
  assert.equal(r.linkedTo, adm.patientId);
  assert.ok(r.written >= 8, `written ${r.written}`);
  assert.equal(r.resolvedBy, idFor(DOCTOR));
  // The observations are on OUR patient's chart, and no partner Patient record exists.
  const cre = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&code=2160-0`)).json();
  assert.equal(cre.total, 1);
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Patient", "fhir-partner-his-pat-his-pat-20"), null);
  assert.deepEqual(await openExceptions(), [], "resolved");
  // Resolving again is refused: the decision is on the record and is not re-made.
  assert.equal((await resolveAs(DOCTOR, { exceptionId: ex.id, resolution: "reject", reason: "changed my mind" })).__status, 409);
  const dec = await RECORD.latestByType(TENANT_ROW.id, "ExchangeIdentityDecision", 10);
  assert.equal(dec.length, 1);
  assert.equal(dec[0].patientId, adm.patientId);
  assert.equal(dec[0].sourcePatientId, "HIS-PAT-20");
  assert.equal(dec[0].decidedBy, idFor(DOCTOR));

  // THE SAME SOURCE PATIENT AGAIN, with new results: linked by the prior decision, never held.
  const again = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, lookalike({ bundleId: "b-hold-2", suffix: "-h2" }));
  assert.equal(again.status, 200, await again.text());
  assert.deepEqual(await openExceptions(), []);
  assert.equal((await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&code=2160-0`)).json()).total, 2);
});

test("FHIR exceptions: CREATE makes the patient once and later messages link to them; REJECT files nothing", async () => {
  seedHospital(); enableInboundFhir();
  const { adm } = await admittedPatientOnDrug();
  const local = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}?orgId=${ORG}`)).json();
  const twin = (over) => partnerBundle({ patientId: "HIS-PAT-30", mrn: "HIS-MRN-30", abha: "00-0000-0000-0030", name: local.name[0].text, dob: local.birthDate, ...over });

  await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, twin({ bundleId: "b-c1", suffix: "-c1" }));
  const [ex] = await openExceptions();
  const r = await resolveAs(DOCTOR, { exceptionId: ex.id, resolution: "create", reason: "Different person: the partner confirmed a different father's name." });
  assert.equal(r.__status, 200, JSON.stringify(r).slice(0, 300));
  const created = await RECORD.latest(TENANT_ROW.id, "Patient", "fhir-partner-his-pat-his-pat-30");
  assert.ok(created, "the partner's patient now exists here, as theirs");
  assert.equal(created.meta.source.system, "fhir-partner-his");
  const dec = (await RECORD.latestByType(TENANT_ROW.id, "ExchangeIdentityDecision", 10))[0];
  assert.equal(dec.decision, "create");
  assert.equal(dec.createdPatientId, created.id);

  // Next message for that source patient goes to the created chart, and is not held.
  const next = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, twin({ bundleId: "b-c2", suffix: "-c2" }));
  assert.equal(next.status, 200);
  assert.equal((await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${created.id}&code=2160-0`)).json()).total, 2);
  assert.equal((await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&code=2160-0`)).json()).total, 0, "and nothing landed on our look-alike");

  // REJECT: a different held twin, nothing written, exception closed under the decider's name.
  await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, partnerBundle({ patientId: "HIS-PAT-31", mrn: "HIS-MRN-31", abha: "00-0000-0000-0031", name: local.name[0].text, dob: local.birthDate, bundleId: "b-r1", suffix: "-r1" }));
  const [rx] = await openExceptions();
  const rej = await resolveAs(DOCTOR, { exceptionId: rx.id, resolution: "reject", reason: "Sent to us in error; belongs to another hospital." });
  assert.equal(rej.__status, 200);
  assert.equal(rej.written, 0);
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Patient", "fhir-partner-his-pat-his-pat-31"), null);
  assert.deepEqual(await openExceptions(), []);
});

test("FHIR exceptions: KEEP-LOCAL leaves ours alone; ACCEPT-FEED makes the feed's content the next version of OUR record, attributed to the feed", async () => {
  seedHospital(); enableInboundFhir();
  const { adm } = await admittedPatientOnDrug();
  const enc = await (await asRaw(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}?orgId=${ORG}`)).json();
  const feedVersion = { ...enc, id: adm.encounterId, status: "finished", period: { start: enc.period.start, end: "2026-09-07T18:00:00Z" } };

  await pushFhir(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}?orgId=${ORG}`, feedVersion, { method: "PUT", "If-Match": 'W/"1"' });
  let [ex] = await openExceptions();
  assert.equal(ex.reason, "conflict-local-authoritative");
  const keep = await resolveAs(DOCTOR, { exceptionId: ex.id, resolution: "keep-local", reason: "Our discharge time is the right one." });
  assert.equal(keep.__status, 200);
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId)).version, 1, "untouched");
  assert.equal((await resolveAs(DOCTOR, { exceptionId: ex.id, resolution: "link", localPatientId: adm.patientId, reason: "x" })).__status, 409, "closed");

  // The same conflict again, this time accepted.
  await pushFhir(DOCTOR, `/ward/fhir/Encounter/${adm.encounterId}?orgId=${ORG}`, { ...feedVersion, period: { start: enc.period.start, end: "2026-09-07T19:00:00Z" } }, { method: "PUT", "If-Match": 'W/"1"' });
  [ex] = await openExceptions();
  assert.equal((await resolveAs(DOCTOR, { exceptionId: ex.id, resolution: "link", localPatientId: adm.patientId, reason: "x" })).__status, 400, "an identity resolution does not fit a conflict");
  const acc = await resolveAs(DOCTOR, { exceptionId: ex.id, resolution: "accept-feed", reason: "The partner's discharge time is correct; ours was provisional." });
  assert.equal(acc.__status, 200, JSON.stringify(acc).slice(0, 400));
  const now = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(now.version, 2, "a NEW version of OUR record; version 1 survives");
  assert.equal(now.periodEnd, "2026-09-07T19:00:00Z");
  assert.equal(now.writtenBy.id, "adapter:fhir-partner-his", "attributed to the feed");
  assert.equal(now.writtenBy.onBehalfOf, idFor(DOCTOR), "on behalf of the person who accepted it");
  const prov = await (await asRaw(DOCTOR, `/ward/fhir/Provenance?orgId=${ORG}&target=Encounter/${adm.encounterId}`)).json();
  assert.deepEqual(prov.entry.map((e) => e.resource.agent[0].type.coding[0].code), ["assembler", "author"], "v2 assembled by the feed, v1 authored by us");
  assert.deepEqual(await openExceptions(), []);
});

/* ---- SMART on FHIR server (2026-09-08): an application reads, as somebody --------------------- */

const { onRequest: fhirDoor } = await import("../functions/api/fhir/[[path]].js");
const { resetMemory: resetRateLimit } = await import("../functions/_wardsynq/rate-limit.js");
const b64u = (bytes) => Buffer.from(bytes).toString("base64url");

async function smartBackendClient(clientId) {
  const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await webcrypto.subtle.exportKey("jwk", kp.publicKey);
  const sign = async (claims) => {
    const h = b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "k1" })), p = b64u(JSON.stringify(claims));
    return `${h}.${p}.${b64u(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
  };
  return { config: { clientId, name: "Lab system", kind: "backend", scopes: ["system/*.read"], jwks: { keys: [{ ...pub, kid: "k1" }] } }, sign };
}

function enableSmart(clients) {
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...(org.fields.wardsynq || {}), fhir: { ...((org.fields.wardsynq || {}).fhir || {}), smart: { enabled: true, clients } } };
  docs.set(`q_orgs/${ORG}`, org);
}

// The external door. `email` is a clinician's session when present (authorize); `bearer` a token.
async function viaFhirDoor(path, init) {
  const i = init || {};
  const headers = { ...(i.headers || {}) };
  if (i.email) headers["Cf-Access-Authenticated-User-Email"] = i.email;
  if (i.bearer) headers.Authorization = `Bearer ${i.bearer}`;
  const segs = path.replace(/^\//, "").split("?")[0].split("/");
  return fhirDoor({ request: new Request(`https://x/api/fhir/${path.replace(/^\//, "")}`, { method: i.method || "GET", headers, body: i.body }), env: ENV, params: { path: segs } });
}
const form = (o) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
const PUBLIC_CLIENT = { clientId: "chart-viewer", name: "Chart viewer", kind: "public", redirectUris: ["https://viewer.example/cb"], scopes: ["user/Observation.read", "user/Patient.read"] };

test("SMART: OFF by default, and the external door answers nothing without a bearer", async () => {
  seedHospital();
  await admittedPatientOnDrug();
  assert.equal((await viaFhirDoor(`${ORG}/.well-known/smart-configuration`)).status, 404);
  assert.equal((await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "client_credentials" }))).status, 404);
  const nobearer = await viaFhirDoor(`${ORG}/Observation`);
  assert.equal(nobearer.status, 401);
  assert.match(nobearer.headers.get("www-authenticate"), /^Bearer/);
  assert.equal((await nobearer.json()).resourceType, "OperationOutcome");
  assert.equal((await viaFhirDoor(`no-such-org/metadata`)).status, 404);
});

test("SMART: authorize (PKCE) -> token -> read as the clinician, narrowed to the granted scopes; a used code and a revoked token die", async () => {
  seedHospital(); enableSmart([PUBLIC_CLIENT]); resetRateLimit();
  const { adm } = await admittedPatientOnDrug();

  const conf = await (await viaFhirDoor(`${ORG}/.well-known/smart-configuration`)).json();
  assert.deepEqual(conf.code_challenge_methods_supported, ["S256"]);
  assert.equal(conf.token_endpoint, `https://x/api/fhir/${ORG}/smart/token`);
  const meta = await (await viaFhirDoor(`${ORG}/metadata`)).json();
  assert.equal(meta.resourceType, "CapabilityStatement", "metadata is public: it is how a client finds the endpoints");
  assert.equal(meta.rest[0].security.service[0].coding[0].code, "SMART-on-FHIR");
  assert.ok(meta.rest[0].security.extension[0].extension.some((e) => e.url === "authorize"));

  const verifier = "v".repeat(20) + "ERIFIER-with-enough-length-to-be-legal-abcdef0123456789";
  const challenge = b64u(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const q = (o) => new URLSearchParams({ response_type: "code", client_id: "chart-viewer", redirect_uri: "https://viewer.example/cb", scope: "user/Observation.read user/Encounter.read", state: "xyz", code_challenge: challenge, code_challenge_method: "S256", ...o }).toString();

  // Errors about the client or the redirect never redirect.
  assert.equal((await viaFhirDoor(`${ORG}/smart/authorize?${q({ redirect_uri: "https://evil.example/cb" })}`, { email: DOCTOR })).status, 400);
  assert.equal((await viaFhirDoor(`${ORG}/smart/authorize?${q({ client_id: "nobody" })}`, { email: DOCTOR })).status, 400);
  // Missing PKCE goes back to the registered redirect as an OAuth error.
  const nopkce = await viaFhirDoor(`${ORG}/smart/authorize?${q({ code_challenge: "" })}`, { email: DOCTOR });
  assert.equal(nopkce.status, 302);
  assert.match(nopkce.headers.get("location"), /^https:\/\/viewer\.example\/cb\?error=invalid_request/);
  // No session: the clinician has to be there to say yes.
  assert.equal((await viaFhirDoor(`${ORG}/smart/authorize?${q()}`)).status, 401);

  /* THE CONSENT SCREEN. Nothing is granted on GET: the clinician sees the application by name, what
   * it will get, what it asked for and will not get, and decides. The form's anti-forgery token is
   * the transaction itself, bound to this clinician. */
  const screen = await viaFhirDoor(`${ORG}/smart/authorize?${q()}`, { email: DOCTOR });
  const screenText = await screen.text();
  assert.equal(screen.status, 200, screenText);
  assert.match(screen.headers.get("content-type"), /^text\/html/);
  assert.match(screen.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(screenText, /Allow Chart viewer to read this record as you\?/);
  assert.match(screenText, /user\/Observation\.read/, "what it will get");
  assert.match(screenText, /will NOT get[\s\S]*user\/Encounter\.read/, "what it asked for and will not get");
  assert.ok(!/<script/i.test(screenText), "no script on the consent page");
  const authz = (/name="authz" value="([^"]+)"/.exec(screenText) || [])[1];
  assert.ok(authz && authz.length > 20);
  // Another clinician cannot use this transaction; a forged one is refused; a deny goes back as access_denied.
  assert.equal((await viaFhirDoor(`${ORG}/smart/authorize`, { ...form({ authz, decision: "allow" }), email: LOCUM })).status, 403);
  assert.equal((await viaFhirDoor(`${ORG}/smart/authorize`, { ...form({ authz: "forged", decision: "allow" }), email: DOCTOR })).status, 400);
  const denied = await viaFhirDoor(`${ORG}/smart/authorize?${q()}`, { email: DOCTOR });
  const deniedAuthz = (/name="authz" value="([^"]+)"/.exec(await denied.text()) || [])[1];
  const deny = await viaFhirDoor(`${ORG}/smart/authorize`, { ...form({ authz: deniedAuthz, decision: "deny" }), email: DOCTOR });
  assert.equal(deny.status, 302);
  assert.match(deny.headers.get("location"), /error=access_denied/);

  const az = await viaFhirDoor(`${ORG}/smart/authorize`, { ...form({ authz, decision: "allow" }), email: DOCTOR });
  assert.equal(az.status, 302, await az.text());
  assert.equal((await viaFhirDoor(`${ORG}/smart/authorize`, { ...form({ authz, decision: "allow" }), email: DOCTOR })).status, 400, "the transaction is spent");
  const loc = new URL(az.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, "https://viewer.example/cb");
  assert.equal(loc.searchParams.get("state"), "xyz");
  const code = loc.searchParams.get("code");
  assert.ok(code && code.length > 20);

  const bad = await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "authorization_code", client_id: "chart-viewer", code, code_verifier: "wrong-" + verifier, redirect_uri: "https://viewer.example/cb" }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_grant");
  const tok = await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "authorization_code", client_id: "chart-viewer", code, code_verifier: verifier, redirect_uri: "https://viewer.example/cb" }));
  const tokText = await tok.text();
  assert.equal(tok.status, 200, tokText);
  assert.equal(tok.headers.get("cache-control"), "no-store");
  const t = JSON.parse(tokText);
  assert.equal(t.token_type, "Bearer");
  assert.equal(t.scope, "user/Observation.read", "Encounter was asked for and not registered: dropped, never widened");
  assert.ok(t.expires_in <= 3600);
  assert.ok(!("refresh_token" in t));
  // The code is spent.
  assert.equal((await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "authorization_code", client_id: "chart-viewer", code, code_verifier: verifier, redirect_uri: "https://viewer.example/cb" }))).status, 400);

  // Reading as the clinician, through the external door, narrowed.
  const obs = await viaFhirDoor(`${ORG}/Observation?patient=${adm.patientId}`, { bearer: t.access_token });
  const obsText = await obs.text();
  assert.equal(obs.status, 200, obsText);
  assert.match(obs.headers.get("content-type"), /^application\/fhir\+json/);
  const ob = JSON.parse(obsText);
  assert.equal(ob.resourceType, "Bundle");
  assert.ok(ob.total >= 1);
  const enc = await viaFhirDoor(`${ORG}/Encounter?patient=${adm.patientId}`, { bearer: t.access_token });
  assert.equal(enc.status, 403, "not in the granted scopes, so the governed store refuses it");
  assert.equal((await enc.json()).resourceType, "OperationOutcome");
  const one = await viaFhirDoor(`${ORG}/Patient/${adm.patientId}`, { bearer: t.access_token });
  assert.equal(one.status, 403, "Patient was registered for this client but not requested in this grant");
  // The audit names the clinician, not the application: the token acts AS them.
  const auditRows = RECORD.audit.filter((a) => a.action === "record.read" && a.actor === idFor(DOCTOR));
  assert.ok(auditRows.length >= 1);

  // Revoked: the bearer revokes its own token and is then refused.
  assert.equal((await viaFhirDoor(`${ORG}/smart/revoke`, { ...form({ token: t.access_token }), bearer: t.access_token })).status, 200);
  const after = await viaFhirDoor(`${ORG}/Observation?patient=${adm.patientId}`, { bearer: t.access_token });
  assert.equal(after.status, 401);
  assert.match(after.headers.get("www-authenticate"), /invalid_token/);
  assert.equal((await viaFhirDoor(`${ORG}/Observation?patient=${adm.patientId}`, { bearer: "made-up-token" })).status, 401);
});

test("SMART: a backend system proves itself with a signed assertion against its registered key; a replayed assertion is refused; the token acts as the system", async () => {
  seedHospital(); resetRateLimit();
  const lab = await smartBackendClient("lab-sys");
  enableSmart([PUBLIC_CLIENT, lab.config]);
  const { adm } = await admittedPatientOnDrug();
  const tokenUrl = `https://x/api/fhir/${ORG}/smart/token`;
  const now = Math.floor(Date.now() / 1000);
  const claims = (o) => ({ iss: "lab-sys", sub: "lab-sys", aud: tokenUrl, exp: now + 120, jti: "jti-" + Math.random().toString(36).slice(2), ...o });
  const cc = async (assertion, extra) => viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion, scope: "system/Observation.read", ...(extra || {}) }));

  assert.equal((await cc(await lab.sign(claims({ aud: "https://elsewhere/token" })))).status, 401, "aud must be this token endpoint");
  const publicTry = await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "client_credentials", client_id: "chart-viewer" }));
  assert.equal(publicTry.status, 400, "a public client has no key and no client_credentials");

  const j = claims();
  const ok = await cc(await lab.sign(j));
  const okText = await ok.text();
  assert.equal(ok.status, 200, okText);
  const t = JSON.parse(okText);
  assert.equal(t.scope, "system/Observation.read");
  // The same assertion again: refused. Bounded by the assertion's own five-minute life.
  assert.equal((await cc(await lab.sign(j))).status, 400);
  assert.equal((await (await cc(await lab.sign(j))).json()).error, "invalid_grant");

  const obs = await viaFhirDoor(`${ORG}/Observation?patient=${adm.patientId}`, { bearer: t.access_token });
  assert.equal(obs.status, 200, await obs.text());
  const auditRows = RECORD.audit.filter((a) => a.action === "record.read" && a.actor === "smart:lab-sys");
  assert.ok(auditRows.length >= 1, "the audit names the system, never a person");
  assert.equal((await viaFhirDoor(`${ORG}/Condition?patient=${adm.patientId}`, { bearer: t.access_token })).status, 403);

  // A read door is a read door: no method but GET past the token endpoints.
  const put = await viaFhirDoor(`${ORG}/Observation/x`, { method: "PUT", bearer: t.access_token, headers: { "Content-Type": "application/fhir+json" }, body: "{}" });
  assert.equal(put.status, 405);
  assert.equal(put.headers.get("allow"), "GET");
});

/* ---- Hardening (2026-09-08): isolation, round trip, malformed input, audit ------------------- */

const ORG2 = "org-two";
function seedSecondHospital(clients) {
  docs.set(`q_orgs/${ORG2}`, { fields: { id: ORG2, code: "SMD-TWO", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW2.id, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: { fhir: { inbound: { enabled: true }, smart: { enabled: true, clients: clients || [] } } } }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG2)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG2, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
}

test("ISOLATION: a chart, an import and a token in one hospital do not exist in another, at either door", async () => {
  seedHospital(); enableInboundFhir(); resetRateLimit();
  const lab = await smartBackendClient("lab-sys");
  enableSmart([lab.config]);
  seedSecondHospital([]);
  const { reg, adm } = await admittedPatientOnDrug();
  await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, partnerBundle({ bundleId: "iso-1", suffix: "-iso" }));

  // The same doctor, a member of both, reading hospital two: our patient is not there.
  const rd = await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}?orgId=${ORG2}`);
  assert.equal(rd.status, 404);
  const srch = await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG2}&patient=${adm.patientId}`)).json();
  assert.equal(srch.total, 0);
  assert.equal((await RECORD.latest(TENANT_ROW2.id, "Patient", "fhir-partner-his-pat-his-pat-77")), null, "the import landed in hospital one only");

  // An import into hospital two carrying hospital ONE's MRN links to nobody: identity is per tenant.
  const two = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG2}`, partnerBundle({ patientId: "HIS-PAT-X", mrn: reg.mrn, abha: "00-0000-0000-0099", bundleId: "iso-2", suffix: "-iso2" }));
  assert.equal(two.status, 200, await two.text());
  assert.ok(await RECORD.latest(TENANT_ROW2.id, "Patient", "fhir-partner-his-pat-his-pat-x"), "created anew in hospital two");
  assert.equal((await (await asRaw(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${adm.patientId}&code=2160-0`)).json()).total, 0, "nothing reached hospital one's chart");

  // A SMART token issued by hospital one is nothing at hospital two, and vice versa.
  const t = await (await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: await lab.sign({ iss: "lab-sys", sub: "lab-sys", aud: `https://x/api/fhir/${ORG}/smart/token`, exp: Math.floor(Date.now() / 1000) + 60, jti: "iso-j1" }) }))).json();
  assert.ok(t.access_token);
  assert.equal((await viaFhirDoor(`${ORG}/Observation?patient=${adm.patientId}`, { bearer: t.access_token })).status, 200);
  assert.equal((await viaFhirDoor(`${ORG2}/Observation?patient=${adm.patientId}`, { bearer: t.access_token })).status, 401, "not a token hospital two issued");
});

test("ROUND TRIP: WardSynQ -> an external EMR -> WardSynQ, and the clinical content survives field for field", async () => {
  seedHospital(); enableInboundFhir();
  const { adm, ord, patient, scan } = await admittedPatientOnDrug();
  await as(DOCTOR, "/ward/problem", "POST", { orgId: ORG, problem: { patientId: adm.patientId, encounterId: adm.encounterId, code: "J18.9", codeSystem: "ICD-10", display: "Pneumonia", verificationStatus: "confirmed" } });
  const step = (a, x) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action: a, orderId: ord.orderId, dueAt: DUE, patient, ...(x || {}) });
  await step("verify"); await step("dispense"); await step("scan", { scan }); await step("administer");
  const sr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Renal profile", category: "laboratory" });
  await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr.orderId, status: "final", reportedAt: "2026-09-07T10:00:00.000Z", conclusion: "Renal function normal.", tests: [{ test: "Creatinine", value: 88, unit: "umol/L" }] });
  const note = await as(DOCTOR, "/ward/note", "POST", { orgId: ORG, templateId: "ward-round", encounterId: adm.encounterId, sections: { impression: "Improving pneumonia.", plan: "Continue antibiotics; review tomorrow." } });
  assert.equal(note.__status, 200, JSON.stringify(note).slice(0, 200));

  // OUT: everything for the patient, as another EMR would pull it.
  const out = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${adm.patientId}/$everything?orgId=${ORG}`)).json();
  const byType = {}; for (const e of out.entry) (byType[e.resource.resourceType] ||= []).push(e.resource);
  assert.ok(byType.Patient && byType.Encounter && byType.Condition && byType.Observation && byType.MedicationRequest && byType.MedicationAdministration && byType.DiagnosticReport && byType.DocumentReference, Object.keys(byType).join(","));
  assert.match(byType.DocumentReference[0].description, /Improving pneumonia/, "the note's words travel");
  assert.ok(byType.DocumentReference[0].content[0].attachment.data, "and as an attachment");

  // The other EMR re-identifies the patient as its own and sends it all back. A different person
  // on paper (new name, dob, MRN) so identity does not hold the bundle; the CONTENT is what is measured.
  const mirror = { resourceType: "Bundle", type: "collection", id: "mirror-1", entry: out.entry.map((e) => ({ resource: e.resource })) };
  const mp = mirror.entry.find((e) => e.resource.resourceType === "Patient").resource;
  mp.identifier = [{ type: { coding: [{ code: "MR" }] }, system: "urn:mirror:mrn", value: "MIRROR-0001" }];
  mp.name = [{ text: "Mirror Person" }]; mp.birthDate = "1961-11-05";
  const back = await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, mirror, { "X-Source-System": "mirror" });
  const backText = await back.text();
  assert.equal(back.status, 200, backText);
  const bb = JSON.parse(backText);
  // Every exported type comes back in, including the dose we gave: filed as the MIRROR's record of a dose
  // given elsewhere, against the mirror's own copy of the order, never as a second dose of OUR order.
  assert.ok(!((bb.meta && bb.meta.tag) || []).some((t) => /MedicationAdministration is not a resource WardSynQ imports/.test(t.display)), JSON.stringify(bb.meta));
  const mirrored = `fhir-mirror-pat-${adm.patientId}`;
  assert.ok(await RECORD.latest(TENANT_ROW.id, "Patient", mirrored));
  const backDose = bb.entry.map((e) => e.resource).find((r) => r && r.resourceType === "MedicationAdministration");
  assert.ok(backDose, JSON.stringify(bb.entry.map((e) => e.response)).slice(0, 400));
  const backDoseRec = await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", backDose.identifier.find((i) => i.system === "urn:stewardmd:record-id").value);
  assert.ok(backDoseRec.orderId.startsWith("fhir-mirror-rx-"), "the mirror's order, not ours: " + backDoseRec.orderId);
  assert.ok(backDoseRec.administeredBy.startsWith("external:fhir-mirror"), backDoseRec.administeredBy);

  const back$ = await (await asRaw(DOCTOR, `/ward/fhir/Patient/${mirrored}/$everything?orgId=${ORG}`)).json();
  const got = {}; for (const e of back$.entry) (got[e.resource.resourceType] ||= []).push(e.resource);

  // Condition: the ICD-10 coding is intact and still ICD-10.
  assert.deepEqual(got.Condition[0].code.coding[0], byType.Condition[0].code.coding[0]);
  assert.equal(got.Condition[0].verificationStatus.coding[0].code, "provisional", "an imported diagnosis is provisional HERE until a clinician here confirms it - never silently confirmed");
  // Observations: same count, and the creatinine is the same number in the same unit at the same time under the same LOINC.
  assert.equal(got.Observation.length, byType.Observation.length);
  const cre0 = byType.Observation.find((o) => o.code.coding && o.code.coding[0].code === "2160-0");
  const cre1 = got.Observation.find((o) => o.code.coding && o.code.coding[0].code === "2160-0");
  assert.deepEqual([cre1.valueQuantity.value, cre1.valueQuantity.unit, cre1.effectiveDateTime, cre1.code.coding[0].system], [cre0.valueQuantity.value, cre0.valueQuantity.unit, cre0.effectiveDateTime, "http://loinc.org"]);
  // Medication: the drug and the instruction text survive; the order is a DRAFT here, attributed to the sender.
  assert.equal(got.MedicationRequest[0].medicationCodeableConcept.text, byType.MedicationRequest[0].medicationCodeableConcept.text);
  assert.equal(got.MedicationRequest[0].dosageInstruction[0].text, byType.MedicationRequest[0].dosageInstruction[0].text);
  assert.equal(got.MedicationRequest[0].status, "draft");
  // Report: status, conclusion, and it still points at its observation.
  assert.equal(got.DiagnosticReport[0].status, "final");
  assert.equal(got.DiagnosticReport[0].conclusion, "Renal function normal.");
  assert.equal(got.DiagnosticReport[0].result.length, 1);
  // Note: the words are the same words.
  assert.equal(got.DocumentReference[0].description, byType.DocumentReference[0].description);
  // Encounter: class and start survive.
  assert.equal(got.Encounter[0].class.code, "IMP");
  assert.equal(got.Encounter[0].period.start, byType.Encounter[0].period.start);
  // Provenance on the way back names the sender's system and the sender's own id for each row.
  const prov = await (await asRaw(DOCTOR, `/ward/fhir/Provenance?orgId=${ORG}&target=Observation/${cre1.id}`)).json();
  assert.equal(prov.entry[0].resource.entity[0].what.identifier.system, "urn:stewardmd:source:fhir-mirror");
  assert.equal(prov.entry[0].resource.entity[0].what.identifier.value, cre0.id, "the sender's id for it is our original id: the loop closes");
});

test("MALFORMED INPUT is refused with an OperationOutcome naming the fault, and nothing is written", async () => {
  seedHospital(); enableInboundFhir();
  const { adm } = await admittedPatientOnDrug();
  const before = RECORD.audit.length;
  const raw = (body, headers) => onRequest({ request: new Request(`https://x/api/queue/ward/fhir?orgId=${ORG}`, { method: "POST", headers: { "Cf-Access-Authenticated-User-Email": DOCTOR, "Content-Type": "application/fhir+json", "X-Source-System": "partner-his", ...(headers || {}) }, body }), env: ENV });

  const notJson = await raw("{this is not json");
  assert.equal(notJson.status, 400);
  assert.equal((await notJson.json()).resourceType, "OperationOutcome");
  const emptyEntry = await raw(JSON.stringify({ resourceType: "Bundle", entry: [{ resource: { resourceType: "Patient", id: "p" } }, { fullUrl: "x" }] }));
  assert.equal(emptyEntry.status, 400);
  assert.match((await emptyEntry.json()).issue[0].diagnostics, /1 bundle entry has no resource/);
  const noId = await raw(JSON.stringify({ resourceType: "Bundle", entry: [{ resource: { resourceType: "Patient", id: "p" } }, { resource: { resourceType: "Observation" } }] }));
  assert.equal(noId.status, 400);
  assert.match((await noId.json()).issue[0].diagnostics, /has no id/);
  const noPatient = await raw(JSON.stringify({ resourceType: "Bundle", type: "collection", entry: [{ resource: { resourceType: "Observation", id: "o1", status: "final", code: { text: "x" } } }] }));
  assert.equal(noPatient.status, 400);
  assert.match((await noPatient.json()).issue[0].diagnostics, /must carry the Patient/);
  // A non-conformant resource is a 422 naming the path, before identity or content is considered.
  const nonConformant = await raw(JSON.stringify({ resourceType: "Bundle", type: "collection", entry: [{ resource: { resourceType: "Patient", id: "p", name: [{ text: "X" }] } }, { resource: { resourceType: "Observation", id: "o1", subject: { reference: "Patient/p" } } }] }));
  assert.equal(nonConformant.status, 422);
  assert.ok((await nonConformant.json()).issue.some((i) => i.code === "required" && /Bundle\.entry\[1\]\.resource\.status/.test(i.expression[0])));
  // A resource with no id cannot be attributed or replayed safely, whatever type it is.
  const noIdPatient = await raw(JSON.stringify({ resourceType: "Patient", name: [{ text: "Nobody" }] }));
  assert.equal(noIdPatient.status, 400);
  assert.match((await noIdPatient.json()).issue[0].diagnostics, /has no id/);
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Patient", "fhir-partner-his-pat-p"), null);
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Observation", "fhir-partner-his-obs-o1")), null);
  assert.ok(!RECORD.audit.slice(before).some((a) => a.action === "record.ingest"), "no ingest audit row: nothing was ingested");
});

/* ---- HL7 v2 gateway (2026-09-08): ADT and ORU through the SAME landing as a FHIR transaction ---- */

function enableHl7(profile) {
  const org = docs.get(`q_orgs/${ORG}`);
  org.fields.wardsynq = { ...(org.fields.wardsynq || {}), hl7: { inbound: { enabled: true }, ...(profile ? { profile } : {}) } };
  docs.set(`q_orgs/${ORG}`, org);
}
const HS = (id, at) => { const n = Math.max(...Object.keys(at).map(Number)); const f = [id]; for (let i = 1; i <= n; i++) f.push(at[i] == null ? "" : String(at[i])); return f.join("|"); };
function adt(o = {}) {
  const ev = o.event || "A01";
  return [
    `MSH|^~\\&|HIS|GENHOSP|WARDSYNQ|WSQ|20260808101500||ADT^${ev}^ADT_${ev === "A03" ? "A03" : "A01"}|${o.controlId || "MSG-" + ev}|${o.processingId || "P"}|2.5.1`,
    `EVN|${ev}|20260808101500`,
    `PID|1||${o.mrn || "H-77"}^^^${o.authority || "GENHOSP"}^MR${o.abha ? "~" + o.abha + "^^^NDHM^NI" : ""}||${o.family || "Testcase"}^${o.given || "Partner"}||${o.dob || "19750309"}|${o.sex || "F"}`,
    HS("PV1", { 1: "1", 2: "I", 3: (o.ward || "MED-A") + "^" + (o.bed || "12") + "^^GENHOSP", 19: (o.visit || "V-2026-001") + "^^^GENHOSP", 44: "20260808100000", ...(ev === "A03" ? { 45: "20260810090000" } : {}) }),
    ...(o.extra || []),
  ].join("\r");
}
async function pushHl7(email, text, headers) {
  return onRequest({ request: new Request(`https://x/api/queue/ward/hl7?orgId=${ORG}`, { method: "POST", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "x-application/hl7-v2+er7", ...(headers || {}) }, body: text }), env: ENV });
}
const msa = (ack) => (/^MSA\|(\w+)\|([^|\r]*)\|?([^\r]*)/m.exec(ack) || []).slice(1);

test("HL7 v2: OFF by default; ON, an ADT A01 lands a patient and a visit through the SAME pipeline as FHIR, is ACKed AA, and a replay is ACKed AA without filing twice", async () => {
  seedHospital();
  await admittedPatientOnDrug();
  const off = await pushHl7(DOCTOR, adt());
  assert.equal(off.status, 404, "off is a 404, before the message is looked at");
  enableHl7();
  const nurse = await pushHl7(NURSE, adt());
  assert.equal(nurse.status, 403, "filing needs the right to treat, exactly as the FHIR door");

  const r = await pushHl7(DOCTOR, adt());
  const ack = await r.text();
  assert.equal(r.status, 200, ack);
  assert.match(r.headers.get("content-type"), /^x-application\/hl7-v2\+er7/);
  assert.equal(r.headers.get("x-wardsynq-ack"), "AA");
  const [code, ctl, text] = msa(ack);
  assert.equal(code, "AA"); assert.equal(ctl, "MSG-A01"); assert.match(text, /2 records filed/);
  assert.match(ack, /^MSH\|\^~\\&\|WardSynQ\|WSQ Ward Hospital\|HIS\|GENHOSP\|\d{14}\|\|ACK\^A01\^ACK\|/, "the ACK is addressed back to the sender");
  const pat = await RECORD.latest(TENANT_ROW.id, "Patient", "hl7v2-his-genhosp-pat-h-77");
  assert.ok(pat, "the patient is on the record under the HL7 feed's own name");
  assert.equal(pat.mrn, "H-77"); assert.equal(pat.meta.source.system, "hl7v2-his-genhosp"); assert.equal(pat.writtenBy.id, "adapter:hl7v2-his-genhosp"); assert.equal(pat.writtenBy.onBehalfOf, idFor(DOCTOR));
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", "hl7v2-his-genhosp-enc-v-2026-001");
  assert.equal(enc.status, "in-progress"); assert.deepEqual(enc.location, { facilityId: "GENHOSP", ward: "MED-A", bed: "12" }); assert.equal(enc.class, "IPD");
  assert.ok(enc.identifiers.some((i) => i.type === "VN" && i.value === "V-2026-001"));
  const audit = RECORD.audit.filter((a) => a.action === "record.ingest" && a.actor === "adapter:hl7v2-his-genhosp");
  assert.ok(audit.length >= 1 && audit.some((a) => a.scope && a.scope.transaction), "landed as one transaction, audited under the feed");

  // The same message again: nothing lands twice, and the sender is told so with an AA.
  const again = await pushHl7(DOCTOR, adt());
  const [c2, , t2] = msa(await again.text());
  assert.equal(c2, "AA"); assert.match(t2, /already processed/);
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Encounter", "hl7v2-his-genhosp-enc-v-2026-001")).version, 1);

  // A02 moves the SAME visit (version 2), A03 finishes it (version 3): the record versions, it does not fork.
  const a02 = await pushHl7(DOCTOR, adt({ event: "A02", ward: "ICU", bed: "3", controlId: "MSG-A02" }));
  assert.equal(msa(await a02.text())[0], "AA");
  const moved = await RECORD.latest(TENANT_ROW.id, "Encounter", "hl7v2-his-genhosp-enc-v-2026-001");
  assert.equal(moved.version, 2); assert.equal(moved.location.ward, "ICU"); assert.equal(moved.status, "in-progress");
  const a03 = await pushHl7(DOCTOR, adt({ event: "A03", controlId: "MSG-A03" }));
  assert.equal(msa(await a03.text())[0], "AA");
  const done = await RECORD.latest(TENANT_ROW.id, "Encounter", "hl7v2-his-genhosp-enc-v-2026-001");
  assert.equal(done.version, 3); assert.equal(done.status, "finished"); assert.equal(done.periodEnd, "2026-08-10T09:00:00Z");
  // Exported, the visit is a conformant FHIR Encounter like any other.
  const f = await (await asRaw(DOCTOR, `/ward/fhir/Encounter/hl7v2-his-genhosp-enc-v-2026-001?orgId=${ORG}`)).json();
  assert.equal(f.status, "finished"); assert.equal(f.meta.source, "urn:stewardmd:source:hl7v2-his-genhosp");
});

test("HL7 v2: a repository failure while reading the record to reconcile identity still gets an ACK, not an uncaught 500", async () => {
  seedHospital(); enableHl7();
  const real = RECORD.latestByType.bind(RECORD);
  RECORD.latestByType = async (tenantId, resourceType, limit) => {
    if (resourceType === "Patient") throw new Error("simulated repository outage");
    return real(tenantId, resourceType, limit);
  };
  try {
    const r = await pushHl7(DOCTOR, adt({ controlId: "MSG-DOWN" }));
    assert.equal(r.status, 200, "an MLLP bridge treats anything but 200 as a transport failure and retries forever");
    assert.equal(r.headers.get("x-wardsynq-ack"), "AE");
    const ack = await r.text();
    const [code, ctl, text] = msa(ack);
    assert.equal(code, "AE"); assert.equal(ctl, "MSG-DOWN");
    assert.match(text, /could not be read/);
    assert.match(ack, /^MSH\|\^~\\&\|WardSynQ\|WSQ Ward Hospital\|HIS\|GENHOSP\|/, "still addressed back to the sender, not a bare error page");
  } finally { RECORD.latestByType = real; }
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Encounter", "hl7v2-his-genhosp-enc-v-2026-001"), null, "nothing was filed from the failed attempt");
});

test("HL7 v2: an A01 carrying THIS hospital's MRN links to the local chart and writes no Patient; a look-alike is HELD with an AE naming the exception, its Z-segment kept verbatim, decided from the same queue", async () => {
  seedHospital(); enableHl7();
  const { reg, adm } = await admittedPatientOnDrug();
  const linked = await pushHl7(DOCTOR, adt({ mrn: reg.mrn, authority: "SMD-WARD01", controlId: "MSG-LINK", visit: "V-LINK" }));
  const ackL = await linked.text();
  assert.equal(msa(ackL)[0], "AA", ackL);
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Patient", `hl7v2-his-genhosp-pat-${reg.mrn.toLowerCase()}`), null, "no second Patient: ours is authoritative");
  const v = await RECORD.latest(TENANT_ROW.id, "Encounter", "hl7v2-his-genhosp-enc-v-link");
  assert.equal(v.patientId, adm.patientId, "the visit is filed on OUR chart");

  // Same name and date of birth as our patient, a different MRN: probable duplicate, held whole.
  const ours = await RECORD.latest(TENANT_ROW.id, "Patient", adm.patientId);
  const heldMsg = adt({ mrn: "OTHER-9", family: ours.name.split(" ").pop(), given: ours.name.split(" ")[0], dob: String(ours.dob || "").replace(/-/g, ""), sex: "F", controlId: "MSG-HELD", visit: "V-HELD", extra: ["ZPI|1|keep-me-verbatim"] });
  const held = await pushHl7(DOCTOR, heldMsg);
  const ackH = await held.text();
  assert.equal(held.status, 200, "an AE is still a 200: the ACK carries the outcome");
  assert.equal(held.headers.get("x-wardsynq-ack"), "AE");
  const [hc, , ht] = msa(ackH);
  assert.equal(hc, "AE"); assert.match(ht, /held for a person to decide: see ExchangeException\/wsq-xchg-hl7v2-his-genhosp-/);
  assert.match(ackH, /^ERR\|\|\|207\^Application internal error\^HL70357\|E\|\|\|\|held: wsq-xchg-/m);
  assert.equal(await RECORD.latest(TENANT_ROW.id, "Encounter", "hl7v2-his-genhosp-enc-v-held"), null, "nothing filed");
  const q = await as(DOCTOR, `/ward/fhir-exceptions?orgId=${ORG}`);
  assert.ok(Array.isArray(q.open), JSON.stringify(q).slice(0, 300));
  const ex = q.open.find((x) => /hl7v2-his-genhosp/.test(x.source));
  assert.ok(ex, JSON.stringify(q.open).slice(0, 300));
  assert.equal(ex.reason, "identity-probable-duplicate");
  const stored = await RECORD.latest(TENANT_ROW.id, "ExchangeException", ex.id);
  assert.equal(typeof stored.payload, "string"); assert.match(stored.payload, /ZPI\|1\|keep-me-verbatim/, "the raw message, Z-segment and all, is the exception's payload");
  assert.equal(stored.context.protocol, "hl7v2"); assert.equal(stored.context.controlId, "MSG-HELD");
  // Decided as a link from the same queue, the message re-enters through the HL7 door and lands on our chart.
  const decided = await as(DOCTOR, "/ward/fhir-exception-resolve", "POST", { orgId: ORG, exceptionId: ex.id, resolution: "link", localPatientId: adm.patientId, reason: "Same person; the other hospital's MRN." });
  assert.equal(decided.__status, 200, JSON.stringify(decided).slice(0, 300));
  const landed = await RECORD.latest(TENANT_ROW.id, "Encounter", "hl7v2-his-genhosp-enc-v-held");
  assert.ok(landed && landed.patientId === adm.patientId, "filed on our chart after the decision");
});

test("HL7 v2: the integration profile refuses with an AR before content is looked at; an ORU files a report the ward's own worklists never pick up; keepRaw stores a receipt", async () => {
  seedHospital();
  enableHl7({ messages: ["ORU^R01", "ADT^A01"], sendingApplications: ["LAB", "HIS"], keepRaw: true });
  const { reg, adm } = await admittedPatientOnDrug();
  const training = await pushHl7(DOCTOR, adt({ processingId: "T", controlId: "MSG-T" }));
  const [tc, , tt] = msa(await training.text());
  assert.equal(tc, "AR"); assert.match(tt, /processing id T is not accepted/);
  const a08 = await pushHl7(DOCTOR, adt({ event: "A08", controlId: "MSG-A08" }));
  assert.equal(msa(await a08.text())[0], "AR", "A08 is not in this hospital's profile");
  const stranger = await pushHl7(DOCTOR, adt().replace("MSH|^~\\&|HIS|", "MSH|^~\\&|ROGUE|"));
  const [sc, , st] = msa(await stranger.text());
  assert.equal(sc, "AR"); assert.match(st, /"ROGUE" is not registered/);
  const noMsh = await pushHl7(DOCTOR, "PID|1||X");
  assert.equal(noMsh.status, 400, "no MSH, no ACK can be built");
  assert.equal((await noMsh.json()).resourceType, "OperationOutcome");

  const oru = [
    "MSH|^~\\&|LAB|GENHOSP|WARDSYNQ|WSQ|20260808120000||ORU^R01^ORU_R01|MSG-ORU|P|2.5.1",
    `PID|1||${reg.mrn}^^^SMD-WARD01^MR||X^Y||19750309|F`,
    HS("OBR", { 1: "1", 2: "PLC-9", 3: "FIL-9", 4: "RENAL^Renal profile^L", 7: "20260808113000", 25: "F" }),
    "OBX|1|NM|2160-0^Creatinine^LN||96|umol/L|60-110|N|||F|||20260808113000",
    "OBX|2|NM|2823-3^Potassium^LN||6.1|mmol/L|3.5-5.1|HH|||F",
  ].join("\r");
  const r = await pushHl7(DOCTOR, oru);
  const ack = await r.text();
  assert.equal(msa(ack)[0], "AA", ack);
  const rep = await RECORD.latest(TENANT_ROW.id, "DiagnosticReport", "hl7v2-lab-genhosp-dr-fil-9");
  assert.ok(rep, "the report is on OUR chart, linked by MRN");
  assert.equal(rep.patientId, adm.patientId); assert.equal(rep.status, "final"); assert.equal(rep.serviceRequestId, "hl7v2-lab-genhosp-sr-plc-9");
  const k = await RECORD.latest(TENANT_ROW.id, "Observation", "hl7v2-lab-genhosp-obs-fil-9-2");
  assert.equal(k.value, 6.1); assert.equal(k.codeSystem, "http://loinc.org"); assert.equal(k.terminologyStatus, "verified");
  // The laboratory's order is the feed's, draft and external: not on this ward's collection worklist, not pending here.
  const coll = await as(NURSE, `/ward/collections?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.ok(!(coll.requests || []).some((x) => x.serviceRequestId === "hl7v2-lab-genhosp-sr-plc-9"));
  // The receipt: the message verbatim, its outcome, no Z-segment interpreted.
  const receipts = await RECORD.latestByType(TENANT_ROW.id, "ExchangeMessage", 50);
  const found = receipts.find((m) => m.controlId === "MSG-ORU");
  assert.ok(found, "the receipt for the ORU was written");
  assert.equal(found.outcome, "filed"); assert.match(found.raw, /^MSH\|/); assert.equal(found.protocol, "hl7v2");
  assert.ok(receipts.some((m) => m.controlId === "MSG-T" && m.outcome === "refused") === false, "a message the profile rejected never reached the landing, so it has no receipt");
});

test("AUDIT: every imported row and every token carries who, as what, and for whom", async () => {
  seedHospital(); enableInboundFhir(); resetRateLimit();
  const lab = await smartBackendClient("lab-sys");
  enableSmart([lab.config]);
  const { adm } = await admittedPatientOnDrug();
  const mark = RECORD.audit.length;
  await pushFhir(DOCTOR, `/ward/fhir?orgId=${ORG}`, partnerBundle({ bundleId: "aud-1", suffix: "-aud" }));
  const ingests = RECORD.audit.slice(mark).filter((a) => a.action === "record.ingest");
  assert.ok(ingests.length >= 8, `ingest rows ${ingests.length}`);
  assert.ok(ingests.every((a) => a.actor === "adapter:fhir-partner-his"), "attributed to the feed, never to the doctor");
  assert.ok(ingests.every((a) => a.scope && a.scope.system === "fhir-partner-his"));
  assert.ok(ingests.every((a) => !JSON.stringify(a).includes("Partner Testcase")), "PHI-free: no name in the audit");

  const denied = await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: await lab.sign({ iss: "lab-sys", sub: "lab-sys", aud: "https://wrong/", exp: Math.floor(Date.now() / 1000) + 60, jti: "aud-j0" }) }));
  assert.equal(denied.status, 401);
  assert.ok(RECORD.audit.some((a) => a.action === "smart.token.denied" && a.scope && a.scope.clientId === "lab-sys"));
  const ok = await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: await lab.sign({ iss: "lab-sys", sub: "lab-sys", aud: `https://x/api/fhir/${ORG}/smart/token`, exp: Math.floor(Date.now() / 1000) + 60, jti: "aud-j1" }) }));
  assert.equal(ok.status, 200);
  const issued = RECORD.audit.find((a) => a.action === "smart.token" && a.actor === "smart:lab-sys");
  assert.ok(issued);
  assert.ok(!JSON.stringify(issued).includes((await ok.json()).access_token), "the token itself is never in the audit");
});

/** A signing key for id_tokens, in the shape the deployment holds it (a private JWK in an env secret). */
async function signingJwk() {
  const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", kp.privateKey);
  return JSON.stringify({ ...jwk, kid: "wsq-test-key" });
}
/** The flow a SMART application runs, as a function: GET the consent screen, POST allow, exchange the code. */
async function smartCodeFlow(o) {
  const verifier = "v".repeat(20) + "ERIFIER-with-enough-length-to-be-legal-abcdef0123456789";
  const challenge = b64u(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const params = new URLSearchParams({ response_type: "code", client_id: o.clientId, redirect_uri: o.redirectUri, scope: o.scope, state: "s1", code_challenge: challenge, code_challenge_method: "S256", ...(o.launch ? { launch: o.launch } : {}), ...(o.nonce ? { nonce: o.nonce } : {}) }).toString();
  const screen = await viaFhirDoor(`${ORG}/smart/authorize?${params}`, { email: o.email || DOCTOR });
  const screenText = await screen.text();
  if (screen.status !== 200) return { screen, screenText };
  const authz = (/name="authz" value="([^"]+)"/.exec(screenText) || [])[1];
  const az = await viaFhirDoor(`${ORG}/smart/authorize`, { ...form({ authz, decision: "allow", ...(o.patientInput ? { patient: o.patientInput } : {}) }), email: o.email || DOCTOR });
  if (az.status !== 302) return { screen, screenText, az, azText: await az.text() };
  const code = new URL(az.headers.get("location")).searchParams.get("code");
  const tok = await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "authorization_code", client_id: o.clientId, code, code_verifier: verifier, redirect_uri: o.redirectUri }));
  const tokText = await tok.text();
  return { screen, screenText, az, tok, tokText, token: tok.status === 200 ? JSON.parse(tokText) : null };
}

test("SMART: an EHR launch fixes the patient before consent; patient/ scopes are FENCED to that compartment on every read, not by a parameter; the token says which patient", async () => {
  seedHospital(); resetRateLimit();
  const app = { clientId: "bedside-app", name: "Bedside app", kind: "public", redirectUris: ["https://bedside.example/cb"], scopes: ["launch", "launch/patient", "patient/*.read", "user/Patient.read", "offline_access", "openid", "fhirUser"] };
  enableSmart([app]);
  const { adm } = await admittedPatientOnDrug();
  // A second patient on the ward, whose chart the token must never see.
  const other = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Other Person", mobile: "9876500022", gender: "male", ageYears: 36 });
  const otherAdm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: other.mrn, ward: "Medical A", bed: "14", admittedAt: "2026-09-07T09:00:00.000Z" });
  const otherId = otherAdm.patientId;
  assert.ok(otherId, JSON.stringify(otherAdm).slice(0, 200));

  // The ward launches the app for THIS patient: a clinician's own capability, a token that lives five minutes.
  const launch = await as(DOCTOR, "/ward/smart-launch", "POST", { orgId: ORG, clientId: "bedside-app", patientId: adm.patientId, encounterId: adm.encounterId });
  assert.equal(launch.__status, 200, JSON.stringify(launch).slice(0, 200));
  assert.ok(launch.launch && launch.launch.length > 20);
  assert.equal((await as(DOCTOR, "/ward/smart-launch", "POST", { orgId: ORG, clientId: "chart-viewer", patientId: adm.patientId })).__status, 400, "an unregistered or non-launch client cannot be launched");
  assert.equal((await as(DOCTOR, "/ward/smart-launch", "POST", { orgId: ORG, clientId: "bedside-app", patientId: "nobody" })).__status, 404);

  const r = await smartCodeFlow({ clientId: "bedside-app", redirectUri: "https://bedside.example/cb", scope: "launch patient/Observation.read patient/Encounter.read user/Patient.read offline_access", launch: launch.launch });
  assert.equal(r.screen.status, 200, r.screenText);
  assert.match(r.screenText, new RegExp(`Confined to patient <strong>${adm.patientId}`), "the consent screen names the patient it is confined to");
  assert.ok(r.token, r.tokText || (r.azText || ""));
  assert.equal(r.token.patient, adm.patientId, "the token says which patient");
  assert.equal(r.token.encounter, adm.encounterId);
  assert.ok(r.token.refresh_token, "offline_access was granted");
  assert.ok(!r.token.id_token, "openid was not requested");
  const t = r.token.access_token;

  // Their own observations: yes, with or without patient=. Another patient's: refused, whatever the parameter says.
  const mine = await (await viaFhirDoor(`${ORG}/Observation`, { bearer: t })).json();
  assert.equal(mine.resourceType, "Bundle"); assert.ok(mine.total >= 1);
  assert.ok(mine.entry.every((e) => e.resource.subject.reference === `Patient/${adm.patientId}`));
  assert.equal((await viaFhirDoor(`${ORG}/Observation?patient=${otherId}`, { bearer: t })).status, 403, "fenced: the parameter does not widen the token");
  assert.equal((await viaFhirDoor(`${ORG}/Patient/${otherId}/$everything`, { bearer: t })).status, 403);
  assert.equal((await viaFhirDoor(`${ORG}/Encounter/${adm.encounterId}`, { bearer: t })).status, 200);
  // A read of a specific resource that belongs to another patient is refused even by direct id.
  const otherVitals = await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: otherAdm.encounterId, patientId: otherId, vitals: { pulse: "70" } });
  assert.equal(otherVitals.__status, 200, JSON.stringify(otherVitals).slice(0, 200));
  const otherObs = (await as(DOCTOR, `/ward/fhir/Observation?orgId=${ORG}&patient=${otherId}`)).entry[0].resource.id;
  assert.equal((await viaFhirDoor(`${ORG}/Observation/${otherObs}`, { bearer: t })).status, 403);
  assert.equal((await viaFhirDoor(`${ORG}/Observation/${otherObs}/_history`, { bearer: t })).status, 403);
  // user/Patient.read was granted too: THAT type is not fenced, so the roster read the user scope allows still works.
  assert.equal((await viaFhirDoor(`${ORG}/Patient/${otherId}`, { bearer: t })).status, 200, "user/ scope on Patient is not narrowed by the patient context");
  // Condition was not granted at all: 403 from the governed store, as before.
  assert.equal((await viaFhirDoor(`${ORG}/Condition`, { bearer: t })).status, 403);

  // The launch is single use, and a different clinician cannot consume it.
  const again = await smartCodeFlow({ clientId: "bedside-app", redirectUri: "https://bedside.example/cb", scope: "launch patient/Observation.read", launch: launch.launch });
  assert.equal(again.screen.status, 302, "a spent launch goes back to the app as an error");
  assert.match(again.screen.headers.get("location"), /error=invalid_request/);
  const launch2 = await as(DOCTOR, "/ward/smart-launch", "POST", { orgId: ORG, clientId: "bedside-app", patientId: adm.patientId });
  const stranger = await smartCodeFlow({ clientId: "bedside-app", redirectUri: "https://bedside.example/cb", scope: "launch patient/Observation.read", launch: launch2.launch, email: LOCUM });
  assert.equal(stranger.screen.status, 302);
  assert.match(stranger.screen.headers.get("location"), /error=invalid_request/);
  // patient/ scopes with no context at all are refused before anyone is asked.
  const noctx = await smartCodeFlow({ clientId: "bedside-app", redirectUri: "https://bedside.example/cb", scope: "patient/Observation.read" });
  assert.equal(noctx.screen.status, 302);
  assert.match(noctx.screen.headers.get("location"), /error=invalid_scope/);

  // STANDALONE: launch/patient asks the clinician to name the patient, by MRN, and refuses a stranger's name.
  const wrong = await smartCodeFlow({ clientId: "bedside-app", redirectUri: "https://bedside.example/cb", scope: "launch/patient patient/Observation.read", patientInput: "NOBODY-9" });
  assert.equal(wrong.az && wrong.az.status, 200, "asked again on the same screen");
  assert.match(wrong.azText, /No patient here matches/);
  const patRec = await (await viaFhirDoor(`${ORG}/Patient/${adm.patientId}`, { bearer: t })).json();
  const mrn = patRec.identifier.find((i) => i.system === "urn:stewardmd:mrn").value;
  const standalone = await smartCodeFlow({ clientId: "bedside-app", redirectUri: "https://bedside.example/cb", scope: "launch/patient patient/Observation.read", patientInput: mrn });
  assert.ok(standalone.token, standalone.tokText || standalone.azText);
  assert.equal(standalone.token.patient, adm.patientId);
  assert.equal((await viaFhirDoor(`${ORG}/Observation?patient=${otherId}`, { bearer: standalone.token.access_token })).status, 403);

  // REFRESH: rotated on use; the old one is dead; presenting a dead one again kills the family.
  const rt = r.token.refresh_token;
  const refreshed = await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "refresh_token", client_id: "bedside-app", refresh_token: rt }));
  const refreshedText = await refreshed.text();
  assert.equal(refreshed.status, 200, refreshedText);
  const r2 = JSON.parse(refreshedText);
  assert.ok(r2.access_token && r2.refresh_token && r2.refresh_token !== rt);
  assert.equal(r2.patient, adm.patientId, "the patient context survives a refresh");
  assert.equal((await viaFhirDoor(`${ORG}/Observation`, { bearer: r2.access_token })).status, 200);
  const reuse = await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "refresh_token", client_id: "bedside-app", refresh_token: rt }));
  assert.equal(reuse.status, 400, "a rotated refresh token presented again");
  assert.equal((await viaFhirDoor(`${ORG}/Observation`, { bearer: r2.access_token })).status, 401, "and the whole family is revoked: the newest access token is dead");
  assert.equal((await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "refresh_token", client_id: "bedside-app", refresh_token: r2.refresh_token }))).status, 400);
  assert.ok(RECORD.audit.some((a) => a.action === "smart.refresh.reuse"));
});

test("SMART: openid issues an ES256 id_token verifiable at jwks.json, fhirUser resolves to the bearer's own Practitioner and nothing else; without a key the scope is dropped and said so", async () => {
  seedHospital(); resetRateLimit();
  const app = { clientId: "id-app", name: "Identity app", kind: "public", redirectUris: ["https://id.example/cb"], scopes: ["user/Patient.read", "openid", "fhirUser"] };
  enableSmart([app]);
  const { adm } = await admittedPatientOnDrug();
  // No key: openid is not offered, not granted, and the consent screen says it will not be.
  delete ENV.WSQ_SMART_SIGNING_JWK;
  const conf0 = await (await viaFhirDoor(`${ORG}/.well-known/smart-configuration`)).json();
  assert.ok(!conf0.jwks_uri && !conf0.scopes_supported.includes("openid") && !conf0.capabilities.includes("sso-openid-connect"));
  const nokey = await smartCodeFlow({ clientId: "id-app", redirectUri: "https://id.example/cb", scope: "user/Patient.read openid", nonce: "n1" });
  assert.match(nokey.screenText, /will NOT get[\s\S]*openid/);
  assert.ok(nokey.token && !nokey.token.id_token);

  ENV.WSQ_SMART_SIGNING_JWK = await signingJwk();
  const conf = await (await viaFhirDoor(`${ORG}/.well-known/smart-configuration`)).json();
  assert.equal(conf.jwks_uri, `https://x/api/fhir/${ORG}/.well-known/jwks.json`);
  assert.ok(conf.capabilities.includes("sso-openid-connect"));
  const jwks = await (await viaFhirDoor(`${ORG}/.well-known/jwks.json`)).json();
  assert.equal(jwks.keys.length, 1); assert.equal(jwks.keys[0].kid, "wsq-test-key"); assert.ok(!("d" in jwks.keys[0]), "the private half never leaves");

  const r = await smartCodeFlow({ clientId: "id-app", redirectUri: "https://id.example/cb", scope: "user/Patient.read openid fhirUser", nonce: "n2" });
  assert.ok(r.token && r.token.id_token, r.tokText);
  const [h, p, s] = r.token.id_token.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString()), claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(header.alg, "ES256"); assert.equal(header.kid, "wsq-test-key");
  assert.equal(claims.iss, `https://x/api/fhir/${ORG}`); assert.equal(claims.aud, "id-app"); assert.equal(claims.sub, idFor(DOCTOR)); assert.equal(claims.nonce, "n2");
  assert.equal(claims.fhirUser, `https://x/api/fhir/${ORG}/Practitioner/${encodeURIComponent(idFor(DOCTOR))}`);
  const pub = await webcrypto.subtle.importKey("jwk", jwks.keys[0], { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.equal(await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`)), true, "verifies with the published key");
  const me = await viaFhirDoor(`${ORG}/Practitioner/${encodeURIComponent(idFor(DOCTOR))}`, { bearer: r.token.access_token });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).id, idFor(DOCTOR));
  assert.equal((await viaFhirDoor(`${ORG}/Practitioner/${encodeURIComponent(idFor(NURSE))}`, { bearer: r.token.access_token })).status, 404, "only its own");
  delete ENV.WSQ_SMART_SIGNING_JWK;
});

test("SMART: a backend client registered with a jwks_uri is verified against keys fetched through the hardened fetch, cached, and refreshed once on an unknown kid", async () => {
  seedHospital(); resetRateLimit();
  const { resetJwksCache } = await import("../functions/_wardsynq/smart-server.js");
  resetJwksCache();
  const lab = await smartBackendClient("lab-uri");
  const remote = { keys: lab.config.jwks.keys };
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { fetched.push(String(url)); return new Response(JSON.stringify(remote), { status: 200 }); };
  try {
    enableSmart([{ clientId: "lab-uri", name: "Lab by URL", kind: "backend", scopes: ["system/Observation.read"], jwksUri: "https://keys.example/lab/jwks.json" }]);
    await admittedPatientOnDrug();
    const tokenUrl = `https://x/api/fhir/${ORG}/smart/token`;
    const claims = () => ({ iss: "lab-uri", sub: "lab-uri", aud: tokenUrl, exp: Math.floor(Date.now() / 1000) + 120, jti: "j-" + Math.random().toString(36).slice(2) });
    const cc = async (assertion) => viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion }));
    const ok = await cc(await lab.sign(claims()));
    assert.equal(ok.status, 200, await ok.text());
    assert.deepEqual(fetched, ["https://keys.example/lab/jwks.json"], "fetched from the URL the HOSPITAL registered");
    await cc(await lab.sign(claims()));
    assert.equal(fetched.length, 1, "cached");
    // The key rotates at the source: the cached set misses the new kid, one fresh fetch finds it.
    const lab2 = await smartBackendClient("lab-uri");
    remote.keys = [{ ...lab2.config.jwks.keys[0], kid: "k2" }];
    const rotated = await cc(await lab2.sign({ ...claims() }).then((j) => j));
    // lab2 signs with kid k1 in its header (the helper's fixed kid); the remote now holds k2 only, so this must fail verification, not crash.
    assert.equal(rotated.status, 401);
    assert.equal(fetched.length, 2, "one fresh fetch on a miss, then the honest answer");
    // A client with neither inline keys nor a registered URL proves nothing.
    enableSmart([{ clientId: "lab-none", name: "No keys", kind: "backend", scopes: ["system/Observation.read"] }]);
    const none = await smartBackendClient("lab-none");
    assert.equal((await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: await none.sign({ iss: "lab-none", sub: "lab-none", aud: tokenUrl, exp: Math.floor(Date.now() / 1000) + 60, jti: "z" }) }))).status, 401);
  } finally { globalThis.fetch = realFetch; }
});

test("SMART: the token endpoint is rate limited per client, and says so with Retry-After", async () => {
  seedHospital(); resetRateLimit();
  const lab = await smartBackendClient("lab-sys");
  enableSmart([lab.config]);
  await admittedPatientOnDrug();
  let last;
  for (let i = 0; i < 31; i++) {
    last = await viaFhirDoor(`${ORG}/smart/token`, form({ grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: await lab.sign({ iss: "lab-sys", sub: "lab-sys", aud: "https://wrong/", exp: Math.floor(Date.now() / 1000) + 60, jti: "x" + i }) }));
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) >= 1);
  assert.equal((await last.json()).error, "temporarily_unavailable");
});
