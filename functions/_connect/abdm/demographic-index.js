// functions/_connect/abdm/demographic-index.js — the deterministic demographic index behind discovery.
//
// WHY THIS EXISTS. ABDM's discovery flowchart (Discovery & Link; certification USER_INIT_LINK_602-607)
// says: match on ABHA address; failing that, match on mobile number - but only if gender ALSO matches,
// AND the age is within +/-5 years, AND the name is phonetically similar; failing that, match on the
// medical record number under the same three conditions. Without this index only the ABHA-address arm
// works, and a patient who registered before they had an ABHA can never find their own records.
//
// THIS IS NOT FUZZY MATCHING, and the distinction is the whole design. There is no distance metric, no
// similarity threshold, no ranking, no "best" candidate. Every comparison is EXACT equality on a value
// that was computed deterministically:
//   - mobile   -> HMAC of the last 10 digits
//   - MRN      -> HMAC of the case/punctuation-folded string
//   - name     -> HMAC of a phonetic CODE derived by fixed rewrite rules
//   - gender   -> exact
//   - age      -> integer year difference against a fixed tolerance
// Two records either produce the same code or they do not. Nothing is scored, so nothing can be
// "close enough".
//
// AND IT REFUSES TO GUESS. A probe that survives the filters against exactly ONE patient is a match.
// Zero survivors is no match. TWO OR MORE survivors is no match - deliberately, because "these two
// patients are both plausible" must never resolve to one of them. Returning the wrong patient's records
// to a stranger is the worst thing this module could do; returning nothing is merely unhelpful.
//
// AT REST: no raw demographic is stored. Mobile, MRN and the name code are per-tenant HMAC pseudonyms
// (the same derivation the rest of ABDM uses for the ABHA), so the table cannot be reversed into a
// patient list, and an identical mobile at two tenants yields two unrelated hashes. Gender and year of
// birth are stored as-is: neither identifies anyone alone, and both need to be COMPARED (exact match and
// a +/-5 window), which a hash cannot do.

import { hmacPseudonym } from "../audit.js";

export class DemographicIndexError extends Error {}

export const DEMOGRAPHIC_TABLE = "connect_abdm_demographic";

/** ABDM's own tolerance, from the discovery flowchart: "Is the age within +/- 5 years?" */
export const AGE_TOLERANCE_YEARS = 5;

// ── normalisation ───────────────────────────────────────────────────────────────────────────────────

/** Last 10 digits. Handles +91, 0-prefixes and spacing without accepting a wrong-length number. */
export function normaliseMobile(v) {
  const d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.length < 10) return null;
  const last10 = d.slice(-10);
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null;   // an Indian mobile, or nothing
}

/** A hospital's own record number. Case and punctuation vary by who typed it; the digits do not. */
export function normaliseMrn(v) {
  const s = String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length >= 3 ? s : null;      // 1-2 characters is not an identifier, it is a typo
}

/** M / F / O, or null. ABDM uses single letters; local systems spell them out. */
export function normaliseGender(v) {
  const s = String(v == null ? "" : v).trim().toUpperCase();
  if (!s) return null;
  if (s.startsWith("M")) return "M";
  if (s.startsWith("F")) return "F";
  if (s.startsWith("O") || s.startsWith("T")) return "O";   // Other / Transgender
  return null;                                              // "U"/"Unknown" is not a match key
}

/** Year of birth as an integer, from a year, a date, or an age-in-years plus a reference year. */
export function normaliseYob(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).slice(0, 4));
  return Number.isInteger(n) && n >= 1900 && n <= 2200 ? n : null;
}

