import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-billing-audit-fixes.test.mjs - regression tests for the 2026-09 billing audit (BILL-01 to BILL-07,
 * BILL-22; report audit-D). The harness is the invoice bridge's: the REAL /api/queue router over a MemoryRepository.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-billing-audit-fixes.test.mjs
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
const DOCTOR = "doctor@example.test", NURSE = "nurse@example.test", CASHIER = "cashier@example.test", PHARM = "pharm@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seedHospital() {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT_ROW.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { tariff: TARIFF } }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [NURSE, "nurse"], [CASHIER, "cashier"], [PHARM, "pharmacy"]]) {
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
  const ord = await as(DOCTOR, "/ward/medication-order", "POST", { orgId: ORG, order: { patientId: adm.patientId, encounterId: adm.encounterId, drug, drugCode: "MET500", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "STAT" } });
  await as(NURSE, "/ward/vitals", "POST", { orgId: ORG, encounterId: adm.encounterId, patientId: adm.patientId, vitals: { weight: "70" } });
  const patient = { id: adm.patientId, mrn: reg.mrn, wristbandBarcode: reg.mrn };
  const scan = { patientBarcode: reg.mrn, drugBarcode: drug, dose: { value: 500, unit: "mg" }, route: "oral" };
  /* CLIN-11: a dose is charted at a time the order schedules, read from the round. A STAT order's one dose is due
   * when it was written, so it is given now rather than at a fixed date the order never scheduled. */
  const win = (h) => encodeURIComponent(new Date(Date.now() + h * 3600e3).toISOString());
  const dueAt = (await as(NURSE, `/ward/schedule?orgId=${ORG}&patientId=${adm.patientId}&from=${win(-1)}&to=${win(1)}`)).due.find((d) => d.orderId === ord.orderId).dueAt;
  const mar = (email, action, extra) => as(email, "/ward/mar", "POST", { orgId: ORG, action, orderId: ord.orderId, dueAt, patient, ...extra });
  await mar(NURSE, "verify");
  await mar(NURSE, "dispense");
  await mar(NURSE, "scan", { scan });
  const given = await mar(NURSE, "administer");
  return { reg, adm, ord, given };
}

const setTariff = (t) => { docs.get(`q_orgs/${ORG}`).fields.wardsynq = { tariff: t }; };
const raise = (adm, extra) => as(CASHIER, "/ward/invoice", "POST", { orgId: ORG, patientId: adm.patientId, encounterId: adm.encounterId, ...(extra || {}) });
const lines = (inv) => (inv.lines || []).map((l) => [l.code, l.sourceType, l.quantity, l.line]);
const dispense28 = (ord) => as(PHARM, "/ward/dispense", "POST", { orgId: ORG, orderId: ord.orderId, quantity: { value: 28, unit: "tablet" }, batch: "B1", expiry: "2030-01" });

/* BILL-01: one drug was billed for the pharmacy supply AND for every dose given, both under the drug's code, so no
 * tariff could choose. Now a dispense is priced only under its own supply code ("<drug code>:supply:<unit>"). */
test("BILL-01: a drug priced per dose is billed for the doses given, not again for the pharmacy supply", async () => {
  seedHospital();
  const { adm, ord } = await admittedPatientOnAdministeredDrug();
  const d = await dispense28(ord);
  assert.equal(d.__status, 200, JSON.stringify(d));
  const inv = await raise(adm);
  assert.equal(inv.__status, 200, JSON.stringify(inv));
  assert.deepEqual(lines(inv).filter((l) => l[0].startsWith("MET500")), [["MET500", "MedicationAdministration", 1, 12]], "billed once, for the dose");
  const ch = await as(CASHIER, `/ward/charges?orgId=${ORG}&patientId=${adm.patientId}&encounterId=${adm.encounterId}`);
  assert.ok((ch.notCharged || []).some((s) => s.sourceType === "MedicationDispense" && s.reason === "billed_per_dose"), "the supply is named as not charged, with why");
});

