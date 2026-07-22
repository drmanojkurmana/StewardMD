/* kardiox-digitize.js — KardioX AI · ON-DEVICE ECG digitiser (SMD_KARDIOX_DIGITIZE).
 *
 * Image (photo/scan of a paper ECG) → per-lead calibrated-mV windows, ENTIRELY on-device (no server, no
 * PHI upload, no model download). A faithful JS port of the backend classical digitiser
 * (backend/kardiox/app/services/digitization.py digitize_auto): binarize → autodetect print layout
 * (3x4+rhythm / 6x2 / 12x1) from ink row/column bands → per-column ink centre-line per lead cell → px→mV
 * via grid-autocorrelation (else geometry). Emits the reconstruction-layer format
 * { leads:{name:{mv,fs}}, rhythmLead, layoutHint, calibration } that SMD_KARDIOX_RECONSTRUCT consumes,
 * which places each lead at its true column time-offset, masks the unprinted portion, and gates a dense
 * 12-lead ONLY at full coverage — it NEVER stitches the 2.5 s cells into a fake continuous trace.
 *
 * HONEST SCOPE: the classical column-scan recovers TIMING (rate/rhythm) well but NOT calibrated
 * amplitudes → amplitudeReliable:false (ST/axis/LVH deferred; the ensemble z-norms so rhythm/conduction
 * are robust). Works on clean/flat images; crumpled real-photo robustness needs the learned nnU-Net
 * digitiser (a later, hardware-gated increment). Pure pixel math — the core is DOM-free + unit-testable;
 * only digitize() touches the canvas.
 */
