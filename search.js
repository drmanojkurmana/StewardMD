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

  /* ---------- browser part is added in Tasks 3 and 4 ---------- */
})();
