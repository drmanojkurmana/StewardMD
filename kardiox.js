/* kardiox.js — KardioX AI · module UI entry (sibling of fundx.js / window.FUNDX).
 *
 * Flag-gated by smd_kardiox (DEFAULT OFF via SMD_KARDIOX_FLAGS). When off, open() is a no-op and the
 * module never touches the DOM — a complete no-op, exactly like FundX. Mounts a single scoped overlay
 * root #kardioxRoot; every KardioX node lives under it with .kx-* classes (zero global leakage).
 *
 * Providers (AI analysis, storage, library, learning) are injected via window.SMD_KARDIOX_PROVIDERS
 * (built in M1). This file owns only view mounting + navigation between screens.
 *
 * M0 scope: flag gate, the flagship Home card (screen 01) markup + click→open, and the #kardioxRoot
 * overlay shell with a top bar + close. Screen 02 (landing) and screens 03–19 are built in M2+.
 *
 * Exposed as window.KARDIOX (UI) — providers/models/flags live in their own globals.
 */
(function () {
  "use strict";

  var ROOT_ID = "kardioxRoot";

  function flags() { return (typeof window !== "undefined" && window.SMD_KARDIOX_FLAGS) || null; }
  function on() { var f = flags(); return !!(f && f.bool("smd_kardiox")); }
  function betaOn() { var f = flags(); return !!(f && f.bool("smd_kardiox_beta")); }
  // Experimental-beta banner (TestFlight/internal builds): an unmissable "not a diagnosis / not for
  // clinical use" bar. Shown only when smd_kardiox_beta is set (default OFF on public/web main).
  function ensureBetaBanner(el) {
    if (!betaOn() || !el || el.querySelector(".kx-beta-banner")) return;
    var b = document.createElement("div");
    b.className = "kx-beta-banner";
    b.setAttribute("role", "note");
    b.innerHTML = ic("science") +
      "<span>EXPERIMENTAL BETA &mdash; AI decision support, <b>not a diagnosis</b>. Not for clinical use.</span>";
    el.insertBefore(b, el.firstChild);
  }
  function haptic(kind) { try { if (window.SMD_KARDIOX_FLAGS && SMD_KARDIOX_FLAGS.bool("smd_kardiox_haptics") && window.SMD_HAPTICS) SMD_HAPTICS[kind || "light"] && SMD_HAPTICS[kind || "light"](); } catch (e) {} }

  // Material Symbols glyph via a span (matches StewardMD's icon usage in FundX).
  function ic(name) { return '<span class="material-symbols-rounded" aria-hidden="true">' + name + '</span>'; }

  /* ── Screen 01 · flagship Home card ──────────────────────────────────────────────────────────────
     Returns the card markup only (the two sibling tiles FundX/Antibiogram are the home surface's own).
     home.js injects this and delegates a click to KARDIOX.open(). */
  function homeCardHtml() {
    // A stylised ECG trace (P-QRS-T x3) drawn by kxDraw. Purely decorative → aria-hidden.
    var trace =
      '<svg class="kx-home-trace" viewBox="0 0 320 46" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M0 28 H36 l6 -2 6 4 4 -18 5 30 6 -14 H88 l6 -2 6 4 4 -18 5 30 6 -14 H160 l6 -2 6 4 4 -18 5 30 6 -14 H236 l6 -2 6 4 4 -18 5 30 6 -14 H320"/>' +
      '</svg>';
    return '' +
      '<div class="kx-home-card" role="button" tabindex="0" data-act="kardiox" aria-label="Open KardioX AI — ECG interpretation, learning and decision support">' +
        '<div class="kx-home-head">' +
          '<span class="kx-home-heart">' + ic("cardiology") + '</span>' +
          '<span class="kx-home-pill">' + ic("bolt") + 'AI ECG</span>' +
          '<span class="kx-home-pill">' + ic("lock") + 'On-device</span>' +
        '</div>' +
        trace +
        '<div class="kx-home-title">KardioX AI</div>' +
        '<div class="kx-home-sub">ECG interpretation · learning · decision support</div>' +
        '<button class="kx-home-cta" type="button" tabindex="-1">Analyze an ECG ' + ic("arrow_forward") + '</button>' +
        '<div class="kx-home-conf">' + ic("science") + 'Demo preview</div>' +
        '<div class="kx-home-foot">' + ic("lock") + 'ECGs stay on your device.</div>' +
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
    el.setAttribute("aria-label", "KardioX AI");
    // Each screen renders its own header (landing/report/etc.); the shell is just the scroll host.
    // All click delegation + navigation is owned by SMD_KARDIOX_ROUTER (kardiox-screens.js).
    el.innerHTML = '<div class="kx-scroll" id="kxScroll"></div>';
    document.body.appendChild(el);
    return el;
  }

  function open() {
    if (!on()) return;                 // hard gate: default OFF → complete no-op
    var el = root();
    ensureBetaBanner(el);              // experimental-beta safety bar (beta builds only)
    // Landing (screen 02) + inner screens are built in M2; M0 mounts the shell only.
    el.classList.add("kx-open");
    document.documentElement.classList.add("kx-lock");
    haptic("light");
    // Health-gate the live backend (flag smd_kardiox_backend): flips the analyzer to RemoteAnalyzer if
    // the pipeline is reachable, else stays on the on-device mock. Non-blocking; default OFF.
    try { if (window.SMD_KARDIOX_PROVIDERS && SMD_KARDIOX_PROVIDERS.checkBackend) SMD_KARDIOX_PROVIDERS.checkBackend(); } catch (e) {}
    try { if (window.SMD_KARDIOX_ROUTER && SMD_KARDIOX_ROUTER.mountLanding) SMD_KARDIOX_ROUTER.mountLanding(document.getElementById("kxScroll")); } catch (e) {}
  }

  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("kx-open");
    document.documentElement.classList.remove("kx-lock");
  }

  /* ── Home-card auto-mount (additive; home.js is NOT modified) ────────────────────────────────────
     When smd_kardiox is on, inject the flagship card into the home content stack after the hero, and
     keep it present across home re-renders via a MutationObserver. If the home markup isn't found the
     card simply doesn't appear — never a breakage. Reversible: flag off → this is a complete no-op. */
  function mountHomeCard() {
    if (!on()) return;
    if (typeof document === "undefined") return;
    var stack = document.querySelector(".v3-stack") || document.querySelector(".rnav-main .rnav-stack") || document.querySelector("main .v3-stack");
    if (!stack) return;
    if (stack.querySelector(".kx-home-card")) return;                 // already mounted
    var wrap = document.createElement("div");
    wrap.className = "kx-home-slot";
    wrap.innerHTML = homeCardHtml();
    var hero = stack.querySelector(".v4-hero");
    if (hero && hero.parentNode === stack) { stack.insertBefore(wrap, hero.nextSibling); }
    else { var greet = stack.querySelector(".v4-greet"); if (greet && greet.parentNode === stack) stack.insertBefore(wrap, greet.nextSibling); else stack.insertBefore(wrap, stack.firstChild); }
  }

  function initHome() {
    if (typeof document === "undefined") return;
    // Delegate the card tap (the card lives outside #kardioxRoot).
    document.addEventListener("click", function (e) {
      var c = e.target.closest && e.target.closest('.kx-home-card[data-act="kardiox"]');
      if (c) { e.preventDefault(); haptic("light"); open(); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var c = e.target.closest && e.target.closest('.kx-home-card[data-act="kardiox"]');
      if (c) { e.preventDefault(); haptic("light"); open(); }
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
  if (typeof window !== "undefined") { window.KARDIOX = API; window.SMD_KARDIOX = API; }
})();
