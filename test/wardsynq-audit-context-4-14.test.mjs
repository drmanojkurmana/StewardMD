/* test/wardsynq-audit-context-4-14.test.mjs — TASK 4.14: correlationId/deviceId/sessionId actually
 * reach the real audit trail through a real route, and the raw staff token never does.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-audit-context-4-14.test.mjs
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
const { sessionRefOf, requestContextOf } = await import("../functions/_wardsynq/actor.js");

test("sessionRefOf: a short hash of a staff token, never the token itself; null with no token", async () => {
  const ref = await sessionRefOf("some-real-bearer-token");
  assert.equal(typeof ref, "string");
  assert.equal(ref.includes("some-real-bearer-token"), false);
  assert.equal(ref.length, 16, "8 bytes, hex-encoded");
  assert.equal(await sessionRefOf(""), null);
  assert.equal(await sessionRefOf(null), null);
});

test("requestContextOf: reads the client's own headers when present, generates a correlation id otherwise", async () => {
  const withHeaders = requestContextOf(new Request("https://x", { headers: { "X-Correlation-Id": "c1", "X-Device-Id": "d1" } }), { sessionRef: "s1" });
  assert.deepEqual(withHeaders, { correlationId: "c1", deviceId: "d1", sessionId: "s1" });
  const bare = requestContextOf(new Request("https://x"), null);
  assert.equal(bare.deviceId, null);
  assert.equal(bare.sessionId, null);
  assert.ok(bare.correlationId, "a fresh id is generated when the client sent none");
});

const ORG = "org-wsq";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(DOCTOR), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body, extraHeaders) {
  const headers = { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json", ...(extraHeaders || {}) };
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("correlationId: a client-supplied X-Correlation-Id is carried through to the real audit trail", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Audit Testcase", mobile: "9876500001", gender: "female", ageYears: 30 }, { "X-Correlation-Id": "corr-abc-123" });
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  const writes = RECORD.audit.filter((a) => a.action === "record.write");
  assert.ok(writes.length, "at least one write happened");
  assert.ok(writes.every((a) => a.scope && a.scope.request && a.scope.request.correlationId === "corr-abc-123"), "the client's own correlation id rides on every write from this request: " + JSON.stringify(writes.map((w) => w.scope && w.scope.request)));
});

test("correlationId: absent from the client, the server still stamps a fresh one - never blank", async () => {
  seedHospital();
  await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Audit Testcase 2", mobile: "9876500002", gender: "male", ageYears: 40 });
  const writes = RECORD.audit.filter((a) => a.action === "record.write");
  assert.ok(writes.length && writes.every((a) => a.scope.request.correlationId), "a correlation id is always present, generated if the client sent none");
});

test("deviceId: a client-supplied X-Device-Id reaches the audit trail; absent, it is null rather than guessed", async () => {
  seedHospital();
  await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Audit Testcase 3", mobile: "9876500003", gender: "female", ageYears: 25 }, { "X-Device-Id": "ipad-ward-3" });
  const writes = RECORD.audit.filter((a) => a.action === "record.write");
  assert.ok(writes.length && writes.every((a) => a.scope.request.deviceId === "ipad-ward-3"));

  seedHospital();
  await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Audit Testcase 4", mobile: "9876500004", gender: "male", ageYears: 25 });
  const writes2 = RECORD.audit.filter((a) => a.action === "record.write");
  assert.ok(writes2.length && writes2.every((a) => a.scope.request.deviceId === null), "no device header means null, never a fabricated id");
});

test("sessionId: a firebase-identified actor (this harness's identity kind) honestly carries no session reference, never a fabricated one", async () => {
  seedHospital();
  const first = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Session Testcase A", mobile: "9876500005", gender: "female", ageYears: 28 });
  assert.equal(first.__status, 200, JSON.stringify(first));
  const writes = RECORD.audit.filter((a) => a.action === "record.write");
  assert.ok(writes.length);
  // A firebase identity has no per-session token surfaced this far in - sessionId is honestly null,
  // never fabricated. actor.js's own sessionRefOf() covers the staff-token case with a pure unit test.
  assert.ok(writes.every((a) => a.scope.request.sessionId === null));
});
