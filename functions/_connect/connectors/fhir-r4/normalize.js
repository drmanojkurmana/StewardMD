// functions/_connect/connectors/fhir-r4/normalize.js — FHIR R4 → SCCM (the anti-corruption map)
import { coding, codeable, quantity } from "../../canonical/coding.js";
import { bundle, patient, encounter, condition, medicationStatement, allergyIntolerance, observation, diagnosticReport, documentReference } from "../../canonical/model.js";

const STD = ["http://loinc.org", "http://snomed.info/sct", "http://hl7.org/fhir/sid/icd-10", "http://hl7.org/fhir/sid/icd-11", "http://www.nlm.nih.gov/research/umls/rxnorm", "http://www.whocc.no/atc"];
function cc(fhirCC, fallback) {
  if (!fhirCC) return codeable({ text: fallback || "unknown" });
  const codes = (fhirCC.coding || []).map((c) => coding({ system: c.system || null, code: c.code || null, display: c.display || null, kind: STD.includes(c.system) ? "standard" : "local" }));
  return codeable({ coding: codes, text: fhirCC.text || (codes[0] && codes[0].display) || fallback || "unknown" });
}
const firstCoding = (arr) => (arr && arr[0] && arr[0].coding && arr[0].coding[0] && arr[0].coding[0].code) || null;

export function normalizeFhir(ctx, raw) {
  const P = raw.patient || {};
  const out = bundle({
    tenantId: ctx.tenant.id, sourceConnector: "fhir-r4",
    generatedAt: ctx.now().toISOString(), provenance: [],
    patient: patient({ id: P.id, gender: P.gender || "unknown", birthDate: P.birthDate || null,
      name: P.name && P.name[0] ? { text: P.name[0].text || null, given: P.name[0].given || [], family: P.name[0].family || null } : null }),
  });
  for (const r of raw.resources || []) {
    out.meta.provenance.push({ resource: r.resourceType, sourceConnector: "fhir-r4", sourceId: r.resourceType + "/" + r.id });
    switch (r.resourceType) {
      case "Encounter": out.encounters.push(encounter({ id: r.id, status: r.status, class: (r.class && r.class.code) || null })); break;
      case "Condition": out.conditions.push(condition({ id: r.id, code: cc(r.code, "condition"), clinicalStatus: firstCoding([r.clinicalStatus]) || "unknown" })); break;
      case "MedicationStatement": out.medications.push(medicationStatement({ id: r.id, medication: cc(r.medicationCodeableConcept, "medication"), origin: "statement", status: r.status || "unknown", dosage: r.dosage && r.dosage[0] ? { text: r.dosage[0].text || null } : null })); break;
      case "MedicationRequest": out.medications.push(medicationStatement({ id: r.id, medication: cc(r.medicationCodeableConcept, "medication"), origin: "order", status: r.status || "unknown" })); break;
      case "AllergyIntolerance": out.allergies.push(allergyIntolerance({ id: r.id, code: cc(r.code, "allergen"), criticality: r.criticality || "unable-to-assess" })); break;
      case "Observation": out.observations.push(observation({ id: r.id, category: firstCoding(r.category) || "laboratory", code: cc(r.code, "observation"),
        value: r.valueQuantity ? quantity({ value: r.valueQuantity.value, unit: r.valueQuantity.unit, code: r.valueQuantity.code }) : (r.valueString ? { text: r.valueString } : null),
        effectiveDateTime: r.effectiveDateTime || null, status: r.status || "unknown" })); break;
      case "DiagnosticReport": out.diagnosticReports.push(diagnosticReport({ id: r.id, code: cc(r.code, "report"), status: r.status || "unknown", conclusion: r.conclusion || null })); break;
      case "DocumentReference": out.documents.push(documentReference({ id: r.id, type: cc(r.type, "document"), status: r.status || "unknown", text: (r.description || null) })); break;
    }
  }
  return out;
}
