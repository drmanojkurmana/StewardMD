// test/connect/abdm/normalize-ndhm.test.mjs — Stage-4 Task-3: NDHM-FHIR document -> SCCM.
// Mirrors the FHIR R4 pull-side normalizer: same cc() text fallbacks, same SCCM factories, same
// kind: standard|local rule, and the output must pass the existing validateBundle. WARN-don't-DROP:
// partial/unknown docs never throw; binary is never carried into SCCM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNdhm } from "../../../functions/_connect/connectors/abdm/normalize.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { makeCtx } from "../../../functions/_connect/interfaces.js";
import * as F from "./fixtures/ndhm-synthetic.mjs";

const norm = (fx) => normalizeNdhm(makeCtx(), fx);

// Walk every coded field and assert a non-empty text fallback is present (R12 invariant).
function assertTextFallbacks(b) {
  const ccs = [];
  (b.conditions || []).forEach((c) => ccs.push(c.code));
  (b.medications || []).forEach((m) => ccs.push(m.medication));
  (b.allergies || []).forEach((a) => ccs.push(a.code));
  (b.observations || []).forEach((o) => ccs.push(o.code));
  (b.diagnosticReports || []).forEach((d) => ccs.push(d.code));
  (b.documents || []).forEach((d) => ccs.push(d.type));
  for (const cc of ccs) { assert.ok(cc && typeof cc.text === "string" && cc.text.trim(), "coded field missing text fallback"); }
}

test("DiagnosticReportRecord -> valid SCCM with DiagnosticReport + resolved result Observation", () => {
  const b = norm(F.diagnosticReportRecord);
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.meta.sourceConnector, "abdm");
  assert.equal(b.diagnosticReports.length, 1);
  assert.equal(b.diagnosticReports[0].code.text, "Complete Blood Count");
  assert.equal(b.diagnosticReports[0].conclusion, "Mild anemia");
  assert.equal(b.observations.length, 1);           // pulled in via DiagnosticReport.result
  assert.equal(b.observations[0].value.value, 9.2);
  assert.deepEqual(b.diagnosticReports[0].results[0], { type: "Observation", id: "obs-hb" });
  assertTextFallbacks(b);
});

test("PrescriptionRecord -> MedicationRequest maps to medicationStatement origin:order", () => {
  const b = norm(F.prescriptionRecord);
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.medications.length, 1);
  assert.equal(b.medications[0].origin, "order");
  assert.equal(b.medications[0].medication.text, "Amoxicillin 500mg");
  assert.equal(b.medications[0].medication.coding[0].kind, "standard"); // rxnorm is a standard system
  assertTextFallbacks(b);
});

test("OPConsultRecord -> Condition + MedicationRequest + AllergyIntolerance", () => {
  const b = norm(F.opConsultRecord);
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.conditions[0].code.text, "Enteric fever");
  assert.equal(b.medications[0].origin, "order");
  assert.equal(b.allergies[0].code.text, "Penicillin");
  assert.equal(b.allergies[0].criticality, "high");
  assertTextFallbacks(b);
});

test("DischargeSummaryRecord -> Condition + MedicationStatement origin:statement + DiagnosticReport", () => {
  const b = norm(F.dischargeSummaryRecord);
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.conditions[0].code.text, "Community-acquired pneumonia");
  assert.equal(b.medications[0].origin, "statement");
  assert.equal(b.medications[0].medication.text, "Azithromycin 500mg");
  assert.equal(b.diagnosticReports[0].code.text, "Chest X-ray");
  assertTextFallbacks(b);
});

test("Composition narrative always becomes a by-reference documentReference (no binary)", () => {
  const b = norm(F.dischargeSummaryRecord);
  const compDoc = b.documents.find((d) => d.id === "comp-ds");
  assert.ok(compDoc, "Composition should be captured as a documentReference");
  assert.equal(compDoc.type.text, "Discharge summary");
  assert.match(compDoc.text, /pneumonia/); // stripped narrative text only
});

test("binary HealthDocumentRecord -> metadata-only documentReference + warning, NO binary bytes", () => {
  const b = norm(F.healthDocumentBinary);
  assert.equal(validateBundle(b).ok, true);
  const docref = b.documents.find((d) => d.id === "docref-1");
  assert.ok(docref, "DocumentReference should be present as metadata");
  assert.match(b.meta.warnings.join(" | "), /binary/i);
  // The base64 bytes must NEVER appear anywhere in the SCCM bundle.
  assert.equal(JSON.stringify(b).includes(F.B64_MARKER), false, "binary bytes leaked into SCCM");
  assertTextFallbacks(b);
});

