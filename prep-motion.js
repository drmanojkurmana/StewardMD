/* PrepNucleus motion layer. window.PREP_MOTION. ES5.
   prep.js calls attach(root) when the overlay opens and detach() when it closes. A MutationObserver watches what each
   screen paints and adds the moments that carry meaning, once each:
   - an answer: the feedback card rises a few pixels into place, with a success or error haptic;
   - finish screens (set, test, battle, lesson, cards): the card fades in, its ring draws, a success haptic;
   - sheets rise on a spring; meters fill once on the first paint after a push; screens slide on a shared axis.
   Quiet pass (2026-10-10, owner: premium, no childish gamification): no confetti, balloons, sparkles, sky parallax,
   tile tilt or spotlight, no counting numbers, no lift or shake on options. confetti() and balloons() stay in the API
   as no-ops so callers keep working; a milestone is said in words on the card.
   Springs come from Motion (motion.dev, MIT, vendored at /vendor/motion/motion.js). The app may already hold an older
   Motion One build on window.Motion (OncoTree), so a modern build is evaluated privately and window.Motion is left alone.
   Everything animates transform and opacity only (the ring stroke is the one SVG paint). Without Motion, or under
   prefers-reduced-motion, nothing here runs and the CSS fallback in prep.css shows the final state. */
