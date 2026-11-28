/* ResearchMD Phase 3 deterministic PHI/PII gate (ES module, server side).
 * Contract: docs/research/contracts/phase-3/phi-gate.md.
 * PORT of backend/research/paperorchestra/adapter/po_adapter/phi.py: same
 * rules, same categories, same 40-char window, same checksum gating. The
 * shared vector file docs/research/contracts/phase-3/phi-vectors.json is run
 * by BOTH test/research-phase3-api.test.mjs and
 * backend/research/tests/test_phi_vectors.py so the two gates cannot drift.
 *
 * scan(text, opts) -> { blocked, hits: [{category, rule, start, end}] }.
 * Default mode is literature-safe: every rule EXCEPT the plain any-full-date
 * rule, so published search results with publicationDate pass. opts.mode
 * "user" adds dates/full_date and is used only for text a person typed (the
 * /ai-draft handler, protocol text and grade rationale in a manuscript job).
 * Birth and admission dates stay context-gated in both modes.
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
/* Digit guards keep a date out of longer id runs (CTRI/2020/01/023456). */
const FULL_DATE =
  "(?<!\\d)(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}" +
  "|\\d{4}-\\d{1,2}-\\d{1,2}" +
  "|\\d{1,2}\\s+" + MONTH + "\\s+\\d{2,4}" +
  "|" + MONTH + "\\s+\\d{1,2},?\\s+\\d{4})(?!\\d)";

const PATIENT_LABEL =
  "\\b(?:patient|Mr\\.|Mrs\\.|Ms\\.|admitted|discharged|diagnosed" +
  "|ward|bed no|IP no|OP no)\\b";
const NAME_BIGRAM = "\\b[A-Z][a-z]{1,20}\\s+[A-Z][a-z]{1,20}(?:\\s+[A-Z][a-z]{1,20})?\\b";
const BIRTH_LABEL = "\\b(?:DOB|date of birth|born on|birth date)\\b";
const ADMISSION_LABEL = "\\b(?:admitted on|admission date|discharged on)\\b";
const STREET = "(?:road|street|nagar|colony|lane|avenue|apt|flat)";
/* House label plus number, then a comma and a locality word: "H.No 12-3-45,
 * Ameerpet", "#14, 2nd Cross". A bare label plus number ("Table #14",
 * "Flat 5 patients") stays allowed. "Flat" must start with a capital F; the
 * other labels keep the old case-insensitive forms by spelling both cases.
 * The locality must start with a capital letter or a digit ordinal. */
const HOUSE = "(?:\\b(?:" +
  "[Hh]\\.?\\s?[Nn][Oo]\\.?|[Hh]\\s+[Nn][Oo]\\.?|[Hh][Oo][Uu][Ss][Ee]\\s+[Nn][Oo]\\.?" +
  "|[Dd][Oo][Oo][Rr]\\s+[Nn][Oo]\\.?|[Dd]\\.?\\s?[Nn][Oo]\\.?|F[Ll][Aa][Tt](?:\\s+[Nn][Oo]\\.?)?" +
  ")[\\s:.#-]*\\d[A-Za-z0-9/-]*|#\\s*\\d[A-Za-z0-9/-]*)" +
  ",\\s*(?:[A-Z][A-Za-z]*|\\d+(?:st|nd|rd|th)\\b)";

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

function isHonorificDot(line, idx) {
  if (line.charAt(idx) !== ".") return false;
  return /\b(?:Mr|Mrs|Ms|Dr)$/i.test(line.slice(Math.max(0, idx - 4), idx));
}