/* BILL-01 and BILL-06: a hospital that prices the supply gets the supply billed, for the quantity issued, and the doses
 * of that drug are then not billed again. */
test("BILL-01 + BILL-06: a drug priced per supply unit bills the quantity dispensed, and the doses are not billed again", async () => {
  seedHospital();
  setTariff({ MET500: { amount: 12, currency: "INR" }, "MET500:supply:tablet": { amount: 12, currency: "INR" } });
  const { adm, ord } = await admittedPatientOnAdministeredDrug();
  await dispense28(ord);
  const inv = await raise(adm);
  assert.equal(inv.__status, 200, JSON.stringify(inv));
  assert.deepEqual(lines(inv).filter((l) => l[0].startsWith("MET500")), [["MET500:supply:tablet", "MedicationDispense", 28, 336]], "28 tablets at Rs 12, and no dose line");
});

test("BILL-06: a dispense in a unit the tariff does not price is listed unpriced, never billed as one unit", async () => {
  seedHospital();
  setTariff({ MET500: { amount: 12, currency: "INR" }, "MET500:supply:strip": { amount: 110, currency: "INR" } });
  const { adm, ord } = await admittedPatientOnAdministeredDrug();
  await dispense28(ord);
  const ch = await as(CASHIER, `/ward/charges?orgId=${ORG}&patientId=${adm.patientId}&encounterId=${adm.encounterId}`);
  assert.ok(!(ch.priced || []).some((p) => p.sourceType === "MedicationDispense"), "not priced in the wrong unit");
  assert.deepEqual((ch.unpriced || []).filter((u) => u.sourceType === "MedicationDispense").map((u) => [u.code, u.reason]), [["MET500:supply:tablet", "no_tariff_entry"]]);
});

/* BILL-02: two raises at the same moment both read "nothing billed yet" and both wrote a bill. */
test("BILL-02: two raise-invoice requests at the same moment put the charges on ONE bill", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnAdministeredDrug();
  const [a, b] = await Promise.all([raise(adm), raise(adm)]);
  assert.equal([a, b].filter((r) => r.written === 1).length, 1, JSON.stringify([a.error || a.written, b.error || b.written]));
  const list = await as(CASHIER, `/ward/invoices?orgId=${ORG}&patientId=${adm.patientId}`);
  assert.equal(list.invoices.length, 1);
  assert.equal(list.outstandingBalance, 12);
});

/* BILL-03: a request resent after a lost response, carrying the same idempotency key, is ONE event. */
test("BILL-03: a payment, a refund and a raise resent with the same idempotency key are each recorded once", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnAdministeredDrug();
  const r1 = await raise(adm, { idempotencyKey: "k-raise-1" });
  const r2 = await raise(adm, { idempotencyKey: "k-raise-1" });
  assert.equal(r1.written, 1);
  assert.equal(r2.invoiceId, r1.invoiceId, "the retried raise answers with the first bill");
  const pay = { orgId: ORG, invoiceId: r1.invoiceId, amount: 12, idempotencyKey: "k-pay-1" };
  const p1 = await as(CASHIER, "/ward/invoice-payment", "POST", pay);
  const p2 = await as(CASHIER, "/ward/invoice-payment", "POST", pay);
  assert.equal(p1.__status, 200, JSON.stringify(p1));
  assert.equal(p2.__status, 200, JSON.stringify(p2));
  assert.deepEqual([p2.paidIn, p2.balance, p2.receipts.length], [12, 0, 1], "the retry answers with the first outcome and records nothing");
  const extra = await as(CASHIER, "/ward/invoice-payment", "POST", { ...pay, idempotencyKey: "k-pay-2" });
  assert.equal(extra.paidIn, 24, "a genuinely new payment (new key) is still recorded");
  const refund = { orgId: ORG, invoiceId: r1.invoiceId, amount: 12, reason: "overpaid", idempotencyKey: "k-ref-1" };
  const f1 = await as(CASHIER, "/ward/invoice-refund", "POST", refund);
  const f2 = await as(CASHIER, "/ward/invoice-refund", "POST", refund);
  assert.equal(f1.__status, 200, JSON.stringify(f1));
  assert.deepEqual([f2.refundedOut, f2.balance], [12, 0], "one refund, not two");
  const stored = await RECORD.latest(TENANT_ROW.id, "Invoice", r1.invoiceId);
  assert.equal(stored.events.filter((e) => e.kind === "payment").length, 2);
  assert.equal(stored.events.filter((e) => e.kind === "refund").length, 1);
});

