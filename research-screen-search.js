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

  var TRIALS_FLAG = "smd_research_trials";

  function trialsFlagOn() {
    try {
      return !!(G.localStorage && G.localStorage.getItem(TRIALS_FLAG) !== "0");
    } catch (e) {
      return false;
    }
  }

  var DATABASES = [
    { id: "pubmed", label: "PubMed", hint: "PubMed syntax, e.g. (BCG[MeSH] OR vaccine[tiab]) AND tuberculosis[tiab]…" },
    { id: "europe_pmc", label: "Europe PMC", hint: "Europe PMC syntax, e.g. (TITLE:bcg) AND (ABSTRACT:tuberculosis)…" },
    { id: "crossref", label: "Crossref", hint: "Crossref terms, e.g. BCG vaccine tuberculosis prevention…" },
    { id: "semantic_scholar", label: "Semantic Scholar", hint: "Plain terms, e.g. BCG vaccine tuberculosis prevention…" }
  ];

  var TRIAL_PHASES = [
    { id: "", label: "Any phase" },
    { id: "EARLY_PHASE1", label: "Early Phase 1" },
    { id: "PHASE1", label: "Phase 1" },
    { id: "PHASE2", label: "Phase 2" },
    { id: "PHASE3", label: "Phase 3" },
    { id: "PHASE4", label: "Phase 4" },
    { id: "NA", label: "Not applicable" }
  ];

  var TRIAL_STATUSES = [
    { id: "", label: "Any status" },
    { id: "RECRUITING", label: "Recruiting" },
    { id: "NOT_YET_RECRUITING", label: "Not yet recruiting" },
    { id: "ACTIVE_NOT_RECRUITING", label: "Active, not recruiting" },
    { id: "COMPLETED", label: "Completed" },
    { id: "TERMINATED", label: "Terminated" },
    { id: "SUSPENDED", label: "Suspended" },
    { id: "WITHDRAWN", label: "Withdrawn" }
  ];

  function dbLabel(id) {
    if (id === "clinicaltrials") return "Trials";
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
    topicQuery: "",
    topicBusy: false,
    topicSearched: false,
    topicError: null,
    topicResults: [],
    topicExpanded: {},
    topicAdding: {},
    topicAdded: {},
    topicAddingAll: false,
    topicStudyAdded: {},
    importFormat: "ris",
    importFileName: "",
    importPreview: null,
    importBusy: false,
    importError: null,
    importResult: null,
    dedupBusy: false,
    dedupError: null,
    dedupResult: null,
    trialsStatusLoaded: false,
    trialsStatusLoading: false,
    trialsAvailable: false,
    trialsNct: "",
    trialsCondition: "",
    trialsIntervention: "",
    trialsPhase: "",
    trialsStatus: "",
    trialsBusy: false,
    trialsSearched: false,
    trialsError: null,
    trialsResults: [],
    trialsNextToken: null,
    trialsTotalCount: 0,
    announce: ""
  };
  var seq = 0;
  var trialsSeq = 0;
  var trialsProbeSeq = 0;
  var importFile = null;

  function p2() { return SMD.p2 || {}; }

  function apiPidFor(project) {
    return (project && project.serverId) || (project && project.id) || st.projectId;
  }

  function load(container, cursor) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;
    var store = SMD.store;
    var proj = (store && store.getActiveProject) ? store.getActiveProject() : null;
    var path = "/v1/projects/" + encodeURIComponent(apiPidFor(proj)) + "/searches?limit=20";
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

  function detectFormat(name, text) {
    var lower = String(name || "").toLowerCase();
    if (/\.ris$/.test(lower)) return "ris";
    if (/\.bib$/.test(lower) || /\.bibtex$/.test(lower)) return "bibtex";
    if (/\.json$/.test(lower)) return "csl_json";
    if (/\.xml$/.test(lower)) return "endnote_xml";
    if (/\.nbib$/.test(lower)) return "nbib";
    if (/\.csv$/.test(lower)) return "csv";
    if (text) {
      var s = String(text).slice(0, 8000);
      if (/^PMID-\s/m.test(s) || /^TI\s+-\s/m.test(s)) return "nbib";
      if (/^TY\s+-\s/m.test(s)) return "ris";
      if (/^@[a-zA-Z]+\s*[{(]/m.test(s)) return "bibtex";
      if (/<record\b/i.test(s)) return "endnote_xml";
      if (/^\s*[\[{]/.test(s)) return "csl_json";
    }
    if (/\.txt$/.test(lower)) return "nbib";
    return null;
  }

  function topicItemKey(item) {
    if (!item) return "";
    if (item.pmid) return "pmid:" + item.pmid;
    if (item.doi) return "doi:" + String(item.doi).toLowerCase();
    return "t:" + String(item.title || "").toLowerCase().slice(0, 80) + ":" + String(item.year || "");
  }

  function formatSourceBadge(item) {
    var srcs = (item && item.sources && item.sources.length) ? item.sources : (item && item.source ? [item.source] : []);
    var names = [];
    for (var i = 0; i < srcs.length; i++) {
      var lbl = srcs[i] === "pubmed" ? "PubMed" : (srcs[i] === "europe_pmc" ? "Europe PMC" : (srcs[i] === "crossref" ? "Crossref" : srcs[i]));
      if (names.indexOf(lbl) < 0) names.push(lbl);
    }
    return names.join(" + ") || "Online";
  }

  function formatAuthorsShort(authors) {
    if (!authors || !authors.length) return "";
    if (authors.length <= 3) return authors.join(", ");
    return authors.slice(0, 3).join(", ") + " et al.";
  }

  function checkQueryPhi(text) {
    var q = String(text || "").trim();
    if (!q) return false;
    if (G.RMDPhi && typeof G.RMDPhi.scan === "function") {
      var hits = G.RMDPhi.scan(q);
      if (hits && hits.length) return true;
    }
    if (typeof G.SMD_redactPHI === "function") {
      if (G.SMD_redactPHI(q) !== q) return true;
    }
    return false;
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
      st.topicQuery = "";
      st.topicBusy = false;
      st.topicSearched = false;
      st.topicError = null;
      st.topicResults = [];
      st.topicExpanded = {};
      st.topicAdding = {};
      st.topicAdded = {};
      st.topicAddingAll = false;
      st.topicStudyAdded = {};
      st.importResult = null;
      st.importError = null;
      st.importPreview = null;
      st.importFileName = "";
      st.dedupResult = null;
      st.dedupError = null;
      st.trialsStatusLoaded = false;
      st.trialsStatusLoading = false;
      st.trialsAvailable = false;
      if (st.database === "clinicaltrials") st.database = "pubmed";
      st.trialsNct = "";
      st.trialsCondition = "";
      st.trialsIntervention = "";
      st.trialsPhase = "";
      st.trialsStatus = "";
      st.trialsBusy = false;
      st.trialsSearched = false;
      st.trialsError = null;
      st.trialsResults = [];
      st.trialsNextToken = null;
      st.trialsTotalCount = 0;
      st.announce = "";
      importFile = null;
    }
    if (trialsFlagOn() && !st.trialsStatusLoaded && !st.trialsStatusLoading) {
      loadTrialsAvailability(container, project);
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading search history") + '</div>';
      load(container);
      return;
    }

    var role = project.role || "owner";
    var canRun = role === "owner" || role === "editor" || role === "analyst";
    var showTrials = trialsFlagOn() && st.trialsAvailable;
    if (!showTrials && st.database === "clinicaltrials") st.database = "pubmed";
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

    // Unified simple topic search across all trusted online sources
    var addedTotal = 0;
    for (var ak in st.topicAdded) if (Object.prototype.hasOwnProperty.call(st.topicAdded, ak)) addedTotal++;
    h.push('<div class="rmd-card" style="margin-bottom:14px;">');
    h.push('<h3 class="rmd-card-heading">Quick Search (All Online Sources)</h3>');
    h.push('<p class="rmd-muted" style="margin-top:0;">Type any topic in plain words. Searches PubMed, Europe PMC, and Crossref together (0 MaiK tokens) so you can add papers directly.</p>');
    h.push('<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;">');
    h.push('<input type="search" id="rmd_topic_q" value="' + esc(st.topicQuery) + '" maxlength="500" placeholder="e.g. BCG vaccine tuberculosis randomised trial" aria-label="Search topic across PubMed, Europe PMC, and Crossref" style="flex:1 1 220px;min-width:0;">');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd="topic-search"' + (st.topicBusy ? " disabled" : "") + '>' + (st.topicBusy ? "Searching…" : "Search All Sources") + '</button>');
    h.push('</div>');
    h.push('<p class="rmd-field-hint" style="margin:6px 0 0;">Search words go to PubMed, Europe PMC, Crossref, ClinicalTrials.gov and OpenAlex (mostly US-hosted). Do not type patient information.</p>');
    if (st.topicError) h.push('<div style="margin-top:10px;">' + p2().errHtml(st.topicError, "topic-search") + '</div>');
    if (st.topicSearched && !st.topicBusy && !st.topicResults.length && !st.topicError) {
      h.push('<p class="rmd-muted" style="margin-top:10px;">No matching papers found. Try shorter or broader topic keywords.</p>');
    }
    if (st.topicResults.length) {
      h.push('<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--rmd-line);">');
      h.push('<span class="rmd-muted" style="font-size:13px;font-weight:600;">Found ' + st.topicResults.length + ' papers across PubMed, Europe PMC &amp; Crossref</span>');
      h.push('<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">');
      if (canRun) {
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="topic-add-all"' + (st.topicAddingAll ? " disabled" : "") + '>' + (st.topicAddingAll ? "Adding…" : "Add all to Screening") + '</button>');
      }
      if (addedTotal > 0) {
        h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="to-screening">Open Screening (' + addedTotal + ' added)</button>');
      }
      h.push('</div></div>');
      if (!canRun) {
        h.push('<p class="rmd-muted" style="margin-top:6px;">Read-only role: owner, editor, or analyst can add papers to this project.</p>');
      }
      h.push('<div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">');
      for (var ti = 0; ti < st.topicResults.length; ti++) {
        var it = st.topicResults[ti];
        var tk = topicItemKey(it);
        var exp = !!st.topicExpanded[tk];
        var metaParts = [];
        var authTxt = formatAuthorsShort(it.authors);
        if (authTxt) metaParts.push(authTxt);
        if (it.year) metaParts.push(String(it.year));
        if (it.journal) metaParts.push(it.journal);
        var addedState = st.topicAdded[tk];
        var addingRec = !!st.topicAdding[tk];
        var studyDone = !!st.topicStudyAdded[tk];
        h.push('<div style="border:1px solid var(--rmd-line);border-radius:10px;padding:12px;background:var(--rmd-bg);">');
        h.push('<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:5px;">');
        h.push('<span class="rmd-badge rmd-badge-pill">' + esc(formatSourceBadge(it)) + '</span>');
        if (it.freeFullText) h.push('<span class="rmd-badge rmd-badge-pill" style="background:var(--rmd-acc-soft);color:var(--rmd-acc-dark);">Free full text</span>');
        if (it.pmid) h.push('<a class="rmd-field-hint" href="https://pubmed.ncbi.nlm.nih.gov/' + encodeURIComponent(it.pmid) + '/" target="_blank" rel="noopener" style="margin:0;">PMID ' + esc(it.pmid) + '</a>');
        else if (it.doi) h.push('<a class="rmd-field-hint" href="https://doi.org/' + encodeURIComponent(it.doi) + '" target="_blank" rel="noopener" style="margin:0;word-break:break-all;">DOI ' + esc(it.doi) + '</a>');
        h.push('</div>');
        h.push('<div style="font-weight:600;font-size:14px;line-height:1.35;overflow-wrap:anywhere;">' + esc(it.title || "Untitled paper") + '</div>');
        if (metaParts.length) h.push('<div class="rmd-row-meta" style="margin-top:3px;">' + esc(metaParts.join(" · ")) + '</div>');
        if (it.abstract) {
          var absText = String(it.abstract);
          var showToggle = absText.length > 180;
          var snippet = (!exp && showToggle) ? absText.slice(0, 180).trim() + "…" : absText;
          h.push('<div class="rmd-muted" style="font-size:12.5px;line-height:1.45;margin-top:6px;">' + esc(snippet) + '</div>');
          if (showToggle) {
            h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" style="margin-top:4px;padding:2px 8px;font-size:12px;" data-rmd-topic-exp="' + ti + '">' + (exp ? "Less" : "More") + '</button>');
          }
        }
        if (canRun) {
          h.push('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center;">');
          if (addedState) {
            h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" disabled>' + (addedState === "duplicate" ? "Already in Screening" : "Added to Screening") + '</button>');
          } else {
            h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-topic-add="' + ti + '"' + (addingRec ? " disabled" : "") + '>' + (addingRec ? "Adding…" : "Add to Screening") + '</button>');
          }
          if (studyDone) {
            h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" disabled>Added to Studies</button>');
          } else {
            h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-topic-study="' + ti + '">+ Add to Studies</button>');
          }
          h.push('</div>');
        }
        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('</div>');

    h.push('<div class="rmd-p2-cols">');

    // Run card
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Run a Search</h3>');
    if (canRun && st.database !== "clinicaltrials" && !st.ai) st.ai = SMD.ai.state();
    if (canRun && st.database !== "clinicaltrials" && st.ai) h.push(SMD.ai.barHtml(st.ai, { task: "search_query", label: "search query", cost: 2 }));
    h.push('<div class="rmd-field"><span class="rmd-section-label" id="rmdDbLabel">Database</span>');
    h.push('<div class="rmd-filter-tabs" role="group" aria-labelledby="rmdDbLabel">');
    for (var d = 0; d < DATABASES.length; d++) {
      h.push('<button type="button" class="rmd-chip' + (st.database === DATABASES[d].id ? " rmd-chip-active" : "") + '" data-rmd-db="' + DATABASES[d].id + '">' + esc(DATABASES[d].label) + '</button>');
    }
    if (showTrials) {
      h.push('<button type="button" class="rmd-chip' + (st.database === "clinicaltrials" ? " rmd-chip-active" : "") + '" data-rmd-db="clinicaltrials">Trials</button>');
    }
    h.push('</div></div>');
    if (showTrials && st.database === "clinicaltrials") {
      h.push(trialsPanelHtml());
    } else {
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
      if (st.database === "semantic_scholar") {
        h.push('<div class="rmd-banner rmd-banner-warn" role="status"><strong>Semantic Scholar is not available yet.</strong><span class="rmd-banner-sub">Select PubMed, Europe PMC, or Crossref above to run a live search.</span></div>');
      }
      if (canRun) {
        var sDisabled = st.busy || st.database === "semantic_scholar";
        h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-block" data-rmd="search-run"' + (sDisabled ? " disabled" : "") + '>' + (st.busy ? "Searching " + esc(db.label) + "…" : "Search " + esc(db.label)) + '</button>');
        h.push('<span class="rmd-field-hint">Tip: Narrow broad queries (e.g. add trial or a date range) if PubMed exceeds daytime limits, or search Europe PMC.</span>');
        if (st.busy) h.push('<p class="rmd-muted" aria-live="polite">The connector pages through every result. Large searches can take several minutes.</p>');
        /* Live BUG-12: render the run error directly under the button that
         * triggered it. At 390px the old position above the query textarea was
         * off-screen, so the doctor never saw why the search failed. */
        if (st.runError) h.push('<div data-rmd="search-run-error" style="margin-top:10px;">' + p2().errHtml(st.runError, "search-run-retry") + '</div>');
      } else {
        h.push('<p class="rmd-muted">Only owner, editor or analyst can run searches.</p>');
      }
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
    h.push('  <li><strong style="color:var(--rmd-ink);">PubMed (NBIB or TXT):</strong> On PubMed, tap <em>Send to &gt; Citation manager &gt; Create File</em> (.nbib) or <em>Save &gt; Format: PubMed</em> (.txt). Both work here.</li>');
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
    h.push('<input type="file" id="rmd_import_file">');
    h.push('<span class="rmd-field-hint">Accepts .nbib, .txt (PubMed), .ris, .bib, .json, .xml, or .csv.</span></div>');
    h.push('<div class="rmd-field"><label for="rmd_import_format">Format</label>');
    h.push('<select id="rmd_import_format">');
    h.push('<option value="ris"' + (st.importFormat === "ris" ? " selected" : "") + '>RIS (.ris)</option>');
    h.push('<option value="bibtex"' + (st.importFormat === "bibtex" ? " selected" : "") + '>BibTeX (.bib)</option>');
    h.push('<option value="csl_json"' + ((st.importFormat === "csl_json" || st.importFormat === "json") ? " selected" : "") + '>CSL-JSON (.json) - Zotero / Mendeley</option>');
    h.push('<option value="endnote_xml"' + ((st.importFormat === "endnote_xml" || st.importFormat === "xml") ? " selected" : "") + '>EndNote XML (.xml)</option>');
    h.push('<option value="nbib"' + (st.importFormat === "nbib" ? " selected" : "") + '>NBIB / PubMed Text (.nbib, .txt) - PubMed</option>');
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

  function runTopicSearch(container, project) {
    var q = String(st.topicQuery || "").trim();
    if (!q) {
      st.topicError = { message: "Enter a topic or keywords to search.", code: "invalid_search" };
      render(container);
      return;
    }
    if (checkQueryPhi(q)) {
      st.topicError = { message: "Remove patient information from the search words before searching.", code: "phi_in_query" };
      render(container);
      return;
    }
    if (!project.serverId && String(project.id || "").indexOf("loc_") === 0) {
      st.topicError = { message: "Sign in and save this project to your account to search online databases.", code: "unauthorized" };
      render(container);
      return;
    }
    st.topicBusy = true;
    st.topicSearched = true;
    st.topicError = null;
    render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPidFor(project)) + "/find-studies", { q: q, limit: 30 }).then(function (data) {
      if (mySeq !== seq) return;
      st.topicBusy = false;
      st.topicResults = (data && data.results) || [];
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.topicBusy = false;
      st.topicError = err;
      render(container);
    });
  }

  function addTopicRecord(container, project, idx) {
    var item = st.topicResults[idx];
    if (!item) return Promise.resolve();
    var tk = topicItemKey(item);
    if (st.topicAdded[tk] || st.topicAdding[tk]) return Promise.resolve();
    st.topicAdding[tk] = true;
    render(container);
    var mySeq = seq;
    return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPidFor(project)) + "/records", {
      source: item.source || "",
      pmid: item.pmid || "",
      doi: item.doi || "",
      title: item.title || "Untitled paper",
      authors: item.authors || [],
      year: item.year,
      journal: item.journal || "",
      abstract: item.abstract || ""
    }).then(function (data) {
      delete st.topicAdding[tk];
      if (mySeq !== seq) return;
      st.topicAdded[tk] = (data && data.duplicate) ? "duplicate" : "added";
      render(container);
    }).catch(function (err) {
      delete st.topicAdding[tk];
      if (mySeq !== seq) return;
      st.topicError = err;
      render(container);
    });
  }

  function addAllTopicRecords(container, project) {
    if (!st.topicResults.length || st.topicAddingAll) return;
    st.topicAddingAll = true;
    render(container);
    var i = 0;
    function next() {
      while (i < st.topicResults.length && st.topicAdded[topicItemKey(st.topicResults[i])]) i++;
      if (i >= st.topicResults.length) {
        st.topicAddingAll = false;
        render(container);
        return;
      }
      var idx = i++;
      addTopicRecord(container, project, idx).then(next);
    }
    next();
  }

  function addTopicStudy(container, project, idx) {
    var item = st.topicResults[idx];
    if (!item) return;
    var tk = topicItemKey(item);
    if (st.topicStudyAdded[tk]) return;
    if (!SMD.store || !SMD.store.createStudy) {
      st.topicError = { message: "Study store is not available yet.", code: "store_unavailable" };
      render(container);
      return;
    }
    var parts = [];
    var authTxt = formatAuthorsShort(item.authors);
    if (authTxt) parts.push(authTxt);
    if (item.title) parts.push(item.title);
    if (item.journal) parts.push(item.journal);
    if (item.year) parts.push(String(item.year));
    if (item.pmid) parts.push("PMID: " + item.pmid);
    if (item.doi) parts.push("DOI: " + item.doi);
    try {
      SMD.store.createStudy(project.id, {
        label: String(item.title || "Study").trim().slice(0, 120) || "Study",
        measure: "RR",
        inputs: {},
        locator: {
          kind: "manual",
          citation: parts.join(". "),
          quote: String(item.abstract || "").trim().slice(0, 400)
        },
        verified: false
      });
      st.topicStudyAdded[tk] = true;
      render(container);
    } catch (err) {
      st.topicError = { message: "Could not add this study to your Studies list.", code: "study_add_failed" };
      render(container);
    }
  }

  function runSearch(container, project) {
    var query = (st.queries[st.database] || "").trim();
    if (!query) {
      st.runError = { message: "Enter a query for " + dbLabel(st.database) + " before running.", code: "invalid_search" };
      render(container);
      return;
    }
    var filters = {};
    var effectiveQuery = query;
    if (st.language === "en") {
      if (st.database === "pubmed") filters.languages = ["english"];
      else if (st.database === "europe_pmc") filters.languages = ["eng"];
    }
    var cleanType = st.studyType.replace(/[\[\]]+/g, " ").trim();
    if (cleanType) {
      if (st.database === "pubmed") {
        filters.publicationTypes = [cleanType];
      } else if (st.database === "crossref" && /^[a-z0-9-]+$/.test(cleanType)) {
        filters.type = cleanType;
      } else {
        effectiveQuery = "(" + query + ") AND (" + cleanType + ")";
      }
    }
    var body = { database: st.database, query: effectiveQuery, filters: filters };
    if (st.dateTo) body.dateTo = st.dateTo;
    st.busy = true;
    st.runError = null;
    st.announce = "";
    render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPidFor(project)) + "/searches", body).then(function (data) {
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
    var apiId = apiPidFor(project);
    SMD.api.upload("/v1/projects/" + encodeURIComponent(apiId) + "/import-uploads", form).then(function (up) {
      if (mySeq !== seq) return;
      var key = up && (up.storageKey || up.key);
      if (!key) throw { message: "Upload did not return a storage key.", code: "upload_failed" };
      return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiId) + "/imports", {
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

  function trialsPanelHtml() {
    var h = [];
    h.push('<div class="rmd-field" data-rmd="trials-panel">');
    h.push('<label for="rmd_trials_nct">NCT ID Lookup</label>');
    h.push('<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;">');
    h.push('<input type="text" id="rmd_trials_nct" value="' + esc(st.trialsNct) + '" maxlength="20" placeholder="e.g. NCT04280705" autocapitalize="characters" spellcheck="false" style="flex:1 1 180px;min-width:0;">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="trials-nct-lookup"' + (st.trialsBusy ? " disabled" : "") + '>Lookup NCT</button>');
    h.push('</div>');
    h.push('<span class="rmd-field-hint">Format: NCT followed by 8 digits.</span>');
    h.push('</div>');

    h.push('<div class="rmd-form-row">');
    h.push('<div class="rmd-field"><label for="rmd_trials_cond">Condition</label>');
    h.push('<input type="text" id="rmd_trials_cond" maxlength="200" value="' + esc(st.trialsCondition) + '" placeholder="e.g. asthma, diabetes" autocomplete="off"></div>');
    h.push('<div class="rmd-field"><label for="rmd_trials_intr">Intervention</label>');
    h.push('<input type="text" id="rmd_trials_intr" maxlength="200" value="' + esc(st.trialsIntervention) + '" placeholder="e.g. pembrolizumab" autocomplete="off"></div>');
    h.push('</div>');

    h.push('<div class="rmd-form-row">');
    h.push('<div class="rmd-field"><label for="rmd_trials_phase">Phase</label>');
    h.push('<select id="rmd_trials_phase">');
    for (var pi = 0; pi < TRIAL_PHASES.length; pi++) {
      var ph = TRIAL_PHASES[pi];
      h.push('<option value="' + esc(ph.id) + '"' + (st.trialsPhase === ph.id ? " selected" : "") + '>' + esc(ph.label) + '</option>');
    }
    h.push('</select></div>');
    h.push('<div class="rmd-field"><label for="rmd_trials_status">Status</label>');
    h.push('<select id="rmd_trials_status">');
    for (var si = 0; si < TRIAL_STATUSES.length; si++) {
      var ts = TRIAL_STATUSES[si];
      h.push('<option value="' + esc(ts.id) + '"' + (st.trialsStatus === ts.id ? " selected" : "") + '>' + esc(ts.label) + '</option>');
    }
    h.push('</select></div>');
    h.push('</div>');

    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-block" data-rmd="trials-search"' + (st.trialsBusy ? " disabled" : "") + '>' + (st.trialsBusy ? "Searching Trials..." : "Search Trials") + '</button>');

    if (st.trialsError) {
      h.push('<div class="rmd-banner rmd-banner-warn" role="status" data-rmd="trials-error"><strong>' + esc(st.trialsError) + '</strong></div>');
    }

    if (st.trialsSearched && !st.trialsBusy && !st.trialsResults.length && !st.trialsError) {
      h.push('<p class="rmd-muted" style="margin-top:6px;">No matching trials found.</p>');
      h.push('<div class="rmd-row-meta" data-rmd="trials-credit">Data: ClinicalTrials.gov</div>');
    }

    if (st.trialsResults.length) {
      h.push('<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-top:10px;border-top:1px solid var(--rmd-line);">');
      h.push('<span class="rmd-muted" style="font-size:13px;font-weight:600;">Showing ' + st.trialsResults.length + (st.trialsTotalCount > st.trialsResults.length ? " of " + st.trialsTotalCount : "") + ' trials</span>');
      h.push('<span class="rmd-row-meta" data-rmd="trials-credit" style="font-weight:600;">Data: ClinicalTrials.gov</span>');
      h.push('</div>');
      h.push('<div style="display:flex;flex-direction:column;gap:10px;" data-rmd="trials-results">');
      for (var ti = 0; ti < st.trialsResults.length; ti++) {
        h.push(trialCardHtml(st.trialsResults[ti]));
      }
      h.push('</div>');
      if (st.trialsNextToken) {
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="trials-more"' + (st.trialsBusy ? " disabled" : "") + '>Load more trials</button>');
      }
    }
    return h.join("\n");
  }

  function trialCardHtml(tr) {
    var h = [];
    h.push('<div class="rmd-trial-card" style="border:1px solid var(--rmd-line);border-radius:10px;padding:12px;background:var(--rmd-bg);display:flex;flex-direction:column;gap:8px;">');
    h.push('<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">');
    if (tr.nct) {
      h.push('<a class="rmd-badge rmd-badge-pill" href="https://clinicaltrials.gov/study/' + encodeURIComponent(tr.nct) + '" target="_blank" rel="noopener" style="text-decoration:none;">' + esc(tr.nct) + '</a>');
    }
    if (tr.status) h.push('<span class="rmd-badge rmd-badge-soft">' + esc(tr.status) + '</span>');
    if (tr.phase) h.push('<span class="rmd-badge rmd-badge-soft">' + esc(tr.phase) + '</span>');
    h.push('<span class="rmd-badge ' + (tr.resultsPosted ? "rmd-badge-pill" : "rmd-badge-soft") + '">' + (tr.resultsPosted ? "Results posted" : "No results posted") + '</span>');
    h.push('</div>');
    h.push('<div style="font-weight:600;font-size:14px;line-height:1.35;overflow-wrap:anywhere;">' + esc(tr.title || "Untitled trial") + '</div>');
    if (tr.enrollment !== null && tr.enrollment !== undefined) {
      h.push('<div class="rmd-row-meta" style="font-variant-numeric:tabular-nums;">Enrollment: ' + esc(String(tr.enrollment)) + '</div>');
    }
    if (tr.arms && tr.arms.length) {
      h.push('<div style="display:flex;flex-direction:column;gap:4px;">');
      h.push('<span class="rmd-section-label">Arms</span>');
      for (var ai = 0; ai < tr.arms.length; ai++) {
        var arm = tr.arms[ai] || {};
        var armLine = (arm.label || "Arm") + (arm.type ? " (" + arm.type + ")" : "") + (arm.description ? ": " + arm.description : "");
        h.push('<div class="rmd-muted" style="font-size:12.5px;line-height:1.4;overflow-wrap:anywhere;">' + esc(armLine) + '</div>');
      }
      h.push('</div>');
    }
    if (tr.primaryOutcome && tr.primaryOutcome.length) {
      h.push('<div style="display:flex;flex-direction:column;gap:4px;">');
      h.push('<span class="rmd-section-label">Primary outcomes</span>');
      for (var oi = 0; oi < tr.primaryOutcome.length; oi++) {
        var out = tr.primaryOutcome[oi] || {};
        var outLine = (out.measure || "Outcome") + (out.timeFrame ? " (" + out.timeFrame + ")" : "");
        h.push('<div class="rmd-muted" style="font-size:12.5px;line-height:1.4;overflow-wrap:anywhere;">' + esc(outLine) + '</div>');
      }
      h.push('</div>');
    }
    h.push('<div class="rmd-row-meta" data-rmd="trials-credit">Data: ClinicalTrials.gov</div>');
    h.push('</div>');
    return h.join("\n");
  }

  function loadTrialsAvailability(container, project) {
    if (!trialsFlagOn() || st.trialsStatusLoaded || st.trialsStatusLoading) return;
    if (!project || (!project.serverId && String(project.id || "").indexOf("loc_") === 0)) {
      st.trialsStatusLoaded = true;
      st.trialsAvailable = false;
      return;
    }
    var mySeq = ++trialsProbeSeq;
    st.trialsStatusLoading = true;
    SMD.api.request("GET", "/v1/projects/" + encodeURIComponent(apiPidFor(project)) + "/trials").then(function (data) {
      if (mySeq !== trialsProbeSeq) return;
      st.trialsStatusLoading = false;
      st.trialsStatusLoaded = true;
      st.trialsAvailable = !!(data && data.available !== false);
      if (!st.trialsAvailable && st.database === "clinicaltrials") st.database = "pubmed";
      render(container);
    }).catch(function () {
      if (mySeq !== trialsProbeSeq) return;
      st.trialsStatusLoading = false;
      st.trialsStatusLoaded = true;
      st.trialsAvailable = false;
      if (st.database === "clinicaltrials") st.database = "pubmed";
      render(container);
    });
  }

  function handleTrialsUnavailable(container) {
    st.trialsBusy = false;
    st.trialsAvailable = false;
    st.trialsStatusLoaded = true;
    st.trialsError = null;
    st.trialsResults = [];
    st.trialsNextToken = null;
    st.trialsSearched = false;
    if (st.database === "clinicaltrials") st.database = "pubmed";
    render(container);
  }

  function isUnavailableResponseErr(err) {
    if (!err) return false;
    if (err.code === "not_found" || err.code === "search_unconfigured" || err.code === "network") return true;
    if (err.status === 404 && err.code !== "trial_not_found" && err.code !== "project_not_found") return true;
    if (err.status >= 500) return true;
    return false;
  }

  function runTrialsNctLookup(container, project) {
    var nct = String(st.trialsNct || "").trim().toUpperCase();
    st.trialsNct = nct;
    if (!/^NCT\d{8}$/.test(nct)) {
      st.trialsError = "Enter a valid NCT ID (NCT followed by 8 digits, e.g. NCT04280705).";
      render(container);
      return;
    }
    if (!project.serverId && String(project.id || "").indexOf("loc_") === 0) {
      handleTrialsUnavailable(container);
      return;
    }
    st.trialsBusy = true;
    st.trialsError = null;
    st.trialsSearched = true;
    st.trialsNextToken = null;
    render(container);
    var mySeq = ++trialsSeq;
    SMD.api.request("GET", "/v1/projects/" + encodeURIComponent(apiPidFor(project)) + "/trials/" + encodeURIComponent(nct)).then(function (data) {
      if (mySeq !== trialsSeq) return;
      if (!data || data.available === false) {
        handleTrialsUnavailable(container);
        return;
      }
      st.trialsBusy = false;
      st.trialsResults = data.trial ? [data.trial] : [];
      st.trialsTotalCount = st.trialsResults.length;
      st.trialsNextToken = null;
      render(container);
    }).catch(function (err) {
      if (mySeq !== trialsSeq) return;
      if (err && err.code === "trial_not_found") {
        st.trialsBusy = false;
        st.trialsResults = [];
        st.trialsTotalCount = 0;
        st.trialsError = "No trial found for " + nct + ".";
        render(container);
        return;
      }
      if (isUnavailableResponseErr(err)) {
        handleTrialsUnavailable(container);
        return;
      }
      st.trialsBusy = false;
      st.trialsError = (err && err.message) || "Could not look up trial.";
      render(container);
    });
  }

  function runTrialsSearch(container, project, pageToken) {
    var cond = String(st.trialsCondition || "").trim();
    var intr = String(st.trialsIntervention || "").trim();
    var phase = String(st.trialsPhase || "").trim();
    var status = String(st.trialsStatus || "").trim();
    if (!cond && !intr && !phase && !status) {
      st.trialsError = "Enter a condition, intervention, phase, or status to search trials.";
      render(container);
      return;
    }
    if (checkQueryPhi(cond) || checkQueryPhi(intr)) {
      st.trialsError = "Query looks like it contains personal details. Remove patient identifiers before searching.";
      render(container);
      return;
    }
    if (!project.serverId && String(project.id || "").indexOf("loc_") === 0) {
      handleTrialsUnavailable(container);
      return;
    }
    st.trialsBusy = true;
    st.trialsError = null;
    st.trialsSearched = true;
    if (!pageToken) {
      st.trialsResults = [];
      st.trialsNextToken = null;
      st.trialsTotalCount = 0;
    }
    render(container);
    var payload = { pageSize: 20 };
    if (cond) payload.condition = cond;
    if (intr) payload.intervention = intr;
    if (phase) payload.phase = phase;
    if (status) payload.status = status;
    if (pageToken) payload.pageToken = pageToken;
    var mySeq = ++trialsSeq;
    SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPidFor(project)) + "/trials/search", payload).then(function (data) {
      if (mySeq !== trialsSeq) return;
      if (!data || data.available === false) {
        handleTrialsUnavailable(container);
        return;
      }
      st.trialsBusy = false;
      var items = (data && data.studies) || [];
      st.trialsResults = pageToken ? st.trialsResults.concat(items) : items;
      st.trialsNextToken = (data && data.nextPageToken) || null;
      st.trialsTotalCount = (data && typeof data.totalCount === "number") ? data.totalCount : st.trialsResults.length;
      render(container);
    }).catch(function (err) {
      if (mySeq !== trialsSeq) return;
      if (isUnavailableResponseErr(err)) {
        handleTrialsUnavailable(container);
        return;
      }
      st.trialsBusy = false;
      st.trialsError = (err && err.message) || "Could not search ClinicalTrials.gov.";
      render(container);
    });
  }

  function runDedup(container, project) {
    st.dedupBusy = true;
    st.dedupError = null;
    st.dedupResult = null;
    render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPidFor(project)) + "/dedup:run", { algorithm: "deterministic-v1" }).then(function (data) {
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
    on('[data-rmd="topic-search"]', function () { runTopicSearch(container, project); });
    on('[data-rmd="topic-add-all"]', function () { addAllTopicRecords(container, project); });
    on('[data-rmd="search-retry"]', function () { st.loaded = false; render(container); });
    on('[data-rmd="search-run-retry"]', function () { runSearch(container, project); });
    on('[data-rmd="search-run"]', function () { runSearch(container, project); });
    on('[data-rmd="search-more"]', function () { load(container, st.nextCursor); });
    on('[data-rmd="import-run"]', function () { runImport(container, project); });
    on('[data-rmd="dedup-run"]', function () { runDedup(container, project); });
    on('[data-rmd="trials-nct-lookup"]', function () { runTrialsNctLookup(container, project); });
    on('[data-rmd="trials-search"]', function () { runTrialsSearch(container, project, null); });
    on('[data-rmd="trials-more"]', function () {
      if (st.trialsNextToken) runTrialsSearch(container, project, st.trialsNextToken);
    });

    var trNct = container.querySelector("#rmd_trials_nct");
    if (trNct) {
      trNct.oninput = function () { st.trialsNct = this.value; };
      trNct.onkeydown = function (ev) {
        if (ev.key === "Enter" || ev.keyCode === 13) {
          ev.preventDefault();
          runTrialsNctLookup(container, project);
        }
      };
    }
    var trCond = container.querySelector("#rmd_trials_cond");
    if (trCond) trCond.oninput = function () { st.trialsCondition = this.value; };
    var trIntr = container.querySelector("#rmd_trials_intr");
    if (trIntr) trIntr.oninput = function () { st.trialsIntervention = this.value; };
    var trPhase = container.querySelector("#rmd_trials_phase");
    if (trPhase) trPhase.onchange = function () { st.trialsPhase = this.value; };
    var trStatus = container.querySelector("#rmd_trials_status");
    if (trStatus) trStatus.onchange = function () { st.trialsStatus = this.value; };

    var tq = container.querySelector("#rmd_topic_q");
    if (tq) {
      tq.oninput = function () { st.topicQuery = this.value; };
      tq.onkeydown = function (ev) {
        if ((ev.key === "Enter" || ev.keyCode === 13)) {
          ev.preventDefault();
          runTopicSearch(container, project);
        }
      };
    }
    var expBtns = container.querySelectorAll("[data-rmd-topic-exp]");
    for (var ei = 0; ei < expBtns.length; ei++) {
      expBtns[ei].onclick = function () {
        var idx = parseInt(this.getAttribute("data-rmd-topic-exp"), 10);
        var it = st.topicResults[idx];
        if (!it) return;
        var tk = topicItemKey(it);
        st.topicExpanded[tk] = !st.topicExpanded[tk];
        render(container);
      };
    }
    var addBtns = container.querySelectorAll("[data-rmd-topic-add]");
    for (var ai = 0; ai < addBtns.length; ai++) {
      addBtns[ai].onclick = function () {
        var idx = parseInt(this.getAttribute("data-rmd-topic-add"), 10);
        addTopicRecord(container, project, idx);
      };
    }
    var studyBtns = container.querySelectorAll("[data-rmd-topic-study]");
    for (var si = 0; si < studyBtns.length; si++) {
      studyBtns[si].onclick = function () {
        var idx = parseInt(this.getAttribute("data-rmd-topic-study"), 10);
        addTopicStudy(container, project, idx);
      };
    }

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
        pid: apiPidFor(project), task: "search_query", label: "search query", cost: 2,
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
      var fileName = st.importFileName || (importFile && importFile.name) || "";
      var reader = new FileReader();
      reader.onload = function () {
        var content = String(reader.result || "");
        var detected = detectFormat(fileName, content);
        if (detected) st.importFormat = detected;
        st.importPreview = countEntries(st.importFormat, content);
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
        var ext = String(f.name || "").split(".").pop().toLowerCase();
        var allowed = { ris: 1, bib: 1, bibtex: 1, json: 1, xml: 1, nbib: 1, csv: 1, txt: 1 };
        if (f.name && f.name.indexOf(".") >= 0 && !allowed[ext]) {
          importFile = null;
          st.importPreview = null;
          st.importFileName = "";
          st.importError = { message: "Select a .nbib, .txt (PubMed), .ris, .bib, .json, .xml, or .csv reference file.", code: "file_type" };
          render(container);
          return;
        }
        st.importFileName = f.name;
        var detected = detectFormat(f.name, "");
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