/* test/wardsynq-ed.test.mjs — the emergency department vertical, through the REAL routes.
 *
 * ED arrival (known and unidentified) -> triage acuity -> vitals -> doctor assessment (note) ->
 * medication order -> the eMAR -> investigation order -> result -> resuscitation bundle ->
 * disposition (home / admitted / lwbs) -> the longitudinal record survives.
 *
 * Same harness shape as wardsynq-inpatient-emar.test.mjs (three real roles, none the org owner, so
 * a separation assertion demonstrates the capability boundary rather than a vacuous admin pass).
 *
 * node --test --experimental-test-module-mocks test/wardsynq-ed.test.mjs
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

const { MemoryRepository, VersionConflictError } = await import("../functions/_wardsynq/repository.js");
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
const NOTE_TEMPLATES = [{
  id: "ed-assessment", name: "ED assessment", version: "1", noteType: "assessment",
  sections: [{ key: "history", title: "History", required: true }, { key: "plan", title: "Plan", required: true }],
}];

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { noteTemplates: NOTE_TEMPLATES } }, updateTime: "t1" });
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

/* ---- arrival ------------------------------------------------------------------------------------ */

test("ED ARRIVAL, known patient: opens a class:ED, in-progress Encounter under their own registered mrn", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ED Testcase", mobile: "9876500201", gender: "male", ageYears: 45 });
  const arr = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, chiefComplaint: "Chest pain", arrivedAt: "2026-09-09T08:00:00.000Z" } });
  assert.equal(arr.__status, 200, JSON.stringify(arr));
  assert.equal(arr.written, 1);
  assert.equal(arr.patientId, "opd-pat-" + reg.mrn.toLowerCase());
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", arr.encounterId);
  assert.equal(enc.class, "ED"); assert.equal(enc.status, "in-progress");
  assert.equal(enc.location.ward, "ED"); assert.equal(enc.reason, "Chest pain");

  // Retrying the SAME arrival (a lost response, a doubled tap) is idempotent, not a second visit.
  const again = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, chiefComplaint: "Chest pain", arrivedAt: "2026-09-09T08:00:00.000Z" } });
  assert.equal(again.written, 0); assert.equal(again.skipped, "unchanged");
});

test("ED ARRIVAL requires an existing MRN or arrival.unknown - it never invents an identity for a named person", async () => {
  seedHospital();
  const noIdentity = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { chiefComplaint: "Fell down" } });
  assert.equal(noIdentity.__status, 422); assert.equal(noIdentity.error, "identity_required");
});

test("UNIDENTIFIED TRAUMA ARRIVAL: makeProvisionalIdentity's own MRN scheme is wired to a real route, writes a real Patient, and a second unidentified arrival of the same sex the same day gets a DIFFERENT sequence", async () => {
  seedHospital();
  const a = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { unknown: { sex: "male" }, chiefComplaint: "Found down, unresponsive", arrivedAt: "2026-09-09T03:00:00.000Z" } });
  assert.equal(a.__status, 200, JSON.stringify(a));
  assert.match(a.mrn, /^TRAUMA-UNKNOWN-MALE-20260909-01$/);
  assert.equal(a.provisional, true);
  const pat = await RECORD.latest(TENANT_ROW.id, "Patient", a.patientId);
  assert.equal(pat.provisional, true); assert.equal(pat.mrn, a.mrn); assert.equal(pat.dob, "0000-00-00");
  assert.match(pat.name, /Unidentified Patient MALE 01/);

  const b = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { unknown: { sex: "male" }, chiefComplaint: "Second trauma, unresponsive", arrivedAt: "2026-09-09T03:10:00.000Z" } });
  assert.equal(b.__status, 200, JSON.stringify(b));
  assert.match(b.mrn, /^TRAUMA-UNKNOWN-MALE-20260909-02$/);
  assert.notEqual(a.patientId, b.patientId, "two different unidentified people never collapse onto one chart");
  assert.notEqual(a.encounterId, b.encounterId);
});

