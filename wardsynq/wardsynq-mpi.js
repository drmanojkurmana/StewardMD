/* wardsynq/wardsynq-mpi.js: WardSynQ P0 Master Patient Identity (MPI).
 *
 * The identity engine that stands between a keystroke at the registration desk and a wrong-patient
 * error at the bedside. Two hazards live here: creating a second record for a patient who already
 * exists (fragmented chart, missed allergy) and linking two records that are not the same person
 * (someone else's allergies, someone else's diagnosis). Both are decided by the same probabilistic
 * comparison, so both live in one file.
 *
 * This file is deliberately a PURE FUNCTION LIBRARY. It does no I/O, persists nothing, and imports
 * neither the store nor the event bus, only the canonical model (wardsynq-model.js) for the Patient
 * shape. The reasons are not stylistic:
 *  - it is called on every keystroke during registration, so it must be cheap and side-effect free;
 *  - identity decisions are auditable and must be reproducible from their inputs alone, which is only
 *    true if nothing hidden (a cache, a clock, a database read) can change the answer;
 *  - a site will want to re-run historical matches against re-estimated weights. That is only
 *    possible if scoring is a function of (candidate, existing, weights) and nothing else.
 * Wiring (emitting `mpi.merged`, writing the merge record, calling this on form input) belongs to
 * the caller, not here.
 *
 * Scoring is Fellegi-Sunter shaped: each field contributes an agreement weight when the two records
 * agree and a smaller disagreement penalty when both sides carry a value and those values differ. A
 * value missing on either side contributes nothing at all: it is neither credited nor held against
 * the pair. The score is those contributions divided by the FIXED total weight available across all
 * fields, so it reads as "weight points earned out of a possible 100". That fixed denominator is the
 * load-bearing choice: it makes the score a measure of how much evidence agrees rather than of what
 * fraction of whatever happened to be filled in agreed, which is why a perfectly matching name and
 * nothing else scores 0.15 instead of 1.00 and can never auto-link a chart.
 *
 * A worked explanation the UI can render straight from `breakdown`:
 *   97 percent match: exact ABHA (50) + exact mobile (25) + name Jaro-Winkler 0.96 (14.4) + exact DOB (8)
 *
 * node --test test/wardsynq-mpi.test.mjs
 */

import { Patient } from "./wardsynq-model.js";

/* ------------------------------------------------------------------ string utilities */

/** Honorifics and courtesy titles seen on Indian registration desks and on imported feeds. They
 * carry no identity information, so leaving them in makes "Dr Anita Rao" and "Anita Rao" look like
 * different people. Deliberately excludes suffixes that CAN disambiguate (Jr/Sr, II/III). */
const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "mx", "master", "dr", "doctor", "prof", "professor",
  "sir", "smt", "shri", "sri", "shrimati", "kum", "kumari", "baby", "bby", "late", "rev",
]);

/**
 * Canonical form of a person's name for comparison: lower case, punctuation removed, honorifics
 * dropped, whitespace collapsed. Never used for display, only as the input to a similarity score.
 * @param {string} [name]
 * @returns {string}
 */
function normalizeName(name) {
  if (typeof name !== "string") return "";
  const tokens = name
    .toLowerCase()
    .replace(/[.,'`_/\\-]+/g, " ") // dots and hyphens are punctuation in names, not letters
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !HONORIFICS.has(t));
  // If a record is nothing but honorifics ("Mrs."), fall back to the stripped tokens rather than
  // returning an empty string that would silently compare equal to every other empty name.
  if (tokens.length === 0) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  return tokens.join(" ");
}

const SOUNDEX_CODES = {
  B: "1", F: "1", P: "1", V: "1",
  C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
  D: "3", T: "3",
  L: "4",
  M: "5", N: "5",
  R: "6",
};

/**
 * Standard (NARA/Knuth) Soundex. H and W are transparent, so two coded letters separated by them
 * still count as adjacent and collapse to one digit, while vowels and Y break the run. That rule
 * is what makes soundex("Ashcraft") === "A261" and soundex("Tymczak") === "T522".
 *
 * Soundex is a blocking key, not a decision: it is cheap enough to shortlist candidates from a large
 * registry, but far too coarse to score with. scoreMatch uses Jaro-Winkler for that.
 * @param {string} [word]
 * @returns {string} four characters, or "" for input with no letters
 */
function soundex(word) {
  if (typeof word !== "string") return "";
  const letters = word.toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length === 0) return "";

  const first = letters[0];
  let out = first;
  let previous = SOUNDEX_CODES[first] || "";

  for (let i = 1; i < letters.length && out.length < 4; i++) {
    const letter = letters[i];
    const code = SOUNDEX_CODES[letter];
    if (code) {
      if (code !== previous) out += code;
      previous = code;
    } else if (letter === "H" || letter === "W") {
      // transparent: leave `previous` alone so C-H-C still collapses
    } else {
      previous = ""; // a vowel or Y separates, so a repeated code after it is kept
    }
  }
  return out.padEnd(4, "0");
}

