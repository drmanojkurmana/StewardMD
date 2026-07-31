/* syndromes-motion.js — Motion One entrance polish for the reference/console overlays:
 *   • Syndrome library  (#sbrefOverlay / .sbref-sec + chips)   — re-animates on tab switch
 *   • Clinical Reasoning (#dxOverlay / .dx-body blocks)         — once per open
 *   • Ward Sync          (#ghisPanel / .ghis cards)            — once per open
 *
 * Additive + progressive enhancement — NO edits to the minified app.js / engine files. On open it
 * staggers the visible cards/sections in with a real Motion One spring (type:"spring"). UX is
 * unchanged: it fires once per open (interaction like search/filter never re-triggers it), and it
 * only animates elements that are actually visible. Fails safe: reduced-motion respected; if Motion
 * never loads the items just appear. Reuses the vendored /vendor/motion/motion.js (window.Motion). */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // overlay selector -> item selector groups to stagger (group 0 = sections/slide, rest = cards/scale).
  // `body` (optional) = a container whose re-render should re-animate (e.g. the syndrome tabs swap innerHTML).
  var TARGETS = [
    { sel: "#sbrefOverlay", body: "#sbrefBody", items: [".sbref-sec", ".sbref-syn > *"] },  // Syndrome library
    { sel: "#dxOverlay",    items: [".dx-body > *"] },                                        // Clinical Reasoning
    { sel: "#ghisPanel",    items: [".ghis-setup-card", ".ghis-pt-card"] },                   // Ward Sync
    // Every bottom sheet (AI Usage, Drugs, Calculators, settings, hospital picker, KU, ...) is the ONE
    // reused .hv-sheet (openSheet re-renders its .hv-sheet-wrap and toggles .on). Stagger its content in.
    { sel: ".hv-sheet", body: ".hv-sheet", items: [".hv-sheet-wrap > *:not(.hv-grab)"] }
  ];

  function reduced() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function visible(el) { try { return el.getClientRects().length > 0; } catch (e) { return false; } }  // false for display:none
  // Overlay is open only when it carries its open/on class AND is laid out (covers the Ward Sync panel,
  // which stays getClientRects>0 while hidden off-screen via translateX(100%)).
  function isOpen(el) { try { return (el.classList.contains("open") || el.classList.contains("on")) && visible(el); } catch (e) { return false; } }

  function withMotion(cb) {
    if (window.Motion && window.Motion.animate) return cb(window.Motion);
    if (!document.getElementById("smd-motion-js")) {
      var s = document.createElement("script"); s.id = "smd-motion-js"; s.src = "/vendor/motion/motion.js"; s.defer = true;
      (document.head || document.documentElement).appendChild(s);
    }
    var tries = 0;
    (function wait() { if (window.Motion && window.Motion.animate) return cb(window.Motion); if (tries++ > 80) return; setTimeout(wait, 50); })();
  }

  function play(overlay, itemSels) {
    if (!overlay || reduced() || !isOpen(overlay)) return;
    withMotion(function (M) {
      if (!M || !M.animate) return;
      var i = 0;
      itemSels.forEach(function (sel, gi) {
        Array.prototype.forEach.call(overlay.querySelectorAll(sel), function (n) {
          if (!visible(n) || i > 30) return;                     // only what's on screen; cap the burst
          var slide = gi === 0;                                   // first group slides up; later groups (chips) scale in
          var kf = slide ? { opacity: [0, 1], transform: ["translateY(14px)", "translateY(0)"] }
                         : { opacity: [0, 1], transform: ["scale(0.96)", "scale(1)"] };
          try { M.animate(n, kf, { type: "spring", stiffness: slide ? 240 : 320, damping: slide ? 26 : 24, delay: Math.min(i, 12) * 0.05 }); } catch (e) {}
          i++;
        });
      });
    });
  }

  // Sync-hide the about-to-stagger items the INSTANT the overlay opens (in the MutationObserver
  // callback, which runs before the browser paints) so the content never flashes in fully-visible a
  // frame before play()'s Motion stagger fades it in — that flash was the "syndromes flickers on open"
  // bug. reduced-motion skips priming (no animation will run, so items must stay visible).
  function primeItems(overlay, itemSels) {
    if (reduced()) return [];
    var out = [];
    itemSels.forEach(function (sel) {
      Array.prototype.forEach.call(overlay.querySelectorAll(sel), function (n) {
        if (visible(n)) { n.style.opacity = "0"; out.push(n); }
      });
    });
    return out;
  }

  // Per-overlay: fire once when it becomes visible; reset when hidden so the next open re-animates.
  // If `body` is set, a full re-render of that container (innerHTML swap) also re-animates.
  function bind(t) {
    var overlay = document.querySelector(t.sel);
    if (!overlay || overlay.__smdMo) return !!overlay;
    overlay.__smdMo = true;
    var timer = null, wasVis = false;
    function schedule(force) {
      var vis = isOpen(overlay);
      if (!vis) { wasVis = false; return; }
      if (!force && wasVis) return;                              // already animated this open; don't re-run on interaction
      wasVis = true;
      var primed = primeItems(overlay, t.items);                 // SYNC hide (before paint) -> no flash
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { play(overlay, t.items); }, 30);
      setTimeout(function () { primed.forEach(function (n) { try { n.style.opacity = ""; } catch (e) {} }); }, 1400);  // safety: never leave content hidden
    }
    new MutationObserver(function () { schedule(false); }).observe(overlay, { attributes: true, attributeFilter: ["class", "style"] });
    if (t.body) {
      var bodyEl = overlay.querySelector(t.body) || document.querySelector(t.body);
      if (bodyEl) new MutationObserver(function () { wasVis = false; schedule(true); }).observe(bodyEl, { childList: true });
    }
    schedule(false);                                            // in case it's already open at bind time
    return true;
  }

  function scan() { TARGETS.forEach(bind); }

  // Tactile micro-interactions for the syndrome chips (press) + section hover — injected once, no extra file.
  function injectCss() {
    if (document.getElementById("smd-synmo-css")) return;
    var st = document.createElement("style"); st.id = "smd-synmo-css";
    st.textContent =
      "#sbrefBody .sbref-syn>*{transition:transform .13s cubic-bezier(.22,1,.36,1),box-shadow .13s ease}" +
      "#sbrefBody .sbref-syn>*:active{transform:scale(.955)}" +
      "#sbrefBody .sbref-sec{transition:box-shadow .2s ease,transform .2s cubic-bezier(.22,1,.36,1)}" +
      "@media(hover:hover){#sbrefBody .sbref-sec:hover{box-shadow:0 6px 22px rgba(13,27,36,.08)}#sbrefBody .sbref-gl:hover{transform:translateY(-1px)}}";
    (document.head || document.documentElement).appendChild(st);
  }

  function boot() {
    injectCss();
    scan();
    // reasoning/wardsync overlays are created lazily (appended to <body> on first open) — watch for them.
    try { new MutationObserver(scan).observe(document.body, { childList: true }); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