/* BILL-04: the already-invoiced set counted void bills, so a voided bill's charges could never be billed again. */
test("BILL-04: after a bill is voided its charges can be raised again", async () => {
  seedHospital();
  const { adm } = await admittedPatientOnAdministeredDrug();
  const first = await raise(adm);
  const v = await as(CASHIER, "/ward/invoice-void", "POST", { orgId: ORG, invoiceId: first.invoiceId, reason: "wrong payer" });
  assert.equal(v.__status, 200, JSON.stringify(v));
  const again = await raise(adm);
  assert.equal(again.written, 1, JSON.stringify(again));
  assert.deepEqual(lines(again), lines(first));
});

/* BILL-07: a bed priced per hour kept one sourceId per day while the day's hours grew, and a sourceId on any bill was
 * excluded for ever, so an interim bill at hour 5 left 19 hours of that day unbilled. What is already on a live bill is
 * now counted by quantity: a later bill charges the hours added since. */
test("BILL-07: an hourly bed interim-billed at hour 5 is billed for all 30 hours by the final bill", async () => {
  const { stayDays, stayDayItems, priceWith, unbilledItems } = await import("../functions/_wardsynq/charge-capture.js");
  const table = { "ICU-BED": { amount: 1000, kind: "bed", unitHours: 1, description: "ICU bed per hour" } };
  const enc = { id: "enc-1", patientId: "p1", periodStart: "2026-09-20T08:00:00Z", location: { ward: "ICU" } };
  const t0 = Date.parse(enc.periodStart);
  const interim = priceWith(stayDayItems(enc, stayDays(enc, null, t0 + 5 * 3600e3), table), table).priced;
  const invoices = [{ id: "inv-1", lines: interim }];
  const done = { ...enc, periodEnd: new Date(t0 + 30 * 3600e3).toISOString() };
  const all = priceWith(stayDayItems(done, stayDays(done, null, Date.now()), table), table).priced;
  const fin = unbilledItems(all, invoices);
  assert.deepEqual(fin.map((l) => [l.sourceId, l.quantity, l.line]), [["enc-1:bed:1", 19, 19000], ["enc-1:bed:2", 6, 6000]]);
  assert.equal([...interim, ...fin].reduce((n, l) => n + l.quantity, 0), 30);
  // A void bill bills nothing (BILL-04), and a later bill that covered everything leaves nothing.
  assert.equal(unbilledItems(all, [{ void: true, lines: all }]).length, 2);
  assert.equal(unbilledItems(all, [...invoices, { lines: fin }]).length, 0);
  // The discharge checklist reads the same way: 25 hours are still unbilled after the interim bill.
  const { billState } = await import("../functions/_wardsynq/migrate-discharge.js");
  const { openInvoice, postEvent } = await import("../wardsynq/wardsynq-invoice.js");
  const paid = openInvoice({ id: "inv-1", patientId: "p1", encounterId: "enc-1", currency: "INR", lines: interim, actorId: "a", at: "2026-09-20T13:00:00Z" });
  postEvent(paid, "payment", { amount: 5000, actorId: "a", at: "2026-09-20T13:05:00Z" });
  const bs = billState({ ok: true, priced: all, unpriced: [] }, [paid], done, Date.now());
  assert.equal(bs.state, "unbilled", "the interim bill is paid, but 25 hours were never billed");
  assert.deepEqual(bs.unbilled.map((u) => u.amount), [19000, 6000]);
});

/* BILL-22: CGST and SGST are each levied at half the rate on the same taxable value, so they are equal. The tax on a
 * line is the two halves, each rounded to the paisa (half up); an odd paisa is never pushed onto one half. */
