/* test/wardsynq-emergency-mode-bridge.test.mjs — TASK 4.15: hospital emergency mode through the
 * REAL routes. Same seeding style as test/wardsynq-rbac-4-13-bridge.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-emergency-mode-bridge.test.mjs
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
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test", CASHIER = "cashier@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [DOCTOR, "doctor"], [CASHIER, "cashier"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("declare -> visible status -> deactivate -> status clears, all through real routes", async () => {
  seedHospital();

  const noReason = await as(ADMIN, "/ward/emergency-declare", "POST", { orgId: ORG, kind: "mass-casualty", reason: "short" });
  assert.equal(noReason.__status, 422, JSON.stringify(noReason));
  assert.equal(noReason.error, "reason_required");

  const declared = await as(ADMIN, "/ward/emergency-declare", "POST", {
    orgId: ORG, kind: "mass-casualty", reason: "Multi-vehicle collision, 12 casualties inbound to ED.",
    relaxations: ["triage-priority-override"], minutes: 180,
  });
  assert.equal(declared.__status, 200, JSON.stringify(declared));
  assert.equal(declared.active, true);
  assert.deepEqual(declared.relaxations, ["triage-priority-override"]);

  const doctorSees = await as(DOCTOR, `/ward/emergency-status?orgId=${ORG}`);
  assert.equal(doctorSees.__status, 200);
  assert.equal(doctorSees.any, true, "a doctor sees the same live status a banner would show");
  assert.equal(doctorSees.active[0].activationId, declared.activationId);

  const noReasonOnStandDown = await as(ADMIN, "/ward/emergency-deactivate", "POST", { orgId: ORG, activationId: declared.activationId });
  assert.equal(noReasonOnStandDown.__status, 422, JSON.stringify(noReasonOnStandDown));

  const stoodDown = await as(ADMIN, "/ward/emergency-deactivate", "POST", { orgId: ORG, activationId: declared.activationId, reason: "All casualties triaged, situation resolved." });
  assert.equal(stoodDown.__status, 200, JSON.stringify(stoodDown));
  assert.equal(stoodDown.active, false);

  const statusAfter = await as(DOCTOR, `/ward/emergency-status?orgId=${ORG}`);
  assert.equal(statusAfter.any, false, "deactivation is visible immediately, everywhere status is read");

  const log = await as(ADMIN, `/ward/emergency-log?orgId=${ORG}`);
  assert.equal(log.__status, 200);
  assert.equal(log.activations.length, 1, "a stood-down emergency stays on the record - never erased");
  assert.equal(log.activations[0].revokedBy, idFor(ADMIN));
});

test("RBAC: a doctor cannot declare or deactivate an emergency - EMERGENCY_DECLARE is admin-only", async () => {
  seedHospital();
  const attempt = await as(DOCTOR, "/ward/emergency-declare", "POST", { orgId: ORG, reason: "Testing unauthorized declaration attempt here." });
  assert.equal(attempt.__status, 403, JSON.stringify(attempt));
});

test("a ward-level declaration must name its own units - 'everywhere' is the org level, stated, not a default", async () => {
  seedHospital();
  const noUnits = await as(ADMIN, "/ward/emergency-declare", "POST", { orgId: ORG, reason: "Ward flooding, evacuating Medical A now.", scope: { level: "ward" } });
  assert.equal(noUnits.__status, 422, JSON.stringify(noUnits));
  assert.equal(noUnits.error, "scope_units_required");

  const withUnits = await as(ADMIN, "/ward/emergency-declare", "POST", { orgId: ORG, reason: "Ward flooding, evacuating Medical A now.", scope: { level: "ward", units: ["Medical A"] } });
  assert.equal(withUnits.__status, 200, JSON.stringify(withUnits));
  assert.deepEqual(withUnits.scope, { level: "ward", units: ["Medical A"] });
});

test("an emergency expires on its own without deactivation - never a silent extension", async () => {
  seedHospital();
  const declared = await as(ADMIN, "/ward/emergency-declare", "POST", { orgId: ORG, reason: "Network outage across the whole campus.", minutes: 5000 });
  assert.equal(declared.minutes, 1440, "clamped to the one-day cap, not the 5000 requested");
});
