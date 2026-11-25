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
    projectId: null,
    measure: null,
    model: "random_dl", // "random_dl", "fixed", "random_reml"
    test: "wald",       // "wald", "knha"
    level: 0.95
  };

  function hasCountInputs(inp) {
    return !!(inp && inp.events1 !== undefined && inp.events1 !== null && inp.n1 !== undefined && inp.n1 !== null &&
      inp.events2 !== undefined && inp.events2 !== null && inp.n2 !== undefined && inp.n2 !== null);
  }

  function hasMeanInputs(inp) {
    return !!(inp && inp.mean1 !== undefined && inp.mean1 !== null && inp.sd1 !== undefined && inp.sd1 !== null &&
      inp.n1 !== undefined && inp.n1 !== null && inp.mean2 !== undefined && inp.mean2 !== null &&
      inp.sd2 !== undefined && inp.sd2 !== null && inp.n2 !== undefined && inp.n2 !== null);
  }

  function hasCiOrGenericInputs(inp) {
    if (!inp) return false;
    var hasCi = inp.effect !== undefined && inp.effect !== null && inp.ciLower !== undefined && inp.ciUpper !== undefined;
    var hasGen = inp.yi !== undefined && inp.yi !== null && (inp.se != null || inp.sei != null || inp.vi != null);
    return !!(hasCi || hasGen);
  }

  function compatibleMeasuresFor(studies) {
    var list = studies || [];
    if (!list.length) return ["RR", "OR", "RD"];
    var allCounts = true, allMeans = true, allDirect = true;
    for (var i = 0; i < list.length; i++) {
      var inp = (list[i] && list[i].inputs) || {};
      if (!hasCountInputs(inp)) allCounts = false;
      if (!hasMeanInputs(inp)) allMeans = false;
      if (!hasCiOrGenericInputs(inp)) allDirect = false;
    }
    if (allDirect) return ["RR", "OR", "HR", "RD", "MD", "SMD"];
    if (allCounts && !allMeans) return ["RR", "OR", "RD"];
    if (allMeans && !allCounts) return ["MD", "SMD"];
    if (allCounts && allMeans) return ["RR", "OR", "RD", "MD", "SMD"];
    return [];
  }

  function checkMeasureCompatibility(measure, studies) {
    var list = studies || [];
    if (!list.length) return { ok: true };
    var needsContinuous = (measure === "MD" || measure === "SMD");
    var needsCounts = (measure === "RR" || measure === "OR" || measure === "RD");
    var needsDirect = (measure === "HR");
    for (var i = 0; i < list.length; i++) {
      var s = list[i] || {};
      var inp = s.inputs || {};
      var label = s.label || ("Study " + (i + 1));
      if (hasCiOrGenericInputs(inp)) continue;
      if (needsContinuous && !hasMeanInputs(inp)) {
        if (hasCountInputs(inp)) {
          return {
            ok: false,
            suggested: "RR",
            message: label + " (and studies with event counts like " + inp.events1 + "/" + inp.n1 + ") do not have Mean and SD values needed for " + (MEASURE_LABELS[measure] || measure) + ". Switch Effect Measure to Risk ratio (RR), Odds ratio (OR), or Risk difference (RD)."
          };
        }
        return {
          ok: false,
          suggested: "MD",
          message: label + " is missing Mean, SD, or sample size (N) needed for " + (MEASURE_LABELS[measure] || measure) + "."
        };
      }
      if (needsCounts && !hasCountInputs(inp)) {
        if (hasMeanInputs(inp)) {
          return {
            ok: false,
            suggested: "MD",
            message: label + " reports Mean and SD rather than event counts. Switch Effect Measure to Mean difference (MD) or Standardised mean difference (SMD)."
          };
        }
        return {
          ok: false,
          suggested: "RR",
          message: label + " is missing 2x2 event counts needed for " + (MEASURE_LABELS[measure] || measure) + "."
        };
      }
      if (needsDirect) {
        return {
          ok: false,
          suggested: hasMeanInputs(inp) ? "MD" : "RR",
          message: "Hazard ratio (HR) requires reported Hazard Ratio and 95% CI values on each study. Switch to " + (hasMeanInputs(inp) ? "Mean difference (MD)." : "Risk ratio (RR), Odds ratio (OR), or Risk difference (RD).")
        };
      }
    }
    return { ok: true };
  }

  function friendlyCalcError(err, measure, verifiedStudies) {
    var raw = String((err && err.message) || err || "Could not run meta-analysis.");
    var compat = checkMeasureCompatibility(measure, verifiedStudies);
    if (!compat.ok) return compat;
    var byId = {};
    for (var i = 0; i < (verifiedStudies || []).length; i++) {
      var st = verifiedStudies[i];
      if (st && st.id) byId[st.id] = st.label || st.id;
    }
    var msg = raw.replace(/^research:\s*/i, "").replace(/study\s+(\S+)/gi, function (m, sid) {
      return byId[sid] ? ('study "' + byId[sid] + '"') : m;
    });
    return { ok: false, suggested: null, message: msg };
  }

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

  var MEASURE_LABELS = {
    RR: "Risk ratio (RR)",
    OR: "Odds ratio (OR)",
    HR: "Hazard ratio (HR)",
    RD: "Risk difference (RD)",
    MD: "Mean difference (MD)",
    SMD: "Standardised mean difference (SMD)"
  };

  var REPORT_WHY = {
    counts: "Risk ratio (RR): the chance of the event with treatment divided by the chance without it.",
    average: "Mean difference (MD): the average in one group minus the average in the other.",
    ratio: "The ratio each study reported, with its 95% confidence interval (CI)."
  };

  /* Normal CDF (Zelen & Severo approximation), same as the manuscript screen,
   * for the two-sided p of the pooled effect. */
  function normCdf(x) {
    var t = 1 / (1 + 0.2316419 * Math.abs(x));
    var d = 0.3989422804014327 * Math.exp(-x * x / 2);
    var p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - p : p;
  }

  function pooledP(result) {
    var pooled = result && result.pooled;
    if (!pooled || pooled.effect == null || !pooled.se) return undefined;
    return 2 * (1 - normCdf(Math.abs(pooled.effect / pooled.se)));
  }

  /* Deterministic "What this means" lines under the result cards. RD has no
   * plain-words rule in the helper, so only heterogeneity and p are shown. */
  function whatMeansHtml(result, measure) {
    var explain = G.SMD_RESEARCH_EXPLAIN;
    if (!explain || !result) return "";
    var isRatio = !!RATIO_MEASURES[measure];
    var pooled = result.pooled || {};
    var het = result.heterogeneity || {};
    var est = isRatio ? Math.exp(pooled.effect) : pooled.effect;
    var lo = isRatio ? Math.exp(pooled.ciLower) : pooled.ciLower;
    var hi = isRatio ? Math.exp(pooled.ciUpper) : pooled.ciUpper;
    var lines = [];
    if (measure !== "RD" && isFinite(est) && isFinite(lo) && isFinite(hi)) {
      try {
        lines.push(explain.effect({ measure: measure, estimate: est, ciLower: lo, ciUpper: hi, p: pooledP(result) }));
      } catch (e) {}
    }
    if (het.i2 != null) {
      try { lines.push(explain.heterogeneity(het.i2, het.tau2)); } catch (e) {}
    }
    if (het.p != null) {
      try { lines.push("Test of Homogeneity: " + explain.pValue(het.p)); } catch (e) {}
    }
    if (!lines.length) return "";
    var h = ['<div class="rmd-what-mean-box">', '<p class="rmd-what-mean-title">What this means</p>'];
    for (var i = 0; i < lines.length; i++) h.push('<p class="rmd-what-mean">' + esc(lines[i]) + '</p>');
    h.push('</div>');
    return h.join("");
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

    // Detect primary measure from studies or preserve valid user selection
    if (runSettings.projectId !== project.id) {
      runSettings.projectId = project.id;
      runSettings.measure = null;
    }
    var compatList = compatibleMeasuresFor(verifiedStudies);
    var defaultMeasure = "RR";
    if (verifiedStudies.length > 0 && verifiedStudies[0].measure) {
      defaultMeasure = verifiedStudies[0].measure;
    } else if (compatList.length) {
      defaultMeasure = compatList[0];
    }
    var measure = runSettings.measure || defaultMeasure;
    var activeResult = store.getActiveRunResult();
    var displayMeasure = (activeResult && activeResult.manifest && activeResult.manifest.measure) || measure;

    var h = [];
    h.push('<div class="rmd-run-screen">');

    // Header (exports live below the Forest Plot, not at the top)
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
    h.push('  </div>');

    // Two-pane or top/bottom layout: Left/Top is Settings, Right/Bottom is Plot & Stats
    h.push('  <div class="rmd-run-layout">');

    // SETTINGS CARD
    h.push('    <div class="rmd-run-settings-panel">');
    h.push('      <div class="rmd-card">');
    h.push('        <h3 class="rmd-card-heading">Analysis Specification</h3>');

    // Plain choosers: set the measure and model selects below without jargon.
    var reportKind = "counts";
    if (verifiedStudies.length && verifiedStudies[0].inputs) {
      var inp0 = verifiedStudies[0].inputs;
      if (inp0.mean1 !== undefined) reportKind = "average";
      else if (inp0.effect !== undefined || inp0.yi !== undefined) reportKind = "ratio";
    }
    var reportOpts = [
      { key: "counts", label: "Counts of people with the event" },
      { key: "average", label: "An average with spread" },
      { key: "ratio", label: "A ratio with its range" }
    ];
    h.push('        <div class="rmd-plain-chooser">');
    h.push('          <p class="rmd-plain-q">What did each study report?</p>');
    h.push('          <div class="rmd-plain-opts">');
    for (var ro = 0; ro < reportOpts.length; ro++) {
      h.push('            <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-plain-report="' + reportOpts[ro].key + '" aria-pressed="' + (reportKind === reportOpts[ro].key ? 'true' : 'false') + '">' + reportOpts[ro].label + '</button>');
    }
    h.push('          </div>');
    h.push('          <p class="rmd-plain-why" id="rmdPlainReportWhy">' + esc(REPORT_WHY[reportKind]) + '</p>');
    h.push('        </div>');

    var sameThing = runSettings.model === "fixed";
    var explainInit = G.SMD_RESEARCH_EXPLAIN;
    var modelWhyText = explainInit ? explainInit.model(sameThing ? "fixed" : "random") : "";
    h.push('        <div class="rmd-plain-chooser">');
    h.push('          <p class="rmd-plain-q">Should we assume every study measures the same thing?</p>');
    h.push('          <div class="rmd-plain-opts">');
    h.push('            <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-plain-model="same" aria-pressed="' + (sameThing ? 'true' : 'false') + '">Yes, the same thing</button>');
    h.push('            <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-plain-model="different" aria-pressed="' + (sameThing ? 'false' : 'true') + '">Not sure, probably a bit different</button>');
    h.push('          </div>');
    h.push('          <p class="rmd-plain-why" id="rmdPlainModelWhy">' + esc(modelWhyText) + '</p>');
    h.push('        </div>');

    h.push('        <form id="rmdRunConfigForm" class="rmd-form">');

    h.push('          <div class="rmd-field">');
    h.push('            <label for="rmd_run_measure">Effect Measure</label>');
    h.push('            <select id="rmd_run_measure">');
    var measures = ["RR", "OR", "HR", "RD", "MD", "SMD"];
    for (var m = 0; m < measures.length; m++) {
      var mLabel = MEASURE_LABELS[measures[m]];
      h.push('              <option value="' + measures[m] + '"' + (measure === measures[m] ? ' selected' : '') + '>' + mLabel + '</option>');
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
      h.push(renderRunResultsHtml(activeResult, displayMeasure, verifiedStudies));
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
    h.push('      <span class="rmd-kpi-lbl">Pooled ' + esc(MEASURE_LABELS[measure] || measure) + ', ' + (manifest.model === 'fixed' ? 'fixed-effect model' : 'random-effects model') + '</span>');
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

    h.push(whatMeansHtml(result, measure));

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

    // One-time plain caption, shown the first time a forest plot appears.
    var explainCap = G.SMD_RESEARCH_EXPLAIN;
    var capSeen = false;
    try { capSeen = localStorage.getItem("smd_rmd_forest_caption") === "1"; } catch (e) {}
    if (explainCap && !capSeen) {
      h.push('    <p class="rmd-what-mean rmd-forest-caption">' + esc(explainCap.forestCaption()) + '</p>');
      try { localStorage.setItem("smd_rmd_forest_caption", "1"); } catch (e) {}
    }

    h.push('  </div>'); // .rmd-forest-card

    // Export Downloads Card (placed below the Forest Plot)
    h.push('  <div class="rmd-card rmd-run-export-bar">');
    h.push('    <p class="rmd-run-export-title">Export results &amp; plot</p>');
    h.push('    <div class="rmd-run-export-actions">');
    h.push('      <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="export-png">');
    h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>');
    h.push('        <span>Download Forest Plot (PNG)</span>');
    h.push('      </button>');
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="export-csv">');
    h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>');
    h.push('        <span>Download CSV</span>');
    h.push('      </button>');
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="export-manifest">');
    h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>');
    h.push('        <span>Download details (JSON)</span>');
    h.push('      </button>');
    h.push('    </div>');
    h.push('  </div>');

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
    svg.push('    .rf-hdr { font-weight: 600; font-size: 11.5px; fill: var(--rmd-mut, #5b607a); text-transform: uppercase; letter-spacing: 0.03em; }');
    svg.push('    .rf-bold { font-weight: 600; }');
    svg.push('    .rf-mono { font-family: ui-monospace, "SF Mono", monospace; font-size: 11.5px; }');
    svg.push('    .rf-null-line { stroke: var(--rmd-line, #e5ddce); stroke-width: 1.5; stroke-dasharray: 4,3; }');
    svg.push('    .rf-pool-line { stroke: var(--rmd-acc, #1b41bf); stroke-width: 1.2; stroke-dasharray: 2,2; opacity: 0.7; }');
    svg.push('    .rf-axis-line { stroke: var(--rmd-mut, #5b607a); stroke-width: 1; }');
    svg.push('    .rf-ci-line { stroke: var(--rmd-ink, #111c44); stroke-width: 1.8; stroke-linecap: round; }');
    svg.push('    .rf-box { fill: var(--rmd-acc, #1b41bf); }');
    svg.push('    .rf-diamond { fill: var(--rmd-acc, #1b41bf); stroke: var(--rmd-acc-dark, #142f8c); stroke-width: 1; }');
    svg.push('  </style>');

    // 1. Column Headers
    var headerY = 25;
    svg.push('  <text x="' + colStudyX + '" y="' + headerY + '" class="rf-hdr">Study</text>');
    svg.push('  <text x="' + colDataX + '" y="' + headerY + '" class="rf-hdr">Data</text>');
    svg.push('  <text x="' + colEffectX + '" y="' + headerY + '" class="rf-hdr">' + esc(measure) + ' [95% CI]</text>');
    svg.push('  <text x="' + colWeightX + '" y="' + headerY + '" class="rf-hdr" text-anchor="end">Weight</text>');
    svg.push('  <line x1="' + colStudyX + '" y1="' + (headerY + 10) + '" x2="' + (totalWidth - 15) + '" y2="' + (headerY + 10) + '" stroke="var(--rmd-line, #e5ddce)" stroke-width="1" />');

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
    svg.push('  <line x1="' + colStudyX + '" y1="' + (summaryY - 8) + '" x2="' + (totalWidth - 15) + '" y2="' + (summaryY - 8) + '" stroke="var(--rmd-line, #e5ddce)" stroke-width="1" />');

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

    return deliverExport(csvRows.join("\n"), "text/csv",
      SMD.p2.fileSlug(project && project.title, "meta-analysis") + "-results.csv");
  }

  function deliverExport(text, mime, filename) {
    var container = document.querySelector(".rmd-run-screen") || document.getElementById("rmdScreenBody");
    return SMD.p2.downloadText(filename, text, mime).then(function (res) {
      if (res && res.cancelled) return res;
      SMD.p2.flashNotice(container, "Your file is ready to save or share.", "info");
      return res;
    }, function (err) {
      SMD.p2.flashNotice(container, SMD.p2.friendlyError(err).message, "error");
    });
  }

  function svgToPngBytes(svgHtml) {
    return new Promise(function (resolve, reject) {
      if (!svgHtml || !G.document) {
        reject(new Error("Forest plot SVG is unavailable."));
        return;
      }
      var cleanSvg = String(svgHtml)
        .replace(/var\(--rmd-mut[^)]*\)/g, "#5b607a")
        .replace(/var\(--rmd-line[^)]*\)/g, "#e5ddce")
        .replace(/var\(--rmd-acc-dark[^)]*\)/g, "#142f8c")
        .replace(/var\(--rmd-acc[^)]*\)/g, "#1b41bf")
        .replace(/var\(--rmd-ink[^)]*\)/g, "#111c44")
        .replace(/fill:\s*currentColor/g, "fill: #111c44")
        .replace(/&larr;/g, "&#8592;")
        .replace(/&rarr;/g, "&#8594;");
      if (cleanSvg.indexOf("xmlns=") < 0) {
        cleanSvg = cleanSvg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      var vb = cleanSvg.match(/viewBox="0 0 (\d+) (\d+)"/);
      var w = vb ? parseInt(vb[1], 10) : 840;
      var h = vb ? parseInt(vb[2], 10) : 480;
      cleanSvg = cleanSvg.replace(/width="100%"/, 'width="' + w + '"');
      var scale = 2;
      var canvas = G.document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      var ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas rendering is not supported."));
        return;
      }
      var img = new G.Image();
      var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(cleanSvg);
      img.onload = function () {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, w, h);
        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error("Could not encode PNG image.")); return; }
            if (blob.arrayBuffer) {
              blob.arrayBuffer().then(function (ab) { resolve(new G.Uint8Array(ab)); }, reject);
            } else {
              var fr = new G.FileReader();
              fr.onload = function () { resolve(new G.Uint8Array(fr.result)); };
              fr.onerror = function () { reject(fr.error || new Error("PNG read failed")); };
              fr.readAsArrayBuffer(blob);
            }
          }, "image/png");
        } else {
          try {
            var b64 = String(canvas.toDataURL("image/png")).split(",")[1] || "";
            var bin = G.atob(b64), arr = new G.Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            resolve(arr);
          } catch (e) { reject(e); }
        }
      };
      img.onerror = function () {
        reject(new Error("Could not rasterize forest plot SVG."));
      };
      img.src = url;
    });
  }

  function exportForestPng(activeResult, project, verifiedStudies) {
    var container = document.querySelector(".rmd-run-screen") || document.getElementById("rmdScreenBody");
    if (!activeResult || !activeResult.result || !activeResult.manifest) return Promise.resolve();
    var svgEl = container ? container.querySelector("svg.rmd-forest-svg") : null;
    var svgHtml = svgEl && G.XMLSerializer
      ? new G.XMLSerializer().serializeToString(svgEl)
      : generateForestPlotSvg(activeResult.result, activeResult.manifest, verifiedStudies || []);
    var filename = SMD.p2.fileSlug(project && project.title, "meta-analysis") + "-forest-plot.png";
    return svgToPngBytes(svgHtml).then(function (bytes) {
      return SMD.p2.downloadBytes(filename, bytes, "image/png", "Forest Plot");
    }).then(function (res) {
      if (res && res.cancelled) return res;
      SMD.p2.flashNotice(container, "Your file is ready to save or share.", "info");
      return res;
    }, function (err) {
      SMD.p2.flashNotice(container, SMD.p2.friendlyError(err).message, "error");
    });
  }

  function exportManifest(activeResult, project) {
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
    return deliverExport(jsonStr, "application/json",
      SMD.p2.fileSlug(project && project.title, "meta-analysis") + "-analysis-details.json");
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

    // Export buttons (located below the Forest Plot)
    var expPngBtn = container.querySelector('[data-rmd="export-png"]');
    if (expPngBtn) {
      expPngBtn.onclick = function () {
        var activeRes = store.getActiveRunResult();
        if (activeRes) exportForestPng(activeRes, project, verifiedStudies);
      };
    }

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
        if (activeRes) exportManifest(activeRes, project);
      };
    }

    // Plain choosers drive the advanced selects; the selects stay editable.
    var measSel0 = container.querySelector("#rmd_run_measure");
    var modSel0 = container.querySelector("#rmd_run_model");
    var reportWhy = container.querySelector("#rmdPlainReportWhy");
    var modelWhy = container.querySelector("#rmdPlainModelWhy");
    var explain = G.SMD_RESEARCH_EXPLAIN;

    function showCalcWarning(compat) {
      var errBox = container.querySelector(".rmd-run-results-panel");
      if (!errBox || !compat) return;
      var sug = compat.suggested;
      var sugLabel = sug ? (MEASURE_LABELS[sug] || sug) : "";
      var html = '<div class="rmd-card"><div class="rmd-banner rmd-banner-warn" role="alert">';
      html += '<strong>Incompatible effect measure</strong>';
      html += '<span>' + esc(compat.message) + '</span>';
      if (sug) {
        html += '<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-switch-measure="' + esc(sug) + '">Switch to ' + esc(sugLabel) + '</button>';
      }
      html += '</div></div>';
      errBox.innerHTML = html;
      var swBtn = errBox.querySelector('[data-rmd-switch-measure]');
      if (swBtn) {
        swBtn.onclick = function () {
          var targetM = this.getAttribute("data-rmd-switch-measure");
          if (measSel0) measSel0.value = targetM;
          runSettings.measure = targetM;
          doCalculate();
        };
      }
    }

    if (measSel0) {
      measSel0.onchange = function () {
        runSettings.measure = measSel0.value;
        var compat = checkMeasureCompatibility(measSel0.value, verifiedStudies);
        if (!compat.ok) showCalcWarning(compat);
      };
    }

    function markPressed(attr, key) {
      var btns = container.querySelectorAll("[" + attr + "]");
      for (var i = 0; i < btns.length; i++) {
        btns[i].setAttribute("aria-pressed", btns[i].getAttribute(attr) === key ? "true" : "false");
      }
    }

    var reportBtns = container.querySelectorAll("[data-rmd-plain-report]");
    for (var rb = 0; rb < reportBtns.length; rb++) {
      reportBtns[rb].onclick = function () {
        var key = this.getAttribute("data-rmd-plain-report");
        if (measSel0) {
          if (key === "counts") measSel0.value = "RR";
          else if (key === "average") measSel0.value = "MD";
          else if (!RATIO_MEASURES[measSel0.value]) measSel0.value = "RR";
          runSettings.measure = measSel0.value;
        }
        markPressed("data-rmd-plain-report", key);
        if (reportWhy) reportWhy.textContent = REPORT_WHY[key] || "";
        if (measSel0) {
          var compat = checkMeasureCompatibility(measSel0.value, verifiedStudies);
          if (!compat.ok) showCalcWarning(compat);
        }
      };
    }

    var modelBtns = container.querySelectorAll("[data-rmd-plain-model]");
    for (var mb = 0; mb < modelBtns.length; mb++) {
      modelBtns[mb].onclick = function () {
        var fixed = this.getAttribute("data-rmd-plain-model") === "same";
        if (modSel0) modSel0.value = fixed ? "fixed" : "random_dl";
        runSettings.model = fixed ? "fixed" : "random_dl";
        markPressed("data-rmd-plain-model", fixed ? "same" : "different");
        if (modelWhy && explain) modelWhy.textContent = explain.model(fixed ? "fixed" : "random");
      };
    }
    if (modSel0) {
      modSel0.onchange = function () {
        var fixed = modSel0.value === "fixed";
        markPressed("data-rmd-plain-model", fixed ? "same" : "different");
        if (modelWhy && explain) modelWhy.textContent = explain.model(fixed ? "fixed" : "random");
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

      runSettings.measure = measure;
      runSettings.model = model;
      runSettings.test = test;
      runSettings.level = level;

      var preCompat = checkMeasureCompatibility(measure, verifiedStudies);
      if (!preCompat.ok) {
        showCalcWarning(preCompat);
        return false;
      }

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
        showCalcWarning(friendlyCalcError(err, measure, verifiedStudies));
      }

      return false;
    }

    if (form) form.onsubmit = doCalculate;
    if (calcBtn) calcBtn.onclick = doCalculate;
  }

  SMD.screens.run = {
    render: renderRunScreen,
    exportCsv: exportCsv,
    exportManifest: exportManifest,
    exportForestPng: exportForestPng
  };

})(typeof window !== "undefined" ? window : globalThis);
