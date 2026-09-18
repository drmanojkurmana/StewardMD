/* StewardMD — LLM OPD-scribe extraction (pure, no CF deps; Node-testable).
 * ---------------------------------------------------------------------------
 * Extracts EMR fields + suggestion lists (diagnosis differential, investigations)
 * from a doctor-patient consultation transcript. Output is whitelisted server-side
 * to plain-text EMR fields and three suggestion arrays, so no invented diagnosis,
 * symptom, finding, dose or investigation can reach the app.
 * Imported by functions/api/ai/[[path]].js (kind:"opd-scribe").
 */

export const EMR_FIELD_KEYS = [
  "cc", "presentHx", "pastHx", "surgicalHistory", "homeMeds", "treatmentReceived", "comorbidsNote",
  "dm", "dmDetails", "htn", "htnDetails", "cardiac", "cardiacDetails",
  "asthma", "asthmaDetails", "tb", "tbDetails", "thyroid", "thyroidDetails",
  "epilepsy", "epilepsyDetails",
  "ckd", "ckdDetails", "cld", "cldDetails", "cancer", "cancerDetails", "cva", "cvaDetails",
  "dyslipidemia", "dyslipidemiaDetails",
  "habits", "alcohol", "smoking", "recDrug", "tobacco", "habitsDetails",
  "familyHistory", "familyDiabetes", "familyHtn", "familyHeart",
  "familyCancer", "familyTb", "familyAsthma", "familyDetails",
  "allergies", "diet", "sleep", "lmp", "immunization", "nutrition", "hydration",
  "systemicExam", "respiratoryExam", "cvsExam", "abdoExam", "localExam",
  "tenderness", "tendernessDetails", "abdoMass", "abdoMassDetails",
  "provisionalDx", "managementPlan", "advice"
];

const YES_NO_KEYS = new Set([
  "dm", "htn", "cardiac", "asthma", "tb", "thyroid", "epilepsy",
  "ckd", "cld", "cancer", "cva", "dyslipidemia",
  "habits", "alcohol", "smoking", "recDrug", "tobacco",
  "familyHistory", "familyDiabetes", "familyHtn", "familyHeart",
  "familyCancer", "familyTb", "familyAsthma",
  "tenderness", "abdoMass"
]);

