/* test/wardsynq-registers.test.mjs - the statutory registers (registers.js, register-routes.js, controlled-drugs.js,
 * notifiable.js). Real router, real RecordService, in-memory repository.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-registers.test.mjs
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
const { RecordService } = await import("../functions/_wardsynq/service.js");
const { makeActor, KIND, TIER } = await import("../wardsynq/wardsynq-actors.js");

const ORG = "org-a", ORG_B = "org-b";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const P = (r) => `${r}@example.test`;
const ADMIN = P("admin"), DOCTOR = P("doctor"), NURSE = P("nurse"), CASHIER = P("cashier"), PHARM = P("pharmacy"), SUPER = P("supervisor"),
  RAD = P("radiologist"), OBS = P("obstetrician"), HIM = P("him"), PH = P("public_health"), ROGUE = P("rogue");
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", WSQ_TICK_OFF: "1",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seed() {
  docs.clear(); clock = 1; RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-a", ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: { controlledDrugs: ["Morphine"] } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG_B}`, { fields: { id: ORG_B, code: "HOSP-B", name: "Hospital B", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-b", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [DOCTOR, "doctor"], [NURSE, "nurse"], [CASHIER, "cashier"], [PHARM, "pharmacy"], [SUPER, "supervisor"],
    [RAD, "radiologist"], [OBS, "obstetrician"], [HIM, "him"], [PH, "public_health"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  // A radiologist of ANOTHER hospital: every register of hospital A refuses them.
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
const registerRows = () => RECORD._rows.filter((r) => String(r.resourceType).startsWith("_wardsynq_register"));
let n = 0;
async function admitted(sex) {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Register Case " + n, mobile: "98765007" + String(n).padStart(2, "0"), gender: sex || "female", ageYears: 30 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Ward A", bed: String(n) });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { ...adm, mrn: reg.mrn };
}
const TODAY = new Date().toISOString().slice(0, 10), MONTH = TODAY.slice(0, 7), YEAR = TODAY.slice(0, 4);

const FORMF_OK = {
  firstReportedOn: TODAY, clinicName: "Hospital A Imaging, Main Road", clinicRegistrationNo: "PNDT/123", patientName: "Register Case", patientAge: 28,
  livingSons: "None", livingDaughters: "One, 4 years", relativeName: "Husband", address: "12 Main Road, 9876500000", selfReferral: "Dr Obstetrician",
  lmpOrWeeks: "20 weeks", procedureKind: "non-invasive", doctorName: "Dr Radiologist", indications: ["ii", "xvii"],
  procedureCarriedOut: "ultrasound", declarationDate: TODAY, declarationTime: "09:00", procedureDate: TODAY, procedureStartTime: "09:30",
  resultBrief: "Single live intrauterine pregnancy, growth appropriate.", resultConveyedTo: "Dr Obstetrician", resultConveyedOn: TODAY, mtpIndication: "None",
  closingPlace: "Hospital A", sectionDoctorRegistrationNo: "KMC 4411", sealOnPrint: "applied-on-print",
  womanSignedBy: "signature", womanDeclaration: "Register Case", doctorDeclaration: "Dr Radiologist", doctorDeclarationRegistrationNo: "KMC 4411",
};

test("PCPNDT Form F: /ward/register-formf is the radiologist's; 401, 403 with nothing written, other hospital, no foetal sex, corrections as versions", async () => {
  seed();
  const adm = await admitted();
  const body = { orgId: ORG, patientId: adm.patientId, fields: FORMF_OK };
  assert.equal((await as(null, "/ward/register-formf", "POST", body)).__status, 401, "no session");
  for (const who of [NURSE, DOCTOR, CASHIER, HIM]) assert.equal((await as(who, "/ward/register-formf", "POST", body)).__status, 403, who);
  assert.equal((await as(DOCTOR, "/ward/register-formf?orgId=" + ORG + "&period=" + MONTH)).__status, 403, "a doctor cannot read Form F");
  assert.equal((await as(ROGUE, "/ward/register-formf", "POST", body)).__status, 403, "another hospital's member");
  assert.equal(registerRows().length, 0, "nothing written by any refusal");

  const sex = await as(RAD, "/ward/register-formf", "POST", { ...body, fields: { ...FORMF_OK, resultBrief: "Male foetus seen", foetalSex: "male" } });
  assert.equal(sex.__status, 422, JSON.stringify(sex));
  assert.ok(sex.problems.some((p) => /foetalSex: not a field/.test(p)) && sex.problems.some((p) => /sex of a foetus/.test(p)));
  assert.equal(registerRows().length, 0);

  const partial = await as(RAD, "/ward/register-formf", "POST", { ...body, fields: { ...FORMF_OK, womanDeclaration: undefined } });
  assert.equal(partial.__status, 200, JSON.stringify(partial));
  assert.equal(partial.entry.complete, false);
  assert.ok(partial.entry.missing.includes("womanDeclaration"));
  assert.equal(partial.entry.fields.doctorDeclaration.by, idFor(RAD), "the attestation is stamped with who was signed in");

  const id = partial.entry.id;
  assert.equal((await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, id, expectedVersion: 1, fields: FORMF_OK })).error, "reason_required");
  assert.equal((await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, id, expectedVersion: 7, reason: "Declaration taken", fields: FORMF_OK })).error, "version_conflict");
  const fixed = await as(OBS, "/ward/register-formf", "POST", { orgId: ORG, id, expectedVersion: 1, reason: "Declaration taken", fields: FORMF_OK });
  assert.equal(fixed.__status, 200, JSON.stringify(fixed));
  assert.equal(fixed.entry.version, 2);
  assert.equal(fixed.entry.complete, true);

  const hist = await as(RAD, "/ward/register-formf?orgId=" + ORG + "&id=" + encodeURIComponent(id));
  assert.deepEqual(hist.versions.map((v) => v.version), [1, 2], "the first version is kept");
  assert.equal(hist.versions[1].correction.reason, "Declaration taken");
  const csv = await as(RAD, "/ward/register-formf?orgId=" + ORG + "&period=" + MONTH + "&format=csv");
  assert.equal(csv.__status, 200);
  assert.match(csv.csv, /A1\. Name and complete address/);
  assert.match(csv.submission, /manual/i);
  const audits = RECORD.audit.filter((a) => a.connectorId === "wardsynq-registers");
  assert.ok(audits.some((a) => a.action === "register.write") && audits.some((a) => a.action === "register.correct") && audits.some((a) => a.action === "register.read"));
  assert.ok(!JSON.stringify(audits).includes("Register Case"), "no name in the audit rows");
});

test("an obstetric ultrasound report (POST /ward/report-imaging) needs the woman's declaration on Form F, a final one the complete form with the doctor's declaration printed; other imaging is unaffected", async () => {
  seed();
  const adm = await admitted();
  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "USG obstetric growth scan", category: "imaging" });
  assert.equal(order.__status, 200, JSON.stringify(order));
  const report = { orgId: ORG, serviceRequestId: order.orderId, findings: "Single live foetus.", impression: "Growth appropriate for dates.", status: "final" };
  const refused = await as(RAD, "/ward/report-imaging", "POST", report);
  assert.equal(refused.__status, 409, JSON.stringify(refused));
  assert.equal(refused.error, "formf_declaration_required");
  assert.equal((await as(RAD, "/ward/report-imaging", "POST", { ...report, status: "preliminary" })).error, "formf_declaration_required", "rule 10(1A): not even a preliminary report without the declaration");

  const incomplete = await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, patientId: adm.patientId, serviceRequestId: order.orderId, fields: { ...FORMF_OK, doctorDeclaration: undefined } });
  assert.equal(incomplete.__status, 200, JSON.stringify(incomplete));
  assert.equal((await as(RAD, "/ward/report-imaging", "POST", { ...report, status: "preliminary" })).__status, 200, "with the declaration recorded, a preliminary report reaches the ward");
  assert.equal((await as(RAD, "/ward/report-imaging", "POST", report)).error, "formf_incomplete");
  const sexed = await as(RAD, "/ward/report-imaging", "POST", { ...report, impression: "Male foetus, growth appropriate." });
  assert.equal(sexed.__status, 422, JSON.stringify(sexed));
  assert.equal(sexed.error, "foetal_sex_refused");
  const refusalAudit = RECORD.audit.find((a) => a.action === "pcpndt.disclosure_refused");
  assert.ok(refusalAudit && refusalAudit.scope.fields.includes("impression") && !JSON.stringify(refusalAudit).includes("Male foetus"), "who, when and which field; never the text");
  await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, id: incomplete.entry.id, expectedVersion: 1, reason: "Doctor declaration signed", fields: FORMF_OK });
  const final = await as(RAD, "/ward/report-imaging", "POST", report);
  assert.equal(final.__status, 200, JSON.stringify(final));
  assert.equal(final.pcpndtDeclaration.text, "I have neither detected nor disclosed the sex of her foetus to anybody in any manner.");
  assert.equal(final.pcpndtDeclaration.registrationNo, "KMC 4411");

  const other = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "USG abdomen", category: "imaging" });
  const plain = await as(RAD, "/ward/report-imaging", "POST", { ...report, serviceRequestId: other.orderId });
  assert.equal(plain.__status, 200, JSON.stringify(plain));
});

const MLC_OK = () => ({
  category: "rta", status: "open", arrivalAt: new Date(Date.now() - 3600000).toISOString(), broughtBy: "Traffic police constable 412", historyAsGiven: "Two-wheeler hit by a car, as told by the constable.",
  policeStation: "Central PS", policeOfficer: "HC Rao 412", intimationAt: new Date().toISOString(), intimationMode: "telephone", intimationNumber: "GD 55",
  injuries: [{ site: "Left forearm", kind: "laceration", size: "4 x 1 cm", age: "Fresh", nature: "simple" }], doctor: "Dr Casualty",
});

test("medico-legal cases: POST /ward/register-mlc numbers per hospital; GET /ward/register-mlc is medical records only; /ward/mlc-flag and /ward/mlc-patient; the flag carries onto the death record", async () => {
  seed();
  const adm = await admitted("male");
  const body = { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, fields: MLC_OK() };
  assert.equal((await as(null, "/ward/register-mlc", "POST", body)).__status, 401);
  for (const who of [NURSE, CASHIER, PHARM, RAD]) assert.equal((await as(who, "/ward/register-mlc", "POST", body)).__status, 403, who);
  assert.equal((await as(ROGUE, "/ward/register-mlc", "POST", body)).__status, 403);
  assert.equal(registerRows().length, 0);

  const first = await as(DOCTOR, "/ward/register-mlc", "POST", body);
  assert.equal(first.__status, 200, JSON.stringify(first));
  assert.equal(first.entry.serial, `MLC/${YEAR}/00001`);
  assert.equal((await as(DOCTOR, "/ward/register-mlc", "POST", body)).error, "already_recorded", "one MLC per stay; a change is a correction");
  const adm2 = await admitted("male");
  const second = await as(DOCTOR, "/ward/register-mlc", "POST", { ...body, patientId: adm2.patientId, encounterId: adm2.encounterId });
  assert.equal(second.entry.serial, `MLC/${YEAR}/00002`);

  assert.equal((await as(DOCTOR, "/ward/register-mlc?orgId=" + ORG + "&period=" + MONTH)).__status, 403, "the register itself is medical records'");
  const list = await as(HIM, "/ward/register-mlc?orgId=" + ORG + "&period=" + MONTH);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.entries.length, 2);
  assert.equal(list.entries[0].fields.injuries, undefined, "injuries are not in the register list");
  assert.equal((await as(NURSE, "/ward/mlc-patient?orgId=" + ORG + "&patientId=" + adm.patientId)).__status, 403);
  const mine = await as(DOCTOR, "/ward/mlc-patient?orgId=" + ORG + "&patientId=" + adm.patientId);
  assert.equal(mine.entries[0].fields.injuries, undefined);
  const byMrn = await as(DOCTOR, "/ward/mlc-patient", "POST", { orgId: ORG, mrn: adm.mrn });
  assert.equal(byMrn.__status, 200, JSON.stringify(byMrn));
  assert.equal(byMrn.entries[0].serial, `MLC/${YEAR}/00001`);
  assert.equal((await as(NURSE, "/ward/mlc-patient", "POST", { orgId: ORG, mrn: adm.mrn })).__status, 403);
  const opened = await as(HIM, "/ward/register-mlc?orgId=" + ORG + "&id=" + encodeURIComponent(first.entry.id));
  assert.equal(opened.entry.fields.injuries.length, 1, "opening the one entry (audited) shows the injuries");

  const flag = await as(NURSE, "/ward/mlc-flag?orgId=" + ORG + "&patientId=" + adm.patientId);
  assert.equal(flag.__status, 200, JSON.stringify(flag));
  assert.equal(flag.mlc, true);
  assert.deepEqual(Object.keys(flag.cases[0]).sort(), ["encounterId", "eventDate", "serial"], "the flag carries the number and nothing from the case");
  assert.equal((await as(CASHIER, "/ward/mlc-flag?orgId=" + ORG + "&patientId=" + adm.patientId)).__status, 403);

  const died = await as(DOCTOR, "/ward/deceased", "POST", { orgId: ORG, patientId: adm.patientId, confirm: true, deceased: { at: new Date().toISOString(), cause: "Head injury" } });
  assert.equal(died.__status, 200, JSON.stringify(died));
  assert.deepEqual(died.deceased.medicoLegal, { mlc: true, numbers: [`MLC/${YEAR}/00001`] });
});

test("the change feed never hands out a register row, whatever the reader's scope", async () => {
  seed();
  const adm = await admitted("male");
  await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: adm.patientId, fields: MLC_OK() });
  assert.ok(registerRows().length > 0);
  const actor = makeActor({ id: "dr", kind: KIND.HUMAN, tier: TIER.EXECUTE, credential: "R1" });
  const svc = new RecordService({ repository: RECORD, tenant: { id: "tenant-a" }, actor });
  const page = await svc.changes(0, 500);
  assert.ok(page.records.length > 0);
  assert.equal(page.records.filter((r) => String(r.resourceType).startsWith("_wardsynq_register")).length, 0);
});

const MTP_OK = {
  admissionDate: TODAY, patientName: "Register Case", relation: "W/o A", age: 26, religion: "hindu", address: "Village B", gestationWeeks: 10,
  reasons: ["contraceptive-failure"], opinionRmp1: "Dr Obstetrician", opinionRmp1Clause: "b", method: "surgical", terminationDate: TODAY, terminationTime: "08:00",
  terminatedBy: "Dr Obstetrician", terminatedByClause: "b", terminationCertified: "Dr Obstetrician", contraception: "iud",
  mentallyIll: "no", consentBy: "woman", consentDate: TODAY, opinionCertified: "Dr Obstetrician", envelopeSealedBy: "Dr Obstetrician", envelopeReceivedByHead: "Dr Medical Superintendent",
};
const FORME_OK = {
  rmp1Name: "Dr Obstetrician", rmp1Qualification: "MD OBG", rmp1Address: "Hospital A", rmp1Clause: "b", rmp2Name: "Dr Second", rmp2Qualification: "MS OBG", rmp2Address: "Hospital A", rmp2Clause: "b",
  patientName: "Register Case", patientAddress: "Village B", gestationWeeks: 22, circumstances: ["b"], place: "Hospital A", signedOn: TODAY, rmp1Attestation: "Dr Obstetrician", rmp2Attestation: "Dr Second",
};

test("MTP: POST /ward/register-mtp enforces the Act's opinions, numbers n/year, keeps the name out of lists and exports; Form II counts", async () => {
  seed();
  const adm = await admitted();
  const body = { orgId: ORG, patientId: adm.patientId, fields: MTP_OK };
  for (const who of [DOCTOR, NURSE, RAD]) assert.equal((await as(who, "/ward/register-mtp", "POST", body)).__status, 403, who);
  assert.equal((await as(null, "/ward/register-mtp", "POST", body)).__status, 401);
  assert.equal((await as(ROGUE, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH)).__status, 403);
  const late = await as(OBS, "/ward/register-mtp", "POST", { ...body, fields: { ...MTP_OK, gestationWeeks: 22 } });
  assert.equal(late.__status, 422);
  assert.ok(late.problems.some((p) => /opinionRmp2/.test(p)));
  assert.equal(registerRows().length, 0);

  const ok = await as(OBS, "/ward/register-mtp", "POST", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.entry.serial, `1/${YEAR}`, "regulation 5(2): serial restarts each year and carries it");
  const noFormE = await as(OBS, "/ward/register-mtp", "POST", { ...body, fields: { ...MTP_OK, gestationWeeks: 22, opinionRmp2: "Dr Second", opinionRmp2Clause: "b", rule3BCategory: ["b"] } });
  assert.ok(noFormE.problems.some((p) => /formERef/.test(p)), "over 20 weeks a termination names its Form E");
  const formE = await as(OBS, "/ward/register-mtp", "POST", { ...body, kind: "mtpforme", fields: FORME_OK });
  assert.equal(formE.__status, 200, JSON.stringify(formE));
  const two = await as(OBS, "/ward/register-mtp", "POST", { ...body, fields: { ...MTP_OK, gestationWeeks: 22, opinionRmp2: "Dr Second", opinionRmp2Clause: "b", rule3BCategory: ["b"], formERef: formE.entry.serial } });
  assert.equal(two.__status, 200, JSON.stringify(two));
  assert.equal(two.entry.serial, `2/${YEAR}`);

  const list = await as(HIM, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH);
  assert.equal(list.__status, 200);
  assert.ok(list.entries.every((e) => e.fields.patientName === undefined && e.fields.address === undefined), "regulation 7: no name in the list");
  assert.equal((await as(HIM, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH + "&format=csv")).error, "legal_authority_required", "regulation 6: no export without a legal authority");
  const csv = await as(HIM, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH + "&format=csv&authorityOfficer=SP%20District&authorityLaw=CrPC%20s.91&authorityReference=Letter%2012");
  assert.equal(csv.__status, 200, JSON.stringify(csv));
  assert.ok(!csv.csv.includes("Register Case") && !csv.csv.includes("Village B"));
  assert.ok(RECORD.audit.some((a) => a.action === "register.export" && a.scope.authority.law === "CrPC s.91"), "the export names its authority in the audit");
  const f2 = await as(OBS, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH + "&format=form2");
  assert.equal(f2.statement["3(a). Duration of pregnancy: up to 12 weeks"], 1);
  assert.equal(f2.statement["4(e). Total"], 1, "the 2003 columns count up to 20 weeks");
  assert.equal(f2.statement["5(b). I.U.D."], 1);
  assert.equal(f2.annex.Total, 1, "over 20 weeks in the separately labelled annex");
  assert.equal(f2.sendTo, "The Chief Medical Officer of the State", "owner's legal guidance 2026-09-17 item 1");
  assert.match(f2.from, /head of the hospital or owner of the approved place/);
  for (const who of [DOCTOR, NURSE, CASHIER, RAD]) assert.equal((await as(who, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH + "&format=form2")).__status, 403, "Form II stays inside the restricted MTP workflow: " + who);
});

test("births and deaths: GET /ward/register-vital lists what is owed, prefills from the chart; POST /ward/register-vital and /ward/register-mccd (ICD-10 checked)", async () => {
  seed();
  const adm = await admitted("male");
  const died = await as(DOCTOR, "/ward/deceased", "POST", { orgId: ORG, patientId: adm.patientId, confirm: true, deceased: { at: new Date().toISOString(), cause: "Pneumonia" } });
  assert.equal(died.__status, 200, JSON.stringify(died));
  const q = "?orgId=" + ORG + "&kind=death&period=" + MONTH;
  for (const who of [DOCTOR, NURSE, CASHIER]) assert.equal((await as(who, "/ward/register-vital" + q + "&pending=1")).__status, 403, who);
  const owed = await as(HIM, "/ward/register-vital" + q + "&pending=1");
  assert.equal(owed.__status, 200, JSON.stringify(owed));
  assert.equal(owed.deaths.length, 1);
  assert.equal(owed.deaths[0].deathReport, false);
  const pre = await as(HIM, "/ward/register-vital?orgId=" + ORG + "&kind=death&prefill=" + encodeURIComponent(adm.patientId));
  assert.deepEqual(pre.fields.deceasedName, { first: "Register", middle: "Case", last: String(n) });

  const addr = { houseNo: "12", locality: "Main Road", townVillage: "Village C", subDistrict: "Taluk D", district: "District E", state: "Karnataka", pin: "560001" };
  const deathFields = { ...pre.fields, deceasedName: { first: "Register", last: "Case" }, deceasedAge: "30 years", addressAtDeath: addr, permanentAddress: addr, placeOfDeathAddress: addr,
    informantName: { first: "Records", last: "Officer" }, informantAddress: addr, informantDeclaration: "Records Officer", residence: { townVillage: "Village C", subDistrict: "Taluk D", district: "District E", state: "Karnataka", pin: "560001" }, medicallyCertified: "yes" };
  const body = { orgId: ORG, kind: "death", patientId: adm.patientId, fields: deathFields };
  assert.equal((await as(DOCTOR, "/ward/register-vital", "POST", body)).__status, 403);
  assert.equal((await as(ROGUE, "/ward/register-vital", "POST", body)).__status, 403);
  const other = await admitted();
  assert.equal((await as(HIM, "/ward/register-vital", "POST", { ...body, patientId: other.patientId })).error, "death_not_recorded");
  const saved = await as(HIM, "/ward/register-vital", "POST", body);
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.equal(saved.entry.complete, true, JSON.stringify(saved.entry.missing));

  const mccd = { form: "4", dateOfDeath: TODAY, deceasedName: { first: "Register", last: "Case" }, sex: "male", ageValue: 30, ageUnit: "years", causeIa: "Respiratory failure due to pneumonia",
    causeIb: "Lobar pneumonia", underlyingIcd10: "heart failure", mannerOfDeath: "natural", certifier: "Dr Attending", verifiedOn: TODAY, copyGivenToName: "Spouse", copyGivenToRelation: "Wife", copyGivenOn: TODAY };
  assert.equal((await as(HIM, "/ward/register-mccd", "POST", { orgId: ORG, patientId: adm.patientId, fields: mccd })).__status, 403, "the doctor certifies, not records");
  const bad = await as(DOCTOR, "/ward/register-mccd", "POST", { orgId: ORG, patientId: adm.patientId, fields: mccd });
  assert.equal(bad.__status, 422);
  assert.ok(bad.problems.some((p) => /underlyingIcd10/.test(p)));
  const good = await as(DOCTOR, "/ward/register-mccd", "POST", { orgId: ORG, patientId: adm.patientId, fields: { ...mccd, underlyingIcd10: "j18.1" } });
  assert.equal(good.__status, 200, JSON.stringify(good));
  assert.equal(good.entry.fields.underlyingIcd10, "J18.1");
  assert.equal(good.entry.fields.underlyingCause, "Lobar pneumonia", "the last line of Part I");
  const owed2 = await as(HIM, "/ward/register-vital" + q + "&pending=1");
  assert.equal(owed2.deaths.length, 0, "nothing owed once both are filed");
  const crs = await as(HIM, "/ward/register-vital" + q + "&format=csv");
  assert.match(crs.csv, /1\. Date of death/);
});

test("notifiable diseases: /ward/notifiable-prompts suggests from a diagnosis; POST /ward/register-notification; the weekly IHIP export is manual", async () => {
  seed();
  const adm = await admitted("male");
  await RECORD.append("tenant-a", [{ resourceType: "Condition", id: "cond-typhoid-1", version: 1, patientId: adm.patientId, code: "A01.0", display: "Typhoid fever", clinicalStatus: "active", verificationStatus: "confirmed" }]);
  assert.equal((await as(CASHIER, "/ward/notifiable-prompts?orgId=" + ORG + "&patientId=" + adm.patientId)).__status, 403);
  const pr = await as(NURSE, "/ward/notifiable-prompts?orgId=" + ORG + "&patientId=" + adm.patientId);
  assert.equal(pr.__status, 200, JSON.stringify(pr));
  assert.deepEqual(pr.prompts.map((p) => p.condition), ["enteric"]);

  const monday = (() => { const d = new Date(TODAY + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  const fields = { condition: "enteric", classification: "P", definitionMet: "yes", diagnosisDate: TODAY, ageYears: 30, sex: "male", village: "Village D", district: "District E", outcome: "alive" };
  const body = { orgId: ORG, patientId: adm.patientId, fields };
  for (const who of [NURSE, CASHIER, PHARM]) assert.equal((await as(who, "/ward/register-notification", "POST", body)).__status, 403, who);
  assert.equal((await as(DOCTOR, "/ward/register-notification", "POST", { ...body, fields: { ...fields, condition: "mumps", classification: "L" } })).__status, 422, "mumps is not an L form condition");
  const saved = await as(DOCTOR, "/ward/register-notification", "POST", body);
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.equal((await as(NURSE, "/ward/notifiable-prompts?orgId=" + ORG + "&patientId=" + adm.patientId)).prompts.length, 0, "notified, so no longer prompted");

  assert.equal((await as(DOCTOR, "/ward/register-notification?orgId=" + ORG + "&week=" + monday)).__status, 403, "the register is the nodal officer's");
  assert.equal((await as(PH, "/ward/register-notification?orgId=" + ORG + "&week=" + TODAY.slice(0, 8) + "31")).__status, 422);
  const week = await as(PH, "/ward/register-notification?orgId=" + ORG + "&week=" + monday + "&format=csv");
  assert.equal(week.__status, 200, JSON.stringify(week));
  assert.equal(week.entries.length, 1);
  assert.equal(week.notYetOnIhip, 1);
  assert.match(week.submission, /Manual/);
  assert.match(week.csv, /Condition \(IDSP\)/);
});

test("NDPS: controlled drugs need a verified second person at wastage and dispense; GET /ward/register-ndps is the book; POST /ward/register-ndps records a count without touching stock", async () => {
  seed();
  const adm = await admitted("male");
  const rcpt = await as(PHARM, "/ward/stock-move", "POST", { orgId: ORG, kind: "receipt", code: "Morphine", quantity: { value: 10, unit: "ampoule" }, receivedFrom: "State supplier", documentNo: "INV-9" });
  assert.equal(rcpt.__status, 200, JSON.stringify(rcpt));
  const waste = { orgId: ORG, kind: "wastage", code: "Morphine", quantity: { value: 1, unit: "ampoule" }, reason: "Ampoule broke" };
  const movements = () => RECORD._rows.filter((r) => r.resourceType === "StockMovement").length;
  const before = movements();
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", waste)).error, "witness_required");
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", { ...waste, witnessId: idFor(PHARM) })).error, "witness_not_independent");
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", { ...waste, witnessId: idFor(CASHIER) })).error, "witness_not_staff");
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", { ...waste, witnessId: idFor(ROGUE) })).error, "witness_not_staff", "another hospital's staff cannot witness");
  assert.equal(movements(), before, "no refused wastage was written");
  const ok = await as(PHARM, "/ward/stock-move", "POST", { ...waste, witnessId: idFor(NURSE) });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.movement.witnessedBy, idFor(NURSE));
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", { ...waste, code: "Paracetamol", reason: "Dropped" })).__status, 200, "an uncontrolled drug needs no witness");

  await RECORD.append("tenant-a", [{ resourceType: "MedicationOrder", id: "rx-morphine-1", version: 1, patientId: adm.patientId, encounterId: adm.encounterId, drug: "Morphine", status: "active", dose: { value: 2, unit: "mg" } }]);
  const disp = { orgId: ORG, orderId: "rx-morphine-1", quantity: { value: 2, unit: "ampoule" } };
  assert.equal((await as(PHARM, "/ward/dispense", "POST", disp)).error, "witness_required");
  const issued = await as(PHARM, "/ward/dispense", "POST", { ...disp, witnessId: idFor(SUPER) });
  assert.equal(issued.__status, 200, JSON.stringify(issued));
  assert.equal(issued.witnessedBy, idFor(SUPER));

  for (const who of [NURSE, DOCTOR, CASHIER]) assert.equal((await as(who, "/ward/register-ndps?orgId=" + ORG)).__status, 403, who);
  const book = await as(SUPER, "/ward/register-ndps?orgId=" + ORG);
  assert.equal(book.__status, 200, JSON.stringify(book));
  const item = book.items.find((i) => i.code === "Morphine");
  assert.equal(item.closing, 7);
  assert.deepEqual(item.lines.map((l) => l.kind), ["receipt", "wastage", "issue"]);
  assert.equal(item.form3h[0].received, 10);
  assert.equal(book.unwitnessed, 0);
  assert.ok(!book.items.some((i) => i.code === "Paracetamol"), "only controlled drugs are in the register");

  const count = { orgId: ORG, code: "Morphine", unit: "ampoule", counted: 6, shift: "Night" };
  assert.equal((await as(NURSE, "/ward/register-ndps", "POST", { ...count, witnessId: idFor(PHARM) })).__status, 403);
  assert.equal((await as(SUPER, "/ward/register-ndps", "POST", count)).error, "witness_required");
  const counted = await as(SUPER, "/ward/register-ndps", "POST", { ...count, witnessId: idFor(PHARM) });
  assert.equal(counted.__status, 200, JSON.stringify(counted));
  assert.equal(counted.expected, 7);
  assert.equal(counted.discrepancy, true);
  assert.equal(movements(), before + 2, "a count adjusts nothing");
  assert.equal((await as(SUPER, "/ward/register-ndps?orgId=" + ORG)).discrepancies, 1);
});

test("GET /ward/register-schema: every register's form, and the Registers page and Map tile reach them", async () => {
  seed();
  const r = await as(NURSE, "/ward/register-schema?orgId=" + ORG);
  assert.equal(r.__status, 200);
  assert.deepEqual(r.schemas.map((s) => s.kind).sort(), ["birth", "death", "dyingdecl", "form3e", "form3esign", "form3hclose", "form3i", "form3j", "formf", "formfprint", "homecare", "mccd", "mlc", "mtp", "mtpboard", "mtpforme", "ndpscount", "notification", "pocsotask", "quarantine", "schedxsupply", "statreturn", "stillbirth"]);
  assert.equal(r.schemas.find((s) => s.kind === "mlc").statutoryForm, false, "the MLC record says it is not a statutory form");
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../wardsynq/site/pages/registers.js", import.meta.url), "utf8");
  for (const route of ["/ward/register-ndps", "/ward/register-formf", "/ward/register-mlc", "/ward/register-mtp", "/ward/register-vital", "/ward/register-mccd", "/ward/register-notification", "/ward/register-schema"]) assert.ok(page.includes(route), route);
  assert.match(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"), /go: "registers"/);
});

test("PURE: a returned issue is not subtracted from stock, and the NDPS book shows the issue and the return", async () => {
  const { levelsFrom } = await import("../functions/_wardsynq/stock.js");
  const { registerBook, isControlledDrug } = await import("../functions/_wardsynq/controlled-drugs.js");
  const movements = [{ id: "m1", kind: "receipt", code: "Morphine", quantity: { value: 10, unit: "amp" }, at: "2026-09-01T08:00:00Z" }];
  const dispenses = [{ id: "d1", drug: "Morphine", quantity: { value: 2, unit: "amp" }, dispensedAt: "2026-09-02T08:00:00Z", state: "returned", returnedAt: "2026-09-02T20:00:00Z", witnessedBy: "w" }];
  assert.equal(levelsFrom(movements, dispenses).levels[0].level, 10);
  const book = registerBook({ cfg: { controlledDrugs: ["Morphine"] }, movements, dispenses });
  assert.deepEqual(book.items[0].lines.map((l) => [l.kind, l.balanceAfter]), [["receipt", 10], ["issue", 8], ["return", 10]]);
  assert.equal(book.items[0].ledgerMismatch, undefined);
  assert.equal(isControlledDrug({ controlledDrugs: ["Morphine"] }, "Morphine sulfate SR"), false, "whole names only, never a substring");
  assert.equal(isControlledDrug({ formulary: [{ drug: "Fentanyl", controlled: true }] }, "fentanyl"), true, "the formulary flag counts");
});

/* ---------------------------------------------------------------------------------------------------------------------
 * Legal review of the statutory registers, 2026-09-17 (sections B to F). Settings go through POST /org/register-settings. */
