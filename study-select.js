/* Study select and shape (Phase 2): lasso move, resize, clipboard, draw-and-hold snapping, shapes tool, shape editing, handwriting to text stub.
   ES5, no deps. Loaded AFTER study-ink.js by prep-loader.js. Pure helpers load under node (module.exports).
   Shape strokes keep the Phase 1 record: {id,doc,page,tool:"shape",color,w,pts,gone,shape,fill}. pts is always the
   shape OUTLINE (page-relative 0..1), so the legacy eraser, lasso hit test and undo keep working unchanged.
   shape = {type:"line"|"circle"|"ellipse"|"rect"|"triangle"|"arrow", ...params}; fill = "none"|"25".
   Text (converted handwriting, Phase 4 absent) is {tool:"text",text,size,pts:[bbox frame]}; it renders on the
   page canvas and fits selection and eraser through its frame points. Strokes are never hard-deleted here. */
(function (G) {
  "use strict";
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function r4(n) { return Math.round(n * 10000) / 10000; }
  function copyShape(sh) {
    if (!sh) return null;
    var o = {}, k;
    for (k in sh) o[k] = sh[k];
    return o;
  }
  function cloneStroke(s) {
    if (!s) return s;
    var o = {}, k;
    for (k in s) { if (k !== "pts" && k !== "shape") o[k] = s[k]; }
    o.pts = (s.pts || []).map(function (p) { return [p[0], p[1], p[2] != null ? p[2] : 0.5]; });
    if (s.shape) o.shape = copyShape(s.shape);
    return o;
  }
  function bboxOf(pts) {
    if (!pts || !pts.length) return null;
    var x0 = 1, y0 = 1, x1 = 0, y1 = 0, i;
    for (i = 0; i < pts.length; i++) {
      if (pts[i][0] < x0) x0 = pts[i][0];
      if (pts[i][0] > x1) x1 = pts[i][0];
      if (pts[i][1] < y0) y0 = pts[i][1];
      if (pts[i][1] > y1) y1 = pts[i][1];
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  function selBBox(items) {
    var all = [];
    (items || []).forEach(function (s) { if (s && s.pts) all = all.concat(s.pts); });
    return bboxOf(all);
  }
  // ---- shape outline (stored pts for a fitted shape) ----
  function shapePts(sh) {
    if (!sh) return [];
    var out = [], i;
    var push = function (x, y) { out.push([r4(x), r4(y), 0.5]); };
    if (sh.type === "line") { var LI = 8, li; for (li = 0; li <= LI; li++) push(sh.x0 + (sh.x1 - sh.x0) * li / LI, sh.y0 + (sh.y1 - sh.y0) * li / LI); return out; }
    if (sh.type === "circle" || sh.type === "ellipse") {
      var N = 48;
      for (i = 0; i <= N; i++) { var a = i / N * Math.PI * 2; push(sh.cx + Math.cos(a) * sh.rx, sh.cy + Math.sin(a) * sh.ry); }
      return out;
    }
    if (sh.type === "rect") {
      var E = 8, k;
      for (k = 0; k <= E; k++) push(sh.x0 + (sh.x1 - sh.x0) * k / E, sh.y0);
      for (k = 1; k <= E; k++) push(sh.x1, sh.y0 + (sh.y1 - sh.y0) * k / E);
      for (k = 1; k <= E; k++) push(sh.x1 - (sh.x1 - sh.x0) * k / E, sh.y1);
      for (k = 1; k < E; k++) push(sh.x0, sh.y1 - (sh.y1 - sh.y0) * k / E);
      return out;
    }
    if (sh.type === "triangle") {
      var V = [[sh.x0, sh.y0], [sh.x1, sh.y1], [sh.x2, sh.y2]], M = 8, e, f;
      for (e = 0; e < 3; e++) {
        var A = V[e], B2 = V[(e + 1) % 3];
        for (f = 0; f <= M; f++) push(A[0] + (B2[0] - A[0]) * f / M, A[1] + (B2[1] - A[1]) * f / M);
      }
      return out;
    }
    if (sh.type === "arrow") {
      var SH = [[sh.x0, sh.y0], [sh.x1, sh.y1], [sh.bx1, sh.by1], [sh.x1, sh.y1], [sh.bx2, sh.by2]], SE = [8, 4, 4, 4], si, sj;
      for (si = 0; si < 4; si++) for (sj = 0; sj <= SE[si]; sj++) { var P = SH[si], Q = SH[si + 1]; if (si && !sj) continue; push(P[0] + (Q[0] - P[0]) * sj / SE[si], P[1] + (Q[1] - P[1]) * sj / SE[si]); }
      return out;
    }
    return out;
  }
  // Scale a stroke's pts and shape about (cx,cy): x scales by sx, y by sy; width scales with the mean factor.
  function scaleStroke(s, cx, cy, sx, sy) {
    var o = cloneStroke(s), wf = (sx + sy) / 2;
    o.pts = (s.pts || []).map(function (p) { return [r4(cx + (p[0] - cx) * sx), r4(cy + (p[1] - cy) * sy), p[2] != null ? p[2] : 0.5]; });
    if (s.shape) {
      var sh = copyShape(s.shape), keys = ["x0", "x1", "x2", "cx", "bx1", "bx2"], keysY = ["y0", "y1", "y2", "cy", "by1", "by2"], i;
      for (i = 0; i < keys.length; i++) if (sh[keys[i]] != null) sh[keys[i]] = r4(cx + (sh[keys[i]] - cx) * sx);
      for (i = 0; i < keysY.length; i++) if (sh[keysY[i]] != null) sh[keysY[i]] = r4(cy + (sh[keysY[i]] - cy) * sy);
      if (sh.rx != null) sh.rx = r4(Math.max(0.0005, sh.rx * Math.abs(sx)));
      if (sh.ry != null) sh.ry = r4(Math.max(0.0005, sh.ry * Math.abs(sy)));
      if (sh.type === "circle") sh.ry = sh.rx;
      o.shape = sh;
    }
    if (o.w != null) o.w = r4(Math.max(0.0004, o.w * Math.max(0.05, wf)));
    return o;
  }
  function translate(s, dx, dy) {
    var o = cloneStroke(s), ks = ["x0", "x1", "x2", "cx", "bx1", "bx2"], ksY = ["y0", "y1", "y2", "cy", "by1", "by2"], i;
    o.pts = (s.pts || []).map(function (p) { return [r4(p[0] + dx), r4(p[1] + dy), p[2] != null ? p[2] : 0.5]; });
    if (s.shape) {
      var sh = copyShape(s.shape);
      for (i = 0; i < ks.length; i++) if (sh[ks[i]] != null) sh[ks[i]] = r4(sh[ks[i]] + dx);
      for (i = 0; i < ksY.length; i++) if (sh[ksY[i]] != null) sh[ksY[i]] = r4(sh[ksY[i]] + dy);
      o.shape = sh;
    }
    return o;
  }
  // Rotate about (cx,cy); ratio = page H/W so 90+270 degree turns are rigid in pixels.
  function rotateStroke(s, deg, cx, cy, ratio) {
    var d = ((deg % 360) + 360) % 360, o = cloneStroke(s), v = ratio || 1;
    var rot = function (x, y) {
      var dx = x - cx, dy = y - cy, nx, ny;
      if (d === 0) { nx = x; ny = y; }
      else if (d === 90) { nx = cx + dy * v; ny = cy - dx / v; }
      else if (d === 180) { nx = cx - dx; ny = cy - dy; }
      else if (d === 270) { nx = cx - dy * v; ny = cy + dx / v; }
      else { var a = d * Math.PI / 180, rx = dx * Math.cos(a) - dy * v * Math.sin(a), ry = dx / v * Math.sin(a) + dy * Math.cos(a); nx = cx + rx; ny = cy + ry; }
      return [r4(nx), r4(ny)];
    };
    o.pts = (s.pts || []).map(function (p) { var q = rot(p[0], p[1]); return [q[0], q[1], p[2] != null ? p[2] : 0.5]; });
    if (s.shape) {
      var sh = copyShape(s.shape), ks = ["x0", "x1", "x2", "cx", "bx1", "bx2"], ksY = ["y0", "y1", "y2", "cy", "by1", "by2"], i;
      var PX = {}, PY = {};
      for (i = 0; i < ks.length; i++) PX[ks[i]] = sh[ks[i]];
      for (i = 0; i < ksY.length; i++) PY[ksY[i]] = sh[ksY[i]];
      for (i = 0; i < ks.length; i++) if (PX[ks[i]] != null && PY[ksY[i]] != null) { var q2 = rot(PX[ks[i]], PY[ksY[i]]); sh[ks[i]] = q2[0]; sh[ksY[i]] = q2[1]; }
      if (sh.rx != null && (d === 90 || d === 270)) { var t = sh.rx; sh.rx = r4(sh.ry / v * v); sh.ry = r4(t); }
      o.shape = sh;
    }
    return o;
  }
  // Keep every point inside the 0..1 page (whole-selection shift first, then per-point clamp).
  function clampStroke(s) {
    var b = bboxOf(s.pts); if (!b) return s;
    var dx = 0, dy = 0;
    if (b.x0 < 0) dx = -b.x0; if (b.x1 > 1) dx = 1 - b.x1;
    if (b.y0 < 0) dy = -b.y0; if (b.y1 > 1) dy = 1 - b.y1;
    var o = translate(s, dx, dy);
    o.pts = o.pts.map(function (p) { return [r4(clamp(p[0], 0, 1)), r4(clamp(p[1], 0, 1)), p[2]]; });
    if (o.shape) { var sh = copyShape(o.shape), ks = ["x0", "x1", "x2", "cx", "bx1", "bx2", "y0", "y1", "y2", "cy", "by1", "by2"], i; for (i = 0; i < ks.length; i++) if (sh[ks[i]] != null) sh[ks[i]] = r4(clamp(sh[ks[i]], 0, 1)); o.shape = sh; }
    return o;
  }

  /* ================= shape fitter (pure) =================
     Input pts: [[x,y,pressure?], ...] page-relative 0..1. Returns {type, ...params}
     or null when the stroke is not confidently that shape (handwriting stays ink).
     fitForced() never returns null for 3+ points: the Shapes tool snaps every stroke. */
  function cleanPts(pts) {
    var out = [], i;
    if (!pts || !pts.length) return out;
    for (i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p && typeof p[0] === "number" && typeof p[1] === "number" && !isNaN(p[0]) && !isNaN(p[1])) out.push([p[0], p[1], p[2] != null ? p[2] : 0.5]);
    }
    // drop consecutive duplicates (same spot)
    return out.filter(function (p, i) { return !i || Math.abs(p[0] - out[i - 1][0]) > 1e-6 || Math.abs(p[1] - out[i - 1][1]) > 1e-6; });
  }
  function smoothPts(pts) {
    var n = pts.length, out = [], i;
    if (n < 3) return pts.slice();
    for (i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) out.push(pts[i].slice());
      else out.push([(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4, pts[i][2]]);
    }
    return out;
  }
  function pathLenOf(pts) {
    var L = 0, i;
    for (i = 1; i < pts.length; i++) { var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1]; L += Math.sqrt(dx * dx + dy * dy); }
    return L;
  }
  // Resample to R points equally spaced by arc length (keeps ends).
  function resample(pts, R) {
    if (pts.length <= R) return pts.slice();
    var cum = [0], i, total = 0;
    for (i = 1; i < pts.length; i++) { var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1]; total += Math.sqrt(dx * dx + dy * dy); cum.push(total); }
    if (total <= 0) return pts.slice(0, R);
    var out = [pts[0].slice()], j = 1;
    for (i = 1; i < R; i++) {
      var d = total * i / (R - 1);
      while (j < cum.length - 1 && cum[j] < d) j++;
      var t = cum[j] - cum[j - 1] || 1, f = (d - cum[j - 1]) / t;
      out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f, 0.5]);
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }
  function centroidOf(pts) {
    var sx = 0, sy = 0, i;
    for (i = 0; i < pts.length; i++) { sx += pts[i][0]; sy += pts[i][1]; }
    return [sx / pts.length, sy / pts.length];
  }
  // Principal axis + line fit stats for pts.
  function lineFit(pts) {
    var c = centroidOf(pts), sxx = 0, syy = 0, sxy = 0, i;
    for (i = 0; i < pts.length; i++) { var dx = pts[i][0] - c[0], dy = pts[i][1] - c[1]; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    var theta = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(theta), uy = Math.sin(theta), vs = [];
    var res = [], maxRes = 0, rms = 0;
    for (i = 0; i < pts.length; i++) {
      var ddx = pts[i][0] - c[0], ddy = pts[i][1] - c[1];
      vs.push(ddx * ux + ddy * uy);
      var perp = -ddx * uy + ddy * ux;
      res.push(perp); rms += perp * perp;
      if (Math.abs(perp) > maxRes) maxRes = Math.abs(perp);
    }
    rms = Math.sqrt(rms / pts.length);
    var vMin = Math.min.apply(null, vs), vMax = Math.max.apply(null, vs), len = Math.max(1e-9, vMax - vMin);
    // endpoints are the extreme projected points
    var iMin = vs.indexOf(vMin), iMax = vs.indexOf(vMax);
    return { c: c, theta: theta, ux: ux, uy: uy, rms: rms, maxRes: maxRes, len: len, vs: vs, res: res, a: pts[iMin], b: pts[iMax] };
  }
  function reversalsAlong(pts, lf) {
    // Count sign changes of along-axis steps (smoothed a little): arrows/handwriting reverse, clean lines do not.
    var rev = 0, prev = 0, acc = 0, i;
    for (i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      acc += dx * lf.ux + dy * lf.uy;
      if (Math.abs(acc) > 0.004) {
        var s = acc > 0 ? 1 : -1;
        if (prev !== 0 && s !== prev) rev++;
        prev = s; acc = 0;
      }
    }
    return rev;
  }
  // Corner turns (degrees) at each resampled vertex, window w steps.
  function turnsOf(pts, w) {
    var out = [], i, n = pts.length;
    for (i = w; i < n - w; i++) {
      var ax = pts[i][0] - pts[i - w][0], ay = pts[i][1] - pts[i - w][1], bx = pts[i + w][0] - pts[i][0], by = pts[i + w][1] - pts[i][1];
      var la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
      if (!la || !lb) { out.push(0); continue; }
      var dot = clamp((ax * bx + ay * by) / (la * lb), -1, 1);
      out.push(Math.acos(dot) * 180 / Math.PI);
    }
    return out;
  }
  // Circular corner peaks over a closed loop (the stroke endpoint meets the start).
  function cornerCount(pts) {
    var n = pts.length, w = 2, i, turns = [];
    for (i = 0; i < n; i++) {
      var A = pts[(i - w + n) % n], B = pts[i], C = pts[(i + w) % n];
      var ax = B[0] - A[0], ay = B[1] - A[1], bx = C[0] - B[0], by = C[1] - B[1];
      var la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
      turns.push(la && lb ? Math.acos(clamp((ax * bx + ay * by) / (la * lb), -1, 1)) * 180 / Math.PI : 0);
    }
    var peaks = [];
    for (i = 0; i < n; i++) {
      if (turns[i] < 34) continue;
      if (turns[i] >= turns[(i - 1 + n) % n] && turns[i] >= turns[(i + 1) % n]) peaks.push({ i: i, v: turns[i] });
    }
    peaks.sort(function (a, b) { return b.v - a.v; });
    var kept = [];
    peaks.forEach(function (p) {
      var near = kept.some(function (k) { var d = Math.abs(k.i - p.i); d = Math.min(d, n - d); return d <= 4; });
      if (!near) kept.push(p);
    });
    return kept.map(function (k) { return k.i; }).sort(function (a, b) { return a - b; });
  }
  function distPtSegPx(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = clamp(t, 0, 1); var cx = ax + t * dx - px, cy = ay + t * dy - py;
    return Math.sqrt(cx * cx + cy * cy);
  }
  function meanDistToPoly(pts, poly) {
    var s = 0, i, j, best;
    for (i = 0; i < pts.length; i++) {
      best = Infinity;
      for (j = 1; j < poly.length; j++) { var d = distPtSegPx(pts[i][0], pts[i][1], poly[j - 1][0], poly[j - 1][1], poly[j][0], poly[j][1]); if (d < best) best = d; }
      s += best;
    }
    return s / pts.length;
  }
  // Ellipse fit via covariance (axes from eigenvalues); returns staff or null.
  function ellipseFit(pts) {
    var c = centroidOf(pts), sxx = 0, syy = 0, sxy = 0, i;
    for (i = 0; i < pts.length; i++) { var dx = pts[i][0] - c[0], dy = pts[i][1] - c[1]; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    var n = pts.length, tr = (sxx + syy) / n, det = (sxx * syy - sxy * sxy) / (n * n), disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    var l1 = tr / 2 + disc, l2 = Math.max(1e-12, tr / 2 - disc);
    var th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
    var a = Math.sqrt(2 * l1), b = Math.sqrt(2 * l2);
    if (a < 1e-6 || b < 1e-6) return null;
    // normalized-radius spread: points ON the ellipse give radius ~1 everywhere
    var rs = [], mean = 0;
    for (i = 0; i < pts.length; i++) {
      var ddx = pts[i][0] - c[0], ddy = pts[i][1] - c[1];
      var u = ddx * ux + ddy * uy, v = -ddx * uy + ddy * ux;
      var r = (u * u) / (a * a) + (v * v) / (b * b);
      rs.push(r); mean += r;
    }
    mean /= pts.length;
    var varr = 0;
    for (i = 0; i < rs.length; i++) varr += (rs[i] - mean) * (rs[i] - mean);
    return { cx: c[0], cy: c[1], a: a, b: b, th: th, ux: ux, uy: uy, mean: mean, std: Math.sqrt(varr / pts.length) };
  }
  function arrowFit(pts, lf) {
    // Shaft = the stroke's diameter pair; the head leaves BOTH sides just behind the tip.
    // Robust even when barb strokes outweigh the shaft (no reliance on the PCA axis).
    var n = pts.length, i, j, ia = 0, ib = 1, best = -1;
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      var dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], d = dx * dx + dy * dy;
      if (d > best) { best = d; ia = i; ib = j; }
    }
    var A = pts[ia], B = pts[ib], L = Math.sqrt(best);
    if (L < 0.06) return null;
    var ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
    var pos = null, neg = null, onLine = 0;
    for (i = 0; i < n; i++) {
      var vx = pts[i][0] - A[0], vy = pts[i][1] - A[1];
      var t = (vx * ux + vy * uy) / L, perp = (-vx * uy + vy * ux) / L;
      if (Math.abs(perp) < 0.06 && t >= -0.02 && t <= 1.02) onLine++;
      if (t >= 0.52 && t <= 1.02) {
        if (perp > 0.11 && (!pos || perp > pos.perp)) pos = { perp: perp, p: pts[i] };
        if (perp < -0.11 && (!neg || perp < neg.perp)) neg = { perp: perp, p: pts[i] };
      }
    }
    if (!pos || !neg || onLine / n < 0.35) return null;
    return { type: "arrow", x0: r4(A[0]), y0: r4(A[1]), x1: r4(B[0]), y1: r4(B[1]), bx1: r4(pos.p[0]), by1: r4(pos.p[1]), bx2: r4(neg.p[0]), by2: r4(neg.p[1]) };
  }
  // Small shapes are never snapped (a dot or a letter "o" must stay ink).
  var MIN_DIAG = 0.045, CLOSED_MIN = 0.05;
  function fitShape(raw, opts) {
    var pts = smoothPts(resample(cleanPts(raw), 48));
    if (!pts || pts.length < 5) return null;
    var bb = bboxOf(pts), diag = Math.sqrt(bb.w * bb.w + bb.h * bb.h), path = pathLenOf(pts);
    if (diag < MIN_DIAG) return null;
    var straight = path > 0 ? Math.sqrt((pts[0][0] - pts[pts.length - 1][0]) * (pts[0][0] - pts[pts.length - 1][0]) + (pts[0][1] - pts[pts.length - 1][1]) * (pts[0][1] - pts[pts.length - 1][1])) / path : 0;
    var closed = straight < 0.20 && bb.w >= CLOSED_MIN && bb.h >= CLOSED_MIN;
    var lf = lineFit(pts), rev = reversalsAlong(pts, lf);
    if (!closed) {
      // Open strokes: arrow (shaft + two-sided head) first, then a strict line. Anything else is handwriting.
      var ar = arrowFit(pts, lf);
      if (ar) return ar;
      if (lf.len > 0.06 && path / lf.len < 1.12 && lf.rms / lf.len < 0.02 && lf.maxRes / lf.len < 0.04 && rev <= 1 && straight > 0.96) {
        return { type: "line", x0: r4(lf.a[0]), y0: r4(lf.a[1]), x1: r4(lf.b[0]), y1: r4(lf.b[1]) };
      }
      return null;
    }
    // Closed family: corners decide triangle/rect, then ellipse.
    var corners = cornerCount(pts);
    var ell = ellipseFit(pts);
    var ellScore = ell && ell.std < 0.22;
    if (corners.length === 3) {
      var triV = [];
      corners.forEach(function (ci) { triV.push(pts[ci]); });
      if (triV.length === 3) {
        var poly = [triV[0], triV[1], triV[2], triV[0]];
        var md = meanDistToPoly(pts, poly);
        if (md / diag < 0.09) return { type: "triangle", x0: r4(triV[0][0]), y0: r4(triV[0][1]), x1: r4(triV[1][0]), y1: r4(triV[1][1]), x2: r4(triV[2][0]), y2: r4(triV[2][1]) };
      }
    }
    if (corners.length >= 4) {
      // Rect: stroke hugs the bounding-box edges.
      var edge = 0, i;
      for (i = 0; i < pts.length; i++) { var dE = Math.min(Math.abs(pts[i][0] - bb.x0), Math.abs(pts[i][0] - bb.x1), Math.abs(pts[i][1] - bb.y0), Math.abs(pts[i][1] - bb.y1)); edge += dE; }
      edge /= pts.length;
      if (edge / diag < 0.10) return { type: "rect", x0: r4(bb.x0), y0: r4(bb.y0), x1: r4(bb.x1), y1: r4(bb.y1) };
    }
    if (ellScore && corners.length <= 2) {
      var ratio = Math.max(ell.a, ell.b) / Math.max(1e-9, Math.min(ell.a, ell.b));
      var th = ell.th, ux = ell.ux, uy = ell.uy;
      // bbox of the fitted (possibly rotated) ellipse
      var ex = Math.sqrt((ell.a * ux) * (ell.a * ux) + (ell.b * uy) * (ell.b * uy)), ey = Math.sqrt((ell.a * uy) * (ell.a * uy) + (ell.b * ux) * (ell.b * ux));
      var refit = { cx: r4(ell.cx), cy: r4(ell.cy), rx: r4(ell.a), ry: r4(ell.b), x0: r4(ell.cx - ex), y0: r4(ell.cy - ey), x1: r4(ell.cx + ex), y1: r4(ell.cy + ey) };
      if (ratio < 1.22) return { type: "circle", cx: refit.cx, cy: refit.cy, rx: r4((ell.a + ell.b) / 2), ry: r4((ell.a + ell.b) / 2) };
      return { type: "ellipse", cx: refit.cx, cy: refit.cy, rx: refit.rx, ry: refit.ry };
    }
    // Wobbly corners failed: if ellipse is clean but corners say 3, retry triangle with bbox corners.
    if (ellScore) {
      var ratio2 = Math.max(ell.a, ell.b) / Math.max(1e-9, Math.min(ell.a, ell.b));
      if (ratio2 < 1.22) return { type: "circle", cx: r4(ell.cx), cy: r4(ell.cy), rx: r4((ell.a + ell.b) / 2), ry: r4((ell.a + ell.b) / 2) };
      return { type: "ellipse", cx: r4(ell.cx), cy: r4(ell.cy), rx: r4(ell.a), ry: r4(ell.b) };
    }
    return null;
  }
  // Shapes tool: every stroke snaps. Falls back to line, or to the ellipse, rather than leaving ink.
  function fitForced(raw) {
    var f = fitShape(raw);
    if (f) return f;
    var pts = smoothPts(resample(cleanPts(raw), 48));
    if (!pts || pts.length < 2) return null;
    var bb = bboxOf(pts), diag = Math.sqrt(bb.w * bb.w + bb.h * bb.h);
    if (diag < 0.01) return { type: "circle", cx: r4(bb.cx), cy: r4(bb.cy), rx: r4(0.01), ry: r4(0.01) };
    var lf = lineFit(pts);
    if (lf.rms / Math.max(1e-9, lf.len) < 0.25) return { type: "line", x0: r4(lf.a[0]), y0: r4(lf.a[1]), x1: r4(lf.b[0]), y1: r4(lf.b[1]) };
    var ell = ellipseFit(pts) || { cx: bb.cx, cy: bb.cy, a: bb.w / 2 || 0.01, b: bb.h / 2 || 0.01 };
    var ratio = Math.max(ell.a, ell.b) / Math.max(1e-9, Math.min(ell.a, ell.b));
    if (ratio < 1.22) return { type: "circle", cx: r4(ell.cx), cy: r4(ell.cy), rx: r4((ell.a + ell.b) / 2), ry: r4((ell.a + ell.b) / 2) };
    return { type: "ellipse", cx: r4(ell.cx), cy: r4(ell.cy), rx: r4(ell.a), ry: r4(ell.b) };
  }
  // ---- selection geometry: handles, resize ----
  function handlesOf(bb) {
    if (!bb) return [];
    return [
      { id: "nw", x: bb.x0, y: bb.y0 }, { id: "n", x: bb.cx, y: bb.y0 }, { id: "ne", x: bb.x1, y: bb.y0 },
      { id: "e", x: bb.x1, y: bb.cy }, { id: "se", x: bb.x1, y: bb.y1 }, { id: "s", x: bb.cx, y: bb.y1 },
      { id: "sw", x: bb.x0, y: bb.y1 }, { id: "w", x: bb.x0, y: bb.cy }
    ];
  }
  function handleAt(bb, x, y, W, H, padPx) {
    var pad = (padPx != null ? padPx : 22) / Math.max(1, Math.min(W, H)), best = null, bestD = Infinity;
    handlesOf(bb).forEach(function (h) {
      var dx = (x - h.x) * W, dy = (y - h.y) * H, d = Math.sqrt(dx * dx + dy * dy);
      if (d <= (padPx != null ? padPx : 22) && d < bestD) { bestD = d; best = h.id; }
    });
    return best;
  }
  function insideBB(bb, x, y, padRel) {
    if (!bb) return false;
    var p = padRel || 0;
    return x >= bb.x0 - p && x <= bb.x1 + p && y >= bb.y0 - p && y <= bb.y1 + p;
  }
  // Resize factors for a handle drag: corners proportional, sides stretch. min side 0.02 page per axis.
  // A degenerate axis (flat stroke: h ~ 0) never scales: dividing by ~0 would explode the other axis.
  function resizeFactors(bb, handle, px, py, minSide) {
    var ms = minSide || 0.02, sx = 1, sy = 1;
    var x0 = bb.x0, x1 = bb.x1, y0 = bb.y0, y1 = bb.y1, w = x1 - x0, h = y1 - y0;
    var hasW = w > 0.002, hasH = h > 0.002;
    if (handle === "e" || handle === "ne" || handle === "se") { if (hasW) sx = (px - x0) / w; }
    if (handle === "w" || handle === "nw" || handle === "sw") { if (hasW) sx = (x1 - px) / w; }
    if (handle === "s" || handle === "se" || handle === "sw") { if (hasH) sy = (py - y0) / h; }
    if (handle === "n" || handle === "ne" || handle === "nw") { if (hasH) sy = (y1 - py) / h; }
    var corner = (handle.length === 2);
    if (corner) {
      var cands = [];
      if (hasW) cands.push(sx);
      if (hasH) cands.push(sy);
      var dims = [];
      if (hasW) dims.push(w);
      if (hasH) dims.push(h);
      if (!cands.length) return { sx: 1, sy: 1 };
      var mind = Math.min.apply(null, dims);
      var s = clamp(Math.max.apply(null, cands), ms / mind, 1 / mind);
      sx = hasW ? s : 1; sy = hasH ? s : 1;
      return { sx: sx, sy: sy };
    }
    if (hasW) sx = clamp(sx, ms / w, 1 / w);
    if (hasH) sy = clamp(sy, ms / h, 1 / h);
    return { sx: sx, sy: sy };
  }
  // Gesture routing for a press near a selection: corners always resize, the
  // interior always moves, side dots resize only on a box big enough to grab.
  // A flat (zero-height) selection puts the n/s dots exactly on the stroke, so
  // interior presses must win there or the selection could never be moved.
  function pickGesture(bb, x, y, W, H, padPx) {
    if (!bb) return null;
    var pad = padPx != null ? padPx : 22;
    var hdl = handleAt(bb, x, y, W, H, pad);
    if (hdl) {
      if (hdl.length === 2) return { kind: "resize", handle: hdl };
      var wPx = (bb.x1 - bb.x0) * (W || 1), hPx = (bb.y1 - bb.y0) * (H || 1);
      var thin = (hdl === "n" || hdl === "s") ? !(hPx >= 2 * pad) : !(wPx >= 2 * pad);
      if (!thin) return { kind: "resize", handle: hdl };
    }
    if (insideBB(bb, x, y, 0.004)) return { kind: "move" };
    return null;
  }
  function resizeAnchor(bb, handle) {
    if (handle === "nw" || handle === "w" || handle === "sw") return [bb.x1, bb.cy];
    return [bb.x0, bb.cy];
  }
  // ---- xform op snapshots: one undo step covers every affected stroke ----
  function snapItems(items) {
    return (items || []).map(function (s) { return { id: s.id, pts: (s.pts || []).map(function (p) { return [p[0], p[1], p[2]]; }), w: s.w, color: s.color, shape: s.shape ? copyShape(s.shape) : null, fill: s.fill || null, page: s.page }; });
  }
  function applySnap(strokes, snap) {
    (snap || []).forEach(function (t) {
      for (var i = 0; i < strokes.length; i++) {
        if (strokes[i].id === t.id) {
          strokes[i].pts = t.pts.map(function (p) { return [p[0], p[1], p[2]]; });
          strokes[i].w = t.w; strokes[i].color = t.color;
          strokes[i].shape = t.shape ? copyShape(t.shape) : strokes[i].shape;
          if (t.fill != null) strokes[i].fill = t.fill;
          if (t.page != null) strokes[i].page = t.page;
          break;
        }
      }
    });
  }
  // ---- clipboard (in-memory copy lives in the browser section; these are the pure bits) ----
  function encodeClip(items) {
    var bb = selBBox(items) || { cx: 0.5, cy: 0.5 };
    var data = (items || []).map(function (s) {
      var o = { tool: s.tool, color: s.color, w: s.w, style: s.style, sens: s.sens, tip: s.tip, fill: s.fill, text: s.text, size: s.size, shape: s.shape ? copyShape(s.shape) : null, pts: (s.pts || []).map(function (p) { return [p[0], p[1], p[2] != null ? p[2] : 0.5]; }) };
      return o;
    });
    return JSON.stringify({ v: 1, cx: bb.cx, cy: bb.cy, items: data });
  }
  function decodeClip(json) {
    var o = JSON.parse(json);
    if (!o || o.v !== 1 || !Array.isArray(o.items)) return null;
    return o;
  }
  // Lasso settings: which stroke kinds the loop is allowed to pick (2.6).
  function lassoDefaults() { return { pen: true, hl: true, shapes: true, images: true, text: true }; }
  function lassoPick(settings, stroke) {
    var st = settings || lassoDefaults();
    if (!stroke) return false;
    if (stroke.tool === "hl") return !!st.hl;
    if (stroke.tool === "shape") return !!st.shapes;
    if (stroke.tool === "text") return !!st.text;
    if (stroke.tool === "image") return !!st.images;
    return !!st.pen; // pen and anything older (prep159-era pen ink)
  }
  function settingsDefaults() { return { lasso: lassoDefaults(), shapeFill: "none", drawSnap: true }; }
  function mergeSelectSettings(raw) {
    var d = settingsDefaults(), s = raw || {}, k;
    for (k in d.lasso) if (s.lasso && s.lasso[k] != null) d.lasso[k] = !!s.lasso[k];
    if (s.shapeFill === "25" || s.shapeFill === "none") d.shapeFill = s.shapeFill;
    if (s.drawSnap != null) d.drawSnap = !!s.drawSnap;
    return d;
  }
  function distPtSeg2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = clamp(t, 0, 1); var cx = ax + t * dx - px, cy = ay + t * dy - py;
    return cx * cx + cy * cy;
  }
  // Tap hit test for shapes/text (single tap selects them, 2.9).
  function nearStroke(st, rx, ry, radPx, W, H) {
    if (!st || !st.pts || !st.pts.length) return false;
    var px = rx * W, py = ry * H, r = radPx + (st.w * W) / 2, r2 = r * r;
    if (st.pts.length === 1) return distPtSeg2(px, py, st.pts[0][0] * W, st.pts[0][1] * H, st.pts[0][0] * W, st.pts[0][1] * H) <= r2;
    for (var i = 1; i < st.pts.length; i++) if (distPtSeg2(px, py, st.pts[i - 1][0] * W, st.pts[i - 1][1] * H, st.pts[i][0] * W, st.pts[i][1] * H) <= r2) return true;
    return false;
  }
  function dwellSnap(heldMs, enabled) { return !!enabled && heldMs >= 500; }
  var PURE = { clamp: clamp, r4: r4, cloneStroke: cloneStroke, bboxOf: bboxOf, selBBox: selBBox, shapePts: shapePts, scaleStroke: scaleStroke, translate: translate, rotateStroke: rotateStroke, clampStroke: clampStroke, fitShape: fitShape, fitForced: fitForced, handlesOf: handlesOf, handleAt: handleAt, insideBB: insideBB, pickGesture: pickGesture, resizeFactors: resizeFactors, resizeAnchor: resizeAnchor, snapItems: snapItems, applySnap: applySnap, encodeClip: encodeClip, decodeClip: decodeClip, lassoDefaults: lassoDefaults, lassoPick: lassoPick, settingsDefaults: settingsDefaults, mergeSelectSettings: mergeSelectSettings, nearStroke: nearStroke, dwellSnap: dwellSnap };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }
  G.STUDY_SELECT_PURE = PURE;

  /* ================= browser ================= */
  var D = G.document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function loadSel() {
    try { var raw = G.localStorage.getItem("smd_study_sel2"); return mergeSelectSettings(raw ? JSON.parse(raw) : null); } catch (e) { return settingsDefaults(); }
  }
  function saveSel(s) { try { G.localStorage.setItem("smd_study_sel2", JSON.stringify(s)); } catch (e) {} }
  function selOf(api) { var V = api.getV(); if (!V.sel2) V.sel2 = loadSel(); return V.sel2; }
  function persistSel(api) { saveSel(selOf(api)); syncStrip(api); }
  var clipMem = null;
  function putClip(items) {
    try { clipMem = encodeClip(items); G.localStorage.setItem("smd_study_clip", clipMem); } catch (e) { clipMem = null; }
    return clipMem;
  }
  function getClip() {
    if (clipMem) try { return decodeClip(clipMem); } catch (e) {}
    try { var raw = G.localStorage.getItem("smd_study_clip"); if (!raw) return null; return decodeClip(raw); } catch (e) { return null; }
  }
  function selItems(api) {
    var V = api.getV(), L = V.lasso;
    if (!L || !L.ids.length) return [];
    var map = {};
    V.strokes.forEach(function (s) { map[s.id] = s; });
    return L.ids.map(function (id) { return map[id]; }).filter(Boolean);
  }
  function selBBoxNow(api) { return selBBox(selItems(api)); }
  function hostToast(api, msg) { try { if (api && typeof api.toast === "function") api.toast(msg); else if (typeof G.toast === "function") G.toast(msg); } catch (e) {} }
  // ---- vector rendering for shape and text strokes (called from study.js drawStroke) ----
  function hexA(hex, alpha) {
    var m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || ""));
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }
  function shapePath(ctx, sh, W, H) {
    ctx.beginPath();
    if (sh.type === "line") { ctx.moveTo(sh.x0 * W, sh.y0 * H); ctx.lineTo(sh.x1 * W, sh.y1 * H); }
    else if (sh.type === "circle" || sh.type === "ellipse") { ctx.ellipse(sh.cx * W, sh.cy * H, sh.rx * W, sh.ry * H, 0, 0, Math.PI * 2); }
    else if (sh.type === "rect") { ctx.rect(sh.x0 * W, sh.y0 * H, (sh.x1 - sh.x0) * W, (sh.y1 - sh.y0) * H); }
    else if (sh.type === "triangle") { ctx.moveTo(sh.x0 * W, sh.y0 * H); ctx.lineTo(sh.x1 * W, sh.y1 * H); ctx.lineTo(sh.x2 * W, sh.y2 * H); ctx.closePath(); }
    else if (sh.type === "arrow") { ctx.moveTo(sh.x0 * W, sh.y0 * H); ctx.lineTo(sh.x1 * W, sh.y1 * H); ctx.moveTo(sh.x1 * W, sh.y1 * H); ctx.lineTo(sh.bx1 * W, sh.by1 * H); ctx.moveTo(sh.x1 * W, sh.y1 * H); ctx.lineTo(sh.bx2 * W, sh.by2 * H); }
  }
  function drawShape(ctx, s, W, H, dpr, isSel) {
    if (!s || !s.shape) return false;
    ctx.save(); ctx.scale(dpr, dpr);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = isSel ? "#42cdb5" : (s.color || "#111111");
    ctx.lineWidth = Math.max(1, (s.w || 0.0032) * W * 1.4);
    shapePath(ctx, s.shape, W, H);
    if (s.fill === "25") {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = s.color || "#111111";
      ctx.fill();
      ctx.restore();
      shapePath(ctx, s.shape, W, H);
    }
    ctx.stroke();
    ctx.restore();
    return true;
  }
  function textFrame(s) {
    var b = bboxOf(s.pts || []);
    if (!b) return null;
    return b;
  }
  function drawText(ctx, s, W, H, dpr, isSel) {
    if (!s || s.tool !== "text") return false;
    var b = textFrame(s);
    if (!b) return false;
    ctx.save(); ctx.scale(dpr, dpr);
    var px0 = b.x0 * W, py0 = b.y0 * H, pw = Math.max(20, (b.x1 - b.x0) * W), ph = Math.max(16, (b.y1 - b.y0) * H);
    ctx.fillStyle = isSel ? "#0d6e5f" : (s.color || "#111111");
    var size = s.size || Math.max(12, ph * 0.72);
    ctx.font = "600 " + size + "px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(String(s.text || ""), px0 + 2, py0 + 2);
    ctx.restore();
    return true;
  }
  // Dashed selection box with 8 handles, drawn over the page overlay (2.1).
  function drawSel(ctx, V, W, H, dpr, n) {
    if (!V || !V.lasso || !V.lasso.ids.length || V.lasso.n !== n) return;
    var items = selItems({ getV: function () { return V; } }), bb = selBBox(items);
    if (!bb) return;
    ctx.save(); ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#42cdb5"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.strokeRect(bb.x0 * W, bb.y0 * H, (bb.x1 - bb.x0) * W, (bb.y1 - bb.y0) * H);
    ctx.setLineDash([]);
    handlesOf(bb).forEach(function (h) {
      var hx = h.x * W, hy = h.y * H, r = Math.max(9, Math.min(W, H) * 0.012);
      ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#0d6e5f"; ctx.lineWidth = 2; ctx.stroke();
    });
    ctx.restore();
  }
  /* ---- context strips (lasso settings 2.6, shapes 2.8) ---- */
  function stripHtml(api) {
    var V = api.getV(), s = selOf(api);
    if (V.tool === "lasso") {
      var labels = { pen: "Ink", hl: "Highlighter", shapes: "Shapes", images: "Images", text: "Text" };
      return '<div class="st-sel-strip" role="group" aria-label="Lasso selects">' +
        ["pen", "hl", "shapes", "images", "text"].map(function (k) {
          var on = !!s.lasso[k];
          return '<button type="button" class="st-sel-rule' + (on ? " on" : "") + '" data-sel="rule" data-v="' + k + '" aria-pressed="' + on + '">' + labels[k] + "</button>";
        }).join("") + "</div>";
    }
    if (V.tool === "shapes") {
      return '<div class="st-sel-strip" role="group" aria-label="Shapes options">' +
        '<button type="button" class="st-sel-rule' + (s.shapeFill === "none" ? " on" : "") + '" data-sel="fill" data-v="none" aria-pressed="' + (s.shapeFill === "none") + '">Outline</button>' +
        '<button type="button" class="st-sel-rule' + (s.shapeFill === "25" ? " on" : "") + '" data-sel="fill" data-v="25" aria-pressed="' + (s.shapeFill === "25") + '">Fill 25%</button>' +
        '<button type="button" class="st-sel-rule' + (s.drawSnap ? " on" : "") + '" data-sel="snap" aria-pressed="' + s.drawSnap + '">Snap</button></div>';
    }
    return "";
  }
  function syncStrip(api) {
    var r = api.root(); if (!r) return;
    var V = api.getV();
    var hostEl = r.querySelector("#stInkCtx");
    if (!hostEl) return;
    if (V.tool !== "lasso" && V.tool !== "shapes") return; // ink strip owns pen, highlighter and eraser
    hostEl.innerHTML = stripHtml(api);
    if (!hostEl._selBound) {
      hostEl._selBound = true;
      hostEl.addEventListener("click", function (e) {
        var b = e.target;
        while (b && b !== hostEl && !b.getAttribute("data-sel")) b = b.parentNode;
        if (!b || b === hostEl) return;
        var k = b.getAttribute("data-sel"), api2 = currentApi();
        if (!api2) return;
        var s = selOf(api2);
        if (k === "rule") { var key = b.getAttribute("data-v"); s.lasso[key] = !s.lasso[key]; persistSel(api2); }
        if (k === "fill") { s.shapeFill = b.getAttribute("data-v"); persistSel(api2); }
        if (k === "snap") { s.drawSnap = !s.drawSnap; persistSel(api2); }
      });
    }
  }
  var lastApi = null;
  function currentApi() { return lastApi; }
  var ICONS = {
    cut: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    dup: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    palette: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.4-.4-.8-.4-1.3 0-1.1.9-2 2-2h2.3c3.9 0 7-3.1 7-7 0-5.5-5.4-9.1-10-9.1z"/></svg>',
    resize: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3l-7 7M21 3v5M21 3h-5M3 21l7-7M3 21v-5M3 21h5"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    shot: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>'
  };
  var PEN_COLORS = ["#111111", "#1a56db", "#d11a2a", "#168038", "#7b1fa2", "#ea580c", "#0e7490", "#b45309", "#be185d", "#334155", "#42cdb5", "#f5f0e6"];
  function removeLassoBar(api) {
    var r = api.root();
    if (r) { var b = r.querySelector("#stLassoBar"); if (b && b.parentNode) b.parentNode.removeChild(b); if (r.classList) r.classList.remove("st-lasso-on"); }
    removePanel(api);
    removePasteBubble(api);
  }
  function removePanel(api) {
    var r = api.root(); if (!r) return;
    ["#stSelColor", "#stSelResize", "#stSelMore", "#stSelConv"].forEach(function (sel) {
      var e = r.querySelector(sel); if (e && e.parentNode) e.parentNode.removeChild(e);
    });
  }
  function removePasteBubble(api) {
    var r = api.root(); if (!r) return;
    var e = r.querySelector("#stPasteBubble"); if (e && e.parentNode) e.parentNode.removeChild(e);
  }
  function removePanels(root) {
    if (!root) return;
    ["#stSelColor", "#stSelResize", "#stSelMore", "#stSelConv"].forEach(function (sel) {
      var e = root.querySelector(sel); if (e && e.parentNode) e.parentNode.removeChild(e);
    });
  }
  // Filter the loop's picks through the lasso settings, then show the menu (2.6).
  function showLassoBar(api) {
    var V = api.getV();
    if (!V || !V.lasso || !V.lasso.ids.length) { removeLassoBar(api); return; }
    var s = selOf(api), map = {};
    V.strokes.forEach(function (st) { map[st.id] = st; });
    var kept = V.lasso.ids.filter(function (id) { return lassoPick(s.lasso, map[id]); });
    if (kept.length !== V.lasso.ids.length) {
      if (!kept.length) { var pgN = V.lasso.n; V.lasso = null; removeLassoBar(api); api.redraw(pgN); hostToast(api, "Nothing here is in the lasso settings."); return; }
      V.lasso = { page: V.lasso.page, ids: kept, n: V.lasso.n };
    }
    removeLassoBar(api);
    var div = D.createElement("div");
    div.id = "stLassoBar";
    div.className = "st-lasso-bar st-sel-bar";
    div.setAttribute("role", "toolbar");
    div.setAttribute("aria-label", "Selection actions, " + kept.length + " selected");
    var btn = function (act, ico, label, extra) { return '<button type="button" class="pn-btn sm st-sel-btn" data-act="' + act + '"' + (extra || "") + ' aria-label="' + label + '">' + ico + "<span>" + label + "</span></button>"; };
    div.innerHTML = '<span class="st-sel-count">' + kept.length + (kept.length === 1 ? " item" : " items") + "</span>" +
      btn("st-lasso-cut", ICONS.cut, "Cut") +
      btn("st-lasso-clipcopy", ICONS.copy, "Copy") +
      btn("st-lasso-del", ICONS.trash, "Delete") +
      btn("st-lasso-dup", ICONS.dup, "Duplicate") +
      btn("st-lasso-color", ICONS.palette, "Color") +
      btn("st-lasso-more", ICONS.more, "More");
    var rootEl = api.root();
    rootEl.appendChild(div);
    if (rootEl.classList) rootEl.classList.add("st-lasso-on");
    positionLassoBar(api, div);
    api.redraw(V.lasso.n);
  }
  function positionLassoBar(api, div) {
    try {
      var V = api.getV();
      var bb = selBBoxNow(api);
      var pg = V && V.pg && V.pg[V.lasso.n];
      var el = pg && pg.el;
      if (!bb || !el || !el.getBoundingClientRect) return;
      var r = el.getBoundingClientRect();
      var bw = div.offsetWidth || 320, bh = div.offsetHeight || 48;
      var cx = r.left + ((bb.x0 + bb.x1) / 2) * r.width;
      var left = Math.max(8, Math.min(cx - bw / 2, (G.innerWidth || 390) - bw - 8));
      var top = r.top + bb.y0 * r.height - bh - 10;
      if (top < 108) top = r.top + bb.y1 * r.height + 10;
      div.style.left = left + "px";
      div.style.top = top + "px";
      div.style.bottom = "auto";
      div.style.transform = "none";
    } catch (e) {}
  }
  // ---- sub-panels: color, resize, more, convert ----
  function panel(api, id, html) {
    var r = api.root(); if (!r) return null;
    var old = r.querySelector("#" + id);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = D.createElement("div");
    el.id = id; el.className = "st-sel-panel"; el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Selection options");
    el.innerHTML = html;
    r.appendChild(el);
    return el;
  }
  function showColorPanel(api) {
    removePanel(api);
    var html = '<div class="st-sel-panel-head"><b>Colour</b><button type="button" class="pn-btn sm" data-sel-close="1">Close</button></div>' +
      '<div class="st-sel-colors" role="group" aria-label="Stroke colour">' + PEN_COLORS.map(function (c) {
        return '<button type="button" class="st-sel-c" data-sel-color="' + c + '" aria-label="Use colour ' + c + '" style="--c:' + c + '"></button>';
      }).join("") + "</div>" +
      '<div class="st-sel-fillrow" role="group" aria-label="Shape fill">' +
      '<button type="button" class="pn-btn sm st-sel-fill" data-sel-fill="none">No fill</button>' +
      '<button type="button" class="pn-btn sm st-sel-fill" data-sel-fill="25">Fill 25%</button></div>';
    var el = panel(api, "stSelColor", html);
    if (el) el.addEventListener("click", function (e) {
      var b = e.target;
      while (b && b !== el && !b.getAttribute("data-sel-color") && !b.getAttribute("data-sel-fill") && !b.getAttribute("data-sel-close")) b = b.parentNode;
      if (!b) return;
      if (b.getAttribute("data-sel-close")) { removePanel(api); return; }
      var col = b.getAttribute("data-sel-color"), fill = b.getAttribute("data-sel-fill");
      xformSelection(api, function (s) { var o = cloneStroke(s); if (col) o.color = col; if (fill) o.fill = fill === "25" ? "25" : "none"; return o; }, col ? "Recoloured." : "Fill changed.", function () { removePanel(api); });
    });
  }
  function showResizePanel(api) {
    removePanel(api);
    var html = '<div class="st-sel-panel-head"><b>Resize</b><button type="button" class="pn-btn sm" data-sel-close="1">Close</button></div>' +
      '<p class="st-sel-note">Drag the corner handles to scale in proportion, or a side handle to stretch. Line width follows the scale.</p>' +
      '<div class="st-sel-scale" role="group" aria-label="Scale presets">' +
      [0.5, 1, 1.5, 2].map(function (f) { return '<button type="button" class="pn-btn sm" data-sel-scale="' + f + '">' + Math.round(f * 100) + "%</button>"; }).join("") + "</div>";
    var el = panel(api, "stSelResize", html);
    if (el) el.addEventListener("click", function (e) {
      var b = e.target;
      while (b && b !== el && !b.getAttribute("data-sel-scale") && !b.getAttribute("data-sel-close")) b = b.parentNode;
      if (!b) return;
      if (b.getAttribute("data-sel-close")) { removePanel(api); return; }
      var f = parseFloat(b.getAttribute("data-sel-scale"));
      var bb = selBBoxNow(api);
      if (!bb || !f) return;
      xformSelection(api, function (s) { return scaleStroke(s, bb.cx, bb.cy, f, f); }, "Resized to " + Math.round(f * 100) + "%.", function () { removePanel(api); });
    });
  }
  function showMorePanel(api) {
    removePanel(api);
    var html = '<div class="st-sel-panel-head"><b>More</b><button type="button" class="pn-btn sm" data-sel-close="1">Close</button></div>' +
      '<button type="button" class="pn-btn sm st-sel-menubtn" data-act="st-lasso-resize">' + ICONS.resize + " Resize</button>" +
      '<button type="button" class="pn-btn sm st-sel-menubtn" data-act="st-lasso-rotate">' + ICONS.rotate + " Rotate</button>" +
      '<button type="button" class="pn-btn sm st-sel-menubtn" data-act="st-lasso-shot">' + ICONS.shot + " Take screenshot</button>" +
      '<button type="button" class="pn-btn sm st-sel-menubtn" data-act="st-lasso-conv">Convert to text</button>' +
      '<button type="button" class="pn-btn sm st-sel-menubtn" data-act="st-lasso-save-elem">Save as element</button>' +
      '<button type="button" class="pn-btn sm st-sel-menubtn" data-act="st-lasso-done">' + ICONS.check + " Done</button>";
    var el = panel(api, "stSelMore", html);
    if (el) el.addEventListener("click", function (e) {
      var b = e.target;
      while (b && b !== el && !b.getAttribute("data-sel-close")) b = b.parentNode;
      if (b && b.getAttribute("data-sel-close")) removePanel(api);
    });
  }
  function showConvPanel(api) {
    removePanel(api);
    var html = '<div class="st-sel-panel-head"><b>Convert handwriting to text</b><button type="button" class="pn-btn sm" data-sel-close="1">Close</button></div>' +
      '<p class="st-sel-note">Server preview. The selection image is sent to our server for transcription, and the text drops onto the page as a text box. There is no on-device handwriting recogniser in this build.</p>' +
      '<div class="st-sel-scale"><button type="button" class="pn-btn sm pri" data-sel-send="1">Send to server</button></div>' +
      '<p class="st-sel-note" data-sel-out role="status"></p>';
    var el = panel(api, "stSelConv", html);
    if (!el) return;
    el.addEventListener("click", function (e) {
      var b = e.target;
      while (b && b !== el && !b.getAttribute("data-sel-close") && !b.getAttribute("data-sel-send")) b = b.parentNode;
      if (!b) return;
      if (b.getAttribute("data-sel-close")) { removePanel(api); return; }
      if (b.getAttribute("data-sel-send")) convertSelection(api, el.querySelector("[data-sel-out]"));
    });
  }
  // ---- selection operations: every action is exactly one undo step (2.2-2.4) ----
  function findStroke(V, id) { for (var i = 0; i < V.strokes.length; i++) if (V.strokes[i].id === id) return V.strokes[i]; return null; }
  function xformSelection(api, fn, doneMsg, after) {
    var V = api.getV(), items = selItems(api);
    if (!items.length) return false;
    var before = snapItems(items);
    items.forEach(function (s) {
      var o = fn(s);
      s.pts = o.pts; s.w = o.w; s.color = o.color;
      if (o.shape) s.shape = copyShape(o.shape);
      if (o.fill !== undefined) s.fill = o.fill;
      api.putStroke(s);
    });
    api.pushOp({ t: "xform", before: before, after: snapItems(items) });
    api.syncTb(); api.saveStack();
    if (V.lasso) api.redraw(V.lasso.n);
    if (doneMsg) hostToast(api, doneMsg);
    if (after) after();
    return true;
  }
  function opDelete(api) {
    var V = api.getV(), L = V.lasso;
    if (!L) return false;
    var ids = L.ids.slice(), n = L.n;
    ids.forEach(function (id) { var s = findStroke(V, id); if (s) { s.gone = true; api.putStroke(s); } });
    api.pushOp({ t: "del", ids: ids });
    api.syncTb(); api.saveStack();
    V.lasso = null; removeLassoBar(api); api.redraw(n);
    hostToast(api, "Deleted selection.");
    return true;
  }
  function opDuplicate(api, dx, dy) {
    var V = api.getV(), L = V.lasso;
    if (!L) return false;
    var src = selItems(api), news = [], n = L.n;
    src.forEach(function (s) {
      var c = translate(cloneStroke(s), dx, dy);
      c.id = api.uid(); c.doc = V.id; c.page = s.page; c.gone = false; c.t = Date.now();
      V.strokes.push(c); news.push(c); api.putStroke(c);
    });
    if (!news.length) return false;
    api.pushOp({ t: "addmulti", ids: news.map(function (s) { return s.id; }) });
    api.syncTb(); api.saveStack();
    V.lasso = { page: news[0].page, ids: news.map(function (s) { return s.id; }), n: n };
    showLassoBar(api);
    hostToast(api, "Duplicated.");
    return true;
  }
  // Render selected strokes to an offscreen canvas; shared by screenshot and convert.
  function renderSelection(api, out) {
    var V = api.getV(), items = selItems(api), bb = selBBox(items);
    if (!bb) return null;
    var pad = 0.02, x0 = Math.max(0, bb.x0 - pad), y0 = Math.max(0, bb.y0 - pad), x1 = Math.min(1, bb.x1 + pad), y1 = Math.min(1, bb.y1 + pad);
    var cw = Math.max(24, Math.round((x1 - x0) * 900)), ch = Math.max(24, Math.round((y1 - y0) * 900));
    var c = D.createElement("canvas");
    c.width = cw; c.height = ch;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cw, ch);
    var sx = cw / (x1 - x0), sy = ch / (y1 - y0);
    items.forEach(function (s) {
      ctx.save();
      ctx.strokeStyle = s.color; ctx.lineCap = "round"; ctx.lineJoin = "round";
      if (s.shape) {
        ctx.lineWidth = Math.max(1, (s.w || 0.0032) * sx);
        ctx.translate(-x0 * sx, -y0 * sy);
        shapePath(ctx, s.shape, sx, sy);
        ctx.stroke();
      } else if (s.tool === "text") {
        ctx.fillStyle = s.color || "#111111"; ctx.font = "600 " + Math.max(10, (s.size || 14)) + "px system-ui, sans-serif";
        var b = textFrame(s);
        ctx.fillText(String(s.text || ""), (b.x0 - x0) * sx, (b.y0 - y0) * sy + Math.max(10, (s.size || 14)));
      } else if (s.tool === "hl") {
        ctx.globalAlpha = 0.4; ctx.lineWidth = Math.max(1, (s.w || 0.007) * sx * 4);
        ctx.beginPath();
        (s.pts || []).forEach(function (p, i) { var X = (p[0] - x0) * sx, Y = (p[1] - y0) * sy; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
        ctx.stroke();
      } else {
        ctx.lineWidth = Math.max(1, (s.w || 0.0032) * sx * 2);
        ctx.beginPath();
        (s.pts || []).forEach(function (p, i) { var X = (p[0] - x0) * sx, Y = (p[1] - y0) * sy; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
        ctx.stroke();
      }
      ctx.restore();
    });
    return c;
  }
  function downloadCanvas(c, name) {
    try {
      var a = D.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = name;
      D.body.appendChild(a); a.click(); D.body.removeChild(a);
    } catch (e) {}
  }
  function opScreenshot(api) {
    var c = renderSelection(api);
    if (!c) return false;
    downloadCanvas(c, "study-selection.png");
    hostToast(api, "Selection saved as screenshot.");
    return true;
  }
  function opRotate(api) {
    var bb = selBBoxNow(api);
    if (!bb) return false;
    var V = api.getV(), ratio = V.ratio || 1.414;
    return xformSelection(api, function (s) { return rotateStroke(s, 90, bb.cx, bb.cy, ratio); }, "Rotated.");
  }
  // Convert (2.10): stub over the existing AI path. Sends the selection image with the signed-in token.
  function convertSelection(api, outEl) {
    var V = api.getV(), items = selItems(api);
    var note = function (m) { if (outEl) outEl.textContent = m; else hostToast(api, m); };
    if (!items.length) { note("Select some ink first."); return; }
    if (G.navigator && G.navigator.onLine === false) { note("You are offline. Convert needs a connection, so nothing was sent."); return; }
    var u = G.SMD_AUTH && G.SMD_AUTH.currentUser;
    if (!u) { note("Sign in to use Convert handwriting to text. It is answered on our server."); return; }
    var c = renderSelection(api);
    if (!c) { note("The selection could not be pictured."); return; }
    note("Reading handwriting...");
    var img = c.toDataURL("image/jpeg", 0.85);
    Promise.resolve(u.getIdToken()).then(function (tok) {
      return G.fetch((G.SMD_API_BASE || "") + "/api/ai/prep-teach", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify({ kind: "transcribe", image: img, messages: [{ r: "u", t: "Transcribe the handwritten ink in this image exactly, line by line. Reply with the text only." }] }) });
    }).then(function (r) {
      return r.json().then(null, function () { return {}; }).then(function (j) {
        var txt = String((j && j.text) || "").trim();
        if (r.status === 200 && txt) return { text: txt };
        return { error: r.status === 401 ? "Sign in to use Convert." : r.status === 429 ? "Your AI limit is reached for now. Try again later." : "Convert could not answer just now. Try again." };
      });
    }, function () { return { error: "Convert could not reach the server. Check your connection." }; }).then(function (r) {
      if (r.text) {
        var bb = selBBox(items), fw = Math.max(0.12, bb.w), fh = Math.max(0.05, bb.h);
        var cx = clamp(bb.cx, fw / 2, 1 - fw / 2), cy = clamp(bb.cy, fh / 2, 1 - fh / 2 + 0.3);
        var fx0 = r4(cx - fw / 2), fy0 = r4(Math.max(0, cy - fh / 4)), fx1 = r4(cx + fw / 2), fy1 = r4(fy0 + fh * 0.75);
        var s = { id: api.uid(), doc: V.id, page: items[0].page, tool: "text", text: r.text.slice(0, 2000), pts: [[fx0, fy0, 0.5], [fx1, fy0, 0.5], [fx1, fy1, 0.5], [fx0, fy1, 0.5], [fx0, fy0, 0.5]], size: 14, color: "#111111", w: 0.0032, gone: false, t: Date.now() };
        V.strokes.push(s); api.putStroke(s);
        api.pushOp({ t: "add", id: s.id });
        api.syncTb(); api.saveStack();
        V.lasso = { page: s.page, ids: [s.id], n: V.lasso ? V.lasso.n : 1 };
        showLassoBar(api); api.redraw(V.lasso.n);
        note("Converted text dropped onto the page.");
      } else note(r.error || "Convert failed.");
    });
  }
  // Paste (2.5): re-anchor the clipboard so its centre lands at (tx,ty) on the target page.
  function pasteAt(api, tx, ty) {
    var clip = getClip();
    if (!clip || !clip.items.length) { hostToast(api, "The clipboard is empty. Cut or copy first."); return false; }
    var V = api.getV(), n = V.lasso ? V.lasso.n : (V.cur || 1), targetPage = api.pid ? api.pid(n) : n;
    var dx = tx - clip.cx, dy = ty - clip.cy, news = [];
    clip.items.forEach(function (d) {
      var s = { id: api.uid(), doc: V.id, page: targetPage, tool: d.tool || "pen", color: d.color, w: d.w, pts: (d.pts || []).map(function (p) { return [r4(p[0] + dx), r4(p[1] + dy), p[2] != null ? p[2] : 0.5]; }), gone: false, t: Date.now() };
      ["style", "sens", "tip", "fill", "text", "size"].forEach(function (k) { if (d[k] != null) s[k] = d[k]; });
      if (d.shape) { var sh = copyShape(d.shape), ks = ["x0", "x1", "x2", "cx", "bx1", "bx2"], ksY = ["y0", "y1", "y2", "cy", "by1", "by2"], i; for (i = 0; i < ks.length; i++) if (sh[ks[i]] != null) sh[ks[i]] = r4(sh[ks[i]] + dx); for (i = 0; i < ksY.length; i++) if (sh[ksY[i]] != null) sh[ksY[i]] = r4(sh[ksY[i]] + dy); s.shape = sh; }
      s = clampStroke(s);
      V.strokes.push(s); news.push(s); api.putStroke(s);
    });
    if (!news.length) return false;
    api.pushOp({ t: "addmulti", ids: news.map(function (s) { return s.id; }) });
    api.syncTb(); api.saveStack();
    V.lasso = { page: targetPage, ids: news.map(function (s) { return s.id; }), n: n };
    showLassoBar(api); api.redraw(n);
    hostToast(api, "Pasted. Undo removes it in one step.");
    return true;
  }
  function showPasteBubble(api, clientX, clientY, tx, ty, n) {
    removePasteBubble(api);
    var clip = getClip();
    if (!clip || !clip.items.length) return;
    var r = api.root(), el = D.createElement("div");
    el.id = "stPasteBubble"; el.className = "st-paste-bubble";
    el.setAttribute("role", "group"); el.setAttribute("aria-label", "Paste clipboard");
    el.style.left = clamp(clientX - 40, 8, (G.innerWidth || 390) - 120) + "px";
    el.style.top = clamp(clientY - 64, 8, (G.innerHeight || 844) - 100) + "px";
    el.innerHTML = '<button type="button" class="pn-btn sm pri st-paste-btn" data-sel-paste="1">Paste</button><button type="button" class="pn-btn sm" data-sel-paste-x="1" aria-label="Dismiss">Dismiss</button>';
    r.appendChild(el);
    el.addEventListener("click", function (e) {
      var b = e.target;
      while (b && b !== el && !b.getAttribute("data-sel-paste") && !b.getAttribute("data-sel-paste-x")) b = b.parentNode;
      if (!b || b === el) return;
      var api2 = lastApi || api;
      if (b.getAttribute("data-sel-paste")) pasteAt(api2, tx, ty);
      removePasteBubble(api);
    });
  }
  // Menu dispatcher (2.4). Returns true when the action was handled here.
  function act(a, el, host, api) {
    lastApi = api || lastApi;
    if (!api) api = lastApi;
    var V = api ? api.getV() : null;
    if (!V) return false;
    if (a === "st-lasso-cut") {
      if (!V.lasso) return false;
      putClip(selItems(api)); opDelete(api);
      hostToast(api, "Cut. Long-press an empty spot to paste.");
      return true;
    }
    if (a === "st-lasso-clipcopy") { if (!V.lasso) return false; putClip(selItems(api)); hostToast(api, "Copied."); return true; }
    if (a === "st-lasso-del") { if (!V.lasso) return false; opDelete(api); return true; }
    if (a === "st-lasso-dup" || a === "st-lasso-copy") { if (!V.lasso) return false; return opDuplicate(api, 0.03, 0.03); }
    if (a === "st-lasso-done") { if (V.lasso) { var n = V.lasso.n; V.lasso = null; removeLassoBar(api); api.redraw(n); } return true; }
    if (a === "st-lasso-resize") { showResizePanel(api); return true; }
    if (a === "st-lasso-color") { showColorPanel(api); return true; }
    if (a === "st-lasso-more") { showMorePanel(api); return true; }
    if (a === "st-lasso-rotate") { removePanel(api); opRotate(api); return true; }
    if (a === "st-lasso-shot") { removePanel(api); opScreenshot(api); return true; }
    if (a === "st-lasso-conv") { removePanel(api); showConvPanel(api); return true; }
    if (a === "st-lasso-paste") {
      var pt = [0.5, 0.5];
      try { var v = el && el.getAttribute("data-v"); if (v) pt = v.split(",").map(parseFloat); } catch (e) {}
      return pasteAt(api, pt[0] || 0.5, pt[1] || 0.5);
    }
    return false;
  }
  /* ---- pointer binding: selection drag, shapes draw, draw-and-hold, tap-select, long-press paste ----
     Capture on the page element so gestures are settled before study-ink sees the pointer. */
  function bindSel(api, ov, n) {
    lastApi = api;
    var V = api.getV();
    var pg = V.pg[n], hostEl = pg && pg.el;
    if (!hostEl || hostEl._selBound) return;
    hostEl._selBound = true;
    var G_ = { drag: null, draw: null, hold: null, lp: null, tap: null };
    var rel = function (e) { var r = ov.getBoundingClientRect(); return api.toRel(e.clientX, e.clientY, r); };
    var beforeIds = function () { var m = {}; V.strokes.forEach(function (s) { m[s.id] = 1; }); return m; };
    var pageW = function () { return ov.clientWidth || 300; }, pageH = function () { return ov.clientHeight || 400; };
    function consume(e) { e.stopPropagation(); e.preventDefault(); try { hostEl.setPointerCapture(e.pointerId); } catch (x) {} }
    function liveTransform(before, fn) {
      var map = {};
      before.forEach(function (t) { map[t.id] = t; });
      V.strokes.forEach(function (s) {
        var t = map[s.id]; if (!t) return;
        var o = fn({ id: s.id, pts: t.pts, w: t.w, color: t.color, shape: t.shape, fill: t.fill, page: t.page });
        s.pts = o.pts; s.w = o.w; s.color = o.color;
        if (o.shape) s.shape = copyShape(o.shape);
      });
      api.redraw(n);
    }
    function finishXform(g) {
      if (!g || !g.before || !g.before.length) return;
      var after = snapItems(g.before.map(function (t) { return findStroke(V, t.id); }).filter(Boolean));
      var aMap = {}; after.forEach(function (t) { aMap[t.id] = t; });
      var changed = false;
      g.before.forEach(function (t) {
        var a = aMap[t.id];
        if (!a) return;
        var ka = JSON.stringify(a.pts) + a.w, kb = JSON.stringify(t.pts) + t.w;
        if (ka !== kb) changed = true;
      });
      if (!changed) { applySnap(V.strokes, g.before); api.redraw(n); return; }
      var after2 = snapItems(selItems(api));
      var byId = {};
      after2.forEach(function (t) { byId[t.id] = t; });
      var afterSnap = g.before.map(function (t) { return byId[t.id] || t; });
      api.pushOp({ t: "xform", before: g.before, after: afterSnap });
      g.before.forEach(function (t) { var s = findStroke(V, t.id); if (s) api.putStroke(s); });
      api.syncTb(); api.saveStack();
    }
    function cancelXform(g) { if (g && g.before) { applySnap(V.strokes, g.before); api.redraw(n); } }
    hostEl.addEventListener("pointerdown", function (e) {
      V = api.getV(); ov = hostEl.querySelector("canvas.st-ov") || ov;   // live state + overlay: this page element outlives the V and canvas captured at first bind
      if (!V || !V.tool && !V.lasso) { /* long-press and tap below still need the down */ }
      var a = rel(e), W = pageW(), H = pageH();
      // Selection hit test
      if (V.lasso && V.lasso.n === n) {
        var bb = selBBoxNow(api);
        if (bb) {
          var pick = pickGesture(bb, a[0], a[1], W, H, 22);
          if (pick && pick.kind === "resize") {
            var before = snapItems(selItems(api));
            G_.drag = { kind: "resize", handle: pick.handle, bb0: { x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1, cx: bb.cx, cy: bb.cy }, before: before };
            consume(e); return;
          }
          if (pick && pick.kind === "move") {
            G_.drag = { kind: "move", start: a, before: snapItems(selItems(api)) };
            consume(e); return;
          }
        }
      }
      // Shapes tool: own the pointer, snap on release.
      if (V.tool === "shapes") {
        G_.draw = { pts: [a], beforeIds: beforeIds() };
        consume(e); return;
      }
      // Draw-and-hold tracking for the pen (never consumes).
      if (V.tool === "pen" && (e.pointerType === "pen" || e.pointerType === "mouse")) {
        G_.hold = { t0: Date.now(), lastMove: Date.now(), last: a, beforeIds: beforeIds(), anyMove: false };
      }
      // Tap-select shapes and text.
      if (V.tool === "shapes" || V.tool === "lasso" || !V.tool) {
        G_.tap = { t0: Date.now(), pos: a, x: e.clientX, y: e.clientY };
      }
      // Long-press paste.
      if (!V.tool || V.tool === "lasso") {
        var clip = getClip();
        if (clip && clip.items.length) {
          var lpPos = { x: e.clientX, y: e.clientY, tx: a[0], ty: a[1] };
          G_.lp = G_.lp || {};
          clearTimeout(G_.lp.timer);
          G_.lp.timer = G.setTimeout(function () {
            var api2 = lastApi || api;
            if (api2 && api2.getV() === V) showPasteBubble(api2, lpPos.x, lpPos.y, lpPos.tx, lpPos.ty, n);
          }, 500);
          G_.lp.pos = lpPos;
        }
      }
    }, true);
    hostEl.addEventListener("pointermove", function (e) {
      V = api.getV(); ov = hostEl.querySelector("canvas.st-ov") || ov;   // live state + overlay: this page element outlives the V and canvas captured at first bind
      var a = rel(e);
      if (G_.lp && G_.lp.pos) {
        var dx = e.clientX - G_.lp.pos.x, dy = e.clientY - G_.lp.pos.y;
        if (dx * dx + dy * dy > 100) { clearTimeout(G_.lp.timer); G_.lp = null; }
      }
      if (G_.hold) { G_.hold.lastMove = Date.now(); G_.hold.last = a; G_.hold.anyMove = true; }
      if (G_.drag) {
        var g = G_.drag;
        if (g.kind === "move") {
          var ddx = a[0] - g.start[0], ddy = a[1] - g.start[1];
          liveTransform(g.before, function (s) { return translate(s, ddx, ddy); });
        } else {
          var f = resizeFactors(g.bb0, g.handle, a[0], a[1]);
          // anchor: opposite side fixed
          var ax = (g.handle === "w" || g.handle === "nw" || g.handle === "sw") ? g.bb0.x1 : g.bb0.x0;
          var ay = (g.handle === "n" || g.handle === "ne" || g.handle === "nw") ? g.bb0.y1 : g.bb0.y0;
          liveTransform(g.before, function (s) { return scaleStroke(s, ax, ay, f.sx, f.sy); });
        }
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (G_.draw) {
        var evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || null;
        if (!evs || !evs.length) evs = [e];
        var self = G_.draw;
        evs.forEach(function (c) { self.pts.push(rel(c)); });
        if (e.cancelable) e.preventDefault();
        return;
      }
    }, true);
    var up = function (e) {
      V = api.getV(); ov = hostEl.querySelector("canvas.st-ov") || ov;   // live state + overlay: this page element outlives the V and canvas captured at first bind
      var a = rel(e);
      if (G_.drag) { var g = G_.drag; G_.drag = null; finishXform(g); return; }
      if (G_.lp) { clearTimeout(G_.lp.timer); var lp = G_.lp; G_.lp = null; }
      if (G_.draw) {
        var dr = G_.draw; G_.draw = null;
        var shape = fitForced(dr.pts);
        if (!shape) return;
        var S = selOf(api), V2 = api.getV();
        var ink = null;
        try { ink = V2.ink || (G.STUDY_INK && G.STUDY_INK.loadSettings ? G.STUDY_INK.loadSettings() : null); } catch (x) {}
        var color = (ink && ink.pen && ink.pen.color) || "#111111";
        var w = (ink && ink.pen && ink.pen.widths && ink.pen.widths[ink.pen.wi]) || 0.0032;
        var s = { id: api.uid(), doc: V2.id, page: api.pid(n), tool: "shape", shape: shape, pts: shapePts(shape), color: color, w: w, fill: S.shapeFill, gone: false, t: Date.now() };
        if (ink && ink.pen.style) { s.style = ink.pen.style; s.sens = ink.pen.sens; s.tip = ink.pen.tip; }
        V2.strokes.push(s);
        api.pushOp({ t: "add", id: s.id });
        api.syncTb();
        api.redraw(n);
        api.putStroke(s).then(function () { api.saveStack(); });
        hostToast(api, "Shape snapped. Tap it to edit, or use the lasso.");
        return;
      }
      if (G_.hold) {
        var h = G_.hold; G_.hold = null;
        var held = Date.now() - h.lastMove;
        if (dwellSnap(held, selOf(api).drawSnap)) {
          // study-ink commits this stroke on pointerup; patch it in the next tick.
          var ids0 = h.beforeIds;
          G.setTimeout(function () {
            var V2 = api.getV();
            var news = V2.strokes.filter(function (s) { return !ids0[s.id] && s.page === api.pid(n) && !s.gone; });
            var s = news[news.length - 1];
            if (!s) return;
            var sh = fitShape(s.pts);
            if (!sh) return;
            s.shape = sh; s.pts = shapePts(sh); s.tool = "shape"; s.fill = selOf(api).shapeFill;
            api.putStroke(s); api.redraw(n);
            hostToast(api, sh.type === "circle" ? "Snapped: a perfect circle." : "Snapped to " + sh.type + ".");
          }, 0);
        }
      }
      if (G_.tap) {
        var t = G_.tap; G_.tap = null;
        var dt = Date.now() - t.t0;
        var moved = Math.sqrt((e.clientX - t.x) * (e.clientX - t.x) + (e.clientY - t.y) * (e.clientY - t.y));
        if (dt < 350 && moved < 8 && (!V.tool || V.tool === "lasso" || V.tool === "shapes")) {
          var W2 = pageW(), H2 = pageH(), hitS = null, i;
          for (i = V.strokes.length - 1; i >= 0; i--) {
            var st = V.strokes[i];
            if (st.page !== api.pid(n) || st.gone) continue;
            if (st.tool !== "shape" && st.tool !== "text") continue;
            if (nearStroke(st, a[0], a[1], 8, W2, H2)) { hitS = st; break; }
          }
          if (hitS) {
            V.lasso = { page: api.pid(n), ids: [hitS.id], n: n };
            showLassoBar(api);
          } else if (V.lasso && (!V.tool || V.tool === "lasso")) {
            var bb2 = selBBoxNow(api);
            if (!bb2 || !insideBB(bb2, a[0], a[1], 0.02)) { var on = V.lasso.n; V.lasso = null; removeLassoBar(api); api.redraw(on); }
          }
        }
      }
    };
    hostEl.addEventListener("pointerup", up, true);
    hostEl.addEventListener("pointercancel", function (e) {
      V = api.getV(); ov = hostEl.querySelector("canvas.st-ov") || ov;   // live state + overlay: this page element outlives the V and canvas captured at first bind
      if (G_.drag) { cancelXform(G_.drag); G_.drag = null; }
      if (G_.draw) G_.draw = null;
      if (G_.hold) G_.hold = null;
      if (G_.tap) G_.tap = null;
      if (G_.lp) { clearTimeout(G_.lp.timer); G_.lp = null; }
    }, true);
  }
  G.STUDY_SELECT = { pure: PURE, drawShape: drawShape, drawText: drawText, drawSel: drawSel, stripHtml: stripHtml, syncStrip: syncStrip, showLassoBar: showLassoBar, removeLassoBar: removeLassoBar, removePanels: removePanels, act: act, bindSel: bindSel, pasteAt: pasteAt, getClip: getClip, putClip: putClip, loadSel: loadSel, saveSel: saveSel };
})(typeof window !== "undefined" ? window : this);

