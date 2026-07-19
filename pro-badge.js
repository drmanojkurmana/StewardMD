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

  // Twitter-style verified: the scalloped badge with a white check. A white disc sits BEHIND the
  // scallop so the check cutout always reads white (light + dark headers), no alignment fuss.
  var SEAL =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle class="pseal-white" cx="12" cy="12" r="6"></circle>' +
      '<path class="pseal-bg" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"></path>' +
    '</svg>';

  // Elements whose inner end the badge is appended to (right after the "MD" of the wordmark).
  var TARGETS = [".v3-brand-tt", ".rnav-brand > span", ".v4-hero-tt", ".sb-head b"];

  function injectCSS() {
    if (document.getElementById("smdProSealCSS")) return;
    var s = document.createElement("style");
    s.id = "smdProSealCSS";
    s.textContent =
      ".smd-proseal{display:none;align-items:center;justify-content:center;width:1.05em;height:1.05em;margin-left:5px;vertical-align:-0.12em;flex:0 0 auto}" +
      "body.pro-verified .smd-proseal{display:inline-flex}" +
      ".smd-proseal svg{width:100%;height:100%;display:block}" +
      ".smd-proseal .pseal-white{fill:#fff}" +
      ".smd-proseal .pseal-bg{fill:#1d9bf0}";
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
