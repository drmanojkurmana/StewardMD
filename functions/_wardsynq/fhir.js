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
import { parseSearch, applySearch, paginate, resolveIncludes, searchBundle, declaredSearch, INCLUDES } from "./fhir-search.js";
import { SYSTEMS, UNCODED, UNMAPPED, IDENTIFIER_SYSTEMS, systemUri, isUri, coverage } from "./terminology.js";

const str = (v) => (v == null ? "" : String(v).trim());

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
function codeable(code, codeSystem, display, source) {
  const c = str(code), d = str(display) || c;
  if (!c && !d) return undefined;
  const system = systemUriFor(codeSystem);
  const out = {};
  const codings = [];
  if (system && c) codings.push({ system, code: c, ...(d && d !== c ? { display: d } : {}) });
  if (source && str(source.code)) {
    const su = systemUri(source.system) || (isUri(source.system) ? str(source.system) : null);
    if (su && !codings.some((x) => x.system === su && x.code === str(source.code))) {
      codings.push(clean({
        system: su, code: str(source.code), display: str(source.display) || undefined,
        extension: [{ url: EXT_TERMINOLOGY_STATUS, valueCode: UNMAPPED }],
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

const ref = (type, id) => (str(id) ? { reference: `${type}/${id}` } : undefined);
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
    resourceType: "Patient", id: p.id,
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
    resourceType: "Encounter", id: e.id,
    status: STATUS[str(e.status)] || "unknown",
    class: e.class === "IPD" ? { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" }
      : e.class === "OPD" ? { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" }
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
    resourceType: "Condition", id: c.id,
    clinicalStatus: CLIN[str(c.clinicalStatus)] ? { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: CLIN[str(c.clinicalStatus)] }] } : undefined,
    // Provisional stays provisional on the way out. A problem list that exported everything as
    // "confirmed" would turn every working diagnosis into a fact at the hospital boundary.
    verificationStatus: VERIF[str(c.verificationStatus)] ? { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: VERIF[str(c.verificationStatus)] }] } : undefined,
    code: codeable(c.code, c.codeSystem, c.display, c.sourceCoding),
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
    resourceType: "AllergyIntolerance", id: a.id,
    recordedDate: str(a.meta && a.meta.recordedAt) || undefined,
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: str(a.clinicalStatus) === "inactive" ? "inactive" : "active" }] },
    // "unable-to-assess" is a real FHIR value and is what our model already says when nobody knows.
    criticality: ["low", "high", "unable-to-assess"].includes(str(a.criticality)) ? str(a.criticality) : "unable-to-assess",
    code: codeable(a.substance, a.substanceCodeSystem, a.substance),
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
    resourceType: "Observation", id: o.id,
    status: "final",
    category: CAT[str(o.category)] ? [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: CAT[str(o.category)] }] }] : undefined,
    code: codeable(o.code, o.codeSystem, o.display, o.sourceCoding),
    subject: ref("Patient", o.patientId),
    encounter: ref("Encounter", o.encounterId),
    effectiveDateTime: str((o.meta && o.meta.effectiveAt) || o.effectiveAt) || undefined,
    ...value,
  });
}

function fhirMedicationRequest(m) {
  const STATUS = { active: "active", draft: "draft", "on-hold": "on-hold", cancelled: "cancelled", completed: "completed" };
  return clean({
    resourceType: "MedicationRequest", id: m.id,
    status: STATUS[str(m.status)] || "unknown",
    intent: "order",
    authoredOn: str(m.meta && m.meta.recordedAt) || undefined,
    medicationCodeableConcept: codeable(m.drugCode || m.drug, m.drugCodeSystem, m.drug, m.sourceCoding),
    subject: ref("Patient", m.patientId),
    encounter: ref("Encounter", m.encounterId),
    requester: m.prescriberId ? { display: m.prescriberId } : undefined,
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
    resourceType: "MedicationAdministration", id: a.id,
    status: STATUS[str(a.status)] || "in-progress",
    medicationCodeableConcept: codeable(a.drugCode || a.drug, a.drugCodeSystem, a.drug),
    subject: ref("Patient", a.patientId),
    context: ref("Encounter", a.encounterId),
    effectiveDateTime: str(a.administeredAt) || undefined,
    performer: a.administeredBy ? [{ actor: { display: a.administeredBy } }] : undefined,
    request: ref("MedicationRequest", a.orderId),
  });
}

