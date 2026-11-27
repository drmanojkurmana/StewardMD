/* StewardMD - ResearchMD Find and add studies sheet (window.SMD_RESEARCH.find).
 * ES5 only, buildless, mobile-first. Search PubMed and Europe PMC, tick papers,
 * and the server fills the numbers. Reuses SMD.api, SMD.store and SMD.p2.
 * The sheet lives inside #researchMD so it inherits the --rmd-* palette.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  var D = G.document;

  var esc = (SMD.esc) || function (s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  /* Live BUG-12: PubMed and Europe PMC abstracts and titles can arrive with
   * HTML entities already escaped (BACKGROUND &amp; OBJECTIVES). esc() alone
   * then double-escapes them and the doctor sees the raw entity. Decode the
   * source text once, then escape once. Same helper shape as the pubconsent
   * screen. */
  function decodeEntities(s) {
    return String(s == null ? "" : s)
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, function (m, n) {
        return String.fromCharCode(parseInt(n, 10));
      })
      .replace(/&amp;/gi, "&");
  }

  function escSrc(s) {
    return esc(decodeEntities(s));
  }

  var state = {
    open: false,
    project: null,
    pid: "",
    localOnly: false,
    outcome: "",
    query: "",
    results: [],
    retrievedAt: 0,
    selected: {},
    expanded: {},
    searching: false,
    searchError: null,
    searched: false,
    phase: "search",
    progress: [],
    addError: null
  };

  function keyOf(item) {
    if (item.pmid) return "pmid:" + item.pmid;
    return "doi:" + String(item.doi || "").toLowerCase();
  }

  function measureName(m) {
    if (m === "RR") return "Risk ratio";
    if (m === "OR") return "Odds ratio";
    if (m === "HR") return "Hazard ratio";
    if (m === "MD") return "Mean difference";
    if (m === "SMD") return "Standardised mean difference";
    return "Effect measure";
  }

  function numbersLine(measure, inputs) {
    if (!inputs) return "No numbers yet";
    var name = measureName(measure) + " (" + measure + ")";
    if (inputs.events1 !== undefined && inputs.n1 !== undefined) {
      return name + ": " + inputs.events1 + "/" + inputs.n1 + " vs " + inputs.events2 + "/" + inputs.n2 +
        " (outcome events out of each group)";
    }
    if (inputs.mean1 !== undefined && inputs.sd1 !== undefined) {
      return name + ": " + inputs.mean1 + " (SD " + inputs.sd1 + ", n " + inputs.n1 + ") vs " +
        inputs.mean2 + " (SD " + inputs.sd2 + ", n " + inputs.n2 + ")";
    }
    if (inputs.effect !== undefined && inputs.ciLower !== undefined) {
      return name + " " + inputs.effect + ", 95% CI " + inputs.ciLower + " to " + inputs.ciUpper +
        " (the effect and its uncertainty range)";
    }
    if (inputs.yi !== undefined) {
      return name + " " + inputs.yi + (inputs.se !== undefined ? " (SE " + inputs.se + ")" : "");
    }
    return name;
  }

  function highlightNumbers(quote) {
    return escSrc(quote || "").replace(/(\d+(?:\.\d+)?)/g, '<mark class="rmd-find-num">$1</mark>');
  }

  function injectCSS() {
    if (D.getElementById("rmdFindCss")) return;
    var root = D.getElementById("researchMD");
    if (!root) return;
    var s = D.createElement("style");
    s.id = "rmdFindCss";
    s.textContent = [
      ".rmd-find-sheet{position:absolute;inset:0;z-index:60;display:flex;flex-direction:column;",
      "background:var(--rmd-bg);color:var(--rmd-ink);font-family:var(--rmd-f);}",
      ".rmd-find-head{display:flex;align-items:center;gap:10px;padding:12px 14px;",
      "border-bottom:1px solid var(--rmd-line);background:var(--rmd-panel);}",
      ".rmd-find-head h2{margin:0;font-size:16px;font-weight:700;flex:1;}",
      ".rmd-find-x{border:1px solid var(--rmd-line);background:var(--rmd-bg);color:var(--rmd-ink);",
      "border-radius:8px;width:34px;height:34px;font-size:18px;line-height:1;cursor:pointer;}",
      ".rmd-find-body{flex:1;overflow-y:auto;padding:14px;-webkit-overflow-scrolling:touch;}",
      ".rmd-find-foot{padding:12px 14px;border-top:1px solid var(--rmd-line);background:var(--rmd-panel);}",
      ".rmd-find-field{margin-bottom:14px;}",
      ".rmd-find-label{display:block;font-size:13px;font-weight:600;margin-bottom:5px;}",
      ".rmd-find-hint{font-size:12px;color:var(--rmd-mut);margin-top:4px;}",
      ".rmd-find-input{width:100%;box-sizing:border-box;padding:10px 12px;font-size:15px;",
      "border:1px solid var(--rmd-line);border-radius:10px;background:var(--rmd-bg);color:var(--rmd-ink);}",
      ".rmd-find-searchrow{display:flex;gap:8px;}",
      ".rmd-find-searchrow .rmd-find-input{flex:1;}",
      ".rmd-find-resulthead{display:flex;align-items:center;justify-content:space-between;margin:6px 0 10px;}",
      ".rmd-find-resulthead span{font-size:13px;color:var(--rmd-mut);}",
      ".rmd-find-link{border:0;background:none;color:var(--rmd-acc-dark);font-size:13px;",
      "font-weight:600;cursor:pointer;padding:4px;}",
      ".rmd-find-result{display:flex;gap:10px;padding:12px;border:1px solid var(--rmd-line);",
      "border-radius:12px;background:var(--rmd-panel);margin-bottom:10px;}",
      ".rmd-find-check{width:22px;height:22px;margin-top:2px;flex:none;accent-color:var(--rmd-acc);}",
      ".rmd-find-rbody{flex:1;min-width:0;}",
      ".rmd-find-title{font-size:14px;font-weight:600;line-height:1.35;}",
      ".rmd-find-meta{font-size:12px;color:var(--rmd-mut);margin-top:3px;}",
      ".rmd-find-badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 7px;",
      "border-radius:999px;background:var(--rmd-acc-soft);color:var(--rmd-acc-dark);margin-top:6px;}",
      ".rmd-find-abstract{font-size:12px;color:var(--rmd-mut);margin-top:6px;line-height:1.45;}",
      ".rmd-find-abstract.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}",
      ".rmd-find-expand{border:0;background:none;color:var(--rmd-acc-dark);font-size:12px;",
      "font-weight:600;cursor:pointer;padding:2px 0;margin-top:2px;}",
      ".rmd-find-empty{font-size:13px;color:var(--rmd-mut);padding:18px 4px;text-align:center;}",
      ".rmd-find-progress{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;",
      "border:1px solid var(--rmd-line);border-radius:12px;background:var(--rmd-panel);margin-bottom:9px;}",
      ".rmd-find-dot{width:10px;height:10px;border-radius:50%;margin-top:5px;flex:none;background:var(--rmd-mut);}",
      ".rmd-find-dot.reading{background:var(--rmd-warn);}",
      ".rmd-find-dot.filled{background:var(--rmd-acc);}",
      ".rmd-find-dot.needs_pdf{background:var(--rmd-warn);}",
      ".rmd-find-dot.failed{background:var(--rmd-bad);}",
      ".rmd-find-ptext{flex:1;min-width:0;}",
      ".rmd-find-ptitle{font-size:13px;font-weight:600;line-height:1.3;}",
      ".rmd-find-pstatus{font-size:12px;color:var(--rmd-mut);margin-top:3px;}",
      ".rmd-find-card{padding:13px;border:1px solid var(--rmd-line);border-radius:12px;",
      "background:var(--rmd-panel);margin-bottom:11px;}",
      ".rmd-find-cardlabel{font-size:14px;font-weight:700;}",
      ".rmd-find-numbers{font-size:13px;margin-top:6px;line-height:1.45;}",
      ".rmd-find-quote{font-size:12px;color:var(--rmd-mut);margin-top:8px;line-height:1.5;",
      "background:var(--rmd-bg);border:1px solid var(--rmd-line);border-radius:8px;padding:8px 10px;}",
      ".rmd-find-num{background:var(--rmd-acc-soft);color:var(--rmd-acc-dark);border-radius:3px;padding:0 2px;}",
      ".rmd-find-doi{display:inline-block;font-size:12px;color:var(--rmd-acc-dark);margin-top:8px;word-break:break-all;}",
      ".rmd-find-btnrow{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap;}",
      ".rmd-find-verified{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;",
      "border-radius:999px;background:var(--rmd-acc-soft);color:var(--rmd-acc-dark);margin-left:8px;}",
      ".rmd-find-summary{font-size:14px;font-weight:700;margin-bottom:4px;}",
      ".rmd-find-subsummary{font-size:12px;color:var(--rmd-mut);margin-bottom:14px;line-height:1.45;}",
      ".rmd-find-file{display:none;}"
    ].join("");
    root.appendChild(s);
  }

  function rootEl() {
    return D.getElementById("researchMD");
  }

  function sheetEl() {
    return D.getElementById("rmdFindSheet");
  }

  function ensureSheet() {
    var root = rootEl();
    if (!root) return null;
    var el = sheetEl();
    if (!el) {
      el = D.createElement("div");
      el.id = "rmdFindSheet";
      el.className = "rmd-find-sheet";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Find and add studies");
      root.appendChild(el);
    }
    return el;
  }

  function render() {
    var el = sheetEl();
    if (!el) return;
    var h = [];
    h.push('<div class="rmd-find-head">');
    h.push('  <h2>Find and add studies</h2>');
    h.push('  <button type="button" class="rmd-find-x" data-find="close" aria-label="Close">&times;</button>');
    h.push('</div>');
    if (state.localOnly) {
      h.push('<div class="rmd-find-body">');
      h.push('  <div class="rmd-find-empty">Save this project to your account first, then you can search for papers and fill the numbers automatically.</div>');
      h.push('</div>');
      h.push('<div class="rmd-find-foot"><button type="button" class="rmd-btn rmd-btn-primary" data-find="to-projects">Back to projects</button></div>');
      el.innerHTML = h.join("\n");
      bind();
      return;
    }
    if (state.phase === "search") {
      h.push(renderSearch());
    } else if (state.phase === "adding") {
      h.push(renderProgress(false));
    } else {
      h.push(renderProgress(true));
    }
    el.innerHTML = h.join("\n");
    bind();
  }

  function renderSearch() {
    var h = [];
    h.push('<div class="rmd-find-body">');
    h.push('  <div class="rmd-find-paste-wrap" id="rmdFindPasteWrap"></div>');
    h.push('  <div class="rmd-find-field">');
    h.push('    <label class="rmd-find-label" for="rmd_find_outcome">What result are you combining?</label>');
    h.push('    <input id="rmd_find_outcome" class="rmd-find-input" type="text" value="' + esc(state.outcome) + '" placeholder="e.g. confirmed tuberculosis at any follow-up" />');
    h.push('    <div class="rmd-find-hint">The outcome you want to pool across studies. We use it to find the right numbers.</div>');
    h.push('  </div>');
    h.push('  <div class="rmd-find-field">');
    h.push('    <label class="rmd-find-label" for="rmd_find_query">Search papers</label>');
    h.push('    <div class="rmd-find-searchrow">');
    h.push('      <input id="rmd_find_query" class="rmd-find-input" type="text" value="' + esc(state.query) + '" placeholder="e.g. BCG tuberculosis randomised trial" />');
    h.push('      <button type="button" class="rmd-btn rmd-btn-primary" data-find="search"' + (state.searching ? ' disabled' : '') + '>' + (state.searching ? 'Searching' : 'Search') + '</button>');
    h.push('    </div>');
    h.push('    <div class="rmd-find-hint">Searches PubMed and Europe PMC together. No tokens used to search.</div>');
    h.push('  </div>');
    if (state.searchError) {
      h.push('  <div class="rmd-banner rmd-banner-error" role="alert"><strong>' + esc(state.searchError) + '</strong></div>');
    }
    if (state.searched && !state.results.length && !state.searching) {
      h.push('  <div class="rmd-find-empty">No papers found. Try different words, or add the study manually.</div>');
    }
    if (state.results.length) {
      var selCount = countSelected();
      h.push('  <div class="rmd-find-resulthead"><span>' + state.results.length + ' papers found</span>');
      h.push('    <button type="button" class="rmd-find-link" data-find="select-all">' + (selCount === state.results.length ? 'Clear all' : 'Select all') + '</button></div>');
      for (var i = 0; i < state.results.length; i++) {
        h.push(renderResult(state.results[i]));
      }
      /* F-20: credit lines for the sources present in these results, plus the
       * retrieval date the search completed. */
      if (SMD.sources && SMD.sources.creditHtml) {
        h.push(SMD.sources.creditHtml(state.results, state.retrievedAt, { attr: 'data-find="sources-credit"' }));
      }
    }
    h.push('</div>');
    h.push('<div class="rmd-find-foot">');
    var n = countSelected();
    h.push('  <button type="button" class="rmd-btn rmd-btn-primary" data-find="add"' + (n && state.outcome ? '' : ' disabled') + '>Add ' + n + ' studies</button>');
    if (!state.outcome) h.push('  <div class="rmd-find-hint">Tell us what result you are combining first.</div>');
    h.push('</div>');
    return h.join("\n");
  }

  function renderResult(item) {
    var k = keyOf(item);
    var checked = state.selected[k] ? " checked" : "";
    var expanded = !!state.expanded[k];
    var authors = (item.authors && item.authors.length) ? item.authors.slice(0, 3).join(", ") : "";
    if (item.authors && item.authors.length > 3) authors += " et al.";
    var meta = [];
    if (authors) meta.push(authors);
    if (item.journal) meta.push(item.journal);
    if (item.year) meta.push(item.year);
    var h = [];
    h.push('<div class="rmd-find-result">');
    h.push('  <input type="checkbox" class="rmd-find-check" data-find-check="' + esc(k) + '"' + checked + ' aria-label="Select this paper" />');
    h.push('  <div class="rmd-find-rbody">');
    h.push('    <div class="rmd-find-title">' + escSrc(item.title || "Untitled paper") + '</div>');
    h.push('    <div class="rmd-find-meta">' + escSrc(meta.join(" · ")) + '</div>');
    if (item.freeFullText) h.push('    <span class="rmd-find-badge">Free full text</span>');
    if (item.abstract) {
      h.push('    <div class="rmd-find-abstract' + (expanded ? '' : ' clamp') + '">' + escSrc(item.abstract) + '</div>');
      h.push('    <button type="button" class="rmd-find-expand" data-find-expand="' + esc(k) + '">' + (expanded ? 'Less' : 'More') + '</button>');
    }
    h.push('  </div>');
    h.push('</div>');
    return h.join("\n");
  }

  function renderProgress(done) {
    var h = [];
    h.push('<div class="rmd-find-body">');
    if (done) {
      var filled = 0;
      for (var c = 0; c < state.progress.length; c++) if (state.progress[c].status === "filled") filled++;
      h.push('  <div class="rmd-find-summary">Added ' + filled + ' of ' + state.progress.length + ' studies</div>');
      h.push('  <div class="rmd-find-subsummary">Check each one matches the paper, then tap Numbers match. Use Fix to correct anything.</div>');
      if (state.addError) {
        h.push('  <div class="rmd-banner rmd-banner-error" role="alert"><strong>' + esc(state.addError) + '</strong></div>');
      }
    } else {
      h.push('  <div class="rmd-find-summary">Filling in the numbers</div>');
      h.push('  <div class="rmd-find-subsummary">Reading each paper and pulling out the result. This stays on your screen.</div>');
    }
    for (var i = 0; i < state.progress.length; i++) {
      var p = state.progress[i];
      if (done && p.status === "filled") {
        h.push(renderFilledCard(p, i));
      } else {
        h.push(renderProgressRow(p, i, done));
      }
    }
    h.push('</div>');
    h.push('<div class="rmd-find-foot">');
    if (done) {
      h.push('  <button type="button" class="rmd-btn rmd-btn-primary" data-find="to-studies">Back to studies</button>');
    } else {
      h.push('  <button type="button" class="rmd-btn rmd-btn-subtle" data-find="close">Cancel</button>');
    }
    h.push('</div>');
    return h.join("\n");
  }

  function renderProgressRow(p, i, done) {
    var h = [];
    h.push('<div class="rmd-find-progress">');
    h.push('  <span class="rmd-find-dot ' + esc(p.status) + '"></span>');
    h.push('  <div class="rmd-find-ptext">');
    h.push('    <div class="rmd-find-ptitle">' + escSrc(p.item.title || "Untitled paper") + '</div>');
    h.push('    <div class="rmd-find-pstatus">' + esc(p.text) + '</div>');
    if (done && p.status === "needs_pdf") {
      var privLine = onDeviceOcrOn() ? ((G && G.SMD_RMD_JOBS && G.SMD_RMD_JOBS.DEVICE_PRIVACY_LINE) || "Runs on this device. Your PDFs and patient data are read here and never uploaded. Works offline.") : "";
      h.push('    <div class="rmd-find-btnrow">');
      h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-find-upload="' + i + '">Upload PDF</button>');
      h.push('      <input type="file" accept="application/pdf" class="rmd-find-file" data-find-file="' + i + '" />');
      h.push('    </div>');
      if (privLine) h.push('    <div class="rmd-find-privacy" style="font-size:11px;opacity:0.8;margin-top:4px;">' + esc(privLine) + '</div>');
    }
    if (done && p.status === "failed") {
      h.push('    <div class="rmd-find-btnrow"><button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-find-retry="' + i + '">Try again</button></div>');
    }
    h.push('  </div>');
    h.push('</div>');
    return h.join("\n");
  }

  function renderFilledCard(p, i) {
    var live = (SMD.store && SMD.store.getStudy && p.study) ? SMD.store.getStudy(p.study.id) : null;
    var study = live || p.study || {};
    var inputs = study.inputs || {};
    var quote = p.quote || study.quote || "";
    var doi = p.item.doi || "";
    var verified = study.verified;
    var h = [];
    h.push('<div class="rmd-find-card">');
    h.push('  <div class="rmd-find-cardlabel">' + escSrc(study.label || p.item.title || "Study"));
    if (verified) h.push('<span class="rmd-find-verified">Verified</span>');
    h.push('  </div>');
    h.push('  <div class="rmd-find-numbers">' + esc(numbersLine(study.measure || "RR", inputs)) + '</div>');
    if (quote) {
      h.push('  <div class="rmd-find-quote">' + highlightNumbers(quote) + '</div>');
    }
    if (doi) {
      h.push('  <a class="rmd-find-doi" href="https://doi.org/' + encodeURIComponent(doi) + '" target="_blank" rel="noopener">DOI: ' + esc(doi) + '</a>');
    }
    h.push('  <div class="rmd-find-btnrow">');
    if (!verified) {
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-find-verify="' + i + '">Numbers match</button>');
    }
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-find-fix="' + i + '">Fix</button>');
    h.push('  </div>');
    h.push('</div>');
    return h.join("\n");
  }

  function countSelected() {
    var n = 0;
    for (var i = 0; i < state.results.length; i++) {
      if (state.selected[keyOf(state.results[i])]) n++;
    }
    return n;
  }

  function bind() {
    var el = sheetEl();
    if (!el) return;
    var closeBtns = el.querySelectorAll('[data-find="close"]');
    for (var a = 0; a < closeBtns.length; a++) closeBtns[a].onclick = function () { close(); };
    var toProj = el.querySelectorAll('[data-find="to-projects"]');
    for (var b = 0; b < toProj.length; b++) toProj[b].onclick = function () { close(); if (SMD.navigate) SMD.navigate("projects"); };
    var toStud = el.querySelectorAll('[data-find="to-studies"]');
    for (var c = 0; c < toStud.length; c++) toStud[c].onclick = function () { close(); if (SMD.navigate) SMD.navigate("studies"); };

    var findPasteWrap = el.querySelector("#rmdFindPasteWrap");
    if (findPasteWrap && SMD.paperCard && SMD.paperCard.mountPasteBox) {
      SMD.paperCard.mountPasteBox(findPasteWrap, {
        project: state.project,
        pid: state.pid,
        onAdded: function () {
          if (SMD.screens && SMD.screens.studies && SMD.screens.studies.render) {
            var sc = D.getElementById("rmdScreenBody");
            if (sc) SMD.screens.studies.render(sc);
          }
        }
      });
    }

    var outcomeInput = D.getElementById("rmd_find_outcome");
    if (outcomeInput) outcomeInput.oninput = function () { state.outcome = outcomeInput.value; refreshFooter(); };
    var queryInput = D.getElementById("rmd_find_query");
    if (queryInput) {
      queryInput.oninput = function () { state.query = queryInput.value; };
      queryInput.onkeydown = function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doSearch(); } };
    }
    var searchBtn = el.querySelectorAll('[data-find="search"]');
    for (var d = 0; d < searchBtn.length; d++) searchBtn[d].onclick = function () { doSearch(); };
    var addBtn = el.querySelectorAll('[data-find="add"]');
    for (var e = 0; e < addBtn.length; e++) addBtn[e].onclick = function () { doAdd(); };
    var selAll = el.querySelectorAll('[data-find="select-all"]');
    for (var f = 0; f < selAll.length; f++) selAll[f].onclick = function () { toggleSelectAll(); };

    var checks = el.querySelectorAll('[data-find-check]');
    for (var g = 0; g < checks.length; g++) {
      checks[g].onchange = function () {
        var k = this.getAttribute("data-find-check");
        if (this.checked) state.selected[k] = true; else delete state.selected[k];
        refreshFooter();
        refreshSelectAll();
      };
    }
    var expands = el.querySelectorAll('[data-find-expand]');
    for (var hh = 0; hh < expands.length; hh++) {
      expands[hh].onclick = function () {
        var k = this.getAttribute("data-find-expand");
        if (state.expanded[k]) delete state.expanded[k]; else state.expanded[k] = true;
        render();
      };
    }
    var verifies = el.querySelectorAll('[data-find-verify]');
    for (var v = 0; v < verifies.length; v++) {
      verifies[v].onclick = function () {
        var idx = parseInt(this.getAttribute("data-find-verify"), 10);
        var p = state.progress[idx];
        if (p && p.study && SMD.store) { SMD.store.toggleVerification(p.study.id); render(); }
      };
    }
    var fixes = el.querySelectorAll('[data-find-fix]');
    for (var fx = 0; fx < fixes.length; fx++) {
      fixes[fx].onclick = function () {
        var idx = parseInt(this.getAttribute("data-find-fix"), 10);
        var p = state.progress[idx];
        if (p && p.study && SMD.screens && SMD.screens.studies && SMD.screens.studies.editStudy) {
          SMD.screens.studies.editStudy(p.study.id);
        }
      };
    }
    var uploads = el.querySelectorAll('[data-find-upload]');
    for (var u = 0; u < uploads.length; u++) {
      uploads[u].onclick = function () {
        var idx = this.getAttribute("data-find-upload");
        var fileInput = el.querySelector('[data-find-file="' + idx + '"]');
        if (fileInput) fileInput.click();
      };
    }
    var files = el.querySelectorAll('[data-find-file]');
    for (var fi = 0; fi < files.length; fi++) {
      files[fi].onchange = function () {
        var idx = parseInt(this.getAttribute("data-find-file"), 10);
        if (this.files && this.files[0]) uploadPdf(idx, this.files[0]);
      };
    }
    var retries = el.querySelectorAll('[data-find-retry]');
    for (var r = 0; r < retries.length; r++) {
      retries[r].onclick = function () {
        var idx = parseInt(this.getAttribute("data-find-retry"), 10);
        retryItem(idx);
      };
    }
  }

  function refreshFooter() {
    var el = sheetEl();
    if (!el || state.phase !== "search") return;
    var n = countSelected();
    var addBtn = el.querySelector('[data-find="add"]');
    if (addBtn) {
      addBtn.textContent = "Add " + n + " studies";
      if (n && state.outcome) addBtn.removeAttribute("disabled"); else addBtn.setAttribute("disabled", "disabled");
    }
  }

  function refreshSelectAll() {
    var el = sheetEl();
    if (!el) return;
    var btn = el.querySelector('[data-find="select-all"]');
    if (btn) btn.textContent = (countSelected() === state.results.length && state.results.length) ? "Clear all" : "Select all";
  }

  function toggleSelectAll() {
    var all = countSelected() === state.results.length && state.results.length;
    state.selected = {};
    if (!all) {
      for (var i = 0; i < state.results.length; i++) state.selected[keyOf(state.results[i])] = true;
    }
    render();
  }

  function doSearch() {
    var queryInput = D.getElementById("rmd_find_query");
    if (queryInput) state.query = queryInput.value;
    var outcomeInput = D.getElementById("rmd_find_outcome");
    if (outcomeInput) state.outcome = outcomeInput.value;
    var q = String(state.query || "").trim();
    if (!q) { state.searchError = "Type some words to search for."; render(); return; }
    state.searching = true;
    state.searchError = null;
    render();
    SMD.api.request("POST", "/v1/projects/" + state.pid + "/find-studies", { q: q, limit: 20 })
      .then(function (data) {
        state.results = (data && data.results) || [];
        state.retrievedAt = Date.now();
        state.selected = {};
        state.searched = true;
        state.searching = false;
        render();
      })
      .catch(function (err) {
        state.searching = false;
        state.searchError = (SMD.p2 && SMD.p2.friendlyError) ? SMD.p2.friendlyError(err).message : "Search failed. Try again.";
        render();
      });
  }

  function doAdd() {
    var outcomeInput = D.getElementById("rmd_find_outcome");
    if (outcomeInput) state.outcome = outcomeInput.value;
    var outcome = String(state.outcome || "").trim();
    if (!outcome) { render(); return; }
    var items = [];
    for (var i = 0; i < state.results.length; i++) {
      var it = state.results[i];
      if (state.selected[keyOf(it)]) items.push(it);
    }
    if (!items.length) return;
    state.phase = "adding";
    state.addError = null;
    state.progress = [];
    for (var j = 0; j < items.length; j++) {
      state.progress.push({ key: keyOf(items[j]), item: items[j], status: "reading", text: "Reading abstract", study: null, quote: "", fields: null, method: null });
    }
    render();
    runSequential(0, outcome);
  }

  function runSequential(idx, outcome) {
    if (idx >= state.progress.length) { state.phase = "done"; render(); return; }
    var p = state.progress[idx];
    p.status = "reading";
    p.text = "Reading abstract";
    render();
    var body = { items: [pickId(p.item)], outcome: outcome };
    SMD.api.request("POST", "/v1/projects/" + state.pid + "/studies/auto-add", body)
      .then(function (data) {
        var res = (data && data.results && data.results[0]) || {};
        applyResult(p, res);
        render();
        runSequential(idx + 1, outcome);
      })
      .catch(function (err) {
        if (err && (err.code === "insufficient_credits" || err.status === 402)) {
          state.addError = (SMD.p2 && SMD.p2.friendlyError) ? SMD.p2.friendlyError(err).message : "You need more MaiK tokens for this step.";
          for (var k = idx; k < state.progress.length; k++) {
            if (state.progress[k].status === "reading") { state.progress[k].status = "stopped"; state.progress[k].text = "Not added yet"; }
          }
          state.phase = "done";
          render();
          return;
        }
        p.status = "failed";
        p.text = "Could not read this paper";
        render();
        runSequential(idx + 1, outcome);
      });
  }

  function pickId(item) {
    var o = {};
    if (item.pmid) o.pmid = item.pmid;
    if (item.doi) o.doi = item.doi;
    return o;
  }

  function applyResult(p, res) {
    p.quote = res.quote || "";
    p.fields = res.fields || null;
    p.method = res.method || null;
    if (res.status === "filled" && res.study) {
      p.status = "filled";
      p.study = res.study;
      p.text = res.method === "cache" ? "Already known, added instantly" : "Found the numbers";
      if (SMD.store && SMD.store.adoptServerStudy) SMD.store.adoptServerStudy(state.project.id, res.study);
    } else if (res.status === "needs_pdf") {
      p.status = "needs_pdf";
      p.text = "Need the PDF to find the numbers";
    } else {
      p.status = "failed";
      p.text = "Could not read this paper";
    }
  }

  function retryItem(idx) {
    var p = state.progress[idx];
    if (!p) return;
    var outcome = String(state.outcome || "").trim();
    p.status = "reading";
    p.text = "Reading abstract";
    render();
    SMD.api.request("POST", "/v1/projects/" + state.pid + "/studies/auto-add", { items: [pickId(p.item)], outcome: outcome })
      .then(function (data) {
        var res = (data && data.results && data.results[0]) || {};
        applyResult(p, res);
        render();
      })
      .catch(function () {
        p.status = "failed";
        p.text = "Could not read this paper";
        render();
      });
  }

  function onDeviceOcrOn() {
    var OD = G && G.SMD_RMD_ONDEVICE_PDF;
    if (OD && typeof OD.isEnabled === "function") return OD.isEnabled();
    try {
      if (typeof location !== "undefined" && location.search) {
        var m = location.search.match(/[?&]rmd_ondevice_ocr=([^&]+)/);
        if (m != null) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== "undefined") return localStorage.getItem("smd_rmd_ondevice_ocr") !== "0";
    } catch (e) {}
    return true;
  }

  function uploadPdfServer(idx, p, file, fallbackMeta) {
    var form = new G.FormData();
    form.append("file", file);
    if (fallbackMeta) {
      form.append("fallback", JSON.stringify(fallbackMeta));
    }
    p.text = "Uploading PDF";
    render();
    return SMD.api.upload("/v1/projects/" + state.pid + "/pdfs", form)
      .then(function (data) {
        var pdf = data && data.pdf;
        if (!pdf || !pdf.id) throw new Error("no pdf");
        var jobBody = {
          kind: "pdf_extract", pdfId: pdf.id, idempotencyKey: "find-" + p.key + "-" + Date.now()
        };
        if (fallbackMeta) jobBody.fallback = fallbackMeta;
        return SMD.api.request("POST", "/v1/projects/" + state.pid + "/jobs", jobBody);
      })
      .then(function () {
        p.status = "pdf_sent";
        p.text = "PDF sent for reading. The numbers will be filled once extraction finishes.";
        render();
        if (SMD.p2 && SMD.p2.flashNotice) SMD.p2.flashNotice(sheetEl(), "PDF uploaded. We are reading it in the background.", "info");
      })
      .catch(function (err) {
        p.text = "Need the PDF to find the numbers";
        render();
        if (SMD.p2 && SMD.p2.flashNotice) {
          var msg = (SMD.p2.friendlyError) ? SMD.p2.friendlyError(err).message : "Upload failed. Try again.";
          SMD.p2.flashNotice(sheetEl(), msg, "error");
        }
      });
  }

  function handleFindDeviceResult(idx, p, file, u8, result, targetPid, CP) {
    var isLocalOnly = !state.project || !state.project.serverId;
    var clearKey = (result && result.sha256) ? ("pdf:" + targetPid + ":" + result.sha256) : "";
    if (isLocalOnly) {
      var clearP = (CP && clearKey) ? CP.remove(clearKey).catch(function () {}) : Promise.resolve();
      var artId = "local_" + (result.sha256 || Date.now());
      var localKey = "local-artifact:" + targetPid + ":" + (result.sha256 || Date.now());
      var storeP = CP ? CP.put(localKey, {
        artifact: {
          id: artId, projectId: targetPid, filename: file.name || "study.pdf",
          sha256: result.sha256, bytes: file.size || u8.byteLength,
          pages: result.pages.length, status: "succeeded", createdTs: Date.now()
        },
        result: result
      }).catch(function () {}) : Promise.resolve();
      return Promise.all([clearP, storeP]).then(function () {
        p.status = "pdf_sent";
        p.text = result.ocr
          ? "PDF read on your phone (some pages used OCR). Check values against the original."
          : "PDF read on your phone.";
        render();
      });
    }
    return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(targetPid) + "/extractions/device", {
      filename: file.name || "study.pdf",
      sha256: result.sha256,
      bytes: file.size || u8.byteLength,
      result: result
    }).then(function () {
      if (CP && clearKey) CP.remove(clearKey).catch(function () {});
      p.status = "pdf_sent";
      p.text = result.ocr
        ? "PDF read on your phone (some pages used OCR). Open Extract to verify values."
        : "PDF read on your phone. Open Extract to review pages.";
      render();
      if (SMD.p2 && SMD.p2.flashNotice) SMD.p2.flashNotice(sheetEl(), "PDF read on your phone.", "info");
    });
  }

  function uploadPdf(idx, file) {
    var p = state.progress[idx];
    if (!p) return;
    var OD = G && G.SMD_RMD_ONDEVICE_PDF;
    var CP = G && G.SMD_RMD_CHECKPOINT;
    var JR = G && G.SMD_RMD_JOBS;
    if (!onDeviceOcrOn() || !OD || typeof OD.extract !== "function" || typeof file.arrayBuffer !== "function") {
      uploadPdfServer(idx, p, file);
      return;
    }
    var targetPid = state.pid;
    p.text = "Reading on your phone";
    render();
    file.arrayBuffer().then(function (ab) {
      var u8 = new Uint8Array(ab);
      return (typeof OD.sha256 === "function" ? OD.sha256(u8) : Promise.resolve(null)).then(function (hash) {
        var ckKey = hash ? ("pdf:" + targetPid + ":" + hash) : ("pdf:" + targetPid + ":" + (p.key || idx));
        function runOne(resumeCtx) {
          var resume = (resumeCtx && resumeCtx.checkpoint) || null;
          return OD.extract(u8, {
            sha256: hash,
            resume: resume,
            signal: resumeCtx && resumeCtx.signal,
            /* A background page job paused by the phone is not the phone being slow. */
            onNativeState: function (ns) {
              if (resumeCtx && resumeCtx.holdClock) resumeCtx.holdClock(!!ns && ns.state === "paused");
            },
            onProgress: function (cur, tot) {
              if (resumeCtx && resumeCtx.touchPage) resumeCtx.touchPage();
              p.text = "Reading on your phone, page " + cur + " of " + tot;
              render();
            },
            onPage: function (partial) {
              if (CP && partial && (partial.sha256 || ckKey)) {
                partial.running = true;
                if (resumeCtx && resumeCtx.checkpoint) {
                  partial.failCount = resumeCtx.checkpoint.failCount;
                  partial.reasons = resumeCtx.checkpoint.reasons;
                }
                return CP.put(partial.sha256 ? ("pdf:" + targetPid + ":" + partial.sha256) : ckKey, partial).catch(function () {});
              }
            }
          });
        }
        if (!JR || typeof JR.runWithFallback !== "function") {
          var resumeP = (CP && ckKey) ? CP.get(ckKey).catch(function () { return null; }) : Promise.resolve(null);
          return resumeP.then(function (saved) {
            return runOne({ checkpoint: saved });
          }).then(function (result) {
            return handleFindDeviceResult(idx, p, file, u8, result, targetPid, CP);
          });
        }
        return JR.runWithFallback("pdf", runOne, function (cpIgnored, fallbackMeta) {
          return uploadPdfServer(idx, p, file, fallbackMeta);
        }, {
          jobKey: ckKey,
          projectId: targetPid,
          targetId: p.key || String(idx),
          engine: "ondevice:pdf",
          onStatus: function (info) {
            if (info && info.state === "retrying" && info.message) {
              p.text = info.message;
              render();
            }
          }
        }).then(function (out) {
          if (out && out.ok && out.source === "device") {
            return handleFindDeviceResult(idx, p, file, u8, out.result, targetPid, CP);
          }
          if (!out || out.source !== "cloud") {
            p.status = "needs_pdf";
            p.text = (out && out.message) || "Saved on this device. Try again later.";
            render();
          }
        });
      }).catch(function (err) {
        p.status = "failed";
        p.text = (err && err.message) || "Could not read this PDF.";
        render();
        if (SMD.p2 && SMD.p2.flashNotice) {
          var msg = (SMD.p2.friendlyError) ? SMD.p2.friendlyError(err).message : p.text;
          SMD.p2.flashNotice(sheetEl(), msg, "error");
        }
      });
    }, function () {
      p.status = "failed";
      p.text = "Could not open this PDF file.";
      render();
    });
  }

  function prefillOutcome() {
    SMD.api.request("GET", "/v1/projects/" + state.pid + "/protocols?limit=100", null)
      .then(function (data) {
        var list = (data && data.protocols) || [];
        if (!list.length) return;
        var best = null;
        for (var i = 0; i < list.length; i++) {
          var pr = list[i];
          if (!best || (pr.createdTs || 0) > (best.createdTs || 0) ||
            ((pr.createdTs || 0) === (best.createdTs || 0) && (pr.version || 0) > (best.version || 0))) best = pr;
        }
        if (!best) return;
        return SMD.api.request("GET", "/v1/protocols/" + best.id, null).then(function (pd) {
          var content = (pd && pd.protocol && pd.protocol.content) || {};
          var outcomes = content.outcomes || {};
          var pico = content.pico || {};
          var outcome = outcomes.primary || pico.outcome || "";
          if (outcome && !state.outcome) {
            state.outcome = String(outcome);
            var input = D.getElementById("rmd_find_outcome");
            if (input) input.value = state.outcome;
            refreshFooter();
          }
        });
      })
      .catch(function () { /* outcome prefill is best effort */ });
  }

  function onKey(ev) {
    if (!state.open) return;
    if (ev.key === "Escape" || ev.keyCode === 27) {
      ev.preventDefault();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      close();
    }
  }

  function open(project) {
    if (!SMD.on || !SMD.on()) return;
    injectCSS();
    var el = ensureSheet();
    if (!el) return;
    state.open = true;
    state.project = project || (SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null);
    state.pid = state.project ? (state.project.serverId || state.project.id) : "";
    state.localOnly = !!(state.project && !state.project.serverId);
    state.outcome = "";
    state.query = "";
    state.results = [];
    state.retrievedAt = 0;
    state.selected = {};
    state.expanded = {};
    state.searching = false;
    state.searchError = null;
    state.searched = false;
    state.phase = "search";
    state.progress = [];
    state.addError = null;
    render();
    D.addEventListener("keydown", onKey, true);
    if (!state.localOnly && state.pid) prefillOutcome();
  }

  function close() {
    state.open = false;
    D.removeEventListener("keydown", onKey, true);
    var el = sheetEl();
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  SMD.find = { open: open, close: close };
})(window);
