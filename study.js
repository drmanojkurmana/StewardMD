/* PrepNucleus Study Studio (phase A1 to A3): a PDF library, a viewer and a pen. window.STUDY. ES5. Loaded by
   prep-loader.js only when flag smd_study is on; draws through PREP._host. prep.js forwards every data-act starting
   "st-" here and asks back() first. Plan: vault/plans/PrepNucleus-StudyStudio.md, note: vault/modules/Study Studio.md.
   Flag smd_study, default OFF, needs smd_prep: localStorage "1" or ?study=1 on, "0" or ?study=0 off.
   Data: IndexedDB "study": docs (metadata + thumbnail), files (original bytes, only when Filesystem is absent), folders,
   strokes (one record per stroke, page-relative 0..1 points [x, y, pressure]), undo (the stacks, per document).
   The original PDF is never modified: it is written once at import and only read afterwards.
   Pure helpers (page-relative maths, eraser hit test, undo/redo stack) load under node. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  function enabled(search, get, prepOn) {
    try {
      if (!prepOn) return false;
      var q = (String(search || "").match(/[?&]study=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return get("smd_study") === "1";
    } catch (e) { return false; }
  }
  // Pointer position in a box (CSS px rect) to 0..1, and back.
  function toRel(x, y, r) { return [(x - r.left) / r.width, (y - r.top) / r.height]; }
  function toAbs(rx, ry, w, h) { return [rx * w, ry * h]; }
  function dist2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var cx = ax + t * dx - px, cy = ay + t * dy - py;
    return cx * cx + cy * cy;
  }
  // Does a circle of rad px at (rx, ry) (0..1) touch the stroke on a w x h px page? Half the stroke width counts.
  function hit(s, rx, ry, rad, w, h) {
    var p = s.pts, px = rx * w, py = ry * h, r = rad + (s.w * w) / 2, r2 = r * r, i;
    if (!p.length) return false;
    if (p.length === 1) return dist2(px, py, p[0][0] * w, p[0][1] * h, p[0][0] * w, p[0][1] * h) <= r2;
    for (i = 1; i < p.length; i++) if (dist2(px, py, p[i - 1][0] * w, p[i - 1][1] * h, p[i][0] * w, p[i][1] * h) <= r2) return true;
    return false;
  }
  // Undo/redo: ops are { t: "add", id } or { t: "del", ids: [id] }. Strokes are never deleted, only flagged gone, so
  // an op is just ids and the stacks stay small enough to persist.
  var CAP = 200;
  function newStack(o) { return { u: (o && o.u) || [], r: (o && o.r) || [] }; }
  function push(st, op) { st.u.push(op); if (st.u.length > CAP) st.u.shift(); st.r = []; return st; }
  function opIds(op) { return op.t === "add" ? [op.id] : op.ids; }
  // gone value each id of op takes when the op is undone (undoing true) or applied again.
  function goneAfter(op, undoing) { return op.t === "add" ? !!undoing : !undoing; }
  function undo(st) { var op = st.u.pop(); if (!op) return null; st.r.push(op); return { op: op, gone: goneAfter(op, true) }; }
  function redo(st) { var op = st.r.pop(); if (!op) return null; st.u.push(op); return { op: op, gone: goneAfter(op, false) }; }
  // Pressure: pens report 0..1; 0 or missing (mouse, finger, unsupported) is 0.5.
  function pressure(e) { return e && e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5; }
  function r4(n) { return Math.round(n * 10000) / 10000; }

  var PURE = { enabled: enabled, toRel: toRel, toAbs: toAbs, hit: hit, newStack: newStack, push: push, undo: undo, redo: redo, opIds: opIds, pressure: pressure, r4: r4 };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var D = G.document, host = null, V = null, penSeen = false, uidN = 0;
  var COLORS = ["#111111", "#1a56db", "#d11a2a"], HCOLORS = ["#ffe14d", "#6fdc6f", "#ff8fc8"], WIDTHS = [0.0016, 0.0032, 0.0064], HMUL = 6;
  var lib = { filter: "all" };

  function uid() { return Date.now().toString(36) + (++uidN).toString(36) + Math.random().toString(36).slice(2, 7); }
  function on() { try { return enabled(G.location.search, function (k) { return G.localStorage.getItem(k); }, !G.PREP_LOADER || G.PREP_LOADER.enabled()); } catch (e) { return false; } }

  /* ---- IndexedDB ---- */
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      var r = G.indexedDB.open("study", 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        d.createObjectStore("docs", { keyPath: "id" });
        d.createObjectStore("files", { keyPath: "id" });
        d.createObjectStore("folders", { keyPath: "id" });
        d.createObjectStore("strokes", { keyPath: "id" }).createIndex("doc", "doc");
        d.createObjectStore("undo", { keyPath: "doc" });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { dbP = null; rej(r.error); };
    });
    return dbP;
  }
  // One request in one transaction; resolves with its result once the transaction is durable.
  function q(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), r = fn(t.objectStore(store));
        t.oncomplete = function () { res(r && r.result); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  var get = function (s, k) { return q(s, "readonly", function (o) { return o.get(k); }); };
  var all = function (s) { return q(s, "readonly", function (o) { return o.getAll(); }); };
  var put = function (s, v) { return q(s, "readwrite", function (o) { return o.put(v); }); };
  var del = function (s, k) { return q(s, "readwrite", function (o) { return o.delete(k); }); };
  var strokesOf = function (id) { return q("strokes", "readonly", function (o) { return o.index("doc").getAll(G.IDBKeyRange.only(id)); }); };

  /* ---- original bytes ---- */
  function fsPlugin() { try { var P = G.Capacitor && G.Capacitor.Plugins; return P && P.Filesystem && P.Filesystem.writeFile ? P.Filesystem : null; } catch (e) { return null; } }
  function b64(bytes) { var s = "", i, n = bytes.length; for (i = 0; i < n; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return G.btoa(s); }
  function unb64(s) { var bin = G.atob(s), n = bin.length, a = new Uint8Array(n), i; for (i = 0; i < n; i++) a[i] = bin.charCodeAt(i); return a; }
  function sha256(bytes) {
    return G.crypto.subtle.digest("SHA-256", bytes).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
    });
  }
  function saveOriginal(id, bytes) {
    var fs = fsPlugin();
    if (fs) return fs.writeFile({ path: "study/" + id + ".pdf", data: b64(bytes), directory: "DATA", recursive: true }).then(function () { return "fs"; });
    // shortcut: without Filesystem (no native shell) the original lives as an IndexedDB blob; the app always has the plugin.
    return put("files", { id: id, blob: new Blob([bytes], { type: "application/pdf" }) }).then(function () { return "idb"; });
  }
  function loadOriginal(d) {
    if (d.store === "fs") return fsPlugin().readFile({ path: "study/" + d.id + ".pdf", directory: "DATA" }).then(function (r) { return unb64(r.data); });
    return get("files", d.id).then(function (f) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(new Uint8Array(fr.result)); }; fr.onerror = rej; fr.readAsArrayBuffer(f.blob); }); });
  }

  /* ---- pdf.js (the vendored copy prep-source.js loads) ---- */
  var libP = null;
  function pdfjs() {
    if (G.pdfjsLib) { G.pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js"; return Promise.resolve(G.pdfjsLib); }
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = D.createElement("script");
      s.src = "/vendor/pdfjs/pdf.min.js";
      s.onload = function () { if (!G.pdfjsLib) { libP = null; return rej(new Error("pdf-load")); } G.pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js"; res(G.pdfjsLib); };
      s.onerror = function () { libP = null; rej(new Error("pdf-load")); };
      D.head.appendChild(s);
    });
    return libP;
  }
  // pdf.js hands the bytes to its worker, so it always gets a copy: the caller's array stays whole for sha and storage.
  function openPdf(bytes) { return pdfjs().then(function (L) { return L.getDocument({ data: bytes.slice() }).promise; }); }

  /* ---- library ---- */
  function importBytes(bytes, name) {
    var id = uid(), meta = { id: id, title: String(name || "PDF").replace(/\.pdf$/i, "").slice(0, 120) || "PDF", created: Date.now(), lastOpened: 0, favourite: false, folderId: null, subject: null };
    return sha256(bytes).then(function (h) {
      meta.sha256 = h;
      return openPdf(bytes);
    }).then(function (pdf) {
      meta.pageCount = pdf.numPages;
      return pdf.getPage(1).then(function (p) {
        var v0 = p.getViewport({ scale: 1 }), sc = 160 / v0.width, v = p.getViewport({ scale: sc }), c = D.createElement("canvas");
        c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
        return p.render({ canvasContext: c.getContext("2d"), viewport: v }).promise.then(function () { meta.thumb = c.toDataURL("image/jpeg", 0.7); pdf.destroy(); });
      });
    }).then(function () { return saveOriginal(id, bytes); }).then(function (where) { meta.store = where; return put("docs", meta); }).then(function () { return meta; });
  }
  function pickPdf() {
    var N = G.SMD_NATIVE;
    var viaInput = function () { var f = host.root() && host.root().querySelector("#stFile"); if (f) f.click(); };
    if (!(N && N.pickFile)) return viaInput();
    N.pickFile({ types: ["application/pdf"] }).then(function (blob) {
      return blob.arrayBuffer().then(function (ab) { return importFile(new Uint8Array(ab), blob.name); });
    }, viaInput);
  }
  function importFile(bytes, name) {
    host.toast("Importing...");
    return importBytes(bytes, name).then(function () { host.toast("PDF added."); if (onTop("#stLib")) fillLib(); }, function () { host.toast("That file could not be added."); });
  }
  function onTop(sel) { return !!(host && host.root() && host.root().querySelector(sel)); }

  function renderLib() {
    closeViewer();
    var h = host;
    h.paint(h.bar("Study Studio", "Read and write on your PDFs", "back") + '<div class="pn-body st-lib" id="stLib">' +
      '<button type="button" class="pn-btn pri" data-act="st-import">' + h.ico("plus") + ' Import a PDF</button>' +
      '<input type="file" id="stFile" accept="application/pdf" hidden>' +
      '<div class="st-chips" id="stChips"></div><div id="stList" aria-live="polite"></div>' +
      '<p class="pn-note">PDFs stay on this phone. Your original file is never changed; pen strokes are saved beside it.</p></div>');
    var f = h.root().querySelector("#stFile");
    f.addEventListener("change", function () {
      var file = f.files && f.files[0]; if (!file) return;
      file.arrayBuffer().then(function (ab) { f.value = ""; return importFile(new Uint8Array(ab), file.name); });
    });
    h.root().querySelector("#stList").addEventListener("change", function (e) {
      var s = e.target.closest && e.target.closest("select[data-id]"); if (!s) return;
      get("docs", s.getAttribute("data-id")).then(function (d) { d.folderId = s.value || null; return put("docs", d); }).then(fillLib);
    });
    fillLib();
  }
  function fillLib() {
    Promise.all([all("docs"), all("folders")]).then(function (r) {
      var root = host.root(), list = root && root.querySelector("#stList"); if (!list) return;
      var docs = r[0].sort(function (a, b) { return (b.lastOpened || b.created) - (a.lastOpened || a.created); }), folders = r[1], esc = host.esc, f = lib.filter;
      if (f !== "all" && f !== "fav" && !folders.some(function (x) { return x.id === f; })) f = lib.filter = "all";
      var chip = function (v, label) { return '<button type="button" class="st-chip' + (f === v ? " on" : "") + '" data-act="st-filter" data-v="' + esc(v) + '">' + esc(label) + "</button>"; };
      root.querySelector("#stChips").innerHTML = chip("all", "Recent") + chip("fav", "Favourites") + folders.map(function (x) { return chip(x.id, x.name); }).join("") +
        '<button type="button" class="st-chip" data-act="st-newfolder">+ Folder</button>' + (f !== "all" && f !== "fav" ? '<button type="button" class="st-chip" data-act="st-delfolder" data-v="' + esc(f) + '">Delete folder</button>' : "");
      var shown = docs.filter(function (d) { return f === "all" || (f === "fav" ? d.favourite : d.folderId === f); });
      if (!shown.length) { list.innerHTML = '<p class="pn-empty">' + (docs.length ? "Nothing here yet." : "No PDFs yet. Import one to read and write on it.") + "</p>"; return; }
      list.innerHTML = shown.map(function (d) {
        return '<div class="st-doc"><button type="button" class="st-open" data-act="st-open" data-id="' + d.id + '"><img class="st-th" alt="" src="' + (d.thumb || "") + '"><span class="st-tt"><b>' + esc(d.title) + "</b><small>" + d.pageCount + (d.pageCount === 1 ? " page" : " pages") + "</small></span></button>" +
          '<div class="st-acts"><button type="button" class="pn-btn sm" data-act="st-fav" data-id="' + d.id + '" aria-pressed="' + !!d.favourite + '">' + (d.favourite ? "Starred" : "Star") + "</button>" +
          '<button type="button" class="pn-btn sm" data-act="st-rename" data-id="' + d.id + '">Rename</button>' +
          '<select class="st-sel" data-id="' + d.id + '" aria-label="Folder"><option value="">No folder</option>' + folders.map(function (x) { return '<option value="' + x.id + '"' + (d.folderId === x.id ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select>" +
          '<button type="button" class="pn-btn sm" data-act="st-delete" data-id="' + d.id + '">Delete</button></div></div>';
      }).join("");
    });
  }
  function removeDoc(id) {
    return strokesOf(id).then(function (ss) {
      return Promise.all(ss.map(function (s) { return del("strokes", s.id); }));
    }).then(function () { return Promise.all([del("undo", id), del("files", id), del("docs", id)]); });
  }

  /* ---- viewer ---- */
  function closeViewer() {
    if (!V) return;
    try { V.io.disconnect(); } catch (e) {}
    Object.keys(V.pg).forEach(function (n) { freePage(+n); });
    try { V.pdf.destroy(); } catch (e) {}
    V = null;
  }
  function renderViewer(id) {
    var h = host;
    get("docs", id).then(function (d) {
      if (!d) return h.back();
      d.lastOpened = Date.now(); put("docs", d);
      h.paint(h.bar(h.esc(d.title), d.pageCount + (d.pageCount === 1 ? " page" : " pages"), "back") + '<div class="pn-body st-body">' + toolbarHtml(d) + '<div class="st-sc" id="stSc"><div class="st-pages" id="stPages"></div></div></div>');
      return Promise.all([loadOriginal(d).then(openPdf), strokesOf(id), get("undo", id)]).then(function (r) { startViewer(d, r[0], r[1], r[2]); });
    }).catch(function () { h.toast("That PDF could not be opened."); });
  }
  function toolbarHtml(d) {
    var b = function (act, label, v, extra) { return '<button type="button" class="st-b" data-act="' + act + '"' + (v != null ? ' data-v="' + v + '"' : "") + (extra || "") + ">" + label + "</button>"; };
    return '<div class="st-tb" id="stTb" role="toolbar" aria-label="Pen tools">' +
      b("st-tool", "Pen", "pen") + b("st-tool", "Marker", "hl") + b("st-tool", "Eraser", "er") +
      '<span class="st-sep"></span>' + [0, 1, 2].map(function (i) { return '<button type="button" class="st-b st-c" data-act="st-color" data-v="' + i + '" aria-label="Colour ' + (i + 1) + '" style="--c:' + COLORS[i] + '"></button>'; }).join("") +
      '<span class="st-sep"></span>' + [0, 1, 2].map(function (i) { return '<button type="button" class="st-b st-w" data-act="st-width" data-v="' + i + '" aria-label="Width ' + (i + 1) + '"><i style="height:' + (i + 1) * 2 + 'px"></i></button>'; }).join("") +
      '<span class="st-sep"></span>' + b("st-undo", "Undo", null, " id=stUndo") + b("st-redo", "Redo", null, " id=stRedo") +
      '<span class="st-sep"></span><label class="st-pj">Page <input id="stPage" type="number" inputmode="numeric" min="1" max="' + d.pageCount + '" value="1"> of ' + d.pageCount + "</label>" + b("st-go", "Go") + b("st-zoom", "-", "-", ' aria-label="Zoom out"') + b("st-zoom", "+", "+", ' aria-label="Zoom in"') + "</div>";
  }
  function startViewer(d, pdf, strokes, undoRec) {
    var root = host.root(), sc = root && root.querySelector("#stSc"), box = root && root.querySelector("#stPages");
    if (!sc) { try { pdf.destroy(); } catch (e) {} return; }
    closeViewer();
    V = { id: d.id, n: pdf.numPages, pdf: pdf, sc: sc, box: box, z: 1, pg: {}, strokes: strokes, stack: newStack(undoRec), tool: null, ci: 0, wi: 1, ratio: 1.414, baseW: Math.max(200, (sc.clientWidth || 360) - 16) };
    pdf.getPage(1).then(function (p) { var v = p.getViewport({ scale: 1 }); V.ratio = v.height / v.width; build(); });
    syncTb();
  }
  function build() {
    var i, f = D.createDocumentFragment(), cw = V.baseW * V.z;
    for (i = 1; i <= V.n; i++) {
      var el = D.createElement("div"); el.className = "st-pg"; el.setAttribute("data-n", i);
      el.style.width = cw + "px"; el.style.height = cw * V.ratio + "px";
      V.pg[i] = { el: el, ratio: V.ratio, on: false, gen: 0 };
      f.appendChild(el);
    }
    V.box.appendChild(f);
    // Only pages within about 1.5 screens of the viewport hold canvases; the rest are empty boxes of the right size.
    V.io = new G.IntersectionObserver(function (es) {
      es.forEach(function (e) { var n = +e.target.getAttribute("data-n"); if (e.isIntersecting) renderPage(n); else freePage(n); });
    }, { root: V.sc, rootMargin: "150% 0px 150% 0px" });
    for (i = 1; i <= V.n; i++) V.io.observe(V.pg[i].el);
    V.sc.addEventListener("scroll", function () { if (V.raf) return; V.raf = G.requestAnimationFrame(function () { V.raf = 0; curPage(); }); });
    bindPinch();
    V.sc.addEventListener("pointermove", function (e) { if (e.pointerType === "pen") penSeen = true; }, true);
    V.sc.addEventListener("pointerdown", function (e) { if (e.pointerType === "pen") penSeen = true; }, true);
  }
  function curPage() {
    if (!V) return;
    var y = V.sc.scrollTop + V.sc.clientHeight / 3, n = 1, i;
    for (i = 1; i <= V.n; i++) { if (V.pg[i].el.offsetTop > y) break; n = i; }
    V.cur = n;
    var inp = host.root() && host.root().querySelector("#stPage"); if (inp && D.activeElement !== inp) inp.value = n;
  }
  function renderPage(n) {
    var p = V && V.pg[n]; if (!p || p.on) return;
    p.on = true; var gen = ++p.gen, pdf = V.pdf;
    pdf.getPage(n).then(function (page) {
      if (!V || V.pdf !== pdf || p.gen !== gen) return;
      var v1 = page.getViewport({ scale: 1 }), cw = V.baseW * V.z, ch = cw * v1.height / v1.width, dpr = Math.min(G.devicePixelRatio || 1, 2);
      var qf = Math.min(dpr, 4096 / cw); // canvas side stays under 4096 px even at 4x zoom
      p.ratio = v1.height / v1.width; p.el.style.height = ch + "px";
      var cv = D.createElement("canvas"), ov = D.createElement("canvas"), vp = page.getViewport({ scale: (cw / v1.width) * qf });
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height); cv.className = "st-cv";
      ov.width = Math.floor(cw * dpr); ov.height = Math.floor(ch * dpr); ov.className = "st-ov"; ov.setAttribute("data-n", n);
      p.cv = cv; p.ov = ov; p.el.appendChild(cv); p.el.appendChild(ov);
      bindInk(ov, n); redraw(n);
      p.task = page.render({ canvasContext: cv.getContext("2d"), viewport: vp });
      p.task.promise.then(function () { page.cleanup(); }, function () {});
    });
  }
  function freePage(n) {
    var p = V && V.pg[n]; if (!p || !p.on) return;
    p.on = false; p.gen++;
    try { if (p.task) p.task.cancel(); } catch (e) {}
    p.task = null;
    [p.cv, p.ov].forEach(function (c) { if (c) { c.width = 0; c.height = 0; if (c.parentNode) c.parentNode.removeChild(c); } });
    p.cv = p.ov = null;
  }
  function setZoom(z) {
    z = Math.max(0.5, Math.min(4, z)); if (!V || z === V.z) return;
    var k = z / V.z, i, cw = V.baseW * z;
    V.sc.scrollTop *= k; V.sc.scrollLeft *= k; V.z = z;
    for (i = 1; i <= V.n; i++) { var p = V.pg[i]; p.el.style.width = cw + "px"; p.el.style.height = cw * p.ratio + "px"; }
    // The canvases stretch while the fingers move; sharp ones are drawn once it settles.
    G.clearTimeout(V.zt);
    V.zt = G.setTimeout(function () { if (!V) return; Object.keys(V.pg).forEach(function (n) { if (V.pg[n].on) { freePage(+n); renderPage(+n); } }); }, 250);
  }
  function bindPinch() {
    var d0 = 0, z0 = 1;
    var span = function (t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); };
    V.sc.addEventListener("touchstart", function (e) { if (e.touches.length === 2) { d0 = span(e.touches); z0 = V.z; } }, { passive: true });
    V.sc.addEventListener("touchmove", function (e) { if (e.touches.length === 2 && d0) { if (e.cancelable) e.preventDefault(); setZoom(z0 * span(e.touches) / d0); } }, { passive: false });
    V.sc.addEventListener("touchend", function (e) { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  }

  /* ---- ink ---- */
  function penW(s, W, p) { return s.tool === "hl" ? s.w * W * HMUL : s.w * W * (0.5 + p); }
  function drawStroke(ctx, s, W, H, dpr) {
    var p = s.pts, i;
    ctx.save(); ctx.scale(dpr, dpr); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = s.color;
    if (s.tool === "hl") {
      ctx.globalAlpha = 0.35; ctx.lineWidth = penW(s, W, 0.5); ctx.beginPath();
      for (i = 0; i < p.length; i++) { if (i) ctx.lineTo(p[i][0] * W, p[i][1] * H); else ctx.moveTo(p[i][0] * W, p[i][1] * H); }
      if (p.length === 1) ctx.lineTo(p[0][0] * W + 0.01, p[0][1] * H);
      ctx.stroke();
    } else {
      for (i = p.length > 1 ? 1 : 0; i < p.length; i++) {
        var a = p[i ? i - 1 : 0];
        ctx.lineWidth = penW(s, W, p[i][2]); ctx.beginPath(); ctx.moveTo(a[0] * W, a[1] * H); ctx.lineTo(p[i][0] * W + (p.length === 1 ? 0.01 : 0), p[i][1] * H); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function redraw(n, live) {
    var p = V && V.pg[n]; if (!p || !p.ov) return;
    var ctx = p.ov.getContext("2d"), dpr = p.ov.width / (p.el.clientWidth || 1), W = p.el.clientWidth, H = p.el.clientHeight;
    ctx.clearRect(0, 0, p.ov.width, p.ov.height);
    V.strokes.forEach(function (s) { if (s.page === n && !s.gone) drawStroke(ctx, s, W, H, dpr); });
    if (live) drawStroke(ctx, live, W, H, dpr);
  }
  function syncTb() {
    var root = host && host.root(); if (!root || !V) return;
    Array.prototype.forEach.call(root.querySelectorAll("#stTb [data-act]"), function (b) {
      var a = b.getAttribute("data-act"), v = b.getAttribute("data-v"), onb = (a === "st-tool" && v === V.tool) || (a === "st-color" && +v === V.ci) || (a === "st-width" && +v === V.wi);
      b.classList.toggle("on", onb); if (a === "st-tool" || a === "st-color" || a === "st-width") b.setAttribute("aria-pressed", onb ? "true" : "false");
      if (a === "st-color") b.style.setProperty("--c", (V.tool === "hl" ? HCOLORS : COLORS)[+v]);
      if (a === "st-undo") b.disabled = !V.stack.u.length;
      if (a === "st-redo") b.disabled = !V.stack.r.length;
    });
    // touch-action none only while a drawing tool is active, so a finger scrolls the page the rest of the time.
    V.box.classList.toggle("st-ink", !!V.tool);
  }
  function saveStack() { return put("undo", { doc: V.id, u: V.stack.u, r: V.stack.r }); }
  function bindInk(ov, n) {
    var cur = null, pan = null, erased = null;
    var pos = function (e) { var r = ov.getBoundingClientRect(); return toRel(e.clientX, e.clientY, r); };
    var sample = function (e) { var a = pos(e); return [r4(a[0]), r4(a[1]), r4(pressure(e))]; };
    ov.addEventListener("pointerdown", function (e) {
      if (!V || !V.tool) return;
      if (e.pointerType === "pen") penSeen = true;
      if (e.pointerType === "touch" && penSeen) { pan = { y: e.clientY, x: e.clientX }; return; }   // palm rejection: a finger scrolls, a pen draws
      if (e.pointerType === "mouse" && e.button) return;
      try { ov.setPointerCapture(e.pointerId); } catch (x) {}
      if (V.tool === "er") { erased = []; eraseAt(e); return; }
      var pt = sample(e);
      cur = { id: uid(), doc: V.id, page: n, tool: V.tool, color: (V.tool === "hl" ? HCOLORS : COLORS)[V.ci], w: WIDTHS[V.wi], pts: [pt], gone: false, t: Date.now() };
      redraw(n, cur);
      e.preventDefault();
    });
    ov.addEventListener("pointermove", function (e) {
      if (pan) { V.sc.scrollTop -= e.clientY - pan.y; V.sc.scrollLeft -= e.clientX - pan.x; pan.y = e.clientY; pan.x = e.clientX; return; }
      if (erased) return eraseAt(e);
      if (!cur) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (!evs || !evs.length) evs = [e];
      evs.forEach(function (c) { cur.pts.push(sample(c)); });
      redraw(n, cur);
    });
    var end = function (e) {
      if (pan) { pan = null; return; }
      if (erased) { var ids = erased; erased = null; if (ids.length) { push(V.stack, { t: "del", ids: ids }); syncTb(); saveStack(); } return; }
      if (!cur) return;
      var s = cur; cur = null;
      V.strokes.push(s); push(V.stack, { t: "add", id: s.id }); syncTb();
      redraw(n);
      // Autosave per stroke: the stroke and the stacks are written as it ends.
      put("strokes", s).then(saveStack);
    };
    ov.addEventListener("pointerup", end); ov.addEventListener("pointercancel", end);
    function eraseAt(e) {
      var a = pos(e), W = ov.clientWidth, H = ov.clientHeight, hitAny = false;
      V.strokes.forEach(function (s) {
        if (s.page === n && !s.gone && hit(s, a[0], a[1], 12, W, H)) { s.gone = true; erased.push(s.id); hitAny = true; put("strokes", s); }
      });
      if (hitAny) redraw(n);
    }
  }
  function flipOp(r) {
    var pages = {};
    opIds(r.op).forEach(function (id) { V.strokes.forEach(function (s) { if (s.id === id) { s.gone = r.gone; pages[s.page] = 1; put("strokes", s); } }); });
    Object.keys(pages).forEach(function (n) { redraw(+n); });
    syncTb(); saveStack();
  }

  /* ---- actions ---- */
  function docIdOf(el) { return el.getAttribute("data-id"); }
  function act(a, el, h) {
    host = h;
    if (a === "st-home") return h.push(renderLib);
    if (a === "st-import") return pickPdf();
    if (a === "st-filter") { lib.filter = el.getAttribute("data-v"); return fillLib(); }
    if (a === "st-newfolder") { var nm = G.prompt("Folder name"); if (nm && nm.trim()) put("folders", { id: uid(), name: nm.trim().slice(0, 40) }).then(fillLib); return; }
    if (a === "st-delfolder") {
      if (!G.confirm("Delete this folder? Its PDFs stay in your library.")) return;
      var fid = el.getAttribute("data-v");
      return all("docs").then(function (ds) { return Promise.all(ds.filter(function (d) { return d.folderId === fid; }).map(function (d) { d.folderId = null; return put("docs", d); })); }).then(function () { return del("folders", fid); }).then(function () { lib.filter = "all"; fillLib(); });
    }
    if (a === "st-open") { var id = docIdOf(el); return h.push(function () { renderViewer(id); }); }
    if (a === "st-fav") return get("docs", docIdOf(el)).then(function (d) { d.favourite = !d.favourite; return put("docs", d); }).then(fillLib);
    if (a === "st-rename") return get("docs", docIdOf(el)).then(function (d) { var t = G.prompt("Rename", d.title); if (t && t.trim()) { d.title = t.trim().slice(0, 120); return put("docs", d).then(fillLib); } });
    if (a === "st-delete") { if (G.confirm("Delete this PDF and your pen strokes on it? This cannot be undone.")) removeDoc(docIdOf(el)).then(fillLib); return; }
    if (!V) return;
    if (a === "st-tool") { var t = el.getAttribute("data-v"); V.tool = V.tool === t ? null : t; return syncTb(); }
    if (a === "st-color") { V.ci = +el.getAttribute("data-v"); if (!V.tool) V.tool = "pen"; return syncTb(); }
    if (a === "st-width") { V.wi = +el.getAttribute("data-v"); if (!V.tool) V.tool = "pen"; return syncTb(); }
    if (a === "st-undo") { var u = undo(V.stack); return u && flipOp(u); }
    if (a === "st-redo") { var r = redo(V.stack); return r && flipOp(r); }
    if (a === "st-go") { var inp = h.root().querySelector("#stPage"), n = Math.max(1, Math.min(V.n, parseInt(inp && inp.value, 10) || 1)); V.sc.scrollTop = V.pg[n].el.offsetTop; return; }
    if (a === "st-zoom") return setZoom(V.z * (el.getAttribute("data-v") === "+" ? 1.25 : 0.8));
  }
  function back() { return false; }
  function leave() { closeViewer(); }

  // The row on the PrepNucleus home: only with the flag on.
  function homeRow(h) {
    host = h;
    return on() ? h.row("st-home", h.ico("deck"), "Study Studio", "Read and write on your own PDFs") : "";
  }

  G.STUDY = { on: on, act: act, back: back, leave: leave, homeRow: homeRow, _pure: PURE, _state: function () { return V; } };
})(typeof window !== "undefined" ? window : this);
