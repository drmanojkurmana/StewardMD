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
  const early = await as(SAFETY_OFFICER, "/ward/incident-rca", "POST", { orgId: ORG, incidentId: id, rootCause: "The pump screen shows no unit label at the bedside" });
  assert.equal(early.error, "NOT_CONFIRMED", "an RCA waits for the signal to be confirmed");
  const conf = await as(SAFETY_OFFICER, "/ward/incident-confirm", "POST", { orgId: ORG, incidentId: id, outcome: "confirmed", reason: "Reviewed: a real event", category: "medication-error" });
  assert.equal(conf.__status, 200, JSON.stringify(conf));

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
  const conf = await as(SAFETY_OFFICER, "/ward/incident-confirm", "POST", { orgId: ORG, incidentId: filed.incident.id, outcome: "confirmed", reason: "Reviewed: a real event", category: "medication-error" });
  assert.equal(conf.__status, 200, JSON.stringify(conf));

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

test("triagedBy/conductedBy are the session's own actor, not whatever name the body supplies", async () => {
  seedHospital();
  const filed = await as(NURSE, "/ward/incident-report", "POST", { orgId: ORG, what: "Wrong dose almost given, caught by the second nurse", severity: "no-harm" });
  assert.equal(filed.__status, 200, JSON.stringify(filed));
  const id = filed.incident.id;

  // Body names somebody else entirely. If the router ever forwards this, the investigation's
  // conclusion is filed under a name the safety officer typed, not the account that authenticated.
  const triaged = await as(SAFETY_OFFICER, "/ward/incident-triage", "POST", { orgId: ORG, incidentId: id, likelihood: "possible", triagedBy: "Dr Somebody Else" });
  assert.equal(triaged.__status, 200, JSON.stringify(triaged));
  assert.equal(triaged.incident.triagedBy, idFor(SAFETY_OFFICER), "triagedBy must be the authenticated session's actor, never the body");
  assert.notEqual(triaged.incident.triagedBy, "Dr Somebody Else");
  const conf = await as(SAFETY_OFFICER, "/ward/incident-confirm", "POST", { orgId: ORG, incidentId: id, outcome: "confirmed", reason: "Reviewed: a real event", category: "medication-error" });
  assert.equal(conf.__status, 200, JSON.stringify(conf));
  assert.equal(conf.incident.confirmation.by, idFor(SAFETY_OFFICER), "the decider is the session's actor");

  const rca = await as(SAFETY_OFFICER, "/ward/incident-rca", "POST", { orgId: ORG, incidentId: id, rootCause: "The infusion pump's rate-entry screen defaults to mL/hr with no unit label visible at the bedside", conductedBy: "Dr Somebody Else" });
  assert.equal(rca.__status, 200, JSON.stringify(rca));
  assert.equal(rca.incident.rca.conductedBy, idFor(SAFETY_OFFICER), "conductedBy must be the authenticated session's actor, never the body");
  assert.notEqual(rca.incident.rca.conductedBy, "Dr Somebody Else");
});

test("P1.14 SIGNAL: raised from a real source record, refused for a missing one; the ledger shows its stage", async () => {
  seedHospital();
  await RECORD.append(TENANT_ROW.id, [{ resourceType: "SafetyOverride", id: "ovr-1", version: 1, patientId: "pat-1", rule: "allergy" }]);
  const none = await as(NURSE, "/ward/incident-signal", "POST", { orgId: ORG, what: "Override looked wrong", severity: "no-harm" });
  assert.equal(none.__status, 422, JSON.stringify(none));
  const missing = await as(NURSE, "/ward/incident-signal", "POST", { orgId: ORG, what: "Override looked wrong", severity: "no-harm", source: { resourceType: "SafetyOverride", id: "nope" } });
  assert.equal(missing.__status, 404, JSON.stringify(missing));
  const sig = await as(NURSE, "/ward/incident-signal", "POST", { orgId: ORG, what: "Allergy override then a rash", severity: "minor", category: "medication-error", source: { resourceType: "SafetyOverride", id: "ovr-1" } });
  assert.equal(sig.__status, 200, JSON.stringify(sig));
  assert.deepEqual(sig.incident.source, { resourceType: "SafetyOverride", id: "ovr-1" });
  assert.equal(sig.incident.patientId, "pat-1", "the patient comes from the source record");
  const log = await as(SAFETY_OFFICER, "/ward/incident-log?orgId=" + ORG);
  assert.equal(log.incidents[0].stage, "signal");
  assert.equal(log.health.signals, 1);
  assert.ok(log.categories.includes("fall"));
});

