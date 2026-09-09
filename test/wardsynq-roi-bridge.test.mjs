/* test/wardsynq-roi-bridge.test.mjs — TASK 4.9: HIM/ROI through the REAL routes.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-roi-bridge.test.mjs
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
const DOCTOR = "doctor@example.test", HIM = "him@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  // TASK 4.9's own header explains why HIM is the org owner in this test: no dedicated HIM
  // capability exists in this codebase, and granting staff.admin (the "hr" role's own capability)
  // any record scope would break this test suite's existing "HR has no business on the chart"
  // guarantee. Today, ROI is reachable only by whoever already holds unrestricted clinical write
  // (in practice, the org owner/admin) - a real, stated limitation, not a role invented here.
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(HIM), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"]]) {
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

test("HIM: request -> authorize -> fulfill, a real disclosure log with real counts, never the values", async () => {
  seedHospital();
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ROI Testcase " + n, mobile: "98765100" + String(n).padStart(2, "0"), gender: "female", ageYears: 45 });

  const req = await as(HIM, "/ward/roi-request", "POST", {
    orgId: ORG, patientId: reg.patientId,
    requester: { name: "Jane Advocate", organization: "Advocate & Co", relationship: "attorney" },
    purpose: "Personal injury litigation", recipient: "jane@advocateco.example",
    scope: { recordTypes: ["DiagnosticReport"], from: "2026-01-01", to: "2026-09-01" },
  });
  assert.equal(req.__status, 200, JSON.stringify(req));
  assert.equal(req.state, "requested");
  const roiId = req.roiId;

  const noBasis = await as(HIM, "/ward/roi-authorize", "POST", { orgId: ORG, roiId });
  assert.equal(noBasis.__status, 409, JSON.stringify(noBasis));
  assert.equal(noBasis.code, "AUTHORIZATION_BASIS_REQUIRED");

  const authorized = await as(HIM, "/ward/roi-authorize", "POST", { orgId: ORG, roiId, authorizationBasis: "Signed patient authorization on file, ref #4471" });
  assert.equal(authorized.__status, 200, JSON.stringify(authorized));
  assert.equal(authorized.state, "authorized");

  const fulfilled = await as(HIM, "/ward/roi-fulfill", "POST", { orgId: ORG, roiId, deliveredStatus: "emailed", resourceCounts: { DiagnosticReport: 3 } });
  assert.equal(fulfilled.__status, 200, JSON.stringify(fulfilled));
  assert.equal(fulfilled.state, "fulfilled");
  assert.equal(fulfilled.disclosure.deliveredStatus, "emailed");
  assert.deepEqual(fulfilled.disclosure.resourceCounts, { DiagnosticReport: 3 });
  assert.equal(JSON.stringify(fulfilled.disclosure).length < 300, true, "the disclosure log is a receipt - counts and a status, not a copy of any clinical value");

  const read = await as(HIM, `/ward/roi?orgId=${ORG}&roiId=${roiId}`);
  assert.equal(read.__status, 200, JSON.stringify(read));
  assert.equal(read.roi.state, "fulfilled");

  const forPatient = await as(HIM, `/ward/roi-requests?orgId=${ORG}&patientId=${reg.patientId}`);
  assert.equal(forPatient.__status, 200, JSON.stringify(forPatient));
  assert.equal(forPatient.requests.length, 1);
  assert.equal(forPatient.shareExternalConsent.status, "not-recorded", "no consent was ever recorded for this patient - stated honestly, never assumed granted");
});

test("a denied request stays on the record; RBAC: a doctor holds no HIM authority for ROI at all", async () => {
  seedHospital();
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ROI RBAC Testcase " + n, mobile: "98765101" + String(n).padStart(2, "0"), gender: "male", ageYears: 30 });

  assert.equal((await as(DOCTOR, "/ward/roi-request", "POST", { orgId: ORG, patientId: reg.patientId, requester: { name: "X" }, purpose: "x", recipient: "x", scope: { recordTypes: ["DiagnosticReport"] } })).__status, 403, "a doctor holds emr.treat, not staff.admin - no HIM authority here");

  const req = await as(HIM, "/ward/roi-request", "POST", { orgId: ORG, patientId: reg.patientId, requester: { name: "General Hospital Records Dept", relationship: "other-provider" }, purpose: "Continuity of care", recipient: "records@generalhospital.example", scope: { recordTypes: ["DiagnosticReport"] } });
  const denied = await as(HIM, "/ward/roi-deny", "POST", { orgId: ORG, roiId: req.roiId, reason: "No authorization provided by the requester" });
  assert.equal(denied.__status, 200, JSON.stringify(denied));
  assert.equal(denied.state, "denied");

  const stillThere = await as(HIM, `/ward/roi-requests?orgId=${ORG}&patientId=${reg.patientId}`);
  assert.equal(stillThere.requests.length, 1, "a denied request stays on the record - requested and refused is a different history from never asked");
  assert.equal(stillThere.requests[0].state, "denied");
});
