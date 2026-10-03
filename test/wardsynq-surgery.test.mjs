import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
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

const { MemoryRepository, VersionConflictError } = await import("../functions/_wardsynq/repository.js");
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
const FIT_PAC = {
  history: "No comorbidities. No previous anaesthetic. No regular medicines. No known allergies.",
  airway: { mallampati: "II", mouthOpeningCm: 4.5, thyromentalDistanceCm: 7, neckMovement: "normal" },
  asaClass: "I", asaEmergency: false,
  fasting: { status: "adequate", solidsLastAt: "2026-09-08T22:00:00.000Z", clearFluidsLastAt: "2026-09-09T04:00:00.000Z" },
  investigations: { reviewed: true, summary: "Hb 13.2 g/dL" }, plan: { technique: "general" },
  consent: { obtained: true, givenBy: "patient" }, decision: "fit",
};
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

  const pac = await as(DOCTOR, "/ward/pac", "POST", { orgId: ORG, caseId, pac: FIT_PAC });
  assert.equal(pac.__status, 200, JSON.stringify(pac));
  const signIn = await as(DOCTOR, "/ward/surgery-signin", "POST", { orgId: ORG, caseId, submission: { items: allOf(SIGN_IN_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  assert.equal(signIn.__status, 200, JSON.stringify(signIn)); assert.equal(signIn.stage, "signed-in");
  const signedIn = await RECORD.latest(TENANT_ROW.id, "SurgicalCase", caseId);
  assert.equal(signedIn.signIn.pac.status, "fit", "sign in keeps what the checkup said at that moment");
  assert.equal(signedIn.signIn.pac.acknowledgement, null);

  const badTech = await as(DOCTOR, "/ward/anesthesia-start", "POST", { orgId: ORG, caseId, asaClass: "ASA II", technique: "hypnosis" });
  assert.equal(badTech.__status, 422); assert.equal(badTech.error, "bad_technique");
  await as(DOCTOR, "/ward/anesthesia-start", "POST", { orgId: ORG, caseId, asaClass: "ASA II", technique: "local-with-monitoring" });
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

  const ended = await as(DOCTOR, "/ward/anesthesia-end", "POST", { orgId: ORG, caseId, technique: "general" });
  assert.equal(ended.__status, 200, JSON.stringify(ended));
  const anes = await as(DOCTOR, `/ward/anesthesia-get?orgId=${ORG}&caseId=${caseId}`);
  assert.ok(anes.record.endedAt, "anaesthesia end is real, not just the case's own state");
  assert.deepEqual([anes.record.technique, anes.record.techniqueChangedFrom], ["general", "local-with-monitoring"], "a conversion keeps the technique it started under");

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

  await as(DOCTOR, "/ward/surgery-signin", "POST", { orgId: ORG, caseId, submission: { items: allOf(SIGN_IN_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable", pacAcknowledgement: "Checkup done on paper, entered later" } });
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
  await as(DOCTOR, "/ward/surgery-signin", "POST", { orgId: ORG, caseId: booking.caseId, submission: { items: allOf(SIGN_IN_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable", pacAcknowledgement: "Checkup done on paper, entered later" } });
  await as(DOCTOR, "/ward/surgery-timeout", "POST", { orgId: ORG, caseId: booking.caseId, submission: { items: allOf(TIME_OUT_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  await as(DOCTOR, "/ward/surgery-incise", "POST", { orgId: ORG, caseId: booking.caseId });
  await as(DOCTOR, "/ward/surgery-signout", "POST", { orgId: ORG, caseId: booking.caseId, submission: { items: allOf(SIGN_OUT_ITEMS), signatures: THREE } });
  await as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId: booking.caseId, disposition: "direct-discharge" });

  const board2 = await as(NURSE, `/ward/surgery-board?orgId=${ORG}`);
  assert.ok(!board2.cases.some((c) => c.id === booking.caseId), "a disposed case's encounter is closed, so it leaves the open theatre board");
});

/* ---- Codex F1 follow-up: the PACU bed takes the same claim admission and transfer take ---------- */

async function signedOutCase(suffix) {
  const { reg, booking } = await bookedCase(suffix);
  const caseId = booking.caseId;
  await as(DOCTOR, "/ward/surgery-consent", "POST", { orgId: ORG, caseId, consent: { procedure: "Appendicectomy", laterality: "not-applicable", signedByPatientOrProxy: true } });
  await as(DOCTOR, "/ward/surgery-marksite", "POST", { orgId: ORG, caseId, marking: { site: "abdomen", laterality: "not-applicable" } });
  await as(DOCTOR, "/ward/surgery-signin", "POST", { orgId: ORG, caseId, submission: { items: allOf(SIGN_IN_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable", pacAcknowledgement: "Checkup done on paper, entered later" } });
  await as(DOCTOR, "/ward/surgery-timeout", "POST", { orgId: ORG, caseId, submission: { items: allOf(TIME_OUT_ITEMS), signatures: THREE, lateralityAsserted: "not-applicable" } });
  await as(DOCTOR, "/ward/surgery-incise", "POST", { orgId: ORG, caseId });
  const out = await as(DOCTOR, "/ward/surgery-signout", "POST", { orgId: ORG, caseId, submission: { items: allOf(SIGN_OUT_ITEMS), signatures: THREE } });
  assert.equal(out.stage, "signed-out", JSON.stringify(out));
  return { reg, booking, caseId };
}
const openInBed = async (ward, bed) => (await RECORD.latestByStatus(TENANT_ROW.id, "Encounter", ["in-progress"], 1000))
  .filter((e) => String(e.location && e.location.ward).toLowerCase() === ward.toLowerCase() && String(e.location && e.location.bed) === bed);

test("PACU BED (Codex F1): an admission racing a PACU disposition for the same bed - exactly one lands, the loser gets 409", async () => {
  seedHospital();
  const { booking, caseId } = await signedOutCase("120");
  const other = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Ward Racer", mobile: "9876500121", gender: "female", ageYears: 52 });

  // Both requests are held at the open-census read until both arrive, then at the bed-claim read, so
  // neither sees the other: the claim's own version race decides.
  const realPage = RECORD.pageByType.bind(RECORD), realLatest = RECORD.latest.bind(RECORD), realAppend = RECORD.append.bind(RECORD);
  let arrived = 0, claimReads = 0, claimConflicts = 0, openCensus, openClaims;
  const census = new Promise((r) => { openCensus = r; }), claims = new Promise((r) => { openClaims = r; });
  const timer = setTimeout(() => { openCensus(); openClaims(); }, 1000);
  RECORD.pageByType = async (t, type, o) => { if (type === "Encounter") { if (++arrived === 2) openCensus(); await census; } return realPage(t, type, o); };
  RECORD.latest = async (t, type, id) => { if (type === "_wardsynq_bed_claim") { if (++claimReads === 2) openClaims(); await claims; } return realLatest(t, type, id); };
  RECORD.append = async (t, records, ctx) => {
    try { return await realAppend(t, records, ctx); }
    catch (e) { if (e instanceof VersionConflictError && records.some((r) => r.resourceType === "_wardsynq_bed_claim")) claimConflicts += 1; throw e; }
  };
  let pacu, adm;
  try {
    [pacu, adm] = await Promise.all([
      as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId, disposition: "pacu", pacuBed: "P2" }),
      as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: other.mrn, ward: "PACU", bed: "P2" }),
    ]);
  } finally { clearTimeout(timer); RECORD.pageByType = realPage; RECORD.latest = realLatest; RECORD.append = realAppend; }

  assert.equal(claimConflicts, 1, "the shared bed claim decided it: " + JSON.stringify([pacu, adm]));
  const won = [pacu, adm].filter((r) => r.__status === 200), lost = [pacu, adm].filter((r) => r.__status === 409 && r.error === "bed_occupied");
  assert.equal(won.length, 1, JSON.stringify([pacu, adm])); assert.equal(lost.length, 1, JSON.stringify([pacu, adm]));
  assert.equal((await openInBed("PACU", "P2")).length, 1, "exactly one patient in PACU bed P2");
  if (lost[0] === pacu) {
    const theatre = await RECORD.latest(TENANT_ROW.id, "Encounter", booking.encounterId);
    assert.equal(theatre.status, "in-progress", "a refused PACU move wrote nothing: the theatre stay is not closed into nowhere");
    assert.equal(pacu.written, 0);
  }
});

test("PACU BED (Codex F1): a recovery patient holds the bed against a ward admission; a PACU move into an admitted bed is refused before anything is written", async () => {
  seedHospital();
  const first = await signedOutCase("122");
  const moved = await as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId: first.caseId, disposition: "pacu", pacuBed: "P3" });
  assert.equal(moved.__status, 200, JSON.stringify(moved));
  const other = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Ward Second", mobile: "9876500123", gender: "male", ageYears: 61 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: other.mrn, ward: "PACU", bed: "P3" });
  assert.equal(adm.__status, 409, JSON.stringify(adm)); assert.equal(adm.error, "bed_occupied");

  const third = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Ward Third", mobile: "9876500124", gender: "male", ageYears: 63 });
  const inBed = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: third.mrn, ward: "PACU", bed: "P4" });
  assert.equal(inBed.__status, 200, JSON.stringify(inBed));
  const second = await signedOutCase("125");
  const refused = await as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId: second.caseId, disposition: "pacu", pacuBed: "P4" });
  assert.equal(refused.__status, 409, JSON.stringify(refused)); assert.equal(refused.error, "bed_occupied"); assert.equal(refused.written, 0);
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Encounter", second.booking.encounterId)).status, "in-progress", "the theatre stay was not closed");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "SurgicalCase", second.caseId)).stage, "signed-out");

  // A PACU stay can be closed now (leaveRecovery), so an open one holds its bay against the next recovery patient too.
  const fourth = await signedOutCase("126");
  const shared = await as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId: fourth.caseId, disposition: "pacu", pacuBed: "P3" });
  assert.equal(shared.__status, 409, JSON.stringify(shared)); assert.equal(shared.error, "bed_occupied"); assert.equal(shared.written, 0);
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Encounter", fourth.booking.encounterId)).status, "in-progress", "the theatre stay was not closed");
});

/* ---- leaving recovery: the PACU stay is closed, its bay freed, the patient placed through the ward's own doors ---- */

async function inRecovery(suffix, bay) {
  const sc = await signedOutCase(suffix);
  const d = await as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId: sc.caseId, disposition: "pacu", pacuBed: bay });
  assert.equal(d.__status, 200, JSON.stringify(d));
  const pacu = await RECORD.latest(TENANT_ROW.id, "Encounter", d.pacuEncounterId);
  return { ...sc, pacu };
}
const leave = (pacu, body) => as(DOCTOR, "/ward/surgery-leave-recovery", "POST", { orgId: ORG, encounterId: pacu.id, expectedVersion: pacu.version, ...body });
const claimSlug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const claimOf = (ward, bed) => RECORD.latest(TENANT_ROW.id, "_wardsynq_bed_claim", `wsq-bedclaim-${claimSlug(ward)}-${claimSlug(bed)}`);

test("LEAVE RECOVERY to a ward bed: the patient is admitted through /ward/admit's door, the recovery stay closes and its bay is free again", async () => {
  seedHospital();
  const r = await inRecovery("130", "R1");
  const board = await as(NURSE, `/ward/surgery-board?orgId=${ORG}`);
  const row = board.recovery.find((x) => x.encounterId === r.pacu.id);
  assert.ok(row && row.bed === "R1" && row.caseId === r.caseId && row.mrn === r.reg.mrn && row.version === r.pacu.version, JSON.stringify(board.recovery));

  const out = await leave(r.pacu, { outcome: "ward", admission: { ward: "Surgical Ward", bed: "S5" }, reason: "stable, Aldrete 10" });
  assert.equal(out.__status, 200, JSON.stringify(out));
  const closed = await RECORD.latest(TENANT_ROW.id, "Encounter", r.pacu.id);
  assert.equal(closed.status, "finished"); assert.ok(closed.periodEnd);
  assert.equal(closed.disposition, "admitted"); assert.equal(closed.dispositionReason, "stable, Aldrete 10");
  assert.equal(closed.recoveryExit.outcome, "ward"); assert.equal(closed.recoveryExit.bed, "S5"); assert.equal(closed.recoveryExit.class, "IPD");
  const adm = await RECORD.latest(TENANT_ROW.id, "Encounter", closed.recoveryExit.encounterId);
  assert.equal(adm.class, "IPD"); assert.equal(adm.status, "in-progress"); assert.equal(adm.patientId, r.pacu.patientId);
  assert.equal((await claimOf("Surgical Ward", "S5")).encounterId, adm.id, "the destination bed took its claim");
  assert.equal((await claimOf("PACU", "R1")).encounterId, null, "the bay's claim is released");
  const after = await as(NURSE, `/ward/surgery-board?orgId=${ORG}`);
  assert.ok(!after.recovery.some((x) => x.encounterId === r.pacu.id), "the patient is off the recovery list");

  // A closed stay frees its bay: the next recovery patient takes R1.
  const next = await inRecovery("131", "R1");
  assert.equal(next.pacu.location.bed, "R1");
  // Leaving again is a no-op, not a second admission.
  const again = await leave(r.pacu, { outcome: "ward", admission: { ward: "Surgical Ward", bed: "S6" } });
  assert.equal(again.__status, 200); assert.equal(again.skipped, "already_left"); assert.equal(again.written, 0);
});

test("LEAVE RECOVERY home (day case) and to ICU: each closes the stay; ICU is admitted as class ICU", async () => {
  seedHospital();
  const home = await inRecovery("132", "R2");
  const h = await leave(home.pacu, { outcome: "home" });
  assert.equal(h.__status, 200, JSON.stringify(h));
  const hc = await RECORD.latest(TENANT_ROW.id, "Encounter", home.pacu.id);
  assert.equal(hc.status, "finished"); assert.equal(hc.disposition, "home"); assert.equal(hc.recoveryExit.encounterId, null);
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "Encounter", home.pacu.patientId)).filter((e) => e.status === "in-progress").length, 0, "nobody was admitted");
  assert.equal((await claimOf("PACU", "R2")).encounterId, null);

  const icu = await inRecovery("133", "R3");
  const noUnit = await leave(icu.pacu, { outcome: "unit", admission: { ward: "ICU", bed: "I1" } });
  assert.equal(noUnit.__status, 422, JSON.stringify(noUnit)); assert.equal(noUnit.error, "unit_required");
  const u = await leave(icu.pacu, { outcome: "unit", admission: { ward: "ICU", bed: "I1", class: "ICU" } });
  assert.equal(u.__status, 200, JSON.stringify(u));
  const uc = await RECORD.latest(TENANT_ROW.id, "Encounter", icu.pacu.id);
  assert.equal(uc.status, "finished"); assert.equal(uc.recoveryExit.outcome, "unit");
  const adm = await RECORD.latest(TENANT_ROW.id, "Encounter", uc.recoveryExit.encounterId);
  assert.equal(adm.class, "ICU"); assert.equal(adm.location.ward, "ICU"); assert.equal(adm.location.bed, "I1");
});

