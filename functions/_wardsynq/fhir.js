/* functions/_wardsynq/fhir.js — WardSynQ's record, as FHIR R4. Read only.
 *
 * "Interoperable" is a claim hospitals are lied to about constantly, so this file is narrow and
 * says what it is: a READ endpoint that renders the canonical record as FHIR R4 resources and a
 * CapabilityStatement that does not overstate what it can do. It is how a hospital gets its own
 * data OUT of WardSynQ - into a national exchange, a research extract, a successor system, or a
 * regulator's hands - which is the half of interoperability that matters most and is most often
 * missing.
 *
 * READ ONLY, DELIBERATELY. A FHIR WRITE endpoint is a far larger commitment: profile validation,
 * terminology binding, conformance to whatever the sender believes R4 means. Accepting writes
 * without that is how a record fills with resources nobody can interpret afterwards. WardSynQ's
 * own doors stay the write path; this one exports.
 *
 * THE ONE RULE THAT MATTERS: NEVER INVENT A CODE SYSTEM.
 *
 * The canonical model records `codeSystem` as "unspecified", "text" or "ghis-local" whenever nobody
 * gave it a real one - the problem list, the fluid chart and the GHIS lab feed all do this on
 * purpose. The tempting thing here is to emit `system: "http://loinc.org"` anyway so the output
 * looks properly coded. That would be a lie that SURVIVES EVERY EXPORT AND EVERY INTEGRATION
 * AFTERWARDS: a receiving system has no way to tell a real LOINC code from one this file made up,
 * and will treat both as authoritative. So an uncoded concept is emitted as CodeableConcept.text
 * with NO coding at all, which is exactly what FHIR provides for and exactly what is true.
 *
 * SHAPED IS NOT THE SAME AS CONFORMANT. The canonical model has been FHIR-shaped since P0, but
 * shaped is not conformant: this output is not profile-validated, not claimed to meet US Core or
 * any national profile, and the CapabilityStatement says so rather than implying a certification
 * nobody has done.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { parseSearch, applySearch, paginate, resolveIncludes, resolveRevIncludes, searchBundle, declaredSearch, chainTargets, includeTargets, subset, refsOf, PATIENT_REF, DEFAULT_COUNT, MAX_COUNT, dateClause, dateMatches } from "./fhir-search.js";
import { SYSTEMS, UNCODED, UNMAPPED, INVALID, IDENTIFIER_SYSTEMS, systemUri, isUri, coverage, validateCode, validateCodeParameters } from "./terminology.js";
import { validateResource, validationOutcome, VALIDATED_TYPES } from "./fhir-validate.js";
import { makeSafeFetch } from "../_connect/onboard/net.js";
import { fhirId, hashedId, isHashedId, RECORD_ID_SYSTEM, provenanceId, parseProvenanceId } from "./fhir-id.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* Hashed FHIR ids seen on the way out, so a read by one resolves without a scan when the same
 * isolate exported it. Bounded; a miss falls back to the governed reads in resolveId(). */
const ALIASES = new Map();
const ALIAS_CAP = 20000;
function remember(fid, canonicalId) {
  if (fid === canonicalId) return;
  if (ALIASES.size >= ALIAS_CAP) ALIASES.clear();
  ALIASES.set(fid, canonicalId);
}

/* The one registry of vocabularies lives in terminology.js. Kept under this name so nothing that
 * imported it breaks; it is the same table. */
const SYSTEM_URI = Object.freeze(Object.fromEntries(Object.entries(SYSTEMS).map(([k, v]) => [k, v.uri])));

/** PURE. The FHIR system URI for one of our codeSystem values, or null when we do not know one. */
function systemUriFor(codeSystem) {
  return systemUri(codeSystem);
}

/** Our extension namespace, for the one fact FHIR has no element for: that WE did not vouch for a
 *  coding the sender supplied. Ours to define, so not an invented vocabulary. */
const EXT_TERMINOLOGY_STATUS = "urn:stewardmd:fhir:extension:terminology-status";

/**
 * PURE. A CodeableConcept that never claims a vocabulary it does not have.
 *
 * With a known system: a proper coding, plus text. Without one: TEXT ONLY. A receiving system can
 * then tell the difference, which is the entire point.
 *
 * `source` is a coding preserved verbatim from another system at import. It goes out under the
 * sender's OWN system URI when that is a real URI - so the receiver sees exactly what the sender
 * said - and is marked with our extension so they can also see we did not verify it. A source
 * system that is not a URI cannot be a FHIR coding at all and stays in the text.
 */
function codeable(code, codeSystem, display, source, status) {
  const c = str(code), d = str(display) || c;
  if (!c && !d) return undefined;
  const system = systemUriFor(codeSystem);
  const out = {};
  const codings = [];
  if (system && c) codings.push({ system, code: c, ...(d && d !== c ? { display: d } : {}) });
  if (source && str(source.code)) {
    const su = systemUri(source.system) || (isUri(source.system) ? str(source.system) : null);
    if (su && !codings.some((x) => x.system === su && x.code === str(source.code))) {
      /* The status travels with the coding: `unmapped` (a system we do not know), or `invalid` (a
       * system we know whose server says this code does not exist in it). Either way the receiver
       * sees the sender's exact words and exactly what we did not vouch for. */
      codings.push(clean({
        system: su, code: str(source.code), display: str(source.display) || undefined,
        extension: [{ url: EXT_TERMINOLOGY_STATUS, valueCode: str(status) === INVALID ? INVALID : UNMAPPED }],
      }));
    }
  }
  if (codings.length) out.coding = codings;
  // `text` is always present. It is the only thing that is always true.
  out.text = d || c || (source && str(source.display)) || undefined;
  return out;
}

/** PURE. A FHIR Identifier for one of ours, with the identifier type a receiver matches on. */
function identifier(systemKey, value, extra) {
  const v = str(value);
  if (!v) return undefined;
  const known = IDENTIFIER_SYSTEMS[str(systemKey).toLowerCase()];
  if (known) {
    return clean({
      use: extra && extra.use,
      type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: known.typeCode }], text: known.typeText },
      system: known.uri, value: v,
    });
  }
  /* A system we do not know: emitted as a system ONLY when it is already a URI. The sender's own
   * declared type is kept when it is a v2-0203 code, because "this is their MRN" is a fact they
   * asserted and one a receiver filters on; otherwise the system name stands in as type text. */
  const declared = str(extra && extra.type);
  const type = /^[A-Z]{2,4}$/.test(declared)
    ? { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: declared }] }
    : (declared ? { text: declared } : (!isUri(systemKey) && str(systemKey) ? { text: str(systemKey) } : undefined));
  return clean({ system: isUri(systemKey) ? str(systemKey) : undefined, type, value: v });
}

/** The identifier namespace for a WardSynQ actor. fhir-identity.js serves Practitioner under it. */
const ACTOR_SYSTEM = "urn:stewardmd:actor";
const ref = (type, id) => (str(id) ? { reference: `${type}/${fhirId(id)}` } : undefined);
/* TASK 7.11. A clinician, as a LOGICAL reference rather than a bare string.
 *
 * Every author, requester, performer and signer on every exported resource used to be
 * `{ display: "cfa:9f2a..." }` - an opaque id sitting in a human-readable slot. A receiving system
 * could not tell whether that was a person, a machine or a typo, and could not match the same
 * author across two resources. Now it carries the identifier, which is exactly what makes that
 * match possible, and keeps the display, so nothing a human reader could see before is lost.
 *
 * WHY A LOGICAL REFERENCE AND NOT `Practitioner/{id}`. R4 ids are [A-Za-z0-9.-]{1,64}: an actor id
 * here is "cfa:<email>" or "fb:<uid>" and contains characters an id may not. Hashing it to fit
 * (fhirId) is ONE-WAY, and this server holds no practitioner table to reverse it with - so a
 * literal reference would point at a resource no isolate could resolve, which is a dangling
 * reference dressed up as a link. R4 has an element for precisely this case: Reference.identifier,
 * "a logical reference, when the literal reference is not known". A receiver matches on it; nothing
 * pretends to be followable that is not. The Practitioner READ endpoint (fhir-identity.js) serves
 * the same identity by the same actor id for a client that asks directly. */
const practitioner = (id) => {
  const raw = str(id);
  if (!raw) return undefined;
  return { identifier: { system: ACTOR_SYSTEM, value: raw }, display: raw };
};
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };

/** Our provenance namespace. It is OURS - a URN for a source system WardSynQ recorded - and so not an
 *  invented vocabulary: the thing it names is the fact that this record came from that system. */
const SOURCE_URN = (system) => `urn:stewardmd:source:${str(system).toLowerCase().replace(/[^a-z0-9.-]+/g, "-") || "unknown"}`;

