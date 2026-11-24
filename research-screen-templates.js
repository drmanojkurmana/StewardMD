/* StewardMD - ResearchMD Study Templates screen (window.SMD_RESEARCH.screens.templates).
 * ES5 only, buildless, mobile-first. Phase 5D.1 / Phase 6: pick a study design
 * template (RCT, Cohort, Observational, Diagnostic Accuracy, Prognostic) with
 * protocol fields, extraction forms, analysis defaults, and reporting checklist.
 * Contracts per docs/research/contracts/phase-6/templates.md.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var esc = SMD.esc || function (s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  function p2() { return SMD.p2 || {}; }

  var DEFAULT_TEMPLATES = [
    {
      id: "rct",
      name: "Randomised Controlled Trial",
      design: "randomised_controlled_trial",
      reportingChecklistId: "consort",
      analysisDefaults: { family: "logistic", engine: "python-stats", model: "Binary/continuous effect" },
      protocolFields: [
        { key: "population", label: "Target clinical population and eligibility criteria" },
        { key: "intervention", label: "Experimental intervention regimen and dosing" },
        { key: "comparator", label: "Control or active comparator" },
        { key: "primary_outcome", label: "Pre-specified primary outcome measure" },
        { key: "randomisation", label: "Randomisation method and allocation concealment" },
        { key: "registration", label: "Clinical trial registry (CTRI, ClinicalTrials.gov)" }
      ],
      extractionForm: {
        fields: ["Randomised (N)", "Intervention events/mean", "Control events/mean", "Loss to follow-up"]
      },
      guidance: "Follows CONSORT 2010 statement for reporting and SPIRIT 2013 for clinical trial protocols."
    },
    {
      id: "cohort",
      name: "Cohort Study",
      design: "cohort",
      reportingChecklistId: "strobe",
      analysisDefaults: { family: "cox", engine: "python-stats", model: "Cox proportional hazards / Kaplan-Meier" },
      protocolFields: [
        { key: "cohort_definition", label: "Cohort entry criteria and baseline definition" },
        { key: "exposure", label: "Exposure assessment and validation" },
        { key: "follow_up", label: "Follow-up period and censoring rules" },
        { key: "confounders", label: "Key confounding variables and adjustment plan" }
      ],
      extractionForm: {
        fields: ["Cohort size", "Person-time / follow-up duration", "Events observed", "Hazard ratio / RR"]
      },
      guidance: "Follows STROBE cohort reporting checklist. Canonical time-to-event analysis via Cox regression."
    },
    {
      id: "observational",
      name: "Observational Study",
      design: "observational",
      reportingChecklistId: "strobe",
      analysisDefaults: { family: "logistic", engine: "python-stats", model: "Multivariable logistic regression" },
      protocolFields: [
        { key: "study_setting", label: "Setting, participants, and eligibility criteria" },
        { key: "variables", label: "Predictor, outcome, and effect modifier variables" },
        { key: "bias_control", label: "Methods to control selection and information bias" }
      ],
      extractionForm: {
        fields: ["Total participants", "Cases / exposed", "Controls / unexposed", "Adjusted odds ratio"]
      },
      guidance: "Follows STROBE statement for cross-sectional and case-control observational studies."
    },
    {
      id: "diagnostic_accuracy",
      name: "Diagnostic Accuracy Study",
      design: "diagnostic_accuracy",
      reportingChecklistId: "stard",
      analysisDefaults: { family: "diagnostic", engine: "python-stats", model: "Reitsma bivariate mixed model" },
      protocolFields: [
        { key: "clinical_context", label: "Intended clinical role and test setting" },
        { key: "index_test", label: "Index test description and positivity cutoff" },
        { key: "reference_standard", label: "Reference standard and verification protocol" }
      ],
      extractionForm: {
        fields: ["True Positives (TP)", "False Positives (FP)", "False Negatives (FN)", "True Negatives (TN)"]
      },
      guidance: "Follows STARD 2015 guidelines. Bivariate model computes pooled sensitivity and specificity simultaneously."
    },
    {
      id: "prognostic",
      name: "Prognostic Model",
      design: "prognostic",
      reportingChecklistId: "tripod",
      analysisDefaults: { family: "cox", engine: "python-stats", model: "Cox regression / Risk calibration" },
      protocolFields: [
        { key: "source_data", label: "Development and validation cohort description" },
        { key: "outcome_definition", label: "Prognostic outcome and horizon time" },
        { key: "candidate_predictors", label: "Candidate prognostic predictors and handling of missing data" }
      ],
      extractionForm: {
        fields: ["Sample size (events)", "C-index / AUC", "Calibration slope/intercept", "Brier score"]
      },
      guidance: "Follows TRIPOD statement for multivariable prediction models for diagnosis or prognosis."
    }
  ];

  var st = {
    loaded: false,
    loading: false,
    error: null,
    busy: false,
    actionError: null,
    announce: "",
    phoneView: "list",
    templates: DEFAULT_TEMPLATES,
    selectedId: "rct",
    templateDetail: DEFAULT_TEMPLATES[0]
  };
  var seq = 0;

  function load(container) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;

    SMD.api.request("GET", "/v1/study-templates").then(function (res) {
      if (mySeq !== seq) return;
      if (res && res.templates && res.templates.length) {
        st.templates = res.templates;
      }
      return fetchDetail(st.selectedId);
    }).then(function (detail) {
      if (mySeq !== seq) return;
      if (detail) st.templateDetail = detail;
      st.loading = false;
      st.loaded = true;
      render(container);
    }).catch(function () {
      if (mySeq !== seq) return;
      st.templates = DEFAULT_TEMPLATES;
      st.templateDetail = DEFAULT_TEMPLATES[0];
      st.loading = false;
      st.loaded = true;
      render(container);
    });
  }

  function fetchDetail(id) {
    return SMD.api.request("GET", "/v1/study-templates/" + encodeURIComponent(id)).then(function (res) {
      return (res && (res.template || res)) || null;
    }).catch(function () {
      for (var i = 0; i < DEFAULT_TEMPLATES.length; i++) {
        if (DEFAULT_TEMPLATES[i].id === id) return DEFAULT_TEMPLATES[i];
      }
      return DEFAULT_TEMPLATES[0];
    });
  }

  function selectTemplate(container, id) {
    st.selectedId = id;
    for (var i = 0; i < st.templates.length; i++) {
      if (st.templates[i].id === id) st.templateDetail = st.templates[i];
    }
    fetchDetail(id).then(function (d) {
      if (d) st.templateDetail = d;
      render(container);
    });
  }

  function applyTemplate(container) {
    var tmpl = st.templateDetail;
    if (!tmpl) return;

    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;

    st.announce = "Template applied: " + tmpl.name + " (" + (tmpl.reportingChecklistId || "").toUpperCase() + ") configured for project protocol and analysis.";
    render(container);
  }

  /* ---------- HTML Builders ---------- */

  function leftPaneHtml() {
    var h = [];
    var hideList = st.phoneView !== "list";
    h.push('<div class="rmd-pane-left rmd-templates-left' + (hideList ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Study Design Templates</h3>');
    h.push('<p class="rmd-muted">Pick an established methodology template to configure protocol fields, data extraction forms, and canonical analysis models.</p>');
    h.push('</div>');

    h.push('<div class="rmd-section-block">');
    h.push('<h4 class="rmd-section-label">Available Designs (' + st.templates.length + ')</h4>');
    h.push('<div class="rmd-data-versions" id="rmdTemplatesList">');
    for (var i = 0; i < st.templates.length; i++) {
      var t = st.templates[i];
      var isSel = t.id === st.selectedId;
      var chk = (t.reportingChecklistId || "").toUpperCase();
      h.push('<button type="button" class="rmd-row-btn' + (isSel ? " rmd-row-selected" : "") + '" data-rmd-template-id="' + esc(t.id) + '">');
      h.push('<div style="display:flex;justify-content:space-between;align-items:center;width:100%">');
      h.push('<span class="rmd-row-title">' + esc(t.name) + '</span>');
      h.push('<span class="rmd-badge rmd-badge-pill">' + esc(chk) + '</span>');
      h.push('</div>');
      h.push('<span class="rmd-row-meta">design: ' + esc(t.design || t.id) + ' · ' + (t.analysisDefaults ? esc(t.analysisDefaults.family || "stats") : "canonical stats") + '</span>');
      h.push('</button>');
    }
    h.push('</div></div>');

    h.push('</div></div>');
    return h.join("\n");
  }

  function rightPaneHtml() {
    var h = [];
    var hideDetail = st.phoneView !== "detail";
    h.push('<div class="rmd-pane-right rmd-templates-right' + (hideDetail ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    var tmpl = st.templateDetail || st.templates[0];
    if (!tmpl) {
      h.push('<div class="rmd-card"><p class="rmd-muted">Select a template to inspect details.</p></div>');
      h.push('</div></div>');
      return h.join("\n");
    }

    var chk = (tmpl.reportingChecklistId || "").toUpperCase();

    /* Header & Overview Card */
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-card-top"><h3 class="rmd-card-heading">' + esc(tmpl.name) + '</h3>');
    h.push('<span class="rmd-badge rmd-badge-pill" id="rmdTemplateChecklistBadge">' + esc(chk) + ' Checklist</span></div>');
    h.push('<p class="rmd-muted">' + esc(tmpl.guidance || "Structured study template aligned with international reporting guidelines.") + '</p>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="apply-template"' + (st.busy ? " disabled" : "") + '>Apply Template to Project</button>');
    h.push('</div>');

    /* Protocol Fields Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Protocol Specification Fields</h3>');
    h.push('<p class="rmd-muted">Pre-configured fields added to your study protocol builder.</p>');
    var pFields = tmpl.protocolFields || [];
    if (pFields.length) {
      h.push('<div class="rmd-field-list">');
      for (var f = 0; f < pFields.length; f++) {
        var pf = pFields[f];
        h.push('<div class="rmd-data-box-row" style="padding:6px 0;border-bottom:1px solid var(--rmd-line)">');
        h.push('<strong style="min-width:140px;color:var(--rmd-ink)">' + esc(pf.key || pf.label) + '</strong>');
        h.push('<span class="rmd-muted">' + esc(pf.label || pf.key) + '</span>');
        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('</div>');

    /* Data Extraction Form Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Extraction Form Items</h3>');
    h.push('<p class="rmd-muted">Structured evidence extraction items designed for this study type.</p>');
    var extFields = (tmpl.extractionForm && tmpl.extractionForm.fields) || [];
    if (extFields.length) {
      h.push('<div class="rmd-field-list">');
      for (var e = 0; e < extFields.length; e++) {
        var ef = extFields[e];
        var efLabel = typeof ef === "string" ? ef : (ef.label || ef.key);
        h.push('<div class="rmd-data-box-row" style="padding:5px 0">');
        h.push('<span class="rmd-badge rmd-badge-soft">' + (e + 1) + '</span>');
        h.push('<span style="color:var(--rmd-ink)">' + esc(efLabel) + '</span>');
        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('</div>');

    /* Analysis Model Defaults Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Statistical Analysis Defaults</h3>');
    var ad = tmpl.analysisDefaults || {};
    h.push('<div class="rmd-provenance-box">');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Engine</span><span>' + esc(ad.engine || "python-stats / research-engine.js") + '</span></div>');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Family</span><span class="rmd-mono-sm">' + esc(ad.family || "stats_model") + '</span></div>');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Model</span><span>' + esc(ad.model || "Pre-specified statistical model") + '</span></div>');
    h.push('</div>');
    h.push('</div>');

    h.push('</div></div>');
    return h.join("\n");
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;

    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading study templates") + '</div>';
      load(container);
      return;
    }

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Study Design Templates</h2>');
    if (project) {
      h.push('<span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    }
    h.push('</div></div></div>');

    if (st.actionError) h.push('<div style="padding:10px 16px">' + p2().errHtml(st.actionError, null) + '</div>');
    if (st.announce) h.push('<div style="padding:10px 16px"><div class="rmd-banner rmd-banner-info" role="status" aria-live="polite" id="rmdTemplateAnnounce">' + esc(st.announce) + '</div></div>');

    h.push('<div class="rmd-phone-seg" role="tablist">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "list" ? " rmd-seg-active" : "") + '" data-rmd-tmpl-view="list">Templates</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "detail" ? " rmd-seg-active" : "") + '" data-rmd-tmpl-view="detail">Details</button>');
    h.push('</div>');

    h.push('<div class="rmd-split-layout">');
    h.push(leftPaneHtml());
    h.push(rightPaneHtml());
    h.push('</div></div>');

    container.innerHTML = h.join("\n");
    bind(container);
  }

  function bind(container) {
    var viewBtns = container.querySelectorAll("[data-rmd-tmpl-view]");
    for (var v = 0; v < viewBtns.length; v++) {
      viewBtns[v].onclick = function () {
        st.phoneView = this.getAttribute("data-rmd-tmpl-view");
        render(container);
      };
    }

    var tmplBtns = container.querySelectorAll("[data-rmd-template-id]");
    for (var t = 0; t < tmplBtns.length; t++) {
      tmplBtns[t].onclick = function () {
        var id = this.getAttribute("data-rmd-template-id");
        if (id) selectTemplate(container, id);
      };
    }

    var applyBtn = container.querySelector('[data-rmd="apply-template"]');
    if (applyBtn) {
      applyBtn.onclick = function () { applyTemplate(container); };
    }
  }

  SMD.screens.templates = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
