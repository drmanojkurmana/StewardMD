/* StewardMD - ResearchMD Studies Screen (window.SMD_RESEARCH.screens.studies).
 * ES5 only, buildless, mobile-first.
 * Manages study table, extraction forms, locator provenance, verification, and 409 conflict resolution.
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

  var D = G.document;

  function enrichFlag(key) {
    try {
      return typeof G.localStorage !== "undefined" && G.localStorage.getItem(key) === "1";
    } catch (e) {
      return false;
    }
  }

  function normDoi(value) {
    var d = String(value || "").trim().toLowerCase();
    d = d.replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
    d = d.replace(/[.,;:\s]+$/, "");
    return d.indexOf("10.") === 0 ? d : "";
  }

  function injectEnrichCSS() {
    if (!D || D.getElementById("rmdEnrichCss")) return;
    var s = D.createElement("style");
    s.id = "rmdEnrichCss";
    s.textContent = [
      "/* ResearchMD study-list enrichment */",
      "#researchMD .rmd-retraction-badge { display: inline-flex; align-items: center; gap: 4px; background: var(--rmd-bad-soft); color: var(--rmd-bad); border: 1px solid rgba(180, 35, 24, 0.26); font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }",
      "#researchMD .rmd-retraction-badge-eoc { background: var(--rmd-warn-soft); color: var(--rmd-warn); border-color: rgba(163, 78, 28, 0.28); }",
      "#researchMD .rmd-enrich-row-slot { display: inline-flex; margin-left: 4px; }",
      "#researchMD .rmd-enrich-credit { display: block; font-size: 11px; line-height: 1.4; color: var(--rmd-mut); margin-top: 4px; }",
      "#researchMD .rmd-enrich-link { color: var(--rmd-acc); text-decoration: underline; text-underline-offset: 2px; word-break: break-word; }",
      "body.dark #researchMD .rmd-retraction-badge, body.v3-dark #researchMD .rmd-retraction-badge { background: rgba(180, 35, 24, 0.2); color: #ffb4ab; border-color: rgba(255, 180, 171, 0.26); }",
      "body.dark #researchMD .rmd-retraction-badge-eoc, body.v3-dark #researchMD .rmd-retraction-badge-eoc { background: rgba(163, 78, 28, 0.24); color: #ffc29c; border-color: rgba(255, 194, 156, 0.26); }"
    ].join("\n");
    D.head.appendChild(s);
  }

  function fmtEnrichDate(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "";
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var mi = parseInt(m[2], 10) - 1;
    if (mi < 0 || mi > 11) return "";
    return parseInt(m[3], 10) + " " + months[mi] + " " + m[1];
  }

  function retractionBadge(r, withCredit) {
    if (!r || (r.status !== "retracted" && r.status !== "expression_of_concern")) return "";
    var eoc = r.status === "expression_of_concern";
    var label = eoc ? "Expression of concern" : "Retracted";
    var date = fmtEnrichDate(r.date);
    var h = [];
    h.push('<span class="rmd-retraction-badge' + (eoc ? " rmd-retraction-badge-eoc" : "") + '" title="Retraction data: Crossref / Retraction Watch">');
    h.push('<svg aria-hidden="true" focusable="false" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>');
    h.push('<span>' + esc(label) + (date ? " " + esc(date) : "") + '</span>');
    h.push('</span>');
    if (withCredit) {
      h.push('<span class="rmd-enrich-credit">Retraction data: Crossref / Retraction Watch');
      if (r.noticeDoi) {
        h.push(' &middot; Notice: <a class="rmd-enrich-link" href="https://doi.org/' + esc(encodeURIComponent(r.noticeDoi)) + '" target="_blank" rel="noopener noreferrer">' + esc(r.noticeDoi) + '</a>');
      }
      h.push('</span>');
    }
    return h.join("");
  }

  function studyDoi(study) {
    return normDoi(study && study.locator && study.locator.doi);
  }

  /* Adds retraction badges to the study rows and detail pane. Runs only when
   * smd_research_retraction is "1"; the server answers unavailable before any
   * lookup, in which case nothing is rendered. */
  function hydrateStudyRetractions(container, studies) {
    if (!enrichFlag("smd_research_retraction") || !container || !SMD.api || typeof SMD.api.request !== "function") return;
    if (!Array.isArray(studies) || !studies.length) return;
    var dois = [];
    for (var i = 0; i < studies.length; i++) {
      var d = studyDoi(studies[i]);
      if (d && dois.indexOf(d) < 0) dois.push(d);
    }
    if (!dois.length) return;
    var chunkSize = 50;
    var chunks = [];
    for (var c = 0; c < dois.length; c += chunkSize) chunks.push(dois.slice(c, c + chunkSize));
    var chain = Promise.resolve();
    chunks.forEach(function (chunk) {
      chain = chain.then(function () {
        return SMD.api.request("POST", "/v1/enrich/retraction", { dois: chunk })
          .then(function (data) {
            if (!data || !data.available || !data.retractions) return;
            applyStudyRetractions(container, studies, data.retractions);
          })
          .catch(function () {});
      });
    });
  }

  function applyStudyRetractions(container, studies, retractions) {
    if (!container || typeof container.querySelectorAll !== "function") return;
    var byId = {};
    for (var i = 0; i < studies.length; i++) byId[studies[i].id] = studies[i];
    var rows = container.querySelectorAll("[data-rmd-enrich-row]");
    for (var r = 0; r < rows.length; r++) {
      var sid = rows[r].getAttribute("data-rmd-enrich-row");
      var study = byId[sid];
      var result = study ? retractions[studyDoi(study)] : null;
      var html = retractionBadge(result, false);
      if (html) rows[r].innerHTML = html;
    }
    var details = container.querySelectorAll("[data-rmd-enrich-detail]");
    for (var j = 0; j < details.length; j++) {
      var did = details[j].getAttribute("data-rmd-enrich-detail");
      var ds = byId[did];
      var dr = ds ? retractions[studyDoi(ds)] : null;
      var dhtml = retractionBadge(dr, true);
      if (dhtml) details[j].innerHTML = dhtml;
    }
  }

  // Screen UI state
  var viewMode = "list"; // "list", "edit", "new"
  var editingStudyId = null;
  var filterStatus = "all"; // "all", "verified", "unverified"
  var currentInputType = "rawCounts"; // "rawCounts", "rawMeans", "reported", "generic"
  var formError = null;

  function detectInputType(measure, inputs) {
    if (!inputs) return "rawCounts";
    if (inputs.events1 !== undefined && inputs.n1 !== undefined) return "rawCounts";
    if (inputs.mean1 !== undefined && inputs.sd1 !== undefined) return "rawMeans";
    if (inputs.effect !== undefined && inputs.ciLower !== undefined) return "reported";
    if (inputs.yi !== undefined) return "generic";
    if (measure === "MD" || measure === "SMD") return "rawMeans";
    if (measure === "HR") return "reported";
    return "rawCounts";
  }

  function formatStudyData(measure, inputs) {
    if (!inputs) return "No data";
    if (inputs.events1 !== undefined && inputs.n1 !== undefined) {
      return inputs.events1 + "/" + inputs.n1 + " vs " + inputs.events2 + "/" + inputs.n2 + " (" + measure + ")";
    }
    if (inputs.mean1 !== undefined && inputs.sd1 !== undefined) {
      return "m1=" + inputs.mean1 + " (sd " + inputs.sd1 + ", n " + inputs.n1 + ") vs m2=" + inputs.mean2 + " (sd " + inputs.sd2 + ", n " + inputs.n2 + ")";
    }
    if (inputs.effect !== undefined && inputs.ciLower !== undefined) {
      return measure + " " + inputs.effect + " [" + inputs.ciLower + ", " + inputs.ciUpper + "]";
    }
    if (inputs.yi !== undefined) {
      return "yi=" + inputs.yi + (inputs.se ? " (se=" + inputs.se + ")" : "");
    }
    return JSON.stringify(inputs);
  }

  function renderStudies(container) {
    injectEnrichCSS();
    var store = SMD.store;
    if (!store) return;
    var project = store.getActiveProject();
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><p>No project selected.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var toP = container.querySelector('[data-rmd="to-projects"]');
      if (toP && SMD.navigate) toP.onclick = function () { SMD.navigate("projects"); };
      return;
    }

    var allStudies = store.getStudies(project.id);
    var conflict = store.getConflict();

    // Filter studies
    var studies = allStudies.filter(function (s) {
      if (filterStatus === "verified") return !!s.verified;
      if (filterStatus === "unverified") return !s.verified;
      return true;
    });

    var verifiedCount = 0;
    for (var i = 0; i < allStudies.length; i++) {
      if (allStudies[i].verified) verifiedCount++;
    }

    var activeStudy = null;
    if (editingStudyId) {
      activeStudy = store.getStudy(editingStudyId);
    } else if (store.getActiveStudy()) {
      activeStudy = store.getActiveStudy();
    } else if (allStudies.length > 0) {
      activeStudy = allStudies[0];
    }

    var h = [];
    h.push('<div class="rmd-studies-screen">');

    // Conflict Alert Banner / Modal (HTTP 409 stale_version)
    if (conflict) {
      h.push(renderConflictModal(conflict));
    }

    // Top Navigation & Action Bar
    h.push('  <div class="rmd-studies-topbar">');
    h.push('    <div class="rmd-topbar-left">');
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="to-projects">');
    h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"></polyline></svg>');
    h.push('        <span>Projects</span>');
    h.push('      </button>');
    h.push('      <div class="rmd-topbar-proj-info">');
    h.push('        <h2 class="rmd-topbar-proj-title">' + esc(project.title) + '</h2>');
    h.push('        <span class="rmd-badge rmd-badge-pill rmd-cap">' + esc(project.discipline || "Medicine") + '</span>');
    if (project.specialty) {
      h.push('        <span class="rmd-badge rmd-badge-soft">' + esc(project.specialty) + '</span>');
    }
    h.push('      </div>');
    h.push('    </div>');

    h.push('    <div class="rmd-topbar-actions">');
    h.push('      <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="find-studies">');
    h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>');
    h.push('        <span>Find and add studies</span>');
    h.push('      </button>');
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="add-study">');
    h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>');
    h.push('        <span>Add manually</span>');
    h.push('      </button>');

    var runDisabled = verifiedCount < 2;
    h.push('      <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-run"' + (runDisabled ? ' title="At least 2 verified studies are required to pool"' : '') + '>');
    h.push('        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>');
    h.push('        <span>Run Meta-Analysis (' + verifiedCount + ' verified)</span>');
    h.push('      </button>');
    h.push('    </div>');
    h.push('  </div>');

    // Phone View Switcher (segmented bar: "Studies (13)" vs "Detail / Form")
    h.push('  <div class="rmd-phone-seg" role="tablist">');
    h.push('    <button type="button" class="rmd-seg-btn' + (viewMode === 'list' ? ' rmd-seg-active' : '') + '" data-rmd-phone-view="list">');
    h.push('      Studies (' + allStudies.length + ')');
    h.push('    </button>');
    h.push('    <button type="button" class="rmd-seg-btn' + (viewMode !== 'list' ? ' rmd-seg-active' : '') + '" data-rmd-phone-view="detail">');
    h.push('      ' + (viewMode === 'new' ? 'New Study' : (viewMode === 'edit' ? 'Edit Study' : 'Study Details')));
    h.push('    </button>');
    h.push('  </div>');

    // Main Content: Two-Pane Split Layout (Desktop/Tablet) or Single-Pane (Phone)
    h.push('  <div class="rmd-split-layout">');

    // LEFT PANE: Studies Table / List
    h.push('    <div class="rmd-pane-left' + (viewMode !== 'list' ? ' rmd-phone-hidden' : '') + '">');
    h.push('      <div class="rmd-pane-header">');
    h.push('        <div class="rmd-filter-tabs">');
    h.push('          <button type="button" class="rmd-chip' + (filterStatus === 'all' ? ' rmd-chip-active' : '') + '" data-rmd-filter="all">All (' + allStudies.length + ')</button>');
    h.push('          <button type="button" class="rmd-chip' + (filterStatus === 'verified' ? ' rmd-chip-active' : '') + '" data-rmd-filter="verified">Verified (' + verifiedCount + ')</button>');
    h.push('          <button type="button" class="rmd-chip' + (filterStatus === 'unverified' ? ' rmd-chip-active' : '') + '" data-rmd-filter="unverified">Unverified (' + (allStudies.length - verifiedCount) + ')</button>');
    h.push('        </div>');
    h.push('      </div>');

    if (!studies.length) {
      h.push('      <div class="rmd-empty-pane">');
      h.push('        <p>No studies match the selected filter.</p>');
      h.push('        <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="find-studies">Find and add studies</button>');
      h.push('        <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="add-study">Add manually</button>');
      h.push('      </div>');
    } else {
      h.push('      <div class="rmd-studies-list" role="list">');
      for (var k = 0; k < studies.length; k++) {
        var s = studies[k];
        var isSelected = activeStudy && activeStudy.id === s.id;
        h.push('        <div class="rmd-study-row' + (isSelected ? ' rmd-study-row-selected' : '') + '" data-rmd-study-id="' + esc(s.id) + '" role="listitem">');
        h.push('          <div class="rmd-study-row-main">');
        h.push('            <div class="rmd-study-row-title-bar">');
        h.push('              <strong class="rmd-study-label">' + esc(s.label || "Untitled Study") + '</strong>');
        h.push('              <span class="rmd-enrich-row-slot" data-rmd-enrich-row="' + esc(s.id) + '"></span>');
        h.push('              <span class="rmd-version-tag">v' + (s.version || 1) + '</span>');
        h.push('            </div>');
        h.push('            <div class="rmd-study-data-str">' + esc(formatStudyData(s.measure, s.inputs)) + '</div>');
        if (s.locator && s.locator.citation) {
          h.push('            <div class="rmd-study-loc-str smd-books-keep"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg> ' + esc(s.locator.citation) + (s.locator.page ? ', p. ' + esc(s.locator.page) : '') + '</div>');
        }
        h.push('          </div>');

        h.push('          <div class="rmd-study-row-actions">');
        if (s.verified) {
          h.push('            <button type="button" class="rmd-status-pill rmd-status-verified" data-rmd-verify="' + esc(s.id) + '" title="Click to unverify">Verified</button>');
        } else {
          h.push('            <button type="button" class="rmd-status-pill rmd-status-unverified" data-rmd-verify="' + esc(s.id) + '" title="Click to verify against source">Unverified</button>');
        }
        h.push('            <button type="button" class="rmd-icon-btn" data-rmd-edit="' + esc(s.id) + '" title="Edit study data">');
        h.push('              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>');
        h.push('            </button>');
        h.push('            <button type="button" class="rmd-icon-btn rmd-icon-danger" data-rmd-delete="' + esc(s.id) + '" title="Delete study">');
        h.push('              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>');
        h.push('            </button>');
        h.push('          </div>');
        h.push('        </div>');
      }
      h.push('      </div>');
    }
    h.push('    </div>');

    // RIGHT PANE: Detail / Form
    h.push('    <div class="rmd-pane-right' + (viewMode === 'list' ? ' rmd-phone-hidden' : '') + '">');
    if (viewMode === "edit" || viewMode === "new") {
      h.push(renderStudyForm(viewMode === "edit" ? activeStudy : null));
    } else if (activeStudy) {
      h.push(renderStudyDetail(activeStudy));
    } else {
      h.push('      <div class="rmd-empty-pane"><p>Select a study to view details, or add a new study.</p></div>');
    }
    h.push('    </div>');

    h.push('  </div>'); // .rmd-split-layout
    h.push('</div>'); // .rmd-studies-screen

    container.innerHTML = h.join("\n");
    bindEvents(container);
    hydrateStudyRetractions(container, allStudies);
  }

  function isPhoneViewport(container) {
    if (container && G.getComputedStyle) {
      var seg = container.querySelector(".rmd-phone-seg");
      if (seg) {
        try { return G.getComputedStyle(seg).display !== "none"; } catch (e) {}
      }
    }
    return !!(G.innerWidth && G.innerWidth < 768);
  }

  function renderStudyDetail(s) {
    var h = [];
    h.push('<div class="rmd-detail-card">');
    h.push('  <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm rmd-mobile-back-studies" data-rmd-phone-view="list">&larr; Studies list</button>');
    h.push('  <div class="rmd-detail-header">');
    h.push('    <div>');
    h.push('      <span class="rmd-version-tag">Version ' + (s.version || 1) + '</span>');
    h.push('      <h3 class="rmd-detail-title">' + esc(s.label || "Untitled Study") + '</h3>');
    h.push('      <div class="rmd-enrich-detail-slot" data-rmd-enrich-detail="' + esc(s.id) + '"></div>');
    h.push('    </div>');
    h.push('    <div class="rmd-detail-header-actions">');
    if (s.verified) {
      h.push('      <span class="rmd-status-pill rmd-status-verified">Verified</span>');
    } else {
      h.push('      <span class="rmd-status-pill rmd-status-unverified">Unverified</span>');
    }
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-edit="' + esc(s.id) + '">Edit Data</button>');
    h.push('    </div>');
    h.push('  </div>');

    // Extracted Data Section
    h.push('  <div class="rmd-section-block">');
    h.push('    <h4 class="rmd-section-label">Extracted Quantitative Values</h4>');
    h.push('    <div class="rmd-data-box">');
    h.push('      <div class="rmd-data-box-row"><span class="rmd-data-box-lbl">Measure:</span> <strong>' + esc(s.measure) + '</strong></div>');
    var inp = s.inputs || {};
    if (inp.events1 !== undefined && inp.n1 !== undefined) {
      h.push('      <div class="rmd-2x2-grid">');
      h.push('        <div class="rmd-grid-cell"><span>Intervention:</span> <strong>' + inp.events1 + ' / ' + inp.n1 + '</strong> (' + (inp.n1 ? (inp.events1 / inp.n1 * 100).toFixed(1) : 0) + '%)</div>');
      h.push('        <div class="rmd-grid-cell"><span>Control:</span> <strong>' + inp.events2 + ' / ' + inp.n2 + '</strong> (' + (inp.n2 ? (inp.events2 / inp.n2 * 100).toFixed(1) : 0) + '%)</div>');
      h.push('      </div>');
    } else if (inp.mean1 !== undefined) {
      h.push('      <div class="rmd-2x2-grid">');
      h.push('        <div class="rmd-grid-cell"><span>Intervention:</span> Mean ' + inp.mean1 + ' (SD ' + inp.sd1 + ', N ' + inp.n1 + ')</div>');
      h.push('        <div class="rmd-grid-cell"><span>Control:</span> Mean ' + inp.mean2 + ' (SD ' + inp.sd2 + ', N ' + inp.n2 + ')</div>');
      h.push('      </div>');
    } else if (inp.effect !== undefined) {
      h.push('      <div class="rmd-data-box-row"><span class="rmd-data-box-lbl">Reported Effect:</span> <strong>' + inp.effect + '</strong> [95% CI ' + inp.ciLower + ', ' + inp.ciUpper + ']</div>');
    } else if (inp.yi !== undefined) {
      h.push('      <div class="rmd-data-box-row"><span class="rmd-data-box-lbl">Log Effect (yi):</span> <strong>' + inp.yi + '</strong>, SE: ' + inp.se + '</div>');
    }
    h.push('    </div>');
    h.push('  </div>');

    // Provenance & Locator Section (Per locator.schema.json)
    var loc = s.locator || {};
    h.push('  <div class="rmd-section-block">');
    h.push('    <h4 class="rmd-section-label">Evidence Provenance &amp; Source Document</h4>');
    h.push('    <div class="rmd-provenance-box">');
    h.push('      <div class="rmd-prov-row"><span class="rmd-prov-lbl">Citation:</span> <span>' + esc(loc.citation || "No citation provided") + '</span></div>');
    if (loc.page) {
      h.push('      <div class="rmd-prov-row smd-books-keep"><span class="rmd-prov-lbl">Page:</span> <span>p. ' + esc(loc.page) + '</span></div>');
    }
    if (loc.section) {
      h.push('      <div class="rmd-prov-row"><span class="rmd-prov-lbl">Section:</span> <span>' + esc(loc.section) + '</span></div>');
    }
    if (loc.table) {
      h.push('      <div class="rmd-prov-row"><span class="rmd-prov-lbl">Table/Figure:</span> <span>' + esc(loc.table) + '</span></div>');
    }
    var quote = s.quote || loc.quote;
    if (quote) {
      h.push('      <div class="rmd-quote-block">');
      h.push('        <div class="rmd-quote-tag">Exact Source Quote</div>');
      h.push('        <blockquote>&ldquo;' + esc(quote) + '&rdquo;</blockquote>');
      h.push('      </div>');
    }
    h.push('    </div>');
    h.push('  </div>');

    // Verification Status & Audit
    h.push('  <div class="rmd-verify-block">');
    if (s.verified) {
      h.push('    <div class="rmd-verify-status-box rmd-verify-ok">');
      h.push('      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>');
      h.push('      <div>');
      h.push('        <strong>Verified by ' + esc(s.verifiedBy || "clinician") + '</strong>');
      h.push('        <p>Values were validated against the cited document quote and page.</p>');
      h.push('      </div>');
      h.push('    </div>');
      h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-verify="' + esc(s.id) + '">Mark Unverified</button>');
    } else {
      h.push('    <div class="rmd-verify-status-box rmd-verify-warn">');
      h.push('      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>');
      h.push('      <div>');
      h.push('        <strong>Unverified Study</strong>');
      h.push('        <p>ResearchMD refuses unverified studies in meta-analysis runs per research integrity rules.</p>');
      h.push('      </div>');
      h.push('    </div>');
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-verify="' + esc(s.id) + '">Verify Study Values</button>');
    }
    h.push('  </div>');

    h.push('</div>');
    return h.join("\n");
  }

  function renderStudyForm(study) {
    var isEdit = !!study;
    var measure = study ? study.measure : "RR";
    var inputs = study ? study.inputs : {};
    var locator = study ? (study.locator || {}) : {};
    var inType = detectInputType(measure, inputs);
    currentInputType = inType;

    var h = [];
    h.push('<div class="rmd-form-card">');
    h.push('  <div class="rmd-form-header">');
    h.push('    <h3>' + (isEdit ? 'Edit Study Data (v' + (study.version || 1) + ')' : 'Add Extracted Study') + '</h3>');
    h.push('    <button type="button" class="rmd-btn-close" data-rmd="cancel-study" aria-label="Cancel">&times;</button>');
    h.push('  </div>');

    h.push('  <form id="rmdStudyForm" class="rmd-form">');
    if (formError) {
      h.push((SMD.p2 && SMD.p2.errHtml) ? SMD.p2.errHtml(formError) : '<div class="rmd-banner rmd-banner-error" role="alert"><strong>' + esc(formError.message || "Something went wrong.") + '</strong></div>');
    }
    if (isEdit) {
      h.push('    <input type="hidden" id="rmd_st_version" value="' + (study.version || 1) + '">');
      h.push('    <input type="hidden" id="rmd_st_id" value="' + esc(study.id) + '">');
    }

    h.push('    <div class="rmd-field">');
    h.push('      <label for="rmd_st_label">Study label (first author and year) <span class="rmd-req">*</span></label>');
    h.push('      <input type="text" id="rmd_st_label" required placeholder="e.g. Aronson 1948" value="' + esc(study ? study.label : '') + '">');
    h.push('    </div>');

    h.push('    <div class="rmd-form-row">');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_st_measure">Effect measure (the statistic comparing the two groups)</label>');
    h.push('        <select id="rmd_st_measure">');
    var measures = ["RR", "OR", "HR", "RD", "MD", "SMD"];
    for (var m = 0; m < measures.length; m++) {
      h.push('          <option value="' + measures[m] + '"' + (measure === measures[m] ? ' selected' : '') + '>' + measures[m] + '</option>');
    }
    h.push('        </select>');
    h.push('      </div>');

    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_st_input_type">Input format (how the numbers are written)</label>');
    h.push('        <select id="rmd_st_input_type">');
    h.push('          <option value="rawCounts"' + (inType === 'rawCounts' ? ' selected' : '') + '>2x2 Raw Counts (Events &amp; Total)</option>');
    h.push('          <option value="rawMeans"' + (inType === 'rawMeans' ? ' selected' : '') + '>Continuous (Mean, SD, N)</option>');
    h.push('          <option value="reported"' + (inType === 'reported' ? ' selected' : '') + '>Reported Effect &amp; 95% CI</option>');
    h.push('          <option value="generic"' + (inType === 'generic' ? ' selected' : '') + '>Generic Inverse-Variance (yi, SE)</option>');
    h.push('        </select>');
    h.push('      </div>');
    h.push('    </div>');

    // Dynamic Data Fields Container
    h.push('    <div id="rmdDataFields" class="rmd-data-fields-wrap">');
    h.push(renderDataFieldsHtml(inType, inputs));
    h.push('    </div>');

    // Evidence Locator Section (Per locator.schema.json)
    h.push('    <div class="rmd-locator-section">');
    h.push('      <h4 class="rmd-section-label">Source provenance (where the numbers came from)</h4>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_st_citation">Citation (the paper reference or DOI) <span class="rmd-req">*</span></label>');
    h.push('        <input type="text" id="rmd_st_citation" required placeholder="e.g. Aronson JD, Am Rev Tuberc 1948; 58:255-281" value="' + esc(locator.citation || '') + '">');
    h.push('      </div>');

    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_st_page">Page (where in the paper)</label>');
    h.push('          <input type="text" id="rmd_st_page" placeholder="e.g. 258 or 258-260" value="' + esc(locator.page || '') + '">');
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_st_section">Section or table (where the numbers appear)</label>');
    h.push('          <input type="text" id="rmd_st_section" placeholder="e.g. Results, Table 2" value="' + esc(locator.section || locator.table || '') + '">');
    h.push('        </div>');
    h.push('      </div>');

    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_st_quote">Exact quote (the sentence from the paper with the numbers)</label>');
    h.push('        <textarea id="rmd_st_quote" rows="2" placeholder="e.g. At 10 years, 4 cases occurred in the vaccinated group (n=123)...">' + esc(study ? (study.quote || locator.quote) : '') + '</textarea>');
    h.push('        <span class="rmd-field-hint">Quote the exact sentence or table cell to allow source auditing.</span>');
    h.push('      </div>');
    h.push('    </div>');

    // Verification Switch
    var isVer = study ? !!study.verified : false;
    h.push('    <div class="rmd-field rmd-checkbox-field">');
    h.push('      <label class="rmd-check-label">');
    h.push('        <input type="checkbox" id="rmd_st_verified"' + (isVer ? ' checked' : '') + '>');
    h.push('        <span>I have verified these values against the cited source quote and page.</span>');
    h.push('      </label>');
    h.push('      <p class="rmd-check-note">ResearchMD strictly requires verification before any study can be included in a meta-analysis.</p>');
    h.push('    </div>');

    h.push('    <div class="rmd-modal-footer">');
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="cancel-study">Cancel</button>');
    h.push('      <button type="submit" class="rmd-btn rmd-btn-primary" data-rmd="save-study">' + (isEdit ? 'Save Changes' : 'Add Study') + '</button>');
    h.push('    </div>');
    h.push('  </form>');
    h.push('</div>');

    return h.join("\n");
  }

  function renderDataFieldsHtml(type, inputs) {
    inputs = inputs || {};
    var h = [];
    if (type === "rawCounts") {
      h.push('<div class="rmd-sub-card">');
      h.push('  <div class="rmd-form-row">');
      h.push('    <div class="rmd-field"><label for="rmd_st_events1">Intervention Events</label><input type="number" id="rmd_st_events1" min="0" placeholder="e.g. 4" value="' + (inputs.events1 != null ? inputs.events1 : '') + '"></div>');
      h.push('    <div class="rmd-field"><label for="rmd_st_n1">Intervention Total (N1)</label><input type="number" id="rmd_st_n1" min="1" placeholder="e.g. 123" value="' + (inputs.n1 != null ? inputs.n1 : '') + '"></div>');
      h.push('  </div>');
      h.push('  <div class="rmd-form-row">');
      h.push('    <div class="rmd-field"><label for="rmd_st_events2">Control Events</label><input type="number" id="rmd_st_events2" min="0" placeholder="e.g. 11" value="' + (inputs.events2 != null ? inputs.events2 : '') + '"></div>');
      h.push('    <div class="rmd-field"><label for="rmd_st_n2">Control Total (N2)</label><input type="number" id="rmd_st_n2" min="1" placeholder="e.g. 139" value="' + (inputs.n2 != null ? inputs.n2 : '') + '"></div>');
      h.push('  </div>');
      h.push('</div>');
    } else if (type === "rawMeans") {
      h.push('<div class="rmd-sub-card">');
      h.push('  <div class="rmd-form-row">');
      h.push('    <div class="rmd-field"><label for="rmd_st_mean1">Intervention Mean</label><input type="number" step="any" id="rmd_st_mean1" placeholder="e.g. 15.2" value="' + (inputs.mean1 != null ? inputs.mean1 : '') + '"></div>');
      h.push('    <div class="rmd-field"><label for="rmd_st_sd1">Intervention SD</label><input type="number" step="any" id="rmd_st_sd1" min="0.0001" placeholder="e.g. 3.4" value="' + (inputs.sd1 != null ? inputs.sd1 : '') + '"></div>');
      h.push('    <div class="rmd-field"><label for="rmd_st_n1_m">Intervention N</label><input type="number" id="rmd_st_n1_m" min="1" placeholder="e.g. 50" value="' + (inputs.n1 != null ? inputs.n1 : '') + '"></div>');
      h.push('  </div>');
      h.push('  <div class="rmd-form-row">');
      h.push('    <div class="rmd-field"><label for="rmd_st_mean2">Control Mean</label><input type="number" step="any" id="rmd_st_mean2" placeholder="e.g. 18.5" value="' + (inputs.mean2 != null ? inputs.mean2 : '') + '"></div>');
      h.push('    <div class="rmd-field"><label for="rmd_st_sd2">Control SD</label><input type="number" step="any" id="rmd_st_sd2" min="0.0001" placeholder="e.g. 4.1" value="' + (inputs.sd2 != null ? inputs.sd2 : '') + '"></div>');
      h.push('    <div class="rmd-field"><label for="rmd_st_n2_m">Control N</label><input type="number" id="rmd_st_n2_m" min="1" placeholder="e.g. 50" value="' + (inputs.n2 != null ? inputs.n2 : '') + '"></div>');
      h.push('  </div>');
      h.push('</div>');
    } else if (type === "reported") {
      h.push('<div class="rmd-sub-card">');
      h.push('  <div class="rmd-form-row">');
      h.push('    <div class="rmd-field"><label for="rmd_st_effect">Effect Estimate (e.g. OR, RR, HR)</label><input type="number" step="any" id="rmd_st_effect" placeholder="e.g. 0.75" value="' + (inputs.effect != null ? inputs.effect : '') + '"></div>');
      h.push('    <div class="rmd-field"><label for="rmd_st_cilower">95% CI Lower</label><input type="number" step="any" id="rmd_st_cilower" placeholder="e.g. 0.55" value="' + (inputs.ciLower != null ? inputs.ciLower : '') + '"></div>');
      h.push('    <div class="rmd-field"><label for="rmd_st_ciupper">95% CI Upper</label><input type="number" step="any" id="rmd_st_ciupper" placeholder="e.g. 0.98" value="' + (inputs.ciUpper != null ? inputs.ciUpper : '') + '"></div>');
      h.push('  </div>');
      h.push('</div>');
    } else if (type === "generic") {
      h.push('<div class="rmd-sub-card">');
      h.push('  <div class="rmd-form-row">');
      h.push('    <div class="rmd-field"><label for="rmd_st_yi">Log Effect Size (yi)</label><input type="number" step="any" id="rmd_st_yi" placeholder="e.g. -0.287" value="' + (inputs.yi != null ? inputs.yi : '') + '"></div>');
      h.push('    <div class="rmd-field"><label for="rmd_st_se">Standard Error (se)</label><input type="number" step="any" id="rmd_st_se" min="0.0001" placeholder="e.g. 0.142" value="' + (inputs.se != null ? inputs.se : '') + '"></div>');
      h.push('  </div>');
      h.push('</div>');
    }
    return h.join("\n");
  }

  // Conflict Resolution Modal (HTTP 409 stale_version)
  function renderConflictModal(conflict) {
    var h = [];
    var local = conflict.local || {};
    var server = conflict.server || {};

    h.push('<div class="rmd-modal-backdrop" id="rmdConflictModal">');
    h.push('  <div class="rmd-modal-card rmd-modal-wide" role="dialog" aria-modal="true">');
    h.push('    <div class="rmd-modal-header rmd-modal-warn">');
    h.push('      <div class="rmd-warn-hdr-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>');
    h.push('      <div>');
    h.push('        <h3>This study changed while you were editing</h3>');
    h.push('        <p>It was updated on another session or device. Choose which version to keep:</p>');
    h.push('      </div>');
    h.push('    </div>');

    h.push('    <div class="rmd-conflict-grid">');
    // Local Card
    h.push('      <div class="rmd-conflict-col rmd-conflict-local">');
    h.push('        <div class="rmd-conflict-tag">Your Changes (v' + (local.version || "1") + ')</div>');
    h.push('        <h4>' + esc(local.label || server.label) + '</h4>');
    h.push('        <div class="rmd-conflict-values">' + esc(formatStudyData(server.measure, local.inputs)) + '</div>');
    if (local.quote) {
      h.push('        <div class="rmd-conflict-quote">&ldquo;' + esc(local.quote) + '&rdquo;</div>');
    }
    h.push('        <div class="rmd-conflict-ver">Status: ' + (local.verified ? 'Verified' : 'Unverified') + '</div>');
    h.push('        <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="conflict-keep-local" data-rmd-study="' + esc(conflict.studyId) + '">Keep My Local Changes</button>');
    h.push('      </div>');

    // Server Card
    h.push('      <div class="rmd-conflict-col rmd-conflict-server">');
    h.push('        <div class="rmd-conflict-tag">Server Stored (v' + (server.version || "1") + ')</div>');
    h.push('        <h4>' + esc(server.label) + '</h4>');
    h.push('        <div class="rmd-conflict-values">' + esc(formatStudyData(server.measure, server.inputs)) + '</div>');
    if (server.quote) {
      h.push('        <div class="rmd-conflict-quote">&ldquo;' + esc(server.quote) + '&rdquo;</div>');
    }
    h.push('        <div class="rmd-conflict-ver">Status: ' + (server.verified ? 'Verified' : 'Unverified') + '</div>');
    h.push('        <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="conflict-accept-server" data-rmd-study="' + esc(conflict.studyId) + '">Accept Server Version</button>');
    h.push('      </div>');
    h.push('    </div>');

    h.push('    <details class="rmd-banner-details"><summary>Details for support</summary><span class="rmd-banner-code">Code: stale_version (HTTP 409)</span></details>');

    h.push('  </div>');
    h.push('</div>');
    return h.join("\n");
  }

  function bindEvents(container) {
    var store = SMD.store;
    if (!store) return;
    var project = store.getActiveProject();
    if (!project) return;

    // Navigation to Projects
    var toProj = container.querySelectorAll('[data-rmd="to-projects"]');
    for (var a = 0; a < toProj.length; a++) {
      toProj[a].onclick = function () {
        if (SMD.navigate) SMD.navigate("projects");
      };
    }

    // Navigation to Run
    var toRun = container.querySelectorAll('[data-rmd="to-run"]');
    for (var b = 0; b < toRun.length; b++) {
      toRun[b].onclick = function () {
        if (SMD.navigate) SMD.navigate("run", { projectId: project.id });
      };
    }

    // Phone View switcher
    var segBtns = container.querySelectorAll('[data-rmd-phone-view]');
    for (var c = 0; c < segBtns.length; c++) {
      segBtns[c].onclick = function () {
        var v = this.getAttribute("data-rmd-phone-view");
        if (v === "list" || v === "detail") {
          editingStudyId = null;
          formError = null;
        }
        viewMode = v;
        renderStudies(container);
      };
    }

    // Filter Chips
    var chips = container.querySelectorAll('[data-rmd-filter]');
    for (var d = 0; d < chips.length; d++) {
      chips[d].onclick = function () {
        filterStatus = this.getAttribute("data-rmd-filter");
        renderStudies(container);
      };
    }

    // Add Study button (manual form)
    var addBtns = container.querySelectorAll('[data-rmd="add-study"]');
    for (var e = 0; e < addBtns.length; e++) {
      addBtns[e].onclick = function () {
        viewMode = "new";
        editingStudyId = null;
        formError = null;
        renderStudies(container);
      };
    }

    // Find and add studies (search sheet)
    var findBtns = container.querySelectorAll('[data-rmd="find-studies"]');
    for (var fb = 0; fb < findBtns.length; fb++) {
      findBtns[fb].onclick = function () {
        if (SMD.find && SMD.find.open) SMD.find.open(project);
      };
    }

    // Cancel Study form
    var cancelBtns = container.querySelectorAll('[data-rmd="cancel-study"]');
    for (var f = 0; f < cancelBtns.length; f++) {
      cancelBtns[f].onclick = function () {
        viewMode = "list";
        editingStudyId = null;
        renderStudies(container);
      };
    }

    // Study selection row: switch to Study Details on phone and clear stale edit pin
    var rows = container.querySelectorAll('.rmd-study-row');
    function selectStudyRow(rowEl) {
      var sid = rowEl ? rowEl.getAttribute("data-rmd-study-id") : "";
      if (!sid) return;
      editingStudyId = null;
      formError = null;
      viewMode = isPhoneViewport(container) ? "detail" : "list";
      store.setActiveStudy(sid);
      renderStudies(container);
    }
    for (var g = 0; g < rows.length; g++) {
      rows[g].setAttribute("tabindex", "0");
      rows[g].onclick = function (ev) {
        if (ev && ev.target && ev.target.closest('button')) return;
        selectStudyRow(this);
      };
      rows[g].onkeydown = function (ev) {
        if (!ev || (ev.key !== "Enter" && ev.key !== " " && ev.keyCode !== 13 && ev.keyCode !== 32)) return;
        if (ev.target && ev.target.closest('button')) return;
        if (ev.preventDefault) ev.preventDefault();
        selectStudyRow(this);
      };
    }

    // Edit Study button
    var editBtns = container.querySelectorAll('[data-rmd-edit]');
    for (var h = 0; h < editBtns.length; h++) {
      editBtns[h].onclick = function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        var sid = this.getAttribute("data-rmd-edit");
        if (sid) {
          editingStudyId = sid;
          viewMode = "edit";
          formError = null;
          renderStudies(container);
        }
      };
    }

    // Delete Study button
    var delBtns = container.querySelectorAll('[data-rmd-delete]');
    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].onclick = function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        var sid = this.getAttribute("data-rmd-delete");
        if (sid) {
          var study = store.getStudy(sid);
          var confirmText = "Delete study '" + (study ? study.label : sid) + "'?";
          if (confirm(confirmText)) {
            store.deleteStudy(sid);
            if (editingStudyId === sid) {
              editingStudyId = null;
              viewMode = "list";
            }
            renderStudies(container);
          }
        }
      };
    }

    // Toggle Verification button
    var verifyBtns = container.querySelectorAll('[data-rmd-verify]');
    for (var k = 0; k < verifyBtns.length; k++) {
      verifyBtns[k].onclick = function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        var sid = this.getAttribute("data-rmd-verify");
        if (sid) {
          store.toggleVerification(sid);
          renderStudies(container);
        }
      };
    }

    // Input Type Selector change in form
    var typeSelect = container.querySelector("#rmd_st_input_type");
    if (typeSelect) {
      typeSelect.onchange = function () {
        var wrap = container.querySelector("#rmdDataFields");
        if (wrap) {
          currentInputType = this.value;
          wrap.innerHTML = renderDataFieldsHtml(this.value, {});
        }
      };
    }

    // Measure Selector change in form
    var measSelect = container.querySelector("#rmd_st_measure");
    if (measSelect) {
      measSelect.onchange = function () {
        var m = this.value;
        var currentT = typeSelect ? typeSelect.value : "rawCounts";
        if ((m === "MD" || m === "SMD") && currentT === "rawCounts") {
          if (typeSelect) {
            typeSelect.value = "rawMeans";
            currentInputType = "rawMeans";
            var wrap = container.querySelector("#rmdDataFields");
            if (wrap) wrap.innerHTML = renderDataFieldsHtml("rawMeans", {});
          }
        } else if (m === "HR" && currentT === "rawCounts") {
          if (typeSelect) {
            typeSelect.value = "reported";
            currentInputType = "reported";
            var wrap2 = container.querySelector("#rmdDataFields");
            if (wrap2) wrap2.innerHTML = renderDataFieldsHtml("reported", {});
          }
        }
      };
    }

    // Study Form Submission
    var studyForm = container.querySelector("#rmdStudyForm");
    if (studyForm) {
      studyForm.onsubmit = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();

        var labelInput = studyForm.querySelector("#rmd_st_label");
        var measInput = studyForm.querySelector("#rmd_st_measure");
        var typeInput = studyForm.querySelector("#rmd_st_input_type");
        var citInput = studyForm.querySelector("#rmd_st_citation");
        var pageInput = studyForm.querySelector("#rmd_st_page");
        var secInput = studyForm.querySelector("#rmd_st_section");
        var quoteInput = studyForm.querySelector("#rmd_st_quote");
        var verInput = studyForm.querySelector("#rmd_st_verified");
        var idInput = studyForm.querySelector("#rmd_st_id");
        var verHidden = studyForm.querySelector("#rmd_st_version");

        var label = (labelInput ? labelInput.value : "").trim();
        var citation = (citInput ? citInput.value : "").trim();
        if (!label || !citation) {
          formError = { message: "Study label and citation are required." };
          renderStudies(container);
          return false;
        }
        formError = null;

        var inType = typeInput ? typeInput.value : "rawCounts";
        var inputs = {};
        if (inType === "rawCounts") {
          var ev1 = studyForm.querySelector("#rmd_st_events1");
          var n1 = studyForm.querySelector("#rmd_st_n1");
          var ev2 = studyForm.querySelector("#rmd_st_events2");
          var n2 = studyForm.querySelector("#rmd_st_n2");
          inputs.events1 = parseInt(ev1 ? ev1.value : "0", 10) || 0;
          inputs.n1 = parseInt(n1 ? n1.value : "1", 10) || 1;
          inputs.events2 = parseInt(ev2 ? ev2.value : "0", 10) || 0;
          inputs.n2 = parseInt(n2 ? n2.value : "1", 10) || 1;
        } else if (inType === "rawMeans") {
          inputs.mean1 = parseFloat(studyForm.querySelector("#rmd_st_mean1").value) || 0;
          inputs.sd1 = parseFloat(studyForm.querySelector("#rmd_st_sd1").value) || 1;
          inputs.n1 = parseInt(studyForm.querySelector("#rmd_st_n1_m").value, 10) || 1;
          inputs.mean2 = parseFloat(studyForm.querySelector("#rmd_st_mean2").value) || 0;
          inputs.sd2 = parseFloat(studyForm.querySelector("#rmd_st_sd2").value) || 1;
          inputs.n2 = parseInt(studyForm.querySelector("#rmd_st_n2_m").value, 10) || 1;
        } else if (inType === "reported") {
          inputs.effect = parseFloat(studyForm.querySelector("#rmd_st_effect").value) || 1;
          inputs.ciLower = parseFloat(studyForm.querySelector("#rmd_st_cilower").value) || 0.1;
          inputs.ciUpper = parseFloat(studyForm.querySelector("#rmd_st_ciupper").value) || 2;
          inputs.ciLevel = 0.95;
        } else if (inType === "generic") {
          inputs.yi = parseFloat(studyForm.querySelector("#rmd_st_yi").value) || 0;
          inputs.se = parseFloat(studyForm.querySelector("#rmd_st_se").value) || 0.1;
        }

        var studyData = {
          label: label,
          measure: measInput ? measInput.value : "RR",
          inputs: inputs,
          locator: {
            kind: "manual",
            citation: citation,
            page: pageInput ? pageInput.value.trim() : "",
            section: secInput ? secInput.value.trim() : "",
            quote: quoteInput ? quoteInput.value.trim() : ""
          },
          quote: quoteInput ? quoteInput.value.trim() : "",
          verified: !!(verInput && verInput.checked)
        };

        if (idInput && idInput.value) {
          // Update study
          var sid = idInput.value;
          studyData.version = verHidden ? parseInt(verHidden.value, 10) : 1;
          try {
            store.updateStudy(sid, studyData);
            viewMode = "list";
            editingStudyId = null;
            renderStudies(container);
          } catch (err) {
            if (err && err.code === "stale_version") {
              renderStudies(container);
            } else {
              formError = err;
              renderStudies(container);
            }
          }
        } else {
          // Create new study
          try {
            store.createStudy(project.id, studyData);
            viewMode = "list";
            editingStudyId = null;
            renderStudies(container);
          } catch (err) {
            formError = err;
            renderStudies(container);
          }
        }

        return false;
      };
    }

    // Conflict Resolution buttons
    var keepLocalBtn = container.querySelector('[data-rmd="conflict-keep-local"]');
    if (keepLocalBtn) {
      keepLocalBtn.onclick = function () {
        var sid = this.getAttribute("data-rmd-study");
        store.resolveConflict(sid, "keep_local");
        renderStudies(container);
      };
    }

    var acceptServerBtn = container.querySelector('[data-rmd="conflict-accept-server"]');
    if (acceptServerBtn) {
      acceptServerBtn.onclick = function () {
        var sid = this.getAttribute("data-rmd-study");
        store.resolveConflict(sid, "accept_server");
        renderStudies(container);
      };
    }
  }

  function editStudy(id) {
    if (SMD.find && SMD.find.close) SMD.find.close();
    editingStudyId = id;
    viewMode = "edit";
    formError = null;
    if (SMD.navigate) SMD.navigate("studies");
  }

  SMD.screens.studies = {
    render: renderStudies,
    editStudy: editStudy,
    hydrateRetractions: hydrateStudyRetractions
  };

})(typeof window !== "undefined" ? window : globalThis);
