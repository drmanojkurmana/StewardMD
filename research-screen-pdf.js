/* StewardMD - ResearchMD PDF viewer (window.SMD_RESEARCH.screens.pdf).
 * ES5 only, buildless, mobile-first. Phase 3.3: tablet-first page viewer that
 * renders the worker result.json (extract.py) fully offline: page text laid
 * out from word boxes, page jump, locator highlight, select-to-quote. No PDF
 * bytes, no external PDF library, no signed-URL iframe (plan 3.3, D-1).
 * Reusable helpers live on SMD.pdf so the extraction screen embeds the same
 * page view beside its form.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var D = G.document;

  var esc = SMD.esc || function (s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  function p2() { return SMD.p2 || {}; }

  /* ---------- reusable page helpers (SMD.pdf) ---------- */

  function pageByN(result, n) {
    var pages = (result && result.pages) || [];
    for (var i = 0; i < pages.length; i++) if (pages[i].n === n) return pages[i];
    return pages[0] || null;
  }

  /* One word span, positioned by normalized box so capture is scale-free. */
  function wordHtml(w, page, scale, idx) {
    var nx0 = w.x0 / page.width, ny0 = w.y0 / page.height;
    var nx1 = w.x1 / page.width, ny1 = w.y1 / page.height;
    var fs = Math.max(4, (w.y1 - w.y0) * scale * 0.82);
    return '<span class="rmd-pdf-word" data-widx="' + idx + '" data-t="' + esc(w.t) + '"' +
      ' data-nx0="' + nx0 + '" data-ny0="' + ny0 + '" data-nx1="' + nx1 + '" data-ny1="' + ny1 + '"' +
      ' style="left:' + (w.x0 * scale).toFixed(2) + 'px;top:' + (w.y0 * scale).toFixed(2) + 'px;' +
      'font-size:' + fs.toFixed(2) + 'px">' + esc(w.t) + '</span>';
  }

  function highlightHtml(box, page, scale) {
    if (!box) return "";
    var l = box.x * page.width * scale, t = box.y * page.height * scale;
    var w = box.w * page.width * scale, h = box.h * page.height * scale;
    return '<div class="rmd-pdf-highlight" data-rmd-highlight="1" aria-hidden="true" style="left:' +
      l.toFixed(2) + 'px;top:' + t.toFixed(2) + 'px;width:' + w.toFixed(2) + 'px;height:' + h.toFixed(2) + 'px"></div>';
  }

  function buildPageHtml(page, scale, highlightBox) {
    var W = page.width * scale, H = page.height * scale;
    var h = ['<div class="rmd-pdf-page" style="width:' + W.toFixed(2) + 'px;height:' + H.toFixed(2) + 'px">'];
    var words = page.words || [];
    for (var i = 0; i < words.length; i++) h.push(wordHtml(words[i], page, scale, i));
    h.push(highlightHtml(highlightBox, page, scale));
    h.push('</div>');
    return h.join("");
  }

  /* Fit the page to its wrapper width and (re)render. Returns the scale used. */
  function fitPage(wrapEl, page, highlightBox) {
    if (!wrapEl || !page) return 1;
    var avail = wrapEl.clientWidth || 600;
    var scale = Math.max(0.2, avail / page.width);
    wrapEl.innerHTML = buildPageHtml(page, scale, highlightBox);
    wrapEl.setAttribute("data-scale", String(scale));
    return scale;
  }

  /* Read the current text selection inside a page and map it to a normalized
   * locator box plus a verbatim quote. Returns {quote, box} or null. */
  function captureSelection(wrapEl) {
    if (!wrapEl || !G.getSelection) return null;
    var sel = G.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var spans = wrapEl.querySelectorAll(".rmd-pdf-word");
    var minX = 1, minY = 1, maxX = 0, maxY = 0, parts = [], found = false;
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      var intersects = false;
      try { intersects = range.intersectsNode(sp); } catch (e) { intersects = false; }
      if (!intersects) continue;
      found = true;
      var x0 = parseFloat(sp.getAttribute("data-nx0")), y0 = parseFloat(sp.getAttribute("data-ny0"));
      var x1 = parseFloat(sp.getAttribute("data-nx1")), y1 = parseFloat(sp.getAttribute("data-ny1"));
      if (x0 < minX) minX = x0; if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1; if (y1 > maxY) maxY = y1;
      parts.push(sp.getAttribute("data-t"));
    }
    if (!found) return null;
    return { quote: parts.join(" "), box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
  }

  function locatorFromCapture(cap, artifactId, pageN, citation) {
    return {
      kind: "pdf",
      citation: citation || "PDF page " + pageN,
      page: pageN,
      quote: cap.quote,
      pdf: { artifactId: artifactId, page: pageN, box: cap.box }
    };
  }

  SMD.pdf = {
    pageByN: pageByN,
    buildPageHtml: buildPageHtml,
    fitPage: fitPage,
    captureSelection: captureSelection,
    locatorFromCapture: locatorFromCapture,
    highlightHtml: highlightHtml
  };

  /* ---------- standalone viewer screen ---------- */

  var st = {
    projectId: null, loaded: false, loading: false, error: null,
    artifacts: [], artifactId: null, result: null, resultLoading: false,
    page: 1, highlight: null, captured: null, announce: ""
  };
  var seq = 0;

  function loadArtifacts(container) {
    var mySeq = ++seq;
    st.loading = true; st.error = null;
    SMD.api.request("GET", "/v1/projects/" + encodeURIComponent(st.projectId) + "/artifacts").then(function (data) {
      if (mySeq !== seq) return;
      st.artifacts = (data && data.artifacts) || [];
      st.loading = false; st.loaded = true;
      var first = null;
      for (var i = 0; i < st.artifacts.length; i++) if (st.artifacts[i].status === "succeeded") { first = st.artifacts[i]; break; }
      if (first) { st.artifactId = first.id; loadResult(container, first.id); }
      else render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false; st.loaded = true; st.error = err; render(container);
    });
  }

  function loadResult(container, artifactId) {
    var mySeq = ++seq;
    st.resultLoading = true; st.result = null; st.highlight = null; st.captured = null;
    render(container);
    SMD.api.request("GET", "/v1/artifacts/" + encodeURIComponent(artifactId) + "/result").then(function (data) {
      if (mySeq !== seq) return;
      st.resultLoading = false; st.result = data; st.page = 1;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.resultLoading = false; st.error = err; render(container);
    });
  }

  function currentArtifact() {
    for (var i = 0; i < st.artifacts.length; i++) if (st.artifacts[i].id === st.artifactId) return st.artifacts[i];
    return null;
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to view its PDFs.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var tp = container.querySelector('[data-rmd="to-projects"]');
      if (tp) tp.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (st.projectId !== project.id) {
      st.projectId = project.id; st.loaded = false; st.loading = false; st.error = null;
      st.artifacts = []; st.artifactId = null; st.result = null; st.page = 1; st.highlight = null; st.captured = null; st.announce = "";
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading PDFs") + '</div>';
      loadArtifacts(container);
      return;
    }

    var art = currentArtifact();
    var result = st.result;
    var page = result ? pageByN(result, st.page) : null;
    var pageCount = result ? (result.pages || []).length : 0;

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">PDF Viewer</h2>');
    h.push('<span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div><div class="rmd-topbar-actions">');
    if (st.artifacts.length > 1) {
      h.push('<select id="rmdPdfArtifact" aria-label="Choose PDF">');
      for (var a = 0; a < st.artifacts.length; a++) {
        h.push('<option value="' + esc(st.artifacts[a].id) + '"' + (st.artifacts[a].id === st.artifactId ? " selected" : "") + '>' + esc(st.artifacts[a].filename) + '</option>');
      }
      h.push('</select>');
    }
    h.push('</div></div>');

    if (st.error) h.push('<div style="padding:12px 16px">' + p2().errHtml(st.error, "pdf-retry") + '</div>');

    if (st.loading) h.push(p2().loadingHtml("Loading PDFs"));
    if (st.loaded && !st.artifacts.length && !st.loading) {
      h.push('<div class="rmd-empty-state"><h3>No PDFs yet</h3><p>Upload a full-text PDF on the Extract screen to view it here.</p><button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="to-extract">Go to Extract</button></div>');
    }

    if (art) {
      h.push('<div class="rmd-pdf-layout">');
      // Page pane
      h.push('<div class="rmd-pdf-main">');
      h.push('<div class="rmd-pdf-controls">');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pdf-prev"' + (st.page <= 1 ? " disabled" : "") + '>Prev</button>');
      h.push('<span class="rmd-pdf-pageind">Page <input type="number" id="rmdPdfPage" min="1" max="' + pageCount + '" value="' + st.page + '" aria-label="Page number"> of ' + pageCount + '</span>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pdf-next"' + (st.page >= pageCount ? " disabled" : "") + '>Next</button>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="pdf-highlight-sel">Highlight selection</button>');
      h.push('</div>');
      if (st.resultLoading) h.push(p2().loadingHtml("Loading page text"));
      if (page) {
        if (page.ocr) h.push('<div class="rmd-banner rmd-banner-warn rmd-pdf-ocr">This page was read by OCR. Check values against the original; nothing is inferred from unreadable text.</div>');
        h.push('<div class="rmd-pdf-scroll" id="rmdPdfScroll" tabindex="0" aria-label="PDF page ' + st.page + '"></div>');
      } else if (result && !page) {
        h.push('<div class="rmd-empty-state"><h3>Page not found</h3><p>This PDF has no page ' + st.page + '.</p></div>');
      }
      h.push('</div>');
      // Info pane
      h.push('<div class="rmd-pdf-side">');
      h.push('<div class="rmd-card"><h3 class="rmd-card-heading">Document</h3>');
      h.push('<div class="rmd-provenance-box">');
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">File</span><span>' + esc(art.filename) + '</span></div>');
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Pages</span><span>' + pageCount + '</span></div>');
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Status</span><span>' + esc(art.status) + '</span></div>');
      if (result && result.ocr) h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">OCR</span><span>Some pages used OCR</span></div>');
      h.push('</div>');
      h.push('<p class="rmd-muted rmd-pdf-hint">Select text on the page, then Highlight selection to pin a locator. The Extract screen turns a selection into a quoted value.</p>');
      if (st.captured) {
        h.push('<div class="rmd-quote-block smd-books-keep"><div class="rmd-quote-tag">Captured quote</div><blockquote>' + esc(st.captured.quote) + '</blockquote>');
        h.push('<p class="rmd-mono-sm rmd-muted">Page ' + st.page + ' box ' + st.captured.box.x.toFixed(3) + ', ' + st.captured.box.y.toFixed(3) + ', ' + st.captured.box.w.toFixed(3) + ', ' + st.captured.box.h.toFixed(3) + '</p></div>');
      }
      if (st.announce) h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite">' + esc(st.announce) + '</div>');
      h.push('</div></div>');
      h.push('</div>');
    }
    h.push('</div>');
    container.innerHTML = h.join("\n");
    bind(container, page, art);
  }

  function bind(container, page, art) {
    function on(sel, fn) { var els = container.querySelectorAll(sel); for (var i = 0; i < els.length; i++) els[i].onclick = fn; }
    on('[data-rmd="to-projects"]', function () { SMD.navigate("projects"); });
    on('[data-rmd="to-extract"]', function () { SMD.navigate("extract"); });
    on('[data-rmd="pdf-retry"]', function () { st.loaded = false; render(container); });

    var wrap = container.querySelector("#rmdPdfScroll");
    if (wrap && page) {
      fitPage(wrap, page, st.highlight);
      wrap.onmouseup = function () {
        var cap = captureSelection(wrap);
        if (cap) { st.captured = cap; }
      };
    }
    var pageCount = st.result ? (st.result.pages || []).length : 0;
    function go(n) {
      if (n < 1 || n > pageCount || n === st.page) return;
      st.page = n; st.highlight = null; st.captured = null; render(container);
    }
    on('[data-rmd="pdf-prev"]', function () { go(st.page - 1); });
    on('[data-rmd="pdf-next"]', function () { go(st.page + 1); });
    var pageInput = container.querySelector("#rmdPdfPage");
    if (pageInput) pageInput.onchange = function () { go(parseInt(this.value, 10) || 1); };
    on('[data-rmd="pdf-highlight-sel"]', function () {
      var w = container.querySelector("#rmdPdfScroll");
      var cap = w ? captureSelection(w) : null;
      if (!cap) { st.announce = "Select some text on the page first, then highlight it."; render(container); return; }
      st.captured = cap; st.highlight = cap.box; st.announce = "Locator pinned on page " + st.page + ".";
      render(container);
    });
    var artSel = container.querySelector("#rmdPdfArtifact");
    if (artSel) artSel.onchange = function () { st.artifactId = this.value; st.page = 1; loadResult(container, this.value); };
  }

  SMD.screens.pdf = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
