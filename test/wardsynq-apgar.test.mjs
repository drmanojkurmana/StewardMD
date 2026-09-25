import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-apgar.test.mjs - structured APGAR on the newborn record, through the REAL routes.
 *
 * Validation and the server-side total, each minute saved on its own, a correction as a new version with a
 * reason, the delivery/newborn section of the mother's and the newborn's discharge summary, and negative
 * authorization on POST /api/queue/ward/apgar and GET /api/queue/ward/apgar-get.
 *
 * Same harness shape as wardsynq-maternity.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-apgar.test.mjs
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

async function admittedMother(mrnSuffix) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Maternity Testcase " + mrnSuffix, mobile: "9876500" + mrnSuffix, gender: "female", ageYears: 28 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Labour Ward", bed: "1", class: "MATERNITY", admittedAt: "2026-09-09T06:00:00.000Z" });
  return { reg, adm };
}

const { apgarScore } = await import("../functions/_wardsynq/migrate-maternity.js");
const STRANGER = "stranger@example.test";
const SIGNS = (a, p, g, ac, r) => ({ appearance: a, pulse: p, grimace: g, activity: ac, respiration: r });

async function bornBaby(suffix) {
  const { adm } = await admittedMother(suffix);
  const del = await as(DOCTOR, "/ward/delivery", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, delivery: { mode: "vaginal" } });
  assert.equal(del.__status, 200, JSON.stringify(del));
  const nb = await as(DOCTOR, "/ward/newborn", "POST", { orgId: ORG, motherPatientId: adm.patientId, encounterId: adm.encounterId, sex: "female", name: "Apgar Baby " + suffix });
  assert.equal(nb.__status, 200, JSON.stringify(nb));
  return { adm, newbornId: nb.newbornId };
}
const apgarRows = (pid) => RECORD.byPatient(TENANT_ROW.id, "ApgarScore", pid);

test("APGAR PURE: the total is the sum of five whole-number signs 0 to 2; strings, fractions, out of range, missing or unknown signs and unknown minutes are refused", () => {
  assert.deepEqual(apgarScore(1, SIGNS(1, 2, 1, 1, 2)), { ok: true, minute: 1, components: SIGNS(1, 2, 1, 1, 2), total: 7 });
  assert.equal(apgarScore(10, SIGNS(0, 0, 0, 0, 0)).total, 0);
  assert.equal(apgarScore(5, SIGNS(2, 2, 2, 2, 2)).total, 10);
  for (const bad of ["2", 1.5, 3, -1, null, true]) assert.equal(apgarScore(5, { ...SIGNS(2, 2, 2, 2, 2), pulse: bad }).error, "bad_sign", String(bad));
  const missing = SIGNS(2, 2, 2, 2, 2); delete missing.grimace;
  assert.equal(apgarScore(5, missing).error, "bad_sign");
  assert.equal(apgarScore(5, { ...SIGNS(2, 2, 2, 2, 2), total: 10 }).error, "unknown_sign", "a client-sent total is not a sign");
  for (const m of [0, 2, 3, 15, "5", null, undefined]) assert.equal(apgarScore(m, SIGNS(2, 2, 2, 2, 2)).error, "unknown_minute", String(m));
  assert.equal(apgarScore(1, null).error, "signs_required");
  assert.equal(apgarScore(1, [1, 2]).error, "signs_required");
});

