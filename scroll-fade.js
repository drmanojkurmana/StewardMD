/* StewardMD - scroll-fade.js: horizontal scroll rows fade at the edge that has more to show (owner 2026-11-18, the
 * "masked scroll edges" hack, app-wide). A row of chips, tabs or cards that is cut off hard at the screen edge does
 * not say it scrolls; a soft fade there does.
 *
 * Generic: finds horizontal scrollers by their computed overflow-x (auto/scroll) among likely row elements, and keeps
 * data-sfade on each: "s" when content is hidden at the start, "e" at the end, both, or removed when it all fits.
 * ui-refine.css turns that into a mask. Rows that already mask themselves (computed mask-image) are left alone.
 * Cheap: one capture-phase scroll listener (passive), a throttled rescan on DOM changes and resize, no layout work
 * per frame beyond the scrolled row. Kill switch: html.no-ui-refine (localStorage smd_ui_refine = "0"). */
(function (G) {
  "use strict";
  var ROW = "[class*='chip'],[class*='scroll'],[class*='rail'],[class*='strip'],[class*='tabs'],[class*='row'],[class*='pills'],[class*='carousel'],[class*='seg'],[class*='filters'],[class*='shelf'],[class*='reel'],[role='tablist']";
  // Pure: which edges hide content. -> "", "s", "e" or "s e".
  function edges(scrollLeft, scrollWidth, clientWidth) {
    var max = scrollWidth - clientWidth;
    if (max <= 4) return "";
    var x = Math.abs(scrollLeft);               // RTL scrollers report negative scrollLeft
    var out = [];
    if (x > 2) out.push("s");
    if (x < max - 2) out.push("e");
    return out.join(" ");
  }
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = { edges: edges, ROW: ROW }; return; }
  if (!G || !G.document) return;
  var D = G.document;
  function off() { return D.documentElement.classList.contains("no-ui-refine"); }

  var own = typeof WeakSet === "function" ? new WeakSet() : null;   // rows with their own mask: never touched
  var known = typeof WeakSet === "function" ? new WeakSet() : null;
  function isScroller(el) {
    try {
      var cs = G.getComputedStyle(el);
      if (cs.overflowX !== "auto" && cs.overflowX !== "scroll") return false;
      if (!el.hasAttribute("data-sfade")) {
        var mk = cs.webkitMaskImage || cs.maskImage;
        if (mk && mk !== "none") { if (own) own.add(el); return false; }
      }
      return true;
    } catch (e) { return false; }
  }
  function update(el) {
    if (own && own.has(el)) return;
    var v = edges(el.scrollLeft, el.scrollWidth, el.clientWidth);
    if (!v) { if (el.hasAttribute("data-sfade")) el.removeAttribute("data-sfade"); return; }
    if (el.getAttribute("data-sfade") !== v) el.setAttribute("data-sfade", v);
  }
  function scan() {
    if (off()) return;
    var list;
    try { list = D.querySelectorAll(ROW); } catch (e) { return; }
    for (var i = 0; i < list.length && i < 800; i++) {
      var el = list[i];
      if (own && own.has(el)) continue;
      if (!el.clientWidth || el.scrollWidth <= el.clientWidth + 4) { if (el.hasAttribute("data-sfade")) el.removeAttribute("data-sfade"); continue; }
      if (!(known && known.has(el)) && !isScroller(el)) continue;
      if (known) known.add(el);
      update(el);
    }
  }
  var t = 0;
  function soon() { if (t) return; t = setTimeout(function () { t = 0; scan(); }, 400); }

  D.addEventListener("scroll", function (e) {
    var el = e.target;
    if (el && el.nodeType === 1 && (el.hasAttribute("data-sfade") || (known && known.has(el)))) update(el);
  }, { capture: true, passive: true });
  G.addEventListener("resize", soon, { passive: true });
  function boot() {
    // Rescan on inserted content and shown/hidden blocks, and after a tap (a tab or filter swaps a row in). Class and
    // style flips are not watched: animations toggle them many times a second.
    try { new MutationObserver(soon).observe(D.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] }); } catch (e) {}
    D.addEventListener("pointerup", soon, { capture: true, passive: true });
    soon();
  }
  if (D.body) boot(); else D.addEventListener("DOMContentLoaded", boot);
  G.SMD_SCROLL_FADE = { scan: scan, edges: edges };
})(typeof window !== "undefined" ? window : this);