/**
 * PURE. FHIR `meta` from what the record service already stamps on every version.
 *
 * versionId IS the record version, so an ETag round-trips to an `expectedVersion` on a later write
 * and a client's `If-Match` means the same thing to both sides. lastUpdated is when WardSynQ learned
 * the fact, which is what a `_lastUpdated` search is asking. `source` is the originating system,
 * and `wardsynq-native` is itself a source - a receiver must be able to tell what we authored from
 * what we imported.
 */
function withMeta(fhir, record) {
  if (!fhir || !record) return fhir;
  const m = record.meta || {};
  const by = record.writtenBy || {};
  const lastUpdated = str(m.recordedAt) || str(by.at) || undefined;
  const version = record.version;
  return {
    ...fhir,
    meta: clean({
      versionId: version === undefined || version === null ? undefined : String(version),
      lastUpdated,
      source: SOURCE_URN((m.source && m.source.system) || "wardsynq-native"),
    }),
  };
}

/* ---- resource mappers. PURE, one per canonical type. ------------------------------------------- */

function fhirPatient(p) {
  return clean({
    resourceType: "Patient", id: fhirId(p.id),
    identifier: (() => {
      const others = (p.identifiers || []).map((i) => (i && i.value ? identifier(i.system, i.value, { type: i.type }) : undefined)).filter(Boolean);
      const srcSystem = str(p.meta && p.meta.source && p.meta.source.system);
      const imported = srcSystem && srcSystem !== "wardsynq-native";
      /* A NATIVE record's mrn slot is this hospital's MRN and goes out under our system. An IMPORTED
       * record's mrn slot holds the SENDER'S number (the adapter fills it from their identifiers),
       * and exporting that as ours would claim an MRN this hospital never issued. It is skipped when
       * the same value already travels as the sender's identifier, else emitted under the sender's
       * own namespace. */
      let own;
      if (!imported) own = identifier("mrn", p.mrn, { use: "usual" });
      else if (!others.some((o) => o.value === str(p.mrn))) own = str(p.mrn) ? { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, system: `${SOURCE_URN(srcSystem)}:mrn`, value: str(p.mrn) } : undefined;
      return [own, ...others].filter(Boolean);
    })(),
    // A single unparsed name. FHIR wants given/family and we do not hold them separately, so the
    // whole name goes in `text` rather than being split on a space and guessed wrong for most of
    // the world's names.
    name: p.name ? [{ text: p.name }] : undefined,
    gender: ["male", "female", "other", "unknown"].includes(str(p.sex)) ? str(p.sex) : "unknown",
    birthDate: str(p.dob) || undefined,
    // An unmerged trauma identity must never leave here looking confirmed.
    active: p.provisional ? false : undefined,
  });
}

function fhirEncounter(e) {
  const STATUS = { "in-progress": "in-progress", finished: "finished", cancelled: "cancelled", planned: "planned" };
  return clean({
    resourceType: "Encounter", id: fhirId(e.id),
    status: STATUS[str(e.status)] || "unknown",
    // FHIR's Encounter.class is required (1..1) - leaving it undefined for a class this file has
    // not yet mapped exports a resource that fails R4 validation. ED maps to the standard v3-ActCode
    // EMER, the same terminology IMP/AMB already use; nothing invented. ICU, SURGERY and PACU all
    // map to IMP as well - v3-ActCode has no distinct class code for any of them; which UNIT an
    // inpatient is on (theatre, recovery, critical care) is carried by Encounter.location, not by
    // class, so IMP is the correct code here and not a simplification.
    class: (e.class === "IPD" || e.class === "ICU" || e.class === "SURGERY" || e.class === "PACU" || e.class === "MATERNITY" || e.class === "PEDIATRICS" || e.class === "NICU") ? { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" }
      : e.class === "OPD" ? { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" }
      : e.class === "ED" ? { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "EMER", display: "emergency" }
      : undefined,
    subject: ref("Patient", e.patientId),
    period: clean({ start: str(e.periodStart) || undefined, end: str(e.periodEnd) || undefined }),
    reasonCode: e.reason ? [{ text: e.reason }] : undefined,
    location: e.location && (e.location.ward || e.location.bed)
      ? [{ location: { display: [e.location.ward, e.location.bed ? `bed ${e.location.bed}` : null].filter(Boolean).join(", ") } }]
      : undefined,
  });
}

function fhirCondition(c) {
  const VERIF = { confirmed: "confirmed", provisional: "provisional", differential: "differential", refuted: "refuted" };
  const CLIN = { active: "active", resolved: "resolved", inactive: "inactive" };
  return clean({
    resourceType: "Condition", id: fhirId(c.id),
    clinicalStatus: CLIN[str(c.clinicalStatus)] ? { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: CLIN[str(c.clinicalStatus)] }] } : undefined,
    // Provisional stays provisional on the way out. A problem list that exported everything as
    // "confirmed" would turn every working diagnosis into a fact at the hospital boundary.
    verificationStatus: VERIF[str(c.verificationStatus)] ? { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: VERIF[str(c.verificationStatus)] }] } : undefined,
    code: codeable(c.code, c.codeSystem, c.display, c.sourceCoding, c.terminologyStatus),
    subject: ref("Patient", c.patientId),
    encounter: ref("Encounter", c.encounterId),
    onsetDateTime: str(c.onsetDate) || undefined,
    // When it was written down, which is what a client's `date=` on a Condition is usually asking.
    recordedDate: str(c.meta && c.meta.recordedAt) || undefined,
    note: c.note ? [{ text: c.note }] : undefined,
  });
}

function fhirAllergy(a) {
  return clean({
    resourceType: "AllergyIntolerance", id: fhirId(a.id),
    recordedDate: str(a.meta && a.meta.recordedAt) || undefined,
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: str(a.clinicalStatus) === "inactive" ? "inactive" : "active" }] },
    // "unable-to-assess" is a real FHIR value and is what our model already says when nobody knows.
    criticality: ["low", "high", "unable-to-assess"].includes(str(a.criticality)) ? str(a.criticality) : "unable-to-assess",
    code: codeable(a.substance, a.substanceCodeSystem, a.substance, a.sourceCoding, a.terminologyStatus),
    patient: ref("Patient", a.patientId),
    reaction: a.reaction || a.severity ? [clean({ manifestation: a.reaction ? [{ text: String(a.reaction) }] : [{ text: "not recorded" }], severity: ["mild", "moderate", "severe"].includes(str(a.severity)) ? str(a.severity) : undefined })] : undefined,
    note: a.reportedText ? [{ text: `Reported as: ${a.reportedText}` }] : undefined,
  });
}

function fhirObservation(o) {
  const CAT = { "vital-signs": "vital-signs", laboratory: "laboratory", imaging: "imaging" };
  const value = typeof o.value === "number"
    ? { valueQuantity: clean({ value: o.value, unit: str(o.unit) || undefined, system: o.unit ? "http://unitsofmeasure.org" : undefined, code: str(o.unit) || undefined }) }
    : (o.value == null || o.value === "" ? {} : { valueString: String(o.value) });
  return clean({
    resourceType: "Observation", id: fhirId(o.id),
    status: "final",
    category: CAT[str(o.category)] ? [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: CAT[str(o.category)] }] }] : undefined,
    code: codeable(o.code, o.codeSystem, o.display, o.sourceCoding, o.terminologyStatus),
    subject: ref("Patient", o.patientId),
    encounter: ref("Encounter", o.encounterId),
    effectiveDateTime: str((o.meta && o.meta.effectiveAt) || o.effectiveAt) || undefined,
    ...value,
  });
}

function fhirMedicationRequest(m) {
  const STATUS = { active: "active", draft: "draft", "on-hold": "on-hold", cancelled: "cancelled", completed: "completed" };
  return clean({
    resourceType: "MedicationRequest", id: fhirId(m.id),
    status: STATUS[str(m.status)] || "unknown",
    intent: "order",
    authoredOn: str(m.meta && m.meta.recordedAt) || undefined,
    medicationCodeableConcept: codeable(m.drugCode || m.drug, m.drugCodeSystem, m.drug, m.sourceCoding, m.terminologyStatus),
    subject: ref("Patient", m.patientId),
    encounter: ref("Encounter", m.encounterId),
    requester: practitioner(m.prescriberId),
    dosageInstruction: (m.dose || m.route || m.frequency) ? [clean({
      text: [m.dose ? `${m.dose.value} ${m.dose.unit}` : null, m.route, m.frequency].filter(Boolean).join(", ") || undefined,
      route: m.route ? { text: m.route } : undefined,
      // The dose as a real quantity, not only as prose, because a receiving system that can only
      // read the text cannot check it.
      doseAndRate: m.dose && typeof m.dose.value === "number"
        ? [{ doseQuantity: clean({ value: m.dose.value, unit: str(m.dose.unit) || undefined, system: m.dose.unit ? "http://unitsofmeasure.org" : undefined, code: str(m.dose.unit) || undefined }) }]
        : undefined,
    })] : undefined,
  });
}

