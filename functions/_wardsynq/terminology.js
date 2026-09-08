/* functions/_wardsynq/terminology.js - the vocabularies WardSynQ genuinely knows. PURE.
 *
 * Every code system this codebase names lived in three places: fhir.js's SYSTEM_URI, the vitals
 * migration's LOINC table and the GHIS adapter's laboratory seed. Three copies of "what does LOINC
 * mean" drift, and the one that drifts is the one an exchange partner reads. This is the one place.
 *
 * TWO DIFFERENT THINGS ARE KEPT APART HERE, AND THE WHOLE FILE IS ABOUT THE DIFFERENCE:
 *
 *   A SYSTEM is a published vocabulary with a canonical URI - LOINC, SNOMED CT, ICD-10, RxNorm,
 *   UCUM. Recognising that "loinc" means http://loinc.org is not inventing anything: the URI is
 *   HL7's, and a receiver that sees it knows exactly what it is being told.
 *
 *   A CODE is a specific concept in one of those systems. WardSynQ knows a code only when a human
 *   put it in a seed table with its display - the vitals LOINC codes and the laboratory panel seed.
 *   Nothing here derives a code from a word, a word from a code, or a code in one system from a
 *   code in another. `isKnown()` answers "did somebody verify this"; it never answers "is this a
 *   valid LOINC code", because this build carries no LOINC release and cannot.
 *
 * UNMAPPED IS A STATE, NOT AN ABSENCE. When a record arrives from another system carrying a coding
 * WardSynQ cannot verify, the coding is kept VERBATIM - system, code, display - and the record is
 * marked `terminologyStatus: "unmapped"`. It is not dropped, not replaced with a guess, and not
 * silently promoted to a coding we vouch for. On export the source coding goes out under its own
 * system URI when that system is a real URI, so the receiver sees exactly what the sender said and
 * exactly what we did not vouch for.
 */

import { VITAL_CODES } from "./migrate-vitals.js";
import { LAB_CODE_SEED } from "../../wardsynq/adapters/wardsynq-ghis-adapter.js";

const str = (v) => (v == null ? "" : String(v).trim());

/**
 * Published code systems, keyed by every alias this codebase has used for them. The URIs are the
 * ones HL7 and the system owners publish; none is ours.
 */
const SYSTEMS = Object.freeze({
  loinc: { uri: "http://loinc.org", name: "LOINC" },
  "http://loinc.org": { uri: "http://loinc.org", name: "LOINC" },
  snomed: { uri: "http://snomed.info/sct", name: "SNOMED CT" },
  "snomed-ct": { uri: "http://snomed.info/sct", name: "SNOMED CT" },
  sct: { uri: "http://snomed.info/sct", name: "SNOMED CT" },
  "http://snomed.info/sct": { uri: "http://snomed.info/sct", name: "SNOMED CT" },
  "icd-10": { uri: "http://hl7.org/fhir/sid/icd-10", name: "ICD-10" },
  icd10: { uri: "http://hl7.org/fhir/sid/icd-10", name: "ICD-10" },
  "http://hl7.org/fhir/sid/icd-10": { uri: "http://hl7.org/fhir/sid/icd-10", name: "ICD-10" },
  "icd-10-cm": { uri: "http://hl7.org/fhir/sid/icd-10-cm", name: "ICD-10-CM" },
  "http://hl7.org/fhir/sid/icd-10-cm": { uri: "http://hl7.org/fhir/sid/icd-10-cm", name: "ICD-10-CM" },
  "icd-11": { uri: "http://id.who.int/icd/release/11/mms", name: "ICD-11 MMS" },
  icd11: { uri: "http://id.who.int/icd/release/11/mms", name: "ICD-11 MMS" },
  "http://id.who.int/icd/release/11/mms": { uri: "http://id.who.int/icd/release/11/mms", name: "ICD-11 MMS" },
  rxnorm: { uri: "http://www.nlm.nih.gov/research/umls/rxnorm", name: "RxNorm" },
  "http://www.nlm.nih.gov/research/umls/rxnorm": { uri: "http://www.nlm.nih.gov/research/umls/rxnorm", name: "RxNorm" },
  atc: { uri: "http://www.whocc.no/atc", name: "ATC" },
  "http://www.whocc.no/atc": { uri: "http://www.whocc.no/atc", name: "ATC" },
  ucum: { uri: "http://unitsofmeasure.org", name: "UCUM" },
  "http://unitsofmeasure.org": { uri: "http://unitsofmeasure.org", name: "UCUM" },
  ndc: { uri: "http://hl7.org/fhir/sid/ndc", name: "NDC" },
  "http://hl7.org/fhir/sid/ndc": { uri: "http://hl7.org/fhir/sid/ndc", name: "NDC" },
});

/** Values the canonical model uses to mean "nobody gave us a coding". Honest in their own files. */
const UNCODED = Object.freeze(["", "unspecified", "text", "ghis-local", "wardsynq-fluid", "local", "unmapped"]);

/** The marker a record carries when it holds a coding WardSynQ could not verify. */
const UNMAPPED = "unmapped";

/**
 * Identifier systems. `mrn` is OURS - a URN in a namespace we own for a number we assign - and so
 * not an invented vocabulary. ABHA is the NDHM-published system for the Ayushman Bharat Health
 * Account; it is included because the canonical model already carries ABHA identifiers by name.
 */
