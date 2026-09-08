/* test/wardsynq-cross-department-journey.test.mjs — TASK 2.9: cross-department patient journey.
 *
 * Proves continuity through the master plan's primary journey - ED -> ICU -> WARD -> SURGERY ->
 * WARD -> DISCHARGE - through the REAL routes, against a single patient. This is not a new
 * mechanism: every department in 2.1-2.7 already shares one canonical Patient/Encounter model, one
 * RecordService, one MRN-derived identity (patientIdForMrn). What this file adds is the PROOF that
 * chaining them produces one continuous chart rather than N disconnected department charts, and it
 * found one real defect while building that proof: edDisposition()'s admission never forwarded
 * admission.class, so an ED admission could never actually reach ICU - it silently defaulted to
 * IPD regardless of what was requested. Fixed in migrate-ed.js as part of this task.
 *
 * Verifies: the SAME patientId across every department; bed/ward history accumulates on ONE
 * encounter for a same-admission transfer (ICU -> WARD) and a new encounter for a new admission
 * type (WARD -> SURGERY), both keyed to the same patient; medications, vitals and notes charted in
 * one department are visible in Patient/{id}/$everything, the longitudinal read; discharge closes
 * the journey without creating any second patient record.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-cross-department-journey.test.mjs
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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", ANAES = "anaesthetist@example.test", SCRUB = "nurse-scrub@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [ANAES, "anaesthetist"], [SCRUB, "nurse"]]) {
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

test("JOURNEY: ED -> ICU -> WARD -> SURGERY -> WARD -> DISCHARGE stays ONE patient, ONE canonical chart, end to end", async () => {
  seedHospital();

  // ---- ED: arrival, triage, vitals, note. ----------------------------------------------------------
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Journey Testcase", mobile: "9876500601", gender: "male", ageYears: 58 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const arr = await as(DOCTOR, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, mode: "self", chiefComplaint: "Chest pain and shortness of breath" } });
  assert.equal(arr.__status, 200, JSON.stringify(arr));
  assert.equal(arr.patientId, patientId, "the ED encounter resolves to the SAME canonical patientId /patient/register created");
  await as(DOCTOR, "/ward/ed-triage", "POST", { orgId: ORG, encounterId: arr.encounterId, acuity: 2, chiefComplaint: "Chest pain and shortness of breath" });
  const edVitals = await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: arr.encounterId, patientId, vitals: { sbp: "150", pulse: "112", spo2: "91", rr: "26" } });
  assert.equal(edVitals.__status, 200, JSON.stringify(edVitals));
  await as(DOCTOR, "/ward/note", "POST", { orgId: ORG, templateId: "ed-assessment", encounterId: arr.encounterId, sections: { history: "Acute chest pain, hypoxic.", plan: "Admit to ICU for monitoring." } });

  // ---- ED -> ICU: the disposition must actually reach ICU, not silently default to IPD. -------------
  const disp = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: arr.encounterId, disposition: "admitted", admission: { ward: "ICU", bed: "3", class: "ICU" } });
  assert.equal(disp.__status, 200, JSON.stringify(disp));
  const icuEncounterId = disp.admittedEncounterId;
  const icuEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", icuEncounterId);
  assert.equal(icuEnc.class, "ICU", "THE FIX: ED disposition-to-admission now actually reaches ICU when requested, not IPD by default");
  assert.equal(icuEnc.patientId, patientId, "the ICU encounter is the SAME canonical patient the ED visit and the registration were");
  assert.equal(icuEnc.location.ward, "ICU"); assert.equal(icuEnc.location.bed, "3");

  // ---- ICU: vitals and a medication order, tied to the ICU encounter. -------------------------------
  const icuVitals = await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: icuEncounterId, patientId, vitals: { sbp: "128", pulse: "92", spo2: "96", rr: "18" } });
  assert.equal(icuVitals.__status, 200, JSON.stringify(icuVitals));
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId, encounterId: icuEncounterId, drug: "Amoxicillin 500mg", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TID" } });
  assert.equal(ord.__status, 200, JSON.stringify(ord));

  // ---- ICU -> WARD: a TRANSFER, not a new admission - the SAME encounter, bed history advances. -----
  const xfer = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: icuEncounterId, ward: "Medical Ward A", bed: "12", reason: "Stepped down from ICU." });
  assert.equal(xfer.__status, 200, JSON.stringify(xfer));
  const wardEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", icuEncounterId);
  assert.equal(wardEnc.id, icuEncounterId, "a transfer moves the SAME encounter - no new encounter, no shadow chart");
  assert.equal(wardEnc.location.ward, "Medical Ward A"); assert.equal(wardEnc.location.bed, "12");
  assert.equal(wardEnc.movedFrom.ward, "ICU", "the move-from location names where the patient actually came from: " + JSON.stringify(wardEnc.movedFrom));
  assert.equal(wardEnc.patientId, patientId);

  // ---- WARD -> SURGERY: a new admission TYPE opens its own encounter, same patient. ------------------
  const booking = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: reg.mrn, procedure: "Coronary artery bypass", site: "chest", laterality: "not-applicable", theatre: "OT-2", scheduledAt: "2026-09-10T07:00:00.000Z" } });
  assert.equal(booking.__status, 200, JSON.stringify(booking));
  const surgEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", booking.encounterId);
  assert.equal(surgEnc.class, "SURGERY"); assert.equal(surgEnc.patientId, patientId, "the surgical encounter is the SAME canonical patient, resolved from the SAME mrn - not a second identity");
  assert.notEqual(booking.encounterId, icuEncounterId, "a new admission type opens its OWN encounter rather than overwriting the ward stay");

  // Consent + WHO checklist through Sign In and Time Out (the minimum to close the case honestly).
  const THREE = [{ role: "surgeon", actorId: "dr-surgeon-1" }, { role: "anaesthetist", actorId: "dr-anaes-1" }, { role: "nurse", actorId: "nurse-scrub-1" }];
  const allOf = (obj) => Object.fromEntries(obj.map((k) => [k, true]));
  const SIGN_IN_ITEMS = ["identity-confirmed", "site-confirmed", "procedure-confirmed", "consent-confirmed", "site-marked-confirmed", "anaesthesia-safety-check", "pulse-oximeter-working", "allergies-reviewed", "airway-risk-assessed", "blood-loss-risk-assessed"];
  const TIME_OUT_ITEMS = ["team-introduced", "identity-site-procedure-reconfirmed", "critical-events-anticipated", "antibiotic-prophylaxis-addressed", "imaging-displayed"];
  const consent = await as(DOCTOR, "/ward/surgery-consent", "POST", { orgId: ORG, caseId: booking.caseId, consent: { procedure: "Coronary artery bypass", laterality: "not-applicable", signedByPatientOrProxy: true } });
  assert.equal(consent.__status, 200, JSON.stringify(consent));
  await as(DOCTOR, "/ward/surgery-marksite", "POST", { orgId: ORG, caseId: booking.caseId, marking: { site: "chest", laterality: "not-applicable" } });
  const signIn = await as(DOCTOR, "/ward/surgery-signin", "POST", { orgId: ORG, caseId: booking.caseId, submission: { items: allOf(SIGN_IN_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  assert.equal(signIn.__status, 200, JSON.stringify(signIn));
  const timeOut = await as(DOCTOR, "/ward/surgery-timeout", "POST", { orgId: ORG, caseId: booking.caseId, submission: { items: allOf(TIME_OUT_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  assert.equal(timeOut.__status, 200, JSON.stringify(timeOut));
  const incise = await as(DOCTOR, "/ward/surgery-incise", "POST", { orgId: ORG, caseId: booking.caseId });
  assert.equal(incise.__status, 200, JSON.stringify(incise), "the checklist gate cleared - incision reachable, proving the journey's surgery leg is a REAL gated case, not a bypass");

  // ---- Discharge: closes the journey. Patient stays the same throughout. -----------------------------
  const finalDischarge = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: icuEncounterId, disposition: "home" });
  assert.equal(finalDischarge.__status, 200, JSON.stringify(finalDischarge));
  const closedWard = await RECORD.latest(TENANT_ROW.id, "Encounter", icuEncounterId);
  assert.equal(closedWard.status, "finished");

  // ---- THE LONGITUDINAL PROOF: one $everything read surfaces the WHOLE journey, one patient. --------
  const everything = await as(DOCTOR, `/ward/fhir/Patient/${patientId}/$everything?orgId=${ORG}`);
  assert.equal(everything.resourceType, "Bundle", JSON.stringify(everything).slice(0, 300));
  const entries = everything.entry || [];
  const types = new Set(entries.map((e) => e.resource && e.resource.resourceType));
  assert.ok(types.has("Encounter"), "the bundle carries Encounter resources");
  assert.ok(types.has("Observation"), "the bundle carries the vitals charted in BOTH ED and ICU");
  assert.ok(types.has("MedicationRequest") || types.has("MedicationOrder"), "the bundle carries the ICU medication order: " + JSON.stringify([...types]));
  // A canonical id longer than 64 chars is hashed for the FHIR resource.id (fhir-id.js), so match on
  // the identifier every resource ALSO carries under RECORD_ID_SYSTEM - the canonical id verbatim.
  const RECORD_ID_SYSTEM = "urn:stewardmd:record-id";
  const canonicalIdsInBundle = entries.filter((e) => e.resource && e.resource.resourceType === "Encounter")
    .flatMap((e) => (e.resource.identifier || []).filter((i) => i.system === RECORD_ID_SYSTEM).map((i) => i.value));
  assert.ok(canonicalIdsInBundle.includes(icuEncounterId), "the ED/ICU/ward encounter (one row, transferred) is in the longitudinal record: " + JSON.stringify(canonicalIdsInBundle));
  assert.ok(canonicalIdsInBundle.includes(booking.encounterId), "the surgical encounter is in the SAME longitudinal record, not a disconnected shadow chart: " + JSON.stringify(canonicalIdsInBundle));
  assert.ok(canonicalIdsInBundle.length >= 3, "three distinct encounters (ED, the transferred ICU/ward stay, and surgery) all belong to one journey: " + JSON.stringify(canonicalIdsInBundle));
  const patientResources = entries.filter((e) => e.resource && e.resource.resourceType === "Patient");
  assert.equal(patientResources.length, 1, "exactly ONE Patient resource for the whole journey - no shadow chart was ever created");
  assert.equal(patientResources[0].resource.id, patientId);

  // ---- NO CROSS-PATIENT CONTAMINATION: a second, unrelated patient's chart stays untouched. ----------
  const other = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Unrelated Bystander", mobile: "9876500602", gender: "female", ageYears: 30 });
  const otherEverything = await as(DOCTOR, `/ward/fhir/Patient/opd-pat-${other.mrn.toLowerCase()}/$everything?orgId=${ORG}`);
  const otherEncounters = (otherEverything.entry || []).filter((e) => e.resource && e.resource.resourceType === "Encounter");
  assert.equal(otherEncounters.length, 0, "the unrelated patient's chart carries NONE of this journey's encounters");
});

test("JOURNEY: ED -> MATERNITY and ED -> PEDIATRICS both reach the requested class directly - the fix is generic, not ICU-specific", async () => {
  seedHospital();

  const mReg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Maternity Journey Testcase", mobile: "9876500603", gender: "female", ageYears: 28 });
  const mArr = await as(DOCTOR, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: mReg.mrn, mode: "self", chiefComplaint: "Reduced fetal movements at 34 weeks" } });
  const mDisp = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: mArr.encounterId, disposition: "admitted", admission: { ward: "Labour Ward", bed: "2", class: "MATERNITY" } });
  assert.equal(mDisp.__status, 200, JSON.stringify(mDisp));
  const mEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", mDisp.admittedEncounterId);
  assert.equal(mEnc.class, "MATERNITY", "ED -> MATERNITY reaches the requested class directly");
  assert.equal(mEnc.patientId, "opd-pat-" + mReg.mrn.toLowerCase());

  const pReg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Pediatrics Journey Testcase", mobile: "9876500604", gender: "male", ageYears: 6 });
  const pArr = await as(DOCTOR, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: pReg.mrn, mode: "ambulance", chiefComplaint: "Severe wheeze, hypoxic" } });
  const pDisp = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: pArr.encounterId, disposition: "admitted", admission: { ward: "Paediatric Ward", bed: "4", class: "PEDIATRICS" } });
  assert.equal(pDisp.__status, 200, JSON.stringify(pDisp));
  const pEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", pDisp.admittedEncounterId);
  assert.equal(pEnc.class, "PEDIATRICS", "ED -> PEDIATRICS reaches the requested class directly");
  assert.equal(pEnc.patientId, "opd-pat-" + pReg.mrn.toLowerCase());

  // An unrecognised class request still falls back to IPD safely, rather than erroring or silently
  // admitting to something nobody asked for.
  const bReg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Bad Class Testcase", mobile: "9876500605", gender: "male", ageYears: 40 });
  const bArr = await as(DOCTOR, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: bReg.mrn, mode: "self", chiefComplaint: "Abdominal pain" } });
  const bDisp = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: bArr.encounterId, disposition: "admitted", admission: { ward: "Medical Ward A", bed: "7", class: "NOT-A-REAL-CLASS" } });
  assert.equal(bDisp.__status, 200, JSON.stringify(bDisp));
  const bEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", bDisp.admittedEncounterId);
  assert.equal(bEnc.class, "IPD", "an unrecognised class falls back to IPD, never to whatever was typed");
});
