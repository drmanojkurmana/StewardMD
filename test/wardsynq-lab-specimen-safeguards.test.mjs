/* test/wardsynq-lab-specimen-safeguards.test.mjs — TASK 3.1: the specimen hard safeguards, through
 * the REAL routes.
 *
 * Two safeguards added this task, both audited-first as reusing existing patterns rather than
 * inventing new ones:
 *
 * - WRONG-PATIENT COLLECTION BLOCKED: collectSpecimen() now accepts an optional
 *   scannedPatientBarcode, compared with the SAME normaliseBarcode() logic wardsynq-meds.js's
 *   five-rights scan (HAZ-MED-04) and wardsynq-transfusion.js's bedside check already use. Per the
 *   master plan, scanning is never the ONLY safeguard - the pre-existing "does this ServiceRequest
 *   exist and remain open" check is the independent second factor.
 * - DUPLICATE/REUSED ACCESSION BLOCKED BY CONSTRUCTION: accessionNumberFor() derives the accession
 *   number from the SAME deterministic specimenId every other id in this file already is, so two
 *   different specimens can never collide and re-collecting the SAME specimen never mints a second
 *   number for it - proven at the unit level in wardsynq-specimen.test.mjs; this file proves it
 *   round-trips through the real route.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-lab-specimen-safeguards.test.mjs
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

test("WRONG-PATIENT COLLECTION BLOCKED: a scanned wristband that does not match the order's own patient refuses, and nothing is written", async () => {
  seedHospital();
  const regA = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Lab Patient A", mobile: "9876500801", gender: "male", ageYears: 50 });
  const regB = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Lab Patient B", mobile: "9876500802", gender: "female", ageYears: 45 });
  const admA = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regA.mrn, ward: "Medical A", bed: "1" });
  const sr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: admA.encounterId, code: "Renal profile", category: "laboratory" });
  assert.equal(sr.__status, 200, JSON.stringify(sr));

  // A phlebotomist scans the WRONG patient's wristband against patient A's order.
  const attack = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr.orderId, specimenType: "Whole blood", scannedPatientBarcode: regB.mrn });
  assert.equal(attack.__status, 409, JSON.stringify(attack));
  assert.equal(attack.error, "wrong_patient_scan");
  assert.equal(attack.written, 0);

  const specimens = await RECORD.byPatient(TENANT_ROW.id, "SpecimenCollection", admA.patientId);
  assert.equal(specimens.length, 0, "no specimen was written for the mismatched scan");

  // The correct scan (patient A's own wristband/mrn) succeeds and carries a real accession number.
  const correct = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr.orderId, specimenType: "Whole blood", scannedPatientBarcode: regA.mrn });
  assert.equal(correct.__status, 200, JSON.stringify(correct));
  assert.match(correct.accessionNumber, /^ACC-[A-Z0-9]+$/);

  // The SAME check runs even when the order does not exist at all - the request check still fires.
  const noOrder = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: "wsq-sr-does-not-exist", specimenType: "Whole blood", scannedPatientBarcode: regA.mrn });
  assert.equal(noOrder.__status, 404); assert.equal(noOrder.error, "request_not_found");
});

test("An unscanned collection (no wristband check requested) still works and still carries a real accession number - backward compatible", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Lab Patient C", mobile: "9876500803", gender: "male", ageYears: 60 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "2" });
  const sr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Full blood count", category: "laboratory" });
  const got = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr.orderId, specimenType: "Whole blood" });
  assert.equal(got.__status, 200, JSON.stringify(got));
  assert.match(got.accessionNumber, /^ACC-[A-Z0-9]+$/);
});

test("DUPLICATE/REUSED ACCESSION BLOCKED BY CONSTRUCTION: re-collecting the SAME attempt is a no-op, never a second accession number", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Lab Patient D", mobile: "9876500804", gender: "female", ageYears: 33 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "3" });
  const sr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Liver function", category: "laboratory" });
  const first = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr.orderId, specimenType: "Whole blood", at: "2026-09-09T08:00:00.000Z" });
  const again = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr.orderId, specimenType: "Whole blood", at: "2026-09-09T08:00:00.000Z" });
  assert.equal(again.skipped, "already_collected");
  assert.equal(again.accessionNumber, first.accessionNumber, "the SAME attempt keeps the SAME accession number, not a second one");

  // A genuinely SECOND attempt (a different time) gets its OWN, different accession number.
  const second = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: sr.orderId, specimenType: "Whole blood", at: "2026-09-09T08:40:00.000Z" });
  assert.notEqual(second.accessionNumber, first.accessionNumber);
});
