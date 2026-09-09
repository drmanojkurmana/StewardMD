/* test/wardsynq-incidents-bridge.test.mjs — TASK 5.14: wardsynq-incidents.js's engine, reached from
 * the record. The engine's own severity/RCA/CAPA/close rules are proven in
 * test/wardsynq-incidents.test.mjs; this proves the route wiring - persistence, capability gating,
 * append-only version history, and the anonymity guarantee surviving the wire.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-incidents-bridge.test.mjs
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
const DOCTOR = "doctor@example.test";
const SAFETY_OFFICER = "safety@example.test";
const NURSE = "nurse@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(SAFETY_OFFICER), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(NURSE))}`, { fields: { orgId: ORG, identity: idFor(NURSE), role: "nurse", active: true }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(SAFETY_OFFICER))}`, { fields: { orgId: ORG, identity: idFor(SAFETY_OFFICER), role: "safety_officer", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("a nurse can file a named incident; a bare description with no severity is refused", async () => {
  seedHospital();
  const bad = await as(NURSE, "/ward/incident-report", "POST", { orgId: ORG, what: "" });
  assert.equal(bad.__status, 422, JSON.stringify(bad));

  const r = await as(NURSE, "/ward/incident-report", "POST", { orgId: ORG, what: "Wrong-patient wristband scanned at bedside, caught before the dose", severity: "near-miss" });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.incident.state, "reported");
  assert.equal(r.incident.severity, "near-miss");
  assert.ok(r.incident.reportedBy, "a named report carries the filing actor");
});

test("an anonymous report carries no reporter, even through the wire", async () => {
  seedHospital();
  const r = await as(NURSE, "/ward/incident-report", "POST", { orgId: ORG, what: "Med room left unlocked overnight, found by the next shift", severity: "no-harm", anonymous: true });
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.incident.anonymous, true);
  assert.equal(r.incident.reportedBy, null, "anonymity is not defeated by backfilling the submitting actor");
});

test("a doctor cannot triage, RCA or close - INCIDENT_REPORT does not carry INCIDENT_INVESTIGATE", async () => {
  seedHospital();
  const filed = await as(DOCTOR, "/ward/incident-report", "POST", { orgId: ORG, what: "Delayed critical potassium escalation, patient stable", severity: "no-harm" });
  assert.equal(filed.__status, 200, JSON.stringify(filed));

  const triage = await as(DOCTOR, "/ward/incident-triage", "POST", { orgId: ORG, incidentId: filed.incident.id, likelihood: "possible", triagedBy: "Dr Test" });
  assert.equal(triage.__status, 403, JSON.stringify(triage));

  const log = await as(DOCTOR, "/ward/incident-log?orgId=" + ORG, "GET");
  assert.equal(log.__status, 403, JSON.stringify(log), "the ledger itself is investigator-only, not reporter-visible");
});

test("full lifecycle: report -> triage -> RCA -> CAPA -> close, each a real new version", async () => {
  seedHospital();
  const filed = await as(NURSE, "/ward/incident-report", "POST", { orgId: ORG, what: "Insulin given at the wrong rate, caught on the second check", severity: "minor" });
  assert.equal(filed.__status, 200, JSON.stringify(filed));
  const id = filed.incident.id;

  const badRCA = await as(SAFETY_OFFICER, "/ward/incident-rca", "POST", { orgId: ORG, incidentId: id, rootCause: "Nurse forgot to double-check the rate", conductedBy: "Safety Officer" });
  assert.equal(badRCA.__status, 409, JSON.stringify(badRCA), "the engine's own refusal (person-as-root-cause) surfaces through the wire");

  const triaged = await as(SAFETY_OFFICER, "/ward/incident-triage", "POST", { orgId: ORG, incidentId: id, likelihood: "possible", triagedBy: "Safety Officer" });
  assert.equal(triaged.__status, 200, JSON.stringify(triaged));
  assert.equal(triaged.incident.state, "triaged");
  assert.ok(triaged.incident.version > filed.incident.version, "triage is a NEW version, not a rewrite");

  const rca = await as(SAFETY_OFFICER, "/ward/incident-rca", "POST", { orgId: ORG, incidentId: id, rootCause: "The infusion pump's rate-entry screen defaults to mL/hr with no unit label visible at the bedside", conductedBy: "Safety Officer" });
  assert.equal(rca.__status, 200, JSON.stringify(rca));
  assert.equal(rca.incident.state, "investigating");

  const weakCapa = await as(SAFETY_OFFICER, "/ward/incident-capa", "POST", { orgId: ORG, incidentId: id, action: "Retrain staff on the pump", owner: "Nurse Educator", dueBy: "2026-10-01" });
  assert.equal(weakCapa.__status, 200, JSON.stringify(weakCapa));
  assert.equal(weakCapa.result.weak, true);
  const weakCapaId = weakCapa.result.id;

  const closeAttempt = await as(SAFETY_OFFICER, "/ward/incident-close", "POST", { orgId: ORG, incidentId: id, by: "Safety Officer" });
  assert.equal(closeAttempt.__status, 409, JSON.stringify(closeAttempt), "cannot close on education-only actions, and the wire surfaces exactly that refusal");

  const strongCapa = await as(SAFETY_OFFICER, "/ward/incident-capa", "POST", { orgId: ORG, incidentId: id, action: "Reconfigure the pump's rate-entry screen to show the unit at all times", owner: "Biomed", dueBy: "2026-10-15", strength: "SIMPLIFICATION" });
  assert.equal(strongCapa.__status, 200, JSON.stringify(strongCapa));
  const capaId = strongCapa.result.id;

  const stillOpen = await as(SAFETY_OFFICER, "/ward/incident-close", "POST", { orgId: ORG, incidentId: id, by: "Safety Officer" });
  assert.equal(stillOpen.__status, 409, JSON.stringify(stillOpen), "open CAPAs still block close");

  const completed = await as(SAFETY_OFFICER, "/ward/incident-capa-complete", "POST", { orgId: ORG, incidentId: id, capaId, by: "Biomed", evidence: "Screen updated fleet-wide, photo on file" });
  assert.equal(completed.__status, 200, JSON.stringify(completed));
  // The weak CAPA is a real action too, even though it alone could not close the incident - it
  // still has to be either dropped as a plan or completed like any other. Completed here so the
  // final close proves "no OPEN actions", not "we quietly forgot about the weak one".
  const weakCompleted = await as(SAFETY_OFFICER, "/ward/incident-capa-complete", "POST", { orgId: ORG, incidentId: id, capaId: weakCapaId, by: "Nurse Educator", evidence: "Session run, attendance on file" });
  assert.equal(weakCompleted.__status, 200, JSON.stringify(weakCompleted));

  const closed = await as(SAFETY_OFFICER, "/ward/incident-close", "POST", { orgId: ORG, incidentId: id, by: "Safety Officer" });
  assert.equal(closed.__status, 200, JSON.stringify(closed));
  assert.equal(closed.incident.state, "closed");

  const log = await as(SAFETY_OFFICER, "/ward/incident-log?orgId=" + ORG, "GET");
  assert.equal(log.__status, 200, JSON.stringify(log));
  assert.equal(log.incidents.length, 1);
  assert.equal(log.incidents[0].state, "closed");
  assert.ok(log.health, "the reporting-health ledger rides along");
});

test("a SAC-1/2 incident cannot close without an RCA, surfaced through the wire", async () => {
  seedHospital();
  const filed = await as(NURSE, "/ward/incident-report", "POST", { orgId: ORG, what: "Wrong blood product started, reaction observed", severity: "major" });
  const triaged = await as(SAFETY_OFFICER, "/ward/incident-triage", "POST", { orgId: ORG, incidentId: filed.incident.id, likelihood: "likely", triagedBy: "Safety Officer" });
  assert.equal(triaged.__status, 200, JSON.stringify(triaged));
  assert.ok(triaged.incident.sac.rcaRequired, "this severity/likelihood combination must require RCA for the test to prove anything");

  const closeAttempt = await as(SAFETY_OFFICER, "/ward/incident-close", "POST", { orgId: ORG, incidentId: filed.incident.id, by: "Safety Officer" });
  assert.equal(closeAttempt.__status, 409, JSON.stringify(closeAttempt));
  assert.equal(closeAttempt.error, "NO_RCA");
});

test("an unknown incident id is refused, not silently reported as empty", async () => {
  seedHospital();
  const r = await as(SAFETY_OFFICER, "/ward/incident-triage", "POST", { orgId: ORG, incidentId: "does-not-exist", likelihood: "possible", triagedBy: "Safety Officer" });
  assert.equal(r.__status, 404, JSON.stringify(r));
  assert.equal(r.error, "incident_not_found");
});
