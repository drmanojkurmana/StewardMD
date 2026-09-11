/* test/wardsynq-scheduling-blackout.test.mjs — TASK 4.5: blackout periods, through the REAL
 * routes, against real appointment and resource bookings. Proves the one hard safeguard this task
 * added: a blackout is a REFUSAL, never an override - unlike an appointment clash (which a human
 * may deliberately overbook and say why), there is no way to book into a period the hospital has
 * declared unavailable.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-scheduling-blackout.test.mjs
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
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq", resources: [{ id: "ct-1", name: "CT Scanner 1", kind: "equipment" }] } }) };
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
const DOCTOR = "doctor@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { resources: [{ id: "ct-1", name: "CT Scanner 1", kind: "equipment" }] } }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
let n = 0;

test("a clinician blackout refuses a booking during it, and does not touch a slot outside it", async () => {
  seedHospital();
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Blackout Testcase " + n, mobile: "98765060" + String(n).padStart(2, "0"), gender: "male", ageYears: 40 });

  const block = await as(DOCTOR, "/ward/block-period", "POST", { orgId: ORG, clinicianId: "dr-smith", from: "2026-09-10T00:00:00.000Z", to: "2026-09-11T00:00:00.000Z", reason: "Annual leave" });
  assert.equal(block.__status, 200, JSON.stringify(block));

  const insideBlock = await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: reg.patientId, clinicianId: "dr-smith", startAt: "2026-09-10T10:00:00.000Z", minutes: 15 });
  assert.equal(insideBlock.__status, 409, JSON.stringify(insideBlock));
  assert.equal(insideBlock.error, "blacked_out");

  // Overbook does NOT override a blackout - there is nothing to override.
  const insideBlockOverbook = await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: reg.patientId, clinicianId: "dr-smith", startAt: "2026-09-10T10:00:00.000Z", minutes: 15, overbook: true, overbookReason: "urgent" });
  assert.equal(insideBlockOverbook.__status, 409, JSON.stringify(insideBlockOverbook));
  assert.equal(insideBlockOverbook.error, "blacked_out");

  const outsideBlock = await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: reg.patientId, clinicianId: "dr-smith", startAt: "2026-09-12T10:00:00.000Z", minutes: 15 });
  assert.equal(outsideBlock.__status, 200, JSON.stringify(outsideBlock));

  // Cancelling the blackout re-opens the period for real.
  const cancel = await as(DOCTOR, "/ward/cancel-blackout", "POST", { orgId: ORG, blackoutId: block.blackoutId });
  assert.equal(cancel.__status, 200, JSON.stringify(cancel));
  const nowBookable = await as(DOCTOR, "/ward/book", "POST", { orgId: ORG, patientId: reg.patientId, clinicianId: "dr-smith", startAt: "2026-09-10T10:00:00.000Z", minutes: 15 });
  assert.equal(nowBookable.__status, 200, JSON.stringify(nowBookable));

  const list = await as(DOCTOR, `/ward/blackouts?orgId=${ORG}&clinicianId=dr-smith`);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.blackouts.length, 0, "a cancelled blackout does not appear in the active list");
});

test("a resource blackout refuses booking it - no override exists, same as a resource clash", async () => {
  seedHospital();
  const block = await as(DOCTOR, "/ward/block-period", "POST", { orgId: ORG, resourceId: "ct-1", from: "2026-09-10T00:00:00.000Z", to: "2026-09-11T00:00:00.000Z", reason: "Scheduled maintenance" });
  assert.equal(block.__status, 200, JSON.stringify(block));

  const attempt = await as(DOCTOR, "/ward/book-resource", "POST", { orgId: ORG, resourceId: "ct-1", startAt: "2026-09-10T10:00:00.000Z", minutes: 30, purpose: "CT abdomen" });
  assert.equal(attempt.__status, 409, JSON.stringify(attempt));
  assert.equal(attempt.error, "blacked_out");

  const outside = await as(DOCTOR, "/ward/book-resource", "POST", { orgId: ORG, resourceId: "ct-1", startAt: "2026-09-12T10:00:00.000Z", minutes: 30, purpose: "CT abdomen" });
  assert.equal(outside.__status, 200, JSON.stringify(outside));
});

test("a blackout must name exactly one subject, a real period, and a reason", async () => {
  seedHospital();
  assert.equal((await as(DOCTOR, "/ward/block-period", "POST", { orgId: ORG, clinicianId: "a", resourceId: "b", from: "2026-09-10T00:00:00.000Z", to: "2026-09-11T00:00:00.000Z", reason: "x" })).error, "one_subject_only");
  assert.equal((await as(DOCTOR, "/ward/block-period", "POST", { orgId: ORG, from: "2026-09-10T00:00:00.000Z", to: "2026-09-11T00:00:00.000Z", reason: "x" })).error, "subject_required");
  assert.equal((await as(DOCTOR, "/ward/block-period", "POST", { orgId: ORG, clinicianId: "a", from: "2026-09-11T00:00:00.000Z", to: "2026-09-10T00:00:00.000Z", reason: "x" })).error, "bad_period");
  assert.equal((await as(DOCTOR, "/ward/block-period", "POST", { orgId: ORG, clinicianId: "a", from: "2026-09-10T00:00:00.000Z", to: "2026-09-11T00:00:00.000Z" })).error, "reason_required");
});
