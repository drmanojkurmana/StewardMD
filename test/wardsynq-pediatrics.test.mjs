/* test/wardsynq-pediatrics.test.mjs — the pediatrics/NICU vertical, through the REAL routes.
 *
 * PEDIATRICS/NICU admission (reusing migrate-inpatient.js UNCHANGED) -> PEWS already reachable at
 * /ward/news2 with zero new wiring -> weight/dose-ceiling calculators (wardsynq-paediatrics.js,
 * real) -> a NICU admission of an ALREADY-REGISTERED newborn, proving the newborn's own MRN round-
 * trips to the SAME Patient id migrate-maternity.js's registerNewborn() created (the real bug this
 * task found and fixed) -> neonatal respiratory observations charted through the real flowsheet ->
 * a line placed and removed.
 *
 * Same harness shape as wardsynq-maternity.test.mjs / wardsynq-surgery.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-pediatrics.test.mjs
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

test("PEDIATRICS ADMISSION reuses migrate-inpatient.js UNCHANGED, and PEWS is already reachable at /ward/news2 with zero new wiring", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Pediatric Testcase", mobile: "9876500301", gender: "male", ageYears: 6 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Paediatrics", bed: "1", class: "PEDIATRICS", admittedAt: "2026-09-09T06:00:00.000Z" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(enc.class, "PEDIATRICS"); assert.equal(enc.status, "in-progress");

  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { pulse: "150", rr: "40" } });
  const news2 = await as(DOCTOR, `/ward/news2?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(news2.__status, 200, JSON.stringify(news2));
  assert.equal(news2.tool, "PEWS", "a non-adult patient is already scored on PEWS via the existing route - no new wiring needed for this task");
});

test("CALCULATORS: weight-based rate and paediatric dose ceiling are the REAL wardsynq-paediatrics.js/wardsynq-flowsheet.js math, read-only", async () => {
  seedHospital();
  const rate = await as(DOCTOR, "/ward/weight-rate", "POST", { orgId: ORG, dosePerKgPerMin: 5, weightKg: 3.2, concentrationMgPerMl: 4, patient: { ageDays: 5 } });
  assert.equal(rate.__status, 200, JSON.stringify(rate));
  assert.ok(rate.result.ratePerHour > 0, "a real computed rate, not a stub");
  assert.equal(rate.result.weightWarning, null, "3.2kg is a plausible neonatal weight");

  const badWeight = await as(DOCTOR, "/ward/weight-rate", "POST", { orgId: ORG, dosePerKgPerMin: 0.1, weightKg: 32, concentrationMgPerMl: 4, patient: { ageDays: 5 } });
  assert.ok(badWeight.result.weightWarning, "32kg for a 5-day-old is flagged as implausible - a decimal-point-style error");

  const ceiling = await as(DOCTOR, "/ward/dose-ceiling", "POST", { orgId: ORG, mgPerKg: 15, weightKg: 90, adultMaxMg: 1000, band: "adolescent" });
  assert.equal(ceiling.__status, 200, JSON.stringify(ceiling));
  assert.equal(ceiling.result.ceiling, 1000, "a 90kg adolescent at 15mg/kg (1350mg) is capped at the adult maximum");
  assert.equal(ceiling.result.cappedByAdult, true);
});

test("AGE BAND: a neonate is flagged not-ready without gestational age, and this is stated as a refusal, never approximated", async () => {
  seedHospital();
  const noGest = await as(DOCTOR, "/ward/age-band", "POST", { orgId: ORG, patient: { ageDays: 3 } });
  assert.equal(noGest.__status, 200, JSON.stringify(noGest));
  assert.equal(noGest.banding.band, "neonate");
  assert.equal(noGest.banding.neonatal.ready, false);

  const withGest = await as(DOCTOR, "/ward/age-band", "POST", { orgId: ORG, patient: { ageDays: 3, gestationalAgeWeeks: 39 } });
  assert.equal(withGest.banding.neonatal.ready, true);
});

test("NICU ADMISSION of an ALREADY-REGISTERED newborn: its own real MRN round-trips to the SAME Patient id registerNewborn() created - the bug this task found and fixed", async () => {
  seedHospital();
  const momReg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "NICU Mother Testcase", mobile: "9876500302", gender: "female", ageYears: 29 });
  const momAdm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: momReg.mrn, ward: "Labour Ward", bed: "1", class: "MATERNITY", admittedAt: "2026-09-09T06:00:00.000Z" });
  await as(DOCTOR, "/ward/delivery", "POST", { orgId: ORG, patientId: momAdm.patientId, encounterId: momAdm.encounterId, delivery: { mode: "caesarean" } });
  const newborn = await as(DOCTOR, "/ward/newborn", "POST", { orgId: ORG, motherPatientId: momAdm.patientId, encounterId: momAdm.encounterId, sex: "male", name: "NICU Baby Testcase" });
  assert.equal(newborn.__status, 200, JSON.stringify(newborn));
  const babyRecord = await RECORD.latest(TENANT_ROW.id, "Patient", newborn.newbornId);
  assert.ok(babyRecord.mrn, "the newborn has a real MRN"); assert.ok(!babyRecord.mrn.startsWith("NEWBORN-NEWBORN-"), "never double-prefixed");

  const nicuAdm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: babyRecord.mrn, ward: "NICU", bed: "Cot 3", class: "NICU", admittedAt: "2026-09-09T06:05:00.000Z" });
  assert.equal(nicuAdm.__status, 200, JSON.stringify(nicuAdm));
  assert.equal(nicuAdm.patientId, newborn.newbornId, "admitting via the newborn's own real MRN lands on the SAME Patient registerNewborn() already created, not a second, mismatched record");
  const nicuEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", nicuAdm.encounterId);
  assert.equal(nicuEnc.class, "NICU"); assert.equal(nicuEnc.location.bed, "Cot 3");

  const links = await as(DOCTOR, `/ward/family-links?orgId=${ORG}&patientId=${momAdm.patientId}`);
  assert.ok(links.links.some((l) => l.relatedPatientId === newborn.newbornId), "the maternal FamilyLink still resolves to the SAME id the NICU admission used");
});

test("NEONATAL OBSERVATIONS: respiratory-support readings are charted through the REAL flowsheet grid, and an unknown mode is refused", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "NICU Direct Testcase", mobile: "9876500303", gender: "female", ageYears: 1 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "NICU", bed: "Cot 1", class: "NICU", admittedAt: "2026-09-09T06:00:00.000Z" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  const now = new Date().toISOString();
  const fio2 = await as(NURSE, "/ward/neonatal", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, code: "fio2-percent", value: 30, at: now });
  assert.equal(fio2.__status, 200, JSON.stringify(fio2));
  const mode = await as(NURSE, "/ward/neonatal", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, code: "resp-support-mode", value: "cpap", at: now });
  assert.equal(mode.__status, 200, JSON.stringify(mode));
  const bogus = await as(NURSE, "/ward/neonatal", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, code: "resp-support-mode", value: "made-up" });
  assert.equal(bogus.__status, 422); assert.equal(bogus.error, "unknown_mode");

  const sheet = await as(DOCTOR, `/ward/flowsheet?orgId=${ORG}&patientId=${adm.patientId}&hours=1`);
  assert.equal(sheet.__status, 200, JSON.stringify(sheet));
  assert.ok(sheet.grid.rows.some((r) => /fio2/i.test(r.label)), "the neonatal observation is rendered by the SAME flowsheet grid vitals use: " + JSON.stringify(sheet.grid.rows.map((r) => r.label)));
});

test("LINES: a line is placed, appears on the list, and removal is idempotent", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Line Testcase", mobile: "9876500304", gender: "male", ageYears: 1 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "NICU", bed: "Cot 2", class: "NICU", admittedAt: "2026-09-09T06:00:00.000Z" });
  const placed = await as(DOCTOR, "/ward/line", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, line: { type: "UVC", site: "umbilical" } });
  assert.equal(placed.__status, 200, JSON.stringify(placed));
  const list1 = await as(DOCTOR, `/ward/line-list?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(list1.lines.length, 1); assert.equal(list1.lines[0].removedAt, null);

  const removed = await as(DOCTOR, "/ward/line-remove", "POST", { orgId: ORG, lineId: placed.lineId, reason: "no longer needed" });
  assert.equal(removed.__status, 200, JSON.stringify(removed));
  const again = await as(DOCTOR, "/ward/line-remove", "POST", { orgId: ORG, lineId: placed.lineId });
  assert.equal(again.skipped, "already_removed");
});

test("RBAC: pharmacy (no emr.treat, no emr.vitals) cannot place a line or chart a neonatal observation", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "RBAC Testcase", mobile: "9876500305", gender: "male", ageYears: 1 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "NICU", bed: "Cot 4", class: "NICU" });
  const line = await as(PHARM, "/ward/line", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, line: { type: "PICC" } });
  assert.equal(line.__status, 403, JSON.stringify(line));
  const obs = await as(PHARM, "/ward/neonatal", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, code: "fio2-percent", value: 21 });
  assert.equal(obs.__status, 403, JSON.stringify(obs));
});

test("a NICU patient exports its Encounter as FHIR-CONFORMANT (class IMP), and appears on the downtime pack and in ward metrics", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "FHIR NICU Testcase", mobile: "9876500306", gender: "female", ageYears: 1 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "NICU", bed: "Cot 5", class: "NICU" });
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/fhir/Encounter/${adm.encounterId}?orgId=${ORG}`, { headers: { "Cf-Access-Authenticated-User-Email": DOCTOR } }), env: ENV });
  const enc = await res.json();
  assert.equal(res.status, 200, JSON.stringify(enc));
  assert.deepEqual(enc.class, { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" });

  const pack = await as(DOCTOR, `/ward/downtime?orgId=${ORG}`);
  assert.equal(pack.__status, 200, JSON.stringify(pack));
  assert.ok(pack.patients.some((p) => p.patientId === adm.patientId));

  const metrics = await as(DOCTOR, `/ward/metrics?orgId=${ORG}&ward=NICU`);
  assert.equal(metrics.__status, 200, JSON.stringify(metrics));
  assert.equal(metrics.metrics.patients, 1);
});