const settingsAs = (email, settings) => as(email, "/org/register-settings", "POST", { orgId: ORG, settings });
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

test("register settings: /org/register-settings is staff.admin's; 401, 403 with nothing saved, another hospital; a Form 3G past three years is refused; the notes come with it", async () => {
  seed();
  const before = JSON.stringify(docs.get(`q_orgs/${ORG}`).fields.wardsynq);
  assert.equal((await as(null, "/org/register-settings?orgId=" + ORG)).__status, 401);
  assert.equal((await settingsAs(null, { mtp: { formIIDueDay: 9 } })).__status, 401);
  for (const who of [NURSE, DOCTOR, OBS, PHARM]) assert.equal((await settingsAs(who, { mtp: { formIIDueDay: 9 } })).__status, 403, who);
  assert.equal((await as(ROGUE, "/org/register-settings", "POST", { orgId: ORG, settings: { mtp: { formIIDueDay: 9 } } })).__status, 403, "another hospital's admin");
  const bad = await settingsAs(ADMIN, { ndps: { rmi: { form3gNumber: "RMI/1", issuedOn: "2025-01-01", expiresOn: "2030-01-01" } } });
  assert.equal(bad.__status, 422, JSON.stringify(bad));
  assert.equal(JSON.stringify(docs.get(`q_orgs/${ORG}`).fields.wardsynq), before, "no refusal wrote anything");
  const saved = await settingsAs(ADMIN, { mtp: { formIIDueDay: 9 } });
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.deepEqual(saved.changed, ["mtp"]);
  const read = await as(ADMIN, "/org/register-settings?orgId=" + ORG);
  assert.equal(read.settings.mtp.formIIDueDay, 9);
  assert.equal(read.notes.formIIRecipient, undefined, "the recipient is settled by the owner's legal guidance, no longer a note");
  assert.match(read.notes.formIIDueDay, /hospital policy/);
  assert.deepEqual(docs.get(`q_orgs/${ORG}`).fields.wardsynq.controlledDrugs, ["Morphine"], "the other hospital settings are kept");
});

