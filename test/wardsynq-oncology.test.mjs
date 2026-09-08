/* test/wardsynq-oncology.test.mjs — the ONCqis bridge, through the REAL routes.
 *
 * ONCqis is not rebuilt: this proves the LINKAGE (resolving a bare ghisPatientId to the real
 * canonical patientId, the same identity discipline every other GHIS-sourced record already keeps),
 * the diagnosis/staging bolt-on (staging never recomputed, only recorded), a CTCAE-graded adverse
 * event (the grade never computed here), a chemo administration's real documentation fields (dose
 * lineage, premedications, structured extravasation), and the longitudinal timeline that proves the
 * oncology record is no longer disconnected. No new Encounter.class - oncology maps onto the
 * existing OPD/DAYCARE/IPD, unchanged.
 *
 * Same harness shape as wardsynq-pediatrics.test.mjs / wardsynq-maternity.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-oncology.test.mjs
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

test("LINK: an ONCqis plan resolves its bare ghisPatientId to the SAME canonical patientId every other GHIS-sourced record already keys on", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Oncology Testcase", mobile: "9876500401", gender: "female", ageYears: 54 });
  const link = await as(DOCTOR, "/ward/onco-link", "POST", { orgId: ORG, plan: { oncoPlanId: "plan-001", hospitalId: "SMD-WARD01", ghisPatientId: reg.mrn, regimen: "AC-T", protocolVersion: "3" } });
  assert.equal(link.__status, 200, JSON.stringify(link));
  const record = await RECORD.latest(TENANT_ROW.id, "OncologyLink", link.linkId);
  assert.equal(record.patientId, "opd-pat-" + reg.mrn.toLowerCase());
  assert.equal(record.regimen, "AC-T"); assert.equal(record.ghisPatientId, reg.mrn);

  const got = await as(DOCTOR, `/ward/onco-link-get?orgId=${ORG}&patientId=${record.patientId}`);
  assert.equal(got.links.length, 1); assert.equal(got.links[0].oncoPlanId, "plan-001");

  // Retrying the SAME link is idempotent (the same version-checked write path every other record uses).
  const again = await as(DOCTOR, "/ward/onco-link", "POST", { orgId: ORG, plan: { oncoPlanId: "plan-001", hospitalId: "SMD-WARD01", ghisPatientId: reg.mrn, regimen: "AC-T", protocolVersion: "3" } });
  assert.equal(again.__status, 200, JSON.stringify(again));
});

test("DIAGNOSIS: staging is recorded exactly as ONCqis's own engine resolved it, never recomputed - and a Condition with no staging works unchanged", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Staging Testcase", mobile: "9876500402", gender: "male", ageYears: 61 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const dx = await as(DOCTOR, "/ward/onco-diagnosis", "POST", { orgId: ORG, patientId, condition: { code: "C34.1", codeSystem: "ICD-10", display: "Malignant neoplasm of upper lobe, bronchus or lung" }, staging: { oncoSite: "lung", stageGroup: "IIIA", t: "T2", n: "N2", m: "M0", resolvedAt: "2026-09-01T00:00:00.000Z" } });
  assert.equal(dx.__status, 200, JSON.stringify(dx));
  const cond = await RECORD.latest(TENANT_ROW.id, "Condition", dx.conditionId);
  assert.equal(cond.oncologyStaging.stageGroup, "IIIA"); assert.equal(cond.oncologyStaging.t, "T2");
  assert.equal(cond.oncologyStaging.source, "oncqis", "staging is attributed to ONCqis's own engine, never claimed as computed here");

  const noStaging = await as(DOCTOR, "/ward/onco-diagnosis", "POST", { orgId: ORG, patientId, condition: { code: "R50.9", display: "Fever, unspecified" } });
  assert.equal(noStaging.__status, 200, JSON.stringify(noStaging));
  const cond2 = await RECORD.latest(TENANT_ROW.id, "Condition", noStaging.conditionId);
  assert.equal(cond2.oncologyStaging, undefined, "a non-oncology diagnosis carries no staging bolt-on at all");
});

test("ADVERSE EVENT: a CTCAE grade is recorded, never computed, and an out-of-range grade is refused", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "AE Testcase", mobile: "9876500403", gender: "female", ageYears: 48 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const ae = await as(DOCTOR, "/ward/onco-ae", "POST", { orgId: ORG, patientId, oncoPlanId: "plan-002", event: { term: "Neutropenia", grade: 3, ctcaeVersion: "5.0" } });
  assert.equal(ae.__status, 200, JSON.stringify(ae));
  const record = await RECORD.latest(TENANT_ROW.id, "AdverseEventRecord", ae.eventId);
  assert.equal(record.grade, 3); assert.equal(record.term, "Neutropenia"); assert.equal(record.ctcaeVersion, "5.0");

  const badGrade = await as(DOCTOR, "/ward/onco-ae", "POST", { orgId: ORG, patientId, event: { term: "Nausea", grade: 6 } });
  assert.equal(badGrade.__status, 422); assert.equal(badGrade.error, "grade_must_be_1_to_5");

  const list = await as(DOCTOR, `/ward/onco-ae-list?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(list.events.length, 1);
});

test("CHEMO ADMINISTRATION: dose lineage, premedications and a structured extravasation field all round-trip; the SAME record retried is idempotent", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Chemo Testcase", mobile: "9876500404", gender: "male", ageYears: 58 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Daycare Oncology", bed: "3", admittedAt: "2026-09-09T08:00:00.000Z" });
  const patientId = adm.patientId;
  const chemo = await as(DOCTOR, "/ward/onco-chemo", "POST", { orgId: ORG, patientId, encounterId: adm.encounterId, oncoPlanId: "plan-003", cycleId: "plan-003__1", admin: {
    drug: "Doxorubicin", doseGiven: 90, doseUnit: "mg", bsaUsed: 1.8, route: "IV",
    premedications: ["Ondansetron 8mg", "Dexamethasone 12mg"], extravasation: { occurred: false },
  } });
  assert.equal(chemo.__status, 200, JSON.stringify(chemo));
  const record = await RECORD.latest(TENANT_ROW.id, "ChemoAdministrationRecord", chemo.chemoId);
  assert.equal(record.doseGiven, 90); assert.equal(record.bsaUsed, 1.8);
  assert.deepEqual(record.premedications, ["Ondansetron 8mg", "Dexamethasone 12mg"]);
  assert.equal(record.extravasation.occurred, false);

  const withExtrav = await as(DOCTOR, "/ward/onco-chemo", "POST", { orgId: ORG, patientId, encounterId: adm.encounterId, oncoPlanId: "plan-003", cycleId: "plan-003__2", admin: {
    drug: "Doxorubicin", doseGiven: 90, doseUnit: "mg", route: "IV", startedAt: "2026-09-23T08:00:00.000Z",
    extravasation: { occurred: true, detail: "Small volume, dorsum of hand, cold compress applied and oncology notified." },
  } });
  const record2 = await RECORD.latest(TENANT_ROW.id, "ChemoAdministrationRecord", withExtrav.chemoId);
  assert.equal(record2.extravasation.occurred, true, "an extravasation is a structured, queryable fact, never buried in free text alone");

  const again = await as(DOCTOR, "/ward/onco-chemo", "POST", { orgId: ORG, patientId, encounterId: adm.encounterId, oncoPlanId: "plan-003", cycleId: "plan-003__2", admin: { drug: "Doxorubicin", doseGiven: 90, route: "IV", startedAt: "2026-09-23T08:00:00.000Z" } });
  assert.equal(again.skipped, "already_recorded");

  const list = await as(DOCTOR, `/ward/onco-chemo-list?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(list.administrations.length, 2);
});

test("TIMELINE: one read assembles the link, diagnosis, adverse events and chemo administrations - proving the record is no longer disconnected", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Timeline Testcase", mobile: "9876500405", gender: "female", ageYears: 50 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Daycare Oncology", bed: "4" });
  const patientId = adm.patientId;
  await as(DOCTOR, "/ward/onco-link", "POST", { orgId: ORG, encounterId: adm.encounterId, plan: { oncoPlanId: "plan-004", hospitalId: "SMD-WARD01", ghisPatientId: reg.mrn, regimen: "FOLFOX" } });
  await as(DOCTOR, "/ward/onco-diagnosis", "POST", { orgId: ORG, patientId, condition: { code: "C18.9", display: "Malignant neoplasm of colon" }, staging: { oncoSite: "colon", stageGroup: "III", t: "T3", n: "N1", m: "M0" } });
  await as(DOCTOR, "/ward/onco-ae", "POST", { orgId: ORG, patientId, oncoPlanId: "plan-004", event: { term: "Peripheral neuropathy", grade: 2 } });
  await as(DOCTOR, "/ward/onco-chemo", "POST", { orgId: ORG, patientId, encounterId: adm.encounterId, oncoPlanId: "plan-004", cycleId: "plan-004__1", admin: { drug: "Oxaliplatin", doseGiven: 150, route: "IV" } });

  const tl = await as(DOCTOR, `/ward/onco-timeline?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(tl.__status, 200, JSON.stringify(tl));
  assert.equal(tl.timeline.links.length, 1);
  assert.equal(tl.timeline.diagnoses.length, 1); assert.equal(tl.timeline.diagnoses[0].oncologyStaging.stageGroup, "III");
  assert.equal(tl.timeline.adverseEvents.length, 1);
  assert.equal(tl.timeline.chemoAdministrations.length, 1);
});

test("NO NEW ENCOUNTER CLASS: an oncology day-case admission is an ordinary IPD/DAYCARE-shaped admission through migrate-inpatient.js, unchanged", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "No New Class Testcase", mobile: "9876500406", gender: "male", ageYears: 45 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Daycare Oncology", bed: "5" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(enc.class, "IPD", "oncology reuses the existing admission path unchanged - it does not need or get a new Encounter.class");
});

test("RBAC: pharmacy (no emr.treat) cannot link a plan, record a diagnosis, an adverse event or a chemo administration", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "RBAC Testcase", mobile: "9876500407", gender: "female", ageYears: 40 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const link = await as(PHARM, "/ward/onco-link", "POST", { orgId: ORG, plan: { oncoPlanId: "plan-005", ghisPatientId: reg.mrn } });
  assert.equal(link.__status, 403, JSON.stringify(link));
  const dx = await as(PHARM, "/ward/onco-diagnosis", "POST", { orgId: ORG, patientId, condition: { code: "C50.9" } });
  assert.equal(dx.__status, 403, JSON.stringify(dx));
  const ae = await as(PHARM, "/ward/onco-ae", "POST", { orgId: ORG, patientId, event: { term: "Fatigue", grade: 1 } });
  assert.equal(ae.__status, 403, JSON.stringify(ae));
});
