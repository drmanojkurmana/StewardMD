/* PrepNucleus motion layer. window.PREP_MOTION. ES5.
   prep.js calls attach(root) when the overlay opens and detach() when it closes. A MutationObserver watches what each
   screen paints and adds the moments that carry meaning, once each:
   - home: the readiness ring draws and its number counts up (first time per open and exam), the sections settle in;
   - an answer: the feedback card springs up, the right option lifts, a wrong one shakes, with a success or error haptic;
   - finish screens (set, test, battle, lesson, cards): the hero card springs in, its ring draws, a success haptic;
   - sheets rise on a spring, battle round results pop; subject tiles tilt under a mouse or trackpad (never on touch).
   Springs come from Motion (motion.dev, MIT, vendored at /vendor/motion/motion.js). The app may already hold an older
   Motion One build on window.Motion (OncoTree), so a modern build is evaluated privately and window.Motion is left alone.
   Everything animates transform and opacity only (the ring stroke is the one SVG paint). Without Motion, or under
   prefers-reduced-motion, nothing here runs and the CSS fallback in prep.css shows the final state. */
(function (G) {
  "use strict";
  if (!G || !G.document) return;
  var D = G.document, SRC = "/vendor/motion/motion.js";
  var M = null, loading = false, root = null, mo = null, io = null, seen = {}, tiltEl = null;

  function reduced() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function finePointer() { try { return G.matchMedia("(hover: hover) and (pointer: fine)").matches; } catch (e) { return false; } }
  function modern(m) { return !!(m && m.animate && m.frame && m.stagger); }
  function haptic(k) { try { if (G.SMD_HAPTICS && G.SMD_HAPTICS[k]) G.SMD_HAPTICS[k](); } catch (e) {} }

  // A modern Motion build: window.Motion when it already is one, else the vendored file evaluated into a private object.
  function ensure() {
    if (M || loading) return;
    if (modern(G.Motion)) { M = G.Motion; ready(); return; }
    if (!G.fetch) return;
    loading = true;
    G.fetch(SRC).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }).then(function (src) {
      var ex = {}; new Function("exports", "module", "define", src)(ex, { exports: ex }, undefined);
      if (modern(ex)) { M = ex; ready(); }
    }).then(null, function () {}).then(function () { loading = false; });
  }
  function ready() { if (root) root.classList.add("pn-mo"); }

  // Entrances: a strong ease-out under 300 ms. Springs only where something lands with weight (finish card, sheet).
  // Keyframes always name the same transform function at both ends: Motion cannot interpolate to "none".
  var EASE = [0.23, 1, 0.32, 1];
  var ENTER = { duration: 0.26, ease: EASE };
  var POP = { type: "spring", visualDuration: 0.4, bounce: 0.2 };
  function anim(el, kf, opt) { try { return M.animate(el, kf, opt); } catch (e) { return null; } }

  // The ring: from empty to its value (WAAPI on the stroke), the number beside it counting up with it.
  function drawRing(ring, num, key) {
    var rv = ring && ring.querySelector(".rv");
    if (!rv || !rv.animate || seen[key]) return;
    seen[key] = 1;
    var target = parseFloat(rv.getAttribute("stroke-dasharray")) || 0, a;
    try { a = rv.animate([{ strokeDasharray: "0 100" }, { strokeDasharray: target + " 100" }], { duration: 900, easing: "cubic-bezier(.23, 1, .32, 1)" }); } catch (e) { return; }
    var t = num && num.firstChild && num.firstChild.nodeType === 3 ? num.firstChild : null;
    if (!t) return;
    (function tick() {
      var p = 1; try { p = a.playState === "finished" ? 1 : Math.min(1, (a.currentTime || 0) / 900); } catch (e) {}
      var e = 1 - Math.pow(1 - p, 3);
      t.nodeValue = String(Math.round(target * e));
      if (p < 1 && t.isConnected) G.requestAnimationFrame(tick); else t.nodeValue = String(target);
    })();
  }

  // Decorative layer for hero surfaces: three meteors. Paused off screen (IntersectionObserver) and under reduced motion.
  function fx(el) {
    if (el.querySelector(":scope > .pn-fx")) return;
    var s = D.createElement("span"); s.className = "pn-fx"; s.setAttribute("aria-hidden", "true"); s.innerHTML = "<i></i><i></i><i></i>";
    el.insertBefore(s, el.firstChild);
    if (io) io.observe(el);
  }

  function scan(el) {
    if (!el || el.nodeType !== 1) return;
    var list = [el].concat(Array.prototype.slice.call(el.querySelectorAll(".pl-hero,.pn-home,.pn-fb,.pn-score,.pn-lsn-fin,.pk-end,.pn-sheet,.pn-round,.pn-lobby")));
    list.forEach(function (n) {
      if (n.__pnMo) return;
      var c = n.classList;
      if (c.contains("pl-hero")) { n.__pnMo = 1; fx(n); drawRing(n.querySelector(".pl-ring"), n.querySelector(".pl-num"), "hero:" + (n.getAttribute("aria-label") || "")); return; }
      if (c.contains("pn-home")) {
        n.__pnMo = 1;
        if (seen.home) return;
        seen.home = 1;
        var kids = Array.prototype.slice.call(n.children, 0, 10);
        anim(kids, { opacity: [0, 1], transform: ["translateY(12px)", "translateY(0px)"] }, { duration: 0.32, ease: EASE, delay: M.stagger(0.03) });
        return;
      }
      if (c.contains("pn-fb")) {
        n.__pnMo = 1;
        var ok = c.contains("ok");
        anim(n, { opacity: [0, 1], transform: ["translateY(12px)", "translateY(0px)"] }, ENTER);
        var opt = root && root.querySelector(ok ? ".pn-opt.right" : ".pn-opt.wrong");
        if (opt) anim(opt, ok ? { transform: ["scale(1)", "scale(1.025)", "scale(1)"] } : { transform: ["translateX(0px)", "translateX(-6px)", "translateX(6px)", "translateX(-3px)", "translateX(0px)"] }, { duration: ok ? 0.28 : 0.3, ease: "easeOut" });
        haptic(ok ? "success" : "error");
        return;
      }
      if (c.contains("pn-score") || c.contains("pn-lsn-fin") || c.contains("pk-end") || c.contains("pn-lobby")) {
        n.__pnMo = 1; fx(n);
        anim(n, { opacity: [0, 1], transform: ["scale(0.95)", "scale(1)"] }, POP);
        var ring = n.querySelector(".pn-ring");
        if (ring) drawRing(ring, null, "ring:" + Math.random());
        if (!c.contains("pn-lobby") && (ring || c.contains("pn-lsn-fin") || c.contains("pk-end") || c.contains("win"))) haptic("success");
        return;
      }
      if (c.contains("pn-sheet")) { n.__pnMo = 1; anim(n, { transform: ["translateY(100%)", "translateY(0%)"] }, { type: "spring", visualDuration: 0.34, bounce: 0.06 }); return; }
      if (c.contains("pn-round")) { n.__pnMo = 1; anim(n, { opacity: [0, 1], transform: ["scale(0.95)", "scale(1)"] }, POP); haptic("light"); }
    });
  }

  // Subject tiles lean toward a mouse or trackpad pointer (up to 6 degrees); touch never tilts.
  function onMove(e) {
    if (e.pointerType !== "mouse" || reduced()) return;
    var t = e.target && e.target.closest ? e.target.closest(".pn-tile") : null;
    if (tiltEl && tiltEl !== t) untilt();
    if (!t) return;
    var r = t.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    tiltEl = t; t.classList.add("pn-tilt");
    t.style.transform = "perspective(700px) rotateX(" + (-y * 6).toFixed(2) + "deg) rotateY(" + (x * 6).toFixed(2) + "deg)";
  }
  function untilt() { if (tiltEl) { tiltEl.style.transform = ""; tiltEl.classList.remove("pn-tilt"); tiltEl = null; } }

  function attach(r) {
    detach();
    root = r; seen = {};
    if (!root || reduced()) return;
    ensure();
    if (M) ready();
    try {
      io = G.IntersectionObserver ? new G.IntersectionObserver(function (es) { es.forEach(function (x) { x.target.classList.toggle("pn-off", !x.isIntersecting); }); }) : null;
    } catch (e) { io = null; }
    mo = new G.MutationObserver(function (recs) {
      if (!M) return;
      recs.forEach(function (rec) { Array.prototype.forEach.call(rec.addedNodes, scan); });
    });
    mo.observe(root, { childList: true, subtree: true });
    if (finePointer()) { root.addEventListener("pointermove", onMove); root.addEventListener("pointerleave", untilt); }
  }
  function detach() {
    if (mo) mo.disconnect();
    if (io) io.disconnect();
    if (root) { root.removeEventListener("pointermove", onMove); root.removeEventListener("pointerleave", untilt); }
    mo = io = null; root = null; tiltEl = null;
  }
  G.PREP_MOTION = { attach: attach, detach: detach, ensure: ensure, ready: function () { return !!M; } };
})(typeof window !== "undefined" ? window : this);
