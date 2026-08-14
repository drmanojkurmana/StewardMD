/* onco-evidence.js — shared provenance/evidence panel builder (window.SMD_ONCOEV). Phase 8 P0.
 * Any oncology result or output (a calculator score, a KB disease, a future staging/CTCAE grade, an
 * AI explanation) can be labelled with WHY it was produced and its SOURCE (name + version +
 * section), and is always tagged into exactly one of four buckets so a clinician never mistakes
 * one kind of information for another:
 *   patient    — Patient data      (entered this session; never auto-decided)
 *   guideline  — Guideline knowledge (the StewardMD Knowledge Base / a protocol document)
 *   calc       — Clinical calculation (a deterministic formula/rule, e.g. MEDCALC)
 *   ai         — AI explanation    (MaiK — always a gloss, never the source of truth)
 * Pure HTML builder only: no DOM writes, no fetch, no window state, no LLM call. Buildless ES5
 * IIFE. window.SMD_ONCOEV + module.exports (fully testable in Node). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  var KIND_LABEL = { patient: "Patient data", guideline: "Guideline knowledge", calc: "Clinical calculation", ai: "AI explanation" };
  var KIND_ORDER = ["patient", "guideline", "calc", "ai"];

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function kindLabel(k) { return KIND_LABEL[k] || "Reference"; }

  function badge(kind) { return '<span class="oev-badge oev-' + esc(kind || "guideline") + '">' + esc(kindLabel(kind)) + "</span>"; }
  function sourceLine(source) {
    if (!source) return "";
    var parts = [];
    if (source.name) parts.push(source.name);
    if (source.version) parts.push("v" + source.version);
    if (source.section) parts.push(source.section);
    return parts.length ? '<div class="oev-source">' + esc(parts.join(" · ")) + "</div>" : "";
  }
  // entry: { kind: "patient"|"guideline"|"calc"|"ai", why, source:{name,version,section} }
  function entryHtml(e) {
    e = e || {};
    return '<div class="oev-entry">' + badge(e.kind) +
      (e.why ? '<div class="oev-why">' + esc(e.why) + "</div>" : "") +
      sourceLine(e.source) + "</div>";
  }
  // build(entries[]) -> the full provenance panel HTML for one result/output. Empty/omitted input
  // -> "" (never a placeholder panel with nothing to say).
  function build(entries) {
    entries = entries || [];
    if (!entries.length) return "";
    return '<div class="oev-panel">' + entries.map(entryHtml).join("") + "</div>";
  }

  /* ---- P0 convenience wrappers (calculator + disease results) ---- */
  // A MEDCALC.list()/.run()-shaped result: { id, title, cat, interpretation? }.
  function forCalculator(r) {
    if (!r) return "";
    var why = r.interpretation || r.desc || "";
    return build([{ kind: "calc", why: why, source: { name: r.title || r.id, section: r.cat } }]);
  }
  // A KB disease index entry: { id, name, system }.
  function forDisease(d) {
    if (!d) return "";
    return build([{ kind: "guideline", why: "StewardMD Knowledge Base (Harrison's Principles of Internal Medicine)",
      source: { name: d.name || d.id, section: d.system } }]);
  }
  // A verbatim, unmodified patient-entered value — never computed, never auto-decided.
  function forPatientData(label, note) {
    if (!label) return "";
    return build([{ kind: "patient", why: label, source: { name: note || "Entered this session, verify before use" } }]);
  }
  // An AI (MaiK) gloss — always labelled distinctly from a calculation or a guideline fact.
  function forAI(text, source) {
    if (!text) return "";
    return build([{ kind: "ai", why: text, source: source }]);
  }

  var API = {
    KIND_LABEL: KIND_LABEL, KIND_ORDER: KIND_ORDER,
    build: build, forCalculator: forCalculator, forDisease: forDisease, forPatientData: forPatientData, forAI: forAI,
    _version: "1.0"
  };
  G.SMD_ONCOEV = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
