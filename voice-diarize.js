/* voice-diarize.js — best-effort Doctor/Patient turn labelling for the Voice Consult "Q&A" view.
 * ---------------------------------------------------------------------------
 * There is NO separate speaker audio on-device, so true diarization is impossible. This is a
 * transparent HEURISTIC: split the transcript into turns and label each by shape — questions and
 * clinical directives read as the Doctor; first-person symptoms / yes-no answers read as the
 * Patient; an unlabelled turn right after a doctor question is treated as the patient's answer.
 * It is display-only (marked "may be imperfect") and NEVER changes an EMR field. Best on the
 * English translation (SMD_AI "en"); still runs on raw text with romanized Telugu/Hindi cues.
 * window.SMD_DIARIZE + module.exports (Node-testable).
 */
(function (root) {
  "use strict";

  // Doctor: asking or directing. Patient: reporting. Word-ish cues (substring, lowercased).
  var Q_CUES = ["what", "when", "where", "why", "how", "which", "who ", "do you", "did you", "are you",
    "have you", "is there", "any ", "since when", "tell me", "describe", "show me", "can you", "could you",
    "would you", "how long", "how many", "how much", "let me see", "let me check",
    "enti", "emi", "ela", "ekkada", "eppudu", "entha", "enduku", "kya", "kab", "kahan", "kaise", "kitna"];
  var DR_CUES = ["let's", "lets ", "i'll ", "we'll ", "i will", "we will", "start ", "order ", "prescribe",
    "advise", "on examination", "i think", "looks like", "my impression", "the plan", "we should", "you should take",
    "continue ", "stop the", "increase the", "reduce the", "follow up", "review after", "get a ", "send for"];
  var PT_CUES = ["i have", "i feel", "i am ", "i'm ", "i've", "my pain", "it hurts", "it started", "i can't",
    "i cannot", "since ", "for the last", "yes ", "no ", "avunu", "ledu", "naaku", "naku", "haan", "nahi", "mujhe", "mera", "meri"];

  function has(low, cues) { for (var i = 0; i < cues.length; i++) if (low.indexOf(cues[i]) >= 0) return true; return false; }

  // Split into turns on sentence enders (incl. the Telugu/Devanagari danda) and newlines, keeping order.
  function splitTurns(text) {
    var t = String(text == null ? "" : text).replace(/\r/g, "\n");
    var parts = t.split(/([.?!।॥\n]+)/), turns = [], cur = "";
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (/^[.?!।॥\n]+$/.test(p)) { cur += p.replace(/\n+/g, ""); if (cur.trim()) turns.push(cur.trim()); cur = ""; }
      else cur += p;
    }
    if (cur.trim()) turns.push(cur.trim());
    return turns;
  }

  function isQuestion(s) { return /\?\s*$/.test(s) || has(s.toLowerCase(), Q_CUES); }

  // Returns [{speaker:"doctor"|"patient", text}], consecutive same-speaker turns merged into one bubble.
  function toQA(text) {
    var turns = splitTurns(text), out = [], prevSpeaker = "doctor", prevQ = false;
    turns.forEach(function (s) {
      var low = s.toLowerCase(), q = isQuestion(s), dr = has(low, DR_CUES), pt = has(low, PT_CUES), lbl;
      if (q || dr) lbl = "doctor";
      else if (pt) lbl = "patient";
      else if (prevQ) lbl = "patient";            // an unlabelled turn right after a question = the answer
      else lbl = prevSpeaker;                       // otherwise stay with the current speaker
      if (out.length && out[out.length - 1].speaker === lbl) out[out.length - 1].text += " " + s;
      else out.push({ speaker: lbl, text: s });
      prevSpeaker = lbl; prevQ = q;
    });
    return out;
  }

  var API = { toQA: toQA, splitTurns: splitTurns, isQuestion: isQuestion, _version: "1.0" };
  if (root) root.SMD_DIARIZE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
