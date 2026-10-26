/* StewardMD — Dynamic Island in-app notifications (window.SMD_dynNotify).
 *
 * A web port of the look of rit3zh/expo-dynamic-notifications (React Native + Skia + Reanimated,
 * which cannot run in this Capacitor WebView): a black pill sits where the iPhone's Dynamic Island
 * is, and a notification card drops out of it, joined to it by a gooey neck. The goo is the classic
 * SVG metaball filter (blur + alpha threshold), the same trick the library draws in Skia. Content
 * sits in a crisp HTML layer above it and is revealed out of a blur.
 *
 * Motion: every shape is a real damped spring (position + velocity), stepped on rAF only while
 * something is moving. A swipe hands its finger velocity to the spring, so a flick up continues
 * into the island instead of restarting. Interruptible: a new notification while one is open
 * morphs the card to the new size, it does not queue.
 *
 * Every in-app notification routes here: toast.js (window.toast / SMD_toast) and native-push.js
 * (foreground push and SMD_localNotify) call it when enabled. Kill switch: localStorage
 * smd_dyn_notify=0 brings back the old bottom toast and the OS banner.
 *
 * API: SMD_dynNotify({ title, message, symbol, avatar, accent, duration, onPress, haptic, action })
 *        action: { label, onPress } a pill button on the card (Undo); tapping it runs onPress and dismisses
 *        symbol: "bell" | "success" | "warning" | "error" | "info" | null
 *        duration: ms, or null to stay until swiped / tapped
 *      SMD_dynNotify.fromText(text)   one string, split into title + message, symbol inferred
 *      SMD_dynNotify.dismiss()   SMD_dynNotify.enabled()   SMD_dynNotify.isVisible() */
