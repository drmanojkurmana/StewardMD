/* Kardia loader: the only Kardia file loaded at app boot. ES5.
   window.KARDIA starts as this small stand-in with the module's public surface (open, openCase, isOpen, back, close).
   The first open injects the engine and Kardia stylesheets and scripts, in order, all at one ?v= token.
   kardia.js replaces window.KARDIA with the real host, and the call that started the load goes through to it.
   Flag (same rule as the home tile in home.js): localStorage smd_kardia = "1" or ?kardia=1 for this load.
   DEFAULT OFF for everyone; there is no early-access tier. */
(function (G) {
  "use strict";
  var V = "krd5";
  var CSS = ["specialty.css", "kardia.css", "kardia-syncprobe.css", "kardia-cases.css", "kardia-practice.css", "kardia-echolab.css", "kardia-scanlab.css"];
  var JS = ["specialty-core.js", "specialty-data.js", "specialty-stage.js", "specialty-shell.js", "specialty-learn.js", "specialty-bank.js", "kardia-flags.js", "kardia-sim-heart.js", "kardia-sim-geom.js", "kardia-sim-us.js", "kardia-sim-probe.js", "kardia-sim-doppler.js", "kardia-sim-measure.js", "kardia-echolab.js", "kardia-scan-targets.js", "kardia-scanlab.js", "kardia.js", "kardia-sync.js", "kardia-sync-ble.js", "kardia-sync-relay.js", "kardia-syncprobe.js", "clinix-audio.js", "kardiox-ecgwave.js", "kardia-cases.js", "kardia-clips.js", "kardia-practice.js"];
  /* Transport adapters load best effort: a missing file must not stop Kardia loading. */
  var OPTIONAL = { "kardia-sync-ble.js": 1, "kardia-sync-relay.js": 1 };
  var loading = null;

  function enabled() {
    try { if (G.SMD_KARDIA_FLAGS && G.SMD_KARDIA_FLAGS.bool) return !!G.SMD_KARDIA_FLAGS.bool("smd_kardia"); } catch (e) {}
    try { var q = (G.location.search.match(/[?&]kardia=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; return G.localStorage.getItem("smd_kardia") === "1"; } catch (e) { return false; }
  }
  function css(href) {
    if (G.document.querySelector('link[data-kardia="' + href + '"]')) return;
    var l = G.document.createElement("link");
    l.rel = "stylesheet"; l.href = "/" + href + "?v=" + V; l.setAttribute("data-kardia", href);
    G.document.head.appendChild(l);
  }
  // Scripts added with async = false run in the order they were added, each after the one before. A retry after a
  // failed load re-adds only the scripts that did not load, so no file (kardia.js: createHost) runs twice.
  var done = {};
  function js(src) {
    if (done[src]) return Promise.resolve();
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
    loading = Promise.all(JS.map(function (src) { return OPTIONAL[src] ? js(src).then(function () {}, function () { done[src] = 1; }) : js(src); })).then(function () { return G.KARDIA; }, function (e) { loading = null; throw e; });
    return loading;
  }
  function fail() { try { if (G.toast) G.toast("Kardia could not load. Check your connection and try again."); } catch (e) {} }
  function real() { return G.KARDIA && G.KARDIA !== stub ? G.KARDIA : null; }

  var stub = {
    open: function () { if (!enabled()) return false; load().then(function () { var t = real(); if (t) t.open(); else fail(); }, fail); return true; },
    openCase: function () { if (!enabled()) return false; return load().then(function () { var t = real(); if (!t) fail(); return t ? t.openCase.apply(t, arguments) : false; }, function () { fail(); return false; }); },
    isOpen: function () { return false; },
    back: function () { return false; },
    close: function () {}
  };
  G.KARDIA_LOADER = { load: load, enabled: enabled, V: V, CSS: CSS, JS: JS };
  if (!G.KARDIA) G.KARDIA = stub;
})(typeof window !== "undefined" ? window : this);
