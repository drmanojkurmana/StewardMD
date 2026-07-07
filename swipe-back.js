/* StewardMD — Swipe-to-go-back (iOS + Android).
 * ===========================================================================
 * Adds the native "swipe from the left edge to go back" gesture used on iPhones
 * and Android phones, so users can dismiss any menu/overlay without hunting for
 * the Back button. Two inputs, one action:
 *   • iOS / touch: a left-edge → right swipe (interactive-pop style).
 *   • Android: the system back gesture / hardware back (Capacitor App backButton).
 * Both call goBack(), which finds the TOP-MOST open menu's Back/Close control and
 * activates it — reusing each screen's existing close logic (no per-screen wiring).
 * At the root (nothing open) the Android back exits the app; the edge-swipe no-ops.
 *
 * Enabled on native + installed PWA (standalone). No-op on a normal desktop/web
 * browser (which has its own back gesture). Never calls preventDefault, so page
 * and horizontal-table scrolling are unaffected.
 * ======================================================================== */
(function () {
  "use strict";
  var C = window.Capacitor;
  var isNative = !!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform());

  // Back/Close controls across every overlay/menu (from the app's own markup).
  var BACK_SEL = [
    '[data-act="close"]', '[data-act="back"]', '[aria-label="Back"]', '[aria-label="Close"]',
    '.asp-close', '.step-nav-back', '.abg-back', '.dx-back', '.dx-close', '.mc-back', '.hv-back',
    '.ece-back', '.ddi-back', '.db-back', '.db-close', '.fea-close', '.ntf-close'
  ].join(',');

  function onScreen(el) {
    if (!el) return false;
    // Walk ancestors — a closed overlay is often opacity:0 / display:none on a PARENT
    // (its Back button itself stays laid out), so checking only the element misses it.
    var n = el;
    while (n && n.nodeType === 1) {
      var cs = window.getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") < 0.05) return false;
      n = n.parentElement;
    }
    var r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
  }
  // Effective stacking z of an element (max z-index among positioned ancestors) — used to
  // pick the top-most overlay's back control when several are in the DOM.
  function zOf(el) {
    var z = 0, n = el;
    while (n && n.nodeType === 1) {
      var cs = window.getComputedStyle(n);
      if (cs.position && cs.position !== "static") { var v = parseInt(cs.zIndex, 10); if (!isNaN(v)) z = Math.max(z, v); }
      n = n.parentElement;
    }
    return z;
  }

  var _last = 0;
  function goBack() {
    var now = Date.now();
    if (now - _last < 400) return true;                       // debounce: don't close two menus per gesture
    var els = [].slice.call(document.querySelectorAll(BACK_SEL)).filter(onScreen);
    if (!els.length) return false;
    els.sort(function (a, b) {
      var za = zOf(a), zb = zOf(b);
      if (za !== zb) return za - zb;                          // higher z last
      return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1; // later in DOM last
    });
    _last = now;
    try { els[els.length - 1].click(); } catch (e) {}
    return true;
  }

  // Is the touch starting inside a horizontally-scrollable area that can still scroll left?
  // If so, defer to that scroll instead of going back.
  function inHScroll(el) {
    var n = el;
    while (n && n.nodeType === 1 && n !== document.body) {
      if (n.scrollWidth > n.clientWidth + 2 && n.scrollLeft > 2) {
        var ox = window.getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      n = n.parentElement;
    }
    return false;
  }

  var enable = isNative || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (enable) {
    var sx = 0, sy = 0, t0 = 0, tracking = false, EDGE = 34, DIST = 72;
    document.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      var t = e.touches[0];
      tracking = t.clientX <= EDGE && !inHScroll(e.target);   // must begin at the left edge
      sx = t.clientX; sy = t.clientY; t0 = Date.now();
    }, { passive: true });
    document.addEventListener("touchend", function (e) {
      if (!tracking) return; tracking = false;
      var t = e.changedTouches && e.changedTouches[0]; if (!t) return;
      var dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - t0;
      if (dx > DIST && Math.abs(dy) < Math.abs(dx) * 0.7 && dt < 800) goBack();  // rightward, mostly-horizontal, brisk
    }, { passive: true });
  }

  // Android system-gesture / hardware back → close the top menu, else exit at the root.
  try {
    if (isNative && C.Plugins && C.Plugins.App && C.Plugins.App.addListener) {
      C.Plugins.App.addListener("backButton", function () {
        if (!goBack()) { try { C.Plugins.App.exitApp(); } catch (e) {} }
      });
    }
  } catch (e) {}

  window.SMD_SWIPE_BACK = { goBack: goBack, enabled: enable };
})();
