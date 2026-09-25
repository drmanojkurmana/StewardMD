import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-billing-reports-livefix.test.mjs - the live retest of 2026-09-16 (docs/wardsynq/LIVE_RETEST_2026-09-16.md).
 *
 * Billing: a price nobody can see on the Price list (the demo seed's wardsynq.tariff) prices nothing; an invoice raised
 *          for an admitted patient carries the stay; the discharge checklist reads that stay's invoices (and an older
 *          invoice with no stay by its lines or dates); "Not billed yet" leaves out what is already on a bill.
 * LT-38:   the billing footing adds up (credit held beyond the bill, void invoices apart), an issue leaves the store it
 *          came from, and the period reports take a server-side date range defaulting to the last 7 days.
 * LT-39:   the command center's discharge rows name the patient.
 * LT-15:   a catalogue of lab and imaging tests; a catalogued imaging test goes to radiology; "other" needs a reason;
 *          an existing imaging order filed as laboratory reads as imaging.
 * LT-03:   the bed board matches a stay's ward to the hospital's ward by name or code without regard to case, and says
 *          why a ward has no bed list.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-billing-reports-livefix.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
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
const R = await import("../functions/_wardsynq/reports.js");
const S = await import("../functions/_wardsynq/stock.js");
const I = await import("../functions/_wardsynq/invoice.js");
const D = await import("../functions/_wardsynq/migrate-discharge.js");
const K = await import("../functions/_wardsynq/investigation-catalogue.js");

const ORG = "org-wsq", ORG2 = "org-other";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", ADMIN = "admin@example.test", HR = "hr@example.test", CASHIER = "cashier@example.test", LAB = "lab@example.test";
const ENV = { QUEUE_ENABLED: "1", CLINIC_BILLING_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital(wsq) {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: wsq || {} }, updateTime: "t1" });
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
async function admitted(ward = "Medical A", admittedAt = new Date(Date.now() - 3600000).toISOString(), bed) {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Test Patient QA " + n, mobile: "98765229" + String(n).padStart(2, "0"), gender: "female", ageYears: 45 });
  assert.equal(reg.__status, 200, JSON.stringify(reg));
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward, bed: bed === undefined ? String(n) : bed, admittedAt });
  assert.equal(adm.__status, 200, JSON.stringify(adm));
  return { reg, adm };
}
const invoicesOf = (patientId) => RECORD.byPatient(TENANT_ROW.id, "Invoice", patientId);
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

// ---- BILLING: an invisible price prices nothing ---------------------------------------------------------------------

