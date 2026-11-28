/* StewardMD - ResearchMD GRADE & Summary of Findings Screen
 * (window.SMD_RESEARCH.screens.grade). ES5 only, buildless. Phase 4.3,
 * module M. Tablet-first per plan decision D-1: the full GRADE form lives
 * at >= 768px; on phone this screen is a read-only Summary of Findings and
 * certainty view.
 *
 * ORCHESTRATOR WIRING (the only edits needed outside this package):
 *
 * 1. index.html, with the other ResearchMD script tags, BEFORE research.js
 *    (after the research-screen-prisma.js line):
 *
 *      <script src="/research-grade.js?v=rmd2" defer></script>
 *      <script src="/research-screen-grade.js?v=rmd2" defer></script>
 *
 * 2. research.js, renderShell() tabs array, add after ["run", "Run"]:
 *
 *      ["grade", "GRADE"]
 *
 * Data: reads the project's saved runs from SMD.store. GRADE assessments
 * persist device-local under localStorage key smd_research_grade_v1 until
 * the Phase 4.3 API contract lands; the screen says so. Suggestions from
 * research-grade.js are labelled "Suggestion" and only apply when a human
 * presses Accept. Every downgrade and upgrade needs a reason; the certainty
 * badge stays "Not graded yet" until the form is complete.
 */
