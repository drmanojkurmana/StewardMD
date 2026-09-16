/* StewardMD — MaiK Thinking Orbs (window.ThinkingOrbs).
 * Dotted 3D thought-orb loading indicators for AI & agent workflows.
 * Inspired by Jakub Antalik's thinking-orbs (MIT License).
 * Nine hand-tuned mathematical animated states rendered on plain 2D canvas:
 *   - 'searching'  (globe): scan meridian sweeps a dotted globe — Web Search / Knowledge Scout
 *   - 'solving'    (rubik): 3D bands scramble and snap back solved — Clinical Problem Solver
 *   - 'connecting' (web):   constellation network wires itself with pulsing signals — Neural Retrieval / Agent Think
 *   - 'working'    (orbits): particles drift on tilted orbital planes — Active Agent Operations
 *   - 'composing'  (ribbon): undulating multi-band sash rides a great circle — Answer Drafting / Synthesis
 *   - 'weaving'    (braid):  three helical strands plait around a ghost sphere — Evidence Weaving
 *   - 'listening'  (wave):   dual waveforms roll through concentric rings — Query & Voice Ingestion
 *   - 'shaping'    (morph):  dotted outline morphs circle → triangle → square — Diagnostic Shaping
 *   - 'breathing'  (ring):   living organic breathing ring — Contemplation & Reflection
 *
 * No external dependencies. High-DPI retina rendering, auto dark/light sync,
 * and automatic rAF pausing when offscreen or sheet closed.
 */
