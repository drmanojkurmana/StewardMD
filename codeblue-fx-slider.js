/* Adapted from React Bits (reactbits.dev) by David Haz, MIT + Commons Clause, see docs/codeblue/third-party/react-bits-LICENSE.md */
/* codeblue-fx-slider.js: elastic slider (ElasticSlider behaviour, reduced).
 * Touch-first native range input with a filled track, a default marker and
 * a short elastic settle on release (transform on the thumb only). Keyboard
 * and screen-reader behaviour stay native. Reduced motion settles instantly.
 * API: window.CodeBlueFX.slider.enhance(input), .enhanceAll(root) */
(function () {
  "use strict";
  window.CodeBlueFX = window.CodeBlueFX || {};
  function reduced(el) {
    try {
      var r = el && el.closest ? el.closest("#cblRoot") : null;
      if (r && (r.classList.contains("cbl-reduced") || r.getAttribute("data-cb-motion") === "reduced")) return true;
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return false; }
  }
  function paint(el) {
    var min = parseFloat(el.min || "0"), max = parseFloat(el.max || "100"), v = parseFloat(el.value || "0");
    var pct = max > min ? (v - min) / (max - min) * 100 : 0;
    el.style.setProperty("--cbfx-fill", pct + "%");
    var out = el.closest(".cbfx-slider-row") ? el.closest(".cbfx-slider-row").querySelector("[data-cbfx-value]") : null;
    if (out) out.textContent = el.value + (el.getAttribute("data-unit") || "");
  }
  function enhance(el) {
    if (!el || el.getAttribute("data-cbfx-slider") === "ready") return;
    el.setAttribute("data-cbfx-slider", "ready"); el.classList.add("cbfx-slider");
    paint(el);
    el.addEventListener("input", function () { paint(el); });
    el.addEventListener("pointerdown", function () { el.classList.add("cbfx-drag"); });
    var end = function () {
      el.classList.remove("cbfx-drag");
      if (!reduced(el)) { el.classList.add("cbfx-settle"); setTimeout(function () { el.classList.remove("cbfx-settle"); }, 180); }
      paint(el);
    };
    el.addEventListener("pointerup", end); el.addEventListener("change", end);
  }
  function enhanceAll(root) {
    if (!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll("[data-cbfx-slider]");
    for (var i = 0; i < els.length; i++) enhance(els[i]);
  }
  window.CodeBlueFX.slider = { enhance: enhance, enhanceAll: enhanceAll, _paint: paint };
})();
