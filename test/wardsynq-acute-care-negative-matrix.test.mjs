/* test/wardsynq-acute-care-negative-matrix.test.mjs — TASK 2.10: the mandatory negative-test list.
 *
 * The master plan requires 17 deliberate-failure scenarios proven across the acute-care system.
 * An audit before writing this file found 16 of the 17 already covered, scattered across the
 * per-department suites built in 2.1-2.9 (wardsynq-actors.test.mjs, wardsynq-mpi.test.mjs,
 * wardsynq-inpatient-emar.test.mjs, wardsynq-icu.test.mjs, wardsynq-ed.test.mjs,
 * wardsynq-safety.test.mjs, wardsynq-transfusion.test.mjs, wardsynq-surgical.test.mjs,
 * wardsynq-iomt.test.mjs, wardsynq-deterioration.test.mjs, wardsynq-record-service.test.mjs,
 * wardsynq-d1-sql.test.mjs). This file does NOT duplicate that coverage - see the TASK 2.10 report
 * for the exact file:test citation for each of the 16. It adds the ONE genuine gap the audit found:
 *
 * "wrong encounter" had no test anywhere, and probing it before writing one found a REAL,
 * previously-unknown defect: recordWardVitals() (migrate-inpatient.js, the door every ward and
 * ED vitals call goes through) never checked that the encounterId supplied actually belongs to the
 * patientId supplied. A caller could name a real encounter belonging to a DIFFERENT patient and the
 * route would silently accept and write vitals under the mismatched pair - exactly the "wrong
 * encounter" hazard this list names. Fixed in migrate-inpatient.js by resolving the encounter and
 * refusing (409 encounter_patient_mismatch) before building or writing any Observation.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-acute-care-negative-matrix.test.mjs
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
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
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

test("WRONG ENCOUNTER: vitals cannot be written under a real encounter that belongs to a DIFFERENT patient - the gap found before this task, now closed", async () => {
  seedHospital();
  const regA = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Patient A", mobile: "9876500701", gender: "male", ageYears: 40 });
  const regB = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Patient B", mobile: "9876500702", gender: "female", ageYears: 35 });
  const admB = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regB.mrn, ward: "Ward B", bed: "1" });
  const patientA = "opd-pat-" + regA.mrn.toLowerCase();

  const attack = await as(DOCTOR, "/ward/vitals", "POST", { orgId: ORG, encounterId: admB.encounterId, patientId: patientA, vitals: { sbp: "120", pulse: "80" } });
  assert.equal(attack.__status, 409, JSON.stringify(attack));
  assert.equal(attack.error, "encounter_patient_mismatch");
  assert.equal(attack.written, 0, "nothing was written under the mismatched pair");

  const obs = await RECORD.latestByType(TENANT_ROW.id, "Observation", 10);
  assert.equal(obs.length, 0, "NO Observation exists anywhere - not under A, not under B, not orphaned");

  // The correct pairing still works: B's own vitals, under B's own encounter.
  const correct = await as(DOCTOR, "/ward/vitals", "POST", { orgId: ORG, encounterId: admB.encounterId, patientId: admB.patientId, vitals: { sbp: "118", pulse: "76" } });
  assert.equal(correct.__status, 200, JSON.stringify(correct));
  assert.ok(correct.written >= 1);

  // An encounter id that does not exist at all is refused distinctly, not treated as a mismatch.
  const missing = await as(DOCTOR, "/ward/vitals", "POST", { orgId: ORG, encounterId: "wsq-adm-does-not-exist", patientId: patientA, vitals: { sbp: "100" } });
  assert.equal(missing.__status, 404); assert.equal(missing.error, "encounter_not_found");
});
