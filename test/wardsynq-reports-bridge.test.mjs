/* test/wardsynq-reports-bridge.test.mjs — TASK 4.12: hospital reports through the REAL routes,
 * seeding real Invoice/Claim/MedicationDispense/MedicationOrder/ROIRequest rows via MemoryRepository
 * directly (the same style test/wardsynq-roi-bridge.test.mjs and
 * test/wardsynq-chart-completion-bridge.test.mjs already use).
 *
 * node --test --experimental-test-module-mocks test/wardsynq-reports-bridge.test.mjs
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
const ADMIN = "admin@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(ADMIN))}`, { fields: { orgId: ORG, identity: idFor(ADMIN), role: "admin", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

function envelopeOk(r) {
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.ok(Array.isArray(r.dataSource) && r.dataSource.length, "dataSource stated: " + JSON.stringify(r));
  assert.ok(r.period && Object.prototype.hasOwnProperty.call(r.period, "from"), "period stated: " + JSON.stringify(r));
  assert.ok(r.generatedAt, "generatedAt stated: " + JSON.stringify(r));
  assert.ok(r.scope && r.scope.role, "permission scope stated: " + JSON.stringify(r));
}

test("billing report: sums real invoices, never presents an estimate", async () => {
  seedHospital();
  await RECORD.append(TENANT_ROW.id, [
    { resourceType: "Invoice", id: "inv-1", version: 1, patientId: "p1", currency: "INR",
      events: [{ kind: "raised", amount: 0, actorId: idFor(ADMIN), at: "2026-09-01T00:00:00.000Z" }, { kind: "payment", amount: 300, actorId: idFor(ADMIN), at: "2026-09-01T01:00:00.000Z" }],
      lines: [{ code: "CONSULT", display: "Consultation", quantity: 1, amount: 500, line: 500 }] },
  ]);
  const r = await as(ADMIN, `/ward/report-billing?orgId=${ORG}`);
  envelopeOk(r);
  assert.equal(r.invoiceCount, 1);
  assert.equal(r.charged, 500);
  assert.equal(r.collected, 300);
  assert.equal(r.outstanding, 200);
});

test("claims report: counts real claims by state, sums outstanding submitted amounts only", async () => {
  seedHospital();
  await RECORD.append(TENANT_ROW.id, [
    { resourceType: "Claim", id: "claim-1", version: 1, patientId: "p1", state: "submitted", submittedAmount: 1000, submittedAt: "2026-09-01T00:00:00.000Z" },
    { resourceType: "Claim", id: "claim-2", version: 1, patientId: "p2", state: "denied", submittedAmount: 500, deniedAmount: 500, submittedAt: "2026-09-01T00:00:00.000Z" },
    { resourceType: "Claim", id: "claim-3", version: 1, patientId: "p3", state: "paid", submittedAmount: 700, approvedAmount: 700, submittedAt: "2026-09-01T00:00:00.000Z" },
  ]);
  const r = await as(ADMIN, `/ward/report-claims?orgId=${ORG}`);
  envelopeOk(r);
  assert.equal(r.claimCount, 3);
  assert.equal(r.submitted, 1);
  assert.equal(r.denied, 1);
  assert.equal(r.approved, 1);
  assert.equal(r.outstandingAmount, 1000, "only the still-submitted claim counts as outstanding, never the denied or paid one");
});

test("pharmacy report: real dispense volume and pending-verification count, reusing stockLevels unchanged", async () => {
  seedHospital();
  await RECORD.append(TENANT_ROW.id, [
    { resourceType: "MedicationOrder", id: "order-1", version: 1, patientId: "p1", drug: "Amoxicillin", status: "active" },
    { resourceType: "MedicationDispense", id: "disp-1", version: 1, patientId: "p1", orderId: "order-1", drug: "Amoxicillin", quantity: 30, state: "issued", dispensedAt: "2026-09-01T00:00:00.000Z" },
  ]);
  const r = await as(ADMIN, `/ward/report-pharmacy?orgId=${ORG}`);
  envelopeOk(r);
  assert.equal(r.dispenseCount, 1);
  assert.equal(r.dispenseVolume.Amoxicillin, 30);
  assert.equal(r.pendingVerification, 1, "the active order with no MedicationVerification row is pending");
  assert.ok(Array.isArray(r.stock), "stockLevels() is reused unchanged: " + JSON.stringify(r.stock));
});

test("HIM report: counts a real incomplete chart and a real ROI request by state", async () => {
  seedHospital();
  docs.get(`q_orgs/${ORG}`).fields.wardsynq = { chartCompletion: { "unsigned-notes": { responsibleRole: "author" } } };
  await RECORD.append(TENANT_ROW.id, [
    { resourceType: "Encounter", id: "enc-1", version: 1, patientId: "p1", class: "IPD", status: "in-progress" },
    { resourceType: "ClinicalNote", id: "note-1", version: 1, patientId: "p1", authorId: idFor(ADMIN), noteType: "Progress", submittedBy: idFor(ADMIN), submittedAt: "2026-09-01T00:00:00.000Z" },
    { resourceType: "ROIRequest", id: "roi-1", version: 1, patientId: "p1", state: "fulfilled" },
  ]);
  const r = await as(ADMIN, `/ward/report-him?orgId=${ORG}`);
  envelopeOk(r);
  assert.equal(r.incompleteCharts, 1);
  assert.equal(r.incompleteBy["unsigned-notes"], 1);
  assert.equal(r.roiRequests.fulfilled, 1);
  assert.equal(r.disclosures, 1, "a fulfilled ROI request IS the disclosure - no second construct");
});

test("patient-flow and clinical-operations reports wrap the existing live queues with the envelope", async () => {
  seedHospital();
  const flow = await as(ADMIN, `/ward/report-patient-flow?orgId=${ORG}`);
  envelopeOk(flow);
  assert.ok(flow.flow, "the real patientFlow() body is still present: " + JSON.stringify(flow));

  const ops = await as(ADMIN, `/ward/report-clinical-operations?orgId=${ORG}`);
  envelopeOk(ops);
  assert.ok(ops.metrics, "the real wardMetrics() body is still present: " + JSON.stringify(ops));
});