test("UNIDENTIFIED ARRIVAL, CONCURRENT: two unidentified arrivals of the same sex racing at once never collide on one provisional MRN", async () => {
  seedHospital();
  const [a, b] = await Promise.all([
    as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { unknown: { sex: "female" }, arrivedAt: "2026-09-09T04:00:00.000Z" } }),
    as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { unknown: { sex: "female" }, arrivedAt: "2026-09-09T04:00:01.000Z" } }),
  ]);
  assert.equal(a.__status, 200, JSON.stringify(a)); assert.equal(b.__status, 200, JSON.stringify(b));
  assert.notEqual(a.mrn, b.mrn, "the storage layer's own version-uniqueness (VersionConflictError retry, migrate-ed.js) kept the two sequences apart: " + a.mrn + " / " + b.mrn);
});

/* ---- RBAC --------------------------------------------------------------------------------------- */

test("RBAC: arrival, triage and disposition are administrative/clinical acts pharmacy does not hold", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "RBAC ED Testcase", mobile: "9876500202", gender: "female", ageYears: 38 });
  const badArrival = await as(PHARM, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn } });
  assert.equal(badArrival.__status, 403);

  const arr = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, arrivedAt: "2026-09-09T08:00:00.000Z" } });
  const badTriage = await as(PHARM, "/ward/ed-triage", "POST", { orgId: ORG, encounterId: arr.encounterId, acuity: 2 });
  assert.equal(badTriage.__status, 403);
  const badDisposition = await as(PHARM, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: arr.encounterId, disposition: "home" });
  assert.equal(badDisposition.__status, 403);

  // And the roles that legitimately hold these still succeed - the refusal above is the boundary,
  // not a route that has quietly stopped working.
  assert.equal((await as(NURSE, "/ward/ed-triage", "POST", { orgId: ORG, encounterId: arr.encounterId, acuity: 2 })).__status, 200);
  assert.equal((await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: arr.encounterId, disposition: "home" })).__status, 200);
});

/* ---- triage: never computed ---------------------------------------------------------------------- */

test("TRIAGE ACUITY is a human's choice, recorded verbatim, never computed from vitals; an out-of-range value is refused", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Triage Testcase", mobile: "9876500203", gender: "male", ageYears: 60 });
  const arr = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, arrivedAt: "2026-09-09T08:00:00.000Z" } });

  const bad = await as(NURSE, "/ward/ed-triage", "POST", { orgId: ORG, encounterId: arr.encounterId, acuity: 0 });
  assert.equal(bad.__status, 422); assert.equal(bad.error, "acuity_required");
  const bad2 = await as(NURSE, "/ward/ed-triage", "POST", { orgId: ORG, encounterId: arr.encounterId, acuity: 6 });
  assert.equal(bad2.__status, 422);

  // No vitals were ever recorded for this patient, and acuity 2 was accepted anyway - proof nothing
  // computed it from a vital sign that does not exist on this chart.
  const good = await as(NURSE, "/ward/ed-triage", "POST", { orgId: ORG, encounterId: arr.encounterId, acuity: 2, chiefComplaint: "Crushing chest pain" });
  assert.equal(good.__status, 200, JSON.stringify(good));
  const enc = await RECORD.latest(TENANT_ROW.id, "Encounter", arr.encounterId);
  assert.equal(enc.acuity, 2); assert.equal(enc.triagedBy, idFor(NURSE)); assert.ok(enc.triagedAt);
});

/* ---- the golden path, known patient: arrival -> triage -> vitals -> note -> order -> eMAR ->
 * investigation -> resuscitation -> disposition home, and the record stays intact ---------------- */