test("APGAR POST /api/queue/ward/apgar: each minute saved on its own, total worked out on the server, recorder from the session; unrecorded minutes read as null", async () => {
  seedHospital();
  const { newbornId } = await bornBaby("301");
  const one = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 1, components: SIGNS(1, 2, 1, 1, 2), recordedBy: "forged", recordedAt: "1999-01-01T00:00:00.000Z" });
  assert.equal(one.__status, 200, JSON.stringify(one));
  assert.equal(one.total, 7); assert.equal(one.version, 1);
  const rec = await RECORD.latest(TENANT_ROW.id, "ApgarScore", one.apgarId);
  assert.equal(rec.total, 7); assert.notEqual(rec.recordedBy, "forged"); assert.equal(rec.recordedBy, one.actor);
  assert.notEqual(rec.recordedAt, "1999-01-01T00:00:00.000Z"); assert.equal(rec.correction, null);

  const got = await as(DOCTOR, `/ward/apgar-get?orgId=${ORG}&patientId=${newbornId}`);
  assert.equal(got.__status, 200, JSON.stringify(got));
  assert.deepEqual(got.apgar.minutes.map((m) => m.minute), [1, 5, 10]);
  assert.equal(got.apgar.minutes[0].record.total, 7);
  assert.equal(got.apgar.minutes[1].record, null, "the 5-minute score is not recorded yet, and is null rather than 0");
  assert.equal(got.apgar.minutes[2].record, null);

  const five = await as(DOCTOR, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 5, components: SIGNS(2, 2, 2, 1, 2) });
  assert.equal(five.__status, 200, JSON.stringify(five)); assert.equal(five.total, 9);

  const bad = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 10, components: SIGNS(2, "2", 2, 2, 2) });
  assert.equal(bad.__status, 422); assert.equal(bad.error, "bad_sign");
  const badMinute = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 20, components: SIGNS(2, 2, 2, 2, 2) });
  assert.equal(badMinute.__status, 422); assert.equal(badMinute.error, "unknown_minute");
  assert.equal((await apgarRows(newbornId)).length, 2, "refused scores wrote nothing");
});

test("APGAR CORRECTION: a recorded minute is refused without a reason, and a correction with a reason and the version read is a new version keeping what it replaced", async () => {
  seedHospital();
  const { newbornId } = await bornBaby("302");
  const first = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 1, components: SIGNS(1, 2, 1, 1, 1) });
  assert.equal(first.__status, 200, JSON.stringify(first));

  const again = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 1, components: SIGNS(2, 2, 2, 2, 2) });
  assert.equal(again.__status, 409); assert.equal(again.error, "already_recorded");
  const short = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 1, components: SIGNS(2, 2, 2, 2, 2), correctionReason: "x", expectedVersion: 1 });
  assert.equal(short.__status, 422); assert.equal(short.error, "reason_required");
  const noVersion = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 1, components: SIGNS(2, 2, 2, 2, 2), correctionReason: "Scored the wrong baby first" });
  assert.equal(noVersion.__status, 422); assert.equal(noVersion.error, "expected_version_required");
  const stale = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 1, components: SIGNS(2, 2, 2, 2, 2), correctionReason: "Scored the wrong baby first", expectedVersion: 0 });
  assert.equal(stale.__status, 409); assert.equal(stale.error, "version_conflict");
  const nothing = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 5, components: SIGNS(2, 2, 2, 2, 2), correctionReason: "Correcting a score never made" });
  assert.equal(nothing.__status, 409); assert.equal(nothing.error, "nothing_to_correct");
  assert.equal((await RECORD.history(TENANT_ROW.id, "ApgarScore", first.apgarId)).length, 1, "every refusal wrote nothing");

  const fixed = await as(DOCTOR, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 1, components: SIGNS(1, 2, 2, 1, 1), correctionReason: "Grimace was a cry on review", expectedVersion: 1 });
  assert.equal(fixed.__status, 200, JSON.stringify(fixed));
  assert.equal(fixed.version, 2); assert.equal(fixed.corrected, true); assert.equal(fixed.total, 7);
  const versions = await RECORD.history(TENANT_ROW.id, "ApgarScore", first.apgarId);
  assert.equal(versions.length, 2, "append-only: the first score is still in the history");
  assert.equal(versions[0].total, 6);
  const latest = await RECORD.latest(TENANT_ROW.id, "ApgarScore", first.apgarId);
  assert.deepEqual({ ...latest.correction, previousRecordedAt: !!latest.correction.previousRecordedAt },
    { reason: "Grimace was a cry on review", previousVersion: 1, previousTotal: 6, previousRecordedBy: first.actor, previousRecordedAt: true });
  assert.equal(latest.recordedBy, fixed.actor);
});

