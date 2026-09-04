/* wardsynq/wardsynq-research.js — de-identification, and the confidence that makes it dangerous.
 *
 * The hazard in a de-identification module is not that it fails. It is that it succeeds visibly and
 * fails invisibly: the name is gone, the record looks anonymous, and the person is still identifiable
 * from their date of birth, their postcode and their rare diagnosis. The output LOOKS safe, which is
 * exactly why it gets shared.
 *
 *   1. SAFE HARBOR IS A FLOOR, NOT A PROOF. Removing the eighteen identifier classes is a recipe, and
 *      a recipe is not a guarantee. This module applies it and then says so, in the output, every
 *      time. Nothing here returns the word "anonymous".
 *   2. QUASI-IDENTIFIERS ARE THE ACTUAL RISK. Date of birth, sex and postcode identify a large
 *      fraction of people on their own. So the module computes k-anonymity across the released
 *      dataset and REFUSES to release rows that are unique on their quasi-identifiers, because those
 *      rows are not de-identified whatever their name field says.
 *   3. A RARE DIAGNOSIS IS AN IDENTIFIER. There may be one patient in the state with that condition,
 *      and no amount of date shifting hides them. Rare values are detected and flagged rather than
 *      silently released.
 *   4. DATE SHIFTING MUST BE PER-PATIENT AND CONSISTENT. A single offset across the dataset preserves
 *      every interval, which is often the research value, but shifting each record independently
 *      destroys the clinical sequence and produces a dataset that is both useless and still
 *      re-identifiable by interval. One offset per patient, stable across their records.
 *   5. FREE TEXT IS NOT DE-IDENTIFIABLE BY THIS MODULE. Clinical narrative contains names, places,
 *      relatives and job titles in unbounded forms. A regular expression over a discharge summary
 *      produces text that looks scrubbed and is not, which is worse than not scrubbing it. Free text
 *      is REMOVED, never "cleaned".
 *
 * WHAT THIS IS NOT. It is not a certification of compliance with HIPAA, the DPDP Act or any other
 * regime, and it does not implement Expert Determination, which requires a qualified statistician and
 * cannot be a function. A dataset this module produces is a candidate for release, not a released
 * dataset, and the caveat travels with it.
 *
 * NOT MODELLED: differential privacy, l-diversity and t-closeness, synthetic data generation,
 * genomic data (which is inherently identifying and must never go through this path), imaging pixel
 * and DICOM header scrubbing, and re-identification risk against external linkage datasets.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT certified for any regulatory regime.
 *
 * node --test test/wardsynq-research.test.mjs
 */

/**
 * The Safe Harbor identifier classes, as field-name patterns. Field NAMES are a weak signal, which
 * is why an unrecognised field is reported rather than assumed safe.
 */
const DIRECT_IDENTIFIERS = Object.freeze([
  "name", "givenname", "familyname", "surname", "firstname", "lastname", "middlename",
  "mrn", "uhid", "nhsnumber", "ssn", "aadhaar", "abha", "healthid", "insurancenumber",
  "address", "street", "postcode", "zip", "zipcode", "pincode",
  "phone", "mobile", "telephone", "fax", "email",
  "url", "ip", "ipaddress", "devicebarcode", "wristbandbarcode", "licenceplate", "vehicleid",
  "biometric", "fingerprint", "photo", "faceimage", "certificatenumber", "accountnumber",
  "employer", "relativename", "nextofkin", "guardianname",
]);

/** Fields whose value identifies by rarity or precision rather than by being a name. */
const QUASI_IDENTIFIERS = Object.freeze(["dob", "dateofbirth", "sex", "gender", "ethnicity", "postcodeprefix", "district", "occupation", "ageyears"]);

/** Free text is removed, never scrubbed. */
const FREE_TEXT_FIELDS = Object.freeze(["notes", "narrative", "summary", "history", "comment", "comments", "impression", "indication", "freetext", "clinicalnote"]);

/**
 * Ages above this are aggregated. A very old patient is rare enough to be identifying, which is why
 * Safe Harbor treats 90-and-over as a single bucket.
 */
const AGE_CEILING = 89;

/** Minimum group size on the quasi-identifiers. A row in a smaller group is not de-identified. */
const DEFAULT_K = 5;