test("retest billing: with the Price list empty, a price in wardsynq.tariff (the demo seed's Specimen collection 60) is not billed; GET /api/queue/ward/charges lists it as no price set and POST /api/queue/ward/invoice raises nothing", async () => {
  seedHospital({ tariff: { "specimen-collection": { amount: 60, currency: "INR", description: "Specimen collection (DEMO price)" } } });
  const { adm } = await admitted();
  await RECORD.append(TENANT_ROW.id, [{ resourceType: "SpecimenCollection", id: "spec-1", version: 1, patientId: adm.patientId, encounterId: adm.encounterId, serviceRequestId: "sr-1", state: "collected", collectedAt: new Date().toISOString() }], { actor: "test" });

  const charges = await as(CASHIER, `/ward/charges?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(charges.__status, 200, JSON.stringify(charges));
  assert.equal(charges.priced.length, 0, "nothing is priced by a table no screen shows: " + JSON.stringify(charges.priced));
  assert.ok(charges.unpriced.some((u) => u.code === "specimen-collection"), "listed as no price set, never dropped");
  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId });
  assert.equal(inv.__status, 200, JSON.stringify(inv));
  assert.equal(inv.skipped, "nothing_priced");
  assert.equal((await invoicesOf(adm.patientId)).length, 0, "no invoice written at a made-up amount");

  // Once the hospital puts the price on its Price list, it is billed from there.
  assert.equal((await as(ADMIN, "/bill/tariff", "POST", { orgId: ORG, name: "Specimen collection", code: "specimen-collection", kind: "service", price: 6000 })).ok, true);
  const priced = await as(CASHIER, `/ward/charges?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.deepEqual(priced.priced.map((p) => [p.code, p.amount]), [["specimen-collection", 60]]);
});

// ---- BILLING: the invoice carries the stay; the checklist reads the stay's invoices ----------------------------------

test("retest billing POST /api/queue/ward/invoice: 401 without a session, 403 for a role without billing and for another hospital, nothing written; a named stay must be this patient's", async () => {
  seedHospital();
  const { adm } = await admitted();
  const other = await admitted();
  assert.equal((await as(ADMIN, "/bill/tariff", "POST", { orgId: ORG, name: "General ward bed", kind: "bed", ward: "", price: 150000 })).ok, true);
  const body = { orgId: ORG, patientId: adm.patientId };
  assert.equal((await as(null, "/ward/invoice", "POST", body)).__status, 401);
  assert.equal((await as(HR, "/ward/invoice", "POST", body)).__status, 403);
  assert.equal((await as(CASHIER, "/ward/invoice", "POST", { ...body, orgId: ORG2 })).__status, 403);
  const wrongStay = await as(CASHIER, "/ward/invoice", "POST", { ...body, encounterId: other.adm.encounterId });
  assert.equal(wrongStay.__status, 422, JSON.stringify(wrongStay));
  assert.equal(wrongStay.error, "encounter_not_this_patient");
  assert.equal((await invoicesOf(adm.patientId)).length, 0, "no refusal wrote an invoice");
});

test("retest billing end to end: raise with only the patient, pay, and GET /api/queue/ward/discharge-checklist shows the stay settled; /ward/charges no longer lists what is on the bill", async () => {
  seedHospital();
  const { adm } = await admitted();
  assert.equal((await as(ADMIN, "/bill/tariff", "POST", { orgId: ORG, name: "General ward bed", kind: "bed", ward: "", price: 150000 })).ok, true);

  const before = await as(DOCTOR, `/ward/discharge-checklist?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(before.checklist.bill.state, "unbilled");

  const inv = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId });
  assert.equal(inv.__status, 200, JSON.stringify(inv));
  assert.equal(inv.encounterId, adm.encounterId, "the cashier sent no stay; the open stay is found");
  assert.equal((await invoicesOf(adm.patientId))[0].encounterId, adm.encounterId, "stored on the invoice");

  const due = await as(DOCTOR, `/ward/discharge-checklist?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(due.checklist.bill.state, "balance_due");
  assert.equal(due.checklist.bill.balance, 1500);

  const paid = await as(CASHIER, "/ward/invoice-payment", "POST", { orgId: ORG, invoiceId: inv.invoiceId, amount: 1500, method: "cash", paymentDetails: { counter: "Main desk" } });
  assert.equal(paid.__status, 200, JSON.stringify(paid));
  const settled = await as(DOCTOR, `/ward/discharge-checklist?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(settled.checklist.bill.state, "settled", JSON.stringify(settled.checklist.bill));
  assert.deepEqual(settled.checklist.bill.invoiceIds, [inv.invoiceId]);
  assert.ok(!settled.blockers.includes("bill_not_settled"));

  const charges = await as(CASHIER, `/ward/charges?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(charges.priced.length, 0, "Not billed yet leaves out what is on a bill: " + JSON.stringify(charges.priced));
  assert.equal(charges.alreadyInvoiced, 1);
});

test("retest billing: an invoice raised before the link (encounterId null) counts for the stay by its lines or its date; another stay's invoice never does", async () => {
  seedHospital();
  const { adm } = await admitted("Medical A", ago(2));
  const line = { code: "X", display: "X", quantity: 1, amount: 500, line: 500, sourceType: "Service", sourceId: "svc-1" };
  const raised = (at) => [{ kind: "raised", amount: 0, actorId: "cfa:c", at }];
  await RECORD.append(TENANT_ROW.id, [
    { resourceType: "Invoice", id: "inv-legacy", version: 1, patientId: adm.patientId, encounterId: null, currency: "INR", lines: [line], events: raised(ago(1)), void: false, source: { system: "wardsynq-native", sourceId: "invoice:inv-legacy" } },
    { resourceType: "Invoice", id: "inv-old-stay", version: 1, patientId: adm.patientId, encounterId: "wsq-adm-some-earlier-stay", currency: "INR", lines: [{ ...line, sourceId: "svc-2" }], events: raised(ago(40)), void: false, source: { system: "wardsynq-native", sourceId: "invoice:inv-old-stay" } },
  ], { actor: "test" });
  const r = await as(DOCTOR, `/ward/discharge-checklist?orgId=${ORG}&encounterId=${adm.encounterId}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.deepEqual(r.checklist.bill.invoiceIds, ["inv-legacy"], "the legacy invoice raised during the stay counts; the earlier stay's does not");
  assert.equal(r.checklist.bill.balance, 500);

  // PURE: matched by a line from this stay even when raised after discharge; not by date when outside the stay.
  const enc = { id: "e1", periodStart: "2026-09-10T00:00:00.000Z", periodEnd: "2026-09-12T00:00:00.000Z" };
  const inv = (id, at, lines, encounterId = null) => ({ id, encounterId, lines, events: raised(at) });
  const got = I.invoicesForStay([
    inv("by-line", "2026-09-14T00:00:00.000Z", [{ sourceType: "SpecimenCollection", sourceId: "s1" }]),
    inv("by-bed-day", "2026-09-14T00:00:00.000Z", [{ sourceType: "Encounter", sourceId: "e1:bed:2" }]),
    inv("by-date", "2026-09-11T00:00:00.000Z", []),
    inv("outside", "2026-09-14T00:00:00.000Z", [{ sourceType: "SpecimenCollection", sourceId: "s9" }]),
    inv("linked-other", "2026-09-11T00:00:00.000Z", [{ sourceType: "SpecimenCollection", sourceId: "s1" }], "e2"),
  ], enc, new Set(["SpecimenCollection:s1"]));
  assert.deepEqual(got.map((i) => i.id), ["by-line", "by-bed-day", "by-date"]);
  assert.equal(D.billState({ ok: true, priced: [], unpriced: [] }, [inv("x", "2026-09-11T00:00:00.000Z", [{ line: 10 }], "e2")], enc).state, "settled", "another stay's unpaid bill does not hold this discharge");
});

// ---- LT-38: reports --------------------------------------------------------------------------------------------------

test("PURE LT-38: the billing footing reproduces the live mismatch (charged 1455, collected 9660) and now adds up: 8205 is credit held beyond the bills; a void invoice is not charged", () => {
  const inv = (id, lineTotal, events, extra) => ({ id, currency: "INR", lines: [{ code: "X", quantity: 1, amount: lineTotal, line: lineTotal }], events: [{ kind: "raised", amount: 0, at: "2026-09-15T10:00:00.000Z" }, ...events], void: false, ...extra });
  const live = [];
  for (let i = 0; i < 12; i++) live.push(inv("seed-" + i, i < 11 ? 115 : 130, [{ kind: "deposit", amount: 500 }, { kind: "payment", amount: 300 }]));
  live.push(inv("qa-03", 60, [{ kind: "payment", amount: 60 }]));
  live.push(inv("voided", 999, [], { void: true, voidReason: "raised twice" }));
  const s = R.billingSums(live);
  assert.equal(s.charged, 1455);
  assert.equal(s.collected, 9660);
  assert.equal(s.outstanding, 0);
  assert.equal(s.creditHeld, 8205, "what was taken beyond the bills is shown, so the page adds up");
  assert.equal(s.netCollected, 9660);
  assert.equal(s.voidCount, 1); assert.equal(s.invoiceCount, 14);
  assert.equal(s.balances, true);
  const mixed = R.billingSums([inv("a", 1000, [{ kind: "payment", amount: 400 }, { kind: "discount", amount: 100, reason: "staff" }]), inv("b", 200, [{ kind: "payment", amount: 300 }, { kind: "refund", amount: 50, reason: "over" }])]);
  assert.deepEqual([mixed.charged, mixed.collected, mixed.refunded, mixed.netCollected, mixed.discounted, mixed.outstanding, mixed.creditHeld, mixed.balances], [1200, 700, 50, 650, 100, 500, 50, true]);
});

test("PURE LT-38: a dispense leaves the store it was received into, not the ward it was sent to; with no receipt at all it is one negative line at the main store", () => {
  const receipt = { id: "m1", kind: "receipt", code: "Amoxicillin", quantity: { value: 100, unit: "dose" }, location: "Main pharmacy" };
  const disp = (id, ward) => ({ id, drug: "Amoxicillin", quantity: { value: 6, unit: "dose" }, destination: ward });
  const { levels } = S.levelsFrom([receipt], [disp("d1", "General Medicine A"), disp("d2", "General Surgery A")]);
  assert.deepEqual(levels.map((l) => [l.location, l.level, l.issued]), [["Main pharmacy", 88, 12]], "no ward reads negative");
  const none = S.levelsFrom([], [disp("d1", "General Medicine A"), disp("d2", "General Surgery A")]).levels;
  assert.deepEqual(none.map((l) => [l.location, l.level]), [[null, -12]]);
  assert.equal(S.flagLevels(none, {}).negative.length, 1, "still reported, never clamped");
});

test("LT-38 GET /api/queue/ward/report-billing: 401, 403 for another hospital, a date range applied server-side defaulting to the last 7 days, a bad date refused", async () => {
  seedHospital();
  const mk = (id, at, amount) => ({ resourceType: "Invoice", id, version: 1, patientId: "p-" + id, currency: "INR", void: false,
    events: [{ kind: "raised", amount: 0, actorId: "cfa:c", at }], lines: [{ code: "X", display: "X", quantity: 1, amount, line: amount }] });
  await RECORD.append(TENANT_ROW.id, [mk("inv-now", ago(1), 300), mk("inv-old", ago(20), 5000)], { actor: "test" });
  const q = `/ward/report-billing?orgId=${ORG}`;
  assert.equal((await as(null, q)).__status, 401);
  assert.equal((await as(ADMIN, `/ward/report-billing?orgId=${ORG2}`)).__status, 403);
  const def = await as(ADMIN, q);
  assert.equal(def.__status, 200, JSON.stringify(def));
  assert.equal(def.invoiceCount, 1, "the last 7 days by default");
  assert.equal(def.charged, 300);
  assert.ok(def.period.from && def.period.to, "the period is stated");
  const wide = await as(ADMIN, `${q}&from=${ago(30).slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`);
  assert.equal(wide.invoiceCount, 2);
  assert.equal(wide.charged, 5300);
  const bad = await as(ADMIN, `${q}&from=yesterday`);
  assert.equal(bad.__status, 422); assert.equal(bad.error, "bad_date");
  assert.equal((await as(ADMIN, `${q}&from=2026-09-10&to=2026-09-01`)).__status, 422, "from after to");
});

// ---- LT-39: command center names the patient -------------------------------------------------------------------------

test("LT-39 GET /api/queue/ward/patient-flow: 401, 403 for another hospital, and every discharge row names the patient and MRN", async () => {
  seedHospital();
  const { adm, reg } = await admitted("Medical A");
  const other = await admitted("Medical A");
  await RECORD.append(TENANT_ROW.id, [{ resourceType: "ServiceRequest", id: "sr-open", version: 1, patientId: other.adm.patientId, encounterId: other.adm.encounterId, code: "CBC", display: "CBC", status: "active", meta: { recordedAt: ago(0.01) } }], { actor: "test" });
  const q = `/ward/patient-flow?orgId=${ORG}`;
  assert.equal((await as(null, q)).__status, 401);
  assert.equal((await as(DOCTOR, `/ward/patient-flow?orgId=${ORG2}`)).__status, 403);
  const r = await as(DOCTOR, q);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const open = r.flow.staysWithOpenItems.find((s) => s.encounterId === other.adm.encounterId);
  assert.ok(open, JSON.stringify(r.flow.staysWithOpenItems));
  assert.equal(open.name, "Test Patient QA " + (n));
  assert.equal(open.mrn, other.reg.mrn);
  assert.equal(open.ward, "Medical A");
  const cand = r.flow.drill.dischargeCandidates.items.find((i) => i.encounterId === adm.encounterId);
  assert.ok(cand, JSON.stringify(r.flow.drill.dischargeCandidates));
  assert.equal(cand.mrn, reg.mrn);
  assert.equal(cand.label, "Test Patient QA " + (n - 1) + " · " + reg.mrn);
  assert.ok(!JSON.stringify(r.flow.staysWithOpenItems).includes("opd-pat-") || open.name, "a name, not only an id");
});

// ---- LT-15: investigation catalogue ----------------------------------------------------------------------------------

test("PURE LT-15: the catalogue is the Price list, the order sets and the built-in tests; a catalogued imaging test is imaging; free-text words never overrule a category", () => {
  const cat = K.catalogue([
    { name: "Complete blood count", code: "CBC", kind: "investigation", price: 35000 },
    { name: "CT chest with contrast", code: "CTC", kind: "investigation", price: 400000 },
    { name: "Doppler legs", code: "", kind: "radiology", price: 200000 },
    { name: "General ward bed", kind: "bed", price: 150000 },
    { name: "Withdrawn test", code: "WD", kind: "investigation", active: false },
  ], [{ id: "s1", items: [{ kind: "investigation", code: "D-DIMER", display: "D-dimer" }] }]);
  const by = (c) => cat.find((e) => e.code === c);
  assert.equal(by("CBC").source, "price-list", "the hospital's own entry wins over the built-in one");
  assert.equal(by("CTC").category, "imaging");
  assert.equal(by("Doppler legs").category, "imaging");
  assert.equal(by("D-DIMER").category, "laboratory");
  assert.equal(by("WD"), undefined); assert.ok(!cat.some((e) => e.name === "General ward bed"));
  for (const c of ["CBC", "RFT", "LFT", "ELEC", "HBA1C", "LIPID", "TSH", "URINE-R", "BCS", "COAG", "TROP", "ABG", "CRP"]) assert.equal(by(c).category, "laboratory", c);
  for (const c of ["CXR", "USG-ABD", "CT-HEAD", "MRI-BRAIN", "ECG", "ECHO"]) assert.equal(by(c).category, "imaging", c);
  assert.equal(K.effectiveCategory({ code: "CXR", category: "laboratory" }), "imaging", "the demo's CXR filed as laboratory");
  assert.equal(K.effectiveCategory({ code: "x", display: "X-ray chest", category: "laboratory" }), "imaging");
  assert.equal(K.effectiveCategory({ code: "Urine culture after x-ray contrast", category: "laboratory" }), "laboratory");
  assert.equal(K.effectiveCategory({ code: "Resting ECG", category: "procedure" }), "procedure");
});

test("LT-15 GET /api/queue/ward/investigation-catalogue and POST /api/queue/ward/investigation: auth, a catalogued CXR goes to radiology whatever category was sent, other needs a reason", async () => {
  seedHospital();
  const { adm } = await admitted();
  assert.equal((await as(ADMIN, "/bill/tariff", "POST", { orgId: ORG, name: "Troponin I (high sensitivity)", code: "HSTROP", kind: "investigation", price: 90000 })).ok, true);
  const q = `/ward/investigation-catalogue?orgId=${ORG}`;
  assert.equal((await as(null, q)).__status, 401);
  assert.equal((await as(HR, q)).__status, 403);
  assert.equal((await as(DOCTOR, `/ward/investigation-catalogue?orgId=${ORG2}`)).__status, 403);
  const cat = await as(NURSE, q);
  assert.equal(cat.__status, 200, JSON.stringify(cat));
  assert.ok(cat.entries.some((e) => e.code === "HSTROP" && e.source === "price-list"));
  assert.ok(cat.entries.some((e) => e.code === "CXR" && e.category === "imaging"));

  const cxr = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "CXR", display: "X-ray chest", category: "laboratory" });
  assert.equal(cxr.__status, 200, JSON.stringify(cxr));
  assert.equal(cxr.category, "imaging");
  const stored = await RECORD.latest(TENANT_ROW.id, "ServiceRequest", cxr.orderId);
  assert.deepEqual(stored.catalogue, { code: "CXR", source: "built-in" });

  const noReason = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Serum ferritin", category: "laboratory", other: true });
  assert.equal(noReason.__status, 422, JSON.stringify(noReason));
  assert.equal(noReason.error, "reason_required_for_other");
  assert.equal((await RECORD.byPatient(TENANT_ROW.id, "ServiceRequest", adm.patientId)).length, 1, "nothing written");
  assert.equal((await as(NURSE, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "CBC" })).__status, 403, "ordering stays emr.treat");
  const withReason = await as(DOCTOR, "/ward/investigation", "POST", { orgId: ORG, encounterId: adm.encounterId, code: "Serum ferritin", category: "laboratory", other: true, reason: "Iron studies for anaemia" });
  assert.equal(withReason.__status, 200, JSON.stringify(withReason));
  assert.equal((await RECORD.latest(TENANT_ROW.id, "ServiceRequest", withReason.orderId)).other, true);
});

test("LT-15: an existing imaging order filed as laboratory (the demo's CXR) is read as imaging: pending-tests says so, the radiology worklist has it, and it cannot be collected", async () => {
  seedHospital();
  const { adm } = await admitted();
  await RECORD.append(TENANT_ROW.id, [{ resourceType: "ServiceRequest", id: "wsq-sr-legacy-cxr", version: 1, patientId: adm.patientId, encounterId: adm.encounterId, code: "CXR", display: "CXR", category: "laboratory", status: "active", requesterId: "cfa:dr", meta: { recordedAt: ago(0.1) } }], { actor: "test" });
  const pending = await as(LAB, `/ward/pending-tests?orgId=${ORG}&scope=hospital`);
  assert.equal(pending.__status, 200, JSON.stringify(pending));
  assert.equal(pending.pending.find((p) => p.serviceRequestId === "wsq-sr-legacy-cxr").category, "imaging");
  const work = await as(DOCTOR, `/ward/imaging-worklist?orgId=${ORG}`);
  assert.equal(work.__status, 200, JSON.stringify(work));
  assert.ok(JSON.stringify(work.worklist).includes("wsq-sr-legacy-cxr"), "on the radiology worklist: " + JSON.stringify(work.worklist));
  const got = await as(NURSE, "/ward/collect", "POST", { orgId: ORG, serviceRequestId: "wsq-sr-legacy-cxr", specimenType: "Whole blood" });
  assert.equal(got.__status, 409, JSON.stringify(got));
  assert.equal(got.error, "not_a_specimen_order");
  assert.equal((await RECORD.latest(TENANT_ROW.id, "ServiceRequest", "wsq-sr-legacy-cxr")).category, "laboratory", "the stored record is not rewritten");
});

// ---- LT-03: bed board ward matching ----------------------------------------------------------------------------------

test("LT-03 GET /api/queue/ward/beds: a stay on 'cardiology ward' or 'CAR' is on Cardiology Ward; a ward not on the list and a ward with no beds each say why", async () => {
  seedHospital();
  docs.set("q_wards/w-car", { fields: { id: "w-car", orgId: ORG, name: "Cardiology Ward", code: "CAR", type: "general", active: true }, updateTime: "t1" });
  docs.set("q_wards/w-empty", { fields: { id: "w-empty", orgId: ORG, name: "Step-down Unit", code: "SDU", type: "general", active: true }, updateTime: "t1" });
  docs.set("q_wards/w-old", { fields: { id: "w-old", orgId: ORG, name: "Old Annexe", code: "ANX", type: "general", active: false }, updateTime: "t1" });
  for (const b of ["CAR-01", "CAR-02", "CAR-03"]) docs.set(`q_beds/b-${b}`, { fields: { id: "b-" + b, orgId: ORG, wardId: "w-car", name: b, state: "available", active: true }, updateTime: "t1" });
  await admitted("cardiology ward", undefined, "CAR-01");
  await admitted("CAR", undefined, "");
  const typed = await admitted("cardio", undefined, "");
  await admitted("Old Annexe", undefined, "");

  assert.equal((await as(null, `/ward/beds?orgId=${ORG}`)).__status, 401);
  assert.equal((await as(DOCTOR, `/ward/beds?orgId=${ORG2}`)).__status, 403);
  const r = await as(NURSE, `/ward/beds?orgId=${ORG}`);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const ward = (name) => r.wards.find((w) => w.ward === name);
  assert.deepEqual(r.wards.filter((w) => /cardi|^CAR$/i.test(w.ward)).map((w) => w.ward).sort(), ["Cardiology Ward", "cardio"], "one Cardiology Ward row, plus the typed ward");
  assert.equal(ward("Cardiology Ward").occupied.length, 1);
  assert.equal(ward("Cardiology Ward").unplaced.length, 1, "the stay recorded against the code CAR");
  assert.deepEqual(ward("Cardiology Ward").free, ["CAR-02", "CAR-03"]);
  assert.equal(ward("cardio").notInWardList, "unknown", "not guessed to be Cardiology Ward");
  assert.equal(ward("cardio").unplaced[0].encounterId, typed.adm.encounterId, "the patient is still shown");
  assert.equal(ward("Old Annexe").notInWardList, "retired");
  assert.equal(ward("Step-down Unit").noBeds, true);
  assert.equal(ward("Step-down Unit").bedsKnown, true);
});

// ---- screens (ward.js rendered in a sandbox) -------------------------------------------------------------------------

const WARD_SRC = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
function loadWard() {
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(WARD_SRC, sb);
  return sb.window.WARD;
}

test("screens: Reports has a date range, a CSV button per table and the credit figure; the command center names the patient; the bed board says why a ward has no beds", () => {
  const W = loadWard();
  const env = (body) => ({ ok: true, dataSource: ["Invoice"], period: { from: "2026-09-10", to: "2026-09-16" }, generatedAt: "2026-09-16T10:00:00Z", scope: { role: "admin" }, ...body });
  const rep = W._render({ ...W._st, view: "reports", reportRange: { from: "2026-09-10", to: "2026-09-16" }, reports: {
    billing: env({ invoiceCount: 13, charged: 1455, collected: 9660, refunded: 0, netCollected: 9660, discounted: 0, adjusted: 0, writtenOff: 0, outstanding: 0, creditHeld: 8205, voidCount: 0, balances: true }),
    pharmacy: env({ dispenseCount: 2, pendingVerification: 0, dispenseVolume: {}, stock: [{ code: "Amoxicillin", display: "Amoxicillin", location: null, level: -12, unit: "dose", impossible: true }], stockWarning: "negative" }),
  } });
  assert.match(rep, /id="wRptFrom" type="date" value="2026-09-10"/);
  assert.match(rep, /id="wRptTo" type="date" value="2026-09-16"/);
  assert.match(rep, /data-w-act="reportsrange"/);
  assert.equal((rep.match(/data-w-act="rptcsv:wRptT\d+"/g) || []).length, (rep.match(/<table class="w-tbl" id="wRptT\d+"/g) || []).length, "one CSV button per table");
  assert.match(rep, /Taken beyond the bill \(to refund or apply\)<\/th><td>8205/);
  assert.match(rep, /never received on record/);
  assert.match(rep, /Main store/);

  const f = { computedAt: "2026-09-16T10:00:00Z", ed: { arrivals: 0, untriaged: 0 }, beds: { occupied: 1, unplacedPatients: 0, states: {} }, admissionsPending: { waiting: 0, longestWaitHours: 0 },
    dischargeCandidates: 0, staysWithOpenItems: [{ encounterId: "e5", patientId: "p5", name: "Test Patient QA-03", mrn: "SMD-6TEQZM-00029", openItems: 5, ward: "Cardiology Ward", bed: "CAR-08", lengthOfStayDays: 4 }], recentTransfers: [], bottlenecks: [], drill: {} };
  const flow = W._render({ ...W._st, view: "flowcommand", flow: { loaded: true, flow: f } });
  assert.match(flow, /Test Patient QA-03 &middot; SMD-6TEQZM-00029/);

  const board = W._render({ ...W._st, view: "board", board: { ok: true, bedsConfigured: true, wards: [
    { ward: "cardio", bedsKnown: false, notInWardList: "unknown", occupied: [], free: [], unplaced: [{ encounterId: "e1", name: "Demo Naina Synthia" }] },
    { ward: "Step-down Unit", bedsKnown: true, noBeds: true, occupied: [], free: [], unplaced: [] },
  ] } });
  assert.match(board, /Not a ward on this hospital&#39;s ward list|Not a ward on this hospital's ward list/);
  assert.match(board, /No beds are set up for this ward/);
  assert.ok(!/Bed list not configured/.test(board));
});

test("screens: investigations offer the catalogue as a search list, and a test not on it is ordered only as other", () => {
  const W = loadWard();
  const sel = { encounterId: "enc-1", patientId: "pat-1", ward: "Medical A", bed: "12", admittedAt: "2026-09-15T04:00:00.000Z", name: "Test Patient QA-03", mrn: "MRN-1" };
  const html = W._render({ ...W._st, orgId: "org-1", loaded: true, view: "chart", sel, invCatalogue: [{ code: "CXR", name: "X-ray chest", category: "imaging" }, { code: "CBC", name: "Complete blood count", category: "laboratory" }] });
  assert.match(html, /<datalist id="wInvList"><option value="X-ray chest \(CXR\)"><\/option><option value="Complete blood count \(CBC\)"><\/option><\/datalist>/);
  assert.match(html, /id="wInvCode" type="search" list="wInvList"/);
  assert.match(html, /id="wInvOther" type="checkbox"/);
  assert.match(W._render({ ...W._st, orgId: "org-1", loaded: true, view: "chart", sel, invCatalogue: false }), /The list of tests could not be loaded/);
  assert.match(WARD_SRC, /if \(!entry && !other\) \{ st\.err = wT\("ward\.inv-pick-from-list"/);
  assert.match(WARD_SRC, /if \(!entry && !reason\) \{ st\.err = wT\("ward\.inv-other-needs-reason"/);
});