test("InvoiceRecord -> skipped + warning (no clinical resources emitted)", () => {
  const b = norm(F.invoiceRecord);
  assert.equal(validateBundle(b).ok, true);           // still valid: patient present, no coded fields
  assert.match(b.meta.warnings.join(" | "), /invoice/i);
  assert.equal(b.conditions.length, 0);
  assert.equal(b.medications.length, 0);
  assert.equal(b.observations.length, 0);
  assert.equal(b.documents.length, 0);                // fully skipped, not turned into a documentReference
});

test("WellnessRecord -> Observations mapped to wellness / social-history categories", () => {
  const b = norm(F.wellnessRecord);
  assert.equal(validateBundle(b).ok, true);
  const wt = b.observations.find((o) => o.id === "obs-wt");
  const steps = b.observations.find((o) => o.id === "obs-steps");
  assert.equal(wt.category, "wellness");
  assert.equal(steps.category, "social-history");
  assertTextFallbacks(b);
});

test("ImmunizationRecord -> metadata-only + warning, not dropped, no crash", () => {
  const b = norm(F.immunizationRecord);
  assert.equal(validateBundle(b).ok, true);
  assert.match(b.meta.warnings.join(" | "), /immuniz/i);
  const compDoc = b.documents.find((d) => d.id === "comp-imm");
  assert.ok(compDoc, "immunization should survive as documentReference metadata (not silently dropped)");
  assert.match(compDoc.text, /vaccine/i);             // clinical info preserved in narrative
});

test("Bundle missing a referenced resource -> warning, no throw, partial bundle valid", () => {
  let b;
  assert.doesNotThrow(() => { b = norm(F.missingReferencedResource); });
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.conditions.length, 1);               // the present resource is still mapped
  assert.match(b.meta.warnings.join(" | "), /not found/i);
});

test("unknown resourceType -> warning, never a throw", () => {
  let b;
  assert.doesNotThrow(() => { b = norm(F.unknownResource); });
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.conditions.length, 1);
  assert.match(b.meta.warnings.join(" | "), /CarePlan|unsupported|not mapped/i);
});

test("cc() always emits a text fallback even when the coded field is absent", () => {
  const b = norm(F.codelessCondition);
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.conditions[0].code.text, "condition"); // fallback, never empty
});

test("per-resource provenance is tagged sourceConnector: abdm", () => {
  const b = norm(F.opConsultRecord);
  assert.ok(b.meta.provenance.length >= 3);
  for (const p of b.meta.provenance) { assert.equal(p.sourceConnector, "abdm"); }
});

test("proprietary NDHM codes get kind=local and preserve their text", () => {
  const raw = {
    resourceType: "Bundle", type: "document",
    entry: [
      { resource: { resourceType: "Composition", id: "c0", status: "final", meta: { profile: ["x/OPConsultRecord"] },
        type: { text: "Clinical consultation report" }, subject: { reference: "Patient/pat-1" }, title: "OP",
        text: { status: "generated", div: "<div>x</div>" },
        section: [{ entry: [{ reference: "Observation/o-local" }] }] } },
      { resource: { resourceType: "Patient", id: "pat-1", gender: "male" } },
      { resource: { resourceType: "Observation", id: "o-local", status: "final",
        category: [{ coding: [{ code: "laboratory" }] }],
        code: { text: "Local hospital test", coding: [{ system: "urn:hospital:labs", code: "LX" }] },
        valueString: "positive" } },
    ],
  };
  const b = norm(raw);
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.observations[0].code.coding[0].kind, "local");
  assert.equal(b.observations[0].code.text, "Local hospital test");
  assert.deepEqual(b.observations[0].value, { text: "positive" });
});

test("a malformed / empty document never throws (degrades to warnings)", () => {
  assert.doesNotThrow(() => normalizeNdhm(makeCtx(), null));
  assert.doesNotThrow(() => normalizeNdhm(makeCtx(), {}));
  assert.doesNotThrow(() => normalizeNdhm(makeCtx(), { resourceType: "Bundle", type: "document", entry: [] }));
  const b = normalizeNdhm(makeCtx(), { resourceType: "Bundle", type: "document", entry: [] });
  assert.match(b.meta.warnings.join(" | "), /Composition/i);
});
