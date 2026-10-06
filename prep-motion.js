/* PrepNucleus motion layer. window.PREP_MOTION. ES5.
   prep.js calls attach(root) when the overlay opens and detach() when it closes. A MutationObserver watches what each
   screen paints and adds the moments that carry meaning, once each:
   - home: the readiness ring draws and its number counts up (first time per open and exam), the sections settle in;
   - an answer: the feedback card springs up, the right option lifts, a wrong one shakes, with a success or error haptic;
   - finish screens (set, test, battle, lesson, cards): the hero card springs in, its ring draws, a success haptic;
   - sheets rise on a spring, battle round results pop; tiles tilt and carry a spotlight under a mouse or trackpad
     (never on touch);
   - the painted sky (.pn-sky) drifts up at under half the scroll speed and fades (1:1 under reduced motion, so it still
     leaves with the content), the level bar fills, lesson XP counts up, wins and strong results throw confetti.
   Springs come from Motion (motion.dev, MIT, vendored at /vendor/motion/motion.js). The app may already hold an older
   Motion One build on window.Motion (OncoTree), so a modern build is evaluated privately and window.Motion is left alone.
   Everything animates transform and opacity only (the ring stroke is the one SVG paint). Without Motion, or under
   prefers-reduced-motion, nothing here runs and the CSS fallback in prep.css shows the final state. */
