/* Measured cost of the OPD scribe's cloud refine, before and after the incremental (delta) mode.
 * Read-only: this simulates consults and builds the REAL prompts with scribeExtractPrompt.
 * Run: node test/bench/scribe-delta-bench.mjs
 *
 * Model (all of it stated, none of it hidden):
 *   - dictation produces CHARS_PER_MIN characters of transcript per minute;
 *   - a background refine every REFINE_GAP_S seconds (smd_scribe_live_mingap_ms default 45000),
 *     plus ONE final refine when the doctor taps Pause/Stop;
 *   - the final refine is IDENTICAL in both modes (whole transcript, no prior draft) -- it is the
 *     safety net, so the saving comes only from the background passes;
 *   - SMD_AI.extract (reasoning.js) slices the transcript to 8000 chars before sending, so a long
 *     consult's full refine is ALREADY capped today. Both a capped and an uncapped column are
 *     printed: the uncapped one is the like-for-like comparison with the original estimate.
 *   - the running draft grows with the consult but is bounded by the field list, not by its length.
 */
import { scribeExtractPrompt } from "../../functions/api/ai/_opd-scribe.js";

const CHARS_PER_MIN = 700;      // ~130 wpm of consultation speech
const REFINE_GAP_S = 45;        // smd_scribe_live_mingap_ms default
const CLIENT_CAP = 8000;        // reasoning.js SMD_AI.extract: String(transcript).slice(0, 8000)

// A draft that grows the way a real one does: a few narrative fields filling up, then plateauing.
// Bounded by the field list (~66 keys x 2000 chars is the hard ceiling; a real consult is far less).
function draftAt(minute) {
  const n = Math.min(1, minute / 10);
  const fill = (len) => "x".repeat(Math.round(len * n));
  return { emrFields: {
    cc: fill(60), presentHx: fill(700), pastHx: fill(220), homeMeds: fill(160),
    allergies: fill(40), systemicExam: fill(240), provisionalDx: fill(60),
    managementPlan: fill(260), advice: fill(120), dm: "Yes", htn: "No",
  } };
}

function simulate(minutes, { delta, capped }) {
  const cap = (s) => (capped ? s.slice(0, CLIENT_CAP) : s);
  const totalChars = minutes * CHARS_PER_MIN;
  const transcript = "s".repeat(totalChars);
  const marks = [];                                  // seconds at which a background refine fires
  for (let t = REFINE_GAP_S; t < minutes * 60; t += REFINE_GAP_S) marks.push(t);
  let calls = 0, payload = 0, prompt = 0, prior = 0, sentUpTo = 0;
  marks.forEach((t) => {
    const at = Math.round((t / 60) * CHARS_PER_MIN);
    const full = transcript.slice(0, at);
    let text, opts;
    if (delta && sentUpTo > 0) { text = full.slice(sentUpTo); opts = { priorDraft: draftAt(t / 60) }; prior += JSON.stringify(opts.priorDraft.emrFields).length; }
    else { text = cap(full); opts = undefined; }
    calls++; payload += text.length; prompt += scribeExtractPrompt(text, opts).length;
    sentUpTo = at;                                   // the result was applied
  });
  // the final, authoritative pass: identical in both modes
  const fin = cap(transcript);
  calls++; payload += fin.length; prompt += scribeExtractPrompt(fin).length;
  return { calls, payload, prompt, prior };
}

const fmt = (n) => n.toLocaleString("en-US");
const pct = (a, b) => (100 * (1 - b / a)).toFixed(1) + "%";
const rows = [];
[5, 10, 20].forEach((m) => {
  [["capped (what ships today)", true], ["uncapped (like-for-like)", false]].forEach(([label, capped]) => {
    const before = simulate(m, { delta: false, capped });
    const after = simulate(m, { delta: true, capped });
    rows.push({ m, label, before, after });
  });
});

console.log("MaiK Scribe cloud refine — input characters per consult\n");
console.log("  " + CHARS_PER_MIN + " transcript chars/min, a background refine every " + REFINE_GAP_S + "s, one final refine.\n");
for (const r of rows) {
  console.log(r.m + " min consult — " + r.label + "  (" + r.before.calls + " calls: " + (r.before.calls - 1) + " background + 1 final)");
  console.log("   transcript chars sent   before " + fmt(r.before.payload).padStart(9) + "   after " + fmt(r.after.payload).padStart(9) + "   saved " + pct(r.before.payload, r.after.payload));
  console.log("   whole prompt chars sent before " + fmt(r.before.prompt).padStart(9) + "   after " + fmt(r.after.prompt).padStart(9) + "   saved " + pct(r.before.prompt, r.after.prompt));
  if (r.after.prior) console.log("   of which prior draft                              " + fmt(r.after.prior).padStart(9) + "   (bounded by the field list, not by consult length)");
  console.log("   est. input tokens (/4)  before " + fmt(Math.round(r.before.prompt / 4)).padStart(9) + "   after " + fmt(Math.round(r.after.prompt / 4)).padStart(9));
  console.log("");
}
console.log("The per-call instruction preamble is ~" + fmt(scribeExtractPrompt("").length) + " chars and is unavoidable in both modes;");
console.log("the transcript rows above are the part that used to scale with the SQUARE of consult length.");
