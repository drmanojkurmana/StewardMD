/* StewardMD — LLM OPD suggestion (Pro tier). Pure, no CF deps; Node-testable.
 * ---------------------------------------------------------------------------
 * Takes the doctor's TYPED assessment (already entered: complaints, history, exam,
 * comorbids, provisional dx) and returns a decision-support differential:
 *   { provisionalDx, ddx:[{dx,why}], investigations:[], treatment:[], redFlags:[] }
 * Output is whitelisted server-side to plain-text strings with hard caps, so the LLM
 * can never inject anything structured or unbounded into the app. Advisory only —
 * the app renders these review-first; nothing is written to the EMR without an
 * explicit doctor Accept + Save. EMR corrections stay on-device (deterministic), not
 * from the LLM. Imported by functions/api/ai/[[path]].js (kind:"opd-suggest").
 */

export function opdSuggestPrompt(assessment) {
  return "You are a senior physician giving OPD decision support. From the clinical assessment below " +
    "(what the doctor has already entered), produce a focused, safe differential.\n" +
    "Return ONLY JSON: {\"provisionalDx\":\"\",\"ddx\":[{\"dx\":\"\",\"why\":\"\"}],\"investigations\":[\"\"],\"treatment\":[\"\"],\"redFlags\":[\"\"]}.\n" +
    "RULES:\n" +
    "- Base EVERYTHING only on the findings stated; NEVER invent a symptom, finding, or history.\n" +
    "- provisionalDx = the single most likely working diagnosis for this picture.\n" +
    "- ddx = the differential, MOST LIKELY FIRST (max 6), each with a one-line 'why' tied to the findings. " +
    "Include must-not-miss diagnoses even if less likely.\n" +
    "- investigations = the workup you would order for this picture (max 10).\n" +
    "- treatment = first-line management, with drug/dose/route/frequency where standard (max 10). This is a " +
    "SUGGESTION for the doctor to verify, never an order; note where dosing depends on weight/renal function.\n" +
    "- redFlags = must-not-miss features to watch for (max 6).\n" +
    "- Write everything in clear clinical ENGLISH. Keep drug names, doses, units and standard abbreviations exact.\n" +
    "- Output ONLY the JSON. No prose, no markdown, no code fences.\n\n" +
    "=== ASSESSMENT ===\n" + assessment;
}

// Whitelist the model output to bounded plain-text. No structured field the app trusts blindly.
export function sanitizeOpdSuggest(parsed) {
  const out = { provisionalDx: "", ddx: [], investigations: [], treatment: [], redFlags: [] };
  if (!parsed || typeof parsed !== "object") return out;
  const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n || 200);
  const list = (a, n, map) => (Array.isArray(a) ? a : []).map(map).filter(Boolean).slice(0, n);
  if (typeof parsed.provisionalDx === "string") out.provisionalDx = str(parsed.provisionalDx, 300);
  out.ddx = list(parsed.ddx, 6, (x) => {
    if (!x) return null;
    if (typeof x === "string") { const d = str(x, 160); return d ? { dx: d, why: "" } : null; }
    const d = str(x.dx || x.name, 160); return d ? { dx: d, why: str(x.why || x.reason, 300) } : null;
  });
  out.investigations = list(parsed.investigations, 10, (x) => str(x, 160));
  out.treatment = list(parsed.treatment, 10, (x) => str(x, 240));
  out.redFlags = list(parsed.redFlags, 6, (x) => str(x, 220));
  return out;
}
