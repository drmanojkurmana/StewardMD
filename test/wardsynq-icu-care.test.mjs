/* test/wardsynq-icu-care.test.mjs - P1.12 ICU bedside record (icu-care.js) through the REAL routes:
 * blood gas, ventilator, sedation, round checklist, vasopressor dose, SOFA and the advisory sepsis
 * screen. Harness copied from wardsynq-icu.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-icu-care.test.mjs
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


/* ---- the ICU bedside record (icu-care.js), through the real routes ------------------------------ */

const LABTECH = "lab@example.test";
function seedWithLab() {
  seedHospital();
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(LABTECH))}`, { fields: { orgId: ORG, identity: idFor(LABTECH), role: "lab", active: true }, updateTime: "t1" });
}
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

async function icuPatient(mobile, bed) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ICU Care Testcase", mobile, gender: "male", ageYears: 62 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "ICU", bed, class: "ICU", admittedAt: ago(600) });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { reg, adm };
}

test("ICU ABG: a nurse charts a gas; the chart interprets it from icu.js logic, and a gas missing pCO2 is not interpretable, never normal", async () => {
  seedHospital();
  const { adm } = await icuPatient("9876500401", "21");
  const w = await as(NURSE, "/ward/icu-record", "POST", { orgId: ORG, kind: "abg", patientId: adm.patientId, encounterId: adm.encounterId, at: ago(30),
    values: { sampleType: "arterial", ph: 7.21, pco2: 26, po2: 80, hco3: 12, baseExcess: -14, lactate: 4.6, fio2: 40 } });
  assert.equal(w.__status, 200, JSON.stringify(w));
  assert.equal(w.interpretation.primary, "Metabolic acidosis");
  assert.match(w.interpretation.compensation, /Appropriate respiratory compensation \(expected pCO2 26/);
  assert.equal(w.interpretation.pf, 200, "P/F = 80 / 0.40");

  const bad = await as(NURSE, "/ward/icu-record", "POST", { orgId: ORG, kind: "abg", patientId: adm.patientId, encounterId: adm.encounterId, at: ago(20), values: { sampleType: "arterial", ph: 7.21, fio2: 150 } });
  assert.equal(bad.__status, 422); assert.ok(bad.problems.some((p) => p.field === "fio2"), "an impossible FiO2 is refused by name, not clipped");

  const partial = await as(NURSE, "/ward/icu-record", "POST", { orgId: ORG, kind: "abg", patientId: adm.patientId, encounterId: adm.encounterId, at: ago(10), values: { sampleType: "venous", ph: 7.30, hco3: 20, po2: 40, fio2: 0.4 } });
  assert.equal(partial.__status, 200, JSON.stringify(partial));
  assert.equal(partial.interpretation.interpretable, false);
  assert.match(partial.interpretation.reason, /Not interpretable: pCO2 not recorded/);
  assert.equal(partial.interpretation.pf, null); assert.match(partial.interpretation.pfReason, /arterial/);

  const chart = await as(DOCTOR, `/ward/icu?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(chart.__status, 200, JSON.stringify(chart));
  assert.equal(chart.abg.history.length, 2, "both gases stay on the record; the newest is current");
  assert.equal(chart.abg.current.sampleType, "venous");
});

