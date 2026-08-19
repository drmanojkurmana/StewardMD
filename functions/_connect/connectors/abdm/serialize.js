// functions/_connect/connectors/abdm/serialize.js — SCCM record -> NDHM-FHIR R4 document Bundle (the ABDM HIP serve map).
// The MIRROR/INVERSE of connectors/abdm/normalize.js: same RECORD_PROFILES, the inverse of its cc() text-fallback
// helper (ccInv), and its output round-trips back through normalizeNdhm to the SAME SCCM resource counts.
// R11: a StewardMD summary is emitted Composition-FIRST with author=StewardMD device + custodian=tenant org, so
// it is ingested as a decision-support document, NOT a hospital's legal medical record. R12: never throw on a
// partial record (validateNdhmDoc reports the shape errors instead).
//
// ZERO BINARY, WITH ONE NAMED EXCEPTION. Attachment/Binary bytes are never emitted; documents are carried
// by-reference / narrative text only. The single exception is HealthDocumentRecord, and it is forced by the
// profile rather than chosen: NRCES makes DocumentReference.content.attachment.data min=1, so a
// HealthDocumentRecord WITHOUT the bytes is structurally invalid. consented-store.js already anticipated
// exactly this ("a genuinely scanned artefact ... must be stored as bytes. Those are HealthDocumentRecord
// and are the only case where the cap should be raised deliberately").
// The relaxation is narrow: bytes are emitted ONLY for HealthDocumentRecord, ONLY when the SCCM document
// actually carries them, and never for any other profile. A HealthDocumentRecord whose source has no bytes
// is REFUSED rather than emitted hollow.
// // VERIFY (owner): this widens a stated invariant. Confirm it before enabling the HIP push path.

// The Composition-level "record" kinds (identical set + order to normalize.js RECORD_PROFILES).
const RECORD_PROFILES = ["DiagnosticReportRecord", "PrescriptionRecord", "OPConsultRecord", "DischargeSummaryRecord", "WellnessRecord", "ImmunizationRecord", "HealthDocumentRecord", "InvoiceRecord"];
const PROFILE = (name) => "https://nrces.in/ndhm/fhir/r4/StructureDefinition/" + name;
const SNOMED = "http://snomed.info/sct";
const V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203";
// NRCES makes identifier.type min=1 on Patient AND Organization (extensible binding to
// ndhm-identifier-type-code, which layers over v2-0203). Without it the resource does not conform, and
// every REFERENCE to it then fails as "unable to find a match for profile" - which is how 9 Patient and
// 4 Organization reference errors were really one missing element.
const ID_TYPE_MR = { coding: [{ system: V2_0203, code: "MR", display: "Medical record number" }], text: "Medical record number" };
const ID_TYPE_PRN = { coding: [{ system: V2_0203, code: "PRN", display: "Provider number" }], text: "Provider number" };

