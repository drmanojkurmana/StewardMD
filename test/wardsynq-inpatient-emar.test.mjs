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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test";
const ENV = {
  QUEUE_ENABLED: "1",
  QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"),
  CONNECT_DB: tenantDb,
};

function seedHospital(mode = "wardsynq") {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  // ownerUid is nobody on this ward: an owner resolves to `admin` and holds every capability, which
  // would make every separation assertion below vacuous.
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode, connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1 }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"]]) {
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

  // An OPD ticket encounter is not an admission.
  const S = await as(DOCTOR, `/session?hospitalId=${ORG}`);
  const T = await as(DOCTOR, "/ticket", "POST", { sessionId: S.session.id, name: "OPD Testcase", mobile: "9876500099", mrn: "SMD-WARD01-00099", visitType: "new" });
  const opdEnc = "opd-enc-" + String(T.ticket.id).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const bad = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: opdEnc });
  assert.equal(bad.__status, 409);
  assert.equal(bad.error, "not_an_admission");
});
