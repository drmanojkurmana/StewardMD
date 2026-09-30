/* StewardMD - neonatal scores (window.SMD_NEO_SCORES). Phase 7, flags smd_neo + smd_neo_scores.
 *
 * Finnegan, Capurro, N-PASS, Rodwell, Raimondi, Ramsay and the AAP / NICHD therapeutic hypothermia
 * criteria, built from data/neo/scores.json (every item and point value quoted from its source) and
 * registered into the calculators.js registry (category "Neonatology", Draft line, source list), so they
 * show in Calculators and universal search. The hub's "Scores" tool opens that category.
 * Score types (see the file): sum, formula (constant + sum, over a divisor), single (pick one level),
 * criteria (groups that must be met). The engine is pure and exported for node tests.
 */
(function (G) {
  "use strict";
  function sumOf(score, chosen) {
    var total = 0, missing = [];
    (score.items || []).forEach(function (it) {
      var v = chosen[it.id];
      if (v == null || v === "") { missing.push(it.label); return; }
      var o = (it.options || [])[+v]; if (o) total += o.points;
    });
    return { total: total, missing: missing };
  }
  function interpret(score, v) {
    var hit = null;
    // Bounds as the source words them: lo (>=), hi (<=), gt (>), lt (<).
    (score.interpretation || []).forEach(function (b) { if ((b.lo == null || v >= b.lo) && (b.hi == null || v <= b.hi) && (b.gt == null || v > b.gt) && (b.lt == null || v < b.lt)) hit = hit || b; });
    return hit;
  }
  /* chosen: { itemId: optionIndex } | { level: index } | { itemId: true } for criteria. */
  function compute(score, chosen) {
    chosen = chosen || {};
    if (score.type === "single") {
      var l = (score.levels || [])[+chosen.level];
      return l ? { value: l.level, text: l.label, src: l } : { missing: ["level"] };
    }
    if (score.type === "criteria") {
      var met = {}, detail = [];
      (score.groups || []).forEach(function (g) {
        var n = (g.items || []).filter(function (it) { return !!chosen[it.id]; }).length, need = g.rule === "all" ? (g.items || []).length : g.rule === "min" ? g.min : 1;
        met[g.id] = n >= need; detail.push({ group: g, count: n, need: need, met: met[g.id] });
      });
      var req = score.eligible_if || (score.groups || []).map(function (g) { return g.id; });
      return { eligible: req.every(function (id) { return met[id]; }), groups: detail };
    }
    var s = sumOf(score, chosen);
    if (s.missing.length) return { missing: s.missing, partial: s.total };
    if (score.type === "formula") {
      var f = score.formula || {}, v = (f.constant + s.total) / (f.divisor || 1);
      return { value: Math.round(v * 10) / 10, unit: f.unit, sum: s.total, band: interpret(score, v) };
    }
    // negate: the source scores these items as negative points (N-PASS sedation); stored as positive
    // magnitudes because quotes cannot carry the sign reliably.
    var tot = score.negate ? -s.total : s.total;
    return { value: tot, band: interpret(score, tot) };
  }
  var ENGINE = { compute: compute, interpret: interpret };
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ calculators.js registration ================================ */
  function esc(s) { return String(s == null ? "" : s).replace(/[–—]/g, "-").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function srcHtml(doc, score) {
    var S = doc.sources || {}, ids = {};
    function add(o) { if (o && o.src) ids[o.src] = 1; }
    add(score); (score.items || []).forEach(function (it) { (it.options || []).forEach(add); }); (score.levels || []).forEach(add); (score.groups || []).forEach(function (g) { (g.items || []).forEach(add); }); (score.interpretation || []).forEach(add); add(score.formula);
    return '<div class="mc-src"><b>Sources</b> (each item quoted from its source; tap the Neonatal tools for the quotes):' + Object.keys(ids).map(function (k) { var s = S[k] || {}; return "<br>" + esc(s.title || k) + (s.licence ? " · " + esc(s.licence) : ""); }).join("") + "</div>";
  }
  function toCalc(doc, score) {
    var inputs = [];
    if (score.type === "single") inputs.push({ id: "level", label: "Level", type: "select", opts: (score.levels || []).map(function (l, i) { return { v: String(i), t: l.level + ": " + l.label }; }) });
    else if (score.type === "criteria") (score.groups || []).forEach(function (g) { (g.items || []).forEach(function (it) { inputs.push({ id: it.id, label: g.label + ": " + it.label, type: "check" }); }); });
    else (score.items || []).forEach(function (it) { inputs.push({ id: it.id, label: it.label, type: "select", opts: [{ v: "", t: "Choose" }].concat((it.options || []).map(function (o, i) { return { v: String(i), t: o.label + " (" + (score.negate && o.points ? "-" : "") + o.points + ")" }; })) }); });
    return {
      id: "neo_" + score.id.replace(/-/g, "_"), cat: "Neonatology", icon: "", title: score.name, desc: score.purpose || "", draft: true, kw: ["neonatal", score.id.replace(/-/g, " ")],
      inputs: inputs, srcHtml: srcHtml(doc, score),
      compute: function (v) {
        var r = compute(score, v);
        if (r.missing) return { err: "Choose: " + r.missing.slice(0, 3).join(", ") + (r.missing.length > 3 ? " and " + (r.missing.length - 3) + " more" : "") + "." };
        if (score.type === "criteria") return { html: '<div class="mc-res-box"><div class="mc-res-num">' + (r.eligible ? "Criteria met" : "Criteria not met") + '</div><div class="mc-res-i">' + r.groups.map(function (g) { return esc(g.group.label) + ": " + g.count + " of " + g.need + " needed" + (g.met ? " (met)" : ""); }).join("<br>") + "<br>Draft: verify against the source and local protocol.</div></div>" };
        if (score.type === "single") return { v: r.value, u: "", i: esc(r.text) + ". Draft." };
        return { v: r.value, u: r.unit || "points", i: (r.band ? esc(r.band.text) + ". " : "") + (score.type === "formula" ? "Sum of items " + r.sum + ". " : "") + "Draft: verify against the source." };
      }
    };
  }
  var registered = false;
  function registerAll() {
    var M = G.MEDCALC, F = G.SMD_NEO_FLAGS; if (registered || !M || !M.register || !F || !F.feature("scores") || !G.SMD_NEO_HUB) return;
    registered = true;
    G.SMD_NEO_HUB.api.dataOrNull("scores").then(function (doc) { if (!doc) return; (doc.scores || []).forEach(function (s) { try { M.register(toCalc(doc, s)); } catch (e) {} }); });
  }
  function screen(el, A) {
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading…</div></section>';
    A.dataOrNull("scores").then(function (doc) {
      if (!doc || !(doc.scores || []).length) { el.innerHTML = '<section class="nh-card"><h3>Scores</h3>' + A.noData("neonatal scores") + "</section>"; return; }
      registerAll();
      el.innerHTML = '<section class="nh-card"><h3>Scores ' + A.badge(doc) + '</h3><div class="nh-list">' + doc.scores.map(function (s) { return '<button type="button" class="nh-li" data-score="' + A.esc("neo_" + s.id.replace(/-/g, "_")) + '"><span>' + A.esc(s.name) + "<br><small>" + A.esc(s.purpose || "") + "</small></span></button>"; }).join("") + "</div>" +
        ((doc.notes || []).map(function (n) { return A.note(n.text, "info") + A.srcLine(doc, n); }).join("")) +
        ((doc.not_included || []).length ? A.note("Not on file: " + doc.not_included.map(function (x) { return x.id.toUpperCase(); }).join(", ") + " (no source defining them was found).", "info") : "") + '<div class="nh-foot">Opens in Calculators (category Neonatology).</div></section>';
      el.onclick = function (e) { var b = e.target.closest && e.target.closest("[data-score]"); if (!b || !G.MEDCALC) return; var id = b.getAttribute("data-score"); G.SMD_NEO_HUB.close(); setTimeout(function () { G.MEDCALC.open(id); }, 30); };
    });
  }
  G.SMD_NEO_SCORES = { engine: ENGINE, registerAll: registerAll, toCalc: toCalc };
  if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "scores", flag: "scores", order: 7, icon: "checklist", title: "Scores", sub: "Finnegan, N-PASS, Capurro, cooling", kw: "score finnegan abstinence capurro gestational age npass pain sedation rodwell sepsis raimondi coma ramsay hypothermia cooling hie", render: screen });
  if (G.document.readyState === "loading") G.document.addEventListener("DOMContentLoaded", function () { setTimeout(registerAll, 0); }); else setTimeout(registerAll, 0);
})(typeof window !== "undefined" ? window : globalThis);
