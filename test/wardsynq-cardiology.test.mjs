/* test/wardsynq-cardiology.test.mjs — the KardiQ X bridge, through the REAL routes.
 *
 * KardiQ X is not rebuilt: this proves the LINKAGE (resolving a bare mrn to the real canonical
 * patientId, the same identity discipline every other bridge already keeps), the ECG reference
 * bolt-on (KardiQ X's own AI verdict/HEART/TIMI scores recorded, never recomputed), the
 * unvalidated:true provenance flag reflecting KardiQ X's self-declared clinically-unvalidated
 * regulatory status, and the longitudinal timeline proving the record is no longer disconnected.
 * No new Encounter.class - cardiology maps onto the existing OPD/DAYCARE/SURGERY/PACU/IPD, unchanged.
 *
 * Same harness shape as wardsynq-oncology.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-cardiology.test.mjs
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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"]]) {
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

test("LINK: a KardiQ X record resolves its bare mrn to the SAME canonical patientId every other bridge already keys on", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Cardiology Testcase", mobile: "9876500501", gender: "male", ageYears: 62 });
  const link = await as(DOCTOR, "/ward/cardio-link", "POST", { orgId: ORG, link: { kardioxRecordId: "kx-rec-001", mrn: reg.mrn } });
  assert.equal(link.__status, 200, JSON.stringify(link));
  const record = await RECORD.latest(TENANT_ROW.id, "CardiologyLink", link.linkId);
  assert.equal(record.patientId, "opd-pat-" + reg.mrn.toLowerCase());
  assert.equal(record.kardioxRecordId, "kx-rec-001"); assert.equal(record.mrn, reg.mrn);

  const got = await as(DOCTOR, `/ward/cardio-link-get?orgId=${ORG}&patientId=${record.patientId}`);
  assert.equal(got.links.length, 1); assert.equal(got.links[0].kardioxRecordId, "kx-rec-001");

  // Retrying the SAME link is idempotent (the same version-checked write path every other record uses).
  const again = await as(DOCTOR, "/ward/cardio-link", "POST", { orgId: ORG, link: { kardioxRecordId: "kx-rec-001", mrn: reg.mrn } });
  assert.equal(again.__status, 200, JSON.stringify(again));
});

test("ECG REFERENCE: the AI verdict and HEART/TIMI scores are recorded exactly as KardiQ X produced them, never recomputed - and every reference carries unvalidated:true", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ECG Testcase", mobile: "9876500502", gender: "female", ageYears: 55 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const ecg = await as(DOCTOR, "/ward/cardio-ecg", "POST", { orgId: ORG, patientId, ecg: { kardioxRecordId: "kx-rec-002", verdict: "STEMI pattern suspected", heartScore: 6, timiScore: 4, capturedAt: "2026-09-09T07:00:00.000Z" } });
  assert.equal(ecg.__status, 200, JSON.stringify(ecg));
  const record = await RECORD.latest(TENANT_ROW.id, "ECGReference", ecg.ecgId);
  assert.equal(record.verdict, "STEMI pattern suspected"); assert.equal(record.heartScore, 6); assert.equal(record.timiScore, 4);
  assert.equal(record.unvalidated, true, "KardiQ X is self-declared clinically unvalidated - every reference must carry that flag, never presented as a validated finding");
  assert.equal(record.source, "kardiox");

  const list = await as(DOCTOR, `/ward/cardio-ecg-list?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(list.ecgs.length, 1);
});

test("ECG REFERENCE requires a verdict and a KardiQ X record id", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Validation Testcase", mobile: "9876500503", gender: "male", ageYears: 33 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const noVerdict = await as(DOCTOR, "/ward/cardio-ecg", "POST", { orgId: ORG, patientId, ecg: { kardioxRecordId: "kx-rec-003" } });
  assert.equal(noVerdict.__status, 422); assert.equal(noVerdict.error, "verdict_required");
  const noRecordId = await as(DOCTOR, "/ward/cardio-ecg", "POST", { orgId: ORG, patientId, ecg: { verdict: "Normal sinus rhythm" } });
  assert.equal(noRecordId.__status, 422); assert.equal(noRecordId.error, "kardiox_record_id_required");
});

test("TIMELINE: one read assembles the link and every ECG reference - proving the record is no longer disconnected", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Timeline Testcase", mobile: "9876500504", gender: "female", ageYears: 70 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  await as(DOCTOR, "/ward/cardio-link", "POST", { orgId: ORG, link: { kardioxRecordId: "kx-rec-004", mrn: reg.mrn } });
  await as(DOCTOR, "/ward/cardio-ecg", "POST", { orgId: ORG, patientId, ecg: { kardioxRecordId: "kx-rec-004", verdict: "Atrial fibrillation suspected", heartScore: 3 } });

  const tl = await as(DOCTOR, `/ward/cardio-timeline?orgId=${ORG}&patientId=${patientId}`);
  assert.equal(tl.__status, 200, JSON.stringify(tl));
  assert.equal(tl.timeline.links.length, 1);
  assert.equal(tl.timeline.ecgs.length, 1); assert.equal(tl.timeline.ecgs[0].verdict, "Atrial fibrillation suspected");
});

test("NO NEW ENCOUNTER CLASS: a cath-lab procedure is an ordinary SURGERY/PACU-shaped case through migrate-surgery.js, unchanged", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "No New Class Testcase", mobile: "9876500505", gender: "male", ageYears: 66 });
  const book = await as(DOCTOR, "/ward/surgery-book", "POST", { orgId: ORG, booking: { mrn: reg.mrn, procedure: "Coronary angiography with PCI", site: "coronary", laterality: "not-applicable", theatre: "Cath Lab 1", scheduledAt: "2026-09-10T08:00:00.000Z" } });
  assert.equal(book.__status, 200, JSON.stringify(book));
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", book.encounterId);
  assert.equal(enc.class, "SURGERY", "a cath-lab procedure reuses the existing SURGERY/PACU class - it does not need or get a cardiology-specific one");
});

test("RBAC: pharmacy (no emr.treat) cannot link a KardiQ X record or record an ECG reference", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "RBAC Testcase", mobile: "9876500506", gender: "female", ageYears: 44 });
  const patientId = "opd-pat-" + reg.mrn.toLowerCase();
  const link = await as(PHARM, "/ward/cardio-link", "POST", { orgId: ORG, link: { kardioxRecordId: "kx-rec-006", mrn: reg.mrn } });
  assert.equal(link.__status, 403, JSON.stringify(link));
  const ecg = await as(PHARM, "/ward/cardio-ecg", "POST", { orgId: ORG, patientId, ecg: { kardioxRecordId: "kx-rec-006", verdict: "Normal" } });
  assert.equal(ecg.__status, 403, JSON.stringify(ecg));
});