(function (G) {
  "use strict";

  var D = G.document;
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var esc = SMD.esc || function (s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  var STORE_KEY = "smd_research_grade_v1";
  var DOMAIN_DEFS = [
    { key: "riskOfBias", label: "Risk of bias" },
    { key: "inconsistency", label: "Inconsistency" },
    { key: "indirectness", label: "Indirectness" },
    { key: "imprecision", label: "Imprecision" },
    { key: "publicationBias", label: "Publication bias" }
  ];
  var UPGRADE_DEFS = [
    { key: "largeEffect", label: "Large effect" },
    { key: "doseResponse", label: "Dose-response gradient" },
    { key: "plausibleConfounding", label: "Plausible confounding" }
  ];
  var LEVEL_OPTIONS = [
    { value: "no", label: "Not serious" },
    { value: "serious", label: "Serious (down 1 level)" },
    { value: "very_serious", label: "Very serious (down 2 levels)" }
  ];
  var CERT_CLASS = { "High": "high", "Moderate": "moderate", "Low": "low", "Very low": "verylow" };

  var st = {
    projectId: null,
    view: "assess",
    selectedRunId: null,
    data: {},
    ai: null,
    serverSugs: {},
    serverRuns: {},
    runsFetched: {},
    runsLoading: false,
    runsError: null
  };
  var lastContainer = null;
  var mqlBound = false;

  function grade() { return G.SMD_RESEARCH_GRADE; }

  function isPhone() {
    try {
      if (G.matchMedia) return G.matchMedia("(max-width: 767px)").matches;
    } catch (e) {}
    return (G.innerWidth || 1024) < 768;
  }

  /* ---- device-local persistence ---------------------------------------- */

  function loadAll() {
    try {
      var raw = G.localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return (parsed && typeof parsed === "object") ? parsed : {};
    } catch (e) { return {}; }
  }

  function saveAll() {
    try {
      G.localStorage.setItem(STORE_KEY, JSON.stringify(st.data));
    } catch (e) { /* storage full or blocked: assessments stay in memory */ }
  }

  function projectData(pid) {
    if (!st.data[pid]) st.data[pid] = { outcomes: {} };
    if (!st.data[pid].outcomes) st.data[pid].outcomes = {};
    return st.data[pid];
  }

  function defaultReviewer() {
    try {
      var u = G.SMD_AUTH && G.SMD_AUTH.currentUser;
      if (u && u.uid) return String(u.uid);
    } catch (e) {}
    return "clinician";
  }

  function defaultAssessment(run) {
    var domains = {}, upgrades = {}, i;
    for (i = 0; i < DOMAIN_DEFS.length; i++) {
      domains[DOMAIN_DEFS[i].key] = { level: "no", reason: "" };
    }
    for (i = 0; i < UPGRADE_DEFS.length; i++) {
      upgrades[UPGRADE_DEFS[i].key] = { levels: 0, reason: "" };
    }
    return {
      outcome: (run.measure || "RR") + " outcome",
      design: "rct",
      reviewer: defaultReviewer(),
      domains: domains,
      upgrades: upgrades,
      mid: "",
      baselineRisk: ""
    };
  }

  function getAssessment(pid, run) {
    var pd = projectData(pid);
    if (!pd.outcomes[run.id]) {
      pd.outcomes[run.id] = defaultAssessment(run);
      saveAll();
    }
    return pd.outcomes[run.id];
  }

  function getRuns(pid) {
    var store = SMD.store;
    var state = store ? store.getState() : null;
    var local = (state && state.runs && state.runs[pid]) ? state.runs[pid] : [];
    var server = st.serverRuns[pid] || [];
    if (!server.length) return local;
    var seen = {}, out = [], i;
    for (i = 0; i < local.length; i++) {
      out.push(local[i]);
      if (local[i] && local[i].serverId) seen[local[i].serverId] = true;
    }
    for (i = 0; i < server.length; i++) {
      if (server[i] && server[i].id && !seen[server[i].id]) out.push(server[i]);
    }
    return out;
  }

  function canUseServer(project) {
    return !!(project && project.serverId && !project.tutorial && !project.practice && SMD.api && typeof SMD.api.request === "function");
  }

  function loadServerRuns(container, project) {
    if (st.runsLoading || st.runsFetched[project.id] || !canUseServer(project)) return;
    st.runsLoading = true;
    st.runsError = null;
    render(container);
    SMD.api.request("GET", "/v1/projects/" + encodeURIComponent(project.serverId) + "/runs?limit=50").then(function (res) {
      st.serverRuns[project.id] = (res && res.runs) || [];
      st.runsFetched[project.id] = true;
      st.runsLoading = false;
      st.runsError = null;
      render(container);
    }, function (err) {
      st.runsFetched[project.id] = true;
      st.runsLoading = false;
      st.runsError = err || { message: "Could not load saved runs." };
      render(container);
    });
  }

  /* ---- grade computation ------------------------------------------------ */

  function buildInput(a, run) {
    var input = {
      outcome: a.outcome,
      design: a.design,
      run: run.result,
      upgrades: {}
    };
    var i, key;
    for (i = 0; i < DOMAIN_DEFS.length; i++) {
      key = DOMAIN_DEFS[i].key;
      input[key] = {
        level: a.domains[key].level,
        reason: a.domains[key].reason,
        by: a.reviewer
      };
    }
    if (a.design === "observational") {
      for (i = 0; i < UPGRADE_DEFS.length; i++) {
        key = UPGRADE_DEFS[i].key;
        input.upgrades[key] = {
          levels: Number(a.upgrades[key].levels) || 0,
          reason: a.upgrades[key].reason,
          by: a.reviewer
        };
      }
    }
    return input;
  }

  function computeGrade(a, run) {
    try {
      return { ok: true, grade: grade().assessOutcome(buildInput(a, run)) };
    } catch (e) {
      return { ok: false, message: String((e && e.message) || e).replace(/^research:\s*/, "") };
    }
  }

  function downTotal(a) {
    var n = 0, i, lv;
    for (i = 0; i < DOMAIN_DEFS.length; i++) {
      lv = a.domains[DOMAIN_DEFS[i].key].level;
      if (lv === "serious") n += 1;
      if (lv === "very_serious") n += 2;
    }
    return n;
  }

  function suggestionsFor(run, a) {
    var server = st.serverSugs && st.serverSugs[run.id];
    if (server) {
      return { imprecision: server.imprecision || null, inconsistency: server.inconsistency || null };
    }
    var mid = parseFloat(a.mid);
    try {
      return {
        imprecision: grade().suggestImprecision(run.result, isFinite(mid) ? mid : undefined),
        inconsistency: grade().suggestInconsistency(run.result)
      };
    } catch (e) {
      return { imprecision: null, inconsistency: null };
    }
  }

  /* ---- CSS (house tokens; no glows, gradients or backdrops) -------------- */

  function injectCss() {
    if (!D || D.getElementById("rmdGradeCss")) return;
    var s = D.createElement("style");
    s.id = "rmdGradeCss";
    s.textContent = [
      "#researchMD .rmd-grade-screen { display: flex; flex-direction: column; flex: 1; min-height: 0; }",
      "#researchMD .rmd-grade-topbar-title { margin: 0; font: 600 16px var(--rmd-f); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      "#researchMD .rmd-grade-views { display: flex; gap: 6px; }",
      "#researchMD .rmd-grade-views .rmd-chip { min-height: 34px; touch-action: manipulation; }",
      "#researchMD .rmd-grade-layout { display: grid; grid-template-columns: 300px 1fr; gap: 18px; padding: 18px 22px 40px; max-width: 1280px; margin: 0 auto; width: 100%; flex: 1; min-height: 0; }",
      "#researchMD .rmd-grade-list { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 12px; overflow-y: auto; align-self: start; max-height: calc(100vh - 220px); }",
      "#researchMD .rmd-grade-list-head { padding: 12px 16px; border-bottom: 1px solid var(--rmd-line); font: 600 12px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.05em; color: var(--rmd-mut); }",
      "#researchMD .rmd-grade-form { display: flex; flex-direction: column; gap: 14px; min-width: 0; }",
      "#researchMD .rmd-grade-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }",
      "#researchMD .rmd-grade-badge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--rmd-line); background: var(--rmd-panel); }",
      "#researchMD .rmd-grade-symbols { font: 600 16px var(--rmd-mono); letter-spacing: 2px; }",
      "#researchMD .rmd-grade-cert-high, #researchMD .rmd-grade-cert-moderate { background: var(--rmd-acc-soft); border-color: var(--rmd-acc); color: var(--rmd-acc); }",
      "#researchMD .rmd-grade-cert-low { background: var(--rmd-warn-soft); border-color: var(--rmd-warn); color: var(--rmd-warn); }",
      "#researchMD .rmd-grade-cert-verylow { background: var(--rmd-bad-soft); border-color: var(--rmd-bad); color: var(--rmd-bad); }",
      "#researchMD .rmd-grade-cert-pending { background: var(--rmd-fill); color: var(--rmd-mut); }",
      "#researchMD .rmd-grade-badge strong { font: 700 15px var(--rmd-f); }",
      "#researchMD .rmd-grade-badge .rmd-muted { font-size: 12.5px; }",
      "#researchMD .rmd-grade-domain { border-top: 1px solid var(--rmd-line); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-grade-domain:first-of-type { border-top: 0; padding-top: 0; }",
      "#researchMD .rmd-grade-domain-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }",
      "#researchMD .rmd-grade-domain-head label { font: 600 14px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-grade-domain select { max-width: 280px; }",
      "#researchMD .rmd-grade-suggestion { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-grade-sug-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
      "#researchMD .rmd-grade-sug-tag { font: 600 11px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.05em; color: var(--rmd-mut); }",
      "#researchMD .rmd-grade-suggestion p { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--rmd-ink); }",
      "#researchMD .rmd-grade-sug-none { color: var(--rmd-mut); }",
      "#researchMD .rmd-grade-req { color: var(--rmd-bad); }",
      "#researchMD .rmd-grade-field-error { margin: 0; font: 500 12.5px var(--rmd-f); color: var(--rmd-bad); }",
      "#researchMD .rmd-grade-note { margin: 0; font-size: 12.5px; color: var(--rmd-mut); }",
      "#researchMD .rmd-grade-upgrade-row { border-top: 1px solid var(--rmd-line); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-grade-upgrade-row:first-of-type { border-top: 0; padding-top: 0; }",
      "#researchMD .rmd-grade-sof { padding: 16px 22px 48px; max-width: 1280px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 14px; }",
      "#researchMD .rmd-grade-sof-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }",
      "#researchMD .rmd-grade-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 12px; }",
      "#researchMD .rmd-grade-table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 860px; }",
      "#researchMD .rmd-grade-table caption { text-align: left; padding: 12px 14px 0; font: 600 14px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-grade-table th { text-align: left; font: 600 12px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.04em; color: var(--rmd-mut); padding: 10px 12px; border-bottom: 1px solid var(--rmd-line); white-space: nowrap; }",
      "#researchMD .rmd-grade-table td { padding: 10px 12px; border-bottom: 1px solid var(--rmd-line); vertical-align: top; color: var(--rmd-ink); }",
      "#researchMD .rmd-grade-table tr:last-child td { border-bottom: 0; }",
      "#researchMD .rmd-grade-num { font: 500 12.5px var(--rmd-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }",
      "#researchMD .rmd-grade-outcome { font-weight: 600; min-width: 140px; }",
      "#researchMD .rmd-grade-footnotes { font-size: 12px; color: var(--rmd-mut); max-width: 340px; line-height: 1.5; }",
      "#researchMD .rmd-grade-cert-cell { white-space: nowrap; }",
      "#researchMD .rmd-grade-copy-msg { font: 500 12.5px var(--rmd-f); color: var(--rmd-acc); }",
      "#researchMD .rmd-grade-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }",
      "#researchMD .rmd-grade-phone-note { margin: 0; font-size: 12.5px; color: var(--rmd-mut); }",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-grade-screen { flex: 0 0 auto; height: auto; min-height: 0; }",
      "  #researchMD .rmd-grade-layout { grid-template-columns: 1fr; flex: none; min-height: auto; padding: 12px 14px; }",
      "  #researchMD .rmd-grade-list { max-height: none; overflow-y: visible; }",
      "  #researchMD .rmd-grade-row2 { grid-template-columns: 1fr; }",
      "  #researchMD .rmd-grade-sof { padding: 12px 14px 40px; }",
      "  #researchMD .rmd-grade-domain select { max-width: none; }",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  #researchMD .rmd-grade-screen * { transition: none !important; }",
      "}"
    ].join("\n");
    D.head.appendChild(s);
  }

  /* ---- shared fragments -------------------------------------------------- */

  function topBarHtml(project, view, phone) {
    var h = [];
    h.push('<div class="rmd-studies-topbar">');
    h.push('  <div class="rmd-topbar-left">');
    h.push('    <h2 class="rmd-grade-topbar-title">GRADE &amp; Summary of Findings</h2>');
    h.push('    <span class="rmd-badge rmd-badge-pill">' + esc(project.title) + '</span>');
    h.push('  </div>');
    h.push('  <div class="rmd-topbar-actions rmd-grade-views" role="group" aria-label="GRADE views">');
    if (!phone) {
      h.push('    <button type="button" class="rmd-chip' + (view === "assess" ? " rmd-chip-active" : "") + '" data-rmd-grade-view="assess"' + (view === "assess" ? ' aria-current="true"' : '') + '>Assess</button>');
    }
    h.push('    <button type="button" class="rmd-chip' + (view === "sof" || phone ? " rmd-chip-active" : "") + '" data-rmd-grade-view="sof"' + (view === "sof" || phone ? ' aria-current="true"' : '') + '>Summary of Findings</button>');
    h.push('  </div>');
    h.push('</div>');
    return h.join("\n");
  }

  function badgeHtml(a, run) {
    var res = computeGrade(a, run);
    if (!res.ok) {
      return '<div class="rmd-grade-badge rmd-grade-cert-pending" id="rmdGradeBadge" aria-live="polite">' +
        '<strong>Not graded yet</strong><span class="rmd-muted">' + esc(res.message) + '</span></div>';
    }
    var g = res.grade;
    var cls = CERT_CLASS[g.certainty] || "pending";
    var detail = "Started at " + g.startedAt;
    if (g.downgrades.length) detail += ", down " + g.downgrades.length + " domain" + (g.downgrades.length === 1 ? "" : "s");
    if (g.upgrades.length) detail += ", up " + g.upgrades.length;
    var certText = g.certainty + " certainty";
    var explain = G.SMD_RESEARCH_EXPLAIN;
    if (explain) { try { certText = explain.grade(g.certainty); } catch (e) {} }
    return '<div class="rmd-grade-badge rmd-grade-cert-' + cls + '" id="rmdGradeBadge" aria-live="polite">' +
      '<span class="rmd-grade-symbols" aria-hidden="true">' + esc(g.symbols) + '</span>' +
      '<strong>' + esc(certText) + '</strong>' +
      '<span class="rmd-muted">' + esc(detail) + '</span></div>';
  }

  /* NNT (or NNH) from the pooled RR and the entered baseline risk per 1000. */
  function nntLine(a, run) {
    var explain = G.SMD_RESEARCH_EXPLAIN;
    if (!explain || !run || run.measure !== "RR") return "";
    var br = parseFloat(a.baselineRisk);
    if (!isFinite(br) || br <= 0) return "";
    var pooled = run.result && run.result.pooled;
    if (!pooled || pooled.effect == null) return "";
    var rr = Math.exp(pooled.effect);
    try { return explain.nnt(rr, br) || ""; } catch (e) { return ""; }
  }

  function suggestionHtml(key, sug) {
    var h = [];
    h.push('<div class="rmd-grade-suggestion" id="rmdGradeSug_' + key + '">');
    if (!sug) {
      h.push('<p class="rmd-grade-sug-none">Suggestion unavailable for this run.</p>');
      h.push('</div>');
      return h.join("\n");
    }
    h.push('  <div class="rmd-grade-sug-head">');
    h.push('    <span class="rmd-grade-sug-tag">Suggestion</span>');
    if (sug.suggested !== "no") {
      h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-grade-accept="' + key + '">Accept</button>');
    }
    h.push('  </div>');
    if (st.ai) h.push(SMD.ai.noteHtml(st.ai, key));
    if (sug.suggested === "no") {
      h.push('  <p class="rmd-grade-sug-none">No downgrade suggested. ' + esc(sug.why) + '</p>');
    } else {
      h.push('  <p>' + esc(sug.why) + ' Suggested level: ' + (sug.suggested === "very_serious" ? "very serious" : "serious") + '. Accepting fills the level and reason; edit them before saving your judgment.</p>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  function reasonError(a, key) {
    var d = a.domains[key];
    return d.level !== "no" && !String(d.reason || "").replace(/^\s+|\s+$/g, "");
  }

  /* ---- assess view (tablet) ---------------------------------------------- */

  function renderAssess(container, project, runs) {
    var pid = project.id;
    var sel = null, i;
    for (i = 0; i < runs.length; i++) {
      if (runs[i].id === st.selectedRunId) { sel = runs[i]; break; }
    }
    if (!sel) { sel = runs[0]; st.selectedRunId = sel.id; }
    var a = getAssessment(pid, sel);
    var sugs = suggestionsFor(sel, a);
    var h = [];
    h.push('<div class="rmd-grade-screen">');
    h.push(topBarHtml(project, "assess", false));
    h.push('<div class="rmd-grade-layout">');

    /* Left: outcome list, one per saved run. */
    h.push('  <div class="rmd-grade-list" role="group" aria-label="Outcomes">');
    h.push('    <div class="rmd-grade-list-head">Outcomes (' + runs.length + ')</div>');
    for (i = 0; i < runs.length; i++) {
      var r = runs[i];
      var ra = getAssessment(pid, r);
      var rg = computeGrade(ra, r);
      var selCls = r.id === sel.id ? " rmd-row-selected" : "";
      h.push('    <button type="button" class="rmd-row-btn' + selCls + '" data-rmd-grade-run="' + esc(r.id) + '">');
      h.push('      <span class="rmd-row-title">' + esc(ra.outcome || "Untitled outcome") + '</span>');
      h.push('      <span class="rmd-row-meta">');
      h.push('        <span class="rmd-badge rmd-badge-soft">' + esc(r.measure) + '</span>');
      if (rg.ok) {
        h.push('        <span>' + esc(rg.grade.symbols) + " " + esc(rg.grade.certainty) + '</span>');
      } else {
        h.push('        <span class="rmd-muted">Not graded</span>');
      }
      h.push('      </span>');
      h.push('    </button>');
    }
    h.push('  </div>');

    /* Right: GRADE form for the selected outcome. */
    h.push('  <div class="rmd-grade-form">');
    if (!st.ai) st.ai = SMD.ai.state();
    h.push(SMD.ai.barHtml(st.ai, { task: "grade", label: "GRADE suggestions", cost: 0 }));
    h.push('    <div class="rmd-card">');
    h.push('      <h3 class="rmd-card-heading">Outcome</h3>');
    h.push('      <div class="rmd-grade-row2">');
    h.push('        <div class="rmd-field"><label for="rmdGradeOutcome">Outcome name</label>');
    h.push('          <input type="text" id="rmdGradeOutcome" autocomplete="off" value="' + esc(a.outcome) + '" maxlength="180"></div>');
    h.push('        <div class="rmd-field"><label for="rmdGradeDesign">Study design</label>');
    h.push('          <select id="rmdGradeDesign">');
    h.push('            <option value="rct"' + (a.design === "rct" ? " selected" : "") + '>Randomised trials (start High)</option>');
    h.push('            <option value="observational"' + (a.design === "observational" ? " selected" : "") + '>Observational studies (start Low)</option>');
    h.push('          </select></div>');
    h.push('      </div>');
    h.push('      <div class="rmd-field"><label for="rmdGradeReviewer">Assessed by (reviewer id)</label>');
    h.push('        <input type="text" id="rmdGradeReviewer" autocomplete="off" value="' + esc(a.reviewer) + '" maxlength="120"></div>');
    h.push(badgeHtml(a, sel));
    h.push('    </div>');

    /* Five downgrade domains. */
    h.push('    <div class="rmd-card">');
    h.push('      <h3 class="rmd-card-heading">Downgrade domains</h3>');
    h.push('      <p class="rmd-grade-note">A serious judgment drops one level, very serious drops two. Every downgrade needs a reason.</p>');
    for (i = 0; i < DOMAIN_DEFS.length; i++) {
      var def = DOMAIN_DEFS[i];
      var d = a.domains[def.key];
      var sug = sugs[def.key] || null;
      var missing = reasonError(a, def.key);
      h.push('      <div class="rmd-grade-domain">');
      h.push('        <div class="rmd-grade-domain-head"><label for="rmdGradeLevel_' + def.key + '">' + esc(def.label) + '</label></div>');
      h.push('        <select id="rmdGradeLevel_' + def.key + '" data-rmd-grade-level="' + def.key + '">');
      for (var o = 0; o < LEVEL_OPTIONS.length; o++) {
        h.push('          <option value="' + LEVEL_OPTIONS[o].value + '"' + (d.level === LEVEL_OPTIONS[o].value ? " selected" : "") + '>' + LEVEL_OPTIONS[o].label + '</option>');
      }
      h.push('        </select>');
      if (def.key === "imprecision" || def.key === "inconsistency") {
        h.push(suggestionHtml(def.key, sug));
      }
      if (def.key === "imprecision") {
        h.push('        <div class="rmd-field"><label for="rmdGradeMid">Minimal important difference (optional, display scale)</label>');
        h.push('          <input type="number" step="any" id="rmdGradeMid" autocomplete="off" value="' + esc(a.mid) + '" placeholder="e.g. 0.9 for RR, -2 for MD">');
        h.push('          <span class="rmd-field-hint">Used only for the imprecision suggestion. The pooled CI is compared with this threshold and the null.</span></div>');
      }
      h.push('        <div class="rmd-field">');
      h.push('          <label for="rmdGradeReason_' + def.key + '">Reason <span class="rmd-grade-req" id="rmdGradeReq_' + def.key + '"' + (d.level === "no" ? " hidden" : "") + '>(required)</span></label>');
      h.push('          <textarea id="rmdGradeReason_' + def.key + '" rows="2" data-rmd-grade-reason="' + def.key + '" aria-describedby="rmdGradeErr_' + def.key + '"' + (d.level !== "no" ? ' aria-required="true"' : "") + '>' + esc(d.reason) + '</textarea>');
      h.push('          <p class="rmd-grade-field-error" id="rmdGradeErr_' + def.key + '" role="alert"' + (missing ? "" : " hidden") + '>Add a reason for this ' + (d.level === "very_serious" ? "very serious" : "serious") + ' judgment.</p>');
      h.push('        </div>');
      h.push('      </div>');
    }
    h.push('    </div>');

    /* Upgrades: observational only. */
    h.push('    <div class="rmd-card">');
    h.push('      <h3 class="rmd-card-heading">Upgrades</h3>');
    if (a.design !== "observational") {
      h.push('      <p class="rmd-grade-note">Upgrades apply to observational designs only. Randomised trials start at High and are not upgraded.</p>');
    } else {
      h.push('      <p class="rmd-grade-note" id="rmdGradeUpNote"' + (downTotal(a) > 0 ? "" : " hidden") + '>Upgrades are not applied while any domain is downgraded.</p>');
      for (i = 0; i < UPGRADE_DEFS.length; i++) {
        var udef = UPGRADE_DEFS[i];
        var u = a.upgrades[udef.key];
        var uMissing = Number(u.levels) > 0 && !String(u.reason || "").replace(/^\s+|\s+$/g, "");
        h.push('      <div class="rmd-grade-upgrade-row">');
        h.push('        <div class="rmd-grade-domain-head"><label for="rmdGradeUp_' + udef.key + '">' + esc(udef.label) + '</label></div>');
        h.push('        <select id="rmdGradeUp_' + udef.key + '" data-rmd-grade-up="' + udef.key + '">');
        h.push('          <option value="0"' + (Number(u.levels) === 0 ? " selected" : "") + '>None</option>');
        h.push('          <option value="1"' + (Number(u.levels) === 1 ? " selected" : "") + '>Up 1 level</option>');
        h.push('          <option value="2"' + (Number(u.levels) === 2 ? " selected" : "") + '>Up 2 levels</option>');
        h.push('        </select>');
        h.push('        <div class="rmd-field">');
        h.push('          <label for="rmdGradeUpReason_' + udef.key + '">Reason <span class="rmd-grade-req" id="rmdGradeUpReq_' + udef.key + '"' + (Number(u.levels) === 0 ? " hidden" : "") + '>(required)</span></label>');
        h.push('          <textarea id="rmdGradeUpReason_' + udef.key + '" rows="2" data-rmd-grade-upreason="' + udef.key + '" aria-describedby="rmdGradeUpErr_' + udef.key + '"' + (Number(u.levels) > 0 ? ' aria-required="true"' : "") + '>' + esc(u.reason) + '</textarea>');
        h.push('          <p class="rmd-grade-field-error" id="rmdGradeUpErr_' + udef.key + '" role="alert"' + (uMissing ? "" : " hidden") + '>Add a reason for this upgrade.</p>');
        h.push('        </div>');
        h.push('      </div>');
      }
    }
    h.push('    </div>');

    /* Absolute-effect input and persistence note. */
    h.push('    <div class="rmd-card">');
    h.push('      <h3 class="rmd-card-heading">Summary of Findings inputs</h3>');
    h.push('      <div class="rmd-field"><label for="rmdGradeBaseline">Assumed control risk per 1000 (optional)</label>');
    h.push('        <input type="number" step="any" min="0" max="1000" id="rmdGradeBaseline" autocomplete="off" value="' + esc(a.baselineRisk) + '" placeholder="e.g. 100">');
    h.push('        <span class="rmd-field-hint">For binary outcomes (RR, OR). The pooled relative effect is converted to absolute effects per 1000 with this baseline. RD needs no baseline.</span></div>');
    var nntText = nntLine(a, sel);
    h.push('      <div id="rmdGradeNnt">' + (nntText ? '<p class="rmd-what-mean">' + esc(nntText) + '</p>' : '') + '</div>');
    h.push('      <p class="rmd-grade-note">Assessments are saved on this device. Server sync ships with the Phase 4.3 API.</p>');
    h.push('    </div>');

    h.push('  </div>'); /* form */
    h.push('</div>'); /* layout */
    h.push('</div>'); /* screen */
    container.innerHTML = h.join("\n");
    bindAssess(container, project, sel);
  }

  /* Targeted updates so typing never loses focus. */
  function refreshDynamic(container, run) {
    var a = getAssessment(st.projectId, run);
    var badge = container.querySelector("#rmdGradeBadge");
    if (badge) badge.outerHTML = badgeHtml(a, run);
    var nntBox = container.querySelector("#rmdGradeNnt");
    if (nntBox) {
      var nl = nntLine(a, run);
      nntBox.innerHTML = nl ? '<p class="rmd-what-mean">' + esc(nl) + '</p>' : "";
    }
    var sugs = suggestionsFor(run, a);
    var i, key, sugBox, sug, missing, errEl, reqEl, ta;
    var sugKeys = ["imprecision", "inconsistency"];
    for (i = 0; i < sugKeys.length; i++) {
      key = sugKeys[i];
      sugBox = container.querySelector("#rmdGradeSug_" + key);
      sug = sugs[key];
      if (sugBox) {
        sugBox.outerHTML = suggestionHtml(key, sug);
        bindAccept(container, run, key);
      }
    }
    for (i = 0; i < DOMAIN_DEFS.length; i++) {
      key = DOMAIN_DEFS[i].key;
      missing = reasonError(a, key);
      errEl = container.querySelector("#rmdGradeErr_" + key);
      reqEl = container.querySelector("#rmdGradeReq_" + key);
      ta = container.querySelector("#rmdGradeReason_" + key);
      if (errEl) {
        if (missing) errEl.removeAttribute("hidden"); else errEl.setAttribute("hidden", "");
      }
      if (reqEl) {
        if (a.domains[key].level === "no") reqEl.setAttribute("hidden", ""); else reqEl.removeAttribute("hidden");
      }
      if (ta) {
        if (a.domains[key].level === "no") ta.removeAttribute("aria-required");
        else ta.setAttribute("aria-required", "true");
      }
    }
    var upNote = container.querySelector("#rmdGradeUpNote");
    if (upNote) {
      if (downTotal(a) > 0) upNote.removeAttribute("hidden"); else upNote.setAttribute("hidden", "");
    }
    for (i = 0; i < UPGRADE_DEFS.length; i++) {
      key = UPGRADE_DEFS[i].key;
      var u = a.upgrades[key];
      var uMissing = Number(u.levels) > 0 && !String(u.reason || "").replace(/^\s+|\s+$/g, "");
      var uErr = container.querySelector("#rmdGradeUpErr_" + key);
      var uReq = container.querySelector("#rmdGradeUpReq_" + key);
      var uTa = container.querySelector("#rmdGradeUpReason_" + key);
      if (uErr) {
        if (uMissing) uErr.removeAttribute("hidden"); else uErr.setAttribute("hidden", "");
      }
      if (uReq) {
        if (Number(u.levels) === 0) uReq.setAttribute("hidden", ""); else uReq.removeAttribute("hidden");
      }
      if (uTa) {
        if (Number(u.levels) === 0) uTa.removeAttribute("aria-required");
        else uTa.setAttribute("aria-required", "true");
      }
    }
    /* Keep the outcome list certainty labels current. */
    var listBtns = container.querySelectorAll("[data-rmd-grade-run]");
    var runs = getRuns(st.projectId);
    for (i = 0; i < listBtns.length; i++) {
      var rid = listBtns[i].getAttribute("data-rmd-grade-run");
      var rr = null, j;
      for (j = 0; j < runs.length; j++) { if (runs[j].id === rid) { rr = runs[j]; break; } }
      if (!rr) continue;
      var ra = getAssessment(st.projectId, rr);
      var rg = computeGrade(ra, rr);
      var meta = listBtns[i].querySelector(".rmd-row-meta");
      if (meta) {
        var label = listBtns[i].querySelector(".rmd-row-title");
        if (label) label.textContent = ra.outcome || "Untitled outcome";
        var certSpan = meta.querySelector(".rmd-grade-list-cert");
        var html = '<span class="rmd-badge rmd-badge-soft">' + esc(rr.measure) + '</span>' +
          (rg.ok
            ? '<span class="rmd-grade-list-cert">' + esc(rg.grade.symbols) + " " + esc(rg.grade.certainty) + '</span>'
            : '<span class="rmd-muted rmd-grade-list-cert">Not graded</span>');
        meta.innerHTML = html;
      }
    }
  }

  function bindAccept(container, run, key) {
    var btn = container.querySelector('[data-rmd-grade-accept="' + key + '"]');
    if (!btn) return;
    btn.onclick = function () {
      var a = getAssessment(st.projectId, run);
      var sugs = suggestionsFor(run, a);
      var sug = sugs[key];
      if (!sug || sug.suggested === "no") return;
      a.domains[key].level = sug.suggested;
      a.domains[key].reason = sug.why;
      saveAll();
      var selEl = container.querySelector("#rmdGradeLevel_" + key);
      var taEl = container.querySelector("#rmdGradeReason_" + key);
      if (selEl) selEl.value = sug.suggested;
      if (taEl) taEl.value = sug.why;
      SMD.ai.clearNote(st.ai, key);
      refreshDynamic(container, run);
    };
  }

  function bindAssess(container, project, run) {
    var pid = project.id;
    function a() { return getAssessment(pid, run); }

    var viewBtns = container.querySelectorAll("[data-rmd-grade-view]");
    for (var v = 0; v < viewBtns.length; v++) {
      viewBtns[v].onclick = function () {
        st.view = this.getAttribute("data-rmd-grade-view");
        render(container);
      };
    }
    var runBtns = container.querySelectorAll("[data-rmd-grade-run]");
    for (var b = 0; b < runBtns.length; b++) {
      runBtns[b].onclick = function () {
        st.selectedRunId = this.getAttribute("data-rmd-grade-run");
        st.ai = null;
        render(container);
      };
    }

    var outcomeEl = container.querySelector("#rmdGradeOutcome");
    if (outcomeEl) outcomeEl.oninput = function () { a().outcome = this.value; saveAll(); refreshDynamic(container, run); };

    var designEl = container.querySelector("#rmdGradeDesign");
    if (designEl) designEl.onchange = function () {
      a().design = this.value;
      saveAll();
      render(container); /* structure changes: upgrades card appears or hides */
    };

    var reviewerEl = container.querySelector("#rmdGradeReviewer");
    if (reviewerEl) reviewerEl.oninput = function () { a().reviewer = this.value; saveAll(); refreshDynamic(container, run); };

    var midEl = container.querySelector("#rmdGradeMid");
    if (midEl) midEl.oninput = function () { a().mid = this.value; saveAll(); refreshDynamic(container, run); };

    var baseEl = container.querySelector("#rmdGradeBaseline");
    if (baseEl) baseEl.oninput = function () { a().baselineRisk = this.value; saveAll(); refreshDynamic(container, run); };

    var levelSels = container.querySelectorAll("[data-rmd-grade-level]");
    for (var l = 0; l < levelSels.length; l++) {
      levelSels[l].onchange = function () {
        var key = this.getAttribute("data-rmd-grade-level");
        a().domains[key].level = this.value;
        saveAll();
        SMD.ai.clearNote(st.ai, key);
        refreshDynamic(container, run);
      };
    }
    var reasonTas = container.querySelectorAll("[data-rmd-grade-reason]");
    for (var t = 0; t < reasonTas.length; t++) {
      reasonTas[t].oninput = function () {
        var key = this.getAttribute("data-rmd-grade-reason");
        a().domains[key].reason = this.value;
        saveAll();
        SMD.ai.clearNote(st.ai, key);
        refreshDynamic(container, run);
      };
    }
    var upSels = container.querySelectorAll("[data-rmd-grade-up]");
    for (var u = 0; u < upSels.length; u++) {
      upSels[u].onchange = function () {
        var key = this.getAttribute("data-rmd-grade-up");
        a().upgrades[key].levels = Number(this.value) || 0;
        saveAll();
        refreshDynamic(container, run);
      };
    }
    var upTas = container.querySelectorAll("[data-rmd-grade-upreason]");
    for (var ut = 0; ut < upTas.length; ut++) {
      upTas[ut].oninput = function () {
        var key = this.getAttribute("data-rmd-grade-upreason");
        a().upgrades[key].reason = this.value;
        saveAll();
        refreshDynamic(container, run);
      };
    }
    bindAccept(container, run, "imprecision");
    bindAccept(container, run, "inconsistency");

    if (st.ai) {
      SMD.ai.bind(container, st.ai, {
        pid: pid, task: "grade", label: "GRADE suggestions", cost: 0,
        request: function () {
          var mid = parseFloat(a().mid);
          var q = "/v1/projects/" + encodeURIComponent(pid) + "/grade-suggestions?runId=" + encodeURIComponent(run.id);
          if (isFinite(mid)) q += "&mid=" + encodeURIComponent(mid);
          return SMD.api.request("GET", q);
        },
        apply: function (draft) {
          var d = draft || {};
          st.serverSugs[run.id] = { imprecision: d.imprecision || null, inconsistency: d.inconsistency || null };
          return ["imprecision", "inconsistency"];
        },
        render: function () { render(container); }
      });
    }
  }

  /* ---- Summary of Findings view ------------------------------------------ */

  function buildSofTable(pid, runs) {
    var rows = [], gradedRuns = [], ungraded = 0, i;
    for (i = 0; i < runs.length; i++) {
      var a = getAssessment(pid, runs[i]);
      var res = computeGrade(a, runs[i]);
      if (!res.ok) { ungraded++; continue; }
      var br = parseFloat(a.baselineRisk);
      rows.push({
        outcome: a.outcome,
        run: runs[i].result,
        grade: res.grade,
        baselineRisk: isFinite(br) ? br : undefined
      });
      gradedRuns.push(runs[i]);
    }
    return { table: grade().summaryOfFindings(rows), ungraded: ungraded, gradedRuns: gradedRuns };
  }

  function absoluteCellHtml(row, run) {
    if (row.absolute) return '<span class="rmd-grade-num">' + esc(row.absolute.text) + '</span>';
    var m = run && run.manifest ? run.manifest.measure : "";
    if (m === "RR" || m === "OR") return '<span class="rmd-muted">Add a baseline risk per 1000</span>';
    return '<span class="rmd-muted">Not applicable</span>';
  }

  function renderSof(container, project, runs, phone) {
    var built = buildSofTable(project.id, runs);
    var table = built.table;
    var h = [];
    h.push('<div class="rmd-grade-screen">');
    h.push(topBarHtml(project, "sof", phone));
    h.push('<div class="rmd-grade-sof">');
    if (phone) {
      h.push('  <p class="rmd-grade-phone-note">Read-only on phone. GRADE assessment is a tablet task.</p>');
    }
    h.push('  <div class="rmd-grade-sof-head">');
    h.push('    <p class="rmd-grade-note">' + table.rows.length + ' graded outcome' + (table.rows.length === 1 ? "" : "s") +
      (built.ungraded > 0 ? ", " + built.ungraded + " not graded yet (not in the table)." : ".") + '</p>');
    h.push('    <div class="rmd-topbar-actions">');
    if (!phone && built.ungraded > 0) {
      h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-grade-view="assess">Assess outcomes</button>');
    }
    if (table.rows.length > 0) {
      h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-grade-copy>Copy as text</button>');
      h.push('      <span class="rmd-grade-copy-msg" id="rmdGradeCopyMsg" aria-live="polite"></span>');
    }
    h.push('    </div>');
    h.push('  </div>');

    if (table.rows.length === 0) {
      h.push('  <div class="rmd-empty-state rmd-card">');
      h.push('    <h3>No graded outcomes yet</h3>');
      if (phone) {
        h.push('    <p>Assess outcomes on a tablet; the Summary of Findings builds itself from completed GRADE judgments.</p>');
      } else {
        h.push('    <p>Complete the five GRADE domains for an outcome and it appears here with its certainty and effects.</p>');
        h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-grade-view="assess">Assess an outcome</button>');
      }
      h.push('  </div>');
    } else {
      h.push('  <div class="rmd-grade-table-wrap">');
      h.push('    <table class="rmd-grade-table">');
      h.push('      <caption>Summary of Findings: ' + esc(project.title) + '</caption>');
      h.push('      <thead><tr>');
      for (var c = 0; c < table.columns.length; c++) {
        h.push('        <th scope="col">' + esc(table.columns[c].label) + '</th>');
      }
      h.push('      </tr></thead>');
      h.push('      <tbody>');
      for (var i = 0; i < table.rows.length; i++) {
        var row = table.rows[i];
        var matchRun = built.gradedRuns[i];
        h.push('        <tr>');
        h.push('          <td class="rmd-grade-outcome">' + esc(row.outcome) + '</td>');
        h.push('          <td class="rmd-grade-num">' + (row.participants === null ? "Not reported" : row.participants) + '</td>');
        h.push('          <td class="rmd-grade-num">' + row.studies + '</td>');
        h.push('          <td class="rmd-grade-num">' + esc(row.relative.text) + '</td>');
        h.push('          <td>' + absoluteCellHtml(row, matchRun) + '</td>');
        h.push('          <td class="rmd-grade-cert-cell"><span class="rmd-grade-symbols" aria-hidden="true">' + esc(row.symbols) + '</span> ' + esc(row.certainty) + '</td>');
        h.push('          <td class="rmd-grade-footnotes">' + (row.footnotes.length ? esc(row.footnotes.join("; ")) : "None") + '</td>');
        h.push('        </tr>');
      }
      h.push('      </tbody>');
      h.push('    </table>');
      h.push('  </div>');
      var sofNnt = [];
      for (var ni = 0; ni < built.gradedRuns.length; ni++) {
        var nrun = built.gradedRuns[ni];
        var na = getAssessment(project.id, nrun);
        var nl = nntLine(na, nrun);
        if (nl) sofNnt.push('<p class="rmd-what-mean">' + esc((na.outcome || "Outcome") + ": " + nl) + '</p>');
      }
      if (sofNnt.length) {
        h.push('  <div class="rmd-what-mean-box"><p class="rmd-what-mean-title">What this means</p>' + sofNnt.join("") + '</div>');
      }
      h.push('  <p class="rmd-grade-note">Certainty: ⊕⊕⊕⊕ High (we are very sure), ⊕⊕⊕◯ Moderate (probably close to the truth), ⊕⊕◯◯ Low (the real effect could be quite different), ⊕◯◯◯ Very low (we are very unsure). CI bounds use the run confidence level (default 95%). Absolute effects assume the entered control risk; Odds ratio (OR) is converted to risks per the GRADE handbook.</p>');
    }
    h.push('</div>');
    h.push('</div>');
    container.innerHTML = h.join("\n");
    bindSof(container, table);
  }

  function copyFallback(text) {
    var ta = D.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    D.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = D.execCommand("copy"); } catch (e) { ok = false; }
    D.body.removeChild(ta);
    return ok;
  }

  function bindSof(container, table) {
    var viewBtns = container.querySelectorAll("[data-rmd-grade-view]");
    for (var v = 0; v < viewBtns.length; v++) {
      viewBtns[v].onclick = function () {
        st.view = this.getAttribute("data-rmd-grade-view");
        render(container);
      };
    }
    var copyBtn = container.querySelector("[data-rmd-grade-copy]");
    if (copyBtn) {
      copyBtn.onclick = function () {
        var text = grade().summaryOfFindingsText(table);
        var msg = container.querySelector("#rmdGradeCopyMsg");
        function done(ok) {
          if (msg) msg.textContent = ok ? "Copied" : "Copy failed; select the table manually.";
          G.setTimeout(function () { if (msg) msg.textContent = ""; }, 2500);
        }
        if (G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
          G.navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(copyFallback(text)); });
        } else {
          done(copyFallback(text));
        }
      };
    }
  }

  /* ---- entry -------------------------------------------------------------- */

  function render(container) {
    injectCss();
    lastContainer = container;
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to grade its outcomes.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var toP = container.querySelector('[data-rmd="to-projects"]');
      if (toP) toP.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (st.projectId !== project.id) {
      st.projectId = project.id;
      st.selectedRunId = null;
      st.view = "assess";
      st.data = loadAll();
      st.ai = null;
      st.serverSugs = {};
      st.serverRuns = {};
      st.runsFetched = {};
      st.runsLoading = false;
      st.runsError = null;
    }
    if (!grade()) {
      container.innerHTML = '<div class="rmd-p2-screen"><div class="rmd-banner rmd-banner-error" role="alert"><strong>The GRADE module did not load.</strong><span>Update the app and reopen ResearchMD.</span></div></div>';
      return;
    }
    var runs = getRuns(project.id);
    if (runs.length === 0) {
      if (st.runsLoading) {
        container.innerHTML = '<div class="rmd-empty-state"><h3>Loading saved runs</h3><p>Checking your project for analysis runs.</p></div>';
        return;
      }
      if (canUseServer(project) && !st.runsFetched[project.id]) {
        loadServerRuns(container, project);
        return;
      }
      container.innerHTML = '<div class="rmd-empty-state"><h3>No saved runs yet</h3><p>GRADE assesses an outcome from a saved meta-analysis run. Run one first.</p>' +
        (st.runsError ? '<p>' + esc(String(st.runsError.message || "Could not load runs from your project.").replace(/[\u2014\u2013]/g, "-")) + '</p>' : '') +
        '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-run">Go to Run</button></div>';
      var toR = container.querySelector('[data-rmd="to-run"]');
      if (toR) toR.onclick = function () { SMD.navigate("run", {}); };
      return;
    }
    if (isPhone()) {
      renderSof(container, project, runs, true);
    } else if (st.view === "sof") {
      renderSof(container, project, runs, false);
    } else {
      renderAssess(container, project, runs);
    }
    bindBreakpoint();
  }

  /* Re-render when the viewport crosses the tablet breakpoint so phone
   * users never land on an editable form after rotation or split view. */
  function bindBreakpoint() {
    if (mqlBound || !G.matchMedia) return;
    try {
      var mql = G.matchMedia("(max-width: 767px)");
      var fn = function () {
        if (lastContainer && D.body && D.body.contains(lastContainer)) render(lastContainer);
      };
      if (mql.addEventListener) mql.addEventListener("change", fn);
      else if (mql.addListener) mql.addListener(fn);
      mqlBound = true;
    } catch (e) {}
  }

  SMD.screens.grade = {
    render: render,
    _getState: function () { return st; }
  };

})(typeof window !== "undefined" ? window : globalThis);
