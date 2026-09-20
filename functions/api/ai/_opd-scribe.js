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
  "provisionalDx", "managementPlan", "advice",
  // 2026-09-20 — the rest of the GHIS Initial Assessment a doctor actually dictates. Every key here
  // has a real field waiting for it in opd-emr.js VOICE_MAP; before this they had no path from speech
  // at all. Plain text / Yes-No / one-of-a-list only: nothing numeric is inferred (see the obstetric
  // counts deliberately left out, vault/modules/MaiK Scribe.md).
  "genCondition", "maritalStatus", "childrenCount", "consanguinity",
  "appetite", "bowels", "micturition", "micturitionDetails", "priorInvestigations",
  "familyPsych", "familyOther",
  "menstrualHistory", "menstrualDetails", "obstetricHistory", "pregnancyComplications",
  "contraception", "lactating", "dysmenorrhoea", "breastFeeding", "feedingDuration",
  "cranialNerves", "motorSystem", "sensorySystem", "reflexes", "plantars", "gait", "speech",
  "cerebellar", "jvp", "skin", "entExam", "musculoskeletal",
  "breastExam", "teethExam", "headNeckExam",
  "hernialOrifices", "hernialOrificesDetails",
  "genitalExam", "perinealExam", "perRectalExam",
  "differentialDx", "referral", "lifestyleAdvice"
];

const YES_NO_KEYS = new Set([
  "dm", "htn", "cardiac", "asthma", "tb", "thyroid", "epilepsy",
  "ckd", "cld", "cancer", "cva", "dyslipidemia",
  "habits", "alcohol", "smoking", "recDrug", "tobacco",
  "familyHistory", "familyDiabetes", "familyHtn", "familyHeart",
  "familyCancer", "familyTb", "familyAsthma",
  "tenderness", "abdoMass",
  "familyPsych", "familyOther", "menstrualHistory", "obstetricHistory", "hernialOrifices"
]);

