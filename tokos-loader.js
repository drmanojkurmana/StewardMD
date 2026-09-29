/* Tokós loader: the only Tokós file loaded at app boot. ES5.
   window.TOKOS starts as this small stand-in with the module's public surface (open, openCase, isOpen, back, close).
   The first open injects the engine and Tokós stylesheets and scripts, in order, all at one ?v= token, then the
   models listed in tokos/models.json (an ordered list: a shared core before the models that use it). tokos.js
   replaces window.TOKOS with the real host, and the call that started the load goes through to it.
   Kill switch (same rule as the home tile in home.js): localStorage smd_tokos = "0" or ?tokos=0 for this load. */
(function (G) {
  "use strict";
  var V = "tok5";
  var CSS = ["specialty.css", "tokos.css", "tokos-sim-labour.css", "tokos-explore-ui.css", "tokos-clinic-us.css"];
  var JS = ["specialty-core.js", "specialty-data.js", "specialty-stage.js", "specialty-shell.js", "specialty-learn.js", "specialty-bank.js",
    "specialty-explore.js", "specialty-tools.js", "specialty-notes.js", "tokos.js", "tokos-calipers.js", "tokos-ctg.js", "tokos-sim-labour.js", "tokos-explore-ui.js", "tokos-clinic-us.js"];
  var BASE = G.SMD_TOKOS_BASE || "/tokos/";
  var loading = null;

  function enabled() {
    try { var q = (G.location.search.match(/[?&]tokos=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; return G.localStorage.getItem("smd_tokos") !== "0"; } catch (e) { return true; }
  }
  function css(href) {
    if (G.document.querySelector('link[data-tokos="' + href + '"]')) return;
    var l = G.document.createElement("link");
    l.rel = "stylesheet"; l.href = "/" + href + "?v=" + V; l.setAttribute("data-tokos", href);
    G.document.head.appendChild(l);
  }
  // Scripts added with async = false run in the order they were added, each after the one before.
  function js(src) {
    return new Promise(function (res, rej) {
      var s = G.document.createElement("script");
      s.src = "/" + src + "?v=" + V; s.async = false;
      s.onload = res; s.onerror = function () { rej(new Error(src)); };
      G.document.head.appendChild(s);
    });
  }
  function models() {
    return G.fetch(BASE + "models.json").then(function (r) { return r.ok ? r.json() : { models: [] }; }, function () { return { models: [] }; })
      .then(function (m) {
        var ids = ((m && m.models) || []).filter(function (id) { return /^[a-z0-9-]+$/.test(id); });
        return Promise.all(ids.map(function (id) { return js("tokos-models/" + id + ".js").then(null, function () {}); }));
      });
  }
  function load() {
    if (loading) return loading;
    CSS.forEach(css);
    loading = Promise.all(JS.map(js)).then(models).then(function () {
      var T = G.TOKOS;
      if (T && T._syncModels) T._syncModels();
      return T;
    }, function (e) { loading = null; throw e; });
    return loading;
  }
  function fail() { try { if (G.toast) G.toast("Tokós could not load. Check your connection and try again."); } catch (e) {} }
  function real() { return G.TOKOS && G.TOKOS !== stub ? G.TOKOS : null; }

  var stub = {
    open: function () { if (!enabled()) return false; load().then(function () { var t = real(); if (t) t.open(); }, fail); return true; },
    // Review Desk "Read it": false when switched off, as the real openCase answers.
    openCase: function (id) { if (!enabled()) return false; return load().then(function () { var t = real(); return t ? t.openCase(id) : false; }, function () { fail(); return false; }); },
    isOpen: function () { return false; },
    back: function () { return false; },
    close: function () {}
  };
  G.TOKOS_LOADER = { load: load, enabled: enabled, V: V, CSS: CSS, JS: JS };
  if (!G.TOKOS) G.TOKOS = stub;
})(typeof window !== "undefined" ? window : this);
