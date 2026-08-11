/* StewardMD — LLM OPD-scribe extraction (pure, no CF deps; Node-testable).
 * ---------------------------------------------------------------------------
 * Extracts EMR fields + suggestion lists (diagnosis differential, investigations)
 * from a doctor-patient consultation transcript. Output is whitelisted server-side
 * to plain-text EMR fields and three suggestion arrays, so no invented diagnosis,
 * symptom, finding, dose or investigation can reach the app.
 * Imported by functions/api/ai/[[path]].js (kind:"opd-scribe").
 */

export const EMR_FIELD_KEYS = ["cc","presentHx","pastHx","comorbidsNote","Temp","dm","htn","cardiac","asthma","tb","thyroid","epilepsy"];

export function scribeExtractPrompt(transcript) {
  return "You are an OPD scribe turning a doctor-patient consultation transcript into a structured note. " +
    "Return ONLY JSON: {\"emrFields\":{...}, \"suggestions\":{\"provisionalDx\":\"\",\"ddx\":[],\"investigations\":[]}}.\n" +
    "emrFields keys allowed: cc, presentHx, pastHx, comorbidsNote (+ dm/htn/cardiac/asthma/tb/thyroid/epilepsy as 'Yes'/'No' only if clearly stated).\n" +
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
  const ef = parsed.emrFields || {};
  EMR_FIELD_KEYS.forEach(k => { const v = ef[k]; if (typeof v==="string"||typeof v==="number"){ const s=String(v).replace(/\s+/g," ").trim().slice(0,2000); if(s) out.emrFields[k]=s; } });
  const sg = parsed.suggestions || {};
  if (typeof sg.provisionalDx==="string" && sg.provisionalDx.trim()) out.suggestions.provisionalDx = sg.provisionalDx.trim().slice(0,300);
  const clean = a => (Array.isArray(a)?a:[]).map(x=>String(x||"").replace(/\s+/g," ").trim()).filter(Boolean).slice(0,12);
  out.suggestions.ddx = clean(sg.ddx); out.suggestions.investigations = clean(sg.investigations);
  return out;
}
