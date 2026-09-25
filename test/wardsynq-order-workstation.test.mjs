import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-order-workstation.test.mjs — LT-09 (live test 2026-09-15), the server half.
 *
 * The Order safety workstation (wardsynq/ui/wardsynq-app.js) showed three fabricated patients and saved
 * nothing. It now reads the hospital's own ward and signs through the ward's order route. This drives
 * the REAL queue router with exactly the requests the page makes, in the order it makes them:
 *   GET  /api/queue/whoami, /api/queue/ward/list                    the roster
 *   GET  /api/queue/ward/fhir/AllergyIntolerance?patient=           allergies (a refusal is a 403, never an empty list)
 *   GET  /api/queue/ward/timeline                                   active medicines
 *   GET  /api/queue/ward/fhir/Patient/<id>                          age
 *   GET  /api/queue/ward/fhir/Observation?code=29463-7&_sort=-date  weight
 *   GET  /api/queue/ward/fhir/Observation?category=laboratory       results
 *   POST /api/queue/ward/medication-order { checkOnly: true }       Sign, step 1: the server's check, nothing written
 *   POST /api/queue/ward/medication-order { overrideReason? }       Sign, step 2: the order
 * and proves the check is the server's engine (LT-10 dosing included), the signed order is on the chart
 * (timeline) and on the round (schedule), and who may not sign.
 * The real-browser half is test/run-wardsynq-workstation-open.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-order-workstation.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// The same Firestore stand-in test/wardsynq-inpatient-emar.test.mjs uses; loaded before the router.
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
const { resetMemory: resetRateLimits } = await import("../functions/_wardsynq/rate-limit.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
const { AllergyIntolerance } = await import("../wardsynq/wardsynq-model.js");
let RECORD = new MemoryRepository();
const TENANT = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const TENANT2 = { id: "tenant-two", name: "Other Hospital", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-two" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : String(a[0]) === TENANT2.id ? { ...TENANT2 } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async (request) => (String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase() === DOCTOR ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {}),
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq", ORG2 = "org-two";
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1; RECORD = new MemoryRepository(); resetRateLimits();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1 }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG2}`, { fields: { id: ORG2, code: "SMD-TWO", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT2.id, ownerUid: "cfa:nobody", createdAt: 1 }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const qs = (o) => Object.keys(o).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(o[k])}`).join("&");

/** An admitted 62 kg adult with a recorded penicillin allergy, as a real ward would have them. */
async function admitted() {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Test Patient QA-01", mobile: "9999999999", gender: "female", ageYears: 67 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "General A", bed: "03", admittedAt: new Date(Date.now() - 3600000).toISOString() });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { weight: "62" } });
  const a = AllergyIntolerance({ patientId: adm.patientId, substance: "Penicillins", reaction: "anaphylaxis", severity: "severe", criticality: "high" });
  const at = new Date().toISOString();
  await RECORD.append(TENANT.id, [{ ...a, version: 1, meta: { ...(a.meta || {}), recordedAt: at, effectiveAt: at } }]);
  return { reg, adm };
}

/** The body wardsynq-app.js sign() posts: checkOnly first, then the order (with overrideReason when there were findings). */
const workstationOrder = (adm, over, extra) => ({
  orgId: ORG,
  order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Paracetamol", dose: { value: 1000, unit: "mg" }, route: "oral", frequency: "q6h", ...(over || {}) },
  ...(extra || {}),
});

test("LT-09: the workstation's roster and context come from the hospital's own ward, through the page's exact requests", async () => {
  seedHospital();
  const { adm } = await admitted();

  const who = await as(DOCTOR, `/whoami?${qs({ orgId: ORG })}`);
  assert.ok(who.ok && who.caps.includes("emr.treat"), JSON.stringify(who));
  const list = await as(DOCTOR, `/ward/list?${qs({ orgId: ORG })}`);
  assert.equal(list.__status, 200);
  assert.deepEqual(list.patients.map((p) => [p.name, p.ward, p.bed]), [["Test Patient QA-01", "General A", "03"]], "the admitted patient, not a fabricated one");

  const allergies = await as(DOCTOR, `/ward/fhir/AllergyIntolerance?${qs({ orgId: ORG, patient: adm.patientId, _count: 200 })}`);
  assert.equal(allergies.__status, 200, JSON.stringify(allergies));
  assert.deepEqual(allergies.entry.map((e) => [e.resource.code.text, e.resource.criticality]), [["Penicillins", "high"]]);

  const timeline = await as(DOCTOR, `/ward/timeline?${qs({ orgId: ORG, patientId: adm.patientId })}`);
  assert.ok(timeline.ok && Array.isArray(timeline.activeMedications));

  const patient = await as(DOCTOR, `/ward/fhir/Patient/${encodeURIComponent(adm.patientId)}?${qs({ orgId: ORG })}`);
  assert.equal(patient.resourceType, "Patient", JSON.stringify(patient));

  const weight = await as(DOCTOR, `/ward/fhir/Observation?${qs({ orgId: ORG, patient: adm.patientId, code: "29463-7", _sort: "-date", _count: 1 })}`);
  assert.equal(weight.__status, 200, JSON.stringify(weight));
  assert.equal(weight.entry[0].resource.valueQuantity.value, 62);
  assert.equal(weight.entry[0].resource.valueQuantity.unit, "kg");

  const labs = await as(DOCTOR, `/ward/fhir/Observation?${qs({ orgId: ORG, patient: adm.patientId, category: "laboratory", _sort: "-date", _count: 20 })}`);
  assert.equal(labs.__status, 200, JSON.stringify(labs));
  assert.equal(labs.resourceType, "Bundle");
});

