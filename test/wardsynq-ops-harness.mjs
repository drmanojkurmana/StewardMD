/* test/wardsynq-ops-harness.mjs - the real router over an in-memory hospital, for the stores, assets and blood bank
 * route tests. Same shape as test/wardsynq-billing-reports-livefix.test.mjs: Firestore and the record deps are mocked,
 * everything between the request and the record (authorization, capability map, modules, RecordService) is real.
 * Import it FIRST in a test file run with --experimental-test-module-mocks. */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { mock } from "node:test";
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
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
export const H = { RECORD: new MemoryRepository() };
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
export const TENANT = TENANT_ROW.id;
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
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: H.RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

export const ORG = "org-wsq", ORG2 = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
export const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
export const U = {
  ADMIN: "admin@example.test", DOCTOR: "doctor@example.test", NURSE: "nurse@example.test", NURSE2: "nurse2@example.test",
  INCHARGE: "incharge@example.test", INCHARGE_OTHER: "incharge2@example.test", STORE: "store@example.test",
  ENGINEER: "engineer@example.test", BLOOD: "blood@example.test", BLOOD2: "blood2@example.test", HR: "hr@example.test", PHARMACY: "pharmacy@example.test", CASHIER: "cashier@example.test",
};
const ENV = { QUEUE_ENABLED: "1", CLINIC_BILLING_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

export function seedHospital() {
  docs.clear(); clock = 1;
  H.RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(U.ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG2}`, { fields: { id: ORG2, code: "SMD-OTHER1", name: "Another Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "someone-else", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set("q_departments/dept-med", { fields: { orgId: ORG, name: "General Medicine", code: "MED", active: true }, updateTime: "t1" });
  docs.set("q_departments/dept-sur", { fields: { orgId: ORG, name: "Surgery", code: "SUR", active: true }, updateTime: "t1" });
  const members = [
    [U.DOCTOR, "doctor"], [U.NURSE, "nurse", ["dept-med"]], [U.NURSE2, "nurse", ["dept-med"]], [U.INCHARGE, "supervisor", ["dept-med"]],
    [U.INCHARGE_OTHER, "supervisor", ["dept-sur"]], [U.STORE, "store_keeper"], [U.ENGINEER, "biomedical_engineer"],
    [U.BLOOD, "blood_bank"], [U.BLOOD2, "blood_bank"], [U.HR, "hr"], [U.PHARMACY, "pharmacy"], [U.CASHIER, "cashier"],
  ];
  for (const [email, role, depts] of members) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true, ...(depts ? { scope: { departments: depts } } : {}) }, updateTime: "t1" });
  }
}

export async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

/** The latest version of every record of a type in the hospital's tenant. */
export async function recordsOf(type) {
  return (await H.RECORD.latestByType(TENANT, type, 1000)) || [];
}
/** The audit rows written for a record type. */
export function auditsOf(type) {
  return (H.RECORD.audit || []).filter((e) => JSON.stringify(e).includes(`"resourceType":"${type}"`));
}
