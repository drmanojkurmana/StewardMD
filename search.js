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

  var API = { CATS: CATS, terms: terms, score: score, rank: rank, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_SEARCH = API;
  if (typeof document === "undefined") return;   // node: ranking only

  /* ---------- browser part is added in Tasks 3 and 4 ---------- */
})();