test("LT-09 and LT-10: the check Sign asks for first is the server's engine on the patient's record, and writes nothing", async () => {
  seedHospital();
  const { adm } = await admitted();
  const check = (over) => as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, over, { checkOnly: true }));

  const adult = await check();
  assert.equal(adult.__status, 200, JSON.stringify(adult));
  assert.equal(adult.checkOnly, true);
  assert.equal(adult.safety.checked, true);
  assert.deepEqual([...adult.safety.blocks, ...adult.safety.overridables].map((f) => f.code), [], "paracetamol 1 g q6h for a 62 kg adult: " + JSON.stringify(adult.safety));
  const overdose = await check({ frequency: "q4h" });
  assert.deepEqual(overdose.safety.blocks.map((f) => f.code), ["DOSE_ABSOLUTE_CEILING_DAILY"], "1 g every 4 hours is 6 g a day");
  const penicillin = await check({ drug: "Amoxicillin", dose: { value: 500, unit: "mg" }, frequency: "TDS" });
  assert.ok([...penicillin.safety.blocks, ...penicillin.safety.overridables].some((f) => /^ALLERGY/.test(f.code)), JSON.stringify(penicillin.safety));
  assert.equal((await RECORD.byPatient(TENANT.id, "MedicationOrder", adm.patientId)).length, 0, "a check writes nothing");

  // Proceeding past a finding carries the prescriber's reason onto the order.
  const placed = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { drug: "Amoxicillin", dose: { value: 500, unit: "mg" }, frequency: "TDS" }, { overrideReason: "Allergy history disputed, allergy team agrees" }));
  assert.equal(placed.__status, 200, JSON.stringify(placed));
  const stored = await RECORD.latest(TENANT.id, "MedicationOrder", placed.orderId);
  assert.equal(stored.safetyAtOrder.reason, "Allergy history disputed, allergy team agrees");
  assert.equal(stored.safetyAtOrder.acknowledgedBy, idFor(DOCTOR));
});

test("LT-09: Sign saves through the ward order route: the order is on the chart and on the round", async () => {
  seedHospital();
  const { adm } = await admitted();
  const saved = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm));
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.equal(saved.written, 1);
  const stored = await RECORD.latest(TENANT.id, "MedicationOrder", saved.orderId);
  assert.deepEqual([stored.drug, stored.dose.value, stored.frequency, stored.status, stored.signedBy], ["Paracetamol", 1000, "q6h", "active", idFor(DOCTOR)],
    "signed by the authenticated doctor, not by any name the page carries");

  const timeline = await as(DOCTOR, `/ward/timeline?${qs({ orgId: ORG, patientId: adm.patientId })}`);
  assert.deepEqual(timeline.activeMedications.map((m) => [m.drug, m.frequency]), [["Paracetamol", "q6h"]], "on the chart");

  const from = stored.meta.effectiveAt, to = new Date(Date.parse(from) + 86400000).toISOString();
  const round = await as(NURSE, `/ward/schedule?${qs({ orgId: ORG, patientId: adm.patientId, from, to })}`);
  assert.equal(round.__status, 200, JSON.stringify(round));
  assert.equal(round.due.length, 4, "q6h is four doses a day on the round: " + JSON.stringify(round.due));
  assert.ok(round.due.every((d) => d.drug === "Paracetamol"));
});

test("LT-09: who may not sign from the workstation: no session, a nurse, another hospital; nothing is written", async () => {
  seedHospital();
  const { adm } = await admitted();
  const count = async () => (await RECORD.byPatient(TENANT.id, "MedicationOrder", adm.patientId)).length;

  const anon = await as(null, "/ward/medication-order", "POST", workstationOrder(adm));
  assert.equal(anon.__status, 401, JSON.stringify(anon));
  const nurse = await as(NURSE, "/ward/medication-order", "POST", workstationOrder(adm));
  assert.equal(nurse.__status, 403, JSON.stringify(nurse));
  const elsewhere = await as(DOCTOR, "/ward/medication-order", "POST", { ...workstationOrder(adm), orgId: ORG2 });
  assert.equal(elsewhere.__status, 403, JSON.stringify(elsewhere));
  assert.equal(await count(), 0, "a refused sign writes nothing");
  // The roster of another hospital is refused too, never answered with an empty ward.
  assert.equal((await as(DOCTOR, `/ward/list?${qs({ orgId: ORG2 })}`)).__status, 403);
  assert.equal((await as(null, `/ward/list?${qs({ orgId: ORG })}`)).__status, 401);

  const ok = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm));
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(await count(), 1);
});