function sameLineSentence(text, start, end) {
  const lineLo = Math.max(text.lastIndexOf("\n", start - 1), text.lastIndexOf("\r", start - 1)) + 1;
  const nIdx = text.indexOf("\n", end);
  const rIdx = text.indexOf("\r", end);
  let lineHi = text.length;
  if (nIdx !== -1 && nIdx < lineHi) lineHi = nIdx;
  if (rIdx !== -1 && rIdx < lineHi) lineHi = rIdx;
  const line = text.slice(lineLo, lineHi);
  const relStart = start - lineLo;
  const relEnd = end - lineLo;
  let sentLo = 0;
  for (let i = relStart - 1; i >= 0; i--) {
    const ch = line.charAt(i);
    if ((ch === "." || ch === "!" || ch === "?") && !isHonorificDot(line, i)) {
      sentLo = i + 1;
      break;
    }
  }
  let sentHi = line.length;
  for (let j = relEnd; j < line.length; j++) {
    const ch2 = line.charAt(j);
    if ((ch2 === "." || ch2 === "!" || ch2 === "?") && !isHonorificDot(line, j)) {
      sentHi = j + 1;
      break;
    }
  }
  return line.slice(sentLo, sentHi);
}

const BIRTH_RE = new RegExp(BIRTH_LABEL, "i");
const PATIENT_RE = new RegExp(PATIENT_LABEL, "i");
const ADMISSION_RE = new RegExp(ADMISSION_LABEL, "i");

function validNameNearLabel(m, text) {
  const phrase = m[0];
  if (/\s+(?:Patient|Patients)$/i.test(phrase)) return false;
  if (/^(?:Patient|Patients)\s+/i.test(phrase)) {
    const rest = phrase.replace(/^(?:Patient|Patients)\s+/i, "").trim().split(/\s+/);
    if (rest.length < 2) return false;
  }
  const end = m.index + phrase.length;
  if (!near(text, m.index, end, PATIENT_RE)) return false;
  return PATIENT_RE.test(sameLineSentence(text, m.index, end));
}

const CITATION_MARKERS = [
  "--- INPUT: citation_map.json (Reference Library) ---",
  "--- CITATION MAP (Reference Truth) ---",
];

function citationLibrarySpans(text) {
  const spans = [];
  const endRe = /\n--- (?:INPUT:|CURRENT |EXPERIMENTAL |CONFERENCE |CITATION )/;
  for (const marker of CITATION_MARKERS) {
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(marker, from);
      if (idx === -1) break;
      const tail = text.slice(idx + marker.length);
      const em = endRe.exec(tail);
      const spanEnd = em ? (idx + marker.length + em.index) : text.length;
      spans.push([idx, spanEnd]);
      from = spanEnd + 1;
    }
  }
  return spans;
}

function inSpans(start, end, spans) {
  for (const sp of spans) {
    if (start >= sp[0] && end <= sp[1]) return true;
  }
  return false;
}

/* Bibliographic identifiers are not patient identifiers. A run of ten digits
 * inside a record id can satisfy the NHS checksum, so numeric PHI rules skip
 * PMIDs, DOIs, trial registrations and internal row ids. */
const ID_TOKEN_RE =
  /(?:\[?PMID\s*:?\s*\d+\]?|PMC\d+|DOI\s*:?\s*10\.[^\s,;)\]]+|NCT\d{8}|ISRCTN\d+|CTRI\/[^\s,;]+|\b(?:rec|st|run|job|prj|srch|ddg|pdf|prot|aut|ma)_[A-Za-z0-9]+)/gi;
