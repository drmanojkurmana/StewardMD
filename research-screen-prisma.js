/* StewardMD - ResearchMD PRISMA Screen (window.SMD_RESEARCH.screens.prisma).
 * ES5 only, buildless, mobile-first. Phase 2.6: PRISMA 2020 counts and flow
 * diagram as inline SVG. Counts come from the API view over stored decisions
 * (contracts/phase-2/prisma2020.md); this screen only renders them.
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

  var D = G.document;

  var st = {
    projectId: null,
    loaded: false,
    loading: false,
    error: null,
    prisma: null,
    generatedTs: null,
    reasons: [],
    fitMode: false
  };
  var seq = 0;

  var cssInjected = false;
  function injectCss() {
    if (cssInjected || !D || !D.head || D.getElementById("rmdPrismaCss")) {
      cssInjected = true;
      return;
    }
    cssInjected = true;
    var el = D.createElement("style");
    el.id = "rmdPrismaCss";
    el.textContent = [
      "#researchMD .rmd-prisma-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }",
      "#researchMD .rmd-prisma-head .rmd-card-heading { margin: 0; }",
      "#researchMD .rmd-prisma-fit-btn { min-height: 44px; padding: 8px 12px; font-size: 12.5px; }",
      "#researchMD .rmd-prisma-scroll-wrap { position: relative; max-width: 100%; border: 1px solid var(--rmd-line, #e5ddce); border-radius: 10px; background: var(--rmd-bg, #f8f1e4); overflow: hidden; }",
      "#researchMD .rmd-svg-scroll-container { width: 100%; max-width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 8px; box-sizing: border-box; }",
      "#researchMD .rmd-prisma-scroll-wrap.is-scrollable::after { content: ''; position: absolute; top: 0; right: 0; bottom: 0; width: 28px; pointer-events: none; background: linear-gradient(90deg, rgba(0, 0, 0, 0), var(--rmd-bg, #f8f1e4) 92%); }",
      "#researchMD .rmd-prisma-scroll-wrap.is-at-end::after, #researchMD .rmd-prisma-scroll-wrap.is-fit::after { display: none; }",
      "#researchMD .rmd-prisma-scroll-wrap.is-fit .rmd-svg-scroll-container { overflow-x: hidden; padding: 6px; }",
      "#researchMD .rmd-prisma-scroll-wrap.is-fit .rmd-prisma-svg { min-width: 0; width: 100%; }",
      "#researchMD .rmd-prisma-hint { margin: 6px 0 0; font: 400 12.5px/1.4 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-mut, #5b607a); display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }",
      "@media (min-width: 700px) { #researchMD .rmd-prisma-hint, #researchMD .rmd-prisma-fit-btn { display: none; } }"
    ].join("\n");
    D.head.appendChild(el);
  }

  function p2() { return SMD.p2 || {}; }

  var COUNT_ROWS = [
    ["recordsIdentified", "Records identified (total)"],
    ["recordsFromDatabases", "Records from databases"],
    ["recordsFromOtherSources", "Records from other sources (imports)"],
    ["recordsDuplicatesRemoved", "Duplicates removed before screening"],
    ["recordsScreened", "Records screened (title/abstract)"],
    ["recordsExcluded", "Records excluded (title/abstract)"],
    ["reportsSought", "Reports sought for retrieval"],
    ["reportsNotRetrieved", "Reports not retrieved"],
    ["reportsAssessed", "Reports assessed for eligibility"],
    ["reportsExcluded", "Reports excluded, with reasons"],
    ["studiesIncluded", "Studies included in review"],
    ["conflictsOpen", "Conflicts still open"]
  ];

  function load(container) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;
    var pid = encodeURIComponent(st.projectId);
    Promise.all([
      SMD.api.request("GET", "/v1/projects/" + pid + "/prisma"),
      SMD.api.request("GET", "/v1/projects/" + pid + "/exclusion-reasons")
    ]).then(function (res) {
      if (mySeq !== seq) return;
      st.prisma = (res[0] && res[0].prisma) || null;
      st.generatedTs = (res[0] && res[0].generatedTs) || null;
      st.reasons = (res[1] && res[1].reasons) || [];
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

  function svgBox(x, y, w, h, lines, count, countFor, highlight) {
    var s = [];
    s.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="' + (highlight ? "var(--rmd-acc-soft, #e4e9f8)" : "var(--rmd-panel, #fffdf9)") + '" stroke="' + (highlight ? "var(--rmd-acc, #1b41bf)" : "var(--rmd-line, #e5ddce)") + '" stroke-width="1.5"/>');
    for (var i = 0; i < lines.length; i++) {
      s.push('<text x="' + (x + 14) + '" y="' + (y + 22 + i * 15) + '" class="rp-label">' + esc(lines[i]) + '</text>');
    }
    s.push('<text x="' + (x + 14) + '" y="' + (y + h - 12) + '" class="rp-count" data-count-for="' + countFor + '">' + count + '</text>');
    return s.join("\n");
  }

  function svgArrow(x1, y1, x2, y2) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="rp-arrow" marker-end="url(#rpArrowHead)"/>';
  }

  function buildDiagramSvg(pr) {
    var byReason = pr.excludedByReason || [];
    var boxH = 74;
    var reasonH = boxH + byReason.length * 18;
    var totalH = Math.max(660, 442 + reasonH + 24);
    var s = [];
    s.push('<svg class="rmd-prisma-svg" viewBox="0 0 720 ' + totalH + '" role="img" aria-label="PRISMA 2020 flow diagram" xmlns="http://www.w3.org/2000/svg">');
    s.push('<title>PRISMA 2020 flow: records, reports and studies through screening</title>');
    s.push('<defs><marker id="rpArrowHead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--rmd-mut, #5b607a)"/></marker></defs>');
    s.push('<style>');
    s.push('.rp-label { font: 500 12.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; fill: var(--rmd-ink, #111c44); }');
    s.push('.rp-count { font: 700 20px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; fill: var(--rmd-ink, #111c44); font-variant-numeric: tabular-nums; }');
    s.push('.rp-reason { font: 400 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; fill: var(--rmd-mut, #5b607a); }');
    s.push('.rp-arrow { stroke: var(--rmd-mut, #5b607a); stroke-width: 1.5; fill: none; }');
    s.push('</style>');

    // Identification row
    s.push(svgBox(20, 16, 340, boxH, ["Records identified from databases", "(PubMed, Europe PMC, Crossref, S2)"], pr.recordsFromDatabases, "recordsFromDatabases", false));
    s.push(svgBox(380, 16, 320, boxH, ["Records identified from other sources", "(RIS, BibTeX, CSV imports)"], pr.recordsFromOtherSources, "recordsFromOtherSources", false));

    // Merge junction, duplicates branch
    s.push('<line x1="190" y1="90" x2="190" y2="118" class="rp-arrow"/>');
    s.push('<line x1="540" y1="90" x2="540" y2="118" class="rp-arrow"/>');
    s.push('<line x1="540" y1="118" x2="190" y2="118" class="rp-arrow"/>');
    s.push(svgArrow(190, 118, 190, 192));
    s.push(svgArrow(190, 139, 418, 139));
    s.push(svgBox(420, 102, 280, boxH, ["Records removed before screening:", "duplicates"], pr.recordsDuplicatesRemoved, "recordsDuplicatesRemoved", false));

    // Records screened
    s.push(svgBox(20, 194, 340, boxH, ["Records screened", "(title and abstract)"], pr.recordsScreened, "recordsScreened", false));
    s.push(svgArrow(360, 231, 418, 231));
    s.push(svgBox(420, 194, 280, boxH, ["Records excluded", "(title and abstract)"], pr.recordsExcluded, "recordsExcluded", false));
    s.push(svgArrow(190, 268, 190, 316));

    // Reports sought
    s.push(svgBox(20, 318, 340, boxH, ["Reports sought for retrieval"], pr.reportsSought, "reportsSought", false));
    s.push(svgArrow(360, 355, 418, 355));
    s.push(svgBox(420, 318, 280, boxH, ["Reports not retrieved"], pr.reportsNotRetrieved, "reportsNotRetrieved", false));
    s.push(svgArrow(190, 392, 190, 440));

    // Reports assessed
    s.push(svgBox(20, 442, 340, boxH, ["Reports assessed for eligibility", "(full text)"], pr.reportsAssessed, "reportsAssessed", false));
    s.push(svgArrow(360, 479, 418, 479));
    s.push(svgBox(420, 442, 280, reasonH, ["Reports excluded, with reasons"], pr.reportsExcluded, "reportsExcluded", false));
    for (var i = 0; i < byReason.length; i++) {
      var label = p2().reasonLabel(byReason[i].reasonCode, st.reasons);
      s.push('<text x="434" y="' + (442 + boxH + 14 + i * 18) + '" class="rp-reason">' + esc(label) + ': ' + byReason[i].count + '</text>');
    }
    s.push(svgArrow(190, 516, 190, 564));

    // Studies included
    s.push(svgBox(20, 566, 340, boxH, ["Studies included in review"], pr.studiesIncluded, "studiesIncluded", true));

    s.push('</svg>');
    return s.join("\n");
  }

  function render(container) {
    injectCss();
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to see its PRISMA flow.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var toP = container.querySelector('[data-rmd="to-projects"]');
      if (toP) toP.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (st.projectId !== project.id) {
      st.projectId = project.id;
      st.loaded = false;
      st.loading = false;
      st.error = null;
      st.prisma = null;
      st.generatedTs = null;
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading PRISMA counts") + '</div>';
      load(container);
      return;
    }

    var h = [];
    h.push('<div class="rmd-p2-screen">');
    h.push('<div class="rmd-screen-header">');
    h.push('<div><h2 class="rmd-screen-title">PRISMA 2020</h2>');
    h.push('<p class="rmd-screen-subtitle">' + esc(project.title) + '</p></div>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="prisma-refresh">Refresh Counts</button>');
    h.push('</div>');

    if (st.error) h.push(p2().errHtml(st.error, "prisma-refresh"));
    if (st.loading) h.push(p2().loadingHtml("Loading PRISMA counts"));

    var pr = st.prisma;
    if (pr) {
      if (pr.conflictsOpen > 0) {
        h.push('<div class="rmd-banner rmd-banner-warn">' + pr.conflictsOpen + ' conflict' + (pr.conflictsOpen === 1 ? "" : "s") + ' still open. Items with an open conflict count as pending until resolved.');
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="to-conflicts">Open Conflicts</button></div>');
      }
      h.push('<div class="rmd-card">');
      h.push('<div class="rmd-prisma-head">');
      h.push('<h3 class="rmd-card-heading">Flow Diagram</h3>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm rmd-prisma-fit-btn" data-rmd="prisma-fit" aria-pressed="' + (st.fitMode ? "true" : "false") + '">' + (st.fitMode ? "Full size" : "Fit screen") + '</button>');
      h.push('</div>');
      h.push('<div class="rmd-prisma-scroll-wrap ' + (st.fitMode ? "is-fit" : "is-scrollable") + '">');
      h.push('<div class="rmd-svg-scroll-container" tabindex="0" aria-label="PRISMA 2020 flow diagram scroll area">' + buildDiagramSvg(pr) + '</div>');
      h.push('</div>');
      h.push('<p class="rmd-prisma-hint" data-rmd="prisma-hint">' + (st.fitMode ? "Fitted to screen width. Tap Full size to read larger text." : "Swipe sideways to view full diagram, or tap Fit screen.") + '</p>');
      h.push('</div>');

      h.push('<div class="rmd-card">');
      h.push('<h3 class="rmd-card-heading">Counts</h3>');
      h.push('<p class="rmd-muted">Every number is derived from stored search runs, records, dedup groups and screening decisions. Nothing is entered by hand.</p>');
      h.push('<table class="rmd-count-table"><tbody>');
      for (var i = 0; i < COUNT_ROWS.length; i++) {
        var key = COUNT_ROWS[i][0];
        h.push('<tr><td>' + esc(COUNT_ROWS[i][1]) + '</td><td data-count-for="' + key + '">' + (pr[key] != null ? pr[key] : 0) + '</td></tr>');
      }
      h.push('</tbody></table>');
      if (st.generatedTs) h.push('<p class="rmd-muted">Generated ' + esc(p2().fmtTs(st.generatedTs)) + '</p>');
      h.push('</div>');
    } else if (st.loaded && !st.loading && !st.error) {
      h.push('<div class="rmd-empty-state"><h3>No counts yet</h3><p>Run a search and start screening; PRISMA counts build themselves from stored decisions.</p>');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="to-search">Go to Search</button></div>');
    }

    h.push('</div>');
    container.innerHTML = h.join("\n");
    bindEvents(container);
  }

  function syncScrollAffordance(container) {
    var wrap = container.querySelector(".rmd-prisma-scroll-wrap");
    var scroller = container.querySelector(".rmd-svg-scroll-container");
    if (!wrap || !scroller) return;
    if (st.fitMode) {
      wrap.classList.add("is-fit");
      wrap.classList.remove("is-scrollable");
      wrap.classList.remove("is-at-end");
      return;
    }
    wrap.classList.remove("is-fit");
    var overflow = scroller.scrollWidth > scroller.clientWidth + 4;
    if (overflow) wrap.classList.add("is-scrollable");
    else wrap.classList.remove("is-scrollable");
    if (!overflow || scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4) {
      wrap.classList.add("is-at-end");
    } else {
      wrap.classList.remove("is-at-end");
    }
  }

  function bindEvents(container) {
    function on(sel, fn) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].onclick = fn;
    }
    on('[data-rmd="to-projects"]', function () { SMD.navigate("projects"); });
    on('[data-rmd="to-search"]', function () { SMD.navigate("search", {}); });
    on('[data-rmd="to-conflicts"]', function () { SMD.navigate("conflicts", {}); });
    on('[data-rmd="prisma-refresh"]', function () { st.loaded = false; render(container); });
    on('[data-rmd="prisma-fit"]', function () {
      st.fitMode = !st.fitMode;
      render(container);
    });
    var scroller = container.querySelector(".rmd-svg-scroll-container");
    if (scroller) {
      scroller.addEventListener("scroll", function () { syncScrollAffordance(container); });
      syncScrollAffordance(container);
    }
  }

  SMD.screens.prisma = {
    render: render,
    buildDiagramSvg: buildDiagramSvg
  };

})(typeof window !== "undefined" ? window : globalThis);