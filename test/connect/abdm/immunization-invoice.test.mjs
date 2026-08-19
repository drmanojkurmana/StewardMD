// test/connect/abdm/immunization-invoice.test.mjs — SCCM v1.1: the last two mandatory HI types.
//
// ABDM makes all EIGHT HI types mandatory for an HMIS. ImmunizationRecord and InvoiceRecord were
// unproducible because SCCM had nowhere to put a vaccination or a bill, and NRCES marks
// Composition.section AND section.entry min=1 on both profiles - so an empty one is structurally INVALID,
// not merely thin.
//
// The rules worth defending here are about not inventing data: a currency is never guessed, an incomplete
// site coding is dropped rather than half-emitted, and a record with no line items is refused rather than
// pushed as an empty bill.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bundle, patient, immunization, invoice, money, invoiceLineItem, invoicePriceComponent, RESOURCE_KEYS,
} from "../../../functions/_connect/canonical/model.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { codeable, coding } from "../../../functions/_connect/canonical/coding.js";
import { serializeNdhm, validateNdhmDoc } from "../../../functions/_connect/connectors/abdm/serialize.js";
import { normalizeNdhm } from "../../../functions/_connect/connectors/abdm/normalize.js";
import { immunizationRecord, invoiceRecord } from "./fixtures/sccm-records.mjs";

const NOW = "2026-08-19T00:00:00.000Z";
const ctx = { now: () => new Date(NOW), tenant: { id: "t1" }, hipId: "IN2810006668", envName: "sandbox" };
const std = (system, code, display) => coding({ system, code, display, kind: "standard" });
const res = (doc, type) => doc.entry.map((e) => e.resource).filter((r) => r.resourceType === type);
const comp = (doc) => doc.entry[0].resource;
const wrap = (o) => bundle({ tenantId: "t1", patient: patient({ id: "p1", name: { text: "A" } }), ...o });

const VACCINE = codeable({ coding: [std("http://snomed.info/sct", "871761004", "Rotavirus vaccine")], text: "Rotavirus vaccine" });
const BILLING = "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-billing-codes";
const PRICE = "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components";
const CONSULT = codeable({ coding: [std(BILLING, "00", "Consultation")], text: "Consultation" });
const RATE = codeable({ coding: [std(PRICE, "01", "Rate")], text: "Rate" });
const okInvoice = (over = {}) => invoice({
  id: "inv-1", identifierValue: "X/1", date: NOW, type: CONSULT,
  lineItems: [{ chargeItem: CONSULT, priceComponents: [{ type: "base", code: RATE, amount: { value: 500, currency: "INR" } }] }],
  totalNet: { value: 500, currency: "INR" }, totalGross: { value: 590, currency: "INR" }, ...over,
});

// ── the model ───────────────────────────────────────────────────────────────────────────────────────
test("both collections are part of the canonical bundle and its resource keys", () => {
  assert.ok(RESOURCE_KEYS.includes("immunizations"));
  assert.ok(RESOURCE_KEYS.includes("invoices"));
  const b = bundle({});
  assert.deepEqual(b.immunizations, []);
  assert.deepEqual(b.invoices, []);
});

test("an absent optional field is OMITTED, never defaulted to a placeholder", () => {
  const im = immunization({ id: "i1", vaccineCode: VACCINE, occurrenceDateTime: NOW });
  for (const k of ["lotNumber", "site", "route", "manufacturer", "doseNumber", "expirationDate"]) {
    assert.ok(!(k in im), k + " must be absent, not null-filled");
  }
  assert.equal(im.status, "completed", "status is the one field with a sensible default");
});

test("money carries a currency and never invents one", () => {
  assert.deepEqual(money({ value: 500, currency: "INR" }), { value: 500, currency: "INR" });
  assert.deepEqual(money({ value: 500 }), { value: 500 }, "no currency is emitted rather than guessed");
  assert.deepEqual(money({}), {});
});

test("a resource with no id is refused outright", () => {
  assert.throws(() => immunization({}), /stable string id/);
  assert.throws(() => invoice({}), /stable string id/);
});

// ── SCCM validation ─────────────────────────────────────────────────────────────────────────────────
test("the shipped fixtures are valid SCCM", () => {
  for (const [n, b] of [["immunizationRecord", immunizationRecord], ["invoiceRecord", invoiceRecord]]) {
    const v = validateBundle(b);
    assert.equal(v.ok, true, n + ": " + JSON.stringify(v.errors));
  }
});

