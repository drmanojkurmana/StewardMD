// functions/_connect/abdm/hip-sources/clinic-billing.js — the clinic BILLING station -> SCCM InvoiceRecord.
//
// WHY THIS EXISTS. SCCM v1.1 gained an `invoices` collection so InvoiceRecord (one of the eight HI types
// ABDM makes mandatory for an HMIS) could be served at all. Nothing populated it: the resource existed
// and round-tripped, but no real bill ever became one. This is the projection that closes that - the
// clinic billing station's `q_invoices` row is the only place in the product that holds what a patient was
// actually charged.
//
// PURE. Same invariant as the other HIP sources (ADR-2G): it re-shapes a row that already exists and
// never prices, discounts or re-bills anything. Firestore I/O stays in _clinic_billing_store.js; this file
// takes the row it already returns, so it is unit-testable with no Firestore and no billing flag.
//
// MONEY. The billing station is integer PAISE end to end, deliberately, because floats lose rupees.
// FHIR Money.value is in the currency's main unit, so paise are converted to rupees HERE and nowhere else,
// and the currency is INR because we issued the bill - that is a fact about our own tariff, not a guess
// about somebody else's. An amount whose paise value is missing is left out rather than sent as zero: a
// zero is a claim that the patient was charged nothing.
//
// NOT WIRED AS A HIP SOURCE YET, and that is deliberate. Advertising an invoice as a care context needs
// two decisions this file cannot make: whether a bill should be linkable at all (a linked context can
// never be withdrawn), and how it survives the same q_* retention conflict native-opd.js documents. So
// this exports the projection and the shape of the reader it would need, and stops there.

import { coding, codeable, provenance } from "../../canonical/coding.js";
import { bundle, patient, invoice, documentReference } from "../../canonical/model.js";

/** The IG's own billing code system, read out of its value sets (ndhm-billing-codes). */
export const NDHM_BILLING = "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-billing-codes";
/** ndhm-price-components: 00 MRP, 01 Rate, 02 Discount, 03 CGST, 04 SGST. */
export const NDHM_PRICE = "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components";

// The billing station bills OPD visits, so "03 OPD" describes the SOURCE rather than guessing at the
// contents. A future pharmacy or IPD station passes its own code instead of inheriting this one.
export const BILLING_CODES = { OPD: ["03", "OPD"], PHARMACY: ["01", "Pharmacy"], CONSULT: ["00", "Consultation"], IPD: ["02", "IPD"], OTHER: ["99", "Others"] };

// q_invoices carries the station's own lifecycle (open -> paid). FHIR Invoice.status is a different value
// set: an unpaid bill is "issued", a settled one is "balanced". Anything else is left to the caller rather
// than coerced, so an unknown status shows up as invalid instead of silently becoming "issued".
const STATUS = { open: "issued", paid: "balanced", cancelled: "cancelled" };

const rupees = (paise) => Number((Math.round(Number(paise) || 0) / 100).toFixed(2));
const std = (system, code, display) => coding({ system, code, display, kind: "standard" });
const money = (paise) => ({ value: rupees(paise), currency: "INR" });

/**
 * One `q_invoices` row -> one SCCM invoice resource. PURE.
 *
 * @param row { id, patientId, encounterId, lines:[{name,qty,unitPrice,amount}], subtotal, total,
 *              status, createdAt }  — exactly what _clinic_billing_store.getInvoice() returns.
 */
export function projectInvoiceResource(row, { typeCode = BILLING_CODES.OPD } = {}) {
  const [code, display] = typeCode;
  const type = codeable({ coding: [std(NDHM_BILLING, code, display)], text: display });
  const lines = (row && Array.isArray(row.lines) ? row.lines : []);

  return invoice({
    id: String(row.id),
    // The station's own invoice id IS the human-facing bill number; there is no second numbering to invent.
    identifierValue: String(row.id),
    status: STATUS[String(row && row.status)] || String(row && row.status || ""),
    type,
    date: new Date(Number(row.createdAt) || 0).toISOString(),
    lineItems: lines.map((l, i) => ({
      sequence: i + 1,
      // The tariff item's own code is not copied onto an invoice line, so the line is coded by what it IS
      // (an OPD charge) and named by the tariff text. Inventing a procedure code from a free-text item
      // name is exactly the kind of false clinical claim the serializer refuses elsewhere.
      chargeItem: codeable({ coding: [std(NDHM_BILLING, code, display)], text: String(l.name || "charge") }),
      priceComponents: [{
        type: "base",
        code: codeable({ coding: [std(NDHM_PRICE, "01", "Rate")], text: "Rate" }),
        amount: money(l.unitPrice),
        // qty as a FACTOR on the unit rate, which is what factor means - rather than restating the line
        // total as if it were a second charge.
        factor: Math.max(1, Math.round(Number(l.qty) || 1)),
      }],
    })),
    totalNet: money(row.subtotal != null ? row.subtotal : row.total),
    totalGross: money(row.total),
    encounter: row.encounterId ? { type: "Encounter", id: String(row.encounterId) } : null,
  });
}

/**
 * A whole SCCM InvoiceRecord bundle for one bill, ready for serializeNdhm(..., "InvoiceRecord").
 *
 * The subject carries the clinic's own MRN and NO name: the billing registry keeps the name under encPHI
 * and an invoice does not need it to be a valid bill.
 */
export function projectInvoiceRecord(row, { tenantId, now, typeCode } = {}) {
  const generatedAt = typeof now === "function" ? now() : new Date().toISOString();
  const inv = projectInvoiceResource(row, typeCode ? { typeCode } : {});
  const total = money(row.total);

  const record = bundle({
    tenantId, sourceConnector: "clinic-billing", generatedAt,
    patient: patient({
      id: String(row.patientId || row.id),
      identifiers: [{ system: "https://stewardmd.in/clinic/mrn", value: String(row.patientId || "") }],
      name: null,
    }),
    invoices: [inv],
    // documents[0] is the Composition narrative, never a second DocumentReference resource (the
    // InvoiceRecord section accepts invoices only) - so the bill reads as a sentence to a human too.
    documents: [documentReference({
      id: "comp-" + String(row.id),
      status: "final",
      type: codeable({ text: "Invoice Record" }),
      date: generatedAt,
      text: "Invoice " + row.id + ", total INR " + total.value.toFixed(2) +
            (STATUS[String(row.status)] === "balanced" ? " (paid)" : " (unpaid)"),
    })],
    scope: ["Patient", "Invoice"],
    provenance: [provenance({ resource: "Composition", sourceConnector: "clinic-billing", sourceId: String(row.id) })],
    warnings: [],
  });
  record.recordType = "InvoiceRecord";
  return record;
}

/**
 * The reader a HIP source would need, stated rather than built: listInvoices/getInvoice over q_invoices,
 * scoped to the org, keyed by the SAME patient pseudonym the other sources use. Wiring it is blocked on
 * the two decisions in the file header, not on code.
 */
export const CLINIC_BILLING_READER_SHAPE = {
  listInvoices: "(env, { tenantId, patientAbhaHash }) -> [row]",
  getInvoice: "(env, { tenantId, invoiceId }) -> row | null",
};