const NUMERIC_CATEGORIES = new Set(["nhs", "aadhaar", "abha", "ssn", "phone", "dob", "admission_date", "dates"]);
function identifierSpans(text) {
  const spans = [];
  ID_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = ID_TOKEN_RE.exec(text)) !== null) spans.push([m.index, m.index + m[0].length]);
  return spans;
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
  /* ABHA address (client rule, phi-india.js) and 2-4-4-4 number forms.
   * Unbroken 14 digits count only when labelled ABHA. */
  ["abha", "addr",
    /\b[A-Za-z0-9._-]{2,}@(?:abdm|sbx)\b/gi, null],
  ["abha", "number_14",
    /(?<!\d)\d{2}[ -]\d{4}[ -]\d{4}[ -]\d{4}(?!\d)/g, null],
  ["abha", "labelled_number",
    /\bABHA(?:\s*(?:No\.?|Number|ID))?\b[\s:.#-]*(\d{14})(?!\d)/gi, null],
  ["ssn", "area_group_serial",
    /(?<!\d)(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?!\d)/g, null],
  ["nhs", "mod11_10", /(?<!\d)\d{10}(?!\d)/g, (m) => nhsMod11Valid(m[0])],
  ["phone", "e164", /(?<![\w.])\+[1-9]\d{7,14}(?!\d)/g, null],
  /* "/" in the lookbehind keeps DOI suffixes (10.1234/6123456789) out. */
  ["phone", "indian_mobile",
    /(?<![\w./])(?:\+91[ -]?|0)?[6-9]\d{9}(?![\dA-Za-z])/g, null],
  /* Spaced mobile: "98765 43210". Same guards as indian_mobile. The optional
   * separator also matches the unspaced form; scan() dedupes identical spans. */
  ["phone", "indian_mobile_spaced",
    /(?<![\w./])(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\dA-Za-z])/g, null],
  ["email", "addr_spec",
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, null],
  ["dob", "date_near_birth_label", new RegExp(FULL_DATE, "gi"),
    (m, text) => near(text, m.index, m.index + m[0].length, BIRTH_RE)],
  ["address", "street_number",
    new RegExp("\\b\\d{1,5}[A-Za-z]?\\s+(?:[A-Za-z]+\\s+){0,3}" + STREET + "\\b", "gi"), null],
  ["address", "house_locality", new RegExp(HOUSE, "g"), null],
  ["address", "pin_with_label",
    /\b(?:PIN\s*code|PIN|postal\s+code|zip\s*code)\D{0,10}(\d{6})\b/gi, null],
  ["patient_name", "name_near_patient_label", new RegExp(NAME_BIGRAM, "g"), validNameNearLabel],
  ["admission_date", "date_near_admission_label", new RegExp(FULL_DATE, "gi"),
    (m, text) => near(text, m.index, m.index + m[0].length, ADMISSION_RE) &&
      PATIENT_RE.test(sameSentence(text, m.index, m.index + m[0].length))],
];

/* User-typed text only: any day-level date blocks on its own. Month-year and
 * bare years stay allowed (enrolment periods, study dates). Published
 * literature keeps the default exemption so search results with a
 * publicationDate pass (owner decision A). */
const USER_ONLY_RULES = [
  ["dates", "full_date", new RegExp(FULL_DATE, "gi"), null],
];

export function scan(text, opts) {
  const s = String(text == null ? "" : text);
  const userMode = !!(opts && opts.mode === "user");
  const allowCitationNames = !!(opts && opts.allowCitationLibraryNames === true);
  const citeSpans = allowCitationNames ? citationLibrarySpans(s) : [];
  const idSpans = identifierSpans(s);
  const rules = userMode ? RULES.concat(USER_ONLY_RULES) : RULES;
  const hits = [];
  const seen = new Set();
  for (const [category, rule, pattern, validator] of rules) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(s)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex++; continue; }
      if (validator && !validator(m, s)) continue;
      const end = m.index + m[0].length;
      if (category === "patient_name" && citeSpans.length && inSpans(m.index, end, citeSpans)) {
        continue;
      }
      if (NUMERIC_CATEGORIES.has(category) && idSpans.length && inSpans(m.index, end, idSpans)) {
        continue;
      }
      /* indian_mobile and indian_mobile_spaced overlap on the unspaced form. */
      const key = category + ":" + m.index + ":" + end;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ category, rule, start: m.index, end });
    }
  }
  hits.sort((a, b) => a.start - b.start || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { blocked: hits.length > 0, hits };
}

/* The job fails with code phi_blocked; only categories are logged. */
export function phiCategories(hits) {
  return [...new Set(hits.map((h) => h.category))].sort();
}

