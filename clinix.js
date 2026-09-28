/* clinix.js — CliniX · module entry. Flag gate + the #clinixRoot overlay + window.CLINIX.
 * Sibling of thorex.js / sknx.js.
 *
 * INVARIANT: flag off is a COMPLETE no-op. open() returns before touching the DOM, nothing is
 * fetched, and no .cx-* custom property ever reaches the page. test/run-clinix-ui.mjs asserts this.
 *
 * LAZY LOADING (2026-09-27): only this file and clinix-flags.js load with the app. The other 13
 * CliniX scripts (~590 KB) used to be parsed on EVERY launch for EVERY user, most of whom never open
 * CliniX; they now load, in order, on the first open(). The list below is the load order and the
 * cache-bust tokens: BUMP A TOKEN HERE when you edit that file (sw.js caches by full URL). Load
 * order is load-bearing: model before content, store before screens (vault/modules/CliniX.md).
 * smd_clinix_lazy=0 loads them eagerly at startup instead, the pre-2026-09-27 behaviour.
 */
(function () {
  "use strict";

  var ROOT_ID = "clinixRoot";

  var SCRIPTS = [
    "/clinix-lexicon.js?v=cxa927-lex1-lazy1",
    "/clinix-model.js?v=cx21a927-lex1-prolock-lazy1-open1",
    "/clinix-dx.js?v=cxa927-dx1-lazy1",
    "/clinix-content.js?v=cx16a927-dxvocab-prolock-lazy1-own4",
    "/clinix-diagrams.js?v=cx13-lazy1-own4",
    "/clinix-audio.js?v=cx-stridor3-api1-snd1-lazy1",
    "/clinix-store.js?v=cx12a927-lazy1",
    "/clinix-tutor.js?v=cx14a927-lazy1",
    "/clinix-engine.js?v=cx11a927-lex1-lazy1",
    "/clinix-physiology.js?v=cx11a927-sandbox1-lazy1",
    "/clinix-profile.js?v=cx10a927-lazy1",
    "/clinix-examiner.js?v=cx10a927-lazy1",
    "/clinix-screens.js?v=cx26a927-sandbox1-prolock-snd1-lazy1-own4"
  ];

  function flags() { try { return (typeof window !== "undefined" && window.SMD_CLINIX_FLAGS) || null; } catch (e) { return null; } }
  function on() { var f = flags(); return !!(f && f.bool("smd_clinix")); }

  function haptic(k) {
    try {
      if (window.SMD_CLINIX_FLAGS && SMD_CLINIX_FLAGS.bool("smd_clinix_haptics") &&
          window.SMD_HAPTICS && SMD_HAPTICS[k]) SMD_HAPTICS[k]();
    } catch (e) {}
  }

  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "CliniX clinical learning");
    // The module owns its scroll host, matching thorex.js. swipe-back.js needs the root itself to
    // be position:fixed inset:0 (set in clinix.css) so the drag-back gesture moves the whole overlay.
    el.innerHTML = '<div class="cx-scroll" id="clinixScroll"></div>';
    document.body.appendChild(el);
    return el;
  }

  /* Sequential, not parallel: each file may read the globals of the ones before it at load. A
   * failed file rejects the whole load and is retried on the next open (the promise is cleared). */
  var _loading = null;
  function loaded() { return !!(window.SMD_CLINIX_SCREENS && window.SMD_CLINIX_SCREENS.mount); }
  function loadOne(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error("load " + src)); };
      document.head.appendChild(s);
    });
  }
  function load() {
    if (loaded()) return Promise.resolve(true);
    if (_loading) return _loading;
    var chain = Promise.resolve();
    SCRIPTS.forEach(function (src) {
      var base = src.split("?")[0];
      chain = chain.then(function () {
        // A tag already in the page (eager mode, an old index.html) is not loaded twice.
        if (document.querySelector('script[src^="' + base + '?"]')) return null;
        return loadOne(src);
      });
    });
    _loading = chain.then(function () { return loaded(); }, function (e) {
      _loading = null;
      try { console.warn("[CliniX] load", e); } catch (_) {}
      return false;
    });
    return _loading;
  }

  function mountInto(el) {
    try {
      if (window.SMD_CLINIX_SCREENS && SMD_CLINIX_SCREENS.mount) SMD_CLINIX_SCREENS.mount(el);
    } catch (e) { try { console.warn("[CliniX] mount", e); } catch (_) {} }
  }

  function open() {
    if (!on()) return;                       // hard gate: default OFF -> complete no-op
    var el = root();
    el.classList.add("cx-open");
    document.documentElement.classList.add("cx-lock");
    haptic("light");
    if (loaded()) { mountInto(el); return; }
    var sc = el.querySelector("#clinixScroll");
    if (sc) sc.innerHTML = '<div class="cx-state"><div class="cx-state-title">Opening CliniX</div></div>';
    load().then(function (ok) {
      if (!isOpen()) return;                 // closed while loading
      if (ok) { mountInto(el); return; }
      if (sc) sc.innerHTML = '<div class="cx-state"><div class="cx-state-title">CliniX could not load</div>' +
        '<div class="cx-state-msg">Check your connection and try again.</div>' +
        '<button type="button" class="cx-btn cx-btn--primary cx-close" data-act="cx-close">Close</button></div>';
      var b = sc && sc.querySelector("[data-act=cx-close]");
      if (b) b.addEventListener("click", close);
    });
  }

  /* Progress is per person. clinix-screens.js wires this itself, but with lazy loading it is absent
   * until the first open, so a sign-out before then must still clear the previous account's data. */
  var STORE_KEYS = ["smd_clinix_skills_v1", "smd_clinix_pos_v1", "smd_clinix_log_v1"];
  function wipeUnloaded() {
    if (window.SMD_CLINIX_WIPE) return;      // screens loaded: it handles sign-out
    for (var i = 0; i < STORE_KEYS.length; i++) { try { localStorage.removeItem(STORE_KEYS[i]); } catch (e) {} }
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    ["smd:signout", "smd-signout", "signout", "smd:logout"].forEach(function (ev) {
      try { window.addEventListener(ev, wipeUnloaded); } catch (e) {}
    });
    // Eager mode: the old behaviour, one flag away.
    try {
      var f = flags();
      if (on() && f && f.DEFS && f.DEFS.smd_clinix_lazy && !f.bool("smd_clinix_lazy")) {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { load(); });
        else load();
      }
    } catch (e) {}
  }

  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("cx-open");
    document.documentElement.classList.remove("cx-lock");
  }

  function isOpen() {
    var el = document.getElementById(ROOT_ID);
    return !!(el && el.classList.contains("cx-open"));
  }

  var API = { open: open, close: close, isOn: on, isOpen: isOpen, load: load, SCRIPTS: SCRIPTS };
  if (typeof window !== "undefined") { window.CLINIX = API; window.SMD_CLINIX = API; }
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