(function () {
  "use strict";

  var GOLDEN = Math.PI * (3 - Math.sqrt(5));

  function hashD(a, b) {
    var h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return h - Math.floor(h);
  }

  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    var a = hashD(xi, yi);
    var b = hashD(xi + 1, yi);
    var c = hashD(xi, yi + 1);
    var d = hashD(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  function fibDir(i, n) {
    var y = 1 - (2 * (i + 0.5)) / n;
    var rad = Math.sqrt(Math.max(0, 1 - y * y));
    var a = i * GOLDEN;
    return [rad * Math.cos(a), y, rad * Math.sin(a)];
  }

  function angleDelta(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }

  function lerp(a, b, f) { return a + (b - a) * f; }
  function frac(x) { return x - Math.floor(x); }

  function makeProj(yaw, tilt, cx, cy, scale) {
    var st = Math.sin(tilt), ct = Math.cos(tilt);
    var sy = Math.sin(yaw), cyw = Math.cos(yaw);
    return function (x, y, z) {
      var x1 = x * cyw + z * sy;
      var z1 = -x * sy + z * cyw;
      var y1 = y * ct - z1 * st;
      var z2 = y * st + z1 * ct;
      return [cx + x1 * scale, cy - y1 * scale, z2];
    };
  }

  function radiusScale(size, pow) {
    return Math.pow(size / 300, pow != null ? pow : 0.6);
  }

  function finalizeFrame(dots, lines, rMin) {
    rMin = rMin != null ? rMin : 0.3;
    var visible = [];
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      var alpha = d.a != null ? d.a : 1;
      if (alpha < 0.02) continue;
      d.r = Math.max(rMin, d.r);
      visible.push(d);
    }
    visible.sort(function (a, b) { return a.z - b.z; });
    var visLines = [];
    if (lines) {
      for (var j = 0; j < lines.length; j++) {
        var l = lines[j];
        if ((l.a != null ? l.a : 1) >= 0.02) visLines.push(l);
      }
    }
    return { dots: visible, lines: visLines };
  }

  function paintLines(ctx, lines, dark, tint) {
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var alpha = l.a != null ? l.a : 1;
      var w = Math.min(1, Math.max(0, l.white));
      var g = Math.round((dark ? 1 - w : w) * 255);
      if (tint) {
        var r = Math.round(g * 0.45 + tint[0] * 0.55);
        var gr = Math.round(g * 0.45 + tint[1] * 0.55);
        var b = Math.round(g * 0.45 + tint[2] * 0.55);
        ctx.strokeStyle = "rgba(" + r + "," + gr + "," + b + "," + alpha + ")";
      } else {
        ctx.strokeStyle = "rgba(" + g + "," + g + "," + g + "," + alpha + ")";
      }
      ctx.lineWidth = l.w;
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
    }
  }

  function paintDots(ctx, dots, dark, tint) {
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      var alpha = d.a != null ? d.a : 1;
      var w = Math.min(1, Math.max(0, d.white));
      var g = Math.round((dark ? 1 - w : w) * 255);
      if (tint) {
        var r = Math.round(g * 0.4 + tint[0] * 0.6);
        var gr = Math.round(g * 0.4 + tint[1] * 0.6);
        var b = Math.round(g * 0.4 + tint[2] * 0.6);
        ctx.fillStyle = "rgba(" + r + "," + gr + "," + b + "," + alpha + ")";
      } else {
        ctx.fillStyle = "rgba(" + g + "," + g + "," + g + "," + alpha + ")";
      }
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function paintFrame(ctx, frame, dark, tint) {
    if (frame.lines && frame.lines.length) paintLines(ctx, frame.lines, dark, tint);
    paintDots(ctx, frame.dots, dark, tint);
  }

  // ── Mode Geometries ────────────────────────────────────────────────────────
  function frameOrbits(size, t, o) {
    var cx = size / 2, cy = size / 2, R = (size / 2) * 0.82;
    var pt = makeProj(t * 0.12, 0.3, cx, cy, 1);
    var rs = radiusScale(size, o.rsPow || 0.6);
    var dots = [];
    var orbitN = o.orbitN != null ? o.orbitN : 10;
    var ghostN = o.ghostN != null ? o.ghostN : 36;
    var particles = o.particles != null ? o.particles : 3;
    for (var orb = 0; orb < orbitN; orb++) {
      var h1 = hashD(orb, 1.7), h2 = hashD(orb, 5.2), h3 = hashD(orb, 8.9);
      var ro = R * (0.45 + 0.52 * h1);
      var th = h1 * 2 * Math.PI;
      var phi = Math.acos(2 * h2 - 1);
      var nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
      var ux = -ny, uy = nx, uz = 0;
      var ul = Math.max(1e-6, Math.sqrt(ux * ux + uy * uy));
      ux /= ul; uy /= ul;
      var vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      var speed = (0.25 + 0.55 * h3) * (h3 > 0.5 ? 1 : -1);
      for (var k = 0; k < ghostN; k++) {
        var a = (k / ghostN) * 2 * Math.PI;
        var p0 = pt((ux * Math.cos(a) + vx * Math.sin(a)) * ro, (uy * Math.cos(a) + vy * Math.sin(a)) * ro, (uz * Math.cos(a) + vz * Math.sin(a)) * ro);
        var depth0 = (p0[2] / ro + 1) / 2;
        dots.push({ x: p0[0], y: p0[1], z: p0[2], r: (o.ghostR || 0.9) * rs, white: 0.72, a: (o.ghostA || 0.5) * (0.4 + 0.6 * depth0) });
      }
      for (var m = 0; m < particles; m++) {
        var a2 = t * speed + (m / particles) * 2 * Math.PI + h2 * 6;
        var p1 = pt((ux * Math.cos(a2) + vx * Math.sin(a2)) * ro, (uy * Math.cos(a2) + vy * Math.sin(a2)) * ro, (uz * Math.cos(a2) + vz * Math.sin(a2)) * ro);
        var depth1 = (p1[2] / ro + 1) / 2;
        dots.push({ x: p1[0], y: p1[1], z: p1[2], r: ((o.partR || 1.2) + (o.partRDepth || 1.6) * depth1) * rs, white: 0.3 - 0.22 * depth1 });
      }
    }
    return finalizeFrame(dots, [], o.rMin);
  }

  function frameGlobe(size, t, o) {
    var spin = 0.5, cx = size / 2, cy = size / 2, radius = (size / 2) * 0.82;
    var tilt = 0.4 + 0.06 * Math.sin(t * 0.35);
    var pt = makeProj(t * spin, tilt, cx, cy, radius);
    var scan = t * (spin + (1.7 - spin) * (o.scanMul != null ? o.scanMul : 1));
    var rs = radiusScale(size, o.rsPow || 0.6);
    var dimBase = o.dimBase != null ? o.dimBase : 1;
    var dots = [];
    var latRings = o.latRings != null ? o.latRings : 15, lonDensity = o.lonDensity != null ? o.lonDensity : 38;
    for (var li = 0; li <= latRings; li++) {
      var lat = -Math.PI / 2 + (li / latRings) * Math.PI;
      var cosLat = Math.cos(lat), sinLat = Math.sin(lat);
      var lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
      for (var lj = 0; lj < lonCount; lj++) {
        var lon = (lj / lonCount) * 2 * Math.PI;
        var p = pt(cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon));
        var depth = (p[2] + 1) / 2;
        var d = angleDelta(lon + t * spin, scan);
        var boost = Math.exp(-(d * d) / 0.18) * Math.max(0, p[2]);
        dots.push({
          x: p[0], y: p[1], z: p[2],
          r: ((o.rBase || 0.6) + (o.rDepth || 1.7) * depth + (o.rBoost || 1) * boost) * rs,
          white: (o.inkFar || 0.62) - (o.inkSpan || 0.54) * depth,
          a: dimBase + (1 - dimBase) * Math.min(1, boost)
        });
      }
    }
    return finalizeFrame(dots, [], o.rMin);
  }

  function solveCycle(time, count, slotDur, rest) {
    var cyc = 2 * count * slotDur + rest;
    var tc = time % cyc;
    var amount = new Array(count);
    for (var i = 0; i < count; i++) amount[i] = 0;
    var active = -1;
    if (tc < 2 * count * slotDur) {
      var slot = Math.floor(tc / slotDur);
      var p = (tc - slot * slotDur) / slotDur;
      var cl = Math.min(1, p / 0.7);
      var ep = 1 - Math.pow(1 - cl, 3);
      if (slot < count) {
        for (var i1 = 0; i1 < slot; i1++) amount[i1] = 1;
        amount[slot] = ep; active = slot;
      } else {
        var u = 2 * count - 1 - slot;
        for (var i2 = 0; i2 < u; i2++) amount[i2] = 1;
        amount[u] = 1 - ep; active = u;
      }
    }
    return { amount: amount, active: active };
  }

  function makeMoves(count) {
    var moves = [];
    for (var i = 0; i < count; i++) {
      var axis = Math.min(2, Math.floor(hashD(i, 2.3) * 3));
      var lo = -1.0 + 0.5 * Math.min(3, Math.floor(hashD(i, 5.9) * 4));
      var dir = hashD(i, 7.7) < 0.5 ? 1 : -1;
      moves.push({ axis: axis, lo: lo, hi: lo + 0.5, ang: (dir * Math.PI) / 2 });
    }
    return moves;
  }

  function applyMoves(pt3, moves, sc) {
    var x = pt3[0], y = pt3[1], z = pt3[2];
    var inActive = false;
    for (var i = 0; i < moves.length; i++) {
      if (sc.amount[i] <= 0) continue;
      var mv = moves[i];
      var coord = mv.axis === 0 ? x : mv.axis === 1 ? y : z;
      if (coord < mv.lo || coord >= mv.hi) continue;
      if (i === sc.active) inActive = true;
      var a = mv.ang * sc.amount[i];
      var ca = Math.cos(a), sa = Math.sin(a);
      if (mv.axis === 0) { var y2 = y * ca - z * sa; z = y * sa + z * ca; y = y2; }
      else if (mv.axis === 1) { var x2 = x * ca + z * sa; z = -x * sa + z * ca; x = x2; }
      else { var x3 = x * ca - y * sa; y = x * sa + y * ca; x = x3; }
    }
    return [x, y, z, inActive];
  }

  function frameRubik(size, t, o) {
    var cx = size / 2, cy = size / 2, R = (size / 2) * 0.82;
    var pt = makeProj(t * 0.55, 0.35 + 0.1 * Math.sin(t * 0.9), cx, cy, R);
    var rs = radiusScale(size, o.rsPow || 0.6);
    var moveCount = o.moveCount != null ? o.moveCount : 12;
    var moves = makeMoves(moveCount);
    var sc = solveCycle(t, moveCount, 0.42, 1.2);
    var dots = [];
    var latRings = o.latRings != null ? o.latRings : 14, lonDensity = o.lonDensity != null ? o.lonDensity : 36;
    for (var li = 0; li <= latRings; li++) {
      var lat = -Math.PI / 2 + (li / latRings) * Math.PI;
      var cosLat = Math.cos(lat), sinLat = Math.sin(lat);
      var lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
      for (var lj = 0; lj < lonCount; lj++) {
        var lon = (lj / lonCount) * 2 * Math.PI;
        var moved = applyMoves([cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon)], moves, sc);
        var inActive = moved[3];
        var p = pt(moved[0], moved[1], moved[2]);
        var depth = (p[2] + 1) / 2;
        dots.push({
          x: p[0], y: p[1], z: p[2],
          r: ((o.rBase || 0.6) + (o.rDepth || 1.7) * depth + (inActive ? (o.rActive || 0.3) : 0)) * rs,
          white: (o.inkFar || 0.62) - (o.inkSpan || 0.54) * depth - (inActive ? 0.14 : 0)
        });
      }
    }
    return finalizeFrame(dots, [], o.rMin);
  }

  function frameWave(size, t, o) {
    var cx = size / 2, cy = size / 2, R = (size / 2) * 0.874;
    var pt = makeProj(t * 0.18, 0.38, cx, cy, 1);
    var rs = radiusScale(size, o.rsPow || 0.6);
    var dots = [];
    var rings = o.rings != null ? o.rings : 14, lonDensity = o.lonDensity != null ? o.lonDensity : 36;
    for (var ri = 0; ri <= rings; ri++) {
      var lat = -Math.PI / 2 + (ri / rings) * Math.PI;
      var cosLat = Math.cos(lat), sinLat = Math.sin(lat);
      var w = 0.62 * Math.sin(t * 2.1 - ri * 0.52) + 0.38 * Math.sin(t * 1.27 + ri * 0.83);
      var rr = R * (0.88 + 0.105 * w);
      var lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
      for (var lj = 0; lj < lonCount; lj++) {
        var lon = (lj / lonCount) * 2 * Math.PI;
        var p = pt(cosLat * Math.cos(lon) * rr, sinLat * rr, cosLat * Math.sin(lon) * rr);
        var depth = (p[2] / R + 1) / 2;
        var crest = Math.max(0, w);
        dots.push({
          x: p[0], y: p[1], z: p[2],
          r: ((o.rBase || 0.6) + (o.rDepth || 1.7) * depth) * (1 + 0.4 * crest) * rs,
          white: 0.66 - 0.56 * depth - 0.1 * crest
        });
      }
    }
    return finalizeFrame(dots, [], o.rMin);
  }

  function frameWeb(size, t, o) {
    var cx = size / 2, cy = size / 2, R = (size / 2) * 0.8 * (o.spread != null ? o.spread : 1);
    var pt = makeProj(t * 0.12, 0.32, cx, cy, R);
    var rs = radiusScale(size, o.rsPow || 0.6);
    var nodeN = o.nodeN != null ? o.nodeN : 24;
    var thr = o.thr != null ? o.thr : 0.72;
    var nodeR = o.nodeR != null ? o.nodeR : 1.4;
    var nodeRDepth = o.nodeRDepth != null ? o.nodeRDepth : 1.8;
    var nodes = [];
    for (var i = 0; i < nodeN; i++) {
      var d = fibDir(i, nodeN);
      var x = d[0] + 0.3 * (vnoise(i * 0.31 + 9, t * 0.24) - 0.5) * 2;
      var y = d[1] + 0.3 * (vnoise(i * 0.53 + 27, t * 0.21) - 0.5) * 2;
      var z = d[2] + 0.3 * (vnoise(i * 0.77 + 55, t * 0.27) - 0.5) * 2;
      var l = Math.sqrt(x * x + y * y + z * z);
      nodes.push([x / l, y / l, z / l]);
    }
    var lines = [], dots = [];
    for (var i1 = 0; i1 < nodeN; i1++) {
      for (var j = i1 + 1; j < nodeN; j++) {
        var dx = nodes[i1][0] - nodes[j][0], dy = nodes[i1][1] - nodes[j][1], dz = nodes[i1][2] - nodes[j][2];
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist >= thr) continue;
        var p1 = pt(nodes[i1][0], nodes[i1][0 + 1], nodes[i1][2]);
        var p2 = pt(nodes[j][0], nodes[j][1], nodes[j][2]);
        var depth = ((p1[2] + p2[2]) / 2 + 1) / 2;
        lines.push({
          x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
          white: 0.42, a: (1 - dist / thr) * (0.3 + 0.55 * depth),
          w: Math.max(0.6, (o.lineW != null ? o.lineW : 0.8) * rs)
        });
      }
    }
    for (var i2 = 0; i2 < nodeN; i2++) {
      var pn = pt(nodes[i2][0], nodes[i2][1], nodes[i2][2]);
      var depthN = (pn[2] + 1) / 2;
      var pulse = 1 + 0.25 * Math.sin(t * 1.4 + i2 * 2.7);
      dots.push({ x: pn[0], y: pn[1], z: pn[2], r: (nodeR + nodeRDepth * depthN) * pulse * rs, white: 0.55 - 0.45 * depthN });
    }
    var signals = o.signals != null ? o.signals : 4;
    for (var s = 0; s < signals; s++) {
      var seg = Math.floor(t * 0.55 + s * 7.31);
      var sa = Math.floor(hashD(seg, s * 3.1 + 1.7) * nodeN);
      var sb = Math.floor(hashD(seg, s * 5.7 + 4.2) * nodeN);
      if (sa === sb) continue;
      var f = frac(t * 0.55 + s * 7.31);
      var sx = lerp(nodes[sa][0], nodes[sb][0], f), sy = lerp(nodes[sa][1], nodes[sb][1], f), sz = lerp(nodes[sa][2], nodes[sb][2], f);
      var sl = Math.max(1e-6, Math.sqrt(sx * sx + sy * sy + sz * sz));
      var ps = pt(sx / sl, sy / sl, sz / sl);
      var depthS = (ps[2] + 1) / 2;
      dots.push({ x: ps[0], y: ps[1], z: ps[2], r: (nodeR * 1.5 + nodeRDepth * depthS) * rs, white: 0.05, a: 0.5 + 0.5 * depthS });
    }
    return finalizeFrame(dots, lines, o.rMin);
  }

  function frameBraid(size, t, o) {
    var cx = size / 2, cy = size / 2, R = (size / 2) * 0.76;
    var pt = makeProj(t * 0.4, 0.3, cx, cy, 1);
    var rs = radiusScale(size, o.rsPow || 0.6);
    var dots = [];
    var ghostN = o.ghostN != null ? o.ghostN : 100;
    for (var i = 0; i < ghostN; i++) {
      var d = fibDir(i, ghostN);
      var pg = pt(d[0] * R, d[1] * R, d[2] * R);
      var depthG = (pg[2] / R + 1) / 2;
      dots.push({ x: pg[0], y: pg[1], z: pg[2], r: 0.8 * rs, white: 0.78, a: 0.1 + 0.22 * depthG });
    }
    var strandN = o.strandN != null ? o.strandN : 44, turns = o.turns != null ? o.turns : 3;
    for (var s = 0; s < 3; s++) {
      var phase = (s / 3) * 2 * Math.PI;
      for (var i1 = 0; i1 < strandN; i1++) {
        var u = (frac(i1 / strandN + t * 0.045) * 2 - 1) * 0.96;
        var surf = Math.sqrt(Math.max(0, 1 - u * u));
        var endFade = Math.min(1, (1 - Math.abs(u)) / 0.1);
        var a = u * Math.PI * turns + phase;
        var weave = 1 + 0.075 * Math.sin(u * Math.PI * turns * 2 + phase * 2 + t * 0.8);
        var rr = surf * R * weave;
        var p = pt(Math.cos(a) * rr, u * R * weave, Math.sin(a) * rr);
        var depth = (p[2] / R + 1) / 2;
        dots.push({
          x: p[0], y: p[1], z: p[2],
          r: ((o.rBase || 1.2) + (o.rDepth || 1.8) * depth) * rs,
          white: 0.55 - 0.45 * depth,
          a: endFade * (0.45 + 0.55 * depth)
        });
      }
    }
    return finalizeFrame(dots, [], o.rMin);
  }

  function frameRibbon(size, t, o) {
    var cx = size / 2, cy = size / 2, R = (size / 2) * 0.78;
    var spin = o.spin != null ? o.spin : 1, camTilt = 0.3;
    var pt = makeProj(t * 0.1 * spin, camTilt, cx, cy, 1);
    var rs = radiusScale(size, o.rsPow || 0.6);
    var dots = [];
    var ghostN = o.ghostN != null ? o.ghostN : (o.faceOn ? 0 : 100);
    for (var i = 0; i < ghostN; i++) {
      var d = fibDir(i, ghostN);
      var pg = pt(d[0] * R, d[1] * R, d[2] * R);
      var depthG = (pg[2] / R + 1) / 2;
      dots.push({ x: pg[0], y: pg[1], z: pg[2], r: 0.8 * rs, white: 0.78, a: 0.1 + 0.22 * depthG });
    }
    var ya = t * 0.24 * spin;
    var ta = o.faceOn ? -camTilt : 0.55 + 0.3 * Math.sin(t * 0.18) * spin;
    var ux = Math.cos(ya), uy = 0, uz = Math.sin(ya);
    var vx = -uz * Math.sin(ta), vy = Math.cos(ta), vz = ux * Math.sin(ta);
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var wobAmp = 0.23 * (o.wobMul != null ? o.wobMul : 1);
    var baseR = o.faceOn ? R / (1 + 0.85 * wobAmp) : R;
    var baseLanes = o.lanes != null ? o.lanes : 5, segs = o.segs != null ? o.segs : 72;
    var lanes = Math.max(1, Math.round(baseLanes * (o.bandMul != null ? o.bandMul : 1)));
    for (var w = 0; w < lanes; w++) {
      var laneOff = (w - (lanes - 1) / 2) * 0.075;
      var edge = Math.abs(w - (lanes - 1) / 2) / Math.max(1, (lanes - 1) / 2);
      for (var k = 0; k < segs; k++) {
        var a = (k / segs) * 2 * Math.PI;
        var wob = (0.16 * Math.sin(a * 3 - t * 1.7 + w * 0.22) + 0.07 * Math.sin(a * 5 + t * 1.1)) * (o.wobMul != null ? o.wobMul : 1);
        var radial = o.faceOn ? 1 + wob : 1;
        var off = o.faceOn ? laneOff : laneOff + wob;
        var x = ux * Math.cos(a) + vx * Math.sin(a) + nx * off;
        var y = uy * Math.cos(a) + vy * Math.sin(a) + ny * off;
        var z = uz * Math.cos(a) + vz * Math.sin(a) + nz * off;
        var l = Math.sqrt(x * x + y * y + z * z);
        var rr = baseR * radial;
        var p = pt((x / l) * rr, (y / l) * rr, (z / l) * rr);
        var depth = (p[2] / R + 1) / 2;
        dots.push({
          x: p[0], y: p[1], z: p[2],
          r: ((o.rBase || 1.1) + (o.rDepth || 1.7) * depth) * (1 - 0.25 * edge) * rs,
          white: 0.52 - 0.44 * depth + 0.18 * edge,
          a: 0.4 + 0.6 * depth
        });
      }
    }
    return finalizeFrame(dots, [], o.rMin);
  }

  function polyPath(verts) {
    var V = verts.length, L = [];
    var total = 0;
    for (var i = 0; i < V; i++) {
      var a = verts[i], b = verts[(i + 1) % V];
      var l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      L.push(l); total += l;
    }
    return function (f) {
      var target = f * total, i = 0;
      while (target > L[i] && i < V - 1) { target -= L[i]; i++; }
      var a2 = verts[i], b2 = verts[(i + 1) % V];
      var ff = L[i] ? Math.min(1, target / L[i]) : 0;
      return [a2[0] + (b2[0] - a2[0]) * ff, a2[1] + (b2[1] - a2[1]) * ff];
    };
  }

  var CIRCLE = function (f) {
    var a = -Math.PI / 2 + f * 2 * Math.PI;
    return [Math.cos(a) * 0.24, Math.sin(a) * 0.24];
  };
  var TRIANGLE = polyPath([[0.0, -0.26], [0.24, 0.16], [-0.24, 0.16]]);
  var SQUARE = polyPath([[0, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2], [-0.2, -0.2]]);
  var CYCLE = [CIRCLE, TRIANGLE, SQUARE];
  var HOLD = 1.4, MORPH = 0.9, SEG = HOLD + MORPH;

  function frameMorph(size, t, o) {
    var K = CYCLE.length, tc = t % (SEG * K), k = Math.floor(tc / SEG), local = tc - k * SEG;
    var m = local > HOLD ? (function (x) { return x * x * (3 - 2 * x); })((local - HOLD) / MORPH) : 0;
    var sprd = o.spread != null ? o.spread : 1;
    var pA = CYCLE[k], pB = CYCLE[(k + 1) % K];
    var M = 120, pts = [];
    for (var i = 0; i < M; i++) {
      var f = i / M, a = pA(f), b = pB(f);
      pts.push([(a[0] + (b[0] - a[0]) * m) * sprd, (a[1] + (b[1] - a[1]) * m) * sprd]);
    }
    var L = [];
    var total = 0;
    for (var i1 = 0; i1 < M; i1++) {
      var a1 = pts[i1], b1 = pts[(i1 + 1) % M];
      var l = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
      L.push(l); total += l;
    }
    var n = Math.max(6, Math.round(30 * (o.iconD != null ? o.iconD : 1)));
    var re = (o.rDot != null ? o.rDot : 0.021) * 1.35 * sprd;
    var pulse = 1 + 0.02 * Math.sin(local * 3.1);
    var dots = [], c2 = size / 2;
    var seg = 0, acc = 0;
    for (var k2 = 0; k2 < n; k2++) {
      var target = (k2 / n) * total;
      while (acc + L[seg] < target && seg < M - 1) { acc += L[seg]; seg++; }
      var a2 = pts[seg], b2 = pts[(seg + 1) % M];
      var f2 = L[seg] ? Math.min(1, (target - acc) / L[seg]) : 0;
      var px = (a2[0] + (b2[0] - a2[0]) * f2) * pulse;
      var py = (a2[1] + (b2[1] - a2[1]) * f2) * pulse;
      dots.push({ x: c2 + px * size, y: c2 + py * size, z: 0, r: Math.max(0.35, re * size), white: 0.1 });
    }
    return finalizeFrame(dots, [], o.rMin);
  }

  var MODES = {
    orbits: frameOrbits,
    globe: frameGlobe,
    rubik: frameRubik,
    wave: frameWave,
    web: frameWeb,
    braid: frameBraid,
    ribbon: frameRibbon,
    ring: function (s, t, o) { return frameRibbon(s, t, Object.assign({}, o, { faceOn: 1, ghostN: 0 })); },
    morph: frameMorph
  };

  var STATE_TO_MODE = {
    working: 'orbits',
    searching: 'globe',
    solving: 'rubik',
    listening: 'wave',
    connecting: 'web',
    weaving: 'braid',
    composing: 'ribbon',
    breathing: 'ring',
    shaping: 'morph',
    // Aliases
    globe: 'globe',
    rubik: 'rubik',
    web: 'web',
    orbits: 'orbits',
    ribbon: 'ribbon',
    braid: 'braid',
    wave: 'wave',
    ring: 'ring',
    morph: 'morph'
  };

  var PRESET_SPEEDS = {
    orbits: 2.4,
    globe: 2.2,
    rubik: 1.9,
    wave: 4.1,
    web: 4.2,
    braid: 2.0,
    ribbon: 2.7,
    ring: 3.4,
    morph: 2.2
  };

  // ── Global Mount Registry ──────────────────────────────────────────────────
  var activeMounts = new Set();
  var globalDark = null;

  function isDocDark() {
    if (globalDark !== null) return globalDark;
    return document.body.classList.contains('dark') || document.body.classList.contains('v3-dark');
  }

  // ── Mount Instance ─────────────────────────────────────────────────────────
  function mountOrb(canvas, options) {
    if (!canvas) return null;
    options = options || {};
    var state = options.state || 'connecting';
    var size = options.size || (canvas.offsetWidth ? canvas.offsetWidth : (canvas.width ? Math.round(canvas.width / 2) : 32));
    var customSpeed = options.speed || 1;
    var tint = options.tint !== false ? (isDocDark() ? [45, 212, 191] : [14, 110, 99]) : null;

    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var running = false, rafId = 0, destroyed = false;
    var mode = STATE_TO_MODE[state] || 'globe';
    var speed = (PRESET_SPEEDS[mode] || 2) * customSpeed;

    function resize() {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    function renderAt(tSec) {
      ctx.clearRect(0, 0, size, size);
      var frameFn = MODES[mode] || frameGlobe;
      var dark = options.dark != null ? options.dark : isDocDark();
      var activeTint = options.tint !== false ? (dark ? [45, 212, 191] : [14, 110, 99]) : null;
      var frame = frameFn(size, tSec, options.opts || {});
      paintFrame(ctx, frame, dark, activeTint);
    }

    function loop() {
      if (!running || destroyed) return;
      var t = (performance.now() / 1000) * speed;
      renderAt(t);
      rafId = requestAnimationFrame(loop);
    }

    function start() {
      if (running || destroyed) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }

    // Single initial render
    renderAt(0.5);
    start();

    // IntersectionObserver to pause offscreen
    var io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(function (entries) {
        if (!entries || !entries[0]) return;
        if (entries[0].isIntersecting && !document.hidden) start();
        else stop();
      });
      io.observe(canvas);
    }

    var onVis = function () {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVis);

    var inst = {
      canvas: canvas,
      setState: function (newState) {
        state = newState;
        mode = STATE_TO_MODE[state] || 'globe';
        speed = (PRESET_SPEEDS[mode] || 2) * customSpeed;
        canvas.setAttribute('data-orb-state', state);
      },
      getState: function () { return state; },
      setDark: function (d) { options.dark = d; renderAt(performance.now() / 1000 * speed); },
      destroy: function () {
        destroyed = true;
        stop();
        if (io) { io.disconnect(); io = null; }
        document.removeEventListener('visibilitychange', onVis);
        activeMounts.delete(inst);
      }
    };

    activeMounts.add(inst);
    canvas._orbInstance = inst;
    canvas.setAttribute('data-orb-state', state);
    return inst;
  }

  // ── Stage & Clinical State Mapping ─────────────────────────────────────────
  var CLINICAL_AGENT_ORBS = ['solving', 'connecting', 'working', 'weaving', 'shaping'];
  var WEB_AGENT_ORBS = ['searching', 'weaving', 'connecting', 'composing'];

  function getStateForStage(stage, cls) {
    stage = String(stage || '').toLowerCase();
    cls = String(cls || '');
    if (cls.indexOf('webbusy') !== -1 || stage.indexOf('web') !== -1 || stage.indexOf('medical sources') !== -1) {
      if (stage.indexOf('synthesizing') !== -1 || stage.indexOf('evidence') !== -1) return 'weaving';
      if (stage.indexOf('finalizing') !== -1 || stage.indexOf('almost') !== -1) return 'composing';
      return 'searching';
    }
    if (stage.indexOf('searching stewardmd') !== -1 || stage.indexOf('knowledge') !== -1) {
      return 'connecting'; // constellation network wires itself
    }
    if (stage.indexOf('reviewing') !== -1 || stage.indexOf('evidence') !== -1) {
      return 'solving'; // rubik bands unscrambling/solving
    }
    if (stage.indexOf('composing') !== -1 || stage.indexOf('answer') !== -1) {
      return 'composing'; // ribbon undulating sash
    }
    if (stage.indexOf('finalizing') !== -1 || stage.indexOf('almost') !== -1) {
      return 'working'; // orbits particles
    }
    return CLINICAL_AGENT_ORBS[Math.floor(Math.random() * CLINICAL_AGENT_ORBS.length)];
  }

  // ── Multi-Orb HTML Builder for MaiK Buffer ─────────────────────────────────
  function getOrbClusterHTML(stage, cls) {
    var primaryState = getStateForStage(stage, cls);
    var isWeb = (cls && cls.indexOf('webbusy') !== -1) || (stage && stage.toLowerCase().indexOf('web') !== -1);
    var companions = isWeb ? ['weaving', 'connecting', 'composing'] : ['solving', 'searching', 'weaving'];
    // Filter out primary from companions
    companions = companions.filter(function (s) { return s !== primaryState; });
    while (companions.length < 2) companions.push('working');

    return '<div class="maik-orb-cluster" data-orb-cluster="1">' +
      '<div class="maik-orb-main" title="Active Thinking Orb: ' + primaryState + '">' +
        '<canvas class="maik-thinking-orb active-orb" data-orb-state="' + primaryState + '" data-orb-size="36" width="72" height="72" style="width:36px;height:36px;border-radius:50%;cursor:pointer;"></canvas>' +
      '</div>' +
      '<div class="maik-orb-satellites">' +
        '<canvas class="maik-thinking-orb sat-orb" data-orb-state="' + companions[0] + '" data-orb-size="20" width="40" height="40" style="width:20px;height:20px;border-radius:50%;cursor:pointer;" title="Agent: ' + companions[0] + '"></canvas>' +
        '<canvas class="maik-thinking-orb sat-orb" data-orb-state="' + companions[1] + '" data-orb-size="20" width="40" height="40" style="width:20px;height:20px;border-radius:50%;cursor:pointer;" title="Agent: ' + companions[1] + '"></canvas>' +
      '</div>' +
    '</div>';
  }

  // ── Auto-Mounting Scanner ──────────────────────────────────────────────────
  function mountAll(root) {
    root = root || document;
    var canvases = root.querySelectorAll('canvas.maik-thinking-orb');
    for (var i = 0; i < canvases.length; i++) {
      var cv = canvases[i];
      if (cv._orbInstance) continue;
      var state = cv.getAttribute('data-orb-state') || 'connecting';
      var size = parseInt(cv.getAttribute('data-orb-size') || '32', 10);
      var orb = mountOrb(cv, { state: state, size: size });
      (function (canvasEl, orbInst) {
        canvasEl.addEventListener('click', function (e) {
          e.stopPropagation();
          var states = ['searching', 'solving', 'connecting', 'working', 'composing', 'weaving', 'shaping'];
          var cur = orbInst.getState();
          var next = states[(states.indexOf(cur) + 1) % states.length];
          orbInst.setState(next);
        });
      })(cv, orb);
    }
  }

  // Auto-scan using MutationObserver so whenever MaiK buffer renders, it mounts instantly
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.addedNodes && m.addedNodes.length) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1) {
              if (n.classList && (n.classList.contains('maik-buffer') || n.classList.contains('maik-thinking-orb') || n.querySelector('canvas.maik-thinking-orb'))) {
                mountAll(n);
              }
            }
          }
        }
      }
    });
    // Start observing when DOM is ready
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        observer.observe(document.body, { childList: true, subtree: true });
        mountAll();
      });
    }
  }

  // Sync dark theme on body class changes
  var themeObserver = new MutationObserver(function () {
    var d = isDocDark();
    activeMounts.forEach(function (m) { try { m.setDark(d); } catch (e) {} });
  });
  if (document.body) {
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.ThinkingOrbs = {
    mount: mountOrb,
    mountAll: mountAll,
    getOrbClusterHTML: getOrbClusterHTML,
    getStateForStage: getStateForStage,
    MODES: Object.keys(MODES),
    setDark: function (d) {
      globalDark = d;
      activeMounts.forEach(function (m) { try { m.setDark(d); } catch (e) {} });
    }
  };
})();
