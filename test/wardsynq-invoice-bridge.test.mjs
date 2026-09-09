/* test/wardsynq-invoice-bridge.test.mjs — TASK 4.6: the invoice ledger through the REAL routes,
 * against a real administered dose charge-capture.js itself prices from the real record.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-invoice-bridge.test.mjs
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
const TARIFF = { "MET500": { amount: 12, currency: "INR" }, "CONSULT": { amount: 500, currency: "INR" } };
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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", CASHIER = "cashier@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { tariff: TARIFF } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [CASHIER, "cashier"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
let n = 0;

/** Registers, admits and administers a real dose - the substrate charge-capture.js prices. */
async function admittedPatientOnAdministeredDrug() {
  n++;
  const reg = await as(DOCTOR, "/patient/register", "POST", { orgId: ORG, name: "Invoice Testcase " + n, mobile: "98765080" + String(n).padStart(2, "0"), gender: "male", ageYears: 50 });
  const adm = await as(DOCTOR, "/ward/admit", "POST", { orgId: ORG, mrn: reg.mrn, ward: "Medical A", bed: String(n) });
  const drug = "Metformin 500mg";
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug, drugCode: "MET500", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "OD" } });
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { weight: "70" } });
  const patient = { id: adm.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn };
  const scan = { patientBarcode: reg.mrn, drugBarcode: drug, dose: { value: 500, unit: "mg" }, route: "oral" };
  const mar = (email, action, extra) => as(email, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt: "2026-09-09T09:00:00.000Z", patient, ...extra });
  await mar(NURSE, "verify");
  await mar(NURSE, "dispense");
  await mar(NURSE, "scan", { scan });
  const given = await mar(NURSE, "administer");
  return { reg, adm, ord, given };
}

test("CASHIER: raises a real invoice from a real administered dose, priced against the hospital's own tariff", async () => {
  seedHospital();
  const { adm, given } = await admittedPatientOnAdministeredDrug();
  assert.equal(given.__status, 200, JSON.stringify(given));
  assert.equal(given.to, "administered");

  const raised = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId });
  assert.equal(raised.__status, 200, JSON.stringify(raised));
  assert.equal(raised.written, 1);
  assert.equal(raised.charged, 12, "the real MET500 tariff price, not a guess");
  assert.equal(raised.balance, 12);
  assert.equal(raised.status, "open");
  assert.equal(raised.lines[0].sourceType, "MedicationAdministration", "the line traces back to the real source event");

  // A second raise finds nothing new to invoice - the same dose is never billed twice.
  const again = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId });
  assert.equal(again.__status, 200, JSON.stringify(again));
  assert.equal(again.written, 0);
  assert.equal(again.skipped, "already_invoiced");
});

test("CASHIER: deposit, payment, refund and reconciliation - every event traceable, a refund cannot exceed what was paid", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnAdministeredDrug();
  const raised = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId });
  const invoiceId = raised.invoiceId;

  const deposit = await as(CASHIER, "/ward/invoice-deposit", "POST", { orgId: ORG, invoiceId, amount: 5 });
  assert.equal(deposit.__status, 200, JSON.stringify(deposit));
  assert.equal(deposit.balance, 7);

  const payment = await as(CASHIER, "/ward/invoice-payment", "POST", { orgId: ORG, invoiceId, amount: 7 });
  assert.equal(payment.__status, 200, JSON.stringify(payment));
  assert.equal(payment.balance, 0);
  assert.equal(payment.status, "paid");

  const overRefund = await as(CASHIER, "/ward/invoice-refund", "POST", { orgId: ORG, invoiceId, amount: 100, reason: "test" });
  assert.equal(overRefund.__status, 409, JSON.stringify(overRefund));
  assert.equal(overRefund.code, "REFUND_EXCEEDS_PAID");

  const refund = await as(CASHIER, "/ward/invoice-refund", "POST", { orgId: ORG, invoiceId, amount: 12, reason: "Overcharged - order corrected" });
  assert.equal(refund.__status, 200, JSON.stringify(refund));
  assert.equal(refund.balance, 12);
  assert.equal(refund.status, "open", "the refunded amount is owed again, not silently forgiven");

  const read = await as(CASHIER, `/ward/invoice?orgId=${ORG}&invoiceId=${invoiceId}`);
  assert.equal(read.__status, 200, JSON.stringify(read));
  assert.equal(read.invoice.paidIn, 12);
  assert.equal(read.invoice.refundedOut, 12);

  const forPatient = await as(CASHIER, `/ward/invoices?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(forPatient.__status, 200, JSON.stringify(forPatient));
  assert.equal(forPatient.invoices.length, 1);
  assert.equal(forPatient.outstandingBalance, 12);
});

test("a discount and a write-off both require a reason; a nurse cannot raise or post against an invoice (not billing.charge)", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnAdministeredDrug();
  const raised = await as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId });
  const invoiceId = raised.invoiceId;

  const noReason = await as(CASHIER, "/ward/invoice-discount", "POST", { orgId: ORG, invoiceId, amount: 2 });
  assert.equal(noReason.__status, 409, JSON.stringify(noReason));
  assert.equal(noReason.code, "REASON_REQUIRED");

  const discounted = await as(CASHIER, "/ward/invoice-discount", "POST", { orgId: ORG, invoiceId, amount: 2, reason: "Staff discount" });
  assert.equal(discounted.__status, 200, JSON.stringify(discounted));
  assert.equal(discounted.balance, 10);

  assert.equal((await as(NURSE, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId })).__status, 403);
  assert.equal((await as(NURSE, "/ward/invoice-payment", "POST", { orgId: ORG, invoiceId, amount: 5 })).__status, 403);
  // A nurse still reads it - billing.view, the same read the cashier has, is not the write authority.
  assert.equal((await as(NURSE, `/ward/invoice?orgId=${ORG}&invoiceId=${invoiceId}`)).__status, 403, "a plain nurse role holds neither billing.view nor billing.charge here");
});
