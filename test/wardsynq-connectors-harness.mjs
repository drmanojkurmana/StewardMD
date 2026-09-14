/* test/wardsynq-connectors-harness.mjs - the shared in-memory hospital for the connector tests (S2, S4, S5).
 * Not a test file itself. Import it FIRST: it installs the module mocks the router needs.
 * Two hospitals: org-wsq (admin, nurse, hr, cashier, doctor) and org-other (its own admin). */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { mock } from "node:test";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

export const docs = new Map();
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
const TENANTS = {
  "tenant-wsq": { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) },
  "tenant-other": { id: "tenant-other", name: "Other", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-other" } }) },
};
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (TENANTS[String(a[0])] ? { ...TENANTS[String(a[0])] } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async (request) => (String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").toLowerCase() === DOCTOR ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {}) }),
    recordDeps: () => ({ repository: H.RECORD, pseudonym: async (id) => "ref-" + id }),
  },
});

export const { onRequest } = await import("../functions/api/queue/[[path]].js");

export const T = "tenant-wsq", ORG_ID = "org-wsq", OTHER = "org-other";
export const ADMIN = "admin@example.test", NURSE = "nurse@example.test", HR = "hr@example.test", CASHIER = "cashier@example.test", DOCTOR = "doctor@example.test", OTHER_ADMIN = "boss@other.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const kv = new Map();
export const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_TICK_OFF: "1",
  MAIK_KV: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); } } };

export function seed(wardsynqCfg) {
  docs.clear(); clock = 1; kv.clear();
  H.RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_ID}`, { fields: { id: ORG_ID, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-wsq", ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: wardsynqCfg || {} }, updateTime: "t1" });
  docs.set(`q_orgs/${OTHER}`, { fields: { id: OTHER, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OTHER_ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [NURSE, "nurse"], [HR, "hr"], [CASHIER, "cashier"], [DOCTOR, "doctor"]]) {
    docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG_ID, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize(OTHER)}__${sanitize(idFor(OTHER_ADMIN))}`, { fields: { orgId: OTHER, identity: idFor(OTHER_ADMIN), role: "admin", active: true }, updateTime: "t1" });
}

/** A call as a staff member (null = no session). raw: send `body` as the exact text given. */
export async function as(email, path, method, body, headers) {
  const h = { ...(email ? { "Cf-Access-Authenticated-User-Email": email } : {}), ...(body != null ? { "Content-Type": "application/json" } : {}), ...(headers || {}) };
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: h, body: body == null ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) }), env: ENV, waitUntil: () => {} });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = {}; }
  j.__status = res.status; j.__text = text;
  return j;
}

export const writesNow = () => H.RECORD._rows.length + H.RECORD.audit.length;

/** Swap the global fetch for one test. */
export async function withFetch(fetchImpl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}
