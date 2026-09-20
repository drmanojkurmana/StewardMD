/* search.js - Universal in-app search. Hand-written, ES5. Wraps window.openSearch (a global in
 * app.js) and shows its own panel; never edits app.js. Kill switch: ?usearch=0 or
 * localStorage smd_universal_search=0 (then this file is a no-op and the legacy panel runs). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  /* ---------- ranking (pure; unit-tested under node) ---------- */
  var CATS = [
    { key: "tools",    label: "Tools",        icon: "grid",     weight: 5 },
    { key: "calcs",    label: "Calculators",  icon: "calc",     weight: 0 },
    { key: "drugs",    label: "Drugs",        icon: "pills",    weight: 0 },
    { key: "kb",       label: "Diseases",     icon: "book",     weight: -5 },
    { key: "syn",      label: "Syndromes",    icon: "microbe",  weight: 0 },
    { key: "icd",      label: "ICD codes",    icon: "list",     weight: -2 },
    { key: "settings", label: "Settings",     icon: "settings", weight: 0 }
  ];
  var CAT_WEIGHT = {}; CATS.forEach(function (c) { CAT_WEIGHT[c.key] = c.weight; });

  function terms(q) {
    return String(q || "").toLowerCase().trim().split(/\s+/).filter(function (t) { return t.length > 0; });
  }
  function lev(a, b) {
    if (typeof G.lev === "function") return G.lev(a, b);      // app.js:20 global when present
    var m = a.length, n = b.length, i, j, prev, cur, tmp;
    if (!m) return n; if (!n) return m;
    prev = []; for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        tmp = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + tmp);
      }
      prev = cur;
    }
    return prev[n];
  }
  function fuzzyWord(t, hay) {
    if (t.length < 4) return false;
    var toks = hay.split(/[^a-z0-9]+/), max = t.length <= 5 ? 1 : 2, i, w;
    for (i = 0; i < toks.length; i++) {
      w = toks[i]; if (!w || w.length < 3) continue;
      if (Math.abs(w.length - t.length) <= max && lev(t, w) <= max) return true;
    }
    return false;
  }
  function termScore(t, title, aux) {
    if (title === t) return 100;
    if (title.indexOf(t) === 0) return 90;
    if ((" " + title).indexOf(" " + t) >= 0) return 80;
    if (title.indexOf(t) >= 0) return 60;
    if (aux.indexOf(t) >= 0) return 40;
    if (fuzzyWord(t, title + " " + aux)) return 25;
    return 0;
  }
  function score(ts, item) {
    if (!ts.length) return 0;
    var title = String(item.title || "").toLowerCase();
    var aux = (String(item.sub || "") + " " + String(item.kw || "")).toLowerCase();
    var sum = 0, i, s;
    for (i = 0; i < ts.length; i++) { s = termScore(ts[i], title, aux); if (!s) return 0; sum += s; }
    return sum / ts.length;
  }
  function rank(q, items, opts) {
    var ts = terms(q), out = [], i, s;
    for (i = 0; i < items.length; i++) { s = score(ts, items[i]); if (s > 0) out.push({ it: items[i], s: s }); }
    out.sort(function (a, b) {
      return (b.s - a.s) || ((CAT_WEIGHT[b.it.cat] || 0) - (CAT_WEIGHT[a.it.cat] || 0)) ||
        (String(a.it.title).localeCompare(String(b.it.title)));
    });
    var lim = (opts && opts.limit) || out.length;
    return out.slice(0, lim).map(function (x) { return x.it; });
  }

  /* ---------- providers ---------- */
  // Static keyword aliases for tools; the tile title alone rarely matches what a doctor types.
  var TOOL_KW = {
    retinalscan: "fundus retina eye fundx", kardiox: "ecg electrocardiogram kardiq heart",
    thorex: "chest xray cxr radiograph", sknx: "skin derm lesion rash dermatology",
    clinix: "learning students clinical skills viva osce", surgx: "surgery surgical notes procedures protocols",
    pglog: "logbook nmc pg residents e-logbook", followcare: "follow up discharge recovery",
    maitri: "maitri patient companion", queue: "opd queue token clinic outpatient",
    oncohome: "oncology cancer oncqis chemo", oncotree: "oncology tree staging",
    dictate: "dictate voice scribe transcription notes", interactions: "scan meds prescription interactions ddi photo",
    guidelines: "guidelines protocols reference", atlas: "radiology anatomy ct mri atlas radioanatome",
    electrolytes: "electrolytes sodium potassium correction", hospital: "hospital hub ward icu opd",
    govschemes: "scheme pmjay arogyasri insurance package rates", icdsearch: "icd code diagnosis coding icd10 icd11",
    icu: "icu critical care patients labs", ward: "ghis ward sync labs radiology inpatient",
    connect: "emr hospital connect integration", agentconnect: "connect hospital emr onboarding",
    startcase: "new case antibiotic", reasoning: "differential diagnosis dx reasoning",
    askai: "maik ai ask assistant chat", drugmenu: "drugs medicines brands database prices",
    calculators: "calculator score crcl meld gcs sofa", dosing: "dose dosing bedside",
    insulin: "insulin glucose sliding scale diabetes", syndromes: "antibiotic empirical syndromes infection",
    antibiogram: "antibiogram resistance culture sensitivity"
  };
  // Actions reachable from ACT (home.js:771-1004) that are not home tiles.
  var EXTRA_TOOLS = [
    { act: "cases", tt: "My Cases", sub: "Saved cases", kw: "cases saved patients" },
    { act: "recent", tt: "Recent", sub: "Last 5 cases", kw: "recent history" },
    { act: "theme", tt: "Appearance", sub: "Theme and dark mode", kw: "dark mode light theme colour appearance" },
    { act: "about", tt: "About StewardMD", sub: "Version and licence", kw: "about version" },
    { act: "drugs", tt: "Drugs database", sub: "Generics, brands, prices", kw: "drug database brands prices" },
    { act: "customizetools", tt: "Customize home tools", sub: "Show, hide, reorder tiles", kw: "customize tiles reorder home" }
  ];
  function route(act) { return function () { if (G.SMD_openRoute) G.SMD_openRoute(act); }; }
  function toolsProvider() {
    var out = [], list = [];
    try { list = G.SMD_HOME_TOOLS ? G.SMD_HOME_TOOLS() : []; } catch (e) { list = []; }
    list.forEach(function (t) { out.push({ cat: "tools", id: t.act, title: t.tt, sub: t.sub, kw: TOOL_KW[t.act] || "", open: route(t.act) }); });
    EXTRA_TOOLS.forEach(function (t) { out.push({ cat: "tools", id: t.act, title: t.tt, sub: t.sub, kw: t.kw, open: route(t.act) }); });
    return out;
  }
  function calcsProvider() {
    var cs = (G.MEDCALC && G.MEDCALC._calcs) || [];
    return cs.map(function (c) {
      return { cat: "calcs", id: c.id, title: c.title, sub: c.cat || "", kw: ((c.desc || "") + " " + [].concat(c.kw || []).join(" ") + " " + c.id),
        open: function () { G.MEDCALC.open(c.id); } };
    });
  }
  function synProvider() {
    var S = G.SYNDROMES || {}, out = [], k, s;
    for (k in S) { s = S[k]; if (!s) continue;
      out.push({ cat: "syn", id: k, title: s.name || k, sub: s.system || "", kw: ((s.aliases || []).join(" ") + " " + (s.tags || []).join(" ") + " " + k),
        open: (function (key) { return function () { if (G.openSynResult) G.openSynResult(key); }; })(k) });
    }
    return out;
  }
  function settingsProvider() {
    var list = [];
    try { list = G.SMD_SETTINGS_INDEX ? G.SMD_SETTINGS_INDEX() : []; } catch (e) { list = []; }
    return list.map(function (t) {
      return { cat: "settings", id: t.key, title: t.title, sub: t.sub || "", kw: t.key.replace(/_/g, " "),
        open: function () {
          if (t.group === "exp" && G.SMD_openExperimental) G.SMD_openExperimental(); else if (G.SMD_openSettings) G.SMD_openSettings();
          setTimeout(function () {                       // scroll the row into view; the title is rendered in .sbr-tg-t
            var els = document.querySelectorAll(".sbr-tg-t"), i;
            for (i = 0; i < els.length; i++) if (els[i].textContent.trim() === t.title) { els[i].scrollIntoView({ block: "center" }); els[i].classList.add("us-flash"); break; }
          }, 120);
        } };
    });
  }
  function kbProvider(q) {
    return new Promise(function (res) {
      var hits = [];
      try { hits = (G.SMD_KB && G.SMD_KB.search) ? G.SMD_KB.search(q, 40) : []; } catch (e) { hits = []; }
      res(hits.map(function (d) { return { cat: "kb", id: d.id, title: d.name, sub: d.sys || "", kw: "", open: function () { G.SMD_KB.open(d.id); } }; }));
    });
  }
  function drugsProvider(q) {
    var local = [], B = (G.SMD_BRANDS && G.SMD_BRANDS.BRANDS) || {}, ql = q.toLowerCase(), k;
    for (k in B) if (k.indexOf(ql) === 0) B[k].forEach(function (gen) {          // brand typed: its generics show instantly
      local.push({ cat: "drugs", id: gen, title: gen, sub: "Brand: " + k, kw: k, open: (function (g) { return function () { G.MEDDB.openComposition(g); }; })(gen) });
    });
    if (!G.MEDAPI || !G.MEDAPI.searchCompositions) return Promise.resolve(local);
    return G.MEDAPI.searchCompositions(q, 12).then(function (d) {
      var seen = {}; local.forEach(function (x) { seen[x.title.toLowerCase()] = 1; });
      ((d && d.results) || []).forEach(function (r) {
        var name = r.composition || ""; if (!name || seen[name.toLowerCase()]) return; seen[name.toLowerCase()] = 1;
        local.push({ cat: "drugs", id: name, title: name, sub: r["class"] || "Generic", kw: "", open: function () { G.MEDDB.openComposition(name); } });
      });
      return local;
    }, function () { return local; });
  }
  function icdProvider(q) {
    if (!G.SMD_ICD || !G.SMD_ICD.localSearch) return Promise.resolve([]);
    return G.SMD_ICD.localSearch(q, 10).then(function (rows) {
      return (rows || []).map(function (r) { return { cat: "icd", id: r.id, title: r.code + "  " + r.title, sub: r.system || "", kw: "", open: function () { G.SMD_ICD.openCode(r.id); } }; });
    }, function () { return []; });
  }
  function providers() {
    return [
      { cat: "tools", items: toolsProvider }, { cat: "calcs", items: calcsProvider },
      { cat: "drugs", query: drugsProvider }, { cat: "kb", query: kbProvider },
      { cat: "syn", items: synProvider }, { cat: "icd", query: icdProvider },
      { cat: "settings", items: settingsProvider }
    ];
  }
  function askItem(q) {
    return { cat: "ask", id: "ask", title: 'Ask MaiK about "' + q + '"', sub: "Grounded clinical AI", kw: "",
      open: function () { if (G.SMD_askMaik) G.SMD_askMaik(q); else if (G.SMD_openRoute) G.SMD_openRoute("askai"); } };
  }

  var API = { CATS: CATS, terms: terms, score: score, rank: rank, providers: providers, askItem: askItem, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_SEARCH = API;
  if (typeof document === "undefined") return;   // node: ranking only

  /* ---------- kill switch ---------- */
  function killed() {
    try { var m = (location.search.match(/[?&]usearch=([^&]+)/) || [])[1]; if (m != null) return m === "0"; } catch (e) {}
    try { return localStorage.getItem("smd_universal_search") === "0"; } catch (e) { return false; }
  }
  if (killed()) return;

  /* ---------- state ---------- */
  var ST = { q: "", cat: "all", sel: -1, token: 0, async: {}, _flat: [], _ask: null };   // async[cat] = { pending, items }
  var SYNC_LIMIT_ALL = 4, FILTER_LIMIT = 200, ASYNC_DEBOUNCE = 200, MINLEN_ASYNC = 2;
  var RECENT_KEY = "smd_recent_searches", RECENT_MAX = 8;        // same key reasoning.js:3234 already uses
  function ico(n, c) { return (G.ICONS && G.ICONS.get) ? G.ICONS.get(n, c || "us-ico") : ""; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function recentGet() { try { var a = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(a) ? a.filter(function (x) { return typeof x === "string"; }) : []; } catch (e) { return []; } }
  function recentPush(q) {
    q = String(q || "").trim(); if (q.length < 2 || q.length > 60) return;
    try { var a = recentGet().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); }); a.unshift(q); localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, RECENT_MAX))); } catch (e) {}
  }
  function recentDel(q) {
    q = String(q || "").trim();
    try { var a = recentGet().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); }); localStorage.setItem(RECENT_KEY, JSON.stringify(a)); } catch (e) {}
    render();
  }
  function recentClear() { try { localStorage.removeItem(RECENT_KEY); } catch (e) {} render(); }

  /* ---------- DOM ---------- */
  var root = null, input = null, body = null, chips = null, clearBtn = null, backdrop = null;
  function ensureDOM() {
    if (root) return;
    backdrop = document.createElement("div"); backdrop.id = "usBackdrop"; backdrop.className = "us-backdrop"; backdrop.hidden = true;
    root = document.createElement("section"); root.id = "usPanel"; root.className = "us-panel"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Search StewardMD"); root.hidden = true;
    root.innerHTML =
      '<header class="us-head">' +
        '<div class="us-field">' + ico("search") +
          '<input id="usInput" class="us-input" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search StewardMD" aria-controls="usBody" placeholder="Search tools, drugs, scores, diseases, codes, settings">' +
          '<button id="usClear" class="us-clear" type="button" aria-label="Clear search" hidden>' + ico("x") + '</button>' +
        '</div>' +
        '<button id="usCancel" class="us-cancel" type="button">Cancel</button>' +
      '</header>' +
      '<div id="usChips" class="us-chips" role="group" aria-label="Filter by category"></div>' +
      '<div id="usBody" class="us-body" role="listbox" aria-label="Results"></div>';
    document.body.appendChild(backdrop); document.body.appendChild(root);
    input = root.querySelector("#usInput"); body = root.querySelector("#usBody"); chips = root.querySelector("#usChips"); clearBtn = root.querySelector("#usClear");
    input.addEventListener("input", function () { setQuery(input.value); });
    input.addEventListener("keydown", onKey);
    clearBtn.addEventListener("click", function () { setQuery(""); input.focus(); });
    root.querySelector("#usCancel").addEventListener("click", close);
    backdrop.addEventListener("click", close);
    chips.addEventListener("click", function (e) { var b = e.target.closest(".us-chip"); if (b) { ST.cat = b.getAttribute("data-cat"); ST.sel = -1; render(); } });
    body.addEventListener("click", function (e) {
      var more = e.target.closest(".us-more"); if (more) { ST.cat = more.getAttribute("data-cat"); ST.sel = -1; render(); return; }
      var rdel = e.target.closest(".us-recent-del");
      if (rdel) {
        var prc = rdel.closest(".us-recent");
        if (prc) recentDel(prc.getAttribute("data-q"));
        return;
      }
      var rc = e.target.closest(".us-recent"); if (rc) { setQuery(rc.getAttribute("data-q")); return; }
      var cl = e.target.closest("#usRecentClear"); if (cl) { recentClear(); return; }
      var br = e.target.closest(".us-browse"); if (br) { ST.cat = br.getAttribute("data-cat"); render(); return; }
      var row = e.target.closest(".us-row"); if (row) activate(row);
    });
  }

  /* ---------- querying ---------- */
  var asyncTimer = null;
  function setQuery(q) {
    ST.q = q; ST.sel = -1; if (input && input.value !== q) input.value = q;
    clearBtn.hidden = !q;
    clearTimeout(asyncTimer);
    var tok = ++ST.token;
    ST.async = {};
    if (terms(q).join(" ").length >= MINLEN_ASYNC) {
      providers().forEach(function (p) { if (p.query) ST.async[p.cat] = { pending: true, items: [] }; });
      asyncTimer = setTimeout(function () {
        providers().forEach(function (p) {
          if (!p.query) return;
          p.query(q).then(function (items) {
            if (tok !== ST.token) return;                        // stale response; a newer query is live
            ST.async[p.cat] = { pending: false, items: rank(q, items) };
            render();
          }).catch(function () {
            if (tok !== ST.token) return;
            ST.async[p.cat] = { pending: false, items: [] };
            render();
          });
        });
      }, ASYNC_DEBOUNCE);
    }
    render();                                                    // local results and skeletons: synchronous, no debounce
  }
  function collect() {                                           // -> { cat: item[] } for the current query
    var out = {}, q = ST.q, hasQ = terms(q).length > 0;
    providers().forEach(function (p) {
      if (p.items) { var its = p.items(); out[p.cat] = hasQ ? rank(q, its) : its.slice().sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); }); }
      else out[p.cat] = ST.async[p.cat] ? ST.async[p.cat].items : [];
    });
    return out;
  }

  /* ---------- rendering ---------- */
  function rowHTML(it, idx, catIcon) {
    return '<button id="us-row-' + idx + '" class="us-row" role="option" type="button" data-cat="' + esc(it.cat) + '" data-id="' + esc(it.id) + '" data-idx="' + idx + '" aria-selected="' + (idx === ST.sel) + '">' +
      '<span class="us-row-ico">' + ico(catIcon) + '</span>' +
      '<span class="us-row-txt"><span class="us-row-t">' + esc(it.title) + '</span>' + (it.sub ? '<span class="us-row-s">' + esc(it.sub) + '</span>' : "") + '</span>' +
      ico("chev", "us-ico us-row-chev") + '</button>';
  }
  function skeletonHTML() { return '<div class="us-skel" aria-hidden="true"><i></i><i></i><i></i></div>'; }
  function visibleCat(c) { return ST.cat === "all" || ST.cat === c.key; }
  function render() {
    if (!root) return;
    var q = ST.q, hasQ = terms(q).length > 0, byCat = collect(), html = "", idx = 0, shownCats = [], total = 0, cap = ST.cat === "all" ? SYNC_LIMIT_ALL : FILTER_LIMIT;
    CATS.forEach(function (c) { var n = (byCat[c.key] || []).length, pend = !!(ST.async[c.key] && ST.async[c.key].pending); if (n || pend) { shownCats.push({ c: c, n: n }); total += n; } });
    ST._flat = []; ST._ask = null;
    if (!hasQ && ST.cat === "all") {                             // zero state: recents + browse
      chips.innerHTML = "";
      var rec = recentGet();
      if (rec.length) {
        html += '<div class="us-sec"><div class="us-sec-h">' + ico("clock") + ' Recent searches<button id="usRecentClear" class="us-link" type="button">Clear all</button></div><div class="us-recents">' +
          rec.map(function (r) { return '<span class="us-recent" data-q="' + esc(r) + '"><span class="us-recent-txt">' + esc(r) + '</span><button class="us-recent-del" type="button" aria-label="Remove ' + esc(r) + '">&times;</button></span>'; }).join("") + '</div></div>';
      }
      html += '<div class="us-sec"><div class="us-sec-h">Browse</div><div class="us-browse-grid">' +
        CATS.map(function (c) { return '<button class="us-browse" type="button" data-cat="' + c.key + '">' + ico(c.icon) + '<span>' + esc(c.label) + '</span></button>'; }).join("") + '</div></div>';
      body.innerHTML = html; return;
    }
    chips.innerHTML = '<button class="us-chip" type="button" data-cat="all" aria-pressed="' + (ST.cat === "all") + '">All' + (hasQ ? ' <b>' + total + '</b>' : "") + '</button>' +
      (hasQ ? shownCats : CATS.map(function (c) { return { c: c, n: 0 }; })).map(function (x) { return '<button class="us-chip" type="button" data-cat="' + x.c.key + '" aria-pressed="' + (ST.cat === x.c.key) + '">' + esc(x.c.label) + (x.n ? ' <b>' + x.n + '</b>' : "") + '</button>'; }).join("");
    CATS.forEach(function (c) {
      if (!visibleCat(c)) return;
      var items = byCat[c.key] || [], pend = !!(ST.async[c.key] && ST.async[c.key].pending), shown = items.slice(0, cap);
      if (!items.length && !pend) {
        if (!hasQ && ST.cat === c.key) html += '<div class="us-empty"><div class="us-empty-t">Type to search ' + esc(c.label.toLowerCase()) + '</div></div>';
        return;
      }
      html += '<div class="us-sec" data-cat="' + c.key + '"><div class="us-sec-h">' + ico(c.icon) + " " + esc(c.label) + '</div>';
      if (pend && !items.length) html += skeletonHTML();
      shown.forEach(function (it) { html += rowHTML(it, idx++, c.icon); ST._flat.push(it); });
      if (items.length > cap) html += '<button class="us-more" type="button" data-cat="' + c.key + '">See all ' + items.length + '</button>';
      html += '</div>';
    });
    if (hasQ) {
      if (!total) html += '<div class="us-empty"><div class="us-empty-t">No results for "' + esc(q) + '"</div><div class="us-empty-s">Check the spelling, or try a brand name or a score name.</div></div>';
      ST._ask = askItem(q);
      html += '<div class="us-sec" data-cat="ask"><div class="us-sec-h">' + ico("ai") + ' Ask</div>' + rowHTML(ST._ask, idx++, "spark") + '</div>';
      ST._flat.push(ST._ask);
    }
    body.innerHTML = html;
  }

  /* ---------- activation and keyboard ---------- */
  function activate(rowEl) {
    var i = Number(rowEl.getAttribute("data-idx")), it = ST._flat[i]; if (!it) return;
    if (ST.q) recentPush(ST.q);
    close();
    try { it.open(); } catch (e) {}
  }
  function onKey(e) {
    var rows = body.querySelectorAll(".us-row"), n = rows.length, i;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!n) return; e.preventDefault();
      ST.sel = e.key === "ArrowDown" ? Math.min(n - 1, ST.sel + 1) : Math.max(0, ST.sel - 1);
      for (i = 0; i < n; i++) rows[i].setAttribute("aria-selected", String(i === ST.sel));
      if (input) input.setAttribute("aria-activedescendant", ST.sel >= 0 ? "us-row-" + ST.sel : "");
      rows[ST.sel].scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); if (!n) return; activate(rows[ST.sel >= 0 ? ST.sel : 0]); }
  }

  /* ---------- open / close ---------- */
  var closeTimer = null;
  function open() {
    ensureDOM();
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    ST.cat = "all"; ST.sel = -1; ST.async = {};
    root.hidden = false; backdrop.hidden = false;
    document.body.classList.add("us-open");
    requestAnimationFrame(function () { root.classList.add("on"); });
    setQuery(input.value);
    input.focus();                                               // synchronous: same tap, keyboard rises on iOS
  }
  function close() {
    if (!root || root.hidden) return;
    root.classList.remove("on"); document.body.classList.remove("us-open");
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    var done = function () {
      if (root && root.classList.contains("on")) return;         // reopened before transition finished
      if (root) root.hidden = true;
      if (backdrop) backdrop.hidden = true;
      if (root) root.removeEventListener("transitionend", done);
    };
    root.addEventListener("transitionend", done);
    closeTimer = setTimeout(done, 220);   // reduced-motion may never fire transitionend
    input.blur();
  }

  API.open = open; API.close = close; API.setQuery = function (q) { ensureDOM(); setQuery(q); };

  /* ---------- wrap the app.js globals ---------- */
  function wrap() {
    G.openSearch = open; G.closeSearch = close;                 // header button onclick, ACT.search, kbOpen all route here
    G.doSearch = function (q) { open(); setQuery(q); };
    G.clearSearch = function () { setQuery(""); };
    var btn = document.getElementById("smdSearchBtn"); if (btn) btn.setAttribute("title", "Search anything in StewardMD (Cmd+K)");
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (root && !root.hidden && root.classList.contains("on")) close(); else open();
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(wrap, 0); });
  else setTimeout(wrap, 0);                                      // after app.js's own DOMContentLoaded listener
})();
