/* test/wardsynq-discharge-billing-livefix.test.mjs - the live test of 2026-09-15 (docs/wardsynq/LIVE_TEST_2026-09-15.md).
 *
 * LT-30: the Price list the Admin Center edits prices the ward bill (bed, nursing and doctor visit per day, a lab or
 *        radiology test by name, a medicine), and "Raise invoice" with nothing priced says which charges have no price.
 * LT-31: a released result is on the discharge summary and is not "open"; Sign works before any draft was saved.
 * LT-32: /api/queue/ward/discharge enforces the checklist server-side: bill settled or deferred with a reason, open
 *        orders and pending results only with an override by a treating clinician, written on the Encounter.
 * LT-17: the destination is a coded list.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-discharge-billing-livefix.test.mjs
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
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
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
        return who === DOCTOR ? { regNo: "TSMC-2019-44821", name: "Dr Test" } : {};
      },
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");
const D = await import("../functions/_wardsynq/migrate-discharge.js");
const C = await import("../functions/_wardsynq/charge-capture.js");

const ORG = "org-wsq", ORG2 = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", ADMIN = "admin@example.test", HR = "hr@example.test", CASHIER = "cashier@example.test", LAB = "lab@example.test";
const ENV = { QUEUE_ENABLED: "1", CLINIC_BILLING_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG2}`, { fields: { id: ORG2, code: "SMD-OTHER1", name: "Another Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: "tenant-other", ownerUid: "someone-else", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [ADMIN, "admin"], [HR, "hr"], [CASHIER, "cashier"], [LAB, "lab"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
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
let n = 0;
async function admitted(ward = "Medical A", admittedAt = "2026-09-13T08:00:00.000Z") {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Test Patient QA " + n, mobile: "98765119" + String(n).padStart(2, "0"), gender: "female", ageYears: 45 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward, bed: String(n), admittedAt });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { reg, adm };
}
async function orderTest(adm, name, id) {
  await RECORD.append(TENANT_ROW.id, [{
    resourceType: "ServiceRequest", id, version: 1, patientId: adm.patientId, encounterId: adm.encounterId,
    code: name, display: name, status: "active", requesterId: "cfa:dr",
    meta: { recordedAt: "2026-09-13T09:00:00.000Z", effectiveAt: "2026-09-13T09:00:00.000Z" },
  }], { actor: "test" });
  return id;
}
const encounter = (id) => RECORD.latest(TENANT_ROW.id, "Encounter", id);

// ---- PURE -----------------------------------------------------------------------------------------------------

test("PURE LT-30: the Price list and the configured tariff are one table; a test is found by its name", () => {
  const table = C.tariffTable({ "BED-DAY": { amount: 999 } }, [
    { name: "General ward bed", code: "", kind: "bed", ward: "", price: 150000, active: true },
    { name: "ICU bed", code: "ICU-BED", kind: "bed", ward: "ICU", price: 600000, active: true },
    { name: "Complete blood count", code: "CBC", kind: "investigation", price: 35000, active: true },
    { name: "Withdrawn scan", kind: "investigation", price: 100, active: false },
  ]);
  assert.equal(table["General ward bed"].amount, 1500, "paise become rupees");
  assert.equal(table.CBC.amount, 350);
  assert.equal(table["Complete blood count"].amount, 350, "a coded row is also found by its name");
  assert.equal(table["Withdrawn scan"], undefined, "a withdrawn row prices nothing");
  const { priced, unpriced } = C.priceWith([{ code: "Complete blood count", display: "Complete blood count", sourceType: "DiagnosticReport", sourceId: "r1", quantity: 1 }, { code: "Mystery", display: "Mystery", quantity: 1 }], table);
  assert.equal(priced.length, 1); assert.equal(priced[0].amount, 350);
  assert.deepEqual(unpriced.map((u) => u.code), ["Mystery"], "an item with no price is listed, never dropped");
});

test("PURE LT-30: stay days carry the ward each day began on; the bed is the ward's own price, else the hospital's, else unpriced", () => {
  const enc = { id: "e1", patientId: "p1", periodStart: "2026-09-13T08:00:00.000Z", periodEnd: null, location: { ward: "ICU" } };
  const versions = [{ location: { ward: "Medical A" } }, { location: { ward: "ICU" }, movedAt: "2026-09-14T12:00:00.000Z" }];
  const days = C.stayDays(enc, versions, Date.parse("2026-09-15T09:00:00.000Z"));
  assert.deepEqual(days.map((d) => [d.n, d.ward]), [[1, "Medical A"], [2, "Medical A"], [3, "ICU"]], "a day is charged once it has started");
  const table = C.tariffTable(null, [
    { name: "General ward bed", kind: "bed", ward: "", price: 150000 },
    { name: "ICU bed", kind: "bed", ward: "ICU", price: 600000 },
    { name: "Nursing care", kind: "nursing", ward: "", price: 50000 },
    { name: "ICU doctor visit", kind: "visit", ward: "ICU", price: 80000 },
  ]);
  const items = C.stayDayItems(enc, days, table);
  assert.deepEqual(items.map((i) => i.display), ["General ward bed", "Nursing care", "General ward bed", "Nursing care", "ICU bed", "Nursing care", "ICU doctor visit"]);
  assert.equal(new Set(items.map((i) => i.sourceId)).size, items.length, "every day line has its own source, so a day is never billed twice");
  const bare = C.priceWith(C.stayDayItems(enc, days, {}), {});
  assert.equal(bare.unpriced.length, 3, "no bed price at all: each day is listed with no price, not given away");
  assert.match(bare.unpriced[0].display, /Bed per day, Medical A/);
});

test("PURE LT-32: the bill is settled only when nothing is owed and nothing done is off a bill; the blockers follow", () => {
  const charges = { ok: true, priced: [{ code: "X", display: "X", sourceType: "Encounter", sourceId: "e1:bed:1", line: 1500 }], unpriced: [] };
  assert.equal(D.billState(charges, []).state, "unbilled");
  const inv = { id: "i1", lines: [{ code: "X", sourceType: "Encounter", sourceId: "e1:bed:1", amount: 1500, quantity: 1, line: 1500 }], events: [] };
  assert.equal(D.billState(charges, [inv]).state, "balance_due");
  assert.equal(D.billState(charges, null).state, "unreadable", "an unread invoice list is not a settled bill");
  assert.equal(D.billState({ ok: true, priced: [], unpriced: [{ code: "BED-DAY", display: "Bed per day" }] }, []).state, "unbilled", "an unpriced charge is not settled");
  assert.equal(D.billState({ ok: true, priced: [], unpriced: [] }, []).state, "settled");

  const open = D.dischargeChecklist([{ kind: "medication", id: "rx1" }, { kind: "investigation", id: "sr1" }, { kind: "problem", id: "c1" }], { state: "settled" }, []);
  assert.equal(open.openOrders.length, 1); assert.equal(open.pendingResults.length, 1);
  assert.deepEqual(D.dischargeBlockers(open, {}), ["override_required"]);
  assert.deepEqual(D.dischargeBlockers(open, { overrideReason: "Going home on these", canOverride: false }), ["override_not_permitted"]);
  assert.deepEqual(D.dischargeBlockers(open, { overrideReason: "Going home on these", canOverride: true }), []);
  const unsettled = D.dischargeChecklist([], { state: "unbilled" }, []);
  assert.deepEqual(D.dischargeBlockers(unsettled, {}), ["bill_not_settled"]);
  assert.deepEqual(D.dischargeBlockers(unsettled, { billDeferredReason: "Insurer settles" }), []);
  assert.deepEqual(D.dischargeBlockers(D.dischargeChecklist([], { state: "settled" }, ["MedicationOrder"]), {}), ["override_required"], "an unread order list needs an override too");
});

test("PURE LT-31: an investigation line carries its released result and the critical flag; a resulted test is not pending", () => {
  const sr = { id: "sr1", display: "Complete blood count", code: "CBC", status: "active" };
  const report = { serviceRequestId: "sr1", status: "final", reportedAt: "2026-09-15T15:00:00.000Z", resultObservationIds: ["o1"] };
  const obs = [{ id: "o1", display: "Haemoglobin", value: 5.2, unit: "g/dL", sourceCritical: true }];
  assert.equal(D.investigationLine(sr, [report], obs), "Complete blood count (result, reported 2026-09-15T15:00:00.000Z): Haemoglobin 5.2 g/dL (critical)");
  assert.equal(D.investigationLine(sr, [], []), "Complete blood count (requested, no result yet)");
  const cxr = { id: "sr2", display: "Chest X-ray PA view", status: "active" };
  assert.match(D.investigationLine(cxr, [{ serviceRequestId: "sr2", status: "final", category: "imaging", impression: "No consolidation." }], []), /Impression: No consolidation\./);
  const pending = D.pendingItems({ serviceRequests: [sr, cxr, { id: "sr3", display: "LFT", status: "active" }], reports: [report, { serviceRequestId: "sr3", status: "preliminary" }] });
  assert.deepEqual(pending.map((p) => [p.id, p.status]), [["sr2", "no result yet"], ["sr3", "preliminary result"]]);
});

// ---- ROUTES ---------------------------------------------------------------------------------------------------

test("LT-32 GET /api/queue/ward/discharge-checklist: 401 without a session, 403 for a role that cannot discharge or another hospital, the checklist for the ward", async () => {
  seedHospital();
  const { adm } = await admitted();
  const q = `/ward/discharge-checklist?orgId=${ORG}&encounterId=${adm.encounterId}`;
  assert.equal((await as(null, q)).__status, 401);
  assert.equal((await as(HR, q)).__status, 403, "hr holds no queue.add");
  assert.equal((await as(DOCTOR, `/ward/discharge-checklist?orgId=${ORG2}&encounterId=${adm.encounterId}`)).__status, 403, "not a member of the other hospital");
  const ok = await as(NURSE, q);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.checklist.bill.state, "unbilled", "a bed day with no price is not a settled bill");
  assert.equal(ok.canOverride, false, "a nurse is told she cannot override");
  assert.ok(ok.dispositions.includes("left-against-advice") && ok.dispositions.includes("died") && ok.dispositions.includes("other"));
  assert.equal((await as(DOCTOR, q)).canOverride, true);
});

test("LT-32 POST /api/queue/ward/discharge: refused with the checklist and nothing written until the bill is deferred and a clinician overrides", async () => {
  seedHospital();
  const { adm } = await admitted();
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug: "Ondansetron 4mg", dose: { value: 4, unit: "mg" }, route: "IV", frequency: "TID" } });
  assert.equal(ord.__status, 200, JSON.stringify(ord));
  await orderTest(adm, "Chest X-ray PA view", "wsq-sr-cxr-1");
  const url = "/ward/discharge";
  const body = { orgId: ORG, encounterId: adm.encounterId, disposition: "home" };

  assert.equal((await as(null, url, "POST", body)).__status, 401);
  const hr = await as(HR, url, "POST", { ...body, billDeferredReason: "x", overrideReason: "x" });
  assert.equal(hr.__status, 403);
  const cross = await as(DOCTOR, url, "POST", { ...body, orgId: ORG2, billDeferredReason: "x", overrideReason: "x" });
  assert.equal(cross.__status, 403, JSON.stringify(cross));

  const noWhere = await as(DOCTOR, url, "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(noWhere.__status, 422); assert.equal(noWhere.error, "disposition_required");
  const typed = await as(DOCTOR, url, "POST", { ...body, disposition: "went home probably" });
  assert.equal(typed.__status, 422, "a typed destination is not a coded one");
  assert.equal((await as(DOCTOR, url, "POST", { ...body, disposition: "other" })).error, "disposition_note_required");
  assert.equal((await as(DOCTOR, url, "POST", { ...body, disposition: "transferred" })).error, "destination_required");
  assert.equal((await as(DOCTOR, url, "POST", { ...body, disposition: "died", billDeferredReason: "x", overrideReason: "x" })).error, "death_not_recorded");

  const blocked = await as(DOCTOR, url, "POST", body);
  assert.equal(blocked.__status, 409, JSON.stringify(blocked));
  assert.equal(blocked.error, "discharge_blocked");
  assert.deepEqual(blocked.blockers, ["bill_not_settled", "override_required"]);
  assert.deepEqual(blocked.checklist.openOrders.map((p) => p.drug), ["Ondansetron 4mg"]);
  assert.deepEqual(blocked.checklist.pendingResults.map((p) => p.display), ["Chest X-ray PA view"]);

  const nurse = await as(NURSE, url, "POST", { ...body, billDeferredReason: "Insurer settles", overrideReason: "Doctor said so" });
  assert.equal(nurse.__status, 403, JSON.stringify(nurse));
  assert.equal(nurse.error, "override_not_permitted");
  assert.equal((await encounter(adm.encounterId)).status, "in-progress", "nothing written by any refusal");

  const done = await as(DOCTOR, url, "POST", { ...body, disposition: "transferred", destination: "City Cardiac Centre", billDeferredReason: "Insurer settles directly", overrideReason: "Receiving hospital continues the antiemetic and chases the X-ray" });
  assert.equal(done.__status, 200, JSON.stringify(done));
  const after = await encounter(adm.encounterId);
  assert.equal(after.status, "finished");
  assert.equal(after.disposition, "transferred"); assert.equal(after.destination, "City Cardiac Centre");
  assert.equal(after.billDeferred.reason, "Insurer settles directly");
  assert.equal(after.dischargeOverride.reason, "Receiving hospital continues the antiemetic and chases the X-ray");
  assert.equal(after.dischargeOverride.by, idFor(DOCTOR));
  assert.equal(after.dischargeChecklist.openOrders.length, 1);
  assert.equal(after.dischargeChecklist.pendingResults.length, 1);
});

test("LT-30 end to end: prices set through POST /api/queue/bill/tariff reach GET /api/queue/ward/charges and POST /api/queue/ward/invoice; nothing priced names what has no price", async () => {
  seedHospital();
  const { adm, reg } = await admitted("Medical A", new Date(Date.now() - 30 * 3600000).toISOString());
  const sr = await orderTest(adm, "Complete blood count", "wsq-sr-cbc-1");
  const rel = await as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr, status: "final", tests: [{ test: "Haemoglobin", value: 5.2, unit: "g/dL", critical: true }] });
  assert.equal(rel.__status, 200, JSON.stringify(rel));

  // Nothing priced yet: the answer names every charge with no price.
  const none = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId });
  assert.equal(none.__status, 200, JSON.stringify(none));
  assert.equal(none.skipped, "nothing_priced");
  assert.ok(none.unpriced.some((u) => /Bed per day/.test(u.display)), JSON.stringify(none.unpriced));
  assert.ok(none.unpriced.some((u) => u.display === "Complete blood count"));

  // Only an administrator sets prices; a cashier cannot.
  assert.equal((await as(CASHIER, "/bill/tariff", "POST", { orgId: ORG, name: "Free bed", kind: "bed", price: 0 })).__status, 403);
  for (const item of [
    { name: "General ward bed", kind: "bed", ward: "Medical A", price: 150000 },
    { name: "Nursing care", kind: "nursing", ward: "", price: 50000 },
    { name: "Consultant visit", kind: "visit", ward: "", price: 80000 },
    { name: "Complete blood count", code: "CBC", kind: "investigation", price: 35000 },
  ]) {
    const saved = await as(ADMIN, "/bill/tariff", "POST", { orgId: ORG, ...item });
    assert.equal(saved.ok, true, JSON.stringify(saved));
  }
  const list = await as(ADMIN, `/bill/tariff?orgId=${ORG}`);
  assert.equal(list.items.find((t) => t.name === "General ward bed").ward, "Medical A", "the ward scope is kept");

  const charges = await as(CASHIER, `/ward/charges?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(charges.__status, 200, JSON.stringify(charges));
  const names = charges.priced.map((p) => p.display).sort();
  assert.deepEqual(names, ["Complete blood count", "Consultant visit", "Consultant visit", "General ward bed", "General ward bed", "Nursing care", "Nursing care"], JSON.stringify(charges.priced));
  assert.equal(charges.total, 350 + 2 * (1500 + 500 + 800));

  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId });
  assert.equal(inv.__status, 200, JSON.stringify(inv));
  assert.equal(inv.written, 1);
  assert.equal(inv.lines.length, 7);
  const again = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId });
  assert.equal(again.skipped, "already_invoiced", "a day already billed is never billed twice");
  assert.ok(reg.mrn);
});

test("LT-31 GET /api/queue/ward/discharge-summary and POST /api/queue/ward/sign-discharge-summary: the released result is in the summary and not pending; Sign works before any draft", async () => {
  seedHospital();
  const { adm } = await admitted();
  const sr = await orderTest(adm, "Complete blood count", "wsq-sr-cbc-2");
  const rel = await as(LAB, "/ward/release-result", "POST", { orgId: ORG, serviceRequestId: sr, status: "final", reportedAt: "2026-09-15T15:00:00.000Z", tests: [{ test: "Haemoglobin", value: 5.2, unit: "g/dL", critical: true }] });
  assert.equal(rel.__status, 200, JSON.stringify(rel));

  const read = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(read.__status, 200, JSON.stringify(read));
  assert.match(read.assembled.investigations, /Complete blood count \(result, reported 2026-09-15T15:00:00.000Z\): Haemoglobin 5.2 g\/dL \(critical\)/);
  assert.ok(!read.pending.some((p) => p.kind === "investigation"), JSON.stringify(read.pending));
  assert.equal(read.stored, null, "not drafted yet");

  const signed = await as(DOCTOR, "/ward/sign-discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId });
  assert.equal(signed.__status, 200, JSON.stringify(signed));
  assert.equal(signed.signed, true);
  const after = await as(DOCTOR, `/ward/discharge-summary?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(after.stored.signed, true);
  assert.equal(after.stored.version, 2, "saved as a draft and signed as its own version");
  assert.match(after.stored.sections.investigations, /Haemoglobin 5.2 g\/dL \(critical\)/);
  assert.equal((await as(NURSE, "/ward/sign-discharge-summary", "POST", { orgId: ORG, encounterId: adm.encounterId })).__status, 403, "signing stays emr.treat");
});
