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
  // Bedside names the WHO titles never use, each mapped to the title the ICD-10 alphabetical index
  // sends it to ("Abscess, dental" -> K04.7 Periapical abscess without sinus).
  var BEDSIDE = [[/\b(?:dental|tooth|dento-?alveolar)\s+abscess\b/i, "periapical abscess"]];
  function localSearch(q, limit) {
    var lim = limit || 30;
    var query = String(q || "").trim();
    BEDSIDE.forEach(function (b) { query = query.replace(b[0], b[1]); });
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

  // Every ICD-10 title word ({ word: 1 }), for the MaiK spelling fix (edge-router.js spell):
  // "dental absccess" is searched as "dental abscess". Built once from the same offline index.
  var vocabMap = null;
  function vocab() {
    if (vocabMap) return Promise.resolve(vocabMap);
    return loadLocalData().then(function (rows) {
      var v = {};
      for (var i = 0; i < rows.length; i++) { var w = titleWords(rows[i][1]); for (var j = 0; j < w.length; j++) if (w[j].length >= 4) v[w[j]] = 1; }
      if (rows.length) vocabMap = v;
      return v;
    });
  }

  var root = null, timer = null, seq = 0;
  var st = { view: "list", q: "", system: "", onSelect: null };

  // The 2026-11 look (flag smd_ref_ui2, default on, ref-ui.js + ref-ui.css). U2 is read on every open();
  // with the flag off, or ref-ui.js missing from the bundle, every branch below renders the earlier screen.
  var R = null, U2 = false;
  function readU2() { R = window.SMD_REFUI || null; U2 = !!(R && R.on()); }
  var EXAMPLES = ["diabetes", "E11", "1A00"];

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

  function sysBtn(val, label) {
    var on = st.system === val;
    return '<button type="button" class="icd-sys' + (on ? " on" : "") + '" data-sys="' + val + '" aria-pressed="' + (on ? "true" : "false") + '">' + label + '</button>';
  }
  function renderList() {
    setTitle(U2 ? (st.onSelect ? "Pick an ICD code" : "Search ICD") : (st.onSelect ? "Search ICD - pick a code" : "Search ICD"));
    var b = root.querySelector("#icdBody");
    b.innerHTML =
      (U2 ? R.searchBar({ id: "icdSearch", cls: "icd-search", wrap: "icd-searchbar", placeholder: "Diagnosis name or code", value: st.q, label: "Search ICD-10 and ICD-11 codes" })
        : '<div class="icd-searchbar">' + gsIco("search", "icd-ico icd-search-ic") +
          '<input id="icdSearch" class="icd-search" type="text" autocomplete="off" ' +
          'placeholder="Diagnosis name or code, e.g. diabetes, E11, 1A00" value="' + esc(st.q) + '"></div>') +
      '<div class="icd-row2"' + (U2 ? ' role="group" aria-label="Code system"' : "") + '>' +
        sysBtn("", "Both") + sysBtn("ICD-10", "ICD-10") + sysBtn("ICD-11", "ICD-11") +
      '</div>' +
      '<div id="icdResults" class="icd-results"' + (U2 ? ' aria-live="polite"' : "") + '></div>';
    var si = b.querySelector("#icdSearch");
    si.addEventListener("input", function () { onQueryInput(si.value); });
    si.addEventListener("keydown", function (e) { e.stopPropagation(); });
    if (U2) R.wireClear(si, function () { if (timer) clearTimeout(timer); st.q = ""; runQuery(); });
    b.querySelectorAll(".icd-sys").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = btn.getAttribute("data-sys");
        if (U2) {
          // Switch in place: the field keeps its focus and the keyboard stays up.
          if (v === st.system) return;
          st.system = v; R.hap("selection");
          b.querySelectorAll(".icd-sys").forEach(function (o) {
            var on = o.getAttribute("data-sys") === v;
            o.classList.toggle("on", on); o.setAttribute("aria-pressed", on ? "true" : "false");
          });
          clearPane(); runQuery(); return;
        }
        st.system = v; renderList();
      });
    });
    setTimeout(function () { try { si.focus(); } catch (e) {} }, 50);
    runQuery();
  }
  function clearPane() { if (root) root.classList.remove("icd-split"); dseq++; }
  function useExample(v) {
    var si = root.querySelector("#icdSearch"); if (!si) return;
    si.value = v;
    try { si.dispatchEvent(new Event("input")); } catch (e) {}
    if (timer) clearTimeout(timer);
    st.q = v; runQuery();
  }
  function onQueryInput(v) {
    st.q = (v || "").trim();
    if (timer) clearTimeout(timer);
    timer = setTimeout(runQuery, DEBOUNCE);
  }
  function runQuery() {
    var r = root.querySelector("#icdResults"); if (!r) return;
    if (st.q.length < MINLEN) {
      if (U2) {
        seq++;
        r.innerHTML = '<div class="icd-hint r2-state"><b class="r2-state-t">' + (st.onSelect ? "Find the code to add" : "Look up a diagnosis code") + '</b>' +
          '<span class="r2-state-x">Type a diagnosis name, or an ICD-10 or ICD-11 code.</span>' +
          '<div class="r2-chips" role="group" aria-label="Examples">' + EXAMPLES.map(function (x) {
            return '<button type="button" class="r2-chip" data-ex="' + esc(x) + '">' + esc(x) + '</button>';
          }).join("") + '</div></div>';
        r.querySelectorAll(".r2-chip").forEach(function (c) { c.addEventListener("click", function () { useExample(c.getAttribute("data-ex")); }); });
        return;
      }
      r.innerHTML = '<div class="icd-hint">Type a diagnosis name or an ICD-10/ICD-11 code to search.</div>';
      return;
    }
    r.innerHTML = U2 ? R.skeleton("Searching") : '<div class="icd-hint">Searching…</div>';
    var mySeq = ++seq, q = st.q;
    ICDAPI.search(q, st.system).then(function (d) {
      if (mySeq !== seq || q !== st.q) return;
      if (d == null) {
        if (U2) {
          r.innerHTML = R.state("icd-err", "Could not reach the ICD service", "Check your connection, then try again.", "retry");
          r.querySelector('[data-r2="retry"]').addEventListener("click", runQuery);
          return;
        }
        r.innerHTML = '<div class="icd-err">Could not reach the ICD service. Check your connection and try again.</div>'; return;
      }
      var rows = (d && d.results) || [];
      if (!rows.length) {
        r.innerHTML = U2
          ? R.state("icd-empty", "No code matches “" + esc(q) + "”", "Check the spelling or try a shorter term" + (st.system ? ". This search covers " + esc(st.system) + " only; Both searches the two together." : "."))
          : '<div class="icd-empty">No ICD-10/ICD-11 code matches “' + esc(q) + '”.</div>';
        return;
      }
      r.innerHTML = U2 ? '<div class="r2-list">' + rows.map(rowHTML).join("") + '</div>' : rows.map(rowHTML).join("");
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
    if (U2) {
      return '<button type="button" class="icd-card" data-id="' + esc(x.id) + '">' +
        '<span class="r2-main"><span class="icd-card-name">' + esc(g(x, "title")) + '</span>' +
        '<span class="r2-sub"><span class="r2-code">' + esc(g(x, "code")) + '</span><span>' + esc(g(x, "system")) + '</span>' +
        (g(x, "chapter") ? '<span>Chapter ' + esc(x.chapter) + '</span>' : "") + '</span></span>' +
        (st.onSelect ? R.PLUS : R.CHEV) + '</button>';
    }
    return '<button type="button" class="icd-card" data-id="' + esc(x.id) + '">' +
      '<div class="icd-card-code">' + esc(g(x, "code")) + '<span class="icd-card-sys">' + esc(g(x, "system")) + '</span></div>' +
      '<div class="icd-card-name">' + esc(g(x, "title")) + '</div>' +
      (g(x, "chapter") ? '<div class="icd-card-ch">' + esc(x.chapter) + '</div>' : "") +
    '</button>';
  }

  /* ---------------- detail view (stand-alone mode only) ---------------- */
  // iPad regular width (vault/plans/iPad-Standards.md): a picked code opens in a pane beside the list (.icd-split,
  // styled in ipad-clinical.css) instead of replacing it. Phones and narrow Split View never take this path.
  function splitOn() {
    return document.documentElement.classList.contains("smd-tablet") && window.innerWidth >= 1000;
  }
  var dseq = 0;
  function openDetailSplit(id) {
    var pane = root.querySelector(".icd-pane");
    if (!pane) { pane = document.createElement("div"); pane.className = "icd-pane"; pane.setAttribute("aria-live", "polite"); root.appendChild(pane); }
    root.classList.add("icd-split");
    root.querySelectorAll(".icd-card").forEach(function (c) { c.classList.toggle("sel", c.getAttribute("data-id") === id); });
    pane.innerHTML = U2 ? R.skeleton("Loading", 1) : '<div class="icd-hint">Loading…</div>';
    var mySeq = ++dseq;
    ICDAPI.code(id).then(function (d) {
      if (mySeq !== dseq) return;
      if (d == null || d.error) { detailError(pane, function () { openDetailSplit(id); }); return; }
      pane.innerHTML = detailHTML(d);
      wireDetail(pane, d);
    });
  }
  function detailError(box, retry) {
    if (!U2) { box.innerHTML = '<div class="icd-err">Could not load this code. Check your connection and try again.</div>'; return; }
    box.innerHTML = R.state("icd-err", "Could not load this code", "Check your connection, then try again.", "retry");
    box.querySelector('[data-r2="retry"]').addEventListener("click", retry);
  }
  // "CODE - Title", the same line the OPD note gets when a code is picked there.
  function wireDetail(box, d) {
    var btn = box.querySelector('[data-r2="copy"]'); if (!btn) return;
    btn.addEventListener("click", function () {
      R.copy(g(d, "code") + " - " + g(d, "title")).then(function (ok) {
        if (ok) R.hap("success");
        btn.textContent = ok ? "Copied" : "Could not copy";
        setTimeout(function () { btn.textContent = "Copy code and name"; }, 1600);
      });
    });
  }
  function detailHTML(d) {
    if (U2) {
      return '<div class="icd-dhead">' +
          '<div class="icd-dcode"><span>' + esc(g(d, "code")) + '</span><span class="icd-card-sys">' + esc(g(d, "system")) + '</span></div>' +
          '<div class="icd-dname">' + esc(g(d, "title")) + '</div>' +
          (g(d, "chapter") ? '<div class="icd-card-ch">Chapter ' + esc(d.chapter) + '</div>' : "") +
        '</div>' +
        '<button type="button" class="r2-btn r2-primary" data-r2="copy">Copy code and name</button>' +
        '<div class="icd-src">Source: WHO ' + esc(g(d, "system")) + ' public reference release. Classification reference data, no patient information.</div>';
    }
    return '<div class="icd-dhead">' +
        '<div class="icd-dcode">' + esc(g(d, "code")) + '<span class="icd-card-sys">' + esc(g(d, "system")) + '</span></div>' +
        '<div class="icd-dname">' + esc(g(d, "title")) + '</div>' +
        (g(d, "chapter") ? '<div class="icd-card-ch">Chapter/category ' + esc(d.chapter) + '</div>' : "") +
      '</div>' +
      '<div class="icd-src">Source: WHO ' + esc(g(d, "system")) + ' public reference release. Non-PHI classification reference data.</div>';
  }
  function openDetail(id) {
    if (splitOn() && root.querySelector("#icdResults")) { openDetailSplit(id); return; }
    st.view = "detail";
    setTitle("ICD code");
    var b = root.querySelector("#icdBody");
    b.innerHTML = U2 ? R.skeleton("Loading", 1) : '<div class="icd-hint">Loading…</div>';
    var mySeq = ++seq;
    ICDAPI.code(id).then(function (d) {
      if (mySeq !== seq || st.view !== "detail") return;
      if (d == null || d.error) { detailError(b, function () { openDetail(id); }); return; }
      setTitle(U2 ? (g(d, "system") || "ICD code") : (g(d, "code") || "ICD code"));
      b.innerHTML = detailHTML(d);
      wireDetail(b, d);
    });
  }

  /* ---------------- open() / pick() / close() ---------------- */
  function openWith(onSelect) {
    ensureRoot();
    readU2();
    root.classList.toggle("r2", U2);
    root.querySelector("#icdBack").innerHTML = U2 ? R.backHTML() : "‹ Back";
    root.classList.add("on");
    document.body.classList.add("icd-lock");
    root.classList.remove("icd-split"); dseq++;
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

  function openCode(id) { openWith(null); try { openDetail(id); } catch (e) {} }
  window.SMD_ICD = { open: open, pick: pick, close: close, localSearch: localSearch, vocab: vocab, openCode: openCode };
})();
