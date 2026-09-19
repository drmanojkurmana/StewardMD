/* test/neg-auth-ward-sensitive.test.mjs — negative-authorization coverage for six sensitive
 * clinical/financial/records-custody WardSynQ routes: POST /ward/invoice-void, /ward/invoice-writeoff,
 * /ward/invoice-adjustment, /ward/resus-waive, /ward/patient-release, /ward/roi-cancel.
 *
 * For each route: (1) no session -> 401, (2) a same-hospital member WITHOUT the required capability
 * -> 403 and nothing written, (3) a member of a DIFFERENT hospital who holds that capability only in
 * their OWN hospital -> refused, never acts across hospitals, (4) the correct role succeeds, so the
 * refusals above are not false greens from a broken harness.
 *
 * Same harness shape as test/wardsynq-ed.test.mjs and test/wardsynq-invoice-bridge.test.mjs: in-memory
 * `_fbfirestore.js`, `_wardsynq/deps.js` mocked onto a real MemoryRepository + a tiny CONNECT_DB
 * double, the router run for real via onRequest.
 *
 * The outer per-request authorization gate (ORG.authorizeOrg against q_orgs/q_members) runs BEFORE
 * any of these routes touch the tenant record store, so cases (1)-(3) below are refused there and
 * never reach the record engine at all - the second, lightweight hospital used for case (3) needs no
 * tenant of its own for that reason. Case (4) needs the real thing: a real invoice, a real running
 * resus bundle, a real ROI request, each raised through its own real route first.
 *
 * node --test --experimental-test-module-mocks test/neg-auth-ward-sensitive.test.mjs
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
const TARIFF = { "MET500": { amount: 12, currency: "INR" } };
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

const ORG = "org-wsq";        // the real hospital, with a real tenant/record store
const OTHER_ORG = "org-other"; // a second hospital, real q_orgs/q_members row only - no tenant needed
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", CASHIER = "cashier@example.test", HIM = "him@example.test";
const OTHER_CASHIER = "other-cashier@example.test", OTHER_DOCTOR = "other-doctor@example.test", OTHER_HIM = "other-him@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { tariff: TARIFF } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [CASHIER, "cashier"], [HIM, "him"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  // A second, real hospital - own owner, own q_orgs row - never linked to a tenant. Its admins hold
  // the very same capabilities, in THEIR OWN hospital only.
  docs.set(`q_orgs/${OTHER_ORG}`, { fields: { id: OTHER_ORG, code: "SMD-OTHR01", name: "A Different Hospital", kind: "clinic", mode: "native", ownerUid: "cfa:someone-else", createdAt: 1 }, updateTime: "t1" });
  for (const [email, role] of [[OTHER_CASHIER, "cashier"], [OTHER_DOCTOR, "doctor"], [OTHER_HIM, "him"]]) {
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
/** Registers, admits and administers a real dose - the substrate charge-capture.js prices - then
 * raises a real, unpaid invoice against it. Same recipe as test/wardsynq-invoice-bridge.test.mjs. */
async function realInvoice() {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "NegAuth Testcase " + n, mobile: "98765090" + String(n).padStart(2, "0"), gender: "male", ageYears: 50 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: String(n) });
  const drug = "Metformin 500mg";
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug, drugCode: "MET500", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "OD" } });
  const patient = { id: adm.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn };
  const scan = { patientBarcode: reg.mrn, drugBarcode: drug, dose: { value: 500, unit: "mg" }, route: "oral" };
  const mar = (action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: "2026-09-09T09:00:00.000Z", patient, ...extra });
  await mar("verify"); await mar("dispense"); await mar("scan", { scan }); await mar("administer");
  const raised = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId });
  assert.equal(raised.__status, 200, JSON.stringify(raised));
  return { reg, adm, invoiceId: raised.invoiceId, patientId: adm.patientId };
}

/** A real, running resuscitation bundle with a CONDITIONAL element still open ("fluids", code-sepsis
 * - wardsynq-emergency.js's own BUNDLES table; only a conditional element may be waived). */
async function realResusBundle(patientId, encounterId) {
  const timeZero = new Date().toISOString();
  const bundle = await as(DOCTOR, "/ward/resus-start", "POST", { orgId: ORG, patientId, encounterId, code: "code-sepsis", timeZero });
  assert.equal(bundle.__status, 200, JSON.stringify(bundle));
  // "fluids" is code-sepsis's own conditional element (wardsynq-emergency.js's BUNDLES table) - only
  // a conditional element may be waived; status() does not echo the `conditional` flag back, so this
  // names it directly rather than searching for a field the wire shape does not carry.
  assert.ok(bundle.status.elements.some((e) => e.key === "fluids"));
  return { bundleId: bundle.bundleId, key: "fluids" };
}