test("ICU VENTILATOR, SEDATION and ROUND: current plus history; RASS against target; an unanswered item is not assessed", async () => {
  seedHospital();
  const { adm } = await icuPatient("9876500402", "22");
  const post = (kind, values, at) => as(NURSE, "/ward/icu-record", "POST", { orgId: ORG, kind, patientId: adm.patientId, encounterId: adm.encounterId, at, values });
  assert.equal((await post("ventilator", { mode: "VC-AC", tidalVolumeMl: 450, rate: 16, peep: 8, fio2: 50, peakPressure: 28, plateauPressure: 24 }, ago(120))).__status, 200);
  assert.equal((await post("ventilator", { mode: "PSV", peep: 6, fio2: 35 }, ago(60))).__status, 200);
  assert.equal((await post("ventilator", { mode: "made-up" }, ago(50))).__status, 422, "a mode that is not on the list is refused");
  assert.equal((await post("sedation", { rass: -3, targetLow: -2, targetHigh: 0, gcs: 9 }, ago(40))).__status, 200);
  assert.equal((await post("sedation", { rass: 7 }, ago(35))).__status, 422, "RASS runs -5 to +4");
  const round = await post("round", { items: { feeding: "yes", thromboprophylaxis: { answer: "no", note: "platelets 40" }, headOfBed: "not-applicable" } }, ago(30));
  assert.equal(round.__status, 200, JSON.stringify(round));

  const chart = await as(NURSE, `/ward/icu?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(chart.ventilator.current.mode, "PSV"); assert.equal(chart.ventilator.history.length, 2);
  assert.equal(chart.sedation.status.onTarget, false); assert.match(chart.sedation.status.say, /deeper than target/);
  const items = Object.fromEntries(chart.rounds.latest.items.map((i) => [i.key, i.answer]));
  assert.equal(items.feeding, "yes"); assert.equal(items.thromboprophylaxis, "no"); assert.equal(items.headOfBed, "not-applicable");
  assert.equal(items.bowels, "not-assessed", "nobody answered bowels: that is not assessed, never no");
  assert.equal(chart.rounds.latest.by, idFor(NURSE), "who charted the round is on it");
  assert.ok(chart.rounds.latest.at);
});

test("ICU VASOPRESSOR: mcg/kg/min from rate, bag concentration and weight; refused without a concentration or with a unit that does not convert", async () => {
  seedHospital();
  const { adm } = await icuPatient("9876500403", "23");
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { weight: "80" }, recordedAt: ago(300) });
  const nor = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Noradrenaline", dose: { value: 0.1, unit: "mcg/kg/min" }, route: "IV", frequency: "continuous" } });
  assert.equal(nor.__status, 200, JSON.stringify(nor));
  const vaso = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Vasopressin", dose: { value: 0.03, unit: "units/min" }, route: "IV", frequency: "continuous" } });
  assert.equal(vaso.__status, 200, JSON.stringify(vaso));

  // No concentration stated: the dose is refused, never computed from an assumed bag.
  assert.equal((await as(NURSE, "/ward/infusion", "POST", { orgId: ORG, orderId: nor.orderId || nor.order?.id, event: "started", ratePerHour: 6, at: ago(90) })).__status, 200);
  let chart = await as(DOCTOR, `/ward/icu?orgId=${ORG}&patientId=${adm.patientId}`);
  let n = chart.vasopressors.find((p) => /Noradrenaline/.test(p.drug));
  assert.equal(n.dose.value, null); assert.match(n.dose.reason, /concentration has not been recorded/);

  const badConc = await as(NURSE, "/ward/infusion", "POST", { orgId: ORG, orderId: nor.orderId || nor.order?.id, event: "rate-changed", ratePerHour: 6, at: ago(80), concentration: { amount: 4, unit: "mg" } });
  assert.equal(badConc.__status, 422, "a concentration with no volume is refused, not half-recorded");

  // 4 mg in 50 mL = 80 mcg/mL; 6 mL/h x 80 / 80 kg / 60 = 0.1 mcg/kg/min.
  assert.equal((await as(NURSE, "/ward/infusion", "POST", { orgId: ORG, orderId: nor.orderId || nor.order?.id, event: "rate-changed", ratePerHour: 6, at: ago(60), concentration: { amount: 4, unit: "mg", volumeMl: 50 } })).__status, 200);
  assert.equal((await as(NURSE, "/ward/infusion", "POST", { orgId: ORG, orderId: vaso.orderId || vaso.order?.id, event: "started", ratePerHour: 3, at: ago(60), concentration: { amount: 20, unit: "units", volumeMl: 50 } })).__status, 200);
  chart = await as(DOCTOR, `/ward/icu?orgId=${ORG}&patientId=${adm.patientId}`);
  n = chart.vasopressors.find((p) => /Noradrenaline/.test(p.drug));
  assert.equal(n.dose.value, 0.1); assert.equal(n.dose.unit, "mcg/kg/min");
  const v = chart.vasopressors.find((p) => /Vasopressin/.test(p.drug));
  assert.equal(v.dose.value, null); assert.match(v.dose.reason, /does not convert to mcg\/kg\/min/);
});

test("ICU SOFA: partial with the unscored systems named, never counted as 0; SEPSIS screen positive from qSOFA 1 plus lactate above 2", async () => {
  seedWithLab();
  const { adm } = await icuPatient("9876500404", "24");
  // Only a gas and a platelet count exist at first.
  await as(NURSE, "/ward/icu-record", "POST", { orgId: ORG, kind: "abg", patientId: adm.patientId, encounterId: adm.encounterId, at: ago(20), values: { sampleType: "arterial", ph: 7.30, pco2: 35, po2: 70, hco3: 17, lactate: 3.1, fio2: 0.5 } });
  const ord = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Platelets", category: "laboratory" });
  const res = await as(LABTECH, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: ord.orderId, status: "final", reportedAt: ago(15), tests: [{ test: "Platelet count", value: 90, unit: "10*3/uL" }] });
  assert.equal(res.__status, 200, JSON.stringify(res));

  let chart = await as(DOCTOR, `/ward/icu?orgId=${ORG}&patientId=${adm.patientId}`);
  const s = chart.sofa;
  assert.equal(s.partial, true);
  assert.equal(s.components.find((c) => c.key === "resp").score, 2, "P/F 140 without ventilatory support scores 2 (sofaResp)");
  assert.equal(s.components.find((c) => c.key === "coag").score, 2, "platelets 90 scores 2 (sofaPlt)");
  for (const k of ["liver", "cardio", "cns", "renal"]) {
    const c = s.components.find((x) => x.key === k);
    assert.equal(c.score, null, `${k} has no data and is not scored, not 0`); assert.ok(c.reason);
  }
  assert.equal(s.total, 4); assert.deepEqual(s.notScored.length, 4); assert.match(s.say, /Partial SOFA 4 from 2 of 6/);

  // No vitals yet: the sepsis screen cannot be run and says what is missing.
  assert.equal(chart.sepsis.result, "cannot-screen"); assert.ok(chart.sepsis.missing.length >= 1, JSON.stringify(chart.sepsis));
  assert.match(chart.sepsis.advisory, /Advisory only/);

  // RR 24 (one criterion), alert, SBP 118: qSOFA 1, with a lactate of 3.1 from the gas.
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { rr: "24", acvpu: "A", sbp: "118", dbp: "70", pulse: "104", spo2: "95", temp: "37.2", tempUnit: "C" }, recordedAt: ago(5) });
  chart = await as(DOCTOR, `/ward/icu?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(chart.sepsis.result, "screen-positive", JSON.stringify(chart.sepsis));
  assert.match(chart.sepsis.say, /lactate 3.1/);
  assert.equal(chart.sepsis.excludesSepsis, false);
  assert.equal(chart.sofa.components.find((c) => c.key === "cardio").score, 0, "MAP (118 + 2x70)/3 = 86 with no pressor");

  // Nothing was started: advisory means no bundle exists until a clinician starts one.
  const resus = await as(DOCTOR, `/ward/resus?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(resus.bundles.length, 0, "a positive screen starts nothing");
});

test("ICU RBAC: pharmacy (no emr.vitals, no emr.view) is refused both the ICU write and the ICU read", async () => {
  seedHospital();
  const { adm } = await icuPatient("9876500405", "25");
  const w = await as(PHARM, "/ward/icu-record", "POST", { orgId: ORG, kind: "sedation", patientId: adm.patientId, encounterId: adm.encounterId, values: { rass: 0 } });
  assert.equal(w.__status, 403, JSON.stringify(w));
  const r = await as(PHARM, `/ward/icu?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(r.__status, 403, JSON.stringify(r));
  const wrong = await icuPatient("9876500406", "26");
  const cross = await as(NURSE, "/ward/icu-record", "POST", { orgId: ORG, kind: "sedation", patientId: adm.patientId, encounterId: wrong.adm.encounterId, values: { rass: 0 } });
  assert.equal(cross.__status, 409, "a gas cannot be charted against another patient's encounter");
});
