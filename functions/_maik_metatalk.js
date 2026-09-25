/* _maik_metatalk.js - MaiK never talks to the doctor about its own reference material.
 *
 * Owner, 2026-09-26: "wont the user think we are using rag or sending rag? why is agent tell the
 * passage yu sent is irrelavant?" A MaiK Cloud answer said "The provided StewardMD knowledge focuses
 * on <another disease> ... This is not directly relevant to the patient's presentation". The doctor
 * sent only a question; the Knowledge Base notes travel inside our prompt. The prompts now frame them
 * as private notes and forbid mentioning them; this is the server-side safety net on the final text,
 * for the streamed and the whole-answer paths alike.
 *
 * HIGH PRECISION OVER RECALL. A clinical sentence must survive: "passage of meconium", "nasal
 * passages", "in the context of sepsis", "the likely sources here", "education materials provided
 * at discharge", "based on the information you provided (age 71, creatinine 1.2)". So:
 *   - a lead-in is cut and its content kept:   "Based on the text provided, X."   -> "X."
 *   - a reporting frame is cut:                "The provided text states that X." -> "X."
 *   - a sentence ABOUT the material is dropped, and so is a next sentence that points back at it
 *     ("This is not directly relevant to ...").
 * Words that can name what the doctor typed (text, context, information, notes) only count with a
 * "provided"-type marker AND a relevance verdict ("the provided context focuses on ..."). Tables,
 * headings and lines carrying the @@MORE@@ / @@REFINE:...@@ markers are never touched.
 */

const RX = (s) => new RegExp(s, "i");
// What the doctor never sends to MaiK Cloud: passages, excerpts, sources, reference material.
const PASSAGE = "(?:passages?|excerpts?|snippets?|sources|references|reference\\s+(?:materials?|notes|texts?))";
// What a doctor's own question can also be called: meta only with a marker AND a relevance verdict.
// ("evidence" and "data" are not here: "the evidence given is not applicable to children" is clinical.)
const WEAK = "(?:texts?|context|information|details|notes|documents?|content|knowledge|materials?)";
const PROVIDER = "(?:provided|supplied|retrieved|accompanying|included|attached|shared|sent)";
const YOU_SENT = "(?:that\\s+)?(?:you|you've|you\\s+have)\\s+(?:sent|provided|shared|supplied|gave|given|included|pasted|attached)";
const REL = "(?:(?:is|are|was|were|seems?|appears?)\\s+(?:not\\s+|n't\\s+)?(?:directly\\s+|particularly\\s+|clinically\\s+|entirely\\s+|really\\s+)?(?:ir)?relevant|(?:is|are|was|were)\\s+(?:un|not\\s+)related|not\\s+(?:directly\\s+)?(?:applicable|pertinent)|off[-\\s]topic|focus(?:es|ed)?\\s+(?:on|primarily|mainly|solely|only)|(?:is|are|was|were)\\s+(?:only\\s+|mainly\\s+)?(?:about|limited\\s+to|silent\\s+on)|pertains?\\s+(?:only\\s+)?to|(?:does|do|did)\\s*(?:not|n't)\\s+(?:directly\\s+)?(?:address|answer|cover)\\s+(?:your|the|this)\\s+(?:question|query))";
const COVER = "(?:(?:does|do|did)\\s*(?:not|n't)\\s+(?:mention|cover|address|discuss|contain|include|describe|specify|provide|say|state|answer|give)|lacks?|(?:has|have)\\s+no\\b)";
const DET = "(?:the|this|that|these|those)";

