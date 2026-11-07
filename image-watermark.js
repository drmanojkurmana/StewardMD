/* image-watermark.js: the brand watermark on content images.
 * Owner 2026-11-05 chose variant E ("just 3"); owner 2026-11-07 found three marks irritating and asked for the style of
 * a textbook figure: ONE large, very faint PrepNucleus mark and name across the middle, and a small "PrepNucleus ·
 * Powered by StewardMD" line at the bottom, the same lockup as the PrepNucleus home header (prep-plan.js wmHtml).
 * Drawn OVER the image (an overlay span), never burned into the file, so originals stay clean.
 *
 * Images from Wikimedia Commons are not ours: they get the bottom line only (no big mark across them) and keep their
 * author and licence credit wherever the app shows it.
 *
 * window.SMD_WM = {
 *   on()            true unless switched off (localStorage smd_watermark = "0" or ?wm=0; ?wm=1 turns it back on)
 *   html(src)       the overlay markup for an image (empty when off); put it inside a .smd-wm-host that wraps the image
 *   follow(img)     for a viewer image that zooms by transform: keeps an overlay on the image's box and copies its transform
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
      '<span class="smd-wm-pb">Powered by</span><i class="smd-wm-gl"></i><span class="smd-wm-wd">Steward<b>MD</b></span></span></span>';
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

  var api = { on: on, html: html, follow: follow, _external: external };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  G.SMD_WM = api;
})(typeof window !== "undefined" ? window : globalThis);
