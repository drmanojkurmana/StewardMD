/* Effects: two Canvas 2D layers (back: ambient light/dust, front: celebrations).
   Canvas 2D was chosen over WebGL: the effects are sprite particles, which 2D canvas draws
   cheaply on every phone without context-loss or shader-compile risk. Quality adapts to the
   measured frame rate. */
(function () {
  "use strict";
  var VK = (window.VK = window.VK || {});
  var FX = (VK.fx = {});

  var root = document.documentElement;
  var REDUCED = root.classList.contains("rm");
  var LITE = root.classList.contains("lite");
  var back, front, bx, fx, W = 0, H = 0, DPR = 1;
  var running = false, last = 0, quality = LITE ? 0.6 : 1, slowFrames = 0, frames = 0;
  var ambient = [], rice = [], petals = [], sparks = [], burstP = [], glints = [];
  var theme = "ember", themeCfg = null;
  var ledgeFn = null, ledges = [];
  var pointer = { x: -999, y: -999, active: false };
  var tiltX = 0, scrollY0 = window.scrollY, scrollDelta = 0;
  var frontDirty = false;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function sprite(w, h, draw) {
    var c = document.createElement("canvas");
    c.width = Math.ceil(w); c.height = Math.ceil(h);
    draw(c.getContext("2d"), c.width, c.height);
    return c;
  }

  /* ── sprites (built once at device resolution) ── */
  var SPR = {};
  function buildSprites() {
    var s = DPR;
    function grain(base, hi, edge) {
      return sprite(5 * s, 12 * s, function (g, w, h) {
        var gr = g.createLinearGradient(0, 0, w, 0);
        gr.addColorStop(0, edge); gr.addColorStop(.45, hi); gr.addColorStop(1, base);
        g.fillStyle = gr; g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - .3, h / 2 - .3, 0, 0, Math.PI * 2); g.fill();
      });
    }
    SPR.rice = [
      grain("#D99A10", "#FFE27A", "#B07408"),
      grain("#E7AE1E", "#FFF0A8", "#BF850C"),
      grain("#D2681A", "#FFC069", "#A2480E"),
      grain("#F0C040", "#FFF6C8", "#C89A1A")
    ];
    function petal(c1, c2, edge) {
      return sprite(12 * s, 16 * s, function (g, w, h) {
        var gr = g.createRadialGradient(w / 2, h * .75, 1, w / 2, h * .55, h * .7);
        gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        g.fillStyle = gr; g.beginPath();
        g.moveTo(w / 2, h - 1);
        g.bezierCurveTo(-w * .1, h * .55, w * .2, 1, w / 2, 1);
        g.bezierCurveTo(w * .8, 1, w * 1.1, h * .55, w / 2, h - 1);
        g.fill(); g.strokeStyle = edge; g.lineWidth = .6 * s; g.stroke();
      });
    }
    SPR.marigold = petal("#FFC24A", "#E8700C", "rgba(160,60,0,.5)");
    SPR.rose = petal("#E0457A", "#8E0F3E", "rgba(90,0,30,.5)");
    SPR.jasmine = petal("#FFFFFF", "#F2EBD6", "rgba(150,140,110,.4)");
    function soft(size, inner, outer) {
      return sprite(size * s, size * s, function (g, w) {
        var gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        gr.addColorStop(0, inner); gr.addColorStop(.35, outer); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.fillRect(0, 0, w, w);
      });
    }
    SPR.bokehGold = soft(64, "rgba(255,214,140,.9)", "rgba(255,170,80,.35)");
    SPR.bokehChamp = soft(64, "rgba(255,240,205,.85)", "rgba(240,210,150,.3)");
    SPR.bokehAmber = soft(64, "rgba(255,190,110,.9)", "rgba(255,130,40,.32)");
    SPR.dust = soft(10, "rgba(255,236,190,1)", "rgba(255,200,120,.5)");
    SPR.dustDark = soft(10, "rgba(176,128,40,.9)", "rgba(176,128,40,.35)");
    SPR.spark = soft(18, "rgba(255,248,215,1)", "rgba(255,170,60,.65)");
    SPR.glint = sprite(28 * s, 28 * s, function (g, w) {
      var c = w / 2;
      var gr = g.createRadialGradient(c, c, 0, c, c, c);
      gr.addColorStop(0, "rgba(255,250,225,1)"); gr.addColorStop(.25, "rgba(255,220,140,.5)"); gr.addColorStop(1, "rgba(255,200,100,0)");
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(c, 0); g.quadraticCurveTo(c, c, w, c); g.quadraticCurveTo(c, c, c, w); g.quadraticCurveTo(c, c, 0, c); g.quadraticCurveTo(c, c, c, 0); g.fill();
    });
  }

  /* ── themes for the ambient layer ── */
  var THEMES = {
    ember:    { bokeh: "bokehGold",  dust: "dust",     n: 34, bn: 9,  alpha: .55, comp: "lighter" },
    ivory:    { bokeh: "bokehGold",  dust: "dustDark", n: 22, bn: 4,  alpha: .32, comp: "source-over" },
    mandap:   { bokeh: "bokehAmber", dust: "dust",     n: 30, bn: 8,  alpha: .45, comp: "lighter" },
    night:    { bokeh: "bokehAmber", dust: "dust",     n: 30, bn: 10, alpha: .5,  comp: "lighter" },
    emerald:  { bokeh: "bokehChamp", dust: "dust",     n: 26, bn: 9,  alpha: .45, comp: "lighter" },
    star:     { bokeh: "bokehChamp", dust: "dust",     n: 46, bn: 5,  alpha: .6,  comp: "lighter", twinkle: true }
  };

  function seedAmbient() {
    var cfg = themeCfg, total = Math.round((cfg.n + cfg.bn) * quality * (LITE ? .7 : 1));
    while (ambient.length < total) ambient.push(newMote(ambient.length < cfg.bn * quality));
    if (ambient.length > total) ambient.length = total;
  }
  function newMote(isBokeh, top) {
    var depth = rnd(.3, 1);
    return {
      bokeh: isBokeh, x: rnd(0, W), y: top ? H + 20 : rnd(0, H), depth: depth,
      r: isBokeh ? rnd(24, 70) * depth : rnd(1.2, 3.2) * depth,
      vx: rnd(-6, 6), vy: -rnd(4, 16) * depth, ph: rnd(0, 6.28), a: 0, ta: isBokeh ? rnd(.08, .22) : rnd(.25, .8)
    };
  }

  /* ── loop ── */
  function loop(t) {
    if (!running) return;
    var dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    frames++;
    if (dt > 0.028) slowFrames++;
    if (frames % 90 === 0) {
      if (slowFrames > 40 && quality > 0.4) { quality = Math.max(0.4, quality - 0.2); seedAmbient(); }
      slowFrames = 0;
    }
    drawAmbient(dt);
    var busy = rice.length || petals.length || sparks.length || burstP.length || glints.length;
    if (busy) { stepFront(dt); frontDirty = true; }
    else if (frontDirty) { fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, front.width, front.height); frontDirty = false; }
    requestAnimationFrame(loop);
  }
  function start() { if (!running && !document.hidden) { running = true; last = performance.now(); requestAnimationFrame(loop); } }

  function drawAmbient(dt) {
    bx.setTransform(1, 0, 0, 1, 0, 0);
    bx.clearRect(0, 0, back.width, back.height);
    if (REDUCED) { drawAmbientStatic(); return; }
    var cfg = themeCfg, sd = scrollDelta; scrollDelta = 0;
    bx.globalCompositeOperation = cfg.comp;
    for (var i = 0; i < ambient.length; i++) {
      var m = ambient[i];
      m.ph += dt * (m.bokeh ? .3 : 1.1);
      m.x += (m.vx + Math.sin(m.ph) * 4) * dt;
      m.y += m.vy * dt - sd * m.depth * .35;
      m.a += (m.ta - m.a) * Math.min(1, dt * 1.5);
      if (m.y < -80) { m.y = H + 60; m.x = rnd(0, W); }
      if (m.y > H + 90) { m.y = -60; m.x = rnd(0, W); }
      if (m.x < -80) m.x = W + 60; else if (m.x > W + 80) m.x = -60;
      var alpha = m.a * cfg.alpha;
      if (cfg.twinkle && !m.bokeh) alpha *= .55 + .45 * Math.sin(m.ph * 2.3);
      var spr = SPR[m.bokeh ? cfg.bokeh : cfg.dust], sz = m.r * 2 * DPR;
      bx.globalAlpha = alpha;
      bx.drawImage(spr, m.x * DPR - sz / 2, m.y * DPR - sz / 2, sz, sz);
    }
    bx.globalAlpha = 1; bx.globalCompositeOperation = "source-over";
  }
  function drawAmbientStatic() {
    var cfg = themeCfg;
    bx.globalCompositeOperation = cfg.comp;
    for (var i = 0; i < ambient.length; i++) {
      var m = ambient[i], spr = SPR[m.bokeh ? cfg.bokeh : cfg.dust], sz = m.r * 2 * DPR;
      bx.globalAlpha = m.ta * cfg.alpha * .8;
      bx.drawImage(spr, m.x * DPR - sz / 2, m.y * DPR - sz / 2, sz, sz);
    }
    bx.globalAlpha = 1; bx.globalCompositeOperation = "source-over";
  }

  /* ── front layer: rice, petals, sparks, burst, glints ── */
  var G = 1650;
  function stepFront(dt) {
    fx.setTransform(1, 0, 0, 1, 0, 0);
    fx.clearRect(0, 0, front.width, front.height);
    if (rice.length || petals.length) ledges = ledgeFn ? ledgeFn() : [];
    stepGrains(rice, dt, false);
    stepGrains(petals, dt, true);
    stepSparks(dt);
    stepBurst(dt);
    stepGlints(dt);
  }

  function collide(p, ny) {
    for (var i = 0; i < ledges.length; i++) {
      var L = ledges[i];
      if (p.y <= L.y + 1 && ny >= L.y && p.x >= L.x1 && p.x <= L.x2) {
        // porous ledges: each grain decides once per ledge whether it is caught
        if (L.c == null || ((p.seed * 31 + i * 17) % 100) / 100 < L.c) return i;
      }
    }
    return -1;
  }

  function stepGrains(arr, dt, isPetal) {
    for (var i = arr.length - 1; i >= 0; i--) {
      var p = arr[i];
      p.life += dt;
      if (p.delay > 0) { p.delay -= dt; continue; }
      if (pointer.active) {
        var dx = p.x - pointer.x, dy = p.y - pointer.y, d2 = dx * dx + dy * dy;
        if (d2 < 5000 && d2 > 1) {
          var d = Math.sqrt(d2), f = (1 - d / 71) * 900 * dt;
          p.vx += dx / d * f; p.vy += dy / d * f * .6; if (p.state === 1) p.state = 0;
        }
      }
      if (p.state === 0) {
        if (isPetal) {
          p.ph += dt * p.flut;
          if (p.wind) {
            p.vx += (440 - p.vx) * .8 * dt;
            p.vy += (Math.sin(p.ph * 1.3) * 40 - p.vy * .8) * dt;
          } else if (p.lift) {
            p.vy += (-60 - p.vy) * .9 * dt;
            p.vx += (Math.sin(p.ph) * 30 - p.vx * .6) * dt;
            if (p.life > 3) p.alpha -= dt * .8;
          } else {
            p.vy += (G * .12 - p.vy * 2.4) * dt;
            p.vx += (Math.sin(p.ph) * 60 - p.vx * 1.5 + tiltX * .4) * dt;
          }
          p.rot += p.vr * dt;
        } else {
          p.vy += G * dt; p.vx += tiltX * dt;
          p.vx *= 1 - .9 * dt; p.vy *= 1 - .12 * dt;
          p.rot += p.vr * dt;
        }
        var ny = p.y + p.vy * dt;
        var hit = p.vy > 0 && !p.wind && !p.lift ? collide(p, ny) : -1;
        if (hit >= 0) {
          var L = ledges[hit];
          ny = L.y;
          if (!isPetal && p.vy > 260 && p.bounces < 2) {
            p.vy = -p.vy * rnd(.16, .32); p.vx += rnd(-70, 70); p.vr = rnd(-9, 9); p.bounces++;
          } else {
            p.state = 1; p.ledge = hit; p.vy = 0; p.vx *= .2; p.rest = rnd(.7, 2.6);
            p.trot = (Math.random() < .5 ? 1 : -1) * Math.PI / 2 + rnd(-.25, .25);
            if (isPetal) p.trot = rnd(-.5, .5) + (p.rot > 0 ? 3.14 : 0);
          }
        }
        p.y = ny; p.x += p.vx * dt;
      } else if (p.state === 1) {
        var Lr = ledges[p.ledge];
        if (!Lr || p.x < Lr.x1 - 2 || p.x > Lr.x2 + 2) { p.state = 0; }
        else {
          p.y = Lr.y; p.x += p.vx * dt; p.vx *= 1 - 3 * dt;
          p.rot += (p.trot - p.rot) * Math.min(1, dt * 10);
          p.rest -= dt;
          if (p.rest <= 0) {
            if (Math.random() < .55) { p.state = 0; p.vx = (Math.random() < .5 ? -1 : 1) * rnd(30, 90); p.vy = 0; p.rest = 9; }
            else { p.state = 2; }
          }
        }
      }
      if (p.state === 2 || p.life > 8) p.alpha -= dt * 1.6;
      if (p.y > H + 30 || p.alpha <= 0 || p.x < -60 || p.x > W + 60) { arr.splice(i, 1); continue; }
      var spr = p.spr, sw = spr.width * p.sc, sh = spr.height * p.sc;
      var sx = isPetal ? Math.cos(p.ph * .7) : 1;
      var c = Math.cos(p.rot), s = Math.sin(p.rot);
      fx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      fx.setTransform(c * sx, s * sx, -s, c, p.x * DPR, (p.y - (p.state === 1 ? 2 * p.sc : 0)) * DPR);
      fx.drawImage(spr, -sw / 2, -sh / 2, sw, sh);
    }
    fx.setTransform(1, 0, 0, 1, 0, 0); fx.globalAlpha = 1;
  }

  function stepSparks(dt) {
    if (!sparks.length) return;
    fx.globalCompositeOperation = "lighter";
    for (var i = sparks.length - 1; i >= 0; i--) {
      var p = sparks[i];
      p.life += dt;
      if (p.life > p.max) { sparks.splice(i, 1); continue; }
      p.vy += p.g * dt; p.vx *= 1 - 1.2 * dt;
      p.x += (p.vx + Math.sin(p.life * 9 + p.ph) * 10) * dt; p.y += p.vy * dt;
      var k = p.life / p.max, sz = p.size * (1 - k * .6) * DPR;
      fx.globalAlpha = (1 - k) * p.a;
      fx.drawImage(SPR.spark, p.x * DPR - sz / 2, p.y * DPR - sz / 2, sz, sz);
    }
    fx.globalAlpha = 1; fx.globalCompositeOperation = "source-over";
  }

  function stepBurst(dt) {
    if (!burstP.length) return;
    for (var i = burstP.length - 1; i >= 0; i--) {
      var p = burstP[i];
      p.life += dt;
      if (p.life < 0) continue;
      var k = p.life / p.max;
      if (k >= 1) { burstP.splice(i, 1); continue; }
      var e = k * k, r = p.r0 + e * p.spread, sc = p.s0 + e * p.s1;
      var x = p.cx + Math.cos(p.ang) * r, y = p.cy + Math.sin(p.ang) * r + e * 60;
      p.rot += p.vr * dt;
      fx.globalAlpha = k < .15 ? k / .15 : Math.max(0, 1 - (k - .55) / .45);
      if (p.spark) {
        fx.globalCompositeOperation = "lighter";
        var sz = 14 * sc * DPR;
        fx.setTransform(1, 0, 0, 1, 0, 0);
        fx.drawImage(SPR.spark, x * DPR - sz / 2, y * DPR - sz / 2, sz, sz);
        fx.globalCompositeOperation = "source-over";
      } else {
        var c = Math.cos(p.rot), s = Math.sin(p.rot), fl = Math.cos(p.life * p.flip);
        fx.setTransform(c * sc * fl, s * sc * fl, -s * sc, c * sc, x * DPR, y * DPR);
        fx.drawImage(p.spr, -p.spr.width / 2, -p.spr.height / 2);
      }
    }
    fx.setTransform(1, 0, 0, 1, 0, 0); fx.globalAlpha = 1;
  }

  function stepGlints(dt) {
    if (!glints.length) return;
    fx.globalCompositeOperation = "lighter";
    for (var i = glints.length - 1; i >= 0; i--) {
      var g = glints[i];
      g.life += dt;
      if (g.life < 0) continue;
      var k = g.life / g.max;
      if (k >= 1) { glints.splice(i, 1); continue; }
      var a = Math.sin(k * Math.PI), sz = g.size * (.4 + a * .8) * DPR;
      fx.globalAlpha = a * .9;
      fx.setTransform(Math.cos(g.rot), Math.sin(g.rot), -Math.sin(g.rot), Math.cos(g.rot), g.x * DPR, g.y * DPR);
      fx.drawImage(SPR.glint, -sz / 2, -sz / 2, sz, sz);
    }
    fx.setTransform(1, 0, 0, 1, 0, 0); fx.globalAlpha = 1; fx.globalCompositeOperation = "source-over";
  }

  /* ── public API ── */
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    var d = Math.min(window.devicePixelRatio || 1, LITE ? 1.25 : 1.75);
    var rebuild = d !== DPR || !SPR.rice;
    DPR = d;
    [back, front].forEach(function (c) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); });
    if (rebuild) buildSprites();
    if (themeCfg) { ambient.forEach(function (m) { if (m.x > W) m.x = rnd(0, W); if (m.y > H) m.y = rnd(0, H); }); }
  }

  FX.init = function () {
    back = document.getElementById("fx-back"); front = document.getElementById("fx-front");
    if (!back || !front || !back.getContext) return false;
    bx = back.getContext("2d"); fx = front.getContext("2d");
    resize();
    FX.setTheme("ember");
    var rt;
    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(resize, 120); });
    window.addEventListener("scroll", function () { var y = window.scrollY; scrollDelta += y - scrollY0; scrollY0 = y; }, { passive: true });
    document.addEventListener("visibilitychange", function () { if (document.hidden) running = false; else start(); });
    window.addEventListener("pointermove", function (e) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; }, { passive: true });
    window.addEventListener("pointerdown", function (e) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; }, { passive: true });
    window.addEventListener("pointerup", function (e) { if (e.pointerType !== "mouse") pointer.active = false; }, { passive: true });
    document.addEventListener("pointerleave", function () { pointer.active = false; });
    start();
    return true;
  };

  FX.setTheme = function (name) {
    if (!THEMES[name] || (name === theme && themeCfg)) return;
    theme = name; themeCfg = THEMES[name];
    ambient.forEach(function (m) { m.a = 0; });
    seedAmbient();
  };
  FX.setLedges = function (fn) { ledgeFn = fn; };
  FX.setTilt = function (gx) { tiltX = gx; };
  FX.quality = function () { return quality; };

  /* talambralu: rice (and a few flowers) poured over an area */
  FX.shower = function (area) {
    var n = Math.round((REDUCED ? 90 : 420) * quality);
    var x0 = Math.max(0, area.left - 20), x1 = Math.min(W, area.right + 20);
    var span = REDUCED ? 1.8 : 1.1;
    for (var i = 0; i < n; i++) {
      var flower = Math.random() < .07;
      var p = {
        x: rnd(x0, x1), y: rnd(-120, -10), vx: rnd(-40, 40), vy: REDUCED ? rnd(20, 60) : rnd(60, 260),
        rot: rnd(0, 6.28), vr: rnd(-7, 7), sc: flower ? rnd(.7, 1.05) : rnd(.6, 1.15), state: 0, life: 0, alpha: 1, bounces: 0, seed: (Math.random() * 1e6) | 0,
        delay: Math.pow(Math.random(), 1.4) * span, ph: rnd(0, 6.28), flut: rnd(2, 4)
      };
      if (flower) { p.spr = Math.random() < .5 ? SPR.marigold : (Math.random() < .5 ? SPR.jasmine : SPR.rose); petals.push(p); }
      else { p.spr = SPR.rice[(Math.random() * SPR.rice.length) | 0]; rice.push(p); }
    }
    if (!REDUCED) {
      for (var g = 0; g < Math.round(26 * quality); g++) {
        glints.push({ x: rnd(area.left, area.right), y: rnd(area.top, area.bottom), size: rnd(14, 30), rot: rnd(0, 1), life: -rnd(.2, 1.6), max: rnd(.6, 1.1) });
      }
    }
    start();
  };

  /* opening: petals and light rushing toward the camera */
  FX.burst = function (cx, cy) {
    if (REDUCED) return;
    var n = Math.round(110 * quality), kinds = [SPR.marigold, SPR.marigold, SPR.rose, SPR.jasmine];
    for (var i = 0; i < n; i++) {
      var spark = Math.random() < .32;
      burstP.push({
        cx: cx + rnd(-30, 30), cy: cy + rnd(-40, 40), ang: rnd(0, 6.283), r0: rnd(0, 30), spread: rnd(Math.max(W, H) * .5, Math.max(W, H) * 1.1),
        s0: rnd(.3, .6), s1: spark ? rnd(1, 2.5) : rnd(2, 5.2), life: -rnd(0, .35), max: rnd(1.3, 2.2), rot: rnd(0, 6.28), vr: rnd(-3, 3),
        flip: rnd(3, 7), spark: spark, spr: kinds[(Math.random() * kinds.length) | 0]
      });
    }
    start();
  };

  /* journey: marigold petals sweeping across on a breeze */
  FX.sweep = function (count) {
    if (REDUCED) return;
    var n = Math.round((count || 24) * quality);
    for (var i = 0; i < n; i++) {
      petals.push({
        x: rnd(-160, -20), y: rnd(H * .1, H * .9), vx: rnd(260, 520), vy: rnd(-40, 30), rot: rnd(0, 6.28), vr: rnd(-4, 4), sc: rnd(.8, 1.5),
        state: 0, life: 0, alpha: 1, bounces: 9, delay: rnd(0, 1.2), ph: rnd(0, 6.28), flut: rnd(3, 6),
        spr: Math.random() < .75 ? SPR.marigold : SPR.rose, wind: true
      });
    }
    start();
  };

  /* lamp: sparks rising from a flame */
  FX.sparks = function (x, y, n) {
    if (REDUCED) return;
    n = Math.round((n || 16) * quality);
    for (var i = 0; i < n; i++) {
      sparks.push({ x: x + rnd(-4, 4), y: y + rnd(-4, 4), vx: rnd(-40, 40), vy: -rnd(50, 170), g: -rnd(10, 40), life: 0, max: rnd(.6, 1.4), size: rnd(4, 10), a: rnd(.6, 1), ph: rnd(0, 6) });
    }
    start();
  };

  /* finale: petals lifting away from the closing words */
  FX.drift = function (rect, n) {
    if (REDUCED) return;
    n = Math.round((n || 40) * quality);
    for (var i = 0; i < n; i++) {
      petals.push({
        x: rnd(rect.left, rect.right), y: rnd(rect.top, rect.bottom), vx: rnd(-50, 50), vy: -rnd(30, 90), rot: rnd(0, 6.28), vr: rnd(-2, 2), sc: rnd(.7, 1.3),
        state: 0, life: 0, alpha: 1, bounces: 9, delay: rnd(0, 1.4), ph: rnd(0, 6.28), flut: rnd(1.5, 3),
        spr: Math.random() < .5 ? SPR.jasmine : SPR.marigold, lift: true
      });
    }
    start();
  };
})();