test("BILL-22: Rs 5,001 at 5 percent is CGST 125.03 + SGST 125.03, and every invoice line splits into equal halves", async () => {
  const R = await import("../functions/_region_in.js");
  const table = { ROOM: { amount: 5001, kind: "bed", gstRate: 5, hsnSac: "999311" } };
  const g = R.gstForLines([{ code: "ROOM", sourceType: "Encounter", sourceId: "e:bed:1", quantity: 1, amount: 5001, line: 5001 }], table, "IN", { inpatient: true });
  assert.equal(g.lines[0].tax, 250.06);
  assert.deepEqual(R.gstSplit(g.lines[0].tax, false), { cgst: 125.03, sgst: 125.03, igst: 0 });
  for (const [taxable, rate] of [[300.25 * 20, 5], [99.99, 18], [1234.57, 12], [0.01, 5], [5001, 5]]) {
    const t = R.gstForLines([{ code: "X", line: taxable }], { X: { amount: taxable, gstRate: rate, kind: "service", nonHealthcare: true, hsnSac: "9963" } }, "IN", {}).lines[0].tax;
    const sp = R.gstSplit(t, false);
    assert.equal(sp.cgst, sp.sgst, `${taxable} at ${rate}: ${t}`);
    assert.equal(Math.round((sp.cgst + sp.sgst) * 100), Math.round(t * 100));
  }
  // A credit note on the whole line reverses exactly the tax the line carried.
  const { openInvoice, postNote } = await import("../wardsynq/wardsynq-invoice.js");
  const inv = openInvoice({ id: "i", patientId: "p", currency: "INR", actorId: "a", at: "2026-09-20T00:00:00Z",
    lines: [{ code: "ROOM", display: "Room", quantity: 1, amount: 5001, line: 5001, taxKind: "GST", taxRate: 5, taxExempt: false, tax: g.lines[0].tax, taxBasis: "room", taxable: 5001 }] });
  postNote(inv, "credit_note", { noteNumber: "CRN/1", actorId: "a", at: "2026-09-21T00:00:00Z", reason: "r", lines: [{ lineIndex: 0, taxable: 5001 }] });
  assert.equal(inv.events.at(-1).tax, 250.06);
});

/* BILL-02, BILL-03, BILL-18, the client half: ward.js minted no idempotency key for money or stock writes, so fetchRetry's
 * resend after a lost answer was a second write, and the cashier buttons were live while a request was in flight. */
test("BILL-03 client: ward.js keys every money, claim and stock write once per submission, and a second tap does nothing", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
  const m = src.match(/var ONCE_PATH = (\/\^.*\$\/);/);
  assert.ok(m, "ward.js names the writes that must happen once");
  const once = eval(m[1]);
  for (const p of ["/ward/invoice", "/ward/invoice-payment", "/ward/invoice-deposit", "/ward/invoice-refund", "/ward/invoice-void", "/ward/invoice-credit-note",
    "/ward/claim", "/ward/preauth", "/ward/stock-move", "/ward/stock-reconcile", "/ward/dispense", "/ward/goods-receive"]) assert.ok(once.test(p), p);
  assert.ok(!once.test("/ward/vitals") && !once.test("/ward/invoice-payment-link"), "only the writes that move money or stock");
  const apiPost = src.slice(src.indexOf("function apiPost(path, body) {"), src.indexOf("function apiPost(path, body) {") + 400);
  assert.match(apiPost, /ONCE_PATH\.test\(path\) && body && !body\.idempotencyKey\) body\.idempotencyKey = offlineKey\(\)/, "minted before the first attempt, reused by fetchRetry");
  assert.match(src, /function cashRaise\(\) \{\n[^\n]*\n\s+if \([^)]*st\.busy\) return;/, "a second raise tap while one is in flight does nothing");
  assert.match(src, /function cashPost\(invoiceId, kind\) \{\n\s+if \(st\.busy\) return;/, "a second payment tap while one is in flight does nothing");
});
