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

  /* ===== ONCQIS Phase C: evidence layers + guideline overlay + divergence (flag smd_onco_evidence_overlay) =====
   * Pure HTML builders + pure helpers. NEVER reconciles evidence or replaces a protocol: every action path
   * only RECORDS the physician's choice (applied:false) for the caller to act on. No DOM writes, no state. */

  function norm(v) { return v == null ? "" : String(v).trim().toLowerCase(); }
  function drugNames(reg) { reg = reg || {}; return (reg.drugs || []).map(function (d) { return d && (d.name || d.id) || ""; }).filter(Boolean); }
  function statusLabel(s) { return s === "current" ? "current" : (s === "superseded" ? "superseded" : "unknown"); }
  function coreSource(ev) { ev = ev || {}; var c = (ev.core || [])[0]; return c && c.source || ""; }

  // One provenance row: source + version + date + evidenceStatus (never invents missing fields).
  function provRow(p) {
    p = p || {};
    var meta = [];
    if (p.version) meta.push("v" + p.version);
    if (p.date) meta.push(p.date);
    meta.push(statusLabel(p.evidenceStatus));
    return '<div class="oev-prow"><span class="oev-psrc">' + esc(p.source || "not specified") +
      '</span><span class="oev-pmeta oev-st-' + esc(statusLabel(p.evidenceStatus)) + '">' + esc(meta.join(" · ")) + "</span></div>";
  }
  function instRow(i) {
    i = i || {};
    var meta = [];
    if (i.version) meta.push("v" + i.version);
    if (i.date) meta.push(i.date);
    if (i.approvedBy) meta.push("approved by " + i.approvedBy);
    var name = i.source || i.hospitalId || "not specified";
    return '<div class="oev-prow"><span class="oev-psrc">' + esc(name) +
      '</span><span class="oev-pmeta">' + esc(meta.join(" · ")) + "</span></div>";
  }
  function layerBlock(cls, title, sub, rowsHtml) {
    return '<div class="oev-layer ' + cls + '"><div class="oev-layer-h">' + esc(title) + "</div>" +
      '<div class="oev-layer-sub">' + esc(sub) + "</div>" + rowsHtml + "</div>";
  }

  // renderEvidenceLayers(protocol): the 3-layer panel. CORE is rendered from evidence.core only and is
  // never mutated by the guideline layer. Empty overlays state so honestly (no fabricated content).
  function renderEvidenceLayers(protocol) {
    protocol = protocol || {};
    var ev = protocol.evidence || {};
    var core = (ev.core || []).map(provRow).join("") || '<div class="oev-empty">No core evidence recorded.</div>';
    var guide = (ev.guideline || []).map(provRow).join("") || '<div class="oev-empty">No guideline overlay recorded.</div>';
    var inst = (ev.institutional || []).map(instRow).join("") || '<div class="oev-empty">No institutional overlay recorded.</div>';
    return '<section class="oev-layers">' +
      layerBlock("oev-layer-core", "Core Evidence", "Long-lived textbook framework (DeVita / Harrison). Never changed by the guideline overlay.", core) +
      layerBlock("oev-layer-guide", "Current Guideline", "Currentness overlay (NCCN / ASCO / ESMO / peer-reviewed). Sits over core; does not rewrite it.", guide) +
      layerBlock("oev-layer-inst", "Institutional", "Per-hospital overlay. Applied only for the treating tenant.", inst) +
      "</section>";
  }

  // _whyDiffer(a, b): PURE structured diff between two regimen descriptors {name, drugs:[names], version, source}.
  // Returns { differs, fields:[{field, standard, guideline, added?, removed?}], summary }. Never reconciles.
  function _whyDiffer(a, b) {
    a = a || {}; b = b || {};
    var fields = [];
    function cmp(field, av, bv) {
      if (norm(av) !== norm(bv)) fields.push({ field: field, standard: av == null ? "" : String(av), guideline: bv == null ? "" : String(bv) });
    }
    cmp("regimen name", a.name, b.name);
    var ad = a.drugs || [], bd = b.drugs || [];
    var adL = ad.map(norm), bdL = bd.map(norm);
    var added = bd.filter(function (x) { return adL.indexOf(norm(x)) < 0; });
    var removed = ad.filter(function (x) { return bdL.indexOf(norm(x)) < 0; });
    if (added.length || removed.length) fields.push({ field: "drugs", standard: ad.join(", "), guideline: bd.join(", "), added: added, removed: removed });
    cmp("version", a.version, b.version);
    cmp("source", a.source, b.source);
    var differs = fields.length > 0;
    var summary = differs
      ? "Differences requiring physician review: " + fields.map(function (f) { return f.field; }).join(", ") + "."
      : "No structured field differences detected. Physician review still required before any change.";
    return { differs: differs, fields: fields, summary: summary };
  }

  function descRow(label, val) { return val ? '<div class="oev-ua-row"><span class="oev-ua-k">' + esc(label) + '</span><span class="oev-ua-v">' + esc(val) + "</span></div>" : ""; }
  function regimenCol(clsExtra, heading, d) {
    return '<div class="oev-ua-col' + clsExtra + '"><div class="oev-ua-col-h">' + esc(heading) + "</div>" +
      descRow("Regimen", d.name) + descRow("Drugs", (d.drugs || []).join(", ")) +
      descRow("Version", d.version) + descRow("Source", d.source) + "</div>";
  }

  // renderUpdateAvailable(protocol, guidelineEntry): the UPDATE AVAILABLE overlay. Shows BOTH the current
  // StewardMD Standard Protocol and the current guideline, a structured why-differ, sources+versions, and
  // three actions. Actions carry data-onco-ev="update-choice" data-choice; clicking one only RECORDS the
  // physician's choice (see recordChoice) - it NEVER auto-applies a change.
  function renderUpdateAvailable(protocol, ge) {
    protocol = protocol || {}; ge = ge || {};
    var std = { name: protocol.name || protocol.id || "Standard Protocol", drugs: drugNames(protocol.regimen), version: protocol.protocolVersion || "", source: coreSource(protocol.evidence) };
    var gRe = ge.regimen || {};
    var gui = { name: gRe.name || ge.name || "", drugs: drugNames(gRe), version: ge.version || "", source: ge.source || "" };
    var wd = _whyDiffer(std, gui);
    var whyRows = wd.fields.map(function (f) {
      return '<div class="oev-ua-why-row"><span class="oev-ua-why-f">' + esc(f.field) +
        '</span><span class="oev-ua-why-d">standard: ' + esc(f.standard || "not set") + " vs guideline: " + esc(f.guideline || "not set") + "</span></div>";
    }).join("");
    return '<section class="oev-ua"><div class="oev-ua-h">UPDATE AVAILABLE</div>' +
      '<div class="oev-ua-lead">A guideline entry proposes a newer or preferred regimen. Review and decide; nothing changes automatically.</div>' +
      '<div class="oev-ua-cols">' + regimenCol("", "Current StewardMD Standard Protocol", std) + regimenCol(" oev-ua-col-new", "Current guideline", gui) + "</div>" +
      '<div class="oev-ua-why"><div class="oev-ua-why-h">Why they differ</div>' + whyRows +
      '<div class="oev-ua-why-sum">' + esc(wd.summary) + "</div></div>" +
      '<div class="oev-ua-actions">' +
      '<button class="oev-ua-btn" data-onco-ev="update-choice" data-choice="continue">CONTINUE STANDARD PROTOCOL</button>' +
      '<button class="oev-ua-btn oev-ua-btn-alt" data-onco-ev="update-choice" data-choice="select">SELECT UPDATED REGIMEN</button>' +
      '<button class="oev-ua-btn oev-ua-btn-ghost" data-onco-ev="update-choice" data-choice="review">REVIEW EVIDENCE</button>' +
      "</div>" +
      '<div class="oev-ua-note">StewardMD never auto-applies a guideline update. Selecting an option records your choice for review; it does not change the protocol.</div>' +
      "</section>";
  }

  // _divergenceModel(entry): PURE normalized model of one evidence.divergence entry. resolution is ALWAYS
  // clinical-review-required and selection is ALWAYS null: divergence is never auto-reconciled here.
  function _divergenceModel(entry) {
    entry = entry || {};
    var sources = (entry.sources || []).map(function (s) { s = s || {}; return { name: s.name || "Unknown source", version: s.version == null ? null : s.version, value: s.value }; });
    var difference = entry.note || sources.map(function (s, i) { return "Source " + (i + 1) + " (" + s.name + "): " + (s.value == null ? "not stated" : String(s.value)); }).join("; ");
    return { field: entry.field || "", sources: sources, difference: difference, note: entry.note || "", resolution: "clinical-review-required", reviewRequired: true, selection: null };
  }

  // renderDivergence(divergenceEntry): the EVIDENCE DIVERGENCE view for one field. Shows each source, the
  // difference, "Clinical review required", and a selection control per source. Selecting only RECORDS the
  // choice (recordDivergenceSelection); it is NEVER auto-reconciled.
  function renderDivergence(entry) {
    var m = _divergenceModel(entry);
    var srcRows = m.sources.map(function (s, i) {
      var v = (s.version ? " v" + s.version : "");
      return '<div class="oev-div-src"><span class="oev-div-src-k">Source ' + (i + 1) + "</span><span class=\"oev-div-src-v\">" + esc(s.name + v + ": " + (s.value == null ? "not stated" : String(s.value))) + "</span></div>";
    }).join("");
    var selBtns = m.sources.map(function (s, i) {
      return '<button class="oev-div-btn" data-onco-ev="divergence-select" data-field="' + esc(m.field) + '" data-src-index="' + i + '">Record: prefer ' + esc(s.name) + "</button>";
    }).join("");
    return '<section class="oev-div"><div class="oev-div-h">EVIDENCE DIVERGENCE</div>' +
      '<div class="oev-div-field">Field: ' + esc(m.field || "not specified") + "</div>" +
      '<div class="oev-div-sources">' + (srcRows || '<div class="oev-empty">No sources recorded.</div>') + "</div>" +
      '<div class="oev-div-diff"><span class="oev-div-diff-k">Difference</span> ' + esc(m.difference || "not described") + "</div>" +
      '<div class="oev-div-review">Clinical review required</div>' +
      '<div class="oev-div-select">' + selBtns + "</div>" +
      '<div class="oev-div-note">Your selection is recorded for the treating physician. StewardMD never auto-reconciles divergent evidence.</div>' +
      "</section>";
  }

  // recordChoice(action): the UPDATE AVAILABLE decision. Returns the choice for the caller to act on; the
  // module itself applies NOTHING (applied:false, autoApplied:false).
  function recordChoice(action) { return { choice: action || null, applied: false, autoApplied: false, reviewRequired: true }; }
  // recordDivergenceSelection(entry, sourceIndex): records a physician's preferred source. Never reconciles:
  // applied:false, autoReconciled:false, resolution stays clinical-review-required.
  function recordDivergenceSelection(entry, sourceIndex) {
    var m = _divergenceModel(entry);
    var idx = (sourceIndex == null || isNaN(Number(sourceIndex))) ? null : Number(sourceIndex);
    var chosen = (idx != null && m.sources[idx]) ? m.sources[idx] : null;
    return { field: m.field, selected: chosen ? chosen.name : null, sourceIndex: idx, applied: false, autoReconciled: false, resolution: "clinical-review-required", reviewRequired: true };
  }

  var API = {
    KIND_LABEL: KIND_LABEL, KIND_ORDER: KIND_ORDER,
    build: build, forCalculator: forCalculator, forDisease: forDisease, forPatientData: forPatientData, forAI: forAI,
    renderEvidenceLayers: renderEvidenceLayers, renderUpdateAvailable: renderUpdateAvailable, renderDivergence: renderDivergence,
    recordChoice: recordChoice, recordDivergenceSelection: recordDivergenceSelection,
    _whyDiffer: _whyDiffer, _divergenceModel: _divergenceModel,
    _version: "1.1"
  };
  G.SMD_ONCOEV = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