test("LEAVE RECOVERY into an occupied ward bed is refused and the patient stays in recovery; a stale version is refused; a nurse cannot", async () => {
  seedHospital();
  const r = await inRecovery("134", "R4");
  const other = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Ward Sitter", mobile: "9876500135", gender: "male", ageYears: 70 });
  assert.equal((await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: other.mrn, ward: "Surgical Ward", bed: "S7" })).__status, 200);

  const refused = await leave(r.pacu, { outcome: "ward", admission: { ward: "Surgical Ward", bed: "S7" } });
  assert.equal(refused.__status, 409, JSON.stringify(refused)); assert.equal(refused.error, "bed_occupied"); assert.equal(refused.written, 0);
  const still = await RECORD.latest(TENANT_ROW.id, "Encounter", r.pacu.id);
  assert.equal(still.status, "in-progress"); assert.equal(still.version, r.pacu.version, "nothing was written to the recovery stay");
  assert.equal((await claimOf("PACU", "R4")).encounterId, r.pacu.id, "the bay is still held");
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "Encounter", r.pacu.patientId)).filter((e) => e.class === "IPD").length, 0, "no admission was made");

  const stale = await leave({ ...r.pacu, version: r.pacu.version - 1 }, { outcome: "home" });
  assert.equal(stale.__status, 409, JSON.stringify(stale)); assert.equal(stale.error, "version_conflict");
  const noVersion = await as(DOCTOR, "/ward/surgery-leave-recovery", "POST", { orgId: ORG, encounterId: r.pacu.id, outcome: "home" });
  assert.equal(noVersion.__status, 422); assert.equal(noVersion.error, "expected_version_required");
  const nurse = await as(NURSE, "/ward/surgery-leave-recovery", "POST", { orgId: ORG, encounterId: r.pacu.id, expectedVersion: r.pacu.version, outcome: "home" });
  assert.equal(nurse.__status, 403, JSON.stringify(nurse));
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Encounter", r.pacu.id)).status, "in-progress");
});

