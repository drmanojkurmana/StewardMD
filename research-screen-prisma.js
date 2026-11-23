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

  var st = {
    projectId: null,
    loaded: false,
    loading: false,
    error: null,
    prisma: null,
    generatedTs: null,
    reasons: []
  };
  var seq = 0;

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
    s.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="' + (highlight ? "var(--rmd-acc-soft, #e3f2ef)" : "var(--rmd-panel, #ffffff)") + '" stroke="' + (highlight ? "var(--rmd-acc, #0f766e)" : "var(--rmd-line, #dce4e2)") + '" stroke-width="1.5"/>');
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
    var reasonH = 64 + byReason.length * 18;
    var totalH = Math.max(576, 384 + reasonH + 20);
    var s = [];
    s.push('<svg class="rmd-prisma-svg" viewBox="0 0 720 ' + totalH + '" role="img" aria-label="PRISMA 2020 flow diagram" xmlns="http://www.w3.org/2000/svg">');
    s.push('<title>PRISMA 2020 flow: records, reports and studies through screening</title>');
    s.push('<defs><marker id="rpArrowHead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--rmd-mut, #5b6b75)"/></marker></defs>');
    s.push('<style>');
    s.push('.rp-label { font: 500 12.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; fill: var(--rmd-ink, #12202a); }');
    s.push('.rp-count { font: 700 20px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; fill: var(--rmd-ink, #12202a); font-variant-numeric: tabular-nums; }');
    s.push('.rp-reason { font: 400 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; fill: var(--rmd-mut, #5b6b75); }');
    s.push('.rp-arrow { stroke: var(--rmd-mut, #5b6b75); stroke-width: 1.5; fill: none; }');
    s.push('</style>');

    // Identification row
    s.push(svgBox(20, 16, 340, 64, ["Records identified from databases", "(PubMed, Europe PMC, Crossref, S2)"], pr.recordsFromDatabases, "recordsFromDatabases", false));
    s.push(svgBox(380, 16, 320, 64, ["Records identified from other sources", "(RIS, BibTeX, CSV imports)"], pr.recordsFromOtherSources, "recordsFromOtherSources", false));

    // Merge junction, duplicates branch
    s.push('<line x1="190" y1="80" x2="190" y2="112" class="rp-arrow"/>');
    s.push('<line x1="540" y1="80" x2="540" y2="112" class="rp-arrow"/>');
    s.push('<line x1="540" y1="112" x2="190" y2="112" class="rp-arrow"/>');
    s.push(svgArrow(190, 112, 190, 158));
    s.push(svgArrow(240, 112, 418, 128));
    s.push(svgBox(420, 96, 280, 64, ["Records removed before screening:", "duplicates"], pr.recordsDuplicatesRemoved, "recordsDuplicatesRemoved", false));

    // Records screened
    s.push(svgBox(20, 160, 340, 64, ["Records screened", "(title and abstract)"], pr.recordsScreened, "recordsScreened", false));
    s.push(svgArrow(360, 192, 418, 192));
    s.push(svgBox(420, 160, 280, 64, ["Records excluded", "(title and abstract)"], pr.recordsExcluded, "recordsExcluded", false));
    s.push(svgArrow(190, 224, 190, 270));

    // Reports sought
    s.push(svgBox(20, 272, 340, 64, ["Reports sought for retrieval"], pr.reportsSought, "reportsSought", false));
    s.push(svgArrow(360, 304, 418, 304));
    s.push(svgBox(420, 272, 280, 64, ["Reports not retrieved"], pr.reportsNotRetrieved, "reportsNotRetrieved", false));
    s.push(svgArrow(190, 336, 190, 382));

    // Reports assessed
    s.push(svgBox(20, 384, 340, 64, ["Reports assessed for eligibility", "(full text)"], pr.reportsAssessed, "reportsAssessed", false));
    s.push(svgArrow(360, 416, 418, 416));
    s.push(svgBox(420, 384, 280, reasonH, ["Reports excluded, with reasons"], pr.reportsExcluded, "reportsExcluded", false));
    for (var i = 0; i < byReason.length; i++) {
      var label = p2().reasonLabel(byReason[i].reasonCode, st.reasons);
      s.push('<text x="434" y="' + (384 + 64 + 14 + i * 18) + '" class="rp-reason">' + esc(label) + ': ' + byReason[i].count + '</text>');
    }
    s.push(svgArrow(190, 448, 190, 494));

    // Studies included
    s.push(svgBox(20, 496, 340, 64, ["Studies included in review"], pr.studiesIncluded, "studiesIncluded", true));

    s.push('</svg>');
    return s.join("\n");
  }

  function render(container) {
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
      h.push('<h3 class="rmd-card-heading">Flow Diagram</h3>');
      h.push('<div class="rmd-svg-scroll-container">' + buildDiagramSvg(pr) + '</div>');
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

  function bindEvents(container) {
    function on(sel, fn) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].onclick = fn;
    }
    on('[data-rmd="to-projects"]', function () { SMD.navigate("projects"); });
    on('[data-rmd="to-search"]', function () { SMD.navigate("search", {}); });
    on('[data-rmd="to-conflicts"]', function () { SMD.navigate("conflicts", {}); });
    on('[data-rmd="prisma-refresh"]', function () { st.loaded = false; render(container); });
  }

  SMD.screens.prisma = {
    render: render,
    buildDiagramSvg: buildDiagramSvg
  };

})(typeof window !== "undefined" ? window : globalThis);