test("APGAR on an adult chart is refused: a first score needs an exact date of birth within 28 days, and nothing is written", async () => {
  seedHospital();
  const { adm } = await admittedMother("303");
  const r = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: adm.patientId, minute: 1, components: SIGNS(2, 2, 2, 2, 2) });
  assert.equal(r.__status, 422, JSON.stringify(r)); assert.equal(r.error, "not_a_newborn");
  const unknown = await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: "opd-pat-nobody", minute: 1, components: SIGNS(2, 2, 2, 2, 2) });
  assert.equal(unknown.__status, 404); assert.equal(unknown.error, "patient_not_found");
  assert.equal((await apgarRows(adm.patientId)).length, 0);
});

test("DISCHARGE SUMMARY: the mother's summary lists the delivery, the newborn and its APGAR per minute (unrecorded says not recorded), the newborn's NICU summary its own APGAR, and an adult stay has no birth section", async () => {
  seedHospital();
  const { adm, newbornId } = await bornBaby("304");
  await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 1, components: SIGNS(1, 2, 1, 1, 2) });
  await as(NURSE, "/ward/apgar", "POST", { orgId: ORG, patientId: newbornId, minute: 5, components: SIGNS(2, 2, 2, 1, 2) });

  const mom = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(mom.__status, 200, JSON.stringify(mom));
  const text = mom.assembled.birth;
  assert.match(text, /^Delivery: vaginal, /);
  assert.match(text, /Newborn: Apgar Baby 304, MRN NEWBORN-[^,]+, female\./);
  assert.match(text, /APGAR 1 min: 7\/10 \(appearance 1, pulse 2, grimace 1, activity 1, respiration 2\), recorded /);
  assert.match(text, /APGAR 5 min: 9\/10 /);
  assert.match(text, /APGAR 10 min: not recorded\./);

  const draft = await as(DOCTOR, "/ward/discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(draft.__status, 200, JSON.stringify(draft));
  assert.equal(draft.sections.birth, text, "the drafted, signable note carries the section");

  const baby = await RECORD.latest(TENANT_ROW.id, "Patient", newbornId);
  const nicu = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: baby.mrn, ward: "NICU", bed: "Cot 1", class: "NICU" });
  assert.equal(nicu.__status, 200, JSON.stringify(nicu)); assert.equal(nicu.patientId, newbornId);
  const own = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${nicu.encounterId}`);
  assert.equal(own.assembled.birth.split("\n")[2], "APGAR 10 min: not recorded.");
  assert.match(own.assembled.birth, /^APGAR 1 min: 7\/10/);

  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Adult Testcase", mobile: "9876500399", gender: "male", ageYears: 60 });
  const ipd = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: "9", class: "IPD" });
  const adult = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${ipd.encounterId}`);
  assert.equal(adult.__status, 200, JSON.stringify(adult));
  assert.ok(!("birth" in adult.assembled), "no birth section on an adult summary");
});

test("APGAR negative authorization on POST /api/queue/ward/apgar and GET /api/queue/ward/apgar-get: no session 401, pharmacy 403 with nothing written, another hospital 403, nurse and doctor allowed", async () => {
  seedHospital();
  const pid = (await bornBaby("305")).newbornId;
  docs.set(`q_orgs/org-other`, { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-other__${sanitize(idFor(STRANGER))}`, { fields: { orgId: "org-other", identity: idFor(STRANGER), role: "doctor", active: true }, updateTime: "t1" });
  const body = { orgId: ORG, patientId: pid, minute: 1, components: SIGNS(2, 2, 2, 2, 2) };

  const anon = await onRequest({ request: new Request("https://x/api/queue/ward/apgar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env: ENV });
  assert.equal(anon.status, 401);
  assert.equal((await as(PHARM, "/ward/apgar", "POST", body)).__status, 403);
  assert.equal((await as(STRANGER, "/ward/apgar", "POST", body)).__status, 403);
  assert.equal((await apgarRows(pid)).length, 0, "no refused write reached the record");

  const path = `/ward/apgar-get?orgId=${ORG}&patientId=${pid}`;
  assert.equal((await onRequest({ request: new Request("https://x/api/queue" + path), env: ENV })).status, 401);
  assert.equal((await as(PHARM, path)).__status, 403);
  assert.equal((await as(STRANGER, path)).__status, 403);

  const ok = await as(NURSE, "/ward/apgar", "POST", body);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  const read = await as(DOCTOR, path);
  assert.equal(read.__status, 200); assert.equal(read.apgar.minutes[0].record.total, 10);
});
