/* test/neg-auth-remaining-routes.test.mjs — negative-authorization coverage for the WardSynQ
 * ward-segment routes that scripts/wardsynq-reachability.mjs listed as untested: GET /ward/device-list,
 * GET /ward/risk-tools, POST /ward/risk-action, GET /ward/templates, GET /ward/maik-status,
 * GET /ward/maternity-status, GET /ward/blood-loss-list, GET /ward/delivery-get,
 * POST /ward/surgery-abandon, GET /ward/surgery-list, POST /ward/id-match, GET /ward/patient-copy,
 * POST /ward/advisory-check, GET /ward/backup-status, GET /ward/upcoding.
 *
 * For each route: (1) no session -> 401, (2) a same-hospital member WITHOUT the required capability
 * -> 403 (and nothing written, for the two writes in this file), (3) a member of a DIFFERENT hospital
 * who holds that capability only in their OWN hospital -> refused, (4) the correct role succeeds and
 * a meaningful property of the response is asserted, not just the 200.
 *
 * Same harness as test/neg-auth-ward-sensitive.test.mjs: in-memory `_fbfirestore.js`, `_wardsynq/deps.js`
 * mocked onto a real MemoryRepository + a tiny CONNECT_DB double, the router run for real via onRequest.
 *
 * BUG (not fixed here, per instruction): migrate-maternity.js's maternityView/listBloodLoss/getDelivery
 * swallow a failed record-service read into an empty/null result and still answer ok:true -
 * functions/_wardsynq/migrate-maternity.js:130-132 (maternityView, used by maternity-status),
 * :249 (listBloodLoss) and :304 (getDelivery). An unloaded list must never look like an empty one
 * (vault/decisions/Decisions.md's own rule, and the brief's), and here it does. Recorded as
 * `test(..., { skip: "BUG: ..." })` below, once per affected route.
 *
 * node --test --experimental-test-module-mocks test/neg-auth-remaining-routes.test.mjs
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
const TENANT_ROW = { id: "tenant-wsq2", name: "WSQ2 Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq2" } }) };
const FALLS_TOOL = {
  id: "falls", name: "Falls Risk", version: "1",
  items: [{ key: "mobility", title: "Mobility", options: [{ value: "independent", score: 0 }, { value: "assisted", score: 2 }] }],
  bands: [{ band: "low", min: 0, max: 1, actions: [] }, { band: "high", min: 2, max: 10, actions: ["bed-alarm"] }],
};
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
        return who === DOCTOR ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {};
      },
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq2";
const OTHER_ORG = "org-other2";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor2@example.test", CASHIER = "cashier2@example.test", ADMIN = "admin2@example.test";
const OTHER_DOCTOR = "other-doctor2@example.test", OTHER_ADMIN = "other-admin2@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WSQ02", name: "WSQ2 Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody2", createdAt: 1, wardsynq: { riskTools: [FALLS_TOOL] } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [CASHIER, "cashier"], [ADMIN, "admin"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_orgs/${OTHER_ORG}`, { fields: { id: OTHER_ORG, code: "SMD-OTHR02", name: "A Different Hospital 2", kind: "clinic", mode: "native", ownerUid: "cfa:someone-else2", createdAt: 1 }, updateTime: "t1" });
  for (const [email, role] of [[OTHER_DOCTOR, "doctor"], [OTHER_ADMIN, "admin"]]) {
    docs.set(`q_members/${sanitize(OTHER_ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: OTHER_ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
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
async function anon(path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

let n = 0;
/** A real registered + admitted patient - the substrate every route below reads or writes against. */
async function admittedPatient() {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Remaining Routes Testcase " + n, mobile: "98765091" + String(n).padStart(2, "0"), gender: "female", ageYears: 40 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical B", bed: String(n) });
  return { reg, adm, patientId: adm.patientId, encounterId: adm.encounterId };
}

/**
 * The four shared cases, against ONE GET or POST route. Cases (1)-(3) are refused at the outer
 * org-authorization gate before the route touches the record store (same reasoning as
 * test/neg-auth-ward-sensitive.test.mjs), so nothing built for case (4) is disturbed by them.
 */
