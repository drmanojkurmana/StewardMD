/* test/wardsynq-labels-routes.test.mjs - printed labels and camera scanning, the server side, through the REAL router.
 *
 * Routes: GET /api/queue/ward/label-data (what a wristband, tube label or ID slip says about the patient),
 * GET /api/queue/ward/list (the hospital's label settings), POST /api/queue/ward/specimen-outcome with scannedAccession
 * (the laboratory receives the tube it scanned, never the one beside it), GET /api/queue/ward/collections (the accession
 * travels to the board), POST /api/queue/org/update (wardsynq.labelSizes, Admin > Hospital).
 * Negative authorization on each: no session 401, wrong role 403 with nothing written, another hospital refused.
 * The generator and the label markup are pinned in test/ward-labels.test.mjs; the screens in test/run-ward-labels-ui.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-labels-routes.test.mjs
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
const { resetMemory: resetRateLimits } = await import("../functions/_wardsynq/rate-limit.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");
const { labelSizesOf, ageYearsAt, DEFAULT_LABEL_SIZES } = await import("../functions/_wardsynq/labels.js");
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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", LAB = "lab@example.test", PHARM = "pharmacy@example.test";
const ADMIN = "admin@example.test", OUTSIDER = "outsider@example.test", OTHER_ADMIN = "other-admin@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital(wardsynq) {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  resetRateLimits();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { ...(wardsynq || {}) } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG2}`, { fields: { id: ORG2, code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody2", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [LAB, "lab"], [PHARM, "pharmacy"], [ADMIN, "admin"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  for (const [email, role] of [[OUTSIDER, "doctor"], [OTHER_ADMIN, "admin"]]) {
    docs.set(`q_members/${sanitize(ORG2)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG2, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}

async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

let bed = 0;
async function admitted(extra) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Label Testcase " + (++bed), mobile: "98765" + String(20000 + bed), gender: "female", ...(extra || { ageYears: 52 }) });
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: String(bed) });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { reg, adm };
}
const rows = () => RECORD._rows.length;
const labelPath = (pid) => `/ward/label-data?orgId=${ORG}&patientId=${encodeURIComponent(pid)}`;

test("labelSizesOf and ageYearsAt: bounds per kind, defaults for the rest; whole years", () => {
  assert.deepEqual(labelSizesOf(null), DEFAULT_LABEL_SIZES);
  const s = labelSizesOf({ specimen: { widthMm: 60, heightMm: 30 }, wristband: { widthMm: 5, heightMm: 25 }, pharmacy: { widthMm: "75", heightMm: 50 }, slip: { widthMm: 80, heightMm: 301 } });
  assert.deepEqual(s.specimen, { widthMm: 60, heightMm: 30 });
  assert.deepEqual(s.wristband, DEFAULT_LABEL_SIZES.wristband, "5 mm is out of bounds");
  assert.deepEqual(s.pharmacy, DEFAULT_LABEL_SIZES.pharmacy, "a string is not a size");
  assert.deepEqual(s.slip, DEFAULT_LABEL_SIZES.slip);
  const now = Date.parse("2026-09-16T00:00:00Z");
  assert.equal(ageYearsAt("1970-09-16", now), 56); assert.equal(ageYearsAt("1970-09-17", now), 55); assert.equal(ageYearsAt("not a date", now), null);
});

test("GET /api/queue/ward/label-data: 401 without a session; pharmacy role and another hospital refused; a read writes nothing", async () => {
  seedHospital();
  const { adm } = await admitted();
  const before = rows();
  assert.equal((await as(null, labelPath(adm.patientId))).__status, 401);
  const ph = await as(PHARM, labelPath(adm.patientId));
  assert.equal(ph.__status, 403, JSON.stringify(ph));
  assert.equal(ph.patient, undefined, "a refused read names nobody");
  const cross = await as(OUTSIDER, labelPath(adm.patientId));
  assert.ok(cross.__status === 403 || cross.__status === 404, JSON.stringify(cross));
  assert.equal(cross.patient, undefined);
  assert.equal((await as(NURSE, `/ward/label-data?orgId=${ORG}`)).__status, 422, "a patient is required");
  assert.equal((await as(NURSE, labelPath("wsq-pat-nobody"))).__status, 404);
  assert.equal(rows(), before, "nothing written by any of these");
});

test("GET /api/queue/ward/label-data (nurse, and the laboratory): name, MRN, sex, age; an estimated DOB is not given as a date; band value is the MRN; hospital sizes", async () => {
  seedHospital({ labelSizes: { wristband: { widthMm: 250, heightMm: 25 } }, timeZone: "Asia/Kolkata" });
  const { reg, adm } = await admitted();
  const r = await as(NURSE, labelPath(adm.patientId));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.patient.mrn, reg.mrn);
  assert.match(r.patient.name, /^Label Testcase/);
  assert.equal(r.patient.sex, "female");
  assert.equal(r.patient.dob, null, "registered with an age only: the derived date is not printed");
  assert.equal(r.patient.dobApproximate, true);
  assert.equal(r.patient.ageYears, 52);
  assert.deepEqual(r.allergies, [], "none recorded is an empty list");
  assert.deepEqual(r.band, { value: reg.mrn, from: "record", bedsideValue: reg.mrn, tagsUnread: false, matchesBedside: true });
  assert.deepEqual(r.labels.sizes.wristband, { widthMm: 250, heightMm: 25 });
  assert.deepEqual(r.labels.sizes.specimen, DEFAULT_LABEL_SIZES.specimen);
  assert.equal(r.labels.timeZone, "Asia/Kolkata");
  const lab = await as(LAB, labelPath(adm.patientId));
  assert.equal(lab.__status, 200, "the laboratory prints the tube label: " + JSON.stringify(lab));
  assert.equal(lab.patient.mrn, reg.mrn);

  const { adm: adm2 } = await admitted({ birthDate: "1980-02-29" });
  const exact = await as(NURSE, labelPath(adm2.patientId));
  assert.equal(exact.patient.dob, "1980-02-29"); assert.equal(exact.patient.dobApproximate, false);
});

test("GET /api/queue/ward/label-data: the active band's code is the QR value and says when it is not what the bedside scans compare with; allergies listed, and null when unreadable", async () => {
  seedHospital();
  const { reg, adm } = await admitted();
  const tag = await as(NURSE, "/ward/tag-assign", "POST", { orgId: ORG, patientId: adm.patientId, tagType: "wristband", code: "band-7781" });
  assert.equal(tag.__status, 200, JSON.stringify(tag));
  const realByPatient = RECORD.byPatient.bind(RECORD);
  RECORD.byPatient = async (tenant, type, pid) => (type === "AllergyIntolerance" ? [{ resourceType: type, id: "a1", patientId: pid, substance: "Penicillin" }] : realByPatient(tenant, type, pid));
  try {
    const r = await as(NURSE, labelPath(adm.patientId));
    assert.equal(r.__status, 200, JSON.stringify(r));
    assert.equal(r.band.value, "BAND-7781"); assert.equal(r.band.from, "tag");
    assert.equal(r.band.bedsideValue, reg.mrn); assert.equal(r.band.matchesBedside, false);
    assert.deepEqual(r.allergies, ["Penicillin"]);
    RECORD.byPatient = async (tenant, type, pid) => { if (type === "AllergyIntolerance") throw new Error("store down"); return realByPatient(tenant, type, pid); };
    const unread = await as(NURSE, labelPath(adm.patientId));
    assert.equal(unread.__status, 200);
    assert.equal(unread.allergies, null, "could not be read is null, never an empty list");
  } finally { RECORD.byPatient = realByPatient; }
});

test("GET /api/queue/ward/list and GET /api/queue/ward/dispenses (the pharmacy's own read) carry the label settings; a refused read does not", async () => {
  seedHospital({ labelSizes: { slip: { widthMm: 58, heightMm: 40 }, pharmacy: { widthMm: 100, heightMm: 70 } } });
  const r = await as(NURSE, `/ward/list?orgId=${ORG}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.labels.sizes.slip, { widthMm: 58, heightMm: 40 });
  assert.equal(r.labels.utcOffsetMinutes, 330);
  const { adm } = await admitted();
  const d = await as(PHARM, `/ward/dispenses?orgId=${ORG}&patientId=${encodeURIComponent(adm.patientId)}`);
  assert.equal(d.__status, 200, JSON.stringify(d));
  assert.deepEqual(d.labels.sizes.pharmacy, { widthMm: 100, heightMm: 70 });
  const refused = await as(null, `/ward/dispenses?orgId=${ORG}&patientId=${encodeURIComponent(adm.patientId)}`);
  assert.equal(refused.__status, 401); assert.equal(refused.labels, undefined);
});

async function collectedTube() {
  const { adm } = await admitted();
  const o = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "CBC", display: "Complete blood count", category: "laboratory" });
  assert.equal(o.__status, 200, JSON.stringify(o));
  const got = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: o.orderId, specimenType: "Whole blood" });
  assert.equal(got.__status, 200, JSON.stringify(got));
  return { adm, order: o, got };
}

test("GET /api/queue/ward/collections: a collected sample carries its accession number and specimen type to the board", async () => {
  seedHospital();
  const { got } = await collectedTube();
  const c = await as(LAB, `/ward/collections?orgId=${ORG}&scope=hospital`);
  assert.equal(c.__status, 200, JSON.stringify(c));
  const row = c.requests.find((x) => x.collection.specimenId === got.specimenId);
  assert.equal(row.collection.accessionNumber, got.accessionNumber);
  assert.equal(row.collection.specimenType, "Whole blood");
});

test("POST /api/queue/ward/specimen-outcome with scannedAccession: 401, pharmacy 403, other hospital refused, a different tube's label 409 - all with nothing written; the tube's own label (any case, spaces) is received", async () => {
  seedHospital();
  const { got } = await collectedTube();
  const { got: other } = await collectedTube();
  const body = (scan) => ({ orgId: ORG, specimenId: got.specimenId, state: "received", scannedAccession: scan });
  const stateOf = async () => RECORD._rows.filter((r) => r.resourceType === "SpecimenCollection" && r.id === got.specimenId).at(-1).body.state;
  assert.equal((await as(null, "/ward/specimen-outcome", "POST", body(got.accessionNumber))).__status, 401);
  assert.equal((await as(PHARM, "/ward/specimen-outcome", "POST", body(got.accessionNumber))).__status, 403);
  const cross = await as(OUTSIDER, "/ward/specimen-outcome", "POST", body(got.accessionNumber));
  assert.ok(cross.__status === 403 || cross.__status === 404, JSON.stringify(cross));
  const wrong = await as(LAB, "/ward/specimen-outcome", "POST", body(other.accessionNumber));
  assert.equal(wrong.__status, 409, JSON.stringify(wrong));
  assert.equal(wrong.error, "wrong_specimen_scan");
  assert.equal(wrong.written, 0);
  assert.equal(await stateOf(), "collected", "the refused receipts wrote nothing");

  const ok = await as(LAB, "/ward/specimen-outcome", "POST", body(" " + got.accessionNumber.toLowerCase() + " "));
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.written, 1);
  assert.equal(await stateOf(), "received");
});

test("POST /api/queue/org/update wardsynq.labelSizes: 401, nurse 403, other hospital's admin refused, nothing written; the admin's save survives the whitelist and keeps the rest", async () => {
  seedHospital({ printLanguages: { enabled: true } });
  const before = JSON.stringify(docs.get(`q_orgs/${ORG}`).fields);
  const body = { orgId: ORG, wardsynq: { labelSizes: { specimen: { widthMm: 60, heightMm: 30 } } } };
  assert.equal((await as(null, "/org/update", "POST", body)).__status, 401);
  assert.equal((await as(NURSE, "/org/update", "POST", body)).__status, 403);
  const cross = await as(OTHER_ADMIN, "/org/update", "POST", body);
  assert.ok(cross.__status === 403 || cross.__status === 404, JSON.stringify(cross));
  assert.equal(JSON.stringify(docs.get(`q_orgs/${ORG}`).fields), before, "nothing written");
  const ok = await as(ADMIN, "/org/update", "POST", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.deepEqual(ok.org.wardsynq.labelSizes, { specimen: { widthMm: 60, heightMm: 30 } });
  assert.deepEqual(ok.org.wardsynq.printLanguages, { enabled: true }, "the rest of the hospital's config is kept");
  const list = await as(NURSE, `/ward/list?orgId=${ORG}`);
  assert.deepEqual(list.labels.sizes.specimen, { widthMm: 60, heightMm: 30 }, "the ward prints at the saved size");
});