/* --- Thesis PHI masking and soft-hit consent helpers ----------------------- */
const THESIS_HARD_RULES = [
  ["email", "[email]", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, null],
  ["abha", "[ID]", /[A-Za-z0-9._%+-]+@(?:abdm|ndhm)\b/gi, null],
  ["abha", "[ID]", /\bABHA(?:\s*(?:No\.?|Number|ID|Id|Address))?\b[\s:.#-]*([A-Za-z0-9@._-]{4,30})/gi,
    (m) => /[\d@]/.test(m[1])],
  ["abha", "[ID]", /(?<!\d)\d{2}-\d{4}-\d{4}-\d{4}(?!\d)/g, null],
  ["aadhaar", "[ID]", /\bAadhaar(?:\s*(?:No\.?|Number|ID))?\b[\s:.#-]*([0-9Xx*]{4}[ -]?[0-9Xx*]{4}[ -]?\d{4})\b/gi, null],
  ["aadhaar", "[ID]", /(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g,
    (m) => verhoeffValid(m[0].replace(/[ -]/g, ""))],
  ["mrn", "[ID]",
    new RegExp("\\b(?:MRN|UHID|medical\\s+record(?:\\s+(?:no\\.?|number|#|id))?|hospital\\s+(?:no\\.?|number|#|id)" +
      "|hosp\\s+(?:no\\.?|number|#)|IP\\/OP\\s*(?:no\\.?|number|#)?|(?:IPD?|OPD?|CR)\\s*(?:no\\.?|number|#|id)" +
      "|registration\\s*(?:no\\.?|number|#)|reg\\s*(?:no\\.?|number|#))\\b[\\s:.#-]*([A-Za-z0-9/-]{3,20})", "gi"),
    (m) => /\d/.test(m[1]) && m[1].length >= 3 && m[1].length <= 20],
  ["mrn", "[ID]", /\b(?:IPD?|OPD?|CR)\b[\s:#-]+(?=[A-Za-z0-9/-]*\d)\d[A-Za-z0-9/-]{3,19}\b/gi, null],
  ["ssn", "[ID]", /(?<!\d)(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?!\d)/g, null],
  ["phone", "[phone]", /(?<![\w.])\+[1-9]\d{7,14}(?!\d)/g, null],
  ["phone", "[phone]", /(?<![\w./])(?:\+91[ -]?|0)?[6-9]\d{9}(?![\dA-Za-z])/g, null],
  ["phone", "[phone]", /(?<![\w./])(?:\+91[\s.-]?|0)?[6-9]\d{4}[\s.-]\d{5}(?![\dA-Za-z])/g, null],
  ["phone", "[phone]", /(?<![\w./])\+91[\s.-]?\d{3}[\s.-]\d{3}[\s.-]\d{4}(?![\dA-Za-z])/g, null],
  ["phone", "[phone]", /(?<![\w./])(?:\(0\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\b0\d{2,4}-\d{6,8})\b/g,
    (m) => { const d = m[0].replace(/\D/g, ""); return d.length >= 10 && d.length <= 12; }],
  ["nhs", "[ID]", /(?<!\d)\d{10}(?!\d)/g, (m) => nhsMod11Valid(m[0])],
  ["dob", "[DOB]", new RegExp(FULL_DATE, "gi"),
    (m, text) => near(text, m.index, m.index + m[0].length, BIRTH_RE)],
];

const THESIS_SOFT_RULES = [
  ["patient_name", "[name]", "name_near_patient_label", new RegExp(NAME_BIGRAM, "g"),
    (m, text) => near(text, m.index, m.index + m[0].length, PATIENT_RE)],
  ["address", "[address]", "street_number",
    new RegExp("\\b\\d{1,5}[A-Za-z]?\\s+(?:[A-Za-z]+\\s+){0,3}" + STREET + "\\b", "gi"), null],
  ["address", "[address]", "pin_with_label",
    /\b(?:PIN\s*code|PIN|postal\s+code|zip\s*code)\D{0,10}(\d{6})\b/gi, null],
  ["admission_date", "[date]", "date_near_admission_label", new RegExp(FULL_DATE, "gi"),
    (m, text) => near(text, m.index, m.index + m[0].length, ADMISSION_RE) &&
      PATIENT_RE.test(sameSentence(text, m.index, m.index + m[0].length))],
];

function maskThesisText(rawText) {
  const s = String(rawText == null ? "" : rawText);
  const matches = [];
  for (const [category, token, pattern, validator] of THESIS_HARD_RULES) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(s)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex++; continue; }
      if (validator && !validator(m, s)) continue;
      matches.push({ category, token, start: m.index, end: m.index + m[0].length });
    }
  }
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  let lastEnd = -1;
  for (const item of matches) {
    if (item.start < lastEnd) continue;
    kept.push(item);
    lastEnd = item.end;
  }
  if (!kept.length) return { text: s, maskedCount: 0, maskedCategories: [] };
  let out = "";
  let pos = 0;
  const cats = new Set();
  for (const item of kept) {
    out += s.slice(pos, item.start) + item.token;
    pos = item.end;
    cats.add(item.category);
  }
  out += s.slice(pos);
  return { text: out, maskedCount: kept.length, maskedCategories: [...cats].sort() };
}

function shortMaskedPreview(text, start, end, token) {
  const win = 18;
  let lo = Math.max(0, start - win);
  let before = text.slice(lo, start);
  const preBreak = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n"));
  if (preBreak >= 0) {
    lo += preBreak + 1;
    before = text.slice(lo, start);
  } else if (lo > 0) {
    const sp = before.indexOf(" ");
    if (sp >= 0) { lo += sp + 1; before = text.slice(lo, start); }
  }
  let hi = Math.min(text.length, end + win);
  let after = text.slice(end, hi);
  const postBreaks = [".", "!", "?", "\n"].map((ch) => after.indexOf(ch)).filter((i) => i >= 0);
  if (postBreaks.length) {
    hi = end + Math.min(...postBreaks);
    after = text.slice(end, hi);
  } else if (hi < text.length) {
    const sp = after.lastIndexOf(" ");
    if (sp >= 0) { hi = end + sp; after = text.slice(end, hi); }
  }
  const preEllipsis = lo > 0 ? "..." : "";
  const postEllipsis = hi < text.length ? "..." : "";
  return (preEllipsis + before + token + after + postEllipsis).replace(/\s+/g, " ").trim();
}

function scanSoftHits(maskedText, pageNum) {
  const s = String(maskedText || "");
  const hits = [];
  for (const [category, token, rule, pattern, validator] of THESIS_SOFT_RULES) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(s)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex++; continue; }
      if (validator && !validator(m, s)) continue;
      hits.push({
        page: pageNum,
        category,
        rule,
        preview: shortMaskedPreview(s, m.index, m.index + m[0].length, token),
      });
    }
  }
  return hits;
}

export function scanAndMaskThesis(input) {
  const hasPages = input && typeof input === "object" && Array.isArray(input.pages) && input.pages.length > 0;
  let maskedCount = 0;
  const maskedCats = new Set();
  const softHits = [];
  const softPages = new Set();
  const softCats = new Set();

  if (hasPages) {
    const maskedPages = [];
    for (const p of input.pages) {
      const pageNum = p && p.n != null ? p.n : null;
      const m = maskThesisText(p && p.text || "");
      maskedCount += m.maskedCount;
      for (const c of m.maskedCategories) maskedCats.add(c);
      maskedPages.push({ n: pageNum, text: m.text });
      const hits = scanSoftHits(m.text, pageNum);
      for (const h of hits) {
        softHits.push(h);
        if (pageNum != null) softPages.add(pageNum);
        softCats.add(h.category);
      }
    }
    return {
      maskedText: maskedPages.map((p) => p.text).join("\n\n"),
      maskedPages,
      maskedCount,
      maskedCategories: [...maskedCats].sort(),
      softHits,
      softPages: [...softPages].sort((a, b) => Number(a) - Number(b)),
      softCategories: [...softCats].sort(),
    };
  }

  const raw = typeof input === "string" ? input : (input && typeof input.text === "string" ? input.text : "");
  const m = maskThesisText(raw);
  const hits = scanSoftHits(m.text, null);
  for (const h of hits) {
    softHits.push(h);
    softCats.add(h.category);
  }
  return {
    maskedText: m.text,
    maskedPages: [],
    maskedCount: m.maskedCount,
    maskedCategories: m.maskedCategories,
    softHits,
    softPages: [],
    softCategories: [...softCats].sort(),
  };
}