test("LEAVE RECOVERY for an inpatient goes back through /ward/transfer's door: no second admission, and home is refused while the stay is open", async () => {
  seedHospital();
  const { reg, booking, caseId } = await signedOutCase("136");
  const stay = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Surgical Ward", bed: "S8", admittedAt: "2026-09-08T08:00:00.000Z" });
  assert.equal(stay.__status, 200, JSON.stringify(stay));
  const d = await as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId, disposition: "pacu", pacuBed: "R5" });
  const pacu = await RECORD.latest(TENANT_ROW.id, "Encounter", d.pacuEncounterId);

  const home = await leave(pacu, { outcome: "home" });
  assert.equal(home.__status, 409, JSON.stringify(home)); assert.equal(home.error, "admitted_elsewhere"); assert.equal(home.stayEncounterId, stay.encounterId);

  const back = await leave(pacu, { outcome: "ward", admission: { ward: "Surgical Ward", bed: "S9" } });
  assert.equal(back.__status, 200, JSON.stringify(back));
  assert.equal(back.to.encounterId, stay.encounterId, "the existing stay was moved, not a new one opened");
  const moved = await RECORD.latest(TENANT_ROW.id, "Encounter", stay.encounterId);
  assert.equal(moved.location.bed, "S9"); assert.ok(moved.movedFrom);
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "Encounter", pacu.patientId)).filter((e) => e.class === "IPD").length, 1);
  assert.equal((await claimOf("Surgical Ward", "S8")).encounterId, null, "the old ward bed's claim is released by the transfer");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Encounter", pacu.id)).status, "finished");
  void booking;
});

