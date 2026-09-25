import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-registers-legal2.test.mjs - the statutory registers, second pass of the 2026-09-17 legal review (sections
 * B to F items the first pass left out): the PCPNDT nodal officer, Form F flags on the imaging worklist, foetal sex refused
 * in patient replies and imports; MTP retention and the POCSO task; restricted sexual-offence cases, requisitioned exports,
 * the Kerala format, custody deaths at the mortuary, the OPD invoice lock; NDPS day closure, the Form 3J cap, quarantine,
 * transfers, home care, Schedule H1 and X registers, drug regimes and the read-only doors.
 * Real router, real RecordService, in-memory repository (the harness of test/wardsynq-registers.test.mjs).
 *
 * node --test --experimental-test-module-mocks test/wardsynq-registers-legal2.test.mjs
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
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
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
const TENANTS = {
  "tenant-a": { id: "tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-a" } }) },
  "tenant-b": { id: "tenant-b", name: "Hospital B", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-b" } }) },
};
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (TENANTS[String(a[0])] ? { ...TENANTS[String(a[0])] } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async (id) => "ph-" + String(id).length }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { mapSccmBundle } = await import("../wardsynq/adapters/wardsynq-sccm-adapter.js");
const { registerSettings, validateRegisterSettings, mtpRetentionEnd, form3hClosureLate } = await import("../functions/_wardsynq/register-settings.js");
const { regimeOf, controlledSet } = await import("../functions/_wardsynq/controlled-drugs.js");
const { pocsoTaskClock, keralaMlcCsv } = await import("../functions/_wardsynq/registers.js");

