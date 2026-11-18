/* Study Studio Phase 5b: search inside notes, audio, print, presentation.
   ES5 IIFE, window.STUDY_MEDIA. Loaded AFTER study.js + study-library.js from prep-loader.js.
   Reuses IndexedDB "study" (docs/files/folders/strokes/undo/ptext/index) + new "audio" store (Blobs).
   5.6 Search: titles + PDF text (pdf.js getTextContent, indexed once per doc in chunks) + typed/ptext
   (src typed/ocr) + handwriting recogniser when available, else AI Convert text via indexText().
   Results show the page thumbnail with the hit highlighted. 5.7 In-document search in the viewer top
   bar: hit count, < > stepping, page highlight. 5.9 Audio: MediaRecorder (AAC/webm) while writing,
   each stroke stores recording offset `a`, playback replays, tapping a stroke seeks, recordings list
   per notebook, Blobs in IndexedDB, backup/restore covered by study.js, storage per notebook in
   Settings. 5.11 Print: this page/all via hidden iframe print(), native via share sheet with exported
   PDF. 5.12 Presentation: fullscreen page + laser, chrome hidden. 5.13 share link: out of scope.
   GoodNotes layout, PrepNucleus skin (#071318 / #0D1D23 / #42CDB5). ES5 only. */
(function (G) {
  "use strict";
  /* ================= pure (node-callable) ================= */
  function fmtBytes(n) {
    n = +n || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (Math.round(n / 102.4) / 10) + " KB";
    return (Math.round(n / 104857.6) / 10) + " MB";
  }
  function fmtDur(s) {
    s = Math.max(0, Math.floor(+s || 0));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  function clampSeek(t, dur) {
    t = +t || 0; dur = +dur || 0;
    if (t < 0) return 0;
    if (dur > 0 && t > dur) return dur;
    return t;
  }
  function nextIdx(i, total, dir) {
    if (total <= 0) return -1;
    i = ((i % total) + total) % total;
    return (i + dir + total) % total;
  }
  function isValidStrokeTime(a, dur) {
    return a != null && isFinite(+a) && +a >= 0 && (dur == null || +dur <= 0 || +a <= +dur);
  }
  function pageList(total, only) {
    var out = [], i;
    total = Math.max(0, parseInt(total, 10) || 0);
    if (only != null) { var p = parseInt(only, 10) || 0; return (p >= 1 && p <= total) ? [p] : []; }
    for (i = 1; i <= total; i++) out.push(i);
    return out;
  }
  function pickMime(supported) {
    var pref = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    for (var i = 0; i < pref.length; i++) if (supported[pref[i]]) return pref[i];
    return "";
  }
  function storageOf(o) {
    o = o || {};
    var pdf = +o.pdfBytes || 0, audio = +o.audioBytes || 0, strokes = +o.strokeBytes || 0;
    return { pdfBytes: pdf, audioBytes: audio, strokeBytes: strokes, total: pdf + audio + strokes };
  }
  var PURE = {
    fmtBytes: fmtBytes, fmtDur: fmtDur, clampSeek: clampSeek, nextIdx: nextIdx,
    isValidStrokeTime: isValidStrokeTime, pageList: pageList, pickMime: pickMime, storageOf: storageOf
  };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }
  var D = G.document;
  /* ---- icons (inline SVG, no emoji) ---- */
  function svg(inner) { return '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>"; }
  var ICO = {
    search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>'),
    mic: svg('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
    micOff: svg('<line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/>'),
    play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
    pause: svg('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'),
    print: svg('<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
    present: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'),
    close: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    prev: svg('<polyline points="15 18 9 12 15 6"/>'),
    next: svg('<polyline points="9 18 15 12 9 6"/>'),
    trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    laser: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>'
  };
  /* ---- db (study v3, same as study.js) ---- */
  var dbP = null;
  function db() {
    try { if (G.STUDY && typeof G.STUDY.db === "function") return G.STUDY.db(); } catch (e) {}
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      var r = G.indexedDB.open("study", 3);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs", { keyPath: "id" });
        if (!d.objectStoreNames.contains("files")) d.createObjectStore("files", { keyPath: "id" });
        if (!d.objectStoreNames.contains("folders")) d.createObjectStore("folders", { keyPath: "id" });
        if (!d.objectStoreNames.contains("strokes")) { var s = d.createObjectStore("strokes", { keyPath: "id" }); s.createIndex("doc", "doc"); }
        if (!d.objectStoreNames.contains("undo")) d.createObjectStore("undo", { keyPath: "doc" });
        if (!d.objectStoreNames.contains("ptext")) { var p = d.createObjectStore("ptext", { keyPath: "id" }); p.createIndex("doc", "doc"); }
        if (!d.objectStoreNames.contains("index")) d.createObjectStore("index", { keyPath: "doc" });
        if (!d.objectStoreNames.contains("audio")) { var a = d.createObjectStore("audio", { keyPath: "id" }); a.createIndex("doc", "doc"); }
      };
      r.onsuccess = function () {
        var conn = r.result;
        conn.onversionchange = function () { dbP = null; try { conn.close(); } catch (e) {} };
        res(conn);
      };
      r.onerror = function () { dbP = null; rej(r.error); };
    });
    return dbP;
  }
  function q(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), r = fn(t.objectStore(store));
        t.oncomplete = function () { res(r && r.result); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  var idbGet = function (s, k) { return q(s, "readonly", function (o) { return o.get(k); }); };
  var idbAll = function (s) { return q(s, "readonly", function (o) { return o.getAll(); }); };
  var idbPut = function (s, v) { return q(s, "readwrite", function (o) { return o.put(v); }); };
  var idbDel = function (s, k) { return q(s, "readwrite", function (o) { return o.delete(k); }); };
  var strokesOf = function (id) { return q("strokes", "readonly", function (o) { return o.index("doc").getAll(G.IDBKeyRange.only(id)); }); };
  function audioOf(id) { return q("audio", "readonly", function (o) { try { return o.index("doc").getAll(G.IDBKeyRange.only(id)); } catch (e) { return o.getAll(); } }).then(function (r) { return (r || []).filter(function (a) { return a.doc === id; }); }); }
  var uidN = 0;
  function uid() { return Date.now().toString(36) + (++uidN).toString(36) + Math.random().toString(36).slice(2, 7); }
  function getHost() { try { if (G.PREP && G.PREP._host) return G.PREP._host; } catch (e) {} return null; }
  function hostRoot() { try { var h = getHost(); return h && h.root && h.root(); } catch (e) { return null; } }
  function esc(s) { try { var h = getHost(); if (h && h.esc) return h.esc(s); } catch (e) {} s = String(s == null ? "" : s); return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function toast(msg) { try { var h = getHost(); if (h && h.toast) return h.toast(msg); } catch (e) {} }
  function studyState() { try { return G.STUDY && G.STUDY._state && G.STUDY._state(); } catch (e) { return null; } }
  function studyPure() { try { return G.STUDY && G.STUDY._pure; } catch (e) { return null; } }
  /* ---- pdf.js (adopt study.js loader pattern) ---- */
  var pdfLibP = null;
  function pdfjsLib() {
    if (G.pdfjsLib) { try { G.pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js"; } catch (e) {} return Promise.resolve(G.pdfjsLib); }
    if (pdfLibP) return pdfLibP;
    pdfLibP = new Promise(function (res, rej) {
      var s = D.createElement("script"); s.src = "/vendor/pdfjs/pdf.min.js";
      s.onload = function () { if (!G.pdfjsLib) { pdfLibP = null; return rej(new Error("pdf")); } try { G.pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js"; } catch (e) {} res(G.pdfjsLib); };
      s.onerror = function () { pdfLibP = null; rej(new Error("pdf")); };
      D.head.appendChild(s);
    });
    return pdfLibP;
  }
  function loadOriginalBytes(doc) {
    if (doc.store === "fs") {
      try {
        var fs = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.Filesystem;
        if (fs) return fs.readFile({ path: "study/" + doc.id + ".pdf", directory: "DATA" }).then(function (r) {
          var bin = G.atob(r.data), n = bin.length, a = new Uint8Array(n), i;
          for (i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
          return a;
        });
      } catch (e) {}
    }
    return idbGet("files", doc.id).then(function (f) {
      if (!f || !f.blob) return new Uint8Array(0);
      return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(new Uint8Array(fr.result)); }; fr.onerror = rej; fr.readAsArrayBuffer(f.blob); });
    });
  }
  /* ================= 5.6 Search enrichment ================= */
  /* Typed / OCR / Convert / handwriting text is indexed into ptext with src. The PDF
     index itself (study.js kick/indexDoc) chunks 3 pages per setTimeout batch, so a
     300-page PDF never freezes; it is indexed once per document and cached in ptext. */
  function indexText(docId, page, text, src) {
    if (!docId || !(+page)) return Promise.resolve(false);
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (!text) return Promise.resolve(false);
    src = src || "typed";
    return idbPut("ptext", { id: docId + ":" + page + ":" + src, doc: docId, page: +page, src: src, text: text.slice(0, 200000) }).then(function () { return true; });
  }
  /* Handwriting: use a native recogniser when one is present (SMD_NATIVE.recognise /
     handwriting), otherwise the AI "Convert" text run by the user is indexed via
     indexText(..., "convert") and searched like any other ptext row. */
  function recogniseStroke(stroke) {
    var N = G.SMD_NATIVE;
    if (!N || !(N.recognise || N.handwriting || N.ocrStroke)) return Promise.resolve("");
    var fn = N.recognise || N.handwriting || N.ocrStroke;
    try { return Promise.resolve(fn.call(N, stroke)).then(function (r) { return (r && (r.text || r)) || ""; }, function () { return ""; }); }
    catch (e) { return Promise.resolve(""); }
  }
  function indexStrokeText(stroke) {
    return recogniseStroke(stroke).then(function (text) {
      text = String(text || "").trim();
      if (!text || !stroke || !stroke.doc || !stroke.page) return "";
      var pid = stroke.page;
      /* Notebook page ids map to positions via study state when present; store by page id,
         the library search sorts by page number, so convert via posOf when available. */
      var V = studyState();
      if (V && V.nb && V.nb.ord) { var ix = V.nb.ord.indexOf(pid); if (ix >= 0) pid = ix + 1; }
      return indexText(stroke.doc, pid, text, "handwriting").then(function () { return text; });
    });
  }
  /* Page thumbnail with the hit highlighted: render the page (or notebook page) to a
     small dataURL and, for PDFs, locate the match with pdf.js textContent and draw a
     highlight box. Notebooks have no text layout, so the thumbnail is the ink page. */
  function drawBg(ctx, style, ratio, W) {
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, W * ratio);
    if (style === "blank") return;
    ctx.strokeStyle = style === "grid" ? "#cfd8e6" : "#b9c5d8"; ctx.lineWidth = Math.max(1, W / 900);
    var s = 0.05, end = style === "cornell" ? ratio * 0.8 : ratio, y, x;
    ctx.beginPath();
    if (style === "ruled" || style === "cornell") for (y = s * 2; y < end; y += s) { ctx.moveTo(0, y * W); ctx.lineTo(W, y * W); }
    if (style === "grid") { for (y = s; y < ratio; y += s) { ctx.moveTo(0, y * W); ctx.lineTo(W, y * W); } for (x = s; x < 1; x += s) { ctx.moveTo(x * W, 0); ctx.lineTo(x * W, ratio * W); } }
    if (style === "dotgrid" || style === "dots") { ctx.fillStyle = "#9fb0c3"; for (y = s * 2; y < ratio; y += s) for (x = s; x < 1; x += s) ctx.fillRect(x * W - 0.5, y * W - 0.5, 1, 1); }
    if (style === "cornell") { ctx.moveTo(0.3 * W, s * 2 * W); ctx.lineTo(0.3 * W, end * W); ctx.moveTo(0, end * W); ctx.lineTo(W, end * W); }
    ctx.stroke();
  }
  function drawInk(ctx, strokes, page, W, H) {
    (strokes || []).forEach(function (s) {
      if (s.gone || s.page !== page) return;
      var p = s.pts, i;
      ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = s.color || "#111";
      if (s.tool === "hl") { ctx.globalAlpha = 0.35; ctx.lineWidth = (s.w || 0.003) * W * 6; ctx.beginPath(); for (i = 0; i < p.length; i++) { if (i) ctx.lineTo(p[i][0] * W, p[i][1] * H); else ctx.moveTo(p[i][0] * W, p[i][1] * H); } if (p.length === 1) ctx.lineTo(p[0][0] * W + 0.01, p[0][1] * H); ctx.stroke(); }
      else { for (i = p.length > 1 ? 1 : 0; i < p.length; i++) { var a = p[i ? i - 1 : 0]; ctx.lineWidth = (s.w || 0.003) * W * (0.5 + p[i][2]); ctx.beginPath(); ctx.moveTo(a[0] * W, a[1] * H); ctx.lineTo(p[i][0] * W + (p.length === 1 ? 0.01 : 0), p[i][1] * H); ctx.stroke(); } }
      ctx.restore();
    });
  }
  function locateHitRects(tcItems, q) {
    var out = [], query = String(q || "").toLowerCase();
    if (!query) return out;
    (tcItems || []).forEach(function (it) {
      var t = String(it && it.str || "");
      if (t.toLowerCase().indexOf(query) !== -1 && it.transform && it.height != null && it.width != null) out.push(it.transform);
    });
    return out;
  }
  function pageThumb(doc, pageNum, q) {
    var W = 220, docId = doc && doc.id;
    return idbGet("docs", docId).then(function (d) { d = d || doc; if (!d) return null;
      return strokesOf(docId).then(function (strokes) {
        var c = D.createElement("canvas");
        if (d.kind === "nb") {
          var ratio = d.ratio || 1.414, H = Math.round(W * ratio);
          c.width = W; c.height = H;
          var ctx = c.getContext("2d");
          drawBg(ctx, d.style || "blank", ratio, W);
          var pid = (d.ord || [])[pageNum - 1];
          drawInk(ctx, strokes, pid, W, H);
          return c.toDataURL("image/jpeg", 0.72);
        }
        return loadOriginalBytes(d).then(function (bytes) { return pdfjsLib().then(function (L) { return L.getDocument({ data: bytes.slice() }).promise; }); }).then(function (pdf) {
          return pdf.getPage(pageNum).then(function (pg) {
            var v0 = pg.getViewport({ scale: 1 }), sc = W / v0.width, vp = pg.getViewport({ scale: sc });
            c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
            var ctx = c.getContext("2d");
            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
            return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
              drawInk(ctx, strokes, pageNum, c.width, c.height);
              /* highlight: every text item containing q gets a translucent box */
              return pg.getTextContent().then(function (tc) {
                ctx.fillStyle = "rgba(66,205,181,0.38)";
                ctx.strokeStyle = "#42CDB5"; ctx.lineWidth = 1.5;
                (tc.items || []).forEach(function (it) {
                  var t = String(it && it.str || "");
                  if (t.toLowerCase().indexOf(String(q || "").toLowerCase()) !== -1 && it.transform) {
                    var tx = it.transform[4], ty = it.transform[5];
                    /* text space -> page space (viewport scale sc), y flips */
                    var px = tx * sc, py = c.height - (ty + (it.height || 0)) * sc, pw = (it.width || 0) * sc, ph = (it.height || 10) * sc;
                    ctx.fillRect(px, py, pw, ph);
                    ctx.strokeRect(px, py, pw, ph);
                  }
                });
                try { pg.cleanup(); } catch (e) {}
                try { pdf.destroy(); } catch (e) {}
                return c.toDataURL("image/jpeg", 0.72);
              });
            });
          });
        }).then(null, function () {
          /* fallback: doc cover */
          return d.thumb || null;
        });
      });
    }).then(null, function () { return null; });
  }
  /* Enrich library search hits in place: each .st-hit gets a page thumbnail. Runs once
     per render; failures leave the hit with its snippet (highlighted) alone. */
  var thumbSeq = 0;
  function enrichHits() {
    var root = hostRoot(); if (!root) return;
    var hits = root.querySelectorAll(".st-hit");
    Array.prototype.forEach.call(hits, function (h) {
      if (h._5bthumb) return; h._5bthumb = true;
      var docId = h.getAttribute("data-id"), page = parseInt(h.getAttribute("data-page"), 10) || 1;
      var label = (h.querySelector("b") || {}).textContent || "";
      var sn = h.querySelector(".st-sn");
      var q = "";
      var input = root.querySelector("#st5aSearchQ, #stQ");
      if (input) q = input.value || "";
      var wrap = D.createElement("span"); wrap.className = "st5b-thwrap";
      var im = D.createElement("img"); im.className = "st5b-th"; im.alt = ""; im.width = 44; im.height = 62;
      var seq = ++thumbSeq;
      h.insertBefore(wrap, h.firstChild);
      wrap.appendChild(im);
      im.addEventListener("error", function () { wrap.style.display = "none"; });
      idbGet("docs", docId).then(function (d) {
        if (!d) return null;
        if (d.kind === "nb" && seq !== thumbSeq && h._5bthumb) {}
        return pageThumb(d, page, q);
      }).then(function (url) {
        if (!url || !h.isConnected) return;
        im.src = url;
      }, function () {});
    });
  }
  /* ================= 5.7 In-document search ================= */
  var inDoc = { hits: [], idx: -1, q: "", seq: 0 };
  function clearInDocHL() {
    var root = hostRoot(); if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".st5b-hit"), function (el) { el.classList.remove("st5b-hit"); });
    Array.prototype.forEach.call(root.querySelectorAll(".st-tl span"), function (el) { el.style.removeProperty("background"); el.style.removeProperty("outline"); el.style.removeProperty("border-radius"); });
  }
  function inDocBar() {
    var root = hostRoot(); if (!root) return null;
    return root.querySelector("#st5bInDoc");
  }
  function toggleInDoc(open) {
    var root = hostRoot(); if (!root) return;
    var bar = inDocBar();
    if (open && !bar) {
      var el = D.createElement("div");
      el.id = "st5bInDoc"; el.className = "st5b-indoc smd-books-keep smd-emo-keep";
      el.setAttribute("role", "search");
      el.setAttribute("aria-label", "Search in document");
      el.innerHTML = '<span class="st5b-indoc-ico">' + ICO.search + "</span>" +
        '<input type="search" id="st5bInQ" class="st5b-indoc-q" placeholder="Search this document" aria-label="Search this document" autocomplete="off">' +
        '<span class="st5b-indoc-count" id="st5bInCount" aria-live="polite">0 of 0</span>' +
        '<button type="button" class="st5b-nav" data-act="st-indoc-prev" aria-label="Previous match">' + ICO.prev + "</button>" +
        '<button type="button" class="st5b-nav" data-act="st-indoc-next" aria-label="Next match">' + ICO.next + "</button>" +
        '<button type="button" class="st5b-nav" data-act="st-indoc-close" aria-label="Close search">' + ICO.close + "</button>";
      var dt = root.querySelector("#stDocTabs");
      var p3Top = root.querySelector("#stP3Top");
      var tb = root.querySelector("#stTb");
      if (dt && dt.parentNode) dt.parentNode.insertBefore(el, dt.nextSibling);
      else if (p3Top && p3Top.parentNode) p3Top.parentNode.insertBefore(el, p3Top.nextSibling);
      else if (tb && tb.parentNode) tb.parentNode.insertBefore(el, tb.nextSibling);
      else root.appendChild(el);
      var inp = el.querySelector("#st5bInQ");
      inp.addEventListener("input", function () { runInDoc(inp.value); });
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); stepInDoc(e.shiftKey ? -1 : 1); }
        if (e.key === "Escape") { e.preventDefault(); toggleInDoc(false); }
      });
      G.setTimeout(function () { try { inp.focus(); } catch (e) {} }, 50);
    }
    if (!open && bar && bar.parentNode) bar.parentNode.removeChild(bar);
    if (!open) { clearInDocHL(); inDoc.hits = []; inDoc.idx = -1; inDoc.q = ""; }
  }
  function runInDoc(raw) {
    var V = studyState();
    var qs = String(raw || "").trim().toLowerCase();
    inDoc.q = qs; inDoc.seq++;
    var countEl = hostRoot() && hostRoot().querySelector("#st5bInCount");
    if (!V || !V.id || qs.length < 2) {
      inDoc.hits = []; inDoc.idx = -1; clearInDocHL();
      if (countEl) countEl.textContent = "0 of 0";
      return;
    }
    /* Kick the chunked indexer so unindexed tail pages join in (it resumes from index.done). */
    try { if (G.STUDY && G.STUDY.kick) G.STUDY.kick(); } catch (e) {}
    var seq = inDoc.seq;
    q("ptext", "readonly", function (o) { try { return o.index("doc").getAll(G.IDBKeyRange.only(V.id)); } catch (e) { return o.getAll(); } }).then(function (rows) {
      if (seq !== inDoc.seq) return;
      rows = (rows || []).filter(function (x) { return x.doc === V.id && x.text && x.text.toLowerCase().indexOf(qs) !== -1; });
      rows.sort(function (a, b) { return a.page - b.page; });
      inDoc.hits = rows; inDoc.idx = rows.length ? 0 : -1;
      clearInDocHL();
      paintInDoc();
    }, function () {});
  }
  function paintInDoc() {
    var countEl = hostRoot() && hostRoot().querySelector("#st5bInCount");
    if (countEl) countEl.textContent = inDoc.hits.length ? (inDoc.idx + 1) + " of " + inDoc.hits.length : "0 of 0";
    var V = studyState(); if (!V || inDoc.idx < 0) return;
    var h = inDoc.hits[inDoc.idx]; if (!h) return;
    /* Scroll to the page first (page may render lazily; highlight after it appears). */
    var pg = V.pg && V.pg[h.page];
    if (pg && pg.el && V.sc) { V.sc.scrollTop = pg.el.offsetTop; }
    highlightPage(h.page, inDoc.q, inDoc.idx);
  }
  function highlightPage(pageNum, q, occ) {
    var root = hostRoot(); if (!root) return;
    var pg = root.querySelector('.st-pg[data-n="' + pageNum + '"]');
    clearInDocHL();
    if (!pg) return;
    var spans = pg.querySelectorAll(".st-tl span");
    var qi = 0;
    Array.prototype.forEach.call(spans, function (sp) {
      var t = String(sp.textContent || "");
      if (t.toLowerCase().indexOf(q) === -1) return;
      sp.classList.add("st5b-hit");
      sp.style.background = "rgba(66,205,181,0.45)";
      sp.style.outline = "1px solid #42CDB5";
      sp.style.borderRadius = "3px";
      if (qi === 0 && sp.scrollIntoView) { try { sp.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {} }
      qi++;
    });
    if (!spans.length) {
      /* Notebook / no text layer: highlight the page itself. */
      pg.classList.add("st5b-hitpage");
      G.setTimeout(function () { pg.classList.remove("st5b-hitpage"); }, 1600);
    }
  }
  function stepInDoc(dir) {
    var V = studyState(); if (!V) return;
    if (!inDoc.hits.length) return;
    inDoc.idx = nextIdx(inDoc.idx, inDoc.hits.length, dir || 1);
    paintInDoc();
  }
  /* ================= 5.9 Audio ================= */
  var rec = { active: false, mr: null, chunks: [], started: 0, mime: "", doc: null, stream: null };
  var player = { el: null, recId: null, blobUrl: null, mode: false, layers: [] };
  function recSupported() {
    return !!(G.MediaRecorder && (G.navigator && G.navigator.mediaDevices && G.navigator.mediaDevices.getUserMedia));
  }
  function pickRecorderMime() {
    if (!(G.MediaRecorder && G.MediaRecorder.isTypeSupported)) return "";
    var pref = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"], i;
    for (i = 0; i < pref.length; i++) try { if (G.MediaRecorder.isTypeSupported(pref[i])) return pref[i]; } catch (e) {}
    return "";
  }
  function stampStroke() {
    if (!rec.active || !rec.started) return null;
    return Math.round(((Date.now() - rec.started) / 1000) * 1000) / 1000;
  }
  function setMicBtn() {
    var root = hostRoot(); if (!root) return;
    var btns = root.querySelectorAll('[data-act="st-audio-rec"], [data-act="st-p3-mic"]');
    Array.prototype.forEach.call(btns, function (b) {
      if (b._lastRecActive === rec.active && b._inited) return;
      b._lastRecActive = rec.active;
      b._inited = true;
      b.classList.toggle("on", rec.active);
      b.setAttribute("aria-pressed", rec.active ? "true" : "false");
      var isMenu = b.classList.contains("st-p3-menu-item");
      if (isMenu) {
        b.innerHTML = (rec.active ? ICO.micOff : ICO.mic) + '<div class="st-p3-menu-txt"><strong>' + (rec.active ? "Stop recording" : "Voice note") + '</strong><small>' + (rec.active ? "Recording in progress" : "Microphone") + '</small></div>';
      } else {
        b.innerHTML = rec.active ? ICO.micOff : ICO.mic;
        b.setAttribute("aria-label", rec.active ? "Stop recording" : "Microphone");
      }
    });
  }
  function startRec() {
    var V = studyState(); if (!V || !V.id) return toast("Open a document first.");
    if (rec.active) return stopRec();
    if (!recSupported()) return toast("Recording is not available on this device.");
    G.navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      rec.stream = stream; rec.chunks = []; rec.started = Date.now(); rec.doc = V.id;
      rec.mime = pickRecorderMime();
      try { rec.mr = new G.MediaRecorder(stream, rec.mime ? { mimeType: rec.mime } : undefined); }
      catch (e) { rec.mr = new G.MediaRecorder(stream); }
      rec.mr.ondataavailable = function (e) { if (e && e.data && e.data.size) rec.chunks.push(e.data); };
      rec.mr.onstop = function () {
        var dur = Math.round(((Date.now() - rec.started) / 1000) * 1000) / 1000;
        var type = (rec.mr && rec.mr.mimeType) || rec.mime || "audio/webm";
        var blob = new Blob(rec.chunks, { type: type });
        var id = uid();
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        rec.active = false; rec.mr = null; rec.stream = null; setMicBtn();
        if (!blob.size) return toast("Nothing was recorded.");
        idbPut("audio", { id: id, doc: rec.doc, mime: type, size: blob.size, started: rec.started, dur: dur, blob: blob }).then(function () {
          toast("Recording saved (" + fmtDur(dur) + "). Tap a stroke while playing to jump.");
          refreshRecList();
          refreshSettingsStorage();
        }, function () { toast("The recording could not be saved."); });
      };
      rec.mr.start(250);
      rec.active = true; setMicBtn();
      toast("Recording. Write now, then tap the mic to stop.");
    }, function () { toast("Microphone permission was not granted."); });
  }
  function stopRec() { if (rec.active && rec.mr) { try { rec.mr.stop(); } catch (e) {} } }
  function stopPlayer() {
    if (player.el) { try { player.el.pause(); } catch (e) {} try { player.el.removeAttribute("src"); } catch (e) {} if (player.blobUrl) { try { G.URL.revokeObjectURL(player.blobUrl); } catch (e) {} } player.el = null; }
    player.recId = null; player.mode = false;
    player.layers.forEach(function (l) { try { l.parentNode.removeChild(l); } catch (e) {} });
    player.layers = [];
    var root = hostRoot(); if (root) root.classList.remove("st5b-seek");
    var btn = root && root.querySelector('[data-act="st-audio-play"]');
    if (btn) btn.classList.remove("on");
  }
  function installSeekLayers() {
    stopSeekLayersOnly();
    var V = studyState(); if (!V || !V.pg) return;
    /* While a writing tool is selected the user is writing: do not overlay seek targets (the editor always has a tool, so lasso/laser/elements/image allow seeking). */
    if (V.tool && /^(pen|er|hl|shapes|text)$/.test(V.tool)) return;
    var root = hostRoot(); if (root) root.classList.add("st5b-seek");
    Object.keys(V.pg).forEach(function (k) {
      var pg = V.pg[k]; if (!pg || !pg.el) return;
      /* Pages render lazily; re-install on scroll/timer while playing. */
      var layer = D.createElement("span");
      layer.className = "st5b-seeklayer"; layer.setAttribute("data-n", k);
      layer.addEventListener("click", function (e) {
        if (!player.mode || !player.el) return;
        var hit = strokeAt(e, pg.el, +k);
        if (hit != null && isValidStrokeTime(hit, player.el.duration)) {
          player.el.currentTime = clampSeek(hit, player.el.duration);
          toast("Jumped to " + fmtDur(hit) + ".");
        }
      });
      try { pg.el.appendChild(layer); player.layers.push(layer); } catch (e) {}
    });
  }
  function stopSeekLayersOnly() {
    player.layers.forEach(function (l) { try { l.parentNode.removeChild(l); } catch (e) {} });
    player.layers = [];
  }
  function strokeAt(e, pageEl, n) {
    var V = studyState(); if (!V) return null;
    var r = pageEl.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var rx = (e.clientX - r.left) / r.width, ry = (e.clientY - r.top) / r.height;
    var pure = studyPure(); if (!pure || !pure.hit) return null;
    var best = null;
    (V.strokes || []).forEach(function (s) {
      if (s.gone || s.page !== (+n) && s.page !== (V.nb ? (V.nb.ord || [])[n - 1] : n)) return;
      if (s.a == null) return;
      if (pure.hit(s, rx, ry, 18, r.width, r.height)) best = s;
    });
    return best ? best.a : null;
  }
  function playRec(recId) {
    if (player.recId === recId && player.el) { try { player.el.play(); } catch (e) {} return; }
    stopPlayer();
    idbGet("audio", recId).then(function (a) {
      if (!a || !a.blob) return toast("That recording is missing.");
      var url = G.URL.createObjectURL(a.blob);
      player.blobUrl = url; player.recId = recId;
      var au = D.createElement("audio");
      au.className = "st5b-audio-el"; au.src = url; au.setAttribute("controls", "");
      au.setAttribute("aria-label", "Notebook recording");
      player.el = au; player.mode = true;
      var root = hostRoot();
      if (root) { root.appendChild(au); root.classList.add("st5b-seek"); }
      au.play().then(function () {}, function () {});
      installSeekLayers();
      /* Re-install when a lazily-rendered page enters. */
      if (V_seekTimer) G.clearInterval(V_seekTimer);
      V_seekTimer = G.setInterval(function () { if (!player.mode) { G.clearInterval(V_seekTimer); return; } installSeekLayers(); }, 800);
      toast("Playing. Turn tools off and tap a stroke to jump to that moment.");
    });
  }
  var V_seekTimer = 0;
  /* Recordings list per notebook (More sheet audio section + viewer sheet). */
  function showAudioSheet() {
    var V = studyState(); if (!V || !V.id) return toast("Open a document first.");
    sheet('<h2>Recordings</h2><p>Tap play, then tap a stroke while it plays to jump to that moment.</p><div class="st5b-reclist" id="st5bRecList"><p role="status">Loading...</p></div>', null, null);
    refreshRecList();
  }
  function refreshRecList() {
    var V = studyState(); var list = hostRoot() && hostRoot().querySelector("#st5bRecList");
    if (!V || !list) return;
    audioOf(V.id).then(function (aa) {
      aa.sort(function (a, b) { return (b.started || 0) - (a.started || 0); });
      if (!aa.length) { list.innerHTML = '<p class="pn-empty">No recordings yet. Tap the mic to record while you write.</p>'; return; }
      list.innerHTML = aa.map(function (a) {
        var dt = new Date(a.started || Date.now());
        var hh = ("0" + dt.getHours()).slice(-2), mm = ("0" + dt.getMinutes()).slice(-2);
        return '<div class="st5b-rec">' +
          '<button type="button" class="st5b-rec-play" data-act="st-audio-play" data-id="' + a.id + '" aria-label="Play recording ' + fmtDur(a.dur) + '">' + ICO.play + "</button>" +
          '<span class="st5b-rec-info"><b>' + fmtDur(a.dur) + "</b><small>" + hh + ":" + mm + " · " + fmtBytes(a.size) + " · " + esc(a.mime || "audio") + "</small></span>" +
          '<button type="button" class="st5b-rec-del" data-act="st-audio-del" data-id="' + a.id + '" aria-label="Delete recording">' + ICO.trash + "</button>" +
          "</div>";
      }).join("");
    }, function () { list.innerHTML = '<p class="pn-empty">Recordings could not be read.</p>'; });
  }
  function delRec(id) {
    idbDel("audio", id).then(function () {
      if (player.recId === id) stopPlayer();
      refreshRecList(); refreshSettingsStorage();
      toast("Recording deleted.");
    });
  }
  /* Storage used per notebook in Settings (More sheet). */
  function storageForDoc(docId) {
    return Promise.all([
      idbGet("docs", docId),
      audioOf(docId),
      strokesOf(docId),
      idbGet("files", docId).then(function (f) { return f && f.blob ? f.blob.size || 0 : 0; }, function () { return 0; })
    ]).then(function (r) {
      var audioB = (r[1] || []).reduce(function (a, x) { return a + (+x.size || 0); }, 0);
      var strokeB = (r[2] || []).reduce(function (a, x) { return a + JSON.stringify(x).length; }, 0);
      var pdfB = +r[3] || 0;
      var st = storageOf({ pdfBytes: pdfB, audioBytes: audioB, strokeBytes: strokeB });
      return { total: st.total, audioBytes: audioB, pdfBytes: pdfB, strokeBytes: strokeB, n: (r[1] || []).length };
    }, function () { return { total: 0, audioBytes: 0, pdfBytes: 0, strokeBytes: 0, n: 0 }; });
  }
  function refreshSettingsStorage() {
    var el = hostRoot() && hostRoot().querySelector("#st5bStorage");
    var V = studyState(); if (!el || !V || el._busy) return;
    el._busy = true;
    storageForDoc(V.id).then(function (s) {
      el._busy = false;
      var msg = s.total ? ("This notebook uses " + fmtBytes(s.total) + " on this phone (" + s.n + (s.n === 1 ? " recording" : " recordings") + ", " + fmtBytes(s.audioBytes) + " audio).") : "This notebook uses almost no space on this phone.";
      if (el.textContent !== msg) el.textContent = msg;
    }, function () { el._busy = false; });
  }
  /* ================= 5.11 Print ================= */
  function sheet(html, ok, label) {
    closeSheet();
    var root = hostRoot(); if (!root) return;
    var e = D.createElement("div");
    e.id = "stSheet"; e.className = "st-sheet"; e.setAttribute("role", "dialog"); e.setAttribute("aria-modal", "true");
    e.innerHTML = '<div class="st-sh smd-books-keep smd-emo-keep">' + html + '<div class="st-acts">' + (ok ? '<button type="button" class="pn-btn pri" data-act="st-sok" id="stSheetOk">' + label + "</button>" : "") +
      '<button type="button" class="pn-btn" data-act="st-scancel">' + (ok ? "Cancel" : "Close") + "</button></div></div>";
    e.addEventListener("click", function (ev) { if (ev.target === e) closeSheet(); });
    root.appendChild(e);
  }
  function closeSheet() { var r = hostRoot(); if (!r) return; var e = r.querySelector("#stSheet"); if (e && e.parentNode) e.parentNode.removeChild(e); }
  function isNative() { try { return !!(G.SMD_IS_NATIVE && G.SMD_NATIVE && G.SMD_NATIVE.share && G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.Filesystem); } catch (e) { return false; } }
  function openPrintSheet() {
    var V = studyState(); if (!V || !V.id) return toast("Open a document first.");
    var cur = V.cur || 1;
    sheet('<h2>Print</h2><p>Print this page or every page with your ink. On this phone the pages are sent to the share sheet; on the web the print dialog opens.</p>' +
      '<div class="st-doc-menu-items">' +
        '<button type="button" class="st-menu-item" data-act="st-print-page"><div class="st-menu-ico">' + ICO.print + '</div><div class="st-menu-txt"><strong>This page (page ' + cur + ')</strong><small>One page with ink</small></div></button>' +
        '<button type="button" class="st-menu-item" data-act="st-print-all"><div class="st-menu-ico">' + ICO.print + '</div><div class="st-menu-txt"><strong>All pages (' + V.n + ')</strong><small>Every page with ink</small></div></button>' +
      "</div>", null, null);
  }
  function renderPageImage(V, pageNum) {
    var d = V.doc || {}, pdf = V.pdf, n = pageNum;
    var W = 1200;
    return new Promise(function (res, rej) {
      var c = D.createElement("canvas");
      var toData = function (ctx, cv) { try { res(cv.toDataURL("image/png")); } catch (e) { rej(e); } };
      var finish = function (ctx, cv) {
        var strokes = (V.strokes || []).filter(function (s) { return !s.gone; });
        if (V.nb) {
          var pid = (V.nb.ord || [])[n - 1];
          drawInk(ctx, strokes, pid, cv.width, cv.height);
        } else drawInk(ctx, strokes, n, cv.width, cv.height);
        toData(ctx, cv);
      };
      if (V.nb || !pdf) {
        var ratio = (V.nb && V.nb.ratio) || V.ratio || 1.414;
        c.width = W; c.height = Math.round(W * ratio);
        var ctx0 = c.getContext("2d");
        drawBg(ctx0, (V.nb && V.nb.style) || "blank", ratio, W);
        finish(ctx0, c);
        return;
      }
      pdf.getPage(n).then(function (pg) {
        var v0 = pg.getViewport({ scale: 1 }), sc = W / v0.width, vp = pg.getViewport({ scale: sc });
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { try { pg.cleanup(); } catch (e) {} finish(ctx, c); }, rej);
      }, rej);
    });
  }
  function printViaIframe(V, pages) {
    closeSheet();
    toast("Preparing pages...");
    var urls = [], i = 0;
    var nextRecover = function () {
      if (i >= pages.length) return doIframePrint(urls);
      renderPageImage(V, pages[i++]).then(function (u) { urls.push(u); nextRecover(); }, function () { urls.push(null); nextRecover(); });
    };
    nextRecover();
  }
  function doIframePrint(urls) {
    var good = urls.filter(function (u) { return u; });
    if (!good.length) return toast("Those pages could not be prepared.");
    var fr = D.createElement("iframe");
    fr.className = "st5b-print-frame"; fr.setAttribute("aria-hidden", "true"); fr.setAttribute("tabindex", "-1");
    D.body.appendChild(fr);
    var doc = fr.contentDocument, win = fr.contentWindow;
    doc.open();
    doc.write("<!doctype html><html><head><title>Print</title><style>body{margin:0}img{display:block;max-width:100%;page-break-after:always}</style></head><body>" +
      good.map(function (u) { return '<img src="' + u + '" alt="">'; }).join("") + "</body></html>");
    doc.close();
    G.setTimeout(function () {
      try { win.focus(); win.print(); } catch (e) {}
      G.setTimeout(function () { try { fr.parentNode.removeChild(fr); } catch (e) {} }, 2000);
    }, 300);
  }
  function doPrint(which) {
    var V = studyState(); if (!V || !V.id) return;
    var cur = V.cur || 1;
    var pages = which === "page" ? pageList(V.n, cur) : pageList(V.n, null);
    if (!pages.length) return toast("No pages to print.");
    /* Native: share sheet with the exported PDF (study-library.js export). */
    if (isNative()) {
      closeSheet();
      try {
        if (G.STUDY_LIB && G.STUDY_LIB.exportAll) return G.STUDY_LIB.exportAll(V.id, which === "page" ? cur : null);
      } catch (e) {}
      return toast("Sharing is not available here.");
    }
    printViaIframe(V, pages);
  }
  /* ================= 5.12 Presentation ================= */
  var pres = { on: false, page: 1, el: null, laser: null };
  function presentRender() {
    var V = studyState(); if (!V || !pres.el) return;
    var n = pres.page, img = pres.el.querySelector(".st5b-pres-img"), label = pres.el.querySelector(".st5b-pres-n");
    if (label) label.textContent = n + " of " + V.n;
    renderPageImage(V, n).then(function (u) { if (img) img.src = u; }, function () {});
  }
  function enterPresent() {
    var V = studyState(); if (!V || !V.id) return toast("Open a document first.");
    if (pres.on) return;
    pres.on = true; pres.page = V.cur || 1;
    var root = hostRoot(); if (!root) return;
    var el = D.createElement("div");
    el.id = "st5bPresent"; el.className = "st5b-present";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Presentation");
    el.innerHTML = '<div class="st5b-pres-stage"><img class="st5b-pres-img" alt="Current page">' +
      '<div class="st5b-laser" aria-hidden="true"><span class="st5b-laser-dot"></span></div>' +
      "</div>" +
      '<div class="st5b-pres-bar" role="toolbar" aria-label="Presentation controls">' +
        '<button type="button" class="st5b-pres-btn" data-act="st-present-prev" aria-label="Previous page">' + ICO.prev + "</button>" +
        '<span class="st5b-pres-n"></span>' +
        '<button type="button" class="st5b-pres-btn" data-act="st-present-next" aria-label="Next page">' + ICO.next + "</button>" +
        '<button type="button" class="st5b-pres-btn" data-act="st-present-exit" aria-label="Exit presentation">' + ICO.close + " Exit</button>" +
      "</div>";
    root.appendChild(el); pres.el = el; pres.laser = el.querySelector(".st5b-laser");
    /* Laser follows the pointer over the stage; it mirrors to the TV with the screen. */
    var stage = el.querySelector(".st5b-pres-stage");
    var move = function (e) {
      if (!pres.laser) return;
      var r = stage.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      pres.laser.style.transform = "translate(" + (x - 8) + "px," + (y - 8) + "px)";
      pres.laser.style.opacity = "1";
    };
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerdown", move);
    stage.addEventListener("pointerleave", function () { if (pres.laser) pres.laser.style.opacity = "0"; });
    /* Chrome hidden: body class hides the toolbar, doc tabs and AI box. */
    if (D.body) D.body.classList.add("st5b-presenting");
    root.classList.add("st5b-presenting");
    presentRender();
    try { if (el.requestFullscreen) el.requestFullscreen().then(function () {}, function () {}); } catch (e) {}
  }
  function exitPresent() {
    if (!pres.on) return;
    pres.on = false;
    if (pres.el && pres.el.parentNode) pres.el.parentNode.removeChild(pres.el);
    pres.el = null; pres.laser = null;
    if (D.body) D.body.classList.remove("st5b-presenting");
    var root = hostRoot(); if (root) root.classList.remove("st5b-presenting");
    try { if (D.exitFullscreen && D.fullscreenElement) D.exitFullscreen(); } catch (e) {}
  }
  function stepPresent(dir) {
    var V = studyState(); if (!V || !pres.on) return;
    pres.page = Math.max(1, Math.min(V.n, pres.page + (dir || 1)));
    var root = hostRoot();
    if (V.sc && V.pg[pres.page] && V.pg[pres.page].el) V.sc.scrollTop = V.pg[pres.page].el.offsetTop;
    presentRender();
  }
  /* ================= viewer toolbar + sheets injection ================= */
  function mediaButtons() {
    /* If polished #stP3Top is present, media controls live in #stP3Top and #stP3MoreSheet.
       Do not inject extra buttons into #stTb. */
    var root = hostRoot(); if (!root) return;
    if (root.querySelector("#stP3Top")) return;
    var tb = root.querySelector("#stTb");
    if (!tb || tb.querySelector('[data-act="st-media-search"]')) return;
    var more = tb.querySelector(".st-tb-more");
    if (!more) return;
    var btn = function (act, ic, label) {
      return '<button type="button" class="st-b" data-act="' + act + '" title="' + label + '" aria-label="' + label + '">' + ic + "</button>";
    };
    more.insertAdjacentHTML("afterbegin",
      btn("st-media-search", ICO.search, "Search in document") +
      btn("st-audio-rec", ICO.mic, "Record while you write") +
      btn("st-print-open", ICO.print, "Print") +
      btn("st-present", ICO.present, "Present"));
    var style = root.querySelector("#stMediaBtnStyle");
    if (!style) return;
  }
  function injectMoreSections() {
    var root = hostRoot(); if (!root) return;
    var sheetEl = root.querySelector("#stMoreSheet");
    if (!sheetEl) return;
    /* Guard against re-injecting when the sheet re-renders with same node. */
    if (sheetEl.querySelector('[data-act="st-audio-list"]')) { refreshSettingsStorage(); return; }
    var settingsSec = sheetEl.querySelectorAll(".st-more-sec");
    var last = settingsSec[settingsSec.length - 1];
    if (!last) return;
    var div = D.createElement("div");
    div.className = "st-more-sec";
    div.innerHTML = '<div class="st-more-sec-title">Audio</div>' +
      '<button type="button" class="st-menu-item" data-act="st-audio-list">' +
        '<div class="st-menu-ico">' + ICO.mic + '</div>' +
        '<div class="st-menu-txt"><strong>Recordings</strong><small>Play and tap a stroke to jump</small></div>' +
      "</button>" +
      '<p class="pn-note" id="st5bStorage" role="status">Storage will appear here.</p>';
    last.parentNode.insertBefore(div, last.nextSibling);
    /* Print + Present in Share and export / View: append rows to the last section. */
    var share = sheetEl.querySelectorAll(".st-more-sec")[1];
    if (share && !share.querySelector('[data-act="st-print-open"]')) {
      share.insertAdjacentHTML("beforeend",
        '<button type="button" class="st-menu-item" data-act="st-print-open">' +
          '<div class="st-menu-ico">' + ICO.print + '</div>' +
          '<div class="st-menu-txt"><strong>Print</strong><small>This page or all pages</small></div></button>');
    }
    var view = sheetEl.querySelectorAll(".st-more-sec")[2];
    if (view && !view.querySelector('[data-act="st-present"]')) {
      view.insertAdjacentHTML("beforeend",
        '<button type="button" class="st-menu-item" data-act="st-present">' +
          '<div class="st-menu-ico">' + ICO.present + '</div>' +
          '<div class="st-menu-txt"><strong>Present</strong><small>Fullscreen, laser follows pointer</small></div></button>');
    }
    refreshSettingsStorage();
  }
  /* ================= actions (st- prefix via STUDY.act wrapper) ================= */
  var origAct = null, origBack = null, origLeave = null;
  function closeP3More() {
    var root = hostRoot(); if (!root) return;
    var s = root.querySelector("#stP3MoreSheet");
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }
  function mediaAct(a, el, h) {
    if (a === "st-media-search" || a === "st-p3-search") { closeP3More(); toggleInDoc(!(inDocBar())); return true; }
    if (a === "st-indoc-close") { toggleInDoc(false); return true; }
    if (a === "st-indoc-prev") { stepInDoc(-1); return true; }
    if (a === "st-indoc-next") { stepInDoc(1); return true; }
    if (a === "st-audio-rec" || a === "st-p3-mic") { closeP3More(); startRec(); return true; }
    if (a === "st-audio-list") { closeP3More(); showAudioSheet(); return true; }
    if (a === "st-audio-play") { playRec(el.getAttribute("data-id")); return true; }
    if (a === "st-audio-del") { delRec(el.getAttribute("data-id")); return true; }
    if (a === "st-print-open" || a === "st-p3-print") { closeP3More(); openPrintSheet(); return true; }
    if (a === "st-print-page") { doPrint("page"); return true; }
    if (a === "st-print-all") { doPrint("all"); return true; }
    if (a === "st-present" || a === "st-p3-present") { closeP3More(); enterPresent(); return true; }
    if (a === "st-present-exit") { exitPresent(); return true; }
    if (a === "st-present-prev") { stepPresent(-1); return true; }
    if (a === "st-present-next") { stepPresent(1); return true; }
    return false;
  }
  /* ================= init: wrap STUDY.act, observe viewer ================= */
  function init() {
    var S = G.STUDY; if (!S) return false;
    if (S._5b) return true; S._5b = true;
    origAct = S.act; origBack = S.back; origLeave = S.leave;
    S.act = function (a, el, h) {
      if (mediaAct(a, el, h)) return true;
      if (a === "st-more") { var r = origAct(a, el, h); G.setTimeout(injectMoreSections, 30); return r; }
      if (a === "st-scancel" || a === "st-sok") { var rr = origAct(a, el, h); return rr; }
      return origAct(a, el, h);
    };
    S.back = function () {
      if (pres.on) { exitPresent(); return true; }
      if (inDocBar()) { toggleInDoc(false); return true; }
      if (player.mode) { stopPlayer(); return true; }
      return origBack ? origBack() : false;
    };
    S.leave = function () {
      if (rec.active) stopRec();
      stopPlayer(); exitPresent(); toggleInDoc(false); clearInDocHL();
      return origLeave ? origLeave() : null;
    };
    /* Re-inject toolbar buttons + enrich new library hits as the DOM changes. */
    if (G.MutationObserver && D.body) {
      var mo = new G.MutationObserver(function () {
        mediaButtons(); enrichHits(); injectMoreSections(); setMicBtn();
      });
      mo.observe(D.body, { childList: true, subtree: true });
    }
    /* Esc exits presentation even when focus is in the page. */
    D.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && pres.on) exitPresent();
    }, true);
    return true;
  }
  if (!init()) G.setTimeout(init, 0);
  G.STUDY_MEDIA = {
    pure: PURE, stampStroke: stampStroke, indexText: indexText, indexStrokeText: indexStrokeText,
    pageThumb: pageThumb, runInDoc: runInDoc, stepInDoc: stepInDoc, toggleInDoc: toggleInDoc,
    startRec: startRec, stopRec: stopRec, playRec: playRec, stopPlayer: stopPlayer, delRec: delRec,
    showAudioSheet: showAudioSheet, storageForDoc: storageForDoc, refreshSettingsStorage: refreshSettingsStorage,
    openPrintSheet: openPrintSheet, doPrint: doPrint, enterPresent: enterPresent, exitPresent: exitPresent,
    stepPresent: stepPresent, mediaButtons: mediaButtons,
    _state: function () { return { rec: rec, player: player, inDoc: inDoc, pres: pres }; }
  };
})(typeof window !== "undefined" ? window : this);