export function scribeExtractPrompt(transcript, opts) {
  const specialtyPrompt = opts && typeof opts.specialtyPrompt === "string" ? opts.specialtyPrompt.trim() : "";
  return "You are an expert OPD scribe turning a doctor-patient consultation transcript into a structured clinical note.\n" +
    "Return ONLY JSON: {\"en\":\"\", \"emrFields\":{...}, \"sources\":{\"<emrFieldKey>\":\"<verbatim transcript sentence>\"}, " +
    "\"suggestions\":{\"provisionalDx\":\"\",\"ddx\":[],\"investigations\":[]}}.\n" +
    "\"en\" = a FAITHFUL English translation of the ENTIRE transcript, verbatim meaning, keeping ALL " +
    "spoken vitals/numbers/units exactly (e.g. 'BP 120/80, pulse 88, temp 101, SpO2 96') — this is used " +
    "for on-device structured extraction, so preserve numbers and clinical terms; do not summarise it.\n" +
    "OUTPUT LANGUAGE — CRITICAL: write EVERY emrFields value and EVERY suggestion in clear clinical ENGLISH. " +
    "The transcript may be Telugu, Hindi, or code-switched Indian English; TRANSLATE the clinical meaning to English. " +
    "Never output Telugu or Devanagari script in any field. Keep drug names, doses, units, numbers and standard " +
    "abbreviations (BP, IV, BD, OD) exactly as stated. Translate faithfully — do not add or drop clinical content.\n" +
    "ASR NOISE — IMPORTANT: this transcript is on-device speech recognition of possibly code-switched " +
    "Telugu/Hindi/English speech, so it may contain mis-hearings, transliteration, repeated or garbled words. " +
    "Reconstruct the intended CLINICAL meaning: de-duplicate repeats, drop filler/noise, and normalize ONLY " +
    "UNAMBIGUOUS mis-recognitions (a clear phonetic match to exactly one common clinical term). If a garbled " +
    "word could plausibly be more than one drug/finding, keep it verbatim or omit it — NEVER substitute a " +
    "different clinical entity and NEVER guess a dose. This is interpreting what was said, not inventing.\n" +
    "STRUCTURED EMR FIELDS (populate each from what was stated):\n" +
    "- cc: Chief complaints with duration (e.g. 'Fever x 3 days, cough x 2 days')\n" +
    "- presentHx: Detailed Chronological History of Present Illness (symptoms, onset, progression, pertinent positives and negatives)\n" +
    "- pastHx: Past illnesses, prior surgeries, hospital admissions\n" +
    "- treatmentReceived: Ongoing home medications or prior treatment (e.g. 'Metformin 500mg BD, Telma 40mg OD')\n" +
    "- dm / dmDetails: dm is 'Yes'/'No' if stated. dmDetails has duration/treatment (e.g. 'Type 2 DM x 5 years on Metformin 500mg BD')\n" +
    "- htn / htnDetails: htn is 'Yes'/'No' if stated. htnDetails has duration/treatment (e.g. 'HTN x 3 years on Telma 40')\n" +
    "- cardiac, asthma, tb, thyroid, epilepsy: 'Yes'/'No' if stated, with cardiacDetails, asthmaDetails, tbDetails, thyroidDetails, epilepsyDetails if described\n" +
    "- comorbidsNote: other chronic conditions or general comorbidity note\n" +
    "- familyHistory: 'Yes'/'No' if family history discussed; familyDiabetes, familyHtn, familyHeart, familyCancer, familyTb, familyAsthma as 'Yes'/'No'; familyDetails for specific relatives and conditions\n" +
    "- allergies: any stated drug, food, or environmental allergies (e.g. 'Penicillin allergy', 'Sulfa allergy')\n" +
    "- lmp: Last Menstrual Period date/status for female patients if stated\n" +
    "- immunization: Immunisation status for pediatric or adult visits (e.g. 'Up to date as per IAP guidelines')\n" +
    "- nutrition / hydration: Nutritional status ('moderately nourished') and hydration state ('well hydrated', 'dehydrated')\n" +
    "- systemicExam: general and systemic physical examination findings stated by the doctor (e.g. 'Chest clear BAE equal, S1 S2 normal, P/A soft non-tender')\n" +
    "- tenderness: 'Yes'/'No' for abdominal tenderness; tendernessDetails if location stated\n" +
    "- abdoMass: 'Yes'/'No' for abdominal mass; abdoMassDetails if described\n" +
    "- habits: alcohol, smoking, recDrug, tobacco as 'Yes'/'No' (only when explicitly stated). Set habits='Yes' if any affirmed; habitsDetails for other habits.\n" +
    "  Add top-level \"alcoholDetail\" with exact amount + type stated (e.g. '60 ml whisky daily').\n" +
    "- provisionalDx: ONLY if the clinician explicitly stated their own diagnosis assessment.\n" +
    "- managementPlan: doctor's stated treatment advice or prescription plan.\n" +
    (specialtyPrompt ? specialtyPrompt + "\n" : "") +
    "NEGATION AND TIME — CRITICAL: a symptom or condition the patient or doctor explicitly DENIES (e.g. 'no fever', " +
    "'denies vomiting', 'not diabetic') must NEVER be written as present anywhere in emrFields; record it as a pertinent " +
    "negative in presentHx/pastHx instead (e.g. 'denies fever'). Preserve every stated duration and onset (e.g. " +
    "'fever for 3 days', 'since Monday', 'stopped metformin last month') in the field text — never drop it. A medicine " +
    "the patient has STOPPED is NOT a current medicine — record it as discontinued (e.g. in pastHx/treatmentReceived), " +
    "never as an ongoing home medication.\n" +
    "SOURCES — CRITICAL: for every emrFields key you populate, add the SAME key to \"sources\" with one sentence copied " +
    "VERBATIM from the transcript that supports that field's content. Never paraphrase, translate or invent a source " +
    "sentence; if you cannot point to a supporting sentence, do not populate the field.\n" +
    "RULES: use ONLY what is explicitly said; NEVER invent a diagnosis, symptom, finding, drug, dose or investigation. " +
    "PATIENT-REPORTED complaints/history go to presentHx/pastHx (never to vitals/exam or as confirmed findings). " +
    "ddx = a short reasonable differential FOR THE DOCTOR TO CONSIDER (label as consideration, not fact). " +
    "investigations = tests a clinician would reasonably consider for the stated picture. No prose outside JSON.\n\n" +
    "=== TRANSCRIPT ===\n" + transcript;
}

