// test/connect/abdm/fhir-validation.test.mjs — NRCES profile conformance, and the facts that produced it.
//
// WHY THIS FILE EXISTS. validateNdhmDoc is a STRUCTURAL gate, not profile conformance. It passed all eight
// HI types while HAPI validator_cli 6.2.1, against the real https://nrces.in/ndhm/fhir/r4, rejected all
// eight - roughly sixty errors. A serializer test that only asks our own serializer whether it is happy
// proves nothing about what ABDM will accept.
//
// The full validation needs a 220MB jar and a JDK, so it is NOT part of the default suite. This file pins
// the FINDINGS as fast assertions - every one of them a rule the validator taught us - and the heavy run
// lives in ./scripts/abdm-validate-fhir.sh, which is what to run before a functional-testing booking.
//
//   ./scripts/abdm-validate-fhir.sh            # generate + validate, PASS/FAIL per HI type
//   ./scripts/abdm-validate-fhir.sh --verbose  # with every diagnostic
import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeNdhm, validateNdhmDoc } from "../../../functions/_connect/connectors/abdm/serialize.js";
import { dischargeRecord } from "./fixtures/sccm-records.mjs";

const NOW = "2026-08-19T00:00:00.000Z";
const ctx = { now: () => new Date(NOW), tenant: { id: "t1" }, hipId: "IN2810006668", envName: "sandbox" };
const build = (profile, over = {}) => serializeNdhm(ctx, { ...dischargeRecord, profile, ...over });
const first = (doc) => doc.entry[0].resource;
const byUrn = (doc) => new Map(doc.entry.map((e) => [e.fullUrl, e.resource]));
const resources = (doc, type) => doc.entry.map((e) => e.resource).filter((r) => r.resourceType === type);

const SCAN = { id: "scan-1", status: "current", contentType: "application/pdf",
               data: "JVBERi0xLjQgc3ludGhldGlj", text: "Scanned report" };

// The six HI types producible from an SCCM record. Immunization and Invoice are absent DELIBERATELY - see
// the test at the bottom.
const PRODUCIBLE = ["OPConsultRecord", "PrescriptionRecord", "DiagnosticReportRecord",
                    "DischargeSummaryRecord", "HealthDocumentRecord", "WellnessRecord"];
const withData = (p) => (p === "HealthDocumentRecord"
  ? build(p, { documents: [...(dischargeRecord.documents || []), SCAN] })
  : build(p));

// ── the shape the profiles demand ───────────────────────────────────────────────────────────────────
test("every producible HI type still passes our own structural gate", () => {
  for (const p of PRODUCIBLE) {
    const v = validateNdhmDoc(withData(p));
    assert.equal(v.ok, true, p + ": " + JSON.stringify(v.errors));
  }
});

test("Composition.type is the code the profile FIXES, not one code for all eight", () => {
  // Six of eight profiles were rejected by NAME ("Value is 'Discharge summary' but must be ...") because
  // the old serializer hardcoded the discharge-summary code everywhere.
  const expected = {
    OPConsultRecord: "371530004", PrescriptionRecord: "440545006",
    DischargeSummaryRecord: "373942005", HealthDocumentRecord: "419891008",
    DiagnosticReportRecord: "721981007",
  };
  for (const [p, code] of Object.entries(expected)) {
    const t = first(withData(p)).type;
    assert.equal(t.coding[0].code, code, p);
    assert.equal(t.coding[0].system, "http://snomed.info/sct", p + " type.coding.system is fixed to SNOMED");
  }
  // WellnessRecord fixes only `text`, and must carry NO coding.
  assert.equal(first(build("WellnessRecord")).type.text, "Wellness Record");
  assert.equal(first(build("WellnessRecord")).type.coding, undefined);
});

test("the single-section profiles emit exactly ONE section, and never an empty one", () => {
  // section max=1 with entry slicing CLOSED on five profiles. The old code emitted five sections for all
  // eight, which is why 8 of 8 failed.
  for (const p of ["PrescriptionRecord", "DiagnosticReportRecord", "HealthDocumentRecord"]) {
    const sections = first(withData(p)).section;
    assert.equal(sections.length, 1, p + " allows one section");
    assert.ok(sections[0].entry && sections[0].entry.length >= 1, p + ": section.entry is min=1");
  }
  for (const p of PRODUCIBLE) {
    for (const sec of first(withData(p)).section) {
      assert.ok(sec.entry && sec.entry.length > 0, p + ": cmp-1 forbids a section with no entries");
    }
  }
});

