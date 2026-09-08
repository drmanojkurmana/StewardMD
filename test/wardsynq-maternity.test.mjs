/* test/wardsynq-maternity.test.mjs — the OB-GYN/maternity vertical, through the REAL routes.
 *
 * Admission (class:MATERNITY, reusing migrate-inpatient.js unchanged) -> pregnancy episode -> a
 * partogram observation charted through the REAL flowsheet -> MEOWS computed from real vitals ->
 * blood loss (visual vs quantitative) -> a REAL Code PPH bundle (proving OBSTETRIC_BUNDLES is wired
 * into the resus engine, not a second clock) -> delivery (para incremented) -> newborn registered +
 * FamilyLink (never PatientLink) -> discharge, reusing migrate-discharge.js unchanged.
 *
 * Same harness shape as wardsynq-icu.test.mjs / wardsynq-surgery.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-maternity.test.mjs
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

async function admittedMother(mrnSuffix) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Maternity Testcase " + mrnSuffix, mobile: "9876500" + mrnSuffix, gender: "female", ageYears: 28 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Labour Ward", bed: "1", class: "MATERNITY", admittedAt: "2026-09-09T06:00:00.000Z" });
  return { reg, adm };
}

test("ADMISSION: /ward/admit with class:\"MATERNITY\" reuses migrate-inpatient.js UNCHANGED - same bed guard, same ward roster", async () => {
  seedHospital();
  const { adm } = await admittedMother("201");
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(enc.class, "MATERNITY"); assert.equal(enc.status, "in-progress");
  const board = await as(NURSE, `/ward/list?orgId=${ORG}&ward=Labour Ward`);
  assert.ok(board.patients.some((p) => p.encounterId === adm.encounterId && p.class === "MATERNITY"));
});

test("PREGNANCY EPISODE: gravida/para/gestation recorded, and a delivery increments para on its own", async () => {
  seedHospital();
  const { adm } = await admittedMother("202");
  const preg = await as(DOCTOR, "/ward/pregnancy", "POST", { orgId: ORG, patientId: adm.patientId, pregnancy: { gravida: 2, para: 1, gestationWeeks: 39, edd: "2026-09-15" } });
  assert.equal(preg.__status, 200, JSON.stringify(preg));
  const got = await as(DOCTOR, `/ward/pregnancy-get?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(got.pregnancy.gravida, 2); assert.equal(got.pregnancy.para, 1); assert.equal(got.pregnancy.gestationWeeks, 39);

  const delOut = await as(DOCTOR, "/ward/delivery", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, delivery: { mode: "vaginal" } });
  assert.equal(delOut.__status, 200, JSON.stringify(delOut));
  const after = await as(DOCTOR, `/ward/pregnancy-get?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(after.pregnancy.para, 2, "a delivery is the fact that changes para, recorded automatically from the real delivery event");
});

test("PARTOGRAM: a labour observation is charted through the REAL flowsheet grid, and an unknown code is refused", async () => {
  seedHospital();
  const { adm } = await admittedMother("203");
  const now = new Date().toISOString();
  const dilation = await as(NURSE, "/ward/labour", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, code: "dilation-cm", value: 4, at: now });
  assert.equal(dilation.__status, 200, JSON.stringify(dilation));
  const status = await as(NURSE, "/ward/labour", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, code: "labour-status", value: "active", at: now });
  assert.equal(status.__status, 200, JSON.stringify(status));

  const bogus = await as(NURSE, "/ward/labour", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, code: "made-up-code", value: 1 });
  assert.equal(bogus.__status, 422); assert.equal(bogus.error, "unknown_labour_code");

  const sheet = await as(DOCTOR, `/ward/flowsheet?orgId=${ORG}&patientId=${adm.patientId}&hours=1`);
  assert.equal(sheet.__status, 200, JSON.stringify(sheet));
  assert.ok(sheet.grid.rows.some((r) => /dilation/i.test(r.label) || /dilation-cm/i.test(r.label)), "the labour observation is rendered by the SAME flowsheet grid vitals use: " + JSON.stringify(sheet.grid.rows.map((r) => r.label)));
});

test("MEOWS: computed from real charted vitals once pregnancy is on record, and states plainly it is not a total", async () => {
  seedHospital();
  const { adm } = await admittedMother("204");
  await as(DOCTOR, "/ward/pregnancy", "POST", { orgId: ORG, patientId: adm.patientId, pregnancy: { gestationWeeks: 38 } });
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { sbp: "85", pulse: "125" } });
  const meows = await as(DOCTOR, `/ward/meows?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(meows.__status, 200, JSON.stringify(meows));
  assert.equal(meows.meows.applicable, true);
  assert.equal(meows.meows.alert, true, "a systolic of 85 and a pulse of 125 both trigger red");
  assert.ok(!("total" in meows.meows), "MEOWS is deliberately trigger-based; there is no total to read as reassuring");
});

test("BLOOD LOSS: a visual estimate is never treated as a measurement, and a real Code PPH bundle can be started because OBSTETRIC_BUNDLES is wired into the resus engine", async () => {
  seedHospital();
  const { adm } = await admittedMother("205");
  const loss = await as(NURSE, "/ward/blood-loss", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, loss: { ml: 600, method: "visual-estimate" } });
  assert.equal(loss.__status, 200, JSON.stringify(loss));
  assert.equal(loss.loss.quantitative, false);
  assert.equal(loss.threshold.reached, null, "a threshold cannot be decided on a visual estimate alone");
  assert.equal(loss.recognition.prompt, true, "600ml visual (plausibly 1200ml) is enough to prompt, never to auto-open anything");
  assert.equal(loss.recognition.code, "code-pph");

  const bundle = await as(DOCTOR, "/ward/resus-start", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, code: "code-pph" });
  assert.equal(bundle.__status, 200, JSON.stringify(bundle));
  assert.ok(bundle.status.elements.some((e) => e.key === "quantify"), "the REAL PPH bundle definition from wardsynq-obstetrics.js is running, not a fallback or a refusal");
  assert.ok(!bundle.status.elements.some((e) => /magnesium.*dose|dose.*magnesium/i.test(e.label)), "no element carries a magnesium dose - the bundle prescribes nothing");
});

test("NEWBORN: registered as a REAL Patient with its own deterministic MRN, linked to the mother via FamilyLink, never PatientLink", async () => {
  seedHospital();
  const { adm } = await admittedMother("206");
  // A newborn cannot be registered before the delivery it is linked to is a real record.
  const tooEarly = await as(DOCTOR, "/ward/newborn", "POST", { orgId: ORG, motherPatientId: adm.patientId, encounterId: adm.encounterId, sex: "female", name: "Baby Testcase" });
  assert.equal(tooEarly.__status, 409); assert.equal(tooEarly.error, "no_delivery_recorded", JSON.stringify(tooEarly));

  const delOut = await as(DOCTOR, "/ward/delivery", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, delivery: { mode: "vaginal" } });
  assert.equal(delOut.__status, 200, JSON.stringify(delOut));
  const newborn = await as(DOCTOR, "/ward/newborn", "POST", { orgId: ORG, motherPatientId: adm.patientId, encounterId: adm.encounterId, sex: "female", name: "Baby Testcase" });
  assert.equal(newborn.__status, 200, JSON.stringify(newborn));
  assert.equal(newborn.written, 2, "a real Patient AND a FamilyLink, both written");

  const baby = await RECORD.latest(TENANT_ROW.id, "Patient", newborn.newbornId);
  assert.equal(baby.name, "Baby Testcase"); assert.ok(baby.mrn && baby.mrn.startsWith("NEWBORN-"), "the newborn has its own real MRN, never null");
  const link = await RECORD.latest(TENANT_ROW.id, "FamilyLink", newborn.linkId);
  assert.equal(link.resourceType, "FamilyLink"); assert.equal(link.relationship, "mother-newborn");
  assert.equal(link.patientId, adm.patientId); assert.equal(link.relatedPatientId, newborn.newbornId);

  const links = await as(DOCTOR, `/ward/family-links?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(links.links.length, 1); assert.equal(links.links[0].relatedPatientId, newborn.newbornId);

  // Retrying the same registration is idempotent, not a second newborn.
  const again = await as(DOCTOR, "/ward/newborn", "POST", { orgId: ORG, motherPatientId: adm.patientId, encounterId: adm.encounterId, sex: "female", name: "Baby Testcase" });
  assert.equal(again.skipped, "already_linked");
});

test("DISCHARGE: a MATERNITY stay is discharged through migrate-discharge.js UNCHANGED, the same door IPD and ICU use", async () => {
  seedHospital();
  const { adm } = await admittedMother("207");
  const out = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, dischargedAt: "2026-09-10T08:00:00.000Z", disposition: "home" });
  assert.equal(out.__status, 200, JSON.stringify(out));
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(enc.status, "finished");
});

test("RBAC: pharmacy (no emr.treat, no emr.vitals) cannot record a delivery or chart a labour observation", async () => {
  seedHospital();
  const { adm } = await admittedMother("208");
  const del = await as(PHARM, "/ward/delivery", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, delivery: { mode: "vaginal" } });
  assert.equal(del.__status, 403, JSON.stringify(del));
  const lab = await as(PHARM, "/ward/labour", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, code: "dilation-cm", value: 5 });
  assert.equal(lab.__status, 403, JSON.stringify(lab));
});

test("a MATERNITY patient exports its Encounter as FHIR-CONFORMANT (class IMP), and appears on the downtime pack and in ward metrics", async () => {
  seedHospital();
  const { adm } = await admittedMother("209");
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/fhir/Encounter/${adm.encounterId}?orgId=${ORG}`, { headers: { "Cf-Access-Authenticated-User-Email": DOCTOR } }), env: ENV });
  const enc = await res.json();
  assert.equal(res.status, 200, JSON.stringify(enc));
  assert.deepEqual(enc.class, { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" });

  const pack = await as(DOCTOR, `/ward/downtime?orgId=${ORG}`);
  assert.equal(pack.__status, 200, JSON.stringify(pack));
  assert.ok(pack.patients.some((p) => p.patientId === adm.patientId));

  const metrics = await as(DOCTOR, `/ward/metrics?orgId=${ORG}&ward=Labour Ward`);
  assert.equal(metrics.__status, 200, JSON.stringify(metrics));
  assert.equal(metrics.metrics.patients, 1);
});
