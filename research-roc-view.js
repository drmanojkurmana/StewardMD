/* StewardMD - ResearchMD ROC curve view (window.SMD_RESEARCH_ROC_VIEW).
 * Turns the result of SMD_RESEARCH_STATS.roc into the result cards, the ROC
 * chart (inline SVG, no chart library), the manuscript text, the results
 * paragraph and the CSV rows for the Master Chart screen.
 * Pure string building: no DOM access, no network, no AI. ES5 only.
 * Dual export: browser global SMD_RESEARCH_ROC_VIEW and CommonJS module.exports.
 *
 * Flag: smd_rmd_roc, DEFAULT ON. Off on a device only when
 * localStorage "smd_rmd_roc" is "0" (kill switch).
 */
(function (G) {
  "use strict";

  var COLORS = ["var(--rmd-acc)", "var(--rmd-warn)", "var(--rmd-bad)", "var(--rmd-mut)"];

  function isEnabled() {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("smd_rmd_roc") === "0") return false;
    } catch (e) {}
    return true;
  }

  function defEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function defFmt(x, d) {
    if (x == null || !isFinite(x)) return "";
    var k = d == null ? 2 : d;
    var f = Math.pow(10, k);
    return (Math.round(x * f) / f).toFixed(k);
  }

  function defP(p) {
    if (p == null || !isFinite(p)) return "";
    if (p < 0.001) return "p < 0.001";
    return "p = " + defFmt(p, 3);
  }

  function helpers(h) {
    h = h || {};
    return { esc: h.esc || defEsc, fmt: h.fmt || defFmt, pStr: h.pStr || defP, pGloss: h.pGloss || function () { return ""; } };
  }

  function stats() { return G && G.SMD_RESEARCH_STATS; }

  function band(auc) {
    var S = stats();
    if (S && S.aucBand) return S.aucBand(auc);
    return "";
  }

  function pct(x, H) { return H.fmt(x * 100, 1) + "%"; }

  function ciPct(ci, H) {
    if (!ci || ci[0] == null || ci[1] == null) return "";
    return "95% CI " + H.fmt(ci[0] * 100, 1) + " to " + H.fmt(ci[1] * 100, 1) + "%";
  }

  /* Cut-off shown with enough decimals to tell neighbouring values apart. */
  function cutStr(x, H) {
    if (x === Infinity || x === -Infinity || x == null) return "";
    var a = Math.abs(x);
    var d = a >= 100 ? 1 : (a >= 1 ? 2 : (a >= 0.01 ? 3 : 4));
    return H.fmt(x, d);
  }

  function aucLine(t, H) {
    var s = "AUC " + H.fmt(t.auc, 3);
    if (t.ciLower != null && t.ciUpper != null) s += " (95% CI " + H.fmt(t.ciLower, 3) + " to " + H.fmt(t.ciUpper, 3) + ", DeLong)";
    return s;
  }

  function aucGloss(t, r) {
    if (t.auc == null || !isFinite(t.auc)) return "";
    var word = t.direction === ">" ? "lower" : "higher";
    return "Pick one person with " + r.positiveLevel + " and one without at random: " + t.name + " is " + word +
      " in the person with " + r.positiveLevel + " " + Math.round(t.auc * 100) + "% of the time (50% is a coin toss).";
  }

  /* ---------- chart ---------- */

  function curvePoints(t) {
    var pts = [], i;
    for (i = 0; i < t.sensitivities.length; i++) pts.push([1 - t.specificities[i], t.sensitivities[i]]);
    pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return pts;
  }

  function svg(result, h) {
    var H = helpers(h);
    var x0 = 54, x1 = 330, y0 = 14, y1 = 290;
    var w = x1 - x0, hgt = y1 - y0;
    var out = '<svg class="rmd-mc-roc" viewBox="0 0 520 330" role="img" aria-label="ROC curve: sensitivity against 1 minus specificity">';
    var i, k, g;
    for (i = 0; i <= 4; i++) {
      var gx = x0 + (i / 4) * w, gy = y1 - (i / 4) * hgt;
      out += '<line x1="' + gx.toFixed(1) + '" y1="' + y0 + '" x2="' + gx.toFixed(1) + '" y2="' + y1 + '" stroke="var(--rmd-line)" stroke-width="0.5" opacity="0.5"/>';
      out += '<line x1="' + x0 + '" y1="' + gy.toFixed(1) + '" x2="' + x1 + '" y2="' + gy.toFixed(1) + '" stroke="var(--rmd-line)" stroke-width="0.5" opacity="0.5"/>';
      out += '<text x="' + gx.toFixed(1) + '" y="' + (y1 + 14) + '" font-size="10" text-anchor="middle" fill="var(--rmd-mut)">' + H.fmt(i / 4, 2) + '</text>';
      out += '<text x="' + (x0 - 6) + '" y="' + (gy + 3).toFixed(1) + '" font-size="10" text-anchor="end" fill="var(--rmd-mut)">' + H.fmt(i / 4, 2) + '</text>';
    }
    out += '<line x1="' + x0 + '" y1="' + y1 + '" x2="' + x1 + '" y2="' + y0 + '" stroke="var(--rmd-mut)" stroke-width="1" stroke-dasharray="4 4"/>';
    out += '<rect x="' + x0 + '" y="' + y0 + '" width="' + w + '" height="' + hgt + '" fill="none" stroke="var(--rmd-line)" stroke-width="1"/>';
    out += '<text x="' + ((x0 + x1) / 2) + '" y="' + (y1 + 30) + '" font-size="11" text-anchor="middle" fill="var(--rmd-mut)">1 - specificity (false positive rate)</text>';
    out += '<text x="14" y="' + ((y0 + y1) / 2) + '" font-size="11" text-anchor="middle" fill="var(--rmd-mut)" transform="rotate(-90 14 ' + ((y0 + y1) / 2) + ')">Sensitivity</text>';
    for (g = 0; g < result.tests.length; g++) {
      var t = result.tests[g];
      var color = COLORS[g % COLORS.length];
      var pts = curvePoints(t), d = "";
      for (k = 0; k < pts.length; k++) {
        d += (k ? "L" : "M") + (x0 + pts[k][0] * w).toFixed(1) + " " + (y1 - pts[k][1] * hgt).toFixed(1);
      }
      out += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
      if (t.best) {
        var bx = x0 + (1 - t.best.specificity) * w, by = y1 - t.best.sensitivity * hgt;
        out += '<circle cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="4.5" fill="' + color + '" stroke="var(--rmd-panel)" stroke-width="1.5"/>';
      }
      var ly = y0 + 10 + g * 34;
      out += '<line x1="346" y1="' + ly + '" x2="366" y2="' + ly + '" stroke="' + color + '" stroke-width="3"/>';
      out += '<text x="372" y="' + (ly + 4) + '" font-size="11" fill="var(--rmd-ink, currentColor)">' + H.esc(shorten(t.name, 20)) + '</text>';
      out += '<text x="372" y="' + (ly + 18) + '" font-size="10" fill="var(--rmd-mut)">AUC ' + H.fmt(t.auc, 2) + '</text>';
    }
    var ny = y0 + 10 + result.tests.length * 34;
    out += '<line x1="346" y1="' + ny + '" x2="366" y2="' + ny + '" stroke="var(--rmd-mut)" stroke-width="1" stroke-dasharray="4 4"/>';
    out += '<text x="372" y="' + (ny + 4) + '" font-size="10" fill="var(--rmd-mut)">Chance (AUC 0.50)</text>';
    out += '<circle cx="356" cy="' + (ny + 22) + '" r="4.5" fill="var(--rmd-mut)"/>';
    out += '<text x="372" y="' + (ny + 26) + '" font-size="10" fill="var(--rmd-mut)">Best cut-off</text>';
    out += "</svg>";
    return out;
  }

  function shorten(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  /* ---------- cards ---------- */

  function testCard(t, r, H) {
    var h = '<div class="rmd-card rmd-mc-result">';
    h += '<h3>' + H.esc(t.name) + '</h3>';
    h += '<p class="rmd-mc-stat">' + H.esc(aucLine(t, H)) + '</p>';
    var b = band(t.auc);
    var gl = aucGloss(t, r);
    if (gl) h += '<p class="rmd-mc-gloss">' + H.esc(gl) + (b ? " Usually called " + H.esc(b) + "." : "") + '</p>';
    h += '<p class="rmd-mc-gloss">n = ' + t.n + ' (' + t.nCases + ' ' + H.esc(r.positiveLevel) + ', ' + t.nControls + ' ' + H.esc(r.negativeLevel) + ').' +
      (t.dropped > 0 ? ' ' + t.dropped + ' rows were left out (missing values).' : '') + '</p>';
    var bt = t.best;
    if (bt && isFinite(bt.threshold)) {
      var when = bt.positiveWhen === "below" ? "below" : "above";
      h += '<p class="rmd-mc-stat"><strong>Best cut-off (Youden): ' + H.esc(cutStr(bt.threshold, H)) + '</strong>. ' +
        'Values ' + when + ' it count as positive.</p>';
      h += '<p class="rmd-mc-gloss">Sensitivity ' + H.esc(pct(bt.sensitivity, H)) + ' (' + H.esc(ciPct(bt.sensitivityCi, H)) + '): of ' + t.nCases +
        ' people with ' + H.esc(r.positiveLevel) + ', the test picks up ' + bt.tp + '.</p>';
      h += '<p class="rmd-mc-gloss">Specificity ' + H.esc(pct(bt.specificity, H)) + ' (' + H.esc(ciPct(bt.specificityCi, H)) + '): of ' + t.nControls +
        ' people without it, the test clears ' + bt.tn + '.</p>';
      h += '<div class="rmd-mc-tablewrap"><table class="rmd-mc-table"><thead><tr><th></th><th>' + H.esc(r.positiveLevel) + '</th><th>' + H.esc(r.negativeLevel) + '</th></tr></thead><tbody>';
      h += '<tr><td>Test positive</td><td>' + bt.tp + '</td><td>' + bt.fp + '</td></tr>';
      h += '<tr><td>Test negative</td><td>' + bt.fn + '</td><td>' + bt.tn + '</td></tr>';
      h += '</tbody></table></div>';
      if (bt.ppv != null || bt.npv != null) {
        h += '<p class="rmd-mc-gloss">In this sample, PPV ' + H.esc(bt.ppv == null ? "not available" : pct(bt.ppv, H)) + ' and NPV ' +
          H.esc(bt.npv == null ? "not available" : pct(bt.npv, H)) + '. These change with how common ' + H.esc(r.positiveLevel) + ' is, so they may not carry over to another hospital.</p>';
      }
      if (bt.ties && bt.ties.length > 1) {
        var others = [];
        for (var i = 0; i < bt.ties.length; i++) if (bt.ties[i] !== bt.threshold && isFinite(bt.ties[i])) others.push(cutStr(bt.ties[i], H));
        if (others.length) h += '<p class="rmd-mc-gloss">' + others.length + (others.length === 1 ? ' other cut-off scores' : ' other cut-offs score') + ' the same (' + H.esc(others.join(", ")) + '). The one shown misses the fewest people with ' + H.esc(r.positiveLevel) + '.</p>';
      }
    }
    for (var w = 0; w < (t.warnings || []).length; w++) h += '<p class="rmd-mc-gloss">' + H.esc(t.warnings[w]) + '</p>';
    h += '</div>';
    return h;
  }

  function comparisonCard(c, H) {
    var h = '<div class="rmd-card rmd-mc-result">';
    h += '<h3>' + H.esc(c.a) + ' vs ' + H.esc(c.b) + '</h3>';
    if (c.error) {
      h += '<p class="rmd-mc-gloss">Could not compare: ' + H.esc(String(c.error).replace(/^research:\s*/i, "")) + '</p></div>';
      return h;
    }
    h += '<p class="rmd-mc-stat">AUC ' + H.fmt(c.aucA, 3) + ' vs ' + H.fmt(c.aucB, 3) + ', difference ' + H.fmt(c.diff, 3);
    if (c.ciLower != null && c.ciUpper != null) h += ' (95% CI ' + H.fmt(c.ciLower, 3) + ' to ' + H.fmt(c.ciUpper, 3) + ')';
    h += ', ' + H.esc(H.pStr(c.p)) + '</p>';
    h += '<p class="rmd-mc-gloss">DeLong test for two tests done on the same ' + c.n + ' people.</p>';
    var pg = H.pGloss(c.p);
    if (pg) h += '<p class="rmd-mc-gloss">' + H.esc(pg) + '</p>';
    if (c.directionsDiffer) h += '<p class="rmd-mc-gloss">One test reads high values as positive and the other reads low values as positive. The comparison still holds, but say so when you report it.</p>';
    h += '</div>';
    return h;
  }

  function resultsHtml(result, h) {
    var H = helpers(h);
    var out = '<p class="rmd-mc-stat">Condition: ' + H.esc(result.truth) + ' (positive = ' + H.esc(result.positiveLevel) + ').</p>';
    out += '<div class="rmd-card rmd-mc-result"><h3>ROC curve</h3>' + svg(result, H) +
      '<p class="rmd-mc-gloss">The closer a curve bends to the top left corner, the better the test. The dashed line is a coin toss.</p></div>';
    var i;
    for (i = 0; i < result.tests.length; i++) out += testCard(result.tests[i], result, H);
    for (i = 0; i < (result.comparisons || []).length; i++) out += comparisonCard(result.comparisons[i], H);
    return out;
  }

  /* ---------- text ---------- */

  function bestSentence(t, r, H) {
    var bt = t.best;
    if (!bt || !isFinite(bt.threshold)) return "";
    return "At the Youden cut-off of " + cutStr(bt.threshold, H) + " (values " + (bt.positiveWhen === "below" ? "below" : "above") +
      " it positive), sensitivity was " + pct(bt.sensitivity, H) + " (" + ciPct(bt.sensitivityCi, H) + ") and specificity " +
      pct(bt.specificity, H) + " (" + ciPct(bt.specificityCi, H) + ").";
  }

  function paragraph(result, h) {
    var H = helpers(h);
    var parts = [], i;
    var t0 = result.tests[0];
    if (!t0) return "";
    parts.push("We assessed how well " + (result.tests.length === 1 ? t0.name : result.tests.map(function (t) { return t.name; }).join(", ")) +
      " identified " + result.positiveLevel + " (" + result.truth + ") using ROC curves; the 95% CI of each AUC used the DeLong method.");
    for (i = 0; i < result.tests.length; i++) {
      var t = result.tests[i];
      var s = t.name + " had an " + aucLine(t, H).replace(", DeLong", "") + " in " + t.n + " patients (" + t.nCases + " with " + result.positiveLevel + ").";
      var bs = bestSentence(t, result, H);
      if (bs) s += " " + bs;
      parts.push(s);
    }
    var cs = result.comparisons || [];
    for (i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c.error || c.p == null) continue;
      parts.push("The AUC of " + c.a + " and " + c.b + " differed by " + H.fmt(c.diff, 3) +
        (c.ciLower != null ? " (95% CI " + H.fmt(c.ciLower, 3) + " to " + H.fmt(c.ciUpper, 3) + ")" : "") +
        " on the " + c.n + " patients with both values (paired DeLong test, " + H.pStr(c.p) + ").");
    }
    return parts.join(" ");
  }

  function manuscriptText(result, h) {
    var H = helpers(h);
    var lines = ["ROC analysis for " + result.positiveLevel + " (" + result.truth + ")."];
    for (var i = 0; i < result.tests.length; i++) {
      var t = result.tests[i];
      var s = t.name + ": n = " + t.n + " (" + t.nCases + " " + result.positiveLevel + ", " + t.nControls + " " + result.negativeLevel + "), " + aucLine(t, H) + ".";
      var bs = bestSentence(t, result, H);
      if (bs) s += " " + bs + " TP " + t.best.tp + ", FP " + t.best.fp + ", FN " + t.best.fn + ", TN " + t.best.tn + ".";
      lines.push(s);
    }
    var cs = result.comparisons || [];
    for (var j = 0; j < cs.length; j++) {
      var c = cs[j];
      if (c.error || c.p == null) continue;
      lines.push(c.a + " vs " + c.b + ": AUC difference " + H.fmt(c.diff, 3) +
        (c.ciLower != null ? " (95% CI " + H.fmt(c.ciLower, 3) + " to " + H.fmt(c.ciUpper, 3) + ")" : "") +
        ", paired DeLong " + H.pStr(c.p) + ", n = " + c.n + ".");
    }
    return lines.join("\n");
  }

  function csvRows(result, h) {
    var H = helpers(h);
    var rows = [["Test", "n", "With " + result.positiveLevel, "Without", "Positive when", "AUC", "CI lower", "CI upper", "SE",
      "Cut-off", "Sensitivity", "Sens CI lower", "Sens CI upper", "Specificity", "Spec CI lower", "Spec CI upper", "PPV", "NPV", "Rows dropped"]];
    var i, k;
    for (i = 0; i < result.tests.length; i++) {
      var t = result.tests[i], bt = t.best || {};
      rows.push([t.name, t.n, t.nCases, t.nControls, t.direction === ">" ? "lower" : "higher",
        H.fmt(t.auc, 4), H.fmt(t.ciLower, 4), H.fmt(t.ciUpper, 4), H.fmt(t.se, 4),
        cutStr(bt.threshold, H), H.fmt(bt.sensitivity, 4), H.fmt(bt.sensitivityCi && bt.sensitivityCi[0], 4), H.fmt(bt.sensitivityCi && bt.sensitivityCi[1], 4),
        H.fmt(bt.specificity, 4), H.fmt(bt.specificityCi && bt.specificityCi[0], 4), H.fmt(bt.specificityCi && bt.specificityCi[1], 4),
        H.fmt(bt.ppv, 4), H.fmt(bt.npv, 4), t.dropped || 0]);
    }
    var cs = result.comparisons || [];
    if (cs.length) {
      rows.push([]);
      rows.push(["Comparison", "n", "AUC A", "AUC B", "Difference", "CI lower", "CI upper", "Z", "p"]);
      for (i = 0; i < cs.length; i++) {
        var c = cs[i];
        rows.push([c.a + " vs " + c.b, c.n, H.fmt(c.aucA, 4), H.fmt(c.aucB, 4), H.fmt(c.diff, 4), H.fmt(c.ciLower, 4), H.fmt(c.ciUpper, 4), H.fmt(c.z, 3), H.pStr(c.p)]);
      }
    }
    rows.push([]);
    rows.push(["Curve points: test", "Threshold", "Sensitivity", "Specificity"]);
    for (i = 0; i < result.tests.length; i++) {
      var tt = result.tests[i];
      for (k = 0; k < tt.thresholds.length; k++) {
        var thr = tt.thresholds[k];
        rows.push([tt.name, thr === -Infinity ? "-Inf" : (thr === Infinity ? "Inf" : String(thr)), H.fmt(tt.sensitivities[k], 4), H.fmt(tt.specificities[k], 4)]);
      }
    }
    return rows;
  }

  var API = {
    isEnabled: isEnabled,
    svg: svg,
    resultsHtml: resultsHtml,
    paragraph: paragraph,
    manuscriptText: manuscriptText,
    csvRows: csvRows,
    cutStr: function (x) { return cutStr(x, helpers()); }
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = API; }
  if (G) { G.SMD_RESEARCH_ROC_VIEW = API; }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : undefined));
