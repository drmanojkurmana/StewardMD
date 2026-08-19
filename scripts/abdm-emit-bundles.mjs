#!/usr/bin/env node
// scripts/abdm-emit-bundles.mjs — emit one NDHM bundle per PRODUCIBLE HI type, for the validator.
//
// Uses the same ctx serveTransfer builds, including the HFR facility that attests the document, so what
// is validated is what would actually be pushed to an HIU - not a hand-written sample.
import { writeFileSync, mkdirSync } from "node:fs";
import { serializeNdhm, validateNdhmDoc } from "../functions/_connect/connectors/abdm/serialize.js";
import { dischargeRecord } from "../test/connect/abdm/fixtures/sccm-records.mjs";

const out = process.argv[2];
if (!out) { console.error("usage: abdm-emit-bundles.mjs <outdir>"); process.exit(2); }
mkdirSync(out, { recursive: true });

// ImmunizationRecord and InvoiceRecord are deliberately ABSENT. NRCES marks both Composition.section and
// section.entry min=1 on them, so a document built from an SCCM record that carries no immunisations and
// no billing is STRUCTURALLY INVALID - not thin, invalid. serializeNdhm refuses to build them, and
// validating a refusal proves nothing. They need SCCM fields, which is a data-model change.
const PRODUCIBLE = ["OPConsultRecord", "PrescriptionRecord", "DiagnosticReportRecord",
                    "DischargeSummaryRecord", "HealthDocumentRecord", "WellnessRecord"];

const ctx = { now: () => new Date("2026-08-19T00:00:00.000Z"), tenant: { id: "t1" },
              hipId: "IN2810006668", envName: "sandbox" };

let bad = 0;
for (const profile of PRODUCIBLE) {
  const record = { ...dischargeRecord, profile };
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
console.log("emitted " + PRODUCIBLE.length + " bundles to " + out);
process.exit(bad ? 1 : 0);