test("PCPNDT Form F (legal review B): register serial, thumb-impression attester, declaration before the scan, online portal, monthly report by the 5th, authenticated printout, disclosure refusal audited", async () => {
  seed();
  const adm = await admitted();
  const body = { orgId: ORG, patientId: adm.patientId, fields: FORMF_OK };
  const first = await as(RAD, "/ward/register-formf", "POST", body);
  assert.equal(first.__status, 200, JSON.stringify(first));
  assert.equal(first.entry.serial, `FORMF/${YEAR}/00001`, "rule 9(1): a register in serial order");
  assert.equal(first.entry.complete, true, JSON.stringify(first.entry.missing));

  const late = await as(RAD, "/ward/register-formf", "POST", { ...body, fields: { ...FORMF_OK, declarationTime: "10:00" } });
  assert.equal(late.__status, 422);
  assert.ok(late.problems.some((p) => /rule 10\(1A\)/.test(p)), "a declaration after the procedure started is refused");
  const thumb = await as(RAD, "/ward/register-formf", "POST", { ...body, fields: { ...FORMF_OK, womanSignedBy: "thumb-impression" } });
  assert.equal(thumb.entry.complete, false);
  for (const k of ["identifiedByName", "identifiedByAge", "identifiedBySex", "identifiedByAddress", "identifiedByContact", "identifiedByAttestation", "identifiedOn"]) assert.ok(thumb.entry.missing.includes(k), k);
  const noReferral = await as(RAD, "/ward/register-formf", "POST", { ...body, fields: { ...FORMF_OK, selfReferral: undefined, referredBy: "Dr Outside, Clinic Road" } });
  assert.ok(noReferral.entry.missing.includes("referralSlipKept"), "A7(a): the referral slip is preserved with Form F");

  const before = registerRows().length;
  const sexed = await as(OBS, "/ward/register-formf", "POST", { ...body, fields: { ...FORMF_OK, resultBrief: "Female foetus, growth normal." } });
  assert.equal(sexed.__status, 422);
  assert.equal(registerRows().length, before);
  const audit = RECORD.audit.filter((a) => a.action === "pcpndt.disclosure_refused");
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0].scope.fields, ["resultBrief"]);
  assert.equal(audit[0].actor, idFor(OBS));
  assert.ok(!JSON.stringify(audit).includes("Female foetus"), "the refused text is not kept");

  /* Online Form F follows the hospital's State/UT (legal-requirements.js): Maharashtra, online within five days. */
  docs.get(`q_orgs/${ORG}`).fields.regionProfile = { stateUt: "MH" };
  const portal = await as(RAD, "/ward/register-formf", "POST", body);
  assert.deepEqual(portal.entry.missing, ["portalSubmittedOn", "portalReference"], "Maharashtra: not complete without the portal submission and its acknowledgement");
  const mhList = await as(RAD, "/ward/register-formf?orgId=" + ORG + "&period=" + MONTH);
  assert.equal(mhList.stateSubmission.mode, "ONLINE");
  assert.equal(mhList.entries.find((e) => e.id === portal.entry.id).portalClock.dueBy, new Date(Date.parse(TODAY + "T00:00:00Z") + 5 * 86400000).toISOString().slice(0, 10), "due within five calendar days of the procedure");
  assert.equal(mhList.portalPending, 4, "every Form F of the month without a recorded portal submission");
  docs.get(`q_orgs/${ORG}`).fields.regionProfile = { stateUt: "BR" };
  assert.deepEqual((await as(RAD, "/ward/register-formf", "POST", body)).entry.missing, [], "Bihar is not configured: Form F is complete without a portal reference");
  docs.get(`q_orgs/${ORG}`).fields.regionProfile = { stateUt: "MH" };

  const list = await as(RAD, "/ward/register-formf?orgId=" + ORG + "&period=" + MONTH);
  assert.equal(list.incomplete, 3);
  assert.match(list.presumedContravention, /s\.4\(3\)/);
  assert.ok(list.centre.some((a) => a.kind === "formb-not-recorded"));

  const monthly = await as(RAD, "/ward/register-formf?orgId=" + ORG + "&period=" + MONTH + "&format=monthly");
  assert.equal(monthly.__status, 200, JSON.stringify(monthly));
  assert.equal(monthly.total, 5);
  assert.equal(monthly.incomplete, 3);
  assert.equal(monthly.csv.split("\r\n").filter((l) => /,no,/.test(l)).length, 3, "every incomplete Form F is in the report, flagged");
  assert.equal(monthly.clock.dueBy.slice(8), "05");
  assert.equal((await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, kind: "statreturn", fields: { returnKind: "mtp-form2", period: MONTH, submittedOn: TODAY, mode: "hand", recipient: "CMO", submittedBy: "Dr Radiologist" } })).error, "not_this_register");
  const filed = await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, kind: "statreturn", fields: { returnKind: "formf-monthly", period: MONTH, submittedOn: TODAY, mode: "portal", recipient: "District Appropriate Authority", acknowledgementRef: "ACK-77", submittedBy: "Dr Radiologist" } });
  assert.equal(filed.__status, 200, JSON.stringify(filed));
  assert.match((await as(RAD, "/ward/register-formf?orgId=" + ORG + "&period=" + MONTH + "&format=monthly")).clock.state, /^submitted/);

  assert.equal((await as(RAD, "/ward/register-formf?orgId=" + ORG + "&id=" + encodeURIComponent(thumb.entry.id) + "&format=print")).error, "formf_incomplete");
  const print = await as(RAD, "/ward/register-formf?orgId=" + ORG + "&id=" + encodeURIComponent(first.entry.id) + "&format=print");
  assert.equal(print.__status, 200, JSON.stringify(print));
  assert.match(print.hash, /^[0-9a-f]{64}$/);
  const auth = { formFId: first.entry.id, formFVersion: 1, printHash: "0".repeat(64), authenticatedBy: "Dr Radiologist", authenticatorRegistrationNo: "KMC 4411", authenticatedOn: TODAY, storageLocation: "Form F file 2026, shelf 3" };
  assert.equal((await as(DOCTOR, "/ward/register-formf", "POST", { orgId: ORG, kind: "formfprint", fields: { ...auth, printHash: print.hash } })).__status, 403, "not the custodian");
  assert.equal((await as(null, "/ward/register-formf", "POST", { orgId: ORG, kind: "formfprint", fields: auth })).__status, 401);
  const wrong = await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, kind: "formfprint", fields: auth });
  assert.ok(wrong.problems.some((p) => /printHash: does not match/.test(p)), JSON.stringify(wrong));
  const ok = await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, kind: "formfprint", fields: { ...auth, printHash: print.hash } });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.entry.fields.authenticatedBy.by, idFor(RAD));
  assert.equal((await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, kind: "mtp", fields: {} })).error, "unknown_register", "only the Form F family through this door");
});

