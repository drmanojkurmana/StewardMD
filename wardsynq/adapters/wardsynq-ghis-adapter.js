/* wardsynq/adapters/wardsynq-ghis-adapter.js — GHIS (Ward Sync) -> WardSynQ canonical model.
 *
 * The first adapter of the Integration Hub, and the reference implementation for every one that
 * follows (HL7 v2, FHIR R4, DICOMweb, LIS, ABDM, IoMT). It converts what the GIMSR GHIS bridge
 * returns into canonical entities and announces them on the Clinical Event Bus. Nothing downstream
 * of the bus knows GHIS exists.
 *
 *   GHIS bridge -> THIS FILE -> canonical model -> Clinical Event Bus -> safety / eMAR / EMR
 *
 * PURE MAPPING. This file performs no fetching, holds no session or token, and touches no live
 * StewardMD state. `ghis-ward.js` still owns the transport, the GHIS bearer token, the 401 silent
 * refresh and the patient picker; this file starts from a bundle that has already been fetched.
 * That split is deliberate: transport and auth are the part most likely to change per site, and
 * mapping is the part that has to be verifiable in a test without a network.
 *
 * THREE TRAPS IN THE SOURCE DATA, all found by surveying the live code on 2026-09-04. Each has
 * caused, or could cause, a wrong clinical value:
 *
 *  1. `dob` IS NOT A DATE OF BIRTH. GHIS sends age in years as a string ("45"). Anything that
 *     parses it as a date gets a patient born in the year 45. Age drives weight-based paediatric
 *     dosing, so a fabricated date of birth here is a dosing hazard, not a cosmetic bug. This
 *     adapter refuses to synthesise a date of birth from an age: it records `ageYears` and leaves
 *     `dob` as the explicit sentinel.
 *  2. `wardToSI` in icu.js does NOT convert to SI despite its name; it converts an SI-labelled
 *     result back to conventional units. Unit handling is therefore NOT replicated here. This
 *     adapter stores the value and unit exactly as reported and flags anything it cannot identify,
 *     because a silently mis-converted electrolyte is worse than an unconverted one.
 *  3. `patientId` doubles as the MRN. There is no separate UHID in the payload.
 *
 * Everything the source said is preserved on each entity under `source*` fields, so a mapping
 * mistake is always recoverable from the record itself rather than needing a re-fetch.
 */

import { Patient, Encounter, Observation, DiagnosticReport } from "../wardsynq-model.js";

const SYSTEM = "ghis";

/** Age is not a birth date. Reused from the MPI's provisional-identity convention. */
const UNKNOWN_DOB = "0000-00-00";

/**
 * GHIS test name to a canonical code, seeded from the vocabulary WARD_LAB_MAP already recognises
 * in icu.js. Deliberately small and exact-match-on-normalised-name rather than a regex cascade:
 * the icu.js version is a first-match-wins regex scan whose ordering is load-bearing, and copying
 * that subtlety here would mean two divergent copies of it. Anything unmapped keeps its original
 * name and is reported in `issues`, never dropped.
 *
 * LOINC codes are the common ones and are UNVERIFIED. They need a terminology review before this
 * pack is trusted for interoperability; they are not used for any safety decision today.
 *
 * WIDENED 2026-09-06, closing the coverage gap PR #862's real-device shadow run surfaced (30 of 37
 * observed lab observations came back GHIS_LAB_UNMAPPED). The real test NAMES from that run were
 * never captured — deliberately, to keep anything from a live session out of a transcript — so this
 * is not a replay of that exact bundle. Instead: every analyte `icu.js WARD_LAB_MAP` already
 * recognises (the SAME vocabulary this seed pack was originally drawn from, already trusted in
 * production by the ICU flowsheet) was checked against what this pack was still missing, and only
 * the ones with a single, unambiguous serum/plasma LOINC code were added. Same UNVERIFIED status as
 * every entry above: standard, well-established assignments, not cross-checked against a live
 * terminology service.
 *
 * TWO WARD_LAB_MAP KEYS DELIBERATELY LEFT OUT, both genuinely ambiguous rather than merely obscure:
 *   hco3   "Bicarbonate" and "TCO2" carry DIFFERENT LOINC codes depending on whether the report
 *          means measured venous bicarbonate or calculated total CO2, and a bare test name does not
 *          say which. Guessing either would be exactly the fabricated-code risk this file exists to
 *          avoid. Stays ghis-local.
 *   neut   "Neutrophils" alone does not say percent (770-8) or absolute count (751-8) — different
 *          codes, and GHIS's own report format for this was never seen to disambiguate. Stays
 *          ghis-local.
 */