test("every section entry carries Reference.type - the slice discriminator is ON it", () => {
  // The profiles slice section.entry with discriminator ('MedicationRequest' in type). Without the type,
  // a correctly-shaped section still matched NO slice and closed slicing rejected it.
  for (const p of PRODUCIBLE) {
    const doc = withData(p);
    const map = byUrn(doc);
    for (const sec of first(doc).section) {
      for (const ref of sec.entry) {
        assert.ok(ref.type, p + ": a section entry without Reference.type matches no slice");
        assert.equal(map.get(ref.reference).resourceType, ref.type, p + ": the type must be the TRUTH");
      }
    }
  }
});

test("a PrescriptionRecord carries MedicationRequests ONLY, never a MedicationStatement", () => {
  // Its section slices to MedicationRequest or Binary. A MedicationStatement (a drug the patient is simply
  // ON) is a different resource type and closed slicing rejects it.
  const doc = build("PrescriptionRecord");
  for (const ref of first(doc).section[0].entry) assert.equal(ref.type, "MedicationRequest");
  assert.equal(resources(doc, "MedicationStatement").length, 0);
});

test("Composition.encounter is present exactly where the profile makes it min=1", () => {
  for (const p of ["OPConsultRecord", "DischargeSummaryRecord"]) {
    assert.ok(first(withData(p)).encounter, p + ": encounter is min=1");
  }
  for (const p of ["PrescriptionRecord", "WellnessRecord", "HealthDocumentRecord"]) {
    assert.equal(first(withData(p)).encounter, undefined, p + ": no encounter required, so none invented");
  }
});

// ── the conformance details that made references resolve ────────────────────────────────────────────
test("Patient and Organization carry identifier.type - without it every REFERENCE to them fails", () => {
  // 9 Patient and 4 Organization "unable to find a match for profile" errors were really ONE missing
  // element: identifier.type is min=1, so the resource did not conform, so no reference to it could match.
  const doc = withData("DischargeSummaryRecord");
  for (const type of ["Patient", "Organization"]) {
    for (const r of resources(doc, type)) {
      assert.ok(r.identifier && r.identifier.length >= 1, type + ".identifier is min=1");
      for (const id of r.identifier) {
        assert.ok(id.type && id.type.coding && id.type.coding[0].code, type + ".identifier.type is min=1");
        assert.ok(id.system, type + ".identifier.system");
      }
      assert.ok((r.meta.profile || []).some((u) => u.endsWith("/" + type)), type + " declares its profile");
    }
  }
});

test("every clinical resource has a subject - a statement about nobody is not a statement", () => {
  const doc = withData("DischargeSummaryRecord");
  const patient = resources(doc, "Patient")[0];
  const patientUrn = doc.entry.find((e) => e.resource === patient).fullUrl;
  for (const t of ["Condition", "MedicationStatement", "MedicationRequest", "Observation", "DiagnosticReport"]) {
    for (const r of resources(doc, t)) {
      assert.ok(r.subject, t + ".subject is min=1");
      assert.equal(r.subject.reference, patientUrn, t + " must point at the bundle's own Patient");
    }
  }
  for (const r of resources(doc, "AllergyIntolerance")) {
    assert.ok(r.patient, "AllergyIntolerance.patient is min=1");
    assert.equal(r.patient.reference, patientUrn);
  }
});

test("AllergyIntolerance always carries clinicalStatus (constraint ait-1)", () => {
  for (const r of resources(withData("DischargeSummaryRecord"), "AllergyIntolerance")) {
    assert.ok(r.clinicalStatus, "SHALL be present unless verificationStatus is entered-in-error");
    assert.equal(r.clinicalStatus.coding[0].system, "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical");
  }
});

test("a bound code is emitted WITH its system, or not at all", () => {
  // "A code with no system has no defined meaning and cannot be validated." Condition.clinicalStatus is a
  // REQUIRED binding, so an unmapped local string is dropped rather than emitted systemless.
  const doc = withData("DischargeSummaryRecord");
  for (const c of resources(doc, "Condition")) {
    if (c.clinicalStatus) {
      assert.equal(c.clinicalStatus.coding[0].system, "http://terminology.hl7.org/CodeSystem/condition-clinical");
    }
  }
  const unmapped = build("DischargeSummaryRecord", {
    conditions: [{ id: "c9", code: { text: "something" }, clinicalStatus: "made-up-local-value" }],
  });
  const c9 = resources(unmapped, "Condition")[0];
  assert.equal(c9.clinicalStatus, undefined, "an unmapped status is omitted, never invented");
});