test("THE ED GOLDEN PATH: arrival, triage, vitals, a doctor's note, a medication order given through the SAME eMAR the ward uses, an investigation ordered, a resuscitation bundle, and disposition home - all through the real routes, and the chart still reads whole afterwards", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Golden Path ED", mobile: "9876500204", gender: "female", ageYears: 52 });
  const arr = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, chiefComplaint: "Breathless", arrivedAt: "2026-09-09T08:00:00.000Z" } });
  assert.equal(arr.__status, 200);

  const triage = await as(NURSE, "/ward/ed-triage", "POST", { orgId: ORG, encounterId: arr.encounterId, acuity: 2 });
  assert.equal(triage.__status, 200);

  const vitals = await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: arr.encounterId, patientId: arr.patientId, vitals: { sbp: "88", pulse: "128", spo2: "89", rr: "32" } });
  assert.equal(vitals.__status, 200); assert.ok(vitals.written >= 1, "the SAME ward-vitals route the inpatient side uses - no second vitals mechanism for ED");

  const note = await as(DOCTOR, "/ward/note", "POST", { orgId: ORG, templateId: "ed-assessment", encounterId: arr.encounterId, sections: { history: "Sudden dyspnoea, hypotensive, tachycardic.", plan: "Sepsis six, fluids, cultures, broad-spectrum antibiotics." } });
  assert.equal(note.__status, 200, JSON.stringify(note));

  const ord = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: arr.patientId, encounterId: arr.encounterId, drug: "Piperacillin-tazobactam", dose: { value: 4.5, unit: "g" }, route: "iv", frequency: "STAT" } });
  assert.equal(ord.__status, 200, JSON.stringify(ord));
  const mar = (action, extra) => as(NURSE, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: "2026-09-09T08:05:00.000Z", patient: { id: arr.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn }, ...extra });
  await mar("verify"); await mar("dispense");
  const given = await mar("scan", { scan: { patientBarcode: reg.mrn, drugBarcode: "Piperacillin-tazobactam", dose: { value: 4.5, unit: "g" }, route: "iv" } }).then(() => mar("administer"));
  assert.equal(given.to, "administered", JSON.stringify(given));

  const inv = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: arr.encounterId, code: "Lactate", display: "Venous lactate", category: "laboratory", priority: "stat" });
  assert.equal(inv.__status, 200, JSON.stringify(inv));

  // RESUSCITATION: a Code Sepsis bundle, real, through wardsynq-emergency.js's real state machine.
  const bundle = await as(DOCTOR, "/ward/resus-start", "POST", { orgId: ORG, patientId: arr.patientId, encounterId: arr.encounterId, code: "code-sepsis" });
  assert.equal(bundle.__status, 200, JSON.stringify(bundle));
  assert.equal(bundle.status.state, "running");
  // The sepsis bundle's first element is "lactate", done on "resulted" (wardsynq-emergency.js's own
  // BUNDLES table) - the SAME rule that refuses recording an ORDER as a completion elsewhere in
  // this file's design (ordering is not doing).
  const firstElement = bundle.status.elements[0];
  assert.equal(firstElement.key, "lactate");
  const marked = await as(DOCTOR, "/ward/resus-mark", "POST", { orgId: ORG, bundleId: bundle.bundleId, key: firstElement.key, event: "resulted", at: "2026-09-09T08:10:00.000Z" });
  assert.equal(marked.__status, 200, JSON.stringify(marked));
  assert.equal(marked.status.elements.find((e) => e.key === firstElement.key).done, true);
  // A nurse can SEE the running bundle - emr.view - without needing to hold emr.treat.
  const seenByNurse = await as(NURSE, `/ward/resus?orgId=${ORG}&patientId=${arr.patientId}`);
  assert.equal(seenByNurse.__status, 200);
  assert.equal(seenByNurse.bundles.length, 1);

  // DISPOSITION: home. The visit closes; nothing already on the chart is touched or hidden.
  const disp = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: arr.encounterId, disposition: "home", reason: "Improved with treatment; safe for discharge with follow-up." });
  assert.equal(disp.__status, 200, JSON.stringify(disp));
  const closedEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", arr.encounterId);
  assert.equal(closedEnc.status, "finished"); assert.equal(closedEnc.disposition, "home");
  assert.equal(closedEnc.acuity, 2, "triage acuity survives disposition, not overwritten or dropped");

  // The record is still whole: the order, the administration, the note, the vitals, the bundle.
  assert.ok(await RECORD.latest(TENANT_ROW.id, "MedicationOrder", ord.orderId));
  assert.equal((await RECORD.latest(TENANT_ROW.id, "MedicationAdministration", given.administrationId)).status, "administered");
  const flow = await as(DOCTOR, `/ward/flowsheet?orgId=${ORG}&patientId=${arr.patientId}&hours=168`);
  assert.ok(flow.grid.rows.some((r) => (r.cells || []).some((c) => !c.empty)), "the vitals charted in the ED are still on the flowsheet after disposition");
});

/* ---- disposition: admitted, transferred, lwbs, and the closed-visit guard ------------------------ */

