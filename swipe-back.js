/* StewardMD — Universal swipe-to-go-back (iOS + Android).
 * ===========================================================================
 * A horizontal swipe — LEFT or RIGHT, anywhere on the screen — goes back, on every
 * page and window. Android's system/hardware back does the same. One action, goBack():
 *   1. If a menu/overlay is open  → activate its top-most Back/Close control.
 *   2. Else if the clinical engine is showing (5-step form OR the Clinical Decision
 *      output) → step back via the app's own window._SMD_goBack().
 *   3. Else (home/root) → nothing (iOS); Android exits the app.
 * Reuses each screen's existing back logic — no per-screen wiring.
 *
 * Enabled on native + installed PWA (a desktop/web browser keeps its own gesture).
 * Never preventDefaults; a swipe that begins inside a horizontally-scrollable area
 * (e.g. the antibiogram grid) is left to scroll instead of going back.
 * ======================================================================== */
(function () {
  "use strict";
  var C = window.Capacitor;
  var isNative = !!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform());

  // Back/Close controls across every overlay/menu. Pattern-based (the app uses dozens of
  // per-screen classes: abg-back, dx-close, mcp-back, ghis-back, sp-close, sb-x, hqp-close,
  // icu-v2-back/-sback …) rather than an ever-growing explicit list. aria-labels are matched by
  // PREFIX (^=) so descriptive labels — "Back to unit board", "Close ICU — back to home" — still
  // count (exact match missed them, so swipe-back silently no-op'd on those screens). Candidates
  // are filtered to interactive elements so a decorative "*-background" div is never a button.
  var BACK_SEL = [
    '[data-act="close"]', '[data-act="back"]', '[data-dismiss]',
    '[aria-label^="Back"]', '[aria-label^="Close"]', '[aria-label^="back"]', '[aria-label^="close"]',
    '.step-nav-back', '.sb-x',
    '[class*="-back"]', '[class*="-sback"]', '[class*="-close"]', '[class*="-cancel"]', '[class*="-dismiss"]'
  ].join(',');
  function interactive(el) {
    if (el.matches && el.matches('button,a,[role="button"],[data-act],[onclick]')) return true;
    if (el.onclick) return true;
    try { return window.getComputedStyle(el).cursor === "pointer"; } catch (e) { return false; }
  }

  function onScreen(el) {
    if (!el) return false;
    var n = el;                                    // a closed overlay is often hidden on a PARENT
    while (n && n.nodeType === 1) {
      var cs = window.getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") < 0.05) return false;
      n = n.parentElement;
    }
    var r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
  }
  function zOf(el) {
    var z = 0, n = el;
    while (n && n.nodeType === 1) {
      var cs = window.getComputedStyle(n);
      if (cs.position && cs.position !== "static") { var v = parseInt(cs.zIndex, 10); if (!isNaN(v)) z = Math.max(z, v); }
      n = n.parentElement;
    }
    return z;
  }
  // The clinical engine (5-step form / Clinical Decision output) is showing.
  function engineActive() {
    return onScreen(document.getElementById("inputCard")) || onScreen(document.getElementById("outputArea"));
  }

  var _last = 0;
  function goBack() {
    var now = Date.now();
    if (now - _last < 400) return true;                        // debounce: one back per gesture
    // 0) FundX AI full-screen overlay owns back while open — step back within it (camera ->
    //    precapture -> home -> close) instead of the generic scan leaking to the main app.
    try { if (window.ATLAS && window.ATLAS.isOpen && window.ATLAS.isOpen()) { _last = now; return window.ATLAS.back() !== false; }
    if (window.FUNDX && window.FUNDX.isOpen && window.FUNDX.isOpen()) { _last = now; return window.FUNDX.back() !== false; } } catch (e) {}
    // 1) top-most open menu/overlay
    var els = [].slice.call(document.querySelectorAll(BACK_SEL)).filter(function (el) { return onScreen(el) && interactive(el); });
    if (els.length) {
      els.sort(function (a, b) {
        var za = zOf(a), zb = zOf(b);
        if (za !== zb) return za - zb;
        return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
      });
      _last = now;
      try { els[els.length - 1].click(); } catch (e) {}
      return true;
    }
    // 2) clinical engine (incl. the Clinical Decision output, which has no visible Back button)
    if (engineActive() && typeof window._SMD_goBack === "function") {
      _last = now;
      // BUG-10: if this stewardship page was opened by selecting a syndrome from Clinical Reasoning,
      // Back returns to the reasoning workspace (the screen the user drilled in from), not the engine step.
      if (window.__smdDxReturn) { window.__smdDxReturn = false; try { if (window.DX && DX.openWorkspace) { DX.openWorkspace(); return true; } } catch (e) {} }
      try { window._SMD_goBack(); } catch (e) {}
      return true;
    }
    return false;                                              // 3) at root
  }

  // Skip when the gesture starts inside a horizontally-scrollable area (let it scroll).
  function inHScroll(el) {
    var n = el;
    while (n && n.nodeType === 1 && n !== document.body) {
      if (n.scrollWidth > n.clientWidth + 4) {
        var ox = window.getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      n = n.parentElement;
    }
    return false;
  }

  var enable = isNative || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (enable) {
    var sx = 0, sy = 0, t0 = 0, tracking = false;
    var DIST = 72, MAXOFF = 0.6, MAXTIME = 700;               // ≥72px horizontal, dominantly horizontal, brisk
    document.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      var t = e.touches[0];
      tracking = !inHScroll(e.target);
      sx = t.clientX; sy = t.clientY; t0 = Date.now();
    }, { passive: true });
    document.addEventListener("touchend", function (e) {
      if (!tracking) return; tracking = false;
      var t = e.changedTouches && e.changedTouches[0]; if (!t) return;
      var dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - t0;
      // LEFT or RIGHT swipe: enough horizontal distance, mostly horizontal, quick
      if (Math.abs(dx) >= DIST && Math.abs(dy) <= Math.abs(dx) * MAXOFF && dt <= MAXTIME) goBack();
    }, { passive: true });
  }

  // Android system-gesture / hardware back → close the top menu / step back, else exit at root.
  try {
    if (isNative && C.Plugins && C.Plugins.App && C.Plugins.App.addListener) {
      C.Plugins.App.addListener("backButton", function () {
        if (!goBack()) { try { C.Plugins.App.exitApp(); } catch (e) {} }
      });
    }
  } catch (e) {}

  window.SMD_SWIPE_BACK = { goBack: goBack, enabled: enable, engineActive: engineActive };
})();