const LAB_CODE_SEED = Object.freeze({
  sodium: { code: "2951-2", display: "Sodium" },
  na: { code: "2951-2", display: "Sodium" },
  potassium: { code: "2823-3", display: "Potassium" },
  k: { code: "2823-3", display: "Potassium" },
  chloride: { code: "2075-0", display: "Chloride" },
  creatinine: { code: "2160-0", display: "Creatinine" },
  urea: { code: "3094-0", display: "Urea nitrogen" },
  glucose: { code: "2345-7", display: "Glucose" },
  haemoglobin: { code: "718-7", display: "Haemoglobin" },
  hemoglobin: { code: "718-7", display: "Haemoglobin" },
  hb: { code: "718-7", display: "Haemoglobin" },
  platelet: { code: "777-3", display: "Platelets" },
  "platelet count": { code: "777-3", display: "Platelets" },
  wbc: { code: "6690-2", display: "Leukocytes" },
  "total leucocyte count": { code: "6690-2", display: "Leukocytes" },
  bilirubin: { code: "1975-2", display: "Bilirubin total" },
  ast: { code: "1920-8", display: "AST" },
  alt: { code: "1742-6", display: "ALT" },
  albumin: { code: "1751-7", display: "Albumin" },
  crp: { code: "1988-5", display: "C-reactive protein" },
  lactate: { code: "2524-7", display: "Lactate" },
  inr: { code: "6301-6", display: "INR" },
  // Total (serum/plasma) calcium — bare "Calcium" with no urine/24-hour/ionised qualifier, the
  // SAME assumption WARD_LAB_MAP's own "ca" key already makes (its exclusion guard only fires on
  // an explicit "urin"/"ionis"/"ioniz"/"free" qualifier in the name).
  calcium: { code: "17861-6", display: "Calcium" },
  // Ionised/free calcium is its OWN analyte (~1.1 mmol/L), a different LOINC from total calcium
  // above — matches WARD_LAB_MAP's separate "ica" key, checked before "ca" there for the same reason.
  "ionised calcium": { code: "1994-3", display: "Calcium.ionized" },
  "ionized calcium": { code: "1994-3", display: "Calcium.ionized" },
  magnesium: { code: "19123-9", display: "Magnesium" },
  // "Phosphate" and "Phosphorus" name the SAME serum analyte in Indian lab reports; both point at
  // the one LOINC code WARD_LAB_MAP's "po4" key already covers.
  phosphate: { code: "2777-1", display: "Phosphate" },
  phosphorus: { code: "2777-1", display: "Phosphate" },
  // Direct (conjugated) bilirubin — a DIFFERENT LOINC from the total-bilirubin entry above, matching
  // WARD_LAB_MAP's separate "bili_d" key (checked before its own "bili" for the same reason).
  "direct bilirubin": { code: "1968-7", display: "Bilirubin direct" },
  "conjugated bilirubin": { code: "1968-7", display: "Bilirubin direct" },
  "alkaline phosphatase": { code: "6768-6", display: "Alkaline phosphatase" },
  alp: { code: "6768-6", display: "Alkaline phosphatase" },
  amylase: { code: "1798-8", display: "Amylase" },
  lipase: { code: "3040-3", display: "Lipase" },
  procalcitonin: { code: "33959-8", display: "Procalcitonin" },
  pct: { code: "33959-8", display: "Procalcitonin" },
  haematocrit: { code: "4544-3", display: "Haematocrit" },
  hematocrit: { code: "4544-3", display: "Haematocrit" },
  pcv: { code: "4544-3", display: "Haematocrit" },
});

