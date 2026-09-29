/* Specialty engine image stage: fit, pinch-zoom, double-tap zoom, pan. ES5, no dependencies.
   window.SPECIALTY_STAGE.attach(stageEl, imgEl) -> { reset() }.
   Pure helpers exported for tests under node. */
(function (G) {
  "use strict";
  var MIN = 1, MAX = 6;

  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }

  // Base fit: the image's displayed size at scale 1 inside the stage (object-fit: contain).
  function fit(stageW, stageH, imgW, imgH) {
    var s = Math.min(stageW / imgW, stageH / imgH);
    return { w: imgW * s, h: imgH * s };
  }

  // Zoom about a stage point (px, py), keeping that image point under the finger.
  // View = { k, x, y }: image top-left at (x, y) in stage px, scale k relative to fit.
  function zoomAt(view, k2, px, py) {
    k2 = clamp(k2, MIN, MAX);
    var r = k2 / view.k;
    return { k: k2, x: px - (px - view.x) * r, y: py - (py - view.y) * r };
  }

  // Keep the image covering the stage when zoomed; centred when it is smaller than the stage.
  function bound(view, stageW, stageH, fw, fh) {
    var w = fw * view.k, h = fh * view.k, x = view.x, y = view.y;
    x = w <= stageW ? (stageW - w) / 2 : clamp(x, stageW - w, 0);
    y = h <= stageH ? (stageH - h) / 2 : clamp(y, stageH - h, 0);
    return { k: view.k, x: x, y: y };
  }

  function attach(stage, img) {
    var view = null, f = null, pts = {}, start = null, lastTap = 0;

    function size() {
      var r = stage.getBoundingClientRect();
      var iw = img.naturalWidth || +img.getAttribute("width") || 1, ih = img.naturalHeight || +img.getAttribute("height") || 1;
      f = fit(r.width, r.height, iw, ih);
      img.style.width = f.w + "px"; img.style.height = f.h + "px";
      img.style.left = "0"; img.style.top = "0"; img.style.maxWidth = "none"; img.style.maxHeight = "none";
      return r;
    }
    function apply(v, animate) {
      var r = stage.getBoundingClientRect();
      view = bound(v, r.width, r.height, f.w, f.h);
      img.style.transition = animate ? "transform 220ms cubic-bezier(0.23, 1, 0.32, 1)" : "none";
      img.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.k + ")";
      stage.classList.toggle("zoomed", view.k > 1.01);
    }
    function reset() { size(); apply({ k: 1, x: 0, y: 0 }, false); }
    function local(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function ids() { return Object.keys(pts); }

    stage.addEventListener("pointerdown", function (e) {
      if (!f) return;
      // A pointer whose up never arrived must not turn later drags into a phantom pinch (atlas lesson).
      if (e.isPrimary) pts = {};
      pts[e.pointerId] = local(e);
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      var n = ids().length;
      if (n === 1) {
        var now = Date.now(), p = pts[e.pointerId];
        if (now - lastTap < 280) {
          apply(view.k > 1.01 ? { k: 1, x: 0, y: 0 } : zoomAt(view, 2.5, p.x, p.y), true);
          lastTap = 0; start = null; return;
        }
        lastTap = now;
        start = { mode: "pan", p: p, v: view };
      } else if (n === 2) {
        var a = pts[ids()[0]], b = pts[ids()[1]];
        start = { mode: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v: view };
      }
    });
    stage.addEventListener("pointermove", function (e) {
      if (!start || !pts[e.pointerId]) return;
      pts[e.pointerId] = local(e);
      if (start.mode === "pan" && start.v.k > 1.01) {
        var p = pts[e.pointerId];
        apply({ k: start.v.k, x: start.v.x + p.x - start.p.x, y: start.v.y + p.y - start.p.y }, false);
      } else if (start.mode === "pinch" && ids().length >= 2) {
        var a = pts[ids()[0]], b = pts[ids()[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var v = zoomAt(start.v, start.v.k * d / start.d, start.c.x, start.c.y);
        var c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        apply({ k: v.k, x: v.x + c.x - start.c.x, y: v.y + c.y - start.c.y }, false);
      }
    });
    function up(e) {
      delete pts[e.pointerId];
      if (!ids().length) start = null;
      else if (start && start.mode === "pinch") { var id = ids()[0]; start = { mode: "pan", p: pts[id], v: view }; }
    }
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("wheel", function (e) {
      if (!f) return;
      e.preventDefault();
      var p = local(e);
      apply(zoomAt(view, view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p.x, p.y), false);
    }, { passive: false });

    if (img.complete && img.naturalWidth) reset();
    img.addEventListener("load", reset);
    // Re-fit when the stage changes size (rotation, split view, tablet layout switch).
    if (G.ResizeObserver) new G.ResizeObserver(function () { if (img.naturalWidth) reset(); }).observe(stage);
    else if (G.addEventListener) G.addEventListener("resize", function () { if (img.naturalWidth && stage.isConnected) reset(); });
    return { reset: reset, zoomBy: function (m) { var r = stage.getBoundingClientRect(); if (f) apply(zoomAt(view, view.k * m, r.width / 2, r.height / 2), true); } };
  }

  var API = { fit: fit, zoomAt: zoomAt, bound: bound, attach: attach, MIN: MIN, MAX: MAX };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.SPECIALTY_STAGE = API;
})(typeof window !== "undefined" ? window : this);
