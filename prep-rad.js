/* PrepNucleus radiology image series (scroll stacks). ES5. window.PREP_RAD, loaded by prep-loader.js after prep.js; draws
   through PREP._host. prep.js forwards every data-act starting "rd-" here, asks back() first, calls figure() while drawing
   a question (next to PREP_PYQ.figure) and mount() after the paint, and leave() on close.
   Data: a bank item may carry stack = { id, n, base, w: ["soft", "lung"], wl: ["Soft tissue", "Lung"], ar, lbl } where
   slice k of window w is host.bankApi + base + w + "/" + NNN + ".webp" (000 to n-1, inferior first), ar = height / width.
   Viewer: the slice on a dark stage, a scrubber, a window switch when there is more than one window, Enlarge (full-screen,
   pinch zoom 1x to 4x, pan, double tap resets), an optional cine loop that never starts by itself. Move through slices by
   dragging up or down on the image, the wheel or trackpad, or the keys (arrows, Page Up / Down, Home, End). Slices load
   from the current one outward; a thin bar shows loading until the window is cached. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pad3(k) { k = String(k); while (k.length < 3) k = "0" + k; return k; }
  // URL of slice k of window index wi.
  function sliceUrl(api, st, wi, k) { var w = (st.w && st.w.length ? st.w : ["soft"])[wi] || st.w[0]; return (api || "/api/prep/bank/") + st.base + w + "/" + pad3(k) + ".webp"; }
  // Pixels of drag per slice: a full-height drag covers the stack, never finer than 3 px or coarser than 8 px.
  function pxPerSlice(h, n) { return clamp((h || 300) / Math.max(1, n), 3, 8); }
  // Slice after a vertical drag of dy px from slice k0 (down = later slice).
  function sliceFromDrag(k0, dy, px, n) { return clamp(k0 + Math.round(dy / px), 0, n - 1); }
  // Wheel: whole slices out of an accumulated delta (pixels; a line is 40 px); returns [steps, rest].
  function wheelSteps(acc, dy, mode) { var d = acc + dy * (mode === 1 ? 40 : mode === 2 ? 400 : 1), s = d > 0 ? Math.floor(d / 40) : Math.ceil(d / 40); return [s, d - s * 40]; }
  // Load order: the current slice, then outward on both sides.
  function preloadOrder(k, n) { var out = [clamp(k, 0, n - 1)]; for (var d = 1; out.length < n; d++) { if (k + d < n) out.push(k + d); if (k - d >= 0) out.push(k - d); } return out; }
  // Key -> slice delta (or absolute for Home / End); null when the key is not ours.
  function keyTo(key, k, n) {
    var big = Math.max(2, Math.round(n / 10));
    if (key === "ArrowDown" || key === "ArrowRight") return clamp(k + 1, 0, n - 1);
    if (key === "ArrowUp" || key === "ArrowLeft") return clamp(k - 1, 0, n - 1);
    if (key === "PageDown") return clamp(k + big, 0, n - 1);
    if (key === "PageUp") return clamp(k - big, 0, n - 1);
    if (key === "Home") return 0;
    if (key === "End") return n - 1;
    return null;
  }
  function valid(st) { return !!(st && st.base && st.n > 0 && /^v\d+\/[a-z0-9-]+\/stack\/[a-z0-9-]+\/$/.test(st.base)); }
  var PURE = { clamp: clamp, pad3: pad3, sliceUrl: sliceUrl, pxPerSlice: pxPerSlice, sliceFromDrag: sliceFromDrag, wheelSteps: wheelSteps, preloadOrder: preloadOrder, keyTo: keyTo, valid: valid };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var D = G.document;
  var R = { host: null, it: null, el: null, k: 0, wi: 0, ov: null, cine: 0, cache: {}, loaded: {}, Z: null };
  var reduced = function () { try { return G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
  var SV = {
    expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'
  };
  function svg(n) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SV[n] + "</svg>"; }
  function esc(s) { return R.host && R.host.esc ? R.host.esc(s) : String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function api() { return (R.host && R.host.bankApi) || "/api/prep/bank/"; }
  function url(k, wi) { return sliceUrl(api(), R.it.stack, wi == null ? R.wi : wi, k); }

  function controls(st, n, k, big) {
    var w = st.w || [], wl = st.wl || w;
    return '<div class="pn-stack-ctl">' +
      '<button type="button" class="pn-stack-b" data-act="rd-play" aria-pressed="false" aria-label="Play the series as a loop">' + svg("play") + "</button>" +
      '<label class="pn-stack-sc"><span class="pn-sr">Slice</span><input type="range" class="pn-stack-rg" min="0" max="' + (n - 1) + '" step="1" value="' + k + '" aria-valuetext="Slice ' + (k + 1) + " of " + n + '"></label>' +
      (big ? "" : '<button type="button" class="pn-stack-b" data-act="rd-zoom" aria-label="Enlarge the image series">' + svg("expand") + "</button>") + "</div>" +
      (w.length > 1 ? '<div class="pn-stack-win" role="group" aria-label="Window">' + w.map(function (x, i) {
        return '<button type="button" class="pn-stack-wb' + (i === R.wi ? " on" : "") + '" data-act="rd-win" data-v="' + i + '" aria-pressed="' + (i === R.wi) + '">' + esc(wl[i] || x) + "</button>";
      }).join("") + "</div>" : "");
  }
  function stage(st, n, k, big) {
    return '<div class="pn-stack-st' + (big ? " big" : "") + '" tabindex="0" role="group" aria-roledescription="image series" aria-label="' + esc(st.lbl || "Image series") + ", slice " + (k + 1) + " of " + n + '. Use the arrow keys to move through the slices." style="--ar:' + (st.ar > 0 ? st.ar : 1) + '">' +
      '<div class="pn-stack-z"><img class="pn-stack-im" src="' + esc(url(k)) + '" alt="' + esc(st.lbl || "Image series") + ", slice " + (k + 1) + " of " + n + '" draggable="false" decoding="async"></div>' +
      '<span class="pn-stack-ct" aria-hidden="true"><b>' + (k + 1) + "</b>/" + n + "</span>" +
      '<span class="pn-stack-ld" aria-hidden="true"><i></i></span></div>';
  }
  // While a question is drawn: the viewer for an item with a stack ("" otherwise).
  function figure(it, host) {
    if (host) R.host = host;
    if (!it || !valid(it.stack)) return "";
    var st = it.stack, n = st.n;
    if (R.it !== it) { stopCine(); R.it = it; R.wi = 0; R.k = Math.floor((n - 1) / 2); }
    return '<section class="pn-stack" data-k="' + R.k + '" data-n="' + n + '" data-w="' + R.wi + '" aria-label="Image series">' +
      '<p class="pn-stack-top"><span class="pn-stack-lbl">' + svg("layers") + "<span>" + esc(st.lbl || "Image series") + '</span></span><span class="pn-stack-cnt">Slice <b>' + (R.k + 1) + "</b> of " + n + "</span></p>" +
      stage(st, n, R.k, false) + controls(st, n, R.k, false) +
      '<p class="pn-stack-h">Drag up or down, or scroll, to move through the slices.</p></section>';
  }

  /* ---------- slice state ---------- */
  function views() { var v = []; if (R.el && R.el.isConnected) v.push(R.el); if (R.ov && R.ov.isConnected) v.push(R.ov); return v; }
  function show(k) {
    var st = R.it && R.it.stack; if (!st) return;
    R.k = clamp(k, 0, st.n - 1);
    var u = url(R.k), lbl = (st.lbl || "Image series") + ", slice " + (R.k + 1) + " of " + st.n;
    views().forEach(function (v) {
      v.setAttribute("data-k", R.k); v.setAttribute("data-w", R.wi);
      var im = v.querySelector(".pn-stack-im"); if (im && im.getAttribute("src") !== u) { im.setAttribute("src", u); im.setAttribute("alt", lbl); }
      var sg = v.querySelector(".pn-stack-st"); if (sg) sg.setAttribute("aria-label", lbl + ". Use the arrow keys to move through the slices.");
      var rg = v.querySelector(".pn-stack-rg"); if (rg) { rg.value = R.k; rg.setAttribute("aria-valuetext", "Slice " + (R.k + 1) + " of " + st.n); }
      v.querySelectorAll(".pn-stack-cnt b, .pn-stack-ct b").forEach(function (b) { b.textContent = R.k + 1; });
    });
  }
  function preload() {
    var st = R.it && R.it.stack; if (!st) return;
    var wi = R.wi, key = st.base + wi, order = preloadOrder(R.k, st.n), next = 0, live = 0, it = R.it;
    var c = R.cache[key] || (R.cache[key] = {});
    var done = function () { var n = 0; for (var k in c) if (c[k].ok) n++; return n; };
    var bar = function () {
      var p = done() / st.n;
      views().forEach(function (v) { var b = v.querySelector(".pn-stack-ld"); if (!b) return; b.classList.toggle("done", p >= 1); b.firstChild.style.transform = "scaleX(" + p.toFixed(3) + ")"; });
    };
    var pump = function () {
      if (R.it !== it || R.wi !== wi) return;
      while (live < 4 && next < order.length) {
        var k = order[next++]; if (c[k]) continue;
        live++;
        (function (k) {
          var im = new G.Image(); c[k] = { im: im, ok: 0 };
          im.onload = function () { c[k].ok = 1; live--; bar(); pump(); };
          im.onerror = function () { live--; pump(); };
          im.decoding = "async"; im.src = url(k, wi);
        })(k);
      }
      bar();
    };
    pump();
  }
  function setWin(i) {
    var st = R.it && R.it.stack; if (!st || !st.w || !st.w[i]) return;
    R.wi = i;
    views().forEach(function (v) { v.querySelectorAll(".pn-stack-wb").forEach(function (b) { var on = +b.getAttribute("data-v") === i; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }); });
    show(R.k); preload();
  }
  function stopCine() {
    if (R.cine) { G.clearInterval(R.cine); R.cine = 0; }
    views().forEach(function (v) { var b = v.querySelector("[data-act=rd-play]"); if (b) { b.setAttribute("aria-pressed", "false"); b.setAttribute("aria-label", "Play the series as a loop"); b.innerHTML = svg("play"); } });
  }
  function toggleCine() {
    if (R.cine) return stopCine();
    var st = R.it && R.it.stack; if (!st) return;
    R.cine = G.setInterval(function () { if (!views().length) return stopCine(); show(R.k >= st.n - 1 ? 0 : R.k + 1); }, 125);
    views().forEach(function (v) { var b = v.querySelector("[data-act=rd-play]"); if (b) { b.setAttribute("aria-pressed", "true"); b.setAttribute("aria-label", "Pause the loop"); b.innerHTML = svg("pause"); } });
  }

  /* ---------- gestures ---------- */
  function bindView(v, big) {
    var sg = v.querySelector(".pn-stack-st"), rg = v.querySelector(".pn-stack-rg"), z = v.querySelector(".pn-stack-z");
    if (!sg) return;
    var st = R.it.stack, pts = {}, g = null, wacc = 0, lastTap = 0;
    var Z = { s: 1, x: 0, y: 0 };
    if (big) R.Z = Z;
    var apply = function () { z.style.transform = Z.s > 1 ? "translate(" + Z.x.toFixed(1) + "px," + Z.y.toFixed(1) + "px) scale(" + Z.s.toFixed(3) + ")" : ""; sg.classList.toggle("zoomed", Z.s > 1); };
    var list = function () { return Object.keys(pts).map(function (k) { return pts[k]; }); };
    var begin = function () {
      var p = list();
      if (big && p.length >= 2) g = { pinch: 1, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, s: Z.s, x: Z.x, y: Z.y, mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2 };
      else if (p.length === 1) g = { pinch: 0, x0: p[0].x, y0: p[0].y, k0: R.k, zx: Z.x, zy: Z.y, px: pxPerSlice(sg.clientHeight, st.n) };
      else g = null;
    };
    sg.addEventListener("pointerdown", function (e) {
      if (e.button) return;
      e.stopPropagation();
      if (R.cine) stopCine();
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { sg.setPointerCapture(e.pointerId); } catch (x) {}
      begin();
    });
    sg.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId] || !g) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var p = list();
      if (g.pinch && p.length >= 2) {
        var s = clamp(g.s * Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / g.d, 1, 4), r = sg.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2, k = s / g.s;
        Z.s = s; Z.x = (g.mx - cx) - ((g.mx - cx) - g.x) * k + (mx - g.mx); Z.y = (g.my - cy) - ((g.my - cy) - g.y) * k + (my - g.my);
        if (s <= 1) { Z.x = 0; Z.y = 0; }
        apply();
      } else if (!g.pinch) {
        if (big && Z.s > 1) { Z.x = g.zx + e.clientX - g.x0; Z.y = g.zy + e.clientY - g.y0; apply(); }
        else show(sliceFromDrag(g.k0, e.clientY - g.y0, g.px, st.n));
      }
    });
    var up = function (e) {
      if (!pts[e.pointerId]) return;
      var moved = g && !g.pinch ? Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0) : 99;
      delete pts[e.pointerId];
      if (big && e.type === "pointerup" && moved < 8) {
        var now = Date.now();
        if (now - lastTap < 320) { Z.s = 1; Z.x = 0; Z.y = 0; apply(); lastTap = 0; } else lastTap = now;
      }
      begin();
    };
    sg.addEventListener("pointerup", up); sg.addEventListener("pointercancel", up);
    sg.addEventListener("wheel", function (e) {
      if (e.ctrlKey && big) { e.preventDefault(); Z.s = clamp(Z.s * (e.deltaY < 0 ? 1.1 : 0.9), 1, 4); if (Z.s <= 1) { Z.x = 0; Z.y = 0; } apply(); return; }
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      if (R.cine) stopCine();
      var r = wheelSteps(wacc, e.deltaY, e.deltaMode); wacc = r[1];
      if (r[0]) show(R.k + r[0]);
    }, { passive: false });
    sg.addEventListener("keydown", function (e) {
      var k = keyTo(e.key, R.k, st.n);
      if (k == null) return;
      e.preventDefault(); e.stopPropagation();
      if (R.cine) stopCine();
      show(k);
    });
    if (rg) rg.addEventListener("input", function () { if (R.cine) stopCine(); show(+rg.value); });
  }

  // After the paint: bind the viewer on screen (new elements each paint, so nothing leaks across questions).
  function mount(root) {
    var el = root && root.querySelector(".pn-stack");
    if (!el) { if (R.el) stopCine(); R.el = null; return; }
    if (el === R.el) return;
    R.el = el;
    bindView(el, false);
    show(R.k); preload();
  }

  /* ---------- enlarge ---------- */
  function zoomOpen() {
    var host = R.host, st = R.it && R.it.stack; if (!host || !st) return;
    zoomClose();
    var el = D.createElement("div");
    el.className = "pn-zoom pn-stack-ov"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Image series, enlarged");
    el.setAttribute("data-k", R.k); el.setAttribute("data-w", R.wi);
    el.innerHTML = '<div class="pn-zoom-top"><p>' + esc(st.lbl || "Image series") + ' <span class="pn-stack-cnt">Slice <b>' + (R.k + 1) + "</b> of " + st.n + '</span></p><button type="button" class="pn-ib" data-act="rd-unzoom" aria-label="Close the image series">' + svg("close") + "</button></div>" +
      '<div class="pn-stack-ovb">' + stage(st, st.n, R.k, true) + "</div>" +
      '<div class="pn-stack-ovf">' + controls(st, st.n, R.k, true) + '<p class="pn-zoom-h">Drag up or down to move through the slices. Pinch to zoom, double tap to reset.</p></div>';
    host.root().appendChild(el);
    R.ov = el;
    bindView(el, true);
    if (R.cine) { var b = el.querySelector("[data-act=rd-play]"); if (b) { b.setAttribute("aria-pressed", "true"); b.innerHTML = svg("pause"); } }
    show(R.k); preload();
    var c = el.querySelector("[data-act=rd-unzoom]"); if (c) c.focus();
  }
  function zoomClose() {
    if (!R.ov) return false;
    var o = R.ov; R.ov = null; R.Z = null;
    if (o.parentNode) o.parentNode.removeChild(o);
    var t = R.el && R.el.isConnected && R.el.querySelector("[data-act=rd-zoom]"); if (t) t.focus();
    return true;
  }

  function act(a, b, host) {
    R.host = host;
    if (a === "rd-win") return setWin(+b.getAttribute("data-v"));
    if (a === "rd-zoom") return zoomOpen();
    if (a === "rd-unzoom") return zoomClose();
    if (a === "rd-play") return toggleCine();
  }
  // back(): true when handled here (the enlarged series closes first).
  function back() { return zoomClose(); }
  function leave() { stopCine(); zoomClose(); R.el = null; R.it = null; R.cache = {}; }

  G.PREP_RAD = { figure: figure, mount: mount, act: act, back: back, leave: leave, reduced: reduced, _pure: PURE, _st: R };
})(typeof window !== "undefined" ? window : this);
