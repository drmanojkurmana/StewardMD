/* StewardMD launch film: shared building blocks.
 *
 * Follows NullMotion's HyperFrames contract: a 1920x1080 #root composition, every section a
 * `.clip` with data-start / data-duration, and ONE paused GSAP timeline registered as
 * window.__timelines.root. Nothing animates on its own clock (no CSS animations, no rAF), so
 * seeking the timeline to t renders the exact same frame every time.
 *
 * Every product pixel is a real StewardMD screen (see README "Source of every screen").
 * These helpers only frame them: device bodies, panning, taps, lifted crops, copy.
 */
(function () {
  "use strict";
  var F = (window.FILM = window.FILM || {});
  F.W = 1920; F.H = 1080; F.FPS = 30; F.DURATION = 30;
  F.sections = [];
  // Master cue sheet (seconds). Every section reads its window from here.
  F.T = { open: 0, reason: 3.0, steward: 7.6, maik: 12.2, icu: 16.8, watch: 21.4, finale: 25.4, end: 30 };
  // Phone "home" placements shared across handoffs (top-left of the 408 x 850 body).
  F.PL = { x: 330, y: 115 };      // left of frame, copy on the right
  F.PR = { x: 1182, y: 115 };     // right of frame, copy on the left

  // Asset paths are relative to film/index.html. Repo-owned assets are referenced in place.
  F.A = {
    home: "../assets/screens/home.jpg",
    dx4: "../assets/screens/dx-findings-4.jpg",
    dx5: "../assets/screens/dx-findings-5.jpg",
    dxr: "../assets/screens/dx-differential-tall.jpg",
    stew: "../assets/screens/stewardship-tall.jpg",
    abgRates: "../assets/screens/antibiogram-resistance-tall.jpg",
    abgGrid: "../assets/screens/antibiogram-grid-ipad-tall.jpg",
    icu: "../assets/screens/icu-overview-tall.jpg",
    site: "../assets/screens/site-desktop.jpg",
    maik: "../../_site/assets/s/maik-2.png",
    watchLabs: "../../_site/assets/s/watch-frame-critical.png",
    watchCode: "../../_site/assets/s/watch-frame-codeblue.png",
    markWhite: "../../mark-white.png",
    markTeal: "../../mark-teal.png",
    maikWord: "../../maik-wordmark-white.png"
  };

  F.el = function (parent, cls, css, html) {
    var n = document.createElement("div");
    if (cls) n.className = cls;
    if (css) n.style.cssText = css;
    if (html != null) n.innerHTML = html;
    if (parent) parent.appendChild(n);
    return n;
  };

  /* ---- section registry ------------------------------------------------------------------ */
  // id, start, duration, build(stage, tl). tl is local (0 = section start); it is nested into
  // the root timeline at `start`. Sections may overlap for handoffs; the end state of one and
  // the start state of the next are authored to be identical, so the cut is invisible.
  F.section = function (def) { F.sections.push(def); };

  /* ---- phone --------------------------------------------------------------------------- */
  // iPhone-class body. Screen is 380 x 822 film px and shows a 390 x 844 CSS-px app viewport.
  var PW = 380, PH = 822, CSSW = 390;
  F.PS = PW / CSSW;          // film px per app CSS px
  F.phone = function (parent, css) {
    var wrap = F.el(parent, "dev phone", "position:absolute;left:0;top:0;width:" + (PW + 28) + "px;height:" + (PH + 28) + "px;" + (css || ""));
    F.el(wrap, "phone-body");
    F.el(wrap, "phone-btn l1"); F.el(wrap, "phone-btn l2"); F.el(wrap, "phone-btn l3"); F.el(wrap, "phone-btn r1");
    var screen = F.el(wrap, "phone-screen", "left:14px;top:14px;width:" + PW + "px;height:" + PH + "px");
    var status = F.el(screen, "status", "", '<span class="t">9:41</span><span class="ico">' + F.statusIcons() + "</span>");
    F.el(screen, "island");
    F.el(wrap, "phone-glare");
    return { wrap: wrap, screen: screen, status: status };
  };
  F.statusIcons = function () {
    return '<svg width="18" height="11" viewBox="0 0 18 11"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="5" y="5" width="3" height="6" rx="1"/><rect x="10" y="2.5" width="3" height="8.5" rx="1"/><rect x="15" y="0" width="3" height="11" rx="1"/></svg>' +
      '<svg width="16" height="11" viewBox="0 0 16 11"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.3 10.3 0 0 0 8 .4 10.3 10.3 0 0 0 .8 3.3L2 4.6a8.5 8.5 0 0 1 6-2.4zm0 3.4c1.4 0 2.6.5 3.6 1.4l1.2-1.3A7 7 0 0 0 8 3.8a7 7 0 0 0-4.8 1.9L4.4 7c1-.9 2.2-1.4 3.6-1.4zm0 3.3c.5 0 1 .2 1.3.5L8 10.8 6.7 9.4c.3-.3.8-.5 1.3-.5z"/></svg>' +
      '<svg width="26" height="12" viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="19" height="8" rx="2"/><rect x="23.6" y="4" width="1.8" height="4" rx=".9" opacity=".5"/></svg>';
  };

  // A screen layer: one real capture, top-aligned under a 47 px iOS status bar area.
  // The app viewport starts below the status bar, so layer content is offset by SB.
  F.SB = 47;
  F.layer = function (screen, src, opts) {
    opts = opts || {};
    var L = F.el(screen, "layer", "position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;background:" + (opts.bg || "#F5F8F9"));
    var bar = F.el(L, "", "position:absolute;left:0;top:0;right:0;height:" + F.SB + "px;background:" + (opts.bar || opts.bg || "#ffffff"));
    var view = F.el(L, "", "position:absolute;left:0;top:" + F.SB + "px;right:0;bottom:0;overflow:hidden");
    var img = document.createElement("img");
    img.src = src; img.className = "shot"; img.style.cssText = "position:absolute;left:0;top:0;width:100%;display:block";
    view.appendChild(img);
    L.img = img; L.view = view;
    if (opts.dark) L.classList.add("dark-bar");
    return L;
  };
  // Scroll a layer so that app CSS-y `y` sits at the top of the viewport.
  F.scrollTo = function (tl, layer, y, at, dur, ease) {
    tl.to(layer.img, { y: -y * F.PS, duration: dur, ease: ease || "power2.inOut" }, at);
  };

  // Tap: ripple at app CSS coords (x, y) inside a screen.
  F.tap = function (tl, screen, x, y, at) {
    var d = F.el(screen, "tap", "left:" + (x * F.PS) + "px;top:" + (F.SB + y * F.PS) + "px");
    tl.fromTo(d, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.14, ease: "power2.out" }, at);
    tl.to(d, { scale: 1.9, opacity: 0, duration: 0.42, ease: "power2.out" }, at + 0.14);
    return d;
  };

  // iOS-style push: `next` slides in from the right over `prev`.
  F.push = function (tl, prev, next, at, dur) {
    dur = dur || 0.5;
    tl.set(next, { xPercent: 100, opacity: 1 }, 0);
    tl.set(next, { xPercent: 100 }, at - 0.001);
    tl.to(next, { xPercent: 0, duration: dur, ease: "power3.inOut" }, at);
    tl.to(prev, { xPercent: -28, duration: dur, ease: "power3.inOut" }, at);
  };

  /* ---- lifted crop ---------------------------------------------------------------------- */
  // A rectangle of a real capture (app CSS px: x, y, w, h), rendered as a floating card.
  // `imgCssW` is the capture width in app CSS px (390 for phone captures).
  F.crop = function (parent, src, imgCssW, x, y, w, h, scale, css) {
    var c = F.el(parent, "lift", "width:" + (w * scale) + "px;height:" + (h * scale) + "px;" +
      "background-image:url('" + src + "');background-size:" + (imgCssW * scale) + "px auto;" +
      "background-position:" + (-x * scale) + "px " + (-y * scale) + "px;" + (css || ""));
    return c;
  };

  // Crop a measured element (FILM.RECTS, from capture-screens.mjs). pad = [x, y] app px.
  // Positioned by its RIGHT edge so lifts never cross into the copy column (x >= 1040).
  F.cropR = function (parent, src, r, pad, scale, right, top, css) {
    var x = r[0] - pad[0], y = r[1] - pad[1], w = r[2] + 2 * pad[0], h = r[3] + 2 * pad[1];
    return F.crop(parent, src, 390, x, y, w, h, scale, "left:" + (right - w * scale) + "px;top:" + top + "px;" + (css || ""));
  };

  // Android phone body (punch-hole camera, flatter corners). Same WebView bundle, same screens.
  F.android = function (parent) {
    var ph = F.phone(parent);
    ph.wrap.classList.add("android");
    var isl = ph.screen.querySelector(".island"); if (isl) isl.className = "punch";
    return ph;
  };

  /* ---- tablet (iPad, landscape) ----------------------------------------------------------- */
  F.tablet = function (parent, w, h, css) {
    var wrap = F.el(parent, "dev tablet", "position:absolute;left:0;top:0;width:" + (w + 36) + "px;height:" + (h + 36) + "px;" + (css || ""));
    F.el(wrap, "tablet-body");
    var screen = F.el(wrap, "tablet-screen", "left:18px;top:18px;width:" + w + "px;height:" + h + "px");
    F.el(wrap, "tablet-cam");
    F.el(wrap, "phone-glare");
    return { wrap: wrap, screen: screen };
  };

  /* ---- desktop display ------------------------------------------------------------------ */
  F.desktop = function (parent, w, h, css) {
    var wrap = F.el(parent, "dev desktop", "position:absolute;left:0;top:0;width:" + (w + 24) + "px;height:" + (h + 24 + 170) + "px;" + (css || ""));
    F.el(wrap, "desk-body", "width:" + (w + 24) + "px;height:" + (h + 24) + "px");
    var screen = F.el(wrap, "desk-screen", "left:12px;top:12px;width:" + w + "px;height:" + h + "px");
    F.el(wrap, "desk-neck", "left:" + ((w + 24) / 2 - 70) + "px;top:" + (h + 24) + "px");
    F.el(wrap, "desk-foot", "left:" + ((w + 24) / 2 - 170) + "px;top:" + (h + 24 + 140) + "px");
    F.el(wrap, "phone-glare", "border-radius:18px;height:" + (h + 24) + "px");
    return { wrap: wrap, screen: screen };
  };

  /* ---- watch (repo's own Apple Watch Ultra renders, transparent PNG) --------------------- */
  F.watch = function (parent, src, h, css) {
    var w = h * 720 / 1172;
    var wrap = F.el(parent, "dev watch", "position:absolute;left:0;top:0;width:" + w + "px;height:" + h + "px;" + (css || ""));
    var img = document.createElement("img");
    img.src = src; img.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    wrap.appendChild(img);
    wrap.img = img;
    return wrap;
  };

  /* ---- copy block ----------------------------------------------------------------------- */
  // kicker: "01" + label; headline: HTML with <em> for the teal italic phrase (site style).
  F.copy = function (parent, num, label, headline, sub, css) {
    var c = F.el(parent, "copy", css || "");
    var k = F.el(c, "kicker", "", '<span class="num">' + num + '</span><span class="rule"></span><span class="lab">' + label + "</span>");
    var h = F.el(c, "headline", "", headline);
    var s = sub ? F.el(c, "sub", "", sub) : null;
    return { root: c, kicker: k, headline: h, sub: s };
  };
  // Standard copy entrance / exit.
  F.copyIn = function (tl, c, at) {
    tl.from(c.kicker, { y: 18, opacity: 0, duration: 0.5, ease: "power3.out" }, at);
    tl.from(c.headline, { y: 34, opacity: 0, filter: "blur(10px)", duration: 0.75, ease: "power3.out" }, at + 0.08);
    if (c.sub) tl.from(c.sub, { y: 20, opacity: 0, duration: 0.6, ease: "power3.out" }, at + 0.28);
  };
  F.copyOut = function (tl, c, at) {
    tl.to(c.root, { y: -26, opacity: 0, filter: "blur(8px)", duration: 0.4, ease: "power2.in" }, at);
  };

  /* ---- build ------------------------------------------------------------------------------ */
  F.build = function () {
    var root = document.getElementById("stage");
    var tl = gsap.timeline({ paused: true });
    F.sections.sort(function (a, b) { return a.start - b.start; }).forEach(function (s) {
      var node = F.el(root, "clip section", "position:absolute;inset:0");
      node.id = s.id;
      node.setAttribute("data-start", s.start);
      node.setAttribute("data-duration", s.duration);
      node.setAttribute("data-track-index", s.track || 0);
      if (s.z != null) node.style.zIndex = s.z;
      var local = gsap.timeline();
      s.build(node, local);
      // A section is visible only inside its own window (plus nothing leaks between sections).
      tl.set(node, { autoAlpha: 0 }, 0);
      tl.set(node, { autoAlpha: 1 }, s.start);
      tl.add(local, s.start);
      tl.set(node, { autoAlpha: 0 }, s.start + s.duration);
    });
    // Keep the timeline exactly DURATION long.
    tl.set({}, {}, F.DURATION);
    window.__timelines = window.__timelines || {};
    window.__timelines.root = tl;
    return tl;
  };

  // All images decoded before the first frame, so frame 0 never renders half-loaded.
  F.ready = function () {
    var imgs = Array.prototype.slice.call(document.images);
    var bg = [];
    document.querySelectorAll(".lift").forEach(function (n) {
      var m = /url\(['"]?(.*?)['"]?\)/.exec(n.style.backgroundImage || "");
      if (m) { var i = new Image(); i.src = m[1]; bg.push(i); }
    });
    return Promise.all(imgs.concat(bg).map(function (i) { return i.decode ? i.decode().catch(function () {}) : Promise.resolve(); }))
      .then(function () { return document.fonts ? document.fonts.ready : null; });
  };
})();
