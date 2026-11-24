/* StewardMD - ResearchMD Extraction screen (window.SMD_RESEARCH.screens.extract).
 * ES5 only, buildless, mobile-first. Phase 3.4: structured form beside the
 * offline page view (SMD.pdf). One value per field with locator + verbatim
 * quote; verify / correct with reason and audit; AI suggestions labelled
 * "Suggestion" with Accept (never auto-applied, never auto-verified); promote
 * a verified extraction to a research_studies row for the engine.
 * Routes per docs/research/contracts/phase-3/extraction.md.
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
  function pdf() { return SMD.pdf || {}; }

  var st = {
    projectId: null, loaded: false, loading: false, error: null,
    studies: [], studyId: null, templates: [], template: "rct_binary",
    extraction: null, extractionLoading: false,
    artifactId: null, result: null, page: 1, highlight: null,
    form: {}, activeField: null, correctFor: null,
    busy: false, actionError: null, announce: "",
    showAudit: false, audit: [], promoteMeasure: "RR",
    phoneView: "form"
  };
  var seq = 0;

  function templateDef() {
    for (var i = 0; i < st.templates.length; i++) if (st.templates[i].id === st.template) return st.templates[i];
    return st.templates[0] || { id: st.template, fields: [], measures: ["RR"] };
  }
  function fieldDef(key) {
    var f = templateDef().fields || [];
    for (var i = 0; i < f.length; i++) if (f[i].key === key) return f[i];
    return { key: key, label: key, type: "text", required: false };
  }
  function formFor(key) {
    if (!st.form[key]) st.form[key] = { value: "", locator: null, quote: "" };
    return st.form[key];
  }
  function statusOf(key) {
    var f = st.extraction && st.extraction.fields && st.extraction.fields[key];
    return f ? f.status : "unverified";
  }

  function load(container) {
    var mySeq = ++seq;
    st.loading = true; st.error = null;
    var base = "/v1/projects/" + encodeURIComponent(st.projectId);
    Promise.all([
      SMD.api.request("GET", base + "/studies?limit=100"),
      SMD.api.request("GET", "/v1/extraction-templates")
    ]).then(function (res) {
      if (mySeq !== seq) return;
      st.studies = (res[0] && res[0].studies) || [];
      st.templates = (res[1] && res[1].templates) || [];
      st.loading = false; st.loaded = true;
      if (!st.studyId && st.studies.length) st.studyId = st.studies[0].id;
      if (st.templates.length) st.template = st.templates[0].id;
      render(container);
      if (st.studyId) loadExtraction(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false; st.loaded = true; st.error = err; render(container);
    });
  }

  function loadExtraction(container) {
    var mySeq = ++seq;
    st.extractionLoading = true; st.extraction = null; st.actionError = null;
    render(container);
    var url = "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies/" + encodeURIComponent(st.studyId) + "/extraction?template=" + encodeURIComponent(st.template);
    SMD.api.request("GET", url).then(function (data) {
      if (mySeq !== seq) return;
      st.extractionLoading = false;
      st.extraction = data.extraction;
      st.template = st.extraction.template || st.template;
      st.form = {};
      var fields = st.extraction.fields || {};
      for (var k in fields) {
        st.form[k] = { value: fields[k].value == null ? "" : fields[k].value, locator: fields[k].locator || null, quote: fields[k].quote || "" };
      }
      var measures = templateDef().measures || ["RR"];
      st.promoteMeasure = measures[0];
      st.artifactId = st.extraction.artifactId || null;
      st.result = null; st.page = 1; st.highlight = null;
      render(container);
      if (st.artifactId) loadResult(container, st.artifactId);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.extractionLoading = false; st.actionError = err; render(container);
    });
  }

  function loadResult(container, artifactId) {
    var mySeq = ++seq;
    SMD.api.request("GET", "/v1/artifacts/" + encodeURIComponent(artifactId) + "/result").then(function (data) {
      if (mySeq !== seq) return;
      st.result = data; st.page = 1; render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.actionError = err; render(container);
    });
  }

  function currentPage() { return st.result ? pdf().pageByN(st.result, st.page) : null; }
  function citation() {
    var s = currentStudy();
    return (s && s.label) || "PDF page " + st.page;
  }
  function currentStudy() {
    for (var i = 0; i < st.studies.length; i++) if (st.studies[i].id === st.studyId) return st.studies[i];
    return null;
  }

  /* Capture the page selection into a field as locator + verbatim quote. */
  function captureInto(container, key) {
    var wrap = container.querySelector("#rmdPdfScroll");
    var cap = wrap ? pdf().captureSelection(wrap) : null;
    if (!cap) { st.actionError = { message: "Select text on the page first, then capture it as the quote for this field.", code: "no_selection" }; render(container); return; }
    var f = formFor(key);
    f.locator = pdf().locatorFromCapture(cap, st.artifactId, st.page, citation());
    f.quote = cap.quote;
    st.highlight = cap.box; st.activeField = key; st.actionError = null;
    st.announce = "Quote captured for " + fieldDef(key).label + " from page " + st.page + ".";
    render(container);
  }

  function saveDraft(container) {
    if (st.busy || !st.extraction) return;
    st.busy = true; st.actionError = null; render(container);
    var mySeq = ++seq;
    var fields = {};
    for (var k in st.form) {
      var f = st.form[k];
      fields[k] = { value: f.value === "" ? null : f.value, locator: f.locator, quote: f.quote };
    }
    var url = "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies/" + encodeURIComponent(st.studyId) + "/extraction";
    SMD.api.request("PUT", url, { template: st.template, version: st.extraction.version, fields: fields, artifactId: st.artifactId }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.extraction = data.extraction;
      st.announce = "Draft saved. Values stay unverified until you verify them.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function verifyField(container, key) {
    if (st.busy || !st.extraction) return;
    st.busy = true; st.actionError = null; render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/verify", { fieldKey: key, version: st.extraction.version }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.extraction = data.extraction; syncForm();
      st.announce = fieldDef(key).label + " verified.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function verifyAll(container) {
    if (st.busy || !st.extraction) return;
    st.busy = true; st.actionError = null; render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/verify", { version: st.extraction.version }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.extraction = data.extraction; syncForm();
      st.announce = "All complete fields verified.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function syncForm() {
    var fields = (st.extraction && st.extraction.fields) || {};
    for (var k in fields) {
      st.form[k] = { value: fields[k].value == null ? "" : fields[k].value, locator: fields[k].locator || null, quote: fields[k].quote || "" };
    }
  }

  function confirmCorrect(container, key) {
    if (st.busy || !st.extraction) return;
    var valEl = container.querySelector("#rmdCorrectValue_" + key);
    var reasonEl = container.querySelector("#rmdCorrectReason_" + key);
    var value = valEl ? valEl.value : "";
    var reason = reasonEl ? reasonEl.value : "";
    if (value === "" || !reason.trim()) { st.actionError = { message: "A correction needs a new value and a reason.", code: "invalid_correction" }; render(container); return; }
    st.busy = true; st.actionError = null; render(container);
    var mySeq = ++seq;
    var f = formFor(key);
    SMD.api.request("POST", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/correct", {
      fieldKey: key, value: isNaN(Number(value)) ? value : Number(value), locator: f.locator, quote: f.quote, reason: reason, version: st.extraction.version
    }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.extraction = data.extraction; syncForm(); st.correctFor = null;
      st.announce = "Correction saved with its reason in the audit trail.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function acceptSuggestion(container, sid) {
    if (st.busy || !st.extraction) return;
    st.busy = true; st.actionError = null; render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/suggestions/" + encodeURIComponent(sid) + "/accept", {}).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.extraction = data.extraction; syncForm();
      st.announce = "Suggestion accepted as an unverified value. Verify it before it can reach analysis.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function promote(container) {
    if (st.busy || !st.extraction) return;
    st.busy = true; st.actionError = null; render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/promote", { measure: st.promoteMeasure }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.announce = "Verified extraction promoted to a study row (" + data.study.measure + "). It is now eligible for the Run screen.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function loadAudit(container) {
    if (!st.extraction) return;
    var mySeq = ++seq;
    SMD.api.request("GET", "/v1/extractions/" + encodeURIComponent(st.extraction.id) + "/audit").then(function (data) {
      if (mySeq !== seq) return;
      st.audit = (data && data.events) || []; st.showAudit = true; render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.actionError = err; render(container);
    });
  }

  function showSource(container, key) {
    var f = st.extraction && st.extraction.fields && st.extraction.fields[key];
    var loc = (f && f.locator) || formFor(key).locator;
    if (!loc || !loc.pdf) { st.actionError = { message: "This field has no PDF locator yet. Capture a quote from the page first.", code: "no_locator" }; render(container); return; }
    st.page = loc.pdf.page; st.highlight = loc.pdf.box || null; st.phoneView = "page";
    render(container);
  }

  /* ---------- render ---------- */

  function statusBadge(status) {
    if (status === "verified") return '<span class="rmd-status-pill rmd-status-verified">Verified</span>';
    if (status === "corrected") return '<span class="rmd-status-pill rmd-status-verified">Corrected</span>';
    return '<span class="rmd-status-pill rmd-status-unverified">Unverified</span>';
  }

  function fieldHtml(key) {
    var def = fieldDef(key);
    var f = formFor(key);
    var status = statusOf(key);
    var h = [];
    h.push('<div class="rmd-extract-field" data-rmd-fieldrow="' + esc(key) + '">');
    h.push('<div class="rmd-extract-field-head"><label for="rmdField_' + esc(key) + '">' + esc(def.label) + (def.required ? ' <span class="rmd-req">*</span>' : "") + '</label>' + statusBadge(status) + '</div>');
    h.push('<input type="text" id="rmdField_' + esc(key) + '" data-rmd-field="' + esc(key) + '" value="' + esc(f.value) + '" inputmode="' + (def.type === "text" ? "text" : "decimal") + '" autocomplete="off">');
    if (f.quote) {
      h.push('<div class="rmd-quote-block smd-books-keep"><div class="rmd-quote-tag">Quote</div><blockquote>' + esc(f.quote) + '</blockquote>');
      if (f.locator && f.locator.pdf) h.push('<p class="rmd-mono-sm rmd-muted">Page ' + esc(f.locator.pdf.page) + '</p>');
      h.push('</div>');
    } else {
      h.push('<p class="rmd-muted rmd-extract-noquote">No quote yet. Select text on the page and capture it.</p>');
    }
    h.push('<div class="rmd-extract-field-actions">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-capture="' + esc(key) + '">Capture quote</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-source="' + esc(key) + '">Show source</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-verify="' + esc(key) + '"' + (st.busy ? " disabled" : "") + '>Verify</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-correct="' + esc(key) + '">Correct</button>');
    h.push('</div>');
    if (st.correctFor === key) {
      h.push('<div class="rmd-sub-card">');
      h.push('<div class="rmd-field"><label for="rmdCorrectValue_' + esc(key) + '">New value</label><input type="text" id="rmdCorrectValue_' + esc(key) + '" value="' + esc(f.value) + '"></div>');
      h.push('<div class="rmd-field"><label for="rmdCorrectReason_' + esc(key) + '">Reason (required)</label><input type="text" id="rmdCorrectReason_' + esc(key) + '" placeholder="Why the value changes"></div>');
      h.push('<div class="rmd-extract-field-actions"><button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-correct-confirm="' + esc(key) + '">Save correction</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-correct-cancel="' + esc(key) + '">Cancel</button></div>');
      h.push('</div>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  function suggestionsHtml() {
    var sugg = (st.extraction && st.extraction.suggestions) || [];
    if (!sugg.length) return "";
    var h = ['<div class="rmd-section-block"><h4 class="rmd-section-label">AI suggestions</h4>'];
    h.push('<p class="rmd-muted">Suggestions are unverified. Accepting one never verifies it; a human must verify before analysis.</p>');
    for (var i = 0; i < sugg.length; i++) {
      var s = sugg[i];
      h.push('<div class="rmd-suggestion" data-rmd-suggestion="' + esc(s.id) + '">');
      h.push('<div class="rmd-suggestion-head"><span class="rmd-badge rmd-badge-neutral">Suggestion</span><span class="rmd-muted">' + esc(fieldDef(s.fieldKey).label) + '</span></div>');
      h.push('<div class="rmd-suggestion-val">' + esc(s.value) + '</div>');
      if (s.quote) h.push('<div class="rmd-quote-block smd-books-keep"><blockquote>' + esc(s.quote) + '</blockquote></div>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-accept="' + esc(s.id) + '"' + (st.busy ? " disabled" : "") + '>Accept</button>');
      h.push('</div>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  function auditHtml() {
    if (!st.showAudit) return "";
    var h = ['<div class="rmd-section-block"><h4 class="rmd-section-label">Correction audit</h4>'];
    if (!st.audit.length) h.push('<p class="rmd-muted">No audit events yet.</p>');
    for (var i = 0; i < st.audit.length; i++) {
      var e = st.audit[i];
      h.push('<div class="rmd-audit-row">');
      h.push('<span class="rmd-badge rmd-badge-soft">' + esc(e.kind) + '</span>');
      if (e.fieldKey) h.push('<span>' + esc(fieldDef(e.fieldKey).label) + '</span>');
      if (e.kind === "corrected") h.push('<span class="rmd-mono-sm">' + esc(e.old) + ' &rarr; ' + esc(e["new"]) + '</span>');
      if (e.reason) h.push('<span class="rmd-muted">' + esc(e.reason) + '</span>');
      h.push('<span class="rmd-muted">' + esc(e.by) + ' · ' + esc(p2().fmtTs(e.ts)) + '</span>');
      h.push('</div>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  function renderFormPane() {
    var h = [];
    h.push('<div class="rmd-pane-left rmd-extract-form' + (st.phoneView !== "form" ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-pane-header"><div class="rmd-extract-selects">');
    h.push('<div class="rmd-field"><label for="rmdExtractStudy">Study</label><select id="rmdExtractStudy">');
    for (var i = 0; i < st.studies.length; i++) h.push('<option value="' + esc(st.studies[i].id) + '"' + (st.studies[i].id === st.studyId ? " selected" : "") + '>' + esc(st.studies[i].label || st.studies[i].id) + '</option>');
    h.push('</select></div>');
    h.push('<div class="rmd-field"><label for="rmdExtractTemplate">Form</label><select id="rmdExtractTemplate">');
    for (var t = 0; t < st.templates.length; t++) h.push('<option value="' + esc(st.templates[t].id) + '"' + (st.templates[t].id === st.template ? " selected" : "") + '>' + esc(st.templates[t].label) + '</option>');
    h.push('</select></div></div></div>');

    h.push('<div class="rmd-extract-form-body">');
    if (st.extractionLoading) h.push(p2().loadingHtml("Loading extraction"));
    if (st.actionError) h.push(p2().errHtml(st.actionError, null));
    if (st.announce) h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite">' + esc(st.announce) + '</div>');

    if (st.extraction) {
      var fields = templateDef().fields || [];
      for (var f = 0; f < fields.length; f++) h.push(fieldHtml(fields[f].key));
      h.push(suggestionsHtml());
      h.push('<div class="rmd-extract-field-actions rmd-extract-save-row">');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="extract-save"' + (st.busy ? " disabled" : "") + '>Save draft</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="extract-verify-all"' + (st.busy ? " disabled" : "") + '>Verify all</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="extract-audit">Audit</button>');
      h.push('</div>');
      h.push(auditHtml());
      h.push('<div class="rmd-sub-card"><h4 class="rmd-section-label">Promote to study</h4>');
      h.push('<p class="rmd-muted">Only verified fields reach analysis. Promote writes the engine-ready study row.</p>');
      h.push('<div class="rmd-field"><label for="rmdPromoteMeasure">Measure</label><select id="rmdPromoteMeasure">');
      var measures = templateDef().measures || ["RR"];
      for (var m = 0; m < measures.length; m++) h.push('<option value="' + measures[m] + '"' + (st.promoteMeasure === measures[m] ? " selected" : "") + '>' + measures[m] + '</option>');
      h.push('</select></div>');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="extract-promote"' + (st.busy ? " disabled" : "") + '>Promote verified extraction</button>');
      h.push('</div>');
    }
    h.push('</div></div>');
    return h.join("\n");
  }

  function renderPagePane() {
    var page = currentPage();
    var pageCount = st.result ? (st.result.pages || []).length : 0;
    var h = [];
    h.push('<div class="rmd-pane-right rmd-extract-page' + (st.phoneView !== "page" ? " rmd-phone-hidden" : "") + '">');
    if (!st.artifactId) {
      h.push('<div class="rmd-empty-state"><h3>No PDF attached</h3><p>This study has no full-text PDF yet. Attach one to extract values with a locator.</p></div>');
    } else if (!st.result) {
      h.push(p2().loadingHtml("Loading page text"));
    } else if (page) {
      h.push('<div class="rmd-pdf-controls">');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pdf-prev"' + (st.page <= 1 ? " disabled" : "") + '>Prev</button>');
      h.push('<span class="rmd-pdf-pageind">Page <input type="number" id="rmdPdfPage" min="1" max="' + pageCount + '" value="' + st.page + '" aria-label="Page number"> of ' + pageCount + '</span>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pdf-next"' + (st.page >= pageCount ? " disabled" : "") + '>Next</button>');
      h.push('</div>');
      if (page.ocr) h.push('<div class="rmd-banner rmd-banner-warn rmd-pdf-ocr">OCR page. Check values against the original.</div>');
      h.push('<div class="rmd-pdf-scroll" id="rmdPdfScroll" tabindex="0" aria-label="PDF page ' + st.page + '"></div>');
      h.push('<p class="rmd-muted rmd-pdf-hint">Select text, then use Capture quote on a field to pin its locator and verbatim quote.</p>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to extract data.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var tp = container.querySelector('[data-rmd="to-projects"]');
      if (tp) tp.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (st.projectId !== project.id) {
      st.projectId = project.id; st.loaded = false; st.loading = false; st.error = null;
      st.studies = []; st.studyId = null; st.extraction = null; st.form = {}; st.result = null;
      st.artifactId = null; st.page = 1; st.highlight = null; st.announce = ""; st.actionError = null; st.showAudit = false; st.audit = [];
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading extraction") + '</div>';
      load(container);
      return;
    }
    var role = project.role || "owner";
    var canEdit = role === "owner" || role === "editor" || role === "analyst";

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Extraction</h2><span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div></div>');
    if (st.error) h.push('<div style="padding:12px 16px">' + p2().errHtml(st.error, "extract-retry") + '</div>');
    h.push('<div class="rmd-phone-seg" role="tablist">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "form" ? " rmd-seg-active" : "") + '" data-rmd-extract-view="form">Form</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "page" ? " rmd-seg-active" : "") + '" data-rmd-extract-view="page">Page</button>');
    h.push('</div>');
    if (st.loaded && !st.studies.length && !st.loading) {
      h.push('<div class="rmd-empty-state"><h3>No studies to extract</h3><p>Include full-text reports on the Screening screen first.</p></div>');
    } else {
      h.push('<div class="rmd-split-layout">');
      h.push(renderFormPane());
      h.push(renderPagePane());
      h.push('</div>');
    }
    h.push('</div>');
    container.innerHTML = h.join("\n");
    bind(container, canEdit);
  }

  function bind(container, canEdit) {
    function on(sel, fn) { var els = container.querySelectorAll(sel); for (var i = 0; i < els.length; i++) els[i].onclick = fn; }
    on('[data-rmd="to-projects"]', function () { SMD.navigate("projects"); });
    on('[data-rmd="extract-retry"]', function () { st.loaded = false; render(container); });

    var viewBtns = container.querySelectorAll("[data-rmd-extract-view]");
    for (var v = 0; v < viewBtns.length; v++) viewBtns[v].onclick = function () { st.phoneView = this.getAttribute("data-rmd-extract-view"); render(container); };

    var studySel = container.querySelector("#rmdExtractStudy");
    if (studySel) studySel.onchange = function () { st.studyId = this.value; st.correctFor = null; st.showAudit = false; loadExtraction(container); };
    var tplSel = container.querySelector("#rmdExtractTemplate");
    if (tplSel) tplSel.onchange = function () { st.template = this.value; st.correctFor = null; loadExtraction(container); };

    var inputs = container.querySelectorAll("[data-rmd-field]");
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].oninput = function () { formFor(this.getAttribute("data-rmd-field")).value = this.value; };
    }
    var capBtns = container.querySelectorAll("[data-rmd-capture]");
    for (var c = 0; c < capBtns.length; c++) capBtns[c].onclick = function () { captureInto(container, this.getAttribute("data-rmd-capture")); };
    var srcBtns = container.querySelectorAll("[data-rmd-source]");
    for (var s = 0; s < srcBtns.length; s++) srcBtns[s].onclick = function () { showSource(container, this.getAttribute("data-rmd-source")); };
    var verBtns = container.querySelectorAll("[data-rmd-verify]");
    for (var b = 0; b < verBtns.length; b++) verBtns[b].onclick = function () { verifyField(container, this.getAttribute("data-rmd-verify")); };
    var corBtns = container.querySelectorAll("[data-rmd-correct]");
    for (var d = 0; d < corBtns.length; d++) corBtns[d].onclick = function () { st.correctFor = this.getAttribute("data-rmd-correct"); render(container); };
    var corOk = container.querySelectorAll("[data-rmd-correct-confirm]");
    for (var e = 0; e < corOk.length; e++) corOk[e].onclick = function () { confirmCorrect(container, this.getAttribute("data-rmd-correct-confirm")); };
    var corNo = container.querySelectorAll("[data-rmd-correct-cancel]");
    for (var f = 0; f < corNo.length; f++) corNo[f].onclick = function () { st.correctFor = null; render(container); };
    var accBtns = container.querySelectorAll("[data-rmd-accept]");
    for (var g = 0; g < accBtns.length; g++) accBtns[g].onclick = function () { acceptSuggestion(container, this.getAttribute("data-rmd-accept")); };

    on('[data-rmd="extract-save"]', function () { saveDraft(container); });
    on('[data-rmd="extract-verify-all"]', function () { verifyAll(container); });
    on('[data-rmd="extract-audit"]', function () { if (st.showAudit) { st.showAudit = false; render(container); } else loadAudit(container); });
    on('[data-rmd="extract-promote"]', function () { promote(container); });
    var pm = container.querySelector("#rmdPromoteMeasure");
    if (pm) pm.onchange = function () { st.promoteMeasure = this.value; };

    var wrap = container.querySelector("#rmdPdfScroll");
    var page = currentPage();
    if (wrap && page) pdf().fitPage(wrap, page, st.highlight);
    var pageCount = st.result ? (st.result.pages || []).length : 0;
    function go(n) { if (n < 1 || n > pageCount || n === st.page) return; st.page = n; st.highlight = null; render(container); }
    on('[data-rmd="pdf-prev"]', function () { go(st.page - 1); });
    on('[data-rmd="pdf-next"]', function () { go(st.page + 1); });
    var pi = container.querySelector("#rmdPdfPage");
    if (pi) pi.onchange = function () { go(parseInt(this.value, 10) || 1); };
  }

  SMD.screens.extract = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
