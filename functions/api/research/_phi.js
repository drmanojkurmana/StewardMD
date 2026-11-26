/* ResearchMD Phase 3 deterministic PHI/PII gate (ES module, server side).
 * Contract: docs/research/contracts/phase-3/phi-gate.md.
 * PORT of backend/research/paperorchestra/adapter/po_adapter/phi.py: same
 * rules, same categories, same 40-char window, same checksum gating. The
 * shared vector file docs/research/contracts/phase-3/phi-vectors.json is run
 * by BOTH test/research-phase3-api.test.mjs and
 * backend/research/tests/test_phi_vectors.py so the two gates cannot drift.
 *
 * scan(text, opts?) -> { blocked, hits: [{category, rule, start, end}] }.
 * opts.publicSpans marks server-established published bibliographic regions
 * (see below); with no opts the rules are identical to phi.py.
 * Hits never carry the matched text (categories only in logs/callbacks).
 * No LLM is involved: an LLM judging PHI would itself receive the PHI.
 * Checksum validators gate the id regexes (a 12-digit number failing
 * Verhoeff is not an Aadhaar hit); this is the main false-positive control.
 */

/* --- Verhoeff (Aadhaar) ---------------------------------------------------- */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffValid(digits) {
  let c = 0;
  const rev = String(digits).split("").reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(rev[i])]];
  return c === 0;
}
/* Check digit for an 11-digit base; tests build synthetic ids with it. */
export function verhoeffCheckDigit(digits) {
  let c = 0;
  const rev = String(digits).split("").reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][Number(rev[i])]];
  return VERHOEFF_INV[c];
}
export function nhsMod11Valid(digits) {
  const s = String(digits);
  if (s.length !== 10 || !/^\d{10}$/.test(s)) return false;
  let total = 0;
  for (let i = 0; i < 9; i++) total += Number(s[i]) * (10 - i);
  let check = 11 - (total % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === Number(s[9]);
}

/* --- patterns (identical to phi.py) ---------------------------------------- */
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";
/* Full day-level dates in common formats. Month-year and bare years are NOT
 * full dates (allowed: enrolment periods, study dates). */
const FULL_DATE =
  "(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}" +
  "|\\d{4}-\\d{1,2}-\\d{1,2}" +
  "|\\d{1,2}\\s+" + MONTH + "\\s+\\d{2,4}" +
  "|" + MONTH + "\\s+\\d{1,2},?\\s+\\d{4})";

const PATIENT_LABEL =
  "\\b(?:patient|patients|Mr\\.|Mrs\\.|Ms\\.|admitted|discharged|diagnosed" +
  "|ward|bed no|IP no|OP no)\\b";
const NAME_BIGRAM = "\\b[A-Z][a-z]{1,20}\\s+[A-Z][a-z]{1,20}(?:\\s+[A-Z][a-z]{1,20})?\\b";
const BIRTH_LABEL = "\\b(?:DOB|date of birth|born on|birth date)\\b";
const ADMISSION_LABEL = "\\b(?:admitted on|admission date|discharged on)\\b";
const STREET = "(?:road|street|nagar|colony|lane|avenue|apt|flat)";

const WINDOW = 40; /* chars, per phi-gate.md */

function near(text, start, end, labelRe) {
  const lo = Math.max(0, start - WINDOW);
  const hi = Math.min(text.length, end + WINDOW);
  return labelRe.test(text.slice(lo, hi));
}
/* Sentence span around a match: from the last .!? before it to the first
 * .!? after it (same logic as phi.py _same_sentence). */
function sameSentence(text, start, end) {
  const lo = Math.max(text.lastIndexOf(".", start - 1), text.lastIndexOf("!", start - 1),
    text.lastIndexOf("?", start - 1)) + 1;
  const stops = [];
  for (const ch of [".", "!", "?"]) {
    const s = text.indexOf(ch, end);
    if (s !== -1) stops.push(s);
  }
  const hi = stops.length ? Math.min(...stops) + 1 : text.length;
  return text.slice(lo, hi);
}

const BIRTH_RE = new RegExp(BIRTH_LABEL, "i");
const PATIENT_RE = new RegExp(PATIENT_LABEL, "i");
const ADMISSION_RE = new RegExp(ADMISSION_LABEL, "i");

/* Bibliographic context for server-marked public spans (published paper text).
 * phi-gate.md Allowed: author names, affiliations, department and hospital
 * names. A published abstract is full of capitalized institutional/clinical
 * phrases ("Intensive Care Unit", "Prospective Observational Study") sitting
 * next to the generic plural "patients" or the methods verb "admitted"; the
 * loose 40-char window mistakes those for patient names. Inside a public span
 * a capitalized phrase is a patient name ONLY when it is explicitly ascribed to
 * a person: a singular patient label or honorific attached to the name, or a
 * ward/bed/ID label right after it ("Patient Ramesh Kumar", "the patient Priya
 * Sharma", "Mr. John Smith", "Ramesh Kumar, ward 4 bed no 12"). Hard identifier
 * rules (mrn/aadhaar/ssn/nhs/phone/email) are never relaxed, in any span. */
const ASCRIPTION_BEFORE = /(?:\b(?:the\s+)?patient\s*:?\s*|\b(?:Mr\.|Mrs\.|Ms\.)\s*)$/i;
const ASCRIPTION_LEADING = /^(?:patient|Mr\.|Mrs\.|Ms\.)\b\s*:?\s*/i;
const ASCRIPTION_AFTER = /^\s*,?\s*(?:ward|bed\s+no|IP\s+no|OP\s+no)\b/i;

function inPublicSpan(start, end, publicSpans) {
  for (let i = 0; i < publicSpans.length; i++) {
    const sp = publicSpans[i];
    if (start >= sp.start && end <= sp.end) return true;
  }
  return false;
}
function patientAscribed(text, start, end) {
  const pre = text.slice(Math.max(0, start - 24), start);
  const post = text.slice(end, end + 24);
  const body = text.slice(start, end);
  return ASCRIPTION_BEFORE.test(pre) || ASCRIPTION_LEADING.test(body) || ASCRIPTION_AFTER.test(post);
}

/* (category, rule, regex, validator) in the same order as phi.py _RULES. */
const RULES = [
  ["mrn", "labelled_id",
    new RegExp("\\b(?:MRN|UHID|medical\\s+record(?:\\s+(?:no|number|#))?|hospital\\s+no" +
      "|IP\\s+no|OP\\s+no|IP/OP\\s+no)\\b[\\s:.#-]*([A-Za-z0-9-]{4,16})", "gi"),
    (m) => { const v = m[1]; return /\d/.test(v) && v.length >= 4 && v.length <= 16; }],
  ["aadhaar", "verhoeff_12",
    /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g,
    (m) => verhoeffValid(m[0].replace(/[ -]/g, ""))],
  ["ssn", "area_group_serial",
    /(?<!\d)(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?!\d)/g, null],
  ["nhs", "mod11_10", /(?<!\d)\d{10}(?!\d)/g, (m) => nhsMod11Valid(m[0])],
  ["phone", "e164", /(?<![\w.])\+[1-9]\d{7,14}(?!\d)/g, null],
  /* "/" in the lookbehind keeps DOI suffixes (10.1234/6123456789) out. */
  ["phone", "indian_mobile",
    /(?<![\w./])(?:\+91[ -]?|0)?[6-9]\d{9}(?![\dA-Za-z])/g, null],
  ["email", "addr_spec",
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, null],
  ["dob", "date_near_birth_label", new RegExp(FULL_DATE, "gi"),
    (m, text) => near(text, m.index, m.index + m[0].length, BIRTH_RE)],
  ["address", "street_number",
    new RegExp("\\b\\d{1,5}[A-Za-z]?\\s+(?:[A-Za-z]+\\s+){0,3}" + STREET + "\\b", "gi"), null],
  ["address", "pin_with_label",
    /\b(?:PIN\s*code|PIN|postal\s+code|zip\s*code)\D{0,10}(\d{6})\b/gi, null],
  ["patient_name", "name_near_patient_label", new RegExp(NAME_BIGRAM, "g"),
    (m, text) => near(text, m.index, m.index + m[0].length, PATIENT_RE)],
  ["admission_date", "date_near_admission_label", new RegExp(FULL_DATE, "gi"),
    (m, text) => near(text, m.index, m.index + m[0].length, ADMISSION_RE) &&
      PATIENT_RE.test(sameSentence(text, m.index, m.index + m[0].length))],
];

/* opts.publicSpans: [{start, end}] regions the SERVER has established are
 * published bibliographic text (e.g. a paper-card prompt assembled from a
 * public connector cache). Only the context-dependent patient_name rule is
 * relaxed there, and only for phrases not explicitly ascribed to a patient.
 * With no publicSpans the behaviour is identical to phi.py and the shared
 * vectors; callers must never pass client/worker-supplied spans. */
export function scan(text, opts = {}) {
  const s = String(text == null ? "" : text);
  const publicSpans = Array.isArray(opts.publicSpans) ? opts.publicSpans : [];
  const hits = [];
  for (const [category, rule, pattern, validator] of RULES) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(s)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex++; continue; }
      if (validator && !validator(m, s)) continue;
      const start = m.index, end = m.index + m[0].length;
      if (category === "patient_name" && publicSpans.length &&
        inPublicSpan(start, end, publicSpans) && !patientAscribed(s, start, end)) continue;
      hits.push({ category, rule, start, end });
    }
  }
  hits.sort((a, b) => a.start - b.start || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { blocked: hits.length > 0, hits };
}

/* The job fails with code phi_blocked; only categories are logged. */
export function phiCategories(hits) {
  return [...new Set(hits.map((h) => h.category))].sort();
}
