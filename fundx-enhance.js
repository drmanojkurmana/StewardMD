/* fundx-enhance.js — FundX AI · image-enhancement pipeline (pure, provider-agnostic).
 *
 * Produces the ENHANCED image persisted alongside the original in every ScanRecord.
 * Operates on ImageData-like { data:Uint8ClampedArray(w*h*4), width, height } and returns
 * a NEW object (the original is never mutated — the raw capture is always preserved).
 *
 * Modular pipeline of independent stages (each optional/config-gated), behind an
 * IEnhancer seam: registerEnhancer(impl) swaps the whole enhancer for a real model
 * (e.g. a super-resolution / denoise network, on-device or cloud) with NO change to the
 * capture flow, UI, or data contracts. DOM-free ⇒ headless-testable; the browser wrapper
 * (decode dataURL → enhance → re-encode) lives in the UI layer.
 *
 * Exposed as window.SMD_FUNDX_ENHANCE.
 */
(function () {
  "use strict";
  var VERSION = "0.1.0";
  function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function cloneImg(img) { var d = new Uint8ClampedArray(img.data.length); d.set(img.data); return { data: d, width: img.width, height: img.height }; }
  function luma(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  // ---- stages (each: (img, opts) => void, mutating img.data in place) -----
  var stages = {
    // Gray-world white balance — neutralises colour cast.
    grayWorld: function (img) {
      var d = img.data, n = d.length, sr = 0, sg = 0, sb = 0, c = n / 4;
      for (var i = 0; i < n; i += 4) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; }
      var mr = sr / c, mg = sg / c, mb = sb / c, gray = (mr + mg + mb) / 3 || 1;
      var kr = gray / (mr || 1), kg = gray / (mg || 1), kb = gray / (mb || 1);
      for (var j = 0; j < n; j += 4) { d[j] = clampByte(d[j] * kr); d[j + 1] = clampByte(d[j + 1] * kg); d[j + 2] = clampByte(d[j + 2] * kb); }
    },
    // Percentile contrast stretch + optional gamma (gamma<1 brightens low-light).
    contrastGamma: function (img, opts) {
      opts = opts || {}; var d = img.data, n = d.length;
      var hist = new Float64Array(256), tot = n / 4, i;
      for (i = 0; i < n; i += 4) hist[Math.round(luma(d[i], d[i + 1], d[i + 2]))]++;
      var clip = (opts.clip != null ? opts.clip : 0.02) * tot, acc = 0, lo = 0, hi = 255;
      for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= clip) { lo = i; break; } }
      acc = 0; for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= clip) { hi = i; break; } }
      var range = (hi - lo) || 1, gamma = opts.gamma != null ? opts.gamma : 0.95, inv = 1 / gamma;
      for (i = 0; i < n; i += 4) {
        for (var k = 0; k < 3; k++) {
          var v = (d[i + k] - lo) / range; if (v < 0) v = 0; else if (v > 1) v = 1;
          d[i + k] = clampByte(Math.pow(v, inv) * 255);
        }
      }
    },
    // Light denoise: blend a 3x3 box mean with the original (strength 0..1).
    denoise: function (img, opts) {
      opts = opts || {}; var s = opts.strength != null ? opts.strength : 0.25;
      var w = img.width, h = img.height, src = img.data, out = new Uint8ClampedArray(src.length); out.set(src);
      for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
        var o = (y * w + x) * 4;
        for (var k = 0; k < 3; k++) {
          var sum = 0;
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) sum += src[((y + dy) * w + (x + dx)) * 4 + k];
          out[o + k] = clampByte(src[o + k] * (1 - s) + (sum / 9) * s);
        }
      }
      src.set(out);
    },
    // Unsharp mask: out = px + amount*(px - blur3x3). Recovers perceived sharpness.
    unsharp: function (img, opts) {
      opts = opts || {}; var amt = opts.amount != null ? opts.amount : 0.6;
      var w = img.width, h = img.height, src = img.data, blur = new Float32Array(src.length);
      for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
        var o = (y * w + x) * 4;
        for (var k = 0; k < 3; k++) {
          var sum = 0;
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) sum += src[((y + dy) * w + (x + dx)) * 4 + k];
          blur[o + k] = sum / 9;
        }
      }
      for (var y2 = 1; y2 < h - 1; y2++) for (var x2 = 1; x2 < w - 1; x2++) {
        var oo = (y2 * w + x2) * 4;
        for (var kk = 0; kk < 3; kk++) src[oo + kk] = clampByte(src[oo + kk] + amt * (src[oo + kk] - blur[oo + kk]));
      }
    },
    // Reflection/glare suppression: pull specular highlights toward a 5x5 local mean.
    reflectionSuppress: function (img, opts) {
      opts = opts || {}; var thr = opts.thr != null ? opts.thr : 244, r = 2;
      var w = img.width, h = img.height, src = img.data, out = new Uint8ClampedArray(src.length); out.set(src);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var o = (y * w + x) * 4, lum = luma(src[o], src[o + 1], src[o + 2]);
        var mx = Math.max(src[o], src[o + 1], src[o + 2]), mn = Math.min(src[o], src[o + 1], src[o + 2]);
        var sat = mx <= 0 ? 0 : (mx - mn) / mx;
        if (lum > thr && sat < 0.12) {
          for (var k = 0; k < 3; k++) {
            var sum = 0, cnt = 0;
            for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
              var yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
              var oo = (yy * w + xx) * 4; if (luma(src[oo], src[oo + 1], src[oo + 2]) <= thr) { sum += src[oo + k]; cnt++; }
            }
            if (cnt) out[o + k] = clampByte(src[o + k] * 0.3 + (sum / cnt) * 0.7);
          }
        }
      }
      src.set(out);
    }
  };

  var DEFAULT_PIPELINE = ["reflectionSuppress", "denoise", "grayWorld", "contrastGamma", "unsharp"];

  // Default IEnhancer: run the configured pipeline on a clone.
  var defaultEnhancer = {
    id: "pipeline",
    version: VERSION,
    enhance: function (img, opts) {
      opts = opts || {}; var out = cloneImg(img);
      var pipe = opts.pipeline || DEFAULT_PIPELINE;
      pipe.forEach(function (name) { if (stages[name] && opts[name] !== false) stages[name](out, opts[name] || opts); });
      return out;
    }
  };
  var _enhancer = defaultEnhancer;

  function contrastOf(img) {
    var d = img.data, n = d.length, s = 0, sq = 0, c = n / 4;
    for (var i = 0; i < n; i += 4) { var l = luma(d[i], d[i + 1], d[i + 2]); s += l; sq += l * l; }
    var m = s / c; return Math.sqrt(Math.max(0, sq / c - m * m));
  }

  var API = {
    VERSION: VERSION,
    DEFAULT_PIPELINE: DEFAULT_PIPELINE,
    stages: stages,
    enhance: function (img, opts) { return _enhancer.enhance(img, opts); },
    registerEnhancer: function (impl) { _enhancer = impl || defaultEnhancer; return _enhancer; },
    getEnhancer: function () { return _enhancer; },
    // QA/telemetry: contrast stddev before/after (used by tests + quality metadata).
    metricsDelta: function (before, after) { return { contrastBefore: contrastOf(before), contrastAfter: contrastOf(after) }; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_FUNDX_ENHANCE = API;
})();
