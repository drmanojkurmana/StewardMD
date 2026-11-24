/* StewardMD - ResearchMD Data screen (window.SMD_RESEARCH.screens.data).
 * ES5 only, buildless, mobile-first. Phase 3.8 (module F): study-level CSV
 * import with a data dictionary, deterministic validation checks, versions
 * and frozen R2 snapshots. Patient-level data is behind the IPD gate (5C).
 * Routes per docs/research/contracts/phase-3/data-import.md.
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

  var st = {
    projectId: null, loaded: false, loading: false, error: null,
    dictionary: null, imports: [], currentImport: null,
    file: null, preview: null, uploadInfo: null,
    busy: false, actionError: null, announce: "",
    dictDraft: null, phoneView: "import"
  };
  var seq = 0;

  function load(container) {
    var mySeq = ++seq;
    st.loading = true; st.error = null;
    var base = "/v1/projects/" + encodeURIComponent(st.projectId);
    Promise.all([
      SMD.api.request("GET", base + "/data-dictionary"),
      SMD.api.request("GET", base + "/data-imports?limit=50")
    ]).then(function (res) {
      if (mySeq !== seq) return;
      st.dictionary = (res[0] && res[0].dictionary) || { version: 1, columns: [] };
      st.imports = (res[1] && res[1].imports) || [];
      st.dictDraft = cloneDict(st.dictionary);
      st.loading = false; st.loaded = true;
      if (st.imports.length) st.currentImport = st.imports[0];
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false; st.loaded = true; st.error = err; render(container);
    });
  }

  function cloneDict(d) {
    var cols = [];
    for (var i = 0; i < (d.columns || []).length; i++) {
      var c = d.columns[i];
      cols.push({ column: c.column, label: c.label || "", type: c.type, unit: c.unit || "", required: !!c.required, range: c.range ? { min: c.range.min, max: c.range.max } : null, allowed: c.allowed ? c.allowed.slice() : null });
    }
    return { version: d.version, columns: cols };
  }

  /* Deterministic client-side preview: header + row count, no validation. */
  function previewFile(file) {
    return file.text().then(function (txt) {
      var lines = txt.split(/\r\n|\n|\r/).filter(function (l) { return l.trim() !== ""; });
      var header = lines.length ? lines[0].split(",").map(function (s) { return s.trim(); }) : [];
      return { rowCount: Math.max(0, lines.length - 1), columns: header };
    });
  }

  function uploadAndImport(container) {
    if (st.busy || !st.file) return;
    st.busy = true; st.actionError = null; st.announce = ""; render(container);
    var mySeq = ++seq;
    var fd = new FormData();
    fd.append("file", st.file);
    var base = "/v1/projects/" + encodeURIComponent(st.projectId);
    SMD.api.upload(base + "/data-uploads", fd).then(function (up) {
      if (mySeq !== seq) return;
      st.uploadInfo = up;
      return SMD.api.request("POST", base + "/data-imports", { storageKey: up.storageKey });
    }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.currentImport = data["import"];
      st.imports.unshift(data["import"]);
      var errs = countSeverity(data["import"].checks, "error");
      var warns = countSeverity(data["import"].checks, "warning");
      st.announce = "Import v" + data["import"].version + ": " + data["import"].rowsImported + " of " + data["import"].rowCount + " rows imported. " + errs + " errors, " + warns + " warnings. Snapshot frozen in R2.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function countSeverity(checks, sev) {
    var n = 0;
    for (var i = 0; i < (checks || []).length; i++) if (checks[i].severity === sev) n++;
    return n;
  }

  function saveDictionary(container) {
    if (st.busy || !st.dictDraft) return;
    st.busy = true; st.actionError = null; render(container);
    var mySeq = ++seq;
    SMD.api.request("PUT", "/v1/projects/" + encodeURIComponent(st.projectId) + "/data-dictionary", st.dictDraft).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.dictionary = data.dictionary; st.dictDraft = cloneDict(data.dictionary);
      st.announce = "Dictionary saved as version " + data.dictionary.version + ".";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function freezeImport(container, id) {
    if (st.busy) return;
    st.busy = true; st.actionError = null; render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/data-imports/" + encodeURIComponent(id) + "/freeze", {}).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.currentImport = data["import"];
      for (var i = 0; i < st.imports.length; i++) if (st.imports[i].id === id) st.imports[i] = data["import"];
      st.announce = "Import v" + data["import"].version + " frozen as the analysis dataset.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  /* ---------- render ---------- */

  function checksHtml(imp) {
    if (!imp) return "";
    var checks = imp.checks || [];
    var h = ['<div class="rmd-section-block"><h4 class="rmd-section-label">Validation checks</h4>'];
    var errs = countSeverity(checks, "error");
    if (errs) h.push('<div class="rmd-banner rmd-banner-error" role="alert">' + errs + ' blocking error' + (errs === 1 ? "" : "s") + '. Rows with errors were not imported. Fix the CSV and import a new version.</div>');
    if (!checks.length) h.push('<p class="rmd-muted">No checks triggered. Every row passed.</p>');
    h.push('<div class="rmd-data-checks" role="table" aria-label="Validation checks">');
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      h.push('<div class="rmd-data-check rmd-data-check-' + esc(c.severity) + '" role="row">');
      h.push('<span class="rmd-badge ' + (c.severity === "error" ? "rmd-badge-neutral" : "rmd-badge-soft") + '">' + esc(c.severity) + '</span>');
      h.push('<span class="rmd-mono-sm">' + esc(c.code) + '</span>');
      h.push('<span class="rmd-muted">' + (c.row != null ? "row " + c.row : "") + (c.column ? " · " + esc(c.column) : "") + '</span>');
      h.push('<span class="rmd-data-check-msg">' + esc(c.message) + '</span>');
      h.push('</div>');
    }
    h.push('</div></div>');
    return h.join("\n");
  }

  function importPaneHtml() {
    var h = [];
    h.push('<div class="rmd-pane-left rmd-data-import' + (st.phoneView !== "import" ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');
    if (st.actionError) h.push(p2().errHtml(st.actionError, null));
    if (st.announce) h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite">' + esc(st.announce) + '</div>');
    h.push('<div class="rmd-card"><h3 class="rmd-card-heading">Import study-level CSV</h3>');
    h.push('<p class="rmd-muted">One row per study. Patient-level data is blocked by the IPD gate.</p>');
    h.push('<div class="rmd-field"><label for="rmdDataFile">CSV file</label><input type="file" id="rmdDataFile" accept=".csv,text/csv"></div>');
    if (st.preview) h.push('<p class="rmd-muted">' + st.preview.rowCount + ' rows detected. Columns: ' + esc(st.preview.columns.join(", ")) + '</p>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="data-import"' + (st.busy || !st.file ? " disabled" : "") + '>Upload and validate</button>');
    h.push('</div>');

    if (st.currentImport) {
      var imp = st.currentImport;
      h.push('<div class="rmd-card"><div class="rmd-card-top"><h3 class="rmd-card-heading">Import v' + imp.version + '</h3>');
      h.push('<span class="rmd-badge ' + (imp.status === "errors" ? "rmd-badge-neutral" : "rmd-badge-pill") + '">' + esc(imp.status) + '</span></div>');
      h.push('<div class="rmd-provenance-box">');
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Rows</span><span>' + imp.rowsImported + ' / ' + imp.rowCount + ' imported</span></div>');
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Snapshot</span><span class="rmd-mono-sm">' + esc(imp.snapshotKey) + '</span></div>');
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Frozen</span><span>' + (imp.frozen ? "Yes" : "No") + '</span></div>');
      h.push('</div>');
      if (!imp.frozen) h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="data-freeze"' + (st.busy ? " disabled" : "") + '>Freeze as analysis dataset</button>');
      h.push('</div>');
      h.push(checksHtml(imp));
    }

    if (st.imports.length) {
      h.push('<div class="rmd-section-block"><h4 class="rmd-section-label">Versions</h4><div class="rmd-data-versions">');
      for (var i = 0; i < st.imports.length; i++) {
        var v = st.imports[i];
        h.push('<button type="button" class="rmd-row-btn' + (st.currentImport && v.id === st.currentImport.id ? " rmd-row-selected" : "") + '" data-rmd-version="' + esc(v.id) + '">');
        h.push('<span class="rmd-row-title">Version ' + v.version + '</span>');
        h.push('<span class="rmd-row-meta">' + esc(v.status) + ' · ' + v.rowsImported + '/' + v.rowCount + ' rows' + (v.frozen ? " · frozen" : "") + '</span>');
        h.push('</button>');
      }
      h.push('</div></div>');
    }
    h.push('</div></div>');
    return h.join("\n");
  }

  function dictionaryPaneHtml() {
    var h = [];
    h.push('<div class="rmd-pane-right rmd-data-dict' + (st.phoneView !== "dictionary" ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-section-block"><h4 class="rmd-section-label">Data dictionary (v' + (st.dictionary ? st.dictionary.version : 1) + ')</h4>');
    h.push('<p class="rmd-muted">Define each column before importing. study_id is required to link rows to studies.</p>');
    var cols = (st.dictDraft && st.dictDraft.columns) || [];
    h.push('<div class="rmd-data-dict-cols">');
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      h.push('<div class="rmd-data-dict-col" data-rmd-col="' + esc(c.column) + '">');
      h.push('<span class="rmd-mono-sm rmd-data-dict-name">' + esc(c.column) + '</span>');
      h.push('<select data-rmd-coltype="' + esc(c.column) + '" aria-label="Type of ' + esc(c.column) + '">');
      var types = ["string", "integer", "number", "date", "category"];
      for (var t = 0; t < types.length; t++) h.push('<option value="' + types[t] + '"' + (c.type === types[t] ? " selected" : "") + '>' + types[t] + '</option>');
      h.push('</select>');
      h.push('<label class="rmd-check-label rmd-data-req"><input type="checkbox" data-rmd-colreq="' + esc(c.column) + '"' + (c.required ? " checked" : "") + '> required</label>');
      h.push('</div>');
    }
    h.push('</div>');
    h.push('<div class="rmd-extract-field-actions">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="dict-add">Add column</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="dict-save"' + (st.busy ? " disabled" : "") + '>Save dictionary</button>');
    h.push('</div>');
    h.push('</div></div>');
    return h.join("\n");
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to import study data.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var tp = container.querySelector('[data-rmd="to-projects"]');
      if (tp) tp.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (st.projectId !== project.id) {
      st.projectId = project.id; st.loaded = false; st.loading = false; st.error = null;
      st.dictionary = null; st.imports = []; st.currentImport = null; st.file = null; st.preview = null; st.uploadInfo = null; st.announce = ""; st.actionError = null; st.dictDraft = null;
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading data dictionary") + '</div>';
      load(container);
      return;
    }
    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Study Data</h2><span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div></div>');
    if (st.error) h.push('<div style="padding:12px 16px">' + p2().errHtml(st.error, "data-retry") + '</div>');
    h.push('<div class="rmd-phone-seg" role="tablist">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "import" ? " rmd-seg-active" : "") + '" data-rmd-data-view="import">Import</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "dictionary" ? " rmd-seg-active" : "") + '" data-rmd-data-view="dictionary">Dictionary</button>');
    h.push('</div>');
    h.push('<div class="rmd-split-layout">');
    h.push(importPaneHtml());
    h.push(dictionaryPaneHtml());
    h.push('</div></div>');
    container.innerHTML = h.join("\n");
    bind(container);
  }

  function bind(container) {
    function on(sel, fn) { var els = container.querySelectorAll(sel); for (var i = 0; i < els.length; i++) els[i].onclick = fn; }
    on('[data-rmd="to-projects"]', function () { SMD.navigate("projects"); });
    on('[data-rmd="data-retry"]', function () { st.loaded = false; render(container); });
    var viewBtns = container.querySelectorAll("[data-rmd-data-view]");
    for (var v = 0; v < viewBtns.length; v++) viewBtns[v].onclick = function () { st.phoneView = this.getAttribute("data-rmd-data-view"); render(container); };

    var fileInput = container.querySelector("#rmdDataFile");
    if (fileInput) fileInput.onchange = function () {
      var f = this.files && this.files[0];
      st.file = f || null; st.preview = null;
      if (f) { previewFile(f).then(function (pv) { st.preview = pv; render(container); }); }
      else render(container);
    };
    on('[data-rmd="data-import"]', function () { uploadAndImport(container); });
    on('[data-rmd="data-freeze"]', function () { if (st.currentImport) freezeImport(container, st.currentImport.id); });
    var verBtns = container.querySelectorAll("[data-rmd-version]");
    for (var b = 0; b < verBtns.length; b++) verBtns[b].onclick = function () {
      var id = this.getAttribute("data-rmd-version");
      for (var i = 0; i < st.imports.length; i++) if (st.imports[i].id === id) st.currentImport = st.imports[i];
      render(container);
    };

    var typeSels = container.querySelectorAll("[data-rmd-coltype]");
    for (var t = 0; t < typeSels.length; t++) typeSels[t].onchange = function () {
      var name = this.getAttribute("data-rmd-coltype");
      for (var i = 0; i < st.dictDraft.columns.length; i++) if (st.dictDraft.columns[i].column === name) st.dictDraft.columns[i].type = this.value;
    };
    var reqBoxes = container.querySelectorAll("[data-rmd-colreq]");
    for (var r = 0; r < reqBoxes.length; r++) reqBoxes[r].onchange = function () {
      var name = this.getAttribute("data-rmd-colreq");
      for (var i = 0; i < st.dictDraft.columns.length; i++) if (st.dictDraft.columns[i].column === name) st.dictDraft.columns[i].required = this.checked;
    };
    on('[data-rmd="dict-add"]', function () {
      st.dictDraft.columns.push({ column: "column_" + (st.dictDraft.columns.length + 1), label: "", type: "number", unit: "", required: false, range: null, allowed: null });
      render(container);
    });
    on('[data-rmd="dict-save"]', function () { saveDictionary(container); });
  }

  SMD.screens.data = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