test("PACU BAY: two recovery patients racing for one bay - the bay claim lets exactly one in", async () => {
  seedHospital();
  const a = await signedOutCase("138"), b = await signedOutCase("139");
  const realPage = RECORD.pageByType.bind(RECORD), realLatest = RECORD.latest.bind(RECORD);
  let arrived = 0, claimReads = 0, openCensus, openClaims;
  const census = new Promise((r) => { openCensus = r; }), claims = new Promise((r) => { openClaims = r; });
  const timer = setTimeout(() => { openCensus(); openClaims(); }, 1000);
  RECORD.pageByType = async (t, type, o) => { if (type === "Encounter") { if (++arrived === 2) openCensus(); await census; } return realPage(t, type, o); };
  RECORD.latest = async (t, type, id) => { if (type === "_wardsynq_bed_claim") { if (++claimReads === 2) openClaims(); await claims; } return realLatest(t, type, id); };
  let ra, rb;
  try {
    [ra, rb] = await Promise.all([
      as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId: a.caseId, disposition: "pacu", pacuBed: "R9" }),
      as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId: b.caseId, disposition: "pacu", pacuBed: "R9" }),
    ]);
  } finally { clearTimeout(timer); RECORD.pageByType = realPage; RECORD.latest = realLatest; }
  assert.deepEqual([ra.__status, rb.__status].sort(), [200, 409], JSON.stringify([ra, rb]));
  assert.equal((await openInBed("PACU", "R9")).length, 1, "exactly one patient in bay R9");
  const lost = ra.__status === 409 ? a : b;
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Encounter", lost.booking.encounterId)).status, "in-progress", "the loser stays in theatre");
});

