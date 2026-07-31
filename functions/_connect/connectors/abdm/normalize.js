// functions/_connect/connectors/abdm/normalize.js — NDHM-FHIR document -> SCCM (the ABDM anti-corruption map).
// Mirrors connectors/fhir-r4/normalize.js: same cc() text-fallback helper, same SCCM factories, same
// kind: standard|local rule, and the output passes the same validateBundle. WARN-don't-DROP (R12): a
// partial/unknown/malformed document NEVER throws — it degrades to a meta.warnings note. Binary content
// (base64 attachments / Binary bytes) is NEVER carried into SCCM; only by-reference/narrative metadata.
import { coding, codeable, quantity, reference, provenance } from "../../canonical/coding.js";
import { bundle, patient, condition, medicationStatement, allergyIntolerance, observation, diagnosticReport, documentReference } from "../../canonical/model.js";

// Standard terminologies (identical to the FHIR R4 normalizer). Everything else is a local/proprietary code.
const STD = ["http://loinc.org", "http://snomed.info/sct", "http://hl7.org/fhir/sid/icd-10", "http://hl7.org/fhir/sid/icd-11", "http://www.nlm.nih.gov/research/umls/rxnorm", "http://www.whocc.no/atc"];
function cc(fhirCC, fallback) {
  if (!fhirCC) return codeable({ text: fallback || "unknown" });
  const codes = (fhirCC.coding || []).map((c) => coding({ system: c.system || null, code: c.code || null, display: c.display || null, kind: STD.includes(c.system) ? "standard" : "local" }));
  return codeable({ coding: codes, text: fhirCC.text || (codes[0] && codes[0].display) || fallback || "unknown" });
}
const firstCoding = (arr) => (arr && arr[0] && arr[0].coding && arr[0].coding[0] && arr[0].coding[0].code) || null;
const stripHtml = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const safeIso = (d) => (d && typeof d.toISOString === "function") ? d.toISOString() : new Date().toISOString();

// Known NDHM/ABDM document record profiles (the Composition-level "record" kind).
const RECORD_PROFILES = ["DiagnosticReportRecord", "PrescriptionRecord", "OPConsultRecord", "DischargeSummaryRecord", "WellnessRecord", "ImmunizationRecord", "HealthDocumentRecord", "InvoiceRecord"];
// Structural / context resources referenced by a Composition but carrying no clinical payload we map.
const CONTEXT = new Set(["Patient", "Practitioner", "PractitionerRole", "Organization", "Location", "Medication", "Encounter", "Device"]);

function recordTypeOf(comp) {
  const profiles = (comp && comp.meta && comp.meta.profile) || [];
  for (const p of profiles) { for (const name of RECORD_PROFILES) if (String(p).endsWith(name)) return name; }
  const t = comp && comp.type;
  const low = String((t && (t.text || (t.coding && t.coding[0] && t.coding[0].display))) || "").toLowerCase();
  if (/invoice/.test(low)) return "InvoiceRecord";
  if (/immuni/.test(low)) return "ImmunizationRecord";
  if (/wellness/.test(low)) return "WellnessRecord";
  if (/discharge/.test(low)) return "DischargeSummaryRecord";
  if (/prescription/.test(low)) return "PrescriptionRecord";
  if (/diagnostic/.test(low)) return "DiagnosticReportRecord";
  if (/consult/.test(low)) return "OPConsultRecord";
  if (/document/.test(low)) return "HealthDocumentRecord";
  return null;
}

function flattenSections(sections) {
  const out = [];
  const walk = (arr) => { for (const s of (arr || [])) { out.push(s); if (s && s.section) walk(s.section); } };
  walk(sections);
  return out;
}