export function sanitizeScribeOutput(parsed) {
  const out = { emrFields:{}, suggestions:{ ddx:[], investigations:[] } };
  if (!parsed || typeof parsed !== "object") return out;
  if (typeof parsed.en === "string" && parsed.en.trim()) out.en = parsed.en.replace(/\s+/g, " ").trim().slice(0, 6000);
  if (typeof parsed.alcoholDetail === "string" && parsed.alcoholDetail.trim()) out.alcoholDetail = parsed.alcoholDetail.replace(/\s+/g, " ").trim().slice(0, 200);
  // Language guard: an EMR field / suggestion must be clinical ENGLISH — never native script in the
  // chart. If the model slips and returns Indic script (Devanagari/Telugu/Bengali/Gurmukhi/Gujarati/
  // Odia/Tamil/Kannada/Malayalam), STRIP the native-script glyphs (keeping any English), tidy leftover
  // empty parens/punctuation, and drop the field only if nothing English remains.
  const stripIndic = (s) => String(s || "")
    .replace(/[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/g, "")
    .replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s{2,}/g, " ").replace(/\s+([.,;:)\]])/g, "$1")
    .replace(/[\s,;:•–—-]+$/,"").replace(/^[\s,;:•–—-]+/,"").trim();
  const ef = parsed.emrFields || {};
  EMR_FIELD_KEYS.forEach(k => {
    const v = ef[k];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      let s = stripIndic(String(v).replace(/\s+/g, " ").trim()).slice(0, 2000);
      if (!s) return;
      if (YES_NO_KEYS.has(k)) {
        if (/^(?:yes|y|true)$/i.test(s)) s = "Yes";
        else if (/^(?:no|n|false)$/i.test(s)) s = "No";
      }
      out.emrFields[k] = s;
    }
  });
  // sources: same whitelist, same string cleaning + length cap as emrFields. Additive/optional --
  // only present when the model actually supplied at least one verbatim supporting sentence.
  const src = parsed.sources || {};
  const sources = {};
  EMR_FIELD_KEYS.forEach(k => {
    const v = src[k];
    if (typeof v === "string" || typeof v === "number") {
      const s = stripIndic(String(v).replace(/\s+/g, " ").trim()).slice(0, 2000);
      if (s) sources[k] = s;
    }
  });
  if (Object.keys(sources).length) out.sources = sources;
  const sg = parsed.suggestions || {};
  if (typeof sg.provisionalDx === "string" && stripIndic(sg.provisionalDx)) out.suggestions.provisionalDx = stripIndic(sg.provisionalDx).slice(0, 300);
  const clean = a => (Array.isArray(a) ? a : []).map(x => stripIndic(String(x || "").replace(/\s+/g, " ").trim())).filter(Boolean).slice(0, 12);
  out.suggestions.ddx = clean(sg.ddx); out.suggestions.investigations = clean(sg.investigations);
  return out;
}

/* ── Task 6: source grounding ──────────────────────────────────────────────
 * A populated emrFields key is only trustworthy if the "sources" sentence claimed for it really
 * appears in the transcript. This never DROPS an ungrounded field (a hallucinated citation is not
 * proof the fact itself is wrong, and the doctor is the one reading the transcript) -- it only
 * reports which fields the app should badge as unverified. */
