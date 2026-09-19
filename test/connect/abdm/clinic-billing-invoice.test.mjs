// A real clinic bill -> a conformant SCCM InvoiceRecord. The gap this closes: `invoices` existed and
// round-tripped, but nothing in the product ever produced one, so InvoiceRecord was servable in theory only.
import test from "node:test";
import assert from "node:assert/strict";
import { projectInvoiceResource, projectInvoiceRecord, BILLING_CODES, NDHM_BILLING, NDHM_PRICE }
  from "../../../functions/_connect/abdm/hip-sources/clinic-billing.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { serializeNdhm, validateNdhmDoc } from "../../../functions/_connect/connectors/abdm/serialize.js";
import { normalizeNdhm } from "../../../functions/_connect/connectors/abdm/normalize.js";
import { buildInvoice } from "../../../functions/_clinic_billing.js";

const ctx = { tenantId: "gimsr", now: () => "2026-08-19T00:00:00.000Z" };

// Exactly what _clinic_billing_store.getInvoice() returns, built through the REAL pure builder so the
// paise contract is the product's own and not a shape invented for the test.
const ORDERS = [
  { id: "o1", name: "Specialist consultation", qty: 1, unitPrice: 50000 },   // Rs 500.00
  { id: "o2", name: "CBC", qty: 2, unitPrice: 12345 },                       // Rs 123.45 x2
];
const row = (over = {}) => Object.assign({
  id: "inv_abc123", patientId: "SMD-GIMSR-0042", encounterId: "",
  status: "open", createdAt: Date.parse("2026-08-18T09:30:00Z"),
}, buildInvoice(ORDERS), over);

test("paise become rupees exactly once, and the currency is never invented", () => {
  const inv = projectInvoiceResource(row());
  assert.deepEqual(inv.totalGross, { value: 746.90, currency: "INR" });      // 50000 + 24690 paise
  assert.deepEqual(inv.lineItems[0].priceComponents[0].amount, { value: 500, currency: "INR" });
  // 12345 paise is the case a float would mangle.
  assert.deepEqual(inv.lineItems[1].priceComponents[0].amount, { value: 123.45, currency: "INR" });
  for (const li of inv.lineItems) assert.equal(li.priceComponents[0].amount.currency, "INR");
});

test("quantity is a FACTOR on the unit rate, not a restated total", () => {
  const inv = projectInvoiceResource(row());
  const pc = inv.lineItems[1].priceComponents[0];
  assert.equal(pc.factor, 2);
  assert.equal(pc.amount.value, 123.45, "the amount is the RATE; 246.90 here would double-count");
  assert.equal(pc.type, "base");
  assert.equal(pc.code.coding[0].system, NDHM_PRICE);
  assert.equal(pc.code.coding[0].code, "01");
});

test("the station's open/paid lifecycle maps onto FHIR's, and an unknown status is not coerced", () => {
  assert.equal(projectInvoiceResource(row()).status, "issued");
  assert.equal(projectInvoiceResource(row({ status: "paid" })).status, "balanced");
  // A status we do not know must fail validation rather than silently become "issued".
  const odd = projectInvoiceRecord(row({ status: "weird" }), ctx);
  assert.equal(validateBundle(odd).ok, false);
});

test("codes come from the IG's own system, and no procedure code is invented from a free-text item", () => {
  const inv = projectInvoiceResource(row());
  assert.equal(inv.type.coding[0].system, NDHM_BILLING);
  assert.equal(inv.type.coding[0].code, "03", "the billing station bills OPD");
  const li = inv.lineItems[0];
  assert.equal(li.chargeItem.coding[0].system, NDHM_BILLING);
  assert.equal(li.chargeItem.text, "Specialist consultation");
  // The tariff's own code is not on the invoice line, so nothing may claim one.
  assert.ok(!li.chargeItem.coding.some((c) => c.code === "" || /consult/i.test(String(c.code))));
});

test("a pharmacy station can pass its own billing code instead of inheriting OPD", () => {
  const inv = projectInvoiceResource(row(), { typeCode: BILLING_CODES.PHARMACY });
  assert.equal(inv.type.coding[0].code, "01");
  assert.equal(inv.lineItems[0].chargeItem.coding[0].code, "01");
});

test("the projected record is valid SCCM and carries no patient name", () => {
  const rec = projectInvoiceRecord(row(), ctx);
  const v = validateBundle(rec);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(rec.recordType, "InvoiceRecord");
  assert.equal(rec.patient.name, null, "the bill does not need the name, so it does not carry it");
  assert.equal(rec.patient.identifiers[0].value, "SMD-GIMSR-0042");
});

test("it SERIALIZES to a conformant NDHM InvoiceRecord", () => {
  const doc = serializeNdhm(ctx, { ...projectInvoiceRecord(row(), ctx), profile: "InvoiceRecord" });
  const v = validateNdhmDoc(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const inv = doc.entry.map((e) => e.resource).find((r) => r.resourceType === "Invoice");
  assert.equal(inv.totalGross.value, 746.90);
  assert.equal(inv.totalGross.currency, "INR");
  assert.equal(inv.lineItem.length, 2);
  assert.equal(inv.lineItem[0].sequence, 1);
});

test("and it survives the round trip back to SCCM with the money intact", () => {
  const doc = serializeNdhm(ctx, { ...projectInvoiceRecord(row({ status: "paid" }), ctx), profile: "InvoiceRecord" });
  const back = normalizeNdhm(ctx, doc);
  assert.equal(back.invoices.length, 1);
  assert.equal(back.invoices[0].status, "balanced");
  assert.deepEqual(back.invoices[0].totalGross, { value: 746.90, currency: "INR" });
});

test("an empty bill produces no InvoiceRecord rather than an empty one", () => {
  // NRCES makes section.entry min=1, and a bill with no lines is not a bill.
  const empty = projectInvoiceRecord(row({ lines: [], subtotal: 0, total: 0 }), ctx);
  assert.equal(validateBundle(empty).ok, false);
});

test("an app id with an UNDERSCORE becomes a legal FHIR id on the wire", () => {
  // FHIR Resource.id is [A-Za-z0-9-.]{1,64}. The billing store mints `inv_<hex>`, which HAPI rejected
  // outright - and then failed the section entry referencing it. Our own gate missed it, so both the fix
  // and the gate are pinned here.
  const doc = serializeNdhm(ctx, { ...projectInvoiceRecord(row(), ctx), profile: "InvoiceRecord" });
  const ids = doc.entry.map((e) => e.resource.id);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9.-]{1,64}$/, "illegal id on the wire: " + id);
  const inv = doc.entry.map((e) => e.resource).find((r) => r.resourceType === "Invoice");
  assert.equal(inv.id, "inv-abc123", "the underscore is rewritten");
  // The business id survives where the charset does not apply.
  assert.equal(inv.identifier[0].value, "inv_abc123");
  assert.equal(validateNdhmDoc(doc).ok, true);
});

test("validateNdhmDoc now REFUSES an illegal id instead of leaving it to HAPI", () => {
  const doc = serializeNdhm(ctx, { ...projectInvoiceRecord(row(), ctx), profile: "InvoiceRecord" });
  doc.entry[0].resource.id = "comp_inv_1";          // what the serializer used to emit
  const v = validateNdhmDoc(doc);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /not a valid FHIR id/.test(e)), JSON.stringify(v.errors));
});