/** Jaro similarity, the base of Jaro-Winkler. Split out so the transposition count stays readable. */
function jaro(a, b) {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (a.length === 0 || b.length === 0) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array(a.length).fill(false);
  const bMatched = new Array(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const halfTranspositions = transpositions / 2;
  return (matches / a.length + matches / b.length + (matches - halfTranspositions) / matches) / 3;
}

/**
 * Jaro-Winkler similarity in 0..1, with Winkler's original prefix bonus (scale 0.1, at most four
 * characters, applied only above a 0.7 boost threshold so weak pairs are not flattered by sharing a
 * first letter). Case-sensitive by design: callers normalize first, and scoreMatch does.
 *
 * Reference values: jaroWinkler("MARTHA","MARHTA") ~ 0.961, jaroWinkler("DIXON","DICKSONX") ~ 0.813.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function jaroWinkler(a, b, opts) {
  a = typeof a === "string" ? a : "";
  b = typeof b === "string" ? b : "";
  const scale = (opts && opts.scale) ?? 0.1;
  const boostThreshold = (opts && opts.boostThreshold) ?? 0.7;

  const base = jaro(a, b);
  if (base < boostThreshold) return base;

  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix += 1;
  return base + prefix * scale * (1 - base);
}

/* ------------------------------------------------------------------ field extraction */

/** Identifier systems that are really contact details. They are scored as `mobile`, once, and must
 * not also be counted as strong identifiers or a shared phone would be paid for twice. */
const PHONE_SYSTEMS = /^(mobile|phone|msisdn|cell|contact)$/i;

function identifierList(patient) {
  return Array.isArray(patient && patient.identifiers) ? patient.identifiers : [];
}

/** Identifiers keyed by upper-cased system, contact numbers excluded. Later entries win, which is
 * the ordinary "most recently appended value is current" convention. */
function identifierMap(patient) {
  const map = new Map();
  for (const id of identifierList(patient)) {
    if (!id || typeof id.system !== "string" || id.value === undefined || id.value === null) continue;
    if (PHONE_SYSTEMS.test(id.system)) continue;
    const value = String(id.value).trim();
    if (value === "") continue;
    map.set(id.system.trim().toUpperCase(), value);
  }
  return map;
}

/**
 * The last ten significant digits of a phone number, or "". Records arrive with and without country
 * codes and separators (+91 98765 43210 vs 09876543210), and treating those as a disagreement would
 * penalize the strongest everyday identifier a registration desk has.
 */
function normalizePhone(value) {
  if (value === undefined || value === null) return "";
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 6) return ""; // too short to identify anyone; treat as absent, not as a clash
  return digits.slice(-10);
}

function phoneOf(patient) {
  if (!patient) return "";
  const direct = normalizePhone(patient.mobile || patient.phone || (patient.telecom && (patient.telecom.mobile || patient.telecom.phone)));
  if (direct) return direct;
  for (const id of identifierList(patient)) {
    if (id && typeof id.system === "string" && PHONE_SYSTEMS.test(id.system)) {
      const fromIdentifier = normalizePhone(id.value);
      if (fromIdentifier) return fromIdentifier;
    }
  }
  return "";
}

