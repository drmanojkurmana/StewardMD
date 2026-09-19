/* ============================================================================
   StewardMD — ICD Search (window.SMD_ICD)
   Full-screen overlay for looking up WHO ICD-10 and ICD-11 disease/diagnosis codes by name or
   code. Same overlay pattern as govschemes.js / the Drugs Database overlay in api.js:
   ensureRoot/#icdOverlay/.icd-top with a real Back button (aria-label="Back" so swipe-back.js
   picks it up for free), same-origin fetch, own CSS file (icd.css, linked in index.html).

   No flag - shipped default-on for every device, same as Scheme Search as of 2026-09-04 (see
   vault/decisions/Decisions.md).

   Two ways in:
     - SMD_ICD.open()            - stand-alone browse/search (Home tile, More sheet).
     - SMD_ICD.pick(onSelect)    - picker mode for embedding in another form: opens the same
       overlay, but tapping a result calls onSelect({system,code,title,id}) and closes instead
       of opening a detail panel. Used by the "Search ICD" buttons wired into OPD/EMR
       (opd-emr.js provisional diagnosis) and ICU ward (icu.js Working diagnosis card).

   API contract (same-origin Cloudflare Pages Functions, functions/api/icd/, field names verified
   against functions/_icd_repo.js):
     GET /api/icd/search?q=&system=&limit=  -> { results: [ { id, system, code, title, chapter, is_leaf } ] }
     GET /api/icd/code/<id>                 -> { id, system, code, title, chapter, is_leaf }
   Every fetch fails safe (network error / non-2xx / bad JSON -> null); every screen shows
   explicit text on empty/error - never a blank panel.
   ========================================================================== */