export function scribeExtractPrompt(transcript, opts) {
  const specialtyPrompt = opts && typeof opts.specialtyPrompt === "string" ? opts.specialtyPrompt.trim() : "";
  // DELTA mode (opts.priorDraft): the caller has already had the earlier speech extracted and is
  // sending only what has been said since. The draft so far is bounded by the field list; the
  // transcript is not, which is the whole point -- see the delta block at the end of this file.
  const pd = opts && opts.priorDraft && typeof opts.priorDraft === "object"
    ? (opts.priorDraft.emrFields && typeof opts.priorDraft.emrFields === "object" ? opts.priorDraft.emrFields : opts.priorDraft)
    : null;
  const priorJson = pd ? JSON.stringify(pd) : "";
  const delta = !!priorJson && priorJson !== "{}";
  return "You are an expert OPD scribe turning a doctor-patient consultation transcript into a structured clinical note.\n" +
    "Return ONLY JSON: {\"en\":\"\", \"emrFields\":{...}, \"sources\":{\"<emrFieldKey>\":\"<verbatim transcript sentence>\"}, " +
    "\"suggestions\":{\"provisionalDx\":\"\",\"ddx\":[],\"investigations\":[]}}.\n" +
    (delta
      ? "\"en\" = a FAITHFUL English translation of the NEW SPEECH below ONLY (not of the already-captured note), verbatim meaning, keeping ALL "
      : "\"en\" = a FAITHFUL English translation of the ENTIRE transcript, verbatim meaning, keeping ALL ") +
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
    "- genCondition: general condition IF the doctor states it — exactly one of Good / Fair / Sick / Moribund\n" +
    "- appetite (Normal|Reduced|Increased), bowels (Regular|Constipated|Loose stools), micturition " +
    "(Normal|Dysuria|Frequency|Hesitancy) with micturitionDetails; maritalStatus (Single|Married|Widowed|Divorced), " +
    "childrenCount, consanguinity (Non-consanguineous|1st degree|2nd degree) — ONLY when stated, using those exact words\n" +
    "- priorInvestigations: investigations ALREADY DONE that were reported in the consult (outside reports, " +
    "previous scans) — never the tests being ordered today, those belong in managementPlan\n" +
    "- familyPsych / familyOther: 'Yes'/'No' for a psychiatric illness or any other condition in the family\n" +
    "- menstrualHistory: 'Yes'/'No' if menstrual history was discussed, with menstrualDetails for what was said; " +
    "obstetricHistory: 'Yes'/'No' if obstetric history was discussed, with pregnancyComplications, contraception " +
    "and lactating for what was stated, plus dysmenorrhoea, breastFeeding and feedingDuration where the " +
    "consult covers them. NEVER infer a count, an age or a date that was not spoken.\n" +
    "- Examination findings the doctor dictates, each verbatim clinical English and ONLY if examined aloud: " +
    "cranialNerves, motorSystem, sensorySystem, reflexes, plantars, gait, speech, cerebellar, jvp, skin, " +
    "entExam, musculoskeletal, breastExam, teethExam, headNeckExam, genitalExam, perinealExam, perRectalExam; " +
    "hernialOrifices is 'Yes'/'No' for hernial orifices NORMAL, with hernialOrificesDetails\n" +
    "- provisionalDx: ONLY if the clinician explicitly stated their own diagnosis assessment.\n" +
    "- differentialDx: ONLY the differential the CLINICIAN themself stated aloud (not your own suggestion — " +
    "that belongs in suggestions.ddx).\n" +
    "- managementPlan: doctor's stated treatment advice or prescription plan.\n" +
    "- referral: who the patient is being referred to and why, if stated. lifestyleAdvice: stated diet / " +
    "lifestyle advice, kept separate from advice (follow-up instructions).\n" +
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
    (delta
      ? "ALREADY CAPTURED — CRITICAL: the note below was built from the EARLIER part of THIS SAME consultation. " +
        "Output ONLY what the NEW SPEECH adds or corrects: include an emrFields key ONLY if the new speech says something " +
        "about it, and NEVER repeat captured content unchanged. An OMITTED key means 'nothing new about this' — it never " +
        "means 'clear it', so never output an empty value to erase something already captured. If the new speech CORRECTS " +
        "or contradicts the captured note ('actually no fever', 'she stopped the metformin'), DO output the corrected value " +
        "for that field.\n"
      : "") +
    "RULES: use ONLY what is explicitly said; NEVER invent a diagnosis, symptom, finding, drug, dose or investigation. " +
    "PATIENT-REPORTED complaints/history go to presentHx/pastHx (never to vitals/exam or as confirmed findings). " +
    "ddx = a short reasonable differential FOR THE DOCTOR TO CONSIDER (label as consideration, not fact). " +
    "investigations = tests a clinician would reasonably consider for the stated picture. No prose outside JSON.\n\n" +
    (delta
      ? "=== ALREADY CAPTURED (the note so far) ===\n" + priorJson + "\n\n=== NEW SPEECH ===\n" + transcript
      : "=== TRANSCRIPT ===\n" + transcript);
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

/* ── incremental (delta) refine: merging one pass into the running draft ─────────────────────────
 * The cloud refine used to re-read the WHOLE growing transcript every 45 s, so a consult's input
 * cost grew with the SQUARE of its length. A background refine now sends only the speech since the
 * last call whose result was actually applied, plus the draft so far (bounded by the field list),
 * and this merges the reply back in.
 *
 * The merge semantics are maik-local.js scribeMerge/mergeText, deliberately duplicated rather than
 * re-derived so the on-device and cloud engines agree (maik-local.js is an ES5 browser IIFE with no
 * export the Worker could import, and it is not ours to edit). Keep the two in step.
 *
 * SAFETY (a dropped clinical fact is the failure mode here):
 *   - an ABSENT or blank key in `next` means "nothing new about this" -> prev is kept, never cleared;
 *   - a narrative field ACCUMULATES (token-containment dedupe), so a delta can never shorten one;
 *   - a Yes/No field only flips Yes -> No when `opts.contradictions` (flagContradictions over the NEW
 *     speech) shows the new speech really negates it. A small model re-emitting every key as "No" is
 *     exactly how a stated history got erased in review; an explicit "actually no fever" still wins.
 *   - `sources` is NOT merged: a citation map covering only the delta would badge every earlier field
 *     as unsupported in the client's review panel, so the delta path withholds grounding entirely
 *     (attachGrounding with disabled:true) and the final full refine produces the real one. */
const SCRIBE_TEXT_CAP = 2000, SCRIBE_EN_CAP = 6000;
function draftWords(s) { return (String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []); }
function mostlyContained(a, b) {
  const wb = draftWords(b); if (!wb.length) return true;
  const have = new Set(draftWords(a));
  let hit = 0; wb.forEach(w => { if (have.has(w)) hit++; });
  return hit / wb.length >= 0.8;
}
function mergeText(a, b) {
  a = a || ""; b = b || "";
  if (!a) return b.slice(0, SCRIBE_TEXT_CAP);
  if (!b || mostlyContained(a, b)) return a;
  return (a + "; " + b).slice(0, SCRIBE_TEXT_CAP);
}
function unionList(a, b, cap) {
  const seen = new Set(), out = [];
  (a || []).concat(b || []).forEach(x => { const k = String(x).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x); } });
  return out.slice(0, cap || 12);
}
export function mergeScribeDraft(prev, next, opts) {
  prev = prev || {}; next = next || {};
  const pf = prev.emrFields || {}, nf = next.emrFields || {};
  const ps = prev.suggestions || {}, ns = next.suggestions || {};
  // flagContradictions reports the field whose TEXT asserts the negated term, which for a comorbidity
  // is the details sibling ("dmDetails: Type 2 DM on metformin" vs the bare "Yes" in dm). Map it back
  // to its Yes/No key so "she stopped the metformin" can actually overturn dm.
  const negated = new Set();
  ((opts && opts.contradictions) || []).forEach(c => {
    const f = c && c.field; if (!f) return;
    negated.add(f);
    if (/Details$/.test(f)) negated.add(f.replace(/Details$/, ""));
  });
  const out = { emrFields: {}, suggestions: { ddx: [], investigations: [] } };
  EMR_FIELD_KEYS.forEach(k => { if (typeof pf[k] === "string" && pf[k]) out.emrFields[k] = pf[k]; });
  EMR_FIELD_KEYS.forEach(k => {
    const v = nf[k];
    if (typeof v !== "string" || !v.trim()) return;          // absent/blank: nothing new, never a clear
    if (YES_NO_KEYS.has(k)) {
      // "No" may only overturn a recorded "Yes" when the new speech explicitly negates it.
      if (v === "No" && out.emrFields[k] === "Yes" && !negated.has(k)) return;
      out.emrFields[k] = v; return;
    }
    out.emrFields[k] = mergeText(out.emrFields[k], v);       // ADD/UPDATE only -- never shorter than prev
  });
  const en = mostlyContained(prev.en || "", next.en || "") ? (prev.en || "") : ((prev.en ? prev.en + " " : "") + (next.en || ""));
  if (en) out.en = en.slice(0, SCRIBE_EN_CAP);
  const alc = next.alcoholDetail || prev.alcoholDetail;
  if (alc) out.alcoholDetail = alc;
  const dx = ns.provisionalDx || ps.provisionalDx;
  if (dx) out.suggestions.provisionalDx = dx;                // a single statement: the newest wins
  out.suggestions.ddx = unionList(ps.ddx, ns.ddx);
  out.suggestions.investigations = unionList(ps.investigations, ns.investigations);
  return out;
}

