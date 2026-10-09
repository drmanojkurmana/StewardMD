/* PrepNucleus image viewer: ONE full-screen viewer for every enlarged image (question and explanation images, lesson
   figures, deck images). window.PREP_VIEWER. ES5.
   API (kept small on purpose):
     PREP_VIEWER.open({ src, alt, caption, from, onClose }) -> true. from: the element to give focus back to on close.
       onClose: called once after it closes (any way: button, Escape, back, swipe down).
     PREP_VIEWER.close() -> true when a viewer was open (prep.js back() calls it first, so Escape and Android back close it).
     PREP_VIEWER.isOpen() -> boolean.
     PREP_VIEWER._pure: the gesture maths (zoomAt, clampPan, rubber), for unit tests.
   Gestures: pinch 1x to 5x around the pinch point (with a soft edge past both ends, settling back on release), one finger
   pans while zoomed (held inside the image's edges), double tap zooms to 2.5x at the tap or back to fit, a vertical swipe
   at fit size drags the image and closes it past 110 px or on a quick flick. Trackpad pinch (ctrl + wheel) and the wheel
   work too; keys: Escape closes, + and - zoom, 0 fits, arrows pan. The app sets user-scalable=no, so all of this is a
   transform on the image (compositor only), never page zoom. The page behind never scrolls: the viewer owns every touch
   (touch-action: none, a non-passive touchmove guard for older WebKit, gesturestart cancelled for iOS).
   Mounted inside the PrepNucleus root (.pn-root, for its tokens) or, outside it, on document.body. */
