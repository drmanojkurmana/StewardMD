/* wardsynq/wardsynq-model.js — WardSynQ P0: canonical clinical data model.
 *
 * These are the typed domain entities every WardSynQ subsystem (safety engine, event bus, eMAR,
 * specialty engines, AI, EMR UI) reads and writes. They are the target shape that interop adapters
 * (GHIS/Ward Sync, HL7 v2, FHIR R4, DICOM, LIS, ABDM, IoMT — see wardsynq-interop.js, not yet built)
 * normalize INTO. No adapter-specific field or vocabulary belongs here: this file must stay
 * meaningful even if every current adapter were replaced tomorrow.
 *
 * Every entity carries a `meta` provenance envelope so a value can always be traced back to the
 * system/record that produced it (`derivedFrom`), per the lineage requirement in the safety case
 * (section 2.8 of the WardSynQ spec). Bi-temporal fields (`recordedAt`/`effectiveAt`) are carried
 * here as plain timestamps; the point-in-time query engine itself is wardsynq-temporal.js, not this
 * file — this module only guarantees the fields exist and are consistent.
 *
 * node --test test/wardsynq-p0-core.test.mjs
 */

/** @typedef {{system: string, sourceId?: string, importedAt?: string}} ProvenanceSource */

function nowIso() {
  return new Date().toISOString();
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} is required and must be a non-empty string`);
  }
  return value;
}

function assertArray(value, field) {
  if (value !== undefined && !Array.isArray(value)) {
    throw new TypeError(`${field} must be an array when provided`);
  }
  return value || [];
}

let seq = 0;
/** Local id generator. Adapters/persistence layers may replace ids on ingest; this only guarantees
 * uniqueness within a process so P0 code can run standalone before wardsynq-store.js exists. */
function localId(prefix) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/**
 * Builds the provenance/bi-temporal envelope shared by every canonical entity.
 * @param {{source?: ProvenanceSource, derivedFrom?: string[], effectiveAt?: string}} [opts]
 */
function makeMeta(opts) {
  opts = opts || {};
  const recordedAt = nowIso();
  return {
    recordedAt, // T_recorded: when WardSynQ learned this fact
    effectiveAt: opts.effectiveAt || recordedAt, // T_effective: when it became clinically true
    amendedAt: null, // set by wardsynq-temporal.js on correction, never on first write
    source: opts.source
      ? { system: requireString(opts.source.system, "meta.source.system"), sourceId: opts.source.sourceId || null, importedAt: opts.source.importedAt || recordedAt }
      : { system: "wardsynq-native", sourceId: null, importedAt: recordedAt },
    derivedFrom: assertArray(opts.derivedFrom, "meta.derivedFrom"),
  };
}

/** Patient & demographics. */
function Patient(input) {
  input = input || {};
  return {
    resourceType: "Patient",
    id: input.id || localId("pat"),
    mrn: requireString(input.mrn, "Patient.mrn"),
    name: requireString(input.name, "Patient.name"),
    dob: requireString(input.dob, "Patient.dob"), // ISO date; age math lives outside this model
    sex: input.sex || "unknown",
    identifiers: assertArray(input.identifiers), // e.g. [{system:"ABHA", value:"..."}]
    // Physical wristband barcode. This, not the on-screen chart, is what the eMAR scans against at
    // the bedside; falls back to mrn where a site encodes the mrn directly on the band.
    wristbandBarcode: input.wristbandBarcode || null,
    provisional: !!input.provisional, // true for TRAUMA-UNKNOWN-* records pending merge
    meta: makeMeta(input),
  };
}

/** Encounter: OPD / IPD / ED / ICU episode of care. */
function Encounter(input) {
  input = input || {};
  const validClasses = ["OPD", "IPD", "ED", "ICU", "DAYCARE", "VIRTUAL"];
  if (!validClasses.includes(input.class)) {
    throw new TypeError(`Encounter.class must be one of ${validClasses.join(", ")}`);
  }
  return {
    resourceType: "Encounter",
    id: input.id || localId("enc"),
    patientId: requireString(input.patientId, "Encounter.patientId"),
    class: input.class,
    status: input.status || "planned", // planned | in-progress | finished | cancelled
    // A visit carries its own identifiers (GHIS episode id, HL7 visit number, FHIR
    // Encounter.identifier). Without this an adapter's only way to preserve the source visit id is
    // to bake it into the generated `id` string, which no consumer can safely parse back out.
    identifiers: assertArray(input.identifiers),
    location: input.location || null, // {facilityId, ward, bed}
    periodStart: input.periodStart || nowIso(),
    periodEnd: input.periodEnd || null,
    meta: makeMeta(input),
  };
}

/** Condition: problem list / diagnosis entry. */
function Condition(input) {
  input = input || {};
  return {
    resourceType: "Condition",
    id: input.id || localId("cond"),
    patientId: requireString(input.patientId, "Condition.patientId"),
    encounterId: input.encounterId || null,
    code: requireString(input.code, "Condition.code"), // coding system-agnostic (e.g. ICD-10/SNOMED CT)
    codeSystem: input.codeSystem || "unspecified",
    display: input.display || input.code,
    clinicalStatus: input.clinicalStatus || "active", // active | resolved | inactive
    verificationStatus: input.verificationStatus || "provisional",
    onsetDate: input.onsetDate || null,
    meta: makeMeta(input),
  };
}

/** AllergyIntolerance — read by the deterministic Allergy Shield (wardsynq-safety.js), not this file. */
function AllergyIntolerance(input) {
  input = input || {};
  const validCriticality = ["low", "high", "unable-to-assess"];
  return {
    resourceType: "AllergyIntolerance",
    id: input.id || localId("alg"),
    patientId: requireString(input.patientId, "AllergyIntolerance.patientId"),
    substance: requireString(input.substance, "AllergyIntolerance.substance"),
    substanceCodeSystem: input.substanceCodeSystem || "unspecified", // e.g. SNOMED CT / RxNorm
    reaction: input.reaction || null, // e.g. "anaphylaxis"
    severity: input.severity || "unknown", // mild | moderate | severe
    criticality: validCriticality.includes(input.criticality) ? input.criticality : "unable-to-assess",
    verifiedBy: input.verifiedBy || null, // clinician id, required before this can gate a hard-stop
    meta: makeMeta(input),
  };
}

/** Observation: vitals, labs, device telemetry readings. */
function Observation(input) {
  input = input || {};
  return {
    resourceType: "Observation",
    id: input.id || localId("obs"),
    patientId: requireString(input.patientId, "Observation.patientId"),
    encounterId: input.encounterId || null,
    category: input.category || "vital-signs", // vital-signs | laboratory | imaging | device
    code: requireString(input.code, "Observation.code"),
    codeSystem: input.codeSystem || "unspecified", // e.g. LOINC
    value: input.value, // number | string | {low, high} — left loose; unit carries meaning
    unit: input.unit || null, // UCUM code where applicable
    signalQualityIndex: typeof input.signalQualityIndex === "number" ? input.signalQualityIndex : null, // IoMT SQI 0-100
    artifact: !!input.artifact, // set by wardsynq-iomt.js when SQI < threshold; excluded from scores
    meta: makeMeta(input),
  };
}

/** MedicationOrder: prescription / order for a medication. */
function MedicationOrder(input) {
  input = input || {};
  return {
    resourceType: "MedicationOrder",
    id: input.id || localId("rx"),
    patientId: requireString(input.patientId, "MedicationOrder.patientId"),
    encounterId: input.encounterId || null,
    drug: requireString(input.drug, "MedicationOrder.drug"),
    drugCode: input.drugCode || null, // coded product identity, e.g. an RxNorm cui
    drugCodeSystem: input.drugCodeSystem || "unspecified", // e.g. RxNorm
    // Unit-dose barcode the ward will scan at the bedside. Distinct from drugCode: the code says
    // what was ordered, the barcode says what is physically in the nurse's hand.
    drugBarcode: input.drugBarcode || null,
    dose: input.dose ?? null, // {value, unit} — dose ceiling math lives in wardsynq-safety.js
    route: input.route || null,
    frequency: input.frequency || null,
    prescriberId: requireString(input.prescriberId, "MedicationOrder.prescriberId"),
    status: input.status || "draft", // draft | active | on-hold | cancelled | completed
    // Every AI-authored field lands here amber-flagged and unsigned; see wardsynq-safety.js invariant.
    aiDrafted: !!input.aiDrafted,
    signedBy: input.signedBy || null, // clinician signature required before status can leave "draft"
    meta: makeMeta(input),
  };
}

/** MedicationAdministration: eMAR record. Lifecycle owned by wardsynq-meds.js. */
function MedicationAdministration(input) {
  input = input || {};
  return {
    resourceType: "MedicationAdministration",
    id: input.id || localId("mar"),
    orderId: requireString(input.orderId, "MedicationAdministration.orderId"),
    patientId: requireString(input.patientId, "MedicationAdministration.patientId"),
    status: input.status || "ordered", // see wardsynq-meds.js state machine
    scannedPatientBarcode: input.scannedPatientBarcode || null,
    scannedDrugBarcode: input.scannedDrugBarcode || null,
    administeredBy: input.administeredBy || null,
    witnessedBy: input.witnessedBy || null, // required for high-alert drugs
    administeredAt: input.administeredAt || null,
    holdReason: input.holdReason || null,
    meta: makeMeta(input),
  };
}

/** ServiceRequest: any clinical order that is not a medication (labs, imaging, referrals). */
function ServiceRequest(input) {
  input = input || {};
  return {
    resourceType: "ServiceRequest",
    id: input.id || localId("sr"),
    patientId: requireString(input.patientId, "ServiceRequest.patientId"),
    encounterId: input.encounterId || null,
    code: requireString(input.code, "ServiceRequest.code"),
    category: input.category || "other", // laboratory | imaging | procedure | referral | other
    priority: input.priority || "routine", // routine | urgent | stat
    requesterId: requireString(input.requesterId, "ServiceRequest.requesterId"),
    status: input.status || "draft",
    meta: makeMeta(input),
  };
}

/** DiagnosticReport: finalized result of a ServiceRequest (lab panel, imaging report). */
function DiagnosticReport(input) {
  input = input || {};
  return {
    resourceType: "DiagnosticReport",
    id: input.id || localId("dr"),
    patientId: requireString(input.patientId, "DiagnosticReport.patientId"),
    serviceRequestId: input.serviceRequestId || null,
    code: requireString(input.code, "DiagnosticReport.code"),
    status: input.status || "preliminary", // preliminary | final | corrected | cancelled
    conclusion: input.conclusion || null,
    resultObservationIds: assertArray(input.resultObservationIds),
    critical: !!input.critical, // gates wardsynq-safety.js closed-loop critical-value escalation
    meta: makeMeta(input),
  };
}

/** CarePlan: goal-directed plan of care spanning an encounter or condition. */
function CarePlan(input) {
  input = input || {};
  return {
    resourceType: "CarePlan",
    id: input.id || localId("cp"),
    patientId: requireString(input.patientId, "CarePlan.patientId"),
    encounterId: input.encounterId || null,
    goals: assertArray(input.goals),
    status: input.status || "draft",
    authorId: requireString(input.authorId, "CarePlan.authorId"),
    meta: makeMeta(input),
  };
}

/** ClinicalNote: SOAP / progress note. AI-authored drafts must set aiDrafted + stay unsigned. */
function ClinicalNote(input) {
  input = input || {};
  return {
    resourceType: "ClinicalNote",
    id: input.id || localId("note"),
    patientId: requireString(input.patientId, "ClinicalNote.patientId"),
    encounterId: input.encounterId || null,
    noteType: input.noteType || "progress", // progress | soap | discharge-summary | operative
    sections: input.sections || {}, // e.g. {subjective, objective, assessment, plan}
    authorId: input.authorId || null, // null while aiDrafted and unsigned
    aiDrafted: !!input.aiDrafted,
    signedBy: input.signedBy || null,
    meta: makeMeta(input),
  };
}

export {
  makeMeta,
  localId,
  Patient,
  Encounter,
  Condition,
  AllergyIntolerance,
  Observation,
  MedicationOrder,
  MedicationAdministration,
  ServiceRequest,
  DiagnosticReport,
  CarePlan,
  ClinicalNote,
};
