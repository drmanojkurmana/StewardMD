/* functions/_wardsynq/identity-key.js — how a patient identifier is spelled, in ONE place.
 *
 * WHY THIS FILE EXISTS AT ALL, rather than living in terminology.js where identifierKey() started.
 *
 * As of the 2026-09-10 audit an identifier is written into a database index (wardsynq_patient_-
 * identifier) at write time and looked up out of it at reconciliation time. Those two moments are
 * in different layers - the storage port and the interoperability layer - and they must canonicalise
 * a system and a value to EXACTLY the same string or the index silently stops finding people. An
 * index that disagrees with its matcher by one character is worse than no index: it answers, it
 * answers confidently, and it answers "no such patient" for somebody who is right there.
 *
 * terminology.js cannot be that place. It imports the vitals codes, the GHIS lab seed and the FHIR
 * validator, so a storage port importing it would pull the whole clinical vocabulary graph into the
 * layer that is supposed to know nothing but rows - and would risk an import cycle the first time
 * any of that graph reached back for the record. So the canonicalisation moved DOWN to a file with
 * no imports at all, and terminology.js re-exports identifierKey() so nothing that already used it
 * had to change.
 *
 * THE RULES, AND WHY EACH ONE IS THE RULE
 *
 *  SYSTEM. Compared by canonical key, so "ABHA", "abha" and https://healthid.ndhm.gov.in are one
 *  system. An UNKNOWN system is its own slug and is therefore only ever equal to itself: two
 *  different unknown systems never compare equal, and nothing is guessed to be the same. Guessing
 *  here would merge two strangers.
 *
 *  VALUE. Upper-cased, with spaces and hyphens removed, because "GH-1024", "gh 1024" and "GH1024"
 *  are one hospital number written by three people. Nothing else is stripped: a leading zero is
 *  part of a number, not noise.
 *
 *  EMPTY IS NOT AN IDENTIFIER. A blank system or a blank value is dropped rather than indexed as
 *  "". Otherwise every patient with no ABHA number would share one key and match each other, which
 *  is the exact failure this whole mechanism exists to prevent.
 */

const str = (v) => (v == null ? "" : String(v).trim());

/* Every spelling this codebase and its FHIR partners use for a system, INCLUDING the published URI,
 * so an identifier that arrives under its own URI is recognised as the same thing it is called here. */
const IDENTIFIER_SYSTEMS = (() => {
  const mrn = { key: "mrn", uri: "urn:stewardmd:mrn", typeCode: "MR", typeText: "Medical record number" };
  const abha = { key: "abha", uri: "https://healthid.ndhm.gov.in", typeCode: "NI", typeText: "ABHA number" };
  const ticket = { key: "opd-ticket-id", uri: "urn:stewardmd:opd-ticket", typeCode: "VN", typeText: "Visit number" };
  const ghis = { key: "ghis-episode-id", uri: "urn:stewardmd:ghis-episode", typeCode: "VN", typeText: "GHIS episode" };
  return Object.freeze({ mrn, [mrn.uri]: mrn, abha, [abha.uri]: abha, "opd-ticket-id": ticket, [ticket.uri]: ticket, "ghis-episode-id": ghis, [ghis.uri]: ghis });
})();

/** PURE. The canonical key for an identifier system, or "" when there is no system to speak of. */
function identifierKey(system) {
  const s = str(system);
  if (!s) return "";
  const hit = IDENTIFIER_SYSTEMS[s] || IDENTIFIER_SYSTEMS[s.toLowerCase()];
  return hit ? hit.key : s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** PURE. The canonical spelling of an identifier VALUE. See the header for what is and is not stripped. */
function identifierValue(value) {
  return str(value).toUpperCase().replace(/[\s-]+/g, "");
}

/**
 * PURE. Every identifier this Patient can be found by, canonicalised and de-duplicated.
 *
 * The MRN is included as the system "mrn" rather than kept apart, because the hospital number IS an
 * identifier and treating it as a special case is how it ends up indexed under one set of rules and
 * matched under another.
 *
 * @returns {{systemKey: string, valueNorm: string}[]}
 */
function patientIdentifierKeys(patient) {
  if (!patient || patient.resourceType !== "Patient") return [];
  const out = [];
  const seen = new Set();
  const add = (system, value) => {
    const systemKey = identifierKey(system);
    const valueNorm = identifierValue(value);
    if (!systemKey || !valueNorm) return;               // empty is not an identifier - see the header
    const k = `${systemKey}|${valueNorm}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ systemKey, valueNorm });
  };
  add("mrn", patient.mrn);
  for (const i of Array.isArray(patient.identifiers) ? patient.identifiers : []) {
    if (i) add(i.system, i.value);
  }
  return out;
}

export { IDENTIFIER_SYSTEMS, identifierKey, identifierValue, patientIdentifierKeys };
