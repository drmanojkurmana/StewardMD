/* StewardMD — Pro verified badge (certification seal).
 *
 * Shows a small teal certification-seal ✓ next to the StewardMD wordmark ONLY for users with a REAL
 * Pro entitlement — the Firebase custom claim pro===true (respecting proExp). It deliberately IGNORES
 * the launch promo and the BETA_PRO_ALL / TEST_PRO_EMAILS testing shortcuts, so the mark stays
 * meaningful (a paid/granted subscriber, not "everyone during the beta").
 *
 * Self-contained: injects its own CSS + the badge element and toggles visibility via body.pro-verified.
 * Does NOT edit home.js/app.js — it attaches to the wordmark by selector and re-attaches on re-render.
 */
(function () {
  "use strict";

  // Pro mark: a minimalist "Pro" label + a clean filled star, both in a theme-adaptive accent so they
  // recolor with the app (teal on light, brighter teal on dark) — like the wordmark itself.
  var STAR = '<svg viewBox="0 0 24 24" class="pstar" aria-hidden="true" focusable="false"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>';
  var LOCKUP = '<span class="ptxt">Pro</span>' + STAR;

  // Elements whose inner end the badge is appended to (right after the "MD" of the wordmark).
  var TARGETS = [".v3-brand-tt", ".rnav-brand > span", ".v4-hero-tt", ".sb-head b"];

  function injectCSS() {
    if (document.getElementById("smdProSealCSS")) return;
    var s = document.createElement("style");
    s.id = "smdProSealCSS";
    s.textContent =
      ".smd-probadge{display:none;align-items:center;gap:2px;margin-left:6px;flex:0 0 auto;vertical-align:baseline;--pro-accent:#0e6e63}" +
      "body.pro-verified .smd-probadge{display:inline-flex}" +
      "body.dark .smd-probadge,body.v3-dark .smd-probadge{--pro-accent:#5dcaa5}" +
      ".smd-probadge .ptxt{font-weight:800;font-size:0.6em;letter-spacing:.04em;line-height:1;color:var(--pro-accent)}" +
      ".smd-probadge .pstar{width:0.78em;height:0.78em;display:block;flex:0 0 auto;fill:var(--pro-accent)}";
    (document.head || document.documentElement).appendChild(s);
  }

  function makeBadge() {
    var b = document.createElement("span");
    b.className = "smd-probadge";
    b.title = "StewardMD Pro";
    b.innerHTML = LOCKUP;
    return b;
  }

  function place() {
    for (var i = 0; i < TARGETS.length; i++) {
      var els = document.querySelectorAll(TARGETS[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (el.querySelector && el.querySelector(".smd-probadge")) continue;   // already badged
        try { el.appendChild(makeBadge()); } catch (e) {}
      }
    }
  }

  var _sched = 0;
  function schedulePlace() {
    if (_sched) return;
    _sched = (window.requestAnimationFrame || setTimeout)(function () { _sched = 0; place(); }, 120);
  }

  var _real = null;
  function setReal(v) {
    v = !!v; if (v === _real) return; _real = v;
    try { document.body.classList.toggle("pro-verified", v); } catch (e) {}
  }
  // Real entitlement = the pro custom claim only (never the promo / BETA flags).
  function computeReal() {
    try {
      var u = window.SMD_AUTH && window.SMD_AUTH.currentUser;
      if (!u || !u.getIdTokenResult) { setReal(false); return; }
      u.getIdTokenResult().then(function (r) {
        var c = (r && r.claims) || {};
        setReal(c.pro === true && (!c.proExp || +c.proExp > Date.now()));
      }).catch(function () { setReal(false); });
    } catch (e) { setReal(false); }
  }

  function boot() {
    injectCSS();
    place();
    try { new MutationObserver(schedulePlace).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    computeReal();
    try { if (window.SMD_AUTH && window.SMD_AUTH.onAuthStateChanged) window.SMD_AUTH.onAuthStateChanged(computeReal); } catch (e) {}
    // Firebase can init after this script; poll a few times, then rely on onAuthStateChanged.
    var n = 0, iv = setInterval(function () { computeReal(); if (++n > 20) clearInterval(iv); }, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
