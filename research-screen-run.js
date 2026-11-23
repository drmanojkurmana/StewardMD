/* StewardMD - ResearchMD Meta-Analysis & Forest Plot Screen (window.SMD_RESEARCH.screens.run).
 * ES5 only, buildless, mobile-first.
 * Runs meta-analysis via SMD_RESEARCH_ENGINE, renders inline SVG forest plot, and exports CSV + manifest.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var esc = (SMD.esc) || function (s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  var RATIO_MEASURES = { OR: 1, RR: 1, HR: 1 };

  // Current analysis settings
  var runSettings = {
    model: "random_dl", // "random_dl", "fixed", "random_reml"
    test: "wald",       // "wald", "knha"
    level: 0.95
  };

  function fmtNum(n, digits) {
    if (n == null || !isFinite(n)) return "N/A";
    var d = digits !== undefined ? digits : 2;
    return Number(n).toFixed(d);
  }

  function fmtP(p) {
    if (p == null || !isFinite(p)) return "N/A";
    if (p < 0.0001) return "< 0.0001";
    if (p < 0.001) return "< 0.001";
    return p.toFixed(4);
  }

  function renderRunScreen(container) {
    var store = SMD.store;
    var engine = G.SMD_RESEARCH_ENGINE;
    if (!store) return;
    var project = store.getActiveProject();
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><p>No project selected.</p></div>';
      return;
    }

    var allStudies = store.getStudies(project.id);
    var verifiedStudies = allStudies.filter(function (s) { return !!s.verified; });
    var unverifiedCount = allStudies.length - verifiedStudies.length;

    // Detect primary measure from studies or project
    var measure = "RR";
    if (verifiedStudies.length > 0 && verifiedStudies[0].measure) {
      measure = verifiedStudies[0].measure;
    }

    var activeResult = store.getActiveRunResult();

    var h = [];
    h.push('<div class="rmd-run-screen">');

    // Header & Actions
    h.push('  <div class="rmd-studies-topbar">');
    h.push('    <div class="rmd-topbar-left">');
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="to-studies">');
    h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"></polyline></svg>');
    h.push('        <span>Studies</span>');
    h.push('      </button>');
    h.push('      <div class="rmd-topbar-proj-info">');
    h.push('        <h2 class="rmd-topbar-proj-title">Meta-Analysis &amp; Forest Plot</h2>');
    h.push('        <span class="rmd-badge rmd-badge-pill">' + esc(project.title) + '</span>');
    h.push('      </div>');
    h.push('    </div>');

    if (activeResult) {
      h.push('    <div class="rmd-topbar-actions">');
      h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="export-csv">');
      h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>');
      h.push('        <span>Export CSV</span>');
      h.push('      </button>');
      h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="export-manifest">');
      h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>');
      h.push('        <span>Manifest JSON</span>');
      h.push('      </button>');
      h.push('    </div>');
    }
    h.push('  </div>');

    // Two-pane or top/bottom layout: Left/Top is Settings, Right/Bottom is Plot & Stats
    h.push('  <div class="rmd-run-layout">');

    // SETTINGS CARD
    h.push('    <div class="rmd-run-settings-panel">');
    h.push('      <div class="rmd-card">');
    h.push('        <h3 class="rmd-card-heading">Analysis Specification</h3>');
    h.push('        <form id="rmdRunConfigForm" class="rmd-form">');

    h.push('          <div class="rmd-field">');
    h.push('            <label for="rmd_run_measure">Effect Measure</label>');
    h.push('            <select id="rmd_run_measure">');
    var measures = ["RR", "OR", "HR", "RD", "MD", "SMD"];
    for (var m = 0; m < measures.length; m++) {
      h.push('              <option value="' + measures[m] + '"' + (measure === measures[m] ? ' selected' : '') + '>' + measures[m] + '</option>');
    }
    h.push('            </select>');
    h.push('          </div>');

    h.push('          <div class="rmd-field">');
    h.push('            <label for="rmd_run_model">Statistical Model</label>');
    h.push('            <select id="rmd_run_model">');
    h.push('              <option value="random_dl"' + (runSettings.model === 'random_dl' ? ' selected' : '') + '>Random Effects: DerSimonian-Laird (DL)</option>');
    h.push('              <option value="random_reml"' + (runSettings.model === 'random_reml' ? ' selected' : '') + '>Random Effects: REML (Fisher Scoring)</option>');
    h.push('              <option value="fixed"' + (runSettings.model === 'fixed' ? ' selected' : '') + '>Fixed Effect: Inverse Variance (FE)</option>');
    h.push('            </select>');
    h.push('          </div>');

    h.push('          <div class="rmd-field">');
    h.push('            <label for="rmd_run_test">Hypothesis Test / CI Method</label>');
    h.push('            <select id="rmd_run_test">');
    h.push('              <option value="wald"' + (runSettings.test === 'wald' ? ' selected' : '') + '>Wald Test (Standard Normal Z)</option>');
    h.push('              <option value="knha"' + (runSettings.test === 'knha' ? ' selected' : '') + '>Hartung-Knapp-Sidik-Jonkman (t-dist, HKSJ)</option>');
    h.push('            </select>');
    h.push('          </div>');

    h.push('          <div class="rmd-field">');
    h.push('            <label for="rmd_run_level">Confidence Level</label>');
    h.push('            <select id="rmd_run_level">');
    h.push('              <option value="0.95" selected>95% Confidence Interval (alpha = 0.05)</option>');
    h.push('              <option value="0.90">90% Confidence Interval (alpha = 0.10)</option>');
    h.push('              <option value="0.99">99% Confidence Interval (alpha = 0.01)</option>');
    h.push('            </select>');
    h.push('          </div>');

    // Studies Eligibility Callout
    h.push('          <div class="rmd-eligibility-box">');
    h.push('            <div class="rmd-elig-stat"><strong>' + verifiedStudies.length + '</strong> verified studies included</div>');
    if (unverifiedCount > 0) {
      h.push('            <div class="rmd-elig-warn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> ' + unverifiedCount + ' unverified study excluded per integrity rules.</div>');
    }
    h.push('          </div>');

    var canRun = verifiedStudies.length >= 2;
    h.push('          <button type="submit" class="rmd-btn rmd-btn-primary rmd-btn-block" data-rmd="calculate"' + (!canRun ? ' disabled' : '') + '>');
    h.push('            <span>Calculate Meta-Analysis</span>');
    h.push('          </button>');

    h.push('        </form>');
    h.push('      </div>'); // .rmd-card
    h.push('    </div>'); // .rmd-run-settings-panel

    // RESULTS & FOREST PLOT AREA
    h.push('    <div class="rmd-run-results-panel">');
    if (!activeResult) {
      h.push('      <div class="rmd-empty-state rmd-card">');
      h.push('        <div class="rmd-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg></div>');
      h.push('        <h3>Ready to Calculate</h3>');
      h.push('        <p>Select your model and click "Calculate Meta-Analysis" to pool studies and generate the forest plot.</p>');
      h.push('      </div>');
    } else {
      h.push(renderRunResultsHtml(activeResult, measure, verifiedStudies));
    }
    h.push('    </div>'); // .rmd-run-results-panel

    h.push('  </div>'); // .rmd-run-layout
    h.push('</div>'); // .rmd-run-screen

    container.innerHTML = h.join("\n");
    bindEvents(container, project, verifiedStudies);
  }

  function renderRunResultsHtml(activeResult, measure, verifiedStudies) {
    var result = activeResult.result;
    var manifest = activeResult.manifest;
    var isRatio = !!RATIO_MEASURES[measure];

    // Exponentiate pooled effect & CI if ratio measure
    var pooledEst = isRatio ? Math.exp(result.pooled.effect) : result.pooled.effect;
    var pooledLower = isRatio ? Math.exp(result.pooled.ciLower) : result.pooled.ciLower;
    var pooledUpper = isRatio ? Math.exp(result.pooled.ciUpper) : result.pooled.ciUpper;

    var h = [];

    // Top KPI Summary Cards
    h.push('<div class="rmd-results-wrap">');
    h.push('  <div class="rmd-kpi-grid">');

    // KPI 1: Pooled Effect
    h.push('    <div class="rmd-kpi-card rmd-kpi-highlight">');
    h.push('      <span class="rmd-kpi-lbl">Pooled ' + esc(measure) + ' (' + (manifest.model === 'fixed' ? 'Fixed Effect' : 'Random Effects') + ')</span>');
    h.push('      <div class="rmd-kpi-val">' + fmtNum(pooledEst, 3) + '</div>');
    h.push('      <div class="rmd-kpi-sub">95% CI [' + fmtNum(pooledLower, 3) + ' to ' + fmtNum(pooledUpper, 3) + ']</div>');
    h.push('    </div>');

    // KPI 2: Heterogeneity
    var het = result.heterogeneity || {};
    h.push('    <div class="rmd-kpi-card">');
    h.push('      <span class="rmd-kpi-lbl">Heterogeneity (I² &amp; tau²)</span>');
    h.push('      <div class="rmd-kpi-val">I² = ' + fmtNum(het.i2, 1) + '%</div>');
    h.push('      <div class="rmd-kpi-sub">tau² = ' + fmtNum(het.tau2, 4) + ' (' + esc(het.tau2Estimator || 'DL') + ')</div>');
    h.push('    </div>');

    // KPI 3: Statistical Significance
    h.push('    <div class="rmd-kpi-card">');
    h.push('      <span class="rmd-kpi-lbl">Test of Homogeneity</span>');
    h.push('      <div class="rmd-kpi-val">Q = ' + fmtNum(het.q, 2) + '</div>');
    h.push('      <div class="rmd-kpi-sub">df = ' + het.df + ', p ' + esc(fmtP(het.p)) + '</div>');
    h.push('    </div>');

    // KPI 4: Prediction Interval (if k >= 3)
    if (result.predictionInterval) {
      var pi = result.predictionInterval;
      var piLo = isRatio ? Math.exp(pi.lower) : pi.lower;
      var piHi = isRatio ? Math.exp(pi.upper) : pi.upper;
      h.push('    <div class="rmd-kpi-card">');
      h.push('      <span class="rmd-kpi-lbl">Prediction Interval (95%)</span>');
      h.push('      <div class="rmd-kpi-val">[' + fmtNum(piLo, 2) + ', ' + fmtNum(piHi, 2) + ']</div>');
      h.push('      <div class="rmd-kpi-sub">Future study expected range</div>');
      h.push('    </div>');
    }

    h.push('  </div>'); // .rmd-kpi-grid

    // Method Notices / Warnings
    if (result.notices && result.notices.length > 0) {
      h.push('  <div class="rmd-notices-box">');
      for (var n = 0; n < result.notices.length; n++) {
        h.push('    <div class="rmd-notice-item">');
        h.push('      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="12" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="8"></line></svg>');
        h.push('      <span>' + esc(result.notices[n]) + '</span>');
        h.push('    </div>');
      }
      h.push('  </div>');
    }

    // Forest Plot Card (Inline SVG)
    h.push('  <div class="rmd-card rmd-forest-card">');
    h.push('    <div class="rmd-forest-card-header">');
    h.push('      <h3 class="rmd-card-heading">Forest Plot</h3>');
    h.push('      <div class="rmd-forest-legend">');
    h.push('        <span class="rmd-legend-item"><span class="rmd-leg-box"></span> Study estimate (size ~ weight)</span>');
    h.push('        <span class="rmd-legend-item"><span class="rmd-leg-diamond"></span> Pooled summary</span>');
    h.push('      </div>');
    h.push('    </div>');

    // Inline SVG Forest Plot
    h.push('    <div class="rmd-svg-scroll-container">');
    h.push(generateForestPlotSvg(result, manifest, verifiedStudies));
    h.push('    </div>');

    h.push('  </div>'); // .rmd-forest-card
    h.push('</div>'); // .rmd-results-wrap

    return h.join("\n");
  }

  /* ==================== INLINE SVG FOREST PLOT ==================== */
  function generateForestPlotSvg(result, manifest, studies) {
    var engine = G.SMD_RESEARCH_ENGINE;
    var measure = manifest.measure;
    var isRatio = !!RATIO_MEASURES[measure];
    var weights = result.weights || [];

    // Calculate individual study effects for plotting
    var rows = [];
    for (var i = 0; i < studies.length; i++) {
      var s = studies[i];
      var eff = null;
      try {
        if (s.inputs && s.inputs.events1 !== undefined) {
          eff = engine.effectFromRaw(s.inputs, measure, manifest.level || 0.95);
        } else if (s.inputs && s.inputs.effect !== undefined) {
          eff = engine.effectFromCI(s.inputs, measure);
        } else if (s.inputs && s.inputs.yi !== undefined) {
          eff = engine.effectFromGeneric(s.inputs, measure, manifest.level || 0.95);
        }
      } catch (e) {
        eff = null;
      }
      rows.push({
        study: s,
        calc: eff,
        weight: weights[i] != null ? weights[i] : (100 / studies.length)
      });
    }

    // SVG Coordinate layout
    var rowHeight = 28;
    var topPadding = 50;
    var bottomPadding = 75;
    var totalHeight = topPadding + (rows.length * rowHeight) + bottomPadding;
    var totalWidth = 840;

    // Column positions
    var colStudyX = 15;
    var colDataX = 185;
    var colEffectX = 310;
    var plotLeft = 400;
    var plotRight = 720;
    var plotWidth = plotRight - plotLeft;
    var colWeightX = 770;

    // X-Axis range determination
    var minVal = Infinity, maxVal = -Infinity;
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (r.calc && !r.calc.excluded) {
        var lo = isRatio ? Math.exp(r.calc.ciLower) : r.calc.ciLower;
        var hi = isRatio ? Math.exp(r.calc.ciUpper) : r.calc.ciUpper;
        var pt = isRatio ? Math.exp(r.calc.yi) : r.calc.yi;
        if (lo < minVal) minVal = lo;
        if (hi > maxVal) maxVal = hi;
        if (pt < minVal) minVal = pt;
        if (pt > maxVal) maxVal = pt;
      }
    }

    var pooledPt = isRatio ? Math.exp(result.pooled.effect) : result.pooled.effect;
    var pooledLo = isRatio ? Math.exp(result.pooled.ciLower) : result.pooled.ciLower;
    var pooledHi = isRatio ? Math.exp(result.pooled.ciUpper) : result.pooled.ciUpper;
    if (pooledLo < minVal) minVal = pooledLo;
    if (pooledHi > maxVal) maxVal = pooledHi;

    // Default bounds with padding
    if (isRatio) {
      if (minVal > 0.1) minVal = 0.1;
      if (maxVal < 10) maxVal = 10;
      minVal = Math.max(0.05, minVal * 0.7);
      maxVal = Math.min(20, maxVal * 1.4);
    } else {
      if (minVal > -1) minVal = -1;
      if (maxVal < 1) maxVal = 1;
      var pad = (maxVal - minVal) * 0.15;
      minVal -= pad;
      maxVal += pad;
    }

    // Coordinate mapping functions
    function xCoord(val) {
      if (val == null || !isFinite(val)) return plotLeft + plotWidth / 2;
      var t;
      if (isRatio) {
        var safeVal = Math.max(minVal, Math.min(maxVal, val));
        t = (Math.log(safeVal) - Math.log(minVal)) / (Math.log(maxVal) - Math.log(minVal));
      } else {
        var safeVal2 = Math.max(minVal, Math.min(maxVal, val));
        t = (safeVal2 - minVal) / (maxVal - minVal);
      }
      return plotLeft + t * plotWidth;
    }

    var nullVal = isRatio ? 1.0 : 0.0;
    var nullX = xCoord(nullVal);
    var pooledX = xCoord(pooledPt);

    var svg = [];
    svg.push('<svg class="rmd-forest-svg" viewBox="0 0 ' + totalWidth + ' ' + totalHeight + '" width="100%" height="' + totalHeight + '" xmlns="http://www.w3.org/2000/svg">');
    svg.push('  <style>');
    svg.push('    .rf-text { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; font-size: 12px; fill: currentColor; }');
    svg.push('    .rf-hdr { font-weight: 600; font-size: 11.5px; fill: var(--rmd-mut, #5b6b75); text-transform: uppercase; letter-spacing: 0.03em; }');
    svg.push('    .rf-bold { font-weight: 600; }');
    svg.push('    .rf-mono { font-family: ui-monospace, "SF Mono", monospace; font-size: 11.5px; }');
    svg.push('    .rf-null-line { stroke: var(--rmd-line, #dce4e2); stroke-width: 1.5; stroke-dasharray: 4,3; }');
    svg.push('    .rf-pool-line { stroke: var(--rmd-acc, #0f766e); stroke-width: 1.2; stroke-dasharray: 2,2; opacity: 0.7; }');
    svg.push('    .rf-axis-line { stroke: var(--rmd-mut, #5b6b75); stroke-width: 1; }');
    svg.push('    .rf-ci-line { stroke: var(--rmd-ink, #12202a); stroke-width: 1.8; stroke-linecap: round; }');
    svg.push('    .rf-box { fill: var(--rmd-acc, #0f766e); }');
    svg.push('    .rf-diamond { fill: var(--rmd-acc, #0f766e); stroke: var(--rmd-acc-dark, #094e48); stroke-width: 1; }');
    svg.push('  </style>');

    // 1. Column Headers
    var headerY = 25;
    svg.push('  <text x="' + colStudyX + '" y="' + headerY + '" class="rf-hdr">Study</text>');
    svg.push('  <text x="' + colDataX + '" y="' + headerY + '" class="rf-hdr">Data</text>');
    svg.push('  <text x="' + colEffectX + '" y="' + headerY + '" class="rf-hdr">' + esc(measure) + ' [95% CI]</text>');
    svg.push('  <text x="' + colWeightX + '" y="' + headerY + '" class="rf-hdr" text-anchor="end">Weight</text>');
    svg.push('  <line x1="' + colStudyX + '" y1="' + (headerY + 10) + '" x2="' + (totalWidth - 15) + '" y2="' + (headerY + 10) + '" stroke="var(--rmd-line, #dce4e2)" stroke-width="1" />');

    // 2. Reference line of no effect (dashed)
    var plotTopY = topPadding - 10;
    var plotBottomY = topPadding + (rows.length * rowHeight) + 15;
    svg.push('  <line x1="' + nullX + '" y1="' + plotTopY + '" x2="' + nullX + '" y2="' + plotBottomY + '" class="rf-null-line" />');

    // 3. Vertical dotted line passing through summary pooled estimate
    svg.push('  <line x1="' + pooledX + '" y1="' + plotTopY + '" x2="' + pooledX + '" y2="' + (plotBottomY + 20) + '" class="rf-pool-line" />');

    // 4. Study Rows
    for (var k = 0; k < rows.length; k++) {
      var row = rows[k];
      var y = topPadding + (k * rowHeight);
      var studyLabel = row.study.label || ("Study " + (k + 1));

      // Study label
      svg.push('  <text x="' + colStudyX + '" y="' + (y + 4) + '" class="rf-text rf-bold">' + esc(studyLabel) + '</text>');

      // Data summary string
      var dataStr = "";
      if (row.study.inputs && row.study.inputs.events1 !== undefined) {
        dataStr = row.study.inputs.events1 + "/" + row.study.inputs.n1 + " vs " + row.study.inputs.events2 + "/" + row.study.inputs.n2;
      } else if (row.study.inputs && row.study.inputs.mean1 !== undefined) {
        dataStr = row.study.inputs.mean1 + " vs " + row.study.inputs.mean2;
      }
      svg.push('  <text x="' + colDataX + '" y="' + (y + 4) + '" class="rf-text rf-mono">' + esc(dataStr) + '</text>');

      if (row.calc && !row.calc.excluded) {
        var effPt = isRatio ? Math.exp(row.calc.yi) : row.calc.yi;
        var effLo = isRatio ? Math.exp(row.calc.ciLower) : row.calc.ciLower;
        var effHi = isRatio ? Math.exp(row.calc.ciUpper) : row.calc.ciUpper;

        // Effect [CI] text
        var effStr = fmtNum(effPt, 2) + " [" + fmtNum(effLo, 2) + ", " + fmtNum(effHi, 2) + "]";
        svg.push('  <text x="' + colEffectX + '" y="' + (y + 4) + '" class="rf-text rf-mono">' + esc(effStr) + '</text>');

        // Graphic: Horizontal CI line
        var x1 = xCoord(effLo);
        var x2 = xCoord(effHi);
        svg.push('  <line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" class="rf-ci-line" />');

        // Graphic: Square box proportional to study weight
        var boxSize = Math.max(5, Math.min(22, 5 + Math.sqrt(row.weight || 1) * 3));
        var boxX = xCoord(effPt) - (boxSize / 2);
        var boxY = y - (boxSize / 2);
        svg.push('  <rect x="' + boxX + '" y="' + boxY + '" width="' + boxSize + '" height="' + boxSize + '" class="rf-box" rx="1" />');

        // Weight text
        svg.push('  <text x="' + colWeightX + '" y="' + (y + 4) + '" class="rf-text rf-mono" text-anchor="end">' + fmtNum(row.weight, 1) + '%</text>');
      } else {
        svg.push('  <text x="' + colEffectX + '" y="' + (y + 4) + '" class="rf-text" fill="var(--rmd-mut)">Excluded</text>');
        svg.push('  <text x="' + colWeightX + '" y="' + (y + 4) + '" class="rf-text rf-mono" text-anchor="end">0.0%</text>');
      }
    }

    // 5. Divider before summary diamond
    var summaryY = topPadding + (rows.length * rowHeight) + 12;
    svg.push('  <line x1="' + colStudyX + '" y1="' + (summaryY - 8) + '" x2="' + (totalWidth - 15) + '" y2="' + (summaryY - 8) + '" stroke="var(--rmd-line, #dce4e2)" stroke-width="1" />');

    // 6. Summary Diamond & Text
    var summaryLabel = manifest.model === "fixed" ? "Fixed Effect Model" : "Random Effects Model (" + (manifest.model === "random_reml" ? "REML" : "DL") + ")";
    svg.push('  <text x="' + colStudyX + '" y="' + (summaryY + 4) + '" class="rf-text rf-bold">' + esc(summaryLabel) + '</text>');

    var poolStr = fmtNum(pooledPt, 2) + " [" + fmtNum(pooledLo, 2) + ", " + fmtNum(pooledHi, 2) + "]";
    svg.push('  <text x="' + colEffectX + '" y="' + (summaryY + 4) + '" class="rf-text rf-mono rf-bold">' + esc(poolStr) + '</text>');
    svg.push('  <text x="' + colWeightX + '" y="' + (summaryY + 4) + '" class="rf-text rf-mono rf-bold" text-anchor="end">100.0%</text>');

    // Diamond polygon points
    var dLeft = xCoord(pooledLo);
    var dRight = xCoord(pooledHi);
    var dCenter = xCoord(pooledPt);
    var dTop = summaryY - 7;
    var dBottom = summaryY + 7;
    var diamondPoints = dLeft + "," + summaryY + " " + dCenter + "," + dTop + " " + dRight + "," + summaryY + " " + dCenter + "," + dBottom;
    svg.push('  <polygon points="' + diamondPoints + '" class="rf-diamond" />');

    // 7. X-Axis line and tick marks
    var axisY = summaryY + 26;
    svg.push('  <line x1="' + plotLeft + '" y1="' + axisY + '" x2="' + plotRight + '" y2="' + axisY + '" class="rf-axis-line" />');

    // Ticks
    var ticks = [];
    if (isRatio) {
      var candidateTicks = [0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0];
      for (var t = 0; t < candidateTicks.length; t++) {
        var tickVal = candidateTicks[t];
        if (tickVal >= minVal * 0.95 && tickVal <= maxVal * 1.05) ticks.push(tickVal);
      }
    } else {
      var step = (maxVal - minVal) / 4;
      for (var s = minVal; s <= maxVal; s += step) {
        ticks.push(s);
      }
    }

    for (var u = 0; u < ticks.length; u++) {
      var tv = ticks[u];
      var tx = xCoord(tv);
      svg.push('  <line x1="' + tx + '" y1="' + axisY + '" x2="' + tx + '" y2="' + (axisY + 4) + '" class="rf-axis-line" />');
      svg.push('  <text x="' + tx + '" y="' + (axisY + 16) + '" class="rf-text rf-mono" text-anchor="middle" font-size="10.5">' + (isRatio ? (tv >= 1 ? tv.toFixed(0) : tv.toFixed(1)) : tv.toFixed(1)) + '</text>');
    }

    // Directional labels below axis
    svg.push('  <text x="' + (plotLeft + 30) + '" y="' + (axisY + 32) + '" class="rf-text" font-size="10.5" fill="var(--rmd-mut)">&larr; Favors Intervention</text>');
    svg.push('  <text x="' + (plotRight - 30) + '" y="' + (axisY + 32) + '" class="rf-text" font-size="10.5" fill="var(--rmd-mut)" text-anchor="end">Favors Control &rarr;</text>');

    svg.push('</svg>');
    return svg.join("\n");
  }

  /* ==================== CSV & MANIFEST EXPORT ==================== */
  function exportCsv(activeResult, project, studies) {
    var result = activeResult.result;
    var manifest = activeResult.manifest;
    var measure = manifest.measure;
    var isRatio = !!RATIO_MEASURES[measure];
    var engine = G.SMD_RESEARCH_ENGINE;

    var csvRows = [];
    csvRows.push(["Study", "Measure", "Events1", "N1", "Events2", "N2", "Effect", "CI_Lower", "CI_Upper", "Weight_Percent", "Citation", "Page"].join(","));

    for (var i = 0; i < studies.length; i++) {
      var s = studies[i];
      var eff = null;
      try {
        if (s.inputs && s.inputs.events1 !== undefined) {
          eff = engine.effectFromRaw(s.inputs, measure, manifest.level || 0.95);
        } else if (s.inputs && s.inputs.effect !== undefined) {
          eff = engine.effectFromCI(s.inputs, measure);
        } else if (s.inputs && s.inputs.yi !== undefined) {
          eff = engine.effectFromGeneric(s.inputs, measure, manifest.level || 0.95);
        }
      } catch (e) {
        eff = null;
      }

      var weight = result.weights && result.weights[i] != null ? result.weights[i].toFixed(2) : "0.00";
      var effPt = eff && !eff.excluded ? (isRatio ? Math.exp(eff.yi).toFixed(4) : eff.yi.toFixed(4)) : "";
      var effLo = eff && !eff.excluded ? (isRatio ? Math.exp(eff.ciLower).toFixed(4) : eff.ciLower.toFixed(4)) : "";
      var effHi = eff && !eff.excluded ? (isRatio ? Math.exp(eff.ciUpper).toFixed(4) : eff.ciUpper.toFixed(4)) : "";
      var ev1 = (s.inputs && s.inputs.events1 != null) ? s.inputs.events1 : "";
      var n1 = (s.inputs && s.inputs.n1 != null) ? s.inputs.n1 : "";
      var ev2 = (s.inputs && s.inputs.events2 != null) ? s.inputs.events2 : "";
      var n2 = (s.inputs && s.inputs.n2 != null) ? s.inputs.n2 : "";
      var cit = (s.locator && s.locator.citation) ? s.locator.citation.replace(/"/g, '""') : "";
      var pg = (s.locator && s.locator.page) ? String(s.locator.page).replace(/"/g, '""') : "";

      csvRows.push([
        '"' + (s.label || "").replace(/"/g, '""') + '"',
        '"' + measure + '"',
        ev1, n1, ev2, n2,
        effPt, effLo, effHi,
        weight,
        '"' + cit + '"',
        '"' + pg + '"'
      ].join(","));
    }

    // Pooled Summary Row
    var pooledPt = isRatio ? Math.exp(result.pooled.effect).toFixed(4) : result.pooled.effect.toFixed(4);
    var pooledLo = isRatio ? Math.exp(result.pooled.ciLower).toFixed(4) : result.pooled.ciLower.toFixed(4);
    var pooledHi = isRatio ? Math.exp(result.pooled.ciUpper).toFixed(4) : result.pooled.ciUpper.toFixed(4);
    var hetNote = "Heterogeneity: Q=" + result.heterogeneity.q.toFixed(2) + " (df=" + result.heterogeneity.df + " p=" + result.heterogeneity.p.toFixed(4) + ") I2=" + result.heterogeneity.i2.toFixed(1) + "% tau2=" + result.heterogeneity.tau2.toFixed(4);

    csvRows.push([
      '"Summary (' + manifest.model + ')"',
      '"' + measure + '"',
      "", "", "", "",
      pooledPt, pooledLo, pooledHi,
      "100.00",
      '"' + hetNote.replace(/"/g, '""') + '"',
      '""'
    ].join(","));

    var blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "researchmd-meta-analysis-" + measure.toLowerCase() + "-" + Date.now() + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportManifest(activeResult) {
    var manifestExport = {
      engine: "research-engine",
      engineVersion: "rmd1",
      measure: activeResult.manifest.measure,
      model: activeResult.manifest.model,
      test: activeResult.manifest.test,
      level: activeResult.manifest.level,
      studyVersions: activeResult.run ? activeResult.run.studyVersions : [],
      inputs: activeResult.manifest.inputs,
      result: activeResult.result,
      createdAt: activeResult.manifest.createdAt || new Date().toISOString()
    };

    var jsonStr = JSON.stringify(manifestExport, null, 2);
    var blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "researchmd-manifest-" + activeResult.manifest.measure.toLowerCase() + "-" + Date.now() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function bindEvents(container, project, verifiedStudies) {
    var store = SMD.store;
    var engine = G.SMD_RESEARCH_ENGINE;
    if (!store || !engine) return;

    // Navigation back to studies
    var toStudies = container.querySelectorAll('[data-rmd="to-studies"]');
    for (var a = 0; a < toStudies.length; a++) {
      toStudies[a].onclick = function () {
        if (SMD.navigate) SMD.navigate("studies", { projectId: project.id });
      };
    }

    // Export buttons
    var expCsvBtn = container.querySelector('[data-rmd="export-csv"]');
    if (expCsvBtn) {
      expCsvBtn.onclick = function () {
        var activeRes = store.getActiveRunResult();
        if (activeRes) exportCsv(activeRes, project, verifiedStudies);
      };
    }

    var expManBtn = container.querySelector('[data-rmd="export-manifest"]');
    if (expManBtn) {
      expManBtn.onclick = function () {
        var activeRes = store.getActiveRunResult();
        if (activeRes) exportManifest(activeRes);
      };
    }

    // Run Form submission
    var form = container.querySelector("#rmdRunConfigForm");
    var calcBtn = container.querySelector('[data-rmd="calculate"]');

    function doCalculate(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();

      var measSel = form ? form.querySelector("#rmd_run_measure") : null;
      var modSel = form ? form.querySelector("#rmd_run_model") : null;
      var testSel = form ? form.querySelector("#rmd_run_test") : null;
      var lvlSel = form ? form.querySelector("#rmd_run_level") : null;

      var measure = measSel ? measSel.value : "RR";
      var model = modSel ? modSel.value : "random_dl";
      var test = testSel ? testSel.value : "wald";
      var level = lvlSel ? parseFloat(lvlSel.value) : 0.95;

      runSettings.model = model;
      runSettings.test = test;
      runSettings.level = level;

      // Build project spec for engine.run() per engine-api.md contract
      var engineStudies = [];
      for (var i = 0; i < verifiedStudies.length; i++) {
        var s = verifiedStudies[i];
        var item = {
          id: s.id,
          verified: true // engine throws if verified is false
        };
        if (s.inputs) {
          for (var key in s.inputs) {
            item[key] = s.inputs[key];
          }
        }
        engineStudies.push(item);
      }

      var spec = {
        measure: measure,
        model: model,
        test: test,
        level: level,
        createdAt: new Date().toISOString(),
        studies: engineStudies
      };

      try {
        var res = engine.run(spec);
        store.saveRunResult(res, res.manifest);
        renderRunScreen(container);
      } catch (err) {
        var errBox = container.querySelector(".rmd-run-results-panel");
        if (errBox) {
          errBox.innerHTML = '<div class="rmd-card rmd-notices-box"><p>Calculation error: ' + esc(err.message || String(err)) + '</p></div>';
        }
      }

      return false;
    }

    if (form) form.onsubmit = doCalculate;
    if (calcBtn) calcBtn.onclick = doCalculate;
  }

  SMD.screens.run = {
    render: renderRunScreen,
    exportCsv: exportCsv,
    exportManifest: exportManifest
  };

})(typeof window !== "undefined" ? window : globalThis);
