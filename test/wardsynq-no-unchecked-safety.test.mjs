/* test/wardsynq-no-unchecked-safety.test.mjs - R6-1: a safety check that could not read the record
 * says so, and is never presented as a clean one.
 *
 * The class of bug proven dead here: `svc.byPatient("AllergyIntolerance", id).catch(() => [])`
 * inside a safety path. The store faults, the check gets an empty list, and a patient with a
 * documented allergy is shown to the prescriber, the pharmacist or the radiologist as a patient
 * with none. The inner catch also swallowed the failure before each file's own outer catch could
 * see it, so the degraded (rx-safety.js) and fail-closed (radiology-protocol.js) branches written
 * underneath were dead code.
 *
 * Routes exercised, in full:
 *   GET  /api/queue/ward/protocol-context    GET  /api/queue/ward/verification-queue
 *   POST /api/queue/ward/protocol-set        POST /api/queue/ward/dispense
 *   GET  /api/queue/ward/icu
 * plus checkPrescriptionSafety() itself, which GET /api/queue/rx-safety calls with the same deps.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-no-unchecked-safety.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
import vm from "node:vm";
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
/** THE FAULT. One resource type's byPatient read throws, exactly as a store hiccup would. */
let FAULT = null;
const repo = new Proxy({}, {
  get(_t, prop) {
    const v = RECORD[prop];
    if (typeof v !== "function") return v;
    if (prop === "byPatient") {
      return (tenantId, type, patientId) => (type === FAULT
        ? Promise.reject(new Error("store unavailable"))
        : RECORD.byPatient(tenantId, type, patientId));
    }
    return v.bind(RECORD);
  },
});

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
    recordDeps: () => ({ repository: repo, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const { actorDeps, recordDeps } = await import("../functions/_wardsynq/deps.js");
const { checkPrescriptionSafety } = await import("../functions/_wardsynq/rx-safety.js");
const { compileRulePack } = await import("../wardsynq/wardsynq-safety.js");

const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", LABTECH = "lab@example.test", PHARM = "pharmacy@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};
const PACK = compileRulePack({
  version: "test-1",
  drugClasses: { amoxicillin: ["penicillin"] },
  interactions: [],
  allergyClasses: { amoxicillin: ["penicillin_class"] },
  crossReactivity: [],
});

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository(); FAULT = null;
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [LABTECH, "lab"], [PHARM, "pharmacy"]]) {
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
/** One admitted patient with a documented penicillin allergy and one active medication order. */
async function admitWithAllergy() {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Unchecked Safety", mobile: "9876500701", gender: "male", ageYears: 50 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "3" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  await RECORD.append(TENANT_ROW.id, [
    { resourceType: "AllergyIntolerance", id: "alg-1", version: 1, patientId, substance: "Amoxicillin", severity: "severe", criticality: "high", reaction: "anaphylaxis" },
  ]);
  return { reg, patientId, encounterId: adm.encounterId };
}

test("SOURCE: not one per-read `.catch(() => [])` survives on the five safety files", () => {
  for (const f of ["rx-safety", "pharmacy-verify", "radiology-protocol", "pharmacy-dispense", "icu-care"]) {
    const src = readFileSync(new URL(`../functions/_wardsynq/${f}.js`, import.meta.url), "utf8")
      .split("\n").filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join("\n");
    assert.equal(/\.catch\(\(\) => \[\]\)/.test(src), false, `${f}.js still swallows a read into an empty list`);
  }
});

