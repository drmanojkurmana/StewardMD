/* Study Studio Phase 5a: library grid, folders, sort/view, trash, bottom tabs, document tabs, export.
   ES5 IIFE, window.STUDY_LIB. Loaded AFTER study.js from prep-loader.js. Reuses the same IndexedDB "study"
   (docs, files, folders, strokes, undo, ptext, index) so backup/restore covers folders and trash without a new store.
   GoodNotes layout, PrepNucleus skin (#071318 / #0D1D23 / #42CDB5): grid with folder + notebook cards, real covers,
   date edited, star, + New tile, Date/Name/Type chips + grid/list toggle, collapsible Documents title, bottom bar.
   Contract: never hard-delete ink; delete goes to Trash (trashedAt) with 30-day purge. ES5 only. */
(function (G) {
  "use strict";
  /* ================= pure ================= */
  function isTrashed(d) { return !!(d && d.trashedAt); }
  function daysOld(ts, now) { now = now || Date.now(); return (now - (ts || now)) / 86400000; }
  function shouldPurge(d, now) { return !!(d && d.trashedAt && daysOld(d.trashedAt, now) > 30); }
  function sortDocs(items, sortBy) {
    var arr = (items || []).slice();
    if (sortBy === "name") {
      arr.sort(function (a, b) {
        var ta = String(a.title || a.name || ""), tb = String(b.title || b.name || "");
        var cmp = ta.toLowerCase() < tb.toLowerCase() ? -1 : ta.toLowerCase() > tb.toLowerCase() ? 1 : 0;
        if (cmp !== 0) return cmp;
        return (b.lastOpened || b.created || 0) - (a.lastOpened || a.created || 0);
      });
    } else if (sortBy === "type") {
      var typeOrder = function (x) {
        if (x.type === "folder") return 0;
        if (x.kind === "nb") return 1;
        return 2;
      };
      arr.sort(function (a, b) {
        var oa = typeOrder(a), ob = typeOrder(b);
        if (oa !== ob) return oa - ob;
        var ta = String(a.title || a.name || "");
        var tb = String(b.title || b.name || "");
        var cmp = ta.toLowerCase() < tb.toLowerCase() ? -1 : ta.toLowerCase() > tb.toLowerCase() ? 1 : 0;
        if (cmp !== 0) return cmp;
        return (b.lastOpened || b.created || 0) - (a.lastOpened || a.created || 0);
      });
    } else {
      arr.sort(function (a, b) { return (b.lastOpened || b.created || 0) - (a.lastOpened || a.created || 0); });
    }
    return arr;
  }
  function dupTitle(t) { var s = String(t || "Untitled").slice(0, 110); return s ? (s + " copy").slice(0, 120) : "Untitled"; }
  function fmtWhen(ts) {
    if (!ts) return "";
    var d = new Date(ts), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var yesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
    var hh = String(d.getHours()).padStart ? String(d.getHours()).padStart(2, "0") : ("0" + d.getHours()).slice(-2);
    var mm = String(d.getMinutes()).padStart ? String(d.getMinutes()).padStart(2, "0") : ("0" + d.getMinutes()).slice(-2);
    var time = hh + ":" + mm;
    var date4 = d.getDate() + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()] + " " + d.getFullYear();
    if (sameDay) return "Today " + time;
    if (yesterday) return "Yesterday " + time;
    if (now.getFullYear() === d.getFullYear()) return d.getDate() + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()] + " " + time;
    return date4;
  }
  function loadPref(k, def) { try { var v = G.localStorage.getItem(k); return v == null ? def : v; } catch (e) { return def; } }
  function savePref(k, v) { try { G.localStorage.setItem(k, v); } catch (e) {} }
  function parseTabs(raw) { try { var a = JSON.parse(raw || "[]"); return Array.isArray(a) ? a.filter(function (x) { return typeof x === "string" && x; }).slice(0, 12) : []; } catch (e) { return []; } }
  // Cover regen predicate (pure): regen only when there is no cover yet or it was marked dirty.
  function needsCoverRegen(doc) { return !!(doc && (!doc.thumb || doc._thumbDirty)); }
  // Bounded tab-restore retry (pure): at most 25 polls of 120ms (~3s); the old code polled forever.
  function shouldRetryTabRestore(tries) { var t = +tries; if (!(t >= 0)) t = 0; return t < 25; }
  var PURE = { isTrashed: isTrashed, daysOld: daysOld, shouldPurge: shouldPurge, sortDocs: sortDocs, dupTitle: dupTitle, fmtWhen: fmtWhen, loadPref: loadPref, savePref: savePref, parseTabs: parseTabs, needsCoverRegen: needsCoverRegen, shouldRetryTabRestore: shouldRetryTabRestore };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }
  // Early return when this runs in browser but study.js missing (flag off): nothing to patch.
  // Browser continues below; if G.STUDY is not yet defined we wait for study.js (loader order guarantees it).
  var D = G.document;
  var LIB_ICO = {
    folder: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    folderStar: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="#e5484d" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" fill="none"/><polygon points="12 8 13.7 11.5 17.5 12 14.8 14.6 15.4 18.4 12 16.5 8.6 18.4 9.2 14.6 6.5 12 10.3 11.5" fill="#e5484d" stroke="#e5484d"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    list: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    book: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    move: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14M5 12h14M5 16h6"/><path d="M18 14l3 3-3 3"/></svg>',
    cover: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    docsIc: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
    favIc: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    palette: '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.4-.4-.8-.4-1.3 0-1.1.9-2 2-2h2.3c3.9 0 7-3.1 7-7 0-5.5-5.4-9.1-10-9.1z"/></svg>'
  };
  var FOLDER_COLORS = ["#42CDB5", "#60A5FA", "#F5854A", "#A78BFA", "#34D399", "#F87171", "#FBBF24", "#94A3B8"];
  var uidN = 0;
  function uid() { return Date.now().toString(36) + (++uidN).toString(36) + Math.random().toString(36).slice(2, 7); }
  var host = null;
  var libState = { view: loadPref("smd_study_lib_view", "grid"), sort: loadPref("smd_study_lib_sort", "date"), tab: loadPref("smd_study_lib_tab", "documents"), currentFolderId: null };
  if (libState.view !== "grid" && libState.view !== "list") libState.view = "grid";
  if (libState.sort !== "date" && libState.sort !== "name" && libState.sort !== "type") libState.sort = "date";
  if (libState.tab !== "documents" && libState.tab !== "search" && libState.tab !== "favorites" && libState.tab !== "trash") libState.tab = "documents";
  /* IndexedDB (same store as study.js).
     Phase 5a hang fix: the library MUST reuse study.js's connection (STUDY.db) and never hold
     a second one. Two open connections to "study" wedged a later indexedDB.open("study") in a
     real browser (the library froze after import), so db() below delegates to STUDY.db().
     The fallback open exists only if STUDY is not ready yet (loader order); it handles
     onblocked/onerror with bounded retries and never loops. */
  var dbP = null, dbTries = 0;
  function sharedDb() {
    try { var S = G.STUDY; if (S && typeof S.db === "function") return S.db(); } catch (e) {}
    return null;
  }
  function ensureStores(d) {
    if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs", { keyPath: "id" });
    if (!d.objectStoreNames.contains("files")) d.createObjectStore("files", { keyPath: "id" });
    if (!d.objectStoreNames.contains("folders")) d.createObjectStore("folders", { keyPath: "id" });
    if (!d.objectStoreNames.contains("strokes")) { var s = d.createObjectStore("strokes", { keyPath: "id" }); s.createIndex("doc", "doc"); }
    if (!d.objectStoreNames.contains("undo")) d.createObjectStore("undo", { keyPath: "doc" });
    if (!d.objectStoreNames.contains("ptext")) { var p = d.createObjectStore("ptext", { keyPath: "id" }); p.createIndex("doc", "doc"); }
    if (!d.objectStoreNames.contains("index")) d.createObjectStore("index", { keyPath: "doc" });
  }
  function db() {
    var shared = sharedDb();
    if (shared) return shared;
    if (dbP) return dbP;
    if (dbTries >= 5) return Promise.reject(new Error("study-db-blocked"));
    var tries = ++dbTries;
    dbP = new Promise(function (res, rej) {
      var r;
      try { r = G.indexedDB.open("study", 2); }
      catch (e) { dbP = null; rej(e); return; }
      r.onupgradeneeded = function () { try { ensureStores(r.result); } catch (e) {} };
      r.onsuccess = function () {
        var conn = r.result;
        try { conn.onversionchange = function () { dbP = null; try { conn.close(); } catch (e) {} }; } catch (e) {}
        res(conn);
      };
      r.onblocked = function () { /* another connection holds the upgrade; retry a few times, never forever */
        dbP = null;
        if (tries >= 5) return rej(new Error("study-db-blocked"));
        G.setTimeout(function () { db().then(res, rej); }, 250 * tries);
      };
      r.onerror = function () { dbP = null; rej(r.error || new Error("study-db-open")); };
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
  var textOf = function (id) { return q("ptext", "readonly", function (o) { return o.index("doc").getAll(G.IDBKeyRange.only(id)); }); };
  function esc(s) { if (host && host.esc) return host.esc(s); s = String(s == null ? "" : s); return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function getHost() { try { if (G.PREP && G.PREP._host) return G.PREP._host; } catch (e) {} return host; }
  // ---- trash auto-purge on load (30 days) ----
  function purgeExpiredTrash() {
    var cutoff = Date.now() - 30 * 86400000;
    return Promise.all([idbAll("docs"), idbAll("folders")]).then(function (r) {
      var docs = r[0], folders = r[1], i, d;
      var toPurge = [];
      for (i = 0; i < docs.length; i++) { d = docs[i]; if (d.trashedAt && d.trashedAt < cutoff) toPurge.push(d); }
      if (!toPurge.length) return null;
      return toPurge.reduce(function (p, doc) {
        return p.then(function () {
          return strokesOf(doc.id).then(function (ss) { return Promise.all(ss.map(function (s) { return idbDel("strokes", s.id); })); })
            .then(function () { return textOf(doc.id).then(function (rows) { return Promise.all(rows.map(function (x) { return idbDel("ptext", x.id); })); }); })
            .then(function () { return Promise.all([idbDel("undo", doc.id), idbDel("files", doc.id), idbDel("docs", doc.id), idbDel("index", doc.id)]); });
        });
      }, Promise.resolve());
    }).then(null, function () {});
  }
  // ---- bulk cover rendering ----
  var coverBusy = {};
  function renderCoverForDoc(doc, onDone) {
    var done = function () { coverBusy[doc.id] = false; if (onDone) onDone(); };
    if (!needsCoverRegen(doc)) return done();
    if (coverBusy[doc.id]) return done();
    coverBusy[doc.id] = true;
    // For notebooks we can regenerate quickly from strokes; for PDFs we need pdf.js
    if (doc.kind === "nb") {
      strokesOf(doc.id).then(function (ss) {
        var c = D.createElement("canvas"); c.width = 160; c.height = Math.round(160 * (doc.ratio || 1.414));
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        // draw ruled/grid background lite
        if (doc.style && doc.style !== "blank") {
          ctx.strokeStyle = "#dce4f0"; ctx.lineWidth = 1;
          ctx.beginPath();
          var step = 8, h = c.height;
          for (var y = step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(c.width, y); }
          if (doc.style === "grid" || doc.style === "dotgrid") for (var x = step; x < c.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
          ctx.stroke();
        }
        // draw strokes
        var live = ss.filter(function (s) { return !s.gone && s.page === (doc.ord && doc.ord[0] ? doc.ord[0] : 1); });
        var W = c.width, H = c.height;
        live.forEach(function (s) {
          ctx.strokeStyle = s.color || "#111"; ctx.lineWidth = (s.w || 0.003) * W * 1.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
          ctx.beginPath();
          var pts = s.pts || [];
          for (var i = 0; i < pts.length; i++) { var px = pts[i][0] * W, py = pts[i][1] * H; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
          ctx.stroke();
        });
        doc.thumb = c.toDataURL("image/jpeg", 0.72);
        doc._thumbDirty = false;
        idbPut("docs", doc).then(done, done);
      }).then(null, done);
      return;
    }
    // PDF: load original and render page 1
    if (G.pdfjsLib || true) {
      loadOriginalBytes(doc).then(function (bytes) {
        return pdfjsLib().then(function (L) { return L.getDocument({ data: bytes.slice() }).promise; }).then(function (pdf) {
          return pdf.getPage(1).then(function (p) {
            var v0 = p.getViewport({ scale: 1 }), sc = 160 / v0.width, vp = p.getViewport({ scale: sc });
            var c = D.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
            var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
            return p.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
              // overlay ink on page 1
              return strokesOf(doc.id).then(function (ss) {
                var W = c.width, H = c.height;
                ss.filter(function (s) { return !s.gone && s.page === 1; }).forEach(function (s) {
                  ctx.strokeStyle = s.color || "#111"; ctx.lineWidth = (s.w || 0.003) * W * 1.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
                  var pts = s.pts || [];
                  for (var i = 0; i < pts.length; i++) { var px = pts[i][0] * W, py = pts[i][1] * H; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
                  ctx.stroke();
                });
                doc.thumb = c.toDataURL("image/jpeg", 0.7);
                doc._thumbDirty = false;
                try { pdf.destroy(); } catch (e) {}
                idbPut("docs", doc).then(done, done);
              });
            });
          });
        });
      }).then(null, done);
    } else done();
  }
  function loadOriginalBytes(doc) {
    if (doc.store === "fs") {
      try {
        var fs = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.Filesystem;
        if (fs) return fs.readFile({ path: "study/" + doc.id + ".pdf", directory: "DATA" }).then(function (r) {
          var bin = atob(r.data), n = bin.length, a = new Uint8Array(n), i;
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
  // ---- jspdf loader ----
  var jspP = null;
  function jspdf() {
    var J = (G.jspdf && G.jspdf.jsPDF) || G.jsPDF;
    if (J) return Promise.resolve(J);
    if (jspP) return jspP;
    jspP = new Promise(function (res, rej) {
      var s = D.createElement("script"); s.src = "/vendor-jspdf.js?v=1";
      s.onload = function () { var K = (G.jspdf && G.jspdf.jsPDF) || G.jsPDF; if (K) res(K); else { jspP = null; rej(new Error("jspdf")); } };
      s.onerror = function () { jspP = null; rej(new Error("jspdf")); };
      D.head.appendChild(s);
    });
    return jspP;
  }
  function b64(bytes) { var s = "", i, n = bytes.length; for (i = 0; i < n; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return G.btoa(s); }
  function saveBlob(blob, name) { var a = D.createElement("a"), u = G.URL.createObjectURL(blob); a.href = u; a.download = name; D.body.appendChild(a); a.click(); D.body.removeChild(a); G.setTimeout(function () { G.URL.revokeObjectURL(u); }, 40000); }
  function safeName(t) { return String(t || "").replace(/[\u0000-\u001f\\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Study"; }
  function fsPlugin() { try { var P = G.Capacitor && G.Capacitor.Plugins; return P && P.Filesystem && P.Filesystem.writeFile ? P.Filesystem : null; } catch (e) { return null; } }
  function shareReady() { try { var N = G.SMD_NATIVE; return G.SMD_IS_NATIVE && fsPlugin() && N && N.share ? N : null; } catch (e) { return null; } }
  function shareFile(name, bytes, mime) {
    var N = shareReady(), fs = fsPlugin();
    if (!N || !fs) { saveBlob(new Blob([bytes], { type: mime }), name); return Promise.resolve(); }
    return fs.writeFile({ path: "study-out/" + name, data: b64(bytes), directory: "CACHE", recursive: true }).then(function (r) { return N.share({ title: name, files: [r.uri], dialogTitle: "Share or print" }); }).then(null, function (e) { if (!/cancel/i.test(String(e && (e.message || e)))) try { host.toast("Sharing did not work. Try again."); } catch (x) {} });
  }
  // ---- export helpers ----
  function drawBgForExport(ctx, style, ratio, W) {
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, W * ratio);
    if (style === "blank") return;
    ctx.strokeStyle = "#b8c4d6"; ctx.lineWidth = Math.max(1, W / 400);
    var s = 0.05, end = style === "cornell" ? ratio * 0.8 : ratio;
    ctx.beginPath();
    if (style === "ruled" || style === "cornell") { for (var y = s * 2; y < end; y += s) { ctx.moveTo(0, y * W); ctx.lineTo(W, y * W); } }
    if (style === "grid") { for (y = s; y < ratio; y += s) { ctx.moveTo(0, y * W); ctx.lineTo(W, y * W); } for (var x = s; x < 1; x += s) { ctx.moveTo(x * W, 0); ctx.lineTo(x * W, ratio * W); } }
    if (style === "dotgrid" || style === "dots") { ctx.fillStyle = "#9fb0c3"; for (y = s * 2; y < ratio; y += s) for (x = s; x < 1; x += s) ctx.fillRect(x * W - 0.5, y * W - 0.5, 1, 1); }
    if (style === "cornell") { ctx.moveTo(0.3 * W, s * 2 * W); ctx.lineTo(0.3 * W, end * W); ctx.moveTo(0, end * W); ctx.lineTo(W, end * W); }
    ctx.stroke();
  }
  function drawStrokeForExport(ctx, s, W, H) {
    var p = s.pts, i;
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = s.color || "#111";
    if (s.tool === "hl") { ctx.globalAlpha = 0.35; ctx.lineWidth = (s.w || 0.003) * W * 6; ctx.beginPath(); for (i = 0; i < p.length; i++) { if (i) ctx.lineTo(p[i][0] * W, p[i][1] * H); else ctx.moveTo(p[i][0] * W, p[i][1] * H); } if (p.length === 1) ctx.lineTo(p[0][0] * W + 0.01, p[0][1] * H); ctx.stroke(); }
    else { for (i = p.length > 1 ? 1 : 0; i < p.length; i++) { var a = p[i ? i - 1 : 0]; ctx.lineWidth = (s.w || 0.003) * W * (0.5 + p[i][2]); ctx.beginPath(); ctx.moveTo(a[0] * W, a[1] * H); ctx.lineTo(p[i][0] * W + (p.length === 1 ? 0.01 : 0), p[i][1] * H); ctx.stroke(); } }
    ctx.restore();
  }
  function exportAllPages(docId, onlyPage) {
    var h = getHost();
    if (h && h.toast) h.toast("Preparing PDF...");
    return jspdf().then(function (J) {
      return idbGet("docs", docId).then(function (doc) {
        if (!doc) throw new Error("not found");
        return strokesOf(docId).then(function (strokes) {
          var live = strokes.filter(function (s) { return !s.gone; });
          var pages = [];
          if (doc.kind === "nb") { var ord = doc.ord || []; pages = ord.map(function (pid, idx) { return { num: idx + 1, pid: pid }; }); if (onlyPage != null) pages = pages.filter(function (p) { return p.num === onlyPage; }); }
          else { var n = doc.pageCount || 1; for (var i = 1; i <= n; i++) pages.push({ num: i, pid: i }); if (onlyPage != null) pages = pages.filter(function (p) { return p.num === onlyPage; }); }
          var pdfBytes = null;
          var pdfObj = null;
          function loadPdf() {
            if (doc.kind === "nb") return Promise.resolve(null);
            return loadOriginalBytes(doc).then(function (bytes) { return pdfjsLib().then(function (L) { return L.getDocument({ data: bytes.slice() }).promise; }); });
          }
          return loadPdf().then(function (pdf) {
            pdfObj = pdf;
            var outDoc = null;
            function next(idx) {
              if (idx >= pages.length) {
                if (!outDoc) throw new Error("no pages");
                var name = safeName(doc.title) + (onlyPage ? " - page " + onlyPage : "") + ".pdf";
                return shareFile(name, new Uint8Array(outDoc.output("arraybuffer")), "application/pdf").then(function () { try { if (pdfObj) pdfObj.destroy(); } catch (e) {} });
              }
              var pg = pages[idx], pgNum = pg.num, pgPid = pg.pid;
              function renderPageCanvas(pageObj, ratioHint) {
                var v1 = pageObj ? pageObj.getViewport({ scale: 1 }) : { width: 595.28, height: 595.28 * (doc.ratio || 1.414) };
                var sc = Math.min(3, 1600 / v1.width), cw = Math.floor(v1.width * sc), ch = Math.floor(v1.height * sc), c = D.createElement("canvas"), x = c.getContext("2d");
                c.width = cw; c.height = ch; x.fillStyle = "#fff"; x.fillRect(0, 0, cw, ch);
                var after = function () {
                  live.forEach(function (s) { if (s.page === pgPid || (doc.kind !== "nb" && s.page === pgNum)) drawStrokeForExport(x, s, cw, ch); });
                  var o = v1.height >= v1.width ? "p" : "l";
                  if (!outDoc) outDoc = new J({ unit: "pt", format: [v1.width, v1.height], orientation: o, compress: true }); else outDoc.addPage([v1.width, v1.height], o);
                  outDoc.addImage(c.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, v1.width, v1.height);
                  c.width = 0;
                  try { if (pageObj) pageObj.cleanup(); } catch (e) {}
                  return next(idx + 1);
                };
                if (pageObj) { return pageObj.render({ canvasContext: x, viewport: pageObj.getViewport({ scale: sc }) }).promise.then(after); }
                drawBgForExport(x, doc.style || "blank", doc.ratio || 1.414, cw);
                return after();
              }
              if (pdfObj) return pdfObj.getPage(pgNum).then(function (p) { return renderPageCanvas(p); });
              return renderPageCanvas(null);
            }
            return next(0);
          });
        });
      });
    }).then(null, function () { try { getHost().toast("The PDF could not be made."); } catch (e) {} });
  }
  function exportThisPage(docId) {
    var st = G.STUDY && G.STUDY._state && G.STUDY._state();
    var cur = (st && st.cur) || 1;
    return exportAllPages(docId, cur);
  }
  function exportOriginal(docId) {
    return idbGet("docs", docId).then(function (doc) {
      if (!doc || doc.kind === "nb") { try { getHost().toast("Original only for PDFs."); } catch (e) {} return; }
      return loadOriginalBytes(doc).then(function (bytes) { return shareFile(safeName(doc.title) + ".pdf", bytes, "application/pdf"); });
    });
  }
  // ---- document tabs state ----
  var TABS_KEY = "smd_study_openTabs", TABSTATE_KEY = "smd_study_tabState";
  function getTabs() { try { return parseTabs(G.localStorage.getItem(TABS_KEY)); } catch (e) { return []; } }
  function setTabs(arr) { try { G.localStorage.setItem(TABS_KEY, JSON.stringify(arr.slice(0, 12))); } catch (e) {} }
  function getTabState() { try { var o = JSON.parse(G.localStorage.getItem(TABSTATE_KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function setTabState(id, st) { var all = getTabState(); all[id] = st; try { G.localStorage.setItem(TABSTATE_KEY, JSON.stringify(all)); } catch (e) {} }
  function addTab(docId) {
    var tabs = getTabs();
    if (tabs.indexOf(docId) === -1) tabs.push(docId);
    if (tabs.length > 12) tabs = tabs.slice(-12);
    setTabs(tabs);
    renderDocTabs();
  }
  function removeTab(docId) {
    var tabs = getTabs().filter(function (x) { return x !== docId; });
    setTabs(tabs);
    var st = getTabState(); delete st[docId]; try { G.localStorage.setItem(TABSTATE_KEY, JSON.stringify(st)); } catch (e) {}
    renderDocTabs();
    // if we closed the current one and there are tabs left, switch to last
    var curState = G.STUDY && G.STUDY._state && G.STUDY._state();
    var curId = curState && curState.id;
    if (curId === docId && tabs.length) {
      var h = getHost();
      if (h && h.push) h.push(function () { openDocById(tabs[tabs.length - 1], null); });
    }
  }
  function captureCurrentTab() {
    var st = G.STUDY && G.STUDY._state && G.STUDY._state();
    if (!st || !st.id) return;
    var sc = st.sc, tool = st.tool, ci = st.ci, wi = st.wi, cur = st.cur || 1, scrollTop = sc ? sc.scrollTop : 0, scrollLeft = sc ? sc.scrollLeft : 0, z = st.z || 1;
    setTabState(st.id, { tool: tool, ci: ci, wi: wi, cur: cur, scrollTop: scrollTop, scrollLeft: scrollLeft, z: z });
  }
  var origAct = null;
  function openDocById(id, page) {
    captureCurrentTab();
    var h = getHost();
    if (!h) return;
    addTab(id);
    // delegate to STUDY's original open (it pushes the viewer itself)
    try { origAct("st-open", { getAttribute: function (n) { return n === "data-id" ? id : null; } }, h); } catch (e) {}
    G.setTimeout(function () { injectDocTabs(); restoreTabState(id, page); }, 80);
  }
  function restoreTabState(id, page, tries) {
    var saved = getTabState()[id];
    var st = G.STUDY && G.STUDY._state && G.STUDY._state();
    // if nothing open yet, retry a bounded number of times (the old code retried forever)
    tries = tries || 0;
    if (!st || st.id !== id) {
      if (shouldRetryTabRestore(tries)) G.setTimeout(function () { restoreTabState(id, page, tries + 1); }, 120);
      return;
    }
    if (page && st.pg && st.pg[page]) { try { st.sc.scrollTop = st.pg[page].el.offsetTop; if (st.cur !== undefined) st.cur = page; } catch (e) {} }
    if (saved) {
      try {
        if (saved.tool) { st.tool = saved.tool; st.ci = saved.ci; st.wi = saved.wi; }
        if (saved.scrollTop != null && st.sc) { st.sc.scrollTop = saved.scrollTop; st.sc.scrollLeft = saved.scrollLeft || 0; }
        if (saved.z && saved.z !== st.z) { /* use study.js setZoom via internal? we set directly and sync */ st.z = saved.z; /* trigger re-render of pages */ try { G.setTimeout(function () { var s2 = G.STUDY && G.STUDY._state && G.STUDY._state(); if (s2 && s2.sc) { /* re-render visible pages large */ } }, 100); } catch (e) {} }
        // sync toolbar
        try { var tb = G.STUDY && G.STUDY._state && G.STUDY._state(); /* syncTb is internal, but calling act tool with same tool will re-sync */ } catch (e) {}
      } catch (e) {}
    }
    injectDocTabs();
    // ensure tool toolbar reflects restored tool via study.js syncTb helper exposed via _state box class toggle
    try { var root = hRoot(); if (root) { var box = root.querySelector("#stPages"); if (box && st.tool) box.classList.add("st-ink"); } } catch (e) {}
  }
  function hRoot() { try { var h = getHost(); return h && h.root && h.root(); } catch (e) { return null; } }
  function injectDocTabs() {
    var root = hRoot(); if (!root) return;
    var body = root.querySelector(".pn-body.st-body");
    if (!body) return;
    var old = body.querySelector("#stDocTabs");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var tabs = getTabs();
    if (!tabs.length) return;
    var curState = G.STUDY && G.STUDY._state && G.STUDY._state();
    var curId = curState && curState.id;
    var curIdx = tabs.indexOf(curId);
    // need titles for tabs; load async then render
    idbAll("docs").then(function (docs) {
      var by = {}; docs.forEach(function (d) { by[d.id] = d; });
      var tabsEl = D.createElement("div");
      tabsEl.id = "stDocTabs";
      tabsEl.className = "st-doc-tabs";
      tabsEl.setAttribute("role", "tablist");
      tabsEl.setAttribute("aria-label", "Open documents");
      var html = "";
      tabs.forEach(function (tid, i) {
        var d = by[tid]; if (!d) return;
        var title = esc(d.title || "Untitled");
        var isCur = tid === curId;
        html += '<div class="st-dt' + (isCur ? " on" : "") + '" role="tab" aria-selected="' + (isCur ? "true" : "false") + '">' +
          '<button type="button" class="st-dt-open" data-act="st-dt-open" data-id="' + tid + '" aria-label="Open ' + esc(d.title || "") + '">' + title + '</button>' +
          '<button type="button" class="st-dt-x" data-act="st-dt-close" data-id="' + tid + '" aria-label="Close ' + esc(d.title || "") + '">' + LIB_ICO.x + '</button>' +
        '</div>';
      });
      tabsEl.innerHTML = html;
      // insert after #stTb if exists else first
      var tb = body.querySelector("#stTb");
      if (tb && tb.parentNode === body) body.insertBefore(tabsEl, tb.nextSibling);
      else if (body.firstChild) body.insertBefore(tabsEl, body.firstChild);
      else body.appendChild(tabsEl);
    });
  }
  function renderDocTabs() { injectDocTabs(); }
  // ---- folder helpers ----
  function folderById(all, id) { for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }
  function breadcrumbFor(folderId, all) {
    var chain = [], cur = folderId, seen = {}, depth = 0;
    while (cur && depth < 20 && !seen[cur]) {
      var f = folderById(all, cur);
      if (!f) break;
      chain.unshift(f);
      cur = f.parentId || null;
      seen[cur] = 1; depth++;
    }
    return chain;
  }
  // ---- library rendering ----
  function hBar(title, sub) {
    var h = getHost();
    if (h && h.bar) return h.bar(title, sub, "back");
    return '<header class="pn-bar"><button type="button" class="pn-ib" data-act="back" aria-label="Back">' + '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>' + '</button><div class="pn-t"><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div><span class="pn-ib-sp"></span></header>';
  }
  function currentFolderCrumbHtml(folders) {
    if (!libState.currentFolderId) return '<button type="button" class="st-bc cur" data-act="st5a-crumb" data-id="">Documents</button>';
    var chain = breadcrumbFor(libState.currentFolderId, folders);
    var html = '<button type="button" class="st-bc" data-act="st5a-crumb" data-id="">Documents</button>';
    chain.forEach(function (f) {
      html += '<span class="st-bc-sep">›</span><button type="button" class="st-bc' + (f.id === libState.currentFolderId ? " cur" : "") + '" data-act="st5a-crumb" data-id="' + f.id + '">' + esc(f.name) + '</button>';
    });
    return html;
  }
  function folderCardHtml(f) {
    var col = f.colour || "#42CDB5";
    var star = f.favourite ? '<span class="st-folder-star" title="Favourite">' + LIB_ICO.starFill + '</span>' : "";
    var icon = f.favourite ? LIB_ICO.folderStar : LIB_ICO.folder;
    return '<div class="st5a-card st5a-folder" data-folder="' + f.id + '" draggable="false">' +
      '<div class="st5a-cover st5a-cover-folder" style="--fc:' + col + '" data-act="st5a-open-folder" data-id="' + f.id + '" role="button" tabindex="0" aria-label="Open folder ' + esc(f.name) + '">' +
        '<div class="st5a-folder-ic" style="color:' + col + '">' + icon + '</div>' +
        star +
      '</div>' +
      '<div class="st5a-name">' +
        '<button type="button" class="st5a-title" data-act="st5a-open-folder" data-id="' + f.id + '"><span class="st5a-title-t">' + esc(f.name) + '</span></button>' +
        '<small class="st5a-meta">' + esc(fmtWhen(f.mtime || f.created || Date.now())) + '</small>' +
      '</div>' +
      '<div class="st5a-card-actions">' +
        '<button type="button" class="st5a-icon-btn' + (f.favourite ? " on" : "") + '" data-act="st5a-fav-folder" data-id="' + f.id + '" aria-pressed="' + !!f.favourite + '" aria-label="' + (f.favourite ? "Unstar folder" : "Star folder") + '">' + (f.favourite ? LIB_ICO.starFill : LIB_ICO.star) + '</button>' +
        '<button type="button" class="st5a-icon-btn" data-act="st5a-folder-menu" data-id="' + f.id + '" aria-label="Folder options">' + LIB_ICO.more + '</button>' +
      '</div>' +
    '</div>';
  }
  var _ixd = {};
  function docCardHtml(d, folders) {
    var isNb = d.kind === "nb";
    var when = d.lastOpened || d.created || Date.now();
    var folderName = "";
    if (d.folderId) { var f = folderById(folders, d.folderId); if (f) folderName = f.name; }
    var fav = d.favourite ? LIB_ICO.starFill : LIB_ICO.star;
    var meta = "";
    if (isNb) meta = "Notebook, " + d.pageCount + (d.pageCount === 1 ? " page" : " pages");
    else meta = d.pageCount + (d.pageCount === 1 ? " page" : " pages");
    if (folderName) meta += " · " + folderName;
    var thumb = d.thumb ? '<img class="st5a-th st-th" alt="" src="' + d.thumb + '" width="160" height="226" loading="lazy">' : '<div class="st5a-th-ph">' + (isNb ? LIB_ICO.book : LIB_ICO.pdf) + '</div>';
    return '<div class="st5a-card st-doc" data-id="' + d.id + '" draggable="true">' +
      '<div class="st5a-cover st-open" data-act="st5a-open" data-id="' + d.id + '" role="button" tabindex="0" aria-label="Open ' + esc(d.title) + '">' +
        thumb +
        '<span class="st5a-kind-badge">' + (isNb ? "NB" : "PDF") + '</span>' +
      '</div>' +
      '<div class="st5a-name">' +
        '<button type="button" class="st5a-title" data-act="st5a-open" data-id="' + d.id + '"><span class="st5a-title-t">' + esc(d.title) + '</span> ' + LIB_ICO.chev + '</button>' +
        '<small class="st5a-meta">' + esc(meta) + ' · ' + esc(fmtWhen(when)) + '</small>' + (isNb ? '' : '<small class="st-ix" data-ix="' + d.id + '">' + esc(ixLabel5a(_ixd[d.id] || 0, d.pageCount)) + '</small>') +
      '</div>' +
      '<div class="st5a-card-actions">' +
        '<button type="button" class="st5a-icon-btn' + (d.favourite ? " on" : "") + '" data-act="st5a-fav" data-id="' + d.id + '" aria-pressed="' + !!d.favourite + '" aria-label="' + (d.favourite ? "Remove favourite" : "Add to favourites") + '">' + fav + '</button>' +
        '<button type="button" class="st5a-icon-btn" data-act="st5a-doc-menu" data-id="' + d.id + '" aria-label="More actions for ' + esc(d.title) + '">' + LIB_ICO.more + '</button>' +
      '</div>' +
    '</div>';
  }
  function listRowHtml(d, folders) {
    var isNb = d.kind === "nb";
    var when = d.lastOpened || d.created || Date.now();
    var folderName = ""; if (d.folderId) { var f = folderById(folders, d.folderId); if (f) folderName = f.name; }
    var meta = (isNb ? "Notebook" : "PDF") + " · " + d.pageCount + (d.pageCount === 1 ? " page" : " pages") + (folderName ? " · " + folderName : "");
    var thumb = d.thumb ? '<img class="st5a-list-th" alt="" src="' + d.thumb + '" loading="lazy">' : '<div class="st5a-list-th-ph">' + (isNb ? LIB_ICO.book : LIB_ICO.pdf) + '</div>';
    return '<div class="st5a-list-row" data-id="' + d.id + '" draggable="true">' +
      '<button type="button" class="st5a-list-open" data-act="st5a-open" data-id="' + d.id + '">' + thumb +
        '<span class="st5a-list-tt"><b>' + esc(d.title) + '</b><small>' + esc(meta) + ' · ' + esc(fmtWhen(when)) + '</small></span>' +
      '</button>' +
      '<button type="button" class="st5a-icon-btn' + (d.favourite ? " on" : "") + '" data-act="st5a-fav" data-id="' + d.id + '" aria-label="Star">' + (d.favourite ? LIB_ICO.starFill : LIB_ICO.star) + '</button>' +
      '<button type="button" class="st5a-icon-btn" data-act="st5a-doc-menu" data-id="' + d.id + '">' + LIB_ICO.more + '</button>' +
    '</div>';
  }
  function newTileHtml() {
    return '<div class="st5a-card st5a-new" data-act="st5a-new" role="button" tabindex="0" aria-label="Create new notebook or import">' +
      '<div class="st5a-cover st5a-cover-new"><span class="st5a-new-plus">' + LIB_ICO.plus + '</span></div>' +
      '<div class="st5a-name"><span class="st5a-title"><span class="st5a-title-t">New</span></span><small class="st5a-meta">Notebook or import</small></div>' +
    '</div>';
  }
  function sortChipsHtml() {
    var s = libState.sort;
    function chip(v, label) { return '<button type="button" class="st5a-chip' + (s === v ? " on" : "") + '" data-act="st5a-sort" data-v="' + v + '">' + label + '</button>'; }
    var viewIc = libState.view === "grid" ? LIB_ICO.grid : LIB_ICO.list;
    var nextView = libState.view === "grid" ? "list" : "grid";
    return '<div class="st5a-sort-row" role="group" aria-label="Sort and view">' +
      chip("date", "Date") + chip("name", "Name") + chip("type", "Type") +
      '<button type="button" class="st5a-view-btn" data-act="st5a-view" data-v="' + nextView + '" aria-label="Show ' + (nextView === "grid" ? "grid" : "list") + ' view">' + viewIc + '</button>' +
      '<button type="button" class="st5a-chip st5a-trash-chip" data-act="st5a-tab" data-v="trash">' + LIB_ICO.trash + ' Trash</button>' +
    '</div>';
  }
  function bottomBarHtml() {
    function t(v, ic, label) { return '<button type="button" class="st5a-tab' + (libState.tab === v ? " on" : "") + '" data-act="st5a-tab" data-v="' + v + '" aria-pressed="' + (libState.tab === v) + '"><span class="st5a-tab-ic">' + ic + '</span><span class="st5a-tab-l">' + label + '</span></button>'; }
    return '<nav class="st5a-bottom" aria-label="Study library">' +
      t("documents", LIB_ICO.docsIc, "Documents") +
      t("search", LIB_ICO.search, "Search") +
      t("favorites", LIB_ICO.favIc, "Favorites") +
    '</nav>';
  }
  function libHtml() {
    var title = libState.tab === "trash" ? "Trash" : libState.tab === "search" ? "Search" : libState.tab === "favorites" ? "Favorites" : "Documents";
    return '<div class="st5a-wrap">' +
      '<div class="st5a-header"><div class="st5a-bc" id="st5aBc"></div>' +
        '<h1 class="st5a-h1" id="st5aH1">' + esc(title) + '</h1>' +
      '</div>' +
      sortChipsHtml() +
      '<div id="stList"></div>' +
    '</div>';
  }
  function renderLibBody() {
    var bodyEl = D.getElementById("stList");
    if (!bodyEl && host && host.root && host.root()) bodyEl = host.root().querySelector("#stList");
    if (!bodyEl) return;
    // trash purge runs once at init only; purging on every render doubled IDB writes and raced renders
    return Promise.all([idbAll("docs"), idbAll("folders"), idbAll("ptext"), idbAll("index")]).then(function (r) {
      var docs = r[0], folders = r[1], ptext = r[2], ixd = {}; _ixd = ixd; (r[3] || []).forEach(function (x) { ixd[x.doc] = x.done; });
      try { var bcEl = D.getElementById("st5aBc"); if (bcEl) bcEl.innerHTML = currentFolderCrumbHtml(folders); } catch (e) {}
      var showTrash = libState.tab === "trash";
      var filtered = docs.filter(function (d) { return showTrash ? !!d.trashedAt : !d.trashedAt; });
      // apply tab filter
      if (libState.tab === "favorites") filtered = filtered.filter(function (d) { return d.favourite; });
      // apply folder filter for documents tab
      if (libState.tab === "documents" && libState.currentFolderId) filtered = filtered.filter(function (d) { return d.folderId === libState.currentFolderId; });
      if (libState.tab === "search") {
        var q = (bodyEl.parentNode && bodyEl.parentNode.querySelector("#st5aSearchQ") || D.getElementById("st5aSearchQ"));
        var raw = q ? q.value : "";
        raw = String(raw || "").trim().toLowerCase();
        if (raw.length >= 2) {
          var byId = {}; docs.forEach(function (d) { byId[d.id] = d; });
          var hits = [];
          // title hits
          filtered.forEach(function (d) { if (String(d.title || "").toLowerCase().indexOf(raw) !== -1) hits.push({ d: d, html: esc(snippet(d.title, raw)) }); });
          // pdf text hits
          ptext.forEach(function (x) {
            if (x.text && x.text.toLowerCase().indexOf(raw) !== -1) {
              var d = byId[x.doc];
              if (d && !d.trashedAt && (libState.currentFolderId ? d.folderId === libState.currentFolderId : true)) {
                // avoid dupe if already title hit? allow multiple pages distinct
                var exists = hits.some(function (h) { return h.d.id === d.id && h.page === x.page; });
                if (!exists) hits.push({ d: d, page: x.page, html: esc(snippet(x.text, raw)) });
              }
            }
          });
          var pend = docs.filter(function (d) { return d.kind !== "nb" && (ixd[d.id] || 0) < (d.pageCount || 0); });
          var pendingNote = pend.length ? '<p class="pn-note">Some pages are not yet indexed, so more matches may appear: ' + pend.map(function (d) { return esc(d.title) + " (" + ixLabel5a(ixd[d.id] || 0, d.pageCount) + ")"; }).join("; ") + ".</p>" : "";
          // render search results
          var searchInputHtml = '<div class="st5a-search-wrap"><div class="st-search-box"><span class="st-search-ico">' + LIB_ICO.search + '</span><input type="search" id="st5aSearchQ" class="st-q" placeholder="Search titles and text" aria-label="Search titles and text" autocomplete="off" value="' + esc(raw) + '"></div></div>';
          if (!hits.length) {
            bodyEl.innerHTML = searchInputHtml + '<div class="st-empty-box"><div class="st-empty-ico">' + LIB_ICO.search + '</div><h3>No results</h3><p>Nothing found for \u201c' + esc(raw) + '\u201d.</p></div>' + pendingNote;
          } else {
            hits = hits.slice(0, 60);
            bodyEl.innerHTML = searchInputHtml + hits.map(function (h) {
              var d = h.d;
              return '<button type="button" class="st-hit" data-act="st5a-open" data-id="' + d.id + '" data-page="' + (h.page || 1) + '"><b>' + esc(d.title) + '</b><small>' + (h.page ? "Page " + h.page : (d.kind === "nb" ? "Notebook title" : "Title")) + '</small><span class="st-sn">' + h.html + '</span></button>';
            }).join("");
          }
          var inp2 = D.getElementById("st5aSearchQ");
          if (inp2 && !inp2._bound) { inp2._bound = true; inp2.addEventListener("input", function () { G.clearTimeout(inp2._deb); inp2._deb = G.setTimeout(renderLibBody, 200); }); }
          return;
        } else {
          // search tab empty state with input
          bodyEl.innerHTML = '<div class="st5a-search-wrap"><div class="st-search-box"><span class="st-search-ico">' + LIB_ICO.search + '</span><input type="search" id="st5aSearchQ" class="st-q" placeholder="Search titles and text" aria-label="Search titles and text" autocomplete="off" value="' + esc(raw) + '"></div><p class="pn-note">Searches titles and PDF text on this phone.</p></div>' +
            '<div id="st5aList"></div>';
          // reuse same list rendering? For search tab with no query, fall through to show nothing? Instead show prompt.
          var listEl = D.getElementById("st5aList");
          if (listEl) listEl.innerHTML = '<p class="pn-empty">Type at least 2 characters to search.</p>';
          var inp = D.getElementById("st5aSearchQ");
          if (inp && !inp._bound) { inp._bound = true; inp.addEventListener("input", function () { G.clearTimeout(inp._deb); inp._deb = G.setTimeout(renderLibBody, 200); }); }
          return;
        }
      }
      // folders for current view
      var shownFolders = [];
      if (libState.tab === "documents") {
        if (libState.currentFolderId) {
          shownFolders = folders.filter(function (f) { return f.parentId === libState.currentFolderId; });
        } else {
          shownFolders = folders.filter(function (f) { return !f.parentId; });
        }
        // trash tab does not show folders
      }
      // sort
      var items = [];
      shownFolders.forEach(function (f) { items.push({ type: "folder", title: f.name, name: f.name, f: f, lastOpened: f.mtime || f.created || 0, created: f.created || 0 }); });
      filtered.forEach(function (d) { items.push(d); });
      items = sortDocs(items, libState.sort);
      if (!items.length) {
        if (libState.tab === "trash") {
          bodyEl.innerHTML = '<div class="st-empty-box"><div class="st-empty-ico">' + LIB_ICO.trash + '</div><h3>Trash is empty</h3><p>Deleted documents live here for 30 days before they are permanently removed. Ink is never lost before then.</p></div>' + (showTrash ? '<div class="st5a-trash-note"><p class="pn-note">Items stay 30 days, then are purged. Restore any item before then.</p></div>' : '');
          if (showTrash) bodyEl.innerHTML += '<div class="st5a-trash-actions"><button type="button" class="pn-btn sm" data-act="st5a-purge-all">Empty trash now</button></div>';
          return;
        }
        var isFav = libState.tab === "favorites";
        bodyEl.innerHTML = '<div class="st-empty-box"><div class="st-empty-ico">' + (isFav ? LIB_ICO.favIc : LIB_ICO.book) + '</div><h3>' + (isFav ? "No favourites yet" : "No PDFs yet") + '</h3><p>' + (isFav ? "Star a document or folder to pin it here." : "Import a PDF, create a notebook, or scan notes.") + '</p></div>';
        return;
      }
      if (libState.view === "grid") {
        var gridCls = "st5a-grid";
        var cards = "";
        if (libState.tab === "documents" && !showTrash) cards += newTileHtml();
        cards += items.map(function (it) {
          if (it.type === "folder") return folderCardHtml(it.f);
          return docCardHtml(it, folders);
        }).join("");
        bodyEl.innerHTML = '<div class="' + gridCls + '">' + cards + '</div>' + (showTrash ? '<div class="st5a-trash-actions"><button type="button" class="pn-btn sm" data-act="st5a-purge-all">Empty trash now</button><p class="pn-note">Trash keeps items for 30 days. Restore is instant.</p></div>' : '');
        wireDrag();
      } else {
        var rows = items.map(function (it) {
          if (it.type === "folder") {
            var f = it.f;
            return '<div class="st5a-list-row st5a-list-folder" data-folder="' + f.id + '">' +
              '<button type="button" class="st5a-list-open" data-act="st5a-open-folder" data-id="' + f.id + '"><span class="st5a-list-th-ph" style="color:' + (f.colour || "#42CDB5") + '">' + (f.favourite ? LIB_ICO.folderStar : LIB_ICO.folder) + '</span><span class="st5a-list-tt"><b>' + esc(f.name) + '</b><small>' + esc(fmtWhen(f.mtime || f.created || Date.now())) + '</small></span></button>' +
              '<button type="button" class="st5a-icon-btn' + (f.favourite ? " on" : "") + '" data-act="st5a-fav-folder" data-id="' + f.id + '">' + (f.favourite ? LIB_ICO.starFill : LIB_ICO.star) + '</button>' +
              '<button type="button" class="st5a-icon-btn" data-act="st5a-folder-menu" data-id="' + f.id + '">' + LIB_ICO.more + '</button>' +
            '</div>';
          }
          return listRowHtml(it, folders);
        }).join("");
        if (libState.tab === "documents" && !showTrash) rows = '<div class="st5a-list-row st5a-list-new" data-act="st5a-new" role="button" tabindex="0"><span class="st5a-list-th-ph">' + LIB_ICO.plus + '</span><span class="st5a-list-tt"><b>New</b><small>Notebook or import</small></span></div>' + rows;
        bodyEl.innerHTML = '<div class="st5a-list">' + rows + '</div>' + (showTrash ? '<div class="st5a-trash-actions"><button type="button" class="pn-btn sm" data-act="st5a-purge-all">Empty trash now</button></div>' : '');
      }
      // regenerate covers that are dirty
      items.forEach(function (it) { if (it.type !== "folder" && needsCoverRegen(it)) renderCoverForDoc(it, function () { /* lazy thumbnail update triggers re-render on next fill */ }); });
    });
  }
  function ixLabel5a(done, total) { return done >= total ? "" : "Indexing, " + done + " of " + total + " pages"; }
  function snippet(text, q) {
    var s = String(text || ""), lower = s.toLowerCase(), idx = lower.indexOf(q), r = 40;
    if (idx < 0) return s.slice(0, 80);
    var a = Math.max(0, idx - r), b = Math.min(s.length, idx + q.length + r);
    var pre = s.slice(a, idx), hit = s.slice(idx, idx + q.length), post = s.slice(idx + q.length, b);
    return (a ? "..." : "") + pre + "<mark>" + hit + "</mark>" + post + (b < s.length ? "..." : "");
  }
  function wireDrag() {
    var root = hRoot(); if (!root) return;
    var cards = root.querySelectorAll(".st5a-card[draggable='true'], .st5a-list-row[draggable='true']");
    Array.prototype.forEach.call(cards, function (card) {
      if (card._dragWired) return; card._dragWired = true;
      card.addEventListener("dragstart", function (e) {
        var id = card.getAttribute("data-id"); if (!id) return;
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("st5a-dragging");
      });
      card.addEventListener("dragend", function () { card.classList.remove("st5a-dragging"); });
    });
    var folders = root.querySelectorAll(".st5a-folder");
    Array.prototype.forEach.call(folders, function (fEl) {
      if (fEl._dropWired) return; fEl._dropWired = true;
      fEl.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; fEl.classList.add("st5a-dragover"); });
      fEl.addEventListener("dragleave", function () { fEl.classList.remove("st5a-dragover"); });
      fEl.addEventListener("drop", function (e) {
        e.preventDefault(); fEl.classList.remove("st5a-dragover");
        var docId = e.dataTransfer.getData("text/plain"); if (!docId) return;
        var folderId = fEl.getAttribute("data-folder"); if (!folderId) {
          var cover = fEl.querySelector("[data-id]"); if (cover) folderId = cover.getAttribute("data-id");
        }
        if (!folderId) return;
        idbGet("docs", docId).then(function (d) { if (!d) return; d.folderId = folderId; d.lastOpened = Date.now(); return idbPut("docs", d); }).then(renderLibBody).then(function () { try { host.toast("Moved to folder"); } catch (x) {} });
      });
    });
    // click + keyboard for folder open
    var opens = root.querySelectorAll("[data-act='st5a-open-folder'], [data-act='st5a-open']");
    Array.prototype.forEach.call(opens, function (b) {
      if (b._keyWired) return; b._keyWired = true;
      b.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.click(); }
      });
    });
  }
  // ---- sheets and menus ----
  function closeSheet5a() { var root = hRoot(); if (!root) return; var s = root.querySelector("#st5aSheet"); if (s && s.parentNode) s.parentNode.removeChild(s); }
  function openSheet(html) {
    var root = hRoot(); if (!root) return;
    closeSheet5a();
    var el = D.createElement("div");
    el.id = "st5aSheet"; el.className = "st-sheet";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.innerHTML = '<div class="st-sh smd-books-keep smd-emo-keep">' + html + '</div>';
    el.addEventListener("click", function (e) { if (e.target === el) closeSheet5a(); });
    root.appendChild(el);
  }
  function showDocMenu5a(docId) {
    closeSheet5a();
    Promise.all([idbGet("docs", docId), idbAll("folders")]).then(function (r) {
      var d = r[0], folders = r[1]; if (!d) return;
      var inTrash = !!d.trashedAt;
      var folderName = d.folderId ? (folderById(folders, d.folderId) || {}).name || "" : "";
      var thumb = d.thumb ? '<img class="st5a-th" alt="" src="' + d.thumb + '" style="width:44px;height:58px;object-fit:cover;border-radius:6px;border:1px solid var(--pn-line)">' : '<div style="width:44px;height:58px;display:flex;align-items:center;justify-content:center;background:var(--pn-s1);border-radius:6px;border:1px solid var(--pn-line)">' + (d.kind === "nb" ? LIB_ICO.book : LIB_ICO.pdf) + '</div>';
      var items = "";
      if (inTrash) {
        items = '<button type="button" class="st-menu-item" data-act="st5a-restore" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.folder + '</div><div class="st-menu-txt"><strong>Restore</strong><small>Move back to library</small></div></button>' +
          '<button type="button" class="st-menu-item bad" data-act="st5a-purge" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.trash + '</div><div class="st-menu-txt"><strong>Delete forever</strong><small>Immediately purge</small></div></button>';
      } else {
        items = '<button type="button" class="st-menu-item" data-act="st5a-rename" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.edit + '</div><div class="st-menu-txt"><strong>Rename</strong></div></button>' +
          '<button type="button" class="st-menu-item" data-act="st5a-duplicate" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.copy + '</div><div class="st-menu-txt"><strong>Duplicate</strong><small>Copy notebook with ink</small></div></button>' +
          '<button type="button" class="st-menu-item" data-act="st5a-move" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.move + '</div><div class="st-menu-txt"><strong>Move to folder</strong><small>' + (folderName ? esc(folderName) : "No folder") + '</small></div></button>' +
          '<button type="button" class="st-menu-item" data-act="st5a-change-cover" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.cover + '</div><div class="st-menu-txt"><strong>Change cover</strong><small>Regenerate thumbnail</small></div></button>' +
          '<button type="button" class="st-menu-item" data-act="st5a-export-sheet" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.download + '</div><div class="st-menu-txt"><strong>Export</strong><small>PDF with ink</small></div></button>' +
          '<button type="button" class="st-menu-item" data-act="st5a-fav" data-id="' + d.id + '"><div class="st-menu-ico">' + (d.favourite ? LIB_ICO.starFill : LIB_ICO.star) + '</div><div class="st-menu-txt"><strong>' + (d.favourite ? "Remove from Favourites" : "Add to Favourites") + '</strong></div></button>' +
          '<button type="button" class="st-menu-item bad" data-act="st5a-trash" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.trash + '</div><div class="st-menu-txt"><strong>Move to Trash</strong><small>Restore within 30 days</small></div></button>';
      }
      openSheet('<div class="st-doc-menu-head"><div class="st-doc-menu-title" style="display:flex;gap:10px;align-items:center;">' + thumb + '<div><h3>' + esc(d.title) + '</h3><small>' + (d.kind === "nb" ? "Notebook" : "PDF") + ' • ' + d.pageCount + (d.pageCount === 1 ? " page" : " pages") + (folderName ? ' • ' + esc(folderName) : '') + (inTrash ? ' • In Trash' : '') + '</small></div></div><button type="button" class="pn-btn sm" data-act="st5a-close">Done</button></div>' +
        '<div class="st-doc-menu-items">' + items + '</div>' +
        (inTrash ? '<p class="pn-note" style="margin-top:8px">In Trash since ' + esc(fmtWhen(d.trashedAt)) + '. Purges after 30 days.</p>' : ''));
    });
  }
  function showMoveSheet5a(docId) {
    closeSheet5a();
    Promise.all([idbGet("docs", docId), idbAll("folders")]).then(function (r) {
      var d = r[0], folders = r[1]; if (!d) return;
      var html = '<div class="st-doc-menu-head"><div class="st-doc-menu-title"><h3>Move to folder</h3><small>' + esc(d.title) + '</small></div><button type="button" class="pn-btn sm" data-act="st5a-close">Done</button></div>' +
        '<div class="st-doc-menu-items">' +
          '<button type="button" class="st-menu-item' + (!d.folderId ? " on" : "") + '" data-act="st5a-set-folder" data-id="' + d.id + '" data-folder=""><div class="st-menu-ico">' + LIB_ICO.folder + '</div><div class="st-menu-txt"><strong>(No folder)</strong></div></button>' +
          folders.map(function (f) { return '<button type="button" class="st-menu-item' + (d.folderId === f.id ? " on" : "") + '" data-act="st5a-set-folder" data-id="' + d.id + '" data-folder="' + f.id + '"><div class="st-menu-ico" style="color:' + (f.colour || "#42CDB5") + '">' + LIB_ICO.folder + '</div><div class="st-menu-txt"><strong>' + esc(f.name) + '</strong></div></button>'; }).join("") +
          '<div class="st5a-new-folder-row" style="display:flex;gap:8px;margin-top:8px"><input id="st5aNewFolderName" type="text" placeholder="New folder name" maxlength="40" style="flex:1;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--pn-line);background:var(--pn-s1);color:var(--pn-text)"><button type="button" class="pn-btn sm" data-act="st5a-new-folder-for-move" data-id="' + d.id + '">Create</button></div>' +
        '</div>';
      openSheet(html);
    });
  }
  function showFolderMenu5a(folderId) {
    closeSheet5a();
    idbAll("folders").then(function (all) {
      var f = folderById(all, folderId); if (!f) return;
      var kids = all.filter(function (x) { return x.parentId === folderId; }).length;
      var docsIn = 0;
      idbAll("docs").then(function (docs) { docsIn = docs.filter(function (d) { return d.folderId === folderId && !d.trashedAt; }).length; });
      // open sheet quickly; doc count filled in on click? we already have all for folders; docs loaded separately will be silent
      openSheet('<div class="st-doc-menu-head"><div class="st-doc-menu-title" style="display:flex;gap:10px;align-items:center;"><span style="color:' + (f.colour || "#42CDB5") + '">' + (f.favourite ? LIB_ICO.folderStar : LIB_ICO.folder) + '</span><div><h3>' + esc(f.name) + '</h3><small>' + kids + (kids === 1 ? " subfolder" : " subfolders") + '</small></div></div><button type="button" class="pn-btn sm" data-act="st5a-close">Done</button></div>' +
        '<div class="st-doc-menu-items">' +
          '<button type="button" class="st-menu-item" data-act="st5a-rename-folder" data-id="' + f.id + '"><div class="st-menu-ico">' + LIB_ICO.edit + '</div><div class="st-menu-txt"><strong>Rename folder</strong></div></button>' +
          '<button type="button" class="st-menu-item" data-act="st5a-fav-folder" data-id="' + f.id + '"><div class="st-menu-ico">' + (f.favourite ? LIB_ICO.starFill : LIB_ICO.star) + '</div><div class="st-menu-txt"><strong>' + (f.favourite ? "Remove favourite" : "Mark as favourite") + '</strong><small>Red star</small></div></button>' +
          '<button type="button" class="st-menu-item" data-act="st5a-folder-colour" data-id="' + f.id + '"><div class="st-menu-ico">' + LIB_ICO.palette + '</div><div class="st-menu-txt"><strong>Folder colour</strong><small>Current: ' + esc(f.colour || "#42CDB5") + '</small></div></button>' +
          '<button type="button" class="st-menu-item" data-act="st5a-new-subfolder" data-id="' + f.id + '"><div class="st-menu-ico">' + LIB_ICO.plus + '</div><div class="st-menu-txt"><strong>New subfolder</strong></div></button>' +
          '<button type="button" class="st-menu-item" data-act="st5a-move-folder" data-id="' + f.id + '"><div class="st-menu-ico">' + LIB_ICO.move + '</div><div class="st-menu-txt"><strong>Move folder</strong></div></button>' +
          '<button type="button" class="st-menu-item bad" data-act="st5a-del-folder" data-id="' + f.id + '"><div class="st-menu-ico">' + LIB_ICO.trash + '</div><div class="st-menu-txt"><strong>Delete folder</strong><small>Items stay in library</small></div></button>' +
        '</div>');
    });
  }
  function showFolderColourSheet(folderId) {
    idbGet("folders", folderId).then(function (f) {
      if (!f) return;
      var cur = f.colour || FOLDER_COLORS[0];
      openSheet('<div class="st-doc-menu-head"><div class="st-doc-menu-title"><h3>Folder colour</h3><small>' + esc(f.name) + '</small></div><button type="button" class="pn-btn sm" data-act="st5a-close">Done</button></div>' +
        '<div class="st5a-colours" style="display:flex;flex-wrap:wrap;gap:10px;padding:8px 0">' + FOLDER_COLORS.map(function (c) { return '<button type="button" class="st5a-col-dot' + (c === cur ? " on" : "") + '" data-act="st5a-set-colour" data-id="' + f.id + '" data-col="' + c + '" style="--c:' + c + '" aria-label="Colour ' + c + '"></button>'; }).join("") + '</div>');
    });
  }
  function showExportSheet(docId) {
    idbGet("docs", docId).then(function (d) {
      if (!d) return;
      var st = G.STUDY && G.STUDY._state && G.STUDY._state();
      var cur = (st && st.id === docId && st.cur) || 1;
      openSheet('<div class="st-doc-menu-head"><div class="st-doc-menu-title"><h3>Export</h3><small>' + esc(d.title) + '</small></div><button type="button" class="pn-btn sm" data-act="st5a-close">Done</button></div>' +
        '<div class="st-doc-menu-items">' +
          '<button type="button" class="st-menu-item" data-act="st5a-export-all" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.download + '</div><div class="st-menu-txt"><strong>All pages</strong><small>PDF with ink flattened</small></div></button>' +
          '<button type="button" class="st-menu-item" data-act="st5a-export-page" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.cover + '</div><div class="st-menu-txt"><strong>This page (page ' + cur + ')</strong><small>Single-page PDF with ink</small></div></button>' +
          (d.kind !== "nb" ? '<button type="button" class="st-menu-item" data-act="st5a-export-orig" data-id="' + d.id + '"><div class="st-menu-ico">' + LIB_ICO.pdf + '</div><div class="st-menu-txt"><strong>Original</strong><small>Unannotated PDF</small></div></button>' : '') +
        '</div>' +
        '<p class="pn-note">Export flattens ink into the PDF on this phone, then shares or downloads.</p>');
    });
  }
  function showNotebookSheet() {
    openSheet('<div class="st-doc-menu-head"><div class="st-doc-menu-title"><h3>New notebook</h3><small>Pick a style and size</small></div><button type="button" class="pn-btn sm" data-act="st5a-close">Done</button></div>' +
      '<div class="st5a-nb-form" style="display:flex;flex-direction:column;gap:8px">' +
        '<input id="st5aNbT" maxlength="120" placeholder="Notebook title" aria-label="Notebook title" style="min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--pn-line);background:var(--pn-s1);color:var(--pn-text)">' +
        '<select id="st5aNbS" aria-label="Page style" style="min-height:44px;border-radius:10px;border:1px solid var(--pn-line);background:var(--pn-s1);color:var(--pn-text)"><option value="blank">Blank</option><option value="ruled" selected>Ruled</option><option value="grid">Grid</option><option value="cornell">Cornell</option><option value="dotgrid">Dot grid</option></select>' +
        '<select id="st5aNbZ" aria-label="Page size" style="min-height:44px;border-radius:10px;border:1px solid var(--pn-line);background:var(--pn-s1);color:var(--pn-text)"><option value="a4">A4</option><option value="phone">Phone</option></select>' +
        '<button type="button" class="pn-btn pri" data-act="st5a-mknb">Create</button>' +
      '</div>');
  }
  function showNewSheet() {
    openSheet('<div class="st-doc-menu-head"><div class="st-doc-menu-title"><h3>New</h3><small>Notebook, folder or import</small></div><button type="button" class="pn-btn sm" data-act="st5a-close">Done</button></div>' +
      '<div class="st-doc-menu-items">' +
        '<button type="button" class="st-menu-item" data-act="st5a-new-notebook"><div class="st-menu-ico">' + LIB_ICO.book + '</div><div class="st-menu-txt"><strong>Notebook</strong><small>Blank, ruled, grid</small></div></button>' +
        '<button type="button" class="st-menu-item" data-act="st5a-new-folder"><div class="st-menu-ico">' + LIB_ICO.folder + '</div><div class="st-menu-txt"><strong>Folder</strong><small>Create, nest, colour</small></div></button>' +
        '<button type="button" class="st-menu-item" data-act="st5a-new-import"><div class="st-menu-ico">' + LIB_ICO.pdf + '</div><div class="st-menu-txt"><strong>Import PDF</strong></div></button>' +
        '<button type="button" class="st-menu-item" data-act="st5a-scan"><div class="st-menu-ico">' + LIB_ICO.pdf + '</div><div class="st-menu-txt"><strong>Scan</strong><small>Scan pages to PDF</small></div></button>' +
        '<button type="button" class="st-menu-item" data-act="st5a-new-photos"><div class="st-menu-ico">' + LIB_ICO.cover + '</div><div class="st-menu-txt"><strong>Photos to PDF</strong></div></button>' +
      '</div>');
  }
  /* ================= import / notebook / restore (same store as study.js) ================= */
  function putAll(store, arr) {
    if (!arr.length) return Promise.resolve();
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, "readwrite"), o = t.objectStore(store);
        arr.forEach(function (v) { o.put(v); });
        t.oncomplete = function () { res(); }; t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function sha256Hex(bytes) {
    return G.crypto.subtle.digest("SHA-256", bytes).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
    });
  }
  function unb64(s) { var bin = G.atob(s), n = bin.length, a = new Uint8Array(n), i; for (i = 0; i < n; i++) a[i] = bin.charCodeAt(i); return a; }
  function saveOriginalBytes(id, bytes) {
    var fs = fsPlugin();
    if (fs) return fs.writeFile({ path: "study/" + id + ".pdf", data: b64(bytes), directory: "DATA", recursive: true }).then(function () { return "fs"; });
    return idbPut("files", { id: id, blob: new Blob([bytes], { type: "application/pdf" }) }).then(function () { return "idb"; });
  }
  function drawBgCanvas(ctx, style, ratio, W) {
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, W * ratio);
    if (style === "blank") return;
    ctx.strokeStyle = "#b8c4d6"; ctx.lineWidth = Math.max(1, W / 400);
    var s = 0.05, end = style === "cornell" ? ratio * 0.8 : ratio;
    ctx.beginPath();
    if (style === "ruled" || style === "cornell") { for (var y = s * 2; y < end; y += s) { ctx.moveTo(0, y * W); ctx.lineTo(W, y * W); } }
    if (style === "grid") { for (y = s; y < ratio; y += s) { ctx.moveTo(0, y * W); ctx.lineTo(W, y * W); } for (var x = s; x < 1; x += s) { ctx.moveTo(x * W, 0); ctx.lineTo(x * W, ratio * W); } }
    if (style === "dotgrid" || style === "dots") { ctx.fillStyle = "#9fb0c3"; for (y = s * 2; y < ratio; y += s) for (x = s; x < 1; x += s) ctx.fillRect(x * W - 0.5, y * W - 0.5, 1, 1); }
    if (style === "cornell") { ctx.moveTo(0.3 * W, s * 2 * W); ctx.lineTo(0.3 * W, end * W); ctx.moveTo(0, end * W); ctx.lineTo(W, end * W); }
    ctx.stroke();
  }
  function importBytes(bytes, name) {
    var id = uid(), meta = { id: id, title: String(name || "PDF").replace(/\.pdf$/i, "").slice(0, 120) || "PDF", created: Date.now(), lastOpened: 0, favourite: false, folderId: libState.currentFolderId || null, subject: null };
    return sha256Hex(bytes).then(function (hh) {
      meta.sha256 = hh;
      return pdfjsLib().then(function (L) { return L.getDocument({ data: bytes.slice() }).promise; });
    }).then(function (pdf) {
      meta.pageCount = pdf.numPages;
      return pdf.getPage(1).then(function (p) {
        var v0 = p.getViewport({ scale: 1 }), sc = 160 / v0.width, v = p.getViewport({ scale: sc }), c = D.createElement("canvas");
        c.width = Math.ceil(v.width); c.height = Math.ceil(v.height);
        var ctx = c.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
        return p.render({ canvasContext: ctx, viewport: v }).promise.then(function () { meta.thumb = c.toDataURL("image/jpeg", 0.7); try { pdf.destroy(); } catch (e) {} });
      });
    }).then(function () { return saveOriginalBytes(id, bytes); }).then(function (where) { meta.store = where; return idbPut("docs", meta); }).then(function () { return meta; });
  }
  function makeNotebook5a(title, style, size) {
    var ratio = size === "phone" ? 2 : 1.414, c = D.createElement("canvas");
    c.width = 160; c.height = Math.round(160 * ratio); drawBgCanvas(c.getContext("2d"), style, ratio, 160);
    var meta = { id: uid(), title: String(title || "").trim().slice(0, 120) || "Notebook", kind: "nb", style: style, size: size, ratio: ratio, ord: [1], next: 2, pageCount: 1, created: Date.now(), lastOpened: 0, favourite: false, folderId: libState.currentFolderId || null, subject: null, thumb: c.toDataURL("image/jpeg", 0.7) };
    return idbPut("docs", meta).then(function () { return meta; });
  }
  function readUrl(f) { return new Promise(function (res, rej) { var r = new G.FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(f); }); }
  function normPhoto(url) {
    return new Promise(function (res, rej) {
      var im = new G.Image();
      im.onload = function () {
        var k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight)), c = D.createElement("canvas"), x;
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        var out = { data: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height }; c.width = 0; res(out);
      };
      im.onerror = function () { rej(new Error("image")); };
      im.src = url;
    });
  }
  function stamp5a() { var n = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; }; return n.getFullYear() + "-" + p(n.getMonth() + 1) + "-" + p(n.getDate()) + " " + p(n.getHours()) + ":" + p(n.getMinutes()); }
  function buildPdfBytes(shots) {
    return jspdf().then(function (J) {
      var doc = null;
      shots.forEach(function (s) {
        var w = 595.28, h = w * s.h / s.w, o = h >= w ? "p" : "l";
        if (!doc) doc = new J({ unit: "pt", format: [w, h], orientation: o, compress: true }); else doc.addPage([w, h], o);
        doc.addImage(s.data, "JPEG", 0, 0, w, h);
      });
      return new Uint8Array(doc.output("arraybuffer"));
    });
  }
  function importPhotos5a(urls) {
    var shots = [];
    if (!urls.length) return Promise.resolve();
    var h = getHost(); if (h && h.toast) h.toast("Building the PDF...");
    return urls.reduce(function (p, u) { return p.then(function () { return normPhoto(u).then(function (s) { shots.push(s); }); }); }, Promise.resolve())
      .then(function () { return buildPdfBytes(shots); }).then(function (bytes) { return importBytes(bytes, "Photos " + stamp5a()); }).then(function (meta) { ocrPhotos(meta, shots); return meta; })
      .then(function () { if (h && h.toast) h.toast("Added " + shots.length + (shots.length === 1 ? " page." : " pages.")); return renderLibBody(); })
      .then(null, function () { try { getHost().toast("Those photos could not be added."); } catch (e) {} });
  }
  function ocrPhotos(meta, shots) {
    var N = G.SMD_NATIVE; if (!(N && N.ocr && meta)) return;
    var n = 0;
    function batch() {
      if (n >= shots.length) return;
      var end = Math.min(n + 3, shots.length), t = [], i;
      for (i = n; i < end; i++) t.push((function (k) {
        return N.ocr(shots[k].data).then(function (r) { if (G.STUDY && G.STUDY.setPageText) G.STUDY.setPageText(meta.id, k + 1, (r && r.text) || ""); }, function () {});
      })(i));
      return Promise.all(t).then(function () { n = end; return new Promise(function (r) { G.setTimeout(r, 30); }); }).then(batch);
    }
    batch();
  }
  function bk5a(msg) { try { var e = hRoot() && hRoot().querySelector("#stBk"); if (e) e.textContent = msg; else if (getHost()) getHost().toast(msg); } catch (e) {} }
  function restoreBytes5a(bytes) {
    var F = G.fflate, ent;
    try { ent = F.unzipSync(bytes); } catch (e) { bk5a("Nothing was restored. That file is not a Study Studio backup."); return; }
    var verify = (G.STUDY && G.STUDY._pure && G.STUDY._pure.verifyBackup) || null;
    if (!verify) { bk5a("Nothing was restored. Restore is not available in this build."); return; }
    bk5a("Checking the backup...");
    return verify(ent, sha256Hex).then(function (v) {
      if (!v.ok) { bk5a("Nothing was restored. " + v.error); return; }
      return Promise.all([idbAll("docs"), idbAll("folders")]).then(function (hh) {
        var plan = G.STUDY._pure.restorePlan(hh[0], v.recs), have = {}, strokes = 0;
        hh[1].forEach(function (f) { have[f.id] = 1; });
        return putAll("folders", v.folders.filter(function (f) { return !have[f.id]; })).then(function () {
          return plan.add.reduce(function (p, r) {
            return p.then(function () {
              var d = r.doc, w = d.kind === "nb" ? Promise.resolve(d.store) : saveOriginalBytes(d.id, ent["files/" + d.id + ".pdf"]);
              return w.then(function (where) { if (d.kind !== "nb") d.store = where; return putAll("strokes", r.strokes); })
                .then(function () { return putAll("ptext", r.ptext); })
                .then(function () { return r.undo ? idbPut("undo", r.undo) : null; })
                .then(function () { return r.index ? idbPut("index", r.index) : null; })
                .then(function () { strokes += r.strokes.length; return idbPut("docs", d); });
            });
          }, Promise.resolve());
        }).then(function () {
          bk5a("Restored " + plan.add.length + " documents with " + strokes + " strokes. Skipped " + plan.skip.length + " already in the library. Nothing existing was changed.");
          renderLibBody();
        });
      });
    }).then(null, function () { bk5a("The restore stopped part way. Run it again: documents already restored are skipped."); });
  }
  /* ---- CRUD: folders, trash, duplicate ---- */
  function newFolder(name, parentId, colour) {
    var f = { id: uid(), name: String(name || "Folder").trim().slice(0, 40) || "Folder", parentId: parentId || null, colour: colour || FOLDER_COLORS[0], favourite: false, created: Date.now(), mtime: Date.now() };
    return idbPut("folders", f).then(function () { return f; });
  }
  function trashDoc(id) { return idbGet("docs", id).then(function (d) { if (!d) return; d.trashedAt = Date.now(); removeTab(id); return idbPut("docs", d); }).then(renderLibBody); }
  function restoreDoc(id) {
    return idbGet("docs", id).then(function (d) {
      if (!d) return;
      delete d.trashedAt;
      // if its folder was deleted, go to root
      return idbAll("folders").then(function (fs) {
        if (d.folderId && !folderById(fs, d.folderId)) d.folderId = null;
        return idbPut("docs", d);
      });
    }).then(renderLibBody).then(function () { try { getHost().toast("Restored."); } catch (e) {} });
  }
  function purgeDoc(id) {
    return strokesOf(id).then(function (ss) { return Promise.all(ss.map(function (s) { return idbDel("strokes", s.id); })); })
      .then(function () { return textOf(id).then(function (rows) { return Promise.all(rows.map(function (x) { return idbDel("ptext", x.id); })); }); })
      .then(function () { return Promise.all([idbDel("undo", id), idbDel("files", id), idbDel("docs", id), idbDel("index", id)]); })
      .then(function () { removeTab(id); return renderLibBody(); });
  }
  function purgeAllTrash() {
    return idbAll("docs").then(function (docs) {
      var t = docs.filter(function (d) { return d.trashedAt; });
      if (!t.length) return renderLibBody();
      if (!G.confirm("Empty the Trash? This permanently deletes " + t.length + " items. This cannot be undone.")) return;
      return t.reduce(function (p, d) { return p.then(function () { return purgeDoc(d.id); }); }, Promise.resolve());
    });
  }
  function duplicateDoc(id) {
    return Promise.all([idbGet("docs", id), strokesOf(id), textOf(id), idbGet("undo", id), idbGet("index", id)]).then(function (r) {
      var src = r[0]; if (!src) return;
      var nid = uid(), copy = {};
      Object.keys(src).forEach(function (k) { copy[k] = src[k]; });
      copy.id = nid; copy.title = dupTitle(src.title); copy.created = Date.now(); copy.lastOpened = 0; delete copy.trashedAt; copy._thumbDirty = true;
      if (copy.ord) copy.ord = copy.ord.slice();
      var strokes = r[1].map(function (s) { var c = {}; Object.keys(s).forEach(function (k) { c[k] = s[k]; }); c.id = uid(); c.doc = nid; return c; });
      var ptexts = (r[2] || []).map(function (x) { var c = {}; Object.keys(x).forEach(function (k) { c[k] = x[k]; }); c.doc = nid; c.id = nid + ":" + x.page + ":" + (x.src || "pdf"); return c; });
      function putFile() {
        if (src.kind === "nb") return Promise.resolve();
        return loadOriginalBytes(src).then(function (bytes) { return saveOriginalBytes(nid, bytes); }).then(function (where) { copy.store = where; });
      }
      return putFile().then(function () {
        return idbPut("docs", copy).then(function () { return putAll("strokes", strokes); })
          .then(function () { return putAll("ptext", ptexts); })
          .then(function () { if (r[3]) return idbPut("undo", { doc: nid, u: [], r: [] }); })
          .then(function () { if (r[4]) return idbPut("index", { doc: nid, done: 0 }); });
      }).then(renderLibBody).then(function () { try { getHost().toast("Duplicated."); } catch (e) {} });
    });
  }
  /* ================= actions (st5a- prefix, self-delegated) ================= */
  function idOf(el) { return el.getAttribute("data-id"); }
  function libAct5a(a, el, h) {
    host = h;
    if (a === "st5a-close") { closeSheet5a(); return; }
    if (a === "st5a-tab") {
      libState.tab = el.getAttribute("data-v") || "documents";
      savePref("smd_study_lib_tab", libState.tab);
      closeSheet5a();
      renderLibPaint();
      return;
    }
    if (a === "st5a-sort") { libState.sort = el.getAttribute("data-v") || "date"; savePref("smd_study_lib_sort", libState.sort); return renderLibPaint(); }
    if (a === "st5a-view") { libState.view = el.getAttribute("data-v") || "grid"; savePref("smd_study_lib_view", libState.view); return renderLibPaint(); }
    if (a === "st5a-crumb") { libState.currentFolderId = el.getAttribute("data-id") || null; return renderLibBody(); }
    if (a === "st5a-open-folder") { libState.currentFolderId = idOf(el); return renderLibBody(); }
    if (a === "st5a-open") { openDocById(idOf(el), parseInt(el.getAttribute("data-page"), 10) || null); return; }
    if (a === "st5a-dt-open") { openDocById(idOf(el), null); return; }
    if (a === "st5a-dt-close") { removeTab(idOf(el)); return; }
    if (a === "st5a-fav") { closeSheet5a(); return idbGet("docs", idOf(el)).then(function (d) { if (!d) return; d.favourite = !d.favourite; return idbPut("docs", d); }).then(renderLibBody); }
    if (a === "st5a-fav-folder") { closeSheet5a(); return idbGet("folders", idOf(el)).then(function (f) { if (!f) return; f.favourite = !f.favourite; return idbPut("folders", f); }).then(renderLibBody); }
    if (a === "st5a-doc-menu") return showDocMenu5a(idOf(el));
    if (a === "st5a-folder-menu") return showFolderMenu5a(idOf(el));
    if (a === "st5a-rename") {
      closeSheet5a();
      return idbGet("docs", idOf(el)).then(function (d) { if (!d) return; var t = G.prompt("Rename", d.title); if (t && t.trim()) { d.title = t.trim().slice(0, 120); d._thumbDirty = true; return idbPut("docs", d).then(renderLibBody); } });
    }
    if (a === "st5a-rename-folder") {
      closeSheet5a();
      return idbGet("folders", idOf(el)).then(function (f) { if (!f) return; var t = G.prompt("Rename folder", f.name); if (t && t.trim()) { f.name = t.trim().slice(0, 40); f.mtime = Date.now(); return idbPut("folders", f).then(renderLibBody); } });
    }
    if (a === "st5a-duplicate") { closeSheet5a(); return duplicateDoc(idOf(el)); }
    if (a === "st5a-move") return showMoveSheet5a(idOf(el));
    if (a === "st5a-set-folder") {
      var sid = idOf(el), sfid = el.getAttribute("data-folder") || null;
      closeSheet5a();
      return idbGet("docs", sid).then(function (d) { if (!d) return; d.folderId = sfid; return idbPut("docs", d); }).then(renderLibBody).then(function () { try { host.toast("Moved."); } catch (e) {} });
    }
    if (a === "st5a-new-folder-for-move") {
      var inp = hRoot() && hRoot().querySelector("#st5aNewFolderName");
      var nm = inp && inp.value;
      if (!nm || !nm.trim()) { try { host.toast("Type a folder name."); } catch (e) {} return; }
      var did = idOf(el);
      return newFolder(nm, null).then(function (f) { return idbGet("docs", did).then(function (d) { if (!d) return; d.folderId = f.id; return idbPut("docs", d); }); }).then(function () { closeSheet5a(); return renderLibBody(); });
    }
    if (a === "st5a-change-cover") {
      closeSheet5a();
      return idbGet("docs", idOf(el)).then(function (d) { if (!d) return; d._thumbDirty = true; return idbPut("docs", d); }).then(function () { return renderLibBody(); }).then(function () {
        return idbGet("docs", idOf(el)).then(function (d) { return renderCoverForDoc(d, renderLibBody); });
      });
    }
    if (a === "st5a-export-sheet") return showExportSheet(idOf(el));
    if (a === "st5a-export-all") { closeSheet5a(); return exportAllPages(idOf(el), null); }
    if (a === "st5a-export-page") { closeSheet5a(); return exportThisPage(idOf(el)); }
    if (a === "st5a-export-orig") { closeSheet5a(); return exportOriginal(idOf(el)); }
    if (a === "st5a-trash") { closeSheet5a(); if (G.confirm("Move to Trash? You can restore it within 30 days.")) return trashDoc(idOf(el)); return; }
    if (a === "st5a-restore") { closeSheet5a(); return restoreDoc(idOf(el)); }
    if (a === "st5a-purge") { closeSheet5a(); if (G.confirm("Delete forever? This cannot be undone.")) return purgeDoc(idOf(el)); return; }
    if (a === "st5a-purge-all") return purgeAllTrash();
    if (a === "st5a-new") return showNewSheet();
    if (a === "st5a-new-notebook") { return showNotebookSheet(); }
    if (a === "st5a-mknb") { closeSheet5a(); var rt = hRoot(); return makeNotebook5a(rt.querySelector("#st5aNbT").value, rt.querySelector("#st5aNbS").value, rt.querySelector("#st5aNbZ").value).then(function (m) { openDocById(m.id, null); }); }
    if (a === "st5a-new-folder") { closeSheet5a(); var fn = G.prompt("Folder name"); if (fn && fn.trim()) return newFolder(fn, libState.currentFolderId).then(renderLibBody); return; }
    if (a === "st5a-new-subfolder") { closeSheet5a(); var sn = G.prompt("Folder name"); if (sn && sn.trim()) return newFolder(sn, idOf(el)).then(renderLibBody); return; }
    if (a === "st5a-new-import") { closeSheet5a(); var f = hRoot() && hRoot().querySelector("#stFile"); if (f) f.click(); return; }
    if (a === "st5a-new-photos") {
      closeSheet5a();
      var N = G.SMD_NATIVE;
      if (!(N && N.pickImage)) { var ph = hRoot() && hRoot().querySelector("#stPhotos"); if (ph) ph.click(); return; }
      (function more(urls) {
        N.pickImage().then(function (u) { urls.push(u); return urls.length < 30 && G.confirm("Add another photo to this PDF?") ? more(urls) : importPhotos5a(urls); }, function () { importPhotos5a(urls); });
      })([]);
      return;
    }
    if (a === "st5a-scan") { if (origAct) return origAct("st-scan", el, h); return; }
    if (a === "st5a-backup") { if (origAct) return origAct("st-backup", el, h); return; }
    if (a === "st5a-restore-lib") { var rf = hRoot() && hRoot().querySelector("#stRestoreF"); if (rf) rf.click(); return; }
    if (a === "st5a-folder-colour") return showFolderColourSheet(idOf(el));
    if (a === "st5a-set-colour") {
      var col = el.getAttribute("data-col");
      closeSheet5a();
      return idbGet("folders", idOf(el)).then(function (f) { if (!f) return; f.colour = col; return idbPut("folders", f); }).then(renderLibBody);
    }
    if (a === "st5a-move-folder") {
      closeSheet5a();
      return Promise.all([idbGet("folders", idOf(el)), idbAll("folders")]).then(function (r) {
        var f = r[0], all = r[1]; if (!f) return;
        var opts = all.filter(function (x) { return x.id !== f.id && x.parentId !== f.id; });
        if (!opts.length) { try { host.toast("No other folder to move to."); } catch (e) {} return; }
        var names = opts.map(function (x) { return x.name; }).join("\n");
        /* simple prompt-based move (native sheet would be a follow-up) */
        var tgt = G.prompt("Move to folder (type name, blank for root):\n" + names, f.parentId ? (folderById(all, f.parentId) || {}).name || "" : "");
        if (tgt == null) return;
        tgt = tgt.trim();
        if (!tgt) { f.parentId = null; } else {
          var m = null; for (var i = 0; i < opts.length; i++) if (opts[i].name === tgt) { m = opts[i]; break; }
          if (!m) { try { host.toast("Folder not found."); } catch (e) {} return; }
          f.parentId = m.id;
        }
        return idbPut("folders", f).then(renderLibBody);
      });
    }
    if (a === "st5a-del-folder") {
      closeSheet5a();
      if (!G.confirm("Delete this folder? Its documents stay in your library.")) return;
      var fid = idOf(el);
      return Promise.all([idbAll("docs"), idbAll("folders")]).then(function (r) {
        var ds = r[0].filter(function (d) { return d.folderId === fid; });
        return Promise.all(ds.map(function (d) { d.folderId = null; return idbPut("docs", d); }));
      }).then(function () {
        return idbAll("folders").then(function (fs) {
          var kids = fs.filter(function (x) { return x.parentId === fid; });
          return Promise.all(kids.map(function (k) { k.parentId = null; return idbPut("folders", k); }));
        });
      }).then(function () { return idbDel("folders", fid); }).then(function () {
        if (libState.currentFolderId === fid) libState.currentFolderId = null;
        return renderLibBody();
      });
    }
  }
  /* ================= render + init ================= */
  function renderLibPaint() {
    var h = getHost(); if (!h) return;
    var title = libState.tab === "trash" ? "Trash" : libState.tab === "search" ? "Search" : libState.tab === "favorites" ? "Favorites" : "Documents";
    h.paint(h.bar(title, libState.tab === "documents" ? "Study Studio" : "Study Studio", "back") +
      '<div class="pn-body st-lib st5a-lib" id="stLib">' +
        libHtml() +
        bottomBarHtml() +
        '<input type="file" id="stFile" accept="application/pdf" hidden>' +
        '<input type="file" id="stPhotos" accept="image/*" multiple hidden>' +
        '<input type="file" id="stRestoreF" accept=".zip,application/zip" hidden>' +
        '<div class="st-backup-box">' +
          '<div class="st-acts">' +
            '<button type="button" class="pn-btn sm" data-act="st5a-backup">Back up library</button>' +
            '<button type="button" class="pn-btn sm" data-act="st5a-restore-lib">Restore</button>' +
          '</div>' +
          '<p class="pn-note" id="stBk" role="status" style="margin:0"></p>' +
        '</div>' +
      '</div>');
    wireLib();
    try { if (G.STUDY && G.STUDY.kick) G.STUDY.kick(); } catch (e) {}
    renderLibBody();
  }
  function wireLib() {
    var root = hRoot(); if (!root) return;
    var f = root.querySelector("#stFile");
    if (f && !f._w5a) { f._w5a = true; f.addEventListener("change", function () {
      var file = f.files && f.files[0]; if (!file) return;
      try { getHost().toast("Importing..."); } catch (e) {}
      file.arrayBuffer().then(function (ab) { f.value = ""; return importBytes(new Uint8Array(ab), file.name); }).then(function () {
        try { getHost().toast("PDF added."); } catch (e) {}
        try { if (G.STUDY && G.STUDY.kick) G.STUDY.kick(); } catch (e) {}
        renderLibBody();
      }).then(null, function () { try { getHost().toast("That file could not be added."); } catch (e) {} });
    }); }
    var ph = root.querySelector("#stPhotos");
    if (ph && !ph._w5a) { ph._w5a = true; ph.addEventListener("change", function () {
      var fl = Array.prototype.slice.call(ph.files || []); ph.value = "";
      Promise.all(fl.map(readUrl)).then(importPhotos5a, function () { try { getHost().toast("Those photos could not be added."); } catch (e) {} });
    }); }
    var rf = root.querySelector("#stRestoreF");
    if (rf && !rf._w5a) { rf._w5a = true; rf.addEventListener("change", function () {
      var file = rf.files && rf.files[0]; if (!file) return;
      file.arrayBuffer().then(function (ab) { rf.value = ""; return restoreBytes5a(new Uint8Array(ab)); });
    }); }
    // collapsible title on scroll (decorative < 120px shrink; keeps title in layout)
    var sc = root.querySelector(".st5a-wrap");
    if (sc && !sc._w5a) { sc._w5a = true; }
  }
  function renderLib() { renderLibPaint(); }
  /* self-delegation: prep.js only forwards data-act starting "st-"; st5a- needs its own listener */
  if (D && D.addEventListener) {
    D.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-act^='st5a-']") : null;
      if (!t) return;
      var a = t.getAttribute("data-act");
      var h = getHost(); if (!h) return;
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      try { libAct5a(a, t, h); } catch (err) { try { h.toast("That action could not be done."); } catch (x) {} }
    }, true);
  }
  function init() {
    var S = G.STUDY; if (!S) return;
    origAct = S.act;
    var origLib = S.lib;
    S.lib = function () { return renderLibPaint(); };
    S.act = function (a, el, h) {
      host = h;
      if (a.indexOf("st5a-") === 0) return libAct5a(a, el, h);
      // opening a document through the old actions also tracks tabs + injects the tab bar
      if (a === "st-open" || a === "st-hit" || a === "st-src") {
        captureCurrentTab();
        var r = origAct(a, el, h);
        var id = a === "st-src" ? el.getAttribute("data-doc") : (el.getAttribute("data-id") || (el.getAttribute && el.getAttribute("data-id")));
        if (a === "st-hit") id = el.getAttribute("data-id");
        if (id) { addTab(id); G.setTimeout(function () { injectDocTabs(); }, 250); }
        return r;
      }
      return origAct(a, el, h);
    };
    // back closes our sheet first
    var origBack = S.back;
    S.back = function () {
      var root = hRoot(); if (root && root.querySelector("#st5aSheet")) { closeSheet5a(); return true; }
      return origBack();
    };
    // viewer leave: capture tab state (scroll/tool) before STUDY releases it
    var origLeave = S.leave;
    S.leave = function () { captureCurrentTab(); return origLeave(); };
    purgeExpiredTrash();
  }
  if (G.STUDY) init(); else G.setTimeout(init, 0);
  G.STUDY_LIB = { lib: renderLibPaint, act: libAct5a, renderBody: renderLibBody, pure: PURE, _state: function () { return libState; }, injectTabs: injectDocTabs, openById: openDocById, exportAll: exportAllPages };
})(typeof window !== "undefined" ? window : this);



