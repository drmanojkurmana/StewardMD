/* StewardMD — tab bar indicator, re-tap to top, and status-bar tap to top (tab-bar.js).
 *
 * 1. The tab bar always stays put (hide-on-scroll was removed at the owner's request). Home's pill is the only
 *    "current" mark; tapping Home while home is scrolled down scrolls it to the top (the iOS re-tap convention).
 * 2. Tap the status bar (iOS sends Capacitor's `statusTap` event; a tap in the top 20px of the web
 *    view is treated the same) and the topmost scrolling list smooth-scrolls to its top, the way
 *    every native iOS list does.
 *
 * transform only; never changes the bar's layout box. Kill switches: localStorage smd_status_top=0, smd_tab_indicator=0. */
(function () {
  "use strict";
  var seam = {};
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  function off(k) { try { return localStorage.getItem(k) === "0"; } catch (e) { return false; } }
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  window.SMD_TABBAR_SEAM = seam;

  /* ---- 1b. re-tap Home scrolls home to the top ----
   * There used to be a small line that slid under the last tab opened (Drugs, MaiK...). The bar already marks Home
   * with its pill, so after coming back from Drugs the phone showed two "current" tabs, and the line sat off the
   * icon on the floating bar (owner 2026-11-13: "this bar... when I click on drugs it comes there"). iOS marks the
   * current tab one way only, so the line is gone; Home, the only tab that is a place rather than a launcher,
   * keeps the iOS re-tap: tapping it while home is scrolled down returns to the top. */
  if (!off("smd_tab_indicator")) {
    try { sessionStorage.removeItem("smd_tab_sel"); } catch (e) {}
    var stray = function () { var o = document.querySelectorAll(".rnav-tab-ind"); for (var i = 0; i < o.length; i++) o[i].remove(); };
    stray();
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest(".rnav-tab"); if (!t || t.getAttribute("data-act") !== "home") return;
      var m = document.querySelector("#homeV2 .v3-main");
      if (!m || m.scrollTop <= 60) return;
      e.stopPropagation(); e.preventDefault();
      try { m.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" }); } catch (x) { m.scrollTop = 0; }
      try { window.SMD_HAPTICS && SMD_HAPTICS.light(); } catch (x) {}
    }, true);
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