function fhirServiceRequest(s) {
  return clean({
    resourceType: "ServiceRequest", id: s.id,
    status: ["active", "completed", "revoked", "draft"].includes(str(s.status)) ? str(s.status) : "unknown",
    intent: "order",
    authoredOn: str(s.meta && s.meta.recordedAt) || undefined,
    code: codeable(s.code, s.codeSystem, s.display, s.sourceCoding),
    subject: ref("Patient", s.patientId),
    encounter: ref("Encounter", s.encounterId),
    requester: s.requesterId ? { display: s.requesterId } : undefined,
  });
}

function fhirDiagnosticReport(d) {
  return clean({
    resourceType: "DiagnosticReport", id: d.id,
    status: ["preliminary", "final", "corrected", "cancelled"].includes(str(d.status)) ? str(d.status) : "unknown",
    code: codeable(d.code, d.codeSystem, d.code, d.sourceCoding),
    subject: ref("Patient", d.patientId),
    encounter: ref("Encounter", d.encounterId),
    // The request this answers, so a receiver can close its own loop.
    basedOn: d.serviceRequestId ? [ref("ServiceRequest", d.serviceRequestId)] : undefined,
    effectiveDateTime: str(d.reportedAt) || undefined,
    issued: str(d.meta && d.meta.recordedAt) || undefined,
    conclusion: d.conclusion || undefined,
    result: (d.resultObservationIds || []).map((id) => ref("Observation", id)).filter(Boolean),
  });
}

function fhirDocumentReference(n) {
  // A clinical note is a DOCUMENT in FHIR, and the signature state travels with it: a draft that
  // exported as `current` would look like a finished, signed note to everyone downstream.
  return clean({
    resourceType: "DocumentReference", id: n.id,
    status: "current",
    docStatus: n.signedBy ? "final" : "preliminary",
    type: { text: str(n.noteType) || "note" },
    subject: ref("Patient", n.patientId),
    date: str(n.meta && n.meta.recordedAt) || undefined,
    author: n.authorId ? [{ display: n.authorId }] : undefined,
    authenticator: n.signedBy ? { display: n.signedBy } : undefined,
    context: n.encounterId ? { encounter: [ref("Encounter", n.encounterId)] } : undefined,
    content: [{ attachment: clean({ contentType: "text/plain", data: undefined, title: str(n.noteType) || undefined }) }],
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
    resourceType: "Consent", id: c.id,
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
  return clean({
    resourceType: "Provenance",
    id: `${fhirType}-${record.id}-v${version === null ? "0" : version}`,
    target: [{ reference: version === null ? `${fhirType}/${record.id}` : `${fhirType}/${record.id}/_history/${version}` }],
    recorded: str(by.at) || str(m.recordedAt) || undefined,
    activity: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-DataOperation", code: version === 1 ? "CREATE" : "UPDATE" }] },
    agent: [clean({
      type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: PARTICIPANT[str(by.kind)] || "author" }] },
      who: { display: str(by.id) || "unknown" },
      /* The human an AI acted for is named as EXACTLY that - the party it acted on behalf of - and
       * never as the author. */
      onBehalfOf: by.onBehalfOf ? { display: str(by.onBehalfOf) } : undefined,
    })],
    entity: external ? [{
      role: "source",
      what: clean({ identifier: clean({ system: SOURCE_URN(src.system), value: str(src.sourceId) || undefined }), display: `${str(src.system)}${str(src.sourceId) ? ":" + str(src.sourceId) : ""}` }),
    }] : undefined,
  });
}

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
});