/** A dob that is present, real, and not the provisional sentinel. */
function dobOf(patient) {
  const dob = patient && typeof patient.dob === "string" ? patient.dob.trim() : "";
  if (dob === "" || dob === PROVISIONAL_DOB_SENTINEL) return "";
  return dob;
}

/** "unknown" is the model's default for sex, so it means "not asserted" and never disagrees. */
function sexOf(patient) {
  const sex = patient && typeof patient.sex === "string" ? patient.sex.trim().toLowerCase() : "";
  return sex === "" || sex === "unknown" ? "" : sex;
}

/* ------------------------------------------------------------------ scoring */

/**
 * SEED WEIGHTS. NOT A CALIBRATION.
 *
 * In a real Fellegi-Sunter linkage the agreement weight of a field is log2(m/u) and the disagreement
 * weight is log2((1-m)/(1-u)), where m is P(agree | same person) and u is P(agree | different
 * people). Both are properties of a particular registry: u for a surname is a function of how common
 * that surname is in that catchment, and m for date of birth is a function of how carefully that
 * front desk types. They MUST be re-estimated per site by EM on that site's own record pairs, and
 * re-estimated again when the catchment or the intake workflow changes.
 *
 * The numbers below are a defensible starting point for day one at a site with no history to
 * estimate from, scaled to sum to 100 so a human can read the breakdown as percentage points. They
 * are not tuned to any population. Shipping them as if they were calibrated is the mistake this
 * comment exists to prevent.
 */
const DEFAULT_WEIGHTS = {
  // A government identity number matching is near-conclusive; when two records carry different ones
  // that is strong but not conclusive evidence against, because misfiled identifiers are common.
  identifier: { agree: 50, disagree: 25 },
  // Mobile numbers are the workhorse identifier at an Indian front desk. Shared family handsets are
  // why agreement alone is not enough to auto-merge (see minAutoEvidence).
  mobile: { agree: 25, disagree: 10 },
  // Names are high-value but noisy: transliteration, initials, and married names all vary. Graded by
  // similarity rather than treated as a yes/no.
  name: { agree: 15, disagree: 8 },
  // A real dob is discriminating; the caveat is registries full of 01-01 defaults, which is exactly
  // the kind of local fact EM re-estimation would catch and this seed cannot.
  dob: { agree: 8, disagree: 6 },
  // Sex agreement carries almost no information (it halves the population at best) but a genuine
  // disagreement is worth flagging.
  sex: { agree: 2, disagree: 2 },
};

const DEFAULT_THRESHOLDS = {
  // Above this, two records may be linked without a human looking. 0.50 is exactly one national
  // identifier's worth of agreement: nothing weaker than that ever auto-links, and a perfect name
  // plus dob plus sex (0.25) cannot reach it, because namesakes born on the same day are not rare
  // enough to bet a chart on. A false link puts someone else's allergy list on this patient; a false
  // review costs a clerk five seconds.
  auto: 0.5,
  // Below this there is nothing worth showing a clerk; between the two it goes to review. Set just
  // under the weight of a single agreeing name (0.15), because one agreeing name is the weakest
  // thing that is still worth a human glance.
  review: 0.13,
  // Jaro-Winkler at or above this counts as name agreement rather than name disagreement.
  nameAgreement: 0.9,
  // Below nameAgreement, a name still agrees when every word sounds alike (per-word Soundex) AND the
  // spelling is at least this close. Transliteration is where Indian registries split one person
  // in two: Mohammed/Muhammad (0.85), Lakshmi/Laxmi (0.83), Sita/Seetha (0.79). Soundex alone is too
  // coarse to trust - Ravi and Rupa are both R100 - so the spelling floor keeps it from pairing them.
  phoneticFloor: 0.75,
};

/** PURE. Same number of words, and each word codes to the same Soundex, in order. */
function soundsAlike(aName, bName) {
  const a = aName.split(" "), b = bName.split(" ");
  if (a.length !== b.length) return false;
  return a.every((t, i) => { const s = soundex(t); return s !== "" && s === soundex(b[i]); });
}