// Transliteration folding for Indian names written in Latin script. These are the variations the SAME
// name acquires between one registration desk and another - not different names being merged.
// Deliberately conservative: every rule below is a spelling of the same sound, and the rules are applied
// in a fixed order so the output is a pure function of the input.
const FOLD = [
  [/[^A-Z ]/g, ""],        // punctuation and digits carry no sound
  [/\bMR|\bMRS|\bMS|\bDR|\bSHRI|\bSMT|\bKUMARI\b/g, ""],   // honorifics are not names
  [/PH/g, "F"],            // Phanindra / Fanindra
  [/GH/g, "G"], [/BH/g, "B"], [/DH/g, "D"], [/TH/g, "T"], [/KH/g, "K"], [/JH/g, "J"], [/CH/g, "C"],
  [/SH/g, "S"], [/ZH/g, "S"], [/Z/g, "S"],                 // Suresh / Suresh, Zubair / Subair
  [/W/g, "V"],             // Viswanath / Vishwanath
  [/Y/g, "I"],             // Satya / Satia
  [/KS/g, "X"], [/QU/g, "K"], [/Q/g, "K"],
  [/[AEIOU]+/g, "A"],      // vowel LENGTH is the commonest variation: Ramesh/Rameesh, Anil/Aneel
  [/(.)\1+/g, "$1"],       // doubled consonants: Siddharth / Sidharth
];

/**
 * A phonetic CODE for a personal name. Order-insensitive, because "Ramesh Kumar" and "Kumar Ramesh" are
 * one person recorded by two desks: the tokens are folded, then SORTED, then joined.
 *
 * Returns null for anything too short to be a name, so an empty probe can never match everyone.
 */
export function nameCode(v) {
  const raw = String(v == null ? "" : v).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const tokens = raw.split(/\s+/).map((t) => {
    let s = " " + t + " ";
    for (const [re, to] of FOLD) s = s.replace(re, to);
    return s.trim();
  }).filter((t) => t.length > 0);
  if (!tokens.length) return null;
  const code = tokens.sort().join(" ");
  return code.replace(/\s+/g, " ").trim() || null;
}

/** True when two names fold to the same code. EXACT equality on the code - never a distance. */
export const nameMatches = (a, b) => {
  const x = nameCode(a), y = nameCode(b);
  return Boolean(x) && x === y;
};

/** ABDM's +/-5 year window, inclusive. Fails CLOSED when either year is unusable. */
export function ageWithinTolerance(yobA, yobB, tolerance = AGE_TOLERANCE_YEARS) {
  const a = normaliseYob(yobA), b = normaliseYob(yobB);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tolerance;
}

// ── the index ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Compute the stored (hashed) row for one patient. Exported so the writer and the reader derive keys
 * through exactly the same code - a mismatch between them would silently match nothing.
 */
export async function demographicKeys(env, tenantId, { name, mobile, mrn } = {}) {
  const m = normaliseMobile(mobile), r = normaliseMrn(mrn), n = nameCode(name);
  return {
    mobileHash: m ? await hmacPseudonym(env, tenantId, "mobile:" + m) : null,
    mrnHash: r ? await hmacPseudonym(env, tenantId, "mrn:" + r) : null,
    nameHash: n ? await hmacPseudonym(env, tenantId, "name:" + n) : null,
  };
}

/**
 * Index one patient so ABDM discovery can find them. Called from registration, never from a callback.
 *
 * Idempotent on (tenant, patientRef): re-registering the same patient updates rather than duplicating,
 * because two rows for one person would look like ambiguity and suppress their own match.
 */
