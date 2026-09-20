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

test("InvoiceRecord -> MAPPED into SCCM invoices (was: skipped as 'not clinical data')", () => {
  // This test used to assert the deferral. SCCM v1.1 carries invoices, because ABDM makes all eight HI
  // types mandatory for an HMIS and a patient asking for their records is entitled to what they were
  // charged. The old behaviour returned before the sections were ever walked.
  const b = norm(F.invoiceRecord);
  assert.equal(b.invoices.length, 1, "the invoice must land somewhere now");
  const inv = b.invoices[0];
  assert.equal(inv.id, "inv-1");
  assert.equal(inv.status, "issued");
  assert.deepEqual(inv.totalGross, { value: 500, currency: "INR" });
  assert.ok(!b.meta.warnings.some((w) => /billing artifact/i.test(w)), "the dismissal warning is retired");
  // The Composition itself is still captured as documentReference metadata, as every record type is.
  assert.ok(b.documents.some((d) => d.id === "comp-inv"));
  assert.equal(b.conditions.length, 0);
  assert.equal(b.observations.length, 0);
});

test("a partial inbound Invoice normalises without throwing, and SCCM validation catches it", () => {
  // This fixture's Invoice has no identifier, date, type or lineItem - a real peer can send that, and
  // WARN-don't-DROP means we map what is there rather than refuse the whole document. The SCCM validator
  // is what reports the gaps, so a bundle we could not re-serialise never masquerades as complete.
  const b = norm(F.invoiceRecord);
  const v = validateBundle(b);
  assert.equal(v.ok, false, "an invoice missing its FHIR minima must not read as valid SCCM");
  assert.ok(v.errors.some((e) => /Invoice inv-1/.test(e)), JSON.stringify(v.errors));
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

test("ImmunizationRecord -> MAPPED into SCCM immunizations (was: metadata-only + DEFER warning)", () => {
  // Also used to assert the deferral. A vaccination arriving from another facility now lands as a first
  // class resource instead of surviving only as narrative text nobody can query.
  const b = norm(F.immunizationRecord);
  assert.equal(validateBundle(b).ok, true, JSON.stringify(validateBundle(b).errors));
  assert.equal(b.immunizations.length, 1);
  const im = b.immunizations[0];
  assert.equal(im.id, "imm-1");
  assert.equal(im.status, "completed");
  assert.equal(im.occurrenceDateTime, "2026-01-15");
  assert.equal(im.vaccineCode.text, "COVID-19 vaccine");
  assert.ok(!b.meta.warnings.some((w) => /DEFER/i.test(w)), "the DEFER warning is retired");
  // …and the narrative is still preserved as documentReference metadata alongside it.
  const compDoc = b.documents.find((d) => d.id === "comp-imm");
  assert.ok(compDoc);
  assert.match(compDoc.text, /vaccine/i);
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
