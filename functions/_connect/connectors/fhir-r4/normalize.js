// functions/_connect/connectors/fhir-r4/normalize.js — FHIR R4 → SCCM (the anti-corruption map)
import { coding, codeable, quantity } from "../../canonical/coding.js";
import { bundle, patient, encounter, condition, medicationStatement, allergyIntolerance, observation, diagnosticReport, documentReference, medicationAdministration, serviceRequest, consent } from "../../canonical/model.js";

const STD = ["http://loinc.org", "http://snomed.info/sct", "http://hl7.org/fhir/sid/icd-10", "http://hl7.org/fhir/sid/icd-11", "http://www.nlm.nih.gov/research/umls/rxnorm", "http://www.whocc.no/atc"];
function cc(fhirCC, fallback) {
  if (!fhirCC) return codeable({ text: fallback || "unknown" });
  const codes = (fhirCC.coding || []).map((c) => coding({ system: c.system || null, code: c.code || null, display: c.display || null, kind: STD.includes(c.system) ? "standard" : "local" }));
  return codeable({ coding: codes, text: fhirCC.text || (codes[0] && codes[0].display) || fallback || "unknown" });
}
const firstCoding = (arr) => (arr && arr[0] && arr[0].coding && arr[0].coding[0] && arr[0].coding[0].code) || null;

// Derive the Observation bucket from the standard observation-category code so maik-context buckets
// vitals vs labs correctly. Unknown -> laboratory + a warning (never a throw).
function obsCategory(r) {
  for (const c of r.category || []) for (const cd of c.coding || []) { if (cd.code === "vital-signs") return { cat: "vital-signs" }; if (cd.code === "laboratory") return { cat: "laboratory" }; }
  return { cat: "laboratory", warn: "observation " + (r.id || "?") + " category defaulted to laboratory (source omitted it)" };
}
const qOrNull = (q) => (q && q.value != null ? quantity({ value: q.value, unit: q.unit, code: q.code }) : null);
const refIdOf = (ref) => { const s = String((ref && ref.reference) || ""); return s ? (s.includes("/") ? s.split("/").pop() : s) : null; };
const refTo = (ref, type) => { const id = refIdOf(ref); return id ? { type, id } : null; };
const encRef = (ref) => refTo(ref, "Encounter");
const displayOf = (ref) => (ref && (ref.display || refIdOf(ref))) || null;