test("MTP (legal review C): Rule 3B list, rule 4A eligibility, guardian consent and POCSO, Form D above 24 weeks with its 3-day clock, section 5, Form I late flag; companion forms refuse other roles", async () => {
  seed();
  const adm = await admitted();
  const body = { orgId: ORG, patientId: adm.patientId };
  const mtp = (fields) => as(OBS, "/ward/register-mtp", "POST", { ...body, fields: { ...MTP_OK, ...fields } });
  assert.ok((await mtp({ gestationWeeks: 22, opinionRmp2: "Dr Second", opinionRmp2Clause: "b", formERef: "E/x" })).problems.some((p) => /rule3BCategory/.test(p)));
  assert.ok((await mtp({ gestationWeeks: 14, terminatedByClause: "c" })).problems.some((p) => /rule 4\(c\) may not perform a surgical termination at 14 weeks/.test(p)));
  assert.ok((await mtp({ age: 16 })).problems.some((p) => /guardian consents in writing/.test(p)));
  const minor = await mtp({ age: 16, consentBy: "guardian", guardianName: "Mother, S Devi" });
  assert.equal(minor.__status, 200, JSON.stringify(minor));
  // Legal review C.4.6 (second pass): the intimation is a task on the medico-legal register, not a field here.
  assert.deepEqual(minor.opened.map((x) => x.register), ["pocsotask"]);
  assert.match(minor.pocso, /POCSO Act s\.19\(1\)/);

  const board = { requestDate: YESTERDAY, requestTime: "09:00", patientName: "Register Case", age: 27, caseNumber: "IP-12", reports: "Anomaly scan: anencephaly. Board concurs.", opinion: "denied",
    jurisdiction: "MTP Act s.3(2B)", physicallyFit: "yes", members: [{ role: "gynaecologist", name: "Dr G" }, { role: "paediatrician", name: "Dr P" }, { role: "radiologist-sonologist", name: "Dr R" }],
    opinionDate: TODAY, opinionTime: "08:00", recordedFor: "Dr G" };
  for (const who of [DOCTOR, RAD, NURSE]) assert.equal((await as(who, "/ward/register-mtp", "POST", { ...body, kind: "mtpboard", fields: board })).__status, 403, who);
  assert.equal((await as(null, "/ward/register-mtp", "POST", { ...body, kind: "mtpboard", fields: board })).__status, 401);
  assert.equal((await as(ROGUE, "/ward/register-mtp", "POST", { ...body, kind: "mtpboard", fields: board })).__status, 403);
  assert.ok((await as(OBS, "/ward/register-mtp", "POST", { ...body, kind: "mtpboard", fields: { ...board, members: board.members.slice(0, 2) } })).problems.some((p) => /s\.3\(2D\)/.test(p)));
  const denied = await as(OBS, "/ward/register-mtp", "POST", { ...body, kind: "mtpboard", fields: board });
  assert.equal(denied.__status, 200, JSON.stringify(denied));
  assert.equal(denied.entry.fields.opinionLate, false);
  assert.ok(denied.entry.fields.opinionDueBy && denied.entry.fields.terminationDueBy, "rule 3A: three days for the opinion, five for the termination");
  const over24 = { gestationWeeks: 26, reasons: ["foetal-abnormality"], opinionRmp2: "Dr Second", opinionRmp2Clause: "b", terminatedBy2: "Dr Second", terminatedBy2Clause: "d" };
  assert.ok((await mtp(over24)).problems.some((p) => /formDRef/.test(p)));
  assert.ok((await mtp({ ...over24, formDRef: denied.entry.serial })).problems.some((p) => /opinion allowed/.test(p)), "a denied Board opinion is refused");
  const allowed = await as(OBS, "/ward/register-mtp", "POST", { ...body, kind: "mtpboard", fields: { ...board, opinion: "allowed" } });
  const board26 = await mtp({ ...over24, formDRef: allowed.entry.serial });
  assert.equal(board26.__status, 200, JSON.stringify(board26));
  assert.equal(board26.entry.complete, true, JSON.stringify(board26.entry.missing));
  const s5 = await mtp({ gestationWeeks: 30, reasons: ["danger-to-life"], emergencySection5: "yes", emergencyAttestation: "Dr Obstetrician" });
  assert.equal(s5.__status, 200, "section 5: the opinion tiers do not apply, attested");

  const lateCert = await mtp({ terminationDate: YESTERDAY, terminationTime: "00:00", admissionDate: YESTERDAY, consentDate: YESTERDAY });
  assert.equal(lateCert.entry.fields.formICertifiedLate, true, "regulation 3: certified more than three hours after the termination is flagged, not refused");
  const list = await as(OBS, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH);
  assert.ok(list.entries.some((e) => e.flags.pocsoPending));
  assert.ok(list.form2.dueBy.endsWith("-07"), "Form II: the hospital's day, the 7th by default");
  assert.equal(list.entries.filter((e) => e.fields.patientName !== undefined).length, 0);
  assert.equal((await as(OBS, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH + "&kind=mtpboard")).entries[0].fields.patientName, undefined, "Form D lists without her name");

  await settingsAs(ADMIN, { mtp: { formIIOver20Annex: false } });
  const f2 = await as(HIM, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH + "&format=form2");
  assert.equal(f2.annex, undefined);
  assert.match(f2.annexOmitted, /no column/);
  assert.match(f2.recipientNote, /reg 4\(5\).*Chief Medical Officer of the State/);
});

