/* StewardMD — Circular Reveal (Radial Wave) theme transition  ->  window.SMD_THEME_REVEAL
 *
 * Turns the instant light/dark switch into a premium circular reveal that expands from the
 * exact point the user tapped, à la the Hike app. It is ADDITIVE and PRESERVES every existing
 * behaviour: it never re-implements the theme logic — it re-dispatches the real toggle click
 * INSIDE a View Transition, so persistence ("stewardmd_theme"), OS-sync bookkeeping
 * (theme-sync.js), the ☀️/🌙 glyph and every downstream listener still run exactly as before.
 *
 * HOW IT WORKS
 *   Every live light/dark toggle in the app ends in `document.body.classList` gaining/losing the
 *   `dark` class (the core setter lives in minified app.js; other entry points click #themeToggle
 *   or fire data-act="theme"). We intercept those clicks in the CAPTURE phase, read the tap x/y,
 *   swallow the real click, then re-fire it from inside `document.startViewTransition(...)`. The
 *   browser GPU-composites an "old" and a "new" snapshot of the page; we animate ONLY a clip-path
 *   circle on the new layer, so the new theme wipes over the old from the tap point. No manual
 *   bitmaps, no canvas readbacks, no cloned DOM — the compositing is the browser's, on the GPU.
 *
 *   System UI (the <meta name="theme-color"> and the native Capacitor StatusBar) is kept in sync
 *   by a MutationObserver on the body class, so it updates for EVERY theme change — button taps,
 *   OS appearance changes, and the no-View-Transitions fallback alike.
 *
 * GRACEFUL DEGRADATION
 *   • Reduce Motion enabled            -> a smooth cross-fade instead of the circle.
 *   • No View Transitions API support  -> the original instant switch (no flash), UI still synced.
 *
 * Reusable API (also usable for non-theme reveals):
 *   SMD_THEME_REVEAL.toggle(x, y)                 flip light/dark, revealing from (x, y)
 *   SMD_THEME_REVEAL.revealFrom(x, y, mutateFn)   run ANY DOM mutation inside a circular reveal
 *   SMD_THEME_REVEAL.syncSystemUI()               push the current theme to status bar / meta
 *   SMD_THEME_REVEAL.config                        { duration, easing, glow, colorLight, colorDark, ... }
 */
