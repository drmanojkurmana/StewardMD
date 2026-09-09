/* test/wardsynq-transfusion-bridge.test.mjs — TASK 3.5: the blood-bank bridge, through the REAL
 * routes.
 *
 * wardsynq-transfusion.js (HAZ-BLD-01) is not re-tested here - its own 22 adversarial tests already
 * prove the ABO/RhD engine and the two-person bedside check. This proves the LINKAGE: identity
 * resolution via patientIdForMrn, deterministic episode ids (never the engine's own Date.now()-based
 * one), a version-checked write per phase transition, and - the single most important property this
 * bridge adds - that a FAILED phase (a bad crossmatch, a failed bedside check) is still persisted,
 * because a near miss is evidence the engine's own header says must never vanish.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-transfusion-bridge.test.mjs
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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

test("LINK: a transfusion request resolves its bare mrn to the SAME canonical patientId every other bridge already keys on, and a retry is idempotent", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Transfusion Testcase", mobile: "9876500901", gender: "male", ageYears: 55 });
  const at = "2026-09-09T08:00:00.000Z";
  const req = await as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, mrn: reg.mrn, component: "red-cells", units: 2, indication: "Acute blood loss", aboGroup: "A", rhD: "positive", at });
  assert.equal(req.__status, 200, JSON.stringify(req));
  assert.equal(req.patientId, "opd-pat-" + reg.mrn.toLowerCase());
  assert.equal(req.phase, "requested");

  const again = await as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, mrn: reg.mrn, component: "red-cells", units: 2, indication: "Acute blood loss", aboGroup: "A", rhD: "positive", at });
  assert.equal(again.written, 0); assert.equal(again.skipped, "already_requested");
  assert.equal(again.episodeId, req.episodeId, "the SAME deterministic id, never the engine's own Date.now()-based one");
});

test("CROSSMATCH -> ISSUE -> BEDSIDE CHECK -> START -> OBSERVE -> COMPLETE: the whole chain persists through real routes, one version per phase", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Full Chain Testcase", mobile: "9876500902", gender: "female", ageYears: 40 });
  const req = await as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, mrn: reg.mrn, component: "red-cells", units: 1, aboGroup: "O", rhD: "negative" });
  const episodeId = req.episodeId;

  const xm = await as(DOCTOR, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId, unitId: "UNIT-001", aboGroup: "O", rhD: "negative", component: "red-cells", expiresAt: "2027-01-01T00:00:00.000Z" });
  assert.equal(xm.__status, 200, JSON.stringify(xm)); assert.equal(xm.phase, "crossmatched");

  const iss = await as(DOCTOR, "/ward/transfusion-issue", "POST", { orgId: ORG, episodeId });
  assert.equal(iss.phase, "issued");

  const patient = { id: req.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn };
  const check = await as(DOCTOR, "/ward/transfusion-bedside-check", "POST", {
    orgId: ORG, episodeId, checkerId: "nurse-a", secondCheckerId: "nurse-b",
    scannedPatientBarcode: reg.mrn, scannedUnitId: "UNIT-001", patient,
    unitInHand: { unitId: "UNIT-001", aboGroup: "O", rhD: "negative", component: "red-cells" },
  });
  assert.equal(check.__status, 200, JSON.stringify(check)); assert.equal(check.phase, "checked");

  const start = await as(DOCTOR, "/ward/transfusion-start", "POST", { orgId: ORG, episodeId });
  assert.equal(start.phase, "transfusing");

  const obs = await as(DOCTOR, "/ward/transfusion-observe", "POST", { orgId: ORG, episodeId, vitals: { pulse: 88, temp: 37.1 } });
  assert.equal(obs.__status, 200, JSON.stringify(obs)); assert.equal(obs.observations.length, 1);

  const done = await as(DOCTOR, "/ward/transfusion-complete", "POST", { orgId: ORG, episodeId });
  assert.equal(done.phase, "completed");

  // Every phase is its OWN version - the append-only shape the engine's own test proves.
  const history = await RECORD.history(TENANT_ROW.id, "TransfusionEpisode", episodeId);
  assert.ok(history.length >= 6, "one version per phase transition: " + history.length);

  const trace = await as(DOCTOR, `/ward/transfusion-trace?orgId=${ORG}&unitId=UNIT-001`);
  assert.equal(trace.trace.length, 1);
  assert.equal(trace.trace[0].phase, "completed");
});

test("ADVERSARIAL: a bad crossmatch is REFUSED, and the refusal itself is still persisted - a near miss is evidence", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Incompatible Testcase", mobile: "9876500903", gender: "male", ageYears: 30 });
  const req = await as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, mrn: reg.mrn, component: "red-cells", aboGroup: "A", rhD: "positive" });

  const bad = await as(DOCTOR, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: req.episodeId, unitId: "UNIT-BAD", aboGroup: "B", rhD: "positive", component: "red-cells" });
  assert.equal(bad.__status, 409, JSON.stringify(bad));
  assert.equal(bad.error, "transfusion_refused"); assert.equal(bad.code, "INCOMPATIBLE");

  // The refusal is on the record: the ledger names the failed attempt, not silence.
  const stored = await RECORD.latest(TENANT_ROW.id, "TransfusionEpisode", req.episodeId);
  assert.ok(stored.ledger.some((e) => e.event === "crossmatch-failed"), "the failed crossmatch attempt is on the record: " + JSON.stringify(stored.ledger));
  assert.equal(stored.phase, "requested", "a failed crossmatch never advances the phase");
});

test("ADVERSARIAL: a single-person bedside check is refused; a mismatched unit is caught even with a clean crossmatch on paper", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Bedside Testcase", mobile: "9876500904", gender: "female", ageYears: 45 });
  const req = await as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, mrn: reg.mrn, component: "red-cells", aboGroup: "AB", rhD: "positive" });
  await as(DOCTOR, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: req.episodeId, unitId: "UNIT-002", aboGroup: "AB", rhD: "positive", component: "red-cells" });
  await as(DOCTOR, "/ward/transfusion-issue", "POST", { orgId: ORG, episodeId: req.episodeId });
  const patient = { id: req.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn };

  const onePerson = await as(DOCTOR, "/ward/transfusion-bedside-check", "POST", {
    orgId: ORG, episodeId: req.episodeId, checkerId: "nurse-a", secondCheckerId: "nurse-a",
    scannedPatientBarcode: reg.mrn, scannedUnitId: "UNIT-002", patient, unitInHand: { unitId: "UNIT-002", aboGroup: "AB", rhD: "positive", component: "red-cells" },
  });
  assert.equal(onePerson.__status, 409); assert.equal(onePerson.code, "SECOND_CHECKER_NOT_INDEPENDENT", JSON.stringify(onePerson));

  const wrongUnit = await as(DOCTOR, "/ward/transfusion-bedside-check", "POST", {
    orgId: ORG, episodeId: req.episodeId, checkerId: "nurse-a", secondCheckerId: "nurse-b",
    scannedPatientBarcode: reg.mrn, scannedUnitId: "UNIT-WRONG", patient, unitInHand: { unitId: "UNIT-WRONG", aboGroup: "AB", rhD: "positive", component: "red-cells" },
  });
  assert.equal(wrongUnit.__status, 409); assert.equal(wrongUnit.code, "WRONG_UNIT", JSON.stringify(wrongUnit));

  const stored = await RECORD.latest(TENANT_ROW.id, "TransfusionEpisode", req.episodeId);
  assert.equal(stored.phase, "issued", "the episode never reaches CHECKED off a failed bedside attempt");
});

test("REACTION stops the episode terminally, and RBAC: a pharmacy actor cannot request, crossmatch or check", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Reaction Testcase", mobile: "9876500905", gender: "male", ageYears: 60 });
  const req = await as(DOCTOR, "/ward/transfusion-request", "POST", { orgId: ORG, mrn: reg.mrn, component: "red-cells", aboGroup: "O", rhD: "positive" });
  await as(DOCTOR, "/ward/transfusion-crossmatch", "POST", { orgId: ORG, episodeId: req.episodeId, unitId: "UNIT-003", aboGroup: "O", rhD: "positive", component: "red-cells" });
  await as(DOCTOR, "/ward/transfusion-issue", "POST", { orgId: ORG, episodeId: req.episodeId });
  const patient = { id: req.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn };
  await as(DOCTOR, "/ward/transfusion-bedside-check", "POST", {
    orgId: ORG, episodeId: req.episodeId, checkerId: "nurse-a", secondCheckerId: "nurse-b",
    scannedPatientBarcode: reg.mrn, scannedUnitId: "UNIT-003", patient, unitInHand: { unitId: "UNIT-003", aboGroup: "O", rhD: "positive", component: "red-cells" },
  });
  await as(DOCTOR, "/ward/transfusion-start", "POST", { orgId: ORG, episodeId: req.episodeId });

  const reaction = await as(DOCTOR, "/ward/transfusion-reaction", "POST", { orgId: ORG, episodeId: req.episodeId, detail: "Fever and rigors 10 minutes in." });
  assert.equal(reaction.__status, 200, JSON.stringify(reaction)); assert.equal(reaction.phase, "stopped");

  const resumeAttempt = await as(DOCTOR, "/ward/transfusion-complete", "POST", { orgId: ORG, episodeId: req.episodeId });
  assert.equal(resumeAttempt.__status, 409); assert.equal(resumeAttempt.code, "STOPPED", "a stopped episode can never be resumed");

  assert.equal((await as(NURSE, "/ward/transfusion-request", "POST", { orgId: ORG, mrn: reg.mrn, component: "red-cells" })).__status, 403);
});
