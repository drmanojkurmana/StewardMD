/* thorex.js — ThoreX AI · module UI entry (sibling of kardiox.js / window.KARDIOX).
 *
 * Flag-gated by smd_thorex (DEFAULT OFF via SMD_THOREX_FLAGS). When off, open() is a no-op and the
 * module never touches the DOM — a complete no-op, exactly like KardioX/FundX. Mounts a single scoped
 * overlay root #thorexRoot; every ThoreX node lives under it with .tx-* classes (zero global leakage).
 *
 * Providers (AI analysis, storage, entitlement) are injected via window.SMD_THOREX_PROVIDERS (built in
 * Task 6). This file owns only view mounting + navigation between screens (via SMD_THOREX_ROUTER, built
 * in Task 8).
 *
 * Scope: flag gate, the flagship Home card markup + click→open, and the #thorexRoot overlay shell with
 * a scroll host. Screens themselves are built/owned by thorex-screens.js.
 *
 * Exposed as window.THOREX (UI) — providers/models/flags live in their own globals.
 */
(function () {
  "use strict";

  var ROOT_ID = "thorexRoot";

  function flags() { return (typeof window !== "undefined" && window.SMD_THOREX_FLAGS) || null; }
  function on() { var f = flags(); return !!(f && f.bool("smd_thorex")); }
  function haptic(kind) { try { if (window.SMD_THOREX_FLAGS && SMD_THOREX_FLAGS.bool("smd_thorex_haptics") && window.SMD_HAPTICS) SMD_HAPTICS[kind || "light"] && SMD_HAPTICS[kind || "light"](); } catch (e) {} }

  // Material Symbols glyph via a span (matches StewardMD's icon usage in FundX/KardioX).
  function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }

  /* ── Screen 01 · flagship Home card ──────────────────────────────────────────────────────────────
     Returns the card markup only (the sibling tiles are the home surface's own).
     home.js injects this and delegates a click to THOREX.open(). */
  function homeCardHtml() {
    // A stylised chest/lung scan sweep drawn by txDraw. Purely decorative → aria-hidden.
    var trace =
      '<svg class="tx-home-scan" viewBox="0 0 320 46" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M0 28 H36 l6 -2 6 4 4 -18 5 30 6 -14 H88 l6 -2 6 4 4 -18 5 30 6 -14 H160 l6 -2 6 4 4 -18 5 30 6 -14 H236 l6 -2 6 4 4 -18 5 30 6 -14 H320"/>' +
      '</svg>';
    return '' +
      '<div class="tx-home-card" role="button" tabindex="0" data-act="thorex" aria-label="Open ThoreX AI — chest X-ray interpretation, learning and decision support">' +
        '<div class="tx-home-head">' +
          '<span class="tx-home-icon">' + ic("pulmonology") + '</span>' +
          '<span class="tx-home-pill">' + ic("bolt") + 'AI CXR</span>' +
          '<span class="tx-home-pill">' + ic("lock") + 'On-device</span>' +
        '</div>' +
        trace +
        '<div class="tx-home-title">ThoreX AI</div>' +
        '<div class="tx-home-sub">Chest X-ray interpretation · learning · decision support</div>' +
        '<button class="tx-home-cta" type="button" tabindex="-1">Analyze a chest X-ray ' + ic("arrow_forward") + '</button>' +
        '<div class="tx-home-conf">' + ic("science") + 'Demo preview</div>' +
        '<div class="tx-home-foot">' + ic("lock") + 'Images stay on your device.</div>' +
      '</div>';
  }

  /* ── Overlay root + shell ────────────────────────────────────────────────────────────────────── */
  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "ThoreX AI");
    // Each screen renders its own header (landing/report/etc.); the shell is just the scroll host.
    // All click delegation + navigation is owned by SMD_THOREX_ROUTER (thorex-screens.js).
    el.innerHTML = '<div class="tx-scroll" id="txScroll"></div>';
    document.body.appendChild(el);
    return el;
  }

  function open() {
    if (!on()) return;                 // hard gate: default OFF → complete no-op
    var el = root();
    el.classList.add("tx-open");
    document.documentElement.classList.add("tx-lock");
    haptic("light");
    // Health-gate the live backend (flag smd_thorex_backend): flips the analyzer to RemoteAnalyzer if
    // the pipeline is reachable, else stays on the on-device mock. Non-blocking; default OFF.
    try { if (window.SMD_THOREX_PROVIDERS && SMD_THOREX_PROVIDERS.checkBackend) SMD_THOREX_PROVIDERS.checkBackend(); } catch (e) {}
    try { if (window.SMD_THOREX_ROUTER && SMD_THOREX_ROUTER.mountLanding) SMD_THOREX_ROUTER.mountLanding(document.getElementById("txScroll")); } catch (e) {}
  }

  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("tx-open");
    document.documentElement.classList.remove("tx-lock");
  }

  // Launch from the home card — re-verify Experimental Access on each open (server-side,
  // revocable), exactly like KardioX/FundX. Falls back to a direct open if the gate isn't present
  // (e.g. dev bypass / offline-cached token handled inside SMD_XACCESS.gate).
  function launch() {
    try { if (window.SMD_XACCESS && SMD_XACCESS.gate) { SMD_XACCESS.gate("thorex", open); return; } } catch (e) {}
    open();
  }

  /* ── Home-card auto-mount (additive; home.js is NOT modified) ────────────────────────────────────
     When smd_thorex is on, inject the flagship card into the home content stack after the hero, and
     keep it present across home re-renders via a MutationObserver. If the home markup isn't found the
     card simply doesn't appear — never a breakage. Reversible: flag off → this is a complete no-op. */
  function mountHomeCard() {
    // MOVED TO CLINICAL-TOOLS TILE: per product decision (mirrors KardioX), the flagship home hero is
    // replaced by a compact "ThoreX AI" tile in home.js's Clinical Tools grid. Hero mount disabled here
    // to avoid duplication; the module + window.THOREX.open are unchanged. Delete this return to restore.
    return;
    if (!on()) return;
    if (typeof document === "undefined") return;
    var stack = document.querySelector(".v3-stack") || document.querySelector(".rnav-main .rnav-stack") || document.querySelector("main .v3-stack");
    if (!stack) return;
    if (stack.querySelector(".tx-home-card")) return;                 // already mounted
    var wrap = document.createElement("div");
    wrap.className = "tx-home-slot";
    wrap.innerHTML = homeCardHtml();
    var hero = stack.querySelector(".v4-hero");
    if (hero && hero.parentNode === stack) { stack.insertBefore(wrap, hero.nextSibling); }
    else { var greet = stack.querySelector(".v4-greet"); if (greet && greet.parentNode === stack) stack.insertBefore(wrap, greet.nextSibling); else stack.insertBefore(wrap, stack.firstChild); }
  }

  function initHome() {
    if (typeof document === "undefined") return;
    // Delegate the card tap (the card lives outside #thorexRoot).
    document.addEventListener("click", function (e) {
      var c = e.target.closest && e.target.closest('.tx-home-card[data-act="thorex"]');
      if (c) { e.preventDefault(); haptic("light"); launch(); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var c = e.target.closest && e.target.closest('.tx-home-card[data-act="thorex"]');
      if (c) { e.preventDefault(); haptic("light"); launch(); }
    });
    // Mount now + on every home re-render (home.js rebuilds .v3-stack on navigation).
    mountHomeCard();
    try {
      var mo = new MutationObserver(function () { mountHomeCard(); });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initHome);
    else initHome();
  }

  var API = { open: open, close: close, homeCardHtml: homeCardHtml, mountHomeCard: mountHomeCard, isOn: on };
  if (typeof window !== "undefined") { window.THOREX = API; window.SMD_THOREX = API; }
})();
