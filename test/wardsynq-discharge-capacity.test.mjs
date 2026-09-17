/* test/wardsynq-discharge-capacity.test.mjs - discharge milestones, the transfer centre and the governed forecasts.
 *
 * POST /api/queue/ward/discharge-milestone and GET /api/queue/ward/discharge-progress (each step by its own role, never
 * backwards without a reason, NABH KPI 24 from them); POST /api/queue/ward/transfer-centre-request,
 * transfer-centre-decide, transfer-centre-cancel and GET /api/queue/ward/transfer-centre (an accepted transfer is an
 * admission request, never a bed); GET /api/queue/ward/twin-predict for blood-demand. Negative authorization on each.
 * Same harness shape as wardsynq-stay-flow.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-discharge-capacity.test.mjs
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

const DM = await import("../functions/_wardsynq/discharge-milestones.js");
const TC = await import("../functions/_wardsynq/transfer-centre.js");
const { computeNabhIndicators, monthWindows } = await import("../functions/_wardsynq/compliance.js");
const { dailySamples, governedPrediction } = await import("../functions/_wardsynq/twin-predict.js");
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
function seedBeds() {
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(KITCHEN))}`, { fields: { orgId: ORG, identity: idFor(KITCHEN), role: "kitchen", active: true }, updateTime: "t1" });
  docs.set("q_wards/w-med", { fields: { id: "w-med", orgId: ORG, name: "Medical A", code: "MEDA", type: "general", active: true }, updateTime: "t1" });
  docs.set("q_wards/w-icu", { fields: { id: "w-icu", orgId: ORG, name: "ICU", code: "ICU", type: "icu", active: true }, updateTime: "t1" });
  for (const [id, ward, state] of [["b-m1", "w-med", "available"], ["b-m2", "w-med", "occupied"], ["b-i1", "w-icu", "occupied"]]) {
    docs.set(`q_beds/${id}`, { fields: { id, orgId: ORG, wardId: ward, name: id, state, active: true }, updateTime: "t1" });
  }
}

test("MILESTONES PURE: order conflicts, derived times, NABH minutes less the patient's own delay, median turnaround", () => {
  const t = { advised: 1000, "bill-ready": 5000, left: 9000 };
  assert.deepEqual(DM.orderConflicts("pharmacy-cleared", 500, t), ["advised"]);
  assert.deepEqual(DM.orderConflicts("pharmacy-cleared", 9500, t), ["left"]);
  assert.deepEqual(DM.orderConflicts("advised", 6000, t), ["bill-ready"]);
  assert.deepEqual(DM.orderConflicts("advised", 9500, t), ["bill-ready", "left"]);
  assert.deepEqual(DM.orderConflicts("left", 4000, t), ["bill-ready"]);
  assert.deepEqual(DM.orderConflicts("tpa-final-received", 2000, { advised: 1000, "tpa-final-requested": 3000 }), ["tpa-final-requested"]);
  assert.deepEqual(DM.orderConflicts("bill-ready", 5000, t), []);

  const rec = { milestones: { advised: { at: "2026-09-10T08:00:00.000Z" } } };
  assert.equal(DM.dischargeMinutes(rec, null), null, "no departure, no number");
  const closed = { status: "finished", periodEnd: "2026-09-10T11:00:00.000Z" };
  assert.equal(DM.milestoneTimes(rec, { encounter: closed }).left.source, "stay-closed");
  assert.equal(DM.dischargeMinutes(rec, closed), 180);
  const left = { milestones: { ...rec.milestones, left: { at: "2026-09-10T12:00:00.000Z", patientDelayMinutes: 30 } } };
  assert.equal(DM.dischargeMinutes(left, closed), 210, "the recorded departure wins over the stay's closing time, less 30 minutes the patient asked for");
  assert.equal(DM.milestoneTimes(rec, { encounter: false }).left.source, "unreadable");
  assert.equal(DM.milestoneTimes(rec, { summarySignedAt: false })["summary-signed"].source, "unreadable");
  assert.equal(DM.median([5, 1, 3]), 3); assert.equal(DM.median([]), null);

  const stays = [left, { milestones: { advised: { at: "2026-09-11T08:00:00.000Z" }, "bill-ready": { at: "2026-09-11T09:00:00.000Z" }, left: { at: "2026-09-11T10:00:00.000Z" } } }]
    .map((record) => ({ record, encounter: null, times: DM.milestoneTimes(record, {}) }));
  const tat = DM.turnaround(stays, Date.parse("2026-09-01"), Date.parse("2026-09-30"));
  assert.equal(tat.stays, 2); assert.equal(tat.medianTotalMinutes, 165, "the median of 210 and 120");
  const bill = tat.steps.find((s) => s.step === "bill-ready");
  assert.deepEqual([bill.medianMinutesFromAdvised, bill.stays, bill.notRecorded], [60, 1, 1], "a step nobody recorded is counted as not recorded, never as zero");
});

test("NABH KPI 24 computes from the milestones: advised to left, day care left out, a stay with no advice not counted", () => {
  const [W] = monthWindows(Date.parse("2026-09-20T06:00:00.000Z"), 1, 330);
  const rows = {
    DischargeMilestone: [
      { encounterId: "e1", class: "IPD", milestones: { advised: { at: "2026-09-05T04:00:00.000Z" }, left: { at: "2026-09-05T06:00:00.000Z" } } },
      { encounterId: "e2", class: "IPD", milestones: { advised: { at: "2026-09-06T04:00:00.000Z" } } },
      { encounterId: "e3", class: "DAYCARE", milestones: { advised: { at: "2026-09-06T04:00:00.000Z" }, left: { at: "2026-09-06T14:00:00.000Z" } } },
    ],
    Encounter: [{ id: "e2", class: "IPD", status: "finished", periodEnd: "2026-09-06T08:00:00.000Z" }, { id: "e4", class: "IPD", status: "finished", periodEnd: "2026-09-06T08:00:00.000Z" }],
  };
  const k24 = computeNabhIndicators({ rows, unreadable: {}, windows: [W] }).find((i) => i.no === 24);
  assert.equal(k24.computable, true, k24.reason);
  assert.deepEqual([k24.months[0].numerator, k24.months[0].denominator, k24.months[0].value], [360, 2, 180], "120 minutes recorded, 240 to the stay's closing time");
  const blocked = computeNabhIndicators({ rows, unreadable: { DischargeMilestone: "not readable with this role" }, windows: [W] }).find((i) => i.no === 24);
  assert.equal(blocked.computable, false); assert.match(blocked.reason, /could not be read/);
  assert.equal(computeNabhIndicators({ rows: {}, unreadable: {}, windows: [W] }).find((i) => i.no === 24).months[0].value, null, "no discharges: no average, never zero");
});

test("MILESTONES POST /api/queue/ward/discharge-milestone and GET /api/queue/ward/discharge-progress: each role its own step, never backwards without a reason, the signed summary derived, turnaround on the board", async () => {
  seedHospital();
  const a = await admitted("401");
  const first = await step(PHARM, a.encounterId, "pharmacy-cleared", { at: ago(4) });
  assert.equal(first.__status, 409); assert.equal(first.error, "not_advised", "advice comes first");
  const derived = await step(DOCTOR, a.encounterId, "summary-signed");
  assert.equal(derived.__status, 422); assert.equal(derived.error, "derived_step");
  const future = await step(DOCTOR, a.encounterId, "advised", { at: new Date(Date.now() + 2 * HOUR).toISOString() });
  assert.equal(future.__status, 422); assert.equal(future.error, "at_in_future");

  const adv = await step(DOCTOR, a.encounterId, "advised", { at: ago(5) });
  assert.equal(adv.__status, 200, JSON.stringify(adv)); assert.equal(adv.version, 1);
  const back = await step(PHARM, a.encounterId, "pharmacy-cleared", { at: ago(6) });
  assert.equal(back.__status, 422); assert.equal(back.error, "out_of_order"); assert.deepEqual(back.conflicts, ["advised"]);
  const backWhy = await step(PHARM, a.encounterId, "pharmacy-cleared", { at: ago(6), reason: "Returns were cleared before the round" });
  assert.equal(backWhy.__status, 200, JSON.stringify(backWhy)); assert.deepEqual(backWhy.outOfOrder, ["advised"]);
  const fix = await step(PHARM, a.encounterId, "pharmacy-cleared", { at: ago(4), expectedVersion: 2 });
  assert.equal(fix.__status, 422); assert.equal(fix.error, "reason_required", "a recorded time changes only with a reason");
  const fixed = await step(PHARM, a.encounterId, "pharmacy-cleared", { at: ago(4), expectedVersion: 2, reason: "Wrong time entered at first" });
  assert.equal(fixed.__status, 200, JSON.stringify(fixed)); assert.equal(fixed.revised, true);
  assert.equal((await step(CASHIER, a.encounterId, "bill-ready", { at: ago(3.5) })).__status, 200);
  assert.equal((await step(CASHIER, a.encounterId, "tpa-final-requested", { at: ago(3) })).__status, 200);
  const early = await step(CASHIER, a.encounterId, "tpa-final-received", { at: ago(3.2) });
  assert.equal(early.__status, 422); assert.deepEqual(early.conflicts, ["tpa-final-requested"]);
  assert.equal((await step(CASHIER, a.encounterId, "tpa-final-received", { at: ago(2) })).__status, 200);
  const delay = await step(NURSE, a.encounterId, "left", { at: ago(1), patientDelayMinutes: 600 });
  assert.equal(delay.__status, 422); assert.equal(delay.error, "delay_invalid");
  const gone = await step(NURSE, a.encounterId, "left", { at: ago(1), patientDelayMinutes: 20 });
  assert.equal(gone.__status, 200, JSON.stringify(gone));
  const hist = await RECORD.history(T, "DischargeMilestone", DM.dmsIdFor(a.encounterId));
  assert.equal(hist.length, 7,"every step and every correction is its own version");
  const cur = hist[hist.length - 1];
  assert.equal(cur.milestones["pharmacy-cleared"].reason, "Wrong time entered at first");
  assert.ok(cur.milestones["pharmacy-cleared"].previousAt);
  assert.equal(cur.milestones.left.patientDelayMinutes, 20);

  const signed = await as(DOCTOR, "/ward/sign-discharge-summary", "POST", { orgId: ORG, encounterId: a.encounterId });
  assert.equal(signed.__status, 200, JSON.stringify(signed));
  const b = await admitted("402", "Medical A", "2");
  assert.equal((await step(DOCTOR, b.encounterId, "advised", { at: ago(2) })).__status, 200);

  const board = await as(NURSE, `/ward/discharge-progress?orgId=${ORG}`);
  assert.equal(board.__status, 200, JSON.stringify(board));
  assert.deepEqual(board.inProgress.map((s) => s.encounterId), [b.encounterId], "a stay that has left is off the board");
  assert.equal(board.inProgress[0].name, "Flow Testcase 402");
  assert.ok(board.inProgress[0].minutesSinceAdvised >= 119);
  assert.equal(board.inProgress[0].steps.find((s) => s.step === "bill-ready").at, null, "not recorded is null, never a time");
  assert.equal(board.turnaround.stays, 1);
  assert.equal(board.turnaround.medianTotalMinutes, 220, "240 minutes less the 20 the patient asked for");
  assert.deepEqual((({ medianMinutesFromAdvised, stays }) => ({ medianMinutesFromAdvised, stays }))(board.turnaround.steps.find((s) => s.step === "bill-ready")), { medianMinutesFromAdvised: 90, stays: 1 });
  assert.equal(board.turnaround.steps.find((s) => s.step === "summary-signed").stays, 1, "the signature is read from the signed summary");

  const cashierBoard = await as(CASHIER, `/ward/discharge-progress?orgId=${ORG}`);
  assert.equal(cashierBoard.__status, 200, JSON.stringify(cashierBoard));
  assert.equal(cashierBoard.unreadable.summaries, true, "the billing desk cannot read the summary: said, not shown as unsigned");
  assert.equal(cashierBoard.inProgress[0].steps.find((s) => s.step === "summary-signed").source, "unreadable");
  assert.equal(cashierBoard.inProgress[0].name, null, "and no name it may not read");
});

test("NEGATIVE AUTHORIZATION on /api/queue/ward/discharge-milestone and /api/queue/ward/discharge-progress: no session 401, the wrong role for a step 403 with nothing written, another hospital 403", async () => {
  seedHospital(); otherHospital();
  const a = await admitted("403");
  seedBeds();
  const body = (s) => ({ orgId: ORG, encounterId: a.encounterId, step: s });
  assert.equal(await anon("/ward/discharge-milestone", body("advised")), 401);
  for (const [who, s] of [[NURSE, "advised"], [PHARM, "advised"], [CASHIER, "advised"], [STRANGER, "advised"], [DESK, "advised"]]) {
    assert.equal((await as(who, "/ward/discharge-milestone", "POST", body(s))).__status, 403, who + " " + s);
  }
  assert.equal((await RECORD.latestByType(T, "DischargeMilestone", 10)).length, 0, "nothing written");
  assert.equal((await as(DOCTOR, "/ward/discharge-milestone", "POST", body("advised"))).__status, 200);
  for (const [who, s] of [[NURSE, "pharmacy-cleared"], [PHARM, "bill-ready"], [NURSE, "tpa-final-received"], [CASHIER, "left"], [PHARM, "left"], [STRANGER, "left"]]) {
    assert.equal((await as(who, "/ward/discharge-milestone", "POST", body(s))).__status, 403, who + " " + s);
  }
  assert.equal((await RECORD.history(T, "DischargeMilestone", DM.dmsIdFor(a.encounterId))).length, 1, "no refused step was written");
  const unknown = await as(NURSE, "/ward/discharge-milestone", "POST", body("teleported"));
  assert.equal(unknown.__status, 403, "a step that names no holder takes the strictest gate");

  const path = `/ward/discharge-progress?orgId=${ORG}`;
  assert.equal(await anon(path), 401);
  assert.equal((await as(STRANGER, path)).__status, 403, "other hospital");
  assert.equal((await as(KITCHEN, path)).__status, 403, "a role whose record grant does not reach discharges");
  assert.equal((await as(PHARM, path)).__status, 200, "pharmacy reads the board it records on");
});

test("TRANSFER CENTRE PURE: time to decision, capacity by ward (unreadable is null, not zero), identity mismatch", () => {
  assert.equal(TC.minutesToDecision({ receivedAt: "2026-09-10T08:00:00.000Z", decidedAt: "2026-09-10T08:45:00.000Z" }), 45);
  assert.equal(TC.minutesToDecision({ receivedAt: "2026-09-10T08:00:00.000Z" }), null);
  const cap = TC.capacityFrom([{ id: "w1", name: "Medical A" }], [{ wardId: "w1", state: "available" }, { wardId: "w1", state: "cleaning" }, { wardId: "w1", state: "occupied", active: false }], 3, "t");
  assert.deepEqual(cap.wards, [{ ward: "Medical A", type: "general", available: 1, reserved: 0, occupied: 0, other: 1, total: 2 }]);
  assert.equal(cap.bedsAvailable, 1); assert.equal(cap.waitingForBed, 3);
  const blind = TC.capacityFrom([], null, null, "t");
  assert.equal(blind.wards, null); assert.equal(blind.bedsAvailable, null); assert.equal(blind.waitingForBed, null);
  const now = Date.parse("2026-09-17T00:00:00.000Z");
  assert.deepEqual(TC.identityMismatch({ sex: "male", ageYears: 50 }, { sex: "female", dob: "1976-01-01" }, now), ["sex"]);
  assert.deepEqual(TC.identityMismatch({ sex: "female", ageYears: 30 }, { sex: "F", dob: "1976-01-01" }, now), ["age"]);
  assert.deepEqual(TC.identityMismatch({ sex: null, ageYears: null }, { sex: "female" }, now), []);
});

test("TRANSFER CENTRE POST /api/queue/ward/transfer-centre-request, transfer-centre-decide, transfer-centre-cancel and GET /api/queue/ward/transfer-centre: the call, a decline with the capacity of that moment, an acceptance that is an admission request and never a bed", async () => {
  seedHospital(); seedBeds();
  const call = { orgId: ORG, facility: "Sai Nursing Home", contactName: "Dr Rao", contactPhone: "9800000001", facilityRef: "SNH-22", ageYears: 50, sex: "male",
    clinicalSummary: "Inferior STEMI, thrombolysed at 06:10, ongoing pain", requestedService: "Cardiology", requestedUnit: "icu", urgency: "emergency", receivedAt: ago(1) };
  const noSummary = await as(DESK, "/ward/transfer-centre-request", "POST", { ...call, clinicalSummary: "" });
  assert.equal(noSummary.__status, 422); assert.equal(noSummary.error, "summary_required");
  const r1 = await as(DESK, "/ward/transfer-centre-request", "POST", call);
  assert.equal(r1.__status, 200, JSON.stringify(r1)); assert.equal(r1.status, "requested");
  const stored = await RECORD.latest(T, "TransferCentreRequest", r1.requestId);
  assert.equal(stored.patientId, null, "a phone call makes no patient record");
  assert.equal((await RECORD.latestByType(T, "Patient", 10)).length, 0);

  const list = await as(NURSE, `/ward/transfer-centre?orgId=${ORG}`);
  assert.equal(list.__status, 200, JSON.stringify(list));
  assert.equal(list.open.length, 1); assert.ok(list.open[0].minutesWaiting >= 59);
  assert.equal(list.capacityNow.bedsAvailable, 1);
  assert.deepEqual(list.capacityNow.wards.map((w) => [w.ward, w.available, w.occupied]), [["Medical A", 1, 1], ["ICU", 0, 1]]);

  const noMrn = await as(DOCTOR, "/ward/transfer-centre-decide", "POST", { orgId: ORG, requestId: r1.requestId, decision: "accept", expectedVersion: 1 });
  assert.equal(noMrn.__status, 422); assert.equal(noMrn.error, "mrn_required");
  const notReg = await as(DOCTOR, "/ward/transfer-centre-decide", "POST", { orgId: ORG, requestId: r1.requestId, decision: "accept", mrn: "NOPE-1", expectedVersion: 1 });
  assert.equal(notReg.__status, 404); assert.equal(notReg.error, "patient_not_found");
  const reg = await as(DESK, "/patient/register", "POST", { orgId: ORG, name: "Transfer Testcase", mobile: "9876500411", gender: "female", ageYears: 50 });
  assert.ok(reg.mrn, JSON.stringify(reg));
  const mismatch = await as(DOCTOR, "/ward/transfer-centre-decide", "POST", { orgId: ORG, requestId: r1.requestId, decision: "accept", mrn: reg.mrn, expectedVersion: 1 });
  assert.equal(mismatch.__status, 409); assert.equal(mismatch.error, "identity_mismatch"); assert.deepEqual(mismatch.mismatch, ["sex"]);
  assert.equal((await RECORD.latestByType(T, "AdmissionRequest", 10)).length, 0, "nothing on the waiting list yet");
  const stale = await as(DOCTOR, "/ward/transfer-centre-decide", "POST", { orgId: ORG, requestId: r1.requestId, decision: "accept", mrn: reg.mrn, identityConfirmed: true, expectedVersion: 0 });
  assert.equal(stale.__status, 409); assert.equal(stale.error, "version_conflict");
  const accepted = await as(DOCTOR, "/ward/transfer-centre-decide", "POST", { orgId: ORG, requestId: r1.requestId, decision: "accept", mrn: reg.mrn, identityConfirmed: true, expectedVersion: 1 });
  assert.equal(accepted.__status, 200, JSON.stringify(accepted));
  assert.equal(accepted.bedReserved, false); assert.ok(accepted.minutesToDecision >= 59);
  assert.equal(accepted.capacityAtDecision.bedsAvailable, 1);
  const adm = await RECORD.latest(T, "AdmissionRequest", accepted.admissionRequestId);
  assert.equal(adm.state, "waiting"); assert.equal(adm.urgency, "emergency"); assert.match(adm.reason, /^Inbound transfer from Sai Nursing Home/);
  assert.equal(docs.get("q_beds/b-m1").fields.state, "available", "no bed was reserved");
  const done = await RECORD.latest(T, "TransferCentreRequest", r1.requestId);
  assert.equal(done.status, "accepted"); assert.equal(done.identityConfirmed.mismatch[0], "sex"); assert.equal(done.capacityAtDecision.wards.length, 2);
  const again = await as(DOCTOR, "/ward/transfer-centre-decide", "POST", { orgId: ORG, requestId: r1.requestId, decision: "decline", reason: "Changed my mind", expectedVersion: 2 });
  assert.equal(again.__status, 409); assert.equal(again.error, "wrong_state");
  const waiting = await as(NURSE, `/ward/waiting-list?orgId=${ORG}`);
  assert.equal(waiting.requests.length, 1, "the accepted transfer waits on the ordinary list");

  const r2 = await as(DESK, "/ward/transfer-centre-request", "POST", { ...call, facility: "City Clinic", urgency: "routine", receivedAt: undefined });
  const noWhy = await as(DOCTOR, "/ward/transfer-centre-decide", "POST", { orgId: ORG, requestId: r2.requestId, decision: "decline", expectedVersion: 1 });
  assert.equal(noWhy.__status, 422); assert.equal(noWhy.error, "reason_required");
  const declined = await as(DOCTOR, "/ward/transfer-centre-decide", "POST", { orgId: ORG, requestId: r2.requestId, decision: "decline", reason: "No ICU bed; advised the nearest cath lab", expectedVersion: 1 });
  assert.equal(declined.__status, 200, JSON.stringify(declined)); assert.equal(declined.capacityAtDecision.wards[1].available, 0);
  const r3 = await as(DESK, "/ward/transfer-centre-request", "POST", { ...call, facility: "Town Hospital", receivedAt: undefined });
  const cancelled = await as(DESK, "/ward/transfer-centre-cancel", "POST", { orgId: ORG, requestId: r3.requestId, reason: "Family took the patient elsewhere", expectedVersion: 1 });
  assert.equal(cancelled.__status, 200, JSON.stringify(cancelled));

  const after = await as(DOCTOR, `/ward/transfer-centre?orgId=${ORG}`);
  assert.equal(after.open.length, 0);
  assert.deepEqual([after.summary.accepted, after.summary.declined, after.summary.cancelled], [1, 1, 1]);
  assert.ok(after.summary.medianMinutesToDecision != null);
  assert.equal(after.decided.find((q) => q.status === "accepted").name, "Transfer Testcase");
});

test("NEGATIVE AUTHORIZATION on /api/queue/ward/transfer-centre-request, transfer-centre-decide, transfer-centre-cancel and transfer-centre: no session 401, wrong role 403 with nothing written, another hospital 403", async () => {
  seedHospital(); seedBeds(); otherHospital();
  const call = { orgId: ORG, facility: "Sai Nursing Home", clinicalSummary: "Sepsis, needs ventilation", requestedService: "Critical care", urgency: "urgent" };
  assert.equal(await anon("/ward/transfer-centre-request", call), 401);
  for (const who of [PHARM, CASHIER, STRANGER]) assert.equal((await as(who, "/ward/transfer-centre-request", "POST", call)).__status, 403, who);
  assert.equal((await RECORD.latestByType(T, "TransferCentreRequest", 10)).length, 0, "nothing written");
  const r = await as(NURSE, "/ward/transfer-centre-request", "POST", call);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const decide = { orgId: ORG, requestId: r.requestId, decision: "decline", reason: "No ventilator free", expectedVersion: 1 };
  const cancel = { orgId: ORG, requestId: r.requestId, reason: "Withdrawn by caller", expectedVersion: 1 };
  assert.equal(await anon("/ward/transfer-centre-decide", decide), 401);
  assert.equal(await anon("/ward/transfer-centre-cancel", cancel), 401);
  for (const who of [NURSE, DESK, PHARM, CASHIER, STRANGER]) assert.equal((await as(who, "/ward/transfer-centre-decide", "POST", decide)).__status, 403, "decide " + who);
  for (const who of [PHARM, CASHIER, STRANGER]) assert.equal((await as(who, "/ward/transfer-centre-cancel", "POST", cancel)).__status, 403, "cancel " + who);
  assert.equal((await RECORD.history(T, "TransferCentreRequest", r.requestId)).length, 1, "no refused answer was written");
  const path = `/ward/transfer-centre?orgId=${ORG}`;
  assert.equal(await anon(path), 401);
  for (const who of [PHARM, CASHIER, STRANGER]) assert.equal((await as(who, path)).__status, 403, "list " + who);
  assert.equal((await as(DOCTOR, "/ward/transfer-centre-decide", "POST", decide)).__status, 200);
});

test("FORECAST PURE: whole days zero-filled from the first event to yesterday, today left out, no event is no samples; the envelope carries its inputs", () => {
  const now = Date.parse("2026-09-17T10:00:00.000Z");
  const ev = (iso, weight) => ({ atMs: Date.parse(iso), weight });
  const s = dailySamples([ev("2026-09-13T05:00:00.000Z", 2), ev("2026-09-15T23:00:00.000Z"), ev("2026-09-17T01:00:00.000Z"), ev("2026-08-01T00:00:00.000Z")], now - 14 * 86400000, now);
  assert.deepEqual(s.map((x) => [x.atIso.slice(0, 10), x.value]), [["2026-09-13", 2], ["2026-09-14", 0], ["2026-09-15", 1], ["2026-09-16", 0]]);
  assert.deepEqual(dailySamples([ev("2026-09-17T01:00:00.000Z")], now - 14 * 86400000, now), [], "only today: nothing to average");
  const p = governedPrediction({ metric: "x", samples: s, method: "mean of things" });
  assert.equal(p.prediction.pointEstimate, 0.75);
  assert.equal(p.prediction.method, "mean of things");
  assert.deepEqual(p.prediction.inputs.map((x) => x.value), [2, 0, 1, 0]);
});