/** Our type name to the FHIR one it renders as. */
const FHIR_TYPE = Object.freeze({
  Patient: "Patient", Encounter: "Encounter", Condition: "Condition",
  AllergyIntolerance: "AllergyIntolerance", Observation: "Observation",
  MedicationOrder: "MedicationRequest", MedicationAdministration: "MedicationAdministration",
  ServiceRequest: "ServiceRequest", DiagnosticReport: "DiagnosticReport", ClinicalNote: "DocumentReference",
  PatientConsent: "Consent",
});
/** And back, so a caller can ask for the FHIR name. */
const CANONICAL_TYPE = Object.freeze(Object.fromEntries(Object.entries(FHIR_TYPE).map(([k, v]) => [v, k])));

/** PURE. One canonical record to FHIR, with meta, or null when this file has no honest mapping. */
function toFhir(record) {
  const m = record && MAPPERS[record.resourceType];
  return m ? withMeta(m(record), record) : null;
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
      description: "WardSynQ clinical record, read-only FHIR R4 export. Not profile-validated; "
        + "no claim of conformance to US Core or any national profile. Concepts WardSynQ holds "
        + "without a coding are emitted as CodeableConcept.text with no coding, never as a guessed code. "
        + `Verified codes carried by this build: ${Object.entries(coverage()).map(([u, n]) => `${n} in ${u}`).join(", ") || "none"}. `
        + "A coding imported from another system that WardSynQ did not verify is emitted under the sender's "
        + `own system with extension ${EXT_TERMINOLOGY_STATUS} = unmapped. Provenance is derived from the `
        + "record's own audit stamp for every version and is never stored separately.",
    },
    rest: [{
      mode: "server",
      security: { description: "Bearer token or staff session, scoped to one hospital. Same authority as every other WardSynQ door." },
      /* Derived from the SAME tables the search parser reads (fhir-search.js), so what is declared
       * here is what actually parses. A CapabilityStatement maintained by hand drifts the first time
       * either side changes, and a client trusts the declaration. */
      resource: [
        ...Object.values(FHIR_TYPE).map((t) => {
          const d = declaredSearch(t);
          return clean({
            type: t,
            versioning: "versioned",
            readHistory: true,
            // READ, VREAD, HISTORY and SEARCH. No create, no update, no delete - and nothing implies otherwise.
            interaction: [{ code: "read" }, { code: "vread" }, { code: "history-instance" }, { code: "search-type" }],
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
      ],
      operation: [{ name: "everything", definition: "http://hl7.org/fhir/OperationDefinition/Patient-everything" }],
    }],
  };
}

async function open(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
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

/**
 * Everything this server holds for one patient, as a Bundle.
 * ctx: { migration, patientId, types?, actorDeps, recordDeps }
 */
async function patientEverything(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ok: false, status: 400, outcome: operationOutcome("error", "required", "patient is required") };

  const { svc, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };

  const wanted = Array.isArray(ctx.types) && ctx.types.length
    ? ctx.types.map((t) => CANONICAL_TYPE[t] || t).filter((t) => MAPPERS[t])
    : Object.keys(MAPPERS);

  const out = [];
  for (const type of wanted) {
    try {
      if (type === "Patient") { const p = await svc.get("Patient", patientId); if (p) out.push(toFhir(p)); continue; }
      const rows = await svc.byPatient(type, patientId);
      for (const r of rows || []) { const f = toFhir(r); if (f) out.push(f); }
    } catch {
      /* A type this actor may not read is simply absent from the bundle. It is NOT reported as an
       * empty result set, because "no allergies" and "you may not see the allergies" are different
       * facts and a bundle cannot express the second one. The reader is told which types are in it
       * via the bundle's own contents. */
    }
  }
  return { ok: true, status: 200, bundle: bundle(out, { base: str(ctx.base), timestamp: new Date().toISOString() }) };
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
  try { record = await svc.get(canonical, str(ctx.id)); }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }
  if (!record) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such resource") };

  const f = toFhir(record);
  if (!f) return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "no mapping for that resource") };
  return { ok: true, status: 200, resource: f };
}