export async function indexPatient(env, deps, { tenantId, patientRef, name, mobile, gender, yearOfBirth, mrn } = {}) {
  const { db } = deps || {};
  if (!db) throw new DemographicIndexError("demographic index is not bound");
  if (!tenantId || !patientRef) throw new DemographicIndexError("tenant and patientRef are both required");
  const keys = await demographicKeys(env, tenantId, { name, mobile, mrn });
  const g = normaliseGender(gender), y = normaliseYob(yearOfBirth);
  const now = typeof deps.now === "function" ? deps.now() : deps.now;

  const existing = await db.prepare(
    `SELECT patient_ref FROM ${DEMOGRAPHIC_TABLE} WHERE tenant_id=? AND patient_ref=?`)
    .bind(tenantId, patientRef).first();
  if (existing) {
    await db.prepare(
      `UPDATE ${DEMOGRAPHIC_TABLE} SET mobile_hash=?,mrn_hash=?,name_hash=?,gender=?,year_of_birth=?,updated_at=?
         WHERE tenant_id=? AND patient_ref=?`)
      .bind(keys.mobileHash, keys.mrnHash, keys.nameHash, g, y, now, tenantId, patientRef).run();
    return { indexed: true, created: false };
  }
  const res = await db.prepare(
    `INSERT INTO ${DEMOGRAPHIC_TABLE}
       (tenant_id,patient_ref,mobile_hash,mrn_hash,name_hash,gender,year_of_birth,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(tenantId, patientRef, keys.mobileHash, keys.mrnHash, keys.nameHash, g, y, now, now).run();
  if (!res || res.success === false) throw new DemographicIndexError("demographic index insert failed");
  return { indexed: true, created: true };
}

/** Remove a patient from the index. Erasure must reach here too, or a deleted patient stays findable. */
export async function unindexPatient(env, deps, { tenantId, patientRef } = {}) {
  const { db } = deps || {};
  if (!db) throw new DemographicIndexError("demographic index is not bound");
  const res = await db.prepare(`DELETE FROM ${DEMOGRAPHIC_TABLE} WHERE tenant_id=? AND patient_ref=?`)
    .bind(tenantId, patientRef).run();
  return { removed: ((res && res.meta && res.meta.changes) || 0) > 0 };
}

// ── the match ───────────────────────────────────────────────────────────────────────────────────────

/**
 * ABDM's discovery algorithm, exactly as the flowchart draws it.
 *
 *   mobile matches?  -> else MRN matches?  -> else NO MATCH
 *        |                    |
 *        +--------------------+--> gender matches? -> age within +/-5? -> name code equal? -> MATCH
 *
 * Note BOTH arms funnel through the same three conditions: an MRN alone is NOT sufficient, because it is
 * an UNVERIFIED, patient-declared identifier. Only the ABHA address (handled by the caller, before this
 * runs) is trusted on its own.
 *
 * @returns { matched, patientRef|null, matchedBy:[...], reason }
 *          `reason` is for the audit trail only. The CALLER must return a constant shape on any
 *          non-match, so "ambiguous" and "nobody" are indistinguishable from outside.
 */
export async function matchDemographics(env, deps, { tenantId, probe } = {}) {
  const { db } = deps || {};
  if (!db) throw new DemographicIndexError("demographic index is not bound");
  if (!tenantId) return { matched: false, patientRef: null, matchedBy: [], reason: "no-tenant" };
  const p = probe || {};

  const mobile = normaliseMobile(p.mobile);
  const mrn = normaliseMrn(p.mrn);
  const gender = normaliseGender(p.gender);
  const yob = normaliseYob(p.yearOfBirth);
  const code = nameCode(p.name);

  // The three corroborating conditions are ALL required. A probe that cannot supply them cannot match on
  // a mobile or an MRN, whatever else it carries - so an attacker who knows only a phone number learns
  // nothing.
  if (!gender || yob == null || !code) {
    return { matched: false, patientRef: null, matchedBy: [], reason: "insufficient-corroboration" };
  }

  const keys = await demographicKeys(env, tenantId, { name: p.name, mobile: p.mobile, mrn: p.mrn });

  // Arm 1: mobile (a VERIFIED identifier). Arm 2: MRN (unverified) only if the mobile arm found nobody.
  for (const [by, column, value] of [["MOBILE", "mobile_hash", mobile ? keys.mobileHash : null],
                                     ["MR", "mrn_hash", mrn ? keys.mrnHash : null]]) {
    if (!value) continue;
    // Tenant scoping is in the WHERE, not applied afterwards: a cross-tenant row is never even loaded.
    const { results = [] } = await db.prepare(
      `SELECT * FROM ${DEMOGRAPHIC_TABLE} WHERE tenant_id=? AND ${column}=?`).bind(tenantId, value).all();
    if (!results.length) continue;

    const survivors = results.filter((row) =>
      row.gender === gender &&
      ageWithinTolerance(row.year_of_birth, yob) &&
      row.name_hash && row.name_hash === keys.nameHash);

    if (survivors.length === 1) {
      return { matched: true, patientRef: survivors[0].patient_ref, matchedBy: [by], reason: "unique" };
    }
    if (survivors.length > 1) {
      // Two people who both fit. Picking either is a coin toss with somebody's medical history, so we
      // pick neither. The caller reports this exactly as it reports "nobody".
      return { matched: false, patientRef: null, matchedBy: [], reason: "ambiguous" };
    }
    // Candidates existed on this identifier but none corroborated. Fall through to the next arm.
  }

  return { matched: false, patientRef: null, matchedBy: [], reason: "no-match" };
}