test("no CodeableConcept ever carries an EMPTY coding array", () => {
  // "Array cannot be empty - the property should not be present if it has no values" - 16 of these.
  const walk = (n, path) => {
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, path + "[" + i + "]"));
    if (!n || typeof n !== "object") return;
    if ("coding" in n) assert.ok(Array.isArray(n.coding) && n.coding.length > 0, path + ".coding must not be empty");
    for (const k of Object.keys(n)) walk(n[k], path + "." + k);
  };
  for (const p of PRODUCIBLE) walk(withData(p), p);
});

test("the codings NRCES marks display-min=1 all carry one", () => {
  // Scoped to the elements the validator actually complained about - Observation.code,
  // MedicationRequest.medication, DiagnosticReport.code and Composition.type. A status coding
  // (clinicalStatus and friends) is NOT display-required, and asserting it globally would be inventing a
  // rule NRCES does not have.
  const needsDisplay = (doc) => {
    const out = [];
    const comp = first(doc);
    if (comp.type.coding) out.push(["Composition.type", comp.type.coding]);
    for (const r of resources(doc, "Observation")) out.push(["Observation.code", r.code.coding || []]);
    for (const r of resources(doc, "DiagnosticReport")) out.push(["DiagnosticReport.code", r.code.coding || []]);
    for (const r of resources(doc, "MedicationRequest")) out.push(["MedicationRequest.medication", r.medicationCodeableConcept.coding || []]);
    for (const t of ["Patient", "Organization"]) {
      for (const r of resources(doc, t)) for (const id of r.identifier) out.push([t + ".identifier.type", id.type.coding]);
    }
    return out;
  };
  for (const p of PRODUCIBLE) {
    for (const [where, codings] of needsDisplay(withData(p))) {
      for (const c of codings) assert.ok(c.display, p + " " + where + ": coding.display is min=1");
    }
  }
});

test("a MedicationRequest coding in a system NRCES forbids is DROPPED, never relabelled", () => {
  // NRCES binds medication[x].coding.system to SNOMED. Our SCCM fixture carries RxNorm. Passing an RxNorm
  // code off as SNOMED would be a false clinical claim; the concept text still carries the meaning.
  const doc = build("PrescriptionRecord");
  for (const m of resources(doc, "MedicationRequest")) {
    for (const c of (m.medicationCodeableConcept.coding || [])) {
      assert.equal(c.system, "http://snomed.info/sct");
    }
    assert.ok(m.medicationCodeableConcept.text, "the text survives even when the code cannot");
    assert.ok(m.authoredOn, "authoredOn is min=1");
    assert.ok(m.requester, "requester is min=1");
    assert.ok(m.dosageInstruction && m.dosageInstruction.length, "dosageInstruction is min=1");
  }
});

test("DiagnosticReport carries a resultsInterpreter and resolvable results", () => {
  const doc = withData("DischargeSummaryRecord");
  const map = byUrn(doc);
  for (const r of resources(doc, "DiagnosticReport")) {
    assert.ok(r.resultsInterpreter && r.resultsInterpreter.length, "min=1");
    for (const res of (r.result || [])) {
      assert.ok(map.get(res.reference), "a result must point INTO this bundle, not at a dangling id");
      assert.equal(map.get(res.reference).resourceType, "Observation");
    }
  }
});

// ── what cannot be produced, and why ────────────────────────────────────────────────────────────────
test("ImmunizationRecord and InvoiceRecord are REFUSED, not emitted hollow", () => {
  // NRCES makes BOTH section and section.entry min=1 on these, so a document built from an SCCM record
  // that carries no immunisations and no billing is structurally INVALID - not thin, invalid. SCCM has
  // neither collection, so these two of the eight mandatory HI types cannot be served at all until the
  // data model carries them. That is a certification gap, and it is a data-model change, not a
  // serializer one.
  for (const p of ["ImmunizationRecord", "InvoiceRecord"]) {
    const v = validateNdhmDoc(build(p));
    assert.equal(v.ok, false, p + " must be refused rather than emitted");
  }
});

test("a HealthDocumentRecord without the scanned bytes is refused too", () => {
  assert.equal(validateNdhmDoc(build("HealthDocumentRecord")).ok, false);
  assert.equal(validateNdhmDoc(withData("HealthDocumentRecord")).ok, true, "…and valid WITH them");
});