test("MTP regulation 7: during her episode the ward list, bed board, timeline, discharge summary and front desk lookup show the serial number, not her name, to anyone outside the MTP register", async () => {
  seed();
  const adm = await admitted();
  const other = await admitted();
  const name = "Register Case " + (n - 1);
  const saved = await as(OBS, "/ward/register-mtp", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, fields: { ...MTP_OK, patientName: name } });
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  const serial = saved.entry.serial;

  const nurseList = await as(NURSE, "/ward/list?orgId=" + ORG);
  assert.equal(nurseList.__status, 200, JSON.stringify(nurseList));
  const row = nurseList.patients.find((p) => p.encounterId === adm.encounterId);
  assert.equal(row.name, serial);
  assert.equal(row.nameWithheld, "MTP Regulations 2003 reg 7");
  assert.equal(nurseList.patients.find((p) => p.encounterId === other.encounterId).name, "Register Case " + n, "another patient keeps her name");
  assert.equal((await as(OBS, "/ward/list?orgId=" + ORG)).patients.find((p) => p.encounterId === adm.encounterId).name, name, "the treating obstetrician keeps the MTP register and sees her name");

  const beds = await as(NURSE, "/ward/beds?orgId=" + ORG);
  assert.equal(beds.__status, 200, JSON.stringify(beds));
  assert.ok(!JSON.stringify(beds).includes(`"${name}"`), "bed board");
  const timeline = await as(DOCTOR, "/ward/timeline?orgId=" + ORG + "&patientId=" + adm.patientId);
  assert.equal(timeline.__status, 200, JSON.stringify(timeline));
  assert.ok(!JSON.stringify(timeline).includes(name) && JSON.stringify(timeline).includes(serial), "case sheet timeline");
  const ds = await as(NURSE, "/ward/discharge-summary?orgId=" + ORG + "&encounterId=" + adm.encounterId);
  assert.equal(ds.__status, 200, JSON.stringify(ds));
  assert.equal(ds.patient.name, serial, "discharge summary");
  const desk = await as(CASHIER, "/patient/get?orgId=" + ORG + "&mrn=" + encodeURIComponent(adm.mrn));
  assert.equal(desk.__status, 200, JSON.stringify(desk));
  assert.equal(desk.patient.name, serial, "the cashier's lookup");
  assert.equal((await as(HIM, "/patient/get?orgId=" + ORG + "&mrn=" + encodeURIComponent(adm.mrn))).patient.name, name, "medical records, the custodian");
});