class ResearchError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ResearchError";
    this.code = code || "RESEARCH_VIOLATION";
  }
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const classify = (field) => {
  const n = norm(field);
  if (DIRECT_IDENTIFIERS.some((d) => n === d || n.endsWith(d) || n.startsWith(d))) return "direct";
  if (FREE_TEXT_FIELDS.some((f) => n === f || n.includes(f))) return "free-text";
  if (QUASI_IDENTIFIERS.some((q) => n === q)) return "quasi";
  return "unknown";
};

/**
 * A deterministic per-patient date offset.
 *
 * Per-patient and stable, so intervals within one patient's record survive and are the research
 * value, while intervals BETWEEN patients carry no absolute anchor. A single dataset-wide offset
 * would let anyone who knows one real date recover every other.
 */
function offsetDaysFor(patientId, salt, maxDays = 365) {
  let h = 0;
  const s = `${salt}:${patientId}`;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return (Math.abs(h) % (maxDays * 2 + 1)) - maxDays;
}

const shiftDate = (iso, days) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + days * 86_400_000).toISOString();
};

/**
 * De-identifies one record.
 *
 * @param {object} record
 * @param {{salt: string, dateFields?: string[], keepFields?: string[], now?: string}} opts
 * @returns {{row: object, removed: string[], shifted: string[], unknownFields: string[],
 *   pseudonym: string}}
 */
function deidentifyRecord(record, { salt, dateFields = [], keepFields = [] } = {}) {
  if (!salt) {
    throw new ResearchError("a salt is required, and must be held separately from the released dataset; without one the pseudonyms are reversible by anyone who can guess the scheme", "NO_SALT");
  }
  if (!record || !record.patientId) throw new ResearchError("a record needs a patientId to pseudonymise", "NO_PATIENT");

  const offset = offsetDaysFor(record.patientId, salt);
  const row = {};
  const removed = [];
  const shifted = [];
  const unknownFields = [];
  const keep = new Set(keepFields.map(norm));

  for (const [field, value] of Object.entries(record)) {
    if (field === "patientId") continue;
    const kind = classify(field);

    if (kind === "direct") { removed.push(field); continue; }
    if (kind === "free-text") {
      // Not scrubbed. A regular expression over a discharge summary produces text that LOOKS
      // scrubbed and still names the referring GP, the patient's daughter and their employer.
      removed.push(field);
      continue;
    }

    if (dateFields.includes(field)) {
      const s = shiftDate(value, offset);
      if (s === null) { removed.push(field); continue; }
      row[field] = s;
      shifted.push(field);
      continue;
    }

    if (norm(field) === "ageyears" || norm(field) === "age") {
      const n = Number(value);
      row[field] = Number.isFinite(n) && n > AGE_CEILING ? AGE_CEILING + 1 : n;
      row[`${field}Capped`] = Number.isFinite(n) && n > AGE_CEILING;
      continue;
    }

    if (kind === "unknown" && !keep.has(norm(field))) {
      // The important default. An unrecognised field is not assumed safe: field names are a weak
      // signal, and "referrerNotes" or "bedLabel" can carry anything.
      unknownFields.push(field);
      removed.push(field);
      continue;
    }

    row[field] = value;
  }

  return {
    row: { ...row, pseudonym: pseudonymise(record.patientId, salt) },
    removed, shifted, unknownFields,
    pseudonym: pseudonymise(record.patientId, salt),
    dateOffsetApplied: true,
  };
}

