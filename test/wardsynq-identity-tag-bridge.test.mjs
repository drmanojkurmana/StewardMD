/* test/wardsynq-identity-tag-bridge.test.mjs — TASK 6.14: wardsynq-identity-tag.js's engine,
 * reached from the record. The engine's own state-machine rules are proven in
 * test/wardsynq-identity-tag.test.mjs; this proves the route wiring - persistence, the
 * "never silently reassign an active tag" query, capability gating, and replace's two-write shape.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-identity-tag-bridge.test.mjs
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
const NURSE = "nurse@example.test";
const CASHIER = "cashier@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(NURSE), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(NURSE))}`, { fields: { orgId: ORG, identity: idFor(NURSE), role: "nurse", active: true }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(CASHIER))}`, { fields: { orgId: ORG, identity: idFor(CASHIER), role: "cashier", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
let n = 0;
async function registerPatient() {
  n++;
  const r = await as(NURSE, "/patient/register", "POST", { orgId: ORG, name: "Tag Testcase " + n, mobile: "98765011" + String(n).padStart(2, "0"), gender: "female", ageYears: 40 });
  return { ...r, patientId: r.wardsynq && r.wardsynq.patientId };
}

test("a cashier cannot assign a tag - EMR_VITALS only", async () => {
  seedHospital();
  const reg = await registerPatient();
  const r = await as(CASHIER, "/ward/tag-assign", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", code: "A1" });
  assert.equal(r.__status, 403, JSON.stringify(r));
});

test("assigning a tag to an unknown patient is refused", async () => {
  seedHospital();
  const r = await as(NURSE, "/ward/tag-assign", "POST", { orgId: ORG, patientId: "does-not-exist", tagType: "wristband", code: "A1" });
  assert.equal(r.__status, 404, JSON.stringify(r));
  assert.equal(r.error, "patient_not_found");
});

test("assign -> verify -> a second assign of the SAME type is refused - never a silent reassignment", async () => {
  seedHospital();
  const reg = await registerPatient();
  const first = await as(NURSE, "/ward/tag-assign", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", code: "A1-B2" });
  assert.equal(first.__status, 200, JSON.stringify(first));
  assert.equal(first.tag.status, "active");

  const ok = await as(NURSE, "/ward/tag-verify", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", scannedCode: "a1-b2" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.matches, true);
  const wrong = await as(NURSE, "/ward/tag-verify", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", scannedCode: "WRONG" });
  assert.equal(wrong.matches, false);

  const second = await as(NURSE, "/ward/tag-assign", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", code: "C3-D4" });
  assert.equal(second.__status, 409, JSON.stringify(second));
  assert.equal(second.error, "active_tag_exists");

  // A DIFFERENT type on the same patient is fine - one wristband and one QR at once is not a
  // double-assignment of the same mechanism.
  const qr = await as(NURSE, "/ward/tag-assign", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "qr", code: "QR-1" });
  assert.equal(qr.__status, 200, JSON.stringify(qr));
});

test("replaceTag ends the old tag and issues a new one through the wire, and the new one verifies", async () => {
  seedHospital();
  const reg = await registerPatient();
  const assigned = await as(NURSE, "/ward/tag-assign", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", code: "A1" });
  const replaced = await as(NURSE, "/ward/tag-replace", "POST", { orgId: ORG, tagId: assigned.tag.id, newCode: "B2", reason: "band damaged in transit" });
  assert.equal(replaced.__status, 200, JSON.stringify(replaced));
  assert.equal(replaced.old.status, "replaced");
  assert.equal(replaced.tag.status, "active");
  assert.equal(replaced.tag.replacesTagId, assigned.tag.id);

  const verifyOld = await as(NURSE, "/ward/tag-verify", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", scannedCode: "A1" });
  assert.equal(verifyOld.matches, false, "the replaced code no longer verifies");
  const verifyNew = await as(NURSE, "/ward/tag-verify", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", scannedCode: "B2" });
  assert.equal(verifyNew.matches, true);

  // Now a fresh assign of the same type is refused again - the NEW tag is the active one.
  const blocked = await as(NURSE, "/ward/tag-assign", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", code: "E5" });
  assert.equal(blocked.__status, 409, JSON.stringify(blocked));
});

test("deactivate then a fresh assign is allowed; reportLost is a distinct outcome", async () => {
  seedHospital();
  const reg = await registerPatient();
  const assigned = await as(NURSE, "/ward/tag-assign", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", code: "A1" });

  const noReason = await as(NURSE, "/ward/tag-deactivate", "POST", { orgId: ORG, tagId: assigned.tag.id });
  assert.equal(noReason.__status, 422, JSON.stringify(noReason));

  const deactivated = await as(NURSE, "/ward/tag-deactivate", "POST", { orgId: ORG, tagId: assigned.tag.id, reason: "patient discharged" });
  assert.equal(deactivated.__status, 200, JSON.stringify(deactivated));
  assert.equal(deactivated.tag.status, "deactivated");

  const fresh = await as(NURSE, "/ward/tag-assign", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", code: "F6" });
  assert.equal(fresh.__status, 200, JSON.stringify(fresh));

  const lost = await as(NURSE, "/ward/tag-lost", "POST", { orgId: ORG, tagId: fresh.tag.id, reason: "fell off during transfer" });
  assert.equal(lost.__status, 200, JSON.stringify(lost));
  assert.equal(lost.tag.status, "lost");
  assert.notEqual(lost.tag.status, "deactivated");
});

test("an unknown tag id is refused, not silently treated as absent-and-fine", async () => {
  seedHospital();
  const r = await as(NURSE, "/ward/tag-deactivate", "POST", { orgId: ORG, tagId: "does-not-exist", reason: "x-y-z" });
  assert.equal(r.__status, 404, JSON.stringify(r));
  assert.equal(r.error, "tag_not_found");
});

test("tag-log lists every tag ever issued, oldest first, active flagged separately", async () => {
  seedHospital();
  const reg = await registerPatient();
  const a1 = await as(NURSE, "/ward/tag-assign", "POST", { orgId: ORG, patientId: reg.patientId, tagType: "wristband", code: "A1" });
  await as(NURSE, "/ward/tag-replace", "POST", { orgId: ORG, tagId: a1.tag.id, newCode: "B2", reason: "damaged" });

  const log = await as(NURSE, "/ward/tag-log?orgId=" + ORG + "&patientId=" + reg.patientId, "GET");
  assert.equal(log.__status, 200, JSON.stringify(log));
  assert.equal(log.tags.length, 2);
  assert.equal(log.tags[0].code, "A1");
  assert.equal(log.tags[0].status, "replaced");
  assert.equal(log.tags[1].code, "B2");
  assert.equal(log.active.length, 1);
  assert.equal(log.active[0].code, "B2");
});