(function () {
  "use strict";

  var MINLEN = 2, DEBOUNCE = 250;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function gsIco(n, cls) { return (window.ICONS && ICONS.get) ? ICONS.get(n, cls || "icd-ico") : ""; }
  function g(o, k) { return (o && o[k] != null) ? o[k] : ""; }

  function api(path) {
    return fetch(path).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  var ICDAPI = {
    search: function (q, system, limit) {
      var p = "/api/icd/search?q=" + encodeURIComponent(q) + "&limit=" + (limit || 40);
      if (system) p += "&system=" + encodeURIComponent(system);
      return api(p);
    },
    code: function (id) { return api("/api/icd/code/" + encodeURIComponent(id)); }
  };

  /* ---------------- offline index (window.SMD_ICD.localSearch) ----------------
     Used by maik-engine.js icdCandidates() when offline / the server is unreachable, so the
     on-device model still has real ICD rows to rank instead of ICD_INDEX_OFFLINE. Data is
     icd/icd10.min.json (built by scripts/icd/build-offline-index.mjs, see icd/README.md) - a
     compact [[code,title],...] array of the WHO 4-character ICD-10 set, lazily fetched once and
     cached. Matching/ranking mirrors functions/_icd_repo.js's searchCodes() intent (code-prefix
     for code-like queries, token-prefix title ranking otherwise) so offline results look like the
     server's. Pure ES5 - this file loads without a build step, same as the rest of the app. */
  var DATA_URL = "icd/icd10.min.json";
  var localData = null; // null = not loaded yet, [] = load failed, else the [[code,title],...] array
  var localLoading = null;

  // Same shape as _icd_repo.js isCodeLike(): a short letter+digit token, not a free-text phrase.
  function isCodeLike(q) {
    var s = String(q || "").trim();
    return /^[A-Za-z0-9][A-Za-z0-9.]{1,9}$/.test(s) && /[0-9]/.test(s);
  }
  // Short medical abbreviations that are meaningful under 3 characters - kept even though the
  // general token filter below drops anything shorter than that.
  var SHORT_OK = { dm: 1, tb: 1, mi: 1, pe: 1, cva: 1, uti: 1, cad: 1, ckd: 1, chf: 1, dvt: 1, htn: 1, dka: 1, ibs: 1, ibd: 1 };
  var ALL_DIGITS = /^[0-9]+$/;
  function tokens(q) {
    var all = String(q || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      // A bare number is never noise here - it is what tells "type 1" from "type 2" diabetes
      // (E10 vs E11), so it is kept regardless of length; short words are dropped unless listed.
      if (t.length >= 3 || SHORT_OK[t] || ALL_DIGITS.test(t)) out.push(t);
    }
    return out;
  }
  function titleWords(title) { return String(title || "").toLowerCase().match(/[a-z0-9]+/g) || []; }
  function anyWordPrefixed(words, tok) {
    for (var i = 0; i < words.length; i++) if (words[i].indexOf(tok) === 0) return true;
    return false;
  }
  function toRow(pair) {
    var code = pair[0], title = pair[1];
    return { id: "icd10:" + code, system: "ICD-10", code: code, title: title, chapter: code.slice(0, 3), is_leaf: 1 };
  }
  function loadLocalData() {
    if (localData) return Promise.resolve(localData);
    if (localLoading) return localLoading;
    if (!window.fetch) return Promise.resolve([]);
    localLoading = window.fetch(DATA_URL)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { localData = Array.isArray(rows) ? rows : []; return localData; },
            function () { localData = []; return localData; });
    return localLoading;
  }
  function localSearch(q, limit) {
    var lim = limit || 30;
    var query = String(q || "").trim();
    return loadLocalData().then(function (rows) {
      if (!query || !rows.length) return [];
      var out = [], i;
      if (isCodeLike(query)) {
        var pfx = query.toUpperCase();
        for (i = 0; i < rows.length && out.length < lim; i++) {
          if (rows[i][0].indexOf(pfx) === 0) out.push(toRow(rows[i]));
        }
        return out;
      }
      var toks = tokens(query);
      if (!toks.length) return [];
      var scored = [];
      for (i = 0; i < rows.length; i++) {
        var words = titleWords(rows[i][1]), hit = 0;
        for (var j = 0; j < toks.length; j++) if (anyWordPrefixed(words, toks[j])) hit++;
        if (hit > 0) scored.push({ row: rows[i], hit: hit });
      }
      scored.sort(function (a, b) {
        if (b.hit !== a.hit) return b.hit - a.hit;
        return a.row[1].length - b.row[1].length;
      });
      for (i = 0; i < scored.length && i < lim; i++) out.push(toRow(scored[i].row));
      return out;
    });
  }

  var root = null, timer = null, seq = 0;
  var st = { view: "list", q: "", system: "", onSelect: null };

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "icdOverlay"; root.className = "icd-overlay";
    root.innerHTML =
      '<div class="icd-top">' +
        '<button class="icd-back" id="icdBack" aria-label="Back">‹ Back</button>' +
        '<div class="icd-title" id="icdTitle">Search ICD</div>' +
        '<span class="icd-top-sp"></span>' +
      '</div>' +
      '<div class="icd-body" id="icdBody"></div>';
    document.body.appendChild(root);
    root.querySelector("#icdBack").addEventListener("click", function () {
      if (st.view === "detail") { st.view = "list"; renderList(); return; }
      close();
    });
    return root;
  }
  function setTitle(t) { var e = root.querySelector("#icdTitle"); if (e) e.textContent = t; }

  function renderList() {
    setTitle(st.onSelect ? "Search ICD - pick a code" : "Search ICD");
    var b = root.querySelector("#icdBody");
    b.innerHTML =
      '<div class="icd-searchbar">' + gsIco("search", "icd-ico icd-search-ic") +
        '<input id="icdSearch" class="icd-search" type="text" autocomplete="off" ' +
        'placeholder="Diagnosis name or code, e.g. diabetes, E11, 1A00" value="' + esc(st.q) + '"></div>' +
      '<div class="icd-row2">' +
        '<button type="button" class="icd-sys' + (st.system === "" ? " on" : "") + '" data-sys="">Both</button>' +
        '<button type="button" class="icd-sys' + (st.system === "ICD-10" ? " on" : "") + '" data-sys="ICD-10">ICD-10</button>' +
        '<button type="button" class="icd-sys' + (st.system === "ICD-11" ? " on" : "") + '" data-sys="ICD-11">ICD-11</button>' +
      '</div>' +
      '<div id="icdResults" class="icd-results"></div>';
    var si = b.querySelector("#icdSearch");
    si.addEventListener("input", function () { onQueryInput(si.value); });
    si.addEventListener("keydown", function (e) { e.stopPropagation(); });
    b.querySelectorAll(".icd-sys").forEach(function (btn) {
      btn.addEventListener("click", function () { st.system = btn.getAttribute("data-sys"); renderList(); });
    });
    setTimeout(function () { try { si.focus(); } catch (e) {} }, 50);
    runQuery();
  }
  function onQueryInput(v) {
    st.q = (v || "").trim();
    if (timer) clearTimeout(timer);
    timer = setTimeout(runQuery, DEBOUNCE);
  }
  function runQuery() {
    var r = root.querySelector("#icdResults"); if (!r) return;
    if (st.q.length < MINLEN) {
      r.innerHTML = '<div class="icd-hint">Type a diagnosis name or an ICD-10/ICD-11 code to search.</div>';
      return;
    }
    r.innerHTML = '<div class="icd-hint">Searching…</div>';
    var mySeq = ++seq, q = st.q;
    ICDAPI.search(q, st.system).then(function (d) {
      if (mySeq !== seq || q !== st.q) return;
      if (d == null) { r.innerHTML = '<div class="icd-err">Could not reach the ICD service. Check your connection and try again.</div>'; return; }
      var rows = (d && d.results) || [];
      if (!rows.length) { r.innerHTML = '<div class="icd-empty">No ICD-10/ICD-11 code matches “' + esc(q) + '”.</div>'; return; }
      r.innerHTML = rows.map(rowHTML).join("");
      r.querySelectorAll(".icd-card").forEach(function (c) {
        c.addEventListener("click", function () {
          var id = c.getAttribute("data-id");
          if (st.onSelect) {
            var row = rows.filter(function (x) { return x.id === id; })[0];
            if (row) { var cb = st.onSelect; close(); cb(row); }
          } else {
            openDetail(id);
          }
        });
      });
    });
  }
  function rowHTML(x) {
    return '<button type="button" class="icd-card" data-id="' + esc(x.id) + '">' +
      '<div class="icd-card-code">' + esc(g(x, "code")) + '<span class="icd-card-sys">' + esc(g(x, "system")) + '</span></div>' +
      '<div class="icd-card-name">' + esc(g(x, "title")) + '</div>' +
      (g(x, "chapter") ? '<div class="icd-card-ch">' + esc(x.chapter) + '</div>' : "") +
    '</button>';
  }

  /* ---------------- detail view (stand-alone mode only) ---------------- */
  function openDetail(id) {
    st.view = "detail";
    setTitle("ICD code");
    var b = root.querySelector("#icdBody");
    b.innerHTML = '<div class="icd-hint">Loading…</div>';
    var mySeq = ++seq;
    ICDAPI.code(id).then(function (d) {
      if (mySeq !== seq || st.view !== "detail") return;
      if (d == null || d.error) { b.innerHTML = '<div class="icd-err">Could not load this code. Check your connection and try again.</div>'; return; }
      setTitle(g(d, "code") || "ICD code");
      b.innerHTML =
        '<div class="icd-dhead">' +
          '<div class="icd-dcode">' + esc(g(d, "code")) + '<span class="icd-card-sys">' + esc(g(d, "system")) + '</span></div>' +
          '<div class="icd-dname">' + esc(g(d, "title")) + '</div>' +
          (g(d, "chapter") ? '<div class="icd-card-ch">Chapter/category ' + esc(d.chapter) + '</div>' : "") +
        '</div>' +
        '<div class="icd-src">Source: WHO ' + esc(g(d, "system")) + ' public reference release. Non-PHI classification reference data.</div>';
    });
  }

  /* ---------------- open() / pick() / close() ---------------- */
  function openWith(onSelect) {
    ensureRoot();
    root.classList.add("on");
    document.body.classList.add("icd-lock");
    st.view = "list"; st.onSelect = onSelect || null;
    renderList();
  }
  function open() { openWith(null); }
  function pick(onSelect) { openWith(onSelect); }
  function close() {
    if (!root) return;
    root.classList.remove("on");
    document.body.classList.remove("icd-lock");
  }

  window.SMD_ICD = { open: open, pick: pick, close: close, localSearch: localSearch };
})();