/** How many of a type one search may consider. Stated in the bundle when it bites. */
const SEARCH_POOL = 1000;

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

  const { svc, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };

  let rows;
  try {
    if (canonical === "Patient") {
      rows = query.patient ? [await svc.get("Patient", query.patient)].filter(Boolean) : await svc.list("Patient", SEARCH_POOL);
    } else {
      rows = query.patient ? await svc.byPatient(canonical, query.patient) : await svc.list(canonical, SEARCH_POOL);
    }
  } catch (e) {
    return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) };
  }
  const pooled = (rows || []).length;
  const resources = (rows || []).map(toFhir).filter(Boolean);

  const matched = applySearch(resources, query);
  const page = paginate(matched, query);

  /* Includes are resolved by REFERENCE through the same governed reads, so an actor who may not see
   * an Encounter does not receive one because a report pointed at it. */
  const cache = new Map();
  const lookup = (t, id) => { const k = `${t}/${id}`; return cache.has(k) ? cache.get(k) : null; };
  if (query.include.length) {
    const wanted = new Set();
    for (const r of page.entries) for (const key of query.include) {
      const spec = INCLUDES[key];
      if (!spec) continue;
      for (const rf of [].concat(spec.path(r) || []).filter(Boolean)) { const m = /^([A-Za-z]+)\/([^/]+)$/.exec(str(rf.reference)); if (m) wanted.add(`${m[1]}/${m[2]}`); }
    }
    for (const k of wanted) {
      const [t, id] = k.split("/");
      const c = CANONICAL_TYPE[t];
      if (!c) continue;
      try { const rec = await svc.get(c, id); cache.set(k, rec ? toFhir(rec) : null); } catch { cache.set(k, null); }
    }
  }
  const included = resolveIncludes(page.entries, query, lookup);

  /* _revinclude=Provenance:target: the provenance of each matched resource's CURRENT version,
   * derived from the canonical rows already in hand - no second read, no second opinion. */
  if (query.revInclude.includes("Provenance:target")) {
    const byId = new Map((rows || []).filter(Boolean).map((r) => [str(r.id), r]));
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
  try { versions = await svc.history(canonical, str(ctx.id)); }
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
  try { versions = await svc.history(canonical, str(ctx.id)); }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }
  const hit = (versions || []).find((v) => String(v.version) === want);
  if (!hit) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such version") };
  return { ok: true, status: 200, resource: toFhir(hit) };
}

/** PURE. A Provenance id back to the version it names, or null. */
function parseProvenanceId(id) {
  const m = /^([A-Za-z]+)-(.+)-v(\d+)$/.exec(str(id));
  if (!m || !CANONICAL_TYPE[m[1]]) return null;
  return { fhirType: m[1], canonical: CANONICAL_TYPE[m[1]], id: m[2], version: Number(m[3]) };
}

/** One Provenance by id. ctx: { migration, id } */
async function provenanceRead(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  const p = parseProvenanceId(ctx.id);
  if (!p) return { ok: false, status: 404, outcome: operationOutcome("error", "not-found", "no such Provenance") };
  const { svc, error } = await open(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) };
  let versions;
  try { versions = await svc.history(p.canonical, p.id); }
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
  try { versions = await svc.history(canonical, query.target.id); }
  catch (e) { return { ok: false, status: 403, outcome: operationOutcome("error", "forbidden", str(e && e.message)) }; }

  const all = (versions || []).map(fhirProvenance).filter(Boolean).reverse();
  const page = paginate(all, query);
  return { ok: true, status: 200, bundle: searchBundle({ base: str(ctx.base), type: "Provenance", q: query, page, included: [], outcomes: [], rawQuery: ctx.rawQuery }) };
}

export {
  SYSTEM_URI, UNCODED, MAPPERS, FHIR_TYPE, CANONICAL_TYPE, SEARCH_POOL, SOURCE_URN, EXT_TERMINOLOGY_STATUS, PARTICIPANT,
  systemUriFor, codeable, identifier, withMeta, toFhir, bundle, capabilityStatement, operationOutcome,
  fhirPatient, fhirEncounter, fhirCondition, fhirAllergy, fhirObservation,
  fhirMedicationRequest, fhirMedicationAdministration, fhirServiceRequest,
  fhirDiagnosticReport, fhirDocumentReference, fhirConsent, fhirProvenance, parseProvenanceId,
  patientEverything, readResource, searchType, historyOf, vread, provenanceRead, provenanceSearch,
};
