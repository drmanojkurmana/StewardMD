/* test/wardsynq-chart-completion-bridge.test.mjs — TASK 4.11: chart completion through the REAL
 * route, reading real ClinicalNote/CriticalResultLoop/MedicationReconciliation/PatientConsent rows
 * via MemoryRepository directly (the same seeding style test/wardsynq-roi-bridge.test.mjs uses),
 * proving the aggregation itself, not just that the route is wired.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-chart-completion-bridge.test.mjs
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
const DOCTOR = "doctor@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };
const RULES = {
  "unsigned-notes": { responsibleRole: "author", dueAfterHours: 12, escalateAfterHours: 24 },
  "result-acknowledgement": { responsibleRole: "doctor" },
  "medication-reconciliation": { responsibleRole: "pharmacist", dueAfterHours: 12 },
  "consent": { responsibleRole: "nurse", requiredScopes: ["treatment"] },
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(DOCTOR), createdAt: 1, wardsynq: { chartCompletion: RULES } }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("chart completion: an old-config-free org gets an empty queue - nothing invented", async () => {
  seedHospital();
  docs.get(`q_orgs/${ORG}`).fields.wardsynq = {};
  const r = await as(DOCTOR, `/ward/completion-queue?orgId=${ORG}&patientId=pat-1`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.items, [], "no rules configured means nothing is flagged, not a default checklist");
});

test("chart completion: unsigned note, open critical loop, undecided reconciliation, missing consent all surface, sorted escalate-first", async () => {
  seedHospital();
  const patientId = "pat-cc-1";
  const nowIso = new Date().toISOString();
  const oldIso = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(); // 3 days ago: escalates

  await RECORD.append(TENANT_ROW.id, [
    { resourceType: "ClinicalNote", id: "note-1", version: 1, patientId, authorId: idFor(DOCTOR), noteType: "Progress", submittedBy: idFor(DOCTOR), submittedAt: oldIso },
    { resourceType: "CriticalResultLoop", id: "loop-1", version: 1, patientId, code: "K", display: "Potassium", state: "open", basis: "limit", reportedAt: nowIso },
    { resourceType: "MedicationReconciliation", id: "rec-1", version: 1, patientId, stage: "admission", startedAt: nowIso, medicines: [{ key: "m1", decision: "undecided" }] },
  ]);

  const r = await as(DOCTOR, `/ward/completion-queue?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const types = r.items.map((i) => i.type);
  assert.ok(types.includes("unsigned-notes"), JSON.stringify(r.items));
  assert.ok(types.includes("result-acknowledgement"), JSON.stringify(r.items));
  assert.ok(types.includes("medication-reconciliation"), JSON.stringify(r.items));
  assert.ok(types.includes("consent"), "no PatientConsent for the required treatment scope was ever recorded: " + JSON.stringify(r.items));

  const unsigned = r.items.filter((i) => i.type === "unsigned-notes")[0];
  assert.equal(unsigned.escalation.level, "escalate", "submitted 3 days ago against a 24h due rule must have escalated");
  assert.equal(unsigned.responsibleRole, "author");

  const consent = r.items.filter((i) => i.type === "consent")[0];
  assert.equal(consent.detail, "Consent (treatment) not recorded");

  // Escalated items sort first.
  assert.equal(r.items[0].escalation.level, "escalate");
});

test("chart completion: recording the consent and signing the note both clear their own deficiencies", async () => {
  seedHospital();
  const patientId = "pat-cc-2";
  await RECORD.append(TENANT_ROW.id, [
    { resourceType: "ClinicalNote", id: "note-2", version: 1, patientId, authorId: idFor(DOCTOR), noteType: "Progress", submittedBy: idFor(DOCTOR), submittedAt: new Date().toISOString(), signedBy: idFor(DOCTOR), signedAt: new Date().toISOString() },
    { resourceType: "PatientConsent", id: "consent-treatment", version: 1, patientId, scope: "treatment", decision: "granted", givenBy: "patient", recordedBy: idFor(DOCTOR), recordedAt: new Date().toISOString() },
  ]);
  const r = await as(DOCTOR, `/ward/completion-queue?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.items.filter((i) => i.type === "unsigned-notes").length, 0, "a signed note is not a deficiency");
  assert.equal(r.items.filter((i) => i.type === "consent").length, 0, "a granted consent for the required scope is not a deficiency");
});