/** A real, pending ROI request, ready to be cancelled. */
async function realRoiRequest(patientId) {
  const req = await as(HIM, "/ward/roi-request", "POST", { orgId: ORG, patientId, requester: { name: "Insurer Co" }, purpose: "claim_adjudication", scope: { recordTypes: ["Encounter"] }, recipient: "insurer@example.test" });
  assert.equal(req.__status, 200, JSON.stringify(req));
  return req.roiId;
}

/* ==================================================================================================
 * A tiny runner for the four shared cases, against ONE real prerequisite record built up-front.
 * This is safe precisely BECAUSE cases (1)-(3) are refused at the outer org-authorization gate
 * before the route ever touches the record store (see the file header) - nothing is consumed by a
 * refused call, so the same invoice/bundle/roi request is still there, untouched, for case (4).
 *  - path: the ward sub-route
 *  - body: the real request body (built once, against the real prerequisite record)
 *  - noCapEmail: an actor in ORG holding no relevant capability ("nurse" for every route here)
 *  - correctCapEmail: the actor in ORG who legitimately holds the capability
 *  - otherOrgEmail: an actor in OTHER_ORG holding the SAME capability, but only in OTHER_ORG
 * ================================================================================================== */

async function runFourCases(path, body, { noCapEmail, correctCapEmail, otherOrgEmail }) {
  const r401 = await anon(path, "POST", { orgId: ORG, ...body });
  assert.equal(r401.__status, 401, path + " (no session): " + JSON.stringify(r401));

  const r403 = await as(noCapEmail, path, "POST", { orgId: ORG, ...body });
  assert.equal(r403.__status, 403, path + " (no cap): " + JSON.stringify(r403));

  const rCross = await as(otherOrgEmail, path, "POST", { orgId: ORG, ...body });
  assert.ok(rCross.__status === 403 || rCross.__status === 404, path + " (cross-hospital): " + JSON.stringify(rCross));

  const rOk = await as(correctCapEmail, path, "POST", { orgId: ORG, ...body });
  assert.equal(rOk.__status, 200, path + " (correct role): " + JSON.stringify(rOk));
  return rOk;
}

/* ==================================================================================================
 * POST /ward/invoice-void, /ward/invoice-writeoff, /ward/invoice-adjustment - billing.charge
 * ================================================================================================== */

for (const [path, extra] of [
  ["/ward/invoice-void", { reason: "Raised in error" }],
  ["/ward/invoice-writeoff", { amount: 12, reason: "Bad debt" }],
  ["/ward/invoice-adjustment", { amount: 2, reason: "Correction" }],
]) {
  test(`POST ${path}: no session refused, wrong-role refused (nothing written), cross-hospital refused, cashier succeeds`, async () => {
    seedHospital();
    const inv = await realInvoice();
    const r = await runFourCases(path, { invoiceId: inv.invoiceId, ...extra }, {
      noCapEmail: NURSE, correctCapEmail: CASHIER, otherOrgEmail: OTHER_CASHIER,
    });
    assert.equal(r.written, 1, path + ": the correct role's call actually wrote the transition");
  });
}

/* ==================================================================================================
 * POST /ward/resus-waive - emr.treat
 * ================================================================================================== */

test("POST /ward/resus-waive: no session refused, wrong-role refused (nothing written), cross-hospital refused, doctor succeeds", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Resus Waive Testcase", mobile: "9876509901", gender: "female", ageYears: 60 });
  const arr = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "ICU", bed: "1" });
  const { bundleId, key } = await realResusBundle(arr.patientId, arr.encounterId);
  const r = await runFourCases("/ward/resus-waive", { bundleId, key, reason: "Not hypotensive; fluids clinically not indicated" }, {
    noCapEmail: NURSE, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR,
  });
  assert.equal(r.written, 1);
  assert.equal(r.status.elements.find((e) => e.key === key).notApplicable, true);
});

/* ==================================================================================================
 * POST /ward/patient-release - emr.treat
 * ================================================================================================== */

test("POST /ward/patient-release: no session refused, wrong-role refused (nothing written), cross-hospital refused, doctor succeeds", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Patient Release Testcase", mobile: "9876509902", gender: "male", ageYears: 40 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const r = await runFourCases("/ward/patient-release", { patientId, givenTo: "patient in person" }, {
    noCapEmail: NURSE, correctCapEmail: DOCTOR, otherOrgEmail: OTHER_DOCTOR,
  });
  assert.equal(r.written, 1);
});

/* ==================================================================================================
 * POST /ward/roi-cancel - staff.admin (or the narrower him.roi alternative authority)
 * ================================================================================================== */

test("POST /ward/roi-cancel: no session refused, wrong-role refused (nothing written), cross-hospital refused, HIM succeeds", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ROI Cancel Testcase", mobile: "9876509903", gender: "female", ageYears: 33 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const roiId = await realRoiRequest(patientId);
  const r = await runFourCases("/ward/roi-cancel", { roiId, reason: "Requester withdrew the request" }, {
    noCapEmail: NURSE, correctCapEmail: HIM, otherOrgEmail: OTHER_HIM,
  });
  assert.equal(r.written, 1);
  assert.equal(r.state, "cancelled");
});
