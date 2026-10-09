/* PrepNucleus loader: the only PrepNucleus file loaded at app boot. ES5.
   window.PREP starts as this small stand-in with the module's public surface (open, isOpen, back, close). The first
   open injects the stylesheets, specialty-core.js (FSRS), specialty-bank.js (search helpers), prep.js and the Layer C
   files, in order, at one ?v= token; prep.js replaces window.PREP with the real module and the call that started the load goes through to it.
   Flag smd_prep: default ON (owner 2026-10-06). localStorage smd_prep = "0" or ?prep=0 turns it off,
   "0" or ?prep=0 turns it off (same rule as the home tile in home.js). prep-arena.js (Arena and My stats) always loads; its
   own flag smd_prep_arena (default ON, ?arena=0 off) decides whether the Compete section shows. prep-lessons.js (Lessons) has
   no flag of its own: a module shows its Lesson row only when prep/lessons/v1/index.json lists it. prep-plan.js
   (onboarding, readiness, today's plan) and prep-flash.js (module flashcards) have no flag of their own either.
   prep-sync.js (opt-in encrypted sync), prep-nudges.js (smart study nudges, optional) and prep-native.js (reminder,
   widget, Live Activity) load with them. prep-pro.js (free tier gates, pricing; flag smd_prep_pro_enforce, default OFF) and prep-social.js are optional: a
   404 skips them. prep-motion.js (springs, ring draw, haptics on answers and finishes; vendor/motion/motion.js fetched on
   first open) is optional too: without it every screen shows its final state through prep.css. prep-viewer.js is the one
   full-screen image viewer (pinch, pan, double tap, swipe down); optional so an older build falls back to the in-screen zoom. */
(function (G) {
  "use strict";
  var V = "prep44";
  // Layer C (prep-source, prep-decks, prep-cards, prep-create) after prep.js; prep-create.js reads the two before it.
  var CSS = ["prep.css", "prep-create.css", "prep-plan.css", "prep-flash.css", "prep-pro.css", "prep-social.css", "prep-setup.css", "prep-ask.css", "prep-lx.css"];
  var JS = ["specialty-core.js", "specialty-bank.js", "prep.js", "prep-viewer.js", "prep-motion.js", "prep-sync.js", "prep-arena.js", "prep-lessons.js", "prep-pyq.js", "prep-rad.js", "prep-setup.js", "prep-plan.js", "prep-nudges.js", "prep-native.js", "prep-flash.js", "prep-teacher.js", "prep-ask.js", "prep-pro.js", "prep-social.js", "prep-source.js", "prep-decks.js", "prep-cards.js", "prep-create.js"];
  // Optional files: a missing one (404, not yet shipped) is skipped instead of failing PrepNucleus.
  var OPTIONAL = { "prep-viewer.js": 1, "prep-ask.js": 1, "prep-setup.js": 1, "prep-rad.js": 1, "prep-motion.js": 1, "prep-sync.js": 1, "prep-pro.js": 1, "prep-social.js": 1, "prep-nudges.js": 1 };
  var loading = null;

  function enabled() {
    try { var q = (G.location.search.match(/[?&]prep=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on" || q === "true"; return G.localStorage.getItem("smd_prep") !== "0"; } catch (e) { return true; }
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
      s.onload = function () { done[src] = 1; res(); }; s.onerror = function () { if (OPTIONAL[src]) { done[src] = 1; res(); } else rej(new Error(src)); };
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
