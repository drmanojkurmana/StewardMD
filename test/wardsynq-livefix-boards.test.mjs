import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-livefix-boards.test.mjs — the live test of 2026-09-15 (docs/wardsynq/LIVE_TEST_2026-09-15.md),
 * LT-21 to LT-28, through the REAL router: /api/queue/ward/release-result, /ward/collect, /ward/collections,
 * /ward/pending-tests, /ward/criticals, /ward/acknowledge, /ward/imaging-worklist, /ward/report-imaging,
 * /ward/handover, /ward/handovers, /ward/nursing-task, /ward/nurse-worklist.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-livefix-boards.test.mjs
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

const { MemoryRepository, bufferReadAudits } = await import("../functions/_wardsynq/repository.js");
const { verifyAuditChain } = await import("../functions/_wardsynq/audit-chain.js");
const { resolveClinicalActor } = await import("../functions/_wardsynq/actor.js");
const { minutesSinceReported, acknowledgeCritical } = await import("../functions/_wardsynq/critical-results.js");
const { dicomDateTime } = await import("../functions/_wardsynq/dicom.js");
const { resetMemory: resetRateLimits } = await import("../functions/_wardsynq/rate-limit.js");
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

const ORG = "org-wsq", ORG2 = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", NURSE2 = "nurse2@example.test", LAB = "lab@example.test", PHARM = "pharmacy@example.test", OUTSIDER = "outsider@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  resetRateLimits();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  // Another hospital, whose own staff member must get nothing from this one.
  docs.set(`q_orgs/${ORG2}`, { fields: { id: ORG2, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody2", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [NURSE2, "nurse"], [LAB, "lab"], [PHARM, "pharmacy"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize(ORG2)}__${sanitize(idFor(OUTSIDER))}`, { fields: { orgId: ORG2, identity: idFor(OUTSIDER), role: "doctor", active: true }, updateTime: "t1" });
}

async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

let bed = 0;
async function admitted(name) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name, mobile: "98765" + String(10000 + (++bed)), gender: "female", ageYears: 52 });
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: String(bed) });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { reg, adm };
}
const order = (encounterId, code, category) => as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId, code, category });
const types = async (type, patientId) => RECORD.byPatient(TENANT_ROW.id, type, patientId);

/* ---- LT-25 ------------------------------------------------------------------------------------------------ */

test("LT-25: POST /api/queue/ward/release-result refuses an uncollected (or only failed) specimen with 409 and writes nothing; imaging is never asked", async () => {
  seedHospital();
  const { adm } = await admitted("Test Patient QA-01");
  const cbc = await order(adm.encounterId, "Full blood count", "laboratory");
  const rel = () => as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: cbc.orderId, status: "final", tests: [{ test: "Haemoglobin", value: 5.2, unit: "g/dL" }] });

  const refused = await rel();
  assert.equal(refused.__status, 409, JSON.stringify(refused));
  assert.equal(refused.error, "specimen_not_collected");
  assert.equal(refused.collection, "none");
  assert.equal(refused.written, 0);
  assert.equal((await types("DiagnosticReport", adm.patientId)).length, 0, "no report written");
  assert.equal((await types("Observation", adm.patientId)).filter((o) => o.category === "laboratory").length, 0, "no value written");
  assert.equal((await types("CriticalResultLoop", adm.patientId)).length, 0, "no critical loop for a result that was never released");

  // A collection whose only attempt failed still has no sample.
  const got = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: cbc.orderId, specimenType: "Whole blood" });
  assert.equal((await as(LAB, "/ward/specimen-outcome", "POST", { orgId: ORG, specimenId: got.specimenId, state: "failed", failureReason: "haemolysed" })).__status, 200);
  const again = await rel();
  assert.equal(again.__status, 409);
  assert.equal(again.collection, "failed");

  // Imaging: acquired, not collected. The radiology report path is untouched.
  const cxr = await order(adm.encounterId, "Chest X-ray PA view", "imaging");
  assert.equal((await as(LAB, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: cxr.orderId, specimenType: "Whole blood" })).error, "not_a_specimen_order");
  const rep = await as(LAB, "/ward/report-imaging", "POST", { orgId: ORG, serviceRequestId: cxr.orderId, modality: "CR", status: "final", findings: "Clear lungs.", impression: "Normal." });
  assert.equal(rep.__status, 200, JSON.stringify(rep));
});

