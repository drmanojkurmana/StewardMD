/* StewardMD — haptic ticks for sliders and scroll pickers (picker-haptics.js).
 *
 * Like the clicks of an iOS picker wheel: every slider (<input type=range>, dose/weight/time) ticks
 * once per step as the thumb crosses it, with a firmer tick at either end, and every small vertical
 * scroll-snap list (a wheel-style picker) ticks once per row that passes the snap line.
 * Uses window.SMD_HAPTICS (haptics.js), which is a no-op on the web and throttled to ~45ms, so a
 * fast fling never buzzes continuously. Kill switch: localStorage smd_picker_haptics=0. */
(function () {
  "use strict";
  // Step index of a range value; null when not computable.
  function stepIndex(value, min, step) {
    var v = parseFloat(value), m = parseFloat(min), s = parseFloat(step);
    if (isNaN(v)) return null;
    if (isNaN(m)) m = 0;
    if (!(s > 0)) s = 1;               // step="any" or missing: whole units
    return Math.round((v - m) / s);
  }
  function snapIndex(scrollTop, rowH) { return rowH > 0 ? Math.round(scrollTop / rowH) : null; }
  var seam = { stepIndex: stepIndex, snapIndex: snapIndex };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_picker_haptics") === "0") return; } catch (e) {}

  var last = new WeakMap();
  function H() { return window.SMD_HAPTICS; }

  document.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "INPUT" || t.type !== "range") return;
    var i = stepIndex(t.value, t.min, t.step);
    if (i === null || last.get(t) === i) return;
    var had = last.has(t); last.set(t, i);
    if (!had) return;                                   // first input event: the starting value, no tick
    var h = H(); if (!h) return;
    var v = parseFloat(t.value), atEnd = v <= parseFloat(t.min || "0") || v >= parseFloat(t.max || "100");
    try { if (atEnd && h.light) h.light(); else if (h.selection) h.selection(); } catch (x) {}
  }, true);
  // Seed on touch so the first change from the current value ticks.
  document.addEventListener("pointerdown", function (e) {
    var t = e.target;
    if (t && t.tagName === "INPUT" && t.type === "range") last.set(t, stepIndex(t.value, t.min, t.step));
  }, true);

  // Wheel-style pickers: a small vertical scroller with mandatory/proximity y snapping.
  var pick = new WeakMap();
  function pickerInfo(sc) {
    var info = pick.get(sc);
    if (info !== undefined) return info;
    info = null;
    var cs = getComputedStyle(sc);
    if (/(^|\s)(y|block|both)(\s|$)/.test(cs.scrollSnapType || "") && sc.clientHeight <= 320 && sc.children.length >= 3) {
      var row = sc.children[Math.min(1, sc.children.length - 1)].getBoundingClientRect().height;
      if (row >= 16 && row <= 80) info = { row: row, idx: snapIndex(sc.scrollTop, row) };
    }
    pick.set(sc, info);
    return info;
  }
  document.addEventListener("scroll", function (e) {
    var sc = e.target;
    if (!sc || sc.nodeType !== 1) return;
    var info = pickerInfo(sc); if (!info) return;
    var i = snapIndex(sc.scrollTop, info.row);
    if (i === info.idx) return;
    info.idx = i;
    var h = H(); try { if (h && h.selection) h.selection(); } catch (x) {}
  }, { capture: true, passive: true });
})();