/** Denominator for the score: the total weight on offer if every field agreed. Identifiers count
 * once here even though several systems can each contribute, which is why the raw total is clamped
 * rather than allowed to exceed 1. */
function maxWeightOf(weights) {
  return weights.identifier.agree + weights.mobile.agree + weights.name.agree + weights.dob.agree + weights.sex.agree;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @typedef {{field: string, agreed: boolean, contribution: number, detail: string}} MatchFactor
 * @typedef {{score: number, band: 'auto'|'review'|'none', breakdown: MatchFactor[],
 *   maxWeight: number, explanation: string}} MatchResult
 */

/**
 * Compares two patient-shaped records and explains the comparison.
 *
 * Never throws: it is called on partially typed registration forms, and a form that is one character
 * into a surname must produce a weak score, not an exception. Anything missing simply contributes
 * nothing.
 *
 * `score` is sum(contributions) / maxWeight, clamped to 0..1, where maxWeight is the weight of every
 * field agreeing. Dividing by what was on offer rather than by what was filled in is what makes the
 * score comparable across candidates with different amounts of data, and what makes "a name alone
 * can never auto-link" a property of the arithmetic instead of a special case bolted on beside it.
 *
 * @param {object} candidate the record being registered or considered
 * @param {object} existing a record already in the registry
 * @param {{weights?: object, thresholds?: object}} [config]
 * @returns {MatchResult}
 */
function scoreMatch(candidate, existing, config) {
  const cfg = config || {};
  const weights = { ...DEFAULT_WEIGHTS, ...(cfg.weights || {}) };
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(cfg.thresholds || {}) };
  const a = candidate || {};
  const b = existing || {};

  /** @type {MatchFactor[]} */
  const breakdown = [];
  let total = 0;

  const record = (field, agreed, contribution, detail) => {
    total += contribution;
    breakdown.push({ field, agreed, contribution: round2(contribution), detail });
  };

  // Identifiers: compared per system, and only for systems present on BOTH sides. A system only one
  // record carries is not evidence either way.
  const aIds = identifierMap(a);
  const bIds = identifierMap(b);
  for (const [system, aValue] of aIds) {
    if (!bIds.has(system)) continue;
    const bValue = bIds.get(system);
    if (aValue === bValue) {
      record(`identifier:${system}`, true, weights.identifier.agree, `exact ${system}`);
    } else {
      record(`identifier:${system}`, false, -weights.identifier.disagree, `${system} differs (${aValue} vs ${bValue})`);
    }
  }

  const aPhone = phoneOf(a);
  const bPhone = phoneOf(b);
  if (aPhone && bPhone) {
    if (aPhone === bPhone) {
      record("mobile", true, weights.mobile.agree, "exact mobile");
    } else {
      record("mobile", false, -weights.mobile.disagree, "mobile differs");
    }
  }

  const aName = normalizeName(a.name);
  const bName = normalizeName(b.name);
  if (aName && bName) {
    const similarity = jaroWinkler(aName, bName);
    const spelled = similarity >= thresholds.nameAgreement;
    const floor = thresholds.phoneticFloor ?? DEFAULT_THRESHOLDS.phoneticFloor;
    const phonetic = !spelled && similarity >= floor && soundsAlike(aName, bName);
    const agreed = spelled || phonetic;
    // Graded both ways: a near miss is worth almost the full weight, and a total mismatch costs the
    // full penalty, with everything in between scaled instead of falling off a cliff at the
    // threshold.
    const contribution = agreed
      ? weights.name.agree * similarity
      : -weights.name.disagree * (1 - similarity);
    record("name", agreed, contribution, `name Jaro-Winkler ${similarity.toFixed(2)}${phonetic ? ", sounds alike" : ""}`);
  }

  const aDob = dobOf(a);
  const bDob = dobOf(b);
  if (aDob && bDob) {
    if (aDob === bDob) {
      record("dob", true, weights.dob.agree, "exact DOB");
    } else {
      record("dob", false, -weights.dob.disagree, `DOB differs (${aDob} vs ${bDob})`);
    }
  }

  const aSex = sexOf(a);
  const bSex = sexOf(b);
  if (aSex && bSex) {
    if (aSex === bSex) {
      record("sex", true, weights.sex.agree, `sex agrees (${aSex})`);
    } else {
      record("sex", false, -weights.sex.disagree, `sex differs (${aSex} vs ${bSex})`);
    }
  }

  const maxWeight = maxWeightOf(weights);
  const score = maxWeight > 0 ? clamp01(total / maxWeight) : 0;
  let band = "none";
  if (score >= thresholds.auto) band = "auto";
  else if (score >= thresholds.review) band = "review";

  return {
    score: round2(score),
    band,
    breakdown,
    maxWeight,
    explanation: explainMatch(score, breakdown),
  };
}