/* ── truncation-tolerant parse ──────────────────────────────────────────────────────────────────
 * The handler's parseJsonLoose takes the first "{" through the LAST "}" and JSON.parse's it. A reply
 * cut off by the output cap has no matching closer, so it returned null and the doctor lost the
 * ENTIRE extraction rather than its tail -- on the FINAL refine, the authoritative one that produces
 * the EMR. Close what is still open instead, and tell the caller the reply was incomplete: grounding
 * computed from a half-written "sources" map is worse than no grounding at all.
 *
 * Returns { parsed, truncated }. `truncated` is true whenever the text had to be repaired, which is
 * a stronger signal than the provider's finishReason (that is a module-level global shared by
 * concurrent requests; this is derived from the bytes of THIS reply).
 *
 * ponytail: rewinds to the last completed key/value pair rather than reconstructing the partial one.
 * Ceiling: the field being written when the cap hit is dropped. Raise SCRIBE_MAX_OUTPUT_TOKENS if
 * that ever fires in practice -- repair is the floor, not the plan. */
function closeOpenJson(s) {
  const stack = [];
  let inStr = false, esc = false, cut = -1, closers = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") { stack.push(c === "{" ? "}" : "]"); continue; }
    if (c === "}" || c === "]") { stack.pop(); cut = i + 1; closers = stack.slice(); continue; }
    // a comma at container level means every key/value before it is complete
    if (c === ",") { cut = i; closers = stack.slice(); }
  }
  if (cut < 0 || !closers) return null;
  return s.slice(0, cut) + closers.reverse().join("");
}
export function parseScribeJson(text) {
  const s = String(text || "");
  const i = s.indexOf("{");
  if (i === -1) return { parsed: null, truncated: false };
  const body = s.slice(i);
  const last = body.lastIndexOf("}");
  if (last > -1) { try { return { parsed: JSON.parse(body.slice(0, last + 1)), truncated: false }; } catch (e) {} }
  const repaired = closeOpenJson(body);
  if (repaired) { try { return { parsed: JSON.parse(repaired), truncated: true }; } catch (e) {} }
  return { parsed: null, truncated: true };
}