const ORG = "org-a", ORG_B = "org-b";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const P = (r) => `${r}@example.test`;
const ADMIN = P("admin"), DOCTOR = P("doctor"), DOCTOR2 = P("doctor2"), NURSE = P("nurse"), CASHIER = P("cashier"), PHARM = P("pharmacy"), SUPER = P("supervisor"),
  RAD = P("radiologist"), OBS = P("obstetrician"), HIM = P("him"), NODAL = P("pcpndt_nodal"), INSPECTOR = P("ndps_inspector"), MORT = P("mortuary"), ROGUE = P("rogue");
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", WSQ_TICK_OFF: "1", CLINIC_BILLING_ENABLED: "1",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seed(wardsynq) {
  docs.clear(); clock = 1; RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-a", ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: { controlledDrugs: ["Morphine"], ...(wardsynq || {}) } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG_B}`, { fields: { id: ORG_B, code: "HOSP-B", name: "Hospital B", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-b", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [DOCTOR, "doctor"], [DOCTOR2, "doctor"], [NURSE, "nurse"], [CASHIER, "cashier"], [PHARM, "pharmacy"], [SUPER, "supervisor"],
    [RAD, "radiologist"], [OBS, "obstetrician"], [HIM, "him"], [NODAL, "pcpndt_nodal"], [INSPECTOR, "ndps_inspector"], [MORT, "mortuary"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize(ORG_B)}__${sanitize(idFor(ROGUE))}`, { fields: { orgId: ORG_B, identity: idFor(ROGUE), role: "admin", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const rows = (type) => RECORD._rows.filter((r) => r.resourceType === type);
const registerRows = () => RECORD._rows.filter((r) => String(r.resourceType).startsWith("_wardsynq_register"));
const audits = () => RECORD.audit;
let n = 0;
async function admitted(sex) {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Legal Case " + n, mobile: "98765008" + String(n).padStart(2, "0"), gender: sex || "female", ageYears: 30 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Ward A", bed: String(n) });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { ...adm, mrn: reg.mrn };
}
const settingsAs = (email, settings) => as(email, "/org/register-settings", "POST", { orgId: ORG, settings });
const TODAY = new Date().toISOString().slice(0, 10), MONTH = TODAY.slice(0, 7), YEAR = TODAY.slice(0, 4);
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const FORMF_OK = {
  firstReportedOn: TODAY, clinicName: "Hospital A Imaging, Main Road", clinicRegistrationNo: "PNDT/123", patientName: "Legal Case", patientAge: 28,
  livingSons: "None", livingDaughters: "One, 4 years", relativeName: "Husband", address: "12 Main Road, 9876500000", selfReferral: "Dr Obstetrician",
  lmpOrWeeks: "20 weeks", procedureKind: "non-invasive", doctorName: "Dr Radiologist", indications: ["ii", "xvii"],
  procedureCarriedOut: "ultrasound", declarationDate: TODAY, declarationTime: "00:01", procedureDate: TODAY, procedureStartTime: "23:58",
  resultBrief: "Single live intrauterine pregnancy, growth appropriate.", resultConveyedTo: "Dr Obstetrician", resultConveyedOn: TODAY, mtpIndication: "None",
  closingPlace: "Hospital A", sectionDoctorRegistrationNo: "KMC 4411", sealOnPrint: "applied-on-print",
  womanSignedBy: "signature", womanDeclaration: "Legal Case", doctorDeclaration: "Dr Radiologist", doctorDeclarationRegistrationNo: "KMC 4411",
};

/* ------------------------------------------------------------------------------------------------ PCPNDT */

test("PCPNDT nodal officer (B.4.5, B.4.9): GET /ward/register-formf reads, POST /ward/register-formf files only the monthly report; 401, 403 with nothing written, another hospital", async () => {
  seed();
  const adm = await admitted();
  assert.equal((await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, patientId: adm.patientId, fields: FORMF_OK })).__status, 200);
  const before = registerRows().length;
  assert.equal((await as(null, "/ward/register-formf?orgId=" + ORG + "&period=" + MONTH)).__status, 401);
  assert.equal((await as(ROGUE, "/ward/register-formf?orgId=" + ORG + "&period=" + MONTH)).__status, 403, "another hospital");
  const list = await as(NODAL, "/ward/register-formf?orgId=" + ORG + "&period=" + MONTH);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.entries.length, 1);
  assert.equal((await as(NODAL, "/ward/register-formf?orgId=" + ORG + "&period=" + MONTH + "&format=monthly")).__status, 200);
  assert.equal((await as(NODAL, "/ward/register-formf", "POST", { orgId: ORG, patientId: adm.patientId, fields: FORMF_OK })).__status, 403, "the nodal officer writes no Form F");
  assert.equal((await as(NODAL, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH)).__status, 403, "nor reads the MTP register");
  assert.equal(registerRows().length, before, "nothing written by a refusal");
  const filed = await as(NODAL, "/ward/register-formf", "POST", { orgId: ORG, kind: "statreturn", fields: { returnKind: "formf-monthly", period: MONTH, submittedOn: TODAY, mode: "portal", recipient: "District Appropriate Authority", submittedBy: "Nodal Officer" } });
  assert.equal(filed.__status, 200, JSON.stringify(filed));
  assert.equal((await as(NURSE, "/ward/register-formf", "POST", { orgId: ORG, kind: "statreturn", fields: { returnKind: "formf-monthly", period: MONTH, submittedOn: TODAY, mode: "hand", recipient: "DAA", submittedBy: "Nurse" } })).__status, 403);
});

test("GET /ward/imaging-worklist flags an obstetric ultrasound whose Form F is missing, without its declaration, or incomplete; other imaging and a complete Form F carry no flag", async () => {
  seed();
  const adm = await admitted();
  const obst = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "USG obstetric growth scan", category: "imaging" });
  const chest = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "X-ray chest PA", category: "imaging" });
  assert.equal(obst.__status, 200, JSON.stringify(obst));
  const flagOf = async () => { const w = await as(RAD, "/ward/imaging-worklist?orgId=" + ORG); assert.equal(w.__status, 200, JSON.stringify(w)); return w.pcpndt; };
  let flags = await flagOf();
  assert.deepEqual(flags.map((f) => [f.orderId, f.state]), [[obst.orderId, "no-form-f"]]);
  assert.ok(!flags.some((f) => f.orderId === chest.orderId));
  const draft = await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, patientId: adm.patientId, serviceRequestId: obst.orderId, fields: { ...FORMF_OK, doctorDeclaration: undefined } });
  assert.equal(draft.__status, 200, JSON.stringify(draft));
  flags = await flagOf();
  assert.equal(flags[0].state, "incomplete");
  assert.deepEqual(flags[0].missing, ["doctorDeclaration"]);
  const done = await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, id: draft.entry.id, expectedVersion: 1, reason: "Doctor's declaration signed", fields: FORMF_OK });
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.deepEqual(await flagOf(), [], "a complete Form F is not flagged");
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("../ward.js", import.meta.url), "utf8"), /r\.pcpndt \|\| \[\]/, "the radiology board reads the flag");
});

test("foetal sex is refused in a reply to a patient (POST /ward/patient-reply), audited without the text, and an imported report or imaging study that states it is not filed", async () => {
  seed();
  const adm = await admitted();
  await RECORD.append("tenant-a", [{ resourceType: "PatientMessage", id: "msg-1", version: 1, patientId: adm.patientId, subject: "Scan", body: "Is it a boy?", sentAt: new Date().toISOString(), answeredAt: null, answeredBy: null }]);
  const reply = { orgId: ORG, messageId: "msg-1", reply: "Your scan is normal and it's a boy." };
  assert.equal((await as(null, "/ward/patient-reply", "POST", reply)).__status, 401);
  assert.equal((await as(NURSE, "/ward/patient-reply", "POST", reply)).__status, 403);
  const refused = await as(DOCTOR, "/ward/patient-reply", "POST", reply);
  assert.equal(refused.__status, 422, JSON.stringify(refused));
  assert.equal(refused.error, "foetal_sex_refused");
  assert.equal(rows("PatientMessage").length, 1, "nothing written");
  const audit = JSON.stringify(audits());
  assert.match(audit, /pcpndt\.disclosure_refused/);
  assert.ok(!audit.includes("it's a boy"), "the refused text is not in the audit");
  const ok = await as(DOCTOR, "/ward/patient-reply", "POST", { ...reply, reply: "Your scan is normal. We will discuss it at your visit." });
  assert.equal(ok.__status, 200, JSON.stringify(ok));

  const bundle = { sccmVersion: "1.1", meta: { sourceConnector: "dicomweb" }, patient: { id: "p-1", name: "A B", birthDate: "1990-01-01", gender: "female", identifiers: [{ system: "MRN", value: "M1" }] },
    diagnosticReports: [{ id: "dr-1", code: { text: "USG obstetric" }, status: "final", conclusion: "Male foetus, 22 weeks." }, { id: "dr-2", code: { text: "USG obstetric" }, status: "final", conclusion: "Single live foetus." },
      { id: "dr-3", code: { text: "Urine culture" }, status: "final", conclusion: "Female child, E. coli urinary infection." }],
    imagingStudies: [{ id: "st-1", description: "OB USG fetal sex female", studyDate: "2026-09-01" }, { id: "st-2", description: "OB USG growth", studyDate: "2026-09-01" }] };
  const m = mapSccmBundle(bundle);
  const filed = m.entities.map((e) => `${e.resourceType}:${e.id}`).join(" ");
  assert.ok(!/dr-1/.test(filed) && /dr-2/.test(filed), filed);
  assert.ok(/dr-3/.test(filed), "a paediatric report on a female child, with no obstetric context, is filed");
  assert.ok(!/st-1/.test(filed) && /st-2/.test(filed), filed);
  const issues = m.issues.filter((i) => i.code === "PCPNDT_FOETAL_SEX_REFUSED");
  assert.equal(issues.length, 2);
  assert.ok(issues.every((i) => !/male|female/i.test(i.message.replace(/states the sex of a foetus/, ""))), "the issue names the record and field, never the text");
});

/* ------------------------------------------------------------------------------------------------ MTP */

const MTP_MINOR = {
  admissionDate: TODAY, patientName: "Legal Case", relation: "D/o A", age: 16, religion: "hindu", address: "Village B", gestationWeeks: 10,
  reasons: ["rape"], opinionRmp1: "Dr Obstetrician", opinionRmp1Clause: "b", method: "surgical", terminationDate: TODAY, terminationTime: "08:00",
  terminatedBy: "Dr Obstetrician", terminatedByClause: "b", terminationCertified: "Dr Obstetrician", contraception: "none",
  mentallyIll: "no", consentBy: "guardian", guardianName: "Mother, S Devi", consentDate: TODAY, opinionCertified: "Dr Obstetrician", envelopeSealedBy: "Dr Obstetrician", envelopeReceivedByHead: "Dr Medical Superintendent",
};

test("MTP (C.4.6, C.4.9): a minor's entry opens a POCSO intimation task on the medico-legal register in the same write; closing it there clears the MTP flag; every entry shows its retention end and nothing is deleted", async () => {
  seed();
  const adm = await admitted();
  const saved = await as(OBS, "/ward/register-mtp", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, fields: MTP_MINOR });
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.equal(saved.written, 2, "the entry and its task in one append");
  const taskId = saved.opened[0].id;
  assert.ok(!/mtp/.test(taskId), "the task's id names no other register");
  const task = await RECORD.latest("tenant-a", "_wardsynq_register_pocsotask", taskId);
  assert.equal(task.kind, "pocsotask");
  assert.equal(task.complete, false);
  assert.ok(!JSON.stringify(task.fields).match(/termination|MTP/i), "the task names no other register");
  const correction = await as(OBS, "/ward/register-mtp", "POST", { orgId: ORG, id: saved.entry.id, expectedVersion: 1, reason: "Discharge date added", fields: { ...MTP_MINOR, dischargeDate: TODAY } });
  assert.equal(correction.__status, 200, JSON.stringify(correction));
  assert.equal(registerRows().filter((r) => r.resourceType === "_wardsynq_register_pocsotask").length, 1, "a correction does not open a second task");

  let list = await as(OBS, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH);
  assert.equal(list.entries[0].flags.pocsoPending, true);
  assert.equal(list.entries[0].retentionEnd, `${Number(YEAR) + 5}-12-31`);
  assert.match(list.retentionNote, /Nothing is deleted/);
  const one = await as(OBS, "/ward/register-mtp?orgId=" + ORG + "&id=" + encodeURIComponent(saved.entry.id));
  assert.equal(one.retentionEnd, `${Number(YEAR) + 5}-12-31`);

  const mlcList = await as(HIM, "/ward/register-mlc?orgId=" + ORG + "&period=" + MONTH);
  assert.equal(mlcList.clockSummary.pocsoTasksOpen, 1);
  const tasks = await as(HIM, "/ward/register-mlc?orgId=" + ORG + "&kind=pocsotask&period=" + MONTH);
  assert.equal(tasks.entries[0].clock.kind, "pocso-intimation");
  const close = { orgId: ORG, kind: "pocsotask", id: taskId, expectedVersion: 1, reason: "Intimated to the SJPU", fields: { reason: "minor-pregnancy", intimation: "intimated", intimatedAt: new Date().toISOString(), intimatedTo: "SJPU Central", policeReference: "GD 77", recordedBy: "Medical Records Officer" } };
  assert.equal((await as(NURSE, "/ward/register-mlc", "POST", close)).__status, 403);
  assert.equal((await as(null, "/ward/register-mlc", "POST", close)).__status, 401);
  const closed = await as(HIM, "/ward/register-mlc", "POST", close);
  assert.equal(closed.__status, 200, JSON.stringify(closed));
  assert.equal(closed.entry.complete, true);
  assert.equal(closed.entry.fields.raisedAt, task.fields.raisedAt, "the server's opening time survives the correction");
  list = await as(OBS, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH);
  assert.equal(list.entries[0].flags.pocsoPending, false);

  assert.equal(mtpRetentionEnd("2026-03-01", "2033-01-02T00:00:00Z"), "2038-01-02", "the later of year-end and last entry");
  assert.equal(pocsoTaskClock({ complete: false, fields: { raisedAt: new Date(Date.now() - 25 * 3600000).toISOString() } }, Date.now()).state, "overdue");
});

/* ------------------------------------------------------------------------------------------------ MLC */

const POCSO = () => ({ category: "pocso", status: "open", arrivalAt: new Date(Date.now() - 3600000).toISOString(), historyAsGiven: "Disclosed to the school counsellor.", personSex: "female", freeTreatment: "confirmed", doctor: "Dr Casualty" });

test("medico-legal access (D.4.8): a POCSO case opens to the doctor who recorded it, the keepers and the people named; another doctor sees it withheld (audited) and cannot correct it; an export needs a recorded requisition", async () => {
  seed();
  const girl = await admitted();
  const opened = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: girl.patientId, encounterId: girl.encounterId, fields: POCSO() });
  assert.equal(opened.__status, 200, JSON.stringify(opened));
  const mine = await as(DOCTOR, "/ward/mlc-patient", "POST", { orgId: ORG, mrn: girl.mrn });
  assert.equal(mine.entries[0].fields.category, "pocso", "the doctor who recorded it opens it");
  const other = await as(DOCTOR2, "/ward/mlc-patient", "POST", { orgId: ORG, mrn: girl.mrn });
  assert.equal(other.__status, 200, JSON.stringify(other));
  assert.equal(other.entries[0].restricted, true);
  assert.equal(other.entries[0].fields, undefined, "no category, history or examination");
  assert.match(JSON.stringify(audits()), /mlc\.restricted_withheld/);
  const before = registerRows().length;
  const fix = await as(DOCTOR2, "/ward/register-mlc", "POST", { orgId: ORG, id: opened.entry.id, expectedVersion: 1, reason: "Adding history", fields: { ...POCSO(), historyAsGiven: "Changed" } });
  assert.equal(fix.__status, 403, JSON.stringify(fix));
  assert.equal(fix.error, "restricted_case");
  assert.equal(registerRows().length, before, "nothing written");
  const again = await as(DOCTOR2, "/ward/register-mlc", "POST", { orgId: ORG, patientId: girl.patientId, encounterId: girl.encounterId, fields: POCSO() });
  assert.equal(again.error, "already_recorded");
  assert.equal(again.entry, undefined, "a refusal does not hand the case back");
  const keeper = await as(HIM, "/ward/mlc-patient?orgId=" + ORG + "&patientId=" + girl.patientId);
  assert.equal(keeper.entries[0].fields.category, "pocso", "the register's keeper opens it");
  assert.equal((await settingsAs(ADMIN, { mlc: { restrictedReaders: [idFor(DOCTOR2)] } })).__status, 200);
  assert.equal((await as(DOCTOR2, "/ward/mlc-patient", "POST", { orgId: ORG, mrn: girl.mrn })).entries[0].fields.category, "pocso", "a person the hospital names opens it");

  const csv = "/ward/register-mlc?orgId=" + ORG + "&period=" + MONTH + "&format=csv";
  assert.equal((await as(HIM, csv)).error, "requisition_required");
  assert.equal((await as(DOCTOR, csv + "&requisitionFrom=SI+Rao&requisitionRef=CR-12&requisitionDate=" + TODAY)).__status, 403, "only the keepers export");
  const exported = await as(HIM, csv + "&requisitionFrom=SI+Rao+Central+PS&requisitionRef=CR-12%2F2026&requisitionDate=" + TODAY);
  assert.equal(exported.__status, 200, JSON.stringify(exported));
  assert.equal(exported.requisition.reference, "CR-12/2026");
  assert.match(JSON.stringify(audits()), /"action":"register\.export".*CR-12\/2026/);
});

test("medico-legal state format (D.4.1): with the Kerala format the register asks for the examination requested and two identification marks, and exports the Kerala register's columns on a requisition", async () => {
  seed();
  const adm = await admitted("male");
  assert.equal((await settingsAs(ADMIN, { mlc: { stateFormat: "kerala" } })).__status, 200);
  const rta = { category: "rta", status: "open", arrivalAt: new Date().toISOString(), historyAsGiven: "Fall from a bike, as told by the patient.", policeStation: "Central PS", intimationAt: new Date().toISOString(), intimationMode: "telephone", doctor: "Dr Casualty" };
  const saved = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, fields: rta });
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.deepEqual(saved.entry.missing.sort(), ["examinationRequested", "identificationMark1", "identificationMark2"]);
  const withCert = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, id: saved.entry.id, expectedVersion: 1, reason: "Kerala fields", fields: { ...rta, examinationRequested: "Wound certificate", identificationMark1: "Mole left cheek", identificationMark2: "Scar right knee", certificateIssuedTo: "SI Rao" } });
  assert.deepEqual(withCert.entry.missing.sort(), ["certificateIssuedOn", "certificateRequestNo"]);
  const k = await as(HIM, "/ward/register-mlc?orgId=" + ORG + "&period=" + MONTH + "&format=kerala&requisitionFrom=SI+Rao&requisitionRef=CR-9&requisitionDate=" + TODAY);
  assert.equal(k.__status, 200, JSON.stringify(k));
  assert.match(k.csv, /^ML number,Date,Name,Age,Sex,Address,Crime number and police station,Requisition from and date,Examination requested,Medical officer,Signature\r\n/);
  assert.match(k.csv, /Wound certificate/);
  assert.equal((await settingsAs(ADMIN, { mlc: { stateFormat: "hospital" } })).__status, 200);
  assert.equal((await as(HIM, "/ward/register-mlc?orgId=" + ORG + "&format=kerala&requisitionFrom=SI+Rao&requisitionRef=CR-9&requisitionDate=" + TODAY)).error, "not_this_format");
  assert.match(keralaMlcCsv([{ serial: "MLC/1", fields: { arrivalAt: "2026-09-01T10:00:00Z", doctor: { name: "=Dr" } }, patientId: "p" }], new Map()), /'=Dr/, "a formula is written as text");
});

test("a custody death (D.4.3) is not released by POST /ward/mortuary-release until the Magistrate's inquest papers are recorded on the medico-legal case", async () => {
  seed();
  const adm = await admitted("male");
  assert.equal((await as(DOCTOR, "/ward/deceased", "POST", { orgId: ORG, patientId: adm.patientId, confirm: true, deceased: { at: new Date().toISOString(), cause: "Head injury" } })).__status, 200);
  const custody = { category: "death-in-custody", status: "open", arrivalAt: new Date().toISOString(), historyAsGiven: "Brought from the lock-up by the police.", policeStation: "Central PS", intimationAt: new Date().toISOString(), intimationMode: "written", doctor: "Dr Casualty" };
  const mlc = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, fields: custody });
  assert.equal(mlc.__status, 200, JSON.stringify(mlc));
  const recv = await as(MORT, "/ward/mortuary-receive", "POST", { orgId: ORG, patientId: adm.patientId, broughtBy: "Ward attendant", identifiedBy: "Staff nurse" });
  assert.equal(recv.__status, 200, JSON.stringify(recv));
  const board = await as(MORT, "/ward/mortuary-board?orgId=" + ORG);
  assert.ok(board.held[0].releaseNeeds.includes("inquest_papers") && board.held[0].releaseNeeds.includes("police_noc"), JSON.stringify(board.held[0].releaseNeeds));
  const release = { orgId: ORG, caseId: recv.caseId, release: { to: "police", receiverName: "SI Rao", idProofType: "police-id", idProofNumber: "P-412", bodyIdentified: true, documents: { deathCertificate: true, policeNoc: true } } };
  assert.equal((await as(null, "/ward/mortuary-release", "POST", release)).__status, 401);
  assert.equal((await as(NURSE, "/ward/mortuary-release", "POST", release)).__status, 403);
  const held = await as(MORT, "/ward/mortuary-release", "POST", release);
  assert.equal(held.__status, 422, JSON.stringify(held));
  assert.ok(held.missing.includes("inquest_papers"));
  const papers = await as(HIM, "/ward/register-mlc", "POST", { orgId: ORG, id: mlc.entry.id, expectedVersion: 1, reason: "Magistrate inquiry papers received", fields: { ...custody, inquestPapersReceived: "yes" } });
  assert.ok(papers.entry.missing.includes("inquestPapersReference"), "the papers are recorded with their reference");
  await as(HIM, "/ward/register-mlc", "POST", { orgId: ORG, id: mlc.entry.id, expectedVersion: 2, reason: "Reference added", fields: { ...custody, inquestPapersReceived: "yes", inquestPapersReference: "JMFC inquiry 14/2026, received today" } });
  const still = await as(MORT, "/ward/mortuary-release", "POST", release);
  assert.ok(!(still.missing || []).includes("inquest_papers"), JSON.stringify(still));
});

test("BNSS s.397 (D.4.2): POST /bill/invoice (the OPD clinic) is refused while a POCSO case is open for the patient", async () => {
  seed();
  const girl = await admitted();
  const opened = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: girl.patientId, encounterId: girl.encounterId, fields: POCSO() });
  assert.equal(opened.__status, 200, JSON.stringify(opened));
  assert.equal((await as(null, "/bill/invoice", "POST", { orgId: ORG, patientId: girl.mrn })).__status, 401);
  assert.equal((await as(NURSE, "/bill/invoice", "POST", { orgId: ORG, patientId: girl.mrn })).__status, 403);
  const refused = await as(CASHIER, "/bill/invoice", "POST", { orgId: ORG, patientId: girl.mrn });
  assert.equal(refused.__status, 409, JSON.stringify(refused));
  assert.equal(refused.error, "free_treatment_bnss_397");
  const boy = await admitted("male");
  assert.notEqual((await as(CASHIER, "/bill/invoice", "POST", { orgId: ORG, patientId: boy.mrn })).error, "free_treatment_bnss_397");
});

/* ------------------------------------------------------------------------------------------------ NDPS */

const RMI = { form3gNumber: "RMI/7", issuedOn: "2026-01-01", expiresOn: "2028-12-31", designatedDoctors: [{ name: "Dr In Charge", overallInCharge: true }] };
const order = async (id, patient, drug) => RECORD.append("tenant-a", [{ resourceType: "MedicationOrder", id, version: 1, patientId: patient.patientId, encounterId: patient.encounterId, drug, status: "active", dose: { value: 1, unit: "mg" }, prescriberId: idFor(DOCTOR) }]);

test("NDPS Form 3H day closure (F.4.3): POST /ward/register-ndps kind form3hclose is signed by the over-all in-charge, numbered at closure, marked late after midnight, never repeated; GET /ward/register-ndps shows each day's closure", async () => {
  seed();
  /* The book and its closures run on the hospital's own day (UTC+05:30 by default), not the UTC date. */
  const local = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
  const TODAY = local(Date.now()), YESTERDAY = local(Date.now() - 86400000), YEAR = TODAY.slice(0, 4);
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "Morphine", quantity: { value: 10, unit: "ampoule" }, receivedFrom: "State supplier", documentNo: "INV-1", at: YESTERDAY + "T06:00:00.000Z" })).__status, 200);
  const today = await as(PHARM, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "Morphine", quantity: { value: 5, unit: "ampoule" }, receivedFrom: "State supplier", documentNo: "INV-2" });
  assert.equal(today.__status, 200, JSON.stringify(today));
  assert.match(today.estimateWarning, /No Form 3J estimate/, "no estimate recorded: said, not refused");
  const close = (fields) => ({ orgId: ORG, kind: "form3hclose", fields: { day: TODAY, drug: "Morphine", unit: "ampoule", closedBy: "Dr In Charge", ...fields } });
  assert.ok((await as(PHARM, "/ward/register-ndps", "POST", close())).problems.some((p) => /no over-all in-charge/.test(p)));
  assert.equal((await settingsAs(ADMIN, { ndps: { rmi: RMI } })).__status, 200);
  for (const who of [NURSE, INSPECTOR, DOCTOR]) assert.equal((await as(who, "/ward/register-ndps", "POST", close())).__status, 403, who);
  assert.equal((await as(null, "/ward/register-ndps", "POST", close())).__status, 401);
  assert.equal((await as(ROGUE, "/ward/register-ndps", "POST", close())).__status, 403);
  assert.ok((await as(PHARM, "/ward/register-ndps", "POST", close({ closedBy: "Somebody Else" }))).problems.some((p) => /over-all in-charge \(Dr In Charge\)/.test(p)));
  assert.equal((await as(PHARM, "/ward/register-ndps", "POST", close({ day: "2999-01-01" }))).error, "invalid_fields", "a day not yet begun");
  assert.equal(registerRows().length, 0, "nothing written by a refusal");
  const closed = await as(PHARM, "/ward/register-ndps", "POST", close());
  assert.equal(closed.__status, 200, JSON.stringify(closed));
  assert.equal(closed.entry.serial, `3H/${YEAR}/00001`);
  assert.deepEqual([closed.entry.fields.openingStock, closed.entry.fields.received, closed.entry.fields.closingStock, closed.entry.fields.closedLate], [10, 5, 15, "no"]);
  assert.equal((await as(PHARM, "/ward/register-ndps", "POST", close())).error, "already_recorded");
  let book = await as(PHARM, "/ward/register-ndps?orgId=" + ORG);
  const days = book.items[0].form3h;
  assert.equal(days.find((d) => d.date === TODAY).closure.page, `3H/${YEAR}/00001`);
  assert.equal(days.find((d) => d.date === YESTERDAY).unclosedLate, true);
  assert.equal(book.daysUnclosed, 1);
  const late = await as(PHARM, "/ward/register-ndps", "POST", close({ day: YESTERDAY }));
  assert.equal(late.entry.fields.closedLate, "yes", "closed after the day ended");
  assert.equal(late.entry.serial, `3H/${YEAR}/00002`);
  book = await as(INSPECTOR, "/ward/register-ndps?orgId=" + ORG);
  assert.equal(book.__status, 200, "the inspector reads the book");
  assert.equal(book.daysUnclosed, 0);
  assert.equal(form3hClosureLate("2026-09-16", "2026-09-16T18:29:00Z", 330), false);
  assert.equal(form3hClosureLate("2026-09-16", "2026-09-16T18:31:00Z", 330), true);
});

test("NDPS stock rules (F.4.4, F.4.5): quarantined batches are not dispensed; a transfer to another institution needs the Controller's approval; home care records the carrier and receives the unused quantity back as a receipt", async () => {
  seed();
  const adm = await admitted("male");
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "Morphine", quantity: { value: 20, unit: "ampoule" }, batch: "B1", receivedFrom: "State supplier" })).__status, 200);
  const q = { drug: "Morphine", unit: "ampoule", batch: "B1", quantity: 2, reason: "expired", quarantinedOn: TODAY, quarantinedBy: "Pharmacist A", status: "open" };
  assert.equal((await as(NURSE, "/ward/register-ndps", "POST", { orgId: ORG, kind: "quarantine", fields: q })).__status, 403);
  assert.equal((await as(INSPECTOR, "/ward/register-ndps", "POST", { orgId: ORG, kind: "quarantine", fields: q })).__status, 403);
  assert.equal(registerRows().length, 0);
  assert.ok((await as(PHARM, "/ward/register-ndps", "POST", { orgId: ORG, kind: "quarantine", fields: { ...q, status: "released", closedOn: TODAY, closedReason: "Looks fine", closedBy: "Pharmacist A" } })).problems.some((p) => /never released back/.test(p)));
  const quarantined = await as(PHARM, "/ward/register-ndps", "POST", { orgId: ORG, kind: "quarantine", fields: q });
  assert.equal(quarantined.__status, 200, JSON.stringify(quarantined));
  await order("rx-m-1", adm, "Morphine");
  const disp = { orgId: ORG, orderId: "rx-m-1", quantity: { value: 2, unit: "ampoule" }, witnessId: idFor(SUPER) };
  const dispenses = () => rows("MedicationDispense").length;
  assert.equal((await as(PHARM, "/ward/dispense", "POST", disp)).error, "quarantine_batch_required");
  assert.equal((await as(PHARM, "/ward/dispense", "POST", { ...disp, batch: "B1" })).error, "batch_quarantined");
  assert.equal(dispenses(), 0, "nothing dispensed");
  const issued = await as(PHARM, "/ward/dispense", "POST", { ...disp, batch: "B2" });
  assert.equal(issued.__status, 200, JSON.stringify(issued));

  const moves = () => rows("StockMovement").length;
  const before = moves();
  const transfer = { orgId: ORG, kind: "transfer-out", code: "Morphine", quantity: { value: 1, unit: "ampoule" }, toInstitution: "District Hospital B" };
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", transfer)).error, "controller_approval_required");
  assert.equal(moves(), before, "nothing written");
  const sent = await as(PHARM, "/ward/stock-move", "POST", { ...transfer, transferKind: "loan", controllerApprovalRef: "CD/APP/19" });
  assert.equal(sent.__status, 200, JSON.stringify(sent));
  assert.deepEqual([sent.movement.toInstitution, sent.movement.transferKind, sent.movement.controllerApprovalRef], ["District Hospital B", "loan", "CD/APP/19"]);

  const home = { orgId: ORG, kind: "homecare", patientId: adm.patientId, fields: { dispenseId: issued.dispenseId, issuedOn: TODAY, carrierName: "R Case", carrierRole: "Son", returnedOn: TODAY, quantityReturned: 5, returnReceivedBy: "Pharmacist A" } };
  assert.equal((await as(NURSE, "/ward/register-ndps", "POST", home)).__status, 403);
  assert.ok((await as(PHARM, "/ward/register-ndps", "POST", home)).problems.some((p) => /more than the 2 ampoule/.test(p)));
  const beforeHome = moves();
  const hc = await as(PHARM, "/ward/register-ndps", "POST", { ...home, fields: { ...home.fields, quantityReturned: 1 } });
  assert.equal(hc.__status, 200, JSON.stringify(hc));
  assert.equal(hc.entry.complete, true, JSON.stringify(hc.entry.missing));
  assert.deepEqual([hc.entry.fields.drug, hc.entry.fields.quantityOut], ["Morphine", 2]);
  assert.equal(moves(), beforeHome + 1, "the unused quantity is received back into stock (r.52V(2))");
  const receipt = rows("StockMovement").slice(-1)[0];
  assert.equal(hc.entry.fields.returnMovementId, receipt.id);
  const again = await as(PHARM, "/ward/register-ndps", "POST", { orgId: ORG, kind: "homecare", id: hc.entry.id, expectedVersion: 1, reason: "Visit note added", fields: { ...home.fields, quantityReturned: 1, visitNote: "Palliative team visit" } });
  assert.equal(again.__status, 200, JSON.stringify(again));
  assert.equal(moves(), beforeHome + 1, "a correction never receives the return twice");
});

test("drug regimes, Schedule H1 and X registers, and the read-only doors (F.4.8 to F.4.10, F.5): GET /ward/register-ndps view=h1 and view=schedx, POST kind schedxsupply; the inspector reads and writes nothing; the nurse reads one patient", async () => {
  seed({ controlledDrugs: ["Morphine", "Diazepam"] });
  assert.equal((await settingsAs(ADMIN, { ndps: { drugRegimes: [{ drug: "Alprazolam", regime: "schedule-h1" }, { drug: "Pentazocine", regime: "schedule-x" }, { drug: "Diazepam", regime: "psychotropic" }], scheduleXLocations: ["CD cupboard"],
    rmi: { ...RMI, expiresOn: "2026-02-01" } } })).__status, 200);
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "Morphine", quantity: { value: 1, unit: "ampoule" } })).error, "rmi_recognition_expired", "Chapter VB binds an essential narcotic drug");
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "Diazepam", quantity: { value: 10, unit: "tablet" } })).__status, 200, "not a psychotropic");
  const adm = await admitted("male");
  await order("rx-a-1", adm, "Alprazolam");
  await order("rx-p-1", adm, "Pentazocine");
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "Pentazocine", quantity: { value: 10, unit: "ampoule" }, location: "Main store", receivedFrom: "Pharma Distributors", supplierAddress: "12 Market Road", supplierLicenceNo: "DL-20B-1", manufacturer: "Maker Ltd", batch: "PZ1" })).__status, 200);
  const h1 = await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: "rx-a-1", quantity: { value: 10, unit: "tablet" } });
  assert.equal(h1.__status, 200, JSON.stringify(h1));
  const x = await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: "rx-p-1", quantity: { value: 1, unit: "ampoule" }, batch: "PZ1" });
  assert.equal(x.__status, 200, JSON.stringify(x));

  assert.equal((await as(null, "/ward/register-ndps?orgId=" + ORG + "&view=h1")).__status, 401);
  assert.equal((await as(NURSE, "/ward/register-ndps?orgId=" + ORG + "&view=h1")).__status, 403);
  assert.equal((await as(ROGUE, "/ward/register-ndps?orgId=" + ORG + "&view=h1")).__status, 403);
  const reg = await as(INSPECTOR, "/ward/register-ndps?orgId=" + ORG + "&view=h1");
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  assert.equal(reg.rows.length, 1);
  assert.deepEqual([reg.rows[0].drug, reg.rows[0].quantity, reg.rows[0].prescriberId, reg.rows[0].prescriberAddress], ["Alprazolam", "10 tablet", idFor(DOCTOR), "Hospital A"]);
  assert.match(reg.rows[0].patientName, /^Legal Case/);

  let xr = await as(PHARM, "/ward/register-ndps?orgId=" + ORG + "&view=schedx");
  assert.equal(xr.__status, 200, JSON.stringify(xr));
  assert.equal(xr.receiptsOutsideLockAndKey, 1, "Main store is not listed as under lock and key");
  assert.equal(xr.withoutParticulars, 1);
  const part = { orgId: ORG, kind: "schedxsupply", patientId: adm.patientId, fields: { dispenseId: x.dispenseId, date: TODAY, patientAddress: "Village B", manufacturer: "Maker Ltd", prescriptionRef: "RX-77", prescriptionCopyRef: "Scan RX-77", billNo: "B-9", billDate: TODAY, supervisedBy: "Pharmacist A" } };
  assert.equal((await as(INSPECTOR, "/ward/register-ndps", "POST", part)).__status, 403, "the inspector writes nothing");
  assert.equal((await as(NURSE, "/ward/register-ndps", "POST", part)).__status, 403);
  const saved = await as(PHARM, "/ward/register-ndps", "POST", part);
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.equal(saved.entry.serial, `X/${YEAR}/00001`);
  xr = await as(INSPECTOR, "/ward/register-ndps?orgId=" + ORG + "&view=schedx");
  assert.equal(xr.withoutParticulars, 0);
  assert.equal(xr.pages[0].supplies[0].particulars.prescriptionRef, "RX-77");

  assert.equal((await as(INSPECTOR, "/ward/register-ndps", "POST", { orgId: ORG, code: "Morphine", unit: "ampoule", counted: 1 })).__status, 403, "no count by the inspector");
  assert.equal((await as(NURSE, "/ward/register-ndps?orgId=" + ORG)).__status, 403, "the nurse does not read the book");
  assert.equal((await as(DOCTOR, "/ward/register-ndps?orgId=" + ORG + "&view=patient&patientId=" + adm.patientId)).__status, 403);
  const mine = await as(NURSE, "/ward/register-ndps?orgId=" + ORG + "&view=patient&patientId=" + adm.patientId);
  assert.equal(mine.__status, 200, JSON.stringify(mine));
  assert.equal(mine.readOnly, true);
  assert.equal((await as(NURSE, "/ward/register-ndps?orgId=" + ORG + "&view=book")).__status, 403, "only the patient view");

  const s = registerSettings({ registers: { ndps: { drugRegimes: [{ drug: "Diazepam", regime: "psychotropic" }] } } });
  assert.equal(regimeOf(s, controlledSet({ controlledDrugs: ["Morphine", "Diazepam"] }), "Diazepam", null), "psychotropic");
  assert.equal(regimeOf(s, controlledSet({ controlledDrugs: ["Morphine"] }), "Morphine", null), "end-chapter-vb", "the list's default is Chapter VB");
  assert.ok(validateRegisterSettings({ ndps: { drugRegimes: [{ drug: "X", regime: "schedule-y" }] } }).problems.some((p) => /schedule-y is not a regime/.test(p)));
  assert.ok(validateRegisterSettings({ mlc: { stateFormat: "atlantis" } }).problems.some((p) => /hospital or kerala/.test(p)));
});
