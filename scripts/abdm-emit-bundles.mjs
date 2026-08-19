#!/usr/bin/env node
// scripts/abdm-emit-bundles.mjs — emit one NDHM bundle per PRODUCIBLE HI type, for the validator.
//
// Uses the same ctx serveTransfer builds, including the HFR facility that attests the document, so what
// is validated is what would actually be pushed to an HIU - not a hand-written sample.
import { writeFileSync, mkdirSync } from "node:fs";
import { serializeNdhm, validateNdhmDoc } from "../functions/_connect/connectors/abdm/serialize.js";
import { dischargeRecord, immunizationRecord, invoiceRecord } from "../test/connect/abdm/fixtures/sccm-records.mjs";
import { projectInvoiceRecord } from "../functions/_connect/abdm/hip-sources/clinic-billing.js";
import { buildInvoice } from "../functions/_clinic_billing.js";
import { projectTimeline } from "../functions/_connect/abdm/hip-sources/native-opd.js";
import { buildImmunisation } from "../functions/_vaccines.js";

const out = process.argv[2];
if (!out) { console.error("usage: abdm-emit-bundles.mjs <outdir>"); process.exit(2); }
mkdirSync(out, { recursive: true });

// ALL EIGHT, as ABDM requires of an HMIS. ImmunizationRecord and InvoiceRecord became producible when
// SCCM v1.1 gained `immunizations` and `invoices`; before that they were structurally impossible, because
// NRCES marks both Composition.section and section.entry min=1 on those profiles.
const PRODUCIBLE = ["OPConsultRecord", "PrescriptionRecord", "DiagnosticReportRecord",
                    "DischargeSummaryRecord", "HealthDocumentRecord", "WellnessRecord",
                    "ImmunizationRecord", "InvoiceRecord"];

// Each HI type is serialised from the SCCM record that actually carries its data - a discharge summary
// does not contain a bill, and pretending otherwise is how the generic-bundle bug happened.
const SOURCE = { ImmunizationRecord: immunizationRecord, InvoiceRecord: invoiceRecord };

const ctx = { now: () => new Date("2026-08-19T00:00:00.000Z"), tenant: { id: "t1" },
              hipId: "IN2810006668", envName: "sandbox" };

let bad = 0;
for (const profile of PRODUCIBLE) {
  const record = { ...(SOURCE[profile] || dischargeRecord), profile };
  // A HealthDocumentRecord IS a scanned artefact: NRCES makes attachment.data min=1, so one has to be
  // present or the profile cannot be built. This is the one place bytes are legitimate.
  if (profile === "HealthDocumentRecord") {
    record.documents = [...(dischargeRecord.documents || []),
      { id: "scan-1", status: "current", contentType: "application/pdf",
        data: Buffer.from("%PDF-1.4 synthetic scanned report").toString("base64"),
        text: "Scanned report the patient brought in" }];
  }
  const doc = serializeNdhm(ctx, record);
  const v = validateNdhmDoc(doc);
  if (!v.ok) { console.error("our own gate rejects " + profile + ": " + JSON.stringify(v.errors)); bad++; }
  writeFileSync(out + "/" + profile + ".json", JSON.stringify(doc, null, 1));
}
// A NINTH bundle: an InvoiceRecord projected from a REAL clinic bill rather than the hand-written
// fixture. The header's whole point is that a serializer test asking our own serializer whether it is
// happy proves nothing - and the fixture is coded by hand, while a projection has to derive its codes and
// convert paise to rupees. If those two disagree with the IG, this is the file that says so.
const billed = Object.assign({
  id: "inv_projected01", patientId: "SMD-GIMSR-0042", encounterId: "",
  status: "paid", createdAt: Date.parse("2026-08-18T09:30:00Z"),
}, buildInvoice([{ id: "o1", name: "Specialist consultation", qty: 1, unitPrice: 50000 },
                 { id: "o2", name: "CBC", qty: 2, unitPrice: 12345 }]));
const projected = serializeNdhm(ctx, { ...projectInvoiceRecord(billed, { tenantId: "t1", now: () => "2026-08-19T00:00:00.000Z" }), profile: "InvoiceRecord" });
const pv = validateNdhmDoc(projected);
if (!pv.ok) { console.error("our own gate rejects the PROJECTED invoice: " + JSON.stringify(pv.errors)); bad++; }
writeFileSync(out + "/InvoiceRecord-projected.json", JSON.stringify(projected, null, 1));

// A TENTH: an ImmunizationRecord projected from an OPD capture, through the real validator that the API
// uses. Same reason as the invoice - the fixture's codes are hand-picked, while a projection has to carry
// what the picker actually produced.
const shot = buildImmunisation({ vaccineCode: "1861000221106", doseNumber: 1, lotNumber: "L-77", occurrenceDateTime: "2026-08-18T09:00:00Z" });
if (shot.error) { console.error("the immunisation capture path refuses its own input: " + shot.error); bad++; }
const visit = { ticketId: "tkt-emit-1", patientAbhaHash: "h", expiresAt: 0,
                entries: [{ ts: Date.parse("2026-08-18T09:00:00Z"), kind: "immunization", by: "dr-1", text: shot.data.text, data: shot.data }] };
const immDoc = serializeNdhm(ctx, { ...projectTimeline(visit, { tenantId: "t1", now: () => "2026-08-19T00:00:00.000Z" }), profile: "ImmunizationRecord" });
const iv = validateNdhmDoc(immDoc);
if (!iv.ok) { console.error("our own gate rejects the PROJECTED immunisation: " + JSON.stringify(iv.errors)); bad++; }
writeFileSync(out + "/ImmunizationRecord-projected.json", JSON.stringify(immDoc, null, 1));

console.log("emitted " + (PRODUCIBLE.length + 2) + " bundles to " + out);
process.exit(bad ? 1 : 0);