(function (G) {
  "use strict";
  if (!G || !G.document) return;
  var D = G.document, SRC = "/vendor/motion/motion.js";
  var M = null, loading = false, root = null, attachedAt = 0, navAt = 0, mo = null, seen = {};

  function reduced() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
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


  function scan(el) {
    if (!el || el.nodeType !== 1 || (el.classList && el.classList.contains("pn-ghost"))) return;   // a leaving screen (prep.js paint)
    var list = [el].concat(Array.prototype.slice.call(el.querySelectorAll(".pl-hero,.pn-home,.pn-fb,.pn-score,.pn-lsn-fin,.pk-end,.pn-sheet,.pn-round,.pn-lobby,.pn-streak,.pn-vsi,.pn-rtick,.pn-heat,.pn-mast,.pn-lvb,.pn-mods,.pc-decks,.ps-list,.pl-ws,.pn-hbn,.pn-fills,[data-cele]")));
    list.forEach(function (n) {
      if (n.__pnMo) return;
      var c = n.classList;
      if (c.contains("pl-hero")) {
        // The readiness bar fills once per open and score.
        n.__pnMo = 1;
        var key = "hero:" + (n.getAttribute("aria-label") || ""), bar = n.querySelector(".pl-sbar i");
        var m = bar && /scaleX\(([\d.]+)\)/.exec(bar.getAttribute("style") || "");
        if (!seen[key] && m && +m[1] > 0) anim(bar, { transform: ["scaleX(0)", "scaleX(" + m[1] + ")"] }, { duration: 0.6, ease: EASE, delay: 0.1 });
        seen[key] = 1;
        return;
      }
      // The reveal, once per answer (.pn-new): the explanation rises 8 px into place with a haptic. A repaint (bookmark,
      // tag) keeps still. The options themselves do not move.
      if (c.contains("pn-fb")) {
        n.__pnMo = 1;
        if (!c.contains("pn-new")) return;
        anim(n, { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0px)"] }, { duration: 0.22, ease: EASE });
        haptic(c.contains("ok") ? "success" : "error");
        return;
      }
      if (c.contains("pn-vsi")) { n.__pnMo = 1; vsIntro(n); return; }
      // Round 5: a list's rows settle in one after another, only on the first paint after a push (or when the list
      // arrives within 1.5 s of it) and when a readiness sheet opens; a filter, an answer or a repaint keeps still.
      if (c.contains("pn-mods") || c.contains("pc-decks") || c.contains("ps-list") || c.contains("pl-ws")) {
        n.__pnMo = 1;
        if (n.closest(".pn-home") || (!c.contains("pl-ws") && Date.now() - navAt > 1500)) return;
        var rows = Array.prototype.slice.call(n.children, 0, 12);
        if (rows.length > 1) anim(rows, { opacity: [0, 1], transform: ["translateY(6px)", "translateY(0px)"] }, { duration: 0.22, ease: EASE, delay: M.stagger(0.025, { startDelay: c.contains("pl-ws") ? 0.15 : 0.04 }) });
        return;
      }
      // Round 6: meters fill from empty on the first paint after a push only (subject map, paper subjects, accuracy
      // bars). Each [data-p] child scales to its own value; without one the element itself scales to full.
      if (c.contains("pn-fills")) {
        n.__pnMo = 1;
        if (Date.now() - navAt > 1500) return;
        var bars = Array.prototype.slice.call(n.querySelectorAll("[data-p]"), 0, 12);
        if (!bars.length) bars = [n];
        bars.forEach(function (b, i) { var v = b === n ? 1 : +b.getAttribute("data-p") || 0; if (v > 0) anim(b, { transform: ["scaleX(0)", "scaleX(" + v + ")"] }, { duration: 0.7, ease: EASE, delay: 0.08 + i * 0.04 }); });
        return;
      }
      if (c.contains("pn-mast") || c.contains("pn-lvb")) {
        n.__pnMo = 1;
        Array.prototype.forEach.call(n.querySelectorAll("[data-p]"), function (b, i) { var v = +b.getAttribute("data-p") || 0; if (v > 0) anim(b, { transform: ["scaleX(0)", "scaleX(" + v + ")"] }, { duration: 0.7, ease: EASE, delay: 0.05 + i * 0.04 }); });
        return;
      }
      if (c.contains("pn-score") || c.contains("pn-lsn-fin") || c.contains("pk-end") || c.contains("pn-lobby")) {
        n.__pnMo = 1;
        anim(n, { opacity: [0, 1], transform: ["translateY(6px)", "translateY(0px)"] }, { duration: 0.24, ease: EASE });
        var ring = n.querySelector(".pn-ring");
        if (ring) drawRing(ring, null, "ring:" + Math.random());
        if (!c.contains("pn-lobby") && (ring || c.contains("pn-lsn-fin") || c.contains("pk-end") || c.contains("win"))) haptic("success");
        return;
      }
      if (c.contains("pn-sheet")) { n.__pnMo = 1; var wide = false; try { wide = G.matchMedia("(min-width: 700px)").matches; } catch (e) {} if (wide) anim(n, { opacity: [0, 1], transform: ["scale(0.96)", "scale(1)"] }, { type: "spring", visualDuration: 0.28, bounce: 0 }); else anim(n, { transform: ["translateY(100%)", "translateY(0%)"] }, { type: "spring", visualDuration: 0.34, bounce: 0.06 }); return; }
      if (c.contains("pn-round")) { n.__pnMo = 1; anim(n, { opacity: [0, 1], transform: ["translateY(6px)", "translateY(0px)"] }, { duration: 0.22, ease: EASE }); haptic("light"); }
    });
  }

  // The battle's match screen: the card fades in once, with a haptic.
  function vsIntro(n) {
    anim(n, { opacity: [0, 1] }, { duration: 0.24, ease: EASE });
    haptic("medium");
  }
  // A drag that did not commit settles back on a spring from where the finger left it.
  function settle(el, from, to) {
    if (!M || !root || reduced()) return false;
    el.style.transform = to;
    var a = anim(el, { transform: [from, to] }, { type: "spring", visualDuration: 0.35, bounce: 0.24 });
    return !!a;
  }
  // Retired 2026-10-10 (no celebrations): kept as no-ops for callers (prep.js, prep-lessons.js, prep-arena.js).
  function confetti() {}
  function balloons() {}
  // Screen to screen (round 4). prep.js marks a push (1), a pop (-1) or a tab (0) and calls this right after the paint.
  // Push and pop: the shared axis, the new body arriving 28 px from the side the student is heading to while it fades
  // in (240 ms, strong ease-out); the title and tabs travel 12 px. A tab or filter: the body cross-fades (180 ms).
  // Reduced motion: every case is a 160 ms cross-fade, no travel. WAAPI only (compositor), so it needs no Motion build.
  // The first paint after the overlay opens is not animated: the overlay itself just arrived.
  // A patched screen keeps its body node (prep.js paint): a transition still running on it from the last navigation is
  // ended first, so the new one starts from the settled state instead of stacking on it.
  function wa(el, kf, o) { try { if (el.getAnimations) el.getAnimations().forEach(function (a) { if (a.id === "pn-nav") a.cancel(); }); var a = el.animate(kf, o); a.id = "pn-nav"; return a; } catch (e) { return null; } }
  function nav(r, d) {
    if (!r || r !== root || Date.now() - attachedAt < 450) return;
    var pick = function (s) { return Array.prototype.slice.call(r.querySelectorAll(s)); };
    var body = pick(":scope > .pn-body, :scope > .pn-qprog, :scope > .pn-load"), head = pick(":scope > .pn-bar > .pn-t, :scope > .pn-tabs, :scope > .pn-filters, :scope > .pn-lsn-prog");
    if (d === 0 || reduced()) {
      (d === 0 ? body : body.concat(head)).forEach(function (el) { wa(el, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced() ? 160 : 180, easing: "cubic-bezier(.23, 1, .32, 1)" }); });
      return;
    }
    var x = d > 0 ? 1 : -1;
    if (d > 0) navAt = Date.now();
    body.forEach(function (el) { wa(el, [{ opacity: 0, transform: "translateX(" + 28 * x + "px)" }, { opacity: 1, transform: "translateX(0px)" }], { duration: 240, easing: "cubic-bezier(.23, 1, .32, 1)" }); });
    head.forEach(function (el) { wa(el, [{ opacity: 0, transform: "translateX(" + 12 * x + "px)" }, { opacity: 1, transform: "translateX(0px)" }], { duration: 200, easing: "cubic-bezier(.23, 1, .32, 1)" }); });
  }

  function attach(r) {
    detach();
    root = r; seen = {}; attachedAt = Date.now();
    if (!root || reduced()) return;
    ensure();
    if (M) ready();
    mo = new G.MutationObserver(function (recs) {
      // Without the Motion build everything shows its final state.
      if (!M) return;
      recs.forEach(function (rec) { Array.prototype.forEach.call(rec.addedNodes, scan); });
    });
    mo.observe(root, { childList: true, subtree: true });
  }
  function detach() {
    if (mo) mo.disconnect();
    mo = null; root = null;
  }
  G.PREP_MOTION = { attach: attach, detach: detach, nav: nav, ensure: ensure, ready: function () { return !!M; }, settle: settle, haptic: haptic, confetti: function (el) { if (M && root && !reduced()) confetti(el); }, balloons: function (el) { if (root && !reduced()) balloons(el); } };
})(typeof window !== "undefined" ? window : this);