test("LT-25: the laboratory collects from its own board, then releases; the specimen moves collected -> received and leaves every awaiting list", async () => {
  seedHospital();
  const { adm } = await admitted("Test Patient QA-02");
  const cbc = await order(adm.encounterId, "Full blood count", "laboratory");
  const board = async () => {
    const [c, p] = await Promise.all([as(LAB, `/ward/collections?orgId=${ORG}&scope=hospital`), as(LAB, `/ward/pending-tests?orgId=${ORG}&scope=hospital`)]);
    return { coll: (c.requests || []).find((r) => r.serviceRequestId === cbc.orderId), pending: (p.pending || []).some((r) => r.serviceRequestId === cbc.orderId) };
  };
  assert.equal((await board()).coll.collection.state, "none");

  const collected = await as(LAB, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: cbc.orderId, specimenType: "Whole blood" });
  assert.equal(collected.__status, 200, "the laboratory board's Collect: " + JSON.stringify(collected));
  const b1 = await board();
  assert.equal(b1.coll.collection.state, "collected");
  assert.equal(b1.coll.collection.by, idFor(LAB), "who collected travels to the board");
  assert.ok(b1.coll.collection.at, "and when");

  const rel = await as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: cbc.orderId, status: "final", tests: [{ test: "Haemoglobin", value: 12.1, unit: "g/dL" }] });
  assert.equal(rel.__status, 200, JSON.stringify(rel));
  const spec = (await types("SpecimenCollection", adm.patientId))[0];
  assert.equal(spec.state, "received");
  assert.equal(spec.receivedBy, idFor(LAB));
  assert.equal(spec.receivedOnRelease, true, "said plainly that receipt was recorded by the release");
  // The release closes the order (R5-2), so it leaves the collection board altogether; the specimen
  // record above still says who received it and when.
  const b2 = await board();
  assert.equal(b2.coll, undefined, "off the board once the order is finished, not awaiting collection or in transit");
  assert.equal(b2.pending, false, "not awaiting a result");
});

test("LT-25: negative authorization on POST /api/queue/ward/collect: no session 401, pharmacy 403, another hospital 403, nothing written", async () => {
  seedHospital();
  const { adm } = await admitted("Test Patient QA-03");
  const cbc = await order(adm.encounterId, "Urea and electrolytes", "laboratory");
  const body = { orgId: ORG, serviceRequestId: cbc.orderId, specimenType: "Serum" };
  assert.equal((await as(null, "/ward/collect", "POST", body)).__status, 401);
  assert.equal((await as(PHARM, "/ward/collect", "POST", body)).__status, 403);
  assert.equal((await as(OUTSIDER, "/ward/collect", "POST", body)).__status, 403);
  assert.equal((await types("SpecimenCollection", adm.patientId)).length, 0, "nothing written by any refused caller");
  assert.equal((await as(LAB, "/ward/collect", "POST", body)).__status, 200, "the laboratory itself may");
});

/* ---- LT-26 / LT-28 ------------------------------------------------------------------------------------------ */

