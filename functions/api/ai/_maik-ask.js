/* functions/api/ai/_maik-ask.js — MaiK Ask reasoning prompts + sanitizers (server side).
 * ===========================================================================
 * Two kinds, mirroring _opd-scribe.js:
 *   maik-ask-next    : ctx {complaint,pathwayLabel,targetField,targetHint,known,allowedFields,language}
 *                      -> ONE natural history question in the patient's language.
 *   maik-ask-extract : ctx + patient answer transcript -> explicitly-stated findings only.
 *
 * SAFETY: MaiK is a history-taking aid, NOT a doctor. The prompts forbid diagnosis / advice /
 * reassurance / treatment, and the sanitizers whitelist the shape + allowed fields (defense in depth,
 * matching the client validators in maik-reasoning.js) so no invented action or finding can reach the app.
 * ======================================================================== */

export function maikNextPrompt(ctx) {
  ctx = ctx || {};
  const known = (ctx.known && typeof ctx.known === "object") ? ctx.known : {};
  const lang = ctx.language ? String(ctx.language) : "the patient's own language";
  return "You are MaiK, helping a doctor take a patient's history. You are NOT a doctor: you do NOT " +
    "diagnose, prescribe, advise, reassure, order tests, or tell the patient anything about their condition. " +
    "You ONLY ask ONE short, natural history question and nothing else.\n" +
    "Return ONLY JSON: {\"action\":\"ask\",\"question\":\"\",\"language\":\"\",\"targetField\":\"\",\"priority\":\"\",\"reason\":\"\"}.\n" +
    "action MUST be exactly one of: ask | clarify | finish | alert_doctor. No other value is allowed.\n" +
    "Ask about EXACTLY this one missing piece of history: \"" + String(ctx.targetHint || ctx.targetField || "") + "\" " +
    "(targetField=\"" + String(ctx.targetField || "") + "\"). Ask ONE question only — never bundle several.\n" +
    "Complaint: " + String(ctx.complaint || ctx.pathwayLabel || "") + ".\n" +
    "Already known — do NOT ask these again: " + JSON.stringify(known).slice(0, 600) + ".\n" +
    "LANGUAGE: phrase the question NATURALLY in the patient's language/style (" + lang + "), the way a real " +
    "Indian clinician actually speaks to a patient. Support natural Telugu/Hindi/English code-switching. Do NOT " +
    "translate word-for-word; use commonly understood everyday phrasing, not textbook language or jargon.\n" +
    "Keep targetField = \"" + String(ctx.targetField || "") + "\". Set language to the code you used (e.g. te-en, hi-en, en). " +
    "priority = high | normal | low. reason = one short phrase. No prose outside the JSON.";
}

export function maikExtractPrompt(ctx, transcript) {
  ctx = ctx || {};
  const allowed = Array.isArray(ctx.allowedFields) ? ctx.allowedFields : [];
  return "You are MaiK, extracting ONLY explicitly-stated history from a patient's spoken answer. You do NOT " +
    "infer, diagnose, or add anything the patient did not clearly say.\n" +
    "The patient was just asked about: \"" + String(ctx.targetHint || ctx.targetField || "") + "\".\n" +
    "Return ONLY JSON: {\"findings\":[{\"field\":\"\",\"value\":\"\",\"confidence\":0.0}]}.\n" +
    "field MUST be one of these allowed field names (name only, no prefix): " + JSON.stringify(allowed).slice(0, 500) + ".\n" +
    ((ctx.targetKind === "redflag" || ctx.targetKind === "associated")
      ? "This was a yes/no screening question: the value for \"" + String(ctx.targetField || "") + "\" MUST be exactly \"present\" or \"absent\" (present if the patient affirms or DESCRIBES the symptom, absent only if they clearly deny it). "
      : "") +
    "value = a SHORT clinical value in ENGLISH (e.g. 'right-sided', 'present', 'absent', '3 days', 'pulsatile', 'high grade'). " +
    "confidence = 0..1. Include a finding ONLY if the patient explicitly stated it. If nothing was clearly stated, return " +
    "{\"findings\":[]}. The answer may be Telugu, Hindi, English, or code-switched — understand it and output English values. " +
    "No prose outside the JSON.\n\n" +
    "=== QUESTION ASKED ===\n" + String(ctx.question || "") + "\n=== PATIENT ANSWER ===\n" + String(transcript || "");
}

const ALLOWED_ACTIONS = { ask: 1, clarify: 1, finish: 1, alert_doctor: 1 };
const ALLOWED_PRIORITY = { high: 1, normal: 1, low: 1 };

export function sanitizeMaikNext(parsed) {
  const out = { action: "finish", question: "", language: "", targetField: "", priority: "normal", reason: "" };
  if (!parsed || typeof parsed !== "object") return out;
  if (!ALLOWED_ACTIONS[parsed.action]) return out;                 // unknown action -> safe finish; client falls back to template
  out.action = parsed.action;
  if (typeof parsed.question === "string") out.question = parsed.question.replace(/\s+/g, " ").trim().slice(0, 400);
  if (typeof parsed.language === "string") out.language = parsed.language.replace(/[^a-z-]/gi, "").slice(0, 10);
  if (typeof parsed.targetField === "string") out.targetField = parsed.targetField.slice(0, 60);
  if (ALLOWED_PRIORITY[parsed.priority]) out.priority = parsed.priority;
  if (typeof parsed.reason === "string") out.reason = parsed.reason.replace(/\s+/g, " ").trim().slice(0, 200);
  if ((out.action === "ask" || out.action === "clarify") && !out.question) out.action = "finish";
  return out;
}

export function sanitizeMaikExtract(parsed, allowedFields) {
  const out = { findings: [] };
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.findings)) return out;
  const allow = (Array.isArray(allowedFields) && allowedFields.length) ? new Set(allowedFields.map((f) => String(f))) : null;
  parsed.findings.forEach((f) => {
    if (!f || typeof f.field !== "string" || !f.field) return;
    const field = f.field.split(".").pop();
    if (allow && !allow.has(field)) return;                        // only pathway-allowed fields
    if (f.value == null || String(f.value).trim() === "") return;  // explicit only
    let c = Number(f.confidence); if (!(c >= 0 && c <= 1)) c = 0.5;
    out.findings.push({ field, value: String(f.value).replace(/\s+/g, " ").trim().slice(0, 200), confidence: c });
  });
  out.findings = out.findings.slice(0, 20);
  return out;
}
