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
import { VS } from "./fhir-validate.js";
import { IDENTIFIER_SYSTEMS, identifierKey } from "./identity-key.js";

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
const UNCODED = Object.freeze(["", "unspecified", "text", "ghis-local", "wardsynq-fluid", "local", "unmapped", "invalid"]);

/** The marker a record carries when it holds a coding WardSynQ could not verify. */
const UNMAPPED = "unmapped";

/**
 * Identifier systems. `mrn` is OURS - a URN in a namespace we own for a number we assign - and so
 * not an invented vocabulary. ABHA is the NDHM-published system for the Ayushman Bharat Health
 * Account; it is included because the canonical model already carries ABHA identifiers by name.
 */
/* THE TABLE AND THE KEY FUNCTION MOVED DOWN to identity-key.js on 2026-09-10, and are re-exported
 * here unchanged so every existing importer of this file is untouched.
 *
 * They had to move because the patient-identifier INDEX now canonicalises a system at write time,
 * inside the storage port, and this file cannot be imported from there: it pulls the vitals codes,
 * the GHIS lab seed and the FHIR validator behind it. An index and its matcher that canonicalise
 * differently is the worst kind of wrong - it answers confidently, and it answers "no such patient"
 * for somebody who is right there - so there is now exactly one definition, in a file with no
 * imports at all. See identity-key.js's own header. */

/** PURE. The canonical URI for a system alias or URI, or null when WardSynQ does not know it. */
function systemUri(aliasOrUri) {
  const s = str(aliasOrUri);
  if (!s || UNCODED.includes(s.toLowerCase())) return null;
  const hit = SYSTEMS[s] || SYSTEMS[s.toLowerCase()];
  if (hit) return hit.uri;
  return HL7[s] ? s : null;
}

/** PURE. Whether a string is an absolute URI, which is the only kind FHIR accepts as a system. */
function isUri(v) {
  return /^(https?:\/\/|urn:)[^\s]+$/i.test(str(v));
}

/**
 * HL7's OWN code systems - the ones FHIR itself defines and this server emits or validates against.
 * Their URIs and codes are HL7's, published with the specification; listing them is not inventing
 * a vocabulary, it is knowing the specification. The codes are the R4 value sets in fhir-validate.js
 * plus the handful of v2/v3 codes this server emits, so a partner's `$validate-code` on them, and
 * our own export, get a real answer rather than "unknown system".
 */
const HL7 = Object.freeze({
  "http://terminology.hl7.org/CodeSystem/condition-clinical": { name: "Condition Clinical Status", codes: VS.conditionClinical },
  "http://terminology.hl7.org/CodeSystem/condition-ver-status": { name: "Condition Verification Status", codes: VS.conditionVer },
  "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical": { name: "AllergyIntolerance Clinical Status", codes: VS.allergyClinical },
  "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification": { name: "AllergyIntolerance Verification Status", codes: VS.allergyVer },
  "http://terminology.hl7.org/CodeSystem/observation-category": { name: "Observation Category", codes: "social-history|vital-signs|imaging|laboratory|procedure|survey|exam|therapy|activity" },
  "http://terminology.hl7.org/CodeSystem/consentscope": { name: "Consent Scope", codes: "adr|research|patient-privacy|treatment" },
  "http://terminology.hl7.org/CodeSystem/consentcategorycodes": { name: "Consent Category", codes: "acd|dnr|emrgonly|hcd|npp|polst|research|rsdid|rsreid" },
  "http://terminology.hl7.org/CodeSystem/v3-ActCode": { name: "HL7 v3 ActCode", codes: "AMB|EMER|FLD|HH|IMP|ACUTE|NONAC|OBSENC|PRENC|SS|VR" },
  "http://terminology.hl7.org/CodeSystem/v2-0203": { name: "HL7 v2 Identifier Type", codes: "MR|NI|VN|PI|PN|PPN|DL|SS|TAX|MB|PRN|EN|ACSN|FILL|PLAC|UDI|SNO|MD|RI" },
  "http://terminology.hl7.org/CodeSystem/v3-DataOperation": { name: "HL7 v3 DataOperation", codes: "CREATE|UPDATE|DELETE|APPEND|NULLIFY|EXECUTE|OPERATE|READ" },
  "http://terminology.hl7.org/CodeSystem/provenance-participant-type": { name: "Provenance Participant Type", codes: "enterer|performer|author|verifier|legal|attester|informant|custodian|assembler|composer" },
  "http://terminology.hl7.org/CodeSystem/v3-ObservationValue": { name: "HL7 v3 ObservationValue", codes: "SUBSETTED|REDACTED|SYNTHETIC|MASKED" },
  "http://terminology.hl7.org/CodeSystem/restful-security-service": { name: "RESTful Security Service", codes: "OAuth|SMART-on-FHIR|NTLM|Basic|Kerberos|Certificates" },
  "http://terminology.hl7.org/CodeSystem/medication-admin-status": { name: "Medication Administration Status", codes: VS.adminStatus },
  "http://hl7.org/fhir/observation-status": { name: "Observation Status", codes: VS.observationStatus },
  "http://hl7.org/fhir/encounter-status": { name: "Encounter Status", codes: VS.encounterStatus },
  "http://hl7.org/fhir/CodeSystem/medicationrequest-status": { name: "MedicationRequest Status", codes: VS.rxStatus },
  "http://hl7.org/fhir/CodeSystem/medicationrequest-intent": { name: "MedicationRequest Intent", codes: VS.rxIntent },
  "http://hl7.org/fhir/request-status": { name: "Request Status", codes: VS.srStatus },
  "http://hl7.org/fhir/request-intent": { name: "Request Intent", codes: VS.srIntent },
  "http://hl7.org/fhir/diagnostic-report-status": { name: "DiagnosticReport Status", codes: VS.drStatus },
  "http://hl7.org/fhir/document-reference-status": { name: "DocumentReference Status", codes: VS.docStatus },
  "http://hl7.org/fhir/composition-status": { name: "Composition Status", codes: VS.compStatus },
  "http://hl7.org/fhir/consent-state-codes": { name: "Consent State", codes: VS.consentStatus },
  "http://hl7.org/fhir/administrative-gender": { name: "Administrative Gender", codes: VS.gender },
  "http://hl7.org/fhir/allergy-intolerance-criticality": { name: "AllergyIntolerance Criticality", codes: VS.criticality },
});

