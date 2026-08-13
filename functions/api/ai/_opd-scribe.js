/* StewardMD — LLM OPD-scribe extraction (pure, no CF deps; Node-testable).
 * ---------------------------------------------------------------------------
 * Extracts EMR fields + suggestion lists (diagnosis differential, investigations)
 * from a doctor-patient consultation transcript. Output is whitelisted server-side
 * to plain-text EMR fields and three suggestion arrays, so no invented diagnosis,
 * symptom, finding, dose or investigation can reach the app.
 * Imported by functions/api/ai/[[path]].js (kind:"opd-scribe").
 */

export const EMR_FIELD_KEYS = ["cc","presentHx","pastHx","comorbidsNote","dm","htn","cardiac","asthma","tb","thyroid","epilepsy",
  "habits","alcohol","smoking","drug","tobacco"];

export function scribeExtractPrompt(transcript) {
  return "You are an OPD scribe turning a doctor-patient consultation transcript into a structured note. " +
    "Return ONLY JSON: {\"en\":\"\", \"emrFields\":{...}, \"suggestions\":{\"provisionalDx\":\"\",\"ddx\":[],\"investigations\":[]}}.\n" +
    "\"en\" = a FAITHFUL English translation of the ENTIRE transcript, verbatim meaning, keeping ALL " +
    "spoken vitals/numbers/units exactly (e.g. 'BP 120/80, pulse 88, temp 101, SpO2 96') — this is used " +
    "for on-device structured extraction, so preserve numbers and clinical terms; do not summarise it.\n" +
    "OUTPUT LANGUAGE — CRITICAL: write EVERY emrFields value and EVERY suggestion in clear clinical ENGLISH. " +
    "The transcript may be Telugu, Hindi, or code-switched Indian English; TRANSLATE the clinical meaning to English. " +
    "Never output Telugu or Devanagari script in any field. Keep drug names, doses, units, numbers and standard " +
    "abbreviations (BP, IV, BD, OD) exactly as stated. Translate faithfully — do not add or drop clinical content.\n" +
    "emrFields keys allowed: cc, presentHx, pastHx, comorbidsNote (+ dm/htn/cardiac/asthma/tb/thyroid/epilepsy as 'Yes'/'No' only if clearly stated).\n" +
    "PERSONAL HISTORY / HABITS: if the patient states a habit, set the matching emrFields key to 'Yes' " +
    "(only when explicitly affirmed): alcohol, smoking, drug (recreational drug use), tobacco (chewing " +
    "tobacco). Set habits='Yes' if ANY of these is present. Also add a top-level \"alcoholDetail\" string " +
    "with the EXACT amount + type the patient stated (e.g. '60 ml whisky per day', '2 beers daily') when " +
    "given, so the app can compute grams of alcohol + standard drinks. Only from what was explicitly said.\n" +
    "RULES: use ONLY what is explicitly said; NEVER invent a diagnosis, symptom, finding, drug, dose or investigation. " +
    "provisionalDx ONLY if the clinician explicitly stated their own assessment. " +
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
  const ef = parsed.emrFields || {};
  EMR_FIELD_KEYS.forEach(k => { const v = ef[k]; if (typeof v==="string"||typeof v==="number"){ const s=String(v).replace(/\s+/g," ").trim().slice(0,2000); if(s) out.emrFields[k]=s; } });
  const sg = parsed.suggestions || {};
  if (typeof sg.provisionalDx==="string" && sg.provisionalDx.trim()) out.suggestions.provisionalDx = sg.provisionalDx.trim().slice(0,300);
  const clean = a => (Array.isArray(a)?a:[]).map(x=>String(x||"").replace(/\s+/g," ").trim()).filter(Boolean).slice(0,12);
  out.suggestions.ddx = clean(sg.ddx); out.suggestions.investigations = clean(sg.investigations);
  return out;
}