test("an immunisation missing a FHIR minimum is rejected at ingest, not at push time", () => {
  const cases = {
    "no vaccineCode": immunization({ id: "i1", occurrenceDateTime: NOW }),
    "no occurrence": immunization({ id: "i1", vaccineCode: VACCINE }),
    "bad status": immunization({ id: "i1", vaccineCode: VACCINE, occurrenceDateTime: NOW, status: "made-up" }),
  };
  for (const [what, im] of Object.entries(cases)) {
    const v = validateBundle(wrap({ immunizations: [im] }));
    assert.equal(v.ok, false, what + " must be rejected");
  }
});

test("an invoice missing a FHIR minimum is rejected at ingest", () => {
  const cases = {
    "no identifier": okInvoice({ identifierValue: null }),
    "no date": okInvoice({ date: null }),
    "no type": okInvoice({ type: null }),
    "no line items": okInvoice({ lineItems: [] }),
    "no totals": okInvoice({ totalNet: null, totalGross: null }),
    "bad status": okInvoice({ status: "paid-ish" }),
  };
  for (const [what, inv] of Object.entries(cases)) {
    assert.equal(validateBundle(wrap({ invoices: [inv] })).ok, false, what + " must be rejected");
  }
});

test("an amount with no currency is REFUSED - a number is not a price", () => {
  const inv = okInvoice({ totalGross: { value: 590 } });
  const v = validateBundle(wrap({ invoices: [inv] }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /currency/.test(e)), JSON.stringify(v.errors));
});

test("a price component with an out-of-set type is refused", () => {
  const inv = okInvoice({ lineItems: [{ chargeItem: CONSULT, priceComponents: [{ type: "vat", code: RATE, amount: { value: 1, currency: "INR" } }] }] });
  assert.equal(validateBundle(wrap({ invoices: [inv] })).ok, false,
    "the R4 binding is base|surcharge|deduction|discount|tax|informational");
});

test("a line item with no price component is refused", () => {
  const inv = okInvoice({ lineItems: [{ chargeItem: CONSULT, priceComponents: [] }] });
  assert.equal(validateBundle(wrap({ invoices: [inv] })).ok, false);
});

// ── serialization ───────────────────────────────────────────────────────────────────────────────────
test("ImmunizationRecord now BUILDS, and carries the immunisation in its single section", () => {
  const doc = serializeNdhm(ctx, { ...immunizationRecord, profile: "ImmunizationRecord" });
  assert.equal(validateNdhmDoc(doc).ok, true, JSON.stringify(validateNdhmDoc(doc).errors));
  assert.equal(comp(doc).type.coding[0].code, "41000179103");
  assert.equal(comp(doc).section.length, 1, "the profile allows exactly one");
  assert.deepEqual(comp(doc).section[0].entry.map((e) => e.type), ["Immunization"]);

  const im = res(doc, "Immunization")[0];
  assert.equal(im.status, "completed");
  assert.equal(im.occurrenceDateTime, "2026-07-30T09:30:00Z");
  assert.ok(im.patient, "patient is min=1");
  assert.equal(im.vaccineCode.coding[0].code, "871761004");
  assert.ok(im.vaccineCode.coding[0].system && im.vaccineCode.coding[0].display,
    "vaccineCode.coding needs system, code AND display");
  assert.deepEqual(im.protocolApplied, [{ doseNumberPositiveInt: 2 }]);
});

test("InvoiceRecord now BUILDS, with real NDHM billing codes and both totals", () => {
  const doc = serializeNdhm(ctx, { ...invoiceRecord, profile: "InvoiceRecord" });
  assert.equal(validateNdhmDoc(doc).ok, true, JSON.stringify(validateNdhmDoc(doc).errors));
  assert.equal(comp(doc).type.text, "Invoice Record");
  assert.equal(comp(doc).type.coding, undefined, "this profile fixes only text");
  assert.deepEqual(comp(doc).section[0].entry.map((e) => e.type), ["Invoice"]);

  const inv = res(doc, "Invoice")[0];
  assert.equal(inv.status, "issued");
  assert.equal(inv.identifier[0].value, "GIMSR/2026/000123");
  assert.ok(inv.subject, "subject is min=1");
  assert.ok(inv.participant && inv.participant[0].actor, "participant.actor is min=1 once participant exists");
  assert.equal(inv.type.coding[0].code, "00");
  assert.deepEqual(inv.totalNet, { value: 500, currency: "INR" });
  assert.deepEqual(inv.totalGross, { value: 590, currency: "INR" });
  const pc = inv.lineItem[0].priceComponent;
  assert.deepEqual(pc.map((p) => p.type), ["base", "tax", "tax"]);
  assert.ok(pc.every((p) => p.code.coding[0].system && p.code.coding[0].code && p.code.coding[0].display));
  assert.equal(inv.lineItem[0].sequence, 1);
  assert.ok(inv.lineItem[0].chargeItemCodeableConcept, "chargeItem[x] is min=1");
});