const ABOUT_MATERIAL = [
  // "the provided sources", "the retrieved passages", "the accompanying reference material"
  RX("\\b" + DET + "\\s+" + PROVIDER + "\\s+(?:stewardmd\\s+)?" + PASSAGE + "\\b"),
  // "the passage you sent", "sources that you provided", "you sent me a passage"
  RX("\\b" + PASSAGE + "\\s+" + YOU_SENT + "\\b"),
  RX("\\b(?:you|you've|you\\s+have)\\s+(?:sent|provided|shared|supplied|given|gave|included|pasted)\\s+(?:me\\s+)?(?:a|an|the|some|these|this|those)\\s+(?:passages?|excerpts?|snippets?|sources|references|reference\\s+materials?)\\b"),
  // never clinical: excerpts, snippets, "retrieved <anything>", reference/private notes, "the prompt"
  RX("\\b(?:excerpts?|snippets?|text\\s+chunks?|retrieved\\s+(?:chunks?|passages?|texts?|knowledge|information|materials?|notes|sources|content|evidence|context|data|documents?)|reference\\s+notes|private\\s+notes|internal\\s+notes|my\\s+(?:notes|reference\\s+(?:notes|materials?))|stewardmd\\s+(?:knowledge(?!\\s+base)|notes|materials?|content|texts?)|in\\s+(?:the|this|your)\\s+prompt)\\b"),
  // a verdict on the material: "the knowledge base does not cover", "the sources do not mention"
  RX("\\b(?:knowledge\\s+base|reference\\s+(?:materials?|texts?)|(?:the|these|those)\\s+(?:passages?|sources|references))\\s+(?:" + REL + "|" + COVER + ")"),
  RX("\\b(?:the|these|those|my)\\s+notes\\s+" + REL),   // not COVER: "the notes do not mention allergies" can be the doctor's own notes
  // a doctor-nameable word only with a marker AND a relevance verdict: "the provided context focuses on"
  RX("\\b" + DET + "\\s+(?:" + PROVIDER + "|given)\\s+(?:stewardmd\\s+)?" + WEAK + "\\b[^.!?\\n]{0,60}?\\b" + REL),
  RX("\\b" + WEAK + "\\s+(?:that\\s+)?(?:(?:was|were)\\s+)?(?:you\\s+)?(?:provided|supplied|retrieved|shared|sent|given)\\b[^.!?\\n]{0,60}?\\b" + REL),
  // "not relevant to your question": no clinical answer says that about its own content
  RX("\\b(?:not\\s+(?:directly\\s+|particularly\\s+)?(?:relevant|applicable|pertinent|related)|irrelevant|unrelated|off[-\\s]topic)\\s+to\\s+(?:your|the|this)\\s+(?:question|query|request)\\b"),
];
// A sentence right after a dropped one that only points back at it.
const POINTS_BACK = /^\W*(?:this|that|it|these|those|they|such\s+\w+)\b[^.!?]{0,120}?\b(?:(?:ir)?relevant|applicable|pertinent|(?:un)?related|helpful|useful|off[-\s]topic)\b/i;

/* Cutting a lead-in / trailing attribution / reporting frame keeps the content, so a false match only
 * costs a few words of style. The phrase must still name the material ("the text provided", "the
 * provided context", "the sources"): "Based on the evidence, X" and "In this context, X" are left. */
const NP = "(?:(?:the|this|these|those|my|our|your)\\s+)?(?:(?:" + PROVIDER + "|given|above)\\s+)?(?:stewardmd\\s+)?(?:" + PASSAGE + "|" + WEAK + "|data|evidence|knowledge\\s+base)(?:\\s+(?:(?:that\\s+)?(?:(?:was|were)\\s+)?(?:you\\s+)?(?:provided|supplied|retrieved|shared|sent|given)|above))*";
const MARKER = RX("\\b(?:provided|supplied|retrieved|accompanying|included|attached|shared|sent|given|above)\\b|\\b(?:passages?|excerpts?|snippets?|sources|references|reference\\s+\\w+|knowledge\\s+base|stewardmd)\\b");
const LEAD = RX("^((?:\\*\\*)?)\\s*(?:(?:based|drawing)\\s+(?:on|upon)|according\\s+to|as\\s+(?:per|(?:stated|noted|described|mentioned|outlined|shown|given|indicated|detailed|summari[sz]ed)\\s+in)|per|going\\s+by|from|in)\\s+(" + NP + ")\\s*,\\s*");
const TRAIL = RX("\\s*,?\\s*\\(?\\s*(?:as\\s+(?:per|(?:stated|noted|described|mentioned|outlined|indicated)\\s+in)|according\\s+to|based\\s+on|per)\\s+(" + NP + ")\\s*\\)?(?=\\s*(?:\\[\\d+(?:\\s*,\\s*\\d+)*\\]\\s*)*[.!?]?\\s*(?:\\*\\*)?$)");
const REPORT = RX("^((?:\\*\\*)?)\\s*(" + NP + ")\\s+(?:also\\s+|clearly\\s+|specifically\\s+)?(?:states|says|notes|mentions|indicates|suggests|explains|confirms|emphasi[sz]es|highlights|specifies|recommends|advises|describes)\\s+that\\s+");

