// test/connect/abdm/fixtures/sccm-records.mjs
// HAND-AUTHORED SYNTHETIC SCCM records (canonical model) fed to serializeNdhm (SCCM -> NDHM HIP serve).
// NEVER real PHI. Built with the canonical factories so they are guaranteed-valid SCCM inputs, and shaped so
// serializeNdhm(...) round-trips back through normalizeNdhm to the SAME resource counts.
import { bundle, patient, condition, medicationStatement, allergyIntolerance, observation, diagnosticReport, documentReference, immunization, invoice } from "../../../../functions/_connect/canonical/model.js";
import { coding, codeable, quantity, reference } from "../../../../functions/_connect/canonical/coding.js";

const std = (system, code, display) => coding({ system, code, display, kind: "standard" });

// A StewardMD discharge-summary decision-support record: 1 condition, 2 meds (order+statement), 1 allergy,
// 2 observations (one is a DiagnosticReport result), 1 diagnostic report, 1 document (= the summary itself).
export const dischargeRecord = bundle({
  tenantId: "gimsr", sourceConnector: "stewardmd", generatedAt: "2026-07-31T00:00:00.000Z",
  patient: patient({ id: "pat-1", gender: "male", birthDate: "1980-01-01", name: { text: "Synthetic Patient", family: "Patient", given: ["Synthetic"] } }),
  conditions: [
    condition({ id: "cond-1", clinicalStatus: "resolved", code: codeable({ coding: [std("http://hl7.org/fhir/sid/icd-10", "J18.9", "Pneumonia")], text: "Community-acquired pneumonia" }) }),
  ],
  medications: [
    medicationStatement({ id: "med-1", origin: "order", status: "active", medication: codeable({ coding: [std("http://www.nlm.nih.gov/research/umls/rxnorm", "308191")], text: "Amoxicillin 500mg" }), dosage: { text: "1 tablet three times a day for 5 days" } }),
    medicationStatement({ id: "med-2", origin: "statement", status: "completed", medication: codeable({ text: "Azithromycin 500mg" }), dosage: { text: "Once daily for 3 days" } }),
  ],
  allergies: [
    allergyIntolerance({ id: "alg-1", criticality: "high", code: codeable({ coding: [std("http://snomed.info/sct", "373270004")], text: "Penicillin" }) }),
  ],
  observations: [
    observation({ id: "obs-hb", category: "laboratory", status: "final", effectiveDateTime: "2026-07-30T10:00:00Z", code: codeable({ coding: [std("http://loinc.org", "718-7")], text: "Hemoglobin" }), value: quantity({ value: 9.2, unit: "g/dL", code: "g/dL" }) }),
    observation({ id: "obs-note", category: "laboratory", status: "final", code: codeable({ text: "Blood culture result" }), value: { text: "No growth after 48h" } }),
  ],
  diagnosticReports: [
    diagnosticReport({ id: "dr-1", status: "final", conclusion: "Mild anemia", code: codeable({ coding: [std("http://loinc.org", "58410-2")], text: "Complete Blood Count" }), results: [reference("Observation", "obs-hb")] }),
  ],
  documents: [
    documentReference({ id: "comp-ds", status: "final", text: "Admitted with pneumonia; treated with antibiotics; discharged stable", type: codeable({ coding: [std("http://snomed.info/sct", "373942005", "Discharge summary")], text: "Discharge summary" }) }),
  ],
});

// A record carrying a StewardMD-local (proprietary, non-standard system) code: the local coding + its text must
// survive serialization (and re-derive to kind:"local" through normalizeNdhm).
export const localOnlyRecord = bundle({
  tenantId: "gimsr", sourceConnector: "stewardmd",
  patient: patient({ id: "pat-9", gender: "female" }),
  conditions: [
    condition({ id: "cond-loc", clinicalStatus: "active", code: codeable({ coding: [coding({ system: "urn:hospital:dx", code: "LX1", display: "House code", kind: "local" })], text: "Local hospital diagnosis label" }) }),
  ],
  documents: [
    documentReference({ id: "comp-loc", status: "final", text: "local consultation note", type: codeable({ text: "Consultation note" }) }),
  ],
});