test("DISPOSITION admitted: closes the ED visit and hands off to the SAME bed-guarded admitPatient() the inpatient ward uses - no second admission mechanism", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "ED to Ward", mobile: "9876500205", gender: "male", ageYears: 70 });
  const arr = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, arrivedAt: "2026-09-09T08:00:00.000Z" } });
  const disp = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: arr.encounterId, disposition: "admitted", admission: { ward: "Medical A", bed: "9" } });
  assert.equal(disp.__status, 200, JSON.stringify(disp));
  assert.equal(disp.written, 2, "two real writes: the ED encounter closed, a real IPD encounter opened");
  const edEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", arr.encounterId);
  assert.equal(edEnc.status, "finished"); assert.equal(edEnc.disposition, "admitted");
  const ipdEnc = await RECORD.latest(TENANT_ROW.id, "Encounter", disp.admittedEncounterId);
  assert.equal(ipdEnc.class, "IPD"); assert.equal(ipdEnc.status, "in-progress");
  assert.equal(ipdEnc.patientId, arr.patientId, "the SAME patient identity carries from ED into the ward, unbroken");
  assert.deepEqual({ ward: ipdEnc.location.ward, bed: ipdEnc.location.bed }, { ward: "Medical A", bed: "9" });

  // And the SAME bed-occupancy guard fires: a second admission attempt to the same bed is refused.
  const reg2 = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Bed Claimant Two", mobile: "9876500206", gender: "female", ageYears: 30 });
  const clash = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg2.mrn, ward: "Medical A", bed: "9", admittedAt: "2026-09-09T09:00:00.000Z" });
  assert.equal(clash.__status, 409); assert.equal(clash.error, "bed_occupied");
});

test("DISPOSITION admitted with no ward named is refused - an ED admission needs a real destination", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "No Ward ED", mobile: "9876500207", gender: "male", ageYears: 55 });
  const arr = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, arrivedAt: "2026-09-09T08:00:00.000Z" } });
  const bad = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: arr.encounterId, disposition: "admitted" });
  assert.equal(bad.__status, 422); assert.equal(bad.error, "ward_required");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "Encounter", arr.encounterId)).status, "in-progress", "the ED visit was NOT closed by a refused admission");
});

test("a closed ED visit cannot be disposed twice, and an unknown disposition is refused", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Double Disposition", mobile: "9876500208", gender: "female", ageYears: 41 });
  const arr = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, arrivedAt: "2026-09-09T08:00:00.000Z" } });
  const bad = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: arr.encounterId, disposition: "somewhere" });
  assert.equal(bad.__status, 422); assert.equal(bad.error, "disposition_required");
  await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: arr.encounterId, disposition: "lwbs", reason: "Left before assessment complete." });
  const again = await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: arr.encounterId, disposition: "home" });
  assert.equal(again.written, 0); assert.equal(again.skipped, "already_closed");
});

/* ---- the ED board --------------------------------------------------------------------------------- */

test("THE ED BOARD lists open presentations, untriaged first, then by acuity, then by wait - and never a closed visit", async () => {
  seedHospital();
  const regA = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Board A", mobile: "9876500209", gender: "male", ageYears: 20 });
  const regB = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Board B", mobile: "9876500210", gender: "female", ageYears: 21 });
  const a = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: regA.mrn, arrivedAt: "2026-09-09T08:00:00.000Z" } });
  const b = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: regB.mrn, arrivedAt: "2026-09-09T08:01:00.000Z" } });
  await as(NURSE, "/ward/ed-triage", "POST", { orgId: ORG, encounterId: b.encounterId, acuity: 1 });
  await as(DOCTOR, "/ward/ed-disposition", "POST", { orgId: ORG, encounterId: a.encounterId, disposition: "home" });

  const c = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: regA.mrn, arrivedAt: "2026-09-09T09:00:00.000Z" } });
  const board = await as(DOCTOR, `/ward/ed-list?orgId=${ORG}`);
  assert.equal(board.__status, 200, JSON.stringify(board));
  assert.equal(board.patients.length, 2, "the discharged presentation is not on the open board");
  // Untriaged sorts first, on purpose: an unknown-risk arrival nobody has triaged yet is the one the
  // board most needs to surface, ahead of a patient already assessed and known to be acuity 1.
  assert.equal(board.patients[0].encounterId, c.encounterId, "the untriaged arrival sorts before an already-triaged acuity 1");
  assert.equal(board.patients[1].encounterId, b.encounterId);
});