(function (G) {
  "use strict";
  if (!G || !G.document) return;
  var D = G.document, SRC = "/vendor/motion/motion.js";
  var M = null, loading = false, root = null, mo = null, io = null, seen = {}, tiltEl = null, skyRaf = 0, lastSk = 0;
  var TILT = ".pn-tile, .pn-home > .pn-next + .pn-group > .pn-row, #pnCompete > .pn-group > .pn-row";

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

  // Decorative layer for finish screens and the lobby: five sparkles. Paused off screen (IntersectionObserver).
  function fx(el) {
    if (el.querySelector(":scope > .pn-fx")) return;
    var s = D.createElement("span"); s.className = "pn-fx"; s.setAttribute("aria-hidden", "true"); s.innerHTML = "<i></i><i></i><i></i><i></i><i></i>";
    el.insertBefore(s, el.firstChild);
    if (io) io.observe(el);
  }

  function scan(el) {
    if (!el || el.nodeType !== 1) return;
    var list = [el].concat(Array.prototype.slice.call(el.querySelectorAll(".pl-hero,.pn-home,.pn-fb,.pn-score,.pn-lsn-fin,.pk-end,.pn-sheet,.pn-round,.pn-lobby,.pn-streak,.pn-vsi,.pn-rtick,.pn-heat,.pn-mast,.pn-lvb")));
    list.forEach(function (n) {
      if (n.__pnMo) return;
      var c = n.classList;
      if (c.contains("pl-hero")) {
        n.__pnMo = 1; if (io) io.observe(n);
        var key = "hero:" + (n.getAttribute("aria-label") || ""), first = !seen[key], bar = n.querySelector(".pl-lvbar i");
        drawRing(n.querySelector(".pl-ring"), n.querySelector(".pl-num"), key);
        var m = bar && /scaleX\(([\d.]+)\)/.exec(bar.getAttribute("style") || "");
        if (first && m && +m[1] > 0) anim(bar, { transform: ["scaleX(0)", "scaleX(" + m[1] + ")"] }, { duration: 0.9, ease: EASE, delay: 0.15 });
        return;
      }
      if (c.contains("pn-home")) {
        n.__pnMo = 1;
        if (seen.home) return;
        seen.home = 1;
        var kids = Array.prototype.slice.call(n.children, 0, 10);
        anim(kids, { opacity: [0, 1], transform: ["translateY(12px)", "translateY(0px)"] }, { duration: 0.32, ease: EASE, delay: M.stagger(0.03) });
        return;
      }
      // The reveal, once per answer (.pn-new): the chosen option answers first (a lift when right, one shake when
      // wrong), the right option lights, then the explanation springs up from below. A repaint (bookmark, tag) keeps still.
      if (c.contains("pn-fb")) {
        n.__pnMo = 1;
        if (!c.contains("pn-new")) return;
        var ok = c.contains("ok"), right = root && root.querySelector(".pn-opt.right"), wrong = root && root.querySelector(".pn-opt.wrong");
        if (ok && right) anim(right, { transform: ["scale(1)", "scale(1.03)", "scale(1)"] }, { duration: 0.32, ease: EASE });
        if (!ok && wrong) anim(wrong, { transform: ["translateX(0px)", "translateX(-7px)", "translateX(6px)", "translateX(-3px)", "translateX(0px)"] }, { duration: 0.32, ease: "easeOut" });
        anim(n, { opacity: [0, 1], transform: ["translateY(36px)", "translateY(0px)"] }, { type: "spring", visualDuration: 0.38, bounce: 0.16, delay: ok ? 0.06 : 0.14 });
        haptic(ok ? "success" : "error");
        return;
      }
      // "3 in a row": pops when the run grows, not when the next question repaints it.
      if (c.contains("pn-streak")) {
        n.__pnMo = 1;
        var sk = +n.getAttribute("data-n") || 0;
        if (sk > lastSk) anim(n, { opacity: [0, 1], transform: ["scale(0.8)", "scale(1)"] }, { type: "spring", visualDuration: 0.3, bounce: 0.35 });
        lastSk = sk;
        return;
      }
      if (c.contains("pn-vsi")) { n.__pnMo = 1; vsIntro(n); return; }
      if (c.contains("pn-rtick")) { n.__pnMo = 1; tickNum(n, +n.getAttribute("data-from"), +n.getAttribute("data-to"), 900); return; }
      if (c.contains("pn-heat")) { n.__pnMo = 1; var cells = n.querySelectorAll("i.l1,i.l2,i.l3,i.l4"); if (cells.length) anim(cells, { opacity: [0, 1], transform: ["scale(0.4)", "scale(1)"] }, { duration: 0.24, ease: EASE, delay: M.stagger(0.006) }); return; }
      if (c.contains("pn-mast") || c.contains("pn-lvb")) {
        n.__pnMo = 1;
        Array.prototype.forEach.call(n.querySelectorAll("[data-p]"), function (b, i) { var v = +b.getAttribute("data-p") || 0; if (v > 0) anim(b, { transform: ["scaleX(0)", "scaleX(" + v + ")"] }, { duration: 0.7, ease: EASE, delay: 0.05 + i * 0.04 }); });
        return;
      }
      if (c.contains("pn-score") || c.contains("pn-lsn-fin") || c.contains("pk-end") || c.contains("pn-lobby")) {
        n.__pnMo = 1; fx(n);
        anim(n, { opacity: [0, 1], transform: ["scale(0.95)", "scale(1)"] }, POP);
        var ring = n.querySelector(".pn-ring"), xp = n.querySelector(".pn-lsn-xp b"), rv = ring && ring.querySelector(".rv");
        if (ring) drawRing(ring, null, "ring:" + Math.random());
        if (xp) countUp(xp);
        var pct = rv ? parseFloat(rv.getAttribute("stroke-dasharray")) || 0 : 0;
        if (c.contains("win") || (xp && /^\+/.test(xp.textContent)) || pct >= 70) confetti(n);
        if (!c.contains("pn-lobby") && (ring || c.contains("pn-lsn-fin") || c.contains("pk-end") || c.contains("win"))) haptic("success");
        return;
      }
      if (c.contains("pn-sheet")) { n.__pnMo = 1; anim(n, { transform: ["translateY(100%)", "translateY(0%)"] }, { type: "spring", visualDuration: 0.34, bounce: 0.06 }); return; }
      if (c.contains("pn-round")) { n.__pnMo = 1; anim(n, { opacity: [0, 1], transform: ["scale(0.95)", "scale(1)"] }, POP); haptic("light"); }
    });
  }

  // A number rolls from one value to another (the rating after a battle).
  function tickNum(el, from, to, ms) {
    if (!isFinite(from) || !isFinite(to) || from === to) return;
    var t0 = 0;
    (function tick(ts) {
      if (!t0) t0 = ts || 1;
      var p = Math.min(1, ((ts || t0) - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(from + (to - from) * e));
      if (p < 1 && el.isConnected) G.requestAnimationFrame(tick); else el.textContent = String(to);
    })();
  }
  // The battle's VS intro: the two players slide in from their sides, the bolt between them strikes (a short flash),
  // then the rules line settles. About 700 ms in all, once per match.
  function vsIntro(n) {
    var l = n.querySelector(".pn-vsi-p.l"), r = n.querySelector(".pn-vsi-p.r"), bolt = n.querySelector(".pn-bolt"), flash = n.querySelector(".pn-flash"), sub = n.querySelector(".pn-vsi-sub");
    if (l) anim(l, { opacity: [0, 1], transform: ["translateX(-40px)", "translateX(0px)"] }, { type: "spring", visualDuration: 0.42, bounce: 0.22 });
    if (r) anim(r, { opacity: [0, 1], transform: ["translateX(40px)", "translateX(0px)"] }, { type: "spring", visualDuration: 0.42, bounce: 0.22, delay: 0.05 });
    if (bolt) anim(bolt, { opacity: [0, 1], transform: ["scale(0.6) rotate(-8deg)", "scale(1) rotate(0deg)"] }, { type: "spring", visualDuration: 0.3, bounce: 0.4, delay: 0.22 });
    if (flash) anim(flash, { opacity: [0, 0.9, 0], transform: ["scale(0.4)", "scale(1.2)", "scale(1.5)"] }, { duration: 0.5, ease: EASE, delay: 0.26 });
    if (sub) anim(sub, { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0px)"] }, { duration: 0.26, ease: EASE, delay: 0.42 });
    haptic("medium");
  }
  // A drag that did not commit settles back on a spring from where the finger left it.
  function settle(el, from, to) {
    if (!M || !root || reduced()) return false;
    el.style.transform = to;
    var a = anim(el, { transform: [from, to] }, { type: "spring", visualDuration: 0.35, bounce: 0.24 });
    return !!a;
  }
  // "+80" counts up from 0 with the same curve as the ring.
  function countUp(el) {
    var mm = /^(\+?)(\d+)$/.exec(el.textContent || ""); if (!mm) return;
    var to = +mm[2], t0 = 0;
    (function tick(ts) {
      if (!t0) t0 = ts || 1;
      var p = Math.min(1, ((ts || t0) - t0) / 800), e = 1 - Math.pow(1 - p, 3);
      el.textContent = mm[1] + Math.round(to * e);
      if (p < 1 && el.isConnected) G.requestAnimationFrame(tick); else el.textContent = mm[1] + to;
    })();
  }
  // Confetti: 28 pieces burst up from the figure and fall away in about 1.6 s, then the layer is removed.
  var HUES = ["#63f0db", "#ffc35c", "#ff8fa3", "#9fb8ff", "#ffffff", "#b6f58c"];
  function confetti(host) {
    var box = D.createElement("span"); box.className = "pn-confetti"; box.setAttribute("aria-hidden", "true");
    var pieces = [];
    for (var i = 0; i < 28; i++) { var p = D.createElement("i"); p.style.background = HUES[i % HUES.length]; box.appendChild(p); pieces.push(p); }
    host.appendChild(box);
    pieces.forEach(function (p, i) {
      var a = (i / pieces.length) * Math.PI * 2 + Math.random() * 0.4, v = 90 + Math.random() * 90;
      var dx = Math.cos(a) * v, up = -Math.abs(Math.sin(a)) * v - 60, r = (Math.random() * 2 - 1) * 540;
      anim(p, { opacity: [1, 1, 0], transform: ["translate(0px, 0px) rotate(0deg) scale(1)", "translate(" + (dx * 0.8).toFixed(1) + "px, " + up.toFixed(1) + "px) rotate(" + (r / 2).toFixed(0) + "deg) scale(1)", "translate(" + dx.toFixed(1) + "px, " + (up + 260).toFixed(1) + "px) rotate(" + r.toFixed(0) + "deg) scale(0.7)"] },
        { duration: 1.4 + Math.random() * 0.5, ease: [0.2, 0.7, 0.4, 1], delay: 0.12 + Math.random() * 0.08 });
    });
    G.setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 2400);
  }

  // Tiles lean toward a mouse or trackpad pointer (up to 6 degrees) and a spotlight follows it; touch never tilts.
  function onMove(e) {
    if (e.pointerType !== "mouse" || reduced()) return;
    var t = e.target && e.target.closest ? e.target.closest(TILT) : null;
    if (tiltEl && tiltEl !== t) untilt();
    if (!t) return;
    var r = t.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    tiltEl = t; t.classList.add("pn-tilt");
    t.style.setProperty("--mx", ((x + 0.5) * 100).toFixed(1) + "%"); t.style.setProperty("--my", ((y + 0.5) * 100).toFixed(1) + "%");
    t.style.transform = "perspective(700px) rotateX(" + (-y * 6).toFixed(2) + "deg) rotateY(" + (x * 6).toFixed(2) + "deg)";
  }
  // The sky: transform and opacity only, one write per frame.
  function onScroll(e) {
    var b = e.target;
    if (!root || !b || !b.classList || !b.classList.contains("pn-body") || skyRaf) return;
    skyRaf = G.requestAnimationFrame(function () {
      skyRaf = 0;
      var sky = root && root.querySelector(":scope > .pn-sky"); if (!sky) return;
      var y = Math.max(0, b.scrollTop), k = reduced() ? 1 : 0.42;
      sky.style.transform = "translate3d(0, " + (-y * k).toFixed(1) + "px, 0)";
      sky.style.opacity = String(Math.max(0, 1 - y / 520).toFixed(3));
    });
  }
  function untilt() { if (tiltEl) { tiltEl.style.transform = ""; tiltEl.classList.remove("pn-tilt"); tiltEl = null; } }

  function attach(r) {
    detach();
    root = r; seen = {}; lastSk = 0;
    if (root) root.addEventListener("scroll", onScroll, true);
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
    if (root) { root.removeEventListener("pointermove", onMove); root.removeEventListener("pointerleave", untilt); root.removeEventListener("scroll", onScroll, true); }
    mo = io = null; root = null; tiltEl = null;
  }
  G.PREP_MOTION = { attach: attach, detach: detach, ensure: ensure, ready: function () { return !!M; }, settle: settle, haptic: haptic, confetti: function (el) { if (M && root && !reduced()) confetti(el); } };
})(typeof window !== "undefined" ? window : this);
