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

/* GROWTH (CDC 2000 centiles unless the hospital loaded its own tables), GET /api/queue/ward/growth. The engine's own numbers are pinned in
 * test/wardsynq-growth.test.mjs; these pin the route: what it reads, the gestational age it finds, the
 * refusals it returns instead of numbers, and who may call it. */
async function pretermNewborn() {
  const momReg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Growth Mother Testcase", mobile: "9876500310", gender: "female", ageYears: 30 });
  const momAdm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: momReg.mrn, ward: "Labour Ward", bed: "2", class: "MATERNITY", admittedAt: "2026-06-30T06:00:00.000Z" });
  // Due 2026-08-26, delivered 2026-07-01: 56 days early, so 280 - 56 = 224 days = 32+0 weeks.
  await as(DOCTOR, "/ward/pregnancy", "POST", { orgId: ORG, patientId: momAdm.patientId, pregnancy: { gravida: 1, para: 0, edd: "2026-08-26", gestationWeeks: 31 } });
  await as(DOCTOR, "/ward/delivery", "POST", { orgId: ORG, patientId: momAdm.patientId, encounterId: momAdm.encounterId, delivery: { mode: "caesarean", deliveredAt: "2026-07-01T10:00:00.000Z" } });
  const newborn = await as(DOCTOR, "/ward/newborn", "POST", { orgId: ORG, motherPatientId: momAdm.patientId, encounterId: momAdm.encounterId, sex: "male", name: "Growth Baby Testcase" });
  const baby = await RECORD.latest(TENANT_ROW.id, "Patient", newborn.newbornId);
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: baby.mrn, ward: "NICU", bed: "Cot 7", class: "NICU", admittedAt: "2026-07-01T11:00:00.000Z" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return adm;
}

test("GROWTH: a preterm newborn's weights are plotted at corrected age from the mother's due date, and a weight before term is refused, not plotted", async () => {
  seedHospital();
  const adm = await pretermNewborn();
  const w1 = await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { weight: "1.6", weightUnit: "kg" }, recordedAt: "2026-07-15T06:00:00.000Z" });
  assert.equal(w1.__status, 200, JSON.stringify(w1));
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { weight: "3.5", weightUnit: "kg" }, recordedAt: "2026-09-09T06:00:00.000Z" });

  const g = await as(DOCTOR, `/ward/growth?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(g.__status, 200, JSON.stringify(g));
  assert.equal(g.growth.sex, "male");
  assert.equal(g.growth.gestationDays, 224, "32+0 weeks from the recorded due date, not the antenatal 31 weeks typed earlier");
  assert.equal(g.growth.measurements.length, 2);
  const [early, later] = g.growth.measurements;
  assert.equal(early.chronologicalDays, 14);
  assert.equal(early.result.ok, false); assert.equal(early.result.code, "BEFORE_TERM"); assert.equal(early.result.z, undefined);
  assert.equal(later.chronologicalDays, 70); assert.equal(later.corrected, true); assert.equal(later.plotDays, 14);
  assert.equal(later.result.ok, true); assert.equal(later.result.reference, "cdc2000");
  assert.equal(typeof later.result.z, "number"); assert.ok(later.result.centile > 0 && later.result.centile < 100);
  assert.deepEqual(g.growth.lines.map((l) => l.centile), [3, 10, 25, 50, 75, 90, 97]);
  assert.equal(g.growth.reference.id, "cdc2000"); assert.match(g.growth.reference.licence, /public domain/i); assert.match(g.growth.reference.attribution, /does not imply endorsement by CDC/);
});

test("GROWTH: an approximate date of birth, a sex other than male or female, and no weights are each stated, never turned into a centile", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Growth Approx Testcase", mobile: "9876500311", gender: "female", ageYears: 3 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Paediatrics", bed: "4", class: "PEDIATRICS" });
  const empty = await as(DOCTOR, `/ward/growth?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(empty.__status, 200, JSON.stringify(empty));
  assert.deepEqual(empty.growth.measurements, []); assert.deepEqual(empty.growth.lines, []);
  assert.equal(empty.growth.gestationDays, null); assert.equal(empty.growth.gestationReason, "not_registered_at_birth_here");
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { weight: "14" } });
  const approx = await as(DOCTOR, `/ward/growth?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(approx.growth.approxDob, true);
  assert.equal(approx.growth.measurements[0].result.code, "DOB_APPROXIMATE"); assert.equal(approx.growth.measurements[0].result.z, undefined);

  const reg2 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Growth Other Testcase", mobile: "9876500312", gender: "other", birthDate: "2024-03-01" });
  const adm2 = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg2.mrn, ward: "Paediatrics", bed: "5", class: "PEDIATRICS" });
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm2.encounterId, patientId: adm2.patientId, vitals: { weight: "12" } });
  const other = await as(DOCTOR, `/ward/growth?orgId=${ORG}&patientId=${adm2.patientId}`);
  assert.equal(other.growth.sex, null);
  assert.equal(other.growth.measurements[0].result.code, "SEX_UNKNOWN");
});

test("GROWTH negative authorization: no session 401, pharmacy (no emr.view) 403, another hospital's staff 403, and the route writes nothing", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Growth Auth Testcase", mobile: "9876500313", gender: "male", birthDate: "2025-01-10" });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Paediatrics", bed: "6", class: "PEDIATRICS" });
  const STRANGER = "stranger@example.test";
  docs.set(`q_orgs/org-other`, { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-other__${sanitize(idFor(STRANGER))}`, { fields: { orgId: "org-other", identity: idFor(STRANGER), role: "doctor", active: true }, updateTime: "t1" });
  const path = `/ward/growth?orgId=${ORG}&patientId=${adm.patientId}`;
  const before = JSON.stringify([...docs.keys()].sort());

  const res = await onRequest({ request: new Request("https://x/api/queue" + path), env: ENV });
  assert.equal(res.status, 401);
  assert.equal((await as(PHARM, path)).__status, 403);
  assert.equal((await as(STRANGER, path)).__status, 403);
  assert.equal(JSON.stringify([...docs.keys()].sort()), before, "a read route writes nothing");
  const ok = await as(DOCTOR, path);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.growth.sex, "male");
});

