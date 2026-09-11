/* test/wardsynq-icu.test.mjs — the ICU vertical, through the REAL routes.
 *
 * ICU admission (class:"ICU", explicit and never inferred from a ward name) -> bed occupancy across
 * mixed IPD/ICU classes -> transfer -> discharge -> device association (wristband + asset-tag
 * scanned) -> device readings, refused with no association and accepted with one -> FHIR/downtime/
 * metrics cross-module checks, the same shape wardsynq-ed.test.mjs already proved for ED.
 *
 * Same harness as wardsynq-ed.test.mjs: three real roles, none the org owner.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-icu.test.mjs
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

/* ---- admission, explicit class, never inferred ---------------------------------------------- */

test("ICU ADMISSION: /ward/admit with class:\"ICU\" opens a class:ICU Encounter; omitting class still defaults to IPD", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ICU Testcase", mobile: "9876500301", gender: "female", ageYears: 61 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "ICU", bed: "1", class: "ICU", admittedAt: "2026-09-09T09:00:00.000Z" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  assert.equal(adm.written, 1);
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(enc.class, "ICU", "the requested class landed on the canonical Encounter, not silently dropped to IPD");
  assert.equal(enc.status, "in-progress");

  const board = await as(NURSE, `/ward/list?orgId=${ORG}&ward=ICU`);
  assert.equal(board.__status, 200);
  assert.ok(board.patients.some((p) => p.encounterId === adm.encounterId), "an ICU-class encounter appears on its own ward's roster, not only IPD's");

  // A ward named "ICU" with no explicit class is still IPD - the class is requested, never guessed
  // from the ward's name.
  const reg2 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ICU Ward No Class", mobile: "9876500302", gender: "male", ageYears: 40 });
  const adm2 = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg2.mrn, ward: "ICU", bed: "2", admittedAt: "2026-09-09T09:05:00.000Z" });
  const enc2 = await RECORD.latest(TENANT_ROW.id, "Encounter", adm2.encounterId);
  assert.equal(enc2.class, "IPD", "no class requested defaults to IPD even on a ward literally named ICU - the name never decides it");
});

test("BED SAFETY across classes: an IPD admission and an ICU admission cannot occupy the same (ward, bed)", async () => {
  seedHospital();
  const regA = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "First In Bed", mobile: "9876500303", gender: "male", ageYears: 55 });
  const admA = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regA.mrn, ward: "ICU", bed: "3", class: "ICU", admittedAt: "2026-09-09T09:00:00.000Z" });
  assert.equal(admA.__status, 200, JSON.stringify(admA));

  const regB = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Second, Same Bed", mobile: "9876500304", gender: "female", ageYears: 33 });
  // No class requested this time (defaults to IPD) - the clash guard must still see it, or an ICU
  // occupant is invisible to an ordinary admission and two patients end up in one bed.
  const admB = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: regB.mrn, ward: "ICU", bed: "3", admittedAt: "2026-09-09T09:05:00.000Z" });
  assert.equal(admB.__status, 409); assert.equal(admB.error, "bed_occupied", JSON.stringify(admB));
});

test("TRANSFER and DISCHARGE both work on an ICU-class stay, unchanged for IPD", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ICU Move And Leave", mobile: "9876500305", gender: "male", ageYears: 70 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "ICU", bed: "4", class: "ICU", admittedAt: "2026-09-09T09:00:00.000Z" });

  const moved = await as(DOCTOR, "/ward/transfer", "POST", { orgId: ORG, encounterId: adm.encounterId, ward: "ICU", bed: "5", movedAt: "2026-09-09T10:00:00.000Z" });
  assert.equal(moved.__status, 200, JSON.stringify(moved));
  const afterMove = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(afterMove.class, "ICU", "a transfer never changes what class a stay is");
  assert.equal(afterMove.location.bed, "5");

  const out = await as(DOCTOR, "/ward/discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, dischargedAt: "2026-09-09T18:00:00.000Z", disposition: "ward" });
  assert.equal(out.__status, 200, JSON.stringify(out));
  const afterDischarge = await RECORD.latest(TENANT_ROW.id, "Encounter", adm.encounterId);
  assert.equal(afterDischarge.status, "finished");
});

/* ---- device association (HAZ-DEV-01) ---------------------------------------------------------- */

async function admitToIcu(mrn, bed) {
  return as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn, ward: "ICU", bed, class: "ICU", admittedAt: "2026-09-09T09:00:00.000Z" });
}