(function (G) {
  "use strict";
  var MIN = 1, MAX = 5, DT = 2.5;

  /* ---------- pure maths ---------- */
  // Scale s -> s2 keeping the screen point f (relative to the stage centre) still: t2 = f - (s2 / s) * (f - t).
  function zoomAt(t, s, s2, f) { var k = s2 / s; return { x: f.x - k * (f.x - t.x), y: f.y - k * (f.y - t.y) }; }
  // The pan limit at scale s for an image laid out w x h (fit size) in a W x H stage: the image edge may not come inside
  // the stage edge; an image smaller than the stage on an axis stays centred on it.
  function bounds(s, w, h, W, H) { return { x: Math.max(0, (w * s - W) / 2), y: Math.max(0, (h * s - H) / 2) }; }
  function clampPan(t, s, w, h, W, H) { var b = bounds(s, w, h, W, H); return { x: Math.max(-b.x, Math.min(b.x, t.x)) + 0, y: Math.max(-b.y, Math.min(b.y, t.y)) + 0 }; }
  // Past a limit the image follows the finger at a falling rate (rubber band), never more than 1/3 of the stage.
  function rubber(over, dim) { var c = 0.55; return (1 - 1 / ((over * c / (dim || 1)) + 1)) * dim / 3 * Math.sign(over || 0); }
  function softPan(t, s, w, h, W, H) {
    var b = bounds(s, w, h, W, H), o = { x: t.x, y: t.y };
    if (t.x > b.x) o.x = b.x + rubber(t.x - b.x, W); else if (t.x < -b.x) o.x = -b.x + rubber(t.x + b.x, W);
    if (t.y > b.y) o.y = b.y + rubber(t.y - b.y, H); else if (t.y < -b.y) o.y = -b.y + rubber(t.y + b.y, H);
    return o;
  }
  function softScale(s) { return s > MAX ? MAX + (s - MAX) * 0.3 : s < MIN ? MIN - (MIN - s) * 0.45 : s; }
  var PURE = { MIN: MIN, MAX: MAX, DT: DT, zoomAt: zoomAt, bounds: bounds, clampPan: clampPan, rubber: rubber, softPan: softPan, softScale: softScale };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }
  if (!G || !G.document) return;
  var D = G.document;

  function reduced() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var ICO = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    minus: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6"/>',
    plus: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8v6M8 11h6"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'
  };
  function svg(n) { return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICO[n] + "</svg>"; }

  var V = null;   // the open viewer: { el, stage, img, s, t, opts, ... }

  function isOpen() { return !!V; }
  function open(o) {
    o = o || {};
    if (!o.src) return false;
    if (V) finish(true);
    var host = D.getElementById("smdPrep") || D.body;
    var el = D.createElement("div");
    el.className = "pv"; el.tabIndex = -1; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", o.caption ? "Image: " + o.caption : "Image viewer");
    el.innerHTML = '<div class="pv-scrim" aria-hidden="true"></div>' +
      '<div class="pv-stage"><img class="pv-img" src="' + esc(o.src) + '" alt="' + esc(o.alt || o.caption || "Image") + '" draggable="false" decoding="async"></div>' +
      '<div class="pv-top"><p class="pv-cap">' + esc(o.caption || "") + '</p><button type="button" class="pv-b pv-x" data-pv="close" aria-label="Close image">' + svg("close") + "</button></div>" +
      '<div class="pv-bot"><div class="pv-zb" role="group" aria-label="Zoom"><button type="button" class="pv-b" data-pv="out" aria-label="Zoom out">' + svg("minus") + '</button><button type="button" class="pv-b pv-pct" data-pv="fit" aria-label="Zoom 100%. Fit to screen"><span>100%</span></button><button type="button" class="pv-b" data-pv="in" aria-label="Zoom in">' + svg("plus") + "</button></div>" +
      '<p class="pv-hint">Pinch or double tap to zoom. Swipe down to close.</p></div>';
    host.appendChild(el);
    V = { el: el, stage: el.querySelector(".pv-stage"), img: el.querySelector(".pv-img"), pct: el.querySelector(".pv-pct span"), s: 1, t: { x: 0, y: 0 }, dy: 0, opts: o, from: o.from || D.activeElement, pts: {}, g: null, tap: null };
    bind(V);
    // Arrive: a fade with a small scale-up (200 ms, strong ease-out); reduced motion fades only.
    try {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced() ? 120 : 180, easing: "cubic-bezier(.23, 1, .32, 1)" });
      if (!reduced()) V.img.animate([{ transform: "scale(.94)" }, { transform: "scale(1)" }], { duration: 240, easing: "cubic-bezier(.23, 1, .32, 1)" });
    } catch (e) {}
    var x = el.querySelector(".pv-x"); try { x.focus({ preventScroll: true }); } catch (e) { x.focus(); }
    return true;
  }
  function close() { if (!V) return false; finish(false); return true; }
  function finish(now) {
    var v = V; V = null;
    if (!v) return;
    G.removeEventListener("resize", v.onResize);
    D.removeEventListener("keydown", v.onKey, true);
    var fired = false, done = function () {
      if (fired) return; fired = true;
      if (v.el.parentNode) v.el.parentNode.removeChild(v.el);
      try { if (v.from && v.from.isConnected && v.from.focus) v.from.focus({ preventScroll: true }); } catch (e) {}
      if (typeof v.opts.onClose === "function") { try { v.opts.onClose(); } catch (e) {} }
    };
    if (now || reduced() || !v.el.animate) return done();
    v.el.style.pointerEvents = "none";
    var a = null; try { a = v.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "ease-out", fill: "forwards" }); } catch (e) {}
    if (a) { a.onfinish = done; G.setTimeout(done, 400); } else done();
  }

  /* ---------- layout and transform ---------- */
  /* Sizes and points in the stage's own CSS px. The app may zoom the whole page (home.js text size: html zoom), so
     pointer coordinates (screen px) are divided by that zoom, and every point is measured from the stage's corner. The
     image sits in the middle of the stage's content box (inside the top and bottom bars); W x H is that box. */
  function dims(v) {
    var r = v.stage.getBoundingClientRect(), ow = v.stage.offsetWidth || r.width || 1, z = (r.width || ow) / ow, cs = G.getComputedStyle(v.stage);
    var pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    var oh = v.stage.offsetHeight || 1, W = Math.max(1, ow - pl - pr), H = Math.max(1, oh - pt - pb);
    return { W: W, H: H, w: v.img.offsetWidth || 1, h: v.img.offsetHeight || 1, cx: pl + W / 2, cy: pt + H / 2, z: z || 1, left: r.left, top: r.top };
  }
  function loc(v, x, y) { var d = dims(v); return { x: (x - d.left) / d.z, y: (y - d.top) / d.z }; }
  function apply(v, ease) {
    v.img.style.transition = ease && !reduced() ? "transform 260ms cubic-bezier(.23, 1, .32, 1)" : "none";
    v.img.style.transform = "translate3d(" + v.t.x.toFixed(1) + "px," + (v.t.y + v.dy).toFixed(1) + "px,0) scale(" + v.s.toFixed(4) + ")";
    v.el.classList.toggle("pv-zoomed", v.s > 1.01);
    if (v.pct) { var pc = Math.round(v.s * 100) + "%"; v.pct.textContent = pc; v.pct.parentNode.setAttribute("aria-label", "Zoom " + pc + ". Fit to screen"); }
    var sc = v.el.querySelector(".pv-scrim");
    if (sc) { sc.style.transition = ease ? "opacity 220ms ease-out" : "none"; sc.style.opacity = String(Math.max(0.15, 1 - Math.abs(v.dy) / 420)); }
  }
  function fit(v) {
    var cs = G.getComputedStyle(v.stage), W = v.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), H = v.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var nw = v.img.naturalWidth, nh = v.img.naturalHeight;
    if (!nw || !nh || W <= 0 || H <= 0) return;
    var k = Math.min(W / nw, H / nh);
    v.img.style.maxWidth = "none"; v.img.style.maxHeight = "none";
    v.img.style.width = Math.floor(nw * k) + "px"; v.img.style.height = Math.floor(nh * k) + "px";
  }
  // Zoom to s2 around the screen point (px, py), or the stage centre; settles inside the limits.
  function zoomTo(v, s2, px, py, ease) {
    var d = dims(v), f = px == null ? { x: 0, y: 0 } : { x: px - d.cx, y: py - d.cy };
    s2 = Math.max(MIN, Math.min(MAX, s2));
    v.t = clampPan(zoomAt(v.t, v.s, s2, f), s2, d.w, d.h, d.W, d.H); v.s = s2;
    apply(v, ease);
  }
  function settle(v) {
    var d = dims(v), s = Math.max(MIN, Math.min(MAX, v.s));
    if (s !== v.s) { var f = v.g && v.g.mid ? { x: v.g.mid.x - d.cx, y: v.g.mid.y - d.cy } : { x: 0, y: 0 }; v.t = zoomAt(v.t, v.s, s, f); v.s = s; }
    v.t = clampPan(v.t, v.s, d.w, d.h, d.W, d.H);
    if (v.s <= 1.001) { v.s = 1; v.t = { x: 0, y: 0 }; }
    apply(v, true);
  }

  /* ---------- gestures ---------- */
  // A finger landing while the image still glides (a settle, a double-tap zoom) catches it where it is on screen:
  // the live transform becomes the state, so nothing jumps to the glide's end first.
  function grab(v) {
    try {
      var m = new G.DOMMatrixReadOnly(G.getComputedStyle(v.img).transform);
      if (m && m.a > 0) { v.s = m.a; v.t = { x: m.e, y: m.f - v.dy }; apply(v, false); }
    } catch (e) {}
  }
  function list(v) { return Object.keys(v.pts).map(function (k) { return v.pts[k]; }); }
  function begin(v) {
    var p = list(v);
    if (p.length >= 2) v.g = { kind: "pinch", d0: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, s0: v.s, t0: { x: v.t.x, y: v.t.y }, m0: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, mid: null };
    else if (p.length === 1) v.g = { kind: "one", x0: p[0].x, y0: p[0].y, t0: { x: v.t.x, y: v.t.y }, axis: null, moved: false, hist: [{ y: p[0].y, t: Date.now() }] };
    else v.g = null;
  }
  function bind(v) {
    var st = v.stage, el = v.el;
    st.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!list(v).length) grab(v);
      v.pts[e.pointerId] = loc(v, e.clientX, e.clientY);
      try { st.setPointerCapture(e.pointerId); } catch (x) {}
      begin(v);
    });
    st.addEventListener("pointermove", function (e) {
      if (!v.pts[e.pointerId] || !v.g) return;
      var lp = v.pts[e.pointerId] = loc(v, e.clientX, e.clientY);
      var p = list(v), g = v.g, d = dims(v);
      if (g.kind === "pinch" && p.length >= 2) {
        var dist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), s2 = softScale(g.s0 * dist / g.d0), m = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        // The image point under the first midpoint stays under the fingers' current midpoint (zoom and pan together).
        var k = s2 / g.s0;
        v.t = softPan({ x: (m.x - d.cx) - k * (g.m0.x - d.cx - g.t0.x), y: (m.y - d.cy) - k * (g.m0.y - d.cy - g.t0.y) }, s2, d.w, d.h, d.W, d.H);
        v.s = s2; g.mid = m; v.tap = null;
        apply(v, false);
      } else if (g.kind === "one") {
        var dx = lp.x - g.x0, dy = lp.y - g.y0;
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
        g.moved = true; v.tap = null;
        g.hist.push({ y: lp.y, t: Date.now() }); if (g.hist.length > 6) g.hist.shift();
        if (v.s > 1.01) { v.t = softPan({ x: g.t0.x + dx, y: g.t0.y + dy }, v.s, d.w, d.h, d.W, d.H); apply(v, false); }
        else {
          if (!g.axis) g.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
          if (g.axis === "y") { v.dy = dy; apply(v, false); }
        }
      }
    });
    var up = function (e) {
      if (!v.pts[e.pointerId]) return;
      var g = v.g, wasOne = g && g.kind === "one", n0 = list(v).length;
      delete v.pts[e.pointerId];
      if (V !== v) return;
      if (n0 >= 2) { if (list(v).length < 2) { settle(v); begin(v); } return; }
      if (wasOne && !g.moved && e.type === "pointerup") { var tp = loc(v, e.clientX, e.clientY); return onTap(v, tp.x, tp.y); }
      if (wasOne && g.axis === "y" && v.s <= 1.01) {
        var h = g.hist, a = h[0], b = h[h.length - 1], vy = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
        if (Math.abs(v.dy) > 110 || (Math.abs(vy) > 0.35 && Math.abs(v.dy) > 24)) return finish(false);
        v.dy = 0; apply(v, true); v.g = null; return;
      }
      settle(v); v.g = null;
    };
    st.addEventListener("pointerup", up); st.addEventListener("pointercancel", up);
    // Trackpad pinch arrives as ctrl + wheel; a plain wheel pans a zoomed image.
    st.addEventListener("wheel", function (e) {
      e.preventDefault();
      var wp = loc(v, e.clientX, e.clientY);
      if (e.ctrlKey) zoomTo(v, v.s * Math.exp(-e.deltaY * 0.01), wp.x, wp.y, false);
      else if (v.s > 1.01) { var d = dims(v); v.t = clampPan({ x: v.t.x - e.deltaX / d.z, y: v.t.y - e.deltaY / d.z }, v.s, d.w, d.h, d.W, d.H); apply(v, false); }
    }, { passive: false });
    // Nothing behind the viewer scrolls or zooms (older WebKit ignores touch-action on some elements).
    el.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
    el.addEventListener("gesturestart", function (e) { e.preventDefault(); });
    el.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-pv]") : null;
      e.stopPropagation();   // the PrepNucleus root's click handler never sees a tap in here
      if (!b) return;
      var a = b.getAttribute("data-pv");
      if (a === "close") return close();
      if (a === "in") return zoomTo(v, v.s >= MAX ? MAX : Math.min(MAX, v.s * 1.6), null, null, true);
      if (a === "out") return zoomTo(v, Math.max(MIN, v.s / 1.6), null, null, true);
      if (a === "fit") return zoomTo(v, 1, null, null, true);
    });
    // Keys are read on the document while the viewer is open (a tap on the image moves focus to nothing on the page).
    v.onKey = function (e) {
      if (V !== v) return;
      var k = e.key, d;
      if (k === "Escape") { e.preventDefault(); e.stopPropagation(); return close(); }
      if (k === "+" || k === "=") { e.preventDefault(); return zoomTo(v, v.s * 1.6, null, null, true); }
      if (k === "-" || k === "_") { e.preventDefault(); return zoomTo(v, v.s / 1.6, null, null, true); }
      if (k === "0") { e.preventDefault(); return zoomTo(v, 1, null, null, true); }
      if (/^Arrow/.test(k) && v.s > 1.01) {
        e.preventDefault(); d = dims(v);
        var step = 60, dx = k === "ArrowLeft" ? step : k === "ArrowRight" ? -step : 0, dy = k === "ArrowUp" ? step : k === "ArrowDown" ? -step : 0;
        v.t = clampPan({ x: v.t.x + dx, y: v.t.y + dy }, v.s, d.w, d.h, d.W, d.H); return apply(v, true);
      }
      if (k === "Tab") {   // focus stays inside the dialog
        var f = Array.prototype.slice.call(el.querySelectorAll("button")), i = f.indexOf(D.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
      }
      e.stopPropagation();
    };
    D.addEventListener("keydown", v.onKey, true);
    v.onResize = function () { if (V === v) { fit(v); settle(v); } };
    G.addEventListener("resize", v.onResize);
    // The image is laid out at the largest size that fits the stage (a small image is enlarged to fit too).
    if (v.img.complete && v.img.naturalWidth) fit(v); else v.img.addEventListener("load", function () { if (V === v) { fit(v); apply(v, false); } });
    st.addEventListener("pointerdown", function () { try { el.focus({ preventScroll: true }); } catch (x) {} }, true);
  }
  // A double tap (two taps within 300 ms and 32 px) zooms to 2.5x at the tap, or back to fit when zoomed.
  function onTap(v, x, y) {
    var now = Date.now(), p = v.tap;
    v.g = null;
    if (p && now - p.t < 300 && Math.abs(p.x - x) < 32 && Math.abs(p.y - y) < 32) {
      v.tap = null;
      return v.s > 1.01 ? zoomTo(v, 1, null, null, true) : zoomTo(v, DT, x, y, true);
    }
    v.tap = { t: now, x: x, y: y };
  }

  G.PREP_VIEWER = { open: open, close: close, isOpen: isOpen, _pure: PURE, _state: function () { return V ? { s: V.s, x: V.t.x, y: V.t.y, dy: V.dy } : null; } };
})(typeof window !== "undefined" ? window : this);