/** Renders a breakdown as the one-line sentence the registration screen shows next to a candidate. */
function explainMatch(score, breakdown) {
  if (!breakdown || breakdown.length === 0) return "0 percent match: nothing comparable";
  const parts = breakdown.map((f) => `${f.detail} (${round2(f.contribution)})`);
  return `${Math.round(score * 100)} percent match: ${parts.join(" + ")}`;
}

/**
 * Ranks existing records against a candidate. Safe to call on every keystroke: it never throws, and
 * a candidate carrying only a partial name simply yields weak review-band suggestions.
 *
 * @param {object} candidate
 * @param {object[]} existingPatients
 * @param {{weights?: object, thresholds?: object, limit?: number}} [opts]
 * @returns {{patient: object, score: number, band: string, match: MatchResult}[]} band !== "none",
 *   highest score first
 */
function findCandidates(candidate, existingPatients, opts) {
  if (!Array.isArray(existingPatients)) return [];
  const options = opts || {};
  const candidateId = candidate && candidate.id;

  const scored = [];
  for (const existing of existingPatients) {
    if (!existing || typeof existing !== "object") continue;
    if (candidateId && existing.id === candidateId) continue; // a record never matches itself
    const match = scoreMatch(candidate, existing, options);
    if (match.band === "none") continue;
    scored.push({ patient: existing, score: match.score, band: match.band, match });
  }

  // Ties are broken by how many fields agreed, then by mrn, so the list a clerk sees is stable
  // between keystrokes rather than reshuffling on every render.
  const agreedCount = (hit) => hit.match.breakdown.filter((f) => f.agreed).length;
  scored.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    const byAgreement = agreedCount(y) - agreedCount(x);
    if (byAgreement !== 0) return byAgreement;
    return String(x.patient.mrn || "").localeCompare(String(y.patient.mrn || ""));
  });

  return typeof options.limit === "number" ? scored.slice(0, options.limit) : scored;
}

/* ------------------------------------------------------------------ provisional identity */

/**
 * Date of birth placed on an unidentified arrival. Not a valid calendar date in any locale, so age
 * arithmetic against it yields NaN/Invalid Date and fails loudly instead of quietly producing an age
 * for a patient nobody has identified. Anything plausible (1900-01-01, today's date) would be worse:
 * it would be silently believed, dosed against, and eventually carried through a merge.
 */
const PROVISIONAL_DOB_SENTINEL = "0000-00-00";