(function () {
  "use strict";

  var MM_PER_S = 25.0, MM_PER_MV = 10.0, FS = 500, MIN_LEADS = 3;
  var STD12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
  var LAYOUT_GRID = {
    "3x4": [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]],
    "6x2": [["I", "V1"], ["II", "V2"], ["III", "V3"], ["aVR", "V4"], ["aVL", "V5"], ["aVF", "V6"]],
    "12x1": STD12.map(function (l) { return [l]; })
  };
  var LAYOUT_CELL_S = { "3x4": 2.5, "6x2": 5.0, "12x1": 10.0 };

  function err(code, message) { var e = new Error(message); e.code = code; e.stage = "digitization"; return e; }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : 0; }

  // RGBA/gray pixels → a flat Uint8 grayscale (row-major) + boolean ink (gray < 128).
  function toGrayInk(img) {
    var W = img.width | 0, H = img.height | 0, d = img.data, N = W * H;
    if (!W || !H || !d) throw err("bad_image", "empty image data");
    var gray = new Uint8Array(N), ink = new Uint8Array(N), i;
    if (d.length === N * 4) { for (i = 0; i < N; i++) { var g = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000; gray[i] = g; ink[i] = g < 128 ? 1 : 0; } }
    else if (d.length === N) { for (i = 0; i < N; i++) { gray[i] = d[i]; ink[i] = d[i] < 128 ? 1 : 0; } }
    else throw err("bad_image", "pixel buffer " + d.length + " != " + N + " (gray) or " + N * 4 + " (rgba)");
    return { W: W, H: H, gray: gray, ink: ink };
  }

  // Per-column ink centre-line over a sub-rect [x0,y0,w,h]; NaN columns linearly interpolated. null if blank.
  function extractTrace(ink, W, x0, y0, w, h) {
    var ys = new Float64Array(w), valid = 0, j, i;
    for (j = 0; j < w; j++) {
      var sum = 0, n = 0;
      for (i = 0; i < h; i++) { if (ink[(y0 + i) * W + (x0 + j)]) { sum += i; n++; } }
      if (n) { ys[j] = sum / n; valid++; } else ys[j] = NaN;
    }
    if (valid < Math.max(2, Math.floor(w / 10))) return null;
    // linear interpolation across NaN gaps
    var lastI = -1, lastV = NaN;
    for (j = 0; j < w; j++) {
      if (!isNaN(ys[j])) {
        if (lastI >= 0 && j - lastI > 1) { var span = j - lastI; for (var k = lastI + 1; k < j; k++) ys[k] = lastV + (ys[j] - lastV) * (k - lastI) / span; }
        lastI = j; lastV = ys[j];
      }
    }
    for (j = 0; j < w && isNaN(ys[j]); j++) ys[j] = lastV;                 // leading NaNs → first valid
    if (lastI >= 0) for (j = lastI + 1; j < w; j++) if (isNaN(ys[j])) ys[j] = lastV; // trailing NaNs
    return ys;
  }

  // Grid period (px/mm) via autocorrelation of the column projection; null if no periodic grid survives.
  function estimatePxPerMm(gray, W, H) {
    var proj = new Float64Array(W), x, y, mean = 0;
    for (x = 0; x < W; x++) { var s = 0; for (y = 0; y < H; y++) s += gray[y * W + x]; proj[x] = s / H; mean += proj[x]; }
    mean /= W; for (x = 0; x < W; x++) proj[x] -= mean;
    var ac0 = 0; for (x = 0; x < W; x++) ac0 += proj[x] * proj[x];
    if (ac0 <= 0) return null;
    var maxLag = Math.min(40, W), ac = new Float64Array(maxLag + 2);
    for (var lag = 0; lag <= maxLag; lag++) { var a = 0; for (x = 0; x + lag < W; x++) a += proj[x] * proj[x + lag]; ac[lag] = a / ac0; }
    for (lag = 3; lag < maxLag; lag++) if (ac[lag] > 0.5 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) return lag;
    return null;
  }

  // Count contiguous horizontal trace bands → layout; detect a full-width bottom rhythm strip.
  function detectLayout(ink, W, H) {
    var rowink = new Float64Array(H), y, x, mean = 0;
    for (y = 0; y < H; y++) { var s = 0; for (x = 0; x < W; x++) s += ink[y * W + x]; rowink[y] = s / W; mean += rowink[y]; }
    mean /= H; var thr = Math.max(mean * 0.5, 0.002);
    var bands = [], inb = false, start = 0;
    for (y = 0; y < H; y++) {
      if (rowink[y] > thr && !inb) { inb = true; start = y; }
      else if (rowink[y] <= thr && inb) { inb = false; if (y - start > H * 0.02) bands.push([start, y]); }
    }
    if (inb) bands.push([start, H]);
    var nb = bands.length, hasStrip = false;
    if (nb) {
      var b = bands[nb - 1], cov = 0;
      for (x = 0; x < W; x++) { var c = 0; for (y = b[0]; y < b[1]; y++) c += ink[y * W + x]; if (c / (b[1] - b[0]) > 0.01) cov++; }
      hasStrip = (cov / W) > 0.85 && (nb === 4 || nb === 7 || nb === 13);
    }
    var rows = nb - (hasStrip ? 1 : 0), layout;
    if (rows >= 10) layout = "12x1"; else if (rows === 6) layout = "6x2"; else if (rows === 3) layout = "3x4";
    else layout = rows > 6 ? "12x1" : (rows >= 5 ? "6x2" : "3x4");
    return { layout: layout, rows: rows, hasRhythmStrip: hasStrip };
  }

  // ── the digitiser core (pure; input = {width,height,data(rgba|gray)}) ──
  function digitizeImageData(img, opts) {
    opts = opts || {};
    var gi = toGrayInk(img), W = gi.W, H = gi.H, gray = gi.gray, ink = gi.ink;
    var det = (opts.layoutHint && LAYOUT_GRID[opts.layoutHint]) ? { layout: opts.layoutHint, hasRhythmStrip: opts.layoutHint === "3x4" } : detectLayout(ink, W, H);
    var layout = det.layout, hasStrip = det.hasRhythmStrip;
    var grid = LAYOUT_GRID[layout], nrows = grid.length, ncols = grid[0].length, cellS = LAYOUT_CELL_S[layout];
    var pxPerMm = estimatePxPerMm(gray, W, H), calibMethod = pxPerMm ? "grid" : "geometry";
    var bandH = Math.floor(H * ((layout === "3x4" && hasStrip) ? 0.78 : 1.0) / nrows);
    var cellW = Math.floor(W / ncols);
    if (!pxPerMm) pxPerMm = cellW / (cellS * MM_PER_S);

    function cellToMv(x0, y0, w, h, nSamples) {
      var trace = extractTrace(ink, W, x0, y0, w, h); if (!trace) return null;
      var base = median(Array.prototype.slice.call(trace)), gain = pxPerMm * MM_PER_MV;
      var mv = new Float64Array(trace.length); for (var j = 0; j < trace.length; j++) mv[j] = (base - trace[j]) / gain; // invert: image y grows down
      var out = new Array(nSamples);
      for (var s = 0; s < nSamples; s++) { var pos = (mv.length - 1) * s / (nSamples - 1 || 1), lo = Math.floor(pos), hi = Math.min(lo + 1, mv.length - 1), f = pos - lo; out[s] = Math.round((mv[lo] + (mv[hi] - mv[lo]) * f) * 1e4) / 1e4; }
      return out;
    }

    var leads = {}, r, c;
    for (r = 0; r < nrows; r++) for (c = 0; c < ncols; c++) {
      var mv = cellToMv(c * cellW, r * bandH, cellW, bandH, Math.round(cellS * FS));
      if (mv) leads[grid[r][c]] = { mv: mv, fs: FS };
    }
    var rhythm = null;
    if (hasStrip && layout === "3x4") {
      var ys = Math.floor(H * 0.78), smv = cellToMv(0, ys, W, H - ys, Math.round(10.0 * FS));
      if (smv) { leads["II"] = { mv: smv, fs: FS }; rhythm = "II"; }
    }
    if (Object.keys(leads).length < MIN_LEADS) throw err("layout_undetected", "Only " + Object.keys(leads).length + " readable leads in " + layout + " layout");
    return {
      leads: leads, rhythmLead: rhythm, layoutHint: layout, layout: layout,
      calibration: { mmPerS: MM_PER_S, mmPerMv: MM_PER_MV, pxPerMm: Math.round(pxPerMm * 1e3) / 1e3, method: calibMethod },
      method: "classical-multilayout-ondevice", amplitudeReliable: false
    };
  }

  // ── browser entry: Blob | Canvas | ImageBitmap | HTMLImageElement → digitizeImageData ──
  function toImageData(src) {
    if (src && typeof src.width === "number" && src.data) return Promise.resolve(src);          // already ImageData-like
    if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") return Promise.reject(err("runtime_unavailable", "no canvas to rasterise image"));
    function draw(bmp) {
      var w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
      var cv = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(w, h) : document.createElement("canvas");
      cv.width = w; cv.height = h; var ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, w, h); return ctx.getImageData(0, 0, w, h);
    }
    if (typeof createImageBitmap === "function" && (typeof Blob === "undefined" || src instanceof Blob || (src && src.getContext) || (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) || (src && src.tagName === "IMG")))
      return createImageBitmap(src).then(draw);
    return Promise.resolve(draw(src));
  }
  function digitize(src, opts) { return toImageData(src).then(function (img) { return digitizeImageData(img, opts); }); }

  var API = { digitize: digitize, digitizeImageData: digitizeImageData,
              _diag: { detectLayout: detectLayout, estimatePxPerMm: estimatePxPerMm, extractTrace: extractTrace, toGrayInk: toGrayInk } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_DIGITIZE = API;
})();