function obsCategory(r, recordType) {
  const cat = firstCoding(r.category);
  if (recordType === "WellnessRecord") return cat === "social-history" ? "social-history" : "wellness";
  return cat || "laboratory";
}
function obsValue(r) {
  if (r.valueQuantity) return quantity({ value: r.valueQuantity.value, unit: r.valueQuantity.unit, code: r.valueQuantity.code });
  if (typeof r.valueString === "string") return { text: r.valueString };
  if (r.valueCodeableConcept) return { text: r.valueCodeableConcept.text || (r.valueCodeableConcept.coding && r.valueCodeableConcept.coding[0] && r.valueCodeableConcept.coding[0].display) || "value" };
  return null;
}
function medOf(r, resolve) {
  if (r.medicationCodeableConcept) return cc(r.medicationCodeableConcept, "medication");
  if (r.medicationReference) { const med = resolve(r.medicationReference); if (med && med.code) return cc(med.code, "medication"); }
  return cc(null, "medication");
}
function dosageOf(r) {
  const d = (r.dosageInstruction && r.dosageInstruction[0]) || (r.dosage && r.dosage[0]) || null;
  return d ? { text: d.text || null } : null;
}

export function normalizeNdhm(ctx, docBundle) {
  const tenantId = (ctx && ctx.tenant && ctx.tenant.id) || null;
  const generatedAt = (ctx && typeof ctx.now === "function") ? safeIso(ctx.now()) : new Date().toISOString();
  const out = bundle({ tenantId, sourceConnector: "abdm", generatedAt, provenance: [], warnings: [], patient: null });
  const warn = (m) => out.meta.warnings.push(m);

  try {
    const doc = docBundle || {};
    const entries = Array.isArray(doc.entry) ? doc.entry : [];

    // Index every entry by fullUrl AND by resourceType/id so section references resolve either way.
    const index = {};
    for (const e of entries) {
      const r = e && e.resource; if (!r) continue;
      if (e.fullUrl) index[e.fullUrl] = r;
      if (r.resourceType && r.id) index[r.resourceType + "/" + r.id] = r;
    }
    const resolve = (ref) => { if (!ref) return null; const key = typeof ref === "string" ? ref : ref.reference; return key ? (index[key] || null) : null; };

    // Composition-FIRST: it drives the walk and identifies the document's record kind.
    const comp = entries.map((e) => e && e.resource).find((r) => r && r.resourceType === "Composition") || null;
    const recordType = recordTypeOf(comp);

    // Patient: from Composition.subject, else the first Patient resource.
    let P = comp && resolve(comp.subject);
    if (!P || P.resourceType !== "Patient") P = entries.map((e) => e && e.resource).find((r) => r && r.resourceType === "Patient") || null;
    if (P && P.id) {
      out.patient = patient({ id: P.id, gender: P.gender || "unknown", birthDate: P.birthDate || null,
        name: (P.name && P.name[0]) ? { text: P.name[0].text || null, given: P.name[0].given || [], family: P.name[0].family || null } : null });
    } else { warn("document has no resolvable Patient resource"); }

    if (!comp) { warn("Bundle.type=document has no Composition; cannot walk"); return out; }

    const prov = (r) => out.meta.provenance.push(provenance({ resource: r.resourceType, sourceConnector: "abdm", sourceId: r.resourceType + "/" + r.id }));

    // InvoiceRecord is a billing artifact, not clinical data: skip entirely, keep a trace.
    if (recordType === "InvoiceRecord") { warn("InvoiceRecord skipped: billing artifact, not clinical data"); return out; }

    // Every record is captured by-reference as a documentReference (narrative text only, NO binary).
    if (comp.id) {
      out.documents.push(documentReference({ id: comp.id, type: cc(comp.type, comp.title || recordType || "document"),
        status: comp.status || "unknown", date: comp.date || null, text: stripHtml(comp.text && comp.text.div) || comp.title || (recordType || "document") }));
      prov(comp);
    }

    // ImmunizationRecord: SCCM has no immunization resource key yet (owner decision: DEFER). Keep the
    // Composition documentReference metadata (narrative preserves the clinical info) + warn; do NOT map.
    if (recordType === "ImmunizationRecord") { warn("ImmunizationRecord: SCCM has no immunization resource key yet (owner decision: DEFER); recorded as documentReference metadata only"); return out; }

    const mapped = new Set();
    const cx = { recordType, resolve, out, mapped, prov, warn };
    for (const sec of flattenSections(comp.section)) {
      for (const entryRef of (sec.entry || [])) {
        const r = resolve(entryRef);
        if (!r) { warn("referenced resource " + ((entryRef && entryRef.reference) || JSON.stringify(entryRef)) + " not found in document"); continue; }
        mapResource(r, cx);
      }
    }
  } catch (e) {
    warn("NDHM normalize degraded (no throw): " + (e && e.message));
  }
  return out;
}

