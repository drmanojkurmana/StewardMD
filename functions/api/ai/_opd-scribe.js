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

export function scribeExtractPrompt(transcript) {
  return "You are an expert OPD scribe turning a doctor-patient consultation transcript into a structured clinical note.\n" +
    "Return ONLY JSON: {\"en\":\"\", \"emrFields\":{...}, \"suggestions\":{\"provisionalDx\":\"\",\"ddx\":[],\"investigations\":[]}}.\n" +
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
  const sg = parsed.suggestions || {};
  if (typeof sg.provisionalDx === "string" && stripIndic(sg.provisionalDx)) out.suggestions.provisionalDx = stripIndic(sg.provisionalDx).slice(0, 300);
  const clean = a => (Array.isArray(a) ? a : []).map(x => stripIndic(String(x || "").replace(/\s+/g, " ").trim())).filter(Boolean).slice(0, 12);
  out.suggestions.ddx = clean(sg.ddx); out.suggestions.investigations = clean(sg.investigations);
  return out;
}
