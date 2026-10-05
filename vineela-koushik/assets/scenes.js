/* Scenes: the film's timeline. GSAP + ScrollTrigger drive the opening, the title sequence,
   pinned scroll scenes and the lighting of the environment. If GSAP is unavailable or the
   guest prefers reduced motion, everything is shown in a calm, static composition. */
(function () {
  "use strict";
  var VK = (window.VK = window.VK || {});
  var S = (VK.scenes = {});
  var root = document.documentElement;
  var REDUCED = root.classList.contains("rm");
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var gsap = window.gsap, ST = window.ScrollTrigger;
  var CINEMA = !!(gsap && ST) && !REDUCED;
  S.cinematic = CINEMA;

  /* ── palettes: the lighting of each scene ── */
  var PAL = {
    night:     { a: "#140906", b: "#070302", glow: "#7A2A10", ga: .55, gx: 50, gy: 34, vig: .75 },
    ivory:     { a: "#F9F2E3", b: "#EEDFC2", glow: "#FFDF98", ga: .75, gx: 50, gy: 42, vig: .16 },
    mandap:    { a: "#8A1A12", b: "#3E070C", glow: "#F2A93B", ga: .6,  gx: 50, gy: 28, vig: .55 },
    dusk:      { a: "#1E0B0E", b: "#07060E", glow: "#6E3410", ga: .32, gx: 50, gy: 50, vig: .82 },
    midnight:  { a: "#0A0F1E", b: "#092A21", glow: "#C88A3A", ga: .32, gx: 50, gy: 18, vig: .7 },
    emerald:   { a: "#062019", b: "#020C09", glow: "#E8A24E", ga: .12, gx: 50, gy: 58, vig: .82 },
    starlight: { a: "#120B08", b: "#040302", glow: "#9A6A28", ga: .36, gx: 50, gy: 46, vig: .8 }
  };
  // warm waypoints so dark-to-light changes pass through lamplight, never grey
  var VIA = {
    "night>ivory": { a: "#A9652C", b: "#4A1E0A", glow: "#FFC870", ga: .95, gx: 50, gy: 40, vig: .45 },
    "ivory>mandap": { a: "#E9A53A", b: "#B4581C", glow: "#FFE2A0", ga: .7, gx: 50, gy: 34, vig: .3 }
  };
  var THEME = { night: "ember", ivory: "ivory", mandap: "mandap", dusk: "night", midnight: "night", emerald: "emerald", starlight: "star" };
  var AUDIO = { title: "title", intro: "couple", couple: "couple", muhurtham: "muhurtham", journey: "journey", reception: "reception", lamps: "lamps", finale: "finale" };

  var bd = document.getElementById("backdrop");
  var warmth = 0;
  var current = Object.assign({}, PAL.night);
  function applyPalette(p) {
    current = p;
    var ga = p.ga, glow = p.glow;
    if (warmth > 0 && p === lampPal) { ga = p.ga + warmth * .55; }
    bd.style.setProperty("--bg-a", p.a); bd.style.setProperty("--bg-b", p.b);
    bd.style.setProperty("--glow", glow); bd.style.setProperty("--ga", ga.toFixed(3));
    bd.style.setProperty("--gx", p.gx + "%"); bd.style.setProperty("--gy", p.gy + "%");
    bd.style.setProperty("--vig", (+p.vig).toFixed(3));
  }
  var lampPal = null;

  function lerpColor(a, b, t) {
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var r = Math.round(((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * t));
    var g = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * t));
    var bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * t));
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  function lerpPal(A, B, t) {
    return { a: lerpColor(A.a, B.a, t), b: lerpColor(A.b, B.b, t), glow: lerpColor(A.glow, B.glow, t),
      ga: A.ga + (B.ga - A.ga) * t, gx: A.gx + (B.gx - A.gx) * t, gy: A.gy + (B.gy - A.gy) * t, vig: A.vig + (B.vig - A.vig) * t };
  }

  /* ── small utilities ── */
  function splitChars(el) {
    var t = el.textContent; el.textContent = "";
    el.setAttribute("aria-label", t);
    t.split("").forEach(function (c) {
      var s = document.createElement("span"); s.className = "ch"; s.setAttribute("aria-hidden", "true");
      s.textContent = c; el.appendChild(s);
    });
    el.setAttribute("data-split-done", "");
    return $$(".ch", el);
  }
  function splitWords(el) {
    var words = el.textContent.trim().split(/\s+/);
    el.setAttribute("aria-label", el.textContent.trim());
    el.innerHTML = "";
    words.forEach(function (w, i) {
      var s = document.createElement("span"); s.className = "w"; s.setAttribute("aria-hidden", "true"); s.textContent = w;
      el.appendChild(s); if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
    });
    return $$(".w", el);
  }
  // odometer: digits become vertical strips that can roll
  function odometer(el) {
    var txt = el.textContent; el.textContent = "";
    var strips = [];
    txt.split("").forEach(function (c) {
      if (/\d/.test(c)) {
        var o = document.createElement("span"); o.className = "odo";
        var s = document.createElement("span"); s.className = "odo-s";
        for (var d = 0; d <= 9; d++) { var n = document.createElement("span"); n.textContent = d; s.appendChild(n); }
        o.appendChild(s); el.appendChild(o);
        s.dataset.d = c; strips.push(s);
        if (el.dataset.fit !== undefined) o.style.width = digitW(el, c);
      } else { el.appendChild(document.createTextNode(c)); }
    });
    return strips;
  }
  var mctx = document.createElement("canvas").getContext("2d");
  function digitW(el, c) {
    var cs = getComputedStyle(el); mctx.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    return (mctx.measureText(c).width / parseFloat(cs.fontSize)).toFixed(3) + "em";
  }
  S.odometer = odometer;
  S.setDigit = function (strip, d) { strip.style.transform = "translateY(" + (-d) + "em)"; };

  // draw-on mask for dotted map routes
  function routeMask(path, i) {
    var svg = path.ownerSVGElement, ns = "http://www.w3.org/2000/svg";
    var defs = svg.querySelector("defs") || svg.insertBefore(document.createElementNS(ns, "defs"), svg.firstChild);
    var m = document.createElementNS(ns, "mask"), id = "rm" + i + Math.random().toString(36).slice(2, 6);
    m.setAttribute("id", id); m.setAttribute("maskUnits", "userSpaceOnUse");
    m.setAttribute("x", "-50"); m.setAttribute("y", "-50"); m.setAttribute("width", "500"); m.setAttribute("height", "300");
    var c = document.createElementNS(ns, "path");
    c.setAttribute("d", path.getAttribute("d")); c.setAttribute("fill", "none"); c.setAttribute("stroke", "#fff");
    c.setAttribute("stroke-width", "8"); c.setAttribute("pathLength", "1"); c.setAttribute("stroke-dasharray", "1");
    c.setAttribute("stroke-dashoffset", "1");
    m.appendChild(c); defs.appendChild(m); path.setAttribute("mask", "url(#" + id + ")");
    return c;
  }

  /* ── generative ornaments ── */
  function muggu(svgHost, rings) {
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "-200 -200 400 400"); svg.setAttribute("aria-hidden", "true");
    var g = document.createElementNS(ns, "g");
    g.setAttribute("fill", "none"); g.setAttribute("stroke", "currentColor"); g.setAttribute("stroke-width", "1.2");
    function add(tag, at) { var e = document.createElementNS(ns, tag); for (var k in at) e.setAttribute(k, at[k]); g.appendChild(e); return e; }
    (rings || [60, 120, 180]).forEach(function (r, ri) {
      add("circle", { r: r, "stroke-dasharray": ri === 1 ? "2 6" : "" });
      var n = 8 * (ri + 1);
      for (var i = 0; i < n; i++) {
        var a = i / n * 360, a1 = r - 18, a2 = r + 18, w = 9 + ri * 2;
        add("path", { d: "M" + a1 + " 0 Q" + r + " " + w + " " + a2 + " 0 Q" + r + " " + (-w) + " " + a1 + " 0Z", transform: "rotate(" + a + ")" });
        add("circle", { cx: Math.cos(a * Math.PI / 180) * (r + 30), cy: Math.sin(a * Math.PI / 180) * (r + 30), r: 2.2, fill: "currentColor", stroke: "none" });
      }
    });
    svg.appendChild(g); svgHost.appendChild(svg);
    return svg;
  }
  function contours() {
    var g = $(".j-contours"); if (!g) return;
    var ns = "http://www.w3.org/2000/svg", centers = [[150, 380, 6], [420, 820, 7], [180, 1150, 5], [520, 300, 4]];
    centers.forEach(function (c) {
      for (var k = 1; k <= c[2]; k++) {
        var R = 30 + k * 34, pts = [], N = 36, seed = Math.random() * 6;
        for (var i = 0; i <= N; i++) {
          var a = i / N * Math.PI * 2, r = R * (1 + .18 * Math.sin(a * 3 + seed) + .08 * Math.sin(a * 5 + seed * 2));
          pts.push((c[0] + Math.cos(a) * r * 1.2).toFixed(1) + " " + (c[1] + Math.sin(a) * r).toFixed(1));
        }
        var p = document.createElementNS(ns, "path"); p.setAttribute("d", "M" + pts.join(" L") + "Z"); g.appendChild(p);
      }
    });
  }
  function jasmine() {
    var svg = $("#malle"); if (!svg) return;
    var ns = "http://www.w3.org/2000/svg";
    function build() {
      var W = Math.max(320, svg.clientWidth || innerWidth), H = svg.clientHeight || 200;
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var gap = W < 600 ? 26 : 34, n = Math.floor(W / gap);
      for (var i = 0; i <= n; i++) {
        var x = i * gap + gap / 2, len = H * (.32 + .55 * Math.abs(Math.sin(i * 1.93 + .6)));
        var g = document.createElementNS(ns, "g"); g.setAttribute("class", "sway"); g.style.animationDelay = (-(i % 7) * .8) + "s";
        var l = document.createElementNS(ns, "line");
        l.setAttribute("x1", x); l.setAttribute("x2", x); l.setAttribute("y1", 0); l.setAttribute("y2", len);
        l.setAttribute("stroke", "rgba(140,170,130,.55)"); l.setAttribute("stroke-width", "1"); g.appendChild(l);
        for (var y = 7; y < len; y += 8.5) {
          var b = document.createElementNS(ns, "ellipse");
          b.setAttribute("cx", x + (Math.round(y / 8.5) % 2 ? 1.6 : -1.6)); b.setAttribute("cy", y);
          b.setAttribute("rx", 2.6); b.setAttribute("ry", 3.6); b.setAttribute("fill", "rgba(255,252,240," + (.55 + .4 * (y / len)) + ")");
          g.appendChild(b);
        }
        if (i % 4 === 1) {
          var k = document.createElementNS(ns, "circle"); k.setAttribute("cx", x); k.setAttribute("cy", len + 6); k.setAttribute("r", 4.4);
          k.setAttribute("fill", "#F08A1C"); g.appendChild(k);
        }
        svg.appendChild(g);
      }
    }
    build();
    var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(build, 200); });
  }
  function endDots() {
    var g = $(".end-dots"); if (!g) return;
    var ns = "http://www.w3.org/2000/svg";
    for (var i = 0; i < 24; i++) {
      var a = i / 24 * Math.PI * 2, c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", (Math.cos(a) * 108).toFixed(2)); c.setAttribute("cy", (Math.sin(a) * 108).toFixed(2)); c.setAttribute("r", i % 6 === 0 ? 2.4 : 1.2);
      g.appendChild(c);
    }
  }

  /* ── the knot between the names: two threads tied in a brahmamudi ── */
  function layoutKnot() {
    var stage = $("#coupleStage"), svg = $("#knotSvg"); if (!stage || !svg) return;
    var sr = stage.getBoundingClientRect(), W = sr.width, H = sr.height;
    var bride = $(".bride .parents").getBoundingClientRect(), groom = $("#nameK").getBoundingClientRect(), w = $("#withWord").getBoundingClientRect();
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var ax = Math.min(bride.left - sr.left + 40, W * .3), ay = bride.bottom - sr.top + 14;
    var bx = Math.max(groom.right - sr.left - 40, W * .7), by = groom.top - sr.top + 10;
    var kx = w.left - sr.left - 22, ky = (w.top + w.bottom) / 2 - sr.top;
    if (W >= 760) { ax = bride.left - sr.left + (bride.width * .5); bx = groom.left - sr.left + groom.width * .5; }
    var t1 = "M" + ax + " " + ay + " C" + ax + " " + (ay + (ky - ay) * .9) + " " + (kx - 60) + " " + (ky - 30) + " " + kx + " " + ky;
    var t2 = "M" + bx + " " + by + " C" + bx + " " + (by - (by - ky) * .9) + " " + (kx + 60) + " " + (ky + 30) + " " + kx + " " + ky;
    var r = 9;
    var knot = "M" + (kx - 16) + " " + (ky - 6) + " C" + (kx - 4) + " " + (ky - 22) + " " + (kx + r + 6) + " " + (ky - 10) + " " + kx + " " + (ky + 2) +
      " C" + (kx - r - 6) + " " + (ky + 14) + " " + (kx + 4) + " " + (ky + 24) + " " + (kx + 16) + " " + (ky + 6) +
      " M" + (kx - 6) + " " + (ky + 4) + " q-10 14 -4 24 M" + (kx + 6) + " " + (ky - 2) + " q10 -14 4 -24";
    svg.querySelector(".t1").setAttribute("d", t1);
    svg.querySelector(".t2").setAttribute("d", t2);
    svg.querySelector(".knot").setAttribute("d", knot);
  }
  S.layoutKnot = layoutKnot;

  /* ── journey camera ── */
  var J = null;
  function setupJourney() {
    var map = $("#jcam"), route = $("#jRoute"), stage = $("#journeyStage");
    if (!map || !route) return;
    route.setAttribute("pathLength", "1");
    route.style.strokeDasharray = "1"; route.style.strokeDashoffset = "1";
    J = { map: map, route: route, stage: stage, base: $("#jRouteBase"), len: $("#jRouteBase").getTotalLength(), caption: $("#jCaption"), diya: $("#jDiya"), swept: {} };
  }
  function journeyAt(p) {
    if (!J) return;
    var W = J.stage.clientWidth, H = J.stage.clientHeight;
    var s = Math.min(1.6, Math.max(W * 1.45, 540) / 600);
    var pt = J.base.getPointAtLength(Math.max(0, Math.min(1, p)) * J.len);
    var tx = W / 2 - pt.x * s, ty = H * .46 - pt.y * s;
    J.map.style.transform = "translate3d(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px,0) scale(" + s.toFixed(4) + ")";
    J.route.style.strokeDashoffset = (1 - p).toFixed(4);
    J.diya.style.top = "46%";
    var c = p < .3 ? 0 : p < .42 ? (p - .3) / .12 : p < .72 ? 1 : p < .84 ? 1 - (p - .72) / .12 : 0;
    J.caption.style.opacity = c.toFixed(3);
    J.caption.style.transform = "translateY(" + ((1 - c) * 14).toFixed(1) + "px)";
    var glow = J.diya.querySelector(".jd-glow"), gs = p > .82 ? 1 + (p - .82) / .18 * 3.4 : 1;
    glow.style.transform = "translate(-50%,-55%) scale(" + gs.toFixed(3) + ")";
    var fade = p > .9 ? Math.max(0, 1 - (p - .9) / .1) : 1;
    J.map.style.opacity = fade.toFixed(3); J.diya.style.opacity = (p > .94 ? Math.max(0, 1 - (p - .94) / .06) : 1).toFixed(3);
    if (p > .3 && !J.swept.a) { J.swept.a = 1; VK.fx && VK.fx.sweep(22); VK.audio && VK.audio.whoosh(); }
    if (p > .62 && !J.swept.b) { J.swept.b = 1; VK.fx && VK.fx.sweep(16); }
    if (p < .2) J.swept = {};
  }

  /* ── static composition (reduced motion or no GSAP) ── */
  function staticMode() {
    root.classList.add("static");
    contours(); jasmine(); endDots();
    var mand = $(".m-mandala"); if (mand) muggu(mand);
    setupJourney();
    if (J) {
      // the whole route at once: both cities visible, no camera
      var fit = function () {
        var W = J.stage.clientWidth, H = J.stage.clientHeight, s = Math.min(W / 640, H * .78 / 1400);
        J.map.style.transform = "translate3d(" + ((W - 600 * s) / 2).toFixed(1) + "px," + (H * .04).toFixed(1) + "px,0) scale(" + s.toFixed(4) + ")";
      };
      fit(); window.addEventListener("resize", fit);
      J.route.style.strokeDashoffset = 0; J.diya.style.display = "none";
      J.caption.style.opacity = 1; J.caption.style.transform = "none";
    }
    layoutKnot();
    $$(".knot-svg path").forEach(function (p) { p.setAttribute("pathLength", "1"); });
    var secs = $$("[data-palette]");
    function onScroll() {
      var mid = window.innerHeight * .5, active = secs[0];
      secs.forEach(function (s) { if (s.getBoundingClientRect().top < mid) active = s; });
      var name = active.getAttribute("data-palette");
      if (name !== S._pal) {
        S._pal = name; applyPalette(name === "emerald" ? (lampPal = PAL.emerald) : PAL[name]);
        VK.fx && VK.fx.setTheme(THEME[name]); VK.audio && VK.audio.setScene(AUDIO[active.id] || "couple");
        document.getElementById("soundToggle").classList.toggle("on-light", name === "ivory");
      }
      progress();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", layoutKnot);
    onScroll();
  }

  function progress() {
    var max = document.documentElement.scrollHeight - innerHeight;
    var p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    var th = $(".thread"); if (th) th.style.setProperty("--prog", p.toFixed(4));
  }

  /* ── opening: the card unfolds, light escapes, the camera passes through ── */
  S.open = function (done) {
    var cover = $("#cover"), flash = $("#flash"), card = $("#card");
    var cx = innerWidth / 2, cy = card.getBoundingClientRect().top + card.offsetHeight / 2;
    if (!gsap) {
      cover.style.transition = "opacity .8s ease"; cover.style.opacity = 0;
      setTimeout(function () { cover.classList.add("gone"); done && done(); }, 820);
      return;
    }
    if (REDUCED) {
      gsap.to(cover, { opacity: 0, duration: .9, ease: "power1.out", onComplete: function () { cover.classList.add("gone"); done && done(); } });
      return;
    }
    var tl = gsap.timeline({ defaults: { ease: "power3.inOut" } });
    tl.to(".cover-cta", { opacity: 0, y: 16, duration: .45, ease: "power2.out" }, 0)
      .to(card, { "--rx": "0deg", "--ry": "0deg", duration: .4, ease: "power2.out" }, 0)
      .to(".panel-l", { rotationY: -112, duration: 1.35 }, .12)
      .to(".panel-r", { rotationY: 112, duration: 1.35 }, .12)
      .to(".inside-light", { opacity: 1, duration: 1, ease: "power2.in" }, .35)
      .call(function () { VK.fx && VK.fx.burst(cx, cy); }, null, .6)
      .to(".card-wrap", { scale: 3.6, duration: 1.5, ease: "power3.in" }, .8)
      .to(".card-shadow", { opacity: 0, duration: .5 }, .8)
      .to(flash, { opacity: 1, duration: .75, ease: "power2.in" }, 1.05)
      .call(function () { cover.classList.add("gone"); done && done(); }, null, 1.85)
      .to(flash, { opacity: 0, duration: 1.6, ease: "power2.out" }, 1.9);
  };

  /* ── title sequence (plays once after the opening) ── */
  var titleTl = null;
  function buildTitle() {
    var lines = $$(".arch-line");
    lines.forEach(function (l) { l.setAttribute("pathLength", "1"); l.style.strokeDasharray = "1"; l.style.strokeDashoffset = "1"; });
    var v = splitChars($(".hn-v")), k = splitChars($(".hn-k"));
    gsap.set([".invocation"], { clipPath: "inset(0 50% 0 50%)", opacity: 0 });
    gsap.set([".credit", ".for", ".scroll-cue", ".title-diya"], { opacity: 0, y: 12 });
    gsap.set(".te-title", { opacity: 0, filter: "blur(10px)", letterSpacing: ".18em" });
    gsap.set(v.concat(k), { yPercent: 115 });
    gsap.set(".hn-amp", { opacity: 0, scale: .6 });
    titleTl = gsap.timeline({ paused: true, defaults: { ease: "expo.out" } });
    titleTl.to(lines, { strokeDashoffset: 0, duration: 2.2, stagger: .12, ease: "power2.inOut" }, 0)
      .to(".title-diya", { opacity: 1, y: 0, duration: 1.2 }, .5)
      .to(".invocation", { clipPath: "inset(0 0% 0 0%)", opacity: 1, duration: 1.6, ease: "power2.inOut" }, .55)
      .call(function () { VK.audio && VK.audio.bell(698, .14); }, null, .6)
      .to(".credit", { opacity: 1, y: 0, duration: 1.2 }, 1.5)
      .to(".te-title", { opacity: 1, filter: "blur(0px)", letterSpacing: "0em", duration: 1.8 }, 1.7)
      .to(".for", { opacity: 1, y: 0, duration: 1 }, 2.3)
      .to(v, { yPercent: 0, duration: 1.4, stagger: { each: .055, from: "center" } }, 2.45)
      .to(k, { yPercent: 0, duration: 1.4, stagger: { each: .055, from: "center" } }, 2.7)
      .to(".hn-amp", { opacity: 1, scale: 1, duration: 1.4 }, 3.0)
      .to(".scroll-cue", { opacity: 1, y: 0, duration: 1 }, 3.8);
    // scrolling early simply completes the sequence
    var skip = function () { if (titleTl.progress() < 1 && scrollY > 40) titleTl.progress(1); };
    window.addEventListener("scroll", skip, { passive: true });
  }
  S.playTitle = function () { if (titleTl) titleTl.play(0); };

  /* ── scroll scenes ── */
  function buildScroll() {
    gsap.registerPlugin(ST);
    ST.config({ ignoreMobileResize: true });

    // title drifts apart as we leave it
    gsap.timeline({ scrollTrigger: { trigger: "#title", start: "top top", end: "bottom top", scrub: .6 } })
      .to(".hn-v", { xPercent: -10, opacity: .15, ease: "none" }, 0)
      .to(".hn-k", { xPercent: 10, opacity: .15, ease: "none" }, 0)
      .to(".title-top", { yPercent: -30, opacity: 0, ease: "none" }, 0)
      .to(".title-credits", { yPercent: -20, opacity: 0, ease: "none" }, 0);

    // the family's words, lit word by word
    var words = splitWords($(".solicit"));
    gsap.fromTo(words, { opacity: .13 }, { opacity: 1, ease: "none", stagger: .12,
      scrollTrigger: { trigger: ".s-intro", start: "top 75%", end: "bottom 65%", scrub: .5 } });

    // couple
    layoutKnot();
    $$(".knot-svg path").forEach(function (p) { p.setAttribute("pathLength", "1"); p.style.strokeDasharray = "1"; p.style.strokeDashoffset = "1"; });
    var knotted = false;
    gsap.timeline({ scrollTrigger: { trigger: "#coupleStage", start: "top 80%", end: "top 5%", scrub: .6 } })
      .fromTo("#nameV", { clipPath: "inset(-20% 100% -30% 0)", x: -24 }, { clipPath: "inset(-20% 0% -30% 0)", x: 0, duration: 1.2, ease: "power2.out" }, 0)
      .fromTo(".bride .parents", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .6, ease: "none" }, .8);
    var ctl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: { trigger: "#coupleStage", start: "top top", end: "+=115%", pin: true, scrub: .6, anticipatePin: 1 } });
    ctl.to(".knot-svg .t1", { strokeDashoffset: 0, duration: 1 }, 0)
      .fromTo("#withWord", { opacity: 0 }, { opacity: 1, duration: .5 }, .6)
      .fromTo("#nameK", { clipPath: "inset(-20% 0 -30% 100%)", x: 24 }, { clipPath: "inset(-20% 0 -30% 0%)", x: 0, duration: 1.2, ease: "power2.out" }, .5)
      .fromTo(".groom .parents", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .6 }, 1.2)
      .to(".knot-svg .t2", { strokeDashoffset: 0, duration: 1 }, 1.1)
      .to(".knot-svg .knot", { strokeDashoffset: 0, duration: .8 }, 2)
      .call(function () { if (!knotted && ctl.scrollTrigger && ctl.scrollTrigger.direction > 0) { knotted = true; VK.audio && VK.audio.knot(); } }, null, 2.7)
      .fromTo(".couple-light", { opacity: 0 }, { opacity: .45, duration: .8 }, 2.3)
      .fromTo(".bless", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: .7, ease: "power2.out" }, 2.5)
      .to({}, { duration: .5 });

    // muhurtham title sequence
    var mand = $(".m-mandala"); if (mand) muggu(mand);
    var dd = odometer($(".m-dd .roll")), tm = odometer($(".m-time .roll"));
    dd.concat(tm).forEach(function (s) { s.style.transition = "none"; });
    gsap.set(dd.concat(tm), { yPercent: 0 });
    var mtl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: { trigger: "#mSeq", start: "top top", end: "+=100%", pin: true, scrub: .6, anticipatePin: 1 } });
    mtl.fromTo(".m-te", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .5 }, 0)
      .fromTo(".m-word", { opacity: 0, letterSpacing: ".2em", filter: "blur(8px)" }, { opacity: 1, letterSpacing: "-.005em", filter: "blur(0px)", duration: 1 }, .1)
      .fromTo(".m-day", { opacity: 0 }, { opacity: 1, duration: .4 }, .8)
      .fromTo(".m-dd", { opacity: 0, scale: 1.7, filter: "blur(16px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.2, ease: "power2.out" }, .9)
      .to(dd, { yPercent: function (i, el) { return -10 * (+el.dataset.d); }, duration: 1.1, ease: "power2.out" }, 1)
      .fromTo(".m-my span", { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: .7, stagger: .2, ease: "power2.out" }, 1.6)
      .fromTo(".m-rule", { scaleX: 0 }, { scaleX: 1, duration: .8 }, 2.1)
      .fromTo(".m-time", { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: .7, ease: "power2.out" }, 2.4)
      .to(tm, { yPercent: function (i, el) { return -10 * (+el.dataset.d); }, duration: 1, stagger: .08, ease: "power2.out" }, 2.4)
      .fromTo(".m-lagnam", { opacity: 0 }, { opacity: 1, duration: .5 }, 3.1)
      .fromTo(".m-mandala", { rotation: -20, opacity: 0 }, { rotation: 18, opacity: .13, duration: 3.8 }, 0)
      .to({}, { duration: .4 });

    // countdown + venues
    gsap.from(".countdown", { opacity: 0, y: 24, duration: 1.2, ease: "power3.out", scrollTrigger: { trigger: ".countdown", start: "top 85%", once: true } });
    $$(".venue").forEach(function (v, i) {
      var route = v.querySelector(".vm-route"), mask = route ? routeMask(route, i) : null;
      var tl = gsap.timeline({ scrollTrigger: { trigger: v, start: "top 78%", once: true } });
      if (mask) tl.to(mask, { attr: { "stroke-dashoffset": 0 }, duration: 1.6, ease: "power2.inOut" }, 0);
      tl.from(v.querySelector(".vm-pin"), { y: -36, opacity: 0, duration: .9, ease: "power3.out" }, 1)
        .from(v.querySelectorAll("address, .actions .btn"), { opacity: 0, y: 18, duration: .9, stagger: .12, ease: "power3.out" }, .4);
    });

    // journey of light
    contours(); setupJourney(); journeyAt(0);
    ST.create({ trigger: "#journeyStage", start: "top top", end: "+=190%", pin: true, scrub: .5, anticipatePin: 1,
      onUpdate: function (self) { journeyAt(self.progress); }, onRefresh: function (self) { journeyAt(self.progress); } });

    // reception
    jasmine();
    gsap.from(".malle", { yPercent: -30, ease: "none", scrollTrigger: { trigger: "#reception", start: "top bottom", end: "top top", scrub: true } });
    gsap.timeline({ scrollTrigger: { trigger: ".r-inner", start: "top 72%", once: true }, defaults: { ease: "expo.out" } })
      .from(".r-lede", { opacity: 0, y: 14, duration: 1.2 }, 0)
      .from(".r-word", { opacity: 0, y: 40, letterSpacing: ".12em", duration: 2 }, .15)
      .from(".r-sub", { opacity: 0, letterSpacing: "1em", duration: 1.8 }, .5)
      .from(".r-day", { opacity: 0, duration: 1 }, .8)
      .from(".r-dd", { opacity: 0, scale: 1.4, filter: "blur(12px)", duration: 1.8 }, .9)
      .from(".r-my span", { opacity: 0, x: 26, stagger: .15, duration: 1.2 }, 1.3)
      .from(".r-time", { opacity: 0, y: 16, duration: 1.2 }, 1.6);

    // lamps
    gsap.from([".l-heading", ".l-hint"], { opacity: 0, y: 20, duration: 1.4, stagger: .15, ease: "power3.out", scrollTrigger: { trigger: "#lamps", start: "top 65%", once: true } });
    gsap.from(".diyas li", { opacity: 0, y: 30, duration: 1.2, stagger: .1, ease: "power3.out", scrollTrigger: { trigger: ".diyas", start: "top 85%", once: true } });

    // finale: words, petals lift away, the end card remains
    endDots();
    var ring = $(".end-ring circle"); ring.setAttribute("pathLength", "1"); ring.style.strokeDasharray = "1"; ring.style.strokeDashoffset = "1";
    var drifted = false;
    gsap.timeline({ scrollTrigger: { trigger: "#fStage", start: "top 85%", end: "top 10%", scrub: .6 } })
      .fromTo(".f-heading", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .8, ease: "power2.out" }, 0)
      .fromTo(".hosts", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: .6, ease: "none" }, .5);
    var ftl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: { trigger: "#fStage", start: "top top", end: "+=115%", pin: true, scrub: .6, anticipatePin: 1 } });
    ftl.to({}, { duration: .9 })
      .call(function () {
        if (!drifted && ftl.scrollTrigger.direction > 0) { drifted = true; VK.fx && VK.fx.drift($(".f-words").getBoundingClientRect(), 46); VK.audio && VK.audio.chime(.06); }
        else if (ftl.scrollTrigger.direction < 0) drifted = false;
      }, null, .9)
      .to(".f-words", { opacity: 0, y: -40, filter: "blur(6px)", duration: .9 }, 1)
      .fromTo(".endcard", { opacity: 0, scale: .92 }, { opacity: 1, scale: 1, duration: 1, ease: "power2.out" }, 1.5)
      .to(ring, { strokeDashoffset: 0, duration: 1.2 }, 1.5)
      .fromTo(".end-names", { letterSpacing: ".34em", opacity: 0 }, { letterSpacing: ".12em", opacity: 1, duration: 1 }, 1.8)
      .fromTo(".end-date", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .6 }, 2.3)
      .to({}, { duration: .4 });
    gsap.from(".f-actions .btn", { opacity: 0, y: 18, stagger: .12, duration: 1, ease: "power3.out", scrollTrigger: { trigger: ".f-actions", start: "top 90%", once: true } });

    // lighting: one controller maps scroll position to the scene palette
    var secs = $$("[data-palette]"), trans = [];
    secs.forEach(function (sec, i) {
      if (i === 0) return;
      trans.push({ st: ST.create({ trigger: sec, start: "top 62%", end: "top 8%" }),
        from: PAL[secs[i - 1].getAttribute("data-palette")], to: PAL[sec.getAttribute("data-palette")], name: sec.getAttribute("data-palette"),
        via: VIA[secs[i - 1].getAttribute("data-palette") + ">" + sec.getAttribute("data-palette")] });
    });
    lampPal = PAL.emerald;
    function light() {
      var y = scrollY, p = PAL[secs[0].getAttribute("data-palette")], name = "night";
      for (var i = 0; i < trans.length; i++) {
        var t = trans[i];
        if (y < t.st.start) break;
        var k = Math.min(1, (y - t.st.start) / Math.max(1, t.st.end - t.st.start));
        p = k >= 1 ? t.to : t.via ? (k < .5 ? lerpPal(t.from, t.via, k * 2) : lerpPal(t.via, t.to, (k - .5) * 2)) : lerpPal(t.from, t.to, k);
        name = k > .5 ? t.name : (i ? trans[i - 1].name : "night");
      }
      if (p === PAL.emerald) p = lampPal;
      applyPalette(p);
      if (name !== S._pal) {
        S._pal = name;
        VK.fx && VK.fx.setTheme(THEME[name]);
        document.getElementById("soundToggle").classList.toggle("on-light", name === "ivory");
      }
      progress();
    }
    S.relight = light;
    ST.create({ start: 0, end: "max", onUpdate: light, onRefresh: light });

    // which scene the music should follow
    secs.forEach(function (sec) {
      ST.create({ trigger: sec, start: "top 55%", end: "bottom 55%", onToggle: function (self) { if (self.isActive) VK.audio && VK.audio.setScene(AUDIO[sec.id] || "couple"); } });
    });

    ST.addEventListener("refreshInit", function () { layoutKnot(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ST.refresh(); });
  }

  S.setWarmth = function (w) {
    warmth = w;
    if (lampPal) {
      lampPal = Object.assign({}, PAL.emerald, { a: lerpColor(PAL.emerald.a, "#2A1A08", w * .8), glow: lerpColor(PAL.emerald.glow, "#FFB860", w), vig: PAL.emerald.vig - w * .25 });
      if (S._pal === "emerald") { if (S.relight) S.relight(); else applyPalette(lampPal); }
    }
  };

  // chapter links land where each scene is fully composed
  S.chapterY = function (id) {
    var el = document.getElementById(id); if (!el) return 0;
    if (CINEMA && ST) {
      var pinEl = { couple: "#coupleStage", muhurtham: "#mSeq" }[id];
      if (pinEl) {
        var st = ST.getAll().filter(function (s) { return s.pin && s.trigger === $(pinEl); })[0];
        if (st) return st.end - 2;
      }
    }
    return el.getBoundingClientRect().top + scrollY;
  };

  S.init = function () {
    applyPalette(PAL.night);
    if (!CINEMA) { staticMode(); return; }
    buildTitle();
    buildScroll();
  };
})();