/* ── the grounding signal the client actually reads ─────────────────────────────────────────────
 * opd-emr.js treats the `sources` map as authoritative: once it is present at all, a populated field
 * MISSING from it is badged "not found in the recording". So an INCOMPLETE map turns correctly
 * extracted fields into apparent fabrications -- a false safety signal pointing the wrong way, which
 * is worse than showing nothing. The rule here is therefore trustworthy-or-absent:
 *
 *   • reply repaired / truncated, or the model cited fewer than GROUND_MIN_COVERAGE of the populated
 *     fields  -> withhold BOTH `sources` and `ungroundedFields`. The client falls back to
 *                supported() === null, i.e. "unknown support", and draws no badge.
 *   • otherwise -> run verifySources (does each cited sentence really appear in the transcript?) and
 *                  flagContradictions, and return their results. These were exported and never
 *                  imported by the handler, so nothing checked the citations the model is paying
 *                  output tokens to produce.
 *
 * Never DROPS a field: a bad citation is not proof the fact is wrong, and the doctor is the one
 * reading the transcript. */
export const GROUND_MIN_COVERAGE = 0.8;
export function attachGrounding(transcript, sanitized, opts) {
  const out = sanitized || {};
  const truncated = !!(opts && opts.truncated);
  if (truncated) out.truncated = true;
  const ef = out.emrFields || {};
  const sources = out.sources || null;
  const populated = EMR_FIELD_KEYS.filter(k => typeof ef[k] === "string" && ef[k]);
  const cited = sources ? populated.filter(k => typeof sources[k] === "string" && sources[k]).length : 0;
  const trustworthy = !!sources && !truncated && !(opts && opts.disabled) &&
    populated.length > 0 && (cited / populated.length) >= GROUND_MIN_COVERAGE;
  if (!trustworthy) { delete out.sources; return out; }
  out.ungroundedFields = verifySources(transcript, out).ungrounded;
  const contradictions = flagContradictions(transcript, out);
  if (contradictions.length) out.contradictions = contradictions;
  return out;
}
