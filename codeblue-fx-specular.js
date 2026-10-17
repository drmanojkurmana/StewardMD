/* Adapted from React Bits (reactbits.dev) by David Haz, MIT + Commons Clause, see docs/codeblue/third-party/react-bits-LICENSE.md */
/* codeblue-fx-specular.js: specular edge highlight (SpecularButton, reduced).
 * Static highlight position taken from pointer/touch down. No looping
 * animation, no WebGL, no canvas. CSS in codeblue-fx.css paints the edge.
 * API: window.CodeBlueFX.specular.enhance(el), .enhanceAll(root) */
(function () {
  "use strict";
  window.CodeBlueFX = window.CodeBlueFX || {};
  function onDown(e) {
    var el = e.currentTarget, r = el.getBoundingClientRect();
    var cx = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    var cy = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    if (r.width) el.style.setProperty("--cbfx-spec-x", Math.max(0, Math.min(100, (cx - r.left) / r.width * 100)) + "%");
    if (r.height) el.style.setProperty("--cbfx-spec-y", Math.max(0, Math.min(100, (cy - r.top) / r.height * 100)) + "%");
    el.classList.add("cbfx-spec-on");
  }
  function enhance(el) {
    if (!el || el.getAttribute("data-cbfx-specular") === "ready") return;
    el.setAttribute("data-cbfx-specular", "ready"); el.classList.add("cbfx-specular");
    el.addEventListener("pointerdown", onDown); el.addEventListener("touchstart", onDown, { passive: true });
  }
  function enhanceAll(root) {
    if (!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll("[data-cbfx-specular]");
    for (var i = 0; i < els.length; i++) enhance(els[i]);
  }
  window.CodeBlueFX.specular = { enhance: enhance, enhanceAll: enhanceAll };
})();
