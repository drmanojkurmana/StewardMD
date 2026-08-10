/* StewardMD — LLM assessment-narrative extraction (pure, no CF deps; Node-testable).
 * ---------------------------------------------------------------------------
 * The ambient voice pipeline handles vitals + exam DETERMINISTICALLY (voice-vitals.js, no LLM).
 * This covers ONLY the free narrative the regex layer can't: the clinician's spoken chief
 * complaint / history / (explicitly-stated) assessment & plan. It NEVER produces vitals,
 * examination findings, drugs, doses or investigations, and NEVER invents a diagnosis — the
 * output is whitelisted server-side to five plain-text fields, so nothing else can reach the app.
 * Imported by functions/api/ai/[[path]].js (kind:"assessment").
 */

// The only fields this path may emit — engine field ids (voice-emr-map maps them to the form).
export const ASSESSMENT_FIELDS = ["cc", "presentHx", "pastHx", "provisionalDx", "managementPlan"];

export function assessmentExtractPrompt(transcript) {
  return "You are transcribing a clinician's spoken consultation into an initial-assessment note. " +
    "Return ONLY JSON containing any of these keys, each a short plain-text string in the clinician's own words:\n" +
    '{"cc": chief complaints and their duration, ' +
    '"presentHx": history of present illness, ' +
    '"pastHx": past medical / surgical history, ' +
    '"provisionalDx": the clinician\'s explicitly stated provisional/working diagnosis, ' +
    '"managementPlan": the clinician\'s explicitly stated plan / orders}\n' +
    "STRICT RULES:\n" +
    "- Use ONLY what is EXPLICITLY stated in the transcript. Never infer, complete, summarise beyond what was said, or invent.\n" +
    "- NEVER generate a diagnosis, symptom, finding, drug, dose or investigation that was not spoken. Include `provisionalDx` and `managementPlan` ONLY if the clinician clearly stated their own assessment/plan; otherwise OMIT those keys.\n" +
    "- Do NOT put vitals or physical-examination findings here (those are captured separately) — only narrative history / assessment / plan.\n" +
    "- Omit any key not clearly stated. You may lightly tidy speech-to-text (grammar, ordering) but add NO clinical content.\n" +
    "- No prose outside the JSON.\n\n=== TRANSCRIPT ===\n" + transcript;
}

// SAFETY whitelist: keep ONLY the five known keys, as trimmed strings (reject arrays/objects/etc.),
// capped, empties dropped. Guarantees the app can never receive an injected field or non-text value.
export function sanitizeAssessmentFields(parsed) {
  var out = {};
  if (!parsed || typeof parsed !== "object") return out;
  ASSESSMENT_FIELDS.forEach(function (k) {
    var v = parsed[k];
    if (typeof v !== "string" && typeof v !== "number") return;   // drop null/array/object/boolean
    var s = String(v).replace(/\s+/g, " ").trim().slice(0, 2000);
    if (s) out[k] = s;
  });
  return out;
}
