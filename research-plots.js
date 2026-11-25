/* StewardMD - ResearchMD Plots (window.SMD_RESEARCH_PLOTS / CommonJS).
 * Pure: no DOM, no Date, no Math.random, no I/O. ES5 only (var/function).
 * Package 4.4: publication-quality forest plots, funnel plots, Cochrane-style
 * risk-of-bias traffic-light and summary plots, and study characteristics tables.
 *
 * Note: svgToPngDataUrl is not needed; export is the SVG string at 300-dpi-equivalent viewBox sizing.
 */
(function (G) {
  "use strict";

  var RATIO_MEASURES = { OR: 1, RR: 1, HR: 1 };

  /* XML escaping helper. All user-supplied and dynamic text in SVGs must pass through this. */
  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* Numeric formatting helper. Returns "--" when not finite (no em-dashes). */
  function fmtNum(n, digits) {
    if (n == null || !isFinite(n)) return "--";
    if (digits === undefined || digits === null) digits = 2;
    return Number(n).toFixed(digits);
  }

  /* =========================================================================
   * 1. FOREST PLOT: forestSvg(run, opts)
   * ========================================================================= */

  function forestSvg(run, opts) {
    run = run || {};
    opts = opts || {};

    var manifest = run.manifest || {};
    var measure = opts.measure || manifest.measure || run.measure || "RR";
    var isRatio = !!RATIO_MEASURES[measure];
    var confLevel = opts.level || manifest.level || run.level || 0.95;
    var zCrit = confLevel === 0.9 ? 1.644853 : (confLevel === 0.99 ? 2.575829 : 1.959964);

    var themeName = opts.theme === "dark" ? "dark" : "light";
    var isDark = themeName === "dark";

    var colors = isDark ? {
      bg: opts.transparentBg ? "none" : "#0f172a",
      text: "#f1f5f9",
      muted: "#94a3b8",
      line: "#334155",
      nullLine: "#64748b",
      poolLine: "#2dd4bf",
      axis: "#64748b",
      ci: "#f1f5f9",
      box: "#14b8a6",
      diamondFill: "#14b8a6",
      diamondStroke: "#2dd4bf",
      piBar: "#fbbf24"
    } : {
      bg: opts.transparentBg ? "none" : "#ffffff",
      text: "#12202a",
      muted: "#64748b",
      line: "#e2e8f0",
      nullLine: "#94a3b8",
      poolLine: "#111c44",
      axis: "#475569",
      ci: "#12202a",
      box: "#111c44",
      diamondFill: "#111c44",
      diamondStroke: "#0a1230",
      piBar: "#b45309"
    };

    var rawStudies = opts.studies || run.studies || manifest.studies || manifest.inputs || [];
    var weights = run.weights || [];

    var rows = [];
    var i, s, effPt, effLo, effHi, weightVal, dataStr, labelStr;

    for (i = 0; i < rawStudies.length; i++) {
      s = rawStudies[i];
      effPt = null;
      effLo = null;
      effHi = null;
      dataStr = "";
      labelStr = s.label || s.study || s.name || s.id || ("Study " + (i + 1));

      // Extract data string if present
      if (s.dataStr) {
        dataStr = s.dataStr;
      } else if (s.data) {
        dataStr = s.data;
      } else if (s.events1 !== undefined && s.n1 !== undefined && s.events2 !== undefined && s.n2 !== undefined) {
        dataStr = s.events1 + "/" + s.n1 + " vs " + s.events2 + "/" + s.n2;
      } else if (s.inputs && s.inputs.events1 !== undefined && s.inputs.n1 !== undefined) {
        dataStr = s.inputs.events1 + "/" + s.inputs.n1 + " vs " + s.inputs.events2 + "/" + s.inputs.n2;
      } else if (s.values && s.values.events1 !== undefined && s.values.n1 !== undefined) {
        dataStr = s.values.events1 + "/" + s.values.n1 + " vs " + s.values.events2 + "/" + s.values.n2;
      } else if (s.mean1 !== undefined && s.mean2 !== undefined) {
        dataStr = s.mean1 + " vs " + s.mean2;
      } else if (s.inputs && s.inputs.mean1 !== undefined && s.inputs.mean2 !== undefined) {
        dataStr = s.inputs.mean1 + " vs " + s.inputs.mean2;
      } else if (s.values && s.values.mean1 !== undefined && s.values.mean2 !== undefined) {
        dataStr = s.values.mean1 + " vs " + s.values.mean2;
      }

      // Extract effect estimates
      if (s.calc && !s.calc.excluded) {
        if (s.calc.effect !== undefined && s.calc.ciLower !== undefined && s.calc.ciUpper !== undefined) {
          effPt = s.calc.effect;
          effLo = s.calc.ciLower;
          effHi = s.calc.ciUpper;
        } else if (s.calc.yi !== undefined) {
          var calcSe = s.calc.se !== undefined ? s.calc.se : (s.calc.vi ? Math.sqrt(s.calc.vi) : 0);
          if (isRatio) {
            effPt = Math.exp(s.calc.yi);
            effLo = Math.exp(s.calc.yi - zCrit * calcSe);
            effHi = Math.exp(s.calc.yi + zCrit * calcSe);
          } else {
            effPt = s.calc.yi;
            effLo = s.calc.yi - zCrit * calcSe;
            effHi = s.calc.yi + zCrit * calcSe;
          }
        }
      } else if (s.effect !== undefined && s.ciLower !== undefined && s.ciUpper !== undefined) {
        effPt = Number(s.effect);
        effLo = Number(s.ciLower);
        effHi = Number(s.ciUpper);
      } else if (s.inputs && s.inputs.effect !== undefined && s.inputs.ciLower !== undefined && s.inputs.ciUpper !== undefined) {
        effPt = Number(s.inputs.effect);
        effLo = Number(s.inputs.ciLower);
        effHi = Number(s.inputs.ciUpper);
      } else if (s.values && s.values.effect !== undefined && s.values.ciLower !== undefined && s.values.ciUpper !== undefined) {
        effPt = Number(s.values.effect);
        effLo = Number(s.values.ciLower);
        effHi = Number(s.values.ciUpper);
      } else if (s.yi !== undefined) {
        var sSe = s.se !== undefined ? Number(s.se) : (s.vi !== undefined ? Math.sqrt(Number(s.vi)) : (s.sei !== undefined ? Number(s.sei) : 0));
        var sYi = Number(s.yi);
        if (isRatio) {
          effPt = Math.exp(sYi);
          effLo = Math.exp(sYi - zCrit * sSe);
          effHi = Math.exp(sYi + zCrit * sSe);
        } else {
          effPt = sYi;
          effLo = sYi - zCrit * sSe;
          effHi = sYi + zCrit * sSe;
        }
      } else if (s.inputs && s.inputs.yi !== undefined) {
        var inSe = s.inputs.se !== undefined ? Number(s.inputs.se) : (s.inputs.vi !== undefined ? Math.sqrt(Number(s.inputs.vi)) : (s.inputs.sei !== undefined ? Number(s.inputs.sei) : 0));
        var inYi = Number(s.inputs.yi);
        if (isRatio) {
          effPt = Math.exp(inYi);
          effLo = Math.exp(inYi - zCrit * inSe);
          effHi = Math.exp(inYi + zCrit * inSe);
        } else {
          effPt = inYi;
          effLo = inYi - zCrit * inSe;
          effHi = inYi + zCrit * inSe;
        }
      }

      weightVal = weights[i] != null ? weights[i] : (s.weight != null ? s.weight : (100 / Math.max(1, rawStudies.length)));

      rows.push({
        study: s,
        label: labelStr,
        dataStr: dataStr,
        effPt: effPt,
        effLo: effLo,
        effHi: effHi,
        weight: weightVal,
        excluded: !!(s.excluded || (s.calc && s.calc.excluded))
      });
    }

    // Pooled estimate handling
    var pooledPt = null, pooledLo = null, pooledHi = null;
    if (run.pooled) {
      if (isRatio) {
        if (run.pooled.ciLower < 0 || run.pooled.effect < 0 || manifest.engine) {
          pooledPt = Math.exp(run.pooled.effect);
          pooledLo = Math.exp(run.pooled.ciLower);
          pooledHi = Math.exp(run.pooled.ciUpper);
        } else {
          pooledPt = run.pooled.effect;
          pooledLo = run.pooled.ciLower;
          pooledHi = run.pooled.ciUpper;
        }
      } else {
        pooledPt = run.pooled.effect;
        pooledLo = run.pooled.ciLower;
        pooledHi = run.pooled.ciUpper;
      }
    }

    // Prediction interval handling
    var predLo = null, predHi = null;
    if (run.predictionInterval && run.predictionInterval.lower != null && run.predictionInterval.upper != null) {
      predLo = isRatio ? Math.exp(run.predictionInterval.lower) : run.predictionInterval.lower;
      predHi = isRatio ? Math.exp(run.predictionInterval.upper) : run.predictionInterval.upper;
    }

    // Determine coordinate scale bounds
    var minVal = Infinity, maxVal = -Infinity;
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (!r.excluded && r.effPt != null && isFinite(r.effPt)) {
        if (r.effLo != null && r.effLo < minVal) minVal = r.effLo;
        if (r.effHi != null && r.effHi > maxVal) maxVal = r.effHi;
        if (r.effPt < minVal) minVal = r.effPt;
        if (r.effPt > maxVal) maxVal = r.effPt;
      }
    }

    if (pooledLo != null && pooledLo < minVal) minVal = pooledLo;
    if (pooledHi != null && pooledHi > maxVal) maxVal = pooledHi;
    if (predLo != null && predLo < minVal) minVal = predLo;
    if (predHi != null && predHi > maxVal) maxVal = predHi;

    var nullVal = isRatio ? 1.0 : 0.0;
    if (nullVal < minVal) minVal = nullVal;
    if (nullVal > maxVal) maxVal = nullVal;

    if (opts.xMin != null) minVal = opts.xMin;
    if (opts.xMax != null) maxVal = opts.xMax;

    if (isRatio) {
      if (minVal > 0.1) minVal = 0.1;
      if (maxVal < 10) maxVal = 10;
      minVal = Math.max(0.01, minVal * 0.75);
      maxVal = Math.min(100, maxVal * 1.35);
    } else {
      if (minVal > -1) minVal = -1;
      if (maxVal < 1) maxVal = 1;
      var pad = (maxVal - minVal) * 0.15;
      minVal -= pad;
      maxVal += pad;
    }

    // SVG Coordinate layout
    var totalWidth = opts.width || 880;
    var rowHeight = opts.rowHeight || 28;
    var topPadding = opts.topPadding || 65;
    var hasPI = predLo != null && predHi != null;
    var hasHet = !!(run.heterogeneity);
    var bottomPadding = 90 + (hasPI ? 24 : 0) + (hasHet ? 24 : 0);
    var totalHeight = opts.height || (topPadding + (rows.length * rowHeight) + bottomPadding);

    var colStudyX = 15;
    var colDataX = 200;
    var colEffectX = 330;
    var colWeightX = totalWidth - 20;
    var plotRight = colWeightX - 70;
    var plotLeft = 440;
    var plotWidth = plotRight - plotLeft;

    function xCoord(val) {
      if (val == null || !isFinite(val)) return plotLeft + plotWidth / 2;
      var t;
      if (isRatio) {
        var safeRatio = Math.max(minVal, Math.min(maxVal, val));
        t = (Math.log(safeRatio) - Math.log(minVal)) / (Math.log(maxVal) - Math.log(minVal));
      } else {
        var safeLinear = Math.max(minVal, Math.min(maxVal, val));
        t = (safeLinear - minVal) / (maxVal - minVal);
      }
      return plotLeft + t * plotWidth;
    }

    var nullX = xCoord(nullVal);
    var pooledX = pooledPt != null ? xCoord(pooledPt) : null;

    var svg = [];
    svg.push('<svg class="smd-forest-svg" viewBox="0 0 ' + totalWidth + ' ' + totalHeight + '" width="' + totalWidth + '" height="' + totalHeight + '" xmlns="http://www.w3.org/2000/svg">');
    svg.push('  <!-- 300-dpi equivalent publication vector graphic -->');
    svg.push('  <style>');
    svg.push('    .rf-bg { fill: ' + colors.bg + '; }');
    svg.push('    .rf-text { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; fill: ' + colors.text + '; }');
    svg.push('    .rf-hdr { font-weight: 600; font-size: 11.5px; fill: ' + colors.muted + '; text-transform: uppercase; letter-spacing: 0.04em; }');
    svg.push('    .rf-bold { font-weight: 600; }');
    svg.push('    .rf-mono { font-family: ui-monospace, "SF Mono", "Roboto Mono", Menlo, Monaco, Consolas, monospace; font-size: 11.5px; }');
    svg.push('    .rf-null-line { stroke: ' + colors.nullLine + '; stroke-width: 1.5; stroke-dasharray: 4,3; }');
    svg.push('    .rf-pool-line { stroke: ' + colors.poolLine + '; stroke-width: 1.2; stroke-dasharray: 2,2; opacity: 0.65; }');
    svg.push('    .rf-axis-line { stroke: ' + colors.axis + '; stroke-width: 1.2; }');
    svg.push('    .rf-ci-line { stroke: ' + colors.ci + '; stroke-width: 1.8; stroke-linecap: round; }');
    svg.push('    .rf-box { fill: ' + colors.box + '; }');
    svg.push('    .rf-diamond { fill: ' + colors.diamondFill + '; stroke: ' + colors.diamondStroke + '; stroke-width: 1.2; }');
    svg.push('    .rf-pibar { stroke: ' + colors.piBar + '; stroke-width: 2.2; stroke-linecap: square; }');
    svg.push('  </style>');

    if (colors.bg !== "none") {
      svg.push('  <rect width="100%" height="100%" class="rf-bg" />');
    }

    // Optional Title
    var headerY = 28;
    if (opts.title) {
      svg.push('  <text x="' + colStudyX + '" y="20" class="rf-text rf-bold" font-size="14">' + esc(opts.title) + '</text>');
      headerY = 44;
      topPadding = Math.max(topPadding, 78);
    }

    // Column Headers
    var pctLabel = (confLevel * 100).toFixed(0);
    svg.push('  <text x="' + colStudyX + '" y="' + headerY + '" class="rf-hdr">Study</text>');
    svg.push('  <text x="' + colDataX + '" y="' + headerY + '" class="rf-hdr">Data</text>');
    svg.push('  <text x="' + colEffectX + '" y="' + headerY + '" class="rf-hdr">' + esc(measure) + ' [' + pctLabel + '% CI]</text>');
    svg.push('  <text x="' + colWeightX + '" y="' + headerY + '" class="rf-hdr" text-anchor="end">Weight</text>');
    svg.push('  <line x1="' + colStudyX + '" y1="' + (headerY + 8) + '" x2="' + (totalWidth - 15) + '" y2="' + (headerY + 8) + '" stroke="' + colors.line + '" stroke-width="1.2" />');

    // Reference lines
    var plotTopY = topPadding - 10;
    var plotBottomY = topPadding + (rows.length * rowHeight) + 16;
    svg.push('  <line x1="' + nullX + '" y1="' + plotTopY + '" x2="' + nullX + '" y2="' + plotBottomY + '" class="rf-null-line" />');

    if (pooledX != null) {
      svg.push('  <line x1="' + pooledX + '" y1="' + plotTopY + '" x2="' + pooledX + '" y2="' + (plotBottomY + 22) + '" class="rf-pool-line" />');
    }

    // Study Rows
    for (var k = 0; k < rows.length; k++) {
      var row = rows[k];
      var y = topPadding + (k * rowHeight);

      svg.push('  <text x="' + colStudyX + '" y="' + (y + 4) + '" class="rf-text rf-bold">' + esc(row.label) + '</text>');
      svg.push('  <text x="' + colDataX + '" y="' + (y + 4) + '" class="rf-text rf-mono">' + esc(row.dataStr) + '</text>');

      if (!row.excluded && row.effPt != null && isFinite(row.effPt)) {
        var effStr = fmtNum(row.effPt, 2) + " [" + fmtNum(row.effLo, 2) + ", " + fmtNum(row.effHi, 2) + "]";
        svg.push('  <text x="' + colEffectX + '" y="' + (y + 4) + '" class="rf-text rf-mono">' + esc(effStr) + '</text>');

        var x1 = xCoord(row.effLo);
        var x2 = xCoord(row.effHi);
        svg.push('  <line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" class="rf-ci-line" />');

        var boxSize = Math.max(5, Math.min(22, 5 + Math.sqrt(Math.max(0, row.weight || 1)) * 2.8));
        var boxX = xCoord(row.effPt) - (boxSize / 2);
        var boxY = y - (boxSize / 2);
        svg.push('  <rect x="' + boxX + '" y="' + boxY + '" width="' + boxSize + '" height="' + boxSize + '" class="rf-box" rx="1" />');

        svg.push('  <text x="' + colWeightX + '" y="' + (y + 4) + '" class="rf-text rf-mono" text-anchor="end">' + fmtNum(row.weight, 1) + '%</text>');
      } else {
        svg.push('  <text x="' + colEffectX + '" y="' + (y + 4) + '" class="rf-text" fill="' + colors.muted + '">Excluded</text>');
        svg.push('  <text x="' + colWeightX + '" y="' + (y + 4) + '" class="rf-text rf-mono" text-anchor="end">0.0%</text>');
      }
    }

    // Divider before summary
    var summaryY = topPadding + (rows.length * rowHeight) + 14;
    svg.push('  <line x1="' + colStudyX + '" y1="' + (summaryY - 8) + '" x2="' + (totalWidth - 15) + '" y2="' + (summaryY - 8) + '" stroke="' + colors.line + '" stroke-width="1.2" />');

    // Pooled Estimate Diamond
    if (pooledPt != null && pooledLo != null && pooledHi != null) {
      var summaryLabel = manifest.model === "fixed" ? "Fixed Effect Model" : "Random Effects Model";
      if (manifest.model === "random_reml") summaryLabel += " (REML)";
      else if (manifest.model === "random_dl") summaryLabel += " (DL)";

      svg.push('  <text x="' + colStudyX + '" y="' + (summaryY + 4) + '" class="rf-text rf-bold">' + esc(summaryLabel) + '</text>');

      var poolStr = fmtNum(pooledPt, 2) + " [" + fmtNum(pooledLo, 2) + ", " + fmtNum(pooledHi, 2) + "]";
      svg.push('  <text x="' + colEffectX + '" y="' + (summaryY + 4) + '" class="rf-text rf-mono rf-bold">' + esc(poolStr) + '</text>');
      svg.push('  <text x="' + colWeightX + '" y="' + (summaryY + 4) + '" class="rf-text rf-mono rf-bold" text-anchor="end">100.0%</text>');

      var dLeft = xCoord(pooledLo);
      var dRight = xCoord(pooledHi);
      var dCenter = xCoord(pooledPt);
      var dTop = summaryY - 7;
      var dBottom = summaryY + 7;
      var diamondPoints = dLeft + "," + summaryY + " " + dCenter + "," + dTop + " " + dRight + "," + summaryY + " " + dCenter + "," + dBottom;
      svg.push('  <polygon points="' + diamondPoints + '" class="rf-diamond" />');
    }

    // Prediction interval bar (if present)
    var curY = summaryY;
    if (hasPI) {
      curY += 22;
      var pBarX1 = xCoord(predLo);
      var pBarX2 = xCoord(predHi);
      svg.push('  <text x="' + colStudyX + '" y="' + (curY + 4) + '" class="rf-text" fill="' + colors.piBar + '">Prediction Interval</text>');
      var piText = "[" + fmtNum(predLo, 2) + ", " + fmtNum(predHi, 2) + "]";
      svg.push('  <text x="' + colEffectX + '" y="' + (curY + 4) + '" class="rf-text rf-mono" fill="' + colors.piBar + '">' + esc(piText) + '</text>');
      svg.push('  <line x1="' + pBarX1 + '" y1="' + curY + '" x2="' + pBarX2 + '" y2="' + curY + '" class="rf-pibar" />');
      svg.push('  <line x1="' + pBarX1 + '" y1="' + (curY - 4) + '" x2="' + pBarX1 + '" y2="' + (curY + 4) + '" stroke="' + colors.piBar + '" stroke-width="2" />');
      svg.push('  <line x1="' + pBarX2 + '" y1="' + (curY - 4) + '" x2="' + pBarX2 + '" y2="' + (curY + 4) + '" stroke="' + colors.piBar + '" stroke-width="2" />');
    }

    // X-Axis line and ticks
    var axisY = curY + 26;
    svg.push('  <line x1="' + plotLeft + '" y1="' + axisY + '" x2="' + plotRight + '" y2="' + axisY + '" class="rf-axis-line" />');

    var ticks = [];
    if (isRatio) {
      var candidateTicks = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0];
      for (var t = 0; t < candidateTicks.length; t++) {
        var tickVal = candidateTicks[t];
        if (tickVal >= minVal * 0.96 && tickVal <= maxVal * 1.04) {
          ticks.push(tickVal);
        }
      }
    } else {
      var range = maxVal - minVal;
      var step = range / 5;
      for (var sVal = minVal; sVal <= maxVal + 1e-9; sVal += step) {
        ticks.push(sVal);
      }
    }

    for (var u = 0; u < ticks.length; u++) {
      var tv = ticks[u];
      var tx = xCoord(tv);
      svg.push('  <line x1="' + tx + '" y1="' + axisY + '" x2="' + tx + '" y2="' + (axisY + 4) + '" class="rf-axis-line" />');
      var tickLabel = isRatio ? (tv >= 1 ? tv.toFixed(0) : (tv >= 0.1 ? tv.toFixed(1) : tv.toFixed(2))) : tv.toFixed(1);
      svg.push('  <text x="' + tx + '" y="' + (axisY + 16) + '" class="rf-text rf-mono" text-anchor="middle" font-size="10.5">' + esc(tickLabel) + '</text>');
    }

    // Directional labels below axis
    var favorsLeft = (opts.labels && opts.labels.favorsLeft) || opts.favorsLeft || "Favors Intervention";
    var favorsRight = (opts.labels && opts.labels.favorsRight) || opts.favorsRight || "Favors Control";
    svg.push('  <text x="' + (plotLeft + 10) + '" y="' + (axisY + 34) + '" class="rf-text" font-size="10.5" fill="' + colors.muted + '">&larr; ' + esc(favorsLeft) + '</text>');
    svg.push('  <text x="' + (plotRight - 10) + '" y="' + (axisY + 34) + '" class="rf-text" font-size="10.5" fill="' + colors.muted + '" text-anchor="end">' + esc(favorsRight) + ' &rarr;</text>');

    // Heterogeneity details
    if (hasHet) {
      var het = run.heterogeneity;
      var hetY = axisY + 48;
      var hetParts = [];
      if (het.tau2 != null) hetParts.push("Tau2 = " + fmtNum(het.tau2, 3));
      if (het.q != null) hetParts.push("Q = " + fmtNum(het.q, 2) + " (p = " + fmtNum(het.p, 3) + ")");
      if (het.i2 != null) hetParts.push("I2 = " + fmtNum(het.i2, 1) + "%");
      var hetStr = "Heterogeneity: " + hetParts.join(", ");
      svg.push('  <text x="' + colStudyX + '" y="' + hetY + '" class="rf-text" font-size="11" fill="' + colors.muted + '">' + esc(hetStr) + '</text>');
    }

    svg.push('</svg>');
    return svg.join("\n");
  }

  /* =========================================================================
   * 2. FUNNEL PLOT: funnelSvg(funnelData, opts)
   * ========================================================================= */

  function funnelSvg(funnelData, opts) {
    funnelData = funnelData || {};
    opts = opts || {};

    var themeName = opts.theme === "dark" ? "dark" : "light";
    var isDark = themeName === "dark";

    var colors = isDark ? {
      bg: opts.transparentBg ? "none" : "#0f172a",
      text: "#f1f5f9",
      muted: "#94a3b8",
      line: "#334155",
      axis: "#64748b",
      feLine: "#2dd4bf",
      limitLine: "#94a3b8",
      coneFill: "rgba(45, 212, 191, 0.08)",
      pointFill: "#14b8a6",
      pointStroke: "#f1f5f9"
    } : {
      bg: opts.transparentBg ? "none" : "#ffffff",
      text: "#12202a",
      muted: "#64748b",
      line: "#e2e8f0",
      axis: "#475569",
      feLine: "#111c44",
      limitLine: "#64748b",
      coneFill: "rgba(15, 118, 110, 0.07)",
      pointFill: "#111c44",
      pointStroke: "#ffffff"
    };

    var width = opts.width || 640;
    var height = opts.height || 480;

    var marginLeft = 65;
    var marginRight = 35;
    var marginTop = 45;
    var marginBottom = 55;
    var plotWidth = width - marginLeft - marginRight;
    var plotHeight = height - marginTop - marginBottom;

    var points = funnelData.points || [];
    var fe = funnelData.fe || { effect: 0, se: 0 };
    var limits = funnelData.limits || {};
    var theta = fe.effect != null ? fe.effect : 0;
    var z = limits.z || 1.959964;

    var seMax = limits.seTo || 0;
    var i, pt;
    for (i = 0; i < points.length; i++) {
      pt = points[i];
      if (pt.se != null && pt.se > seMax) seMax = pt.se;
    }
    if (!(seMax > 0)) seMax = 1.0;

    // Determine horizontal bounds centered symmetrically on theta
    var minYi = theta, maxYi = theta;
    for (i = 0; i < points.length; i++) {
      pt = points[i];
      if (pt.yi != null && isFinite(pt.yi)) {
        if (pt.yi < minYi) minYi = pt.yi;
        if (pt.yi > maxYi) maxYi = pt.yi;
      }
    }

    var coneLeft = theta - z * seMax;
    var coneRight = theta + z * seMax;
    if (coneLeft < minYi) minYi = coneLeft;
    if (coneRight > maxYi) maxYi = coneRight;

    var spread = Math.max(Math.abs(theta - minYi), Math.abs(maxYi - theta));
    spread = Math.max(spread * 1.15, 0.4);
    var xMin = theta - spread;
    var xMax = theta + spread;

    function xCoord(yi) {
      if (yi == null || !isFinite(yi)) return marginLeft + plotWidth / 2;
      return marginLeft + ((yi - xMin) / (xMax - xMin)) * plotWidth;
    }

    // Inverted Y-axis: se = 0 at top, seMax at bottom
    function yCoord(se) {
      if (se == null || !isFinite(se)) return marginTop;
      var clamped = Math.max(0, Math.min(seMax, se));
      return marginTop + (clamped / seMax) * plotHeight;
    }

    var svg = [];
    svg.push('<svg class="smd-funnel-svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg">');
    svg.push('  <!-- 300-dpi equivalent publication vector graphic -->');
    svg.push('  <style>');
    svg.push('    .fn-bg { fill: ' + colors.bg + '; }');
    svg.push('    .fn-text { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; fill: ' + colors.text + '; }');
    svg.push('    .fn-axis { stroke: ' + colors.axis + '; stroke-width: 1.2; }');
    svg.push('    .fn-grid { stroke: ' + colors.line + '; stroke-width: 1; stroke-dasharray: 2,3; }');
    svg.push('    .fn-fe { stroke: ' + colors.feLine + '; stroke-width: 1.8; stroke-dasharray: 4,3; }');
    svg.push('    .fn-limit { stroke: ' + colors.limitLine + '; stroke-width: 1.5; stroke-dasharray: 3,3; }');
    svg.push('    .fn-point { fill: ' + colors.pointFill + '; stroke: ' + colors.pointStroke + '; stroke-width: 1.5; }');
    svg.push('  </style>');

    if (colors.bg !== "none") {
      svg.push('  <rect width="100%" height="100%" class="fn-bg" />');
    }

    // Title
    var title = opts.title || "Funnel Plot of Pseudo-95% Confidence Limits";
    svg.push('  <text x="' + (width / 2) + '" y="24" class="fn-text" font-weight="600" font-size="13.5" text-anchor="middle">' + esc(title) + '</text>');

    // Pseudo-95% confidence cone polygon
    var topX = xCoord(theta);
    var topY = yCoord(0);
    var botLeftX = xCoord(coneLeft);
    var botRightX = xCoord(coneRight);
    var botY = yCoord(seMax);

    var conePts = topX + "," + topY + " " + botLeftX + "," + botY + " " + botRightX + "," + botY;
    svg.push('  <polygon points="' + conePts + '" fill="' + colors.coneFill + '" />');

    // Pseudo-95% limits lines
    svg.push('  <line x1="' + topX + '" y1="' + topY + '" x2="' + botLeftX + '" y2="' + botY + '" class="fn-limit" />');
    svg.push('  <line x1="' + topX + '" y1="' + topY + '" x2="' + botRightX + '" y2="' + botY + '" class="fn-limit" />');

    // Fixed Effect reference line
    svg.push('  <line x1="' + topX + '" y1="' + topY + '" x2="' + topX + '" y2="' + botY + '" class="fn-fe" />');

    // Plot Points
    for (var k = 0; k < points.length; k++) {
      var p = points[k];
      if (p.yi != null && isFinite(p.yi) && p.se != null && isFinite(p.se)) {
        var px = xCoord(p.yi);
        var py = yCoord(p.se);
        var tipText = (p.id || ("Study " + (k + 1))) + " (effect=" + fmtNum(p.yi, 2) + ", se=" + fmtNum(p.se, 2) + ")";
        svg.push('  <circle cx="' + px + '" cy="' + py + '" r="5" class="fn-point"><title>' + esc(tipText) + '</title></circle>');
      }
    }

    // Axes
    // X-Axis line at bottom
    svg.push('  <line x1="' + marginLeft + '" y1="' + botY + '" x2="' + (marginLeft + plotWidth) + '" y2="' + botY + '" class="fn-axis" />');
    // Y-Axis line at left
    svg.push('  <line x1="' + marginLeft + '" y1="' + topY + '" x2="' + marginLeft + '" y2="' + botY + '" class="fn-axis" />');

    // X-Axis Ticks (5 intervals)
    var xStep = (xMax - xMin) / 4;
    for (var xi = 0; xi <= 4; xi++) {
      var xVal = xMin + xi * xStep;
      var curX = xCoord(xVal);
      svg.push('  <line x1="' + curX + '" y1="' + botY + '" x2="' + curX + '" y2="' + (botY + 5) + '" class="fn-axis" />');
      svg.push('  <text x="' + curX + '" y="' + (botY + 18) + '" class="fn-text" font-size="11" text-anchor="middle">' + fmtNum(xVal, 2) + '</text>');
    }

    // Y-Axis Ticks (4 intervals: 0 at top, increasing downwards)
    var yStep = seMax / 4;
    for (var yi = 0; yi <= 4; yi++) {
      var yVal = yi * yStep;
      var curY = yCoord(yVal);
      svg.push('  <line x1="' + (marginLeft - 5) + '" y1="' + curY + '" x2="' + marginLeft + '" y2="' + curY + '" class="fn-axis" />');
      svg.push('  <text x="' + (marginLeft - 8) + '" y="' + (curY + 4) + '" class="fn-text" font-size="11" text-anchor="end">' + fmtNum(yVal, 2) + '</text>');
    }

    // Axis Labels
    var xLabel = opts.xLabel || "Effect Estimate";
    var yLabel = opts.yLabel || "Standard Error";
    svg.push('  <text x="' + (marginLeft + plotWidth / 2) + '" y="' + (height - 14) + '" class="fn-text" font-weight="600" font-size="12" text-anchor="middle">' + esc(xLabel) + '</text>');

    var rotY = marginTop + plotHeight / 2;
    svg.push('  <text x="' + 18 + '" y="' + rotY + '" class="fn-text" font-weight="600" font-size="12" text-anchor="middle" transform="rotate(-90 18 ' + rotY + ')">' + esc(yLabel) + '</text>');

    svg.push('</svg>');
    return svg.join("\n");
  }

  /* =========================================================================
   * 3. RISK OF BIAS: robTrafficLightSvg and robSummarySvg
   * ========================================================================= */

  var ROB_TOOL_DEFS = {
    rob2: {
      id: "rob2",
      name: "RoB 2",
      domains: [
        { key: "d1", label: "Randomisation process", short: "D1" },
        { key: "d2", label: "Deviations from intended interventions", short: "D2" },
        { key: "d3", label: "Missing outcome data", short: "D3" },
        { key: "d4", label: "Measurement of the outcome", short: "D4" },
        { key: "d5", label: "Selection of the reported result", short: "D5" }
      ],
      overallKey: "overall",
      overallLabel: "Overall risk of bias"
    },
    robins_i: {
      id: "robins_i",
      name: "ROBINS-I",
      domains: [
        { key: "d1", label: "Confounding", short: "D1" },
        { key: "d2", label: "Selection of participants", short: "D2" },
        { key: "d3", label: "Classification of interventions", short: "D3" },
        { key: "d4", label: "Deviations from intended interventions", short: "D4" },
        { key: "d5", label: "Missing data", short: "D5" },
        { key: "d6", label: "Measurement of outcomes", short: "D6" },
        { key: "d7", label: "Selection of the reported result", short: "D7" }
      ],
      overallKey: "overall",
      overallLabel: "Overall risk of bias"
    },
    quadas2: {
      id: "quadas2",
      name: "QUADAS-2",
      domains: [
        { key: "patient_selection", label: "Patient selection", short: "D1" },
        { key: "index_test", label: "Index test", short: "D2" },
        { key: "reference_standard", label: "Reference standard", short: "D3" },
        { key: "flow_timing", label: "Flow and timing", short: "D4" }
      ],
      overallKey: "overall",
      overallLabel: "Overall risk of bias"
    }
  };

  /* Colour-blind safe Okabe-Ito / Cochrane palette and distinct symbols */
  var JUDGMENT_MAP = {
    low: { key: "low", label: "Low risk of bias", color: "#009E73", symbol: "+", textColor: "#ffffff" },
    some_concerns: { key: "some_concerns", label: "Some concerns", color: "#E69F00", symbol: "?", textColor: "#ffffff" },
    moderate: { key: "moderate", label: "Moderate", color: "#E69F00", symbol: "?", textColor: "#ffffff" },
    unclear: { key: "unclear", label: "Unclear", color: "#E69F00", symbol: "?", textColor: "#ffffff" },
    high: { key: "high", label: "High risk of bias", color: "#D55E00", symbol: "-", textColor: "#ffffff" },
    serious: { key: "serious", label: "Serious", color: "#D55E00", symbol: "-", textColor: "#ffffff" },
    critical: { key: "critical", label: "Critical", color: "#D55E00", symbol: "-", textColor: "#ffffff" },
    no_information: { key: "no_information", label: "No information", color: "#56B4E9", symbol: "!", textColor: "#ffffff" },
    unknown: { key: "no_information", label: "No information", color: "#56B4E9", symbol: "!", textColor: "#ffffff" }
  };

  function getJudgmentSpec(raw) {
    if (!raw) return JUDGMENT_MAP.no_information;
    var norm = String(raw).toLowerCase().replace(/[\s-]+/g, "_");
    return JUDGMENT_MAP[norm] || JUDGMENT_MAP.no_information;
  }

  function resolveTool(tool) {
    if (typeof tool === "string") {
      return ROB_TOOL_DEFS[tool] || ROB_TOOL_DEFS.rob2;
    }
    if (tool && tool.domains) {
      return tool;
    }
    return ROB_TOOL_DEFS.rob2;
  }

  function normalizeAssessments(assessments, toolDef) {
    var list = [];
    if (!assessments) return list;
    if (Array.isArray(assessments)) {
      list = assessments;
    } else if (assessments.assessments && Array.isArray(assessments.assessments)) {
      list = assessments.assessments;
    } else if (typeof assessments === "object") {
      for (var k in assessments) {
        if (Object.prototype.hasOwnProperty.call(assessments, k)) {
          var item = assessments[k] || {};
          if (!item.id && !item.studyId) item.studyId = k;
          list.push(item);
        }
      }
    }

    var result = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var studyLabel = a.studyLabel || a.label || a.study || a.studyId || a.id || ("Study " + (i + 1));
      var domainMap = {};

      var dSource = null;
      if (a.consensus && a.consensus.domains) dSource = a.consensus.domains;
      else if (a.self && a.self.domains) dSource = a.self.domains;
      else if (a.domains) dSource = a.domains;

      if (Array.isArray(dSource)) {
        for (var d = 0; d < dSource.length; d++) {
          var entry = dSource[d];
          if (entry && entry.key) {
            domainMap[entry.key] = entry.judgment || entry.value;
          }
        }
      } else if (dSource && typeof dSource === "object") {
        for (var dk in dSource) {
          if (Object.prototype.hasOwnProperty.call(dSource, dk)) {
            domainMap[dk] = dSource[dk];
          }
        }
      }

      var overallVal = (a.consensus && a.consensus.overall) || a.overall || (a.self && a.self.overall);
      if (!overallVal) {
        // Compute overall from domain map if missing
        var highFound = false;
        var concernsCount = 0;
        for (var domIdx = 0; domIdx < toolDef.domains.length; domIdx++) {
          var jKey = domainMap[toolDef.domains[domIdx].key];
          var spec = getJudgmentSpec(jKey);
          if (spec.key === "high" || spec.key === "serious" || spec.key === "critical") highFound = true;
          if (spec.key === "some_concerns" || spec.key === "moderate") concernsCount++;
        }
        if (highFound || concernsCount >= 2) overallVal = "high";
        else if (concernsCount === 1) overallVal = "some_concerns";
        else overallVal = "low";
      }

      result.push({
        studyId: a.studyId || a.id || ("s" + (i + 1)),
        label: studyLabel,
        weight: a.weight != null ? Number(a.weight) : 1,
        domains: domainMap,
        overall: overallVal
      });
    }
    return result;
  }

  /* 3A. Traffic-light grid: robTrafficLightSvg(assessments, tool, opts) */
  function robTrafficLightSvg(assessments, tool, opts) {
    opts = opts || {};
    var toolDef = resolveTool(tool);
    var studies = normalizeAssessments(assessments, toolDef);

    var themeName = opts.theme === "dark" ? "dark" : "light";
    var isDark = themeName === "dark";

    var colors = isDark ? {
      bg: opts.transparentBg ? "none" : "#0f172a",
      text: "#f1f5f9",
      muted: "#94a3b8",
      line: "#334155",
      headerBg: "#1e293b",
      altRow: "#16222f"
    } : {
      bg: opts.transparentBg ? "none" : "#ffffff",
      text: "#12202a",
      muted: "#64748b",
      line: "#e2e8f0",
      headerBg: "#f8fafc",
      altRow: "#fcfdfe"
    };

    var colStudyWidth = opts.colStudyWidth || 190;
    var colDomainWidth = opts.colDomainWidth || 42;
    var rowHeight = opts.rowHeight || 34;
    var headerHeight = 50;

    var numCols = toolDef.domains.length + 1; // domains + overall
    var totalWidth = opts.width || Math.max(520, colStudyWidth + (numCols * colDomainWidth) + 30);

    var legendHeight = 110 + (toolDef.domains.length * 16);
    var gridHeight = headerHeight + (studies.length * rowHeight);
    var totalHeight = opts.height || (gridHeight + legendHeight + 25);

    var svg = [];
    svg.push('<svg class="smd-rob-traffic-svg" viewBox="0 0 ' + totalWidth + ' ' + totalHeight + '" width="' + totalWidth + '" height="' + totalHeight + '" xmlns="http://www.w3.org/2000/svg">');
    svg.push('  <!-- 300-dpi equivalent publication vector graphic -->');
    svg.push('  <style>');
    svg.push('    .rt-bg { fill: ' + colors.bg + '; }');
    svg.push('    .rt-text { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; fill: ' + colors.text + '; }');
    svg.push('    .rt-hdr { font-weight: 600; font-size: 11.5px; fill: ' + colors.muted + '; }');
    svg.push('    .rt-bold { font-weight: 600; }');
    svg.push('    .rt-line { stroke: ' + colors.line + '; stroke-width: 1; }');
    svg.push('  </style>');

    if (colors.bg !== "none") {
      svg.push('  <rect width="100%" height="100%" class="rt-bg" />');
    }

    // Header Background
    svg.push('  <rect x="15" y="10" width="' + (totalWidth - 30) + '" height="' + (headerHeight - 10) + '" fill="' + colors.headerBg + '" rx="3" />');
    svg.push('  <text x="25" y="34" class="rt-hdr">Study</text>');

    // Domain Column Headers
    var c;
    for (c = 0; c < toolDef.domains.length; c++) {
      var d = toolDef.domains[c];
      var cx = colStudyWidth + (c * colDomainWidth) + (colDomainWidth / 2);
      var shortLabel = d.short || ("D" + (c + 1));
      svg.push('  <text x="' + cx + '" y="34" class="rt-hdr" text-anchor="middle">' + esc(shortLabel) + '</text>');
    }
    // Overall Column Header
    var ovX = colStudyWidth + (toolDef.domains.length * colDomainWidth) + (colDomainWidth / 2);
    svg.push('  <text x="' + ovX + '" y="34" class="rt-hdr" text-anchor="middle">Overall</text>');
    svg.push('  <line x1="15" y1="' + headerHeight + '" x2="' + (totalWidth - 15) + '" y2="' + headerHeight + '" class="rt-line" />');

    // Study Rows
    for (var r = 0; r < studies.length; r++) {
      var study = studies[r];
      var rowY = headerHeight + (r * rowHeight);

      if (r % 2 === 1) {
        svg.push('  <rect x="15" y="' + rowY + '" width="' + (totalWidth - 30) + '" height="' + rowHeight + '" fill="' + colors.altRow + '" />');
      }

      svg.push('  <text x="25" y="' + (rowY + rowHeight / 2 + 4) + '" class="rt-text rt-bold">' + esc(study.label) + '</text>');

      // Domain Circles
      for (c = 0; c < toolDef.domains.length; c++) {
        var dKey = toolDef.domains[c].key;
        var rawJ = study.domains[dKey];
        var spec = getJudgmentSpec(rawJ);
        var cellX = colStudyWidth + (c * colDomainWidth) + (colDomainWidth / 2);
        var cellY = rowY + (rowHeight / 2);

        svg.push('  <circle cx="' + cellX + '" cy="' + cellY + '" r="10.5" fill="' + spec.color + '" />');
        svg.push('  <text x="' + cellX + '" y="' + (cellY + 4) + '" text-anchor="middle" font-weight="bold" font-size="12" fill="' + spec.textColor + '">' + esc(spec.symbol) + '</text>');
      }

      // Overall Circle
      var ovSpec = getJudgmentSpec(study.overall);
      var ovCellX = colStudyWidth + (toolDef.domains.length * colDomainWidth) + (colDomainWidth / 2);
      var ovCellY = rowY + (rowHeight / 2);
      svg.push('  <circle cx="' + ovCellX + '" cy="' + ovCellY + '" r="10.5" fill="' + ovSpec.color + '" />');
      svg.push('  <text x="' + ovCellX + '" y="' + (ovCellY + 4) + '" text-anchor="middle" font-weight="bold" font-size="12" fill="' + ovSpec.textColor + '">' + esc(ovSpec.symbol) + '</text>');

      svg.push('  <line x1="15" y1="' + (rowY + rowHeight) + '" x2="' + (totalWidth - 15) + '" y2="' + (rowY + rowHeight) + '" class="rt-line" />');
    }

    // Legend
    var legY = gridHeight + 20;
    svg.push('  <line x1="15" y1="' + (legY - 8) + '" x2="' + (totalWidth - 15) + '" y2="' + (legY - 8) + '" class="rt-line" stroke-width="1.2" />');
    svg.push('  <text x="25" y="' + legY + '" class="rt-text rt-bold">Domains:</text>');

    var domY = legY + 16;
    for (c = 0; c < toolDef.domains.length; c++) {
      var dom = toolDef.domains[c];
      var sLbl = dom.short || ("D" + (c + 1));
      svg.push('  <text x="25" y="' + domY + '" class="rt-text" font-size="11"><tspan font-weight="600">' + esc(sLbl) + ':</tspan> ' + esc(dom.label) + '</text>');
      domY += 16;
    }

    // Judgments Key
    domY += 10;
    svg.push('  <text x="25" y="' + domY + '" class="rt-text rt-bold">Judgments:</text>');
    domY += 16;

    var keyItems = [
      { spec: JUDGMENT_MAP.low, text: "Low risk of bias" },
      { spec: JUDGMENT_MAP.some_concerns, text: "Some concerns" },
      { spec: JUDGMENT_MAP.high, text: "High risk of bias" },
      { spec: JUDGMENT_MAP.no_information, text: "No information" }
    ];

    var itemX = 25;
    for (var k = 0; k < keyItems.length; k++) {
      var item = keyItems[k];
      svg.push('  <circle cx="' + (itemX + 6) + '" cy="' + (domY - 4) + '" r="6.5" fill="' + item.spec.color + '" />');
      svg.push('  <text x="' + (itemX + 6) + '" y="' + (domY - 1) + '" text-anchor="middle" font-weight="bold" font-size="8.5" fill="' + item.spec.textColor + '">' + esc(item.spec.symbol) + '</text>');
      svg.push('  <text x="' + (itemX + 18) + '" y="' + domY + '" class="rt-text" font-size="11">' + esc(item.text) + '</text>');
      itemX += 135;
    }

    svg.push('</svg>');
    return svg.join("\n");
  }

  /* 3B. Summary bars: robSummarySvg(assessments, tool, opts) */
  function robSummarySvg(assessments, tool, opts) {
    opts = opts || {};
    var toolDef = resolveTool(tool);
    var studies = normalizeAssessments(assessments, toolDef);

    var themeName = opts.theme === "dark" ? "dark" : "light";
    var isDark = themeName === "dark";

    var colors = isDark ? {
      bg: opts.transparentBg ? "none" : "#0f172a",
      text: "#f1f5f9",
      muted: "#94a3b8",
      line: "#334155",
      axis: "#64748b"
    } : {
      bg: opts.transparentBg ? "none" : "#ffffff",
      text: "#12202a",
      muted: "#64748b",
      line: "#e2e8f0",
      axis: "#475569"
    };

    var width = opts.width || 720;
    var rowHeight = opts.rowHeight || 38;
    var labelWidth = opts.labelWidth || 220;
    var barWidth = width - labelWidth - 60;
    var topPadding = 45;

    var allDomains = [];
    for (var d = 0; d < toolDef.domains.length; d++) {
      allDomains.push({ key: toolDef.domains[d].key, label: toolDef.domains[d].label });
    }
    allDomains.push({ key: "overall", label: toolDef.overallLabel || "Overall risk of bias" });

    var totalHeight = opts.height || (topPadding + (allDomains.length * rowHeight) + 85);

    var svg = [];
    svg.push('<svg class="smd-rob-summary-svg" viewBox="0 0 ' + width + ' ' + totalHeight + '" width="' + width + '" height="' + totalHeight + '" xmlns="http://www.w3.org/2000/svg">');
    svg.push('  <!-- 300-dpi equivalent publication vector graphic -->');
    svg.push('  <style>');
    svg.push('    .rs-bg { fill: ' + colors.bg + '; }');
    svg.push('    .rs-text { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; fill: ' + colors.text + '; }');
    svg.push('    .rs-bold { font-weight: 600; }');
    svg.push('    .rs-axis { stroke: ' + colors.axis + '; stroke-width: 1.2; }');
    svg.push('    .rs-grid { stroke: ' + colors.line + '; stroke-width: 1; stroke-dasharray: 2,3; }');
    svg.push('  </style>');

    if (colors.bg !== "none") {
      svg.push('  <rect width="100%" height="100%" class="rs-bg" />');
    }

    // Title
    var title = opts.title || "Risk of Bias Summary";
    svg.push('  <text x="' + (width / 2) + '" y="24" class="rs-text rs-bold" font-size="14" text-anchor="middle">' + esc(title) + '</text>');

    var barStartX = labelWidth + 20;

    // Render each domain's stacked bar
    for (var i = 0; i < allDomains.length; i++) {
      var dom = allDomains[i];
      var y = topPadding + (i * rowHeight);

      // Domain label
      svg.push('  <text x="' + (barStartX - 10) + '" y="' + (y + 16) + '" class="rs-text" text-anchor="end" font-size="11.5">' + esc(dom.label) + '</text>');

      // Calculate totals per judgment category
      var wLow = 0, wSome = 0, wHigh = 0, wNoInfo = 0, wTotal = 0;
      for (var s = 0; s < studies.length; s++) {
        var study = studies[s];
        var weight = study.weight || 1;
        var jVal = (dom.key === "overall") ? study.overall : study.domains[dom.key];
        var spec = getJudgmentSpec(jVal);

        if (spec.key === "low") wLow += weight;
        else if (spec.key === "some_concerns" || spec.key === "moderate" || spec.key === "unclear") wSome += weight;
        else if (spec.key === "high" || spec.key === "serious" || spec.key === "critical") wHigh += weight;
        else wNoInfo += weight;
        wTotal += weight;
      }
      if (wTotal <= 0) wTotal = 1;

      var pLow = wLow / wTotal;
      var pSome = wSome / wTotal;
      var pHigh = wHigh / wTotal;
      var pNoInfo = wNoInfo / wTotal;

      var segments = [
        { pct: pLow, color: JUDGMENT_MAP.low.color, textColor: "#ffffff" },
        { pct: pSome, color: JUDGMENT_MAP.some_concerns.color, textColor: "#ffffff" },
        { pct: pHigh, color: JUDGMENT_MAP.high.color, textColor: "#ffffff" },
        { pct: pNoInfo, color: JUDGMENT_MAP.no_information.color, textColor: "#ffffff" }
      ];

      var curX = barStartX;
      var bH = 22;
      for (var segIdx = 0; segIdx < segments.length; segIdx++) {
        var seg = segments[segIdx];
        if (seg.pct > 0) {
          var segW = seg.pct * barWidth;
          svg.push('  <rect x="' + curX + '" y="' + y + '" width="' + segW + '" height="' + bH + '" fill="' + seg.color + '" />');
          if (segW >= 24) {
            var pctText = (seg.pct * 100).toFixed(0) + "%";
            svg.push('  <text x="' + (curX + segW / 2) + '" y="' + (y + 15) + '" text-anchor="middle" font-size="10.5" font-weight="600" fill="' + seg.textColor + '">' + pctText + '</text>');
          }
          curX += segW;
        }
      }
    }

    // X-Axis at bottom of bars
    var axisY = topPadding + (allDomains.length * rowHeight) + 4;
    svg.push('  <line x1="' + barStartX + '" y1="' + axisY + '" x2="' + (barStartX + barWidth) + '" y2="' + axisY + '" class="rs-axis" />');

    // Ticks at 0%, 25%, 50%, 75%, 100%
    var pTicks = [0, 0.25, 0.5, 0.75, 1.0];
    for (var ti = 0; ti < pTicks.length; ti++) {
      var ptVal = pTicks[ti];
      var tx = barStartX + ptVal * barWidth;
      svg.push('  <line x1="' + tx + '" y1="' + axisY + '" x2="' + tx + '" y2="' + (axisY + 4) + '" class="rs-axis" />');
      svg.push('  <text x="' + tx + '" y="' + (axisY + 16) + '" class="rs-text" font-size="10.5" text-anchor="middle">' + (ptVal * 100).toFixed(0) + '%</text>');
    }

    // Legend at bottom
    var legY = axisY + 36;
    var keyItems = [
      { color: JUDGMENT_MAP.low.color, text: "Low risk of bias" },
      { color: JUDGMENT_MAP.some_concerns.color, text: "Some concerns" },
      { color: JUDGMENT_MAP.high.color, text: "High risk of bias" },
      { color: JUDGMENT_MAP.no_information.color, text: "No information" }
    ];

    var itemX = barStartX;
    for (var k = 0; k < keyItems.length; k++) {
      var item = keyItems[k];
      svg.push('  <rect x="' + itemX + '" y="' + (legY - 10) + '" width="' + 12 + '" height="' + 12 + '" fill="' + item.color + '" rx="2" />');
      svg.push('  <text x="' + (itemX + 18) + '" y="' + legY + '" class="rs-text" font-size="11">' + esc(item.text) + '</text>');
      itemX += 125;
    }

    svg.push('</svg>');
    return svg.join("\n");
  }

  /* =========================================================================
   * 4. CHARACTERISTICS TABLE: characteristicsTable(studies, fields)
   * ========================================================================= */

  /* RFC 4180 CSV cell escaping */
  function escapeCsvCell(val) {
    if (val == null) return "";
    var s = String(val);
    if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function characteristicsTable(studies, fields) {
    studies = studies || [];

    // Normalize columns
    var columns = [];
    if (fields && fields.length) {
      for (var f = 0; f < fields.length; f++) {
        var item = fields[f];
        if (typeof item === "string") {
          var lbl = item.charAt(0).toUpperCase() + item.slice(1);
          columns.push({ key: item, label: lbl });
        } else if (item && item.key) {
          columns.push({ key: item.key, label: item.label || item.key });
        }
      }
    } else {
      // Default standard characteristics fields
      columns = [
        { key: "study", label: "Study" },
        { key: "year", label: "Year" },
        { key: "design", label: "Design" },
        { key: "participants", label: "Participants" },
        { key: "intervention", label: "Intervention" },
        { key: "control", label: "Control" },
        { key: "outcome", label: "Outcome" }
      ];
    }

    // Normalize rows
    var rows = [];
    for (var i = 0; i < studies.length; i++) {
      var s = studies[i];
      var row = {};
      for (var c = 0; c < columns.length; c++) {
        var colKey = columns[c].key;
        var val = "";
        if (s[colKey] !== undefined && s[colKey] !== null) {
          val = s[colKey];
        } else if (s.inputs && s.inputs[colKey] !== undefined && s.inputs[colKey] !== null) {
          val = s.inputs[colKey];
        } else if (s.values && s.values[colKey] !== undefined && s.values[colKey] !== null) {
          val = s.values[colKey];
        } else if (colKey === "study") {
          val = s.label || s.name || s.id || ("Study " + (i + 1));
        }
        row[colKey] = val;
      }
      rows.push(row);
    }

    function toCsv() {
      var lines = [];
      // Header line
      var headerRow = [];
      for (var hc = 0; hc < columns.length; hc++) {
        headerRow.push(escapeCsvCell(columns[hc].label));
      }
      lines.push(headerRow.join(","));

      // Data lines
      for (var r = 0; r < rows.length; r++) {
        var dataRow = [];
        for (var dc = 0; dc < columns.length; dc++) {
          var k = columns[dc].key;
          dataRow.push(escapeCsvCell(rows[r][k]));
        }
        lines.push(dataRow.join(","));
      }
      return lines.join("\r\n");
    }

    return {
      columns: columns,
      rows: rows,
      toCsv: toCsv
    };
  }

  /* =========================================================================
   * EXPORTS
   * ========================================================================= */

  var PLOTS = {
    forestSvg: forestSvg,
    funnelSvg: funnelSvg,
    robTrafficLightSvg: robTrafficLightSvg,
    robSummarySvg: robSummarySvg,
    characteristicsTable: characteristicsTable
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PLOTS;
  }
  if (G) {
    G.SMD_RESEARCH_PLOTS = PLOTS;
  }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : undefined));
