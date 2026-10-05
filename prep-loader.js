/* PrepNucleus loader: the only PrepNucleus file loaded at app boot. ES5.
   window.PREP starts as this small stand-in with the module's public surface (open, isOpen, back, close). The first
   open injects the stylesheets, specialty-core.js (FSRS), specialty-bank.js (search helpers), prep.js and the Layer C
   files, in order, at one ?v= token; prep.js replaces window.PREP with the real module and the call that started the load goes through to it.
   Flag smd_prep: default OFF while the bank is being filled. localStorage smd_prep = "1" or ?prep=1 turns it on,
   "0" or ?prep=0 turns it off (same rule as the home tile in home.js). */
(function (G) {
  "use strict";
  var V = "prep2";
  // Layer C (prep-source, prep-decks, prep-cards, prep-create) after prep.js; prep-create.js reads the two before it.
  var CSS = ["prep.css", "prep-create.css"];
  var JS = ["specialty-core.js", "specialty-bank.js", "prep.js", "prep-teacher.js", "prep-source.js", "prep-decks.js", "prep-cards.js", "prep-create.js"];
  var loading = null;

  function enabled() {
    try { var q = (G.location.search.match(/[?&]prep=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; return G.localStorage.getItem("smd_prep") === "1"; } catch (e) { return false; }
  }
  function css(href) {
    if (G.document.querySelector('link[data-prep="' + href + '"]')) return;
    var l = G.document.createElement("link");
    l.rel = "stylesheet"; l.href = "/" + href + "?v=" + V; l.setAttribute("data-prep", href);
    G.document.head.appendChild(l);
  }
  // async = false keeps the order; a retry re-adds only what did not load, so nothing runs twice. The engine files may
  // already be on the page (Tokós): each is skipped when its global exists.
  var done = {};
  function js(src) {
    if (done[src] || (src === "specialty-core.js" && G.SPECIALTY_CORE) || (src === "specialty-bank.js" && G.SPECIALTY && G.SPECIALTY.BANK)) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = G.document.createElement("script");
      s.src = "/" + src + "?v=" + V; s.async = false;
      s.onload = function () { done[src] = 1; res(); }; s.onerror = function () { rej(new Error(src)); };
      G.document.head.appendChild(s);
    });
  }
  function load() {
    if (loading) return loading;
    CSS.forEach(css);
    loading = Promise.all(JS.map(js)).then(function () { return G.PREP; }, function (e) { loading = null; throw e; });
    return loading;
  }
  function fail() { try { if (G.toast) G.toast("PrepNucleus could not load. Check your connection and try again."); } catch (e) {} }
  function real() { return G.PREP && G.PREP !== stub ? G.PREP : null; }

  var stub = {
    open: function (opts) { if (!enabled()) return false; load().then(function () { var p = real(); if (p) p.open(opts); else fail(); }, fail); return true; },
    isOpen: function () { return false; },
    back: function () { return false; },
    close: function () {}
  };
  G.PREP_LOADER = { load: load, enabled: enabled, V: V, CSS: CSS, JS: JS };
  if (!G.PREP) G.PREP = stub;
})(typeof window !== "undefined" ? window : this);
