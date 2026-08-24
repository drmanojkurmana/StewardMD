/* functions/api/ai/_surgx-note.js — SURGX surgical-note extraction (pure, no CF deps, Node-testable).
 * ===========================================================================================
 * Turns a surgeon's dictation into STRUCTURE for an operative, pre-op, post-op, progress or
 * discharge note. It never turns it into CONTENT.
 *
 * This is the single most safety-critical file in SURGX, so the design is stated plainly:
 *
 *   An operative note is a legal medical record. A fabricated blood loss, a fabricated drain, an
 *   invented specimen or an invented swab count in a signed note is a patient-safety event and a
 *   medico-legal one. The model is therefore given the narrowest possible job - decide WHICH FIELD
 *   a sentence the surgeon actually said belongs in - and three independent mechanisms stop it
 *   doing anything else:
 *
 *   1. THE PROMPT tells it not to invent. A prompt is a request, not a mechanism, so it is only
 *      layer one.
 *   2. THIS SANITIZER drops every key that is not in the caller-supplied allow-list. The allow-list
 *      is computed from the note schema's aiFillable:true fields, so a field the schema marks as
 *      never-AI-fillable (swab/instrument/needle counts, specimen register, implant serials,
 *      consent, discharge medications, patient identifiers, the surgeon's name) is structurally
 *      unreachable no matter what the model returns.
 *   3. THE CLIENT NUMERIC GUARD (surgx-model.js numericGuard) voids any field containing a number
 *      that does not appear in the transcript, and marks it missing.
 *
 * Layers 2 and 3 are code. Only layer 1 is a prompt. That ordering is the point.
 *
 * Imported by functions/api/ai/[[path]].js (kind:"surgx-note").
 */

/* Fields the model may NEVER write, whatever the caller says. This is a belt-and-braces DENY list
 * layered under the caller's allow-list: if a future schema change accidentally marks one of these
 * aiFillable, the server still refuses. Keys match surgx-note-schema.js. */
export const NEVER_AI_FILLABLE = [
  "counts",          // swab / instrument / needle counts - a two-person physical verification
  "specimens",       // specimen register - a physical hand-off
  "implants",        // implant type, size and serial number
  "consent",         // consent is an act, not a transcription
  "meds",            // discharge medication list - this is prescribing
  "side",            // site marking is a physical check
  "cultureSent",     // whether a specimen actually left the room
  "patientRef", "age", "sex", "date", "admitDate", "dischargeDate",   // identifiers and dates
  "surgeon", "assistants", "anaesthetist", "doctor"                    // attribution
];

const MAX_FIELD_CHARS = 4000;
const MAX_KEYS = 40;

export function surgxNotePrompt(transcript, opts) {
  opts = opts || {};
  const noteType = String(opts.noteType || "operative").slice(0, 24);
  const keys = (Array.isArray(opts.allowedFields) ? opts.allowedFields : [])
    .map((f) => (f && typeof f === "object" ? f : { k: String(f), label: String(f) }))
    .slice(0, MAX_KEYS);
  const fieldList = keys.map((f) => "  - " + f.k + ": " + (f.label || f.k)).join("\n");

  return "You are structuring a surgeon's own dictation into a " + noteType + " note. " +
    "Return ONLY JSON: {\"fields\":{\"<key>\":\"<text>\"}}. No prose outside the JSON.\n\n" +
    "YOUR ONLY JOB is to decide which field each thing the surgeon SAID belongs in, and to tidy " +
    "the wording into clinical English. You are a typist with anatomy knowledge, not a clinician.\n\n" +
    "ABSOLUTE RULES - a breach of any of these is a patient-safety event:\n" +
    "1. NEVER invent, infer, estimate, complete or 'make consistent' any clinical fact. That includes " +
    "findings, blood loss, specimens, drains, implants, complications, medications, doses, " +
    "measurements, counts, times, operative details and anything about the patient.\n" +
    "2. If the surgeon did not say it, OMIT THE FIELD ENTIRELY. An absent field is correct and safe. " +
    "A plausible guess is not. Do NOT write 'nil', 'none', 'routine', 'as usual' or 'not stated' " +
    "unless the surgeon actually said so.\n" +
    "3. NEVER write a number that is not spoken in the transcript. Do not convert units, do not round, " +
    "do not total, do not infer a size from a description.\n" +
    "4. Do not add a normal finding because it is usually present. Do not add a step because it is " +
    "usually performed. Absence of mention is not evidence of occurrence.\n" +
    "5. Use only these field keys; anything else is discarded:\n" + fieldList + "\n" +
    "6. Preserve the surgeon's own clinical terms, drug names, laterality and anatomical detail exactly.\n\n" +
    "DICTATION NOISE: this is speech recognition of possibly code-switched Indian English, so it may " +
    "contain mis-hearings and repeats. De-duplicate repeats and drop filler. Normalise ONLY an " +
    "unambiguous mis-recognition - a clear phonetic match to exactly one common surgical term. If a " +
    "garbled word could plausibly be more than one structure, drug or instrument, keep it VERBATIM or " +
    "omit it. Never substitute a different clinical entity, and never guess a number.\n\n" +
    "=== TRANSCRIPT ===\n" + String(transcript || "");
}

/* Whitelist the model's output against (allowed - NEVER_AI_FILLABLE). Anything else is dropped
 * silently before it can reach the app; the caller is told what was dropped so the UI can be
 * honest about it rather than quietly showing a shorter note. */
export function sanitizeSurgxNote(parsed, allowedKeys) {
  const out = { fields: {}, dropped: [] };
  const allow = {};
  (Array.isArray(allowedKeys) ? allowedKeys : []).slice(0, MAX_KEYS).forEach((k) => {
    const key = (k && typeof k === "object") ? String(k.k || "") : String(k || "");
    if (key) allow[key] = 1;
  });
  NEVER_AI_FILLABLE.forEach((k) => { delete allow[k]; });

  if (!parsed || typeof parsed !== "object") return out;
  const src = (parsed.fields && typeof parsed.fields === "object") ? parsed.fields : parsed;

  Object.keys(src).forEach((k) => {
    if (!allow[k]) { out.dropped.push(k); return; }
    const v = src[k];
    if (typeof v !== "string" && typeof v !== "number") { out.dropped.push(k); return; }
    const s = String(v).replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_CHARS);
    if (!s) { out.dropped.push(k); return; }
    // A model that has nothing to say sometimes says so. That is not a clinical fact either.
    if (/^(n\/?a|none stated|not stated|not mentioned|unknown|unspecified|-{1,3})$/i.test(s)) { out.dropped.push(k); return; }
    out.fields[k] = s;
  });
  return out;
}