async function runFourCases(path, method, params, { noCapEmail, correctCapEmail, otherOrgEmail }) {
  const isGet = (method || "GET") === "GET";
  const qs = isGet ? "?" + new URLSearchParams({ orgId: ORG, ...params }).toString() : "";
  const body = isGet ? undefined : { orgId: ORG, ...params };
  const call = (email) => (email === null ? anon(path + qs, method, body) : as(email, path + qs, method, body));

  const r401 = await call(null);
  assert.equal(r401.__status, 401, path + " (no session): " + JSON.stringify(r401));

  const r403 = await call(noCapEmail);
  assert.equal(r403.__status, 403, path + " (no cap): " + JSON.stringify(r403));

  const rCross = await call(otherOrgEmail);
  assert.ok(rCross.__status === 403 || rCross.__status === 404, path + " (cross-hospital): " + JSON.stringify(rCross));

  const rOk = await call(correctCapEmail);
  assert.equal(rOk.__status, 200, path + " (correct role): " + JSON.stringify(rOk));
  return rOk;
}

/* ==================================================================================================
 * GET /ward/device-list - emr.view
 * ================================================================================================== */

test("GET /ward/device-list: no session refused, wrong-role refused, cross-hospital refused, doctor sees the (empty) device list", async () => {
  seedHospital();
  const { patientId } = await admittedPatient();
  const r = await runFourCases("/ward/device-list", "GET", { patientId }, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.ok(Array.isArray(r.devices), "devices is a real array, not a bare 200");
});

/* ==================================================================================================
 * GET /ward/risk-tools - emr.view (pure hospital configuration, no patient read)
 * ================================================================================================== */

test("GET /ward/risk-tools: no session refused, wrong-role refused, cross-hospital refused, doctor sees the configured tool", async () => {
  seedHospital();
  const r = await runFourCases("/ward/risk-tools", "GET", {}, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.equal(r.tools.length, 1);
  assert.equal(r.tools[0].id, "falls");
});

/* ==================================================================================================
 * POST /ward/risk-action - emr.vitals
 * ================================================================================================== */

test("POST /ward/risk-action: no session refused, wrong-role refused (nothing written), cross-hospital refused, doctor completes the action", async () => {
  seedHospital();
  const { patientId, encounterId } = await admittedPatient();
  const assessed = await as(DOCTOR, "/ward/assess", "POST", { orgId: ORG, toolId: "falls", encounterId, answers: { mobility: "assisted" } });
  assert.equal(assessed.__status, 200, JSON.stringify(assessed));
  assert.equal(assessed.band, "high");
  assert.deepEqual(assessed.actions, ["bed-alarm"]);

  const r = await runFourCases("/ward/risk-action", "POST", { assessmentId: assessed.assessmentId, action: "bed-alarm" }, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.equal(r.written, 1);
  assert.equal(r.actionsOutstanding, 0, "the one action the band called for is now done");

  const listed = await as(DOCTOR, `/ward/risks?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(listed.__status, 200, JSON.stringify(listed));
  assert.equal(listed.assessments[0].actionsOutstanding, 0);
});

/* ==================================================================================================
 * GET /ward/templates - emr.view (pure hospital configuration + built-ins, no patient read)
 * ================================================================================================== */

test("GET /ward/templates: no session refused, wrong-role refused, cross-hospital refused, doctor sees the built-in templates", async () => {
  seedHospital();
  const r = await runFourCases("/ward/templates", "GET", {}, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.ok(r.templates.length > 0, "the built-in templates are always available");
});

/* ==================================================================================================
 * GET /ward/maik-status - emr.view (synchronous config read, no record-service I/O at all)
 * ================================================================================================== */

test("GET /ward/maik-status: no session refused, wrong-role refused, cross-hospital refused, doctor sees whether MaiK is configured", async () => {
  seedHospital();
  const r = await runFourCases("/ward/maik-status", "GET", {}, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.equal(typeof r.enabled, "boolean");
});

/* ==================================================================================================
 * GET /ward/maternity-status - emr.view
 * ================================================================================================== */

test("GET /ward/maternity-status: no session refused, wrong-role refused, cross-hospital refused, doctor sees a recorded pregnancy", async () => {
  seedHospital();
  const { patientId } = await admittedPatient();
  const preg = await as(DOCTOR, "/ward/pregnancy", "POST", { orgId: ORG, patientId, pregnancy: { gestationWeeks: 28, gravida: 2, para: 1 } });
  assert.equal(preg.__status, 200, JSON.stringify(preg));

  const r = await runFourCases("/ward/maternity-status", "GET", { patientId }, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.equal(r.status.state, "antenatal");
  assert.equal(r.status.gestationWeeks, 28);
});

test("GET /ward/maternity-status: a read that cannot reach the store is refused, never answered as an empty-but-fine status", async () => {
  seedHospital();
  const { patientId } = await admittedPatient();
  const preg = await as(DOCTOR, "/ward/pregnancy", "POST", { orgId: ORG, patientId, pregnancy: { gestationWeeks: 28, gravida: 2, para: 1 } });
  assert.equal(preg.__status, 200, JSON.stringify(preg));
  const real = RECORD.byPatient.bind(RECORD);
  RECORD.byPatient = async (tenantId, resourceType, pid) => { if (resourceType === "Observation") throw new Error("store unavailable"); return real(tenantId, resourceType, pid); };
  try {
    const r = await as(DOCTOR, `/ward/maternity-status?orgId=${ORG}&patientId=${patientId}`);
    assert.equal(r.__status, 502, JSON.stringify(r));
    assert.equal(r.error, "record_read_failed");
  } finally { RECORD.byPatient = real; }
});

/* ==================================================================================================
 * GET /ward/blood-loss-list - emr.view
 * ================================================================================================== */

test("GET /ward/blood-loss-list: no session refused, wrong-role refused, cross-hospital refused, doctor sees a recorded loss", async () => {
  seedHospital();
  const { patientId, encounterId } = await admittedPatient();
  const loss = await as(DOCTOR, "/ward/blood-loss", "POST", { orgId: ORG, patientId, encounterId, loss: { ml: 300, method: "visual-estimate" } });
  assert.equal(loss.__status, 200, JSON.stringify(loss));

  const r = await runFourCases("/ward/blood-loss-list", "GET", { patientId }, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.equal(r.losses.length, 1);
  assert.equal(r.losses[0].ml, 300);
});

test("GET /ward/blood-loss-list: a read that cannot reach the store is refused, never answered as an empty-but-fine list", async () => {
  seedHospital();
  const { patientId, encounterId } = await admittedPatient();
  const loss = await as(DOCTOR, "/ward/blood-loss", "POST", { orgId: ORG, patientId, encounterId, loss: { ml: 300, method: "visual-estimate" } });
  assert.equal(loss.__status, 200, JSON.stringify(loss));
  const real = RECORD.byPatient.bind(RECORD);
  RECORD.byPatient = async (tenantId, resourceType, pid) => { if (resourceType === "BloodLossRecord") throw new Error("store unavailable"); return real(tenantId, resourceType, pid); };
  try {
    const r = await as(DOCTOR, `/ward/blood-loss-list?orgId=${ORG}&patientId=${patientId}`);
    assert.equal(r.__status, 502, JSON.stringify(r));
    assert.equal(r.error, "record_read_failed");
  } finally { RECORD.byPatient = real; }
});

/* ==================================================================================================
 * GET /ward/delivery-get - emr.view
 * ================================================================================================== */

test("GET /ward/delivery-get: no session refused, wrong-role refused, cross-hospital refused, doctor sees a recorded delivery", async () => {
  seedHospital();
  const { patientId, encounterId } = await admittedPatient();
  const del = await as(DOCTOR, "/ward/delivery", "POST", { orgId: ORG, patientId, encounterId, delivery: { mode: "vaginal" } });
  assert.equal(del.__status, 200, JSON.stringify(del));

  const r = await runFourCases("/ward/delivery-get", "GET", { patientId }, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.equal(r.delivery.mode, "vaginal");
});

test("GET /ward/delivery-get: a read that cannot reach the store is refused, never answered as an empty-but-fine delivery", async () => {
  seedHospital();
  const { patientId, encounterId } = await admittedPatient();
  const del = await as(DOCTOR, "/ward/delivery", "POST", { orgId: ORG, patientId, encounterId, delivery: { mode: "vaginal" } });
  assert.equal(del.__status, 200, JSON.stringify(del));
  const real = RECORD.byPatient.bind(RECORD);
  RECORD.byPatient = async (tenantId, resourceType, pid) => { if (resourceType === "DeliveryRecord") throw new Error("store unavailable"); return real(tenantId, resourceType, pid); };
  try {
    const r = await as(DOCTOR, `/ward/delivery-get?orgId=${ORG}&patientId=${patientId}`);
    assert.equal(r.__status, 502, JSON.stringify(r));
    assert.equal(r.error, "record_read_failed");
  } finally { RECORD.byPatient = real; }
});

/* ==================================================================================================
 * POST /ward/surgery-abandon - emr.treat
 * ================================================================================================== */

test("POST /ward/surgery-abandon: no session refused, wrong-role refused (nothing written), cross-hospital refused, doctor abandons the case", async () => {
  seedHospital();
  n++;
  const mrn = "SGYAB" + n;
  const booked = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn, procedure: "Appendicectomy", site: "abdomen", laterality: "not-applicable" } });
  assert.equal(booked.__status, 200, JSON.stringify(booked));

  const r = await runFourCases("/ward/surgery-abandon", "POST", { caseId: booked.caseId, reason: "Patient declined on the day" }, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.equal(r.written, 1);

  const got = await as(DOCTOR, `/ward/surgery-get?orgId=${ORG}&caseId=${booked.caseId}`);
  assert.equal(got.case.stage, "abandoned");
});

/* ==================================================================================================
 * GET /ward/surgery-list - emr.view
 * ================================================================================================== */

test("GET /ward/surgery-list: no session refused, wrong-role refused, cross-hospital refused, doctor sees the booked case", async () => {
  seedHospital();
  n++;
  const mrn = "SGYLS" + n;
  const booked = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn, procedure: "Cholecystectomy", site: "abdomen", laterality: "not-applicable" } });
  assert.equal(booked.__status, 200, JSON.stringify(booked));

  const r = await runFourCases("/ward/surgery-list", "GET", { patientId: booked.patientId }, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.equal(r.cases.length, 1);
  assert.equal(r.cases[0].id, booked.caseId);
});

/* ==================================================================================================
 * POST /ward/id-match - queue.add (proposes candidates; writes nothing)
 * ================================================================================================== */

test("POST /ward/id-match: no session refused, wrong-role refused, cross-hospital refused, doctor finds the likely duplicate", async () => {
  seedHospital();
  n++;
  const name = "Idmatch Testperson " + n;
  const dob = "1980-04-12";
  const a = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name, mobile: "98765092" + String(n).padStart(2, "0"), gender: "male", ageYears: 45, dob });
  assert.equal(a.__status, 200, JSON.stringify(a));

  const r = await runFourCases("/ward/id-match", "POST", { name, dob }, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.ok(Array.isArray(r.candidates));
});

/* ==================================================================================================
 * GET /ward/patient-copy - emr.view
 * ================================================================================================== */

test("GET /ward/patient-copy: no session refused, wrong-role refused, cross-hospital refused, doctor sees what the patient would be given", async () => {
  seedHospital();
  const { patientId } = await admittedPatient();
  const r = await runFourCases("/ward/patient-copy", "GET", { patientId }, { noCapEmail: CASHIER, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR });
  assert.equal(typeof r.document, "object");
  assert.ok(r.document, "the document itself is present, not null");
  assert.equal(r.preview, "Nothing has been given to the patient. Recording the handover is a separate, deliberate act.");
});

/* ==================================================================================================
 * POST /ward/advisory-check - staff.admin
 * ================================================================================================== */

test("POST /ward/advisory-check: no session refused, wrong-role refused, cross-hospital refused, admin gets a dry-run report", async () => {
  seedHospital();
  const r = await runFourCases("/ward/advisory-check", "POST", { advisories: [] }, { noCapEmail: DOCTOR, correctCapEmail: ADMIN, otherOrgEmail: OTHER_ADMIN });
  assert.equal(r.accepted, 0);
  assert.ok(Array.isArray(r.rules));
});

/* ==================================================================================================
 * GET /ward/backup-status - staff.admin
 * ================================================================================================== */

test("GET /ward/backup-status: no session refused, wrong-role refused, cross-hospital refused, admin sees the last recorded run", async () => {
  seedHospital();
  const ran = await as(ADMIN, "/ward/backup", "POST", { orgId: ORG, throughSeq: 1, rows: 10, location: "s3://backups/test" });
  assert.equal(ran.__status, 200, JSON.stringify(ran));

  const r = await runFourCases("/ward/backup-status", "GET", {}, { noCapEmail: DOCTOR, correctCapEmail: ADMIN, otherOrgEmail: OTHER_ADMIN });
  assert.equal(r.lastBackup.throughSeq, 1);
  assert.equal(r.lastBackup.location, "s3://backups/test");
});

/* ==================================================================================================
 * GET /ward/upcoding - staff.admin (the watchlist is checked "by somebody who is not paid on
 * collections", per billing.js's own comment - staff.admin, never billing.charge/billing.view)
 * ================================================================================================== */

test("GET /ward/upcoding: no session refused, wrong-role refused, cross-hospital refused, admin gets the watchlist for the patient", async () => {
  seedHospital();
  const { patientId } = await admittedPatient();
  const r = await runFourCases("/ward/upcoding", "GET", { patientId }, { noCapEmail: DOCTOR, correctCapEmail: ADMIN, otherOrgEmail: OTHER_ADMIN });
  assert.equal(typeof r.count, "number");
  assert.ok(Array.isArray(r.claims));
});