function normalizeForMatch(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function fuzzySentenceMatch(transcript, sourceSentence) {
  const hay = normalizeForMatch(transcript);
  const needle = normalizeForMatch(sourceSentence);
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  // fuzzy: a translated/lightly-cleaned quote may reorder or drop small words -- accept a
  // high-overlap match on the meaningful (3+ char) words instead of an exact substring.
  const words = needle.split(" ").filter(w => w.length > 2);
  if (!words.length) return false;
  const hayWords = new Set(hay.split(" "));
  const hits = words.filter(w => hayWords.has(w)).length;
  return (hits / words.length) >= 0.7;
}
export function verifySources(transcript, sanitized) {
  const grounded = [], ungrounded = [];
  const ef = (sanitized && sanitized.emrFields) || {};
  const sources = (sanitized && sanitized.sources) || {};
  EMR_FIELD_KEYS.forEach(k => {
    const v = ef[k];
    if (typeof v !== "string" || !v) return;   // only populated fields need a citation
    const s = sources[k];
    if (typeof s === "string" && s && fuzzySentenceMatch(transcript, s)) grounded.push(k);
    else ungrounded.push(k);
  });
  return { grounded, ungrounded };
}

/* ── Task 10: negation / stopped-medicine contradiction check ────────────────────────────────
 * Conservative by design: only flags a field that asserts a term the transcript explicitly negates
 * (or says was stopped) in the SAME clause the field itself does not also negate. Misses are fine
 * (fewer negation phrasings caught); false alarms are not -- so a short, generic word list is
 * excluded from ever being treated as "the term". */
const CONTRADICTION_STOPWORDS = new Set([
  "history", "issue", "issues", "problem", "problems", "complaint", "complaints", "mention",
  "mentioned", "reports", "reported", "stated", "said", "information", "details", "detail",
  "note", "notes", "comment", "comments", "thing", "things", "other", "others", "idea", "reason", "reasons"
]);
function lastWord(phrase) {
  const parts = String(phrase || "").trim().split(/\s+/);
  return (parts[parts.length - 1] || "").toLowerCase();
}
function assertsPositive(fieldText, term) {
  const lower = String(fieldText || "").toLowerCase();
  const idx = lower.indexOf(term);
  if (idx === -1) return false;
  // if the field's OWN text negates/stops the term in the same clause, it's a correctly recorded
  // pertinent negative / discontinued medicine, not a contradiction.
  const before = lower.slice(Math.max(0, idx - 30), idx);
  if (/\b(?:no|denies|denied|without|stopped|discontinued|off|negative for|absence of)\b[^.;]*$/.test(before)) return false;
  return true;
}
export function flagContradictions(transcript, sanitized) {
  const out = [];
  const t = String(transcript || "");
  const ef = (sanitized && sanitized.emrFields) || {};
  const cues = [];
  const NEG_RE = /\b(?:no|denies|denied|without|negative for|absence of)\s+([a-z]{3,})/gi;
  const STOP_RE = /\b(?:stopped|discontinued)\s+([a-z]{3,})/gi;
  let m;
  while ((m = NEG_RE.exec(t))) cues.push({ term: lastWord(m[1]), reason: "the transcript explicitly denies this" });
  while ((m = STOP_RE.exec(t))) cues.push({ term: lastWord(m[1]), reason: "the transcript says this was stopped/discontinued" });
  const seen = new Set();
  EMR_FIELD_KEYS.forEach(key => {
    const val = ef[key];
    if (typeof val !== "string" || !val) return;
    cues.forEach(({ term, reason }) => {
      if (!term || term.length < 3 || CONTRADICTION_STOPWORDS.has(term)) return;
      if (!assertsPositive(val, term)) return;
      const dedupe = key + "|" + term;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      out.push({ field: key, term, reason });
    });
  });
  return out;
}