test("medico-legal cases (legal review D): Good Samaritan identity optional; POCSO 24-hour and IO 7-day clocks; consent before examination; a woman doctor for a girl; BNSS s.397 blocks the invoice; the dying declaration is never edited", async () => {
  seed();
  const rta = await admitted("male");
  const gs = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: rta.patientId, encounterId: rta.encounterId, fields: { ...MLC_OK(), broughtBy: undefined, goodSamaritan: "yes" } });
  assert.equal(gs.__status, 200, JSON.stringify(gs));
  assert.equal(gs.entry.complete, true, "CMVR r.168(4): who brought the patient is never required");

  const girl = await admitted();
  const arrival = new Date(Date.now() - 30 * 3600000).toISOString();
  const pocso = { category: "pocso", status: "open", arrivalAt: arrival, historyAsGiven: "Disclosed to the school counsellor.", personSex: "female", freeTreatment: "confirmed", doctor: "Dr Casualty" };
  const noConsent = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: girl.patientId, encounterId: girl.encounterId, fields: { ...pocso, examStartAt: arrival } });
  assert.ok(noConsent.problems.some((p) => /s\.184\(7\)/.test(p)), JSON.stringify(noConsent));
  const maleDoctor = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: girl.patientId, encounterId: girl.encounterId, fields: { ...pocso, consentBy: "guardian", examiningDoctorSex: "male" } });
  assert.ok(maleDoctor.problems.some((p) => /s\.27\(2\)/.test(p)));
  const pv = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: girl.patientId, encounterId: girl.encounterId, fields: { ...pocso, consentBy: "guardian", pvExamination: "clinically-indicated" } });
  assert.ok(pv.problems.some((p) => /clinical reason/.test(p)));
  const opened = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: girl.patientId, encounterId: girl.encounterId, fields: { ...pocso, consentBy: "guardian", consentAt: arrival, consentName: "Mother", examiningDoctorName: "Dr Woman", examiningDoctorSex: "female", examEndAt: arrival } });
  assert.equal(opened.__status, 200, JSON.stringify(opened));
  assert.match(opened.freeTreatment, /BNSS s\.397/);
  assert.ok(opened.entry.missing.includes("pocsoReportAt") && opened.entry.missing.includes("policeStation"));

  const list = await as(HIM, "/ward/register-mlc?orgId=" + ORG + "&period=" + MONTH);
  assert.equal(list.__status, 200, JSON.stringify(list));
  const clocks = list.entries.find((e) => e.id === opened.entry.id).clocks;
  assert.equal(clocks.find((c) => c.kind === "pocso-report").state, "overdue", "POCSO Rules r.6(5): 24 hours");
  assert.equal(clocks.find((c) => c.kind === "io-report").state, "due", "BNSS s.184(6): 7 days");
  assert.equal(list.clockSummary.overdue, 1);

  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: girl.patientId });
  assert.equal(inv.__status, 409, JSON.stringify(inv));
  assert.equal(inv.error, "free_treatment_bnss_397");
  assert.notEqual((await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: rta.patientId })).error, "free_treatment_bnss_397", "a road accident is billed as usual");

  await settingsAs(ADMIN, { mlc: { intimationCategories: [] } });
  /* MedLEaPR follows the State/UT (legal-requirements.js): required in Rajasthan from 1 February 2026 (High Court order),
   * not configured in Karnataka. */
  docs.get(`q_orgs/${ORG}`).fields.regionProfile = { stateUt: "RJ" };
  const bite = await admitted("male");
  const biteCase = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: bite.patientId, encounterId: bite.encounterId, fields: { category: "animal-bite", status: "open", arrivalAt: new Date().toISOString(), historyAsGiven: "Dog bite.", doctor: "Dr Casualty" } });
  assert.deepEqual(biteCase.entry.missing, ["medleaprReference", "medleaprFrozenOn"], "not a statutory intimation once the hospital narrows the list; MedLEaPR required in Rajasthan");
  const before = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: bite.patientId, fields: { category: "animal-bite", status: "open", arrivalAt: "2026-01-31T10:00:00+05:30", historyAsGiven: "Dog bite.", doctor: "Dr Casualty" } });
  assert.deepEqual(before.entry.missing, [], "a case that arrived before 1 February 2026 follows the State-prescribed workflow");
  docs.get(`q_orgs/${ORG}`).fields.regionProfile = { stateUt: "KA" };
  const ka = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: bite.patientId, fields: { category: "animal-bite", status: "open", arrivalAt: new Date().toISOString(), historyAsGiven: "Dog bite.", doctor: "Dr Casualty" } });
  assert.deepEqual(ka.entry.missing, [], "Karnataka: MedLEaPR not configured, no reference required");
  delete docs.get(`q_orgs/${ORG}`).fields.regionProfile;

  const decl = { mlcNumber: opened.entry.serial, fitnessBeforeAt: new Date(Date.now() - 7200000).toISOString(), fitnessBefore: "Dr Casualty", magistrateCalled: "unavailable", witness1Name: "Staff Nurse A, Hospital A", witness1: "Staff Nurse A",
    witness2Name: "Security Officer B, Hospital A", witness2: "Security Officer B", startDate: TODAY, startTime: "01:00", language: "Kannada", statementVerbatim: "As spoken.", readOver: "yes",
    declarantMark: "thumb-impression", declarantMarkRef: "Scan DD-1", endTime: "01:20", fitnessAfterAt: new Date(Date.now() - 3600000).toISOString(), fitnessAfter: "Dr Casualty" };
  assert.equal((await as(NURSE, "/ward/register-mlc", "POST", { orgId: ORG, patientId: rta.patientId, kind: "dyingdecl", fields: decl })).__status, 403);
  assert.equal((await as(null, "/ward/register-mlc", "POST", { orgId: ORG, patientId: rta.patientId, kind: "dyingdecl", fields: decl })).__status, 401);
  const dd = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, patientId: rta.patientId, kind: "dyingdecl", fields: decl });
  assert.equal(dd.__status, 200, JSON.stringify(dd));
  assert.equal(dd.entry.complete, true, JSON.stringify(dd.entry.missing));
  const edit = await as(DOCTOR, "/ward/register-mlc", "POST", { orgId: ORG, kind: "dyingdecl", id: dd.entry.id, expectedVersion: 1, reason: "Typo in the statement", fields: decl });
  assert.equal(edit.__status, 409);
  assert.equal(edit.error, "immutable_entry");
});