test("DEVICE ASSOCIATION: both the wristband and the device's own asset tag must be scanned, and match", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Monitor Patient", mobile: "9876500306", gender: "female", ageYears: 48 });
  const adm = await admitToIcu(reg.mrn, "6");

  const ok = await as(NURSE, "/ward/device-associate", "POST", { orgId: ORG, association: {
    device: { deviceId: "mon-01", assetTag: "AT-1001", kind: "monitor" },
    patient: { id: adm.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn },
    encounterId: adm.encounterId, scannedWristband: reg.mrn, scannedAssetTag: "AT-1001",
  } });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.association.patientId, adm.patientId);

  const status = await as(DOCTOR, `/ward/device-status?orgId=${ORG}&deviceId=mon-01`);
  assert.equal(status.__status, 200);
  assert.equal(status.association.patientId, adm.patientId, "the association is durable across requests - a rehydrated gateway, not per-request memory");

  const reg2 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Wrong Wristband", mobile: "9876500307", gender: "male", ageYears: 51 });
  const adm2 = await admitToIcu(reg2.mrn, "7");
  const mismatch = await as(NURSE, "/ward/device-associate", "POST", { orgId: ORG, association: {
    device: { deviceId: "mon-02", assetTag: "AT-1002", kind: "monitor" },
    patient: { id: adm2.patientId, mrn: reg2.mrn, wristbandBarcode: reg2.mrn },
    encounterId: adm2.encounterId, scannedWristband: "SOME-OTHER-MRN", scannedAssetTag: "AT-1002",
  } });
  assert.equal(mismatch.__status, 422); assert.equal(mismatch.error, "WRISTBAND_MISMATCH", JSON.stringify(mismatch));
  const noStatus = await as(DOCTOR, `/ward/device-status?orgId=${ORG}&deviceId=mon-02`);
  assert.equal(noStatus.association, null, "a refused association writes nothing - the device stays unassociated");

  // A CLAIMED mrn/wristbandBarcode is never trusted, only the real patient record read server-side -
  // otherwise the whole point of scanning a wristband is defeated by whatever the request merely says.
  const spoofed = await as(NURSE, "/ward/device-associate", "POST", { orgId: ORG, association: {
    device: { deviceId: "mon-spoof", assetTag: "AT-SPOOF", kind: "monitor" },
    patient: { id: adm2.patientId, mrn: "SOME-OTHER-MRN", wristbandBarcode: "SOME-OTHER-MRN" },
    encounterId: adm2.encounterId, scannedWristband: "SOME-OTHER-MRN", scannedAssetTag: "AT-SPOOF",
  } });
  assert.equal(spoofed.__status, 422); assert.equal(spoofed.error, "WRISTBAND_MISMATCH", "a spoofed patient.mrn in the request body cannot make a wristband scan appear to match: " + JSON.stringify(spoofed));
});

test("A DEVICE READING WITH NO ASSOCIATION IS REFUSED, never queued or guessed from a bed; an associated device's reading reaches the chart as a real Observation", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Ingest Patient", mobile: "9876500308", gender: "male", ageYears: 66 });
  const adm = await admitToIcu(reg.mrn, "8");

  const orphan = await as(NURSE, "/ward/device-ingest", "POST", { orgId: ORG, reading: { deviceId: "mon-orphan", code: "8867-4", value: 88, unit: "/min", signalQualityIndex: 95, measuredAt: new Date().toISOString() } });
  assert.equal(orphan.__status, 422); assert.equal(orphan.error, "NOT_ASSOCIATED", JSON.stringify(orphan));

  await as(NURSE, "/ward/device-associate", "POST", { orgId: ORG, association: {
    device: { deviceId: "mon-03", assetTag: "AT-1003", kind: "monitor" },
    patient: { id: adm.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn },
    encounterId: adm.encounterId, scannedWristband: reg.mrn, scannedAssetTag: "AT-1003",
  } });

  const clean = await as(NURSE, "/ward/device-ingest", "POST", { orgId: ORG, reading: { deviceId: "mon-03", code: "8867-4", value: 88, unit: "/min", signalQualityIndex: 95, measuredAt: new Date().toISOString() } });
  assert.equal(clean.__status, 200, JSON.stringify(clean));
  assert.equal(clean.artifact, false); assert.equal(clean.scoreEligible, true);
  const obs = await RECORD.latest(TENANT_ROW.id, "Observation", clean.observationId);
  assert.equal(obs.patientId, adm.patientId); assert.equal(obs.encounterId, adm.encounterId); assert.equal(obs.category, "device");

  // An implausible value is derived as artifact server-side - never accepted, never discarded.
  const bad = await as(NURSE, "/ward/device-ingest", "POST", { orgId: ORG, reading: { deviceId: "mon-03", code: "8867-4", value: 400, unit: "/min", signalQualityIndex: 95, measuredAt: new Date().toISOString() } });
  assert.equal(bad.__status, 200); assert.equal(bad.artifact, true, "an out-of-plausible-range value is flagged, not silently accepted as clean");
  assert.equal(bad.scoreEligible, false);
  const badObs = await RECORD.latest(TENANT_ROW.id, "Observation", bad.observationId);
  assert.equal(badObs.value, 400, "flagged, never discarded - the real value still reaches the chart");
});

