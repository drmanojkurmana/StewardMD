/* Study ink engine (Phase 1): pen styles, pressure, highlighter, erasers, latency, palm rejection.
   ES5, no deps. Loaded AFTER study.js by prep-loader.js. Pure helpers load under node (module.exports).
   Stroke format stays backward compatible: {id,doc,page,tool,color,w,pts:[[x,y,pressure]],gone,t}
   New optional fields: style ("fountain"|"ball"|"brush"), sens (0..1), tip (0..1 sharpness).
   Old strokes have no style: they render with the legacy segment renderer in study.js, exactly as before. */
(function (G) {
  "use strict";
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function r4(n) { return Math.round(n * 10000) / 10000; }
  var PEN_COLORS = ["#111111", "#1a56db", "#d11a2a", "#168038", "#7b1fa2", "#ea580c", "#0e7490", "#b45309", "#be185d", "#334155", "#42cdb5", "#f5f0e6"];
  var HL_COLORS = ["#ffe14d", "#a7f3a0", "#6fdc6f", "#ff8fc8", "#ffb3d9", "#60a5fa", "#93c5fd", "#c084fc", "#fdba74", "#fde68a", "#5eead4", "#fca5a5"];
  var ERASER_RADII = { precision: 6, standard: [10, 18, 28], stroke: 12 };
  function defaults() {
    return {
      pen: { style: "fountain", sens: 0.5, tip: 0.7, color: PEN_COLORS[0], ci: 0, widths: [0.0016, 0.0032, 0.0064], wi: 1 },
      hl: { style: "ball", sens: 0, tip: 0.5, color: HL_COLORS[0], ci: 0, widths: [0.004, 0.007, 0.011], wi: 1 },
      eraser: { mode: "standard", size: 1, hlOnly: false, autoDeselect: true },
      recents: [], custom: {}, drawFinger: true, fingerManual: false, penSeen: false
    };
  }
  function mergeSettings(raw) {
    var d = defaults(), s = raw || {}, k, t;
    for (k in d) {
      if (s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) { for (t in d[k]) if (s[k][t] != null) d[k][t] = s[k][t]; }
      else if (s[k] != null) d[k] = s[k];
    }
    if (!Array.isArray(d.recents)) d.recents = [];
    return d;
  }
  function loadSettings(store) {
    try { var raw = store ? store.getItem("smd_study_ink1") : G.localStorage.getItem("smd_study_ink1"); return mergeSettings(raw ? JSON.parse(raw) : null); } catch (e) { return defaults(); }
  }
  function saveSettings(s, store) { try { (store || G.localStorage).setItem("smd_study_ink1", JSON.stringify(s)); } catch (e) {} }
  function validHex(c) { return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c); }
  function addRecent(s, color) {
    if (!validHex(color)) return s;
    s.recents = [color].concat((s.recents || []).filter(function (c) { return c.toLowerCase() !== color.toLowerCase(); })).slice(0, 5);
    return s;
  }
  // 1.4 pressure: sens 0..1. factor 1 at nominal pressure 0.5; at 100% hard press (p=1) doubles, light (p=0) tends to 0.
  function widthFactor(pressure, sens) {
    var p = (pressure == null || typeof pressure !== "number" || isNaN(pressure)) ? 0.5 : clamp(pressure, 0, 1);
    var s = clamp(sens == null ? 0.5 : sens, 0, 1);
    return Math.max(0.08, 1 + s * (p - 0.5) * 2);
  }
  function effPressure(pressure, sens) {
    var p = (pressure == null || typeof pressure !== "number" || isNaN(pressure)) ? 0.5 : clamp(pressure, 0, 1);
    return 0.5 + (p - 0.5) * clamp(sens == null ? 0.5 : sens, 0, 1);
  }
  // Per-point radius multiplier: fountain = pressure taper at both ends, brush = heavier taper, ball = even.
  function pointScale(style, ep, t, tip) {
    var taper;
    if (style === "ball") return 0.55 + 0.45 * (0.5 + ep * 0.6);
    var end = Math.min(t, 1 - t);
    if (style === "brush") { taper = clamp(end * 6, 0.06, 1); return taper * (0.25 + 1.1 * ep); }
    var sharp = clamp(tip == null ? 0.7 : tip, 0, 1);
    taper = clamp(end * (3 + sharp * 9), 0.05 + (1 - sharp) * 0.3, 1);
    return taper * (0.3 + 1.05 * ep);
  }
  function strokeWidths(pts, opts, W) {
    opts = opts || {}; var out = [], i, n = pts.length;
    for (i = 0; i < n; i++) {
      var t = n <= 1 ? 0.5 : i / (n - 1);
      var ep = effPressure(pts[i][2], opts.sens);
      var base = (opts.w || 0.0032) * W * widthFactor(pts[i][2], opts.sens);
      out.push(Math.max(0.15, base * pointScale(opts.style || "ball", ep, t, opts.tip) * 0.5));
    }
    return out;
  }
  // Variable-width outline (perfect-freehand style, written here): left/right offsets along normals, smoothed.
  /* Points no further apart than `step` px (x, y and pressure interpolated). Sparse input (a mouse, a trackpad, a fast
     flick) otherwise loses its corners to the outline smoothing: a zigzag drew as a trapezoid. Capped at 4,000. */
  function densify(pts, W, H, step) {
    if (!pts || pts.length < 2) return pts;
    var i, len = 0;
    for (i = 1; i < pts.length; i++) len += Math.sqrt(Math.pow((pts[i][0] - pts[i - 1][0]) * W, 2) + Math.pow((pts[i][1] - pts[i - 1][1]) * H, 2));
    step = Math.max(step || 2, len / 4000);
    var out = [pts[0]];
    for (i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], d = Math.sqrt(Math.pow((b[0] - a[0]) * W, 2) + Math.pow((b[1] - a[1]) * H, 2)), k = Math.floor(d / step);
      var pa = a[2] == null ? 0.5 : a[2], pb = b[2] == null ? 0.5 : b[2];
      for (var j = 1; j <= k; j++) { var t = j / (k + 1); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, pa + (pb - pa) * t]); }
      out.push(b);
    }
    return out;
  }
  function outline(pts, opts, W, H) {
    if (!pts || !pts.length) return [];
    pts = densify(pts, W, H, 2);
    var radii = strokeWidths(pts, opts, W), left = [], right = [], i;
    var px = pts.map(function (p) { return [p[0] * W, p[1] * H]; });
    if (px.length === 1) {
      var r = radii[0], cx = px[0][0], cy = px[0][1], dot = [];
      for (i = 0; i < 8; i++) { var a = i / 8 * Math.PI * 2; dot.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      return dot;
    }
    for (i = 0; i < px.length; i++) {
      var a = px[Math.max(0, i - 1)], b = px[Math.min(px.length - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      left.push([px[i][0] + nx * radii[i], px[i][1] + ny * radii[i]]);
      right.push([px[i][0] - nx * radii[i], px[i][1] - ny * radii[i]]);
    }
    var smooth = function (arr) {
      if (arr.length < 3) return arr;
      var o = [arr[0]];
      for (var j = 1; j < arr.length - 1; j++) o.push([(arr[j - 1][0] + arr[j][0] * 2 + arr[j + 1][0]) / 4, (arr[j - 1][1] + arr[j][1] * 2 + arr[j + 1][1]) / 4]);
      o.push(arr[arr.length - 1]); return o;
    };
    return smooth(left).concat(smooth(right).reverse());
  }
  function distPtSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = clamp(t, 0, 1); var cx = ax + t * dx - px, cy = ay + t * dy - py; return Math.sqrt(cx * cx + cy * cy);
  }
  // Kept sub-polylines after a circular eraser at (cx,cy) radius rad (all in 0..1, distances scaled by W,H).
  function splitPts(pts, cx, cy, rad, W, H) {
    if (!pts || !pts.length) return [];
    var R = rad, i;
    var inside = function (p) { var dx = (p[0] - cx) * W, dy = (p[1] - cy) * H; return dx * dx + dy * dy <= R * R; };
    if (pts.length === 1) return inside(pts[0]) ? [] : [pts];
    var pieces = [], cur = null;
    var pushPt = function (p) { if (!cur) cur = []; var last = cur[cur.length - 1]; if (!last || last[0] !== p[0] || last[1] !== p[1]) cur.push(p); };
    var close = function () { if (cur && cur.length) pieces.push(cur); cur = null; };
    // For each segment, keep the parts outside the circle by sampling the quadratic intersection.
    for (i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H, ccx = cx * W, ccy = cy * H;
      var dx = bx - ax, dy = by - ay, fx = ax - ccx, fy = ay - ccy;
      var A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - R * R, cuts = [0, 1], disc = B * B - 4 * A * C;
      if (A > 0 && disc > 0) { var sq = Math.sqrt(disc); var t1 = (-B - sq) / (2 * A), t2 = (-B + sq) / (2 * A); if (t1 > 0 && t1 < 1) cuts.push(t1); if (t2 > 0 && t2 < 1) cuts.push(t2); cuts.sort(function (x, y) { return x - y; }); }
      for (var k = 0; k < cuts.length - 1; k++) {
        var t0 = cuts[k], t1b = cuts[k + 1], tm = (t0 + t1b) / 2;
        var mx = ax + dx * tm, my = ay + dy * tm, mdx = mx - ccx, mdy = my - ccy;
        if (mdx * mdx + mdy * mdy <= R * R) { close(); continue; }
        pushPt([r4(a[0] + (b[0] - a[0]) * t0), r4(a[1] + (b[1] - a[1]) * t0), a[2] != null ? a[2] : 0.5]);
        pushPt([r4(a[0] + (b[0] - a[0]) * t1b), r4(a[1] + (b[1] - a[1]) * t1b), b[2] != null ? b[2] : 0.5]);
      }
      if (inside(b)) close();
    }
    close();
    return pieces.filter(function (p) { return p.length >= 1; });
  }
  function snapStraight(pts) { if (!pts || !pts.length) return pts; if (pts.length < 2) return pts.slice(); return [pts[0], pts[pts.length - 1]]; }
  function isStraightSnap(heldMs) { return heldMs >= 500; }
  /* Hold-to-straighten recogniser (pts in 0..1 page space, W/H page size in px).
     Open stroke -> straight line; closed stroke -> rectangle or ellipse; scribbles -> null (keep freehand). */
  function recognizeShape(pts, W, H) {
    if (!pts || pts.length < 3) return null;
    var px = pts.map(function (p) { return [p[0] * W, p[1] * H]; }), i, len = 0;
    for (i = 1; i < px.length; i++) len += Math.sqrt(Math.pow(px[i][0] - px[i - 1][0], 2) + Math.pow(px[i][1] - px[i - 1][1], 2));
    if (len < 18) return null;
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, pr = 0;
    px.forEach(function (q, k) { minx = Math.min(minx, q[0]); maxx = Math.max(maxx, q[0]); miny = Math.min(miny, q[1]); maxy = Math.max(maxy, q[1]); pr += pts[k][2] != null ? pts[k][2] : 0.5; });
    pr = r4(pr / pts.length);
    var bw = maxx - minx, bh = maxy - miny, diag = Math.sqrt(bw * bw + bh * bh) || 1;
    var a0 = px[0], a1 = px[px.length - 1], gap = Math.sqrt(Math.pow(a1[0] - a0[0], 2) + Math.pow(a1[1] - a0[1], 2));
    var toRel = function (x, y) { return [r4(x / W), r4(y / H), pr]; };
    var dense = function (list, closed) { var out = [], j, k, n = list.length; for (j = 0; j < n - (closed ? 0 : 1); j++) { var A = list[j], B = list[(j + 1) % n]; for (k = 0; k < 8; k++) out.push(toRel(A[0] + (B[0] - A[0]) * k / 8, A[1] + (B[1] - A[1]) * k / 8)); } out.push(toRel(list[closed ? 0 : n - 1][0], list[closed ? 0 : n - 1][1])); return out; };
    var closed = gap < 0.22 * diag && len > 2.2 * diag && Math.min(bw, bh) > 14;
    if (!closed) return { kind: "line", pts: dense([a0, a1], false) };
    var cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, rx = bw / 2 || 1, ry = bh / 2 || 1, eErr = 0, rErr = 0, m = Math.min(bw, bh) || 1;
    px.forEach(function (q) {
      var dx = (q[0] - cx) / rx, dy = (q[1] - cy) / ry; eErr += Math.abs(Math.sqrt(dx * dx + dy * dy) - 1);
      rErr += Math.min(Math.abs(q[0] - minx), Math.abs(q[0] - maxx), Math.abs(q[1] - miny), Math.abs(q[1] - maxy)) / m;
    });
    eErr /= px.length; rErr /= px.length;
    if (Math.min(eErr, rErr) > 0.12) return null;
    if (rErr <= eErr) return { kind: "rect", pts: dense([[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy]], true) };
    var el = []; for (i = 0; i <= 48; i++) { var t = i / 48 * Math.PI * 2; el.push(toRel(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry)); }
    return { kind: "ellipse", pts: el };
  }
  // Palm rejection / finger policy. Returns "draw" | "pan" | "ignore".
  function pointerAction(e, st, isPenActive) {
    if (!e || e.isPrimary === false) return "ignore";
    if (e.pointerType === "pen") return "draw";
    if (e.pointerType === "mouse") return (e.button != null && e.button !== 0) ? "ignore" : "draw";
    // touch
    if (isPenActive) return "ignore";
    if ((e.width && e.width > 25) || (e.height && e.height > 25)) return "ignore";
    if (st && (st.penSeen || st.settingsPenSeen)) return "pan";
    if (st && st.drawFinger === false) return "pan";
    return "draw";
  }
  function toolSettings(s, tool) { return tool === "hl" ? s.hl : s.pen; }
  function activeWidth(s, tool) { var t = toolSettings(s, tool); return t.widths[t.wi] || t.widths[1]; }
  var PURE = { PEN_COLORS: PEN_COLORS, HL_COLORS: HL_COLORS, ERASER_RADII: ERASER_RADII, defaults: defaults, mergeSettings: mergeSettings, loadSettings: loadSettings, saveSettings: saveSettings, validHex: validHex, addRecent: addRecent, widthFactor: widthFactor, effPressure: effPressure, pointScale: pointScale, strokeWidths: strokeWidths, densify: densify, outline: outline, splitPts: splitPts, snapStraight: snapStraight, isStraightSnap: isStraightSnap, recognizeShape: recognizeShape, pointerAction: pointerAction, activeWidth: activeWidth, distPtSeg: distPtSeg, clamp: clamp };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }
  G.STUDY_INK_PURE = PURE;

  /* ================= browser engine ================= */
  var D = G.document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var ICONS = {
    zoom: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/></svg>',
    shapes: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><rect x="3" y="3" width="8" height="8"/><circle cx="16" cy="16" r="5"/></svg>',
    elements: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    text: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><path d="M4 7V5h16v2M12 5v14M9 19h6"/></svg>',
    typing: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/></svg>',
    laser: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>'
  };
  function settingsOf(api) { var V = api.getV(); if (!V.ink) V.ink = loadSettings(); return V.ink; }
  function persist(api) { saveSettings(settingsOf(api)); syncStrip(api); }
  /* Highlighter like real ink: all highlight strokes are painted OPAQUE on a scratch layer, then laid down
     once at a fixed opacity, so self-overlaps and crossings never darken into blobs (GoodNotes look). */
  var hlScratch = null;
  function drawHlLayer(ctx, list, W, H, dpr, ox, oy) {
    if (!list || !list.length) return;
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    if (!hlScratch) hlScratch = D.createElement("canvas");
    if (hlScratch.width !== cw || hlScratch.height !== ch) { hlScratch.width = cw; hlScratch.height = ch; }
    var sc = hlScratch.getContext("2d");
    sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, cw, ch); sc.setTransform(dpr, 0, 0, dpr, -(ox || 0) * dpr, -(oy || 0) * dpr); /* ox/oy: page offset of a viewport tile */
    sc.lineCap = "round"; sc.lineJoin = "round"; sc.globalAlpha = 1;
    list.forEach(function (s) {
      var pts = s.pts || []; if (!pts.length) return;
      sc.strokeStyle = s.color; sc.lineWidth = Math.max(1, s.w * W * 6); sc.beginPath();
      pts.forEach(function (p, i) { if (i) sc.lineTo(p[0] * W, p[1] * H); else sc.moveTo(p[0] * W, p[1] * H); });
      if (pts.length === 1) sc.lineTo(pts[0][0] * W + 0.01, pts[0][1] * H);
      sc.stroke();
    });
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.55; ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(hlScratch, 0, 0); ctx.restore();
  }
  function drawStyled(ctx, s, W, H, dpr) {
    if (s.tool === "hl") { drawHlLayer(ctx, [s], W, H, dpr); return; }
    ctx.save(); ctx.scale(dpr, dpr);
    var poly = outline(s.pts, { style: s.style || "ball", sens: s.sens != null ? s.sens : 0.5, tip: s.tip != null ? s.tip : 0.7, w: s.w }, W, H);
    ctx.fillStyle = s.color; ctx.beginPath();
    poly.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function drawStroke(ctx, s, W, H, dpr, isSel) {
    if (isSel || !s.style) return false; // study.js legacy renderer handles old strokes + selection glow
    drawStyled(ctx, s, W, H, dpr); return true;
  }
  function stripHtml(api) {
    var V = api.getV(), s = settingsOf(api), tool = V.tool;
    if (tool !== "pen" && tool !== "hl" && tool !== "er") return "";
    if (tool === "er") {
      var er = s.eraser;
      return '<div class="st-ink-strip" role="group" aria-label="Eraser options">' +
        ["precision", "standard", "stroke"].map(function (m) { return '<button type="button" class="st-ink-seg' + (er.mode === m ? " on" : "") + '" data-ink="er-mode" data-v="' + m + '" aria-pressed="' + (er.mode === m) + '">' + { precision: "Precision", standard: "Partial", stroke: "Whole stroke" }[m] + "</button>"; }).join("") +
        (er.mode === "standard" ? '<span class="st-ink-sizes">' + [0, 1, 2].map(function (i) { return '<button type="button" class="st-ink-size' + (er.size === i ? " on" : "") + '" data-ink="er-size" data-v="' + i + '" aria-label="Eraser size ' + (i + 1) + '" aria-pressed="' + (er.size === i) + '"><i style="width:' + (10 + i * 8) + "px;height:" + (10 + i * 8) + 'px"></i></button>'; }).join("") + "</span>" : "") +
        '<span class="st-ink-hint">Tap the eraser again for more options</span></div>';
    }
    var ts = toolSettings(s, tool), pal = tool === "hl" ? HL_COLORS : PEN_COLORS;
    var html = '<div class="st-ink-strip" role="group" aria-label="' + (tool === "hl" ? "Highlighter" : "Pen") + ' options">' +
      '<div class="st-ink-widths" role="group" aria-label="Width presets">' + ts.widths.map(function (w, i) { return '<button type="button" class="st-ink-w' + (ts.wi === i ? " on" : "") + '" data-ink="width" data-v="' + i + '" aria-label="Width preset ' + (i + 1) + ', long press to edit" aria-pressed="' + (ts.wi === i) + '"><i style="height:' + Math.max(2, Math.round(w * 900)) + 'px"></i></button>'; }).join("") + "</div>" +
      '<span class="st-ink-divider" aria-hidden="true"></span><div class="st-ink-colors">' +
      pal.map(function (c) { return '<button type="button" class="st-ink-c' + (ts.color === c ? " on" : "") + '" data-ink="color" data-v="' + c + '" aria-label="Colour ' + c + '" aria-pressed="' + (ts.color === c) + '" style="--c:' + c + '"></button>'; }).join("") +
      (s.recents || []).map(function (c) { return '<button type="button" class="st-ink-c recent' + (ts.color === c ? " on" : "") + '" data-ink="color" data-v="' + c + '" aria-label="Recent colour ' + c + '" style="--c:' + c + '"></button>'; }).join("") +
      '<label class="st-ink-custom" title="Custom colour"><input type="color" data-ink-custom value="' + esc(ts.color) + '" aria-label="Custom colour wheel"><input type="text" data-ink-hex value="' + esc(ts.color) + '" aria-label="Custom colour hex" maxlength="7" spellcheck="false"></label></div>' +
      '<span class="st-ink-hint">Tap the ' + (tool === "hl" ? "highlighter" : "pen") + " again for settings</span></div>";
    return html;
  }
  function preview(api, cv) {
    if (!cv) return;
    var V = api.getV(), s = settingsOf(api), tool = V.tool === "hl" ? "hl" : "pen", ts = toolSettings(s, tool);
    var ctx = cv.getContext("2d"), W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
    var pts = [], i; for (i = 0; i <= 60; i++) { var x = 0.08 + 0.84 * i / 60; pts.push([x, 0.52 + Math.sin(i / 60 * Math.PI * 2) * 0.2, 0.3 + 0.6 * Math.abs(Math.sin(i / 60 * Math.PI))]); }
    // Drawn as if the page were 3x the card: at real phone size the chosen width is a hairline in a preview.
    drawStyled(ctx, { tool: tool, color: ts.color, w: ts.widths[ts.wi] * 3, pts: pts, style: ts.style, sens: ts.sens, tip: ts.tip }, W, H, 1);
  }
  var NB_ICO = {
    x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    "nib-fountain": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M24 44 14 26l4-14h12l4 14z" fill="var(--nb-nib-fill)"/><path d="M24 44V30"/><circle cx="24" cy="27" r="2.6" fill="currentColor" stroke="none"/><path d="M19 6h10v6H19z"/></svg>',
    "nib-ball": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M17 6h14v20l-4 10h-6l-4-10z" fill="var(--nb-nib-fill)"/><path d="M17 26h14"/><circle cx="24" cy="40" r="3" fill="currentColor" stroke="none"/></svg>',
    "nib-brush": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M19 4h10v14H19z"/><path d="M18 18h12l2 6c0 9-4 16-8 20-4-4-8-11-8-20z" fill="var(--nb-nib-fill)"/><path d="M24 26v12"/></svg>',
    "er-precision": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 34 30 14l8 8-20 20H10z" fill="var(--nb-nib-fill)"/><circle cx="12" cy="40" r="2" fill="currentColor" stroke="none"/></svg>',
    "er-standard": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 32 26 14a3 3 0 0 1 4 0l8 8a3 3 0 0 1 0 4L22 42H14z" fill="var(--nb-nib-fill)"/><path d="M18 22l12 12M22 42h18"/></svg>',
    "er-stroke": '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 30c6-10 12 6 18-4s12-8 18 0" stroke-dasharray="3 4"/><path d="M14 12l20 20M34 12 14 32" stroke-width="2.4"/></svg>'
  };
  function closePopover(api) { var r = api.root(); var e = r && r.querySelector("#stInkPop"); if (e) e.parentNode.removeChild(e); }
  function popover(api, tool) {
    var V = api.getV(), s = settingsOf(api), r = api.root(); if (!r) return;
    var existing = r.querySelector("#stInkPop");
    if (existing && existing.getAttribute("data-tool") === tool) { closePopover(api); return; }
    closePopover(api);
    var el = D.createElement("div"); el.id = "stInkPop"; el.className = "st-ink-pop"; el.setAttribute("data-tool", tool); el.setAttribute("role", "dialog"); el.setAttribute("aria-label", tool === "er" ? "Eraser settings" : "Pen settings");
    /* NoteBook settings card (2026-11-27, owner: "premium, new gen"): a header, a live preview on paper, illustrated
       nib cards, one swatch row and one grouped list (filled sliders with the value on the right, switches). The
       data-ink hooks are the same, so bindPopover only gained the slider fill and Close. */
    var head = function (kicker, title) { return '<div class="nb-grab" aria-hidden="true"></div><header class="nb-head"><div><small>' + kicker + "</small><h3>" + title + '</h3></div><button type="button" class="nb-x" data-ink="close" aria-label="Close">' + NB_ICO.x + "</button></header>"; };
    var slider = function (k, label, val, min, max, step, shown) { var pc = Math.round((val - min) / (max - min) * 100); return '<label class="nb-row nb-slide"><span class="nb-rl">' + label + '</span><b class="nb-rv" data-ink-' + k + '-val>' + shown + '</b><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" data-ink="' + k + '" aria-label="' + label + '" style="--p:' + pc + '%"></label>'; };
    var sw = function (k, label, on, sub) { return '<div class="nb-row nb-sw"><span class="nb-rl">' + label + (sub ? "<small>" + sub + "</small>" : "") + '</span><button type="button" role="switch" class="nb-switch' + (on ? " on" : "") + '" data-ink="' + k + '" aria-checked="' + !!on + '" aria-label="' + label + '"><i></i></button></div>'; };
    if (tool === "er") {
      var er = s.eraser, EM = { precision: ["Precision", "Only what it touches"], standard: ["Partial", "A round eraser"], stroke: ["Whole stroke", "Lifts the line"] };
      el.innerHTML = head("Eraser", EM[er.mode] ? EM[er.mode][0] : "Eraser") +
        '<div class="nb-nibs" role="radiogroup" aria-label="Eraser mode">' + ["precision", "standard", "stroke"].map(function (m) { return '<button type="button" role="radio" class="nb-nib' + (er.mode === m ? " on" : "") + '" data-ink="er-mode" data-v="' + m + '" aria-checked="' + (er.mode === m) + '"><span class="nb-nib-art">' + NB_ICO["er-" + m] + "</span><b>" + EM[m][0] + "</b><small>" + EM[m][1] + "</small></button>"; }).join("") + "</div>" +
        (er.mode === "standard" ? '<div class="nb-sizes" role="radiogroup" aria-label="Eraser size">' + [0, 1, 2].map(function (i) { return '<button type="button" role="radio" class="nb-size' + (er.size === i ? " on" : "") + '" data-ink="er-size" data-v="' + i + '" aria-checked="' + (er.size === i) + '" aria-label="' + ["Small", "Medium", "Large"][i] + '"><i style="--d:' + [8, 14, 22][i] + 'px"></i></button>'; }).join("") + "</div>" : "") +
        '<div class="nb-group">' + sw("er-hlonly", "Erase highlighter only", er.hlOnly) + sw("er-auto", "Back to the last tool after erasing", er.autoDeselect) + "</div>" +
        '<button type="button" class="nb-danger" data-ink="er-clear">' + NB_ICO.trash + " Clear this page</button>" +
        '<p class="nb-note">Clearing a page can be undone.</p>';
    } else {
      var ts = toolSettings(s, tool), cols = tool === "hl" ? HL_COLORS : PEN_COLORS, NIB = { fountain: "Fountain", ball: "Ballpoint", brush: "Brush" };
      var custom = cols.indexOf(ts.color) < 0;
      el.innerHTML = head(tool === "hl" ? "Highlighter" : "Pen", tool === "hl" ? "Highlighter" : (NIB[ts.style] || "Pen") + " pen") +
        '<div class="nb-prev"><canvas class="st-ink-preview" width="840" height="220" aria-label="Stroke preview"></canvas></div>' +
        (tool === "pen" ? '<div class="nb-nibs" role="radiogroup" aria-label="Pen style">' + ["fountain", "ball", "brush"].map(function (st) { return '<button type="button" role="radio" class="nb-nib' + (ts.style === st ? " on" : "") + '" data-ink="style" data-v="' + st + '" aria-checked="' + (ts.style === st) + '"><span class="nb-nib-art">' + NB_ICO["nib-" + st] + "</span><b>" + NIB[st] + "</b></button>"; }).join("") + "</div>" : "") +
        '<div class="nb-swatches" role="radiogroup" aria-label="Colour">' + cols.map(function (c) { return '<button type="button" role="radio" class="nb-swatch' + (ts.color === c ? " on" : "") + '" data-ink="color" data-v="' + c + '" aria-label="Colour ' + c + '" aria-checked="' + (ts.color === c) + '" style="--c:' + c + '"></button>'; }).join("") +
          '<label class="nb-swatch nb-wheel' + (custom ? " on" : "") + '" title="Any colour" style="--c:' + esc(ts.color) + '"><input type="color" data-ink-custom value="' + esc(ts.color) + '" aria-label="Pick any colour"></label></div>' +
        '<div class="nb-group">' +
          slider("size", "Size", Math.round(ts.widths[ts.wi] * 1500), 1, 12, 0.5, Math.round(ts.widths[ts.wi] * 1500)) +
          slider("sens", "Pressure", Math.round(ts.sens * 100), 0, 100, 1, Math.round(ts.sens * 100) + "%") +
          (tool === "pen" && ts.style === "fountain" ? slider("tip", "Tip sharpness", Math.round(ts.tip * 100), 0, 100, 1, Math.round(ts.tip * 100) + "%") : "") +
          sw("finger", "Draw with finger", s.drawFinger, "Turns off by itself once a pencil is used") +
        "</div>";
    }
    var tb = r.querySelector("#stTb"); if (tb && tb.parentNode) tb.parentNode.insertBefore(el, tb.nextSibling); else r.appendChild(el);
    preview(api, el.querySelector(".st-ink-preview"));
    bindPopover(api, el);
    function onDocPointer(ev) {
      if (!el.parentNode) { D.removeEventListener("pointerdown", onDocPointer, true); return; }
      if (!el.contains(ev.target) && !ev.target.closest("#stTb")) {
        closePopover(api);
        D.removeEventListener("pointerdown", onDocPointer, true);
      }
    }
    G.setTimeout(function () {
      D.addEventListener("pointerdown", onDocPointer, true);
    }, 50);
  }
  function bindPopover(api, el) {
    el.addEventListener("input", function (e) {
      var t = e.target, k = t.getAttribute("data-ink"), V = api.getV(), s = settingsOf(api), ts = toolSettings(s, V.tool === "hl" ? "hl" : "pen");
      if (t.type === "range") t.style.setProperty("--p", Math.round((t.value - t.min) / (t.max - t.min) * 100) + "%");
      if (k === "sens") { ts.sens = (+t.value) / 100; var b = el.querySelector("[data-ink-sens-val]"); if (b) b.textContent = t.value + "%"; }
      if (k === "tip") { ts.tip = (+t.value) / 100; var b2 = el.querySelector("[data-ink-tip-val]"); if (b2) b2.textContent = t.value + "%"; }
      if (k === "size") { ts.widths[ts.wi] = (+t.value) / 1500; var b3 = el.querySelector("[data-ink-size-val]"); if (b3) b3.textContent = t.value; }
      if (t.hasAttribute("data-ink-custom")) { ts.color = t.value; ts.ci = -1; addRecent(s, ts.color); var wl = t.parentNode; if (wl && wl.classList) { wl.style.setProperty("--c", ts.color); Array.prototype.forEach.call(el.querySelectorAll(".nb-swatch.on"), function (x) { x.classList.remove("on"); }); wl.classList.add("on"); } }
      if (t.hasAttribute("data-ink-hex")) { var hv = t.value.trim(); if (validHex(hv)) { ts.color = hv; ts.ci = -1; addRecent(s, hv); } }
      persist(api); preview(api, el.querySelector(".st-ink-preview"));
    });
    el.addEventListener("click", function (e) {
      var b = e.target; while (b && b !== el && !b.getAttribute("data-ink")) b = b.parentNode;
      if (!b || b === el) return;
      var k = b.getAttribute("data-ink"), V = api.getV(), s = settingsOf(api), tool = V.tool === "hl" ? "hl" : "pen", ts = toolSettings(s, tool);
      if (k === "close") { closePopover(api); return; }
      if (k === "color") { ts.color = b.getAttribute("data-v"); ts.ci = (tool === "hl" ? HL_COLORS : PEN_COLORS).indexOf(ts.color); persist(api); popoverRefresh(api, tool); }
      if (k === "er-mode") { s.eraser.mode = b.getAttribute("data-v"); persist(api); popoverRefresh(api, "er"); }
      if (k === "er-size") { s.eraser.size = +b.getAttribute("data-v"); persist(api); popoverRefresh(api, "er"); }
      if (k === "style") { ts.style = b.getAttribute("data-v"); persist(api); popoverRefresh(api, tool); }
      if (k === "finger") { s.drawFinger = !s.drawFinger; s.fingerManual = true; persist(api); popoverRefresh(api, tool); }
      if (k === "er-hlonly") { s.eraser.hlOnly = !s.eraser.hlOnly; persist(api); popoverRefresh(api, "er"); }
      if (k === "er-auto") { s.eraser.autoDeselect = !s.eraser.autoDeselect; persist(api); popoverRefresh(api, "er"); }
      if (k === "er-clear") { api.clearPage(); closePopover(api); }
    });
  }
  function popoverRefresh(api, tool) { closePopover(api); popover(api, tool); }
  function syncStrip(api) {
    var r = api.root(); if (!r) return;
    var hostEl = r.querySelector("#stInkCtx"); if (hostEl) hostEl.innerHTML = stripHtml(api);
    bindStrip(api, hostEl);
  }
  var stripBound = false;
  function bindStrip(api, hostEl) {
    if (!hostEl || hostEl._inkBound) return; hostEl._inkBound = true;
    var pressTimer = null;
    hostEl.addEventListener("pointerdown", function (e) {
      var b = e.target; while (b && b !== hostEl && !b.getAttribute("data-ink")) b = b.parentNode;
      if (!b || b.getAttribute("data-ink") !== "width") return;
      pressTimer = setTimeout(function () {
        var V = api.getV(), s = settingsOf(api), ts = toolSettings(s, V.tool), i = +b.getAttribute("data-v");
        var val = G.prompt("Width preset " + (i + 1) + " (1 to 12)", String(Math.round(ts.widths[i] * 1500)));
        var n = parseFloat(val); if (n >= 1 && n <= 12) { ts.widths[i] = n / 1500; persist(api); }
      }, 600);
    });
    hostEl.addEventListener("pointerup", function () { if (pressTimer) clearTimeout(pressTimer); });
    hostEl.addEventListener("click", function (e) {
      var b = e.target; while (b && b !== hostEl && !b.getAttribute("data-ink")) b = b.parentNode;
      if (!b || b === hostEl) return;
      var k = b.getAttribute("data-ink"), V = api.getV(), s = settingsOf(api);
      if (k === "color") { var ts = toolSettings(s, V.tool); ts.color = b.getAttribute("data-v"); ts.ci = (V.tool === "hl" ? HL_COLORS : PEN_COLORS).indexOf(ts.color); persist(api); }
      if (k === "width") { var tw = toolSettings(s, V.tool); tw.wi = +b.getAttribute("data-v"); persist(api); }
      if (k === "er-mode") { s.eraser.mode = b.getAttribute("data-v"); persist(api); }
      if (k === "er-size") { s.eraser.size = +b.getAttribute("data-v"); persist(api); }
    });
    hostEl.addEventListener("input", function (e) {
      var V = api.getV(), s = settingsOf(api), ts = toolSettings(s, V.tool);
      if (e.target.hasAttribute("data-ink-custom")) { ts.color = e.target.value; ts.ci = -1; addRecent(s, ts.color); persist(api); var hx = hostEl.querySelector("[data-ink-hex]"); if (hx) hx.value = ts.color; }
      if (e.target.hasAttribute("data-ink-hex")) { var v = e.target.value.trim(); if (validHex(v)) { ts.color = v; ts.ci = -1; addRecent(s, v); persist(api); } }
    });
    hostEl.addEventListener("change", function (e) { if (e.target.hasAttribute("data-ink-hex") && !validHex(e.target.value.trim())) { e.target.value = toolSettings(settingsOf(api), api.getV().tool).color; } });
  }
  function onPenSeen(api) {
    var s = settingsOf(api);
    if (!s.penSeen) { s.penSeen = true; if (!s.fingerManual) s.drawFinger = false; saveSettings(s); }
    api.setPenSeen();
  }
  function bindInk(api, ov, n) {
    var cur = null, pan = null, lassoPts = null, rafId = 0, lastMoveTs = 0, lastPt = null;
    var eraseOrig = [], erasePieces = [], erasedWhole = [], eraseTouched = false, eraseCursor = null;
    var cachedRect = null, cachedW = 0, cachedH = 0, cachedDpr = 1, drawnIndex = 0;
    function updateCached() {
      cachedRect = ov.getBoundingClientRect();
      var V = api.getV(), p = V && V.pg[n];
      cachedW = (p && p.el && p.el.clientWidth) || cachedRect.width || ov.width || 1;
      cachedH = (p && p.el && p.el.clientHeight) || cachedRect.height || ov.height || 1;
      cachedDpr = ov.width / (cachedW || 1);
    }
    function posFast(e) {
      if (!cachedRect || !cachedRect.width) updateCached();
      return api.toRel(e.clientX, e.clientY, cachedRect);
    }
    var sampleFast = function (e) {
      var a = posFast(e);
      return [r4(a[0]), r4(a[1]), r4(api.pressureOf(e))];
    };
    /* Live stroke is drawn by the SAME renderer as the saved stroke (drawStyled), on the live layer,
       so nothing changes when the pen lifts (owner: "bold while drawing, shrinks after"). */
    function drawIncremental() { drawPredicted(); }
    function scheduleFrame() {
      if (rafId) return;
      rafId = G.requestAnimationFrame(function () {
        rafId = 0;
        if (cur) drawPredicted();
      });
    }
    function drawPredicted() {
      var V = api.getV(), p = V && V.pg[n]; if (!p || !p.live || !cur) { if (p && p.live) { var c0 = p.live.getContext("2d"); c0.clearRect(0, 0, p.live.width, p.live.height); } return; }
      var ctx = p.live.getContext("2d"), dpr = cachedDpr || (p.live.width / (p.el.clientWidth || 1)), W = cachedW || p.el.clientWidth, H = cachedH || p.el.clientHeight;
      ctx.clearRect(0, 0, p.live.width, p.live.height);
      // predicted points are drawn only on the live layer and never saved
      var tmp = { tool: cur.tool, color: cur.color, w: cur.w, pts: (cur._pred && cur._pred.length && !snapped) ? cur.pts.concat(cur._pred) : cur.pts, style: cur.style, sens: cur.sens, tip: cur.tip };
      drawStyled(ctx, tmp, W, H, dpr);
    }
    function clearLive() { var V = api.getV(), p = V && V.pg[n]; if (p && p.live) { var ctx = p.live.getContext("2d"); ctx.clearRect(0, 0, p.live.width, p.live.height); } if (cur) cur._pred = null; }
    function eraseRadius() { var s = settingsOf(api); if (s.eraser.mode === "precision") return ERASER_RADII.precision; if (s.eraser.mode === "standard") return ERASER_RADII.standard[s.eraser.size] || 18; return ERASER_RADII.stroke; }
    function showCursor(e) {
      var V = api.getV(), p = V && V.pg[n]; if (!p || !p.live) return;
      var ctx = p.live.getContext("2d"), dpr = cachedDpr || (p.live.width / (p.el.clientWidth || 1)), a = posFast(e);
      ctx.clearRect(0, 0, p.live.width, p.live.height); ctx.save(); ctx.scale(dpr, dpr);
      ctx.strokeStyle = "#3e4c72"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(a[0] * (cachedW || p.el.clientWidth), a[1] * (cachedH || p.el.clientHeight), eraseRadius(), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    function eraseAt(e) {
      var V = api.getV(), s = settingsOf(api), a = posFast(e), W = cachedW || ov.clientWidth, H = cachedH || ov.clientHeight, rad = eraseRadius(), changed = false;
      var targets = V.strokes.filter(function (st) { return st.page === api.pid(n) && !st.gone && eraseOrig.indexOf(st.id) === -1 && erasedWhole.indexOf(st.id) === -1 && erasePieces.indexOf(st) === -1 && (!s.eraser.hlOnly || st.tool === "hl"); });
      // include already-split pieces created in this gesture
      targets = targets.concat(erasePieces.filter(function (st) { return !st.gone; }));
      targets.forEach(function (st) {
        var half = (st.w * W) / 2, eff = rad + half;
        var touches = false, i;
        for (i = 0; i < st.pts.length; i++) { var dx = (st.pts[i][0] - a[0]) * W, dy = (st.pts[i][1] - a[1]) * H; if (dx * dx + dy * dy <= eff * eff) { touches = true; break; } }
        if (!touches) for (i = 1; i < st.pts.length; i++) { if (distPtSeg(a[0] * W, a[1] * H, st.pts[i - 1][0] * W, st.pts[i - 1][1] * H, st.pts[i][0] * W, st.pts[i][1] * H) <= eff) { touches = true; break; } }
        if (!touches) return;
        changed = true; eraseTouched = true;
        if (s.eraser.mode === "stroke") {
          st.gone = true; if (erasePieces.indexOf(st) !== -1) { /* piece removed whole */ } else erasedWhole.push(st.id); api.putStroke(st); return;
        }
        var pieces = splitPts(st.pts, a[0], a[1], eff, W, H);
        if (pieces.length === 1 && pieces[0].length === st.pts.length) return;
        var wasPiece = erasePieces.indexOf(st);
        st.gone = true; api.putStroke(st);
        if (wasPiece !== -1) erasePieces.splice(wasPiece, 1); else if (eraseOrig.indexOf(st.id) === -1) eraseOrig.push(st.id);
        pieces.forEach(function (pp) {
          if (!pp.length) return;
          var ns = { id: api.uid(), doc: V.id, page: st.page, tool: st.tool, color: st.color, w: st.w, pts: pp, gone: false, t: Date.now(), style: st.style, sens: st.sens, tip: st.tip };
          V.strokes.push(ns); erasePieces.push(ns); api.putStroke(ns);
        });
      });
      if (changed) api.redraw(n);
    }
    var holdTimer = 0, holdAnchor = null, snapped = null;
    function clearHold() { if (holdTimer) { G.clearTimeout(holdTimer); holdTimer = 0; } }
    function armHold(p) {
      clearHold(); holdAnchor = p;
      holdTimer = G.setTimeout(function () {
        holdTimer = 0;
        if (!cur || snapped || (cur.tool !== "pen" && cur.tool !== "hl")) return;
        var shape = recognizeShape(cur.pts, cachedW || ov.clientWidth, cachedH || ov.clientHeight);
        if (!shape) return;
        cur._free = cur.pts; cur.pts = shape.pts; cur.snap = shape.kind; snapped = shape;
        try { if (G.navigator && G.navigator.vibrate) G.navigator.vibrate(8); } catch (x) {}
        drawPredicted();
      }, 500);
    }
    ov.addEventListener("pointerdown", function (e) {
      var V = api.getV(); if (!V || !V.tool) return;
      if (e.pointerType === "pen") {
        onPenSeen(api);
        if (V) V._isPenDown = true;
        pan = null;
      }
      var st = settingsOf(api);
      var isPenActive = (V && V._isPenDown) || cur !== null;
      var act2 = pointerAction(e, { penSeen: api.isPenSeen() || st.penSeen, drawFinger: st.drawFinger }, isPenActive);
      if (act2 === "ignore") return;
      if (act2 === "pan") {
        if (isPenActive || V._pinching) return;
        pan = { y: e.clientY, x: e.clientX };
        return;
      }
      if (e.pointerType === "mouse" && e.button) return;
      try { ov.setPointerCapture(e.pointerId); } catch (x) {}
      updateCached();
      if (V.tool === "er") { eraseOrig = []; erasePieces = []; erasedWhole = []; eraseTouched = false; eraseAt(e); showCursor(e); return; }
      if (V.tool === "lasso") { lassoPts = [posFast(e)]; api.removeLassoBar(); api.redraw(n, null, lassoPts); e.preventDefault(); return; }
      var ts = toolSettings(st, V.tool);
      var pt = sampleFast(e); lastMoveTs = e.timeStamp || Date.now(); lastPt = pt;
      drawnIndex = 0; snapped = null; clearHold();
      if (V._pinching) return;
      cur = { id: api.uid(), doc: V.id, page: api.pid(n), tool: V.tool, color: ts.color, w: ts.widths[ts.wi], pts: [pt], gone: false, t: Date.now(), t0: Date.now(), t1: Date.now(), style: V.tool === "hl" ? "ball" : ts.style, sens: ts.sens, tip: ts.tip };
      cur._touch = e.pointerType === "touch"; cur._pid = e.pointerId;
      try { if (window.STUDY_MEDIA && window.STUDY_MEDIA.stampStroke) { var aOff = window.STUDY_MEDIA.stampStroke(); if (aOff != null) cur.a = aOff; } } catch (x) {} /* Phase 5b: audio offset for tap-to-seek */
      drawIncremental();
      scheduleFrame();
      e.preventDefault();
    });
    ov.addEventListener("pointermove", function (e) {
      var V = api.getV(); if (!V) return;
      if (pan) {
        if (V && (V._isPenDown || V._pinching)) { pan = null; return; } /* two fingers = pinch/pan owns the gesture */
        V.sc.scrollTop -= e.clientY - pan.y; V.sc.scrollLeft -= e.clientX - pan.x; pan.y = e.clientY; pan.x = e.clientX; return;
      }
      if (V._pinching && cur && cur._touch) { clearHold(); cur = null; snapped = null; clearLive(); return; } /* second finger landed: a pinch, not ink */
      /* A touch while the PENCIL is writing is a palm: ignore it. A finger's own stroke (cur._touch) must keep its
         moves; this used to drop every touch move once a stroke began, so finger writing left a single dot. */
      if (e.pointerType === "touch" && ((cur && !cur._touch) || (V && V._isPenDown))) return;
      if (cur && cur._pid != null && e.pointerId !== cur._pid) return;   /* only the pointer that started the stroke adds to it */
      if (eraseOrig.length || erasePieces.length || erasedWhole.length || (V.tool === "er" && e.buttons)) { eraseAt(e); showCursor(e); return; }
      if (V.tool === "er") { showCursor(e); return; }
      if (lassoPts) { lassoPts.push(posFast(e)); api.redraw(n, null, lassoPts); return; }
      if (!cur) return;
      if (snapped) {
        /* after a snap, a line's end follows the pen until lift (GoodNotes); rectangles/ellipses stay put */
        if (snapped.kind === "line") { var ep = sampleFast(e), sp = cur.pts[0]; cur.pts = recognizeShape([sp, [(sp[0] + ep[0]) / 2, (sp[1] + ep[1]) / 2, sp[2]], [ep[0], ep[1], sp[2]]], cachedW || ov.clientWidth, cachedH || ov.clientHeight).pts; }
        scheduleFrame(); return;
      }
      var evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || null;
      if (!evs || !evs.length) evs = [e];
      for (var ci = 0; ci < evs.length; ci++) {
        var p = sampleFast(evs[ci]);
        cur.pts.push(p);
        lastPt = p;
      }
      if (cur.tool === "pen" || cur.tool === "hl") {
        var Wm = cachedW || ov.clientWidth, Hm = cachedH || ov.clientHeight;
        if (!holdAnchor || Math.abs((lastPt[0] - holdAnchor[0]) * Wm) > 4 || Math.abs((lastPt[1] - holdAnchor[1]) * Hm) > 4) armHold(lastPt);
      }
      lastMoveTs = e.timeStamp || Date.now();
      var pred = (e.getPredictedEvents && e.getPredictedEvents()) || [];
      cur._pred = [];
      for (var pi = 0; pi < pred.length; pi++) {
        cur._pred.push(sampleFast(pred[pi]));
      }
      scheduleFrame();
    });
    var end = function (e) {
      var V = api.getV(); if (!V) return;
      if (cur && cur._pid != null && e && e.pointerId != null && e.pointerId !== cur._pid) return;   /* another finger lifting */
      if (e && e.pointerType === "pen" && V) {
        V._isPenDown = false;
      }
      if (pan) { pan = null; return; }
      if (rafId) { G.cancelAnimationFrame(rafId); rafId = 0; }
      cachedRect = null;
      if (V.tool === "er" && (eraseTouched || eraseOrig.length || erasedWhole.length)) {
        var orig = eraseOrig.concat(erasedWhole), pieceIds = erasePieces.filter(function (s) { return !s.gone; }).map(function (s) { return s.id; });
        eraseOrig = []; erasedWhole = []; erasePieces = []; eraseTouched = false; clearLive();
        if (orig.length || pieceIds.length) { api.pushOp({ t: "split", orig: orig, pieces: pieceIds }); api.syncTb(); api.saveStack(); }
        api.redraw(n);
        if (settingsOf(api).eraser.autoDeselect && V.prevTool && V.prevTool !== "er") { V.tool = V.prevTool; api.syncTb(); syncStrip(api); }
        return;
      }
      if (V.tool === "er") { clearLive(); return; }
      if (lassoPts) {
        var loop = lassoPts; lassoPts = null;
        if (loop.length >= 3) {
          var sel = [];
          V.strokes.forEach(function (s2) { if (s2.page === api.pid(n) && !s2.gone && api.lassoHit(s2, loop)) sel.push(s2.id); });
          if (sel.length) { V.lasso = { page: api.pid(n), ids: sel, n: n }; api.showLassoBar(); } else { V.lasso = null; api.removeLassoBar(); }
        }
        api.redraw(n); return;
      }
      if (!cur) return;
      cur.t1 = Date.now();
      clearHold(); holdAnchor = null;
      var wasSnapped = !!snapped; snapped = null;
      // Phase 0 scribble erase, unchanged gates via study.js helpers
      if (V.tool === "pen" && V.scribble !== false && !wasSnapped) {
        var scW = ov.clientWidth, scH = ov.clientHeight, scInk = [];
        V.strokes.forEach(function (s2) { if (s2.page === api.pid(n) && !s2.gone) scInk.push(s2); });
        if (api.isScribble(cur.pts, { durationMs: cur.t1 - cur.t0, pageW: scW, pageH: scH, ink: scInk })) {
          var scPts = cur.pts, scIds = [];
          V.strokes.forEach(function (s2) { if (s2.page === api.pid(n) && !s2.gone && api.coveredBy(scPts, s2, scW, scH)) { s2.gone = true; scIds.push(s2.id); api.putStroke(s2); } });
          if (scIds.length) { cur = null; clearLive(); api.pushOp({ t: "del", ids: scIds }); api.syncTb(); api.saveStack(); api.redraw(n); api.showEraseToast(scIds.length, scIds, n); return; }
        }
      }
      var s = cur; cur = null; clearLive();
      delete s._pred; delete s._touch; delete s._free; /* runtime-only fields never stored */
      V.strokes.push(s); api.pushOp({ t: "add", id: s.id }); api.syncTb(); api.redraw(n);
      api.putStroke(s).then(function () { api.saveStack(); });
    };
    ov.addEventListener("pointerup", end); ov.addEventListener("pointercancel", end);
    ov.addEventListener("pointerleave", function () { if (api.getV() && api.getV().tool === "er") clearLive(); });
  }
  G.STUDY_INK = { pure: PURE, ICONS: ICONS, drawStroke: drawStroke, drawStyled: drawStyled, drawHlLayer: drawHlLayer, stripHtml: stripHtml, syncStrip: syncStrip, popover: popover, closePopover: closePopover, bindInk: bindInk, loadSettings: loadSettings, toolSettings: toolSettings, onPenSeen: onPenSeen, preview: preview };
})(typeof window !== "undefined" ? window : this);