function fhirMedicationAdministration(a) {
  // Our states are the eMAR's, and only ONE of them is an administration that happened. Everything
  // else is in-flight or stopped, and must not export as "completed".
  const STATUS = { administered: "completed", refused: "not-done", cancelled: "not-done", held: "on-hold" };
  return clean({
    resourceType: "MedicationAdministration", id: fhirId(a.id),
    status: STATUS[str(a.status)] || "in-progress",
    medicationCodeableConcept: codeable(a.drugCode || a.drug, a.drugCodeSystem, a.drug, a.sourceCoding, a.terminologyStatus),
    subject: ref("Patient", a.patientId),
    context: ref("Encounter", a.encounterId),
    effectiveDateTime: str(a.administeredAt) || undefined,
    performer: a.administeredBy ? [{ actor: practitioner(a.administeredBy) }] : undefined,
    request: ref("MedicationRequest", a.orderId),
  });
}

function fhirServiceRequest(s) {
  return clean({
    resourceType: "ServiceRequest", id: fhirId(s.id),
    status: ["active", "completed", "revoked", "draft"].includes(str(s.status)) ? str(s.status) : "unknown",
    intent: "order",
    authoredOn: str(s.meta && s.meta.recordedAt) || undefined,
    code: codeable(s.code, s.codeSystem, s.display, s.sourceCoding, s.terminologyStatus),
    subject: ref("Patient", s.patientId),
    encounter: ref("Encounter", s.encounterId),
    requester: practitioner(s.requesterId),
  });
}

function fhirDiagnosticReport(d) {
  return clean({
    resourceType: "DiagnosticReport", id: fhirId(d.id),
    status: ["preliminary", "final", "corrected", "cancelled"].includes(str(d.status)) ? str(d.status) : "unknown",
    code: codeable(d.code, d.codeSystem, d.code, d.sourceCoding, d.terminologyStatus),
    subject: ref("Patient", d.patientId),
    encounter: ref("Encounter", d.encounterId),
    // The request this answers, so a receiver can close its own loop.
    basedOn: d.serviceRequestId ? [ref("ServiceRequest", d.serviceRequestId)] : undefined,
    effectiveDateTime: str(d.reportedAt) || undefined,
    issued: str(d.meta && d.meta.recordedAt) || undefined,
    conclusion: d.conclusion || undefined,
    // Omitted, not empty, when a report has no observations: R4 forbids an empty element (ele-1).
    result: (d.resultObservationIds || []).length ? (d.resultObservationIds || []).map((id) => ref("Observation", id)).filter(Boolean) : undefined,
  });
}

/** TASK 3.7: the specimen a Patient/{id}/$everything bundle was missing. specimen.js's own rule is
 *  that no specimen type is invented - the type goes out as CodeableConcept.text only, never coded,
 *  the same restraint codeable() already applies to every uncoded concept in this file. */
function fhirSpecimen(s) {
  // R4's Specimen.status has no "unknown" - collected/received are both a specimen that exists
  // (available); failed is the closest defined meaning to "not usable" (unsatisfactory).
  const STATUS = { collected: "available", received: "available", failed: "unsatisfactory" };
  return clean({
    resourceType: "Specimen", id: fhirId(s.id),
    status: STATUS[str(s.state)] || "unavailable",
    type: s.specimenType ? { text: str(s.specimenType) } : undefined,
    subject: ref("Patient", s.patientId),
    request: s.serviceRequestId ? [ref("ServiceRequest", s.serviceRequestId)] : undefined,
    receivedTime: str(s.receivedAt) || undefined,
    collection: (s.collectedAt || s.collectedBy) ? clean({
      collectedDateTime: str(s.collectedAt) || undefined,
      collector: practitioner(s.collectedBy),
    }) : undefined,
    note: s.state === "failed" && s.failureReason ? [{ text: str(s.failureReason) }] : undefined,
  });
}

/** TASK 3.7: the pharmacy supply fact a Patient/{id}/$everything bundle was missing. Batch and
 *  expiry stay out of this export - R4 has no root-level element for them on MedicationDispense,
 *  and inventing an extension for two facts nothing downstream asked for is not this file's job;
 *  they remain readable through WardSynQ's own API, which is where pharmacy-dispense.js's header
 *  already says a recall or harm investigation goes first. */
function fhirMedicationDispense(d) {
  // "returned" has no exact R4 status: it is a completed dispense later reversed, not one stopped
  // mid-flight. "stopped" is the closest defined code and claims no more precision than that.
  const STATUS = { issued: "completed", returned: "stopped" };
  return clean({
    resourceType: "MedicationDispense", id: fhirId(d.id),
    status: STATUS[str(d.state)] || "unknown",
    medicationCodeableConcept: codeable(d.drugCode || d.drug, d.drugCodeSystem, d.drug, d.sourceCoding, d.terminologyStatus),
    subject: ref("Patient", d.patientId),
    context: ref("Encounter", d.encounterId),
    authorizingPrescription: d.orderId ? [ref("MedicationRequest", d.orderId)] : undefined,
    quantity: d.quantity && typeof d.quantity.value === "number" ? clean({ value: d.quantity.value, unit: str(d.quantity.unit) || undefined, system: d.quantity.unit ? "http://unitsofmeasure.org" : undefined, code: str(d.quantity.unit) || undefined }) : undefined,
    whenHandedOver: str(d.dispensedAt) || undefined,
    performer: d.dispensedBy ? [{ actor: practitioner(d.dispensedBy) }] : undefined,
  });
}