test("BEDSIDE PRESCRIBING: a faulted allergy read is NOT CHECKED, never a clean verdict", async () => {
  const { patientId } = await admitWithAllergy();
  const req = () => new Request("https://x", { headers: { "Cf-Access-Authenticated-User-Email": DOCTOR } });
  const ctx = () => ({ candidate: { drug: "amoxicillin", generic: "amoxicillin" }, patientId, tenantId: TENANT_ROW.id,
    actorDeps: actorDeps(ENV), recordDeps: recordDeps(ENV, TENANT_ROW.id), rulePack: PACK });

  // Control: the read works, and the documented allergy is found. Without this the test below proves nothing.
  const clean = await checkPrescriptionSafety(req(), ENV, ctx());
  assert.ok(clean.findings.some((f) => f.code.startsWith("ALLERGY")), "the documented allergy must be found when the record reads: " + JSON.stringify(clean));
  assert.ok(!clean.notChecked, "nothing is reported as unchecked when both reads landed");

  // The bug: the store faults on AllergyIntolerance.
  FAULT = "AllergyIntolerance";
  const v = await checkPrescriptionSafety(req(), ENV, ctx());
  assert.ok(Array.isArray(v.notChecked) && v.notChecked.includes("AllergyIntolerance"),
    "a failed allergy read must be NAMED on the verdict, not left as findings: [] - " + JSON.stringify(v));
  assert.equal(v.findings.filter((f) => f.code.startsWith("ALLERGY")).length, 0, "it genuinely could not check - that is the point");
  assert.ok(v.notCheckedReason, "and it says why");
  assert.equal(v.unapproved, true, "still advisory only: this never gates the prescription");
  assert.ok(!("blocked" in v) && !("allowed" in v), "R6-1 does not turn the advisory hook into a gate");

  // A faulted MedicationOrder read is named too - an empty active-medication list is not an answer.
  FAULT = "MedicationOrder";
  const m = await checkPrescriptionSafety(req(), ENV, ctx());
  assert.ok(m.notChecked.includes("MedicationOrder"), JSON.stringify(m));
});

test("GET /api/queue/ward/protocol-context: an unreadable allergy list is not 'no contrast reaction recorded'", async () => {
  const { encounterId } = await admitWithAllergy();
  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId, code: "CT abdomen", category: "imaging" });
  assert.equal(order.__status, 200, JSON.stringify(order));

  const ok = await as(LABTECH, `/ward/protocol-context?orgId=${ORG}&serviceRequestId=${order.orderId}`);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.deepEqual(ok.contrastAllergies, [], "read and found nothing about CONTRAST (the penicillin allergy is not one)");
  assert.match(ok.note, /No contrast reaction is recorded/);

  FAULT = "AllergyIntolerance";
  const r = await as(LABTECH, `/ward/protocol-context?orgId=${ORG}&serviceRequestId=${order.orderId}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.contrastAllergies, null, "null is the read that did not happen; [] would render as a clear check");
  assert.ok(r.notChecked.includes("AllergyIntolerance"), JSON.stringify(r));
  assert.match(r.note, /COULD NOT BE READ/);

  FAULT = "Observation";
  const renal = await as(LABTECH, `/ward/protocol-context?orgId=${ORG}&serviceRequestId=${order.orderId}`);
  assert.equal(renal.renal, null, "an unreadable Observation must not become 'NO CREATININE IS RECORDED'");
  assert.ok(renal.notChecked.includes("Observation"));
});

test("POST /api/queue/ward/protocol-set: contrast is REFUSED while the allergy or renal read is faulted, and nothing is written", async () => {
  const { encounterId, patientId } = await admitWithAllergy();
  const order = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId, code: "CT abdomen", category: "imaging" });

  FAULT = "AllergyIntolerance";
  const refused = await as(LABTECH, "/ward/protocol-set", "POST", { orgId: ORG, serviceRequestId: order.orderId, protocol: "CT abdomen portal venous", contrast: true });
  assert.equal(refused.__status, 502, JSON.stringify(refused));
  assert.equal(refused.error, "clinical_read_failed");
  assert.equal(refused.written, 0);
  assert.match(refused.detail, /not a clear one/);
  assert.deepEqual(await RECORD.byPatient(TENANT_ROW.id, "ImagingProtocol", patientId), [], "no protocol record exists for a refused contrast protocol");

  FAULT = "Observation";
  const renalRefused = await as(LABTECH, "/ward/protocol-set", "POST", { orgId: ORG, serviceRequestId: order.orderId, protocol: "CT abdomen portal venous", contrast: true });
  assert.equal(renalRefused.__status, 502, JSON.stringify(renalRefused));
  assert.equal(renalRefused.written, 0);

  // A NON-contrast protocol is still recordable - this file warns, it does not stop imaging - but the
  // record says which read did not happen rather than recording an empty allergy list as a fact.
  const nonContrast = await as(LABTECH, "/ward/protocol-set", "POST", { orgId: ORG, serviceRequestId: order.orderId, protocol: "CT abdomen non-contrast", contrast: false });
  assert.equal(nonContrast.__status, 200, JSON.stringify(nonContrast));
  assert.ok(nonContrast.notChecked.includes("Observation"), JSON.stringify(nonContrast));
  assert.equal(nonContrast.protocolRecord.renalAtProtocol, null, "not 'NO CREATININE IS RECORDED' about a read that failed");
  assert.deepEqual(nonContrast.protocolRecord.notCheckedAtProtocol, ["Observation"]);
});

test("GET /api/queue/ward/verification-queue: the allergy list is null when unread, and an unreadable verification list is a refusal", async () => {
  const { patientId, encounterId } = await admitWithAllergy();
  const medOrder = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId, encounterId, drug: "Amoxicillin 500mg", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TID" } });
  assert.equal(medOrder.__status, 200, JSON.stringify(medOrder));

  const ok = await as(PHARM, `/ward/verification-queue?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.allergies.length, 1, "the allergies travel with the queue when they can be read");

  FAULT = "AllergyIntolerance";
  const r = await as(PHARM, `/ward/verification-queue?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.allergies, null, "null, never [] - a pharmacist reading [] concludes the patient has no allergies");
  assert.deepEqual(r.allergiesUnavailable.notChecked, ["AllergyIntolerance"]);
  assert.equal(r.orders.length, 1, "the orders are still shown: the gap is named, not the whole screen lost");

  FAULT = "MedicationVerification";
  const v = await as(PHARM, `/ward/verification-queue?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(v.__status, 502, JSON.stringify(v));
  assert.equal(v.error, "record_read_failed", "every order would otherwise read as 'unverified', including one verified at an older version");
});

