/* StewardMD - ResearchMD novelty screen.
 * ES5 IIFE. Registers SMD.screens.novelty. Plan item 2.
 * Searches published cases from the diagnosis and the unusual feature only.
 * No age, sex, dates or patient details are sent. Search costs 0 MaiK tokens;
 * adding a reference is a local study entry, not an AI extraction.
 * No em or en dashes.
 */
(function (G) {
  "use strict";
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "novelty";

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function labelFor(name) {
    var C = G.SMD_RESEARCH_CONTRACTS;
    if (C && C.STEP_LABELS && C.STEP_LABELS[name]) return C.STEP_LABELS[name];
    return name;
  }

  function trim(s) { return String(s == null ? "" : s).replace(/^\s+|\s+$/g, ""); }

  /* Query from diagnosis + unusual feature only. Strip anything date-like,
   * age-like or sex-like that may sit inside the free text. Never throws. */
  function buildNoveltyQuery(casefile) {
    var cf = (casefile && typeof casefile === "object") ? casefile : {};
    var text = trim(cf.diagnosis) + " " + trim(cf.unusual);
    text = text
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
      .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, " ")
      .replace(/\b\d{1,3}\s*[- ]\s*year\s*[- ]\s*old\b/gi, " ")
      .replace(/\b\d{1,3}\s*(years?|yrs?)\s*(old|of age)?\b/gi, " ")
      .replace(/\b(male|female|man|woman|boy|girl)\b/gi, " ")
      .replace(/\s+/g, " ");
    text = trim(text);
    if (text.length > 300) text = trim(text.slice(0, 300));
    return text;
  }

  function keyOf(item) {
    if (item && item.pmid) return "pmid:" + item.pmid;
    if (item && item.doi) return "doi:" + item.doi;
    return "t:" + ((item && item.title) || "");
  }

  function citationOf(item) {
    var parts = [];
    var authors = (item && item.authors) || [];
    if (authors.length) {
      parts.push(authors[0] + (authors.length > 1 ? " et al" : ""));
    }
    if (item && item.journal) parts.push(item.journal);
    if (item && item.year) parts.push(String(item.year));
    var cit = parts.join(", ");
    if (!cit) cit = trim((item && item.title) || "Published case");
    if (item && item.pmid) cit += ". PMID: " + item.pmid;
    if (item && item.doi) cit += ". doi:" + item.doi;
    return cit;
  }

  var st = null;

  function freshState(pid) {
    return {
      pid: pid, container: null,
      cf: null, patientNote: "", query: "",
      results: null, searching: false, searched: false,
      error: null, addError: null, adding: {}, added: {}, expanded: {}
    };
  }

  function injectCss() {
    var D = G.document;
    if (!D || D.getElementById("rmdNoveltyCss")) return;
    var s = D.createElement("style");
    s.id = "rmdNoveltyCss";
    s.textContent = [
      "#researchMD .rmd-nv-result { padding: 12px 0; border-top: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-nv-result:first-child { border-top: 0; }",
      "#researchMD .rmd-nv-title { font: 600 14.5px/1.4 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-nv-meta { font: 400 12.5px/1.4 var(--rmd-f); color: var(--rmd-mut); margin-top: 3px; }",
      "#researchMD .rmd-nv-abstract { font: 400 13px/1.5 var(--rmd-f); color: var(--rmd-ink); margin-top: 6px; }",
      "#researchMD .rmd-nv-abstract-clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }",
      "#researchMD .rmd-nv-actions { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }",
      "#researchMD .rmd-nv-added { font: 600 12.5px var(--rmd-f); color: var(--rmd-acc); }",
      /* Shared base only forces 44px targets at iPad width; scope phone fixes here. */
      "#researchMD .rmd-novelty-screen .rmd-btn, #researchMD .rmd-novelty-screen label.rmd-btn { min-height: 44px; }",
      "#researchMD .rmd-novelty-screen .rmd-btn:focus-visible { outline: 2px solid var(--rmd-acc, #1b41bf); outline-offset: 2px; }",
      "#researchMD .rmd-novelty-screen input[type=text], #researchMD .rmd-novelty-screen select, #researchMD .rmd-novelty-screen textarea { min-height: 44px; }"
    ].join("\n");
    D.head.appendChild(s);
  }

  function stepBannerHtml() {
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    var idx = -1, i;
    for (i = 0; i < journey.length; i++) if (journey[i] === KEY) idx = i;
    var nextName = (idx >= 0 && idx + 1 < journey.length) ? journey[idx + 1] : "";
    var stepNo = idx >= 0 ? idx + 1 : 1;
    var stepCount = journey.length || 1;
    var nextLabel = nextName ? labelFor(nextName) : "continue when this step is ready";
    var h = '<div class="rmd-step-banner" role="status">';
    h += '<div class="rmd-step-line"><span class="rmd-step-text"><strong>Step ' + stepNo + ' of ' + stepCount + '</strong> ' + esc(labelFor(KEY)) + '</span></div>';
    h += '</div>';
    h += '<p class="rmd-next-line">Next: ' + esc(nextLabel) + '</p>';
    return h;
  }

  function resultHtml(item) {
    var k = keyOf(item);
    var authors = (item.authors && item.authors.length) ? item.authors.slice(0, 3).join(", ") : "";
    if (item.authors && item.authors.length > 3) authors += " et al.";
    var meta = [];
    if (authors) meta.push(authors);
    if (item.journal) meta.push(item.journal);
    if (item.year) meta.push(String(item.year));
    var added = !!st.added[k];
    var adding = !!(st.adding && st.adding[k]);
    var expanded = !!st.expanded[k];
    var h = '<div class="rmd-nv-result">';
    h += '<div class="rmd-nv-title">' + esc(item.title || "Untitled paper") + '</div>';
    h += '<div class="rmd-nv-meta">' + esc(meta.join(" · ")) + '</div>';
    if (item.freeFullText) h += '<span class="rmd-badge rmd-badge-soft">Free full text</span>';
    if (item.abstract) {
      h += '<div class="rmd-nv-abstract' + (expanded ? "" : " rmd-nv-abstract-clamp") + '">' + esc(item.abstract) + '</div>';
      h += '<div class="rmd-nv-actions"><button type="button" class="rmd-btn rmd-btn-quiet rmd-btn-sm" data-rmd-nv-expand="' + esc(k) + '">' + (expanded ? "Less" : "More") + '</button>';
    } else {
      h += '<div class="rmd-nv-actions">';
    }
    if (added) {
      h += '<span class="rmd-nv-added" role="status">Added to your references</span>';
    } else {
      h += '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-nv-add="' + esc(k) + '"' + (adding ? " disabled" : "") + '>' + (adding ? "Adding..." : "Add to my references") + '</button>';
    }
    h += '</div></div>';
    return h;
  }

  function draw() {
    if (!st || !st.container) return;
    var h = [], i;
    h.push('<div class="rmd-p2-screen rmd-' + KEY + '-screen">');
    h.push(stepBannerHtml());
    h.push('<div class="rmd-card">');
    h.push('<h3>Is this case new? <span class="rmd-badge rmd-badge-soft">0 MaiK tokens</span></h3>');
    h.push('<p class="rmd-muted">We search published cases using your diagnosis and what is new or unusual. No age, sex, dates or patient details are sent.</p>');
    if (st.patientNote) h.push('<p class="rmd-muted">' + esc(st.patientNote) + '</p>');
    h.push('<div class="rmd-form">');
    h.push('<div class="rmd-field"><label for="rmdNvQuery">Search query</label>');
    h.push('<textarea id="rmdNvQuery" rows="3">' + esc(st.query) + '</textarea>');
    h.push('<p class="rmd-muted">Built from the case file. Edit it if you want, but keep patient details out.</p></div>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-nv="search"' + (st.searching || !trim(st.query) ? " disabled" : "") + '>' + (st.searching ? "Searching" : "Search published cases") + '</button>');
    h.push('</div></div>');

    if (st.searching) {
      h.push('<div class="rmd-card">' + (SMD.p2 ? SMD.p2.loadingHtml("Searching PubMed and Europe PMC") : "Searching") + '</div>');
    } else if (st.error) {
      if (st.error.isPhi && st.error.findings) {
        h.push('<div class="rmd-card">' +
          '<div class="rmd-banner rmd-banner-warn" role="alert">' +
          '<strong>De-identification findings (must fix before sending):</strong>' +
          '<ul style="margin:6px 0 0 16px; padding:0; font-size:12px;">' +
          st.error.findings.map(function (f) {
            var fix = f.indexOf("phone") >= 0 ? "Remove phone number." :
                      f.indexOf("date") >= 0 ? "Convert dates to Day N." :
                      f.indexOf("email") >= 0 ? "Remove email address." :
                      f.indexOf("aadhaar") >= 0 ? "Remove Aadhaar number." :
                      f.indexOf("uhid") >= 0 ? "Remove hospital identification number." : "Remove personal identifier.";
            return '<li><span class="rmd-finding-match">' + esc(f) + '</span>: ' + esc(fix) + '</li>';
          }).join("") +
          '</ul></div></div>');
      } else {
        h.push('<div class="rmd-card">' + (SMD.p2 ? SMD.p2.errHtml(st.error, "nv-retry") : '<div class="rmd-banner rmd-banner-error" role="alert">' + esc(st.error.message) + '</div>') + '</div>');
      }
    } else if (st.searched && st.results) {
      h.push('<div class="rmd-card">');
      h.push('<h3 role="status">We found ' + st.results.length + ' similar published cases</h3>');
      if (st.addError) {
        h.push(SMD.p2 ? SMD.p2.errHtml(st.addError, null) : '<div class="rmd-banner rmd-banner-error" role="alert">' + esc(st.addError.message || "Could not add reference.") + '</div>');
      }
      if (!st.results.length) {
        h.push('<p class="rmd-muted">Nothing close came back. That supports the novelty of your case. Still read the journal\u2019s scope before you submit.</p>');
      } else {
        h.push('<p class="rmd-muted">Read each one. If a paper reports the same finding, say how your case differs in the discussion.</p>');
        for (i = 0; i < st.results.length; i++) h.push(resultHtml(st.results[i]));
      }
      h.push('</div>');
    }
    h.push('</div>');
    st.container.innerHTML = h.join("");
    bind();
  }

  function alreadyAdded(item) {
    if (!SMD.store || !SMD.store.getStudies) return false;
    var studies = SMD.store.getStudies(st.pid) || [];
    var pmid = item.pmid ? "PMID: " + item.pmid : "";
    var doi = item.doi ? "doi:" + item.doi : "";
    for (var i = 0; i < studies.length; i++) {
      var cit = (studies[i].locator && studies[i].locator.citation) || "";
      if ((pmid && cit.indexOf(pmid) >= 0) || (doi && cit.indexOf(doi) >= 0)) return true;
    }
    return false;
  }

  function doSearch() {
    if (!st || st.searching) return;
    var inputEl = st.container ? st.container.querySelector("#rmdNvQuery") : null;
    if (inputEl && inputEl.value != null) st.query = inputEl.value;
    var q = trim(st.query);
    if (!q) return;

    if (!G.RMDPhi || !G.RMDPhi.scan) {
      st.searching = false;
      st.results = null;
      st.error = {
        isPhi: true,
        findings: ["The privacy check did not load. Close and reopen the app, then try again."],
        message: "The privacy check did not load. Close and reopen the app, then try again."
      };
      draw();
      return;
    }

    var phiHits = G.RMDPhi.scan(q);
    var redactFn = (G && G.SMD_redactPHI) ? G.SMD_redactPHI : (typeof window !== "undefined" && window.SMD_redactPHI ? window.SMD_redactPHI : null);
    var redactChanged = false;
    if (redactFn) {
      try {
        var rq = redactFn(q);
        if (rq !== q) redactChanged = true;
      } catch (e) {}
    }

    if (phiHits.length > 0 || redactChanged) {
      var findings = [];
      for (var f = 0; f < phiHits.length; f++) {
        var item = phiHits[f];
        findings.push(item.kind + ": " + item.match);
      }
      if (redactChanged && !phiHits.length) {
        findings.push("personal identifier flagged");
      }
      st.searching = false;
      st.results = null;
      st.error = {
        isPhi: true,
        findings: findings,
        message: "De-identification findings (must fix before sending): " + findings.join("; ")
      };
      draw();
      return;
    }

    st.searching = true;
    st.error = null;
    draw();
    var apiProj = (SMD.store && SMD.store.getProject) ? SMD.store.getProject(st.pid) : null;
    var apiPid = (apiProj && apiProj.serverId) || st.pid;
    SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPid) + "/find-studies", { q: q, limit: 20 })
      .then(function (data) {
        st.searching = false;
        st.searched = true;
        st.results = (data && data.results) || [];
        st.added = {};
        for (var i = 0; i < st.results.length; i++) {
          if (alreadyAdded(st.results[i])) st.added[keyOf(st.results[i])] = true;
        }
        draw();
      })
      .catch(function (err) {
        st.searching = false;
        st.error = (SMD.p2 && SMD.p2.friendlyError) ? SMD.p2.friendlyError(err) : { message: "Search failed. Try again." };
        draw();
      });
  }

  function addToReferences(k) {
    var item = null, i;
    for (i = 0; st.results && i < st.results.length; i++) {
      if (keyOf(st.results[i]) === k) { item = st.results[i]; break; }
    }
    if (!item || st.added[k] || (st.adding && st.adding[k])) return;
    st.addError = null;
    var apiProj = (SMD.store && SMD.store.getProject) ? SMD.store.getProject(st.pid) : null;
    var apiPid = (apiProj && apiProj.serverId) || st.pid;
    var isLocalOnly = !!(apiProj && !apiProj.serverId && (apiProj.practice || apiProj.tutorial || String(apiProj.id || "").indexOf("loc_") === 0));
    function saveLocalRef() {
      if (!SMD.store || !SMD.store.createStudy) return;
      SMD.store.createStudy(st.pid, {
        label: trim(item.title || "Published case").slice(0, 120) || "Published case",
        measure: "RR",
        inputs: {},
        locator: {
          kind: "manual",
          citation: citationOf(item),
          quote: trim(item.abstract || "").slice(0, 400)
        },
        verified: false
      });
    }
    if (SMD.api && typeof SMD.api.request === "function" && !isLocalOnly && apiPid) {
      st.adding[k] = true;
      draw();
      SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(apiPid) + "/records", {
        source: item.source || "",
        pmid: item.pmid || "",
        doi: item.doi || "",
        title: trim(item.title || "Published case") || "Published case",
        authors: Array.isArray(item.authors) ? item.authors : [],
        year: item.year,
        journal: item.journal || "",
        abstract: trim(item.abstract || "").slice(0, 4000)
      }).then(function () {
        delete st.adding[k];
        try { saveLocalRef(); } catch (e) {}
        st.added[k] = true;
        draw();
      }).catch(function (err) {
        delete st.adding[k];
        st.addError = (SMD.p2 && SMD.p2.friendlyError)
          ? SMD.p2.friendlyError(err)
          : { message: (err && err.message) || "Could not add this reference. Try again." };
        draw();
      });
      return;
    }
    try {
      saveLocalRef();
      st.added[k] = true;
      draw();
    } catch (err) {
      st.addError = { message: "Could not add this reference on this phone. Try again." };
      draw();
    }
  }

  function bind() {
    var c = st.container;
    var q = c.querySelector("#rmdNvQuery");
    var sbtn = c.querySelector('[data-rmd-nv="search"]');
    if (q) {
      q.oninput = function () {
        st.query = this.value;
        if (sbtn) sbtn.disabled = st.searching || !trim(st.query);
      };
    }
    c.onclick = function (ev) {
      var el = ev.target, attr;
      while (el && el !== c) {
        if (el.getAttribute) {
          attr = el.getAttribute("data-rmd-nv");
          if (attr === "search") { doSearch(); return; }
          attr = el.getAttribute("data-rmd");
          if (attr === "nv-retry") { doSearch(); return; }
          attr = el.getAttribute("data-rmd-nv-add");
          if (attr != null && attr !== "") { addToReferences(attr); return; }
          attr = el.getAttribute("data-rmd-nv-expand");
          if (attr != null && attr !== "") {
            st.expanded[attr] = !st.expanded[attr];
            draw();
            return;
          }
        }
        el = el.parentNode;
      }
    };
  }

  function load() {
    var store = G.RMDStore;
    if (!store || !store.list) {
      st.cf = {};
      st.query = "";
      draw();
      return;
    }
      var myPid = st.pid;
      store.list(myPid, "casefile").then(function (recs) {
        if (!st || st.pid !== myPid) return;
        var list = recs || [], i, rec = null;
        for (i = 0; i < list.length; i++) if (list[i].id === "case") rec = list[i];
        if (!rec && list.length) rec = list[0];
        st.cf = rec ? rec.value : {};
        if (rec && rec.id !== "case") st.patientNote = "Using patient " + rec.id + "\u2019s case file for the search.";
        var inputEl = st.container ? st.container.querySelector("#rmdNvQuery") : null;
        if (inputEl && trim(inputEl.value)) st.query = inputEl.value;
        if (trim(st.query) || st.error || st.searched) {
          draw();
          return;
        }
        st.query = buildNoveltyQuery(st.cf);
        draw();
      if (!st.query) {
        var card = st.container.querySelector(".rmd-card");
        if (card) {
          var note = G.document.createElement("p");
          note.className = "rmd-muted";
          note.textContent = "Add the diagnosis and what is new or unusual in the Case file step, or type a query here yourself.";
          card.appendChild(note);
        }
      }
    }).catch(function () {
      st.cf = {};
      st.query = "";
      draw();
    });
  }

  function render(container, params) {
    if (!container) return;
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var pid = (params && params.projectId) || (proj && proj.id) || "local";
    st = freshState(pid);
    st.container = container;
    injectCss();
    draw();
    load();
  }

  SMD.screens[KEY] = { render: render };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { render: render, buildNoveltyQuery: buildNoveltyQuery, citationOf: citationOf, keyOf: keyOf };
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
