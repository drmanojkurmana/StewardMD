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
 *   morphIn(el, rect)        -> a page grows out of the tapped tile: clip from the tile's rect to the full screen,
 *                               a slight scale and a fade of the corners (the container transform)
 *   morphOutKf(el, rect)     -> keyframes that shrink a closing page back into its tile
 *   push(inEls, ghost, dir)  -> iOS-style push (dir 1) and pop (dir -1): the new screen slides in from the edge on a
 *                               spring while the old one drifts a third of the way and dims under or over it
 *   stagger(list)            -> rows settle in one after another (28 ms apart, first 10 only)
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
  function morphFrom(rect, box, radius) {
    var l = Math.max(0, rect.left - box.left), t = Math.max(0, rect.top - box.top);
    var r = Math.max(0, box.left + box.width - (rect.left + rect.width)), b = Math.max(0, box.top + box.height - (rect.top + rect.height));
    var round = Math.round, rd = radius == null ? 18 : radius;
    return { clip: "inset(" + round(t) + "px " + round(r) + "px " + round(b) + "px " + round(l) + "px round " + rd + "px)", scale: 0.96,
      ox: round(rect.left + rect.width / 2 - box.left) + "px", oy: round(rect.top + rect.height / 2 - box.top) + "px" };
  }
  var PRESET = { open: [340, 28], push: [340, 38], settle: [420, 34] };
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
  function source() { return last && Date.now() - last.at < 700 ? last : null; }
  function take() { var s = source(); last = null; return s; }

  function anim(el, kf, o) { try { return el.animate(kf, o); } catch (e) { return null; } }
  function morphIn(el, rect) {
    var box = boxOf(el), m = morphFrom(rect, box, rect.radius), e = ease("open");
    el.style.transformOrigin = m.ox + " " + m.oy;
    // The shape grows on the spring for its whole length; the fade is short, so the page is solid early.
    var a = anim(el, [{ clipPath: m.clip, transform: "scale(" + m.scale + ")" }, { clipPath: "inset(0px 0px 0px 0px round 0px)", transform: "none" }], { duration: e.duration, easing: e.easing, fill: "backwards" });
    anim(el, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 160, easing: "cubic-bezier(.2, 0, 0, 1)", fill: "backwards" });
    if (a) a.onfinish = a.oncancel = function () { el.style.transformOrigin = ""; };
    return a;
  }
  // A page's box; a node already taken out of the page (its exit copy is measured later) counts as the full screen.
  function boxOf(el) { var b = el.getBoundingClientRect(); return b.width && b.height ? b : { left: 0, top: 0, width: G.innerWidth, height: G.innerHeight }; }
  function morphOutKf(el, rect) {
    var box = boxOf(el), m = morphFrom(rect, box, rect.radius);
    return { origin: m.ox + " " + m.oy, kf: [{ clipPath: "inset(0px 0px 0px 0px round 0px)", transform: "none", opacity: 1 }, { clipPath: m.clip, transform: "scale(" + m.scale + ")", opacity: 0 }] };
  }
  // A sheet-like rise for a page with no source: up from 6% of the screen on the open spring.
  function riseIn(el) { var e = ease("open"); return anim(el, [{ opacity: 0, transform: "translateY(" + Math.round(G.innerHeight * 0.06) + "px) scale(.985)" }, { opacity: 1, transform: "none" }], { duration: e.duration, easing: e.easing, fill: "backwards" }); }
  function push(inEls, ghost, dir) {
    var e = ease("push"), w = G.innerWidth, d = dir > 0 ? 1 : -1, out = [];
    (inEls || []).forEach(function (el) {
      out.push(anim(el, d > 0 ? [{ transform: "translateX(" + w + "px)" }, { transform: "translateX(0px)" }] : [{ transform: "translateX(" + Math.round(-w * 0.3) + "px)", opacity: 0.6 }, { transform: "translateX(0px)", opacity: 1 }],
        { duration: e.duration, easing: e.easing, fill: "backwards", id: "pn-nav" }));
    });
    if (ghost) out.push(anim(ghost, d > 0 ? [{ transform: "translateX(0px)", opacity: 1 }, { transform: "translateX(" + Math.round(-w * 0.3) + "px)", opacity: 0, offset: 0.7 }, { transform: "translateX(" + Math.round(-w * 0.32) + "px)", opacity: 0 }] :
      [{ transform: "translateX(0px)", opacity: 1, boxShadow: "-12px 0 32px rgba(0,0,0,.18)" }, { transform: "translateX(" + w + "px)", opacity: 1, boxShadow: "-12px 0 32px rgba(0,0,0,0)" }],
      { duration: e.duration, easing: e.easing, fill: "forwards" }));
    return out;
  }
  function stagger(list) {
    var e = ease("settle");
    Array.prototype.slice.call(list || [], 0, 10).forEach(function (el, i) { anim(el, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: e.duration, easing: e.easing, delay: 40 + i * 28, fill: "backwards" }); });
  }

  G.SMD_MOTION = { on: on, ease: ease, source: source, take: take, morphIn: morphIn, morphOutKf: morphOutKf, riseIn: riseIn, push: push, stagger: stagger, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
