/* functions/_wardsynq/fhir-validate.js - FHIR R4 conformance validation. PURE.
 *
 * "Conformant" has a definition, and this file is that definition applied: every element of a
 * resource against the R4 base StructureDefinition of its type - which elements exist, their
 * cardinality, their datatype, the format of every primitive, that a choice element has exactly one
 * form, that a REQUIRED binding carries one of its codes - plus the invariants a receiver can check
 * without a FHIRPath engine, and any profile constraints the hospital has loaded.
 *
 * WHAT IT IS NOT. This build carries no implementation guide. A resource that declares
 * `meta.profile` US Core or NDHM/ABDM is validated against R4 base and told, in an information
 * issue, that the profile itself was not evaluated - unless the hospital has loaded that profile's
 * constraints under wardsynq.fhir.profiles, in which case they are applied. It does not fabricate
 * conformance it did not check.
 *
 * STRICT ON UNKNOWN ELEMENTS. R4 says a receiver SHALL treat an unknown element as an error, and a
 * writer of clinical data should want that: `valueQuantiy` silently dropped is a result that arrives
 * with no value. So every element of every type this server exchanges is listed here; a datatype it
 * does not model in depth (Timing, Signature, SampledData) is accepted as an object and said so.
 *
 * TERMINOLOGY IS SOMEONE ELSE'S. This file checks REQUIRED bindings from the R4 base - the code sets
 * FHIR itself fixes, like Observation.status - because those are structural. Whether a LOINC code
 * exists is a question for terminology.js, so this file COLLECTS every coding with a system and hands
 * the list back; the caller decides what to ask and what to report.
 */

const str = (v) => (v == null ? "" : String(v).trim());
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/* ---- primitives ------------------------------------------------------------------------------ */

const DATE = /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?$/;
const DATETIME = /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?$/;
const INSTANT = /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?$/;
const ID = /^[A-Za-z0-9\-.]{1,64}$/;
const CODE = /^[^\s]+(\s[^\s]+)*$/;
const URI = /^\S*$/;
const OID = /^urn:oid:[0-2](\.(0|[1-9][0-9]*))+$/;
const UUID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64 = /^(\s*([0-9a-zA-Z+/=]){4}\s*)+$/;

const PRIMITIVES = Object.freeze({
  string: (v) => typeof v === "string" && v.length > 0 && v.length <= 1048576,
  markdown: (v) => typeof v === "string" && v.length > 0,
  xhtml: (v) => typeof v === "string" && /^\s*<div[\s>]/.test(v) && /<\/div>\s*$/.test(v),
  code: (v) => typeof v === "string" && CODE.test(v),
  id: (v) => typeof v === "string" && ID.test(v),
  uri: (v) => typeof v === "string" && v.length > 0 && URI.test(v),
  url: (v) => typeof v === "string" && v.length > 0 && URI.test(v),
  canonical: (v) => typeof v === "string" && v.length > 0 && URI.test(v),
  oid: (v) => typeof v === "string" && OID.test(v),
  uuid: (v) => typeof v === "string" && UUID.test(v),
  boolean: (v) => v === true || v === false,
  integer: (v) => Number.isInteger(v),
  positiveInt: (v) => Number.isInteger(v) && v > 0,
  unsignedInt: (v) => Number.isInteger(v) && v >= 0,
  decimal: (v) => typeof v === "number" && Number.isFinite(v),
  date: (v) => typeof v === "string" && DATE.test(v),
  dateTime: (v) => typeof v === "string" && DATETIME.test(v),
  instant: (v) => typeof v === "string" && INSTANT.test(v),
  time: (v) => typeof v === "string" && TIME.test(v),
  base64Binary: (v) => typeof v === "string" && BASE64.test(v),
});

/* ---- the R4 base value sets that are REQUIRED bindings on the types exchanged --------------- */

const VS = Object.freeze({
  gender: "male|female|other|unknown",
  identifierUse: "usual|official|temp|secondary|old",
  nameUse: "usual|official|temp|nickname|anonymous|old|maiden",
  contactSystem: "phone|fax|email|pager|url|sms|other",
  contactUse: "home|work|temp|old|mobile",
  addressUse: "home|work|temp|old|billing",
  addressType: "postal|physical|both",
  narrative: "generated|extensions|additional|empty",
  comparator: "<|<=|>=|>",
  encounterStatus: "planned|arrived|triaged|in-progress|onleave|finished|cancelled|entered-in-error|unknown",
  encounterLocationStatus: "planned|active|reserved|completed",
  observationStatus: "registered|preliminary|final|amended|corrected|cancelled|entered-in-error|unknown",
  rxStatus: "active|on-hold|cancelled|completed|entered-in-error|stopped|draft|unknown",
  rxIntent: "proposal|plan|order|original-order|reflex-order|filler-order|instance-order|option",
  priority: "routine|urgent|asap|stat",
  adminStatus: "in-progress|not-done|on-hold|completed|entered-in-error|stopped|unknown",
  srStatus: "draft|active|on-hold|revoked|completed|entered-in-error|unknown",
  srIntent: "proposal|plan|directive|order|original-order|reflex-order|filler-order|instance-order|option",
  drStatus: "registered|partial|preliminary|final|amended|corrected|appended|cancelled|entered-in-error|unknown",
  specimenStatus: "available|unavailable|unsatisfactory|entered-in-error",
  dispenseStatus: "preparation|in-progress|cancelled|on-hold|completed|entered-in-error|stopped|declined|unknown",
  docStatus: "current|superseded|entered-in-error",
  compStatus: "preliminary|final|amended|entered-in-error",
  carePlanStatus: "draft|active|on-hold|revoked|completed|entered-in-error|unknown",
  imagingStudyStatus: "registered|available|cancelled|entered-in-error|unknown",
  carePlanIntent: "proposal|plan|order|option",
  carePlanActivityStatus: "not-started|scheduled|in-progress|on-hold|completed|cancelled|stopped|unknown|entered-in-error",
  relatesTo: "replaces|transforms|signs|appends",
  consentStatus: "draft|proposed|active|rejected|inactive|entered-in-error",
  provisionType: "deny|permit",
  dataMeaning: "instance|related|dependents|authoredby",
  entityRole: "derivation|revision|quotation|source|removal",
  allergyType: "allergy|intolerance",
  allergyCategory: "food|medication|environment|biologic",
  criticality: "low|high|unable-to-assess",
  severity: "mild|moderate|severe",
  linkType: "replaced-by|replaces|refer|seealso",
  bundleType: "document|message|transaction|transaction-response|batch|batch-response|history|searchset|collection",
  searchMode: "match|include|outcome",
  httpVerb: "GET|HEAD|POST|PUT|DELETE|PATCH",
  issueSeverity: "fatal|error|warning|information",
  daysOfWeek: "mon|tue|wed|thu|fri|sat|sun",
  eventTiming: "MORN|MORN.early|MORN.late|NOON|AFT|AFT.early|AFT.late|EVE|EVE.early|EVE.late|NIGHT|PHS|HS|WAKE|C|CM|CD|CV|AC|ACM|ACD|ACV|PC|PCM|PCD|PCV",
  unitsOfTime: "s|min|h|d|wk|mo|a",
  quantityComparator: "<|<=|>=|>",
  conditionClinical: "active|recurrence|relapse|inactive|remission|resolved",
  conditionVer: "unconfirmed|provisional|differential|confirmed|refuted|entered-in-error",
  allergyClinical: "active|inactive|resolved",
  allergyVer: "unconfirmed|confirmed|refuted|entered-in-error",
});