// ── ImmunizationRecord + InvoiceRecord source data (SCCM v1.1) ──────────────────────────────────────
// ABDM makes all EIGHT HI types mandatory for an HMIS. These two used to be unproducible because SCCM had
// nowhere to put a vaccination or a bill, and NRCES marks Composition.section AND section.entry min=1 on
// both profiles - so an empty one is structurally INVALID, not merely thin.
//
// Codes are the real NDHM ones, taken from the IG's own value sets rather than invented:
//   vaccineCode      ndhm-vaccine-codes (SNOMED)
//   invoice type     ndhm-billing-codes  00 Consultation, 01 Pharmacy, 02 IPD, 03 OPD, 99 Others
//   price component  ndhm-price-components  00 MRP, 01 Rate, 02 Discount, 03 CGST, 04 SGST
//   pc.type          the R4 required set  base|surcharge|deduction|discount|tax|informational
const NDHM_BILLING = "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-billing-codes";
const NDHM_PRICE = "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components";

export const immunizationRecord = bundle({
  tenantId: "gimsr", sourceConnector: "stewardmd", generatedAt: "2026-07-31T00:00:00.000Z",
  patient: patient({ id: "pat-1", gender: "male", birthDate: "1980-01-01", name: { text: "Synthetic Patient", family: "Patient", given: ["Synthetic"] } }),
  immunizations: [
    immunization({
      id: "imm-1", status: "completed", occurrenceDateTime: "2026-07-30T09:30:00Z",
      vaccineCode: codeable({ coding: [std("http://snomed.info/sct", "871761004", "Rotavirus vaccine")], text: "Rotavirus vaccine" }),
      lotNumber: "SYN-2026-07", doseNumber: 2,
      // site and route are OPTIONAL parents whose codings are min=1 once present, so they are supplied
      // complete (system + code + display) or not at all.
      site: codeable({ coding: [std("http://snomed.info/sct", "368208006", "Left upper arm structure")], text: "Left upper arm" }),
      route: codeable({ coding: [std("http://snomed.info/sct", "78421000", "Intramuscular route")], text: "Intramuscular" }),
      manufacturer: "Synthetic Biologicals Ltd",
    }),
  ],
  documents: [
    documentReference({ id: "comp-imm", status: "final", text: "Rotavirus vaccine, dose 2, administered", type: codeable({ coding: [std("http://snomed.info/sct", "41000179103", "Immunization record")], text: "Immunization record" }) }),
  ],
});

export const invoiceRecord = bundle({
  tenantId: "gimsr", sourceConnector: "stewardmd", generatedAt: "2026-07-31T00:00:00.000Z",
  patient: patient({ id: "pat-1", gender: "male", birthDate: "1980-01-01", name: { text: "Synthetic Patient", family: "Patient", given: ["Synthetic"] } }),
  invoices: [
    invoice({
      id: "inv-1", status: "issued", identifierValue: "GIMSR/2026/000123", date: "2026-07-30T12:00:00Z",
      type: codeable({ coding: [std(NDHM_BILLING, "00", "Consultation")], text: "Consultation" }),
      lineItems: [
        { sequence: 1, chargeItem: codeable({ coding: [std(NDHM_BILLING, "00", "Consultation")], text: "Specialist consultation" },),
          priceComponents: [
            { type: "base", code: codeable({ coding: [std(NDHM_PRICE, "01", "Rate")], text: "Rate" }, ), amount: { value: 500, currency: "INR" } },
            { type: "tax", code: codeable({ coding: [std(NDHM_PRICE, "03", "CGST")], text: "CGST" }), amount: { value: 45, currency: "INR" } },
            { type: "tax", code: codeable({ coding: [std(NDHM_PRICE, "04", "SGST")], text: "SGST" }), amount: { value: 45, currency: "INR" } },
          ] },
      ],
      totalNet: { value: 500, currency: "INR" },
      totalGross: { value: 590, currency: "INR" },
    }),
  ],
  documents: [
    documentReference({ id: "comp-inv", status: "final", text: "Consultation invoice GIMSR/2026/000123", type: codeable({ text: "Invoice Record" }) }),
  ],
});
