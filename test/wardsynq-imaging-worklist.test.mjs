/* test/wardsynq-imaging-worklist.test.mjs — TASK 7.7: the modality worklist, through the REAL route.
 *
 * The mapping itself is proven in test/wardsynq-dicom-imaging.test.mjs. This file exists because a
 * pure function returning the right shape is not evidence that the ENDPOINT does: these tests call
 * onRequest -> GET /ward/imaging-worklist exactly as a client would, and check the authorisation,
 * the scoping and the honesty of what comes back.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-imaging-worklist.test.mjs
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
const TENANT = { id: "tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-a" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});


const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-a";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", LAB = "lab@example.test", CASHIER = "cashier@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

/** The hospital's own order-code to modality map, which is the ONLY thing that decides a modality. */
const MODALITY_MAP = { "CT-ABDO": "CT", "MRI-BRAIN": "MR" };

function seed(dicomConfig) {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1,
    wardsynq: { dicom: dicomConfig === undefined ? { modalityMap: MODALITY_MAP } : dicomConfig } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [LAB, "lab"], [CASHIER, "cashier"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function get(email, path) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { headers: { "Cf-Access-Authenticated-User-Email": email } }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const worklist = (email, extra) => get(email, `/ward/imaging-worklist?orgId=${ORG}${extra || ""}`);

const meta = (over) => ({ recordedAt: "2026-09-09T08:00:00.000Z", effectiveAt: "2026-09-09T08:30:00.000Z", amendedAt: null,
  source: { system: "wardsynq-native", sourceId: null, importedAt: "2026-09-09T08:00:00.000Z" }, derivedFrom: [], ...(over || {}) });

async function patient(id, mrn, name) {
  await RECORD.append(TENANT.id, [{ resourceType: "Patient", id, version: 1, mrn, name, dob: "1959-02-14", sex: "female", identifiers: [], meta: meta() }]);
  return id;
}
async function order(id, patientId, over) {
  await RECORD.append(TENANT.id, [{ resourceType: "ServiceRequest", id, version: 1, patientId, encounterId: null,
    code: "CT-ABDO", display: "CT abdomen", category: "imaging", priority: "routine", requesterId: "fb:doc", status: "active", meta: meta(), ...(over || {}) }]);
  return id;
}

/* ---- 1 ------------------------------------------------------------------------------------------ */

test("1. the route returns this hospital's pending imaging orders as DICOM-JSON worklist items", async () => {
  seed();
  await patient("pat-1", "GH-1", "Anjali Menon");
  await order("sr-1", "pat-1");
  const r = await worklist(DOCTOR);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.count, 1);
  const item = r.worklist[0];
  assert.equal(item["00100010"].Value[0], "Menon^Anjali");
  assert.equal(item["00100020"].Value[0], "GH-1");
  assert.equal(item["00080050"].Value[0], "sr-1", "the accession number is the order id the study will come back quoting");
  assert.equal(item["00400100"].Value[0]["00080060"].Value[0], "CT", "the modality came from the hospital's own map");
  assert.deepEqual(r.unmapped, []);
});

test("2. a laboratory order and a completed scan are not on it", async () => {
  seed();
  await patient("pat-1", "GH-1", "Anjali Menon");
  await order("sr-lab", "pat-1", { category: "laboratory", code: "2823-3", display: "Potassium" });
  await order("sr-done", "pat-1", { status: "completed" });
  await order("sr-live", "pat-1");
  const r = await worklist(DOCTOR);
  assert.equal(r.count, 1);
  assert.equal(r.worklist[0]["00080050"].Value[0], "sr-live");
});

test("3. an unmapped order code appears WITHOUT a modality and is counted, never given one", async () => {
  seed();
  await patient("pat-1", "GH-1", "Anjali Menon");
  await order("sr-us", "pat-1", { code: "US-ABDO", display: "Ultrasound abdomen" });
  const r = await worklist(DOCTOR);
  assert.equal(r.count, 1, "the order is still on the list - a missing map is not a missing patient");
  assert.equal(r.worklist[0]["00400100"].Value[0]["00080060"], undefined, "no modality was invented from 'Ultrasound abdomen'");
  assert.equal(r.unmapped.length, 1);
  assert.match(r.unmapped[0].reason, /no modality is mapped/);
});

test("4. a modality the DICOM standard does not define is refused in configuration, and said so", async () => {
  seed({ modalityMap: { "CT-ABDO": "SCANNER" } });
  await patient("pat-1", "GH-1", "Anjali Menon");
  await order("sr-1", "pat-1");
  const r = await worklist(DOCTOR);
  assert.equal(r.__status, 200);
  assert.equal(r.worklist[0]["00400100"].Value[0]["00080060"], undefined, "the bad mapping was not passed through to the scanner");
  assert.ok((r.configWarnings || []).some((w) => /SCANNER/.test(w)), JSON.stringify(r.configWarnings));
});

test("5. it can be asked for one patient, and answers only about that patient", async () => {
  seed();
  await patient("pat-1", "GH-1", "Anjali Menon");
  await patient("pat-2", "GH-2", "Ravi Kumar");
  await order("sr-1", "pat-1");
  await order("sr-2", "pat-2");
  const r = await worklist(DOCTOR, "&patientId=pat-2");
  assert.equal(r.count, 1);
  assert.equal(r.worklist[0]["00100020"].Value[0], "GH-2");
});

/* ---- 6: authorisation ---------------------------------------------------------------------------- */

test("6. a role with no chart access cannot read the worklist at all", async () => {
  seed();
  await patient("pat-1", "GH-1", "Anjali Menon");
  await order("sr-1", "pat-1");
  const r = await worklist(CASHIER);
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.ok(!r.worklist || !r.worklist.length);
});

test("7. an item is never emitted half-identified: an unreadable patient is skipped and COUNTED", async () => {
  seed();
  /* The order exists; the patient row does not. A worklist item with no identity is how the wrong
   * study is attached to the wrong person, so it is dropped rather than sent with blanks. */
  await order("sr-orphan", "pat-missing");
  const r = await worklist(DOCTOR);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.count, 0);
  assert.equal(r.unmapped.length, 1);
  assert.match(r.unmapped[0].reason, /patient is not readable/);
});