/* ---- Retest 2026-09-16 (docs/wardsynq/LIVE_RETEST_2026-09-16.md, new observation 1) ------------------
 * QA-04, 62 kg, paracetamol 1000 mg QDS active: a second paracetamol order came back allowed:true,
 * findings:[] (8 g a day). The same molecule already active is a finding; the day's total across the active
 * orders of that molecule above the daily ceiling is a hard stop the server refuses whatever the reason. */
test("retest 2026-09-16: POST /api/queue/ward/medication-order flags the same drug already active and refuses a combined daily overdose; a replacement is neither", async () => {
  seedHospital();
  const { adm } = await admitted();
  const count = async () => (await RECORD.byPatient(TENANT.id, "MedicationOrder", adm.patientId)).filter((o) => o.status === "active").length;
  const first = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { frequency: "QDS" }));
  assert.equal(first.__status, 200, JSON.stringify(first));
  assert.equal(await count(), 1);
  const codes = (sf) => [...sf.blocks, ...sf.overridables, ...sf.warnings].map((f) => f.code).sort();

  // The exact live case: another paracetamol 1 g QDS, written as its own order.
  const second = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { drug: "Paracetamol 1g", frequency: "QDS" }, { checkOnly: true }));
  assert.equal(second.__status, 200, JSON.stringify(second));
  assert.equal(second.safety.allowed, false);
  assert.deepEqual(codes(second.safety), ["DOSE_ABSOLUTE_CEILING_CUMULATIVE", "SAME_DRUG_ACTIVE"], JSON.stringify(second.safety));
  assert.deepEqual(second.safety.hardStops.map((f) => f.code), ["DOSE_ABSOLUTE_CEILING_CUMULATIVE"]);
  assert.match(second.safety.hardStops[0].message, /8000 mg a day/);
  assert.equal(second.safety.overridables.find((f) => f.code === "SAME_DRUG_ACTIVE").hardStop, undefined, "the duplicate itself needs a reason, it is not a hard stop");
  // 650 mg TDS on top is 5.95 g: the same refusal.
  const tds = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { drug: "Paracetamol 650", dose: { value: 650, unit: "mg" }, frequency: "TDS" }, { checkOnly: true }));
  assert.deepEqual(tds.safety.hardStops.map((f) => f.code), ["DOSE_ABSOLUTE_CEILING_CUMULATIVE"], JSON.stringify(tds.safety));
  // A dose in grams is summed in mg, not dropped.
  const grams = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { drug: "Paracetamol tablet", dose: { value: 1, unit: "g" }, frequency: "BD" }, { checkOnly: true }));
  assert.deepEqual(grams.safety.hardStops.map((f) => f.code), ["DOSE_ABSOLUTE_CEILING_CUMULATIVE"], JSON.stringify(grams.safety));

  // Placing it, even with a reason, is refused and writes nothing.
  const placed = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { drug: "Paracetamol 1g", frequency: "QDS" }, { overrideReason: "pain not controlled" }));
  assert.equal(placed.__status, 409, JSON.stringify(placed));
  assert.equal(placed.error, "safety_hard_stop");
  assert.equal(placed.written, 0);
  assert.equal(await count(), 1, "nothing written");
  // So is a single order above the daily ceiling (1 g every 4 hours).
  const q4h = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { drug: "Paracetamol IV", frequency: "q4h" }, { overrideReason: "x" }));
  assert.equal(q4h.__status, 409, JSON.stringify(q4h));
  assert.equal(await count(), 1);

  // The replacement flow: the same order written again replaces the active one, so it is not a duplicate of itself.
  const repl = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { dose: { value: 650, unit: "mg" }, frequency: "TDS" }, { checkOnly: true }));
  assert.equal(repl.replaces.orderId, first.orderId, JSON.stringify(repl));
  assert.deepEqual(codes(repl.safety), [], JSON.stringify(repl.safety));
  const replaced = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { dose: { value: 650, unit: "mg" }, frequency: "TDS" }));
  assert.equal(replaced.__status, 200, JSON.stringify(replaced));
  assert.equal(await count(), 1, "still one active paracetamol order");

  // A PRN on top of the regular order has no daily count: a finding that needs a reason, and it can be placed.
  const prn = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { drug: "Paracetamol PRN", dose: { value: 500, unit: "mg" }, frequency: "PRN" }, { checkOnly: true }));
  assert.deepEqual(codes(prn.safety), ["SAME_DRUG_ACTIVE"], JSON.stringify(prn.safety));
  assert.deepEqual(prn.safety.hardStops, []);
  const prnPlaced = await as(DOCTOR, "/ward/medication-order", "POST", workstationOrder(adm, { drug: "Paracetamol PRN", dose: { value: 500, unit: "mg" }, frequency: "PRN" }, { overrideReason: "breakthrough fever overnight" }));
  assert.equal(prnPlaced.__status, 200, JSON.stringify(prnPlaced));
  assert.equal(await count(), 2);
  // A nurse still cannot place anything, hard stop or not.
  assert.equal((await as(NURSE, "/ward/medication-order", "POST", workstationOrder(adm, { drug: "Paracetamol 1g", frequency: "QDS" }))).__status, 403);
});