function cap(s) { return s.replace(/^([^A-Za-z0-9]*)([a-z])/, function (m, p, c) { return p + c.toUpperCase(); }); }

function rewrite(sent) {
  let s = sent, m;
  if ((m = LEAD.exec(s)) && MARKER.test(m[2])) s = m[1] + cap(s.slice(m[0].length));
  if ((m = REPORT.exec(s)) && MARKER.test(m[2])) s = m[1] + cap(s.slice(m[0].length));
  if ((m = TRAIL.exec(s)) && MARKER.test(m[1])) s = s.slice(0, m.index) + s.slice(m.index + m[0].length);
  return s;
}
function aboutMaterial(sent) { return ABOUT_MATERIAL.some(function (r) { return r.test(sent); }); }

/* One line of an answer -> the same line without meta-talk ("" when nothing is left). Structure lines
 * (table rows, headings, fences, the @@ markers) come back untouched, and so does an unchanged line. */
function scrubLine(line) {
  if (!line.trim() || /^\s*(?:\||#|```)/.test(line) || line.indexOf("@@") >= 0) return line;
  const pm = /^(\s*(?:[-*•]|\d+[.)])\s+)/.exec(line);
  const prefix = pm ? pm[1] : "", body = line.slice(prefix.length);
  const out = [];
  let changed = false, dropped = false, carry = "";
  for (const p0 of body.split(/(?<=[.!?][)"'\]]*)\s+/)) {
    const p = rewrite(p0);
    if (p !== p0) changed = true;
    if (aboutMaterial(p) || (dropped && POINTS_BACK.test(p)) || !p.replace(/\*\*|\[\d+(?:\s*,\s*\d+)*\]|[\s.,;:]/g, "")) {
      changed = true; dropped = true;
      // keep **bold** balanced: a dropped piece that opened bold hands it on, one that closed it hands it back
      if ((p.match(/\*\*/g) || []).length % 2) { if (/^\s*\*\*/.test(p)) carry = "**"; else if (out.length) out[out.length - 1] += "**"; }
      continue;
    }
    dropped = false;
    out.push(carry + p); carry = "";
  }
  if (!changed) return line;
  return out.length ? prefix + out.join(" ") : "";
}

/* Whole-answer scrub (non-stream path, cache hits). A line emptied by the scrub leaves no hole. */
export function scrubMetaTalk(text) {
  if (!text) return text;
  const kept = [];
  for (const l of String(text).split("\n")) { const s = scrubLine(l); if (s !== "" || l === "") kept.push(s); }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

/* Streaming scrub: holds back the unfinished line and emits whole scrubbed lines; flush() at the end.
 * ponytail: line granularity, so a live paragraph appears when its line ends; sentence-level release
 * if live streaming becomes the default and that delay is noticed. */
export function metaTalkStream() {
  let buf = "";
  return {
    push(delta) {
      buf += String(delta || "");
      const i = buf.lastIndexOf("\n");
      if (i < 0) return "";
      const lines = buf.slice(0, i).split("\n");
      buf = buf.slice(i + 1);
      let out = "";
      for (const l of lines) { const s = scrubLine(l); if (s !== "" || l === "") out += s + "\n"; }
      return out;
    },
    flush() { const t = buf; buf = ""; return t ? scrubLine(t) : ""; }
  };
}
