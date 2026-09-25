import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-support-harness.mjs - the in-memory hospital for the support-services route tests (diet, CSSD,
 * housekeeping, ambulance, mortuary). Not a test file. Import it FIRST: it installs the module mocks the router needs.
 * Two hospitals: org-wsq (every role below) and org-other (its own admin). Wards and beds live in the mocked
 * Firestore, patients and stays are admitted through the real routes. */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { mock } from "node:test";
import assert from "node:assert/strict";
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
export const DOCTOR = "doctor@example.test";
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
export const ADMIN = "admin@example.test", NURSE = "nurse@example.test", HR = "hr@example.test", CASHIER = "cashier@example.test",
  DIETITIAN = "dietitian@example.test", KITCHEN = "kitchen@example.test", CSSD = "cssd@example.test", HOUSEKEEPER = "housekeeper@example.test",
  HOUSEKEEPER2 = "housekeeper2@example.test", SUPERVISOR = "supervisor@example.test", TRANSPORT = "transport@example.test",
  MORTUARY = "mortuary@example.test", OTHER_ADMIN = "boss@other.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
export const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const kv = new Map();
export const ENV = { QUEUE_ENABLED: "1", CLINIC_BILLING_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb, WSQ_TICK_OFF: "1",
  MAIK_KV: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); } } };

export const SUPPORT_CFG = { mealTimes: { breakfast: "07:30", lunch: "12:30", tea: "16:00", dinner: "19:30" }, mortuaryChambers: ["C1", "C2"], housekeepingInspection: true };

export function seed(supportServices) {
  docs.clear(); clock = 1; kv.clear(); admittedCount = 0;
  H.RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG_ID}`, { fields: { id: ORG_ID, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-wsq", ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: { supportServices: supportServices === undefined ? SUPPORT_CFG : supportServices } }, updateTime: "t1" });
  docs.set(`q_orgs/${OTHER}`, { fields: { id: OTHER, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: idFor(OTHER_ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [NURSE, "nurse"], [HR, "hr"], [CASHIER, "cashier"], [DOCTOR, "doctor"], [DIETITIAN, "dietitian"], [KITCHEN, "kitchen"],
    [CSSD, "cssd"], [HOUSEKEEPER, "housekeeping"], [HOUSEKEEPER2, "housekeeping"], [SUPERVISOR, "supervisor"], [TRANSPORT, "transport"], [MORTUARY, "mortuary"]]) {
    docs.set(`q_members/${sanitize(ORG_ID)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG_ID, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize(OTHER)}__${sanitize(idFor(OTHER_ADMIN))}`, { fields: { orgId: OTHER, identity: idFor(OTHER_ADMIN), role: "admin", active: true }, updateTime: "t1" });
  docs.set("q_wards/w-med", { fields: { id: "w-med", orgId: ORG_ID, name: "Medical A", code: "MA", type: "general", active: true }, updateTime: "t1" });
  for (let i = 1; i <= 6; i++) docs.set(`q_beds/b-${i}`, { fields: { id: `b-${i}`, orgId: ORG_ID, wardId: "w-med", name: String(i), state: "available", active: true }, updateTime: "t1" });
}

/** A call as a staff member (null = no session). */
export async function as(email, path, method, body) {
  const h = { ...(email ? { "Cf-Access-Authenticated-User-Email": email } : {}), ...(body != null ? { "Content-Type": "application/json" } : {}) };
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: h, body: body == null ? undefined : JSON.stringify(body) }), env: ENV, waitUntil: () => {} });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

export const writesNow = () => H.RECORD._rows.length;

let admittedCount = 0;
/** Registers and admits a patient to Medical A, bed n. */
export async function admitted() {
  admittedCount++;
  const n = admittedCount;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG_ID, name: "Support Patient " + n, mobile: "98765229" + String(n).padStart(2, "0"), gender: "male", ageYears: 60 });
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG_ID, mrn: reg.mrn, ward: "Medical A", bed: String(n), admittedAt: "2026-09-15T08:00:00.000Z" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { mrn: reg.mrn, patientId: adm.patientId, encounterId: adm.encounterId, bed: String(n) };
}

/** The four refusals every support route owes: no session 401, wrong role 403 with nothing written, another hospital refused. */
export async function refusals(path, method, body, wrongRole, forbidden403 = [403]) {
  const q = method === "GET" ? (path.includes("?") ? "&" : "?") + "orgId=" + ORG_ID : "";
  const b = method === "GET" ? null : { orgId: ORG_ID, ...(body || {}) };
  const before = writesNow();
  const none = await as(null, path + q, method, b);
  assert.equal(none.__status, 401, path + " without a session: " + JSON.stringify(none));
  const wrong = await as(wrongRole, path + q, method, b);
  assert.ok(forbidden403.includes(wrong.__status), path + " as the wrong role: " + wrong.__status + " " + JSON.stringify(wrong));
  // An administrator of another hospital naming this one.
  const other = await as(OTHER_ADMIN, path + q, method, b);
  assert.ok([403, 404].includes(other.__status), path + " from another hospital: " + other.__status);
  assert.equal(writesNow(), before, path + ": nothing written by a refused call");
}
