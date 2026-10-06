/* Narkē loader: the only Narkē file loaded at app boot. ES5.
   window.NARKE starts as this small stand-in with the module's public surface (open, openCase, isOpen, back, close).
   The first open injects the engine and Narkē stylesheets and scripts, in order, all at one ?v= token, then the
   models listed in narke/models.json (an ordered list: a shared core before the models that use it). narke.js
   replaces window.NARKE with the real host, and the call that started the load goes through to it.
   Kill switch (same rule as the home tile in home.js): localStorage smd_narke = "0" or ?narke=0 for this load. */
(function (G) {
  "use strict";
  var V = "nrk2";
  var CSS = ["specialty.css", "narke.css", "narke-explore-ui.css", "narke-clinic.css"];
  var JS = ["specialty-core.js", "specialty-data.js", "specialty-stage.js", "specialty-shell.js", "specialty-learn.js", "specialty-bank.js",
    "specialty-explore.js", "specialty-tools.js", "specialty-notes.js", "narke.js", "narke-explore-ui.js", "narke-clinic.js"];
  var BASE = G.SMD_NARKE_BASE || "/narke/";
  var loading = null;

  function enabled() {
    try { var q = (G.location.search.match(/[?&]narke=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; return G.localStorage.getItem("smd_narke") !== "0"; } catch (e) { return true; }
  }
  function css(href) {
    if (G.document.querySelector('link[data-narke="' + href + '"]')) return;
    var l = G.document.createElement("link");
    l.rel = "stylesheet"; l.href = "/" + href + "?v=" + V; l.setAttribute("data-narke", href);
    G.document.head.appendChild(l);
  }
  // Scripts added with async = false run in the order they were added, each after the one before. A retry after a
  // failed load re-adds only the scripts that did not load, so no file (narke.js: createHost) runs twice.
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
  function models() {
    return G.fetch(BASE + "models.json").then(function (r) { return r.ok ? r.json() : { models: [] }; }, function () { return { models: [] }; })
      .then(function (m) {
        var ids = ((m && m.models) || []).filter(function (id) { return /^[a-z0-9-]+$/.test(id); });
        return Promise.all(ids.map(function (id) { return js("narke-models/" + id + ".js").then(null, function () {}); }));
      });
  }
  function load() {
    if (loading) return loading;
    CSS.forEach(css);
    loading = Promise.all(JS.map(js)).then(models).then(function () {
      var T = G.NARKE;
      if (T && T._syncModels) T._syncModels();
      return T;
    }, function (e) { loading = null; throw e; });
    return loading;
  }
  function fail() { try { if (G.toast) G.toast("Narkē could not load. Check your connection and try again."); } catch (e) {} }
  function real() { return G.NARKE && G.NARKE !== stub ? G.NARKE : null; }

  var stub = {
    // Loaded but no host (a script failed to run): the same retry message as a failed download.
    open: function () { if (!enabled()) return false; load().then(function () { var t = real(); if (t) t.open(); else fail(); }, fail); return true; },
    // Review Desk "Read it": false when switched off, as the real openCase answers.
    openCase: function (id) { if (!enabled()) return false; return load().then(function () { var t = real(); if (!t) fail(); return t ? t.openCase(id) : false; }, function () { fail(); return false; }); },
    isOpen: function () { return false; },
    back: function () { return false; },
    close: function () {}
  };
  G.NARKE_LOADER = { load: load, enabled: enabled, V: V, CSS: CSS, JS: JS };
  if (!G.NARKE) G.NARKE = stub;
})(typeof window !== "undefined" ? window : this);
