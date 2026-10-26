/* Kardia calculator figures: canvas renderer (ES5). One ECG clock drives
   chamber contraction, spectral envelope sweep and the ECG cursor, so
   end diastole, end systole, E and A waves and e prime stay in step.
   Motion purpose: explanation of timing. It runs only while a calculator
   is open; reduced motion or pause draws the key frame once. Render uses
   canvas paths only (no layout properties), so a figure can be drawn in
   Node against a fake context by the unit tests. */
(function (G) {
  "use strict";
  function data() { if (G.KCALC_FIG_DATA) return G.KCALC_FIG_DATA; try { if (typeof require === "function") return require("./kardia-calc-fig-data.js"); } catch (e) {} return null; }
  function get(id) { var d = data(); return d && d.figures ? d.figures[id] || null : null; }
  function ecg(phase) {
    var p = phase % 1;
    if (p < 0.06) return 0.08 * Math.sin(p / 0.06 * Math.PI);
    if (p < 0.10) return -0.12 * ((p - 0.06) / 0.04);
    if (p < 0.13) return 1.0 * ((p - 0.10) / 0.03);
    if (p < 0.18) return 1.0 - 1.25 * ((p - 0.13) / 0.05);
    if (p < 0.34) return 0;
    if (p < 0.46) return 0.22 * Math.sin((p - 0.34) / 0.12 * Math.PI);
    return 0;
  }
  function contraction(phase) {
    var p = phase % 1;
    if (p < 0.10) return 0;
    if (p < 0.20) return (p - 0.10) / 0.10;
    if (p < 0.34) return 1;
    if (p < 0.52) return 1 - (p - 0.34) / 0.18;
    return 0;
  }
  function phaseName(fig, phase) {
    var p = phase % 1;
    if (fig.kind === "diastolic") return p < 0.46 ? "Systole" : p < 0.64 ? "E wave" : p < 0.80 ? "Diastasis" : "A wave";
    if (fig.kind === "tdi") return p < 0.34 ? "s prime" : p < 0.66 ? "e prime" : "a prime";
    if (fig.kind === "pisa") return p >= 0.12 && p <= 0.42 ? "Mid systole: measure the radius" : "Cycle";
    if (p < 0.10) return "End diastole (QRS)";
    if (p < 0.36) return "Systole";
    if (p < 0.52) return "End systole";
    return "Diastole";
  }
  var PAL = { bg: "#0b1114", sector: "#111a1f", wall: "#cfe3da", wallDim: "#7d948a", blood: "#1b2a30", acc: "#3ee07a", warn: "#ffc05a", bad: "#ff6961", ecg: "#3ee07a", grid: "#24343b", text: "#eef3f1" };
  function lerpPt(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  function poly(ctx, pts, x0, y0, w, h) {
    ctx.beginPath();
    pts.forEach(function (pt, i) { var x = x0 + pt[0] * w, y = y0 + pt[1] * h; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.closePath();
  }
  function chamberAt(ch, t) {
    var out = [], i;
    for (i = 0; i < ch.ed.length; i += 2) {
      var a = [ch.ed[i], ch.ed[i + 1]], b = ch.es && ch.es.length === ch.ed.length ? [ch.es[i], ch.es[i + 1]] : a;
      out.push(lerpPt(a, b, t));
    }
    return out;
  }
  function drawSector(ctx, W, H) {
    ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W / 2, 6); ctx.lineTo(W * 0.06, H - 4); ctx.quadraticCurveTo(W / 2, H + H * 0.16, W * 0.94, H - 4); ctx.closePath();
    ctx.fillStyle = PAL.sector; ctx.fill();
    ctx.clip();
    ctx.strokeStyle = PAL.grid; ctx.lineWidth = 1;
    for (var i = 1; i < 5; i++) { ctx.beginPath(); ctx.arc(W / 2, 6, (H / 5) * i, 0.35, Math.PI - 0.35); ctx.stroke(); }
  }
  function drawChambers(ctx, view, t, W, H, fig) {
    view.chambers.forEach(function (ch) {
      var pts = chamberAt(ch, t);
      poly(ctx, pts, W * 0.05, 4, W * 0.90, H - 10);
      ctx.fillStyle = PAL.blood; ctx.fill();
      ctx.strokeStyle = PAL.wall; ctx.lineWidth = 1.6; ctx.stroke();
      if (ctx.fillText && pts.length) { ctx.fillStyle = PAL.wallDim; ctx.font = "600 9px system-ui, sans-serif"; ctx.fillText(ch.n, W * 0.05 + pts[0][0] * W * 0.90 + 3, 4 + pts[0][1] * (H - 10) - 3); }
    });
    if (fig.kind === "trace") {
      var main = view.chambers[0];
      if (main) {
        var pts2 = chamberAt(main, t);
        ctx.save(); if (ctx.setLineDash) ctx.setLineDash([4, 3]);
        poly(ctx, pts2, W * 0.05, 4, W * 0.90, H - 10);
        ctx.strokeStyle = PAL.acc; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        ctx.fillStyle = PAL.warn;
        pts2.forEach(function (pt) { ctx.beginPath(); ctx.arc(W * 0.05 + pt[0] * W * 0.90, 4 + pt[1] * (H - 10), 2, 0, 6.2832); ctx.fill(); });
      }
    }
    if (fig.kind === "linear" || fig.kind === "body" || fig.kind === "physics") drawCaliper(ctx, W, H, fig);
    if (fig.kind === "mmode") drawMmode(ctx, W, H, t);
    if (fig.kind === "pisa") drawPisa(ctx, W, H);
    if (fig.kind === "ivc") drawIvc(ctx, W, H, t);
  }
  function drawCaliper(ctx, W, H, fig) {
    var y = fig.id === "effusion-size" ? H * 0.80 : H * 0.52;
    var x1 = W * 0.30, x2 = W * 0.72;
    ctx.strokeStyle = PAL.acc; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    [x1, x2].forEach(function (x) { ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke(); });
    if (ctx.fillText) { ctx.fillStyle = PAL.acc; ctx.font = "700 10px system-ui, sans-serif"; ctx.fillText(fig.id === "aortic-size" ? "leading edge" : "caliper", (x1 + x2) / 2 - 18, y - 12); }
  }
  function drawMmode(ctx, W, H, t) {
    var x0 = W * 0.52, w = W * 0.44, y0 = H * 0.10, h = H * 0.80;
    ctx.fillStyle = "#0e1519"; ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = PAL.warn; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0 + h * 0.30); ctx.lineTo(x0 + w, y0 + h * 0.30); ctx.stroke();
    ctx.strokeStyle = PAL.wall; ctx.beginPath();
    for (var x = 0; x <= w; x += 4) { var ph = (x / w + t * 0.2) % 1; var y = y0 + h * (0.55 - 0.20 * contraction(ph)); if (x === 0) ctx.moveTo(x0 + x, y); else ctx.lineTo(x0 + x, y); }
    ctx.stroke();
    if (ctx.fillText) { ctx.fillStyle = PAL.wallDim; ctx.font = "600 9px system-ui, sans-serif"; ctx.fillText("M-mode", x0 + 4, y0 + 12); }
  }
  function drawPisa(ctx, W, H) {
    var cx = W * 0.50, cy = H * 0.42;
    [26, 18, 10].forEach(function (r, i) {
      ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0);
      ctx.strokeStyle = i === 1 ? PAL.warn : PAL.acc; ctx.lineWidth = i === 1 ? 2.5 : 1.4; ctx.stroke();
    });
    ctx.strokeStyle = PAL.warn; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 6, cy - 18); ctx.lineTo(cx + 6, cy - 18); ctx.stroke();
    if (ctx.fillText) { ctx.fillStyle = PAL.warn; ctx.font = "700 10px system-ui, sans-serif"; ctx.fillText("r", cx + 8, cy - 12); }
  }
  function drawIvc(ctx, W, H, t) {
    var collapse = 0.5 + 0.5 * Math.sin(t * 6.2832);
    ctx.strokeStyle = PAL.acc; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W * 0.08, H * 0.86); ctx.lineTo(W * 0.92, H * 0.86 - collapse * 4); ctx.stroke();
    if (ctx.fillText) { ctx.fillStyle = PAL.wallDim; ctx.font = "600 9px system-ui, sans-serif"; ctx.fillText(collapse > 0.5 ? "inspiration: IVC narrows" : "expiration: IVC fills", W * 0.08, H * 0.94); }
  }
  function drawWave(ctx, fig, phase, W, H) {
    ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = PAL.grid; ctx.lineWidth = 1;
    var base = H * 0.62;
    ctx.beginPath(); ctx.moveTo(6, base); ctx.lineTo(W - 6, base); ctx.stroke();
    for (var v = 1; v <= 3; v++) { ctx.beginPath(); ctx.moveTo(6, base - v * H * 0.16); ctx.lineTo(W - 6, base - v * H * 0.16); ctx.stroke(); }
    var d = data(), wave = d && d.waves[fig.wave];
    if (!wave) return;
    var pts = wave.pts;
    ctx.beginPath();
    pts.forEach(function (pt, i) { var x = 8 + pt[0] * (W - 16), y = base - pt[1] * H * 0.46; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    if (wave.mode === "cw" || wave.mode === "pw") { ctx.lineTo(8 + pts[pts.length - 1][0] * (W - 16), base); ctx.lineTo(8 + pts[0][0] * (W - 16), base); ctx.closePath(); ctx.fillStyle = "rgba(62,224,122,0.20)"; ctx.fill(); }
    ctx.strokeStyle = PAL.acc; ctx.lineWidth = 2; ctx.stroke();
    var sweepX = 8 + (phase % 1) * (W - 16);
    ctx.strokeStyle = PAL.warn; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sweepX, 8); ctx.lineTo(sweepX, H - 8); ctx.stroke();
    var peak = pts.reduce(function (a, b) { return b[1] > a[1] ? b : a; }, pts[0]);
    var px = 8 + peak[0] * (W - 16), py = base - peak[1] * H * 0.46;
    ctx.fillStyle = PAL.warn; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 6.2832); ctx.fill();
    if (ctx.fillText) { ctx.fillStyle = PAL.text; ctx.font = "700 10px system-ui, sans-serif"; ctx.fillText(fig.kind === "diastolic" ? "trace E, then A" : fig.kind === "tdi" ? "sample at the annulus" : "trace the outer envelope (VTI)", 10, 16); ctx.fillStyle = PAL.warn; ctx.fillText("peak", px + 7, py - 6); }
    if (fig.kind === "diastolic" || fig.kind === "tdi") drawTdiInset(ctx, W, H, base);
  }
  function drawTdiInset(ctx, W, H, base) {
    var x0 = W * 0.62, y0 = H * 0.70, w = W * 0.34, h = H * 0.24;
    ctx.strokeStyle = PAL.grid; ctx.strokeRect(x0, y0, w, h);
    ctx.strokeStyle = PAL.warn; ctx.lineWidth = 1.6; ctx.beginPath();
    ctx.moveTo(x0 + 4, y0 + h * 0.45); ctx.lineTo(x0 + w * 0.35, y0 + h * 0.45); ctx.lineTo(x0 + w * 0.55, y0 + h * 0.85); ctx.lineTo(x0 + w * 0.75, y0 + h * 0.45); ctx.lineTo(x0 + w - 4, y0 + h * 0.45); ctx.stroke();
    if (ctx.fillText) { ctx.fillStyle = PAL.wallDim; ctx.font = "600 9px system-ui, sans-serif"; ctx.fillText("TDI e prime", x0 + 4, y0 + 11); }
  }
  function drawWmsi(ctx, W, H) {
    ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2;
    [0.42, 0.28, 0.14].forEach(function (r, ring) {
      for (var s = 0; s < 6; s++) {
        var a0 = s / 6 * 6.2832 + ring * 0.3, a1 = (s + 0.9) / 6 * 6.2832 + ring * 0.3;
        ctx.beginPath(); ctx.arc(cx, cy, H * r, a0, a1); ctx.arc(cx, cy, H * (r - 0.11), a1, a0, true); ctx.closePath();
        ctx.fillStyle = ring === 1 && s === 2 ? "rgba(255,192,90,0.55)" : "rgba(62,224,122,0.16)"; ctx.fill();
        ctx.strokeStyle = PAL.wallDim; ctx.lineWidth = 1; ctx.stroke();
      }
    });
    if (ctx.fillText) { ctx.fillStyle = PAL.text; ctx.font = "700 10px system-ui, sans-serif"; ctx.fillText("17 segment map: tap a segment, score 1 to 4", 10, 16); }
  }
  function drawPathway(ctx, fig, W, H) {
    ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, W, H);
    var steps = fig.id === "pathway-as" ? ["AVA", "Gradient", "SV index", "Flow state", "Grade"] : fig.id === "pathway-mr" ? ["Jet", "PISA", "Chambers", "Concordance"] : ["Inflow", "e prime", "TR", "LA volume", "Grade"];
    steps.forEach(function (s, i) {
      var x = 10 + i * ((W - 20) / steps.length), w = (W - 20) / steps.length - 8;
      ctx.fillStyle = i === steps.length - 1 ? PAL.acc : "#1b2a30"; if (ctx.fillRect) ctx.fillRect(x, H * 0.34, w, H * 0.30);
      ctx.strokeStyle = PAL.wallDim; if (ctx.strokeRect) ctx.strokeRect(x, H * 0.34, w, H * 0.30);
      if (ctx.fillText) { ctx.fillStyle = i === steps.length - 1 ? "#04160a" : PAL.text; ctx.font = "700 9px system-ui, sans-serif"; ctx.fillText(s, x + 5, H * 0.52); }
      if (i < steps.length - 1 && ctx.fillText) { ctx.fillStyle = PAL.warn; ctx.fillText(">", x + w + 1, H * 0.52); }
    });
  }
  function drawBodyPhysics(ctx, fig, W, H) {
    ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = PAL.wall; ctx.lineWidth = 2;
    if (fig.kind === "body") {
      ctx.strokeRect(W * 0.42, H * 0.12, W * 0.16, H * 0.62);
      ctx.beginPath(); ctx.arc(W / 2, H * 0.10, 10, 0, 6.2832); ctx.stroke();
      ctx.strokeStyle = PAL.acc; ctx.beginPath(); ctx.moveTo(W * 0.30, H * 0.12); ctx.lineTo(W * 0.30, H * 0.74); ctx.stroke();
      if (ctx.fillText) { ctx.fillStyle = PAL.acc; ctx.font = "700 10px system-ui, sans-serif"; ctx.fillText("height today", W * 0.30 - 24, H * 0.08); ctx.fillText("weight today", W * 0.60, H * 0.86); }
      return;
    }
    ctx.beginPath(); ctx.moveTo(W * 0.14, H * 0.62); ctx.lineTo(W * 0.86, H * 0.58); ctx.stroke();
    ctx.strokeStyle = PAL.acc; ctx.beginPath(); ctx.moveTo(W * 0.50, H * 0.10); ctx.lineTo(W * 0.54, H * 0.60); ctx.stroke();
    ctx.strokeStyle = PAL.warn; ctx.beginPath(); ctx.arc(W * 0.54, H * 0.60, 34, -1.35, -0.45); ctx.stroke();
    if (ctx.fillText) { ctx.fillStyle = PAL.warn; ctx.font = "700 10px system-ui, sans-serif"; ctx.fillText("angle 20 deg or less", W * 0.56, H * 0.30); ctx.fillStyle = PAL.text; ctx.fillText("sample volume", W * 0.56, H * 0.66); }
    ctx.fillStyle = PAL.warn; ctx.fillRect(W * 0.52, H * 0.56, 7, 7);
  }
  function drawEcg(ctx, phase, W, y0, H) {
    ctx.fillStyle = "#08100c"; ctx.fillRect(0, y0, W, H);
    ctx.strokeStyle = PAL.ecg; ctx.lineWidth = 1.6; ctx.beginPath();
    for (var x = 0; x < W; x += 2) { var ph = (x / W + phase) % 1; var y = y0 + H * 0.62 - ecg(ph) * H * 0.42; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    if (ctx.fillText) { ctx.fillStyle = PAL.wallDim; ctx.font = "600 9px system-ui, sans-serif"; ctx.fillText("ECG: one clock for image, Doppler and trace", 8, y0 + 12); }
  }
  function render(ctx, id, phase, W, H) {
    var fig = get(id); if (!fig || !ctx) return null;
    W = W || 320; H = H || 210;
    var imgH = Math.round(H * 0.78), ecgH = H - imgH;
    var d = data();
    ctx.save();
    if (fig.kind === "wmsi") drawWmsi(ctx, W, imgH);
    else if (fig.kind === "pathway") drawPathway(ctx, fig, W, imgH);
    else if (fig.kind === "body" || fig.kind === "physics") drawBodyPhysics(ctx, fig, W, imgH);
    else if (fig.wave) drawWave(ctx, fig, phase, W, imgH);
    else {
      drawSector(ctx, W, imgH);
      var view = d && d.views[fig.view || fig.ref];
      if (view) drawChambers(ctx, view, contraction(phase), W, imgH, fig);
      ctx.restore(); ctx.save();
    }
    /* place sample volume or cursor exactly at the measurement site */
    if (fig.wave && (fig.kind === "doppler" || fig.kind === "resp")) {
      ctx.strokeStyle = PAL.warn; ctx.lineWidth = 1.2;
    }
    ctx.restore();
    drawEcg(ctx, phase, W, imgH, ecgH);
    return { id: id, phaseName: phaseName(fig, phase) };
  }
  var API = { get: get, render: render, ecg: ecg, contraction: contraction, phaseName: phaseName, palette: PAL };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.KCALC_FIG = API;
})(typeof window !== "undefined" ? window : this);