function sexToken(sex) {
  const normalized = typeof sex === "string" ? sex.trim().toLowerCase() : "";
  if (normalized === "male" || normalized === "m") return "MALE";
  if (normalized === "female" || normalized === "f") return "FEMALE";
  if (normalized === "" || normalized === "unknown") return "UNKNOWN";
  return normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** YYYYMMDD in UTC. UTC, not local time, so two nodes in different timezones give one trauma
 * arrival the same mrn instead of two. */
function compactDate(arrivedAt) {
  const date = arrivedAt instanceof Date ? arrivedAt : new Date(arrivedAt);
  if (Number.isNaN(date.getTime())) throw new TypeError("makeProvisionalIdentity requires a valid arrivedAt");
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Builds the record an unidentified emergency arrival is registered under, so care (and its audit
 * trail) can start before anyone knows who the patient is.
 *
 * mrn form: TRAUMA-UNKNOWN-MALE-20260903-01, human-readable at the resus bay whiteboard and unique
 * per arrival day, which is what lets a second unidentified arrival that shift not collide with the
 * first. The record is flagged provisional so downstream code knows it is expected to be merged.
 *
 * @param {{sex?: string, arrivedAt: string|Date, sequence: number, name?: string}} input
 * @returns {object} Patient
 */
function makeProvisionalIdentity(input) {
  const spec = input || {};
  const sequence = spec.sequence;
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new TypeError("makeProvisionalIdentity requires an integer sequence >= 1");
  }
  const token = sexToken(spec.sex);
  const day = compactDate(spec.arrivedAt);
  // Padded to two digits for readability; a day past 99 unidentified arrivals keeps counting rather
  // than wrapping, because a colliding mrn is a wrong-patient hazard and an ugly one is not.
  const mrn = `TRAUMA-UNKNOWN-${token}-${day}-${String(sequence).padStart(2, "0")}`;

  return Patient({
    mrn,
    name: spec.name || `Unidentified Patient ${token} ${String(sequence).padStart(2, "0")}`,
    dob: PROVISIONAL_DOB_SENTINEL,
    sex: spec.sex || "unknown",
    provisional: true,
    effectiveAt: typeof spec.arrivedAt === "string" ? spec.arrivedAt : undefined,
  });
}

/* ------------------------------------------------------------------ merge / unmerge */

function deepCopy(value) {
  return structuredClone(value);
}

/**
 * @typedef {{field: string, survivorValue: any, duplicateValue: any, detail: string}} MergeConflict
 * @typedef {{survivorId: string, duplicateId: string, survivor: object, duplicate: object,
 *   actorId: string, mergedAt: string, reason: string|null, conflicts: MergeConflict[]}} MergeRecord
 */

/** Every disagreement a human must adjudicate. Absent values never conflict; "unknown" sex and the
 * provisional dob sentinel count as absent, since they assert nothing to disagree with. */
function detectConflicts(survivor, duplicate, thresholds) {
  /** @type {MergeConflict[]} */
  const conflicts = [];

  const sDob = dobOf(survivor);
  const dDob = dobOf(duplicate);
  if (sDob && dDob && sDob !== dDob) {
    conflicts.push({ field: "dob", survivorValue: sDob, duplicateValue: dDob, detail: `date of birth differs (${sDob} vs ${dDob})` });
  }

  const sSex = sexOf(survivor);
  const dSex = sexOf(duplicate);
  if (sSex && dSex && sSex !== dSex) {
    conflicts.push({ field: "sex", survivorValue: sSex, duplicateValue: dSex, detail: `sex differs (${sSex} vs ${dSex})` });
  }

  const sName = normalizeName(survivor && survivor.name);
  const dName = normalizeName(duplicate && duplicate.name);
  if (sName && dName) {
    const similarity = jaroWinkler(sName, dName);
    if (similarity < thresholds.nameAgreement) {
      conflicts.push({
        field: "name",
        survivorValue: survivor.name,
        duplicateValue: duplicate.name,
        detail: `names differ beyond threshold (Jaro-Winkler ${similarity.toFixed(2)} < ${thresholds.nameAgreement})`,
      });
    }
  }

  const sIds = identifierMap(survivor);
  const dIds = identifierMap(duplicate);
  for (const [system, dValue] of dIds) {
    if (!sIds.has(system)) continue;
    const sValue = sIds.get(system);
    if (sValue !== dValue) {
      conflicts.push({
        field: `identifier:${system}`,
        survivorValue: sValue,
        duplicateValue: dValue,
        detail: `${system} differs (${sValue} vs ${dValue})`,
      });
    }
  }

  return conflicts;
}

/**
 * Links a duplicate record into a survivor. Pure: neither input is mutated, and everything needed to
 * undo the link is in the returned record.
 *
 * Conflict policy: a field where both records assert a different value is NEVER silently resolved.
 * The merged record keeps the SURVIVOR's value and the disagreement is listed for a human. The same
 * applies to identifiers: a conflicting system contributes nothing to the union, because writing
 * two different ABHA numbers onto one chart converts a visible conflict into an invisible one.
 *
 * @param {object} survivor the record that continues to exist
 * @param {object} duplicate the record being folded into it
 * @param {{actorId: string, reason?: string, at?: string}} ctx who is doing this, and why
 * @returns {{merged: object, mergeRecord: MergeRecord}}
 */
function merge(survivor, duplicate, ctx) {
  if (!survivor || typeof survivor !== "object") throw new TypeError("merge() needs a survivor Patient");
  if (!duplicate || typeof duplicate !== "object") throw new TypeError("merge() needs a duplicate Patient");
  const context = ctx || {};
  if (typeof context.actorId !== "string" || context.actorId.trim() === "") {
    // A merge is a clinical act with a wrong-patient failure mode. It is never anonymous.
    throw new TypeError("merge() needs ctx.actorId, because a merge is always attributable to a person");
  }
  if (survivor.id && duplicate.id && survivor.id === duplicate.id) {
    throw new TypeError("merge() refuses to merge a record into itself");
  }

  const thresholds = { ...DEFAULT_THRESHOLDS, ...(context.thresholds || {}) };
  const conflicts = detectConflicts(survivor, duplicate, thresholds);
  const conflictedSystems = new Set(
    conflicts.filter((c) => c.field.startsWith("identifier:")).map((c) => c.field.slice("identifier:".length)),
  );

  // Union of identifiers: survivor's list in its original order, then any of the duplicate's that the
  // survivor does not already carry and that are not in conflict.
  const survivorIdentifiers = deepCopy(identifierList(survivor));
  const seen = new Set(
    survivorIdentifiers
      .filter((id) => id && typeof id.system === "string")
      .map((id) => `${id.system.trim().toUpperCase()}|${String(id.value).trim()}`),
  );
  const identifiers = survivorIdentifiers.slice();
  for (const id of identifierList(duplicate)) {
    if (!id || typeof id.system !== "string" || id.value === undefined || id.value === null) continue;
    const system = id.system.trim().toUpperCase();
    const key = `${system}|${String(id.value).trim()}`;
    if (seen.has(key)) continue;
    if (!PHONE_SYSTEMS.test(id.system) && conflictedSystems.has(system)) continue;
    seen.add(key);
    identifiers.push(deepCopy(id));
  }

  const mergedAt = context.at || new Date().toISOString();
  const merged = {
    ...deepCopy(survivor),
    identifiers,
    // Lineage, not a new record: the merged chart is the survivor's, and derivedFrom is how the
    // temporal/audit layer later explains where the extra identifiers came from.
    meta: {
      ...deepCopy(survivor.meta || {}),
      derivedFrom: [...((survivor.meta && survivor.meta.derivedFrom) || []), duplicate.id].filter(Boolean),
    },
  };

  /** @type {MergeRecord} */
  const mergeRecord = {
    survivorId: survivor.id || null,
    duplicateId: duplicate.id || null,
    // Full deep copies, not references and not diffs. unmerge() must be able to restore both records
    // exactly from this object alone, years later, with no access to whatever the store now holds.
    survivor: deepCopy(survivor),
    duplicate: deepCopy(duplicate),
    actorId: context.actorId,
    mergedAt,
    reason: context.reason || null,
    conflicts,
  };

  return { merged, mergeRecord };
}

/**
 * Restores both records exactly as they were before a merge. A pure function of the record: it reads
 * nothing but its argument, so an unmerge is reproducible and testable in isolation, and a merge that
 * cannot be undone from its own record is a bug this signature makes impossible.
 * @param {MergeRecord} mergeRecord
 * @returns {{survivor: object, duplicate: object}}
 */
function unmerge(mergeRecord) {
  if (!mergeRecord || typeof mergeRecord !== "object" || !mergeRecord.survivor || !mergeRecord.duplicate) {
    throw new TypeError("unmerge() needs a merge record carrying both original patients");
  }
  return {
    survivor: deepCopy(mergeRecord.survivor),
    duplicate: deepCopy(mergeRecord.duplicate),
  };
}

export {
  normalizeName,
  soundex,
  jaroWinkler,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  scoreMatch,
  findCandidates,
  PROVISIONAL_DOB_SENTINEL,
  makeProvisionalIdentity,
  merge,
  unmerge,
};