test("POST /api/queue/ward/dispense: stock is NOT issued while the verification list cannot be read", async () => {
  const { patientId, encounterId } = await admitWithAllergy();
  const medOrder = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId, encounterId, drug: "Amoxicillin 500mg", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TID" } });
  assert.equal((await as(PHARM, "/ward/verify-order", "POST", { orgId: ORG, orderId: medOrder.orderId, outcome: "verified" })).__status, 200);

  FAULT = "MedicationVerification";
  const d = await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: medOrder.orderId, quantity: { value: 21, unit: "capsule" }, batch: "AMX-1", expiry: "2027-01-31" });
  assert.equal(d.__status, 502, JSON.stringify(d));
  assert.equal(d.error, "record_read_failed");
  assert.equal(d.written, 0);
  assert.deepEqual(await RECORD.byPatient(TENANT_ROW.id, "MedicationDispense", patientId), [],
    "nothing was issued, and nothing was recorded as 'unverified' about an order that WAS verified");

  FAULT = null;
  const ok = await as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: medOrder.orderId, quantity: { value: 21, unit: "capsule" }, batch: "AMX-1", expiry: "2027-01-31" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.unverified, false, "and once the list reads, the supply knows it was verified");
});

test("GET /api/queue/ward/icu: an unreadable medication list refuses, it does not quietly drop the infusion", async () => {
  const { patientId } = await admitWithAllergy();
  FAULT = "MedicationOrder";
  const r = await as(NURSE, `/ward/icu?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(r.__status, 502, JSON.stringify(r));
  assert.equal(r.error, "record_read_failed", "a running noradrenaline whose drug name cannot be read used to vanish off the card");
});

// ---- the screens -------------------------------------------------------------------------------
/** ward.js in a sandbox, English, no i18n catalogue - the same loader test/ward-staff-i18n.test.mjs uses. */
function wardUi() {
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], documentElement: {} },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(readFileSync(new URL("../ward.js", import.meta.url), "utf8"), sb);
  return sb.window.WARD;
}
const SEL = { encounterId: "enc-1", patientId: "pat-1", ward: "Medical A", bed: "3", name: "Unchecked Safety", mrn: "MRN-1" };
const render = (W, s) => W._render(JSON.parse(JSON.stringify({ ...W._st, orgId: "org-1", loaded: true, sel: SEL, ...s })));

test("SCREEN radiology: an unread allergy list says so, and does not offer a clean protocol", () => {
  const W = wardUi();
  const req = { serviceRequestId: "sr-1", code: "CT abdomen", display: "CT abdomen", patientId: "pat-1", version: 1 };
  const base = { view: "radiology", investigations: { requests: [{ serviceRequestId: "sr-1", code: "CT abdomen", display: "CT abdomen", category: "imaging" }] } };

  const clear = render(W, { ...base, radiology: { pickedRequestId: "sr-1", protocol: { request: req, contrastAllergies: [], renal: { known: false, note: "x" } } } });
  assert.match(clear, /No contrast reaction is recorded/);

  const unread = render(W, { ...base, radiology: { pickedRequestId: "sr-1", protocol: { request: req, contrastAllergies: null, renal: null, notChecked: ["AllergyIntolerance", "Observation"] } } });
  assert.ok(!/No contrast reaction is recorded/.test(unread), "the clean sentence must be gone when nothing was read");
  assert.match(unread, /The allergy record could not be read/);
  assert.match(unread, /The renal results could not be read/);
  assert.ok(!/No creatinine on record/.test(unread));
  assert.match(unread, /Contrast cannot be protocolled/);
});

test("SCREEN pharmacy: an unread allergy list is never 'No allergy recorded', and the verdict is not 'nothing against this order'", () => {
  const W = wardUi();
  const order = { orderId: "rx-1", drug: "Amoxicillin 500mg", state: "unverified", orderVersion: 1, safety: { blocks: [], warnings: [] } };

  const clear = render(W, { view: "pharmacy", pharmacy: { pickedOrderId: "rx-1", queue: { orders: [order], allergies: [], unverified: 1 } } });
  assert.match(clear, /No allergy recorded/);
  assert.match(clear, /reports nothing against this order/);

  const unread = render(W, { view: "pharmacy", pharmacy: { pickedOrderId: "rx-1", queue: { orders: [order], allergies: null, unverified: 1, allergiesUnavailable: { notChecked: ["AllergyIntolerance"], reason: "store unavailable" } } } });
  assert.ok(!/No allergy recorded/.test(unread), "an unreadable allergy list must never render as an empty one");
  assert.match(unread, /The allergy list could not be read/);
  assert.ok(!/reports nothing against this order/.test(unread), "and the verdict card must not read as clean either");
  assert.match(unread, /NOT CHECKED against allergies/);
});

test("SCREEN prescribe confirm (opd-emr.js): a notChecked verdict names the record it could not read", () => {
  const src = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  const m = /function wardsynqSafetyNote\(safety\) \{[\s\S]*?\n  \}/.exec(src);
  assert.ok(m, "wardsynqSafetyNote must still exist");
  const fn = vm.runInNewContext("(" + m[0] + ")");

  const unchecked = fn({ unapproved: true, findings: [], notChecked: ["AllergyIntolerance"], notCheckedReason: "store unavailable" });
  assert.match(unchecked, /NOT CHECKED against: this patient's allergies/);
  assert.ok(!/No interaction or allergy match found/.test(unchecked), "the clean sentence must not appear on an unchecked verdict");

  const degraded = fn({ unapproved: true, findings: [], degraded: true });
  assert.match(degraded, /NOT CHECKED/);

  const clean = fn({ unapproved: true, findings: [], unresolvedActiveMeds: [] });
  assert.match(clean, /No interaction or allergy match found/, "a real clean check still reads as one");
});
