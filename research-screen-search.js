/* StewardMD - ResearchMD Search Screen (window.SMD_RESEARCH.screens.search).
 * ES5 only, buildless, mobile-first. Phase 2.3/2.4: per-database queries with
 * a date upper bound, run history with counts, RIS/BibTeX/CSV import, dedup.
 * Contracts: docs/research/contracts/phase-2/schemas/search-run-*, import-*, dedup-*.
 * The file-upload step before import-create is outside the frozen contract;
 * this screen posts multipart to /v1/projects/{id}/import-uploads and expects
 * {storageKey} back (2.4 API builder owns that endpoint).
 */
(function (G) {
  "use strict";

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

  var DATABASES = [
    { id: "pubmed", label: "PubMed", hint: "PubMed syntax, e.g. (BCG[MeSH] OR vaccine[tiab]) AND tuberculosis[tiab]…" },
    { id: "europe_pmc", label: "Europe PMC", hint: "Europe PMC syntax, e.g. (TITLE:bcg) AND (ABSTRACT:tuberculosis)…" },
    { id: "crossref", label: "Crossref", hint: "Crossref terms, e.g. BCG vaccine tuberculosis prevention…" },
    { id: "semantic_scholar", label: "Semantic Scholar", hint: "Plain terms, e.g. BCG vaccine tuberculosis prevention…" }
  ];

  function dbLabel(id) {
    for (var i = 0; i < DATABASES.length; i++) {
      if (DATABASES[i].id === id) return DATABASES[i].label;
    }
    return id === "import" ? "Import" : id;
  }

  function todayStr() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  var st = {
    projectId: null,
    loaded: false,
    loading: false,
    error: null,
    runs: [],
    nextCursor: null,
    database: "pubmed",
    queries: { pubmed: "", europe_pmc: "", crossref: "", semantic_scholar: "" },
    dateTo: todayStr(),
    language: "",
    studyType: "",
    busy: false,
    runError: null,
    ai: null,
    importFormat: "ris",
    importFileName: "",
    importPreview: null,
    importBusy: false,
    importError: null,
    importResult: null,
    dedupBusy: false,
    dedupError: null,
    dedupResult: null,
    announce: ""
  };
  var seq = 0;
  var importFile = null;

  function p2() { return SMD.p2 || {}; }

  function load(container, cursor) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;
    var path = "/v1/projects/" + encodeURIComponent(st.projectId) + "/searches?limit=20";
    if (cursor) path += "&cursor=" + encodeURIComponent(cursor);
    SMD.api.request("GET", path).then(function (data) {
      if (mySeq !== seq) return;
      var runs = (data && data.searchRuns) || [];
      st.runs = cursor ? st.runs.concat(runs) : runs;
      st.nextCursor = (data && data.nextCursor) || null;
      st.loaded = true;
      st.loading = false;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false;
      st.loaded = true;
      st.error = err;
      render(container);
    });
  }

  function countEntries(format, text) {
    var n = 0;
    var m;
    var fmt = String(format || "").toLowerCase();
    if (fmt === "ris") {
      m = text.match(/^TY\s+-\s/gm);
      n = m ? m.length : 0;
      if (!n) {
        m = text.match(/^ER\s+-/gm);
        n = m ? m.length : 0;
      }
    } else if (fmt === "bibtex") {
      m = text.match(/^@[a-zA-Z]+\s*[{(]/gm);
      n = m ? m.length : 0;
    } else if (fmt === "csl_json" || fmt === "json") {
      try {
        var parsed = JSON.parse(text);
        if (Object.prototype.toString.call(parsed) === "[object Array]") return parsed.length;
        if (parsed && parsed.items && Object.prototype.toString.call(parsed.items) === "[object Array]") return parsed.items.length;
      } catch (e) {}
      m = text.match(/"id"\s*:/g);
      n = m ? m.length : 0;
      if (!n) {
        m = text.match(/"title"\s*:/g);
        n = m ? m.length : 0;
      }
    } else if (fmt === "endnote_xml" || fmt === "xml") {
      m = text.match(/<record\b/gi);
      n = m ? m.length : 0;
      if (!n) {
        m = text.match(/<style\b/gi);
        n = m ? m.length : 0;
      }
    } else if (fmt === "nbib") {
      m = text.match(/^PMID-\s+/gm);
      n = m ? m.length : 0;
      if (!n) {
        m = text.match(/^TI\s+-\s+/gm);
        n = m ? m.length : 0;
      }
    } else {
      var lines = text.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim()) n++;
      }
      if (n > 0) n--; // header row
    }
    return n;
  }

  function detectFormat(name) {
    var lower = String(name || "").toLowerCase();
    if (/\.ris$/.test(lower)) return "ris";
    if (/\.bib$/.test(lower) || /\.bibtex$/.test(lower)) return "bibtex";
    if (/\.json$/.test(lower)) return "csl_json";
    if (/\.xml$/.test(lower)) return "endnote_xml";
    if (/\.nbib$/.test(lower)) return "nbib";
    if (/\.csv$/.test(lower)) return "csv";
    return null;
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to search the literature.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var toP = container.querySelector('[data-rmd="to-projects"]');
      if (toP) toP.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (st.projectId !== project.id) {
      st.projectId = project.id;
      st.loaded = false;
      st.loading = false;
      st.error = null;
      st.runs = [];
      st.nextCursor = null;
      st.runError = null;
      st.ai = null;
      st.importResult = null;
      st.importError = null;
      st.importPreview = null;
      st.importFileName = "";
      st.dedupResult = null;
      st.dedupError = null;
      st.announce = "";
      importFile = null;
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading search history") + '</div>';
      load(container);
      return;
    }

    var role = project.role || "owner";
    var canRun = role === "owner" || role === "editor" || role === "analyst";
    var db = null;
    for (var i = 0; i < DATABASES.length; i++) {
      if (DATABASES[i].id === st.database) db = DATABASES[i];
    }
    var h = [];
    h.push('<div class="rmd-p2-screen">');
    h.push('<div class="rmd-screen-header"><div>');
    h.push('<h2 class="rmd-screen-title">Literature Search</h2>');
    h.push('<p class="rmd-screen-subtitle">' + esc(project.title) + '</p>');
    h.push('</div></div>');

    if (st.announce) h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite">' + esc(st.announce) + '</div>');
    if (st.error) h.push(p2().errHtml(st.error, "search-retry"));

    h.push('<div class="rmd-p2-cols">');

    // Run card
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Run a Search</h3>');
    if (canRun && !st.ai) st.ai = SMD.ai.state();
    if (canRun && st.ai) h.push(SMD.ai.barHtml(st.ai, { task: "search_query", label: "search query", cost: 2 }));
    if (st.runError) h.push(p2().errHtml(st.runError, "search-run-retry"));
    h.push('<div class="rmd-field"><span class="rmd-section-label" id="rmdDbLabel">Database</span>');
    h.push('<div class="rmd-filter-tabs" role="group" aria-labelledby="rmdDbLabel">');
    for (var d = 0; d < DATABASES.length; d++) {
      h.push('<button type="button" class="rmd-chip' + (st.database === DATABASES[d].id ? " rmd-chip-active" : "") + '" data-rmd-db="' + DATABASES[d].id + '">' + esc(DATABASES[d].label) + '</button>');
    }
    h.push('</div></div>');
    h.push('<div class="rmd-field"><label for="rmd_search_query">Query for ' + esc(db.label) + ' <span class="rmd-req">*</span></label>');
    h.push('<textarea id="rmd_search_query" rows="4" maxlength="4000" placeholder="' + esc(db.hint) + '" spellcheck="false">' + esc(st.queries[st.database]) + '</textarea>');
    h.push('<span class="rmd-field-hint">Stored verbatim on the run so the search can be replayed exactly.</span>');
    if (st.ai) h.push(SMD.ai.noteHtml(st.ai, st.database));
    h.push('</div>');
    h.push('<div class="rmd-form-row">');
    h.push('<div class="rmd-field"><label for="rmd_search_dateto">Date Upper Bound</label>');
    h.push('<input type="date" id="rmd_search_dateto" value="' + esc(st.dateTo) + '">');
    h.push('<span class="rmd-field-hint">Results up to this date. Keeps re-runs comparable.</span></div>');
    h.push('<div class="rmd-field"><label for="rmd_search_lang">Language Filter</label>');
    h.push('<select id="rmd_search_lang"><option value=""' + (st.language === "" ? " selected" : "") + '>Any language</option><option value="en"' + (st.language === "en" ? " selected" : "") + '>English</option></select></div>');
    h.push('</div>');
    h.push('<div class="rmd-field"><label for="rmd_search_type">Study Type Filter (optional)</label>');
    h.push('<input type="text" id="rmd_search_type" maxlength="120" value="' + esc(st.studyType) + '" placeholder="e.g. randomized controlled trial…" autocomplete="off"></div>');
    if (canRun) {
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-block" data-rmd="search-run"' + (st.busy ? " disabled" : "") + '>' + (st.busy ? "Searching " + esc(db.label) + "…" : "Search " + esc(db.label)) + '</button>');
      if (st.busy) h.push('<p class="rmd-muted" aria-live="polite">The connector pages through every result. Large searches can take several minutes.</p>');
    } else {
      h.push('<p class="rmd-muted">Only owner, editor or analyst can run searches.</p>');
    }
    h.push('</div>');

    // History card
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Run History (' + st.runs.length + ')</h3>');
    if (st.loading) h.push(p2().loadingHtml("Loading search history"));
    if (!st.runs.length && st.loaded && !st.loading) {
      h.push('<div class="rmd-empty-state"><h3>No searches yet</h3><p>Run a database search or import a reference file. Every run stores its query, date bound and full ID list for replay.</p></div>');
    }
    h.push('<div role="list">');
    for (var r = 0; r < st.runs.length; r++) {
      var run = st.runs[r];
      h.push('<div class="rmd-row-btn" role="listitem" style="cursor:default">');
      h.push('<span class="rmd-row-title">' + esc(dbLabel(run.database)) + ' <span class="rmd-badge rmd-badge-pill">' + run.resultCount + ' records</span></span>');
      if (run.query) h.push('<span class="rmd-row-meta rmd-mono-sm" translate="no">' + esc(run.query) + '</span>');
      h.push('<span class="rmd-row-meta">' + (run.dateTo ? "Up to " + esc(run.dateTo) + " · " : "") + esc(p2().fmtTs(run.createdTs)) + (run.apiVersion ? ' · API <span translate="no">' + esc(run.apiVersion) + '</span>' : "") + '</span>');
      h.push('</div>');
    }
    h.push('</div>');
    if (st.nextCursor) {
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="search-more">Load More Runs</button>');
    }
    h.push('</div>');

    h.push('</div>'); // cols

    h.push('<div class="rmd-p2-cols">');

    // Import card
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Import References</h3>');
    h.push('<p class="rmd-muted">RIS, BibTeX, CSL-JSON, EndNote XML, NBIB, or CSV from your reference manager or database. Entries are normalised and deduplicated deterministically; nothing is silently dropped.</p>');
    h.push('<div class="rmd-field">');
    h.push('<span class="rmd-section-label">Supported formats and export guides</span>');
    h.push('<ul class="rmd-tips-list" style="list-style:none;padding:0;margin:6px 0 0;display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--rmd-mut);">');
    h.push('  <li><strong style="color:var(--rmd-ink);">Zotero:</strong> Right-click your collection, choose Export Collection, and select Better CSL JSON or CSL JSON (.json) or RIS (.ris).</li>');
    h.push('  <li><strong style="color:var(--rmd-ink);">Mendeley:</strong> Select reference entries, choose File &gt; Export, and select CSL-JSON (.json) or RIS (.ris).</li>');
    h.push('  <li><strong style="color:var(--rmd-ink);">EndNote:</strong> Select File &gt; Export, choose XML format (.xml) or RIS (.ris) with Output Style set to EndNote Export.</li>');
    h.push('  <li><strong style="color:var(--rmd-ink);">PubMed (NBIB):</strong> On PubMed, click Save &gt; Selection or All results &gt; Format: PubMed / Summary (.nbib).</li>');
    h.push('  <li><strong style="color:var(--rmd-ink);">BibTeX / CSV:</strong> From Google Scholar, Scopus, or spreadsheets, export as BibTeX (.bib) or CSV (.csv).</li>');
    h.push('</ul>');
    h.push('</div>');
    if (st.importError) h.push(p2().errHtml(st.importError, null));
    if (st.importResult) {
      var added = st.importResult.added != null ? st.importResult.added : (st.importResult.recordsAdded != null ? st.importResult.recordsAdded : 0);
      var dups = st.importResult.duplicates != null ? st.importResult.duplicates : (st.importResult.duplicatesFlagged != null ? st.importResult.duplicatesFlagged : 0);
      h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite"><strong>Import complete: ' + added + ' added, ' + dups + ' duplicates flagged (already in the project or repeated in this file).</strong>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="to-screening">Open Screening</button></div>');
    }
    h.push('<div class="rmd-field"><label for="rmd_import_file">Reference File</label>');
    h.push('<input type="file" id="rmd_import_file" accept=".ris,.bib,.json,.xml,.nbib,.csv"></div>');
    h.push('<div class="rmd-field"><label for="rmd_import_format">Format</label>');
    h.push('<select id="rmd_import_format">');
    h.push('<option value="ris"' + (st.importFormat === "ris" ? " selected" : "") + '>RIS (.ris)</option>');
    h.push('<option value="bibtex"' + (st.importFormat === "bibtex" ? " selected" : "") + '>BibTeX (.bib)</option>');
    h.push('<option value="csl_json"' + ((st.importFormat === "csl_json" || st.importFormat === "json") ? " selected" : "") + '>CSL-JSON (.json) - Zotero / Mendeley</option>');
    h.push('<option value="endnote_xml"' + ((st.importFormat === "endnote_xml" || st.importFormat === "xml") ? " selected" : "") + '>EndNote XML (.xml)</option>');
    h.push('<option value="nbib"' + (st.importFormat === "nbib" ? " selected" : "") + '>NBIB (.nbib) - PubMed</option>');
    h.push('<option value="csv"' + (st.importFormat === "csv" ? " selected" : "") + '>CSV (.csv)</option>');
    h.push('</select></div>');
    if (st.importPreview != null) {
      h.push('<p class="rmd-muted" aria-live="polite">' + esc(st.importFileName) + ': ' + st.importPreview + ' entries detected.</p>');
    }
    if (canRun) {
      h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="import-run"' + (st.importBusy || !importFile ? " disabled" : "") + '>' + (st.importBusy ? "Importing…" : "Import References") + '</button>');
    } else {
      h.push('<p class="rmd-muted">Only owner, editor or analyst can import.</p>');
    }
    h.push('</div>');

    // Dedup card
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Remove Duplicates</h3>');
    h.push('<p class="rmd-muted">Deterministic matching: DOI exact, then PMID exact, then normalised title. The earliest record stays canonical; duplicates are flagged, never deleted, so PRISMA can account for every record.</p>');
    if (st.dedupError) h.push(p2().errHtml(st.dedupError, null));
    if (st.dedupResult) {
      h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite"><strong>' + st.dedupResult.duplicatesRemoved + ' duplicates removed across ' + st.dedupResult.groupsCreated + ' groups.</strong>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="to-screening">Open Screening</button></div>');
    }
    if (canRun) {
      h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="dedup-run"' + (st.dedupBusy ? " disabled" : "") + '>' + (st.dedupBusy ? "Deduplicating…" : "Run Deduplication") + '</button>');
    }
    h.push('</div>');

    h.push('</div>'); // cols
    h.push('</div>');
    container.innerHTML = h.join("\n");
    bindEvents(container, project);
  }

  function runSearch(container, project) {
    var query = (st.queries[st.database] || "").trim();
    if (!query) {
      st.runError = { message: "Enter a query for " + dbLabel(st.database) + " before running.", code: "invalid_search" };
      render(container);
      return;
    }
    var filters = {};
    if (st.language) filters.language = st.language;
    if (st.studyType.trim()) filters.studyType = st.studyType.trim();
    var body = { database: st.database, query: query, filters: filters };
    if (st.dateTo) body.dateTo = st.dateTo;
    st.busy = true;
    st.runError = null;
    st.announce = "";
    render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(project.id) + "/searches", body).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false;
      var run = data.searchRun;
      st.runs.unshift(run);
      st.announce = dbLabel(run.database) + " search complete: " + run.resultCount + " records. The full ID list is archived for replay.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.runError = err;
      render(container);
    });
  }

  function runImport(container, project) {
    if (!importFile) return;
    st.importBusy = true;
    st.importError = null;
    st.importResult = null;
    render(container);
    var mySeq = ++seq;
    var form = new FormData();
    form.append("file", importFile, st.importFileName || "references." + st.importFormat);
    SMD.api.upload("/v1/projects/" + encodeURIComponent(project.id) + "/import-uploads", form).then(function (up) {
      if (mySeq !== seq) return;
      var key = up && (up.storageKey || up.key);
      if (!key) throw { message: "Upload did not return a storage key.", code: "upload_failed" };
      return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(project.id) + "/imports", {
        format: st.importFormat,
        storageKey: key
      });
    }).then(function (data) {
      if (mySeq !== seq) return;
      st.importBusy = false;
      st.importResult = (data && data.import) || data || {};
      st.importPreview = null;
      st.importFileName = "";
      importFile = null;
      st.loaded = false;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.importBusy = false;
      st.importError = err;
      render(container);
    });
  }

  function runDedup(container, project) {
    st.dedupBusy = true;
    st.dedupError = null;
    st.dedupResult = null;
    render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(project.id) + "/dedup:run", { algorithm: "deterministic-v1" }).then(function (data) {
      if (mySeq !== seq) return;
      st.dedupBusy = false;
      st.dedupResult = data.dedupRun;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.dedupBusy = false;
      st.dedupError = err;
      render(container);
    });
  }

  function bindEvents(container, project) {
    function on(sel, fn) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].onclick = fn;
    }
    on('[data-rmd="to-projects"]', function () { SMD.navigate("projects"); });
    on('[data-rmd="to-screening"]', function () { SMD.navigate("screening", {}); });
    on('[data-rmd="search-retry"]', function () { st.loaded = false; render(container); });
    on('[data-rmd="search-run-retry"]', function () { runSearch(container, project); });
    on('[data-rmd="search-run"]', function () { runSearch(container, project); });
    on('[data-rmd="search-more"]', function () { load(container, st.nextCursor); });
    on('[data-rmd="import-run"]', function () { runImport(container, project); });
    on('[data-rmd="dedup-run"]', function () { runDedup(container, project); });

    var dbBtns = container.querySelectorAll("[data-rmd-db]");
    for (var d = 0; d < dbBtns.length; d++) {
      dbBtns[d].onclick = function () {
        st.database = this.getAttribute("data-rmd-db");
        render(container);
      };
    }

    var q = container.querySelector("#rmd_search_query");
    if (q) q.oninput = function () { st.queries[st.database] = this.value; SMD.ai.clearNote(st.ai, st.database); };
    var dt = container.querySelector("#rmd_search_dateto");
    if (dt) dt.onchange = function () { st.dateTo = this.value; };
    var lang = container.querySelector("#rmd_search_lang");
    if (lang) lang.onchange = function () { st.language = this.value; };
    var type = container.querySelector("#rmd_search_type");
    if (type) type.oninput = function () { st.studyType = this.value; };

    if (st.ai) {
      SMD.ai.bind(container, st.ai, {
        pid: project.id, task: "search_query", label: "search query", cost: 2,
        input: function () {
          return {
            researchQuestion: project.researchQuestion || "",
            title: project.title || "",
            studyType: st.studyType || project.studyType || ""
          };
        },
        apply: function (draft) {
          var d = draft || {};
          var keys = [];
          if (typeof d.pubmed === "string" && d.pubmed) { st.queries.pubmed = d.pubmed; keys.push("pubmed"); }
          if (typeof d.europePmc === "string" && d.europePmc) { st.queries.europe_pmc = d.europePmc; keys.push("europe_pmc"); }
          return keys;
        },
        render: function () { render(container); }
      });
    }

    var fmt = container.querySelector("#rmd_import_format");
    if (fmt) fmt.onchange = function () {
      st.importFormat = this.value;
      if (importFile) previewFile();
      render(container);
    };

    function previewFile() {
      if (!importFile) return;
      var reader = new FileReader();
      reader.onload = function () {
        st.importPreview = countEntries(st.importFormat, String(reader.result || ""));
        render(container);
      };
      reader.onerror = function () {
        st.importError = { message: "Could not read the file. Try selecting it again.", code: "file_read" };
        render(container);
      };
      reader.readAsText(importFile);
    }

    var fileInput = container.querySelector("#rmd_import_file");
    if (fileInput) fileInput.onchange = function () {
      var f = this.files && this.files[0];
      importFile = f || null;
      st.importResult = null;
      st.importError = null;
      if (f) {
        st.importFileName = f.name;
        var detected = detectFormat(f.name);
        if (detected) st.importFormat = detected;
        previewFile();
      } else {
        st.importPreview = null;
        st.importFileName = "";
      }
      render(container);
    };
  }

  SMD.screens.search = {
    render: render,
    countEntries: countEntries
  };

})(typeof window !== "undefined" ? window : globalThis);