/* StewardMD — keyboard-aware screens (keyboard-aware.js).
 *
 * When the keyboard opens:
 *   1. the focused field glides into the visible area if the keyboard (or the notch) is covering it;
 *   2. a bar pinned to the bottom of the screen (a composer, a Save/Next footer) rides up above the
 *      keyboard instead of hiding behind it, and settles back when the keyboard closes;
 *   3. `--smd-kb` (px) is published on <html> for any CSS that wants it.
 *
 * It only ever acts on what is STILL covered ~450ms after the keyboard appears, so screens that
 * already manage the keyboard themselves (onboarding, PrepNucleus, phone verify, profile setup,
 * reasoning) are left alone: after their own handling nothing is covered and this does nothing.
 * Uses window.visualViewport (the part the user can see); a no-op where it does not exist or where
 * the web view itself resizes (then the viewport shrinks with the keyboard and nothing is covered).
 * Kill switch: localStorage smd_kb_aware=0. */
(function () {
  "use strict";
  // How much of the layout viewport the keyboard covers.
  function overlap(innerH, vvH, vvTop) { return Math.max(0, Math.round(innerH - (vvH + vvTop))); }
  // The scroll delta that puts a covered field in the middle of the visible band; 0 when it is fine.
  function scrollDelta(rect, visTop, visBottom, margin) {
    margin = margin == null ? 12 : margin;
    if (rect.top >= visTop + margin && rect.bottom <= visBottom - margin) return 0;
    var mid = (visTop + visBottom) / 2, fieldMid = (rect.top + rect.bottom) / 2;
    return Math.round(fieldMid - mid);
  }
  // A pinned footer/composer: sits on the bottom edge, is wide and short.
  function isBottomBar(r, vw, vh) { return r.bottom >= vh - 4 && r.bottom <= vh + 2 && r.width >= vw * 0.6 && r.height >= 36 && r.height <= 170; }
  var seam = { overlap: overlap, scrollDelta: scrollDelta, isBottomBar: isBottomBar };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_kb_aware") === "0") return; } catch (e) {}
  window.SMD_KB_SEAM = seam;

  var EDIT = "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=file]),textarea,[contenteditable=''],[contenteditable=true]";
  var moved = [];     // [{ el, prev }] bars we lifted
  var settleT = 0, kb = 0;
  function vv() { return window.visualViewport || null; }
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  function layerOf(el) { var n = el; while (n.parentElement && n.parentElement !== document.body) n = n.parentElement; return n; }
  function scroller(el) {
    for (var n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && n.scrollHeight > n.clientHeight + 2) return n;
    }
    return document.scrollingElement;
  }
  function nudgeField() {
    var f = document.activeElement, v = vv(); if (!f || !f.matches || !f.matches(EDIT) || !v) return;
    var d = scrollDelta(f.getBoundingClientRect(), v.offsetTop, v.offsetTop + v.height, 12);
    if (!d) return;
    var sc = scroller(f); if (!sc) return;
    try { sc.scrollTo({ top: sc.scrollTop + d, behavior: reduced() ? "auto" : "smooth" }); } catch (e) { sc.scrollTop += d; }
  }
  function liftBars(px) {
    var f = document.activeElement; if (!f || !f.closest) return;
    var layer = layerOf(f), all = layer.querySelectorAll("*"), vw = innerWidth, vh = innerHeight;
    for (var i = 0; i < all.length && i < 1800; i++) {
      var el = all[i];
      if (moved.some(function (m) { return m.el === el || m.el.contains(el); })) continue;
      var cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "absolute" && cs.position !== "sticky") continue;
      if (cs.transform !== "none" || el.hasAttribute("data-kb-managed")) continue;      // someone else moves it
      if (!isBottomBar(el.getBoundingClientRect(), vw, vh)) continue;
      if (!el.querySelector("button,input,textarea,[contenteditable],a[href]") && !el.matches(EDIT)) continue;
      moved.push({ el: el, prev: { t: el.style.transform, tr: el.style.transition } });
      el.style.transition = reduced() ? "none" : "transform .28s cubic-bezier(.32,.72,0,1)";
      el.style.transform = "translate3d(0," + (-px) + "px,0)";
    }
  }
  function lowerBars() {
    moved.forEach(function (m) {
      m.el.style.transform = "translate3d(0,0,0)";
      setTimeout(function () { m.el.style.transform = m.prev.t; m.el.style.transition = m.prev.tr; }, 320);
    });
    moved = [];
  }

  function onVV() {
    var v = vv(); if (!v) return;
    var px = overlap(innerHeight, v.height, v.offsetTop);
    document.documentElement.style.setProperty("--smd-kb", px + "px");
    clearTimeout(settleT);
    if (px < 60) { if (kb >= 60) { kb = 0; lowerBars(); } kb = px; return; }
    var rising = kb < 60; kb = px;
    // Wait for the keyboard animation and for any module that handles it itself, then act on what is still covered.
    settleT = setTimeout(function () {
      var v2 = vv(); if (!v2) return;
      var px2 = overlap(innerHeight, v2.height, v2.offsetTop);
      if (px2 < 60) return;
      liftBars(px2);
      nudgeField();
    }, rising ? 450 : 200);
  }
  document.addEventListener("focusin", function (e) {
    if (!e.target || !e.target.matches || !e.target.matches(EDIT)) return;
    if (kb >= 60) setTimeout(nudgeField, 120);    // moving between fields with the keyboard already up
  }, true);
  if (vv()) { vv().addEventListener("resize", onVV); vv().addEventListener("scroll", onVV); }
})();
