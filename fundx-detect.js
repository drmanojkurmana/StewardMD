/* fundx-detect.js — FundX AI · perception layer (browser-side detectors + camera).
 *
 * Feeds the pure Vision Engine (fundx-vision.js) with per-frame FrameAnalysis objects.
 * Split from fundx-vision.js so the engine stays DOM-free/testable while the parts that
 * genuinely need the browser (canvas pixels, getUserMedia, MediaPipe) live here.
 *
 * Detection sources, each behind a clean seam so real models swap in with no change to
 * the engine, the UI, or the data contracts:
 *   - Heuristic (REAL, pure pixel math)  — focus, exposure, brightness, contrast,
 *     reflection, red-reflex. Fully headless-testable.
 *   - MediaPipe (REAL, lazy)             — eye presence, pupil centering, phone→eye
 *     distance, motion. Loads @mediapipe/tasks-vision from a configurable assetBase
 *     (local vendored copy preferred; CDN fallback). If it cannot load, available()
 *     is false and guidance degrades gracefully to heuristic-only.
 *   - SimRetina (SIMULATED, swappable)   — live retina/disc/macula/FOV presence, so the
 *     guided flow can reach Capture-Ready before a real on-device retina detector exists.
 *     Replaceable via DetectorHub.setRetinaSignalProvider(fn).
 *
 * Exposed as window.SMD_FUNDX_DETECT. Additive; only referenced by the flag-gated UI.
 */