test("LT-26/LT-28: GET /api/queue/ward/criticals?names=1 names patient, ward and bed; minutes since reported survive acknowledgement; the acknowledger is a name; `open` is unacknowledged only", async () => {
  seedHospital();
  const { adm, reg } = await admitted("Test Patient QA-04");
  const k = await order(adm.encounterId, "Potassium", "laboratory");
  await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: k.orderId, specimenType: "Serum" });
  const reportedAt = new Date(Date.now() - 95 * 60000).toISOString();
  const rel = await as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: k.orderId, status: "final", reportedAt, tests: [{ test: "Potassium", value: 7.2, unit: "mmol/L" }] });
  assert.equal(rel.__status, 200, JSON.stringify(rel));

  const before = await as(DOCTOR, `/ward/criticals?orgId=${ORG}&names=1`);
  assert.equal(before.__status, 200, JSON.stringify(before));
  const loop = before.loops.find((l) => l.patientId === adm.patientId);
  assert.ok(loop, JSON.stringify(before));
  assert.deepEqual({ name: loop.patient.name, mrn: loop.patient.mrn, ward: loop.patient.ward, bed: loop.patient.bed }, { name: "Test Patient QA-04", mrn: reg.mrn, ward: "Medical A", bed: String(bed) });
  assert.ok(loop.minutesSinceReported >= 94 && loop.minutesSinceReported <= 96, String(loop.minutesSinceReported));
  assert.equal(before.open, 1);

  const ack = await as(DOCTOR, "/ward/acknowledge", "POST", { orgId: ORG, loopId: loop.loopId, action: "Repeated K, started insulin-dextrose" });
  assert.equal(ack.__status, 200, JSON.stringify(ack));
  assert.equal(ack.acknowledgedByName, "Dr Test", "the acknowledger's name, not a sign-in uid");
  const after = await as(DOCTOR, `/ward/criticals?orgId=${ORG}&names=1`);
  const acked = after.loops.find((l) => l.loopId === loop.loopId);
  assert.equal(acked.state, "acknowledged");
  assert.ok(acked.minutesSinceReported >= 94, "acknowledging does not reset the time since reported: " + acked.minutesSinceReported);
  assert.equal(acked.escalation.minutesOpen, 0, "escalation stops, which is what minutesOpen is for");
  assert.equal(after.open, 0, "one definition of open: not acknowledged");
  assert.equal((await as(DOCTOR, `/ward/criticals?orgId=${ORG}&state=open`)).loops.length, after.open, "the Map tile's count and the boards' count agree");

  // Negative authorization on the named read.
  assert.equal((await as(null, `/ward/criticals?orgId=${ORG}&names=1`)).__status, 401);
  assert.equal((await as(OUTSIDER, `/ward/criticals?orgId=${ORG}&names=1`)).__status, 403);
  assert.equal((await as(LAB, `/ward/criticals?orgId=${ORG}&names=1`)).__status, 403, "the laboratory does not read the ward's list");
});

