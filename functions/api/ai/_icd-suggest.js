/* StewardMD — LLM ICD-10/ICD-11 code suggestion (Pro tier, "ocr" gate — same as opd-suggest).
 * ---------------------------------------------------------------------------
 * Takes the doctor's diagnosis/symptom text AND a candidate list of REAL codes already
 * retrieved from the icd_codes D1 table (functions/_icd_repo.js searchCodes()) and asks the
 * model to pick/rank ONLY from that list — it never sees a blank page and can never invent a
 * code. sanitizeIcdSuggest() then re-validates every returned id against the candidate list
 * server-side before it reaches the client: an id the model didn't copy exactly is dropped, not
 * "corrected" or guessed. Advisory only — nothing is written to any chart/EMR field without an
 * explicit clinician Accept tap, same convention as every other /extract kind here.
 * Imported by functions/api/ai/[[path]].js (kind:"icd-suggest").
 */

export function icdSuggestPrompt(text, candidates) {
  const rows = (candidates || []).map((c) => c.id + " | " + c.system + " | " + c.code + " | " + c.title).join("\n");
  return "You are a clinical coder helping a doctor attach ICD-10/ICD-11 codes to a diagnosis. Below is the " +
    "doctor's diagnosis/symptom text, and a candidate list of REAL codes already retrieved from the ICD " +
    "database. Select ONLY from the candidate list - never invent, alter or guess a code or id.\n" +
    "Return ONLY JSON: {\"suggestions\":[{\"id\":\"\",\"confidence\":\"high|medium|low\",\"why\":\"\"}]}.\n" +
    "RULES:\n" +
    "- id MUST be copied EXACTLY, character for character, from a candidate's \"id\" field above.\n" +
    "- Prefer including one good ICD-10 match AND one good ICD-11 match when both fit reasonably well.\n" +
    "- Order by relevance, most likely first. Max 6 suggestions.\n" +
    "- why = one short clinical justification (max ~20 words) tied to the doctor's text.\n" +
    "- If nothing in the candidate list is a reasonable fit, return {\"suggestions\":[]} - do not force a match.\n" +
    "- Output ONLY the JSON. No prose, no markdown, no code fences.\n\n" +
    "=== DOCTOR'S TEXT ===\n" + text + "\n\n" +
    "=== CANDIDATE CODES (id | system | code | title) ===\n" + (rows || "(none found)");
}

// Whitelist: every surviving suggestion's id must exactly match a candidate the caller actually
// retrieved from the D1 table. The model's own code/system/title strings are DISCARDED and
// replaced with the candidate's own verified fields - never trust the model's transcription of
// a code it was merely shown.
export function sanitizeIcdSuggest(parsed, candidates) {
  const byId = {};
  (candidates || []).forEach((c) => { if (c && c.id) byId[c.id] = c; });
  const out = [];
  const list = (parsed && Array.isArray(parsed.suggestions)) ? parsed.suggestions : [];
  const seen = {};
  for (const s of list) {
    if (!s || typeof s !== "object") continue;
    const id = String(s.id || "");
    const cand = byId[id];
    if (!cand || seen[id]) continue;
    seen[id] = 1;
    const conf = ["high", "medium", "low"].indexOf(String(s.confidence || "").toLowerCase()) >= 0 ? String(s.confidence).toLowerCase() : "medium";
    const why = String(s.why == null ? "" : s.why).replace(/\s+/g, " ").trim().slice(0, 200);
    out.push({ id: cand.id, system: cand.system, code: cand.code, title: cand.title, confidence: conf, why });
    if (out.length >= 6) break;
  }
  return { suggestions: out };
}