// ── the per-profile shape, taken from the NRCES IG itself (ndhm.in#6.5.0) ───────────────────────────
// This table is not a guess and not a convention: every value below was read out of
// nrces.in/ndhm/fhir/r4/package.tgz, and every bundle this file emits is checked against that IG by
// HAPI validator_cli 6.2.1 in test/connect/abdm/fhir-validation.test.mjs.
//
// WHY IT HAS TO BE PER-PROFILE. The old code emitted one generic "everything" bundle - Diagnosis,
// Medications, Allergies, Observations and Investigations as five sections - for all eight record types.
// Five of the eight profiles allow `Composition.section` a MAXIMUM OF ONE, and slice its entry to
// specific resource types with slicing CLOSED. So the generic bundle failed every single profile: 8 of 8
// bundles were rejected. A PrescriptionRecord carries medications; a DiagnosticReportRecord carries
// reports. Emitting everything everywhere was never valid, it just was never checked.
//
//   type      the FIXED Composition.type the profile demands (fixedCode / fixedString on .text)
//   encounter true when Composition.encounter has min=1
//   sections  ordered; `accepts` names the SCCM collections whose resources may appear in that section
const SCCM_KIND = {
  conditions: "Condition", medications: "Medication", allergies: "AllergyIntolerance",
  observations: "Observation", diagnosticReports: "DiagnosticReport", documents: "DocumentReference",
};
const RECORD_SHAPE = {
  OPConsultRecord: {
    type: { code: "371530004", display: "Clinical consultation report" }, encounter: true,
    sections: [
      { name: "MedicalHistory", title: "Medical History", accepts: ["conditions"] },
      { name: "Allergies", title: "Allergies", accepts: ["allergies"] },
      { name: "Medications", title: "Medications", accepts: ["medications"] },
      { name: "OtherObservations", title: "Other Observations", accepts: ["observations"] },
      { name: "InvestigationAdvice", title: "Investigation Advice", accepts: ["diagnosticReports"] },
      { name: "DocumentReference", title: "Document Reference", accepts: ["documents"] },
    ],
  },
  DischargeSummaryRecord: {
    type: { code: "373942005", display: "Discharge summary" }, encounter: true,
    sections: [
      { name: "MedicalHistory", title: "Medical History", accepts: ["conditions"] },
      { name: "Allergies", title: "Allergies", accepts: ["allergies"] },
      { name: "Medications", title: "Medications", accepts: ["medications"] },
      { name: "Investigations", title: "Investigations", accepts: ["observations", "diagnosticReports"] },
      { name: "DocumentReference", title: "Document Reference", accepts: ["documents"] },
    ],
  },
  WellnessRecord: {
    // The only profile whose type is text-only (no fixed SNOMED code).
    type: { text: "Wellness Record" }, encounter: false,
    sections: [
      { name: "OtherObservations", title: "Other Observations", accepts: ["observations"] },
      { name: "DocumentReference", title: "Document Reference", accepts: ["documents"] },
    ],
  },
  // ── single-section profiles: section max = 1, entry slicing CLOSED ──
  PrescriptionRecord: {
    // The section slices to MedicationRequest or Binary, slicing CLOSED. A MedicationStatement - what
    // SCCM produces for a medication the patient is simply ON, rather than one prescribed here - is a
    // different resource type and is excluded. A prescription record carries prescriptions.
    type: { code: "440545006", display: "Prescription record" }, encounter: false,
    sections: [{ title: "Prescription", accepts: ["medicationRequests"] }],
  },
  DiagnosticReportRecord: {
    // No FIXED code, but Composition.type.coding is min=1 AND its system is fixed to SNOMED - so a code
    // must be chosen, and it must be a SNOMED one. 721981007 is "Diagnostic studies report".
    type: { code: "721981007", display: "Diagnostic studies report" }, encounter: false,
    sections: [{ title: "Diagnostic Report", accepts: ["diagnosticReports", "documents"] }],
  },
  HealthDocumentRecord: {
    // The whole point of this profile is to carry a document, and section/section.entry are both min=1.
    // So here documents[0] is BOTH the Composition narrative and a DocumentReference in the section -
    // for every other profile it is only the narrative.
    type: { code: "419891008", display: "Record artifact" }, encounter: false,
    includePrimaryDoc: true,
    inlineBytes: true,                 // the ONLY profile permitted to carry attachment bytes
    needsAttachment: true,             // …and it must actually have some
    sections: [{ title: "Health Document", accepts: ["documents"] }],
  },
  ImmunizationRecord: {
    // NRCES: section min=1 AND section.entry min=1, so an immunisation record with nothing in it is
    // STRUCTURALLY INVALID rather than merely thin. SCCM v1.1 added `immunizations` precisely so this HI
    // type could be served; `needs` still refuses a record that carries none, because refusing beats
    // pushing a document the far end rejects.
    type: { code: "41000179103", display: "Immunization record" }, encounter: false,
    needs: ["immunizations"],
    sections: [{ title: "Immunization", accepts: ["immunizations", "documents"] }],
  },
  InvoiceRecord: {
    // Same story: SCCM v1.1 added `invoices`. ABDM requires this HI type of an HMIS, and a patient asking
    // for their records is entitled to what they were charged.
    type: { text: "Invoice Record" }, encounter: false,
    needs: ["invoices"],
    sections: [{ title: "Invoice", accepts: ["invoices"] }],
  },
};

// Provenance stamp: source:"StewardMD" on every emitted resource (R11/R12).
const SOURCE_URI = "https://stewardmd.in";
const SOURCE_TAG = { system: "https://stewardmd.in/CodeSystem/provenance-source", code: "StewardMD", display: "StewardMD" };
function stampMeta(res, extra) {
  res.meta = Object.assign({ tag: [SOURCE_TAG], source: SOURCE_URI }, res.meta || {}, extra || {});
  return res;
}
/** DiagnosticReportLab is the NRCES name; there is no bare "DiagnosticReport" profile in the IG. */