/** A stable pseudonym. Not a hash of the id alone, which is trivially reversible by dictionary. */
function pseudonymise(patientId, salt) {
  let h1 = 0x811c9dc5;
  const s = `${salt}|${patientId}`;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  let h2 = 0xc2b2ae35;
  for (let i = s.length - 1; i >= 0; i--) {
    h2 ^= s.charCodeAt(i);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `P-${h1.toString(36)}${h2.toString(36)}`.toUpperCase();
}

/**
 * k-anonymity across the released rows.
 *
 * This is where a dataset that passed Safe Harbor gets caught. A 47-year-old woman in one district
 * with one rare condition may be the only such row, and she is identifiable however thoroughly her
 * name was deleted.
 */
function kAnonymity(rows, quasiFields, k = DEFAULT_K) {
  const groups = new Map();
  for (const row of rows) {
    const key = quasiFields.map((f) => String(row[f] ?? "")).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const sizes = [...groups.values()].map((g) => g.length);
  const smallest = sizes.length ? Math.min(...sizes) : 0;
  const violating = [...groups.entries()].filter(([, g]) => g.length < k);

  return {
    k,
    achievedK: smallest,
    satisfied: sizes.length > 0 && smallest >= k,
    groups: groups.size,
    violatingGroups: violating.length,
    violatingRows: violating.reduce((n, [, g]) => n + g.length, 0),
    uniqueRows: sizes.filter((n) => n === 1).length,
    quasiFields,
  };
}

/** Values so rare in the dataset that they identify on their own. */
function rareValues(rows, fields, threshold = DEFAULT_K) {
  const found = [];
  for (const field of fields) {
    const counts = new Map();
    for (const row of rows) {
      const v = row[field];
      if (v === undefined || v === null || v === "") continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    for (const [value, n] of counts) {
      if (n < threshold) found.push({ field, value, count: n });
    }
  }
  return found;
}

/**
 * Prepares a release, and refuses to call it anonymous.
 *
 * Rows that fail k-anonymity are WITHHELD rather than released with a warning, because a warning
 * attached to a dataset does not travel with the row once somebody opens it in a spreadsheet.
 */
function prepareRelease(records, {
  salt, dateFields = [], quasiFields = [], keepFields = [], k = DEFAULT_K,
  rareValueFields = [], purpose, requestedBy,
} = {}) {
  if (!purpose || !requestedBy) {
    throw new ResearchError("a release needs a stated purpose and a named requester; data released without a recorded purpose cannot be audited or revoked", "NO_PURPOSE");
  }

  const deidentified = records.map((r) => deidentifyRecord(r, { salt, dateFields, keepFields }));
  const allRows = deidentified.map((d) => d.row);

  const kResult = kAnonymity(allRows, quasiFields, k);
  const rare = rareValues(allRows, rareValueFields, k);

  // Withhold, do not warn. A row that is unique on its quasi-identifiers is not de-identified, and
  // shipping it with a note attached means shipping it.
  const groupCounts = new Map();
  for (const row of allRows) {
    const key = quasiFields.map((f) => String(row[f] ?? "")).join("|");
    groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
  }
  const released = [];
  const withheld = [];
  for (const row of allRows) {
    const key = quasiFields.map((f) => String(row[f] ?? "")).join("|");
    const size = quasiFields.length ? groupCounts.get(key) : Infinity;
    if (size < k) {
      withheld.push({ pseudonym: row.pseudonym, reason: `only ${size} row${size > 1 ? "s" : ""} share this combination of ${quasiFields.join(", ")}; below k=${k} this row identifies a person` });
    } else {
      released.push(row);
    }
  }

  const removedFields = [...new Set(deidentified.flatMap((d) => d.removed))];
  const unknownFields = [...new Set(deidentified.flatMap((d) => d.unknownFields))];

  return {
    purpose, requestedBy,
    rows: released,
    releasedCount: released.length,
    withheld,
    withheldCount: withheld.length,
    removedFields,
    // Surfaced loudly: these were dropped because the module did not recognise them, which means a
    // human should look at whether they were research-relevant and can be safely re-included.
    unknownFieldsDropped: unknownFields,
    kAnonymity: kResult,
    rareValues: rare,
    // The sentence that must travel with every dataset this produces.
    disclaimer: "This dataset is DE-IDENTIFIED, not anonymous. Safe Harbor field removal is a recipe, not a proof, and re-identification remains possible through linkage with external data. It is not certified against HIPAA, the DPDP Act or any other regime, and Expert Determination has not been performed. Treat it as personal data under a data use agreement.",
    warnings: [
      ...(kResult.satisfied ? [] : [`k-anonymity of ${k} is NOT satisfied by the released set; smallest group is ${kResult.achievedK}`]),
      ...(rare.length ? [`${rare.length} rare value${rare.length > 1 ? "s" : ""} appear fewer than ${k} times and may identify on their own`] : []),
      ...(unknownFields.length ? [`${unknownFields.length} unrecognised field${unknownFields.length > 1 ? "s were" : " was"} dropped rather than assumed safe: ${unknownFields.join(", ")}`] : []),
    ],
  };
}

export {
  DIRECT_IDENTIFIERS, QUASI_IDENTIFIERS, FREE_TEXT_FIELDS, AGE_CEILING, DEFAULT_K,
  ResearchError,
  classify, pseudonymise, offsetDaysFor, deidentifyRecord, kAnonymity, rareValues, prepareRelease,
};