(function () {
  "use strict";

  // ── Configuration (override via SMD_THEME_REVEAL.config then call applyConfig()) ───────────
  var CONFIG = {
    duration: 400,                          // circular reveal duration (ms) — per spec
    fadeDuration: 220,                      // reduce-motion cross-fade duration (ms)
    easing: "cubic-bezier(.4, 0, .2, 1)",   // smooth ease-in-out for a premium feel
    glow: "rgba(45, 212, 191, .30)",        // soft teal leading-edge glow/blur (brand accent)
    colorLight: "#F8FAFC",                  // <meta theme-color> + Android status bar, light theme
    colorDark: "#0B1220"                    // …dark theme (both mirror --v3-bg in ui-v3.css)
  };

  // Every element that performs a DIRECT light/dark toggle. (Accent-theme swatches and the
  // Appearance sheet use different attributes and are intentionally excluded.)
  var TOGGLE_SEL = '#themeToggle, #v4ThemeBtn, [data-act="theme"]';

  var docEl = document.documentElement;
  var supportsVT = typeof document.startViewTransition === "function";
  var reentrant = false;   // true while we re-dispatch the real click, so we don't re-wrap it
  var seq = 0;             // monotonic id so an overtaken transition never strips a newer one's class

  function prefersReducedMotion() {
    try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  // ── Inject the View-Transition stylesheet (self-contained; no external CSS file needed) ────
  function injectStyle() {
    if (document.getElementById("smd-vt-style")) return;
    var css =
      /* Tunable custom properties (set from CONFIG below). */
      ":root{" +
        "--smd-vt-dur:" + CONFIG.duration + "ms;" +
        "--smd-vt-dur-fade:" + CONFIG.fadeDuration + "ms;" +
        "--smd-vt-ease:" + CONFIG.easing + ";" +
        "--smd-vt-glow:" + CONFIG.glow + ";" +
        "--smd-vt-x:50%;--smd-vt-y:50%;--smd-vt-r:100vmax;}" +

      /* Circular reveal: the new theme sits on top and is unmasked by an expanding clip circle
         centred on the tap point; a soft drop-shadow gives the premium leading-edge glow/blur.
         The old theme stays fully opaque until the circle already covers most of the screen,
         then eases back slightly — so there is never a transparent frame (no white/black flash). */
      "html.smd-vt-reveal::view-transition-old(root){" +
        "z-index:0;animation:smd-vt-recede var(--smd-vt-dur) both ease-out;}" +
      "html.smd-vt-reveal::view-transition-new(root){" +
        "z-index:1;animation:smd-vt-reveal-in var(--smd-vt-dur) both var(--smd-vt-ease);" +
        "filter:drop-shadow(0 0 10px var(--smd-vt-glow));}" +
      "@keyframes smd-vt-reveal-in{" +
        "from{clip-path:circle(0px at var(--smd-vt-x) var(--smd-vt-y));}" +
        "to{clip-path:circle(var(--smd-vt-r) at var(--smd-vt-x) var(--smd-vt-y));}}" +
      "@keyframes smd-vt-recede{0%,72%{opacity:1}100%{opacity:.6}}" +

      /* Reduced-motion accessibility path: a plain, smooth cross-fade (no circle, no transform). */
      "html.smd-vt-fade::view-transition-old(root){z-index:0;animation:smd-vt-fade-out var(--smd-vt-dur-fade) both ease;}" +
      "html.smd-vt-fade::view-transition-new(root){z-index:1;animation:smd-vt-fade-in var(--smd-vt-dur-fade) both ease;}" +
      "@keyframes smd-vt-fade-out{from{opacity:1}to{opacity:0}}" +
      "@keyframes smd-vt-fade-in{from{opacity:0}to{opacity:1}}";

    var st = document.createElement("style");
    st.id = "smd-vt-style";
    st.textContent = css;
    (document.head || docEl).appendChild(st);
  }

  // Re-push CONFIG values into the CSS custom properties (used by applyConfig / init).
  function applyConfig() {
    docEl.style.setProperty("--smd-vt-dur", CONFIG.duration + "ms");
    docEl.style.setProperty("--smd-vt-dur-fade", CONFIG.fadeDuration + "ms");
    docEl.style.setProperty("--smd-vt-ease", CONFIG.easing);
    docEl.style.setProperty("--smd-vt-glow", CONFIG.glow);
  }

  // ── The reveal itself ──────────────────────────────────────────────────────────────────────
  // Runs `mutate` (the DOM change) inside a View Transition, animating a clip circle from (x,y).
  // Returns a promise that resolves when the animation finishes.
  function runVT(mutate, x, y, fade) {
    var W = window.innerWidth, H = window.innerHeight;
    x = (typeof x === "number" && isFinite(x)) ? x : W / 2;
    y = (typeof y === "number" && isFinite(y)) ? y : H / 2;
    // Radius = distance to the FARTHEST screen corner (+ a few px overscan) so the circle fully
    // covers the viewport on any size/orientation, incl. safe areas / Dynamic Island / Split View.
    var r = Math.hypot(Math.max(x, W - x), Math.max(y, H - y)) + 4;

    docEl.style.setProperty("--smd-vt-x", x + "px");
    docEl.style.setProperty("--smd-vt-y", y + "px");
    docEl.style.setProperty("--smd-vt-r", r + "px");

    var cls = fade ? "smd-vt-fade" : "smd-vt-reveal";
    var myId = ++seq;
    docEl.classList.add(cls);

    var runMutation = function () {
      reentrant = true;                       // let our own re-dispatched click pass straight through
      try { mutate(); } finally { reentrant = false; }
    };

    var vt;
    try {
      vt = document.startViewTransition(runMutation);
    } catch (e) {
      // Extremely defensive: if the API throws, apply the change instantly and bail cleanly.
      try { runMutation(); } catch (_) {}
      docEl.classList.remove("smd-vt-reveal", "smd-vt-fade");
      return Promise.resolve();
    }

    var cleanup = function () {
      if (myId !== seq) return;               // a newer transition started — leave its class alone
      docEl.classList.remove("smd-vt-reveal", "smd-vt-fade");
      docEl.style.removeProperty("--smd-vt-x");
      docEl.style.removeProperty("--smd-vt-y");
      docEl.style.removeProperty("--smd-vt-r");
    };
    // .ready rejects if the browser skips the transition (e.g. rapid re-tap) — swallow it.
    if (vt.ready && vt.ready.catch) vt.ready.catch(function () {});
    vt.finished.then(cleanup, cleanup);
    return vt.finished.catch(function () {});
  }

  // ── Public reveal API ────────────────────────────────────────────────────────────────────
  // Run ANY DOM mutation inside the circular reveal from (x, y). Reusable anywhere in the app.
  function revealFrom(x, y, mutate, opts) {
    opts = opts || {};
    if (typeof mutate !== "function") return Promise.resolve();
    // Gentle haptic exactly as the animation starts (iOS-native; respects the user's setting).
    if (opts.haptic !== false) {
      try { if (window.SMD_HAPTICS && SMD_HAPTICS.light) SMD_HAPTICS.light(); } catch (e) {}
    }
    if (!supportsVT) { try { mutate(); } catch (e) {} return Promise.resolve(); }  // instant fallback
    return runVT(mutate, x, y, prefersReducedMotion());
  }

  // Flip light/dark with a reveal from (x, y) — routes through the canonical toggle so all
  // existing side-effects fire. Defaults to the toggle button's centre, else the screen centre.
  function toggle(x, y) {
    var btn = document.getElementById("themeToggle");
    if ((x == null || y == null) && btn) {
      var rct = btn.getBoundingClientRect();
      if (x == null) x = rct.left + rct.width / 2;
      if (y == null) y = rct.top + rct.height / 2;
    }
    var mutate = btn ? function () { btn.click(); } : function () { document.body.classList.toggle("dark"); };
    return revealFrom(x, y, mutate);
  }

  // ── System-UI sync (status bar / navigation bar / theme-color meta) ─────────────────────────
  function ensureMeta() {
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement("meta"); m.setAttribute("name", "theme-color"); (document.head || docEl).appendChild(m); }
    return m;
  }
  function isDark() { return document.body && document.body.classList.contains("dark"); }

  function syncStatusBar(dark) {
    try {
      var C = window.Capacitor;
      var SB = C && C.Plugins && C.Plugins.StatusBar;
      if (!SB) return;
      // Capacitor Style.Dark = LIGHT icons/text (for a dark background) and vice-versa.
      if (SB.setStyle) SB.setStyle({ style: dark ? "DARK" : "LIGHT" });
      // Android tints the bar itself; iOS overlay throws here, hence the inner guard.
      if (SB.setBackgroundColor) { try { SB.setBackgroundColor({ color: dark ? CONFIG.colorDark : CONFIG.colorLight }); } catch (e) {} }
    } catch (e) {}
  }
  function syncSystemUI() {
    var dark = isDark();
    try { ensureMeta().setAttribute("content", dark ? CONFIG.colorDark : CONFIG.colorLight); } catch (e) {}
    syncStatusBar(dark);
  }

  var lastDark = null;
  function maybeSync() {
    var d = isDark();
    if (d === lastDark) return;               // ignore unrelated body-class churn
    lastDark = d;
    syncSystemUI();
  }

  // ── Capture-phase interceptor: wrap real toggle taps in the reveal ──────────────────────────
  function onClickCapture(e) {
    if (reentrant) return;                    // our own synthetic re-dispatch — let it through
    var t = e.target && e.target.closest ? e.target.closest(TOGGLE_SEL) : null;
    if (!t) return;
    if (!supportsVT) return;                  // no API → keep the existing instant switch (no flash)

    // Tap origin. e.detail===0 for keyboard/synthetic activation → fall back to the button centre.
    var x, y;
    if (e.detail === 0) { var rct = t.getBoundingClientRect(); x = rct.left + rct.width / 2; y = rct.top + rct.height / 2; }
    else { x = e.clientX; y = e.clientY; }

    e.preventDefault();
    e.stopImmediatePropagation();             // swallow the real click; we re-fire it inside the VT
    revealFrom(x, y, function () { t.click(); });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────────────────
  function init() {
    injectStyle();
    applyConfig();
    // Intercept as early as possible (capture phase, top of the tree).
    window.addEventListener("click", onClickCapture, true);
    // Keep system UI in lock-step with the theme, however it changes.
    maybeSync();
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) { if (muts[i].attributeName === "class") { maybeSync(); break; } }
      });
      mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {}
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });

  // ── Expose the reusable API ────────────────────────────────────────────────────────────────
  window.SMD_THEME_REVEAL = {
    supported: supportsVT,
    toggle: toggle,
    revealFrom: revealFrom,
    syncSystemUI: syncSystemUI,
    config: CONFIG,
    applyConfig: function () { applyConfig(); }   // call after mutating .config
  };
})();