test("PACU BAYS come from the hospital's bed list for the PACU ward: the board offers the free ones, and a bay not on the list is refused", async () => {
  seedHospital();
  const { createWard, createBed } = await import("../functions/_opd_org_store.js");
  const w = await createWard(ENV, ORG, { name: "PACU" }, "test");
  for (const name of ["Bay 1", "Bay 2", "Bay 3"]) await createBed(ENV, ORG, { wardId: w.id, name, state: name === "Bay 3" ? "cleaning" : "available" }, "test");
  const b0 = await as(NURSE, `/ward/surgery-board?orgId=${ORG}`);
  assert.deepEqual(b0.pacuBays, ["Bay 1", "Bay 2"], JSON.stringify(b0.pacuBays));

  const sc = await signedOutCase("137");
  const notListed = await as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId: sc.caseId, disposition: "pacu", pacuBed: "1" });
  assert.equal(notListed.__status, 422, JSON.stringify(notListed)); assert.equal(notListed.error, "bed_not_found");
  const ok = await as(DOCTOR, "/ward/surgery-disposition", "POST", { orgId: ORG, caseId: sc.caseId, disposition: "pacu", pacuBed: "Bay 1" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const b1 = await as(NURSE, `/ward/surgery-board?orgId=${ORG}`);
  assert.deepEqual(b1.pacuBays, ["Bay 2"], "a held bay is not offered");
  assert.equal(b1.recovery.length, 1);

  seedHospital();
  const none = await as(NURSE, `/ward/surgery-board?orgId=${ORG}`);
  assert.equal(none.pacuBays, null, "no PACU beds listed: the screen falls back to bay 1");
});