export function normalizeFhir(ctx, raw) {
  const P = raw.patient || {};
  const out = bundle({
    tenantId: ctx.tenant.id, sourceConnector: "fhir-r4",
    generatedAt: ctx.now().toISOString(), provenance: [],
    patient: patient({ id: P.id, gender: P.gender || "unknown", birthDate: P.birthDate || null,
      name: P.name && P.name[0] ? { text: P.name[0].text || null, given: P.name[0].given || [], family: P.name[0].family || null } : null,
      /* Identifiers were dropped here until 2026-09-08, which made cross-system patient
       * reconciliation impossible: a bundle's MRN and ABHA never reached the record. Carried
       * verbatim - system, the v2-0203 type code when given, value - and never interpreted. */
      identifiers: (P.identifier || []).filter((i) => i && i.value != null && String(i.value).trim())
        .map((i) => ({ system: i.system || null, type: (i.type && i.type.coding && i.type.coding[0] && i.type.coding[0].code) || (i.type && i.type.text) || null, value: String(i.value).trim() })) }),
  });
  for (const r of raw.resources || []) {
    out.meta.provenance.push({ resource: r.resourceType, sourceConnector: "fhir-r4", sourceId: r.resourceType + "/" + r.id });
    switch (r.resourceType) {
      /* period was dropped here until 2026-09-08, so an encounter arrived with no dates at all - an
       * admission that cannot say when it happened. Carried as sent, never defaulted. */
      case "Encounter": out.encounters.push(encounter({ id: r.id, status: r.status, class: (r.class && r.class.code) || null,
        period: r.period && (r.period.start || r.period.end) ? { start: r.period.start || null, end: r.period.end || null } : null })); break;
      case "Condition": out.conditions.push(condition({ id: r.id, code: cc(r.code, "condition"), clinicalStatus: firstCoding([r.clinicalStatus]) || "unknown" })); break;
      case "MedicationStatement": out.medications.push(medicationStatement({ id: r.id, medication: cc(r.medicationCodeableConcept, "medication"), origin: "statement", status: r.status || "unknown", dosage: r.dosage && r.dosage[0] ? { text: r.dosage[0].text || null } : null })); break;
      case "MedicationRequest": out.medications.push(medicationStatement({ id: r.id, medication: cc(r.medicationCodeableConcept, "medication"), origin: "order", status: r.status || "unknown", dosage: r.dosageInstruction && r.dosageInstruction[0] && r.dosageInstruction[0].text ? { text: r.dosageInstruction[0].text } : null })); break;
      case "AllergyIntolerance": out.allergies.push(allergyIntolerance({ id: r.id, code: cc(r.code, "allergen"), criticality: r.criticality || "unable-to-assess" })); break;
      case "Observation": {
        const oc = obsCategory(r); if (oc.warn) out.meta.warnings.push(oc.warn);
        const value = r.valueQuantity ? quantity({ value: r.valueQuantity.value, unit: r.valueQuantity.unit, code: r.valueQuantity.code })
          : (r.valueString ? { text: r.valueString } : (r.valueCodeableConcept ? cc(r.valueCodeableConcept, "value") : null));
        const rrIn = r.referenceRange && r.referenceRange[0];
        const referenceRange = rrIn ? { low: qOrNull(rrIn.low), high: qOrNull(rrIn.high), text: rrIn.text || null } : null;
        out.observations.push(observation({ id: r.id, category: oc.cat, code: cc(r.code, "observation"), value, referenceRange,
          interpretation: r.interpretation && r.interpretation[0] ? cc(r.interpretation[0], "interpretation") : null,
          effectiveDateTime: r.effectiveDateTime || null, status: r.status || "unknown", encounter: encRef(r.encounter) })); break;
      }
      case "DiagnosticReport": out.diagnosticReports.push(diagnosticReport({ id: r.id, code: cc(r.code, "report"), status: r.status || "unknown",
        effectiveDateTime: r.effectiveDateTime || null, conclusion: r.conclusion || null,
        results: (r.result || []).map((x) => { const id = refIdOf(x); return id ? { type: "Observation", id } : null; }).filter(Boolean),
        // SCCM 1.1: the order this report answers, when the sender says so and it is a ServiceRequest.
        basedOn: (r.basedOn || []).map((x) => (/(^|\/)ServiceRequest\//.test(String(x && x.reference)) ? refTo(x, "ServiceRequest") : null)).find(Boolean) || null,
        encounter: encRef(r.encounter) })); break;
      /* SCCM 1.1. A dose given (or explicitly not given) elsewhere. Carried as sent: the FHIR status
       * verbatim, the performer as the sender named them, the request when referenced. */
      case "MedicationAdministration": out.administrations.push(medicationAdministration({ id: r.id, medication: cc(r.medicationCodeableConcept, "medication"), status: r.status || "unknown",
        effectiveDateTime: r.effectiveDateTime || (r.effectivePeriod && (r.effectivePeriod.start || r.effectivePeriod.end)) || null,
        performer: r.performer && r.performer[0] && r.performer[0].actor ? displayOf(r.performer[0].actor) : null,
        dosage: r.dosage ? { text: r.dosage.text || null, route: r.dosage.route ? cc(r.dosage.route, "route") : null, dose: r.dosage.dose && r.dosage.dose.value != null ? quantity({ value: r.dosage.dose.value, unit: r.dosage.dose.unit, code: r.dosage.dose.code }) : null } : null,
        encounter: encRef(r.context), request: refTo(r.request, "MedicationStatement"), reason: r.statusReason && r.statusReason[0] ? cc(r.statusReason[0], "reason") : null })); break;
      /* SCCM 1.1. An order for something other than a medicine. The category is the sender's coding;
       * the adapter maps it to WardSynQ's closed list or "other", never a guess. */
      case "ServiceRequest": out.serviceRequests.push(serviceRequest({ id: r.id, code: cc(r.code, "request"), category: r.category && r.category[0] ? cc(r.category[0], "category") : null,
        status: r.status || "unknown", intent: r.intent || "order", priority: r.priority || null, authoredOn: r.authoredOn || null,
        requester: displayOf(r.requester), encounter: encRef(r.encounter), occurrence: r.occurrenceDateTime || (r.occurrencePeriod && r.occurrencePeriod.start) || null })); break;
      /* SCCM 1.1. A consent decision. permit/deny is read from status AND provision, because a sender
       * may express a refusal either way; anything less than an active or rejected decision is null. */
      case "Consent": {
        const prov = r.provision && r.provision.type;
        const decision = r.status === "rejected" || prov === "deny" ? "deny" : r.status === "active" && (!prov || prov === "permit") ? "permit" : null;
        out.consents.push(consent({ id: r.id, status: r.status || "unknown", scope: r.scope ? cc(r.scope, "scope") : null, category: (r.category || []).map((c) => cc(c, "category")),
          decision, dateTime: r.dateTime || null, performer: r.performer && r.performer[0] ? displayOf(r.performer[0]) : null,
          period: r.provision && r.provision.period ? { start: r.provision.period.start || null, end: r.provision.period.end || null } : null,
          policy: r.policyRule ? cc(r.policyRule, "policy") : null })); break;
      }
      case "DocumentReference": {
        if (r.content && r.content.some((c) => c.attachment && c.attachment.data)) out.meta.warnings.push("document " + (r.id || "?") + " inline attachment bytes dropped (narrative-only)");
        out.documents.push(documentReference({ id: r.id, type: cc(r.type, "document"), status: r.status || "unknown", date: r.date || null, text: r.description || (r.text && r.text.div) || null })); break;
      }
    }
  }
  return out;
}
