/* StewardMD — tab bar that gets out of the way, and tap-the-top-to-scroll-up (tab-bar.js).
 *
 * 1. Home's bottom tab bar slides away as you scroll down the page and returns the moment you
 *    scroll up (or reach the top / bottom), like Safari and Music: more room for content.
 *    Also: a small indicator slides under the tab you last opened (the tabs are launchers, so "selected"
 *    means "last opened this session"), and tapping that same tab again while home is scrolled down
 *    scrolls home to the top instead of reopening it (the iOS re-tap convention).
 * 2. Tap the status bar (iOS sends Capacitor's `statusTap` event; a tap in the top 20px of the web
 *    view is treated the same) and the topmost scrolling list smooth-scrolls to its top, the way
 *    every native iOS list does.
 *
 * transform only; never changes the bar's layout box. Kill switches: localStorage smd_tabbar_hide=0,
 * smd_status_top=0, smd_tab_indicator=0. */
(function () {
  "use strict";
  // Direction decision with hysteresis: ignore jitter, always show near the top and the bottom.
  function decide(prevTop, top, maxTop, hidden) {
    var d = top - prevTop;
    if (top <= 80 || (maxTop > 0 && top >= maxTop - 40)) return false;
    if (d > 10) return true;
    if (d < -8) return false;
    return hidden;
  }
  var seam = { decide: decide };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  function off(k) { try { return localStorage.getItem(k) === "0"; } catch (e) { return false; } }
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  window.SMD_TABBAR_SEAM = seam;

  /* ---- 1. hide on scroll ---- */
  if (!off("smd_tabbar_hide")) {
    var last = new WeakMap(), hidden = false, bar = null;
    var getBar = function () { return bar && bar.isConnected ? bar : (bar = document.querySelector(".rnav-tabbar")); };
    var setHidden = function (h) {
      var b = getBar(); if (!b || h === hidden) return;
      hidden = h;
      b.style.transition = reduced() ? "opacity .2s linear" : "transform .34s cubic-bezier(.32,.72,0,1)";
      if (reduced()) b.style.opacity = h ? "0" : ""; else b.style.transform = h ? "translateY(100%)" : "";
      b.style.pointerEvents = h ? "none" : "";
    };
    document.addEventListener("scroll", function (e) {
      var sc = e.target;
      if (!sc || sc.nodeType !== 1 || !sc.classList || !sc.classList.contains("v3-main")) return;
      var top = sc.scrollTop, prev = last.has(sc) ? last.get(sc) : top;
      last.set(sc, top);
      setHidden(decide(prev, top, sc.scrollHeight - sc.clientHeight, hidden));
    }, { capture: true, passive: true });
    // Anything that opens over home (sheet, overlay) or a tab press brings the bar back.
    document.addEventListener("click", function (e) { if (e.target && e.target.closest && e.target.closest(".rnav-tab")) setHidden(false); }, true);
    seam.setHidden = setHidden;
  }

  /* ---- 1b. sliding indicator + re-tap scrolls home to the top ---- */
  if (!off("smd_tab_indicator")) {
    var ind = null, sel = null, KEY = "smd_tab_sel";
    var tabbar = function () { return document.querySelector(".rnav-tabbar"); };
    var place = function (instant) {
      var b = tabbar(); if (!b || !sel) return;
      var t = b.querySelector('.rnav-tab[data-act="' + sel + '"]'); if (!t) return;
      if (!ind || ind.parentNode !== b) {
        ind = document.createElement("i"); ind.className = "rnav-tab-ind"; ind.setAttribute("aria-hidden", "true");
        ind.style.cssText = "position:absolute;left:0;bottom:calc(env(safe-area-inset-bottom,0px) + 3px);width:20px;height:3px;border-radius:3px;" +
          "background:var(--rds-primary,#0e6e63);pointer-events:none;opacity:0;will-change:transform";
        if (getComputedStyle(b).position === "static") b.style.position = "relative";
        b.appendChild(ind); instant = true;
      }
      // Layout offsets, not rects: immune to the sheet-depth scale and the hide-on-scroll translate.
      var x = Math.round(t.offsetLeft + t.offsetWidth / 2 - 10);
      var first = ind.style.opacity !== "1";
      ind.style.transition = (instant || first || reduced()) ? "opacity .2s linear" : "transform .42s cubic-bezier(.32,1.25,.5,1)";
      ind.style.transform = "translateX(" + x + "px)";
      ind.style.opacity = "1";
      var all = b.querySelectorAll(".rnav-tab");
      for (var i = 0; i < all.length; i++) { if (all[i] === t) all[i].setAttribute("aria-current", "true"); else all[i].removeAttribute("aria-current"); }
    };
    try { sel = sessionStorage.getItem(KEY) || null; } catch (e) {}
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest(".rnav-tab"); if (!t) return;
      var k = t.getAttribute("data-act"); if (!k) return;
      var m = document.querySelector("#homeV2 .v3-main");
      if (k === sel && m && m.scrollTop > 60) {   // re-tap of the selected tab, home scrolled down: back to the top
        e.stopPropagation(); e.preventDefault();
        try { m.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" }); } catch (x) { m.scrollTop = 0; }
        try { window.SMD_HAPTICS && SMD_HAPTICS.light(); } catch (x) {}
        return;
      }
      sel = k; try { sessionStorage.setItem(KEY, k); } catch (x) {}
      place(false);
    }, true);
    var again = function () { place(true); };
    window.addEventListener("resize", again); window.addEventListener("orientationchange", again);
    new MutationObserver(function (muts) {
      if (!sel) return;
      for (var i = 0; i < muts.length; i++) for (var j = 0; j < muts[i].addedNodes.length; j++) {
        var n = muts[i].addedNodes[j];
        if (n.nodeType === 1 && (n.classList.contains("rnav-tabbar") || (n.querySelector && n.querySelector(".rnav-tabbar")))) { requestAnimationFrame(again); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    if (sel) { var tries = 0; (function w() { if (tabbar()) again(); else if (++tries < 40) setTimeout(w, 250); })(); }
  }

  /* ---- 2. status-bar tap -> scroll to top ---- */
  if (!off("smd_status_top")) {
    var topScroller = function () {
      var els = document.elementsFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight * 0.45));
      for (var i = 0; i < els.length; i++) {
        for (var n = els[i]; n && n !== document.body; n = n.parentElement) {
          var cs = getComputedStyle(n);
          if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && n.scrollHeight > n.clientHeight + 40 && n.scrollTop > 0) return n;
        }
      }
      return null;
    };
    var toTop = function () {
      var sc = topScroller(); if (!sc) return false;
      try { sc.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" }); } catch (e) { sc.scrollTop = 0; }
      try { window.SMD_HAPTICS && SMD_HAPTICS.light(); } catch (e) {}
      return true;
    };
    window.addEventListener("statusTap", toTop);
    var tapT = 0;
    document.addEventListener("touchstart", function (e) { tapT = e.touches.length === 1 && e.touches[0].clientY < 20 ? Date.now() : 0; }, { passive: true, capture: true });
    document.addEventListener("touchend", function (e) {
      if (!tapT || Date.now() - tapT > 300) return;
      var t = e.changedTouches && e.changedTouches[0];
      if (t && t.clientY < 20) toTop();
      tapT = 0;
    }, { passive: true, capture: true });
    seam.toTop = toTop;
  }
})();