test("DEVICE DISSOCIATION: ending an association makes the device refuse the next reading again", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Freed Monitor", mobile: "9876500309", gender: "female", ageYears: 39 });
  const adm = await admitToIcu(reg.mrn, "9");
  await as(NURSE, "/ward/device-associate", "POST", { orgId: ORG, association: {
    device: { deviceId: "mon-04", assetTag: "AT-1004", kind: "monitor" },
    patient: { id: adm.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn },
    encounterId: adm.encounterId, scannedWristband: reg.mrn, scannedAssetTag: "AT-1004",
  } });

  const end = await as(NURSE, "/ward/device-dissociate", "POST", { orgId: ORG, deviceId: "mon-04", reason: "patient transferred out" });
  assert.equal(end.__status, 200, JSON.stringify(end));
  const status = await as(DOCTOR, `/ward/device-status?orgId=${ORG}&deviceId=mon-04`);
  assert.equal(status.association, null);

  const after = await as(NURSE, "/ward/device-ingest", "POST", { orgId: ORG, reading: { deviceId: "mon-04", code: "59408-5", value: 97, unit: "%", signalQualityIndex: 90, measuredAt: new Date().toISOString() } });
  assert.equal(after.__status, 422); assert.equal(after.error, "NOT_ASSOCIATED", "an ended association is really ended, not still live in some cached gateway");
});

test("RBAC: a pharmacy actor (no emr.vitals) cannot associate or ingest a device", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "RBAC Check", mobile: "9876500310", gender: "male", ageYears: 44 });
  const adm = await admitToIcu(reg.mrn, "10");
  const refused = await as(PHARM, "/ward/device-associate", "POST", { orgId: ORG, association: {
    device: { deviceId: "mon-05", assetTag: "AT-1005", kind: "monitor" },
    patient: { id: adm.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn },
    encounterId: adm.encounterId, scannedWristband: reg.mrn, scannedAssetTag: "AT-1005",
  } });
  assert.equal(refused.__status, 403, JSON.stringify(refused));
});

/* ---- cross-module: FHIR / downtime / metrics --------------------------------------------------- */

test("an ICU patient exports as a FHIR-CONFORMANT Encounter (class IMP), and appears on the downtime pack and in ward metrics", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "FHIR ICU Testcase", mobile: "9876500311", gender: "female", ageYears: 58 });
  const adm = await admitToIcu(reg.mrn, "11");

  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/fhir/Encounter/${adm.encounterId}?orgId=${ORG}`, { headers: { "Cf-Access-Authenticated-User-Email": DOCTOR } }), env: ENV });
  const enc = await res.json();
  assert.equal(res.status, 200, JSON.stringify(enc));
  assert.deepEqual(enc.class, { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" }, "an ICU stay is still, correctly, an inpatient FHIR encounter class - the unit is location, not class");

  const pack = await as(DOCTOR, `/ward/downtime?orgId=${ORG}`);
  assert.equal(pack.__status, 200, JSON.stringify(pack));
  assert.ok(pack.patients.some((p) => p.patientId === adm.patientId), "an open ICU encounter appears on the downtime pack");

  const metrics = await as(DOCTOR, `/ward/metrics?orgId=${ORG}&ward=ICU`);
  assert.equal(metrics.__status, 200, JSON.stringify(metrics));
  assert.equal(metrics.metrics.patients, 1, "the ICU is counted in ward metrics, not silently zero");
});
