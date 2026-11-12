/* Guided tour helpers for fig-viewer.js. ES5. Pure: no DOM.
 * window.SMD_FIGGUIDE: stepsFrom, termHits, gloss, and the plain-language table. */
(function (G) {
  "use strict";
  /* Plain words only. No dashes in the gloss text. Keys are matched whole word, case insensitive. */
  var GLOSS = {
    "adcc": "immune cells killing a cell that antibodies have marked",
    "sn-38": "the active form of irinotecan",
    "cyp": "a liver enzyme family that processes drugs",
    "topoisomerase": "an enzyme that cuts and reseals DNA so it can unwind",
    "astrocyte": "a support cell in the brain",
    "glutamine": "an amino acid that draws water into brain cells",
    "ischaemia": "too little blood flow to a tissue",
    "preload": "how full the heart is before it squeezes",
    "afterload": "the pressure the heart has to push against",
    "raas": "the hormone system that holds salt and raises blood pressure",
    "st elevation": "an ECG sign of sudden heart muscle injury",
    "st segment": "the ECG stretch looked at for a heart attack",
    "troponin": "a blood protein that rises when heart muscle is injured",
    "cytokine": "a messenger protein between immune cells",
    "apoptosis": "programmed cell death",
    "dna cross-link": "a bond that ties two DNA strands together",
    "dna crosslink": "a bond that ties two DNA strands together",
    "microtubule": "a rod the cell uses to divide",
    "gpcr": "a receptor that passes a signal across the cell membrane",
    "camp": "a messenger molecule inside the cell",
    "endotoxin": "a toxin from the bacterial cell wall",
    "pathogen": "a germ that causes disease",
    "macrophage": "a white cell that eats germs and raises the alarm",
    "endothelial": "of the cell lining of a blood vessel",
    "coagulation": "clotting of the blood",
    "interleukin": "a messenger protein between white cells",
    "vasopressor": "a drug that tightens vessels and raises blood pressure",
    "hypotension": "low blood pressure",
    "necrosis": "tissue death from injury",
    "neutrophil": "a white cell that moves toward infection",
    "nitric oxide": "a gas that relaxes blood vessels",
    "lactate": "a blood marker that rises when tissues lack oxygen",
    "lactic acidosis": "acid build up when tissues lack blood flow",
    "thrombus": "a clot formed inside a vessel",
    "cytochrome": "a liver enzyme that processes drugs",
    "g protein": "a switch protein linked to a receptor",
    "tumour necrosis factor": "a messenger protein that drives inflammation",
    "antibody dependent killing": "immune cells destroying a cell that antibodies have marked",
    "complement": "blood proteins that punch holes in a marked cell",
    "surfactant": "the film that keeps lung air sacs open",
    "hypoxaemia": "low oxygen in the blood",
    "arrhythmia": "an abnormal heart rhythm",
    "oedema": "swelling from fluid in the tissues",
    "inotrope": "a drug that strengthens the heartbeat"
  };
  var FIELDS = [
    { key: "trigger", label: "Cause", color: "--w-t", drug: "off" },
    { key: "target", label: "Target", color: "--w-g", drug: "" },
    { key: "mechanism", label: "What it does", color: "--w-m", drug: "" },
    { key: "manifestation", label: "Result", color: "--w-f", drug: "" },
    { key: "intervention", label: "Treatment", color: "--w-i", drug: "on" },
    { key: "adverse", label: "Side effects", color: "--w-a", drug: "on" }
  ];
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  /* Whole word. A trailing s is optional on ordinary words so "macrophage" matches "macrophages". Acronyms stay exact. */
  function termBody(term) {
    var parts = String(term).trim().split(/\s+/), last = parts.pop(), body = escRe(last);
    var acronym = last === last.toUpperCase() && /[A-Z]/.test(last);
    if (!acronym && last.length > 3 && /s$/i.test(last)) body = escRe(last.slice(0, -1)) + "s?";
    else if (!acronym) body += "s?";
    var head = parts.map(escRe).join("\\s+");
    return head ? head + "\\s+" + body : body;
  }
  function termRe(term) { return new RegExp("(^|[^A-Za-z0-9])(" + termBody(term) + ")(?![A-Za-z0-9])", "i"); }
  function firstSentence(t) {
    t = String(t || "").replace(/\s+/g, " ").trim();
    var i = t.search(/[.!?](\s|$)/);
    return i > 0 ? t.slice(0, i + 1) : t;
  }
  function boldTerms(s) {
    var out = [], re = /\*\*(.+?)\*\*/g, m;
    while ((m = re.exec(String(s || "")))) { if (m[1] && out.indexOf(m[1]) < 0) out.push(m[1]); }
    return out;
  }
  function findTerm(text, term) {
    var m = termRe(term).exec(text);
    if (!m) return null;
    var start = m.index + m[1].length, end = start + m[2].length, at = end;
    var open = text.lastIndexOf("**", start - 1), close = text.indexOf("**", end);
    if (open >= 0 && close >= end && text.slice(open + 2, start).indexOf("**") < 0 && text.slice(end, close).indexOf("**") < 0) at = close + 2;
    return { start: start, end: end, at: at };
  }
  function gloss(text) {
    var s = String(text || ""), keys = Object.keys(GLOSS).sort(function (a, b) { return b.length - a.length; }), spans = [], i, j, f, over;
    for (i = 0; i < keys.length; i++) {
      f = findTerm(s, keys[i]);
      if (!f) continue;
      over = false;
      for (j = 0; j < spans.length; j++) if (f.start < spans[j].end && f.end > spans[j].start) { over = true; break; }
      if (!over) spans.push({ start: f.start, end: f.end, at: f.at, plain: GLOSS[keys[i]] });
    }
    spans.sort(function (a, b) { return b.at - a.at; });
    for (i = 0; i < spans.length; i++) s = s.slice(0, spans[i].at) + " (" + spans[i].plain + ")" + s.slice(spans[i].at);
    return s;
  }
  function termHits(terms, text) {
    var hay = String(text || ""), i;
    for (i = 0; i < (terms || []).length; i++) if (terms[i] && termRe(terms[i]).test(hay)) return true;
    return false;
  }
  /* parts: [{ info, label, text }] from a .hot (info + label) or a stage label (text). Returns indexes that hit. */
  function matching(terms, parts) {
    var out = [], i, p;
    for (i = 0; i < (parts || []).length; i++) {
      p = parts[i] || {};
      if (termHits(terms, p.info) || termHits(terms, p.label) || termHits(terms, p.text)) out.push(i);
    }
    return out;
  }
  function stepsFrom(entry) {
    var out = [];
    if (!entry) return out;
    FIELDS.forEach(function (f) {
      var raw = entry[f.key];
      if (raw == null || !String(raw).trim()) return;
      var sentence = firstSentence(raw);
      if (!sentence) return;
      out.push({ key: f.key, label: f.label, color: f.color, drug: f.drug, sentence: gloss(sentence), terms: boldTerms(sentence) });
    });
    return out;
  }
  G.SMD_FIGGUIDE = {
    GLOSS: GLOSS,
    FIELDS: FIELDS,
    GAUGE_LINE: "Bars show how much: higher means more of that.",
    firstSentence: firstSentence,
    boldTerms: boldTerms,
    stepsFrom: stepsFrom,
    termHits: termHits,
    matching: matching,
    gloss: gloss
  };
})(typeof window !== "undefined" ? window : this);
