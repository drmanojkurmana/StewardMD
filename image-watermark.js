/* image-watermark.js: the brand watermark on content images.
 * Owner 2026-11-05 chose variant E ("just 3"); owner 2026-11-07 found three marks irritating and asked for the style of
 * a textbook figure: ONE large, very faint PrepNucleus mark and name across the middle, and a small "PrepNucleus ·
 * Powered by StewardMD" line, the same lockup as the PrepNucleus home header (prep-plan.js wmHtml).
 * Owner 2026-11-11: the PrepNucleus marks belong to PrepNucleus only. Everywhere else an image carries one small
 * StewardMD logo in its bottom right corner. The overlay holds both looks and image-viewer.css picks one from where
 * the image is: inside PrepNucleus (#smdPrep, which exists only while it is open) or the Image Library (.igl-overlay)
 * it is the big centre mark plus the lockup in the bottom right corner; anywhere else, the small StewardMD corner.
 * Press and hold a watermarked image and the corner badges fade (.smd-wm-peek) so the labels under them can be read;
 * they come back on release. The big centre PrepNucleus mark never fades (owner 2026-11-11).
 * Drawn OVER the image (an overlay span), never burned into the file, so originals stay clean.
 *
 * Images from Wikimedia Commons are not ours: they never get the big mark across them, and keep their author and
 * licence credit wherever the app shows it.
 *
 * window.SMD_WM = {
 *   on()            true unless switched off (localStorage smd_watermark = "0" or ?wm=0; ?wm=1 turns it back on)
 *   html(src)       the overlay markup for an image (empty when off); put it inside a .smd-wm-host that wraps the image
 *   follow(img)     for a viewer image that zooms by transform: keeps an overlay on the image's box and copies its transform
 *   peekScope(el)   the overlays a press on el fades (pure DOM lookup, used by the hold handler and tests)
 * }
 * Styles: image-viewer.css (.smd-wm*); marks are CSS masks of prepnucleus-wm.png and stewardmd-glyph.png. Used by
 * kb-figure.js and reasoning.js (disease reader figures), image-library.js (thumbnails and its viewer) and prep-viewer.js
 * (the full-screen viewer every tapped image opens in). ES5. */
(function (G) {
  "use strict";
  function on() {
    try {
      var q = (G.location.search.match(/[?&]wm=([^&]+)/) || [])[1];
      if (q === "0" || q === "off") G.localStorage.setItem("smd_watermark", "0");
      if (q === "1" || q === "on") G.localStorage.removeItem("smd_watermark");
      return G.localStorage.getItem("smd_watermark") !== "0";
    } catch (e) { return true; }
  }
  function external(src) { return /(^|\/\/)(upload|thumb|commons)\.wikimedia\.org\//.test(String(src || "")); }
  /* Pure: the overlay markup. */
  function html(src, force) {
    if (!force && !on()) return "";
    var ext = external(src);
    return '<span class="smd-wm' + (ext ? " smd-wm--ext" : "") + '" aria-hidden="true">' +
      (ext ? "" : '<span class="smd-wm-big"><i class="smd-wm-pn"></i><span>PrepNucleus</span></span>') +
      '<span class="smd-wm-by"><i class="smd-wm-pn"></i><span class="smd-wm-pt">PrepNucleus</span><i class="smd-wm-sep"></i>' +
      '<span class="smd-wm-pb">Powered by</span><i class="smd-wm-gl"></i><span class="smd-wm-wd">Steward<b>MD</b></span></span>' +
      '<span class="smd-wm-sm"><i class="smd-wm-gl"></i><span class="smd-wm-wd">Steward<b>MD</b></span></span></span>';
  }
  /* A viewer image is laid out in its stage and zoomed with a CSS transform on the image. The overlay sits on the
   * image's layout box (offsetLeft/Top/Width/Height ignore transforms) in the same stage and copies the transform, so
   * the marks zoom and pan with the picture. Kept in step on load, resize and every style change of the image. */
  function follow(img) {
    if (!img || !img.parentNode || !on() || img.__smdWm) return null;
    var host = img.parentNode, D = img.ownerDocument;
    var tmp = D.createElement("div"); tmp.innerHTML = html(img.currentSrc || img.src);
    var ov = tmp.firstChild; if (!ov) return null;
    ov.classList.add("smd-wm--follow");
    host.appendChild(ov);
    img.__smdWm = ov;
    function place() {
      if (!img.isConnected) { stop(); return; }
      var w = img.offsetWidth, h = img.offsetHeight;
      ov.style.display = w && h ? "" : "none";
      ov.style.left = img.offsetLeft + "px"; ov.style.top = img.offsetTop + "px";
      ov.style.width = w + "px"; ov.style.height = h + "px";
      ov.style.transform = img.style.transform || "";
      ov.style.transition = img.style.transition || "";
    }
    var mo = null, ro = null;
    try { mo = new MutationObserver(place); mo.observe(img, { attributes: true, attributeFilter: ["style", "src"] }); } catch (e) {}
    try { ro = new ResizeObserver(place); ro.observe(img); ro.observe(host); } catch (e) {}
    img.addEventListener("load", place);
    G.addEventListener("resize", place);
    function stop() { try { mo && mo.disconnect(); ro && ro.disconnect(); } catch (e) {} G.removeEventListener("resize", place); }
    place();
    return ov;
  }

  /* Press and hold to see under the marks. One listener on the document: a finger (or mouse) held still on a
   * watermarked image for HOLD_MS fades its marks; lifting, cancelling or a second finger (a pinch) brings them back.
   * Nothing is prevented, so taps, pinch, pan and swipe in the viewers work as before. */
  var HOLD_MS = 260, SLOP = 10;
  function peekScope(el) {
    if (!el || !el.closest) return [];
    var host = el.closest(".smd-wm-host");
    if (host) return [].filter.call(host.children, function (c) { return c.classList && c.classList.contains("smd-wm"); });
    var stage = el.closest(".pv-stage, .igl-vstage");
    return stage ? [].slice.call(stage.querySelectorAll(".smd-wm--follow")) : [];
  }
  function installPeek(D) {
    if (!D || !D.addEventListener || D.__smdWmPeek) return;
    D.__smdWmPeek = true;
    var P = null;   // { id, x, y, els, t, on }
    function end() {
      if (!P) return;
      G.clearTimeout(P.t);
      P.els.forEach(function (o) { o.classList.remove("smd-wm-peek"); });
      P = null;
    }
    D.addEventListener("pointerdown", function (e) {
      if (P) { if (!P.on) end(); return; }   // a second finger: a pinch, not a hold
      if (e.button > 0) return;
      var els = peekScope(e.target);
      if (!els.length) return;
      P = { id: e.pointerId, x: e.clientX, y: e.clientY, els: els, on: false };
      P.t = G.setTimeout(function () { if (!P) return; P.on = true; P.els.forEach(function (o) { o.classList.add("smd-wm-peek"); }); }, HOLD_MS);
    }, true);
    D.addEventListener("pointermove", function (e) {
      if (P && !P.on && e.pointerId === P.id && Math.abs(e.clientX - P.x) + Math.abs(e.clientY - P.y) > SLOP) end();
    }, true);
    ["pointerup", "pointercancel"].forEach(function (n) { D.addEventListener(n, function (e) { if (P && e.pointerId === P.id) end(); }, true); });
    G.addEventListener("blur", end);
  }
  if (G.document) installPeek(G.document);

  var api = { on: on, html: html, follow: follow, peekScope: peekScope, _external: external };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  G.SMD_WM = api;
})(typeof window !== "undefined" ? window : globalThis);