/** PURE. A note's sections as one plain-text document, headings in the order they were written. */
function noteText(n) {
  const s = n && n.sections;
  if (!s) return "";
  if (typeof s === "string") return s;
  if (typeof s === "object") {
    /* `type` is what an imported note's sections carry as metadata (the sender's document type),
     * not a heading a clinician wrote. Everything else is narrative and is rendered under its key. */
    return Object.keys(s).filter((k) => k !== "type").map((k) => { const v = s[k]; if (v == null || v === "") return ""; const body = typeof v === "object" ? (v.text || JSON.stringify(v)) : String(v); return k === "text" ? body : `${k}:\n${body}`; }).filter(Boolean).join("\n\n");
  }
  return String(s);
}
const escapeXhtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fhirDocumentReference(n) {
  // A clinical note is a DOCUMENT in FHIR, and the signature state travels with it: a draft that
  // exported as `current` would look like a finished, signed note to everyone downstream.
  const text = noteText(n);
  return clean({
    resourceType: "DocumentReference", id: fhirId(n.id),
    status: "current",
    docStatus: n.signedBy ? "final" : "preliminary",
    type: { text: str(n.noteType) || "note" },
    subject: ref("Patient", n.patientId),
    date: str(n.meta && n.meta.recordedAt) || undefined,
    author: n.authorId ? [practitioner(n.authorId)] : undefined,
    authenticator: practitioner(n.signedBy),
    context: n.encounterId ? { encounter: [ref("Encounter", n.encounterId)] } : undefined,
    /* THE WORDS TRAVEL. Until 2026-09-08 this carried a title and no content, so a note left here as
     * an empty document and a receiver's normaliser dropped it as having no narrative. The text goes
     * as the attachment (base64 text/plain) and as `description`, which is what a receiver that
     * ignores attachment bytes reads. */
    description: text || undefined,
    text: text ? { status: "generated", div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeXhtml(text).replace(/\n/g, "<br/>")}</div>` } : undefined,
    content: [{ attachment: clean({ contentType: "text/plain", data: text ? btoa(unescape(encodeURIComponent(text))) : undefined, title: str(n.noteType) || undefined }) }],
  });
}

/**
 * A recorded consent, as FHIR Consent. The decision maps to status AND to the provision, because a
 * receiver may read either: a refusal is `rejected` with a `deny` provision, never an `active`
 * consent whose fine print says no.
 */
function fhirConsent(c) {
  const STATUS = { granted: "active", refused: "rejected", withdrawn: "inactive" };
  const SCOPE = { treatment: "treatment", research: "research" };
  const scopeCode = SCOPE[str(c.scope)] || "patient-privacy";
  return clean({
    resourceType: "Consent", id: fhirId(c.id),
    status: STATUS[str(c.decision)] || "unknown",
    scope: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentscope", code: scopeCode }] },
    // Our scope vocabulary is ours; it goes out as text, never dressed as a standard category.
    category: [{ text: str(c.scope) || "other" }],
    patient: ref("Patient", c.patientId),
    dateTime: str(c.recordedAt) || str(c.meta && c.meta.recordedAt) || undefined,
    performer: c.giverName || c.givenBy ? [{ display: [str(c.giverName), str(c.givenBy)].filter(Boolean).join(" - ") }] : undefined,
    provision: clean({
      type: str(c.decision) === "granted" ? "permit" : "deny",
      period: c.validFrom || c.validUntil ? clean({ start: str(c.validFrom) || undefined, end: str(c.validUntil) || undefined }) : undefined,
    }),
    // Capacity is a recorded clinical judgement or an honest null; it never becomes an assertion.
    ...(c.capacity === true || c.capacity === false ? { extension: [{ url: "urn:stewardmd:fhir:extension:capacity-recorded", valueBoolean: c.capacity }] } : {}),
    ...(c.detail ? { sourceReference: undefined, note: undefined } : {}),
  });
}

/** Provenance participant type per actor kind. An AI or an adapter ASSEMBLED a record; a human or a
 *  device AUTHORED one. Nothing here can make an AI look like the clinician it acted for. */
const PARTICIPANT = Object.freeze({ human: "author", device: "author", ai: "assembler", adapter: "assembler", service: "assembler" });

/**
 * PURE. Provenance for ONE VERSION of a record, derived from what the store stamped: who wrote it,
 * as what kind of actor, when, on whose behalf, and from which source system. Never stored - it is
 * a view of the audit the record already carries, so it cannot disagree with it.
 */
function fhirProvenance(record) {
  const fhirType = record && FHIR_TYPE[record.resourceType];
  if (!fhirType || !record.id) return null;
  const by = record.writtenBy || {};
  const m = record.meta || {};
  const version = record.version === undefined || record.version === null ? null : Number(record.version);
  const src = m.source || {};
  const external = str(src.system) && str(src.system) !== "wardsynq-native";
  const fid = fhirId(record.id);
  remember(fid, str(record.id));
  remember(hashedId(record.id), str(record.id)); // a Provenance id may carry the hashed form even when the resource id did not need it
  return clean({
    resourceType: "Provenance",
    id: provenanceId(fhirType, record.id, version),
    target: [{ reference: version === null ? `${fhirType}/${fid}` : `${fhirType}/${fid}/_history/${version}` }],
    recorded: str(by.at) || str(m.recordedAt) || undefined,
    activity: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-DataOperation", code: version === 1 ? "CREATE" : "UPDATE" }] },
    agent: [clean({
      type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: PARTICIPANT[str(by.kind)] || "author" }] },
      /* TASK 7.11: a reference ONLY when the writer was a person. R4's Provenance.agent.who may be a
       * Practitioner, a Device, an Organization or a Patient, and an adapter, an AI or a service is
       * none of those - pointing at Practitioner/adapter:hl7v2-lab would assert that a piece of
       * software is a clinician. A non-human agent keeps the display it always had; the `type`
       * coding beside it already says what kind of thing wrote this. */
      who: str(by.kind) === "human" && str(by.id) ? practitioner(by.id) : { display: str(by.id) || "unknown" },
      /* The human an AI acted for is named as EXACTLY that - the party it acted on behalf of - and
       * never as the author. It IS a person, so it references one. */
      onBehalfOf: by.onBehalfOf ? practitioner(by.onBehalfOf) : undefined,
    })],
    /* TASK 7 STEP 4.3: entity[] is where R4 Provenance carries derivation - which is exactly what
     * "transformation" and "encounter" resolve to in a resource that has no dedicated fields for
     * either. entity.role="source" + entity.what naming the external system IS the transformation
     * fact (this record's content was derived FROM that source, via the CREATE/UPDATE `activity`
     * above) - R4 has no separate "transformation" element, and inventing an extension for one
     * would be exactly the fabrication the plan forbids. The encounter entry is new: which visit
     * this fact belongs to is real, load-bearing information every other exported resource type
     * already carries as its own `encounter` field - Provenance did not, until now. */
    /* TASK 7.12: THE AUTHORISATION THAT PERMITTED THIS WRITE. R4's Provenance.policy is exactly
     * "the policy or plan the activity was defined by", and for an imported record that is the
     * SourceSystemGrant an administrator issued - the thing that is later revoked, renewed, or found
     * to have been issued in error. Until now the row said which system sent it and who wrote it,
     * and nothing said under whose authority it was accepted, so "what came in under that grant"
     * was answerable only by inferring from a system name and a time window. Absent for a native
     * write, which had no grant, rather than filled in with something plausible. */
    policy: str(src.authorizedBy) ? [`urn:stewardmd:source-grant:${str(src.authorizedBy)}`] : undefined,
    entity: (() => {
      const rows = [];
      if (external) rows.push({ role: "source", what: clean({ identifier: clean({ system: SOURCE_URN(src.system), value: str(src.sourceId) || undefined }), display: `${str(src.system)}${str(src.sourceId) ? ":" + str(src.sourceId) : ""}` }) });
      if (record.encounterId) rows.push({ role: "source", what: ref("Encounter", record.encounterId) });
      return rows.length ? rows : undefined;
    })(),
  });
}

/* TASK 7 STEP 4.6. CarePlan already exists as a real canonical resource type (functions/_wardsynq/
 * care-plan.js), with real goal tracking and review-date staleness - only its FHIR export was
 * missing. Goals become CarePlan.activity entries (FHIR models a plan's goal as a Goal resource
 * proper, which this codebase does not have; activity.detail.description carries the goal's own
 * words rather than inventing a second resource type to hold one string). */
const CAREPLAN_ACTIVITY_STATUS = Object.freeze({ active: "in-progress", met: "completed", "not-met": "stopped", cancelled: "cancelled" });
const CAREPLAN_STATUS = Object.freeze({ active: "active", completed: "completed", cancelled: "revoked" });
function fhirCarePlan(p) {
  const goals = Array.isArray(p.goals) ? p.goals : [];
  return clean({
    resourceType: "CarePlan", id: fhirId(p.id),
    status: CAREPLAN_STATUS[str(p.state || p.status)] || "unknown",
    intent: "plan",
    title: str(p.title) || undefined,
    subject: ref("Patient", p.patientId),
    encounter: ref("Encounter", p.encounterId),
    author: practitioner(p.authorId),
    period: str(p.reviewBy) ? { end: str(p.reviewBy) } : undefined,
    activity: goals.length ? goals.map((g) => clean({
      detail: clean({
        status: CAREPLAN_ACTIVITY_STATUS[str(g.state)] || "unknown",
        description: [str(g.title), str(g.measure)].filter(Boolean).join(" - ") || undefined,
      }),
    })) : undefined,
  });
}

/* R4 ImagingStudy.status. WardSynQ carries the same three words, so this is a check rather than a
 * translation: a status this file does not recognise renders as "unknown", never as "available". */
const IMAGING_STATUS = Object.freeze({ available: "available", registered: "registered", cancelled: "cancelled", "entered-in-error": "entered-in-error" });

/**
 * TASK 7.7. An ImagingStudy, metadata only.
 *
 * NO ENDPOINT, NO INSTANCE, NO URL - and that is the point rather than an omission. R4's
 * ImagingStudy.endpoint and .series.instance exist to point a viewer at pixel data, and WardSynQ
 * holds none: the record says a scan exists, what it is, and the accession number that finds it in
 * the PACS. `basedOn` carries the order it answers, which is the fact a receiving system actually
 * needs to file it against the right request.
 */
function fhirImagingStudy(s) {
  const modality = str(s.modality);
  return clean({
    resourceType: "ImagingStudy", id: fhirId(s.id),
    status: IMAGING_STATUS[str(s.status)] || "unknown",
    // The StudyInstanceUID under its own DICOM URN system, which is how a PACS recognises it.
    identifier: [
      str(s.studyUid) ? { system: "urn:dicom:uid", value: `urn:oid:${str(s.studyUid)}` } : null,
      str(s.accessionNumber) ? { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "ACSN" }] }, value: str(s.accessionNumber) } : null,
    ].filter(Boolean),
    subject: ref("Patient", s.patientId),
    encounter: ref("Encounter", s.encounterId),
    basedOn: s.serviceRequestId ? [ref("ServiceRequest", s.serviceRequestId)] : undefined,
    started: str(s.started) || undefined,
    // The source's own modality string, under DICOM's own code system. Never re-coded to another.
    modality: modality ? [{ system: "http://dicom.nema.org/resources/ontology/DCM", code: modality }] : undefined,
    numberOfSeries: Number.isFinite(Number(s.seriesCount)) && s.seriesCount != null ? Number(s.seriesCount) : undefined,
    numberOfInstances: Number.isFinite(Number(s.instanceCount)) && s.instanceCount != null ? Number(s.instanceCount) : undefined,
    description: str(s.description) || undefined,
    /* bodySite is NOT exported. R4 carries it on ImagingStudy.series.bodySite - a series this record
     * does not model - and the study-level field that would take it, procedureCode, means the
     * PROCEDURE performed, not the part examined. Rendering DICOM's BodyPartExamined there would be
     * a receiving system reading a body part as a procedure code. It stays on the WardSynQ row,
     * where it is true, rather than being exported into a field that means something else. */
  });
}

/* NOT DONE, stated honestly rather than half-wired: RelatedPerson/FamilyLink export. FamilyLink
 * (functions/_wardsynq/migrate-maternity.js) relates TWO WardSynQ Patients (mother, newborn) -
 * which FHIR itself would model as Patient.link (R4's own "this record and that one refer to
 * related individuals" mechanism), not a standalone RelatedPerson (that resource is for someone
 * who is NOT themselves a patient here, e.g. an emergency contact - which has no canonical
 * WardSynQ resource today and is not invented by this file). Rendering Patient.link requires
 * reading a patient's FamilyLink rows at export time, and toFhir() is a PURE, SYNCHRONOUS
 * function with no store access - adding an async cross-reference read inside it would change
 * its contract for every caller, not just this one field. Left for a dedicated pass that also
 * decides where that read belongs (fhirPatient's caller, not this file, most likely).
 */

/** The canonical types this file can render, and the mapper for each. A type absent here is not
 *  exported at all rather than being emitted as something approximate. */
const MAPPERS = Object.freeze({
  PatientConsent: fhirConsent,
  Patient: fhirPatient,
  Encounter: fhirEncounter,
  Condition: fhirCondition,
  AllergyIntolerance: fhirAllergy,
  Observation: fhirObservation,
  MedicationOrder: fhirMedicationRequest,
  MedicationAdministration: fhirMedicationAdministration,
  ServiceRequest: fhirServiceRequest,
  DiagnosticReport: fhirDiagnosticReport,
  ClinicalNote: fhirDocumentReference,
  SpecimenCollection: fhirSpecimen,
  MedicationDispense: fhirMedicationDispense,
  CarePlan: fhirCarePlan,
  ImagingStudy: fhirImagingStudy,
});

/** Our type name to the FHIR one it renders as. */
const FHIR_TYPE = Object.freeze({
  Patient: "Patient", Encounter: "Encounter", Condition: "Condition",
  AllergyIntolerance: "AllergyIntolerance", Observation: "Observation",
  MedicationOrder: "MedicationRequest", MedicationAdministration: "MedicationAdministration",
  ServiceRequest: "ServiceRequest", DiagnosticReport: "DiagnosticReport", ClinicalNote: "DocumentReference",
  PatientConsent: "Consent", SpecimenCollection: "Specimen", MedicationDispense: "MedicationDispense",
  CarePlan: "CarePlan", ImagingStudy: "ImagingStudy",
});
/** And back, so a caller can ask for the FHIR name. */
const CANONICAL_TYPE = Object.freeze(Object.fromEntries(Object.entries(FHIR_TYPE).map(([k, v]) => [v, k])));

/** PURE. One canonical record to FHIR, with meta, or null when this file has no honest mapping. */
function toFhir(record) {
  const m = record && MAPPERS[record.resourceType];
  if (!m) return null;
  const f = withMeta(m(record), record);
  /* The canonical id always travels, as an Identifier under our own system: it is the record's real
   * key, and when the FHIR id had to be hashed to fit R4's 64 characters it is the only way a
   * receiver (or we, on a read) gets back to it. */
  const fid = fhirId(record.id);
  remember(fid, str(record.id));
  const own = { system: RECORD_ID_SYSTEM, value: str(record.id) };
  f.identifier = [...(f.identifier || []).filter((i) => !(i && i.system === RECORD_ID_SYSTEM)), own];
  return f;
}

/**
 * A FHIR id back to the canonical id it stands for, through the governed reads: verbatim when it
 * was never hashed, from the alias cache when this isolate exported it, else by scanning what the
 * actor may read (the patient's compartment when one is known, otherwise the latest SEARCH_POOL of
 * the type). ponytail: pool scan; a persisted alias index if a hospital's roster outgrows it.
 */
async function resolveId(svc, canonical, fid, hint) {
  const id = str(fid);
  if (!id || !isHashedId(id)) return id;
  if (ALIASES.has(id)) return ALIASES.get(id);
  const rows = [];
  try {
    if (hint && str(hint.patientId) && canonical !== "Patient") rows.push(...((await svc.byPatient(canonical, str(hint.patientId))) || []));
    if (!rows.length) rows.push(...((await svc.list(canonical, SEARCH_POOL)) || []));
  } catch { /* unreadable is unresolved */ }
  const hit = rows.find((r) => r && hashedId(r.id) === id);
  if (hit) { remember(id, str(hit.id)); return str(hit.id); }
  return id;
}

/** PURE. A searchset Bundle. */
function bundle(resources, opts) {
  const o = opts || {};
  return {
    resourceType: "Bundle",
    type: o.type || "searchset",
    total: resources.length,
    ...(o.timestamp ? { timestamp: o.timestamp } : {}),
    entry: resources.map((r) => ({ fullUrl: `${o.base || ""}/${r.resourceType}/${r.id}`, resource: r })),
  };
}

/**
 * PURE. What this server actually supports. It says READ and SEARCH only, and it says outright that
 * the output is not profile-validated - because a CapabilityStatement that overstates is how a
 * receiving system decides it can trust something it cannot.
 */
function capabilityStatement(opts) {
  const o = opts || {};
  return {
    resourceType: "CapabilityStatement",
    status: "active",
    date: o.date || null,
    kind: "instance",
    software: { name: "WardSynQ", version: o.version || "0" },
    fhirVersion: "4.0.1",
    format: ["application/fhir+json"],
    /* Said in the document itself, where a machine and a human both see it. WardSynQ's model has
     * been FHIR-SHAPED since P0, and shaped is not conformant. */
    implementation: {
      description: "WardSynQ clinical record, FHIR R4. Every resource this server emits validates against the R4 base "
        + "StructureDefinition of its type ($validate is offered so a partner can check that for themselves); no implementation "
        + "guide is carried, so conformance to US Core or a national profile is neither claimed nor checked unless the hospital "
        + "has loaded that profile's constraints. Concepts WardSynQ holds "
        + "without a coding are emitted as CodeableConcept.text with no coding, never as a guessed code. "
        + `Verified codes carried by this build: ${Object.entries(coverage()).map(([u, n]) => `${n} in ${u}`).join(", ") || "none"}. `
        + "A coding imported from another system that WardSynQ did not verify is emitted under the sender's "
        + `own system with extension ${EXT_TERMINOLOGY_STATUS} = unmapped. Provenance is derived from the `
        + "record's own audit stamp for every version and is never stored separately.",
    },
    rest: [{
      mode: "server",
      security: clean({
        description: "A staff session, or - where the hospital has enabled it - a SMART on FHIR bearer token issued by this server, scoped to one hospital and narrowed to READ. Same governed store and audit as every other WardSynQ door.",
        service: o.smart ? [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/restful-security-service", code: "SMART-on-FHIR" }] }] : undefined,
        extension: o.smart ? [{
          url: "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris",
          extension: [{ url: "authorize", valueUri: o.smart.authorize }, { url: "token", valueUri: o.smart.token }, ...(o.smart.revoke ? [{ url: "revoke", valueUri: o.smart.revoke }] : [])],
        }] : undefined,
      }),
      /* Derived from the SAME tables the search parser reads (fhir-search.js), so what is declared
       * here is what actually parses. A CapabilityStatement maintained by hand drifts the first time
       * either side changes, and a client trusts the declaration. */
      /* Writes are declared ONLY on the door and the hospital that has them: the clinician's door
       * with wardsynq.fhir.inbound enabled. The external SMART door is read-only and says so. */
      interaction: o.inbound ? [{ code: "transaction", documentation: "all or nothing: one refusal refuses the whole Bundle and nothing is written" }, { code: "batch" }] : undefined,
      resource: [
        ...Object.values(FHIR_TYPE).map((t) => {
          const d = declaredSearch(t);
          const writes = o.inbound && INBOUND_FHIR_TYPES.includes(t);
          return clean({
            type: t,
            versioning: "versioned",
            readHistory: true,
            // READ, VREAD, HISTORY and SEARCH always. CREATE and UPDATE only where the inbound door is open; never delete.
            interaction: [{ code: "read" }, { code: "vread" }, { code: "history-instance" }, { code: "search-type" }, ...(writes ? [{ code: "create" }, { code: "update", documentation: "If-Match is required" }] : [])],
            updateCreate: writes ? false : undefined,
            conditionalCreate: writes ? true : undefined,
            conditionalUpdate: writes ? false : undefined,
            conditionalDelete: writes ? "not-supported" : undefined,
            searchParam: d.params,
            searchInclude: d.includes.length ? d.includes : undefined,
            searchRevInclude: d.revIncludes.length ? d.revIncludes : undefined,
          });
        }),
        /* Provenance is DERIVED, one per version of every resource above, from the audit stamp the
         * store puts on each write. It is read and searched by target; it has no history of its own
         * because it IS the history. */
        clean({
          type: "Provenance",
          interaction: [{ code: "read" }, { code: "search-type" }],
          searchParam: declaredSearch("Provenance").params,
          documentation: "Derived from every version's writtenBy and meta.source. target is required on search.",
        }),
        /* TASK 7.11. Practitioner and Organization are DERIVED too, and read-only by nature: this
         * server holds no staff directory, so there is nothing to search and nothing to write. A
         * Practitioner is served for an actor id that appears on the record - the identifier always,
         * a name and a council registration number only when a verified registration exists.
         * Declared here rather than in FHIR_TYPE because neither is a stored canonical type. */
        clean({
          type: "Practitioner",
          interaction: [{ code: "read" }],
          documentation: "Derived, read-only. Identifier always; a name and a medical council registration number ONLY where a verified registration exists - never a name inferred from an account. No search: this server holds no practitioner directory.",
        }),
        clean({
          type: "Organization",
          interaction: [{ code: "read" }],
          documentation: "Derived, read-only, and only this hospital: the organisation this door belongs to. No search: this server is not a directory of organisations.",
        }),
      ],
      operation: [
        { name: "everything", definition: "http://hl7.org/fhir/OperationDefinition/Patient-everything", documentation: "Patient/{id}/$everything: _since, _type, _count, _page, _summary, _elements, _total" },
        { name: "validate", definition: "http://hl7.org/fhir/OperationDefinition/Resource-validate", documentation: `POST {Type}/$validate or $validate (a Bundle validates every entry) with the resource as the body, or GET {Type}/{id}/$validate for a stored resource. R4 base structure, cardinality, primitives, choice types, required bindings and invariants for ${VALIDATED_TYPES.join(", ")}; codings are checked with the terminology service; profiles named in meta.profile are evaluated only when the hospital has loaded them (wardsynq.fhir.profiles), and said so otherwise.` },
        { name: "validate-code", definition: "http://hl7.org/fhir/OperationDefinition/CodeSystem-validate-code", documentation: "GET CodeSystem/$validate-code?url=<system>&code=<code>[&display=]. Answers verified (seed tables, the hospital's code lists, or its terminology server), invalid (the server says no), recognised (a real system, not verified) or unmapped (a system this server does not know). Nothing is guessed." },
      ],
    }],
  };
}

/* ---- operations: $validate and $validate-code ---------------------------------------------- */

/** The terminology service's dependencies for one request. `fetchImpl` may be injected by a test. */
function txDeps(env, ctx) {
  return { config: (ctx && ctx.terminology) || null, kv: env && env.WSQ_TX_KV, fetchImpl: (ctx && ctx.fetchImpl) || (typeof fetch === "function" ? makeSafeFetch(fetch) : null) };
}

/**
 * Validates one resource fully: structure and profiles (pure), then every coding with a system
 * through the terminology service. An `invalid` code is an error; a code merely not verified is an
 * information issue, because "this server cannot vouch for it" is not "it is wrong".
 */
async function validateFully(resource, env, ctx) {
  const v = validateResource(resource, { profiles: (ctx && ctx.profiles) || null });
  const deps = txDeps(env, ctx);
  const seen = new Map();
  for (const c of v.codings) {
    const key = `${c.system}|${c.code}`;
    if (!seen.has(key)) seen.set(key, await validateCode(c, deps));
    const t = seen.get(key);
    if (t.status === INVALID) v.issues.push({ severity: "error", code: "code-invalid", diagnostics: `${c.system}|${c.code}: ${t.note || "not a code in this system"}`, expression: [c.path] });
    else if (t.status === "recognised") v.issues.push({ severity: "information", code: "informational", diagnostics: `${c.system}|${c.code}: ${t.note || "not verified by this server"}`, expression: [c.path] });
    else if (t.status === UNMAPPED) v.issues.push({ severity: "information", code: "informational", diagnostics: `${c.system}: ${t.note || "not a vocabulary this server knows"}`, expression: [c.path] });
    else if (t.display && c.display && t.display.toLowerCase() !== c.display.toLowerCase()) v.issues.push({ severity: "warning", code: "informational", diagnostics: `${c.system}|${c.code}: display "${c.display}" differs from the verified display "${t.display}"`, expression: [`${c.path}.display`] });
  }
  v.valid = !v.issues.some((i) => i.severity === "error" || i.severity === "fatal");
  return v;
}

/**
 * $validate. ctx: { migration, body?, type?, id?, profiles?, terminology?, fetchImpl?, actorDeps, recordDeps }
 * With a body: validates it (the URL type, when given, must match). With an id: validates the stored
 * resource's export, through the governed read. 200 when valid, 422 with the issues when not.
 */
async function validateOperation(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  let resource = ctx.body;
  if (resource && resource.resourceType === "Parameters" && Array.isArray(resource.parameter)) {
    const p = resource.parameter.find((x) => x && x.name === "resource" && x.resource);
    resource = p ? p.resource : null;
  }
  if (str(ctx.id)) {
    const r = await readResource(request, env, { ...ctx, searchParams: "" });
    if (!r.ok) return r;
    resource = r.resource;
  }
  if (!resource || typeof resource !== "object") return { ok: false, status: 400, outcome: operationOutcome("error", "required", "send the resource as the body, or as Parameters.parameter[name=resource].resource") };
  if (str(ctx.type) && str(resource.resourceType) !== str(ctx.type)) return { ok: false, status: 400, outcome: operationOutcome("error", "invalid", `body is ${resource.resourceType}, URL says ${ctx.type}`) };
  const v = await validateFully(resource, env, ctx);
  return { ok: true, status: v.valid ? 200 : 422, valid: v.valid, outcome: validationOutcome(v) };
}

/** CodeSystem/$validate-code. ctx: { migration, searchParams, terminology?, fetchImpl? } */
async function validateCodeOperation(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  const params = ctx.searchParams instanceof URLSearchParams ? ctx.searchParams : new URLSearchParams(ctx.searchParams || "");
  let system = str(params.get("url") || params.get("system")), code = str(params.get("code")), display = str(params.get("display"));
  const coding = params.get("coding");
  if (!code && coding) { try { const c = JSON.parse(coding); system = str(c.system); code = str(c.code); display = str(c.display); } catch { /* named below */ } }
  if (!system || !code) return { ok: false, status: 400, outcome: operationOutcome("error", "required", "url (the code system) and code are required") };
  const v = await validateCode({ system, code, display }, txDeps(env, ctx));
  return { ok: true, status: 200, parameters: validateCodeParameters(v), validation: v };
}

/**
 * A read service FENCED to one patient's compartment, for a SMART token with patient/ scopes. The
 * fence is on the READ LAYER, not on a search parameter: a get of a resource that belongs to another
 * patient, a history of one, a compartment read for another patient id, or a roster read of a fenced
 * type is refused as a permission error before a row is seen. `types` is "*" (every type) or the
 * list of canonical types the token holds only by patient/ scope.
 */
function fenced(svc, patientId, types) {
  const pid = str(patientId);
  const isFenced = (t) => types === "*" || (Array.isArray(types) && types.includes(t));
  const belongs = (t, rec) => !rec || (t === "Patient" ? str(rec.id) === pid : str(rec.patientId) === pid);
  const refuse = () => { throw new PermissionError("outside the token's patient context"); };
  return {
    get: async (t, id) => { const r = await svc.get(t, id); if (isFenced(t) && !belongs(t, r)) refuse(); return r; },
    history: async (t, id) => { const rows = await svc.history(t, id); const last = rows && rows[rows.length - 1]; if (isFenced(t) && !belongs(t, last)) refuse(); return rows; },
    byPatient: async (t, p) => { if (isFenced(t) && str(p) !== pid) refuse(); return svc.byPatient(t, p); },
    list: async (t, n) => { if (isFenced(t)) refuse(); return svc.list(t, n); },
  };
}

async function open(request, env, ctx) {
  try {
    /* A SMART bearer arrives already resolved (smart-server.js): a READ-tier actor narrowed to its
     * granted types, with an empty write scope. It is used AS IS - never re-derived from an org role
     * it does not hold - and everything below it (the governed store, the audit) treats it exactly
     * as it treats a clinician's session. A bearer with a patient context is fenced to it. */
    const resolved = ctx.actorOverride || await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
    const base = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    const svc = resolved.patientId && resolved.compartmentTypes !== null && resolved.compartmentTypes !== undefined ? fenced(base, resolved.patientId, resolved.compartmentTypes) : base;
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/** FHIR's own error shape. A FHIR client parses OperationOutcome; it does not parse ours. */
function operationOutcome(severity, code, detail) {
  return { resourceType: "OperationOutcome", issue: [{ severity, code, diagnostics: detail }] };
}

/** PURE. The parameters Patient/$everything takes: _since, _type, _count, _page, _summary, _elements, _total. Anything else is named. */
function parseEverything(searchParams) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || "");
  const q = { type: "$everything", since: null, types: [], count: DEFAULT_COUNT, page: 0, summary: null, elements: null, total: "accurate", include: [], revInclude: [], filters: [], chain: [], has: [], lastUpdated: [] };
  const problems = [];
  for (const [key, raw] of params.entries()) {
    const val = str(raw);
    if (key === "_since") { const c = dateClause(/^(eq|ne|gt|lt|ge|le|sa|eb|ap)/.test(val) ? val : `ge${val}`); if (!c) problems.push({ param: key, reason: "not a date" }); else q.since = c; continue; }
    if (key === "_type") { q.types = val.split(",").map(str).filter(Boolean); continue; }
    if (key === "_count") { const n = Number(val); if (val === "" || !Number.isFinite(n) || n < 0) problems.push({ param: key, reason: "must be a non-negative integer" }); else if (n === 0) q.summary = "count"; else q.count = Math.min(MAX_COUNT, Math.floor(n)); continue; }
    if (key === "_page") { const n = Number(val); q.page = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; continue; }
    if (key === "_summary") { if (!["true", "text", "data", "count", "false"].includes(val)) problems.push({ param: key, reason: "must be true, text, data, count or false" }); else q.summary = val === "false" ? null : val; continue; }
    if (key === "_elements") { q.elements = (q.elements || []).concat(val.split(",").map(str).filter(Boolean)); continue; }
    if (key === "_total") { if (!["none", "estimate", "accurate"].includes(val)) problems.push({ param: key, reason: "must be none, estimate or accurate" }); else q.total = val; continue; }
    if (key === "_format" || key === "patient" || key === "patientId") continue;
    problems.push({ param: key, reason: "not a parameter of $everything this server supports (start/end are not: use _since)" });
  }
  return { query: q, problems };
}

/**
 * Everything this server holds for one patient, as a paged searchset Bundle - the Patient first,
 * then everything else newest first. `_since` keeps only what changed at or after that instant
 * (by meta.lastUpdated, which is when WardSynQ learned it); `_type` narrows the types.
 * ctx: { migration, patientId, searchParams?, types?, base, actorDeps, recordDeps }
 */
async function patientEverything(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };

  const requestedId = str(ctx.patientId);
  if (!requestedId) return { ok: false, status: 400, outcome: operationOutcome("error", "required", "patient is required") };

  const { query, problems } = parseEverything(ctx.searchParams);
  if (problems.length && !ctx.lenient) {
    return { ok: false, status: 400, outcome: { resourceType: "OperationOutcome", issue: problems.map((p) => ({ severity: "error", code: "not-supported", diagnostics: `${p.param}: ${p.reason}`, expression: [p.param] })) } };
  }
  const typeNames = query.types.length ? query.types : (Array.isArray(ctx.types) ? ctx.types : []);
  const unknown = typeNames.filter((t) => !CANONICAL_TYPE[t] && !MAPPERS[t]);
  if (unknown.length) return { ok: false, status: 400, outcome: operationOutcome("error", "not-supported", `_type: WardSynQ does not export ${unknown.join(", ")}`) };

  const { svc, resolved, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };
  const patientId = await resolveId(svc, "Patient", requestedId);
  /* A token launched for one patient may ask for EVERYTHING about that patient only. Another
   * patient's everything is outside the context as a whole, and is refused as a whole. */
  if (resolved && resolved.patientId && resolved.compartmentTypes !== null && resolved.compartmentTypes !== undefined && patientId !== str(resolved.patientId)) {
    return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", "outside the token's patient context") };
  }

  const wanted = typeNames.length ? typeNames.map((t) => CANONICAL_TYPE[t] || t).filter((t) => MAPPERS[t]) : Object.keys(MAPPERS);

  /* The patient must exist (and be readable) for there to be an "everything": a compartment for a
   * patient this hospital never registered is a 404, not an empty bundle a client would file as
   * "no record". */
  let patient = null;
  try { const p = await svc.get("Patient", patientId); patient = p ? toFhir(p) : null; }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }
  if (!patient) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such patient") };

  const rest = [];
  for (const type of wanted) {
    if (type === "Patient") continue;
    try {
      const rows = await svc.byPatient(type, patientId);
      for (const r of rows || []) { const f = toFhir(r); if (f) rest.push(f); }
    } catch {
      /* A type this actor may not read is simply absent from the bundle. It is NOT reported as an
       * empty result set, because "no allergies" and "you may not see the allergies" are different
       * facts and a bundle cannot express the second one. The reader is told which types are in it
       * via the bundle's own contents. */
    }
  }

  const since = (r) => !query.since || dateMatches(r.meta && r.meta.lastUpdated, query.since);
  rest.sort((a, b) => { const ka = str(a.meta && a.meta.lastUpdated), kb = str(b.meta && b.meta.lastUpdated); return ka === kb ? str(a.id).localeCompare(str(b.id)) : kb.localeCompare(ka); });
  const all = [...(wanted.includes("Patient") && since(patient) ? [patient] : []), ...rest.filter(since)];
  const page = paginate(all, query);
  const b = searchBundle({ base: str(ctx.base), type: "Patient", path: `Patient/${fhirId(patientId)}/$everything`, q: query, page, included: [], outcomes: problems.length ? [{ resourceType: "OperationOutcome", issue: problems.map((p) => ({ severity: "warning", code: "not-supported", diagnostics: `${p.param} was ignored: ${p.reason}` })) }] : [], rawQuery: ctx.rawQuery });
  b.timestamp = new Date().toISOString();
  return { ok: true, status: 200, bundle: b };
}

/** One resource by type and id. */
async function readResource(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };

  const fhirType = str(ctx.type);
  const canonical = CANONICAL_TYPE[fhirType];
  if (!canonical) return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", `WardSynQ does not export ${fhirType || "that type"}`) };

  const { svc, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };

  let record;
  try { record = await svc.get(canonical, await resolveId(svc, canonical, ctx.id)); }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }
  if (!record) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such resource") };

  const f = toFhir(record);
  if (!f) return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "no mapping for that resource") };
  /* _summary and _elements apply to a read too. Parsed by the search grammar, so the same values
   * mean the same thing on both; anything else on a read URL is not a search and is ignored. */
  const { query } = parseSearch(fhirType, ctx.searchParams || "");
  return { ok: true, status: 200, resource: subset(f, { summary: query.summary === "count" ? null : query.summary, elements: query.elements }) };
}

/** How many of a type one search may consider. Stated in the bundle when it bites. */
const SEARCH_POOL = 1000;

/** The FHIR types the inbound door accepts. Kept here (not imported from fhir-inbound.js, which imports this file). */
const INBOUND_FHIR_TYPES = Object.freeze(["Patient", "Encounter", "Condition", "Observation", "MedicationRequest", "AllergyIntolerance", "DiagnosticReport", "DocumentReference", "MedicationAdministration", "ServiceRequest", "Consent"]);

/** PURE. The patient id a FHIR resource belongs to: itself for a Patient, else its compartment reference. */
function compartmentOf(r) {
  if (!r) return "";
  if (r.resourceType === "Patient") return str(r.id);
  const get = PATIENT_REF[r.resourceType];
  const ref = get && refsOf(get(r)).find((x) => x.type === "Patient");
  return ref ? ref.id : "";
}

/**
 * Search one type. `patient=` reads the compartment (scoped and audited by the store); without it,
 * a roster of the latest SEARCH_POOL records, which is the one cross-patient read the record
 * service already permits and audits as a list.
 *
 * ctx: { migration, type, searchParams, rawQuery, base, lenient?, actorDeps, recordDeps }
 */
async function searchType(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };

  const fhirType = str(ctx.type);
  const canonical = CANONICAL_TYPE[fhirType];
  if (!canonical) return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", `WardSynQ does not export ${fhirType || "that type"}`) };

  const { query, problems } = parseSearch(fhirType, ctx.searchParams);
  /* STRICT BY DEFAULT. A dropped parameter means a client asked for the final results and got all
   * of them, believing they were final. Lenient handling is opt-in and every dropped parameter is
   * still reported inside the bundle. */
  if (problems.length && !ctx.lenient) {
    return { ok: false, status: 400, outcome: { resourceType: "OperationOutcome", issue: problems.map((p) => ({ severity: "error", code: "not-supported", diagnostics: `${p.param}: ${p.reason}`, expression: [p.param] })) } };
  }

  const { svc, resolved, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };
  // A token launched for one patient reads that patient unless it says otherwise: SMART's patient context.
  if (!query.patient && resolved && resolved.patientId) query.patient = resolved.patientId;

  let rows;
  try {
    const pid = query.patient ? await resolveId(svc, "Patient", query.patient) : "";
    if (canonical === "Patient") {
      rows = pid ? [await svc.get("Patient", pid)].filter(Boolean) : await svc.list("Patient", SEARCH_POOL);
    } else {
      rows = pid ? await svc.byPatient(canonical, pid) : await svc.list(canonical, SEARCH_POOL);
    }
  } catch (e) {
    return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) };
  }
  const pooled = (rows || []).length;
  const resources = (rows || []).map(toFhir).filter(Boolean);

  /* EVERY reference this search follows - a chain, an include, a _has, a reverse include - is
   * resolved through the same governed reads as a direct GET, then handed to the pure matcher as a
   * lookup. An actor who may not see an Encounter does not receive one because a report pointed at
   * it, and a Patient they may not read is a Patient a chain does not match. */
  const cache = new Map();
  const lookup = (t, id) => { const k = `${t}/${id}`; return cache.has(k) ? cache.get(k) : null; };
  const fetchAll = async (keys) => {
    for (const k of keys) {
      if (cache.has(k)) continue;
      const [t, id] = k.split("/");
      const c = CANONICAL_TYPE[t];
      if (!c) { cache.set(k, null); continue; }
      try { const rec = await svc.get(c, await resolveId(svc, c, id)); cache.set(k, rec ? toFhir(rec) : null); } catch { cache.set(k, null); }
    }
  };
  /* `has(type, resource)`: the resources of `type` in that resource's patient compartment, read by
   * patient (scoped and audited by the store). Filled before matching for the types a query needs. */
  const compartments = new Map();
  const has = (t, r) => { const pid = compartmentOf(r); return (pid && compartments.get(`${t}|${pid}`)) || []; };
  const fillCompartments = async (types, list) => {
    for (const t of types) {
      const c = CANONICAL_TYPE[t];
      if (!c) continue;
      for (const r of list) {
        const pid = compartmentOf(r);
        if (!pid) continue;
        const k = `${t}|${pid}`;
        if (compartments.has(k)) continue;
        try { compartments.set(k, ((await svc.byPatient(c, await resolveId(svc, "Patient", pid))) || []).map(toFhir).filter(Boolean)); } catch { compartments.set(k, []); }
      }
    }
  };

  await fetchAll(chainTargets(resources, query));
  await fillCompartments(query.has.map((h) => h.type), resources);
  const matched = applySearch(resources, query, { lookup, has });
  const page = paginate(matched, query);

  await fetchAll(includeTargets(page.entries, query));
  const included = resolveIncludes(page.entries, query, lookup);
  await fillCompartments(query.revInclude.filter((rv) => rv.ref).map((rv) => rv.type), page.entries);
  included.push(...resolveRevIncludes(page.entries, query, has));

  /* _revinclude=Provenance:target: the provenance of each matched resource's CURRENT version,
   * derived from the canonical rows already in hand - no second read, no second opinion. */
  if (query.revInclude.some((rv) => rv.key === "Provenance:target")) {
    const byId = new Map((rows || []).filter(Boolean).map((r) => [fhirId(r.id), r]));
    for (const r of page.entries) {
      const p = fhirProvenance(byId.get(str(r.id)));
      if (p) included.push(p);
    }
  }

  const outcomes = [];
  if (problems.length) outcomes.push({ resourceType: "OperationOutcome", issue: problems.map((p) => ({ severity: "warning", code: "not-supported", diagnostics: `${p.param} was ignored: ${p.reason}` })) });
  /* A search over a roster that hit the pool cap is a search over PART of the record, and a client
   * that read `total` as the hospital's total would be wrong. Said in the bundle, in FHIR's own way. */
  if (!query.patient && pooled >= SEARCH_POOL) {
    outcomes.push(operationOutcome("warning", "too-costly", `This search considered the most recent ${SEARCH_POOL} ${fhirType} records only. Narrow it with patient= or _lastUpdated=.`));
  }

  return { ok: true, status: 200, bundle: searchBundle({ base: str(ctx.base), type: fhirType, q: query, page, included, outcomes, rawQuery: ctx.rawQuery }) };
}

/** Every version of one resource, as a history Bundle. ctx: { migration, type, id, base } */
async function historyOf(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  const fhirType = str(ctx.type), canonical = CANONICAL_TYPE[fhirType];
  if (!canonical) return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", `WardSynQ does not export ${fhirType || "that type"}`) };

  const { svc, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };

  let versions;
  try { versions = await svc.history(canonical, await resolveId(svc, canonical, ctx.id)); }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }
  if (!versions || !versions.length) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such resource") };

  const base = str(ctx.base);
  // Newest first, as FHIR history is read.
  const entries = versions.map(toFhir).filter(Boolean).reverse().map((r) => ({
    fullUrl: `${base}/${r.resourceType}/${r.id}`,
    resource: r,
    // Every version here is a real write. This store has no updates in place and no deletes.
    request: { method: r.meta && r.meta.versionId === "1" ? "POST" : "PUT", url: `${r.resourceType}/${r.id}` },
    response: { status: "200", etag: r.meta && r.meta.versionId ? `W/"${r.meta.versionId}"` : undefined, lastModified: r.meta && r.meta.lastUpdated },
  }));
  return { ok: true, status: 200, bundle: { resourceType: "Bundle", type: "history", total: entries.length, link: [{ relation: "self", url: `${base}/${fhirType}/${str(ctx.id)}/_history` }], entry: entries } };
}

/** One specific version. ctx: { migration, type, id, versionId } */
async function vread(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  const fhirType = str(ctx.type), canonical = CANONICAL_TYPE[fhirType];
  if (!canonical) return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", `WardSynQ does not export ${fhirType || "that type"}`) };
  const want = str(ctx.versionId);
  if (!/^\d+$/.test(want)) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "version ids here are integers") };

  const { svc, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };

  let versions;
  try { versions = await svc.history(canonical, await resolveId(svc, canonical, ctx.id)); }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }
  const hit = (versions || []).find((v) => String(v.version) === want);
  if (!hit) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such version") };
  return { ok: true, status: 200, resource: toFhir(hit) };
}

/** One Provenance by id. ctx: { migration, id } */
async function provenanceRead(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  const p = parseProvenanceId(ctx.id);
  const canonicalType = p && CANONICAL_TYPE[p.fhirType];
  if (!p || !canonicalType) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such Provenance") };
  const { svc, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };
  let versions;
  try { versions = await svc.history(canonicalType, await resolveId(svc, canonicalType, p.fhirId)); }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }
  const hit = (versions || []).find((v) => Number(v.version) === p.version);
  if (!hit) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such Provenance") };
  return { ok: true, status: 200, resource: fhirProvenance(hit) };
}

/**
 * Provenance by target - every version of one resource. `target` is REQUIRED: a hospital-wide
 * provenance dump is a different act from asking who wrote this, and it is not offered here.
 * ctx: { migration, searchParams, base }
 */
async function provenanceSearch(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  const { query, problems } = parseSearch("Provenance", ctx.searchParams);
  if (problems.length) return { ok: false, status: 400, outcome: { resourceType: "OperationOutcome", issue: problems.map((p) => ({ severity: "error", code: "not-supported", diagnostics: `${p.param}: ${p.reason}` })) } };
  if (!query.target) return { ok: false, status: 400, outcome: operationOutcome("error", "required", "Provenance search needs target=Type/id") };
  const canonical = CANONICAL_TYPE[query.target.type];
  if (!canonical) return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", `WardSynQ does not export ${query.target.type}`) };

  const { svc, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };
  let versions;
  try { versions = await svc.history(canonical, await resolveId(svc, canonical, query.target.id)); }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }

  const all = (versions || []).map(fhirProvenance).filter(Boolean).reverse();
  const page = paginate(all, query);
  return { ok: true, status: 200, bundle: searchBundle({ base: str(ctx.base), type: "Provenance", q: query, page, included: [], outcomes: [], rawQuery: ctx.rawQuery }) };
}

export {
  SYSTEM_URI, UNCODED, MAPPERS, FHIR_TYPE, CANONICAL_TYPE, SEARCH_POOL, INBOUND_FHIR_TYPES, SOURCE_URN, EXT_TERMINOLOGY_STATUS, PARTICIPANT,
  systemUriFor, codeable, identifier, withMeta, toFhir, bundle, capabilityStatement, operationOutcome,
  fhirPatient, fhirEncounter, fhirCondition, fhirAllergy, fhirObservation,
  fhirMedicationRequest, fhirMedicationAdministration, fhirServiceRequest,
  fhirDiagnosticReport, fhirDocumentReference, fhirConsent, fhirProvenance, fhirImagingStudy, parseProvenanceId, compartmentOf, parseEverything, resolveId, fenced,
  patientEverything, readResource, searchType, historyOf, vread, provenanceRead, provenanceSearch,
  validateFully, validateOperation, validateCodeOperation,
};
