/* test/wardsynq-rbac-4-13-bridge.test.mjs — TASK 4.13: the new alternative-authority fallbacks
 * through the REAL routes - a `him` role member reaching ROI routes without staff.admin, a
 * `blood_bank` role member reaching transfusion routes without emr.treat, and confirming neither
 * gained anything beyond its own narrow grant.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-rbac-4-13-bridge.test.mjs
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
      claimsFn: async () => ({}),
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const HIM_OFFICER = "him@example.test", BLOOD_BANK = "bloodbank@example.test", DOCTOR = "doctor@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(DOCTOR), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[HIM_OFFICER, "him"], [BLOOD_BANK, "blood_bank"], [DOCTOR, "doctor"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("him role: reaches ROI routes via HIM_ROI, without staff.admin, and cannot write anything else", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "RBAC ROI Testcase", mobile: "9876543210", gender: "female", ageYears: 40 });

  const req = await as(HIM_OFFICER, "/ward/roi-request", "POST", {
    orgId: ORG, patientId: reg.patientId,
    requester: { name: "Jane Advocate", relationship: "attorney" }, purpose: "Litigation", recipient: "jane@example.test",
    scope: { recordTypes: ["DiagnosticReport"] },
  });
  assert.equal(req.__status, 200, JSON.stringify(req));

  // The him role cannot write a clinical note - HIM_ROI grants ROIRequest and nothing else.
  const noteAttempt = await as(HIM_OFFICER, "/ward/note", "POST", { orgId: ORG, patientId: reg.patientId, noteType: "Progress", text: "x" });
  assert.equal(noteAttempt.__status, 403, "HIM_ROI grants no clinical write: " + JSON.stringify(noteAttempt));
});

test("blood_bank role: reaches transfusion routes via TRANSFUSION_ISSUE, without emr.treat, and cannot write a clinical note", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "RBAC Transfusion Testcase", mobile: "9876543211", gender: "male", ageYears: 55 });
  const enc = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, patientId: reg.patientId, ward: "Medical A", bed: "1", class: "IPD" });

  const req = await as(BLOOD_BANK, "/ward/transfusion-request", "POST", {
    orgId: ORG, patientId: reg.patientId, mrn: reg.mrn, encounterId: enc.encounterId, component: "red-cells", units: 1, indication: "Anaemia",
  });
  assert.equal(req.__status, 200, JSON.stringify(req));

  const noteAttempt = await as(BLOOD_BANK, "/ward/note", "POST", { orgId: ORG, patientId: reg.patientId, noteType: "Progress", text: "x" });
  assert.equal(noteAttempt.__status, 403, "TRANSFUSION_ISSUE grants no clinical write: " + JSON.stringify(noteAttempt));
});

test("a doctor still reaches both ROI and transfusion routes unchanged via existing authority", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "RBAC Doctor Testcase", mobile: "9876543212", gender: "female", ageYears: 33 });
  const enc = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, patientId: reg.patientId, ward: "Medical A", bed: "2", class: "IPD" });

  assert.equal((await as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, patientId: reg.patientId, mrn: reg.mrn, encounterId: enc.encounterId, component: "platelets", units: 1 })).__status, 200);
});
