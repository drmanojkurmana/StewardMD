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

  G.SMD_MOTION = { on: on, ease: ease, source: source, take: take, morphIn: morphIn, morphOutKf: morphOutKf, riseIn: riseIn, sinkKf: sinkKf, push: push, page: page, nudgeUp: nudgeUp, tabDir: tabDir, vtBusy: vtBusy, stagger: stagger, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