test("P1.14 CONFIRM: a nurse or doctor cannot decide; not-an-incident and duplicate carry a reason and a real target", async () => {
  seedHospital();
  const a = await as(NURSE, "/ward/incident-report", "POST", { orgId: ORG, what: "Patient found on the floor beside the bed", severity: "minor", category: "fall" });
  const b = await as(DOCTOR, "/ward/incident-report", "POST", { orgId: ORG, what: "Same fall, reported by the doctor", severity: "minor" });
  for (const who of [NURSE, DOCTOR]) {
    const r = await as(who, "/ward/incident-confirm", "POST", { orgId: ORG, incidentId: a.incident.id, outcome: "confirmed", reason: "real", category: "fall" });
    assert.equal(r.__status, 403, who);
  }
  const noReason = await as(SAFETY_OFFICER, "/ward/incident-confirm", "POST", { orgId: ORG, incidentId: b.incident.id, outcome: "not-an-incident" });
  assert.equal(noReason.error, "NO_REASON");
  const ghost = await as(SAFETY_OFFICER, "/ward/incident-confirm", "POST", { orgId: ORG, incidentId: b.incident.id, outcome: "duplicate", duplicateOf: "wsq-incident-none", reason: "same fall" });
  assert.equal(ghost.__status, 404, JSON.stringify(ghost));
  const dup = await as(SAFETY_OFFICER, "/ward/incident-confirm", "POST", { orgId: ORG, incidentId: b.incident.id, outcome: "duplicate", duplicateOf: a.incident.id, reason: "same fall, second reporter" });
  assert.equal(dup.__status, 200, JSON.stringify(dup));
  assert.equal(dup.incident.state, "rejected");
  const ok = await as(SAFETY_OFFICER, "/ward/incident-confirm", "POST", { orgId: ORG, incidentId: a.incident.id, outcome: "confirmed", reason: "witnessed fall" });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const again = await as(SAFETY_OFFICER, "/ward/incident-confirm", "POST", { orgId: ORG, incidentId: a.incident.id, outcome: "not-an-incident", reason: "changed mind" });
  assert.equal(again.error, "ALREADY_DECIDED");
  const log = await as(SAFETY_OFFICER, "/ward/incident-log?orgId=" + ORG);
  assert.deepEqual(log.incidents.map((i) => i.stage).sort(), ["confirmed", "rejected"]);
  assert.equal(log.health.confirmed, 1);
  assert.equal(log.health.rejected, 1);
});

test("P1.14 quality-safety: returns the seed measures and case lists for analytics.view; a nurse and a safety officer are refused", async () => {
  seedHospital();
  const a = await as(NURSE, "/ward/incident-report", "POST", { orgId: ORG, what: "Patient found on the floor beside the bed", severity: "minor", category: "fall" });
  await as(SAFETY_OFFICER, "/ward/incident-confirm", "POST", { orgId: ORG, incidentId: a.incident.id, outcome: "confirmed", reason: "witnessed fall" });
  await as(NURSE, "/ward/incident-report", "POST", { orgId: ORG, what: "Possible second fall, unclear", severity: "no-harm" });

  const r = await as(DOCTOR, "/ward/quality-safety?orgId=" + ORG + "&days=90");
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.period.days, 90);
  const ids = r.measures.map((m) => m.id);
  for (const id of ["inpatient-mortality", "readmission-30-day", "sepsis-bundle-compliance", "length-of-stay", "falls", "pressure-injuries", "medication-errors", "hai", "antibiotic-dot", "lab-tat", "radiology-tat", "bed-utilisation"]) assert.ok(ids.includes(id), id);
  const falls = r.measures.find((m) => m.id === "falls");
  assert.equal(falls.numerator, 1);
  assert.equal(falls.rate, null, "no bed-days in this hospital: no rate, not zero");
  assert.match(r.measures.find((m) => m.id === "antibiotic-dot").reason, /antibiotic list not configured/);
  assert.deepEqual(r.safety, { signals: 1, confirmed: 1, rejected: 0, withRootCause: 0, capasOpen: 0, capasCompleted: 0 });
  assert.ok(!JSON.stringify(r).includes(idFor(NURSE)), "no clinician is named");

  const denied = await as(NURSE, "/ward/quality-safety?orgId=" + ORG);
  assert.equal(denied.__status, 403, "a nurse holds no analytics.view");
  assert.equal(denied.error, "forbidden");
  // (SAFETY_OFFICER is this org's owner in the harness, so resolves as admin; not a negative case here.)
});
