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

  // Pro mark: just a small "Pro" label in a theme-adaptive accent (dark teal on light, bright teal on
  // dark) so it recolors with the app — like the wordmark itself.
  var LOCKUP = '<span class="ptxt">Pro</span>';

  // Elements whose inner end the badge is appended to (right after the "MD" of the wordmark).
  var TARGETS = [".v3-brand-tt", ".rnav-brand > span", ".v4-hero-tt", ".rnav-hero-tt", ".v3-h-hero", ".sb-head b"];

  function injectCSS() {
    if (document.getElementById("smdProSealCSS")) return;
    var s = document.createElement("style");
    s.id = "smdProSealCSS";
    s.textContent =
      ".smd-probadge{display:none;margin-left:5px;--pro-accent:#0a2320}" +
      "body.pro-verified .smd-probadge{display:inline}" +
      "body.dark .smd-probadge,body.v3-dark .smd-probadge{--pro-accent:#7fe0cf}" +
      ".smd-probadge .ptxt{font-weight:800;font-size:0.58em;letter-spacing:.03em;color:var(--pro-accent);vertical-align:0.12em}" +
      // Gold ring around Pro users' profile picture (large profile-section avatar + the account-menu one).
      "body.pro-verified .hv-acct-pic{box-shadow:0 0 0 3px #d4af37!important}" +
      "body.pro-verified .smd-sba-pic{box-shadow:0 0 0 2px #d4af37!important}";
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
