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

  // Verified mark: a flat GREEN circle with a white tick — no border, no ring. Same in light + dark.
  var SEAL =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle class="pseal-bg" cx="12" cy="12" r="11"></circle>' +
      '<path class="pseal-tick" d="M7.3 12.5 l3.1 3.1 l6.2-6.8" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>' +
    '</svg>';

  // Elements whose inner end the badge is appended to (right after the "MD" of the wordmark).
  var TARGETS = [".v3-brand-tt", ".rnav-brand > span", ".v4-hero-tt", ".sb-head b"];

  function injectCSS() {
    if (document.getElementById("smdProSealCSS")) return;
    var s = document.createElement("style");
    s.id = "smdProSealCSS";
    s.textContent =
      ".smd-proseal{display:none;align-items:center;justify-content:center;width:1.02em;height:1.02em;margin-left:5px;vertical-align:-0.12em;flex:0 0 auto}" +
      "body.pro-verified .smd-proseal{display:inline-flex}" +
      ".smd-proseal svg{width:100%;height:100%;display:block}" +
      ".smd-proseal .pseal-bg{fill:#1da851}" +
      ".smd-proseal .pseal-tick{stroke:#fff}" +
      // Pro users: the 'MD' of the wordmark turns gold (deeper on light, brighter on dark headers).
      "body.pro-verified{--md-gold:#c99700}" +
      "body.pro-verified.dark,body.pro-verified.v3-dark{--md-gold:#f2c94c}" +
      "body.pro-verified .v3-md,body.pro-verified .rnav-brand b,body.pro-verified .rnav-hero-tt b,body.pro-verified .sb-head .accent{color:var(--md-gold)!important}";
    (document.head || document.documentElement).appendChild(s);
  }

  function makeBadge() {
    var b = document.createElement("span");
    b.className = "smd-proseal";
    b.setAttribute("role", "img");
    b.setAttribute("aria-label", "StewardMD Pro");
    b.title = "StewardMD Pro";
    b.innerHTML = SEAL;
    return b;
  }

  function place() {
    for (var i = 0; i < TARGETS.length; i++) {
      var els = document.querySelectorAll(TARGETS[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (el.querySelector && el.querySelector(".smd-proseal")) continue;   // already badged
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
