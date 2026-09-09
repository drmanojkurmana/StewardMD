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
  // SURGERY and PACU joined 2026-09-08 (Task 2.3): a case in theatre and post-anaesthesia recovery
  // are their own encounters, not the inpatient stay that may surround them - the same reasoning ED
  // and ICU already established for this list.
  // MATERNITY joined 2026-09-08 (Task 2.4): antenatal admission, labour and delivery, and the
  // postpartum stay are one visit to one department, the same reasoning ED/ICU/SURGERY/PACU already
  // established for this list.
  // PEDIATRICS and NICU joined 2026-09-08 (Task 2.5): the identical reasoning ED/ICU/SURGERY/PACU/
  // MATERNITY already established for this list.
  const validClasses = ["OPD", "IPD", "ED", "ICU", "SURGERY", "PACU", "MATERNITY", "PEDIATRICS", "NICU", "DAYCARE", "VIRTUAL"];
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

/* A measured value, or null — never a number the source text did not actually state.
 *
 * WHY THIS IS NOT Number.parseFloat. parseFloat reads a leading number and silently DISCARDS the
 * rest, and the strip-then-parse variant that grew alongside it
 * (`parseFloat(String(v).replace(/[^0-9.\-]/g, ""))`) is worse still: it deletes the separators and
 * GLUES the remaining digits together. Measured on the real helpers, 2026-09-07:
 *
 *     "120/80"  -> 12080     a blood pressure pair typed into one box, as a systolic reading
 *     "98,6"    -> 986       a comma decimal separator
 *     "1:320"   -> 1320      (strip variant) / 1 (plain parseFloat) — a Widal titer, either way
 *     "5-10"    -> 5         a range reported as its lower bound
 *
 * Every one of those is a confidently wrong clinical number that reads as a real measurement, which
 * is the same fabrication the allergy capture is careful to avoid: a missed value degrades to
 * nothing recorded, a wrong one is charted, trended and acted on.
 *
 * So: a value is numeric only if the WHOLE string is one number, optionally followed by a unit that
 * itself contains no digits ("6.2 mg/dL", "98.6 F", "12.5 %"). Scientific notation is kept ("2.0E3").
 * Anything with a second number in it — a ratio, a range, a BP pair — is not a measurement this
 * function will invent, and anything with a qualifier that changes the meaning ("1+", "<5") is left
 * to the caller as text. Callers decide what null means: vitals skip the reading, lab results keep
 * the original string and mark it nonNumeric.
 */
function numericValue(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*([a-zA-Z%/·^°µμ\s]*)$/.exec(s);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
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
    // Set by the IoMT quality filter. null means NOT ASSESSED, which for a device observation is
    // treated as ineligible: a reading nothing has vetted has not passed. It lives on the canonical
    // model rather than being bolted on afterwards because a device reading that loses this field in
    // transit through the store or the bus would be excluded from every automated score forever, and
    // silently, which is exactly the failure the filter exists to prevent.
    scoreEligible: typeof input.scoreEligible === "boolean" ? input.scoreEligible : null,
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
    // What was actually given, copied from the order when the record is opened. An administration
    // record that can only say "order 47" is a poor clinical record: reading it back requires the
    // order still to exist and to be fetchable, which is exactly what an audit or a downstream
    // consumer cannot rely on. It also lets the administered EVENT be self-describing.
    drug: input.drug || null,
    drugCode: input.drugCode || null,
    status: input.status || "ordered", // see wardsynq-meds.js state machine
    scannedPatientBarcode: input.scannedPatientBarcode || null,
    scannedDrugBarcode: input.scannedDrugBarcode || null,
    administeredBy: input.administeredBy || null,
    witnessedBy: input.witnessedBy || null, // required for high-alert drugs
    administeredAt: input.administeredAt || null,
    // When the dose was DUE, as the schedule computed it. Without this a record can say a dose was
    // given and cannot say whether it was late, which is the only way to ask whether an eMAR is
    // working. Never derived from administeredAt: that would make every dose on time by definition.
    dueAt: input.dueAt || null,
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

/**
 * DiagnosticReport: finalized result of a ServiceRequest (lab panel, imaging report).
 *
 * `encounterId` added 2026-09-06 (the results migration): every other clinical resource here
 * (Observation, ServiceRequest, MedicationOrder, ClinicalNote) already carries the visit it belongs
 * to, and a result with no encounter link cannot be shown alongside the visit that produced it. Not
 * a second model, not a new resource type — the same field the rest of this file already has.
 */
function DiagnosticReport(input) {
  input = input || {};
  return {
    resourceType: "DiagnosticReport",
    id: input.id || localId("dr"),
    patientId: requireString(input.patientId, "DiagnosticReport.patientId"),
    encounterId: input.encounterId || null,
    serviceRequestId: input.serviceRequestId || null,
    code: requireString(input.code, "DiagnosticReport.code"),
    status: input.status || "preliminary", // preliminary | final | corrected | cancelled
    conclusion: input.conclusion || null,
    resultObservationIds: assertArray(input.resultObservationIds),
    critical: !!input.critical, // gates wardsynq-safety.js closed-loop critical-value escalation
    meta: makeMeta(input),
  };
}

/**
 * ImagingStudy: that a study EXISTS in a PACS, and what it is. TASK 7.7.
 *
 * METADATA ONLY, and that is a decision rather than an omission. There is no url, no binary, no
 * instance list and no pixel data anywhere in this record: WardSynQ is a clinician's phone talking
 * to an API that has no object storage, and a field holding a retrieve URL would become the thing
 * every viewer, cache and log copies a patient's images through. What a clinician needs from the
 * chart is that the scan happened, when, of what, and the accession number that finds it in the
 * PACS viewer they already have. That is what this carries.
 *
 * `serviceRequestId` is the point of the whole thing: the imaging ORDER this study answers, matched
 * on the accession number the order and the study share. Without it a chart shows a request with no
 * scan and a scan belonging to nobody's request.
 */
function ImagingStudy(input) {
  input = input || {};
  return {
    resourceType: "ImagingStudy",
    id: input.id || localId("img"),
    patientId: requireString(input.patientId, "ImagingStudy.patientId"),
    encounterId: input.encounterId || null,
    serviceRequestId: input.serviceRequestId || null,
    // The PACS's own identifiers. `studyUid` is the StudyInstanceUID as a plain string, never a URL.
    studyUid: input.studyUid || null,
    accessionNumber: input.accessionNumber || null,
    modality: input.modality || null,           // as the source wrote it; never mapped to another vocabulary
    bodySite: input.bodySite || null,
    description: input.description || null,
    started: input.started || null,
    seriesCount: Number.isFinite(Number(input.seriesCount)) ? Number(input.seriesCount) : null,
    instanceCount: Number.isFinite(Number(input.instanceCount)) ? Number(input.instanceCount) : null,
    status: input.status || "available",        // available | registered | cancelled | entered-in-error
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
  numericValue,
  Patient,
  Encounter,
  Condition,
  AllergyIntolerance,
  Observation,
  MedicationOrder,
  MedicationAdministration,
  ServiceRequest,
  DiagnosticReport,
  ImagingStudy,
  CarePlan,
  ClinicalNote,
};