/* A HOSPITAL'S OWN LICENSED GROWTH TABLES (functions/_wardsynq/growth-tables.js): POST /api/queue/ward/growth-table-import
 * and GET /api/queue/ward/growth-tables. The chart uses them once loaded, and CDC 2000 again once withdrawn. */
const HADMIN = "hospital-admin@example.test";
const TABLE_CSV = ["indicator,sex,x,l,m,s", "wfa,1,0,1,3,0.1", "wfa,1,24,1,13,0.1", "wfa,2,0,1,3,0.1", "wfa,2,24,1,12,0.1"].join("\r\n");
const { parseGrowthCsv } = await import("../functions/_wardsynq/growth-tables.js");

test("growth table CSV: every row checked, one bad row loads nothing", () => {
  const ok = parseGrowthCsv(TABLE_CSV);
  assert.equal(ok.ok, true); assert.equal(ok.rows.length, 4); assert.deepEqual(ok.indicators, ["wfa"]);
  assert.deepEqual(ok.rows[0], ["wfa", "male", 0, 1, 3, 0.1]);
  assert.equal(parseGrowthCsv("indicator,sex,x,l,m\nwfa,1,0,1,3").error, "csv_columns");
  assert.equal(parseGrowthCsv(TABLE_CSV + "\nheight,1,3,1,5,0.1").error, "csv_row_invalid");
  assert.equal(parseGrowthCsv(TABLE_CSV + "\nwfa,3,3,1,5,0.1").error, "csv_row_invalid");
  assert.equal(parseGrowthCsv(TABLE_CSV + "\nwfa,1,3,1,0,0.1").line, 6, "M must be more than 0");
  assert.equal(parseGrowthCsv(TABLE_CSV + "\nwfa,male,24,1,13,0.1").error, "csv_row_duplicate");
  assert.equal(parseGrowthCsv("indicator\tsex\tx\tl\tm\ts\nhcfa\tfemale\t1.5\t1\t38\t0.03").rows[0][0], "hcfa", "tab-separated");
});

