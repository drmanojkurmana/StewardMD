/* test/wardsynq-surgery.test.mjs — the surgery/OT/PACU vertical, through the REAL routes.
 *
 * Booking -> consent (checked against the booking, via the REAL consent.js PatientConsent) -> site
 * marking -> WHO Sign In -> Time Out -> incision -> an implant logged -> Sign Out -> operative note
 * -> disposition to PACU. Same harness shape as wardsynq-ed.test.mjs / wardsynq-icu.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-surgery.test.mjs
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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"]]) {
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

// The checklist's three roles are self-declared strings inside a submission, not the app's own
// RBAC roles - the same convention wardsynq-surgical.test.mjs itself uses.
const THREE = [{ role: "surgeon", actorId: "dr-surgeon-1" }, { role: "anaesthetist", actorId: "dr-anaes-1" }, { role: "nurse", actorId: "nurse-scrub-1" }];
const allOf = (obj) => Object.fromEntries(obj.map((k) => [k, true]));
const SIGN_IN_ITEMS = ["identity-confirmed", "site-confirmed", "procedure-confirmed", "consent-confirmed", "site-marked-confirmed", "anaesthesia-safety-check", "pulse-oximeter-working", "allergies-reviewed", "airway-risk-assessed", "blood-loss-risk-assessed"];
const TIME_OUT_ITEMS = ["team-introduced", "identity-site-procedure-reconfirmed", "critical-events-anticipated", "antibiotic-prophylaxis-addressed", "imaging-displayed"];
const SIGN_OUT_ITEMS = ["procedure-recorded", "counts-correct", "specimens-labelled", "equipment-problems-addressed", "recovery-concerns-addressed"];

async function bookedCase(mrnSuffix) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "OT Testcase " + mrnSuffix, mobile: "9876500" + mrnSuffix, gender: "male", ageYears: 44 });
  const booking = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: reg.mrn, procedure: "Appendicectomy", site: "abdomen", laterality: "not-applicable", theatre: "OT-1", scheduledAt: "2026-09-09T07:00:00.000Z" } });
  return { reg, booking };
}

test("BOOKING opens a REAL class:SURGERY Encounter, linked to the case, never a shadow chart", async () => {
  seedHospital();
  const { reg, booking } = await bookedCase("101");
  assert.equal(booking.__status, 200, JSON.stringify(booking));
  assert.equal(booking.written, 2);
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", booking.encounterId);
  assert.equal(enc.class, "SURGERY"); assert.equal(enc.status, "in-progress"); assert.equal(enc.location.ward, "OT-1");
  const c = await RECORD.latest(TENANT_ROW.id, "SurgicalCase", booking.caseId);
  assert.equal(c.stage, "booked"); assert.equal(c.procedure, "Appendicectomy"); assert.equal(c.encounterId, booking.encounterId);

  // Retrying the SAME booking (same mrn, procedure, scheduled time) is idempotent, not a second case.
  const again = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: reg.mrn, procedure: "Appendicectomy", site: "abdomen", laterality: "not-applicable", theatre: "OT-1", scheduledAt: "2026-09-09T07:00:00.000Z" } });
  assert.equal(again.__status, 200, JSON.stringify(again));
  assert.equal(again.written, 0); assert.equal(again.skipped, "unchanged"); assert.equal(again.caseId, booking.caseId);
});

test("CONSENT is checked against THIS booking's procedure and side, through the REAL PatientConsent record", async () => {
  seedHospital();
  const { booking } = await bookedCase("102");
  const matching = await as(DOCTOR, "/ward/surgery-consent", "POST", { orgId: ORG, caseId: booking.caseId, consent: { procedure: "Appendicectomy", laterality: "not-applicable", signedByPatientOrProxy: true, givenBy: "patient" } });
  assert.equal(matching.__status, 200, JSON.stringify(matching));
  assert.equal(matching.written, 2, "a real PatientConsent AND the case's own consent field, both written");
  const pc = await RECORD.latest(TENANT_ROW.id, "PatientConsent", matching.consent.consentId);
  assert.equal(pc.decision, "granted"); assert.equal(pc.scope, "procedure");

  const { booking: b2 } = await bookedCase("103");
  const mismatch = await as(DOCTOR, "/ward/surgery-consent", "POST", { orgId: ORG, caseId: b2.caseId, consent: { procedure: "Cholecystectomy", laterality: "not-applicable", signedByPatientOrProxy: true } });
  assert.equal(mismatch.__status, 409); assert.equal(mismatch.code, "CONSENT_MISMATCH", JSON.stringify(mismatch));
  // The PatientConsent document itself was still written (it is real, honest documentation of what
  // was actually signed) - only the CASE's own checklist state refuses to accept it as a match.
  assert.equal(mismatch.written, 1);
});

test("THE GOLDEN PATH: consent -> mark site -> Sign In -> Time Out -> incision -> implant logged -> Sign Out -> operative note -> disposition to PACU", async () => {
  seedHospital();
  const { booking } = await bookedCase("104");
  const caseId = booking.caseId;

  await as(DOCTOR, "/ward/surgery-consent", "POST", { orgId: ORG, caseId, consent: { procedure: "Appendicectomy", laterality: "not-applicable", signedByPatientOrProxy: true } });
  const marked = await as(DOCTOR, "/ward/surgery-marksite", "POST", { orgId: ORG, caseId, marking: { site: "abdomen", laterality: "not-applicable" } });
  assert.equal(marked.__status, 200, JSON.stringify(marked)); assert.equal(marked.stage, "marked");

  const signIn = await as(DOCTOR, "/ward/surgery-signin", "POST", { orgId: ORG, caseId, submission: { items: allOf(SIGN_IN_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  assert.equal(signIn.__status, 200, JSON.stringify(signIn)); assert.equal(signIn.stage, "signed-in");

  await as(DOCTOR, "/ward/anesthesia-start", "POST", { orgId: ORG, caseId, asaClass: "ASA II" });
  const drug = await as(DOCTOR, "/ward/anesthesia-event", "POST", { orgId: ORG, caseId, event: { drug: "Propofol", dose: "150 mg", route: "IV" } });
  assert.equal(drug.__status, 200, JSON.stringify(drug)); assert.equal(drug.events.length, 1);

  const timeOut = await as(DOCTOR, "/ward/surgery-timeout", "POST", { orgId: ORG, caseId, submission: { items: allOf(TIME_OUT_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  assert.equal(timeOut.__status, 200, JSON.stringify(timeOut)); assert.equal(timeOut.stage, "timed-out");

  const incised = await as(DOCTOR, "/ward/surgery-incise", "POST", { orgId: ORG, caseId });
  assert.equal(incised.__status, 200, JSON.stringify(incised)); assert.equal(incised.stage, "incised");

  const implant = await as(DOCTOR, "/ward/implant", "POST", { orgId: ORG, caseId, implant: { device: "Endo-GIA stapler load", lot: "LOT-2291", serial: "SN-88213" } });
  assert.equal(implant.__status, 200, JSON.stringify(implant));
  const implants = await as(DOCTOR, `/ward/implant-list?orgId=${ORG}&patientId=${booking.patientId}`);
  assert.equal(implants.implants.length, 1); assert.equal(implants.implants[0].lot, "LOT-2291");

  const signOut = await as(DOCTOR, "/ward/surgery-signout", "POST", { orgId: ORG, caseId, submission: { items: allOf(SIGN_OUT_ITEMS), signatures: THREE } });
  assert.equal(signOut.__status, 200, JSON.stringify(signOut)); assert.equal(signOut.stage, "signed-out");

  await as(DOCTOR, "/ward/anesthesia-end", "POST", { orgId: ORG, caseId });
  const anes = await as(DOCTOR, `/ward/anesthesia-get?orgId=${ORG}&caseId=${caseId}`);
  assert.ok(anes.record.endedAt, "anaesthesia end is real, not just the case's own state");

  const note = await as(DOCTOR, "/ward/surgery-note", "POST", { orgId: ORG, caseId, note: "Uncomplicated appendicectomy." });
  assert.equal(note.__status, 200, JSON.stringify(note));

  const disposed = await as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId, disposition: "pacu", pacuBed: "P1" });
  assert.equal(disposed.__status, 200, JSON.stringify(disposed)); assert.equal(disposed.written, 2);
  const theatreEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", booking.encounterId);
  assert.equal(theatreEnc.status, "finished", "the SURGERY encounter is closed, not left open forever");
  const pacuEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", disposed.pacuEncounterId);
  assert.equal(pacuEnc.class, "PACU"); assert.equal(pacuEnc.status, "in-progress"); assert.equal(pacuEnc.location.bed, "P1");
});

test("THE GATE: incision is unreachable without both Sign In and Time Out; sign out with wrong counts refuses; one person cannot sign all three roles", async () => {
  seedHospital();
  const { booking } = await bookedCase("105");
  const caseId = booking.caseId;
  await as(DOCTOR, "/ward/surgery-consent", "POST", { orgId: ORG, caseId, consent: { procedure: "Appendicectomy", laterality: "not-applicable", signedByPatientOrProxy: true } });
  await as(DOCTOR, "/ward/surgery-marksite", "POST", { orgId: ORG, caseId, marking: { site: "abdomen", laterality: "not-applicable" } });

  const skipped = await as(DOCTOR, "/ward/surgery-incise", "POST", { orgId: ORG, caseId });
  assert.equal(skipped.__status, 409); assert.equal(skipped.code, "SIGN_IN_INCOMPLETE", JSON.stringify(skipped));

  const onePerson = await as(DOCTOR, "/ward/surgery-signin", "POST", { orgId: ORG, caseId, submission: { items: allOf(SIGN_IN_ITEMS), signatures: [{ role: "surgeon", actorId: "dr-x" }, { role: "anaesthetist", actorId: "dr-x" }, { role: "nurse", actorId: "dr-x" }], lateralityAsserted: "not-applicable" } });
  assert.equal(onePerson.__status, 409); assert.equal(onePerson.code, "SIGNATURES_NOT_INDEPENDENT", JSON.stringify(onePerson));

  await as(DOCTOR, "/ward/surgery-signin", "POST", { orgId: ORG, caseId, submission: { items: allOf(SIGN_IN_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  await as(DOCTOR, "/ward/surgery-timeout", "POST", { orgId: ORG, caseId, submission: { items: allOf(TIME_OUT_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  await as(DOCTOR, "/ward/surgery-incise", "POST", { orgId: ORG, caseId });

  const badCounts = await as(DOCTOR, "/ward/surgery-signout", "POST", { orgId: ORG, caseId, submission: { items: { ...allOf(SIGN_OUT_ITEMS), "counts-correct": false }, signatures: THREE } });
  assert.equal(badCounts.__status, 409); assert.equal(badCounts.code, "COUNTS_INCORRECT", JSON.stringify(badCounts));
});

test("RBAC: a nurse (no emr.treat) cannot book a case or advance the checklist", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "RBAC Check", mobile: "9876509999", gender: "female", ageYears: 30 });
  const refused = await as(NURSE, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: reg.mrn, procedure: "Appendicectomy", laterality: "not-applicable" } });
  assert.equal(refused.__status, 403, JSON.stringify(refused));
});

test("a surgical case exports its Encounter as FHIR-CONFORMANT (class IMP), and appears on the downtime pack and in ward metrics", async () => {
  seedHospital();
  const { booking } = await bookedCase("106");
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/fhir/Encounter/${booking.encounterId}?orgId=${ORG}`, { headers: { "Cf-Access-Authenticated-User-Email": DOCTOR } }), env: ENV });
  const enc = await res.json();
  assert.equal(res.status, 200, JSON.stringify(enc));
  assert.deepEqual(enc.class, { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" });

  const pack = await as(DOCTOR, `/ward/downtime?orgId=${ORG}`);
  assert.equal(pack.__status, 200, JSON.stringify(pack));
  assert.ok(pack.patients.some((p) => p.patientId === booking.patientId));

  const metrics = await as(DOCTOR, `/ward/metrics?orgId=${ORG}&ward=OT-1`);
  assert.equal(metrics.__status, 200, JSON.stringify(metrics));
  assert.equal(metrics.metrics.patients, 1);
});

test("THE THEATRE BOARD lists every open case hospital-wide, and drops one once it is disposed", async () => {
  seedHospital();
  const { booking } = await bookedCase("107");
  const board1 = await as(NURSE, `/ward/surgery-board?orgId=${ORG}`);
  assert.equal(board1.__status, 200, JSON.stringify(board1));
  assert.ok(board1.cases.some((c) => c.id === booking.caseId && c.theatre === "OT-1"));

  await as(DOCTOR, "/ward/surgery-consent", "POST", { orgId: ORG, caseId: booking.caseId, consent: { procedure: "Appendicectomy", laterality: "not-applicable", signedByPatientOrProxy: true } });
  await as(DOCTOR, "/ward/surgery-marksite", "POST", { orgId: ORG, caseId: booking.caseId, marking: { site: "abdomen", laterality: "not-applicable" } });
  await as(DOCTOR, "/ward/surgery-signin", "POST", { orgId: ORG, caseId: booking.caseId, submission: { items: allOf(SIGN_IN_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  await as(DOCTOR, "/ward/surgery-timeout", "POST", { orgId: ORG, caseId: booking.caseId, submission: { items: allOf(TIME_OUT_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  await as(DOCTOR, "/ward/surgery-incise", "POST", { orgId: ORG, caseId: booking.caseId });
  await as(DOCTOR, "/ward/surgery-signout", "POST", { orgId: ORG, caseId: booking.caseId, submission: { items: allOf(SIGN_OUT_ITEMS), signatures: THREE } });
  await as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId: booking.caseId, disposition: "direct-discharge" });

  const board2 = await as(NURSE, `/ward/surgery-board?orgId=${ORG}`);
  assert.ok(!board2.cases.some((c) => c.id === booking.caseId), "a disposed case's encounter is closed, so it leaves the open theatre board");
});