const uuid = () => (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : ("x" + Date.now().toString(16) + Math.random().toString(16).slice(2));
const safeIso = (d) => (d && typeof d.toISOString === "function") ? d.toISOString() : new Date().toISOString();
const humanize = (p) => String(p).replace(/Record$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "Health Document";
const escapeHtml = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// FHIR document-bundle references must RESOLVE inside the bundle, so `fullUrl` and every `reference` to
// that resource have to be the SAME string. They were not: fullUrl was "urn:uuid:composition-<id>" while
// the reference was "Composition/<id>", so a validator resolving the document found nothing - and
// "urn:uuid:composition-<id>" is not a well-formed urn:uuid either (it must be an actual UUID).
// ABDM FAQ Q37/Q46 settles the style: use urn:uuid. One UUID is minted per resource on first mention and
// reused for both sides. The WeakMap is keyed by the resource OBJECT and every serializeNdhm call builds
// fresh objects, so ids never collide across calls and entries are collected when the bundle is.
const URNS = new WeakMap();
const urnFor = (res) => {
  let u = URNS.get(res);
  if (!u) { u = "urn:uuid:" + uuid(); URNS.set(res, u); }
  return u;
};
// `type` is not decoration: the NRCES profiles slice Composition.section.entry with the discriminator
// ('MedicationRequest' in type) and slicing CLOSED. A reference without it matches NO slice, so a
// correctly-shaped section was still rejected outright.
const refOf = (res) => ({ reference: urnFor(res), type: res.resourceType });
const entryOf = (res) => ({ fullUrl: urnFor(res), resource: res });

// INVERSE of normalize.js cc(): SCCM codeable {coding:[{system,code,display,kind}],text} -> FHIR CodeableConcept
// {coding:[{system,code,display}],text}. The `kind` is dropped (FHIR has none); normalizeNdhm re-derives it from
// its STD set — so preserving `system` verbatim keeps a local code local and a standard system standard. ALWAYS a
// non-empty `text` (the R12 fallback).
function ccInv(sccmCc, fallback) {
  const text = (sccmCc && typeof sccmCc.text === "string" && sccmCc.text.trim()) ? sccmCc.text.trim() : (fallback || "unknown");
  const coding = ((sccmCc && sccmCc.coding) || [])
    .map((c) => {
      const o = {};
      if (c.system) o.system = c.system;
      if (c.code) o.code = c.code;
      // NRCES marks coding.display min=1 on Observation/MedicationRequest/DiagnosticReport codes. A code
      // with no display is unreadable to the receiving clinician anyway, so the concept text stands in.
      o.display = c.display || text;
      return o;
    })
    .filter((c) => c.system || c.code);
  // FHIR: "Array cannot be empty - the property should not be present if it has no values". An empty
  // `coding: []` is an ERROR, not a harmless default, and the validator flagged 16 of them.
  return coding.length ? { coding, text } : { text };
}
// A status/category coding that still carries the mandatory text fallback (so validateNdhmDoc sees a text).
// An absent code yields NO coding array at all - see the ccInv note above.
const codedText = (code, text) => (code
  ? { coding: [{ code }], text: String(text || code) }
  : { text: String(text || "unknown") });
// The same, bound to a code SYSTEM. Several NRCES/R4 elements are bound to a required value set, and a
// code with no system "has no defined meaning and cannot be validated" - which the validator treats as an
// error on Condition.clinicalStatus and AllergyIntolerance.clinicalStatus.
/** Keep only SNOMED codings; a CodeableConcept with none left is text-only, which is always valid. */
function snomedOnly(cc) {
  const keep = (cc.coding || []).filter((c) => !c.system || c.system === SNOMED);
  return keep.length ? { coding: keep, text: cc.text } : { text: cc.text };
}
const codedIn = (system, code, text) => ({ coding: [{ system, code }], text: String(text || code) });
const CLINICAL_STATUS = "http://terminology.hl7.org/CodeSystem/condition-clinical";
const ALLERGY_CLINICAL = "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical";
const OBS_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category";
// Condition Clinical Status Codes is a REQUIRED binding, so an unmapped local value must not be invented.
const CONDITION_STATUS = new Set(["active", "recurrence", "relapse", "inactive", "remission", "resolved"]);
const ALLERGY_STATUS = new Set(["active", "inactive", "resolved"]);
const OBS_CATEGORIES = new Set(["social-history", "vital-signs", "imaging", "laboratory", "procedure",
                                "survey", "exam", "therapy", "activity"]);

function pickProfile(r) {
  const p = r && r.profile;
  if (typeof p === "string" && RECORD_PROFILES.includes(p)) return p;
  return "DischargeSummaryRecord"; // StewardMD decision-support summaries default to a discharge-summary record
}

function buildPatient(p) {
  const res = { resourceType: "Patient", id: p.id, gender: p.gender || "unknown" };
  if (p.birthDate) res.birthDate = p.birthDate;
  if (p.name) { const n = {}; if (p.name.text) n.text = p.name.text; if (p.name.family) n.family = p.name.family; if (p.name.given) n.given = p.name.given; res.name = [n]; }
  // NRCES Patient makes identifier min=1. The SCCM identifiers are used when present; otherwise the
  // record's own patient id is carried as a local identifier - NEVER the ABHA, which does not belong in a
  // bundle that crosses to another facility under a care-context reference.
  const ids = (p.identifiers || []).filter((i) => i && i.value)
    .map((i) => ({ type: ID_TYPE_MR, system: i.system || "https://stewardmd.in/patient-id", value: String(i.value) }));
  res.identifier = ids.length ? ids : [{ type: ID_TYPE_MR, system: "https://stewardmd.in/patient-id", value: String(p.id) }];
  return stampMeta(res, { profile: [PROFILE("Patient")] });
}
function buildAuthorDevice() {
  // StewardMD Device = the software author of the summary (Device.type omitted: a CodeableConcept must carry text).
  return stampMeta({ resourceType: "Device", id: "stewardmd-cds", status: "active", manufacturer: "StewardMD", deviceName: [{ name: "StewardMD Clinical Decision Support", type: "user-friendly-name" }] });
}
function buildCustodianOrg(tenantId) {
  const t = String(tenantId || "stewardmd").replace(/[^A-Za-z0-9_-]/g, "-");
  // NRCES Organization: identifier AND name are both min=1.
  return stampMeta({
    resourceType: "Organization", id: "stewardmd-org-" + t,
    identifier: [{ type: ID_TYPE_PRN, system: "https://stewardmd.in/tenant", value: String(tenantId || "stewardmd") }],
    name: "StewardMD (tenant " + (tenantId || "stewardmd") + ")",
  }, { profile: [PROFILE("Organization")] });
}
// The HFR facility this document was produced at. ABDM's Main Envelope requires
// Composition.attester.party to be an Organization whose identifier.value is the HIP id, with the facility
// registry as the system - that is how the HIE-CM attributes a record to a real facility.
const FACILITY_SYSTEM = { sandbox: "https://facilitysbx.ndhm.gov.in", production: "https://facility.ndhm.gov.in" };
export function facilitySystemFor(envName) {
  return FACILITY_SYSTEM[String(envName || "sandbox").toLowerCase()] || FACILITY_SYSTEM.sandbox;
}
function buildHipOrg(hipId, system) {
  const safe = String(hipId).replace(/[^A-Za-z0-9_-]/g, "-");
  // attester.party must resolve to something matching the NRCES Organization profile - the validator
  // rejected it as "unable to find a match for profile" until this carried meta.profile.
  return stampMeta({
    resourceType: "Organization", id: "hip-" + safe, name: "StewardMD HIP " + hipId,
    identifier: [{ type: ID_TYPE_PRN, system, value: String(hipId) }],
  }, { profile: [PROFILE("Organization")] });
}
// Composition.encounter is min=1 on OPConsultRecord and DischargeSummaryRecord. NRCES Encounter requires
// class and status; an SCCM encounter supplies the rest when it has one.
function buildEncounter(enc, subject) {
  const e = enc || {};
  const res = {
    resourceType: "Encounter", id: e.id || "enc-1", status: e.status || "finished",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: e.class || "AMB", display: e.classDisplay || "ambulatory" },
  };
  if (subject) res.subject = subject;
  if (e.period) res.period = e.period;
  return stampMeta(res, { profile: [PROFILE("Encounter")] });
}
// EVERY clinical resource needs a subject. R4 makes Condition.subject, AllergyIntolerance.patient,
// MedicationRequest.subject and MedicationStatement.subject all min=1, and the validator raised 8 of each:
// a clinical statement about nobody is not a clinical statement.
function buildCondition(c, subject) {
  const status = String(c.clinicalStatus || "").toLowerCase();
  const res = { resourceType: "Condition", id: c.id, code: ccInv(c.code, "condition") };
  // Condition Clinical Status Codes is a REQUIRED binding: send a real code or send none at all, never
  // invent one from a local string.
  if (CONDITION_STATUS.has(status)) res.clinicalStatus = codedIn(CLINICAL_STATUS, status);
  if (subject) res.subject = subject;
  return stampMeta(res, { profile: [PROFILE("Condition")] });
}
function buildMedication(m, subject, requester, generatedAt) {
  const rt = m.origin === "order" ? "MedicationRequest" : "MedicationStatement";
  // NRCES binds MedicationRequest.medication[x].coding.system to SNOMED. A source code in another system
  // (our SCCM carries RxNorm) is DROPPED rather than relabelled - passing an RxNorm code off as SNOMED
  // would be a false clinical claim, and the concept text still carries the meaning.
  const med = rt === "MedicationRequest" ? snomedOnly(ccInv(m.medication, "medication")) : ccInv(m.medication, "medication");
  const res = { resourceType: rt, id: m.id, status: m.status || "unknown", medicationCodeableConcept: med };
  if (subject) res.subject = subject;
  if (rt === "MedicationRequest") {
    // NRCES MedicationRequest: authoredOn, dosageInstruction, intent, medication[x], requester, status,
    // subject are ALL min=1.
    res.intent = "order";
    res.authoredOn = m.authoredOn || m.date || generatedAt;   // min=1; the document time is the honest floor
    if (requester) res.requester = requester;
    res.dosageInstruction = [{ text: (m.dosage && m.dosage.text) || "As directed" }];
  } else if (m.dosage && m.dosage.text) {
    res.dosage = [{ text: m.dosage.text }];
  }
  return stampMeta(res, rt === "MedicationRequest" ? { profile: [PROFILE("MedicationRequest")] } : undefined);
}
function buildAllergy(a, subject) {
  const status = String(a.clinicalStatus || "active").toLowerCase();
  const res = { resourceType: "AllergyIntolerance", id: a.id, criticality: a.criticality || "unable-to-assess", code: ccInv(a.code, "allergen") };
  // ait-1: "AllergyIntolerance.clinicalStatus SHALL be present if verificationStatus is not
  // entered-in-error." We never emit entered-in-error, so it is always required.
  res.clinicalStatus = codedIn(ALLERGY_CLINICAL, ALLERGY_STATUS.has(status) ? status : "active");
  if (subject) res.patient = subject;
  return stampMeta(res, { profile: [PROFILE("AllergyIntolerance")] });
}
function buildObservation(o, subject) {
  const cat = String(o.category || "").toLowerCase();
  const res = { resourceType: "Observation", id: o.id, status: o.status || "unknown", code: ccInv(o.code, "observation") };
  // Observation Category Codes is a preferred binding; a code with no system cannot be validated, so an
  // unmapped local category is dropped rather than emitted systemless.
  if (OBS_CATEGORIES.has(cat)) res.category = [codedIn(OBS_CATEGORY, cat)];
  if (subject) res.subject = subject;
  const v = o.value;
  if (v != null) {
    if (typeof v.text === "string" && v.value == null && v.unit == null) res.valueString = v.text;
    else { const q = {}; if (v.value != null) q.value = v.value; if (v.unit) q.unit = v.unit; if (v.system) q.system = v.system; if (v.code) q.code = v.code; res.valueQuantity = q; }
  }
  if (o.effectiveDateTime) res.effectiveDateTime = o.effectiveDateTime;
  return stampMeta(res, { profile: [PROFILE("Observation")] });
}
function buildDiagnosticReport(d, subject, obsRefs, interpreter) {
  const res = { resourceType: "DiagnosticReport", id: d.id, status: d.status || "unknown", code: ccInv(d.code, "report") };
  if (subject) res.subject = subject;
  // NRCES DiagnosticReportLab makes resultsInterpreter min=1. Where the source names nobody, the
  // custodian organisation is the honest answer: this facility issued the report.
  if (interpreter) res.resultsInterpreter = [interpreter];
  if (d.conclusion) res.conclusion = d.conclusion;
  if (d.effectiveDateTime) res.effectiveDateTime = d.effectiveDateTime;
  // `result` must point at the Observation's urn in THIS bundle. It used to emit "Observation/<id>",
  // which resolved to nothing once references became urn:uuid, and the validator called it an invalid
  // target type. A referenced observation that is not in the bundle is dropped rather than dangled.
  const result = (d.results || [])
    .filter((rr) => rr && rr.type === "Observation" && rr.id && obsRefs && obsRefs.get(rr.id))
    .map((rr) => obsRefs.get(rr.id));
  if (result.length) res.result = result;
  return stampMeta(res, { profile: [PROFILE("DiagnosticReportLab")] });
}
const DOC_STATUS = new Set(["current", "superseded", "entered-in-error"]);
/**
 * The attachment. Bytes are emitted ONLY when the profile permits it (HealthDocumentRecord) AND the source
 * actually has them - see the ZERO BINARY note at the top of this file. Every other profile gets metadata
 * and narrative only, exactly as before.
 */
function buildAttachment(d, inlineBytes) {
  const att = { title: d.text || undefined };
  if (inlineBytes && d.data && d.contentType) { att.contentType = d.contentType; att.data = d.data; }
  return att;
}
/**
 * Immunization. NRCES minima: status, vaccineCode (system+code+display), patient, occurrence[x].
 *
 * site / route / performer / reasonCode / protocolApplied are all OPTIONAL parents whose codings are
 * min=1 once the parent exists - so a half-known site is emitted as nothing rather than as a coding the
 * validator will reject. The SCCM validator already refuses an incomplete one upstream.
 */
function buildImmunization(im, subject) {
  const res = {
    resourceType: "Immunization", id: im.id,
    status: im.status || "completed",
    vaccineCode: ccInv(im.vaccineCode, "vaccine"),
    occurrenceDateTime: im.occurrenceDateTime,
  };
  if (subject) res.patient = subject;
  if (im.lotNumber) res.lotNumber = im.lotNumber;
  if (im.expirationDate) res.expirationDate = im.expirationDate;
  // A site/route coding must be complete or absent. `hasFullCoding` is what makes that a rule rather than
  // a hope: text-only is fine for a CodeableConcept in general, but NOT for these two elements.
  if (hasFullCoding(im.site)) res.site = ccInv(im.site, "site");
  if (hasFullCoding(im.route)) res.route = ccInv(im.route, "route");
  if (im.doseNumber != null) {
    res.protocolApplied = [{ doseNumberPositiveInt: Number(im.doseNumber) }];
  }
  if (im.manufacturer) res.manufacturer = { display: String(im.manufacturer) };
  return stampMeta(res, { profile: [PROFILE("Immunization")] });
}
/** True when every coding carries system, code AND display - what NRCES demands once the element exists. */
function hasFullCoding(cc) {
  const codings = (cc && cc.coding) || [];
  return codings.length > 0 && codings.every((c) => c.system && c.code && c.display);
}

/**
 * Invoice. NRCES minima: identifier.value, status, type (system+code+display), subject, date,
 * lineItem[].chargeItem[x], lineItem[].priceComponent[].{type, code(system+code+display), amount},
 * totalNet, totalGross.
 *
 * Money currency is passed through, never defaulted: guessing INR on a bill we did not issue would be
 * inventing a fact about someone's money. The SCCM validator refuses an amount with no currency, so by
 * the time we are here there is one.
 */
function buildInvoice(inv, subject, participant) {
  const money = (m) => ({ value: m.value, currency: m.currency });
  const res = {
    resourceType: "Invoice", id: inv.id,
    identifier: [{ system: "https://stewardmd.in/invoice", value: String(inv.identifierValue) }],
    status: inv.status || "issued",
    type: ccInv(inv.type, "invoice"),
    date: inv.date,
    lineItem: (inv.lineItems || []).map((li, i) => {
      const out = { sequence: li.sequence != null ? Number(li.sequence) : i + 1 };
      out.chargeItemCodeableConcept = ccInv(li.chargeItem, "charge");
      out.priceComponent = (li.priceComponents || []).map((pc) => {
        const p = { type: pc.type || "base", code: ccInv(pc.code, "price component"), amount: money(pc.amount || {}) };
        if (pc.factor != null) p.factor = Number(pc.factor);
        return p;
      });
      return out;
    }),
    totalNet: money(inv.totalNet || {}),
    totalGross: money(inv.totalGross || {}),
  };
  if (subject) res.subject = subject;
  // participant.actor is min=1 once participant exists, so the issuing organisation is named explicitly.
  if (participant) res.participant = [{ actor: participant }];
  return stampMeta(res, { profile: [PROFILE("Invoice")] });
}

function buildDocumentReference(d, inlineBytes) {
  // By-reference metadata only — NO attachment.data / Binary bytes are ever emitted.
  // DocumentReference.status is a REQUIRED binding to current|superseded|entered-in-error. An SCCM
  // document often carries a Composition-style status like "final", which is a different value set: it is
  // mapped rather than passed through, because a required binding rejects the document outright.
  const status = DOC_STATUS.has(String(d.status)) ? d.status : "current";
  return stampMeta({
    resourceType: "DocumentReference", id: d.id, status,
    type: ccInv(d.type, "document"),
    content: [{ attachment: buildAttachment(d, inlineBytes) }],
  }, { profile: [PROFILE("DocumentReference")] });
}

// Group section entries by title, preserving insertion order (matches how normalizeNdhm walks flattened sections).
function sectionPusher() {
  const byTitle = new Map(); const list = [];
  return { list, add(title, ref) { let s = byTitle.get(title); if (!s) { s = { title, entry: [] }; byTitle.set(title, s); list.push(s); } s.entry.push(ref); } };
}

export function serializeNdhm(ctx, record) {
  const identifier = { system: "urn:ietf:rfc:3986", value: "urn:uuid:" + uuid() }; // globally-unique, FRESH per call
  const generatedAt = (ctx && typeof ctx.now === "function") ? safeIso(ctx.now()) : new Date().toISOString();
  const meta = { tag: [SOURCE_TAG], source: SOURCE_URI };
  try {
    const r = record || {};
    const tenantId = (r.tenantId) || (ctx && ctx.tenant && ctx.tenant.id) || "stewardmd";
    const profile = pickProfile(r);
    const shape = RECORD_SHAPE[profile] || RECORD_SHAPE.DischargeSummaryRecord;

    // Some profiles CANNOT be produced from an SCCM record that lacks the data they are made of, because
    // NRCES marks both section and section.entry min=1. Emitting an empty one produces a document the
    // receiving system rejects, which is worse than declining: the HIU sees a care context that never
    // loads. UnservableProfileError is caught below and reported through validateNdhmDoc.
    for (const need of (shape.needs || [])) {
      if (!Array.isArray(r[need]) || r[need].length === 0) {
        throw new Error("cannot build " + profile + ": the record carries no " + need +
          ", and NRCES requires at least one section entry");
      }
    }
    if (shape.needsAttachment && !(r.documents || []).some((d) => d && d.data && d.contentType)) {
      // NRCES makes attachment.data min=1 on DocumentReference, so a health-document record without the
      // scanned bytes cannot be built. Refusing is right: the HIU would otherwise see a care context
      // that resolves to an empty document.
      throw new Error("cannot build " + profile + ": no document carries attachment bytes (contentType + data)");
    }

    const patientRes = (r.patient && r.patient.id) ? buildPatient(r.patient) : null;
    const author = buildAuthorDevice();
    const custodian = buildCustodianOrg(tenantId);
    const subject = patientRes ? refOf(patientRes) : null;
    const requester = refOf(custodian);        // NRCES MedicationRequest.requester is min=1

    // Encounter, only where the profile demands one.
    const encounterRes = shape.encounter ? buildEncounter((r.encounters || [])[0], subject) : null;

    // Build every candidate resource ONCE, keyed by the SCCM collection it came from, so the section
    // table below can select rather than rebuild. Observations are indexed by SCCM id as well, because a
    // DiagnosticReport.result must reference the urn of an Observation that is actually in this bundle.
    const obsRefs = new Map();
    const built = { conditions: [], medications: [], medicationRequests: [], allergies: [],
                    observations: [], diagnosticReports: [], documents: [],
                    immunizations: [], invoices: [] };
    for (const c of (r.conditions || [])) if (c && c.id) built.conditions.push(buildCondition(c, subject));
    for (const m of (r.medications || [])) if (m && m.id) {
      const res = buildMedication(m, subject, requester, generatedAt);
      built.medications.push(res);
      // PrescriptionRecord's closed slicing admits MedicationRequest only, so the two are kept apart.
      if (res.resourceType === "MedicationRequest") built.medicationRequests.push(res);
    }
    for (const a of (r.allergies || [])) if (a && a.id) built.allergies.push(buildAllergy(a, subject));
    for (const o of (r.observations || [])) if (o && o.id) {
      const res = buildObservation(o, subject);
      built.observations.push(res);
      obsRefs.set(o.id, refOf(res));
    }
    for (const d of (r.diagnosticReports || [])) if (d && d.id) built.diagnosticReports.push(buildDiagnosticReport(d, subject, obsRefs, requester));
    for (const im of (r.immunizations || [])) if (im && im.id) built.immunizations.push(buildImmunization(im, subject));
    for (const inv of (r.invoices || [])) if (inv && inv.id) built.invoices.push(buildInvoice(inv, subject, requester));

    // documents[0] IS the summary itself -> it becomes the Composition narrative (normalizeNdhm always
    // re-captures the Composition as one documentReference). documents[1..] become by-reference
    // DocumentReference resources. This keeps the round-trip document count exact.
    const docs = r.documents || [];
    const primaryDoc = docs[0] || null;
    // A DocumentReference is emitted ONLY when it can actually conform: NRCES makes
    // content.attachment.contentType AND .data both min=1, so a by-reference document with no bytes is
    // not a valid DocumentReference at all. Its text is already the Composition narrative, so skipping it
    // loses nothing - whereas emitting it produces a document the receiving system rejects.
    const firstDoc = shape.includePrimaryDoc ? 0 : 1;
    for (let i = firstDoc; i < docs.length; i++) {
      const d = docs[i];
      if (!d || !d.id) continue;
      if (!(d.contentType && d.data)) continue;
      built.documents.push(buildDocumentReference(d, shape.inlineBytes === true));
    }

    // The attesting facility. Present only when a HIP id is configured - an unattested bundle is still a
    // valid document, but an attester pointing at a blank facility id would be worse than none.
    const hipId = (ctx && ctx.hipId) || null;
    const hipOrg = hipId ? buildHipOrg(hipId, (ctx && ctx.facilitySystem) || facilitySystemFor(ctx && ctx.envName)) : null;

    // Sections, per the profile's OWN slices. A resource whose type this profile does not accept is not
    // emitted at all: five of the eight profiles slice section.entry with slicing CLOSED, so smuggling a
    // Condition into a PrescriptionRecord is a validation error, not a bonus.
    const sections = [];
    const included = [];
    for (const spec of shape.sections) {
      const entries = [];
      for (const kind of spec.accepts) for (const res of (built[kind] || [])) { entries.push(refOf(res)); included.push(res); }
      // NRCES marks section.entry min=1 on the single-section profiles, and FHIR's own cmp-1 says a
      // section must contain text, entries or sub-sections. So an empty section is never emitted - a
      // multi-section profile omits it, and a single-section profile has already been refused above by
      // its `needs` guard.
      if (!entries.length) continue;
      sections.push({ title: spec.title, entry: entries });
    }

    const comp = buildComposition({
      profile, shape, primaryDoc, patientRes, author, custodian, hipOrg,
      encounterRes, generatedAt, sections,
    });

    const entry = [entryOf(comp)]; // Composition FIRST
    if (patientRes) entry.push(entryOf(patientRes));
    entry.push(entryOf(author), entryOf(custodian));
    if (hipOrg) entry.push(entryOf(hipOrg));
    if (encounterRes) entry.push(entryOf(encounterRes));
    // ONLY the resources a section actually references. A document bundle whose entries are unreachable
    // from the Composition is not a document, it is a pile.
    for (const res of included) entry.push(entryOf(res));

    return { resourceType: "Bundle", type: "document", identifier, timestamp: generatedAt, meta, entry };
  } catch (e) {
    // R12: never throw on a partial/malformed record — return a shell bundle that validateNdhmDoc will reject.
    return { resourceType: "Bundle", type: "document", identifier, timestamp: generatedAt, meta: Object.assign({}, meta, { warning: "serializeNdhm degraded: " + (e && e.message) }), entry: [] };
  }
}

function buildComposition({ profile, shape, primaryDoc, patientRes, author, custodian, hipOrg, encounterRes, generatedAt, sections }) {
  const id = (primaryDoc && primaryDoc.id) || ("comp-" + uuid());
  const narrative = (primaryDoc && primaryDoc.text) ? primaryDoc.text : (humanize(profile) + " generated by StewardMD clinical decision support");
  const comp = {
    resourceType: "Composition", id, status: "final",
    meta: { profile: [PROFILE(profile)], tag: [SOURCE_TAG], source: SOURCE_URI },
    // Composition.type is FIXED by the profile - the old code sent "Discharge summary" for all eight,
    // which the validator rejected on six of them by name.
    type: compositionType(shape, profile),
    title: humanize(profile), date: generatedAt,
    text: { status: "generated", div: '<div xmlns="http://www.w3.org/1999/xhtml">' + escapeHtml(narrative) + "</div>" },
    section: sections,
  };
  if (patientRes) comp.subject = refOf(patientRes);
  if (encounterRes) comp.encounter = refOf(encounterRes);   // min=1 on OPConsult and DischargeSummary
  comp.author = [refOf(author)];       // StewardMD Device
  comp.custodian = refOf(custodian);   // StewardMD tenant Organization
  // Main Envelope: attester.party = the HFR facility Organization carrying our HIP id.
  if (hipOrg) comp.attester = [{ mode: "official", time: generatedAt, party: refOf(hipOrg) }];
  return comp;
}

/** The Composition.type the profile FIXES. Two profiles fix only `text` and must carry no coding at all. */
function compositionType(shape, profile) {
  const t = shape && shape.type;
  if (!t) return { text: humanize(profile) };                       // DiagnosticReportRecord fixes nothing
  if (t.text && !t.code) return { text: t.text };                   // Wellness / Invoice: text only
  return { coding: [{ system: t.system || SNOMED, code: t.code, display: t.display }], text: t.display };
}

// Structural NDHM-document shape checker (mirror of what the HIU normalizer expects). NOT full profile conformance.
// VERIFY: validate the emitted bundle against the live NRCES/FHIR validator (R11) — this is the structural gate, not full profile conformance.
export function validateNdhmDoc(docBundle) {
  const errors = [];
  const b = docBundle;
  if (!b || typeof b !== "object") return { ok: false, errors: ["bundle missing or not an object"] };
  if (b.type !== "document") errors.push('Bundle.type must be "document"');
  const id = b.identifier;
  if (!id || typeof id.value !== "string" || !id.value.trim()) errors.push("Bundle.identifier.value missing (a globally-unique non-empty urn is required)");
  const entries = Array.isArray(b.entry) ? b.entry : [];
  const first = entries[0] && entries[0].resource;
  if (!first || first.resourceType !== "Composition") errors.push("first entry must be a Composition (Composition-first, R11)");
  else {
    if (!first.subject) errors.push("Composition.subject (Patient) missing");
    if (!first.author || (Array.isArray(first.author) ? first.author.length === 0 : !first.author)) errors.push("Composition.author (StewardMD device/organization) missing");
    if (!first.custodian) errors.push("Composition.custodian (StewardMD tenant organization) missing");
  }
  walkDoc(b, errors, "Bundle"); // every CodeableConcept carries a non-empty text; and NO binary/attachment bytes.
  return { ok: errors.length === 0, errors };
}

function walkDoc(node, errors, path) {
  if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) walkDoc(node[i], errors, path + "[" + i + "]"); return; }
  if (!node || typeof node !== "object") return;
  if (node.resourceType === "Binary") errors.push(path + ": Binary resource (raw bytes) is not permitted in a decision-support document");
  if (Array.isArray(node.coding) && (typeof node.text !== "string" || !node.text.trim())) errors.push(path + ": CodeableConcept missing a non-empty text fallback");
  // Inline bytes are permitted in exactly one place: a DocumentReference attachment, which is what a
  // HealthDocumentRecord IS. Anywhere else they are still a leak of a rendering we should not be shipping.
  const isDocAttachment = /\.content\[\d+\]\.attachment$/.test(path);
  if (typeof node.data === "string" && node.data.trim() && !isDocAttachment) {
    errors.push(path + ".data: inline attachment/Binary bytes are not permitted (metadata / narrative only)");
  }
  if (typeof node.url === "string" && /^data:/i.test(node.url)) errors.push(path + ".url: data: URI bytes are not permitted");
  for (const k of Object.keys(node)) { if (k === "meta") continue; walkDoc(node[k], errors, path + "." + k); }
}