test("growth tables negative authorization: POST /api/queue/ward/growth-table-import 401 without a session, 403 for a doctor or another hospital with nothing written; GET /api/queue/ward/growth-tables 401 and 403 for another hospital", async () => {
  seedHospital();
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(HADMIN))}`, { fields: { orgId: ORG, identity: idFor(HADMIN), role: "admin", active: true }, updateTime: "t1" });
  const STRANGER = "stranger-admin@example.test";
  docs.set(`q_orgs/org-other`, { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-other__${sanitize(idFor(STRANGER))}`, { fields: { orgId: "org-other", identity: idFor(STRANGER), role: "admin", active: true }, updateTime: "t1" });
  const body = { orgId: ORG, referenceName: "WHO Child Growth Standards 2006", method: "who-restricted", csv: TABLE_CSV, fileName: "who.csv", licenceConfirmed: true };
  const post = (b) => onRequest({ request: new Request("https://x/api/queue/ward/growth-table-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }), env: ENV });
  assert.equal((await post(body)).status, 401);
  assert.equal((await onRequest({ request: new Request(`https://x/api/queue/ward/growth-tables?orgId=${ORG}`), env: ENV })).status, 401);
  assert.equal((await as(DOCTOR, "/ward/growth-table-import", "POST", body)).__status, 403, "loading licensed tables is hospital administration");
  assert.equal((await as(STRANGER, "/ward/growth-table-import", "POST", body)).__status, 403);
  assert.equal((await as(STRANGER, `/ward/growth-tables?orgId=${ORG}`)).__status, 403);
  assert.equal((await as(HADMIN, "/ward/growth-table-import", "POST", { ...body, licenceConfirmed: false })).error, "licence_not_confirmed");
  assert.equal((await as(HADMIN, "/ward/growth-table-import", "POST", { ...body, csv: TABLE_CSV + "\nwfa,9,1,1,1,1" })).error, "csv_row_invalid");
  assert.equal((await RECORD.latestByType(TENANT_ROW.id, "GrowthTableImport", 10)).length, 0, "nothing written by any refusal");
  assert.equal((await RECORD.latestByType(TENANT_ROW.id, "GrowthTableChunk", 10)).length, 0);
  const list = await as(DOCTOR, `/ward/growth-tables?orgId=${ORG}`);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.inUse, "cdc2000"); assert.equal(list.loaded, null);
});

test("GET /api/queue/ward/growth uses the hospital's loaded tables and names them, and CDC 2000 again after POST /api/queue/ward/growth-table-import withdraws them", async () => {
  seedHospital();
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(HADMIN))}`, { fields: { orgId: ORG, identity: idFor(HADMIN), role: "admin", active: true }, updateTime: "t1" });
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Growth Table Testcase", mobile: "9876500314", gender: "male", birthDate: "2026-01-01" });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Paediatrics", bed: "7", class: "PEDIATRICS" });
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { weight: "8", weightUnit: "kg" }, recordedAt: "2026-07-01T06:00:00.000Z" });
  const path = `/ward/growth?orgId=${ORG}&patientId=${adm.patientId}`;

  const cdc = await as(DOCTOR, path);
  assert.equal(cdc.growth.reference.id, "cdc2000");
  const loaded = await as(HADMIN, "/ward/growth-table-import", "POST", { orgId: ORG, referenceName: "IAP growth charts (licensed)", method: "lms", csv: TABLE_CSV, fileName: "iap.csv", licenceConfirmed: true });
  assert.equal(loaded.__status, 200, JSON.stringify(loaded));
  assert.equal(loaded.count, 4);
  const imp = await RECORD.latest(TENANT_ROW.id, "GrowthTableImport", "wsq-growthtable");
  assert.equal(imp.licenceConfirmed.by, idFor(HADMIN)); assert.match(imp.licenceConfirmed.statement, /holds a licence from the publisher/);

  const g = await as(DOCTOR, path);
  assert.equal(g.growth.reference.id, "hospital"); assert.equal(g.growth.reference.name, "IAP growth charts (licensed)");
  const m = g.growth.measurements[0];
  assert.equal(m.result.reference, "hospital");
  // 181 days = 5.95 months; the hospital's M interpolates 3 + (13 - 3) * 5.95 / 24, S 0.1, L 1.
  const mo = 181 / 30.4375, M = 3 + 10 * mo / 24;
  assert.equal(m.result.z, Math.round(((8 / M - 1) / 0.1) * 100) / 100);
  const listed = await as(DOCTOR, `/ward/growth-tables?orgId=${ORG}`);
  assert.equal(listed.inUse, "hospital"); assert.equal(listed.loaded.referenceName, "IAP growth charts (licensed)");

  assert.equal((await as(DOCTOR, "/ward/growth-table-import", "POST", { orgId: ORG, withdraw: true })).__status, 403, "a doctor cannot withdraw them either");
  const wd = await as(HADMIN, "/ward/growth-table-import", "POST", { orgId: ORG, withdraw: true });
  assert.equal(wd.__status, 200, JSON.stringify(wd)); assert.equal(wd.withdrawn, true);
  assert.equal((await as(DOCTOR, path)).growth.reference.id, "cdc2000");
  assert.equal((await as(HADMIN, "/ward/growth-table-import", "POST", { orgId: ORG, withdraw: true })).error, "nothing_loaded");
  assert.equal((await RECORD.latestByType(TENANT_ROW.id, "GrowthTableChunk", 10)).length, 1, "the loaded rows stay on record");
});