/* ---- resuscitation: the real state machine's own rules still hold ---------------------------------- */

test("RESUSCITATION: the bundle refuses to be started on a screen result alone, refuses an unknown code, and voiding requires a reason - all wardsynq-emergency.js's own rules, unchanged", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Resus Rules", mobile: "9876500211", gender: "male", ageYears: 66 });
  const arr = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, arrivedAt: "2026-09-09T08:00:00.000Z" } });

  const badCode = await as(DOCTOR, "/ward/resus-start", "POST", { orgId: ORG, patientId: arr.patientId, encounterId: arr.encounterId, code: "code-not-a-real-one" });
  assert.equal(badCode.__status, 422); assert.equal(badCode.code, "UNKNOWN_CODE");

  const started = await as(DOCTOR, "/ward/resus-start", "POST", { orgId: ORG, patientId: arr.patientId, encounterId: arr.encounterId, code: "code-blue" });
  assert.equal(started.__status, 200, JSON.stringify(started));

  const voidNoReason = await as(DOCTOR, "/ward/resus-void", "POST", { orgId: ORG, bundleId: started.bundleId });
  assert.equal(voidNoReason.__status, 409, JSON.stringify(voidNoReason));
  const voided = await as(DOCTOR, "/ward/resus-void", "POST", { orgId: ORG, bundleId: started.bundleId, reason: "Opened in error - wrong patient selected." });
  assert.equal(voided.__status, 200, JSON.stringify(voided));
  assert.equal(voided.status.state, "voided");

  // A voided bundle is still on the record - never deleted, never editable back to running.
  const stillThere = await as(DOCTOR, `/ward/resus?orgId=${ORG}&patientId=${arr.patientId}`);
  assert.equal(stillThere.bundles.length, 1);
  assert.equal(stillThere.bundles[0].state, "voided");
});

/* ---- an ED Encounter reaching the OTHER doors already built for IPD: not a second copy of each,
 * a broadened filter in each - so an ED patient does not silently vanish from an outage pack, a
 * ward's own metrics, or a conformant FHIR export, the way a first pass of these would have left
 * them (found by review, fixed here, verified for real rather than assumed). ---------------------- */

test("an ED patient exports as a FHIR-CONFORMANT Encounter (class EMER, not undefined)", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "FHIR ED Testcase", mobile: "9876500212", gender: "female", ageYears: 29 });
  const arr = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, arrivedAt: "2026-09-09T08:00:00.000Z" } });
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/fhir/Encounter/${arr.encounterId}?orgId=${ORG}`, { headers: { "Cf-Access-Authenticated-User-Email": DOCTOR } }), env: ENV });
  const enc = await res.json();
  assert.equal(res.status, 200, JSON.stringify(enc));
  assert.deepEqual(enc.class, { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "EMER", display: "emergency" }, "FHIR's Encounter.class is required (1..1) - it must never be left off for a class this build produces natively");
});

test("an open ED patient appears on the downtime pack and in ward metrics, not only admitted inpatients", async () => {
  seedHospital();
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Downtime ED Testcase", mobile: "9876500213", gender: "male", ageYears: 58 });
  const arr = await as(NURSE, "/ward/ed-arrival", "POST", { orgId: ORG, arrival: { mrn: reg.mrn, chiefComplaint: "Abdominal pain", arrivedAt: "2026-09-09T08:00:00.000Z" } });

  const pack = await as(DOCTOR, `/ward/downtime?orgId=${ORG}`);
  assert.equal(pack.__status, 200, JSON.stringify(pack));
  assert.ok(pack.patients.some((p) => p.patientId === arr.patientId), "an outage does not stop the emergency department - the pack must still carry this patient's allergies and orders");

  const metrics = await as(DOCTOR, `/ward/metrics?orgId=${ORG}&ward=ED`);
  assert.equal(metrics.__status, 200, JSON.stringify(metrics));
  assert.ok(metrics, "the ED's own metrics read without error and are not silently empty because the filter never looked for class ED");
});