test("LT-28: minutesSinceReported is the report's clock whatever the state; a legacy acknowledgement keeps no invented name", async () => {
  const now = Date.parse("2026-09-15T12:00:00.000Z");
  assert.equal(minutesSinceReported({ state: "acknowledged", reportedAt: "2026-09-11T19:52:00.000Z" }, now), 5288);
  assert.equal(minutesSinceReported({ state: "open" }, now), null);
  const repo = new MemoryRepository();
  await repo.append("t", [{ resourceType: "CriticalResultLoop", id: "l1", version: 1, patientId: "p", state: "acknowledged", acknowledgedBy: "fb:uid", acknowledgedAt: "2026-09-13T00:00:00.000Z", reportedAt: "2026-09-12T00:00:00.000Z" }]);
  const deps = { recordDeps: { repository: repo, pseudonym: async () => null }, migration: { mode: "live", tenantId: "t" },
    actorDeps: { db: { prepare: () => ({ bind: () => ({ first: async () => ({ id: "t" }) }) }) }, identifyFn: async () => ({ id: "fb:second", name: "Second Doctor" }), claimsFn: async () => ({}), orgForTenant: async () => ({ id: "o" }), authorizeOrg: async () => ({ ok: true, role: "doctor" }) } };
  const r = await acknowledgeCritical(new Request("https://x/"), {}, { ...deps, loopId: "l1", action: "second note" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.acknowledgedBy, "fb:uid", "the first acknowledgement stands");
  assert.equal(r.acknowledgedByName, null, "a name is never borrowed from the second person");
});

/* ---- LT-27 -------------------------------------------------------------------------------------------------- */

test("LT-27: DICOM start time is the hospital's wall clock with TimezoneOffsetFromUTC; a date of birth is never shifted", () => {
  assert.deepEqual(dicomDateTime("2026-09-15T15:36:00.000Z", { offsetMinutes: 330 }), { date: "20260915", time: "210600", offset: "+0530" });
  assert.deepEqual(dicomDateTime("2026-09-15T20:00:00.000Z", { offsetMinutes: 330 }), { date: "20260916", time: "013000", offset: "+0530" }, "the local date rolls over");
  assert.deepEqual(dicomDateTime("2026-01-15T15:00:00.000Z", { timeZone: "America/New_York" }), { date: "20260115", time: "100000", offset: "-0500" });
  assert.deepEqual(dicomDateTime("1959-02-14", { offsetMinutes: 330 }), { date: "19590214", time: null });
});

test("LT-27: GET /api/queue/ward/imaging-worklist carries the offset, and a FINAL report takes the study off (a preliminary one does not)", async () => {
  seedHospital();
  const { adm } = await admitted("Test Patient QA-05");
  const cxr = await order(adm.encounterId, "Chest X-ray PA view", "imaging");
  const ct = await order(adm.encounterId, "CT head", "imaging");
  const list = async () => (await as(DOCTOR, `/ward/imaging-worklist?orgId=${ORG}`));
  const w0 = await list();
  assert.equal(w0.__status, 200, JSON.stringify(w0));
  const item = w0.worklist.find((i) => i["00080050"].Value[0] === cxr.orderId);
  assert.equal(item["00080201"].Value[0], "+0530");
  const sr = (await types("ServiceRequest", adm.patientId)).find((s) => s.id === cxr.orderId);
  const wall = new Date(Date.parse(sr.meta.effectiveAt) + 330 * 60000).toISOString();
  assert.equal(item["00400100"].Value[0]["00400003"].Value[0], wall.slice(11, 13) + wall.slice(14, 16) + wall.slice(17, 19), "local time, not UTC digits");

  assert.equal((await as(LAB, "/ward/report-imaging", "POST", { orgId: ORG, serviceRequestId: cxr.orderId, modality: "CR", status: "final", findings: "Clear.", impression: "Normal." })).__status, 200);
  assert.equal((await as(LAB, "/ward/report-imaging", "POST", { orgId: ORG, serviceRequestId: ct.orderId, modality: "CT", status: "preliminary", findings: "No bleed on first look." })).__status, 200);
  const w1 = await list();
  const ids = w1.worklist.map((i) => i["00080050"].Value[0]);
  assert.ok(!ids.includes(cxr.orderId), "a finally reported study is not still requested");
  assert.ok(ids.includes(ct.orderId), "a preliminary reading still owes the final one");
  // A finally reported study's order is closed (R5-2), so the worklist never reads it; only studies
  // still open and already reported count here, and a preliminary read leaves the order open.
  assert.equal(w1.reportedExcluded, 0);
});

/* ---- LT-22 / LT-23 ------------------------------------------------------------------------------------------ */

test("LT-22/LT-23: POST /api/queue/ward/handover from the chart and GET /ward/handovers name the patient and the staff; negative authorization", async () => {
  seedHospital();
  const { adm, reg } = await admitted("Test Patient QA-06");
  const body = { orgId: ORG, encounterId: adm.encounterId, sbar: { situation: "Day 2 pneumonia, stable", recommendation: "Repeat CRP" } };
  assert.equal((await as(null, "/ward/handover", "POST", body)).__status, 401);
  assert.equal((await as(PHARM, "/ward/handover", "POST", body)).__status, 403);
  assert.equal((await as(OUTSIDER, "/ward/handover", "POST", body)).__status, 403);
  assert.equal((await types("ShiftHandover", adm.patientId)).length, 0, "nothing written by a refused caller");

  const given = await as(NURSE, "/ward/handover", "POST", body);
  assert.equal(given.__status, 200, JSON.stringify(given));
  assert.equal(given.givenByName, NURSE, "the sign-in's own name (here the email), beside the id");
  const list = await as(NURSE2, `/ward/handovers?orgId=${ORG}`);
  const h = list.handovers.find((x) => x.handoverId === given.handoverId);
  assert.deepEqual(h.patient, { name: "Test Patient QA-06", mrn: reg.mrn, ward: "Medical A", bed: String(bed) });
  const taken = await as(NURSE2, "/ward/receive-handover", "POST", { orgId: ORG, handoverId: given.handoverId });
  assert.equal(taken.receivedByName, NURSE2);
  assert.equal(taken.givenByName, NURSE, "the giver's name is kept on the taken version");
  assert.equal((await as(null, `/ward/handovers?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(OUTSIDER, `/ward/handovers?orgId=${ORG}`)).__status, 403);
});

test("LT-23: POST /api/queue/ward/nursing-task from the chart: no session 401, pharmacy 403, another hospital 403, nurse 200", async () => {
  seedHospital();
  const { adm } = await admitted("Test Patient QA-07");
  const body = { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, title: "Turn every 2 hours", dueAt: new Date(Date.now() + 3600e3).toISOString() };
  assert.equal((await as(null, "/ward/nursing-task", "POST", body)).__status, 401);
  assert.equal((await as(PHARM, "/ward/nursing-task", "POST", body)).__status, 403);
  assert.equal((await as(OUTSIDER, "/ward/nursing-task", "POST", body)).__status, 403);
  assert.equal((await types("NursingTask", adm.patientId)).length, 0);
  const ok = await as(NURSE, "/ward/nursing-task", "POST", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
});

/* ---- LT-21 -------------------------------------------------------------------------------------------------- */

test("LT-21: GET /api/queue/ward/nurse-worklist lists EVERY admitted patient (no silent 60 cap), and every read is still audited", async () => {
  seedHospital();
  const T = TENANT_ROW.id, N = 65;
  const recs = [];
  for (let i = 1; i <= N; i++) {
    recs.push({ resourceType: "Patient", id: `pat-lt21-${i}`, version: 1, patientId: `pat-lt21-${i}`, name: `Worklist Patient ${i}`, mrn: `LT21-${i}` });
    recs.push({ resourceType: "Encounter", id: `enc-lt21-${i}`, version: 1, patientId: `pat-lt21-${i}`, class: "IPD", status: "in-progress", location: { ward: "Medical A", bed: String(i) }, periodStart: "2026-09-15T00:00:00.000Z" });
  }
  await RECORD.append(T, recs);
  const auditBefore = RECORD.audit.length;
  // What made it slow: one chain step (lock, head, write) per read. Count them.
  let single = 0, batches = 0;
  const one = RECORD.auditOnly.bind(RECORD), many = RECORD.auditMany.bind(RECORD);
  RECORD.auditOnly = async (...a) => { single += 1; return one(...a); };
  RECORD.auditMany = async (...a) => { batches += 1; return many(...a); };
  const w = await as(NURSE, `/ward/nurse-worklist?orgId=${ORG}`);
  const readRows = RECORD.audit.length - auditBefore;
  assert.ok(readRows > 5 * N, "hundreds of audited reads: " + readRows);
  assert.ok(single + batches <= Math.ceil(readRows / 40) + 2, `chain steps ${single} single + ${batches} batched for ${readRows} rows`);
  assert.equal(w.__status, 200, JSON.stringify(w).slice(0, 300));
  assert.equal(w.rows.length, N, "all patients, not the first 60");
  assert.equal(w.total, N);
  assert.equal(w.partial, false);
  assert.ok(w.rows.some((r) => r.patientId === `pat-lt21-${N}`), "the newest admission is on it");
  const reads = RECORD.audit.slice(auditBefore).filter((e) => e.action === "record.read");
  assert.ok(reads.filter((e) => e.scope && e.scope.resourceType === "MedicationAdministration").length >= N, "one dose read per patient, each audited before the answer");
  assert.equal((await verifyAuditChain(RECORD, T)).status, "ok", "the batched rows are on the hash chain intact");
  assert.equal((await as(PHARM, `/ward/nurse-worklist?orgId=${ORG}`)).__status, 403);
});

test("LT-21: bufferReadAudits holds read rows until flush and writes them all, chained; the repository's own state is used", async () => {
  const repo = new MemoryRepository();
  const { repository, flush } = bufferReadAudits(repo);
  await repository.append("t", [{ resourceType: "Patient", id: "p1", version: 1, patientId: "p1", name: "A" }]);
  assert.equal((await repository.latest("t", "Patient", "p1")).name, "A", "reads and writes reach the real store");
  for (let i = 0; i < 95; i++) await repository.auditOnly("t", { ts: new Date().toISOString(), actor: "a", action: "record.read", scope: { i } });
  assert.equal(repo.audit.length, 0, "held, not yet written");
  assert.equal(await flush(), 95);
  assert.equal(repo.audit.length, 95);
  assert.deepEqual(repo.audit.map((e) => e.scope.i), [...Array(95).keys()], "in the order they were read");
  assert.equal((await verifyAuditChain(repo, "t")).status, "ok");
});

test("LT-21: resolveClinicalActor answers once per request, not once per call", async () => {
  let calls = 0;
  const deps = { db: { prepare: () => ({ bind: () => ({ first: async () => ({ id: "t" }) }) }) }, identifyFn: async () => ({ id: "u1", email: "u1@x" }), claimsFn: async () => ({}),
    orgForTenant: async () => ({ id: "o" }), authorizeOrg: async () => { calls += 1; return { ok: true, role: "nurse" }; } };
  const req = new Request("https://x/");
  const [a, b] = await Promise.all([resolveClinicalActor(req, {}, "t", "record:read", deps), resolveClinicalActor(req, {}, "t", "record:read", deps)]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  await resolveClinicalActor(new Request("https://x/"), {}, "t", "record:read", deps);
  assert.equal(calls, 2, "a new request asks again");
});
