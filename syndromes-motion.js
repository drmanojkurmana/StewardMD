/* syndromes-motion.js — Motion One polish for the Syndrome library (SB.openRef → #sbrefOverlay/#sbrefBody).
 *
 * Additive + progressive enhancement: staggers the .sbref-sec section blocks (and the syndrome chips)
 * in with a spring on open / tab-switch, so the reference reads as deliberately built, not static.
 * Zero edits to the minified app.js. Fails safe: if Motion is absent or reduced-motion is set, the
 * sections simply appear normally. Reuses the vendored /vendor/motion/motion.js (window.Motion). */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  function reduced() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }

  // Lazy-load the vendored Motion One (index.html doesn't load it), then run cb once ready.
  function withMotion(cb) {
    if (window.Motion && window.Motion.animate) return cb(window.Motion);
    if (!document.getElementById("smd-motion-js")) {
      var s = document.createElement("script");
      s.id = "smd-motion-js"; s.src = "/vendor/motion/motion.js"; s.defer = true;
      (document.head || document.documentElement).appendChild(s);
    }
    var tries = 0;
    (function wait() {
      if (window.Motion && window.Motion.animate) return cb(window.Motion);
      if (tries++ > 80) return;                       // ~4s ceiling; give up silently (sections stay visible)
      setTimeout(wait, 50);
    })();
  }

  // Real Motion One spring lives in the options as type:"spring" — passing spring() as `easing`
  // throws in this vendored build (which would abort the whole animation).
  function play(body) {
    if (!body || reduced()) return;
    withMotion(function (M) {
      if (!M || !M.animate) return;
      var secs = body.querySelectorAll(".sbref-sec");
      Array.prototype.forEach.call(secs, function (n, i) {
        try { M.animate(n, { opacity: [0, 1], transform: ["translateY(14px)", "translateY(0)"] }, { type: "spring", stiffness: 240, damping: 26, delay: Math.min(i, 8) * 0.06 }); } catch (e) {}
      });
      // Syndrome chips settle in just after their section — snappier spring, light and not distracting.
      var chips = body.querySelectorAll(".sbref-syn > *");
      Array.prototype.forEach.call(chips, function (n, i) {
        if (i > 26) return;
        try { M.animate(n, { opacity: [0, 1], transform: ["scale(0.96)", "scale(1)"] }, { type: "spring", stiffness: 320, damping: 24, delay: 0.14 + Math.min(i, 22) * 0.014 }); } catch (e) {}
      });
    });
  }

  // One animation per burst (open + first childList render can both fire) — coalesce.
  var timer = null;
  function schedule() {
    var ov = document.getElementById("sbrefOverlay");
    if (!ov || !ov.classList.contains("open")) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { play(document.getElementById("sbrefBody")); }, 30);
  }

  function hook() {
    var ov = document.getElementById("sbrefOverlay"), body = document.getElementById("sbrefBody");
    if (!ov || !body) return false;
    // Fires when the overlay opens (class toggles to "open").
    new MutationObserver(schedule).observe(ov, { attributes: true, attributeFilter: ["class"] });
    // Fires when the body re-renders (switching syndromes ↔ antibiogram ↔ guidelines tabs).
    new MutationObserver(schedule).observe(body, { childList: true });
    return true;
  }

  // Tactile micro-interactions (CSS, injected once — no extra file, no app.js edit): tappable
  // syndrome chips give a crisp press response; sections lift subtly on hover.
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
    if (hook()) return;
    var n = 0, iv = setInterval(function () { if (hook() || n++ > 50) clearInterval(iv); }, 200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
