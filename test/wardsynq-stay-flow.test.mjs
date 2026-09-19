/* test/wardsynq-stay-flow.test.mjs - the expected discharge date and the transfer request workflow, through the REAL routes.
 *
 * POST /api/queue/ward/expected-discharge, GET /api/queue/ward/expected-discharge-history, the date on GET /api/queue/ward/list
 * and GET /api/queue/ward/patient-flow (overdue on the hospital's clock); POST /api/queue/ward/transfer-request,
 * transfer-respond, transfer-assign-bed, transfer-execute (through /ward/transfer's own checks), transfer-cancel and
 * GET /api/queue/ward/transfer-requests; negative authorization on each. Same harness shape as wardsynq-surgery.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-stay-flow.test.mjs
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

const { hospitalToday, isoDate, eddStatus } = await import("../functions/_wardsynq/expected-discharge.js");
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

test("EXPECTED DISCHARGE PURE: today on the hospital's clock (zone, else offset), real dates only, overdue once the date has passed", () => {
  const at = Date.parse("2026-09-16T20:00:00.000Z");
  assert.equal(hospitalToday(at, { offsetMinutes: 330 }), "2026-09-17", "01:30 IST is already the next day in India");
  assert.equal(hospitalToday(at, {}), "2026-09-17", "IST when nothing is configured");
  assert.equal(hospitalToday(at, { timeZone: "America/New_York", offsetMinutes: 330 }), "2026-09-16", "a configured zone wins over the offset");
  assert.equal(hospitalToday(at, { timeZone: "Not/AZone", offsetMinutes: 0 }), "2026-09-16", "an unusable zone falls back to the offset");
  assert.equal(isoDate("2026-02-30"), null); assert.equal(isoDate("18/09/2026"), null); assert.equal(isoDate("2026-09-18"), "2026-09-18");
  assert.equal(eddStatus(null, "2026-09-17"), null);
  assert.deepEqual([eddStatus({ expectedDate: "2026-09-16" }, "2026-09-17").overdue, eddStatus({ expectedDate: "2026-09-17" }, "2026-09-17").dueToday, eddStatus({ expectedDate: "2026-09-18" }, "2026-09-17").overdue], [true, true, false]);
});

test("EXPECTED DISCHARGE POST /api/queue/ward/expected-discharge and GET /api/queue/ward/expected-discharge-history: set, revise only with a reason and the version, history kept, shown on GET /api/queue/ward/list with overdue", async () => {
  seedHospital();
  const adm = await admitted("301");
  const list0 = await as(NURSE, `/ward/list?orgId=${ORG}`);
  assert.equal(list0.patients.find((p) => p.encounterId === adm.encounterId).expectedDischarge, null, "none set is null, not a date");

  const past = await as(DOCTOR, "/ward/expected-discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, expectedDate: plusDays(-1) });
  assert.equal(past.__status, 422); assert.equal(past.error, "date_in_past");
  const bad = await as(DOCTOR, "/ward/expected-discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, expectedDate: "next week" });
  assert.equal(bad.__status, 422); assert.equal(bad.error, "date_required");

  const set = await as(DOCTOR, "/ward/expected-discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, expectedDate: plusDays(3) });
  assert.equal(set.__status, 200, JSON.stringify(set)); assert.equal(set.version, 1);
  const noReason = await as(DOCTOR, "/ward/expected-discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, expectedDate: plusDays(5), expectedVersion: 1 });
  assert.equal(noReason.__status, 422); assert.equal(noReason.error, "reason_required");
  const noVersion = await as(DOCTOR, "/ward/expected-discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, expectedDate: plusDays(5), reason: "Awaiting culture results" });
  assert.equal(noVersion.__status, 422); assert.equal(noVersion.error, "expected_version_required");
  const stale = await as(DOCTOR, "/ward/expected-discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, expectedDate: plusDays(5), reason: "Awaiting culture results", expectedVersion: 0 });
  assert.equal(stale.__status, 409);
  const same = await as(DOCTOR, "/ward/expected-discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, expectedDate: plusDays(3), reason: "Just confirming it", expectedVersion: 1 });
  assert.equal(same.__status, 409); assert.equal(same.error, "unchanged");
  const revised = await as(DOCTOR, "/ward/expected-discharge", "POST", { orgId: ORG, encounterId: adm.encounterId, expectedDate: plusDays(5), reason: "Awaiting culture results", expectedVersion: 1 });
  assert.equal(revised.__status, 200, JSON.stringify(revised)); assert.equal(revised.version, 2); assert.equal(revised.revised, true);

  const hist = await as(NURSE, `/ward/expected-discharge-history?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(hist.__status, 200, JSON.stringify(hist));
  assert.deepEqual(hist.history.map((h) => h.expectedDate), [plusDays(5), plusDays(3)], "newest first, the first date kept");
  assert.equal(hist.current.date, plusDays(5)); assert.equal(hist.current.reason, "Awaiting culture results"); assert.equal(hist.current.overdue, false);
  assert.equal(hist.history[0].previous.expectedDate, plusDays(3)); assert.equal(hist.history[0].setBy, revised.actor);

  // A date that has passed with the stay still open reads as overdue on the ward list and the command center.
  const cur = await RECORD.latest(T, "ExpectedDischarge", "wsq-edd-" + adm.encounterId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
  await RECORD.append(T, [{ ...cur, version: cur.version + 1, expectedDate: "2026-01-02" }]);
  const list1 = await as(NURSE, `/ward/list?orgId=${ORG}`);
  assert.deepEqual((({ date, overdue }) => ({ date, overdue }))(list1.patients.find((p) => p.encounterId === adm.encounterId).expectedDischarge), { date: "2026-01-02", overdue: true });
  const flow = await as(DOCTOR, `/ward/patient-flow?orgId=${ORG}`);
  assert.equal(flow.__status, 200, JSON.stringify(flow));
  assert.equal(flow.flow.overdueDischarges.length, 1); assert.equal(flow.flow.overdueDischarges[0].encounterId, adm.encounterId);
  assert.equal(flow.flow.overdueDischarges[0].name, "Flow Testcase 301");
});

test("TRANSFER WORKFLOW: request -> accept -> bed assigned -> executed through the transfer route; visible to both wards while open; one open request per stay", async () => {
  seedHospital();
  const adm = await admitted("302", "Medical A", "3");
  const nurseAsks = await as(NURSE, "/ward/transfer-request", "POST", { orgId: ORG, encounterId: adm.encounterId, toUnit: "ward", toWard: "Surgical B", reason: "Needs surgical review", urgency: "urgent" });
  assert.equal(nurseAsks.__status, 403, "asking is a clinical decision");
  const noReason = await as(DOCTOR, "/ward/transfer-request", "POST", { orgId: ORG, encounterId: adm.encounterId, toUnit: "ward", toWard: "Surgical B", urgency: "urgent" });
  assert.equal(noReason.__status, 422); assert.equal(noReason.error, "reason_required");
  const req = await as(DOCTOR, "/ward/transfer-request", "POST", { orgId: ORG, encounterId: adm.encounterId, toUnit: "ward", toWard: "Surgical B", toBed: "5", reason: "Needs surgical review", urgency: "urgent" });
  assert.equal(req.__status, 200, JSON.stringify(req)); assert.equal(req.status, "requested");
  const dup = await as(DOCTOR, "/ward/transfer-request", "POST", { orgId: ORG, encounterId: adm.encounterId, toUnit: "icu", toWard: "ICU", reason: "Second thoughts", urgency: "routine" });
  assert.equal(dup.__status, 409); assert.equal(dup.error, "transfer_already_requested");

  for (const w of ["Medical A", "Surgical B"]) {
    const board = await as(NURSE, `/ward/transfer-requests?orgId=${ORG}&ward=${encodeURIComponent(w)}`);
    assert.equal(board.__status, 200, JSON.stringify(board));
    assert.equal(board.requests.length, 1, w + " sees the request"); assert.equal(board.requests[0].name, "Flow Testcase 302");
  }
  assert.equal((await as(NURSE, `/ward/transfer-requests?orgId=${ORG}&ward=Other`)).requests.length, 0);
  const flow = await as(DOCTOR, `/ward/patient-flow?orgId=${ORG}`);
  assert.equal(flow.flow.pendingTransfers.length, 1); assert.equal(flow.flow.pendingTransfers[0].to.ward, "Surgical B");

  const early = await as(NURSE, "/ward/transfer-execute", "POST", { orgId: ORG, requestId: req.requestId, expectedVersion: 1 });
  assert.equal(early.__status, 409); assert.equal(early.error, "wrong_state");
  const accepted = await as(NURSE, "/ward/transfer-respond", "POST", { orgId: ORG, requestId: req.requestId, decision: "accept", expectedVersion: 1 });
  assert.equal(accepted.__status, 200, JSON.stringify(accepted)); assert.equal(accepted.status, "accepted"); assert.equal(accepted.version, 2);
  const staleAnswer = await as(NURSE, "/ward/transfer-assign-bed", "POST", { orgId: ORG, requestId: req.requestId, bed: "5", expectedVersion: 1 });
  assert.equal(staleAnswer.__status, 409); assert.equal(staleAnswer.error, "version_conflict");
  const bed = await as(NURSE, "/ward/transfer-assign-bed", "POST", { orgId: ORG, requestId: req.requestId, bed: "5", expectedVersion: 2 });
  assert.equal(bed.__status, 200, JSON.stringify(bed)); assert.equal(bed.status, "bed-assigned");

  const done = await as(NURSE, "/ward/transfer-execute", "POST", { orgId: ORG, requestId: req.requestId, expectedVersion: 3 });
  assert.equal(done.__status, 200, JSON.stringify(done)); assert.equal(done.status, "completed"); assert.equal(done.transferred, true);
  const enc = await RECORD.latest(T, "Encounter", adm.encounterId);
  assert.equal(enc.location.ward, "Surgical B"); assert.equal(enc.location.bed, "5"); assert.equal(enc.movedFrom.ward, "Medical A");
  assert.match(enc.moveReason, /Needs surgical review/);
  const history = await RECORD.history(T, "TransferRequest", req.requestId);
  assert.deepEqual(history.map((h) => h.status), ["requested", "accepted", "bed-assigned", "completed"], "every step is its own version");
  assert.equal((await as(NURSE, `/ward/transfer-requests?orgId=${ORG}&ward=Surgical%20B`)).requests.length, 0, "a completed request leaves the boards");
  const mine = await as(NURSE, `/ward/transfer-requests?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(mine.requests[0].status, "completed", "the stay's own list keeps it");
});

test("TRANSFER refusals: decline and cancel need a reason; a patient moved since the request, or a bed taken, is refused and the request stays open", async () => {
  seedHospital();
  const a = await admitted("303", "Medical A", "7");
  const r1 = await as(DOCTOR, "/ward/transfer-request", "POST", { orgId: ORG, encounterId: a.encounterId, toUnit: "icu", toWard: "ICU", reason: "Rising oxygen need", urgency: "emergency" });
  const noWhy = await as(NURSE, "/ward/transfer-respond", "POST", { orgId: ORG, requestId: r1.requestId, decision: "decline", expectedVersion: 1 });
  assert.equal(noWhy.__status, 422); assert.equal(noWhy.error, "reason_required");
  const declined = await as(NURSE, "/ward/transfer-respond", "POST", { orgId: ORG, requestId: r1.requestId, decision: "decline", reason: "No ICU bed; review in 2 hours", expectedVersion: 1 });
  assert.equal(declined.__status, 200, JSON.stringify(declined)); assert.equal(declined.status, "declined");
  const late = await as(NURSE, "/ward/transfer-respond", "POST", { orgId: ORG, requestId: r1.requestId, decision: "accept", expectedVersion: 2 });
  assert.equal(late.__status, 409); assert.equal(late.error, "wrong_state");

  // Moved by a direct transfer after the bed was assigned: the request no longer describes where the patient is.
  const r2 = await as(DOCTOR, "/ward/transfer-request", "POST", { orgId: ORG, encounterId: a.encounterId, toUnit: "ward", toWard: "Surgical B", reason: "Needs surgical review", urgency: "routine" });
  assert.equal(r2.__status, 200, "a declined request is closed, so a new one can be made: " + JSON.stringify(r2));
  await as(NURSE, "/ward/transfer-respond", "POST", { orgId: ORG, requestId: r2.requestId, decision: "accept", expectedVersion: 1 });
  await as(NURSE, "/ward/transfer-assign-bed", "POST", { orgId: ORG, requestId: r2.requestId, bed: "9", expectedVersion: 2 });
  await as(NURSE, "/ward/transfer", "POST", { orgId: ORG, encounterId: a.encounterId, ward: "Medical A", bed: "8", reason: "Bay change" });
  const moved = await as(NURSE, "/ward/transfer-execute", "POST", { orgId: ORG, requestId: r2.requestId, expectedVersion: 3 });
  assert.equal(moved.__status, 409); assert.equal(moved.error, "moved_since_request");
  assert.equal((await RECORD.latest(T, "TransferRequest", r2.requestId)).status, "bed-assigned", "nothing written");
  const noCancelWhy = await as(NURSE, "/ward/transfer-cancel", "POST", { orgId: ORG, requestId: r2.requestId, expectedVersion: 3 });
  assert.equal(noCancelWhy.__status, 422);
  const cancelled = await as(NURSE, "/ward/transfer-cancel", "POST", { orgId: ORG, requestId: r2.requestId, reason: "Moved within the ward instead", expectedVersion: 3 });
  assert.equal(cancelled.__status, 200, JSON.stringify(cancelled)); assert.equal(cancelled.status, "cancelled");

  // The assigned bed is taken by the time of the move: the transfer route's own refusal, the request still open.
  const b = await admitted("304", "Surgical B", "4");
  const r3 = await as(DOCTOR, "/ward/transfer-request", "POST", { orgId: ORG, encounterId: a.encounterId, toUnit: "ward", toWard: "Surgical B", reason: "Needs surgical review", urgency: "routine" });
  await as(NURSE, "/ward/transfer-respond", "POST", { orgId: ORG, requestId: r3.requestId, decision: "accept", expectedVersion: 1 });
  await as(NURSE, "/ward/transfer-assign-bed", "POST", { orgId: ORG, requestId: r3.requestId, bed: "4", expectedVersion: 2 });
  const taken = await as(NURSE, "/ward/transfer-execute", "POST", { orgId: ORG, requestId: r3.requestId, expectedVersion: 3 });
  assert.equal(taken.__status, 409); assert.equal(taken.error, "bed_occupied"); assert.equal(taken.transferred, false);
  assert.equal((await RECORD.latest(T, "TransferRequest", r3.requestId)).status, "bed-assigned");
  assert.equal((await RECORD.latest(T, "Encounter", a.encounterId)).location.bed, "8", "the patient did not move");
  assert.equal((await RECORD.latest(T, "Encounter", b.encounterId)).location.bed, "4");
});

test("NEGATIVE AUTHORIZATION on /api/queue/ward/expected-discharge, expected-discharge-history, transfer-request, transfer-respond, transfer-assign-bed, transfer-execute, transfer-cancel, transfer-requests: no session 401, wrong role 403 with nothing written, another hospital 403", async () => {
  seedHospital(); otherHospital();
  const adm = await admitted("305");
  const eddBody = { orgId: ORG, encounterId: adm.encounterId, expectedDate: plusDays(2) };
  const reqBody = { orgId: ORG, encounterId: adm.encounterId, toUnit: "ward", toWard: "Surgical B", reason: "Needs surgical review", urgency: "routine" };
  for (const [path, body] of [["/ward/expected-discharge", eddBody], ["/ward/transfer-request", reqBody]]) {
    assert.equal(await anon(path, body), 401, path);
    assert.equal((await as(NURSE, path, "POST", body)).__status, 403, path + " nurse");
    assert.equal((await as(PHARM, path, "POST", body)).__status, 403, path + " pharmacy");
    assert.equal((await as(STRANGER, path, "POST", body)).__status, 403, path + " other hospital");
  }
  assert.equal((await RECORD.latestByType(T, "ExpectedDischarge", 10)).length, 0);
  assert.equal((await RECORD.latestByType(T, "TransferRequest", 10)).length, 0);

  const req = await as(DOCTOR, "/ward/transfer-request", "POST", reqBody);
  assert.equal(req.__status, 200, JSON.stringify(req));
  const steps = [["/ward/transfer-respond", { decision: "accept" }], ["/ward/transfer-assign-bed", { bed: "5" }], ["/ward/transfer-execute", {}], ["/ward/transfer-cancel", { reason: "No longer needed" }]];
  for (const [path, extra] of steps) {
    const body = { orgId: ORG, requestId: req.requestId, expectedVersion: 1, ...extra };
    assert.equal(await anon(path, body), 401, path);
    assert.equal((await as(PHARM, path, "POST", body)).__status, 403, path + " pharmacy");
    assert.equal((await as(STRANGER, path, "POST", body)).__status, 403, path + " other hospital");
  }
  assert.equal((await RECORD.history(T, "TransferRequest", req.requestId)).length, 1, "no refused step was written");

  for (const path of [`/ward/transfer-requests?orgId=${ORG}`, `/ward/expected-discharge-history?orgId=${ORG}&encounterId=${adm.encounterId}`]) {
    assert.equal(await anon(path), 401, path);
    assert.equal((await as(PHARM, path)).__status, 403, path + " pharmacy");
    assert.equal((await as(STRANGER, path)).__status, 403, path + " other hospital");
    assert.equal((await as(NURSE, path)).__status, 200, path + " nurse reads");
  }
  const ok = await as(NURSE, "/ward/transfer-respond", "POST", { orgId: ORG, requestId: req.requestId, decision: "accept", expectedVersion: 1 });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
});
