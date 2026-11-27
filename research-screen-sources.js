/* StewardMD - ResearchMD Data sources and licences screen (window.SMD_RESEARCH.screens.sources).
 * ES5 only, buildless, mobile-first. Launch blocker F-20: one screen listing every
 * external literature database the connectors call (what is sent, licence, required
 * credit line, outbound link), the owner-approved sub-processor list, and ONE shared
 * credit-line helper (SMD.sources) the search, find, paper card and studies
 * renderers reuse so the required notices cannot drift.
 * Terms source: docs/research/research-2.0b-database-terms.md (sections 2, 3, 4, 4.9, 6, 8)
 * and the connector file headers in functions/api/research/_connectors/.
 * Semantic Scholar is deliberately absent: its connector is a refusing stub
 * (licence blocks commercial use) and no request ever reaches it.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
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

  /* Required notices, verbatim. Sources: connector file headers and
   * docs/research/research-2.0b-database-terms.md 2.7, 3.7, 4.7, 4.9, 6.7, 8.7.
   * Do not reword: these are the exact strings the terms require. */
  var NOTICES = {
    pubmed: "Courtesy of the U.S. National Library of Medicine",
    europe_pmc: "Data provided by Europe PMC",
    crossref: "Metadata provided by Crossref",
    clinicaltrials: "Data: ClinicalTrials.gov",
    openalex: "Data: OpenAlex",
    retraction: "Retraction data: Crossref / Retraction Watch"
  };

  var SOURCE_ORDER = ["pubmed", "europe_pmc", "crossref", "clinicaltrials", "openalex", "retraction"];

  var SOURCES = [
    {
      id: "pubmed",
      name: "PubMed (U.S. National Library of Medicine)",
      site: "https://pubmed.ncbi.nlm.nih.gov/",
      terms: "https://www.nlm.nih.gov/databases/download/terms_and_conditions.html",
      sent: "Search words and PubMed IDs (PMID, the number PubMed gives a paper). Never patient data.",
      licence: "Public domain data. NLM allows free use in a paid app when credit is shown. NLM, NCBI and NIH do not endorse this app."
    },
    {
      id: "europe_pmc",
      name: "Europe PMC",
      site: "https://europepmc.org/",
      terms: "https://www.ebi.ac.uk/about/terms-of-use/",
      sent: "Search words, PMIDs, PMC IDs and DOIs (digital object identifier, a permanent link to a paper). Never patient data.",
      licence: "Open API from EMBL-EBI. Metadata and abstracts are free to use. Full text is read only for open-access papers carrying a CC BY, CC BY-SA, CC0 or public domain licence (terms that allow commercial use); other papers get an outbound link instead."
    },
    {
      id: "crossref",
      name: "Crossref",
      site: "https://www.crossref.org/",
      terms: "https://www.crossref.org/terms/",
      sent: "Search words and DOIs. Never patient data.",
      licence: "CC0 (no rights reserved; the metadata is free for any use and may be stored indefinitely)."
    },
    {
      id: "clinicaltrials",
      name: "ClinicalTrials.gov",
      site: "https://clinicaltrials.gov/",
      terms: "https://clinicaltrials.gov/about-site/terms-conditions",
      sent: "Condition and treatment words, and NCT numbers (the registration number ClinicalTrials.gov gives a trial). Never patient data.",
      licence: "United States Government registry, free to use. Records are cached for 24 hours so they stay current. No United States Government endorsement of this app is implied."
    },
    {
      id: "openalex",
      name: "OpenAlex",
      site: "https://openalex.org/",
      terms: "https://help.openalex.org/",
      sent: "DOIs and PMIDs only. Never case text, thesis text or any project document.",
      licence: "CC0 (no rights reserved; the metadata is free for any use)."
    },
    {
      id: "retraction",
      name: "Retraction Watch (through Crossref)",
      site: "https://gitlab.com/crossref/retraction-watch-data",
      terms: "https://www.crossref.org/blog/news-crossref-and-retraction-watch/",
      sent: "DOIs only, to check whether a paper was retracted (withdrawn by its journal) or carries an expression of concern (a journal warning that a paper may be withdrawn). Never patient data.",
      licence: "Read through the Crossref API under its CC0 metadata terms. Each DOI result is cached for 24 hours."
    }
  ];

  /* Owner-approved public sub-processor list (F-20 brief 2026-11-27). No email,
   * SMS or error-logging vendor receives ResearchMD data (verified by grep of
   * functions/, wrangler.toml and privacy.html; see REPORT.md). */
  var PROCESSORS = [
    {
      name: "Cloudflare",
      data: "Your account ID, the research data you save to your account, and the text you send for AI drafting after its patient-identifier check",
      purpose: "Hosting, storage (database, cache, files) and global network delivery",
      countries: "Global network; may cache outside India, including the United States, the European Union and Singapore"
    },
    {
      name: "Google Firebase",
      data: "Your sign-in details and the app data you save to your account",
      purpose: "Sign-in and app data storage",
      countries: "India (Mumbai region) for stored data; other processing per Google infrastructure"
    },
    {
      name: "Google Vertex AI (Gemini)",
      data: "The text you ask to draft or summarise, after its patient-identifier check",
      purpose: "AI drafting with the Gemini model",
      countries: "Servers may be outside India"
    },
    {
      name: "Runware",
      data: "The text you ask to draft or summarise, after its patient-identifier check",
      purpose: "AI drafting; passes the text to an OpenAI GPT model",
      countries: "Servers may be outside India"
    },
    {
      name: "OpenAI",
      data: "The drafting text Runware passes on",
      purpose: "GPT model processing through Runware",
      countries: "Servers may be outside India"
    }
  ];

  function ensureCss() {
    if (!D || !D.createElement || !D.head || !D.getElementById) return;
    if (D.getElementById("rmdSourcesCss")) return;
    var s = D.createElement("style");
    s.id = "rmdSourcesCss";
    s.textContent = [
      "/* ResearchMD data-source credit lines (shared by search, find, paper card, studies) */",
      "#researchMD .rmd-source-credit { display: block; font-size: 11px; line-height: 1.45; color: var(--rmd-mut); margin-top: 6px; }",
      "#researchMD .rmd-source-credit a { color: var(--rmd-acc); text-decoration: underline; text-underline-offset: 2px; word-break: break-word; }",
      "#researchMD .rmd-src-links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 2px; }",
      "#researchMD .rmd-src-links a { color: var(--rmd-acc); font-size: 12.5px; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; word-break: break-word; padding: 4px 0; }",
      "#researchMD .rmd-proc-box { background: var(--rmd-fill); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; margin-top: 4px; }",
      "#researchMD .rmd-proc-name { font-weight: 600; color: var(--rmd-ink); }"
    ].join("\n");
    D.head.appendChild(s);
  }

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function fmtDate(value) {
    if (!value) return "";
    var d = (value instanceof Date) ? value : new Date(value);
    if (!d || isNaN(d.getTime())) return "";
    var m = MONTHS[d.getMonth()];
    if (!m) return "";
    return d.getDate() + " " + m + " " + d.getFullYear();
  }

  function indexOfId(id) {
    for (var i = 0; i < SOURCE_ORDER.length; i++) {
      if (SOURCE_ORDER[i] === id) return i;
    }
    return SOURCE_ORDER.length;
  }

  /* Collect the source ids present in a result list. Reads item.source and the
   * merged item.sources array (find-studies merges duplicates across sources). */
  function itemsSources(items) {
    var seen = {};
    var out = [];
    if (Object.prototype.toString.call(items) !== "[object Array]") return out;
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var list = (Object.prototype.toString.call(it.sources) === "[object Array]" && it.sources.length) ? it.sources : [it.source];
      for (var j = 0; j < list.length; j++) {
        var id = String(list[j] || "");
        if (NOTICES[id] && !seen[id]) { seen[id] = 1; out.push(id); }
      }
    }
    out.sort(function (a, b) { return indexOfId(a) - indexOfId(b); });
    return out;
  }

  /* The one credit-line builder every renderer shares. sourceIds may be a single
   * id, an array of ids, or an array of result items (auto-detected). retrievedAt
   * is optional and renders "Retrieved {date}" when given. opts.attr adds a raw
   * attribute string (e.g. ' data-rmd="sources-credit"'). */
  function creditHtml(sourceIds, retrievedAt, opts) {
    ensureCss();
    var ids = sourceIds;
    if (ids && Object.prototype.toString.call(ids) !== "[object Array]") ids = [ids];
    if (!ids || !ids.length) return "";
    var itemsLike = true;
    for (var c = 0; c < ids.length; c++) {
      var entry = ids[c];
      if (typeof entry === "string" || entry == null) { itemsLike = false; break; }
    }
    if (itemsLike) ids = itemsSources(ids);
    var parts = [];
    for (var i = 0; i < ids.length; i++) {
      var id = String(ids[i] || "");
      if (NOTICES[id]) parts.push(esc(NOTICES[id]));
    }
    if (!parts.length) return "";
    var line = parts.join(" &middot; ");
    var dateTxt = fmtDate(retrievedAt);
    if (dateTxt) line += " &middot; Retrieved " + esc(dateTxt);
    var attr = (opts && opts.attr) ? (" " + String(opts.attr)) : "";
    return '<div class="rmd-source-credit"' + attr + ">" + line + "</div>";
  }

  function sourceCardHtml(src) {
    var h = [];
    h.push('<div class="rmd-card" data-rmd-source="' + esc(src.id) + '">');
    h.push('<h3 class="rmd-card-heading">' + esc(src.name) + '</h3>');
    h.push('<div class="rmd-provenance-box">');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Sent</span><span>' + esc(src.sent) + '</span></div>');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Licence</span><span>' + esc(src.licence) + '</span></div>');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Credit</span><span class="rmd-source-credit" style="margin-top:0">' + esc(NOTICES[src.id]) + '</span></div>');
    h.push('</div>');
    h.push('<div class="rmd-src-links">');
    h.push('<a href="' + esc(src.site) + '" target="_blank" rel="noopener noreferrer" aria-label="Open ' + esc(src.name) + ' website">Visit</a>');
    h.push('<a href="' + esc(src.terms) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(src.name) + ' terms">Terms</a>');
    h.push('</div>');
    h.push('</div>');
    return h.join("\n");
  }

  function processorBoxHtml(p) {
    var h = [];
    h.push('<div class="rmd-proc-box" data-rmd-processor="' + esc(p.name) + '">');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Company</span><span class="rmd-proc-name">' + esc(p.name) + '</span></div>');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Data</span><span>' + esc(p.data) + '</span></div>');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Purpose</span><span>' + esc(p.purpose) + '</span></div>');
    h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Countries</span><span>' + esc(p.countries) + '</span></div>');
    h.push('</div>');
    return h.join("\n");
  }

  function render(container) {
    if (!container) return;
    ensureCss();
    var store = SMD.store;
    var project = store && store.getActiveProject ? store.getActiveProject() : null;

    var h = [];
    h.push('<div class="rmd-studies-screen rmd-sources-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Data sources and licences</h2>');
    if (project && project.title) h.push('<span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div></div>');

    h.push('<div class="rmd-p2-screen">');

    h.push('<div class="rmd-p2-cols">');

    h.push('<div>');
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Where the literature comes from</h3>');
    h.push('<p class="rmd-muted" style="margin:0">ResearchMD searches these public medical databases through its server. Only search words and paper identifiers leave your phone. Patient data is never sent to a literature database.</p>');
    h.push('</div>');
    for (var i = 0; i < SOURCES.length; i++) {
      h.push(sourceCardHtml(SOURCES[i]));
    }
    h.push('</div>');

    h.push('<div>');
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Who processes your data</h3>');
    h.push('<p class="rmd-muted" style="margin:0">These companies process your data as our sub-processors (companies that handle data for us under contract). Servers outside India are used only where listed. The search words covered above carry no patient data.</p>');
    for (var p = 0; p < PROCESSORS.length; p++) {
      h.push(processorBoxHtml(PROCESSORS[p]));
    }
    h.push('<div class="rmd-src-links"><a href="https://stewardmd.in/privacy.html" target="_blank" rel="noopener noreferrer" aria-label="Open the StewardMD privacy policy">Full privacy policy</a></div>');
    h.push('</div>');

    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Credit lines and retrieval dates</h3>');
    h.push('<p class="rmd-muted" style="margin:0">Screens that show literature results also show the credit line each source requires, and the date the results were retrieved when the screen knows it. The credit lines are the exact wording the database terms ask for.</p>');
    h.push('</div>');
    h.push('</div>');

    h.push('</div>');
    h.push('</div>');
    h.push('</div>');

    container.innerHTML = h.join("\n");
  }

  SMD.screens.sources = { render: render };

  SMD.sources = {
    NOTICES: NOTICES,
    SOURCES: SOURCES,
    PROCESSORS: PROCESSORS,
    notice: function (id) { return NOTICES[id] || ""; },
    itemsSources: itemsSources,
    creditHtml: creditHtml,
    fmtDate: fmtDate
  };

})(typeof window !== "undefined" ? window : globalThis);
