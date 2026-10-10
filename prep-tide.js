/* PrepNucleus Tide (prep-tide.js, 2026-10-10): the live background behind the top of every screen. ES5, no library.
   A port of React Bits "Grainient" (grainy gradient swirls with a soft wave warp; ogl + React in the original) to one
   plain WebGL 1 full-screen triangle, retuned to the owner's palette: Prussian and Dark Navy currents with one slow
   Pastel Amber ember, on Midnight (dark) or on the warm paper (light, pale tints only so the ink keeps 4.5:1 over it).
   Where it lives: a layer under the overlay (#smdPrepTide, z-index just below #smdPrep), as tall as the screen's top
   region (home: the readiness hero; lists: the bar and the first card; reading screens: the bar only), fading into the
   page through a mask. It moves up with the screen's scroll at 0.6x and stops drawing once it has left the view.
   Battery: drawn at half the CSS pixel size (DPR ignored: a soft field needs no more), at most 30 frames a second, only
   while PrepNucleus is open, the page is visible and the layer is on screen. Grain is a 96 px noise tile made once in
   CSS, not per frame. Reduced motion: one still frame. No WebGL: a still CSS gradient in the same colours.
   API: PREP_TIDE.attach(root), sync(root) after every paint, detach(). */
(function (G) {
  "use strict";
  var D = G.document;
  var VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";
  // Grainient's field (warp, rotation by noise, three-colour blend), grain removed (CSS tile), light mode replaced by
  // the theme's own pale colours.
  var FS = [
    "precision mediump float;",
    "uniform vec2 R;uniform float T;uniform vec3 C1;uniform vec3 C2;uniform vec3 C3;uniform float B;",
    "mat2 rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}",
    "vec2 hs(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}",
    "float nz(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);",
    "return 0.5+0.5*mix(mix(dot(-1.0+2.0*hs(i),f),dot(-1.0+2.0*hs(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),",
    "mix(dot(-1.0+2.0*hs(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hs(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);}",
    "void main(){",
    "float t=T;vec2 uv=gl_FragCoord.xy/R;float ra=R.x/R.y;",
    "vec2 q=uv-0.5+vec2(-0.12,0.08);q/=0.85;",
    "float dg=nz(vec2(t*0.1,q.x*q.y)*1.6);",
    "q.y*=1.0/ra;q*=rot(radians((dg-0.5)*300.0+180.0));q.y*=ra;",
    "q.x+=sin(q.y*4.0+t*1.1)/40.0;q.y+=sin(q.x*6.0+t*1.1)/20.0;",
    "float bx=(q*rot(radians(-18.0))).x;",
    "vec3 l1=mix(C3,C2,smoothstep(-0.38-B,0.28-B,bx));vec3 l2=mix(C2,C1,smoothstep(-0.38-B,0.28-B,bx));",
    "vec3 col=mix(l1,l2,smoothstep(0.58-B,-0.38-B,q.y));",
    "gl_FragColor=vec4(col,1.0);}"
  ].join("\n");
  // Theme colours: C1 the high current, C2 the ember, C3 the deep. Light: tints of the same hues on the paper.
  var PAL = {
    dark: { c1: [0x1a, 0x40, 0x74], c2: [0x5e, 0x4a, 0x33], c3: [0x16, 0x1a, 0x30], b: 0.04 },
    light: { c1: [0xcb, 0xda, 0xef], c2: [0xf8, 0xdf, 0xb6], c3: [0xe2, 0xe9, 0xf4], b: 0.02 }
  };
  var CANVAS_H = 420, SCALE = 0.5, FRAME_MS = 1000 / 30, SPEED = 0.16;
  var host = null, tw = null, cv = null, gl = null, prog = null, U = {}, raf = 0, last = 0, t0 = 0, tAcc = 0, w = 0, root = null, mo = null, mode = "", reg = 0, offY = 0, bodyEl = null;
  var still = false, ok = false, vis = true;

  function reduced() { try { return G.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function dark() { return D.body.classList.contains("dark"); }
  function grainTile() {
    try {
      var c = D.createElement("canvas"); c.width = c.height = 96;
      var x = c.getContext("2d"), im = x.createImageData(96, 96), d = im.data, s = 7;
      for (var i = 0; i < d.length; i += 4) { s = (s * 16807) % 2147483647; var v = s % 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      x.putImageData(im, 0, 0); return c.toDataURL("image/png");
    } catch (e) { return ""; }
  }
  var GRAIN = null;
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }
  function initGL() {
    try { gl = cv.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" }); } catch (e) { gl = null; }
    if (!gl) return false;
    var v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
    if (!v || !f) return false;
    prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ["R", "T", "C1", "C2", "C3", "B"].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
    cv.addEventListener("webglcontextlost", function (e) { e.preventDefault(); ok = false; stop(); host && host.classList.add("pn-tide-off"); });
    return true;
  }
  function size() {
    if (!host || !cv) return;
    var nw = host.offsetWidth || G.innerWidth || 390;
    if (nw === w && cv.height) return;
    w = nw; cv.width = Math.max(1, Math.round(w * SCALE)); cv.height = Math.round(CANVAS_H * SCALE);
    if (gl) gl.viewport(0, 0, cv.width, cv.height);
  }
  function colors() {
    var p = dark() ? PAL.dark : PAL.light, f = function (a) { return [a[0] / 255, a[1] / 255, a[2] / 255]; };
    gl.uniform3fv(U.C1, f(p.c1)); gl.uniform3fv(U.C2, f(p.c2)); gl.uniform3fv(U.C3, f(p.c3)); gl.uniform1f(U.B, p.b);
  }
  function draw(t) {
    if (!ok) return;
    size();
    gl.uniform2f(U.R, cv.width, cv.height); gl.uniform1f(U.T, t); colors();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function running() { return ok && !still && vis && root && !D.hidden && offY < reg + 40; }
  // One frame, then sleep until the next is due (a timer, not a wake-up every vsync), then the next vsync draws it.
  var tmr = 0;
  function loop(now) {
    raf = 0;
    if (!running()) return;
    if (last) tAcc += Math.min(100, now - last) / 1000 * SPEED * 6;
    last = now; draw(tAcc);
    tmr = G.setTimeout(function () { tmr = 0; if (running()) raf = G.requestAnimationFrame(loop); }, Math.max(0, FRAME_MS - 6));
  }
  function start() { if (!raf && !tmr && running()) { last = 0; raf = G.requestAnimationFrame(loop); } }
  function stop() { if (raf) { G.cancelAnimationFrame(raf); raf = 0; } if (tmr) { G.clearTimeout(tmr); tmr = 0; } }
  function onVis() { if (D.hidden) stop(); else start(); }
  function onTheme() { if (ok) { draw(tAcc); } paintFallback(); }
  function paintFallback() { if (host) host.classList.toggle("pn-tide-dk", dark()); }

  // The screen's top region: home keeps the hero on the tide; a reading screen (a question, a lesson) only its bar.
  function regionFor(r) {
    var bar = r.querySelector(":scope > .pn-bar"), body = r.querySelector(":scope > .pn-body");
    var barB = bar ? bar.offsetTop + bar.offsetHeight : 64;
    if (!body) return { m: "list", h: barB + 160 };
    if (body.classList.contains("pn-home")) return { m: "home", h: Math.min(CANVAS_H, barB + 300) };
    if (body.classList.contains("pn-run") || r.querySelector(".pn-lsn-step")) return { m: "read", h: barB + 36 };
    return { m: "list", h: Math.min(CANVAS_H, barB + 190) };
  }
  function onScroll(e) {
    var b = e.target;
    if (!b || !b.classList || !b.classList.contains("pn-body") || b.parentNode !== root) return;
    place(b.scrollTop);
  }
  function place(y) {
    offY = Math.max(0, y || 0) * 0.6;
    if (tw) tw.style.transform = offY ? "translate3d(0," + (-Math.min(offY, reg + 40)) + "px,0)" : "";
    if (root) root.classList.toggle("pn-scr", (y || 0) > 6);
    if (running()) start(); else stop();
  }

  /* Press effects (React Bits, ported to a delegated listener): a primary button gets one specular sweep (ShinyText /
     SpecularButton) per press; a spotlight card (SpotlightCard) lights from the point pressed, and follows a mouse. */
  var SPOT = ".pn-next, .pn-qotd, .pn-subs > .pn-tile, .pl-upnext";
  function spotAt(el, e) { var b = el.getBoundingClientRect(), z = el.offsetWidth ? b.width / el.offsetWidth : 1; el.style.setProperty("--mx", ((e.clientX - b.left) / (z || 1)).toFixed(0) + "px"); el.style.setProperty("--my", ((e.clientY - b.top) / (z || 1)).toFixed(0) + "px"); }
  function onDown(e) {
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    var p = t.closest(".pn-btn.pri");
    if (p && !p.disabled && !reduced()) { p.classList.remove("pn-shine"); void p.offsetWidth; p.classList.add("pn-shine"); }
    var c = t.closest(SPOT); if (c) spotAt(c, e);
  }
  function onMove(e) { if (e.pointerType !== "mouse") return; var c = e.target && e.target.closest && e.target.closest(SPOT); if (c) spotAt(c, e); }
  function onEnd(e) { var p = e.target && e.target.classList && e.target.classList.contains("pn-shine") ? e.target : null; if (p && e.animationName === "pn-shine") p.classList.remove("pn-shine"); }
  function attach(r) {
    if (host) detach();
    root = r; still = reduced();
    host = D.createElement("div"); host.id = "smdPrepTide"; host.className = "pn-root pn-tidehost"; host.setAttribute("aria-hidden", "true");
    host.innerHTML = '<div class="pn-tide"><canvas class="pn-tide-cv"></canvas><i class="pn-tide-gr"></i></div>';
    r.parentNode.insertBefore(host, r);
    r.classList.add("pn-tided");
    cv = host.querySelector("canvas"); tw = host.firstChild;
    if (GRAIN === null) GRAIN = grainTile();
    if (GRAIN) host.querySelector(".pn-tide-gr").style.backgroundImage = "url(" + GRAIN + ")";
    w = 0; size();
    ok = initGL();
    if (!ok) host.classList.add("pn-tide-off");
    paintFallback();
    tAcc = 7.3;   // a settled start: the field opens mid-swirl, not on its symmetric first frame
    if (ok) draw(tAcc);
    D.addEventListener("visibilitychange", onVis);
    r.addEventListener("scroll", onScroll, true);
    r.addEventListener("pointerdown", onDown, { passive: true });
    r.addEventListener("pointermove", onMove, { passive: true });
    r.addEventListener("animationend", onEnd);
    G.addEventListener("resize", onResize);
    try { mo = new MutationObserver(onTheme); mo.observe(D.body, { attributes: true, attributeFilter: ["class"] }); } catch (e) { mo = null; }
    try { G.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", onMotionPref); } catch (e) {}
    vis = true; start();
  }
  function onMotionPref() { still = reduced(); if (still) stop(); else start(); }
  function onResize() { w = 0; size(); if (ok) draw(tAcc); }
  // After a paint: the region of the new screen, the scroll it was restored to, and the tide is told to run.
  function sync(r) {
    if (!host || r !== root) return;
    var g = regionFor(r);
    if (g.m !== mode || Math.abs(g.h - reg) > 1) {
      mode = g.m; reg = g.h;
      tw.style.height = reg + "px"; host.setAttribute("data-m", mode);
    }
    var b = r.querySelector(":scope > .pn-body");
    bodyEl = b;
    place(b ? b.scrollTop : 0);
  }
  function detach() {
    stop();
    D.removeEventListener("visibilitychange", onVis);
    G.removeEventListener("resize", onResize);
    try { G.matchMedia("(prefers-reduced-motion: reduce)").removeEventListener("change", onMotionPref); } catch (e) {}
    if (mo) { mo.disconnect(); mo = null; }
    if (root) { root.removeEventListener("scroll", onScroll, true); root.removeEventListener("pointerdown", onDown); root.removeEventListener("pointermove", onMove); root.removeEventListener("animationend", onEnd); root.classList.remove("pn-tided", "pn-scr"); }
    try { var x = gl && gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); } catch (e) {}
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = tw = cv = gl = prog = root = bodyEl = null; ok = false; mode = ""; reg = 0; offY = 0;
  }
  G.PREP_TIDE = { attach: attach, sync: sync, detach: detach, _state: function () { return { ok: ok, running: !!(raf || tmr), mode: mode, reg: reg, still: still }; } };
})(typeof window !== "undefined" ? window : this);
