/* StewardMD - smd-motion.js: the shared motion language (window.SMD_MOTION), owner 2026-10-31: "any transition in app
 * should have good motion, slide up down or anything premium, new, unique, giving the app overall best feeling".
 *
 * One physics for the whole app: real springs (the same damped-spring maths as smd-spring.js and Motion's spring),
 * sampled once into a CSS linear() easing so they run in the browser's own animation engine (Web Animations, on the
 * compositor). That keeps the start frame synchronous: Motion's rAF loop applies a start keyframe a frame late, which
 * flickers a full-screen page (dialog-motion.js documents the same problem). Motion itself still drives the dialogs.
 *
 *   ease(name)               -> { easing, duration } for "open" | "push" | "close" | "settle"
 *   source()                 -> the rect of the control tapped in the last 700 ms (a tile or a row), or null
 *   morphIn(el, rect)        -> a page grows out of the tapped card: clipped from the card's exact rect and radius to
 *                               the full screen on the morph spring, the card's own face riding over it and handing over
 *   morphOut(el, rect)       -> the reverse: keyframes, timing and face() that shrink a closing page into the card
 *   popIn / popOut           -> a menu or dialog grows out of the button that opened it and shrinks back into it
 *   riseFromEdge / sinkToEdge -> the same with no button: up from the bottom edge and back down
 *   push(inEls, ghost, dir)  -> iOS-style push (dir 1) and pop (dir -1): the new screen slides in from the edge on a
 *                               spring while the old one drifts a third of the way and dims under or over it
 *   page(inEls, ghost, dir)  -> tabs: a pager, new content in from the tapped tab's side, old out the other way
 *   tabDir()                 -> +1 / -1 when a tab or segment right / left of the current one was just tapped, else 0
 *   nudgeUp(list)            -> in-place content (a filter) slides up 22 px on a spring
 *   riseIn(el), sinkKf()     -> a page with no source slides up from the bottom edge, and back down when it closes
 *   stagger(list)            -> rows slide up into place one after another (28 ms apart, first 10 only)
 * No cross-fades (owner, 2026-10-31: "I dont want cross fade, it looks ugly"): everything travels.
 *   on()                     -> false under prefers-reduced-motion or with localStorage smd_motion3 = "0"
 *
 * Pure helpers (springCurve, linearEasing, morphFrom) load under node for tests. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  // Damped spring from 0 to 1 (mass 1). -> { pts: [x at equal time steps], ms: time to rest }.
  function springCurve(k, c, maxMs) {
    var dt = 1 / 600, x = 0, v = 0, t = 0, pts = [0], every = 6, n = 0, lim = (maxMs || 1200) / 1000;
    while (t < lim) {
      var a = -k * (x - 1) - c * v; v += a * dt; x += v * dt; t += dt; n++;
      if (n % every === 0) pts.push(x);
      if (Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.02) break;
    }
    pts.push(1);
    return { pts: pts, ms: Math.round(t * 1000) };
  }
  // A curve as a CSS linear() easing, thinned to at most `max` stops.
  function linearEasing(pts, max) {
    var step = Math.max(1, Math.ceil(pts.length / (max || 48))), out = [];
    for (var i = 0; i < pts.length; i += step) out.push(+pts[i].toFixed(4));
    if (out[out.length - 1] !== 1) out.push(1);
    return "linear(" + out.join(", ") + ")";
  }
  /* The container transform's start: the page clipped to the tile, in the page's own box. rect = the tile, box = the
     page; both { left, top, width, height }. -> { clip, scale, ox, oy }: inset() from each side, a starting scale and
     the transform origin at the tile's centre. */
  function morphFrom(rect, box, radius, scale) {
    var l = Math.max(0, rect.left - box.left), t = Math.max(0, rect.top - box.top);
    var r = Math.max(0, box.left + box.width - (rect.left + rect.width)), b = Math.max(0, box.top + box.height - (rect.top + rect.height));
    var round = Math.round, rd = radius == null ? 18 : radius;
    return { clip: "inset(" + round(t) + "px " + round(r) + "px " + round(b) + "px " + round(l) + "px round " + rd + "px)", scale: scale == null ? 0.96 : scale,
      ox: round(rect.left + rect.width / 2 - box.left) + "px", oy: round(rect.top + rect.height / 2 - box.top) + "px" };
  }
  // morph: card to page and back, about 300 ms, no overshoot. menu: a menu or dialog out of its button, about 280 ms,
  // a hair of overshoot so it lands with life.
  var PRESET = { open: [340, 28], push: [340, 38], settle: [420, 34], morph: [700, 50], menu: [560, 38] };
  var PURE = { springCurve: springCurve, linearEasing: linearEasing, morphFrom: morphFrom, PRESET: PRESET };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }
  if (!G || !G.document || G.SMD_MOTION) return;

  /* ================= browser ================= */
  var D = G.document;
  function reduced() { try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function flagOff() { try { return G.localStorage.getItem("smd_motion3") === "0"; } catch (e) { return false; } }
  function on() { return !flagOff() && !reduced() && !!(G.Element && G.Element.prototype.animate); }
  var LIN = false; try { LIN = !!(G.CSS && G.CSS.supports && G.CSS.supports("transition-timing-function", "linear(0, 1)")); } catch (e) {}
  var cache = {};
  function ease(name) {
    if (cache[name]) return cache[name];
    if (name === "close") return (cache[name] = { easing: "cubic-bezier(.4, 0, .9, .6)", duration: 220 });
    var p = PRESET[name] || PRESET.open, c = springCurve(p[0], p[1]);
    // The shared-element springs stay in the 200 to 320 ms band (owner 2026-11-15): quick, and still a spring.
    if (name === "morph" || name === "menu") return (cache[name] = LIN ? { easing: linearEasing(c.pts), duration: Math.min(320, Math.max(200, c.ms)) } : { easing: "cubic-bezier(.22, 1, .36, 1)", duration: 300 });
    // Without linear() (older WebViews): the nearest cubic, an iOS-like strong ease-out.
    return (cache[name] = LIN ? { easing: linearEasing(c.pts), duration: Math.min(700, Math.max(320, c.ms)) } : { easing: "cubic-bezier(.22, 1, .36, 1)", duration: 360 });
  }

  // The control the user just tapped: tiles, rows and buttons that open things. Recorded at pointerdown (before any
  // handler swaps the screen), read once by the page that opens next.
  var SRC = "button,a,[role=button],[data-act],[onclick],.tile,[class*=tile],[class*=card],li";
  var last = null;
  D.addEventListener("pointerdown", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(SRC) : null;
    if (!t) { last = null; return; }
    var r = t.getBoundingClientRect();
    // Only a real source: smaller than most of the screen and on it.
    if (r.width < 8 || r.height < 8 || (r.width > G.innerWidth * 0.96 && r.height > G.innerHeight * 0.5)) { last = null; return; }
    var cs = G.getComputedStyle(t), rad = parseFloat(cs.borderTopLeftRadius) || 14;
    last = { left: r.left, top: r.top, width: r.width, height: r.height, radius: Math.min(28, rad), at: Date.now(), el: t };
  }, true);
  /* Tabs and segmented filters: which way the student is heading. The tapped tab's place among its siblings against
     the one marked current (before the handler repaints), so the new content pages in from that side. */
  var TAB = "[role=tab],.pn-tabs > *,.pnv-tabs > *,.pn-seg > *,.pn-filters > *,.pn-chips > *,[role=tablist] > *,[class*=tabs] > button,[class*=seg] > button";
  var tabAt = 0, tabD = 0;
  function isCur(n) {
    var c = " " + (n.className && n.className.baseVal == null ? n.className : "") + " ";
    return n.getAttribute("aria-selected") === "true" || n.getAttribute("aria-current") === "page" || n.getAttribute("aria-current") === "true" ||
      n.getAttribute("aria-pressed") === "true" || / (on|act|active|sel|selected|cur|current|is-on|is-active) /.test(c);
  }
  function tabDirOf(t) {
    var tab = t && t.closest ? t.closest(TAB) : null;
    if (!tab || !tab.parentNode) return 0;
    var sib = Array.prototype.slice.call(tab.parentNode.children), me = sib.indexOf(tab), cur = -1;
    for (var i = 0; i < sib.length; i++) if (sib[i] !== tab && isCur(sib[i])) { cur = i; break; }
    return cur < 0 || cur === me ? 0 : me > cur ? 1 : -1;
  }
  D.addEventListener("pointerdown", function (e) { tabD = tabDirOf(e.target); tabAt = tabD ? Date.now() : 0; }, true);
  function tabDir() { var d = Date.now() - tabAt < 900 ? tabD : 0; tabD = 0; tabAt = 0; return d; }
  function source() { return last && Date.now() - last.at < 700 ? last : null; }
  function take() { var s = source(); last = null; return s; }

  function anim(el, kf, o) { try { return el.animate(kf, o); } catch (e) { return null; } }
  /* Screen px per CSS px for an element. The text-size setting zooms <html> (zoom: 0.95 and the like): rects come back
     in screen px while the element's own styles are in its CSS px, so every rect is divided by this before it becomes
     a clip, a transform or a transform origin. 1 when the engine already reports CSS px. */
  function zf(el) { try { var w = el.offsetWidth, r = el.getBoundingClientRect().width; return w > 0 && r > 0 ? r / w : 1; } catch (e) { return 1; } }
  function div(r, z) { return { left: r.left / z, top: r.top / z, width: r.width / z, height: r.height / z, radius: r.radius, el: r.el }; }
  /* Card to page (owner 2026-11-15: "the card should be the origin point, don't fade or do a hard cut").
     The container transform: the page is clipped to the card's exact rect and radius and grows to the full screen on
     the morph spring, solid the whole way. A live copy of the card rides on top of it, scaled from the card's spot to
     the page's width, and gives way to the page's own content over the first 40% (the card's face hands over, the
     container never fades). Closing runs it backwards: the page shrinks into the card's exact rect while the card's
     face comes back over the last part, so the last frame IS the card. */
  // A detached copy of the card that looks the same anywhere: every computed style inlined (a big card keeps only
  // its outer box so the copy stays cheap). Ids stripped, inert, no media.
  function snapshot(src) {
    var o = src.el, c;
    try { c = o.cloneNode(true); } catch (e) { return null; }
    var os = [o].concat(Array.prototype.slice.call(o.querySelectorAll("*"))), cs = [c].concat(Array.prototype.slice.call(c.querySelectorAll("*")));
    if (os.length > 80) { while (c.firstChild) c.removeChild(c.firstChild); os = [o]; cs = [c]; }
    for (var i = 0; i < os.length && i < cs.length; i++) {
      var st = G.getComputedStyle(os[i]), t = cs[i].style;
      for (var j = 0; j < st.length; j++) { var k = st[j]; try { t.setProperty(k, st.getPropertyValue(k)); } catch (e) {} }
      t.transition = "none"; t.animation = "none";
      if (cs[i].removeAttribute) cs[i].removeAttribute("id");
    }
    Array.prototype.forEach.call(c.querySelectorAll("iframe,video,audio,script,object,embed"), function (x) { x.parentNode.removeChild(x); });
    var w = o.offsetWidth || src.width, h = o.offsetHeight || src.height;
    c.style.position = "absolute"; c.style.left = "0px"; c.style.top = "0px"; c.style.right = "auto"; c.style.bottom = "auto"; c.style.margin = "0px";
    c.style.width = w + "px"; c.style.height = h + "px"; c.style.transformOrigin = "0 0"; c.style.translate = "none"; c.style.scale = "none"; c.style.rotate = "none";
    // The surface under it carries the card's colour across the whole shape: the copy keeps only what is ON the card.
    c.style.background = "transparent"; c.style.boxShadow = "none"; c.style.borderColor = "transparent"; c.style.outline = "none";
    c.setAttribute("aria-hidden", "true"); c.inert = true;
    return { node: c, w: w, h: h };
  }
  /* The card's face over a page: a host the size of the page box, clipped with the page's own keyframes (so the copy
     never spills outside the growing shape), holding the card copy. dir 1 = opening, -1 = closing. -> the host. */
  function face(page, src, box, clipKf, timing, dir) {
    var sn = snapshot(src); if (!sn) return null;
    var z = zf(page); src = div(src, z); box = div(box, z);
    var host = D.createElement("div"), z = "auto";
    try { z = G.getComputedStyle(page).zIndex || "auto"; } catch (e) {}
    host.setAttribute("data-pm-ghost", ""); host.setAttribute("data-no-motion", ""); host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:" + box.left + "px;top:" + box.top + "px;width:" + box.width + "px;height:" + box.height + "px;overflow:hidden;pointer-events:none;contain:layout paint;z-index:" + z;
    // The card's surface fills the whole growing shape (its colour, radius from the clip), so for the hand-over the
    // shape reads as the card itself getting bigger, not a page with a sticker on it. The face sits on top of it.
    var surf = D.createElement("div"), cbg = "";
    try { var ccs = G.getComputedStyle(src.el); cbg = ccs.backgroundColor; if (ccs.backgroundImage && ccs.backgroundImage !== "none") surf.style.backgroundImage = ccs.backgroundImage; } catch (e) {}
    surf.style.cssText += ";position:absolute;inset:0;background-color:" + (cbg || "transparent") + ";background-size:cover";
    host.appendChild(surf);
    host.appendChild(sn.node);
    (D.body || D.documentElement).appendChild(host);
    var k0 = src.width / sn.w, k1 = box.width / sn.w;   // all in the page's CSS px (the host sits beside it)
    var at = "translate(" + (src.left - box.left) + "px, " + (src.top - box.top) + "px) scale(" + k0 + ", " + (src.height / sn.h) + ")";
    var full = "translate(0px, 0px) scale(" + k1 + ")";
    var tr = dir > 0 ? [{ transform: at }, { transform: full }] : [{ transform: full }, { transform: at }];
    var d = timing.duration;
    anim(host, clipKf, { duration: d, easing: timing.easing, fill: "both" });
    anim(sn.node, tr, { duration: d, easing: timing.easing, fill: "both" });
    // The hand-over: the card's face is fully there at the card end, gone by 40% of the way to the page.
    var ho = dir > 0 ? { kf: [{ opacity: 1 }, { opacity: 0 }], t: { duration: Math.round(d * 0.4), delay: Math.round(d * 0.04), easing: "cubic-bezier(.4, 0, 1, 1)", fill: "both" } }
      : { kf: [{ opacity: 0 }, { opacity: 1 }], t: { duration: Math.round(d * 0.42), delay: Math.round(d * 0.55), easing: "cubic-bezier(0, 0, .2, 1)", fill: "both" } };
    anim(sn.node, ho.kf, ho.t); anim(surf, ho.kf, ho.t);
    // Gone when its motion is: on the clip's finish (a busy main thread can start the animation late, so never on a
    // bare timer), with a long safety net.
    var drop = function () { if (host.parentNode) host.parentNode.removeChild(host); };
    var ca = host.getAnimations ? host.getAnimations()[0] : null;
    if (ca) ca.onfinish = ca.oncancel = drop;
    setTimeout(drop, d + 1500);
    return host;
  }
  function morphIn(el, rect) {
    var box = boxOf(el), z = zf(el), m = morphFrom(div(rect, z), div(box, z), rect.radius, 1), e = ease("morph");
    var kf = [{ clipPath: m.clip }, { clipPath: "inset(0px 0px 0px 0px round 0px)" }];
    var a = anim(el, kf, { duration: e.duration, easing: e.easing, fill: "backwards" });
    face(el, rect, box, kf, e, 1);
    return a;
  }
  // A page's box; a node already taken out of the page (its exit copy is measured later) counts as the full screen.
  function boxOf(el) { var b = el.getBoundingClientRect(); return b.width && b.height ? b : { left: 0, top: 0, width: G.innerWidth, height: G.innerHeight }; }
  // A closing page back into its card's exact rect: the keyframes, the timing, and start(el) which lays the card's face
  // over it for the hand-back. No fade on the page: it stays solid until it IS the card's shape.
  function morphOut(el, rect) {
    var box = boxOf(el), z = zf(el), m = morphFrom(div(rect, z), div(box, z), rect.radius, 1), e = ease("morph");
    var kf = [{ clipPath: "inset(0px 0px 0px 0px round 0px)" }, { clipPath: m.clip }], o = { duration: e.duration, easing: e.easing, fill: "forwards" };
    return { kf: kf, o: o, origin: m.ox + " " + m.oy, face: function (target) { return face(target || el, rect, box, kf, e, -1); } };
  }
  function morphOutKf(el, rect) { var mo = morphOut(el, rect); return { origin: mo.origin, kf: mo.kf }; }

  /* Menus and dialogs out of the control that opened them (owner 2026-11-15: "any dropdown or menu should originate
     from the button that opened it"). The individual scale property, so a transform the element uses to place itself
     (translate(-50%)) is left alone; the origin is the button's centre in the element's own untransformed box.
     -> { origin } or null when there is no button to grow from. */
  var IND = false; try { IND = !!(G.CSS && G.CSS.supports && G.CSS.supports("scale", "1")); } catch (e) {}
  function originFor(el, src) {
    if (!src || !src.el || (el.contains && el.contains(src.el))) return null;
    var r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
    var tx = 0, ty = 0;
    try { var t = G.getComputedStyle(el).transform; if (t && t !== "none" && G.DOMMatrix) { var mx = new G.DOMMatrix(t); tx = mx.e; ty = mx.f; } } catch (e) {}
    var px = src.left + src.width / 2, py = src.top + src.height / 2, z = zf(el);
    return { origin: Math.round((px - r.left) / z + tx) + "px " + Math.round((py - r.top) / z + ty) + "px" };
  }
  // A pop's exit holds its last frame (fill forwards) until the app hides or removes the element; the next opening
  // clears it first, or the element would open at its shrunken exit frame.
  function clearPops(el) { try { el.getAnimations().forEach(function (a) { if (a.id === "smd-pop") a.cancel(); }); } catch (e) {} }
  function popIn(el, src) {
    clearPops(el);
    var o = originFor(el, src); if (!o || !IND) return null;
    var e = ease("menu"), keep = el.style.transformOrigin;
    el.style.transformOrigin = o.origin;
    var a = anim(el, [{ scale: "0.2" }, { scale: "1" }], { duration: e.duration, easing: e.easing, fill: "backwards", id: "smd-pop" });
    anim(el, [{ opacity: 0.5 }, { opacity: 1 }], { duration: Math.round(e.duration * 0.35), easing: "linear", fill: "backwards", id: "smd-pop" });
    if (a) a.onfinish = a.oncancel = function () { el.style.transformOrigin = keep; };
    else el.style.transformOrigin = keep;
    return a ? o : null;
  }
  // Back into the button: it shrinks to it on the close curve and is gone as it arrives. origin from popIn.
  function popOut(el, origin, done) {
    if (!IND) { if (done) done(); return null; }
    var keep = el.style.transformOrigin; el.style.transformOrigin = origin;
    clearPops(el);
    var a = anim(el, [{ scale: "1" }, { scale: "0.2" }], { duration: 200, easing: "cubic-bezier(.4, 0, .9, .6)", fill: "forwards", id: "smd-pop" });
    anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 110, delay: 90, easing: "linear", fill: "forwards", id: "smd-pop" });
    var fin = false, end = function () { if (fin) return; fin = true; el.style.transformOrigin = keep; if (done) done(); };
    if (a) { a.onfinish = a.oncancel = end; } else end();
    setTimeout(end, 500);
    return a;
  }
  // No button to grow from: it rises from the bottom edge of the screen (never a fade from nowhere), and goes back down.
  function riseFromEdge(el) {
    if (!IND) return null;
    clearPops(el);
    var r = el.getBoundingClientRect(), e = ease("menu"), dy = Math.max(40, Math.round((G.innerHeight - r.top) / zf(el)));
    return anim(el, [{ translate: "0px " + dy + "px" }, { translate: "0px 0px" }], { duration: e.duration, easing: e.easing, fill: "backwards", id: "smd-pop" });
  }
  function sinkToEdge(el, done) {
    if (!IND) { if (done) done(); return null; }
    clearPops(el);
    var r = el.getBoundingClientRect(), dy = Math.max(40, Math.round((G.innerHeight - r.top) / zf(el)));
    var a = anim(el, [{ translate: "0px 0px" }, { translate: "0px " + dy + "px" }], { duration: 220, easing: "cubic-bezier(.32, 0, .67, 0)", fill: "forwards", id: "smd-pop" });
    var fin = false, end = function () { if (fin) return; fin = true; if (done) done(); };
    if (a) a.onfinish = a.oncancel = end; else end();
    setTimeout(end, 500);
    return a;
  }
  // A page with no source slides up from the bottom edge on the open spring (a full-screen sheet), and slides back
  // down when it closes. No fade: the page is solid the whole way.
  function riseIn(el) { var e = ease("push"); return anim(el, [{ transform: "translateY(" + G.innerHeight + "px)" }, { transform: "translateY(0px)" }], { duration: e.duration, easing: e.easing, fill: "backwards" }); }
  function sinkKf() { return { kf: [{ transform: "translateY(0px)" }, { transform: "translateY(" + G.innerHeight + "px)" }], o: { duration: 300, easing: "cubic-bezier(.32, 0, .67, 0)", fill: "forwards" } }; }
  /* Push (dir 1): the new screen slides in from the right edge over the old one, which drifts a third of the way left.
     The old screen is the one on top (it is a ghost laid over the page), so it is clipped at the new screen's moving
     edge instead of faded: both run on the same curve, so the clip tracks that edge exactly and nothing dissolves.
     Pop (dir -1): the old screen slides off to the right with a soft edge shadow, the one coming back drifts in from
     a third of the way left, dimmed under it. */
  function push(inEls, ghost, dir) {
    var e = ease("push"), w = G.innerWidth, d = dir > 0 ? 1 : -1, out = [], gw = ghost ? (ghost.getBoundingClientRect().width || w) : w;
    (inEls || []).forEach(function (el) {
      out.push(anim(el, d > 0 ? [{ transform: "translateX(" + w + "px)" }, { transform: "translateX(0px)" }] : [{ transform: "translateX(" + Math.round(-w * 0.3) + "px)", opacity: 0.6 }, { transform: "translateX(0px)", opacity: 1 }],
        { duration: e.duration, easing: e.easing, fill: "backwards", id: "pn-nav" }));
    });
    if (ghost) out.push(anim(ghost, d > 0 ? [{ transform: "translateX(0px)", clipPath: "inset(0px 0px 0px 0px)" }, { transform: "translateX(" + Math.round(-w * 0.3) + "px)", clipPath: "inset(0px " + Math.round(gw * 0.7) + "px 0px 0px)" }] :
      [{ transform: "translateX(0px)", boxShadow: "-12px 0 32px rgba(0,0,0,.18)" }, { transform: "translateX(" + w + "px)", boxShadow: "-12px 0 32px rgba(0,0,0,0)" }],
      { duration: e.duration, easing: e.easing, fill: "forwards" }));
    return out;
  }
  // Tabs: a pager. The new content slides in from the side of the tab tapped while the old content slides out the
  // other way, edge to edge, on the push spring.
  function page(inEls, ghost, dir) {
    var e = ease("push"), w = G.innerWidth, d = dir > 0 ? 1 : -1, out = [];
    (inEls || []).forEach(function (el) { out.push(anim(el, [{ transform: "translateX(" + d * w + "px)" }, { transform: "translateX(0px)" }], { duration: e.duration, easing: e.easing, fill: "backwards", id: "pn-nav" })); });
    if (ghost) out.push(anim(ghost, [{ transform: "translateX(0px)" }, { transform: "translateX(" + -d * w + "px)" }], { duration: e.duration, easing: e.easing, fill: "forwards" }));
    return out;
  }
  // Content that changed in place with no direction (a filter, a toggle): it slides up a short way on a spring.
  function nudgeUp(list) {
    var e = ease("settle");
    (list || []).forEach(function (el) { anim(el, [{ transform: "translateY(22px)" }, { transform: "translateY(0px)" }], { duration: e.duration, easing: e.easing, fill: "backwards", id: "pn-nav" }); });
  }
  function stagger(list) {
    var e = ease("settle");
    Array.prototype.slice.call(list || [], 0, 10).forEach(function (el, i) { anim(el, [{ transform: "translateY(16px)" }, { transform: "translateY(0px)" }], { duration: e.duration, easing: e.easing, delay: 40 + i * 28, fill: "backwards" }); });
  }

  /* Whole-screen View Transitions (a list row opening its screen, view-transitions.js; a Back tap, page-motion.js):
     a push instead of the old cross-fade. The new screen slides in from the right over the old one, which drifts a
     third of the way left and dims; with html.smd-vt-back the old screen slides off to the right over the one coming
     back. Theme changes (theme-reveal.js) set their own classes, which outrank these rules. */
  (function () {
    var e = ease("push"), dur = e.duration + "ms " + e.easing, st = D.createElement("style");
    st.id = "smdVtPush";
    st.textContent =
      "::view-transition-old(root){animation:" + dur + " both smdPushOld;z-index:0}" +
      "::view-transition-new(root){animation:" + dur + " both smdPushNew;z-index:1;box-shadow:-12px 0 32px rgba(0,0,0,.16)}" +
      "html.smd-vt-back::view-transition-old(root){animation:" + dur + " both smdPopOld;z-index:1;box-shadow:-12px 0 32px rgba(0,0,0,.16)}" +
      "html.smd-vt-back::view-transition-new(root){animation:" + dur + " both smdPopNew;z-index:0}" +
      "@keyframes smdPushOld{to{transform:translateX(-30%);filter:brightness(.82)}}" +
      "@keyframes smdPushNew{from{transform:translateX(100%)}}" +
      "@keyframes smdPopOld{to{transform:translateX(100%)}}" +
      "@keyframes smdPopNew{from{transform:translateX(-30%);filter:brightness(.82)}}" +
      "@media (prefers-reduced-motion:reduce){::view-transition-old(root),::view-transition-new(root){animation:none!important}}";
    (D.head || D.documentElement).appendChild(st);
  })();
  // A View Transition owns the screen while it runs: page-motion.js keeps its own entrance off it.
  function vtBusy() { return Date.now() - (G.__smdVtAt || 0) < 900; }

  G.SMD_MOTION = { on: on, ease: ease, source: source, take: take, morphIn: morphIn, morphOut: morphOut, morphOutKf: morphOutKf, originFor: originFor, popIn: popIn, popOut: popOut, riseFromEdge: riseFromEdge, sinkToEdge: sinkToEdge, riseIn: riseIn, sinkKf: sinkKf, push: push, page: page, nudgeUp: nudgeUp, tabDir: tabDir, vtBusy: vtBusy, stagger: stagger, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