/** A CodeableConcept whose R4 binding is REQUIRED: at least one coding must carry one of these codes in this system. */
const REQUIRED_CC = Object.freeze({
  conditionClinical: { system: "http://terminology.hl7.org/CodeSystem/condition-clinical", codes: VS.conditionClinical },
  conditionVer: { system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", codes: VS.conditionVer },
  allergyClinical: { system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", codes: VS.allergyClinical },
  allergyVer: { system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", codes: VS.allergyVer },
});

/* ---- datatypes -------------------------------------------------------------------------------
 * Element spec grammar:  "name": "Type"        0..1
 *                        "name[]": "Type"      0..*
 *                        "name!": "Type"       1..1
 *                        "name[]!": "Type"     1..*
 *   Type may be a primitive, a datatype name, "Reference(A|B)", "code:a|b|c" (required binding),
 *   "cc:key" (CodeableConcept with a REQUIRED binding), "any" (accepted, not deep-checked), or an
 *   inline object (a BackboneElement). A choice element is "name[x]": { nameQuantity: "Quantity", ... }
 *   with "!" on the key when one form is required.
 */
const ELEMENT = { id: "string", "extension[]": "Extension" };
const BACKBONE = { ...ELEMENT, "modifierExtension[]": "Extension" };

const VALUE_CHOICE = {
  valueBase64Binary: "base64Binary", valueBoolean: "boolean", valueCanonical: "canonical", valueCode: "code", valueDate: "date", valueDateTime: "dateTime",
  valueDecimal: "decimal", valueId: "id", valueInstant: "instant", valueInteger: "integer", valueMarkdown: "markdown", valueOid: "oid", valuePositiveInt: "positiveInt",
  valueString: "string", valueTime: "time", valueUnsignedInt: "unsignedInt", valueUri: "uri", valueUrl: "url", valueUuid: "uuid",
  valueAddress: "Address", valueAge: "Quantity", valueAnnotation: "Annotation", valueAttachment: "Attachment", valueCodeableConcept: "CodeableConcept", valueCoding: "Coding",
  valueContactPoint: "ContactPoint", valueCount: "Quantity", valueDistance: "Quantity", valueDuration: "Quantity", valueHumanName: "HumanName", valueIdentifier: "Identifier",
  valueMoney: "any", valuePeriod: "Period", valueQuantity: "Quantity", valueRange: "Range", valueRatio: "Ratio", valueReference: "Reference", valueSampledData: "any",
  valueSignature: "any", valueTiming: "Timing", valueContactDetail: "any", valueContributor: "any", valueDataRequirement: "any", valueExpression: "any",
  valueParameterDefinition: "any", valueRelatedArtifact: "any", valueTriggerDefinition: "any", valueUsageContext: "any", valueDosage: "Dosage", valueMeta: "Meta",
};

const TYPES = Object.freeze({
  Extension: { ...ELEMENT, "url!": "uri", "value[x]": VALUE_CHOICE },
  Coding: { ...ELEMENT, system: "uri", version: "string", code: "code", display: "string", userSelected: "boolean" },
  CodeableConcept: { ...ELEMENT, "coding[]": "Coding", text: "string" },
  Identifier: { ...ELEMENT, use: `code:${VS.identifierUse}`, type: "CodeableConcept", system: "uri", value: "string", period: "Period", assigner: "Reference(Organization)" },
  Period: { ...ELEMENT, start: "dateTime", end: "dateTime" },
  Quantity: { ...ELEMENT, value: "decimal", comparator: `code:${VS.comparator}`, unit: "string", system: "uri", code: "code" },
  Range: { ...ELEMENT, low: "Quantity", high: "Quantity" },
  Ratio: { ...ELEMENT, numerator: "Quantity", denominator: "Quantity" },
  Reference: { ...ELEMENT, reference: "string", type: "uri", identifier: "Identifier", display: "string" },
  HumanName: { ...ELEMENT, use: `code:${VS.nameUse}`, text: "string", family: "string", "given[]": "string", "prefix[]": "string", "suffix[]": "string", period: "Period" },
  ContactPoint: { ...ELEMENT, system: `code:${VS.contactSystem}`, value: "string", use: `code:${VS.contactUse}`, rank: "positiveInt", period: "Period" },
  Address: { ...ELEMENT, use: `code:${VS.addressUse}`, type: `code:${VS.addressType}`, text: "string", "line[]": "string", city: "string", district: "string", state: "string", postalCode: "string", country: "string", period: "Period" },
  Annotation: { ...ELEMENT, "author[x]": { authorReference: "Reference", authorString: "string" }, time: "dateTime", "text!": "markdown" },
  Attachment: { ...ELEMENT, contentType: "code", language: "code", data: "base64Binary", url: "url", size: "unsignedInt", hash: "base64Binary", title: "string", creation: "dateTime" },
  Narrative: { ...ELEMENT, "status!": `code:${VS.narrative}`, "div!": "xhtml" },
  Meta: { ...ELEMENT, versionId: "id", lastUpdated: "instant", source: "uri", "profile[]": "canonical", "security[]": "Coding", "tag[]": "Coding" },
  Timing: { ...BACKBONE, "event[]": "dateTime", repeat: { ...ELEMENT, "bounds[x]": { boundsDuration: "Quantity", boundsRange: "Range", boundsPeriod: "Period" }, count: "positiveInt", countMax: "positiveInt", duration: "decimal", durationMax: "decimal", durationUnit: `code:${VS.unitsOfTime}`, frequency: "positiveInt", frequencyMax: "positiveInt", period: "decimal", periodMax: "decimal", periodUnit: `code:${VS.unitsOfTime}`, "dayOfWeek[]": `code:${VS.daysOfWeek}`, "timeOfDay[]": "time", "when[]": `code:${VS.eventTiming}`, offset: "unsignedInt" }, code: "CodeableConcept" },
  Dosage: { ...BACKBONE, sequence: "integer", text: "string", "additionalInstruction[]": "CodeableConcept", patientInstruction: "string", timing: "Timing", "asNeeded[x]": { asNeededBoolean: "boolean", asNeededCodeableConcept: "CodeableConcept" }, site: "CodeableConcept", route: "CodeableConcept", method: "CodeableConcept",
    "doseAndRate[]": { ...ELEMENT, type: "CodeableConcept", "dose[x]": { doseRange: "Range", doseQuantity: "Quantity" }, "rate[x]": { rateRatio: "Ratio", rateRange: "Range", rateQuantity: "Quantity" } },
    maxDosePerPeriod: "Ratio", maxDosePerAdministration: "Quantity", maxDosePerLifetime: "Quantity" },
  Signature: "any", SampledData: "any", Money: "any",
});

/* ---- resources ------------------------------------------------------------------------------- */

const RESOURCE = { id: "id", meta: "Meta", implicitRules: "uri", language: "code" };
const DOMAIN = { ...RESOURCE, text: "Narrative", "contained[]": "Resource", "extension[]": "Extension", "modifierExtension[]": "Extension" };

const RESOURCES = Object.freeze({
  Patient: { ...DOMAIN, "identifier[]": "Identifier", active: "boolean", "name[]": "HumanName", "telecom[]": "ContactPoint", gender: `code:${VS.gender}`, birthDate: "date",
    "deceased[x]": { deceasedBoolean: "boolean", deceasedDateTime: "dateTime" }, "address[]": "Address", maritalStatus: "CodeableConcept",
    "multipleBirth[x]": { multipleBirthBoolean: "boolean", multipleBirthInteger: "integer" }, "photo[]": "Attachment",
    "contact[]": { ...BACKBONE, "relationship[]": "CodeableConcept", name: "HumanName", "telecom[]": "ContactPoint", address: "Address", gender: `code:${VS.gender}`, organization: "Reference(Organization)", period: "Period" },
    "communication[]": { ...BACKBONE, "language!": "CodeableConcept", preferred: "boolean" },
    "generalPractitioner[]": "Reference(Organization|Practitioner|PractitionerRole)", managingOrganization: "Reference(Organization)",
    "link[]": { ...BACKBONE, "other!": "Reference(Patient|RelatedPerson)", "type!": `code:${VS.linkType}` } },
  Encounter: { ...DOMAIN, "identifier[]": "Identifier", "status!": `code:${VS.encounterStatus}`,
    "statusHistory[]": { ...BACKBONE, "status!": `code:${VS.encounterStatus}`, "period!": "Period" }, "class!": "Coding",
    "classHistory[]": { ...BACKBONE, "class!": "Coding", "period!": "Period" }, "type[]": "CodeableConcept", serviceType: "CodeableConcept", priority: "CodeableConcept",
    subject: "Reference(Patient|Group)", "episodeOfCare[]": "Reference(EpisodeOfCare)", "basedOn[]": "Reference(ServiceRequest)",
    "participant[]": { ...BACKBONE, "type[]": "CodeableConcept", period: "Period", individual: "Reference(Practitioner|PractitionerRole|RelatedPerson)" },
    "appointment[]": "Reference(Appointment)", period: "Period", length: "Quantity", "reasonCode[]": "CodeableConcept", "reasonReference[]": "Reference(Condition|Procedure|Observation|ImmunizationRecommendation)",
    "diagnosis[]": { ...BACKBONE, "condition!": "Reference(Condition|Procedure)", use: "CodeableConcept", rank: "positiveInt" }, "account[]": "Reference(Account)",
    hospitalization: { ...BACKBONE, preAdmissionIdentifier: "Identifier", origin: "Reference(Location|Organization)", admitSource: "CodeableConcept", reAdmission: "CodeableConcept", "dietPreference[]": "CodeableConcept", "specialCourtesy[]": "CodeableConcept", "specialArrangement[]": "CodeableConcept", destination: "Reference(Location|Organization)", dischargeDisposition: "CodeableConcept" },
    "location[]": { ...BACKBONE, "location!": "Reference(Location)", status: `code:${VS.encounterLocationStatus}`, physicalType: "CodeableConcept", period: "Period" },
    serviceProvider: "Reference(Organization)", partOf: "Reference(Encounter)" },
  Condition: { ...DOMAIN, "identifier[]": "Identifier", clinicalStatus: "cc:conditionClinical", verificationStatus: "cc:conditionVer", "category[]": "CodeableConcept", severity: "CodeableConcept", code: "CodeableConcept", "bodySite[]": "CodeableConcept",
    "subject!": "Reference(Patient|Group)", encounter: "Reference(Encounter)",
    "onset[x]": { onsetDateTime: "dateTime", onsetAge: "Quantity", onsetPeriod: "Period", onsetRange: "Range", onsetString: "string" },
    "abatement[x]": { abatementDateTime: "dateTime", abatementAge: "Quantity", abatementPeriod: "Period", abatementRange: "Range", abatementString: "string" },
    recordedDate: "dateTime", recorder: "Reference(Practitioner|PractitionerRole|Patient|RelatedPerson)", asserter: "Reference(Practitioner|PractitionerRole|Patient|RelatedPerson)",
    "stage[]": { ...BACKBONE, summary: "CodeableConcept", "assessment[]": "Reference(ClinicalImpression|DiagnosticReport|Observation)", type: "CodeableConcept" },
    "evidence[]": { ...BACKBONE, "code[]": "CodeableConcept", "detail[]": "Reference" }, "note[]": "Annotation" },
  AllergyIntolerance: { ...DOMAIN, "identifier[]": "Identifier", clinicalStatus: "cc:allergyClinical", verificationStatus: "cc:allergyVer", type: `code:${VS.allergyType}`, "category[]": `code:${VS.allergyCategory}`, criticality: `code:${VS.criticality}`,
    code: "CodeableConcept", "patient!": "Reference(Patient)", encounter: "Reference(Encounter)",
    "onset[x]": { onsetDateTime: "dateTime", onsetAge: "Quantity", onsetPeriod: "Period", onsetRange: "Range", onsetString: "string" },
    recordedDate: "dateTime", recorder: "Reference(Practitioner|PractitionerRole|Patient|RelatedPerson)", asserter: "Reference(Patient|RelatedPerson|Practitioner|PractitionerRole)", lastOccurrence: "dateTime", "note[]": "Annotation",
    "reaction[]": { ...BACKBONE, substance: "CodeableConcept", "manifestation[]!": "CodeableConcept", description: "string", onset: "dateTime", severity: `code:${VS.severity}`, exposureRoute: "CodeableConcept", "note[]": "Annotation" } },
  Observation: { ...DOMAIN, "identifier[]": "Identifier", "basedOn[]": "Reference(CarePlan|DeviceRequest|ImmunizationRecommendation|MedicationRequest|NutritionOrder|ServiceRequest)", "partOf[]": "Reference(MedicationAdministration|MedicationDispense|MedicationStatement|Procedure|Immunization|ImagingStudy)",
    "status!": `code:${VS.observationStatus}`, "category[]": "CodeableConcept", "code!": "CodeableConcept", subject: "Reference(Patient|Group|Device|Location)", "focus[]": "Reference", encounter: "Reference(Encounter)",
    "effective[x]": { effectiveDateTime: "dateTime", effectivePeriod: "Period", effectiveTiming: "Timing", effectiveInstant: "instant" }, issued: "instant", "performer[]": "Reference(Practitioner|PractitionerRole|Organization|CareTeam|Patient|RelatedPerson)",
    "value[x]": { valueQuantity: "Quantity", valueCodeableConcept: "CodeableConcept", valueString: "string", valueBoolean: "boolean", valueInteger: "integer", valueRange: "Range", valueRatio: "Ratio", valueSampledData: "any", valueTime: "time", valueDateTime: "dateTime", valuePeriod: "Period" },
    dataAbsentReason: "CodeableConcept", "interpretation[]": "CodeableConcept", "note[]": "Annotation", bodySite: "CodeableConcept", method: "CodeableConcept", specimen: "Reference(Specimen)", device: "Reference(Device|DeviceMetric)",
    "referenceRange[]": { ...BACKBONE, low: "Quantity", high: "Quantity", type: "CodeableConcept", "appliesTo[]": "CodeableConcept", age: "Range", text: "string" },
    "hasMember[]": "Reference(Observation|QuestionnaireResponse|MolecularSequence)", "derivedFrom[]": "Reference(DocumentReference|ImagingStudy|Media|QuestionnaireResponse|Observation|MolecularSequence)",
    "component[]": { ...BACKBONE, "code!": "CodeableConcept", "value[x]": { valueQuantity: "Quantity", valueCodeableConcept: "CodeableConcept", valueString: "string", valueBoolean: "boolean", valueInteger: "integer", valueRange: "Range", valueRatio: "Ratio", valueSampledData: "any", valueTime: "time", valueDateTime: "dateTime", valuePeriod: "Period" },
      dataAbsentReason: "CodeableConcept", "interpretation[]": "CodeableConcept", "referenceRange[]": { ...BACKBONE, low: "Quantity", high: "Quantity", type: "CodeableConcept", "appliesTo[]": "CodeableConcept", age: "Range", text: "string" } } },
  MedicationRequest: { ...DOMAIN, "identifier[]": "Identifier", "status!": `code:${VS.rxStatus}`, statusReason: "CodeableConcept", "intent!": `code:${VS.rxIntent}`, "category[]": "CodeableConcept", priority: `code:${VS.priority}`, doNotPerform: "boolean",
    "reported[x]": { reportedBoolean: "boolean", reportedReference: "Reference(Patient|Practitioner|PractitionerRole|RelatedPerson|Organization)" },
    "medication[x]!": { medicationCodeableConcept: "CodeableConcept", medicationReference: "Reference(Medication)" },
    "subject!": "Reference(Patient|Group)", encounter: "Reference(Encounter)", "supportingInformation[]": "Reference", authoredOn: "dateTime", requester: "Reference(Practitioner|PractitionerRole|Organization|Patient|RelatedPerson|Device)",
    performer: "Reference(Practitioner|PractitionerRole|Organization|Patient|Device|RelatedPerson|CareTeam)", performerType: "CodeableConcept", recorder: "Reference(Practitioner|PractitionerRole)", "reasonCode[]": "CodeableConcept", "reasonReference[]": "Reference(Condition|Observation)",
    "instantiatesCanonical[]": "canonical", "instantiatesUri[]": "uri", "basedOn[]": "Reference(CarePlan|MedicationRequest|ServiceRequest|ImmunizationRecommendation)", groupIdentifier: "Identifier", courseOfTherapyType: "CodeableConcept", "insurance[]": "Reference(Coverage|ClaimResponse)", "note[]": "Annotation",
    "dosageInstruction[]": "Dosage",
    dispenseRequest: { ...BACKBONE, initialFill: { ...BACKBONE, quantity: "Quantity", duration: "Quantity" }, dispenseInterval: "Quantity", validityPeriod: "Period", numberOfRepeatsAllowed: "unsignedInt", quantity: "Quantity", expectedSupplyDuration: "Quantity", performer: "Reference(Organization)" },
    substitution: { ...BACKBONE, "allowed[x]!": { allowedBoolean: "boolean", allowedCodeableConcept: "CodeableConcept" }, reason: "CodeableConcept" },
    priorPrescription: "Reference(MedicationRequest)", "detectedIssue[]": "Reference(DetectedIssue)", "eventHistory[]": "Reference(Provenance)" },
  MedicationAdministration: { ...DOMAIN, "identifier[]": "Identifier", "instantiates[]": "uri", "partOf[]": "Reference(MedicationAdministration|Procedure)", "status!": `code:${VS.adminStatus}`, "statusReason[]": "CodeableConcept", category: "CodeableConcept",
    "medication[x]!": { medicationCodeableConcept: "CodeableConcept", medicationReference: "Reference(Medication)" }, "subject!": "Reference(Patient|Group)", context: "Reference(Encounter|EpisodeOfCare)", "supportingInformation[]": "Reference",
    "effective[x]!": { effectiveDateTime: "dateTime", effectivePeriod: "Period" },
    "performer[]": { ...BACKBONE, function: "CodeableConcept", "actor!": "Reference(Practitioner|PractitionerRole|Patient|RelatedPerson|Device)" },
    "reasonCode[]": "CodeableConcept", "reasonReference[]": "Reference(Condition|Observation|DiagnosticReport)", request: "Reference(MedicationRequest)", "device[]": "Reference(Device)", "note[]": "Annotation",
    dosage: { ...BACKBONE, text: "string", site: "CodeableConcept", route: "CodeableConcept", method: "CodeableConcept", dose: "Quantity", "rate[x]": { rateRatio: "Ratio", rateQuantity: "Quantity" } },
    "eventHistory[]": "Reference(Provenance)" },
  ServiceRequest: { ...DOMAIN, "identifier[]": "Identifier", "instantiatesCanonical[]": "canonical", "instantiatesUri[]": "uri", "basedOn[]": "Reference(CarePlan|ServiceRequest|MedicationRequest)", "replaces[]": "Reference(ServiceRequest)", requisition: "Identifier",
    "status!": `code:${VS.srStatus}`, "intent!": `code:${VS.srIntent}`, "category[]": "CodeableConcept", priority: `code:${VS.priority}`, doNotPerform: "boolean", code: "CodeableConcept", "orderDetail[]": "CodeableConcept",
    "quantity[x]": { quantityQuantity: "Quantity", quantityRatio: "Ratio", quantityRange: "Range" }, "subject!": "Reference(Patient|Group|Location|Device)", encounter: "Reference(Encounter)",
    "occurrence[x]": { occurrenceDateTime: "dateTime", occurrencePeriod: "Period", occurrenceTiming: "Timing" }, "asNeeded[x]": { asNeededBoolean: "boolean", asNeededCodeableConcept: "CodeableConcept" },
    authoredOn: "dateTime", requester: "Reference(Practitioner|PractitionerRole|Organization|Patient|RelatedPerson|Device)", performerType: "CodeableConcept", "performer[]": "Reference", "locationCode[]": "CodeableConcept", "locationReference[]": "Reference(Location)",
    "reasonCode[]": "CodeableConcept", "reasonReference[]": "Reference(Condition|Observation|DiagnosticReport|DocumentReference)", "insurance[]": "Reference(Coverage|ClaimResponse)", "supportingInfo[]": "Reference", "specimen[]": "Reference(Specimen)", "bodySite[]": "CodeableConcept",
    "note[]": "Annotation", patientInstruction: "string", "relevantHistory[]": "Reference(Provenance)" },
  DiagnosticReport: { ...DOMAIN, "identifier[]": "Identifier", "basedOn[]": "Reference(CarePlan|ImmunizationRecommendation|MedicationRequest|NutritionOrder|ServiceRequest)", "status!": `code:${VS.drStatus}`, "category[]": "CodeableConcept", "code!": "CodeableConcept",
    subject: "Reference(Patient|Group|Device|Location)", encounter: "Reference(Encounter)", "effective[x]": { effectiveDateTime: "dateTime", effectivePeriod: "Period" }, issued: "instant",
    "performer[]": "Reference(Practitioner|PractitionerRole|Organization|CareTeam)", "resultsInterpreter[]": "Reference(Practitioner|PractitionerRole|Organization|CareTeam)", "specimen[]": "Reference(Specimen)", "result[]": "Reference(Observation)", "imagingStudy[]": "Reference(ImagingStudy)",
    "media[]": { ...BACKBONE, comment: "string", "link!": "Reference(Media)" }, conclusion: "string", "conclusionCode[]": "CodeableConcept", "presentedForm[]": "Attachment" },
  Specimen: { ...DOMAIN, "identifier[]": "Identifier", accessionIdentifier: "Identifier", "status!": `code:${VS.specimenStatus}`, type: "CodeableConcept",
    subject: "Reference(Patient|Group|Device|Substance|Location)", receivedTime: "dateTime", "parent[]": "Reference(Specimen)", "request[]": "Reference(ServiceRequest)",
    collection: { ...BACKBONE, collector: "Reference(Practitioner|PractitionerRole)", "collected[x]": { collectedDateTime: "dateTime", collectedPeriod: "Period" }, duration: "Quantity", quantity: "Quantity", method: "CodeableConcept", bodySite: "CodeableConcept",
      "fastingStatus[x]": { fastingStatusCodeableConcept: "CodeableConcept", fastingStatusDuration: "Quantity" } },
    "processing[]": { ...BACKBONE, description: "string", procedure: "CodeableConcept", "additive[]": "Reference(Substance)", "time[x]": { timeDateTime: "dateTime", timePeriod: "Period" } },
    "container[]": { ...BACKBONE, identifier: "Identifier", description: "string", type: "CodeableConcept", capacity: "Quantity", specimenQuantity: "Quantity", "additive[x]": { additiveCodeableConcept: "CodeableConcept", additiveReference: "Reference(Substance)" } },
    condition: "CodeableConcept", "note[]": "Annotation" },
  MedicationDispense: { ...DOMAIN, "identifier[]": "Identifier", "partOf[]": "Reference(Procedure)", "status!": `code:${VS.dispenseStatus}`, statusReasonCodeableConcept: "CodeableConcept", statusReasonReference: "Reference(DetectedIssue)", category: "CodeableConcept",
    "medication[x]!": { medicationCodeableConcept: "CodeableConcept", medicationReference: "Reference(Medication)" }, subject: "Reference(Patient|Group)", context: "Reference(Encounter|EpisodeOfCare)", "supportingInformation[]": "Reference",
    "performer[]": { ...BACKBONE, function: "CodeableConcept", "actor!": "Reference(Practitioner|PractitionerRole|Organization|Patient|Device|RelatedPerson)" }, location: "Reference(Location)", "authorizingPrescription[]": "Reference(MedicationRequest)",
    type: "CodeableConcept", quantity: "Quantity", daysSupply: "Quantity", whenPrepared: "dateTime", whenHandedOver: "dateTime", destination: "Reference(Location)", "receiver[]": "Reference(Patient|Practitioner)", "note[]": "Annotation", dosageInstruction: "Dosage",
    substitution: { ...BACKBONE, wasSubstituted: "boolean", type: "CodeableConcept", "reason[]": "CodeableConcept", "responsibleParty[]": "Reference(Practitioner|PractitionerRole)" },
    "detectedIssue[]": "Reference(DetectedIssue)", "eventHistory[]": "Reference(Provenance)" },
  CarePlan: { ...DOMAIN, "identifier[]": "Identifier", "instantiatesCanonical[]": "canonical", "instantiatesUri[]": "uri", "basedOn[]": "Reference(CarePlan)", "replaces[]": "Reference(CarePlan)", "partOf[]": "Reference(CarePlan)",
    "status!": `code:${VS.carePlanStatus}`, "intent!": `code:${VS.carePlanIntent}`, "category[]": "CodeableConcept", title: "string", description: "string",
    "subject!": "Reference(Patient|Group)", encounter: "Reference(Encounter)", period: "Period", created: "dateTime", author: "Reference(Patient|Practitioner|PractitionerRole|Device|RelatedPerson|Organization|CareTeam)",
    "contributor[]": "Reference(Patient|Practitioner|PractitionerRole|Device|RelatedPerson|Organization|CareTeam)", "careTeam[]": "Reference(CareTeam)", "addresses[]": "Reference(Condition)", "supportingInfo[]": "Reference", "goal[]": "Reference(Goal)",
    "activity[]": { ...BACKBONE, "outcomeCodeableConcept[]": "CodeableConcept", "outcomeReference[]": "Reference(Resource)", "progress[]": "Annotation", reference: "Reference(Appointment|CommunicationRequest|DeviceRequest|MedicationRequest|NutritionOrder|Task|ServiceRequest|VisionPrescription)",
      detail: { ...BACKBONE, kind: `code:${VS.srIntent}`, "instantiatesCanonical[]": "canonical", "instantiatesUri[]": "uri", "code": "CodeableConcept", "reasonCode[]": "CodeableConcept", "reasonReference[]": "Reference(Condition|Observation|DiagnosticReport|DocumentReference)",
        "goal[]": "Reference(Goal)", status: `code:${VS.carePlanActivityStatus}`, statusReason: "CodeableConcept", doNotPerform: "boolean",
        "scheduled[x]": { scheduledTiming: "Timing", scheduledPeriod: "Period", scheduledString: "string" }, location: "Reference(Location)", "performer[]": "Reference(Practitioner|PractitionerRole|Organization|RelatedPerson|Patient|CareTeam|Device)",
        "product[x]": { productCodeableConcept: "CodeableConcept", productReference: "Reference(Medication|Substance)" }, dailyAmount: "Quantity", quantity: "Quantity", description: "string" } },
    "note[]": "Annotation" },
  /* TASK 7.7. The R4 shape, with `endpoint` and `series` present in the definition but never
   * produced by this server: WardSynQ holds no pixel data and no retrieve URL, so a study exported
   * from here carries identity, status, subject, the order it answers and counts - nothing that
   * points at an image. */
  ImagingStudy: { ...DOMAIN, "identifier[]": "Identifier", "status!": `code:${VS.imagingStudyStatus}`, "modality[]": "Coding",
    "subject!": "Reference(Patient|Device|Group)", encounter: "Reference(Encounter)", started: "dateTime",
    "basedOn[]": "Reference(CarePlan|ServiceRequest|Appointment|AppointmentResponse|Task)", referrer: "Reference(Practitioner|PractitionerRole)",
    "interpreter[]": "Reference(Practitioner|PractitionerRole)", "endpoint[]": "Reference(Endpoint)",
    numberOfSeries: "unsignedInt", numberOfInstances: "unsignedInt", procedureReference: "Reference(Procedure)", "procedureCode[]": "CodeableConcept",
    location: "Reference(Location)", "reasonCode[]": "CodeableConcept", "reasonReference[]": "Reference(Condition|Observation|Media|DiagnosticReport|DocumentReference)",
    "note[]": "Annotation", description: "string" },
  /* TASK 7.11. Practitioner and Organization are DERIVED (fhir-identity.js), not stored - but they
   * are EXPORTED, and this file's whole discipline is that anything this server emits is validated
   * against R4 rather than trusted because we wrote it. The full R4 element sets are listed, not
   * only the ones currently emitted, so an element added later is checked rather than silently
   * unknown. `qualification` is here and is never populated: this server holds no qualifications. */
  Practitioner: { ...DOMAIN, "identifier[]": "Identifier", active: "boolean", "name[]": "HumanName", "telecom[]": "ContactPoint",
    "address[]": "Address", gender: `code:${VS.gender}`, birthDate: "date", "photo[]": "Attachment",
    "qualification[]": { ...BACKBONE, "identifier[]": "Identifier", "code!": "CodeableConcept", period: "Period", issuer: "Reference(Organization)" },
    "communication[]": "CodeableConcept" },
  Organization: { ...DOMAIN, "identifier[]": "Identifier", active: "boolean", "type[]": "CodeableConcept", name: "string",
    "alias[]": "string", "telecom[]": "ContactPoint", "address[]": "Address", partOf: "Reference(Organization)",
    "contact[]": { ...BACKBONE, purpose: "CodeableConcept", name: "HumanName", "telecom[]": "ContactPoint", address: "Address" },
    "endpoint[]": "Reference(Endpoint)" },
  DocumentReference: { ...DOMAIN, masterIdentifier: "Identifier", "identifier[]": "Identifier", "status!": `code:${VS.docStatus}`, docStatus: `code:${VS.compStatus}`, type: "CodeableConcept", "category[]": "CodeableConcept",
    subject: "Reference(Patient|Practitioner|Group|Device)", date: "instant", "author[]": "Reference", authenticator: "Reference(Practitioner|PractitionerRole|Organization)", custodian: "Reference(Organization)",
    "relatesTo[]": { ...BACKBONE, "code!": `code:${VS.relatesTo}`, "target!": "Reference(DocumentReference)" }, description: "string", "securityLabel[]": "CodeableConcept",
    "content[]!": { ...BACKBONE, "attachment!": "Attachment", format: "Coding" },
    context: { ...BACKBONE, "encounter[]": "Reference(Encounter|EpisodeOfCare)", "event[]": "CodeableConcept", period: "Period", facilityType: "CodeableConcept", practiceSetting: "CodeableConcept", sourcePatientInfo: "Reference(Patient)", "related[]": "Reference" } },
  Consent: { ...DOMAIN, "identifier[]": "Identifier", "status!": `code:${VS.consentStatus}`, "scope!": "CodeableConcept", "category[]!": "CodeableConcept", patient: "Reference(Patient)", dateTime: "dateTime",
    "performer[]": "Reference(Organization|Patient|Practitioner|RelatedPerson|PractitionerRole)", "organization[]": "Reference(Organization)", "source[x]": { sourceAttachment: "Attachment", sourceReference: "Reference" },
    "policy[]": { ...BACKBONE, authority: "uri", uri: "uri" }, policyRule: "CodeableConcept",
    "verification[]": { ...BACKBONE, "verified!": "boolean", verifiedWith: "Reference(Patient|RelatedPerson)", verificationDate: "dateTime" },
    provision: "ConsentProvision" },
  Provenance: { ...DOMAIN, "target[]!": "Reference", "occurred[x]": { occurredPeriod: "Period", occurredDateTime: "dateTime" }, "recorded!": "instant", "policy[]": "uri", location: "Reference(Location)", "reason[]": "CodeableConcept", activity: "CodeableConcept",
    "agent[]!": { ...BACKBONE, type: "CodeableConcept", "role[]": "CodeableConcept", "who!": "Reference", onBehalfOf: "Reference" },
    "entity[]": { ...BACKBONE, "role!": `code:${VS.entityRole}`, "what!": "Reference", "agent[]": "any" }, "signature[]": "any" },
  Bundle: { ...RESOURCE, identifier: "Identifier", "type!": `code:${VS.bundleType}`, timestamp: "instant", total: "unsignedInt",
    "link[]": { ...BACKBONE, "relation!": "string", "url!": "uri" },
    "entry[]": { ...BACKBONE, "link[]": { ...BACKBONE, "relation!": "string", "url!": "uri" }, fullUrl: "uri", resource: "Resource",
      search: { ...BACKBONE, mode: `code:${VS.searchMode}`, score: "decimal" },
      request: { ...BACKBONE, "method!": `code:${VS.httpVerb}`, "url!": "uri", ifNoneMatch: "string", ifModifiedSince: "instant", ifMatch: "string", ifNoneExist: "string" },
      response: { ...BACKBONE, "status!": "string", location: "uri", etag: "string", lastModified: "instant", outcome: "Resource" } },
    signature: "any" },
  OperationOutcome: { ...DOMAIN, "issue[]!": { ...BACKBONE, "severity!": `code:${VS.issueSeverity}`, "code!": "code", details: "CodeableConcept", diagnostics: "string", "location[]": "string", "expression[]": "string" } },
  Parameters: { ...RESOURCE, "parameter[]": "ParametersParameter" },
});

/* Recursive datatypes are named so a spec can refer to itself. */
const NAMED = Object.freeze({
  ConsentProvision: { ...BACKBONE, type: `code:${VS.provisionType}`, period: "Period",
    "actor[]": { ...BACKBONE, "role!": "CodeableConcept", "reference!": "Reference" }, "action[]": "CodeableConcept", "securityLabel[]": "Coding", "purpose[]": "Coding", "class[]": "Coding", "code[]": "CodeableConcept", dataPeriod: "Period",
    "data[]": { ...BACKBONE, "meaning!": `code:${VS.dataMeaning}`, "reference!": "Reference" }, "provision[]": "ConsentProvision" },
  ParametersParameter: { ...BACKBONE, "name!": "string", "value[x]": VALUE_CHOICE, resource: "Resource", "part[]": "ParametersParameter" },
});

/* ---- the walker ------------------------------------------------------------------------------ */

/** PURE. Parses an element key of the spec grammar. */
function parseKey(k) {
  const m = /^([A-Za-z]+)(\[x\])?(\[\])?(!)?$/.exec(k);
  return { name: m[1], choice: !!m[2], many: !!m[3], required: !!m[4] };
}

/** PURE. Issue constructor. */
const issue = (severity, code, path, diagnostics) => ({ severity, code, diagnostics, expression: [path] });

class Walker {
  constructor(opts) {
    this.issues = [];
    this.codings = [];
    this.max = (opts && opts.maxIssues) || 200;
    this.depth = 0;
  }
  add(i) { if (this.issues.length < this.max) this.issues.push(i); }

  /** A value against a type name. */
  value(v, type, path) {
    if (isObj(type)) { this.object(v, type, path); return; } // an inline BackboneElement
    if (type === "any") { if (!isObj(v) && !Array.isArray(v)) this.add(issue("error", "structure", path, "must be an object")); return; }
    if (type === "Resource") { this.resource(v, path); return; }
    if (PRIMITIVES[type]) { if (!PRIMITIVES[type](v)) this.add(issue("error", "value", path, `not a valid ${type}`)); return; }
    if (type.startsWith("code:")) {
      if (!PRIMITIVES.code(v)) { this.add(issue("error", "value", path, "not a valid code")); return; }
      const allowed = type.slice(5).split("|");
      if (!allowed.includes(v)) this.add(issue("error", "code-invalid", path, `"${v}" is not in the required value set (${allowed.join(", ")})`));
      return;
    }
    if (type.startsWith("cc:")) {
      const b = REQUIRED_CC[type.slice(3)];
      this.object(v, TYPES.CodeableConcept, path);
      if (isObj(v)) {
        const codes = b.codes.split("|");
        const ok = (v.coding || []).some((c) => c && c.system === b.system && codes.includes(c.code));
        if (!ok) this.add(issue("error", "code-invalid", path, `a coding from ${b.system} (${b.codes.replace(/\|/g, ", ")}) is required`));
      }
      return;
    }
    const refM = /^Reference(?:\(([^)]*)\))?$/.exec(type);
    if (refM) {
      this.object(v, TYPES.Reference, path);
      if (isObj(v)) {
        const ref = str(v.reference);
        if (ref) {
          const rel = /^([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})(\/_history\/[A-Za-z0-9\-.]{1,64})?$/.exec(ref);
          const abs = /^(https?:\/\/[^\s]+\/([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})(\/_history\/[A-Za-z0-9\-.]{1,64})?|urn:uuid:[0-9a-f-]{36}|urn:oid:[0-9.]+|#[A-Za-z0-9\-.]{1,64})$/.exec(ref);
          if (!rel && !abs) this.add(issue("error", "value", path + ".reference", `"${ref}" is not a Type/id, absolute URL, urn:uuid, urn:oid or #contained reference`));
          const targetType = rel ? rel[1] : abs && abs[2];
          if (targetType && refM[1] && !refM[1].split("|").includes(targetType)) this.add(issue("error", "invalid", path + ".reference", `must reference ${refM[1].replace(/\|/g, " or ")}, not ${targetType}`));
        } else if (!v.identifier && !v.display && !(v.extension && v.extension.length)) {
          this.add(issue("error", "structure", path, "a Reference needs reference, identifier or display"));
        }
      }
      return;
    }
    const spec = TYPES[type] || NAMED[type];
    if (spec === undefined) { this.add(issue("fatal", "exception", path, `validator has no definition for ${type}`)); return; }
    if (spec === "any") { if (!isObj(v)) this.add(issue("error", "structure", path, "must be an object")); return; }
    this.object(v, spec, path);
  }

  /** An object against an element spec. */
  object(v, spec, path) {
    if (!isObj(v)) { this.add(issue("error", "structure", path, "must be an object")); return; }
    if (++this.depth > 64) { this.add(issue("fatal", "too-costly", path, "nesting too deep")); this.depth--; return; }
    const known = new Map();      // element name -> {key, meta, type}
    const choices = [];
    for (const [k, t] of Object.entries(spec)) {
      const m = parseKey(k);
      if (m.choice) { choices.push({ ...m, options: t }); for (const opt of Object.keys(t)) known.set(opt, { meta: { ...m, name: opt }, type: t[opt], choiceOf: m.name }); }
      else known.set(m.name, { meta: m, type: t });
    }
    // Unknown elements are errors; a primitive's `_name` companion is an Element.
    const seen = new Set(Object.keys(v));
    for (const key of seen) {
      if (key === "resourceType") continue;
      if (key.startsWith("_")) {
        const base = known.get(key.slice(1));
        if (!base || (typeof base.type === "string" && !PRIMITIVES[base.type] && !base.type.startsWith("code:"))) this.add(issue("error", "structure", `${path}.${key}`, "unknown element"));
        else this.object(v[key], ELEMENT, `${path}.${key}`);
        continue;
      }
      const k = known.get(key);
      if (!k) { this.add(issue("error", "structure", `${path}.${key}`, "unknown element (not in R4)")); continue; }
      const val = v[key];
      const p = `${path}.${key}`;
      if (val === null || val === undefined) { this.add(issue("error", "structure", p, "null is not a value; omit the element")); continue; }
      if (k.meta.many) {
        if (!Array.isArray(val)) { this.add(issue("error", "structure", p, "must be an array")); continue; }
        if (!val.length) this.add(issue("error", "structure", p, "an empty array is not allowed (ele-1)"));
        val.forEach((item, i) => this.value(item, k.type, `${p}[${i}]`));
      } else {
        if (Array.isArray(val)) { this.add(issue("error", "structure", p, "must be a single value, not an array")); continue; }
        this.value(val, k.type, p);
      }
      // Every Coding with a system is collected for the terminology pass (a CodeableConcept's codings arrive here as its `coding` element).
      if (k.type === "Coding") this.collect(val, p);
    }
    // Required elements and choice cardinality.
    for (const [name, k] of known) {
      if (k.choiceOf) continue;
      if (k.meta.required && !(name in v)) this.add(issue("error", "required", `${path}.${name}`, "required element is missing"));
    }
    for (const c of choices) {
      const present = Object.keys(c.options).filter((o) => o in v);
      if (present.length > 1) this.add(issue("error", "structure", `${path}.${c.name}[x]`, `only one of ${present.join(", ")} may be present`));
      if (c.required && !present.length) this.add(issue("error", "required", `${path}.${c.name}[x]`, `one of ${Object.keys(c.options).join(", ")} is required`));
    }
    if (isObj(v) && "extension" in v && Object.keys(v).length === 1 && path.includes(".extension[")) { /* ext-1 handled below */ }
    if (spec === TYPES.Extension && isObj(v)) {
      const hasValue = Object.keys(v).some((k) => k.startsWith("value"));
      const hasNested = Array.isArray(v.extension) && v.extension.length > 0;
      if (hasValue && hasNested) this.add(issue("error", "structure", path, "an extension has a value or nested extensions, not both (ext-1)"));
      if (!hasValue && !hasNested) this.add(issue("error", "structure", path, "an extension needs a value or nested extensions (ext-1)"));
    }
    // ele-1: an element must carry something.
    const carried = Object.keys(v).filter((k) => k !== "resourceType");
    if (!carried.length) this.add(issue("error", "structure", path, "an empty element is not allowed (ele-1)"));
    this.depth--;
  }

  collect(val, path) {
    const list = Array.isArray(val) ? val : [val];
    list.forEach((c, i) => {
      if (isObj(c) && str(c.system) && str(c.code)) this.codings.push({ path: Array.isArray(val) ? `${path}[${i}]` : path, system: str(c.system), code: str(c.code), display: str(c.display) || null });
    });
  }

  /** A whole resource: type known, then its spec, then the invariants this file checks. */
  resource(r, path) {
    if (!isObj(r)) { this.add(issue("error", "structure", path, "a resource must be a JSON object")); return; }
    const t = str(r.resourceType);
    if (!t) { this.add(issue("error", "structure", path, "resourceType is required")); return; }
    const spec = RESOURCES[t];
    if (!spec) { this.add(issue("error", "not-supported", path, `${t} is not a resource type this server validates`)); return; }
    this.object(r, spec, path);
    this.invariants(r, t, path);
  }

  invariants(r, t, path) {
    if (t === "Observation") {
      const hasValue = Object.keys(r).some((k) => k.startsWith("value"));
      if (hasValue && r.dataAbsentReason) this.add(issue("error", "invariant", `${path}.dataAbsentReason`, "dataAbsentReason SHALL only be present if Observation.value[x] is not present (obs-6)"));
      for (const [i, c] of (Array.isArray(r.component) ? r.component : []).entries()) {
        if (isObj(c) && Object.keys(c).some((k) => k.startsWith("value")) && c.dataAbsentReason) this.add(issue("error", "invariant", `${path}.component[${i}].dataAbsentReason`, "dataAbsentReason SHALL only be present if value[x] is not present (obs-6)"));
      }
      if (r.code && Array.isArray(r.component) && isObj(r.code)) {
        const same = r.component.some((c) => isObj(c) && isObj(c.code) && JSON.stringify(c.code) === JSON.stringify(r.code));
        if (same) this.add(issue("error", "invariant", `${path}.component`, "a component code SHALL NOT be the same as the observation code (obs-7)"));
      }
    }
    if (t === "Bundle") {
      const entries = Array.isArray(r.entry) ? r.entry : [];
      const type = str(r.type);
      if (["transaction", "batch"].includes(type)) entries.forEach((e, i) => { if (isObj(e) && !e.request) this.add(issue("error", "invariant", `${path}.entry[${i}]`, "entry.request is required in a transaction or batch (bdl-3)")); });
      if (["transaction-response", "batch-response"].includes(type)) entries.forEach((e, i) => { if (isObj(e) && !e.response) this.add(issue("error", "invariant", `${path}.entry[${i}]`, "entry.response is required in a response bundle (bdl-4)")); });
      if (r.total !== undefined && !["searchset", "history"].includes(type)) this.add(issue("error", "invariant", `${path}.total`, "total only when a search or history (bdl-1)"));
      if (type === "document" && (!entries.length || !isObj(entries[0].resource) || entries[0].resource.resourceType !== "Composition")) this.add(issue("error", "invariant", `${path}.entry[0]`, "a document must start with a Composition (bdl-11)"));
      if (type === "message" && (!entries.length || !isObj(entries[0].resource) || entries[0].resource.resourceType !== "MessageHeader")) this.add(issue("error", "invariant", `${path}.entry[0]`, "a message must start with a MessageHeader (bdl-12)"));
      const seen = new Set();
      entries.forEach((e, i) => {
        if (!isObj(e)) return;
        const key = str(e.fullUrl) + "|" + str(e.resource && e.resource.meta && e.resource.meta.versionId);
        if (str(e.fullUrl) && seen.has(key)) this.add(issue("error", "invariant", `${path}.entry[${i}].fullUrl`, "fullUrl must be unique in a bundle, or else entries with the same fullUrl must have different meta.versionId (bdl-7)"));
        if (str(e.fullUrl)) seen.add(key);
        if (str(e.fullUrl) && /\/_history\//.test(str(e.fullUrl))) this.add(issue("error", "invariant", `${path}.entry[${i}].fullUrl`, "fullUrl cannot be a version specific reference (bdl-8)"));
        if (isObj(e) && !e.resource && !e.request && !e.response) this.add(issue("error", "invariant", `${path}.entry[${i}]`, "must be a resource unless there is a request or response (bdl-5)"));
      });
    }
    if (t === "Provenance" && Array.isArray(r.agent)) { /* who is required by cardinality already */ }
    if (t === "Patient" && Array.isArray(r.contact)) {
      r.contact.forEach((c, i) => { if (isObj(c) && !c.name && !(c.telecom && c.telecom.length) && !c.address && !c.organization) this.add(issue("error", "invariant", `${path}.contact[${i}]`, "SHALL at least contain a contact's details or a reference to an organization (pat-1)")); });
    }
    if (t === "Encounter" && Array.isArray(r.location)) { /* no base invariant to check */ }
    if (t === "Consent" && r.provision && isObj(r.provision) && r.provision.type === undefined && Array.isArray(r.provision.provision) && !r.provision.provision.length) { /* fine */ }
  }
}

/* ---- profiles the hospital loaded ---------------------------------------------------------- */

/**
 * PURE. Applies hospital-loaded profile constraints to one resource. A profile is
 *   { [Type]: { [dotted.path]: { min?, max?, binding?: { system?, codes: [] }, fixed? } } }
 * under wardsynq.fhir.profiles[url]. Paths are top-level or one level down (e.g. "name.family").
 * A declared profile this server does not hold is an information issue, never a pass.
 */
function applyProfiles(r, profiles, w, path) {
  const declared = (isObj(r) && isObj(r.meta) && Array.isArray(r.meta.profile) ? r.meta.profile : []).map(str).filter(Boolean);
  for (const url of declared) {
    const prof = profiles && profiles[url];
    if (!prof || !isObj(prof)) { w.add(issue("information", "informational", `${path}.meta.profile`, `profile ${url} is not held by this server and was not evaluated; validated against R4 base only`)); continue; }
    const rules = prof[r.resourceType];
    if (!rules) { w.add(issue("information", "informational", `${path}.meta.profile`, `profile ${url} says nothing about ${r.resourceType}`)); continue; }
    for (const [p, rule] of Object.entries(rules)) {
      const values = valuesAt(r, p);
      const n = values.length;
      if (rule.min !== undefined && n < rule.min) w.add(issue("error", "required", `${path}.${p}`, `profile ${url} requires at least ${rule.min}`));
      if (rule.max !== undefined && rule.max !== "*" && n > Number(rule.max)) w.add(issue("error", "structure", `${path}.${p}`, `profile ${url} allows at most ${rule.max}`));
      if (rule.binding && n) {
        const codes = Array.isArray(rule.binding.codes) ? rule.binding.codes.map(str) : [];
        const ok = values.some((v) => {
          if (typeof v === "string") return codes.includes(v);
          const list = isObj(v) && Array.isArray(v.coding) ? v.coding : isObj(v) && v.code ? [v] : [];
          return list.some((c) => isObj(c) && codes.includes(str(c.code)) && (!rule.binding.system || str(c.system) === rule.binding.system));
        });
        if (!ok) w.add(issue("error", "code-invalid", `${path}.${p}`, `profile ${url} binds this to ${codes.join(", ")}${rule.binding.system ? " from " + rule.binding.system : ""}`));
      }
      if (rule.fixed !== undefined && n && !values.some((v) => JSON.stringify(v) === JSON.stringify(rule.fixed))) w.add(issue("error", "value", `${path}.${p}`, `profile ${url} fixes this to ${JSON.stringify(rule.fixed)}`));
    }
  }
}

/** PURE. The values at a dotted path, flattening arrays at each step. */
function valuesAt(obj, path) {
  let cur = [obj];
  for (const seg of String(path).split(".")) {
    const next = [];
    for (const o of cur) {
      if (!isObj(o)) continue;
      const v = o[seg];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) next.push(...v); else next.push(v);
    }
    cur = next;
  }
  return cur;
}

/* ---- entry points ---------------------------------------------------------------------------- */

/**
 * PURE. Validates one resource (a Bundle validates every entry resource). Returns
 *   { valid, issues: [OperationOutcome.issue], codings: [{path, system, code, display}] }
 * `valid` is false when any issue is an error or fatal. opts: { profiles?, maxIssues? }
 */
function validateResource(resource, opts) {
  const w = new Walker(opts);
  const root = isObj(resource) && str(resource.resourceType) ? str(resource.resourceType) : "Resource";
  w.resource(resource, root);
  if (isObj(resource)) {
    applyProfiles(resource, opts && opts.profiles, w, root);
    if (resource.resourceType === "Bundle" && Array.isArray(resource.entry)) {
      resource.entry.forEach((e, i) => { if (isObj(e) && isObj(e.resource)) applyProfiles(e.resource, opts && opts.profiles, w, `Bundle.entry[${i}].resource`); });
    }
  }
  return { valid: !w.issues.some((i) => i.severity === "error" || i.severity === "fatal"), issues: w.issues, codings: w.codings };
}

/** PURE. An OperationOutcome for a validation result. An empty result says so, in FHIR's own idiom. */
function validationOutcome(result) {
  const issues = result.issues.length ? result.issues : [{ severity: "information", code: "informational", diagnostics: "All OK" }];
  return { resourceType: "OperationOutcome", issue: issues };
}

/** The types this file validates, for the CapabilityStatement. */
const VALIDATED_TYPES = Object.freeze(Object.keys(RESOURCES));

export { PRIMITIVES, VS, REQUIRED_CC, TYPES, RESOURCES, VALIDATED_TYPES, parseKey, validateResource, validationOutcome, applyProfiles, valuesAt };