const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "");

/**
 * Deterministic id for an ingested entity.
 *
 * Stability is the whole point: a re-sync, a reconnect or an offline replay must produce the SAME
 * id for the same source record, so the store's append-only history shows one entity with versions
 * rather than a pile of duplicates, and the event bus can deduplicate by id. Built only from
 * source-stable parts, never from a timestamp of ingestion.
 */
function sourceId(kind, ...parts) {
  const tail = parts.map((p) => String(p == null ? "" : p).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")).join("--");
  return `${SYSTEM}-${kind}-${tail}`;
}

/**
 * Parses the GHIS `DD-MON-YYYY[ HH:MM]` date form into an ISO string.
 * Mirrors what parseWardDate in icu.js accepts, including its 08:00 default when no time is given,
 * because a lab drawn "on the 3rd" with no time must not silently become midnight UTC and land on
 * the previous day in a different timezone.
 * @returns {string|null} ISO string, or null when unrecognised (never a guess)
 */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseGhisDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) return null;
    const d = new Date(Date.UTC(+m[3], month, +m[1], m[4] === undefined ? 8 : +m[4], m[5] === undefined ? 0 : +m[5]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** GHIS sends "M" / "F" / "" and free text. Anything unrecognised stays unknown rather than guessed. */
function mapSex(value) {
  const c = norm(value).charAt(0);
  if (c === "m") return "male";
  if (c === "f") return "female";
  return "unknown";
}

/**
 * Maps the GHIS patient block to a canonical Patient.
 *
 * `ageYears` is carried as its own field and `dob` is left as the sentinel. See trap 1 in the file
 * header: inventing a birth date from an age would give downstream paediatric dosing a precise
 * looking value that is up to a year wrong, and nothing downstream could tell it was derived.
 */
function toPatient(bundle, issues) {
  const p = (bundle && bundle.patient) || {};
  const patientId = bundle.patientId != null ? String(bundle.patientId) : (p.mrn != null ? String(p.mrn) : null);
  if (!patientId) {
    issues.push({ code: "GHIS_NO_PATIENT_ID", message: "bundle has no patientId; cannot build a patient identity" });
    return null;
  }

  // GHIS puts the whole display name in patientFirstName and has no separate surname field.
  const name = String(p.name || bundle.patientFirstName || "").trim();
  if (!name) issues.push({ code: "GHIS_NO_NAME", message: `patient ${patientId} has no name in the bundle` });

  const rawAge = p.age != null ? p.age : bundle.dob; // GHIS `dob` is an age. See trap 1.
  const ageYears = rawAge == null || rawAge === "" ? null : Number.parseInt(String(rawAge), 10);
  if (rawAge != null && rawAge !== "" && !Number.isFinite(ageYears)) {
    issues.push({ code: "GHIS_AGE_UNPARSEABLE", message: `patient ${patientId} age "${rawAge}" could not be parsed` });
  }

  const patient = Patient({
    id: sourceId("pat", patientId),
    mrn: patientId, // trap 3: patientId IS the MRN, there is no separate UHID
    name: name || `GHIS patient ${patientId}`,
    dob: UNKNOWN_DOB,
    sex: mapSex(p.sex || bundle.gender),
    identifiers: [{ system: "ghis-patient-id", value: patientId }],
    source: { system: SYSTEM, sourceId: patientId },
  });

  // Explicitly denormalised extras. Named so nothing mistakes them for a precise value.
  patient.ageYears = Number.isFinite(ageYears) ? ageYears : null;
  patient.dobIsUnknown = true;
  patient.sourceBed = p.bed || bundle.bedName || null;
  patient.sourceDepartment = p.dept || bundle.deptDescription || null;
  patient.sourceTreatingDoctor = p.doctor || bundle.employeeFirstName || null;
  return patient;
}

/** Maps the GHIS episode to an Encounter. An episode is a visit, not a patient. */
function toEncounter(bundle, patient, issues) {
  if (!bundle.episodeId) return null;
  const dept = norm((bundle.patient && bundle.patient.dept) || bundle.deptDescription);
  return Encounter({
    id: sourceId("enc", bundle.episodeId),
    patientId: patient.id,
    // GHIS says which ward in free text and does not state a care setting. ICU is inferable from
    // the department name; anything else is recorded as IPD rather than guessed more precisely.
    class: /icu|critical|itu/.test(dept) ? "ICU" : "IPD",
    status: "in-progress",
    location: { facilityId: "gimsr", ward: (bundle.patient && bundle.patient.dept) || bundle.deptDescription || null, bed: (bundle.patient && bundle.patient.bed) || bundle.bedName || null },
    identifiers: [{ system: "ghis-episode-id", value: String(bundle.episodeId) }],
    source: { system: SYSTEM, sourceId: String(bundle.episodeId) },
  });
}

/**
 * Maps GHIS lab rows to canonical Observations.
 *
 * Values are stored AS REPORTED with the unit as reported. See trap 2: the existing wardToSI is
 * not a unit normaliser and re-deriving one here, unreviewed, would risk silently altering
 * electrolyte values. The raw test name, value and unit are always preserved so a later, reviewed
 * normalisation can run over stored data without a re-fetch.
 */
function toObservations(bundle, patient, encounter, issues) {
  const out = [];
  for (const row of bundle.labs || []) {
    const testName = String(row.test || "").trim();
    if (!testName) {
      issues.push({ code: "GHIS_LAB_NO_NAME", message: "a lab row had no test name and was skipped" });
      continue;
    }
    const numeric = Number.parseFloat(row.result);
    const mapped = LAB_CODE_SEED[norm(testName)] || null;
    if (!mapped) {
      issues.push({ code: "GHIS_LAB_UNMAPPED", message: `no canonical code for "${testName}"`, testName });
    }
    const effectiveAt = parseGhisDate(row.date) || (bundle.ts ? new Date(bundle.ts).toISOString() : undefined);
    if (row.date && !parseGhisDate(row.date)) {
      issues.push({ code: "GHIS_LAB_DATE_UNPARSEABLE", message: `could not parse lab date "${row.date}" for "${testName}"`, testName });
    }

    const obs = Observation({
      id: sourceId("obs", patient.mrn, testName, row.date || bundle.ts || ""),
      patientId: patient.id,
      encounterId: encounter ? encounter.id : null,
      category: "laboratory",
      code: mapped ? mapped.code : testName,
      codeSystem: mapped ? "LOINC" : "ghis-local",
      value: Number.isFinite(numeric) ? numeric : (row.result != null ? String(row.result) : null),
      unit: row.units || null,
      effectiveAt,
      source: { system: SYSTEM, sourceId: String(row.order || row.renderId || testName) },
    });

    // Everything the source said, kept verbatim. A mapping error must be recoverable from the
    // record rather than requiring the source system to still be reachable.
    obs.sourceTestName = testName;
    obs.sourceValue = row.result != null ? String(row.result) : null;
    obs.sourceUnit = row.units || null;
    obs.unitNormalised = false; // see trap 2
    obs.referenceRange = (row.low != null || row.high != null)
      ? { low: row.low != null ? Number.parseFloat(row.low) : null, high: row.high != null ? Number.parseFloat(row.high) : null, text: row.range || null }
      : (row.range ? { low: null, high: null, text: row.range } : null);
    // GHIS flags criticality itself. Trusted as a flag, but it does NOT drive any hard-stop here:
    // critical-value escalation is a clinical control that belongs to the safety engine.
    obs.sourceCritical = !!row.critical;
    if (!Number.isFinite(numeric)) {
      obs.nonNumeric = true; // e.g. "NOT DETECTED", ">10.0". Kept, never coerced to a number.
    }
    out.push(obs);
  }
  return out;
}

/** Maps GHIS radiology reports to canonical DiagnosticReports. */
function toDiagnosticReports(bundle, patient, encounter, issues) {
  const out = [];
  for (const row of bundle.imaging || []) {
    const name = String(row.studyName || row.testName || "").trim();
    if (!name) {
      issues.push({ code: "GHIS_IMAGING_NO_NAME", message: "an imaging row had no study name and was skipped" });
      continue;
    }
    const effectiveAt = parseGhisDate(row.date) || undefined;
    const report = DiagnosticReport({
      id: sourceId("dr", patient.mrn, row.reportId || row.resultid || name, row.date || ""),
      patientId: patient.id,
      encounterId: encounter ? encounter.id : null,
      code: name,
      // GHIS marks whether a study has been reported; an unreported study is preliminary, and
      // treating it as final would let an unread scan look like a signed-off result.
      status: row.reported ? "final" : "preliminary",
      conclusion: row.report || null,
      effectiveAt,
      source: { system: SYSTEM, sourceId: String(row.reportId || row.resultid || name) },
    });
    report.sourceStudyName = name;
    report.sourceReportedBy = row.doctor || null;
    report.sourceEnteredBy = row.enteredBy || null;
    out.push(report);
  }
  return out;
}

/**
 * Converts a fetched GHIS bundle into canonical entities. PURE: returns what it built and does not
 * persist or emit. `ingestGhisBundle` is the side-effecting wrapper.
 *
 * @param {object} bundle as assembled by ghis-ward.js
 * @returns {{patient: object|null, encounter: object|null, observations: object[],
 *   reports: object[], issues: object[]}}
 *   `issues` is never thrown on. A partially mappable bundle should yield the parts that mapped
 *   plus a list of what did not, because dropping a whole ward's labs over one unparseable row is
 *   its own clinical risk.
 */
function mapGhisBundle(bundle) {
  const issues = [];
  if (!bundle || typeof bundle !== "object") {
    return { patient: null, encounter: null, observations: [], reports: [], issues: [{ code: "GHIS_NO_BUNDLE", message: "no bundle supplied" }] };
  }
  const patient = toPatient(bundle, issues);
  if (!patient) return { patient: null, encounter: null, observations: [], reports: [], issues };
  const encounter = toEncounter(bundle, patient, issues);
  return {
    patient,
    encounter,
    observations: toObservations(bundle, patient, encounter, issues),
    reports: toDiagnosticReports(bundle, patient, encounter, issues),
    issues,
  };
}

/**
 * Maps a bundle and announces it. This is the Integration Hub entry point.
 *
 * Events carry the entity's own stable id, so the bus deduplicates a replayed bundle rather than
 * reprocessing it (see the idempotency contract in wardsynq-events.js). Persistence is optional:
 * pass a ClinicalStore to write, omit it to only announce.
 *
 * @param {object} bundle
 * @param {{bus?: object, store?: object}} [deps]
 */
async function ingestGhisBundle(bundle, deps) {
  deps = deps || {};
  const mapped = mapGhisBundle(bundle);
  if (!mapped.patient) {
    if (deps.bus) await deps.bus.emit("adapter.ingest.failed", { system: SYSTEM, issues: mapped.issues });
    return mapped;
  }

  const entities = [mapped.patient, mapped.encounter, ...mapped.observations, ...mapped.reports].filter(Boolean);

  if (deps.store) {
    // One transaction: a half-written ward import is a chart that disagrees with itself.
    await deps.store.transaction(async (tx) => {
      for (const entity of entities) await tx.put(entity);
    });
  }

  if (deps.bus) {
    for (const entity of entities) {
      await deps.bus.emit(`adapter.ingest.${entity.resourceType}`, { system: SYSTEM, entity }, { id: `ingest-${entity.id}-${entity.meta.recordedAt}` });
    }
    if (mapped.issues.length) {
      await deps.bus.emit("adapter.ingest.issues", { system: SYSTEM, patientId: mapped.patient.id, issues: mapped.issues });
    }
  }

  return mapped;
}

export {
  SYSTEM, UNKNOWN_DOB, LAB_CODE_SEED,
  mapGhisBundle, ingestGhisBundle,
  toPatient, toEncounter, toObservations, toDiagnosticReports,
  parseGhisDate, mapSex, sourceId,
};
