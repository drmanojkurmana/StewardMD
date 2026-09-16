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
  clinicName: "Hospital A Imaging, Main Road", clinicRegistrationNo: "PNDT/123", patientName: "Register Case", patientAge: 28, relativeName: "Husband",
  address: "12 Main Road, 9876500000", lmpOrWeeks: "20 weeks", procedureKind: "non-invasive", doctorName: "Dr Radiologist", indications: ["ii", "xvii"],
  procedureCarriedOut: "ultrasound", declarationDate: TODAY, procedureDate: TODAY, resultBrief: "Single live intrauterine pregnancy, growth appropriate.",
  resultConveyedTo: "Dr Obstetrician", resultConveyedOn: TODAY, womanDeclaration: "Register Case", doctorDeclaration: "Dr Radiologist",
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

test("an obstetric ultrasound report is not finalised (POST /ward/report-imaging) without a complete Form F; other imaging is unaffected", async () => {
  seed();
  const adm = await admitted();
  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "USG obstetric growth scan", category: "imaging" });
  assert.equal(order.__status, 200, JSON.stringify(order));
  const report = { orgId: ORG, serviceRequestId: order.orderId, findings: "Single live foetus.", impression: "Growth appropriate for dates.", status: "final" };
  const refused = await as(RAD, "/ward/report-imaging", "POST", report);
  assert.equal(refused.__status, 409, JSON.stringify(refused));
  assert.equal(refused.error, "formf_required");
  const prelim = await as(RAD, "/ward/report-imaging", "POST", { ...report, status: "preliminary" });
  assert.equal(prelim.__status, 200, "a preliminary report still reaches the ward");

  const incomplete = await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, patientId: adm.patientId, serviceRequestId: order.orderId, fields: { ...FORMF_OK, doctorDeclaration: undefined } });
  assert.equal(incomplete.__status, 200, JSON.stringify(incomplete));
  assert.equal((await as(RAD, "/ward/report-imaging", "POST", report)).error, "formf_incomplete");
  await as(RAD, "/ward/register-formf", "POST", { orgId: ORG, id: incomplete.entry.id, expectedVersion: 1, reason: "Doctor declaration signed", fields: FORMF_OK });
  const final = await as(RAD, "/ward/report-imaging", "POST", report);
  assert.equal(final.__status, 200, JSON.stringify(final));

  const other = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "USG abdomen", category: "imaging" });
  const plain = await as(RAD, "/ward/report-imaging", "POST", { ...report, serviceRequestId: other.orderId });
  assert.equal(plain.__status, 200, JSON.stringify(plain));
});

const MLC_OK = () => ({
  category: "rta", status: "open", arrivalAt: new Date(Date.now() - 3600000).toISOString(), broughtBy: "Traffic police constable 412", historyAsGiven: "Two-wheeler hit by a car, as told by the constable.",
  policeStation: "Central PS", policeOfficer: "HC Rao 412", intimationAt: new Date().toISOString(), intimationMode: "telephone", intimationNumber: "GD 55",
  injuries: [{ site: "Left forearm", kind: "laceration", size: "4 x 1 cm", nature: "simple" }], doctor: "Dr Casualty",
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
  reasons: ["contraceptive-failure"], terminationDate: TODAY, opinionRmp1: "Dr Obstetrician", terminatedBy: "Dr Obstetrician", contraception: "iud",
  consentBy: "woman", consentDate: TODAY, opinionCertified: "Dr Obstetrician",
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
  const two = await as(OBS, "/ward/register-mtp", "POST", { ...body, fields: { ...MTP_OK, gestationWeeks: 22, opinionRmp2: "Dr Second" } });
  assert.equal(two.entry.serial, `2/${YEAR}`);

  const list = await as(HIM, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH);
  assert.equal(list.__status, 200);
  assert.ok(list.entries.every((e) => e.fields.patientName === undefined && e.fields.address === undefined), "regulation 7: no name in the list");
  const csv = await as(HIM, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH + "&format=csv");
  assert.ok(!csv.csv.includes("Register Case") && !csv.csv.includes("Village B"));
  const f2 = await as(OBS, "/ward/register-mtp?orgId=" + ORG + "&period=" + MONTH + "&format=form2");
  assert.equal(f2.statement["3(a). Duration of pregnancy: up to 12 weeks"], 1);
  assert.equal(f2.statement["4(e). Total"], 2);
  assert.equal(f2.statement["5(b). I.U.D."], 2);
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
  assert.equal(pre.fields.deceasedName, "Register Case " + n);

  const deathFields = { ...pre.fields, deceasedAge: "30 years", addressAtDeath: "Ward A", permanentAddress: "Village C", informantName: "Medical records officer",
    informantAddress: "Hospital A", informantDeclaration: "Records Officer", residenceTownVillage: "Village C", medicallyCertified: "yes" };
  const body = { orgId: ORG, kind: "death", patientId: adm.patientId, fields: deathFields };
  assert.equal((await as(DOCTOR, "/ward/register-vital", "POST", body)).__status, 403);
  assert.equal((await as(ROGUE, "/ward/register-vital", "POST", body)).__status, 403);
  const other = await admitted();
  assert.equal((await as(HIM, "/ward/register-vital", "POST", { ...body, patientId: other.patientId })).error, "death_not_recorded");
  const saved = await as(HIM, "/ward/register-vital", "POST", body);
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.equal(saved.entry.complete, true, JSON.stringify(saved.entry.missing));

  const mccd = { form: "4", dateOfDeath: TODAY, deceasedName: "Register Case", sex: "male", ageValue: 30, ageUnit: "years", causeIa: "Respiratory failure due to pneumonia",
    causeIb: "Lobar pneumonia", underlyingIcd10: "heart failure", mannerOfDeath: "natural", certifier: "Dr Attending" };
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
  assert.deepEqual(r.schemas.map((s) => s.kind).sort(), ["birth", "death", "formf", "mccd", "mlc", "mtp", "ndpscount", "notification", "stillbirth"]);
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