(function () {
  "use strict";

  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (n !== n ? 0 : n); }

  // ---- Heuristic detector (pure) -----------------------------------------
  // Operates on an ImageData-like { data:Uint8ClampedArray(w*h*4), width, height }.
  // Analyses a centered square region (the fundus sits centrally through the lens).
  var Heuristic = {
    // Return {focus, brightness, exposure, contrast, reflection, redReflex} in [0,1].
    analyze: function (img, opts) {
      opts = opts || {};
      var w = img.width, h = img.height, data = img.data;
      if (!w || !h || !data) return { focus: 0, brightness: 0, exposure: 0, contrast: 0, reflection: 1, redReflex: 0 };
      var frac = opts.regionFrac || 0.7;
      var rw = Math.max(2, Math.floor(w * frac)), rh = Math.max(2, Math.floor(h * frac));
      var x0 = (w - rw) >> 1, y0 = (h - rh) >> 1;
      // grayscale of region + running stats
      var gray = new Float32Array(rw * rh);
      var sum = 0, sumSq = 0, clip = 0, specular = 0, redAcc = 0, brightAcc = 0, n = rw * rh;
      for (var y = 0; y < rh; y++) {
        for (var x = 0; x < rw; x++) {
          var si = ((y0 + y) * w + (x0 + x)) * 4;
          var r = data[si], g = data[si + 1], b = data[si + 2];
          var lum = 0.299 * r + 0.587 * g + 0.114 * b;
          gray[y * rw + x] = lum;
          sum += lum; sumSq += lum * lum;
          if (lum < 8 || lum > 247) clip++;
          // specular = very bright AND low colour saturation (glare, not fundus glow)
          var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          var sat = mx <= 0 ? 0 : (mx - mn) / mx;
          if (lum > 240 && sat < 0.12) specular++;
          // red-reflex proxy: warm (R dominant) and bright
          redAcc += (r - (g + b) / 2);
          brightAcc += lum;
        }
      }
      var mean = sum / n;
      var variance = Math.max(0, sumSq / n - mean * mean);
      // Laplacian variance for focus (4-neighbour), skip borders
      var lapSum = 0, lapSumSq = 0, lapN = 0;
      for (var yy = 1; yy < rh - 1; yy++) {
        for (var xx = 1; xx < rw - 1; xx++) {
          var c = gray[yy * rw + xx];
          var lap = (gray[(yy - 1) * rw + xx] + gray[(yy + 1) * rw + xx] + gray[yy * rw + (xx - 1)] + gray[yy * rw + (xx + 1)]) - 4 * c;
          lapSum += lap; lapSumSq += lap * lap; lapN++;
        }
      }
      var lapVar = lapN ? Math.max(0, lapSumSq / lapN - (lapSum / lapN) * (lapSum / lapN)) : 0;
      var focus = clamp01(lapVar / (lapVar + 120));                    // saturating; K tuned on-device
      var brightness = clamp01(mean / 255);
      var band = 1 - Math.min(1, Math.abs(mean - 130) / 130);          // peaks at mid brightness
      var exposure = clamp01((1 - Math.min(1, (clip / n) * 3)) * (0.4 + 0.6 * band));
      var contrast = clamp01(Math.sqrt(variance) / 90);
      var reflection = clamp01((specular / n) * 6);
      var redReflex = clamp01(((redAcc / n) / 90) * (0.4 + 0.6 * (brightAcc / n / 255)) * 1.6);
      return { focus: focus, brightness: brightness, exposure: exposure, contrast: contrast, reflection: reflection, redReflex: redReflex };
    },
    // Circular fundus appearance — the observed illuminated retinal field seen through ANY
    // indirect lens (power-agnostic: 20D/28D/40D all present as a warm, roughly circular
    // central glow). Returns visibility + circularity + centre offset + size.
    fundus: function (img) {
      var w = img.width, h = img.height, data = img.data;
      if (!w || !h || !data) return { fundusVisible: false, fundusConf: 0, fundusCircularity: 0, fundusCenter: null, fundusSize: 0 };
      var n = w * h, cx = 0, cy = 0, cnt = 0, i, x, y, r, g, b, lum, warm;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = (y * w + x) * 4; r = data[i]; g = data[i + 1]; b = data[i + 2]; lum = 0.299 * r + 0.587 * g + 0.114 * b; warm = r - (g + b) / 2; if (lum > 40 && lum < 250 && warm > 16) { cx += x; cy += y; cnt++; } }
      if (cnt < n * 0.03) return { fundusVisible: false, fundusConf: clamp01(cnt / (n * 0.03)) * 0.3, fundusCircularity: 0, fundusCenter: null, fundusSize: 0 };
      cx /= cnt; cy /= cnt;
      var rg2 = 0, dx, dy;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = (y * w + x) * 4; r = data[i]; g = data[i + 1]; b = data[i + 2]; lum = 0.299 * r + 0.587 * g + 0.114 * b; warm = r - (g + b) / 2; if (lum > 40 && lum < 250 && warm > 16) { dx = x - cx; dy = y - cy; rg2 += dx * dx + dy * dy; } }
      var rg = Math.sqrt(rg2 / cnt), rArea = Math.sqrt(cnt / Math.PI), frac = cnt / n;
      var circ = clamp01(1 - Math.abs(rg * Math.SQRT2 - rArea) / (rArea || 1));   // 1 when a filled disk
      var size = clamp01(2 * rArea / Math.min(w, h));
      var conf = clamp01(Math.min(1, frac / 0.15) * (0.5 + 0.5 * circ));
      function sgn(v) { return v < -1 ? -1 : v > 1 ? 1 : (v !== v ? 0 : v); }
      return { fundusVisible: frac >= 0.04 && circ >= 0.35 && size > 0.2, fundusConf: conf, fundusCircularity: circ, fundusCenter: { x: sgn((cx - w / 2) / (w / 2)), y: sgn((cy - h / 2) / (h / 2)) }, fundusSize: size };
    },
    // Vessel-like structure — dark curvilinear ridges (green channel) in the central field.
    vessels: function (img, opts) {
      var w = img.width, h = img.height, data = img.data;
      if (!w || !h || !data) return 0;
      var frac = (opts && opts.regionFrac) || 0.6, rw = Math.max(4, Math.floor(w * frac)), rh = Math.max(4, Math.floor(h * frac)), x0 = (w - rw) >> 1, y0 = (h - rh) >> 1;
      function grn(px, py) { return data[((y0 + py) * w + (x0 + px)) * 4 + 1]; }
      var gradSum = 0, darkCnt = 0, tot = (rw - 2) * (rh - 2), x, y, c, l, r, u, d, nb;
      for (y = 1; y < rh - 1; y++) for (x = 1; x < rw - 1; x++) {
        c = grn(x, y); l = grn(x - 1, y); r = grn(x + 1, y); u = grn(x, y - 1); d = grn(x, y + 1);
        gradSum += Math.abs(r - l) + Math.abs(d - u);          // region-wide edge energy
        nb = (l + r + u + d) / 4; if (c < nb - 6) darkCnt++;   // dark curvilinear ridge pixels
      }
      if (!tot) return 0;
      var meanGrad = gradSum / tot, density = darkCnt / tot;
      return clamp01((meanGrad / 25) * 0.6 + (density / 0.15) * 0.4);
    }
  };

  // ---- Phone pose (roll) — real, from device orientation -----------------
  // Roll drives "rotate clockwise / counter-clockwise" coaching. Uses the deviceorientation
  // gamma (left-right tilt) as the roll proxy. If no sensor/events (web/desktop), roll stays
  // null → rollState "unknown" → the engine's "level" gate is a no-op (never blocks).
  function makePose() {
    var roll = null, attached = false;
    function onOrient(e) { if (e && e.gamma != null) roll = e.gamma; }
    return {
      attach: function () {
        if (attached || typeof window === "undefined" || !window.addEventListener) return;
        try {
          // iOS 13+ needs a permission grant (best-effort; ignored elsewhere).
          if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) { try { DeviceOrientationEvent.requestPermission().catch(function () {}); } catch (e) {} }
          window.addEventListener("deviceorientation", onOrient, true); attached = true;
        } catch (e) {}
      },
      detach: function () { if (!attached) return; try { window.removeEventListener("deviceorientation", onOrient, true); } catch (e) {} attached = false; },
      reset: function () { roll = null; },
      read: function () {
        if (roll == null) return { roll: null, rollState: "unknown" };
        return { roll: roll, rollState: Math.abs(roll) <= 12 ? "level" : (roll > 0 ? "cw" : "ccw") };
      }
    };
  }

  // ---- MediaPipe adapter (lazy, graceful) --------------------------------
  // Real eye/pupil/distance/motion from FaceLandmarker (refined landmarks incl. iris).
  // Cannot be exercised headlessly; guarded so any failure => available()===false.
  function makeMediaPipe() {
    var landmarker = null, ready = false, failed = false, loading = null, prev = null;
    var CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
    var LOCAL = "/assets/vendor/mediapipe";   // vendored assets (offline); shipped by build-www.sh
    // Candidate asset roots, tried in order until one loads. An explicit override
    // (SMD_FUNDX_DETECT.mediapipeAssetBase) wins outright with no fallback; otherwise prefer
    // the vendored LOCAL copy (works offline / no CDN dependency) and fall back to the CDN.
    function assetBases() {
      try { if (window.SMD_FUNDX_DETECT && window.SMD_FUNDX_DETECT.mediapipeAssetBase) return [window.SMD_FUNDX_DETECT.mediapipeAssetBase]; } catch (e) {}
      return [LOCAL, CDN];
    }
    async function loadFrom(base) {
      var mod = await import(base + "/vision_bundle.mjs");
      var files = await mod.FilesetResolver.forVisionTasks(base + "/wasm");
      landmarker = await mod.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: base + "/face_landmarker.task", delegate: "GPU" },
        runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: false
      });
    }
    function load() {
      if (ready || failed) return Promise.resolve(ready);
      if (loading) return loading;
      loading = (async function () {
        var cands = assetBases(), lastErr = null;
        for (var i = 0; i < cands.length; i++) {
          try { await loadFrom(cands[i]); ready = true; return true; }
          catch (e) { lastErr = e; landmarker = null; try { console.warn("[FundX] MediaPipe load failed from " + cands[i] + " — " + (e && e.message)); } catch (_) {} }
        }
        failed = true; ready = false;
        try { console.warn("[FundX] MediaPipe unavailable — heuristic-only guidance.", lastErr && lastErr.message); } catch (_) {}
        return false;
      })();
      return loading;
    }
    function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
    return {
      available: function () { return ready; },
      failed: function () { return failed; },
      init: load,
      reset: function () { prev = null; },
      // videoOrCanvas + timestamp(ms). Returns eye/pupil/distance/motion partial, or {} if N/A.
      analyze: function (src, tsMs) {
        if (!ready || !landmarker) return {};
        try {
          var res = landmarker.detectForVideo(src, tsMs);
          var faces = res && res.faceLandmarks; if (!faces || !faces.length) { prev = null; return { eyePresent: false, eyeConf: 0 }; }
          var lm = faces[0];
          // iris centres (refined-landmark indices): right ~468, left ~473
          var rIris = lm[468] || lm[159], lIris = lm[473] || lm[386];
          var eyeCenter = { x: (lm[33].x + lm[263].x) / 2, y: (lm[33].y + lm[263].y) / 2 };  // outer canthi midpoint
          var pupil = { x: (rIris.x + lIris.x) / 2, y: (rIris.y + lIris.y) / 2 };
          var eyeWidth = dist(lm[33], lm[263]) || 0.2;
          var offx = (pupil.x - eyeCenter.x) / (eyeWidth / 2);
          var offy = (pupil.y - eyeCenter.y) / (eyeWidth / 2);
          var pupilOffset = clamp01(Math.sqrt(offx * offx + offy * offy));
          var irisW = dist(rIris, lIris);                     // proxy inversely related to distance
          var distanceState = irisW > 0.42 ? "near" : (irisW < 0.24 ? "far" : "ok");
          var motion = 0.05;
          if (prev) { motion = clamp01(dist(pupil, prev) * 12); }
          prev = pupil;
          return {
            eyePresent: true, eyeConf: clamp01(0.7 + 0.3 * Math.min(1, eyeWidth * 2)),
            pupilCentered: pupilOffset <= 0.22, pupilOffset: pupilOffset,
            pupilDir: { x: offx, y: offy },
            distanceState: distanceState, motion: motion
          };
        } catch (e) { return {}; }
      }
    };
  }

  // ---- DetectorHub --------------------------------------------------------
  // Merges heuristic + MediaPipe + retina-signal partials into ONE FrameAnalysis via
  // the engine's makeFrameAnalysis. Retina-signal provider is swappable.
  function makeHub(opts) {
    opts = opts || {};
    var V = window.SMD_FUNDX_VISION;
    var mp = opts.mediapipe || makeMediaPipe();
    var pose = opts.pose || makePose();
    // Sensor-fusion (Phase 1: IMU). Active only when SMD_FUNDX_SENSORS is present AND the flag
    // is on (or an explicit manager is injected). Absent -> the merged partial is untouched ->
    // the engine behaves EXACTLY as before. Native depth (Phase 2) enters via this same manager.
    var sensors = opts.sensors ||
      ((window.SMD_FUNDX_SENSORS && window.SMD_FUNDX_SENSORS.flagOn && window.SMD_FUNDX_SENSORS.flagOn())
        ? window.SMD_FUNDX_SENSORS.makeManager(opts.sensorOpts || {}) : null);
    // Optional real disc/macula/lesion provider (findings-level enrichment; NOT a capture
    // gate). Left null by default — the acquisition flow is driven purely by observable
    // image-quality cues (fundus circle + vessels + focus/exposure/glare), no simulation.
    var retinaProvider = null;
    return {
      mediapipe: mp, pose: pose, sensors: sensors,
      setRetinaSignalProvider: function (fn) { retinaProvider = (typeof fn === "function") ? fn : null; },
      resetSession: function () { if (mp && mp.reset) mp.reset(); if (pose && pose.reset) pose.reset(); if (sensors && sensors.reset) sensors.reset(); },
      // parts: { imageData, mpPartial?, posePartial?, ts }. Builds a full FrameAnalysis from
      // observable signals: image heuristics + circular-fundus + vessels + MediaPipe geometry
      // + phone roll. No lens detection anywhere.
      build: function (parts) {
        parts = parts || {};
        var h = parts.imageData ? Heuristic.analyze(parts.imageData, opts) : {};
        var fund = parts.imageData ? Heuristic.fundus(parts.imageData, opts) : {};
        var vess = parts.imageData ? Heuristic.vessels(parts.imageData, opts) : 0;
        var mpPart = parts.mpPartial || {};
        var posePart = parts.posePartial || {};
        var merged = Object.assign({ ts: parts.ts != null ? parts.ts : null, vesselScore: vess }, h, fund, mpPart, posePart);
        // Fuse device-motion sensor signals over the monocular partial (motion + confidence).
        // read() treats merged.motion as one source, so with no sensor data motion is unchanged.
        if (sensors && sensors.read) { try { Object.assign(merged, sensors.read(merged) || {}); } catch (e) {} }
        if (retinaProvider) { try { Object.assign(merged, retinaProvider(merged) || {}); } catch (e) {} }
        return V ? V.makeFrameAnalysis(merged) : merged;
      }
    };
  }

  // ---- Camera controller (browser-only; verified on-device) --------------
  // Live preview via getUserMedia → <video> → throttled offscreen-canvas frame grab →
  // DetectorHub → onFrame(FrameAnalysis). Also captures a short best-frame burst on
  // demand. Never blocks the paint path (analysis throttled to analyzeEveryMs).
  function makeCamera() {
    var stream = null, videoEl = null, canvas = null, cctx = null, raf = 0, running = false;
    var hub = null, onFrame = null, lastAnalyze = 0, opts = {};
    function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
    function grab(scale) {
      if (!videoEl || !videoEl.videoWidth) return null;
      var vw = videoEl.videoWidth, vh = videoEl.videoHeight;
      var sc = scale || 1;
      canvas.width = Math.max(2, Math.round(vw * sc)); canvas.height = Math.max(2, Math.round(vh * sc));
      cctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      return canvas;
    }
    function loop() {
      if (!running) return;
      var t = now();
      if (t - lastAnalyze >= (opts.analyzeEveryMs || 120)) {
        lastAnalyze = t;
        try {
          var c = grab(opts.analyzeScale || 0.25);
          if (c) {
            var img = cctx.getImageData(0, 0, c.width, c.height);
            var mpPart = (hub && hub.mediapipe && hub.mediapipe.available()) ? hub.mediapipe.analyze(videoEl, t) : {};
            var posePart = (hub && hub.pose && hub.pose.read) ? hub.pose.read() : {};
            var fa = hub.build({ imageData: img, mpPartial: mpPart, posePartial: posePart, ts: t });
            if (onFrame) onFrame(fa);
          }
        } catch (e) {}
      }
      raf = requestAnimationFrame(loop);
    }
    return {
      isRunning: function () { return running; },
      start: function (video, cb, o) {
        opts = o || {}; onFrame = cb; videoEl = video;
        hub = opts.hub || makeHub(opts);
        if (!canvas) { canvas = document.createElement("canvas"); cctx = canvas.getContext("2d", { willReadFrequently: true }); }
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: opts.facingMode || "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
          .then(function (s) {
            stream = s; videoEl.srcObject = s; videoEl.setAttribute("playsinline", ""); videoEl.muted = true;
            return videoEl.play().catch(function () {});
          })
          .then(function () {
            running = true; lastAnalyze = 0;
            if (hub.pose && hub.pose.attach) hub.pose.attach();   // phone-roll for rotate coaching
            if (hub.sensors && hub.sensors.start) hub.sensors.start();   // IMU fusion (Phase 1)
            if (hub.resetSession) hub.resetSession();
            if (hub.mediapipe && hub.mediapipe.init) hub.mediapipe.init();   // lazy, non-blocking
            raf = requestAnimationFrame(loop);
            return { hub: hub };
          });
      },
      // Capture a best-frame burst: grab N full-res frames, score, return dataURLs + metrics.
      captureBurst: function (count) {
        count = count || 12; var frames = [];
        for (var i = 0; i < count; i++) {
          var c = grab(1);
          if (!c) break;
          var img = cctx.getImageData(0, 0, c.width, c.height);
          var h = Heuristic.analyze(img, opts);
          var fund = Heuristic.fundus(img);
          h.fundusConf = fund.fundusConf; h.fundusSize = fund.fundusSize; h.fundusCircularity = fund.fundusCircularity;
          h.vesselScore = Heuristic.vessels(img, opts);
          frames.push({ dataUrl: c.toDataURL("image/jpeg", 0.9), metrics: h, w: c.width, h: c.height });
        }
        return frames;
      },
      stop: function () {
        running = false; if (raf) cancelAnimationFrame(raf); raf = 0;
        try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        try { if (videoEl) videoEl.srcObject = null; } catch (e) {}
        try { if (hub && hub.pose && hub.pose.detach) hub.pose.detach(); } catch (e) {}
        try { if (hub && hub.sensors && hub.sensors.stop) hub.sensors.stop(); } catch (e) {}
        stream = null;
      }
    };
  }

  var API = {
    Heuristic: Heuristic,
    makePose: makePose,
    makeMediaPipe: makeMediaPipe,
    makeHub: makeHub,
    makeCamera: makeCamera,
    mediapipeAssetBase: null   // default tries vendored /assets/vendor/mediapipe then CDN; set to force ONE root
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_FUNDX_DETECT = API;
})();
