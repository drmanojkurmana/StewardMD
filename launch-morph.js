/* StewardMD — the launch logo flies into the home header (launch-morph.js).
 *
 * When the boot splash finishes (it gets `sbs-hide`), instead of the splash simply fading away and
 * the header logo appearing, the splash's logo lifts off, shrinks and lands exactly on the header
 * logo (`.rnav-brand img`) while the splash background fades, one continuous motion.
 *
 * Only when it can be true: the splash logo and the header logo both exist, the header logo is
 * really visible (nothing like the account gate or intro poster is covering it), and the user has
 * not asked for reduced motion. Otherwise the splash behaves exactly as before.
 * Kill switch: localStorage smd_launch_morph=0. */
(function () {
  "use strict";
  // Transform that maps rect `a` onto rect `b` (scale about the top-left, then translate).
  function fit(a, b) { return { dx: b.left - a.left, dy: b.top - a.top, s: b.width / a.width }; }
  var seam = { fit: fit };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_launch_morph") === "0") return; } catch (e) {}
  window.SMD_MORPH_SEAM = seam;

  var splash = document.getElementById("smdBootSplash");
  if (!splash || !window.MutationObserver) return;
  try { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
  var done = false;

  function go() {
    if (done) return; done = true;
    var logo = splash.querySelector("img.sbs-logo"), dest = document.querySelector("#homeV2 .rnav-brand img");
    if (!logo || !dest) return;
    var a = logo.getBoundingClientRect(), b = dest.getBoundingClientRect();
    if (a.width < 20 || b.width < 8 || b.bottom <= 0 || b.top >= innerHeight) return;
    // The header logo must really be what the user would see there.
    var hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    var home = document.getElementById("homeV2");
    if (!hit || !home || !(hit === dest || home.contains(hit) || splash.contains(hit))) return;
    if (!logo.animate) return;
    var f = fit(a, b);
    var clone = logo.cloneNode(false);
    clone.removeAttribute("id"); clone.setAttribute("aria-hidden", "true"); clone.alt = "";
    clone.style.cssText = "position:fixed;z-index:2147483100;pointer-events:none;margin:0;left:" + a.left + "px;top:" + a.top + "px;width:" + a.width +
      "px;height:" + a.height + "px;transform-origin:0 0;will-change:transform";
    document.body.appendChild(clone);
    logo.style.visibility = "hidden";
    var prev = dest.style.visibility; dest.style.visibility = "hidden";
    var anim = clone.animate([
      { transform: "translate(0,0) scale(1)" },
      { transform: "translate(" + f.dx + "px," + f.dy + "px) scale(" + f.s + ")" }
    ], { duration: 640, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" });
    var end = function () { dest.style.visibility = prev; clone.remove(); };
    anim.onfinish = end; anim.oncancel = end;
    setTimeout(end, 1200);   // never leave the header logo hidden
  }

  new MutationObserver(function (m, obs) {
    if (splash.classList.contains("sbs-hide")) { obs.disconnect(); go(); }
  }).observe(splash, { attributes: true, attributeFilter: ["class"] });
})();