test("births and deaths (legal review E): no Aadhaar kept, 21-day clock on the list, Form 4 needs no ICD-10 code, a manner other than natural asks for a medico-legal case", async () => {
  seed();
  const adm = await admitted("male");
  await as(DOCTOR, "/ward/deceased", "POST", { orgId: ORG, patientId: adm.patientId, confirm: true, deceased: { at: new Date().toISOString(), cause: "Fall from height" } });
  const refused = await as(HIM, "/ward/register-vital", "POST", { orgId: ORG, kind: "death", patientId: adm.patientId, fields: { dateOfDeath: TODAY, deceasedAadhaar: "123412341234" } });
  assert.equal(refused.__status, 422);
  assert.equal(registerRows().length, 0);
  const partial = await as(HIM, "/ward/register-vital", "POST", { orgId: ORG, kind: "death", patientId: adm.patientId, fields: { dateOfDeath: TODAY, sex: "male" } });
  assert.equal(partial.__status, 200, JSON.stringify(partial));
  assert.equal(partial.entry.formVersion, "model-2024");
  const list = await as(HIM, "/ward/register-vital?orgId=" + ORG + "&kind=death&period=" + MONTH);
  assert.equal(list.entries[0].clock.state, "due");
  const owed = await as(HIM, "/ward/register-vital?orgId=" + ORG + "&kind=death&period=" + MONTH + "&pending=1");
  assert.equal(owed.notSubmitted.length, 1, "written but not yet recorded as submitted");

  const mccd = { form: "4", dateOfDeath: TODAY, sex: "male", ageValue: 30, ageUnit: "years", causeIa: "Traumatic brain injury", causeIb: "Fall from height", mannerOfDeath: "accident",
    howInjuryOccurred: "Fell from scaffolding at work.", certifier: "Dr Attending", verifiedOn: TODAY, copyGivenToName: "Spouse", copyGivenToRelation: "Wife", copyGivenOn: TODAY };
  const cert = await as(DOCTOR, "/ward/register-mccd", "POST", { orgId: ORG, patientId: adm.patientId, fields: mccd });
  assert.equal(cert.__status, 200, JSON.stringify(cert));
  assert.equal(cert.entry.complete, true, "no ICD-10 code is needed: Form No. 4 has no such field");
  assert.match(cert.mlcPrompt, /no medico-legal case is open/);
});