/**
 * The codes a human verified: LOINC from the vitals table and the laboratory seed, and HL7's own
 * code systems from the specification. Built once from tables that already exist, so there is no
 * third copy to drift.
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
  const out = { "http://loinc.org": loinc };
  for (const [uri, sys] of Object.entries(HL7)) out[uri] = new Map(sys.codes.split("|").map((c) => [c, { display: null, unit: null }]));
  return Object.freeze(out);
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

/* ---- the terminology validation service -------------------------------------------------------
 *
 * THREE SOURCES, IN ORDER, AND EACH SAYS WHICH IT WAS. (1) the seed tables above - codes a human in
 * this codebase verified; (2) the hospital's own code lists under wardsynq.terminology.codeSystems
 * - the LOINC subset their laboratory really reports, the ICD-10 chapter their coders use, loaded by
 * them; (3) an external terminology server the hospital configured (wardsynq.terminology.server),
 * asked through the hardened fetch, its answers cached. A code none of them can vouch for is
 * `recognised` when its system is a real one and `unmapped` when it is not; a code the server says
 * DOES NOT EXIST is `invalid`. Nothing is ever promoted by guessing, and NOTHING IS EVER REJECTED
 * BECAUSE A NETWORK BLINKED: an unreachable server yields `recognised` with a note, never `invalid`.
 */

/** The marker a record carries when a coding was checked and found not to exist in its system. */
const INVALID = "invalid";

/** Module-level answer cache, per isolate. KV, when bound as WSQ_TX_KV, is the shared one. */
const TX_MEMORY = new Map();
const TX_TTL_MS = 24 * 3600000;
const TX_TIMEOUT_MS = 3000;

function txCache(kv) {
  if (kv && typeof kv.get === "function" && typeof kv.put === "function") {
    return {
      kind: "kv",
      async get(key) { try { const s = await kv.get(key); return s ? JSON.parse(s) : null; } catch { return null; } },
      async put(key, value) { try { await kv.put(key, JSON.stringify(value), { expirationTtl: Math.ceil(TX_TTL_MS / 1000) }); } catch { /* a cache that cannot write changes no answer */ } },
    };
  }
  return {
    kind: "memory",
    async get(key) { const v = TX_MEMORY.get(key); if (!v) return null; if (v.expiresAt <= Date.now()) { TX_MEMORY.delete(key); return null; } return v.value; },
    async put(key, value) { TX_MEMORY.set(key, { value, expiresAt: Date.now() + TX_TTL_MS }); },
  };
}
function resetTxCache() { TX_MEMORY.clear(); }

/** PURE. The hospital's own verified code lists: { [systemUriOrAlias]: { [code]: display } }. */
function orgKnown(config, uri, code) {
  const lists = config && config.codeSystems && typeof config.codeSystems === "object" ? config.codeSystems : null;
  if (!lists) return null;
  for (const [sys, codes] of Object.entries(lists)) {
    if ((systemUri(sys) || str(sys)) !== uri || !codes || typeof codes !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(codes, str(code))) return { display: str(codes[str(code)]) || null };
  }
  return null;
}

/** PURE. Whether the configured server is asked about this system. An empty list means every known system. */
function serverCovers(server, uri) {
  if (!server || !str(server.url)) return false;
  const systems = Array.isArray(server.systems) ? server.systems.map((s) => systemUri(s) || str(s)).filter(Boolean) : [];
  return !systems.length || systems.includes(uri);
}

