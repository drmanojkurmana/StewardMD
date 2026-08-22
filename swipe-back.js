/* StewardMD — Universal edge-swipe-back + back-handle (iOS + Android).
 * ===========================================================================
 * A rightward drag from the LEFT EDGE goes back one step, with the current screen
 * sliding under the finger (WhatsApp-style). Tapping the always-available left-edge
 * back-handle does the same, and Android's system/hardware back too. One action, goBack():
 *   1. Top-most open overlay → activate its BACK control (never Close, so we step ONE
 *      screen back to the previous page instead of dismissing all the way to home).
 *   2. Else the clinical engine (5-step form / Clinical Decision output) → window._SMD_goBack().
 *   3. Else (home/root) → nothing (iOS); Android exits the app.
 * At HOME the same edge-drag has nothing to go back to, so it SLIDES THE MENU OPEN instead
 * (gesture only — Android's hardware back still exits at root).
 * Reuses each screen's own back logic — no per-screen wiring. The edge-handle appears on
 * every screen that can go back, so no module is a dead-end even without its own button.
 *
 * Enabled on native + installed PWA (a desktop/web browser keeps its own gesture). A drag
 * that begins inside a horizontally-scrollable area is left to scroll instead of going back.
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
  // A "back" control (step one screen back) vs a "close" control (dismiss the whole overlay). When an
  // overlay header has BOTH (e.g. insulin: aria-label="Back" then aria-label="Close"), swipe-back must
  // click Back — clicking Close dumped the user to home instead of the previous screen.
  var BACK_ONLY = '[data-act="back"],[aria-label^="Back"],[aria-label^="back"],.step-nav-back,[class*="-back"],[class*="-sback"]';
  function isBack(el) { try { return !!(el.matches && el.matches(BACK_ONLY)); } catch (e) { return false; } }

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

  // The element goBack() activates at step 1: the top-most overlay's control, preferring a Back control
  // (step one screen back) over a Close control (dismiss to home). null when no overlay control is on screen.
  function topBackControl() {
    var els = [].slice.call(document.querySelectorAll(BACK_SEL)).filter(function (el) { return el.id !== "smdTopBack" && onScreen(el) && interactive(el); });
    if (!els.length) return null;
    els.sort(function (a, b) {
      var za = zOf(a), zb = zOf(b);
      if (za !== zb) return za - zb;
      return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });
    var topZ = zOf(els[els.length - 1]);
    var top = els.filter(function (el) { return zOf(el) === topZ; });
    var backs = top.filter(isBack);
    return backs.length ? backs[backs.length - 1] : top[top.length - 1];
  }
  // Home is the true foreground screen (nothing covering it) — the same check refreshFab() in
  // home.js uses for the FAB's own visibility. If home owns the screen center there is nowhere
  // further "back" to go (see #3 in the file header), no matter what topBackControl()'s
  // pattern-matching (BACK_SEL is necessarily broad — any "-close"/"-back" class or aria-label
  // prefix) thinks it found on the page; a stray match there must never win over this.
  function homeIsForeground() {
    var h = document.getElementById("homeV2");
    if (!h || !h.classList.contains("on")) return false;
    var cs = window.getComputedStyle(h);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    try {
      var el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
      return !!(el && h.contains(el));
    } catch (e) { return false; }
  }
  // True when there is somewhere to go back to (drives the universal edge back-handle's visibility).
  function canGoBack() {
    if (homeIsForeground()) return false;
    try { if (window.ATLAS && window.ATLAS.isOpen && window.ATLAS.isOpen()) return true; } catch (e) {}
    try { if (window.FUNDX && window.FUNDX.isOpen && window.FUNDX.isOpen()) return true; } catch (e) {}
    if (topBackControl()) return true;
    return !!(engineActive() && typeof window._SMD_goBack === "function");
  }

  var _last = 0;
  function goBack() {
    var now = Date.now();
    if (now - _last < 400) return true;                        // debounce: one back per gesture
    // 0) FundX / Atlas AI full-screen overlay owns back while open.
    try { if (window.ATLAS && window.ATLAS.isOpen && window.ATLAS.isOpen()) { _last = now; return window.ATLAS.back() !== false; }
    if (window.FUNDX && window.FUNDX.isOpen && window.FUNDX.isOpen()) { _last = now; return window.FUNDX.back() !== false; } } catch (e) {}
    // 1) top-most open overlay → its BACK control (never Close, so we step back, not jump home)
    var ctrl = topBackControl();
    if (ctrl) { _last = now; try { ctrl.click(); } catch (e) {} return true; }
    // 2) clinical engine (incl. the Clinical Decision output, which has no visible Back button)
    if (engineActive() && typeof window._SMD_goBack === "function") {
      _last = now;
      // BUG-10: a stewardship page opened from Clinical Reasoning returns to the reasoning workspace.
      if (window.__smdDxReturn) { window.__smdDxReturn = false; try { if (window.DX && DX.openWorkspace) { DX.openWorkspace(); return true; } } catch (e) {} }
      try { window._SMD_goBack(); } catch (e) {}
      return true;
    }
    return false;                                              // 3) at root
  }

  // At HOME there is nowhere to go back to (step 3 above), so the same left-edge rightward drag
  // opens the main menu instead of doing nothing — the drawer slides in on release (its own CSS
  // transition). Gesture-only: the Android hardware back must still exit at root, so this is NOT
  // inside goBack(). No-op when the drawer is already open or home isn't the foreground screen.
  function openMenuAtHome() {
    if (!homeIsForeground()) return false;
    try { var d = document.getElementById("sbDrawer"); if (d && d.classList.contains("open")) return false; } catch (e) {}
    try { if (window.SB && typeof SB.open === "function") { SB.open(); return true; } } catch (e) {}
    return false;
  }
  // With the menu already open it covers the left edge, so a further RIGHTWARD drag on it is a
  // no-op (it closes by swiping left, tapping the backdrop, or hardware back — all unchanged).
  function edgeSwipeAction() {
    try { var d = document.getElementById("sbDrawer"); if (d && d.classList.contains("open")) return true; } catch (e) {}
    return openMenuAtHome() || goBack();
  }

  // The screen to slide during an interactive edge-drag = the largest positioned (fixed/absolute) ancestor
  // of the top back control (the module's overlay container). null → no element to drag (discrete back only).
  function overlayRootOf(el) {
    var best = null, n = el;
    while (n && n.nodeType === 1 && n !== document.body) {
      var cs = window.getComputedStyle(n);
      if (cs.position === "fixed" || cs.position === "absolute") {
        var r = n.getBoundingClientRect();
        if (r.width >= window.innerWidth * 0.55 && r.height >= window.innerHeight * 0.45) best = n;
      }
      n = n.parentElement;
    }
    return best;
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

  // ── Universal top-left back button (WhatsApp-style): shown on any screen that CAN go back but does NOT
  //    already have its own top-left back/close control — so every module gets a visible back button without
  //    per-module edits and without duplicating existing ones. Tap = goBack. Hidden at home/root. ──
  var _btn = null;
  function ensureBackBtn() {
    if (_btn) return _btn;
    var b = document.createElement("button");
    b.id = "smdTopBack"; b.type = "button"; b.setAttribute("aria-label", "Back");
    b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
    b.style.cssText = "position:fixed;left:9px;top:calc(env(safe-area-inset-top,0px) + 9px);z-index:99000;width:38px;height:38px;"
      + "display:none;align-items:center;justify-content:center;border:none;border-radius:50%;cursor:pointer;"
      + "background:rgba(15,118,110,.92);color:#fff;box-shadow:0 2px 10px -2px rgba(0,0,0,.45);-webkit-tap-highlight-color:transparent";
    b.addEventListener("click", function (ev) { ev.stopPropagation(); goBack(); setTimeout(syncHandle, 80); });
    (document.body || document.documentElement).appendChild(b);
    _btn = b; return b;
  }
  // Does the top-most screen already show a back/close control in the top-left corner? (Then no need for ours.)
  function hasTopLeftControl() {
    var els = [].slice.call(document.querySelectorAll(BACK_SEL)).filter(function (el) { return el.id !== "smdTopBack" && onScreen(el) && interactive(el); });
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > 4 && r.height > 4 && r.top < 150 && r.left < 150) return true;
    }
    return false;
  }
  // hasTopLeftControl() only catches a BACK_SEL match sitting top-left. A bottom sheet like MaiK
  // (height:86vh) leaves home's OWN top-left header button genuinely visible above it, while MaiK's
  // Close sits top-RIGHT — so hasTopLeftControl sees no top-left match and would show our button
  // right on top of home's. Detect that by asking whether the topmost overlay's own root even
  // reaches the top of the viewport: if it doesn't, home is exposed above it and our button would
  // double up on home's control regardless of where the overlay's own control sits. A full-screen
  // overlay (root.top===0) doesn't expose home, so this never falsely suppresses the button on a
  // dead-end screen that has no back control of its own.
  function topExposesHome() {
    var ctrl = topBackControl();
    var root = ctrl && overlayRootOf(ctrl);
    return !!(root && root.getBoundingClientRect().top > 8);
  }
  function syncHandle() {
    try { ensureBackBtn().style.display = (canGoBack() && !hasTopLeftControl() && !topExposesHome()) ? "flex" : "none"; } catch (e) {}
  }

  var enable = isNative || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (enable) {
    var sx = 0, sy = 0, t0 = 0, tracking = false, dragging = false, dragEl = null, curDx = 0;
    var DIST = 70, EDGE = 30, MAXTIME = 800;                  // start ≤30px from the left edge; ≥70px (or 32% width) completes
    function vw() { return window.innerWidth || 360; }
    function setX(el, x, anim) {
      if (!el) return;
      el.style.transition = anim ? "transform .18s ease" : "none";
      el.style.transform = x ? ("translateX(" + x + "px)") : "";
      el.style.boxShadow = x ? "-14px 0 34px -12px rgba(0,0,0,.45)" : "";
    }
    function endDrag(complete) {
      var el = dragEl; dragging = false; dragEl = null;
      if (complete) { edgeSwipeAction(); if (el) { try { el.style.transition = ""; el.style.transform = ""; el.style.boxShadow = ""; } catch (e) {} } setTimeout(syncHandle, 80); }
      else if (el) { setX(el, 0, true); setTimeout(function () { try { el.style.transition = ""; } catch (e) {} }, 220); }
    }
    document.addEventListener("touchstart", function (e) {
      dragging = false; dragEl = null; curDx = 0; tracking = false;
      if (e.touches.length !== 1) return;
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY; t0 = Date.now();
      if (sx > EDGE || inHScroll(e.target)) return;           // only a left-edge start can be a back-swipe
      tracking = true;
      var ctrl = topBackControl(); dragEl = ctrl ? overlayRootOf(ctrl) : null;
    }, { passive: true });
    document.addEventListener("touchmove", function (e) {
      if (!tracking) return;
      var t = e.touches && e.touches[0]; if (!t) return;
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (!dragging) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) { tracking = false; return; }   // not a rightward-horizontal drag
        dragging = true;
      }
      curDx = Math.max(0, dx);
      if (dragEl) { setX(dragEl, curDx, false); if (e.cancelable) e.preventDefault(); }   // own the horizontal drag
    }, { passive: false });
    document.addEventListener("touchend", function (e) {
      if (!tracking) return; tracking = false;
      var t = e.changedTouches && e.changedTouches[0], dt = Date.now() - t0;
      var dx = t ? (t.clientX - sx) : curDx;
      var far = curDx >= vw() * 0.32 || (dx >= DIST && dt <= MAXTIME);
      if (dragging) endDrag(far);
      else if (far) edgeSwipeAction();                          // valid edge flick with no draggable overlay (at home: opens the menu)
    }, { passive: true });
  }

  // keep the handle synced as screens open/close (cheap DOM poll; also refreshed after each goBack)
  setInterval(syncHandle, 900);
  if (document.readyState !== "loading") syncHandle();
  else document.addEventListener("DOMContentLoaded", syncHandle);

  // Android system-gesture / hardware back → close the top menu / step back, else exit at root.
  try {
    if (isNative && C.Plugins && C.Plugins.App && C.Plugins.App.addListener) {
      C.Plugins.App.addListener("backButton", function () {
        if (!goBack()) { try { C.Plugins.App.exitApp(); } catch (e) {} }
        setTimeout(syncHandle, 80);
      });
    }
  } catch (e) {}

  window.SMD_SWIPE_BACK = { goBack: goBack, canGoBack: canGoBack, openMenuAtHome: openMenuAtHome, edgeSwipeAction: edgeSwipeAction, enabled: enable, engineActive: engineActive, syncHandle: syncHandle };
})();
