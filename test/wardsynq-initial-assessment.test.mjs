/* test/wardsynq-initial-assessment.test.mjs - NABH KPI 1, time to initial assessment (admission-times.js).
 *
 * POST /api/queue/ward/bed-arrival (the nurse, default now, a change needs a reason), POST /api/queue/ward/initial-assessment
 * (a doctor marks a signed note; the first mark wins; a note signed before the bed arrival is refused without a reason)
 * and GET /api/queue/ward/admission-times; KPI 1 computed from them with missing times counted, never averaged.
 * Negative authorization on each. Same harness shape as wardsynq-discharge-capacity.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-initial-assessment.test.mjs
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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", PHARM = "pharmacy@example.test", CASHIER = "cashier@example.test", DESK = "reception@example.test";
const ENV = {
  QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
};

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [PHARM, "pharmacy"], [CASHIER, "cashier"], [DESK, "reception"]]) {
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

const AT = await import("../functions/_wardsynq/admission-times.js");
const { computeNabhIndicators, monthWindows } = await import("../functions/_wardsynq/compliance.js");
const STRANGER = "stranger@example.test";
const T = TENANT_ROW.id;

async function admitted(suffix, ward, bed) {
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Flow Testcase " + suffix, mobile: "9876522" + suffix, gender: "female", ageYears: 52 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: ward || "Medical A", bed: bed || "1", class: "IPD" });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return adm;
}
const plusDays = (n) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);
const otherHospital = () => {
  docs.set(`q_orgs/org-other`, { fields: { id: "org-other", code: "SMD-OTHER1", name: "Other Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_members/org-other__${sanitize(idFor(STRANGER))}`, { fields: { orgId: "org-other", identity: idFor(STRANGER), role: "doctor", active: true }, updateTime: "t1" });
};
const anon = async (path, body) => (await onRequest({ request: new Request("https://x/api/queue" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), env: ENV })).status;

const KITCHEN = "kitchen@example.test";
const HOUR = 3600000;
const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
const step = (email, encounterId, s, extra) => as(email, "/ward/discharge-milestone", "POST", { orgId: ORG, encounterId, step: s, ...(extra || {}) });
async function signedNote(encounterId, text) {
  const n = await as(DOCTOR, "/ward/note", "POST", { orgId: ORG, templateId: "progress", encounterId, sections: { narrative: text || "Seen on arrival" }, at: new Date().toISOString() });
  assert.equal(n.__status, 200, JSON.stringify(n));
  const s = await as(DOCTOR, "/ward/note-sign", "POST", { orgId: ORG, noteId: n.noteId });
  assert.equal(s.__status, 200, JSON.stringify(s));
  return n.noteId;
}
const arrive = (email, encounterId, extra) => as(email, "/ward/bed-arrival", "POST", { orgId: ORG, encounterId, ...(extra || {}) });
const mark = (email, encounterId, noteId, extra) => as(email, "/ward/initial-assessment", "POST", { orgId: ORG, encounterId, noteId, ...(extra || {}) });

test("KPI 1 PURE: arrival 10:00 and a note signed 10:40 gives 40; a stay with no mark is missing; out of order and day care are not averaged", () => {
  const [W] = monthWindows(Date.parse("2026-09-20T06:00:00.000Z"), 1, 330);
  const enc = (id, cls, start) => ({ id, class: cls, status: "in-progress", periodStart: start || "2026-09-05T04:00:00.000Z" });
  const rec = (encounterId, at, signedAt) => ({ encounterId, bedArrival: at ? { at } : null, initialAssessment: signedAt ? { noteId: "n", signedAt } : null });
  assert.equal(AT.assessmentMinutes(rec("e1", "2026-09-05T10:00:00.000Z", "2026-09-05T10:40:00.000Z")), 40);
  const cell = AT.initialAssessmentCell([
    rec("e1", "2026-09-05T10:00:00.000Z", "2026-09-05T10:40:00.000Z"),
    rec("e2", "2026-09-05T10:00:00.000Z", null),
    rec("e3", "2026-09-05T11:00:00.000Z", "2026-09-05T10:00:00.000Z"),
    rec("e4", "2026-09-05T10:00:00.000Z", "2026-09-05T10:20:00.000Z"),
    rec("e6", "2026-09-05T10:00:00.000Z", "2026-09-05T11:00:00.000Z"),
  ], [enc("e1", "IPD"), enc("e2", "ICU"), enc("e3", "IPD"), enc("e4", "DAYCARE"), enc("e5", "IPD"), enc("e6", "IPD", "2026-08-05T04:00:00.000Z")], W);
  assert.deepEqual([cell.numerator, cell.denominator, cell.value, cell.admissions], [40, 1, 40, 4], "day care and last month's admission left out");
  assert.deepEqual([cell.missingBedArrival, cell.missingInitialAssessment, cell.outOfOrder], [1, 2, 1]);
  assert.deepEqual(cell.missing, [{ encounterId: "e2", missing: ["initialAssessment"] }, { encounterId: "e5", missing: ["bedArrival", "initialAssessment"] }]);
  const k1 = computeNabhIndicators({ rows: { AdmissionTimes: [rec("e1", "2026-09-05T10:00:00.000Z", "2026-09-05T10:40:00.000Z")], Encounter: [enc("e1", "IPD")] }, unreadable: {}, windows: [W] }).find((i) => i.no === 1);
  assert.equal(k1.computable, true, k1.reason); assert.equal(k1.months[0].value, 40);
  assert.equal(computeNabhIndicators({ rows: {}, unreadable: {}, windows: [W] }).find((i) => i.no === 1).months[0].value, null, "no admissions: no average, never zero");
  const blocked = computeNabhIndicators({ rows: {}, unreadable: { AdmissionTimes: "not readable with this role" }, windows: [W] }).find((i) => i.no === 1);
  assert.equal(blocked.computable, false); assert.match(blocked.reason, /could not be read/);
});

test("POST /api/queue/ward/bed-arrival, /api/queue/ward/initial-assessment and GET /api/queue/ward/admission-times: the nurse's arrival, the doctor's mark, first mark wins, a change needs a reason", async () => {
  seedHospital();
  const a = await admitted("501");
  const future = await arrive(NURSE, a.encounterId, { at: new Date(Date.now() + 2 * HOUR).toISOString() });
  assert.equal(future.__status, 422); assert.equal(future.error, "at_in_future");
  const arrived = await arrive(NURSE, a.encounterId, { at: new Date(Date.now() - 40 * 60000).toISOString() });
  assert.equal(arrived.__status, 200, JSON.stringify(arrived)); assert.equal(arrived.minutes, null, "no assessment yet: no number");

  const draft = await as(DOCTOR, "/ward/note", "POST", { orgId: ORG, templateId: "progress", encounterId: a.encounterId, sections: { narrative: "Draft" }, at: ago(0.1) });
  const unsigned = await mark(DOCTOR, a.encounterId, draft.noteId);
  assert.equal(unsigned.__status, 409); assert.equal(unsigned.error, "note_not_signed");
  const noteId = await signedNote(a.encounterId);
  const view0 = await as(NURSE, `/ward/admission-times?orgId=${ORG}&encounterId=${a.encounterId}`);
  assert.equal(view0.__status, 200, JSON.stringify(view0));
  assert.deepEqual(view0.signedNotes.map((n) => n.noteId), [noteId], "only signed notes of the stay are offered");
  const marked = await mark(DOCTOR, a.encounterId, noteId);
  assert.equal(marked.__status, 200, JSON.stringify(marked));
  assert.ok(marked.minutes >= 39 && marked.minutes <= 41, "arrival 40 minutes before the signature: " + marked.minutes);
  const second = await mark(DOCTOR, a.encounterId, await signedNote(a.encounterId, "Later round"));
  assert.equal(second.__status, 409); assert.equal(second.error, "already_marked"); assert.ok(second.detail.includes(noteId), "the existing mark is named");

  const change = await arrive(NURSE, a.encounterId, { at: ago(1), expectedVersion: 2 });
  assert.equal(change.__status, 422); assert.equal(change.error, "reason_required");
  const fixed = await arrive(NURSE, a.encounterId, { at: ago(1), expectedVersion: 2, reason: "Arrival time was entered wrong" });
  assert.equal(fixed.__status, 200, JSON.stringify(fixed)); assert.equal(fixed.revised, true);
  const hist = await RECORD.history(T, "AdmissionTimes", AT.admissionTimesIdFor(a.encounterId));
  assert.equal(hist.length, 3, "every time and every correction is its own version");
  assert.ok(hist[2].bedArrival.previousAt); assert.equal(hist[2].bedArrival.reason, "Arrival time was entered wrong");

  const view = await as(DOCTOR, `/ward/admission-times?orgId=${ORG}&encounterId=${a.encounterId}`);
  assert.equal(view.record.initialAssessment.noteId, noteId); assert.ok(view.minutes >= 59 && view.minutes <= 61);

  const b = await admitted("502", "Medical A", "2");
  const bNote = await signedNote(b.encounterId);
  assert.equal((await arrive(NURSE, b.encounterId, { at: new Date(Date.now() + 60000).toISOString() })).__status, 200, "an arrival a minute after the signature (within the clock allowance)");
  const before = await mark(DOCTOR, b.encounterId, bNote);
  assert.equal(before.__status, 422); assert.equal(before.error, "out_of_order", "a note signed before the bed arrival is refused without a reason");
  assert.equal((await RECORD.history(T, "AdmissionTimes", AT.admissionTimesIdFor(b.encounterId))).length, 1, "nothing written by the refusal");
  const why = await mark(DOCTOR, b.encounterId, bNote, { reason: "Assessed in the emergency department before the bed" });
  assert.equal(why.__status, 200, JSON.stringify(why)); assert.equal(why.initialAssessment.outOfOrder, true); assert.equal(why.minutes, null, "never averaged as a negative");

  const nabh = await as(DOCTOR, `/ward/nabh-indicators?orgId=${ORG}&months=1`);
  assert.equal(nabh.__status, 200, JSON.stringify(nabh).slice(0, 300));
  const k1 = nabh.indicators.find((i) => i.no === 1);
  assert.equal(k1.computable, true, k1.reason);
  assert.equal(k1.months[0].denominator, 1); assert.equal(k1.months[0].outOfOrder, 1);
});

test("NEGATIVE AUTHORIZATION on /api/queue/ward/bed-arrival, /api/queue/ward/initial-assessment and /api/queue/ward/admission-times: no session 401, wrong role 403 with nothing written, another hospital 403", async () => {
  seedHospital(); otherHospital();
  const a = await admitted("503");
  const noteId = await signedNote(a.encounterId);
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(KITCHEN))}`, { fields: { orgId: ORG, identity: idFor(KITCHEN), role: "kitchen", active: true }, updateTime: "t1" });
  assert.equal(await anon("/ward/bed-arrival", { orgId: ORG, encounterId: a.encounterId }), 401);
  assert.equal(await anon("/ward/initial-assessment", { orgId: ORG, encounterId: a.encounterId, noteId }), 401);
  for (const who of [CASHIER, PHARM, KITCHEN, STRANGER]) assert.equal((await arrive(who, a.encounterId)).__status, 403, who);
  for (const who of [NURSE, CASHIER, DESK, KITCHEN, STRANGER]) assert.equal((await mark(who, a.encounterId, noteId)).__status, 403, who);
  assert.equal((await RECORD.latestByType(T, "AdmissionTimes", 10)).length, 0, "nothing written");
  const path = `/ward/admission-times?orgId=${ORG}&encounterId=${a.encounterId}`;
  assert.equal(await anon(path), 401);
  for (const who of [CASHIER, KITCHEN, STRANGER]) assert.equal((await as(who, path)).__status, 403, who);
  assert.equal((await arrive(NURSE, a.encounterId)).__status, 200, "the nurse records the arrival");
  assert.equal((await mark(DOCTOR, a.encounterId, noteId, { reason: "Seen before the bed was ready" })).__status, 200, "the doctor marks the assessment");
});