/**
 * Asks a FHIR terminology server CodeSystem/$validate-code. Returns { result: true|false|null, display, note }.
 * null = no answer (unreachable, malformed, timed out); the caller treats that as "not verified", never as invalid.
 * deps: { fetchImpl, safeFetch, nowMs }
 */
async function askServer(server, uri, code, display, deps) {
  const fetchImpl = deps && deps.fetchImpl;
  if (!fetchImpl) return { result: null, note: "no fetch available" };
  const base = str(server.url).replace(/\/+$/, "");
  const q = new URLSearchParams({ url: uri, code: str(code) });
  if (str(display)) q.set("display", str(display));
  const headers = { Accept: "application/fhir+json" };
  if (str(server.bearer)) headers.Authorization = `Bearer ${str(server.bearer)}`;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TX_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(`${base}/CodeSystem/$validate-code?${q.toString()}`, { method: "GET", headers, ...(controller ? { signal: controller.signal } : {}) });
    if (!res || !res.ok) return { result: null, note: `terminology server answered ${res ? res.status : "nothing"}` };
    const body = await res.json();
    if (!body || body.resourceType !== "Parameters" || !Array.isArray(body.parameter)) return { result: null, note: "terminology server returned something other than Parameters" };
    const p = (name) => body.parameter.find((x) => x && x.name === name);
    const r = p("result");
    if (!r || typeof r.valueBoolean !== "boolean") return { result: null, note: "terminology server gave no result" };
    return { result: r.valueBoolean, display: str(p("display") && p("display").valueString) || null, note: str(p("message") && p("message").valueString) || null };
  } catch (e) {
    return { result: null, note: `terminology server unreachable: ${str(e && e.message) || "error"}` };
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * Validates one coding. Returns
 *   { status: "verified"|"recognised"|"unmapped"|"invalid", result: true|false|null, uri, display, source: "seed"|"org"|"server"|null, note }
 * deps: { config: wardsynq.terminology, kv?: WSQ_TX_KV, fetchImpl? }. Pure when nothing is configured.
 */
async function validateCode(coding, deps) {
  const system = str(coding && coding.system), code = str(coding && coding.code), display = str(coding && coding.display);
  const uri = systemUri(system) || (isUri(system) ? system : null);
  if (!uri || !code) return { status: UNMAPPED, result: null, uri: null, display: null, source: null, note: uri ? "no code" : "system is not a vocabulary this server knows or a URI" };
  const known = systemUri(system) !== null;
  if (known && isKnown(uri, code)) return { status: "verified", result: true, uri, display: displayOf(uri, code) || display || null, source: "seed", note: null };
  const config = deps && deps.config;
  const org = orgKnown(config, uri, code);
  if (org) return { status: "verified", result: true, uri, display: org.display || display || null, source: "org", note: null };
  const server = config && config.server;
  if (serverCovers(server, uri)) {
    const cache = txCache(deps && deps.kv);
    const key = `tx:${str(server.url)}|${uri}|${code}`;
    let answer = await cache.get(key);
    if (!answer) {
      answer = await askServer(server, uri, code, display, deps);
      if (answer.result !== null) await cache.put(key, answer); // an outage is not remembered as an answer
    }
    if (answer.result === true) return { status: "verified", result: true, uri, display: answer.display || display || null, source: "server", note: null };
    if (answer.result === false) return { status: INVALID, result: false, uri, display: display || null, source: "server", note: answer.note || "the terminology server does not know this code in this system" };
    return { status: known ? "recognised" : UNMAPPED, result: null, uri, display: display || null, source: null, note: answer.note || null };
  }
  return { status: known ? "recognised" : UNMAPPED, result: null, uri, display: display || null, source: null, note: known ? "system recognised; code not verified by this server" : "system is a URI this server does not know" };
}

/** PURE. A FHIR Parameters response for $validate-code. */
function validateCodeParameters(v) {
  const p = [{ name: "result", valueBoolean: v.result === true }];
  if (v.display) p.push({ name: "display", valueString: v.display });
  const message = v.status === "verified" ? `verified (${v.source})` : v.status === INVALID ? (v.note || "invalid") : v.status === "recognised" ? (v.note || "not verified") : (v.note || "unknown system");
  p.push({ name: "message", valueString: message });
  p.push({ name: "x-wardsynq-status", valueCode: v.status });
  return { resourceType: "Parameters", parameter: p };
}

export {
  SYSTEMS, HL7, UNCODED, UNMAPPED, INVALID, IDENTIFIER_SYSTEMS, KNOWN, systemUri, isUri, isKnown, displayOf, unmappedCoding, classifyCoding, coverage, identifierKey,
  validateCode, validateCodeParameters, orgKnown, serverCovers, askServer, txCache, resetTxCache, TX_TIMEOUT_MS,
};