test("NDPS (legal review F): Form 3E registration and the patient's signature per supply; Form 3J and 3-I with due dates; destruction before the Controller's nominee; an expired recognition refuses receipts and dispensing", async () => {
  seed();
  const adm = await admitted("male");
  const receipt = { orgId: ORG, kind: "receipt", code: "Morphine", quantity: { value: 10, unit: "ampoule" }, receivedFrom: "State supplier", documentNo: "INV-9" };
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", receipt)).__status, 200);

  const reg = { registrationDate: TODAY, patientName: "Register Case", address: "Village B", contactNumber: "9876500000", illness: "Carcinoma pancreas, pain", otherRegistration: "no" };
  for (const who of [NURSE, DOCTOR, CASHIER]) assert.equal((await as(who, "/ward/register-ndps", "POST", { orgId: ORG, patientId: adm.patientId, kind: "form3e", fields: reg })).__status, 403, who);
  assert.equal((await as(null, "/ward/register-ndps", "POST", { orgId: ORG, patientId: adm.patientId, kind: "form3e", fields: reg })).__status, 401);
  assert.equal((await as(ROGUE, "/ward/register-ndps", "POST", { orgId: ORG, patientId: adm.patientId, kind: "form3e", fields: reg })).__status, 403);
  assert.equal(registerRows().length, 0);
  const r3e = await as(PHARM, "/ward/register-ndps", "POST", { orgId: ORG, patientId: adm.patientId, kind: "form3e", fields: reg });
  assert.equal(r3e.__status, 200, JSON.stringify(r3e));
  assert.equal(r3e.entry.serial, `3E/${YEAR}/00001`);

  await RECORD.append("tenant-a", [{ resourceType: "MedicationOrder", id: "rx-morphine-2", version: 1, patientId: adm.patientId, encounterId: adm.encounterId, drug: "Morphine", status: "active", dose: { value: 2, unit: "mg" } }]);
  const issued = await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: "rx-morphine-2", quantity: { value: 2, unit: "ampoule" }, witnessId: idFor(SUPER) });
  assert.equal(issued.__status, 200, JSON.stringify(issued));
  const book = await as(SUPER, "/ward/register-ndps?orgId=" + ORG);
  assert.equal(book.withoutForm3e, 0);
  assert.equal(book.items[0].form3h.find((d) => d.dispensed).toPatients[0].form3e, `3E/${YEAR}/00001`, "Form 3H names the Form 3E registration");

  const view = await as(PHARM, "/ward/register-ndps?orgId=" + ORG + "&view=form3e&patientId=" + adm.patientId);
  assert.equal(view.__status, 200, JSON.stringify(view));
  assert.equal(view.unsigned, 1);
  const dispenseId = view.rows[0].dispenseId;
  const sign = { form3eId: r3e.entry.id, dispenseId, date: TODAY, drug: "Morphine", quantity: "2 ampoule", signedBy: "representative", signature: "Son, R Case" };
  const other = await admitted("male");
  assert.ok((await as(PHARM, "/ward/register-ndps", "POST", { orgId: ORG, patientId: other.patientId, kind: "form3esign", fields: sign })).problems.some((p) => /form3eId/.test(p)), "another patient's registration is refused");
  const half = await as(PHARM, "/ward/register-ndps", "POST", { orgId: ORG, patientId: adm.patientId, kind: "form3esign", fields: sign });
  assert.deepEqual(half.entry.missing, ["representativeName", "representativeReason"]);
  assert.equal((await as(PHARM, "/ward/register-ndps?orgId=" + ORG + "&view=form3e&patientId=" + adm.patientId)).unsigned, 1, "an incomplete signature is not a signature");
  const signed = await as(PHARM, "/ward/register-ndps", "POST", { orgId: ORG, kind: "form3esign", id: half.entry.id, expectedVersion: 1, reason: "Son named, patient drowsy", fields: { ...sign, representativeName: "R Case, son", representativeReason: "Patient drowsy after the dose" } });
  assert.equal(signed.entry.complete, true, JSON.stringify(signed));
  assert.equal(signed.entry.fields.signature.by, idFor(PHARM), "who recorded the attestation, and when, is the server's stamp");
  assert.equal((await as(PHARM, "/ward/register-ndps?orgId=" + ORG + "&view=form3e&patientId=" + adm.patientId)).unsigned, 0);

  const est = { year: Number(YEAR), estimateKind: "estimate", drug: "Morphine", unit: "ampoule", quantity: 1, preparedOn: TODAY, preparedBy: "Dr Pharmacist" };
  assert.equal((await as(NURSE, "/ward/register-ndps", "POST", { orgId: ORG, kind: "form3j", fields: est })).__status, 403);
  assert.equal((await as(PHARM, "/ward/register-ndps", "POST", { orgId: ORG, kind: "form3j", fields: est })).__status, 200);
  assert.equal((await as(DOCTOR, "/ward/register-ndps?orgId=" + ORG + "&view=annual&year=" + YEAR)).__status, 403);
  const annual = await as(PHARM, "/ward/register-ndps?orgId=" + ORG + "&view=annual&year=" + YEAR);
  assert.equal(annual.__status, 200, JSON.stringify(annual));
  const row = annual.form3i.find((x) => x.drug === "Morphine");
  assert.deepEqual([row.procured, row.disbursed, row.estimate, row.overEstimate], [10, 2, 1, true]);
  assert.deepEqual(annual.clocks.map((c) => c.what), ["form3j", "form3i"]);
  const ret = { year: Number(YEAR), drug: "Morphine", unit: "ampoule", preparedOn: TODAY, preparedBy: "Dr Pharmacist" };
  assert.ok((await as(PHARM, "/ward/register-ndps", "POST", { orgId: ORG, kind: "form3i", fields: ret })).problems.some((p) => /justification/.test(p)));
  const i3 = await as(PHARM, "/ward/register-ndps", "POST", { orgId: ORG, kind: "form3i", fields: { ...ret, justification: "Two terminal-care admissions over the estimate." } });
  assert.equal(i3.__status, 200, JSON.stringify(i3));
  assert.equal(i3.entry.fields.disbursed, 2, "the numbers are the ledger's, not typed");

  const expired = { orgId: ORG, kind: "wastage", code: "Morphine", quantity: { value: 1, unit: "ampoule" }, reason: "Expired stock destroyed", witnessId: idFor(NURSE) };
  const noNominee = await as(PHARM, "/ward/stock-move", "POST", expired);
  assert.equal(noNominee.error, "destruction_nominee_required");
  const destroyed = await as(PHARM, "/ward/stock-move", "POST", { ...expired, destruction: { nomineeName: "Shri A Inspector", nomineeDesignation: "Drugs Inspector", nominatingOrderRef: "CD/NOM/12", destroyedOn: TODAY } });
  assert.equal(destroyed.__status, 200, JSON.stringify(destroyed));
  assert.equal(destroyed.movement.destruction.nominatingOrderRef, "CD/NOM/12");

  await settingsAs(ADMIN, { ndps: { requireWitness: false, rmi: { form3gNumber: "RMI/7", issuedOn: "2023-01-01", expiresOn: "2025-12-31", designatedDoctors: [{ name: "Dr P", overallInCharge: true }] } } });
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", receipt)).error, "rmi_recognition_expired");
  await RECORD.append("tenant-a", [{ resourceType: "MedicationOrder", id: "rx-morphine-3", version: 1, patientId: adm.patientId, encounterId: adm.encounterId, drug: "Morphine", status: "active", dose: { value: 2, unit: "mg" } }]);
  assert.equal((await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: "rx-morphine-3", quantity: { value: 1, unit: "ampoule" } })).error, "rmi_recognition_expired");
  await settingsAs(ADMIN, { ndps: { requireWitness: false, rmi: { form3gNumber: "RMI/7", issuedOn: "2023-01-01", expiresOn: "2025-12-31", renewalApplicationRef: "CD/REN/44", designatedDoctors: [{ name: "Dr P", overallInCharge: true }] } } });
  const unwitnessed = await as(PHARM, "/ward/stock-move", "POST", { orgId: ORG, kind: "wastage", code: "Morphine", quantity: { value: 1, unit: "ampoule" }, reason: "Ampoule broke" });
  assert.equal(unwitnessed.__status, 200, "the witness is hospital policy, switched off here");
  // Renewal applied for, so recognition no longer refuses; the Form 3J estimate of 1 (r.52U) now does, until a revised estimate is named.
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", receipt)).error, "above_form3j_estimate");
  assert.equal((await as(PHARM, "/ward/stock-move", "POST", { ...receipt, revisedEstimateRef: "CD/3J-REV/2" })).__status, 200, "renewal applied for, revised estimate named");
});
