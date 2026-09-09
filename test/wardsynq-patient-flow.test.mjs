/* test/wardsynq-patient-flow.test.mjs — TASK 4.4: the hospital-wide patient flow command center,
 * through the REAL route, against real ED/admission/discharge/bed-master data. Every count is
 * checked against a real record this test itself created - proving the plan's own requirement
 * ("every displayed state must trace back to a real source record"), not just that the endpoint
 * returns 200.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-patient-flow.test.mjs
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
const ORG_STORE = await import("../functions/_opd_org_store.js");
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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
let n = 0;
function nextMrn() { n++; return { mobile: "98765070" + String(n).padStart(2, "0") }; }

test("EVERY NUMBER TRACES BACK TO A REAL RECORD: ED arrival, admissions pending, discharge candidate, recent transfer, blocked bed", async () => {
  seedHospital();

  // ---- ED: one untriaged arrival. -----------------------------------------------------------
  const edReg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Flow ED Testcase", ...nextMrn(), gender: "male", ageYears: 44 });
  const arr = await as(DOCTOR, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: edReg.mrn, mode: "self", chiefComplaint: "Chest pain" } });
  assert.equal(arr.__status, 200, JSON.stringify(arr));

  // ---- Admission with an active medication order still open (NOT a discharge candidate). ----
  const w = await ORG_STORE.createWard(undefined, ORG, { name: "Medical A" }, "actor-1");
  await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "1" }, "actor-1");
  const openBed = await ORG_STORE.createBed(undefined, ORG, { wardId: w.id, name: "2", state: "blocked" }, "actor-1");
  const reg1 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Flow Admitted Testcase", ...nextMrn(), gender: "female", ageYears: 60 });
  const adm1 = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg1.mrn, ward: "Medical A", bed: "1" });
  assert.equal(adm1.__status, 200, JSON.stringify(adm1));
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm1.patientId, encounterId: adm1.encounterId, drug: "Amoxicillin 500mg", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "TID" } });
  assert.equal(ord.__status, 200, JSON.stringify(ord));

  // ---- A second admission with NOTHING outstanding - a real discharge candidate. ------------
  const reg2 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Flow Discharge-Ready Testcase", ...nextMrn(), gender: "male", ageYears: 50 });
  const adm2 = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg2.mrn, ward: "Medical A", bed: null });
  assert.equal(adm2.__status, 200, JSON.stringify(adm2));

  // ---- A transfer, so a REAL movedAt exists. -------------------------------------------------
  const w2 = await ORG_STORE.createWard(undefined, ORG, { name: "Medical B" }, "actor-1");
  await ORG_STORE.createBed(undefined, ORG, { wardId: w2.id, name: "1" }, "actor-1");
  const xfer = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm2.encounterId, ward: "Medical B", bed: "1" });
  assert.equal(xfer.__status, 200, JSON.stringify(xfer));

  // ---- An admission-request, waiting. --------------------------------------------------------
  const reg3 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Flow Waiting Testcase", ...nextMrn(), gender: "female", ageYears: 33 });
  const areq = await as(DOCTOR, "/ward/request-admission", "POST", { orgId: ORG, mrn: reg3.mrn, specialty: "medicine", urgency: "urgent", reason: "Community-acquired pneumonia" });
  assert.equal(areq.__status, 200, JSON.stringify(areq));

  // ---- THE COMMAND CENTER READ. --------------------------------------------------------------
  const flow = await as(DOCTOR, `/ward/patient-flow?orgId=${ORG}`);
  assert.equal(flow.__status, 200, JSON.stringify(flow));
  const f = flow.flow;

  assert.equal(f.ed.arrivals, 1, "the real ED arrival is counted");
  assert.equal(f.ed.untriaged, 1, "the arrival is untriaged, and this is stated, not silently absorbed");

  assert.equal(f.admissionsPending.waiting, 1, "the real admission-request is counted");

  assert.equal(f.beds.occupied, 2, "two real occupied beds - the two admissions with a bed assigned"); // adm1 (bed 1) + adm2's transfer (Medical B bed 1)
  assert.equal(f.beds.states.blocked, 1, "the one real blocked bed is counted, not silently absorbed into the free list");

  assert.equal(f.dischargeCandidates, 1, "exactly the ONE stay with zero open items is a discharge candidate");
  assert.equal(f.staysWithOpenItems.length, 1, "exactly the ONE stay with an active order is reported as having open items");
  assert.equal(f.staysWithOpenItems[0].encounterId, adm1.encounterId);
  assert.equal(f.staysWithOpenItems[0].openItems, 1);

  assert.equal(f.recentTransfers.length, 1, "the real transfer is a recent transfer");
  assert.equal(f.recentTransfers[0].encounterId, adm2.encounterId);
  assert.equal(f.recentTransfers[0].movedFrom.ward, "Medical A");

  // Bottlenecks are a plain ranking of the real counts above - never an invented severity.
  const kinds = f.bottlenecks.map((b) => b.kind);
  assert.ok(kinds.includes("ed_untriaged"));
  assert.ok(kinds.includes("beds_blocked"));
  assert.ok(kinds.includes("stays_with_open_items"));
  assert.ok(!("severity" in (f.bottlenecks[0] || {})), "no invented severity field - a plain count only");

  // Never a fabricated field: no expected/predicted discharge date exists anywhere in the response.
  assert.equal(JSON.stringify(f).indexOf("xpectedDischarge"), -1);
  assert.equal(JSON.stringify(f).indexOf("redictedDischarge"), -1);
});

test("RBAC: emr.view is enough to read the command center - a nurse can see it, exactly like ward metrics", async () => {
  seedHospital();
  const flow = await as(NURSE, `/ward/patient-flow?orgId=${ORG}`);
  assert.equal(flow.__status, 200, JSON.stringify(flow));
  assert.equal(flow.flow.ed.arrivals, 0);
  assert.equal(flow.flow.dischargeCandidates, 0);
});