test("an INCOMPLETE site or route coding is dropped rather than half-emitted", () => {
  // NRCES makes site.coding.system/code/display all min=1 once `site` exists, so a text-only site would
  // be rejected. Better to say nothing about the site than to say something unvalidatable.
  const doc = serializeNdhm(ctx, {
    ...immunizationRecord, profile: "ImmunizationRecord",
    immunizations: [immunization({
      id: "i1", vaccineCode: VACCINE, occurrenceDateTime: NOW,
      site: codeable({ text: "left arm" }),                                  // no coding at all
      route: codeable({ coding: [coding({ system: "http://snomed.info/sct", code: "78421000" })], text: "IM" }), // no display
    })],
  });
  const im = res(doc, "Immunization")[0];
  assert.equal(im.site, undefined, "a text-only site is not a valid NRCES site");
  assert.equal(im.route, undefined, "a coding with no display is not valid either");
  assert.equal(validateNdhmDoc(doc).ok, true);
});

test("a record with no immunisations or no invoices is still REFUSED", () => {
  // The `needs` guard survives the model change: section and section.entry are both min=1, so an empty
  // document would be rejected by the receiving system.
  assert.equal(validateNdhmDoc(serializeNdhm(ctx, { ...invoiceRecord, profile: "ImmunizationRecord" })).ok, false);
  assert.equal(validateNdhmDoc(serializeNdhm(ctx, { ...immunizationRecord, profile: "InvoiceRecord" })).ok, false);
});

// ── the round trip ──────────────────────────────────────────────────────────────────────────────────
test("an Immunization survives serialize -> normalize with its facts intact", () => {
  const doc = serializeNdhm(ctx, { ...immunizationRecord, profile: "ImmunizationRecord" });
  const back = normalizeNdhm({ now: () => new Date(NOW), tenant: { id: "t1" } }, doc);
  assert.equal(back.immunizations.length, 1, "the normalizer used to WARN and drop these");
  const im = back.immunizations[0];
  assert.equal(im.id, "imm-1");
  assert.equal(im.status, "completed");
  assert.equal(im.occurrenceDateTime, "2026-07-30T09:30:00Z");
  assert.equal(im.vaccineCode.text, "Rotavirus vaccine");
  assert.equal(im.vaccineCode.coding[0].code, "871761004");
  assert.equal(im.doseNumber, 2);
  assert.equal(im.lotNumber, "SYN-2026-07");
  assert.equal(validateBundle(back).ok, true, JSON.stringify(validateBundle(back).errors));
});

test("an Invoice survives serialize -> normalize, money and all", () => {
  const doc = serializeNdhm(ctx, { ...invoiceRecord, profile: "InvoiceRecord" });
  const back = normalizeNdhm({ now: () => new Date(NOW), tenant: { id: "t1" } }, doc);
  assert.equal(back.invoices.length, 1, "the normalizer used to skip these as 'not clinical data'");
  const inv = back.invoices[0];
  assert.equal(inv.id, "inv-1");
  assert.equal(inv.identifierValue, "GIMSR/2026/000123");
  assert.equal(inv.status, "issued");
  assert.deepEqual(inv.totalNet, { value: 500, currency: "INR" });
  assert.deepEqual(inv.totalGross, { value: 590, currency: "INR" });
  assert.equal(inv.lineItems.length, 1);
  assert.deepEqual(inv.lineItems[0].priceComponents.map((p) => p.type), ["base", "tax", "tax"]);
  assert.deepEqual(inv.lineItems[0].priceComponents[0].amount, { value: 500, currency: "INR" });
  assert.equal(validateBundle(back).ok, true, JSON.stringify(validateBundle(back).errors));
});

test("the round trip does not silently warn away what it used to drop", () => {
  const doc = serializeNdhm(ctx, { ...immunizationRecord, profile: "ImmunizationRecord" });
  const back = normalizeNdhm({ now: () => new Date(NOW), tenant: { id: "t1" } }, doc);
  const skipped = (back.meta.warnings || []).filter((w) => /Immunization|Invoice/.test(w) && /skip/i.test(w));
  assert.deepEqual(skipped, [], "the DEFER warnings are retired: " + JSON.stringify(back.meta.warnings));
});