const IDENTIFIER_SYSTEMS = (() => {
  const mrn = { key: "mrn", uri: "urn:stewardmd:mrn", typeCode: "MR", typeText: "Medical record number" };
  const abha = { key: "abha", uri: "https://healthid.ndhm.gov.in", typeCode: "NI", typeText: "ABHA number" };
  const ticket = { key: "opd-ticket-id", uri: "urn:stewardmd:opd-ticket", typeCode: "VN", typeText: "Visit number" };
  const ghis = { key: "ghis-episode-id", uri: "urn:stewardmd:ghis-episode", typeCode: "VN", typeText: "GHIS episode" };
  // Keyed by every spelling this codebase and a FHIR partner use, INCLUDING the URI itself, so an
  // identifier that arrives under its published system is recognised as the same thing.
  return Object.freeze({ mrn, [mrn.uri]: mrn, abha, [abha.uri]: abha, "opd-ticket-id": ticket, [ticket.uri]: ticket, "ghis-episode-id": ghis, [ghis.uri]: ghis });
})();

/**
 * PURE. The canonical key for an identifier system, so "ABHA", "abha" and the NDHM URI compare
 * equal when two patients are reconciled. An unknown system is its own slug - two different unknown
 * systems never compare equal, and nothing is guessed to be the same.
 */
function identifierKey(system) {
  const s = str(system);
  if (!s) return "";
  const hit = IDENTIFIER_SYSTEMS[s] || IDENTIFIER_SYSTEMS[s.toLowerCase()];
  return hit ? hit.key : s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** PURE. The canonical URI for a system alias or URI, or null when WardSynQ does not know it. */
function systemUri(aliasOrUri) {
  const s = str(aliasOrUri);
  if (!s || UNCODED.includes(s.toLowerCase())) return null;
  const hit = SYSTEMS[s] || SYSTEMS[s.toLowerCase()];
  return hit ? hit.uri : null;
}

/** PURE. Whether a string is an absolute URI, which is the only kind FHIR accepts as a system. */
function isUri(v) {
  return /^(https?:\/\/|urn:)[^\s]+$/i.test(str(v));
}

/**
 * The codes a human verified. LOINC only, today: the vitals table and the laboratory seed. Built
 * once from the two tables that already exist, so there is no third copy to drift.
 */
const KNOWN = (() => {
  const loinc = new Map();
  for (const k of Object.keys(VITAL_CODES || {})) {
    const v = VITAL_CODES[k];
    if (v && v.code) loinc.set(str(v.code), { display: v.display || null, unit: v.unit || null });
  }
  for (const k of Object.keys(LAB_CODE_SEED || {})) {
    const v = LAB_CODE_SEED[k];
    if (v && v.code && !loinc.has(str(v.code))) loinc.set(str(v.code), { display: v.display || null, unit: null });
  }
  return Object.freeze({ "http://loinc.org": loinc });
})();

/** PURE. Did somebody in this codebase verify this exact code in this exact system. */
function isKnown(system, code) {
  const uri = systemUri(system);
  const table = uri && KNOWN[uri];
  return !!(table && table.has(str(code)));
}

/** PURE. The verified display for a known code, or null. Never a guess. */
function displayOf(system, code) {
  const uri = systemUri(system);
  const table = uri && KNOWN[uri];
  const hit = table && table.get(str(code));
  return hit ? hit.display : null;
}

/**
 * PURE. The fields a canonical record carries for a coding WardSynQ could not verify.
 *
 * The record's own `code` is the source's code (so a search by that code still works within the
 * source's meaning) and its `codeSystem` is UNMAPPED, which every export treats as uncoded. The
 * original coding is kept verbatim beside it. Nothing here consults a table: by definition this is
 * the case where no table had an answer.
 */
function unmappedCoding(sourceSystem, code, display) {
  return {
    code: str(code) || null,
    codeSystem: UNMAPPED,
    display: str(display) || str(code) || null,
    terminologyStatus: UNMAPPED,
    sourceCoding: { system: str(sourceSystem) || null, code: str(code) || null, display: str(display) || null },
  };
}

/**
 * PURE. Classifies an incoming coding: `verified` (a system we know AND a code somebody checked),
 * `recognised` (a system we know, a code we have no table for - kept under that system, because
 * the SYSTEM is the sender's claim and it is a real one), or `unmapped` (a system we do not know).
 */
function classifyCoding(system, code) {
  const uri = systemUri(system);
  if (!uri) return { status: UNMAPPED, uri: null };
  if (isKnown(uri, code)) return { status: "verified", uri };
  return { status: "recognised", uri };
}

/** How many codes this build has verified, per system. Stated in the CapabilityStatement, so a
 *  partner knows the vocabulary is thin before they discover it. */
function coverage() {
  return Object.fromEntries(Object.entries(KNOWN).map(([uri, m]) => [uri, m.size]));
}

export { SYSTEMS, UNCODED, UNMAPPED, IDENTIFIER_SYSTEMS, KNOWN, systemUri, isUri, isKnown, displayOf, unmappedCoding, classifyCoding, coverage, identifierKey };
