/* StewardMD — images reveal softly instead of popping in (blur-up.js).
 *
 * An image that is still loading when it appears (Atlas plates, ECGs, CliniX figures, drug and
 * protocol diagrams) stays invisible until it has arrived, then fades from a soft blur to sharp.
 * No more half-painted images filling in line by line. Images already in cache (complete on
 * insertion), tiny icons, logos and data: images are untouched, so nothing that was instant gets slower.
 *
 * There is no low-resolution preview file to blur up from, so the "blur" is the reveal itself.
 * Safety: an image that errors is shown as-is; nothing stays hidden after 8s.
 * Kill switch: localStorage smd_blur_up=0. */
(function () {
  "use strict";
  // Worth animating? Skip icons/logos/thumbnails.
  function shouldAnimate(natW, natH, dispW) { return natW * natH >= 160 * 160 && dispW >= 72; }
  var seam = { shouldAnimate: shouldAnimate };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_blur_up") === "0") return; } catch (e) {}
  window.SMD_BLURUP_SEAM = seam;

  var pending = new WeakMap();   // img -> safety timer
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function unhide(img) { img.style.opacity = ""; img.style.visibility = ""; }

  function watch(img) {
    if (img.nodeType !== 1 || img.tagName !== "IMG" || pending.has(img)) return;
    if (img.complete || img.hasAttribute("data-no-blur")) return;
    var src = img.getAttribute("src") || img.currentSrc || "";
    if (!src || /^data:/i.test(src) || /logo|icon|mark|avatar|sprite/i.test(src) || img.closest("button,[data-no-blur]")) return;
    img.style.opacity = "0";
    pending.set(img, setTimeout(function () { pending.delete(img); unhide(img); }, 8000));
  }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.tagName === "IMG") { watch(root); return; }
    var imgs = root.getElementsByTagName("img");
    for (var i = 0; i < imgs.length && i < 200; i++) watch(imgs[i]);
  }
  function reveal(img) {
    var t = pending.get(img); if (t === undefined) return;
    clearTimeout(t); pending.delete(img);
    var ok = img.naturalWidth && shouldAnimate(img.naturalWidth, img.naturalHeight, img.getBoundingClientRect().width);
    if (!ok || !img.animate) { unhide(img); return; }
    var go = function () {
      var kf = reduced() ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, filter: "blur(14px)", transform: "scale(1.035)" }, { opacity: 1, filter: "blur(0px)", transform: "none" }];
      try { img.animate(kf, { duration: reduced() ? 160 : 440, easing: "cubic-bezier(.2,.8,.2,1)" }); } catch (e) {}
      unhide(img);
    };
    // Decoded before it is shown: no mid-paint frame.
    if (img.decode) img.decode().then(go, go); else go();
  }
  document.addEventListener("load", function (e) { if (e.target && e.target.tagName === "IMG") reveal(e.target); }, true);
  document.addEventListener("error", function (e) {
    var img = e.target; if (img && img.tagName === "IMG" && pending.has(img)) { clearTimeout(pending.get(img)); pending.delete(img); unhide(img); }
  }, true);

  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === "attributes") { clearTimeout(pending.get(m.target)); pending.delete(m.target); watch(m.target); continue; }   // src assigned after insertion
      for (var j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]);
    }
  });
  function start() { mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] }); }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