function mapResource(r, cx) {
  if (!r || !r.resourceType) return;
  const key = r.resourceType + "/" + r.id;
  if (r.id && cx.mapped.has(key)) return;
  if (r.id) cx.mapped.add(key);
  if (CONTEXT.has(r.resourceType)) return;           // structural context, no clinical payload
  if (!r.id) { cx.warn(r.resourceType + " without a stable id skipped"); return; }

  const { out, recordType, resolve, prov } = cx;
  switch (r.resourceType) {
    case "Condition":
      out.conditions.push(condition({ id: r.id, code: cc(r.code, "condition"), clinicalStatus: firstCoding([r.clinicalStatus]) || "unknown" }));
      prov(r); break;
    case "MedicationRequest":
      out.medications.push(medicationStatement({ id: r.id, medication: medOf(r, resolve), origin: "order", status: r.status || "unknown", dosage: dosageOf(r) }));
      prov(r); break;
    case "MedicationStatement":
      out.medications.push(medicationStatement({ id: r.id, medication: medOf(r, resolve), origin: "statement", status: r.status || "unknown", dosage: dosageOf(r) }));
      prov(r); break;
    case "AllergyIntolerance":
      out.allergies.push(allergyIntolerance({ id: r.id, code: cc(r.code, "allergen"), criticality: r.criticality || "unable-to-assess" }));
      prov(r); break;
    case "Observation":
      out.observations.push(observation({ id: r.id, category: obsCategory(r, recordType), code: cc(r.code, "observation"),
        value: obsValue(r), effectiveDateTime: r.effectiveDateTime || null, status: r.status || "unknown" }));
      prov(r); break;
    case "DiagnosticReport": {
      const results = [];
      for (const rr of (r.result || [])) {
        const obs = resolve(rr);
        if (obs && obs.resourceType === "Observation") { mapResource(obs, cx); results.push(reference("Observation", obs.id)); }
        else cx.warn("DiagnosticReport/" + r.id + " result " + ((rr && rr.reference) || "?") + " not found in document");
      }
      out.diagnosticReports.push(diagnosticReport({ id: r.id, code: cc(r.code, "report"), status: r.status || "unknown",
        conclusion: r.conclusion || null, effectiveDateTime: r.effectiveDateTime || null, results }));
      prov(r); break;
    }
    case "DocumentReference": {
      // Metadata only — the attachment bytes (base64/url) are NEVER copied into SCCM.
      const att = (r.content && r.content[0] && r.content[0].attachment) || {};
      out.documents.push(documentReference({ id: r.id, type: cc(r.type, "document"), status: r.status || "unknown",
        text: att.title || r.description || att.contentType || null }));
      prov(r);
      if (att.data || (att.url && /^data:/.test(att.url))) cx.warn("DocumentReference/" + r.id + " binary content (" + (att.contentType || "attachment") + ") not carried into SCCM; metadata only");
      break;
    }
    case "Binary":
      cx.warn("Binary/" + r.id + " binary content not carried into SCCM (bytes are never imported)"); break;
    case "Immunization":
      cx.warn("Immunization/" + r.id + " skipped: SCCM has no immunization resource key yet (owner decision: DEFER)"); break;
    case "Invoice":
      cx.warn("Invoice/" + r.id + " skipped: billing artifact, not clinical data"); break;
    default:
      cx.warn("unsupported resourceType " + r.resourceType + "/" + r.id + " not mapped");
  }
}