(function () {
  "use strict";

  /* ---- pure helpers (exported on a test seam, no DOM) ---- */
  var K = 420, C = 31;                        // spring stiffness / damping: slightly underdamped, the goo wobbles once
  var DT = 1 / 240;                           // fixed physics substep

  // Semi-implicit Euler, one substep. Unit mass.
  function springStep(x, v, target, dt, k, c) {
    k = k || K; c = c || C;
    var a = -k * (x - target) - c * v;
    v = v + a * dt;
    return { x: x + v * dt, v: v };
  }
  function settled(x, v, target) { return Math.abs(x - target) < 0.15 && Math.abs(v) < 2; }

  function durationFor(title, message) {
    var n = String(title || "").length + String(message || "").length;
    return Math.min(6500, Math.max(2600, n * 55));
  }

  // "Title — body" (native-push.js fallback shape), "Title\nbody", or one line (title only).
  function splitText(text) {
    var s = String(text == null ? "" : text).trim();
    var nl = s.indexOf("\n");
    if (nl > 0) return { title: s.slice(0, nl).trim(), message: s.slice(nl + 1).trim() };
    var d = s.indexOf(" — ");
    if (d > 0 && d < 60) return { title: s.slice(0, d).trim(), message: s.slice(d + 3).trim() };
    return { title: s, message: "" };
  }

  // Icon only. Outcome haptics stay with the code that owns the outcome (haptics.js rule).
  function kindOf(text) {
    var s = String(text || "");
    if (/\b(fail(ed|ure)?|error|could ?n[o']t|unable|denied|invalid|offline|not (saved|sent|available))\b/i.test(s)) return "error";
    if (/\b(warning|caution|careful|expir(ed|es|ing)|low |limit)\b/i.test(s)) return "warning";
    if (/\b(saved|copied|done|sent|added|updated|deleted|removed|shared|exported|synced|enabled|complete[d]?|success(ful(ly)?)?)\b/i.test(s)) return "success";
    return "info";
  }

  // Swipe up (toward the island) dismisses; a flick beats distance. dy, vy in px and px/s.
  function swipeDismiss(dy, vy) { return dy < -28 || (dy < -6 && vy < -380); }
  // Toward the island tracks 1:1; away from it, a rubber band.
  function dampen(dy) { return dy <= 0 ? dy : Math.sqrt(dy) * 4; }

  // The real island: 126 x 37 at 11pt from the top, on a 59pt safe area. Elsewhere, float at 8px.
  var PILL_W = 126, PILL_H = 37, GAP = 10;
  function pillTop(safeTop) { return Math.max(8, (safeTop || 0) - 48); }
  function cardWidth(vw) { return Math.max(200, Math.min(vw - 24, 420)); }

  var seam = { springStep: springStep, settled: settled, durationFor: durationFor, splitText: splitText,
               kindOf: kindOf, swipeDismiss: swipeDismiss, dampen: dampen, pillTop: pillTop, cardWidth: cardWidth,
               PILL_W: PILL_W, PILL_H: PILL_H, GAP: GAP };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  if (window.SMD_dynNotify) return;
  window.SMD_DYN_SEAM = seam;

  var NS = "http://www.w3.org/2000/svg";
  var FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,'Segoe UI',Roboto,sans-serif";
  var ACCENT = { bell: "#FF9F0A", success: "#30D158", warning: "#FFD60A", error: "#FF453A", info: "#0A84FF" };
  var ICON = {
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    success: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    warning: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16.5h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4.5"/><path d="M12 8h.01"/>'
  };

  function enabled() { try { return window.localStorage.getItem("smd_dyn_notify") !== "0"; } catch (e) { return true; } }
  function still() { try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function hidden() { return document.visibilityState === "hidden"; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }

  /* ---- DOM ---- */
  var svg, gGroup, pill, card, layer, live, probe;
  function el(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }

  function ensureDom() {
    if (svg && svg.isConnected) return;
    var host = document.body || document.documentElement;
    svg = el("svg", { "aria-hidden": "true", focusable: "false" });
    svg.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:0;overflow:visible;pointer-events:none;z-index:2147483100;opacity:0";
    var defs = el("defs", {});
    var f = el("filter", { id: "smdDynGoo", filterUnits: "userSpaceOnUse", x: "-50", y: "-50", width: "4000", height: "2000", "color-interpolation-filters": "sRGB" });
    f.appendChild(el("feGaussianBlur", { "in": "SourceGraphic", stdDeviation: "9", result: "b" }));
    f.appendChild(el("feColorMatrix", { "in": "b", mode: "matrix", values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9", result: "goo" }));
    f.appendChild(el("feComposite", { "in": "SourceGraphic", in2: "goo", operator: "atop", result: "shape" }));
    f.appendChild(el("feDropShadow", { "in": "shape", dx: "0", dy: "10", stdDeviation: "14", "flood-color": "#000", "flood-opacity": "0.28" }));
    defs.appendChild(f);
    svg.appendChild(defs);
    gGroup = el("g", { filter: "url(#smdDynGoo)", fill: "#000" });
    pill = el("rect", {}); card = el("rect", {});
    gGroup.appendChild(pill); gGroup.appendChild(card);
    svg.appendChild(gGroup);
    host.appendChild(svg);

    layer = document.createElement("div");
    layer.style.cssText = "position:fixed;left:0;top:0;z-index:2147483101;pointer-events:none;touch-action:none;" +
      "-webkit-user-select:none;user-select:none;will-change:transform,clip-path;opacity:1";
    host.appendChild(layer);
    wireGestures();

    live = document.createElement("div");
    live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
    live.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;left:-9999px";
    host.appendChild(live);

    probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:max(env(safe-area-inset-top,0px),var(--sai-top,0px))";
    host.appendChild(probe);
  }
  /* The Display setting zooms the whole page (home.js zoomNowD: documentElement.style.zoom, 0.95 by default on a
   * small phone). The island is laid out in screen pixels (innerWidth, the hardware island), so it opts out of that
   * zoom the way the Display sheet does; inside a 0.95 page it drew 5% small and slid toward the left edge. */
  function pageZoom() {
    var de = document.documentElement, z = parseFloat(de.style.zoom);
    if (!(z > 0)) try { z = parseFloat(getComputedStyle(de).zoom); } catch (e) { z = 1; }
    return z > 0.3 && z < 4 ? z : 1;
  }
  function unzoom() {
    var z = pageZoom(), inv = z === 1 ? "" : String(Math.round(1e4 / z) / 1e4);
    if (svg && svg.style.zoom !== inv) svg.style.zoom = inv;
    if (layer && layer.style.zoom !== inv) layer.style.zoom = inv;
  }
  function safeTop() { try { return parseFloat(getComputedStyle(probe).paddingTop) || 0; } catch (e) { return 0; } }

  /* ---- spring state: pill {x,y,w,h} and card {x,y,w,h}, each a spring ---- */
  var keys = ["px", "py", "pw", "ph", "cx", "cy", "cw", "ch"];
  var S = {}, V = {}, T = {};
  keys.forEach(function (k) { S[k] = 0; V[k] = 0; T[k] = 0; });
  var raf = 0, last = 0, onSettle = null, geo = null;

  function setAll(src, dst) { keys.forEach(function (k) { dst[k] = src[k]; }); }
  function paint() {
    var pr = Math.max(0, S.ph / 2), cr = Math.max(0, Math.min(24, S.ch / 2, S.cw / 2));
    pill.setAttribute("x", S.px - S.pw / 2); pill.setAttribute("y", S.py);
    pill.setAttribute("width", Math.max(0, S.pw)); pill.setAttribute("height", Math.max(0, S.ph)); pill.setAttribute("rx", pr);
    card.setAttribute("x", S.cx - S.cw / 2); card.setAttribute("y", S.cy);
    card.setAttribute("width", Math.max(0, S.cw)); card.setAttribute("height", Math.max(0, S.ch)); card.setAttribute("rx", cr);
    svg.style.height = Math.ceil(Math.max(S.cy + S.ch, S.py + S.ph) + 60) + "px";
    if (geo) {
      // Content is laid out at the card's resting size; clip it to the live shape so text never
      // shows outside the black while the card grows, shrinks or wobbles.
      var dx = (S.cx - S.cw / 2) - geo.x, dy = S.cy - geo.y;
      layer.style.transform = "translate3d(" + geo.x + "px," + (geo.y + dy) + "px,0)";
      var l = dx, r = geo.w - (dx + S.cw), b = geo.h - S.ch;
      layer.style.clipPath = "inset(0px " + Math.max(0, r) + "px " + Math.max(0, b) + "px " + Math.max(0, l) + "px round " + cr + "px)";
    }
  }
  function tick(now) {
    raf = 0;
    var el2 = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    var n = Math.max(1, Math.round(el2 / DT)), done = true;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < keys.length; j++) {
        var k = keys[j], r = springStep(S[k], V[k], T[k], DT);
        S[k] = r.x; V[k] = r.v;
      }
    }
    for (var m = 0; m < keys.length; m++) {
      var kk = keys[m];
      if (!settled(S[kk], V[kk], T[kk])) { done = false; break; }
    }
    if (done) { setAll(T, S); keys.forEach(function (k) { V[k] = 0; }); }
    paint();
    if (!done) run();
    else if (onSettle) { var f = onSettle; onSettle = null; f(); }
  }
  function run() { if (!raf) raf = requestAnimationFrame(tick); }
  function animate(then) {
    onSettle = then || null;
    if (still()) { setAll(T, S); paint(); if (onSettle) { var f = onSettle; onSettle = null; f(); } return; }
    if (!raf) last = performance.now();
    run();
  }

  /* ---- content ---- */
  function contentHtml(o) {
    var lead = "";
    if (o.avatar) {
      lead = '<img alt="" src="' + esc(o.avatar) + '" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex:none">';
    } else if (o.symbol && ICON[o.symbol]) {
      var a = o.accent || ACCENT[o.symbol];
      lead = '<div style="width:38px;height:38px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;' +
        'background:' + a + '26;color:' + a + '"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' + ICON[o.symbol] + "</svg></div>";
    }
    var t = o.title ? '<div style="font:600 15px/1.3 ' + FONT + ';letter-spacing:-0.01em;color:#fff;overflow:hidden;' +
      'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2">' + esc(o.title) + "</div>" : "";
    var m = o.message ? '<div style="font:400 13.5px/1.35 ' + FONT + ';color:rgba(235,235,245,.66);margin-top:2px;overflow:hidden;' +
      'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;white-space:pre-line;overflow-wrap:anywhere">' + esc(o.message) + "</div>" : "";
    var act = o.action ? '<div data-dn-action role="button" tabindex="0" style="flex:none;margin-left:4px;padding:8px 14px;border-radius:999px;' +
      'background:rgba(255,255,255,.14);color:' + (o.accent || ACCENT.info) + ';font:600 14px/1 ' + FONT + ';letter-spacing:-0.01em">' + esc(o.action.label) + "</div>" : "";
    return '<div style="display:flex;align-items:center;gap:12px;padding:14px 18px 14px 14px;box-sizing:border-box">' +
      lead + '<div style="min-width:0;flex:1">' + t + m + "</div>" + act + "</div>";
  }
  var REVEAL = "cubic-bezier(.2,.8,.2,1)";
  function revealIn(node, delay) {
    if (still()) { node.style.transition = "opacity 180ms linear"; node.style.opacity = "1"; return; }
    node.style.transition = "opacity 380ms " + REVEAL + " " + delay + "ms,filter 460ms " + REVEAL + " " + delay + "ms,transform 520ms " + REVEAL + " " + delay + "ms";
    node.style.opacity = "1"; node.style.filter = "blur(0px)"; node.style.transform = "translateY(0) scale(1)";
  }
  function hiddenStyle(node) {
    node.style.opacity = "0";
    if (!still()) { node.style.filter = "blur(10px)"; node.style.transform = "translateY(-10px) scale(.94)"; }
  }

  /* ---- lifecycle ---- */
  var cur = null;       // { opts, node, t: {remaining, t0, running}, timer }
  var phase = "idle";   // idle | open | closing

  function restPill() {
    var vw = window.innerWidth || document.documentElement.clientWidth || 390;
    return { x: vw / 2, y: pillTop(safeTop()), w: PILL_W, h: PILL_H };
  }

  function show(opts) {
    if (!opts) return;
    try {
      ensureDom();
      unzoom();
      var o = {
        title: opts.title ? String(opts.title) : "", message: opts.message ? String(opts.message) : "",
        symbol: opts.symbol === undefined ? "info" : opts.symbol, avatar: opts.avatar || null, accent: opts.accent || null,
        onPress: typeof opts.onPress === "function" ? opts.onPress : null,
        action: opts.action && opts.action.label && typeof opts.action.onPress === "function" ? { label: String(opts.action.label).slice(0, 18), onPress: opts.action.onPress } : null
      };
      if (!o.title && !o.message) return;
      if (!o.title) { o.title = o.message; o.message = ""; }
      o.duration = opts.duration === null ? null : (typeof opts.duration === "number" ? opts.duration : durationFor(o.title, o.message));

      // Same notification again: restart its timer, don't re-animate.
      if (cur && phase === "open" && cur.opts.title === o.title && cur.opts.message === o.message) { arm(cur, o.duration); return; }

      var vw = window.innerWidth || document.documentElement.clientWidth || 390;
      var p = restPill(), w = cardWidth(vw);
      var node = document.createElement("div");
      node.innerHTML = contentHtml(o);
      node.style.cssText = "position:absolute;left:0;top:0;width:" + w + "px;will-change:opacity,filter,transform;transform-origin:50% 0";
      hiddenStyle(node);
      layer.appendChild(node);
      var h = Math.max(64, Math.ceil(node.firstChild.getBoundingClientRect().height));
      geo = { x: Math.round(vw / 2 - w / 2), y: Math.round(p.y + PILL_H + GAP), w: w, h: h };
      layer.style.width = w + "px"; layer.style.height = h + "px";

      if (phase === "idle") {
        // Born inside the island: card starts as the pill, the pill starts a touch small.
        S.px = p.x; S.py = p.y + 2; S.pw = PILL_W * 0.7; S.ph = PILL_H * 0.85;
        S.cx = p.x; S.cy = p.y; S.cw = PILL_W; S.ch = PILL_H;
        keys.forEach(function (k) { V[k] = 0; });
        V.ch = 900; V.cw = 600;                      // initial kick: it springs out, not eases out
        paint();
      }
      svg.style.transition = "opacity 120ms linear"; svg.style.opacity = "1";
      T.px = p.x; T.py = p.y; T.pw = p.w; T.ph = p.h;
      T.cx = vw / 2; T.cy = geo.y; T.cw = w; T.ch = h;

      if (cur) retire(cur);
      phase = "open";
      cur = { opts: o, node: node, t: null, timer: null, dragging: false };
      layer.style.pointerEvents = "auto";
      layer.setAttribute("aria-label", o.title + (o.message ? ". " + o.message : ""));
      void node.offsetWidth;
      revealIn(node, S.ch > PILL_H + 4 ? 40 : 110);   // morphing from an open card: reveal sooner
      live.textContent = ""; live.textContent = o.title + (o.message ? ". " + o.message : "");
      if (opts.haptic) { try { var H = window.SMD_HAPTICS; if (H && H.light) H.light(); } catch (e) {} }
      // Sound (soft, off unless the doctor enabled it in Settings): a bell for pushes, a note for outcomes.
      try { var SS = window.SMD_SOUND, sn = opts.sound || (opts.haptic ? "notify" : (o.symbol === "success" ? "success" : (o.symbol === "error" ? "error" : null))); if (SS && sn) SS.play(sn); } catch (e) {}
      animate(null);
      arm(cur, o.duration);
    } catch (e) {
      try { console.log("[dyn-notify]", opts && (opts.title || opts.message)); } catch (x) {}
    }
  }

  function retire(it) {
    clearTimeout(it.timer);
    var n = it.node;
    n.style.transition = "opacity 140ms linear" + (still() ? "" : ",filter 160ms linear,transform 180ms " + REVEAL);
    n.style.opacity = "0";
    if (!still()) { n.style.filter = "blur(8px)"; n.style.transform = "translateY(-6px) scale(.97)"; }
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 220);
  }

  // Countdown runs only while the app is visible and no finger holds the card.
  function arm(it, ms) {
    clearTimeout(it.timer); it.timer = null;
    it.t = ms == null ? null : { remaining: ms, t0: 0, running: false };
    sync();
  }
  function sync() {
    var it = cur; if (!it || !it.t) return;
    var should = phase === "open" && !hidden() && !it.dragging, now = Date.now();
    if (should && !it.t.running) {
      it.t = { remaining: it.t.remaining, t0: now, running: true };
      it.timer = setTimeout(function () { if (cur === it) dismiss(); }, it.t.remaining);
    } else if (!should && it.t.running) {
      clearTimeout(it.timer); it.timer = null;
      it.t = { remaining: Math.max(0, it.t.remaining - (now - it.t.t0)), t0: 0, running: false };
    }
  }

  function dismiss(vel) {
    if (!cur || phase !== "open") return;
    var it = cur; phase = "closing";
    layer.style.pointerEvents = "none";
    retire(it);
    var p = restPill();
    T.cx = p.x; T.cy = p.y; T.cw = PILL_W; T.ch = PILL_H;
    if (typeof vel === "number") V.cy = vel;          // a flick continues into the island
    animate(function () {
      if (phase !== "closing") return;
      // Card is back inside the island; now the island itself breathes out.
      T.pw = PILL_W * 0.7; T.ph = PILL_H * 0.85; T.cw = PILL_W * 0.7; T.ch = PILL_H * 0.85; T.py = p.y + 2; T.cy = p.y + 2;
      svg.style.transition = "opacity 180ms linear"; svg.style.opacity = "0";
      animate(function () {
        if (phase !== "closing") return;
        phase = "idle"; cur = null; geo = null; live.textContent = "";
      });
    });
  }

  /* ---- gestures: swipe up to dismiss (velocity handed to the spring), tap to open ---- */
  function wireGestures() {
    var id = null, y0 = 0, t0 = 0, lastY = 0, lastT = 0, vy = 0, moved = false, base = 0, downEl = null;
    layer.addEventListener("pointerdown", function (e) {
      if (id !== null || !cur || phase !== "open") return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      downEl = e.target;   // pointer capture retargets later events to the layer, so remember the real target
      id = e.pointerId; y0 = lastY = e.clientY; t0 = lastT = performance.now(); vy = 0; moved = false; base = T.cy;
      cur.dragging = true; sync();
      try { layer.setPointerCapture(id); } catch (x) {}
    });
    layer.addEventListener("pointermove", function (e) {
      if (e.pointerId !== id || !cur) return;
      var now = performance.now(), dy = e.clientY - y0;
      if (Math.abs(dy) > 6) moved = true;
      if (now > lastT) { vy = 0.7 * vy + 0.3 * ((e.clientY - lastY) / (now - lastT) * 1000); lastY = e.clientY; lastT = now; }
      // Finger owns the card: position follows directly, the spring takes over on release.
      S.cy = T.cy = base + dampen(dy); V.cy = 0;
      var squeeze = dy < 0 ? Math.min(1, -dy / 160) : 0;   // pulled toward the island, it narrows a little
      S.cw = T.cw = geo.w * (1 - 0.12 * squeeze);
      paint();
    });
    function end(e, cancelled) {
      if (e.pointerId !== id) return;
      id = null;
      try { layer.releasePointerCapture(e.pointerId); } catch (x) {}
      if (!cur) return;
      var it = cur, dy = e.clientY - y0, tap = !moved && performance.now() - t0 < 400;
      it.dragging = false;
      if (!cancelled && tap) {
        var onAct = it.opts.action && downEl && downEl.closest && downEl.closest("[data-dn-action]");
        var fn = onAct ? it.opts.action.onPress : it.opts.onPress;
        dismiss();
        if (fn) { try { fn(); } catch (x) {} }
        return;
      }
      if (!cancelled && swipeDismiss(dy, vy)) { dismiss(Math.min(-600, vy)); return; }
      T.cy = base; T.cw = geo.w; V.cy = vy;
      animate(null); sync();
    }
    layer.addEventListener("pointerup", function (e) { end(e, false); });
    layer.addEventListener("pointercancel", function (e) { end(e, true); });
  }

  // 2026-10-26 (owner): the gooey Island card and its icons are retired as the default look. Every caller still
  // goes through this API, but it draws with toast.js's plain card. localStorage smd_dyn_notify=island brings the Island back.
  function island() { try { return window.localStorage.getItem("smd_dyn_notify") === "island"; } catch (e) { return false; } }
  function api(opts) { if (!island() && window.SMD_toastCard) { window.SMD_toastCard(opts); return; } show(opts); }
  api.fromText = function (text, extra) {
    if (!island() && window.SMD_toastCard) {
      var c = { text: String(text) };
      if (extra) for (var j in extra) c[j] = extra[j];
      window.SMD_toastCard(c);
      return;
    }
    var s = splitText(text);
    var o = { title: s.title, message: s.message, symbol: kindOf(text) };
    if (extra) for (var k in extra) o[k] = extra[k];
    show(o);
  };
  api.dismiss = function () { if (!island() && window.SMD_toastDismiss) { window.SMD_toastDismiss(); return; } dismiss(); };
  api.enabled = enabled;
  api.isVisible = function () { if (!island() && window.SMD_toastVisible) return window.SMD_toastVisible(); return phase === "open"; };
  window.SMD_dynNotify = api;

  document.addEventListener("visibilitychange", sync);
  window.addEventListener("resize", function () {
    if (!cur || phase !== "open" || !geo) return;
    unzoom();
    var vw = window.innerWidth || 390, p = restPill();
    geo.x = Math.round(vw / 2 - geo.w / 2);
    T.px = S.px = p.x; T.cx = S.cx = vw / 2; paint();
  });
})();
