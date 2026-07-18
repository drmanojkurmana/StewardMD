/* fundx-sensors.js — FundX AI · sensor-fusion layer (Phase 1: IMU + orientation).
 *
 * Adds real device-motion signals (W3C DeviceMotion accel+gyro) ON TOP of the monocular
 * acquisition engine, fused into a per-signal {value, confidence}. Purely ADDITIVE and
 * flag-gated (smd_fundx_sensors): when the flag is off, or no motion sensor / permission is
 * available, this module is inert and the engine behaves EXACTLY as before (fallback-identical).
 *
 * Depth/pose from native ARKit/ARCore (Phase 2) plug in as additional adapters through the
 * SAME {value, source, confidence} contract with no change to the engine or UI.
 *
 * Exposed as window.SMD_FUNDX_SENSORS. Headless-testable: capability detection, the IMU
 * adapter (fed synthetic devicemotion events), and the fusion math are pure. Thresholds in CFG
 * need on-device calibration (same philosophy as SMD_FUNDX_VISION.CFG).
 */
(function () {
  "use strict";
  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (n !== n ? 0 : n); }
  function num(n) { n = +n; return n !== n ? 0 : n; }

  var CFG = {
    accelStill: 0.35,   // m/s^2 linear-accel magnitude at/below which the phone reads "still"
    accelMax: 4.0,      // m/s^2 mapped to motion = 1
    gyroStill: 3,       // deg/s rotation-rate at/below which rotation reads "still"
    gyroMax: 60,        // deg/s mapped to motion = 1
    emaAlpha: 0.3,      // smoothing for the motion estimate
    warmSamples: 8,     // samples before the IMU is fully trusted (confidence ramp)
    disagreeMax: 0.6,   // max spread penalty applied to fused confidence
    mpEyeConf: 0.5,     // trust in the monocular (MediaPipe pupil-delta) motion when an eye is seen
    mpNoEyeConf: 0.2,   // ...and when no eye is present (noisier)
    // Phase 2 depth: metric phone->eye working-distance band (needs on-device calibration).
    workingNearM: 0.20, // < this (m) reads "near" (too close)
    workingFarM: 0.55   // > this (m) reads "far"; between = "ok"
  };

  function capabilities(w) {
    w = w || (typeof window !== "undefined" ? window : {});
    var caps = { deviceMotion: false, deviceOrientation: false, motionPermission: "unavailable", nativeDepth: false, nativePose: false };
    try { caps.deviceMotion = ("DeviceMotionEvent" in w); } catch (e) {}
    try { caps.deviceOrientation = ("DeviceOrientationEvent" in w); } catch (e) {}
    try {
      if (caps.deviceMotion) {
        var DME = w.DeviceMotionEvent;
        caps.motionPermission = (DME && typeof DME.requestPermission === "function") ? "prompt" : "granted";
      }
    } catch (e) {}
    try { var P = w.Capacitor && w.Capacitor.Plugins && w.Capacitor.Plugins.FundxDepth; caps.nativeDepth = !!P; caps.nativePose = !!P; } catch (e) {}
    return caps;
  }

  // ---- IMU adapter (W3C DeviceMotion) -------------------------------------
  // Emits a MOTION signal (0 = perfectly still) from max(linear-accel, rotation-rate),
  // EMA-smoothed. Confidence ramps with sample count. No metric distance (Phase 2 depth adds it).
  function makeImuAdapter(w) {
    w = w || (typeof window !== "undefined" ? window : {});
    var attached = false, samples = 0, motionEma = 0, lastRaw = 0;
    function onMotion(e) {
      var a = (e && (e.acceleration || e.accelerationIncludingGravity)) || {};
      var rr = (e && e.rotationRate) || {};
      var am = Math.sqrt(num(a.x) * num(a.x) + num(a.y) * num(a.y) + num(a.z) * num(a.z));
      var rm = Math.sqrt(num(rr.alpha) * num(rr.alpha) + num(rr.beta) * num(rr.beta) + num(rr.gamma) * num(rr.gamma));
      var mAcc = clamp01((am - CFG.accelStill) / (CFG.accelMax - CFG.accelStill));
      var mGyro = clamp01((rm - CFG.gyroStill) / (CFG.gyroMax - CFG.gyroStill));
      var m = Math.max(mAcc, mGyro);   // either translation OR rotation counts as motion
      lastRaw = m;
      motionEma = samples ? (motionEma * (1 - CFG.emaAlpha) + m * CFG.emaAlpha) : m;
      samples++;
    }
    return {
      source: "imu",
      start: function () { if (attached) return; try { w.addEventListener("devicemotion", onMotion, true); attached = true; } catch (e) {} },
      stop: function () { if (!attached) return; try { w.removeEventListener("devicemotion", onMotion, true); } catch (e) {} attached = false; },
      requestPermission: function () {
        try {
          var DME = w.DeviceMotionEvent;
          if (DME && typeof DME.requestPermission === "function") {
            return DME.requestPermission().then(function (r) { return r === "granted"; }, function () { return false; });
          }
        } catch (e) { return Promise.resolve(false); }
        return Promise.resolve(true);
      },
      reset: function () { samples = 0; motionEma = 0; lastRaw = 0; },
      // MOTION signal partial (null until we have data).
      read: function () {
        if (!attached || samples === 0) return null;
        return { motion: { value: clamp01(motionEma), confidence: clamp01(samples / CFG.warmSamples), source: "imu" } };
      },
      _debug: function () { return { attached: attached, samples: samples, motionEma: motionEma, lastRaw: lastRaw }; }
    };
  }

  // ---- Fusion -------------------------------------------------------------
  // sources: [{value, confidence, source}] -> {value, confidence, contributors} or null.
  // value = confidence-weighted mean; confidence = 1 - PROD(1 - conf_i) (independent evidence),
  // reduced by source disagreement so one rogue sensor cannot dominate.
  function fuse(sources) {
    if (!sources || !sources.length) return null;
    var wsum = 0, den = 0, prod = 1, contrib = [], vals = [];
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (!s || s.value == null || s.confidence == null) continue;
      var c = clamp01(s.confidence), v = num(s.value);
      wsum += c * v; den += c; prod *= (1 - c); contrib.push(s.source || ("src" + i)); vals.push(v);
    }
    if (den <= 0) return null;
    var value = wsum / den, conf = clamp01(1 - prod);
    if (vals.length > 1) {
      var mean = 0, k; for (k = 0; k < vals.length; k++) mean += vals[k]; mean /= vals.length;
      var vs = 0; for (k = 0; k < vals.length; k++) vs += (vals[k] - mean) * (vals[k] - mean);
      var sd = Math.sqrt(vs / vals.length);
      conf = clamp01(conf * (1 - Math.min(CFG.disagreeMax, sd)));
    }
    return { value: value, confidence: conf, contributors: contrib };
  }

  // ---- Manager ------------------------------------------------------------
  // Wires the available adapters and fuses their signals with the monocular partial the engine
  // already computes. read(monoPartial) -> the fields the sensors IMPROVE, ready to
  // Object.assign into the partial. Absent sensors -> engine unchanged (fallback-identical).
  // ---- Depth adapter (Phase 2: native ARKit/LiDAR / ARCore Depth via the FundxDepth plugin) ----
  // Talks to Capacitor.Plugins.FundxDepth; emits metric distance + pose in the fusion contract.
  // No-op + available()=false when the plugin is absent (iOS/older devices/web) -> monocular
  // fallback. Frames arrive via the "fundxDepthFrame" event; _push injects one for tests.
  function makeDepthAdapter(opts) {
    opts = opts || {};
    var w = opts.window || (typeof window !== "undefined" ? window : {});
    function plug() { try { return opts.plugin || (w.Capacitor && w.Capacitor.Plugins && w.Capacitor.Plugins.FundxDepth) || null; } catch (e) { return null; } }
    var caps = null, last = null, sub = null, started = false;
    var lat = { frames: 0, sumMs: 0, lastT: 0, fps: 0 };
    function onFrame(s) {
      last = s || null;
      var t = (typeof performance !== "undefined" && performance.now) ? performance.now() : (opts.now ? opts.now() : 0);
      if (lat.lastT && t) { var dt = t - lat.lastT; if (dt > 0) { lat.frames++; lat.sumMs += dt; lat.fps = 1000 / dt; } }
      lat.lastT = t;
    }
    return {
      source: "depth",
      available: function () { return !!(plug() && caps && caps.depth); },
      capabilities: function () { return caps; },
      init: function () {
        var p = plug();
        if (!p || !p.capabilities) { caps = null; return Promise.resolve(false); }
        return p.capabilities().then(function (c) { caps = c || null; return !!(c && c.depth); }, function () { caps = null; return false; });
      },
      start: function (config) {
        var p = plug(); if (!p || !p.start) return;
        try { if (p.addListener && !sub) { sub = p.addListener("fundxDepthFrame", onFrame); } p.start(config || {}); started = true; } catch (e) {}
      },
      stop: function () {
        var p = plug();
        try { if (p && p.stop) p.stop(); } catch (e) {}
        try { if (sub && sub.remove) sub.remove(); } catch (e) {}
        sub = null; started = false;
      },
      reset: function () { last = null; lat = { frames: 0, sumMs: 0, lastT: 0, fps: 0 }; },
      read: function () {
        if (!last) return null;
        var out = {};
        if (last.distanceMeters != null) out.distance = { value: num(last.distanceMeters), confidence: clamp01(last.distanceConfidence != null ? last.distanceConfidence : 0.75), source: "depth", metric: true };
        if (last.roll != null || last.pitch != null) out.pose = { roll: last.roll != null ? num(last.roll) : null, pitch: last.pitch != null ? num(last.pitch) : null, confidence: clamp01(last.poseConfidence != null ? last.poseConfidence : 0.8), source: "depth" };
        return out;
      },
      latency: function () { return { fps: Math.round(lat.fps || 0), avgMs: lat.frames ? Math.round(lat.sumMs / lat.frames) : 0, frames: lat.frames }; },
      _push: onFrame
    };
  }

  function depthFlagOn(w) {
    w = w || (typeof window !== "undefined" ? window : {});
    try {
      var q = ((w.location && w.location.search) || "").match(/[?&]fundxdepth=([^&]+)/);
      if (q) return q[1] === "1";
      return !!(w.localStorage && w.localStorage.getItem("smd_fundx_depth") === "1");
    } catch (e) { return false; }
  }
  function devForceMono(w) { try { return !!(w.localStorage && w.localStorage.getItem("smd_fundx_dev_forcemono") === "1"); } catch (e) { return false; } }
  function depthEnabled(w) { return depthFlagOn(w) && !devForceMono(w); }

  function makeManager(opts) {
    opts = opts || {};
    var w = opts.window || (typeof window !== "undefined" ? window : {});
    var adapters = [];
    var imu = opts.imu || makeImuAdapter(w);
    adapters.push(imu);
    var depth = opts.depth;                       // Phase 2 native depth adapter (same contract)
    if (depth === undefined && depthEnabled(w)) { try { depth = makeDepthAdapter({ window: w }); } catch (e) { depth = null; } }
    if (depth) adapters.push(depth);
    var contributions = {};
    var started = false;
    return {
      capabilities: function () { return capabilities(w); },
      adapters: adapters,
      depthAdapter: depth || null,
      contributions: function () { return contributions; },
      latency: function () { return depth && depth.latency ? depth.latency() : { fps: 0, avgMs: 0, frames: 0 }; },
      init: function () {
        var ps = adapters.map(function (a) { return a.init ? a.init() : Promise.resolve(true); });
        return Promise.all(ps).then(function () { return true; }, function () { return false; });
      },
      start: function () { if (started) return; adapters.forEach(function (a) { try { a.start && a.start(); } catch (e) {} }); started = true; },
      stop: function () { if (!started) return; adapters.forEach(function (a) { try { a.stop && a.stop(); } catch (e) {} }); started = false; },
      reset: function () { adapters.forEach(function (a) { try { a.reset && a.reset(); } catch (e) {} }); },
      requestPermission: function () {
        var ps = adapters.map(function (a) { return a.requestPermission ? a.requestPermission() : Promise.resolve(true); });
        return Promise.all(ps).then(function (rs) { return rs.every(Boolean); }, function () { return false; });
      },
      // monoPartial: the engine's own frame partial (motion from MediaPipe pupil-delta,
      // distanceState/roll from the monocular engine). Fuses every available sensor into the
      // fields the engine already reads. Absent depth/IMU -> output equals the monocular input.
      read: function (monoPartial) {
        monoPartial = monoPartial || {};
        var out = {}, i, sig, depthSig = null;
        // ---- motion: monocular pupil-delta + IMU (+ any adapter emitting motion) ----
        var motionSrcs = [];
        if (monoPartial.motion != null) motionSrcs.push({ value: num(monoPartial.motion), confidence: monoPartial.eyePresent ? CFG.mpEyeConf : CFG.mpNoEyeConf, source: "mediapipe" });
        for (i = 0; i < adapters.length; i++) {
          sig = null; try { sig = adapters[i].read && adapters[i].read(); } catch (e) {}
          if (!sig) continue;
          if (sig.motion) motionSrcs.push(sig.motion);
          if (sig.distance || sig.pose) depthSig = sig;   // the depth adapter's partial
        }
        var fm = fuse(motionSrcs);
        if (fm) { out.motion = fm.value; out.motionConfidence = fm.confidence; out.motionSources = fm.contributors; }
        // ---- distance: metric depth (high conf) overrides the monocular near/ok/far state ----
        var distConf = null;
        if (depthSig && depthSig.distance && depthSig.distance.value != null) {
          var m = num(depthSig.distance.value);
          out.distanceMm = Math.round(m * 1000);
          out.distanceState = m < CFG.workingNearM ? "near" : (m > CFG.workingFarM ? "far" : "ok");
          out.distanceConfidence = distConf = clamp01(depthSig.distance.confidence);
        }
        // ---- pose: depth/AR roll refines the deviceorientation roll when present ----
        if (depthSig && depthSig.pose && depthSig.pose.roll != null) {
          out.roll = num(depthSig.pose.roll);
          out.rollState = Math.abs(out.roll) <= 12 ? "level" : (out.roll > 0 ? "cw" : "ccw");
          out.poseConfidence = clamp01(depthSig.pose.confidence);
        }
        // ---- unified acquisition confidence: mean of the available per-signal confidences ----
        var confs = [];
        if (fm) confs.push(fm.confidence);
        if (distConf != null) confs.push(distConf);
        if (out.poseConfidence != null) confs.push(out.poseConfidence);
        out.acqConfidence = confs.length ? (confs.reduce(function (a, b) { return a + b; }, 0) / confs.length) : (monoPartial.motion != null ? 0.4 : null);
        // ---- contributions (for the Developer Settings panel) ----
        contributions = {
          motion: fm ? fm.contributors : [],
          distance: out.distanceMm != null ? ["depth"] : (monoPartial.distanceState ? ["mediapipe"] : []),
          pose: out.poseConfidence != null ? ["depth"] : (monoPartial.roll != null ? ["orientation"] : []),
          acqConfidence: out.acqConfidence
        };
        return out;
      },
      _fuse: fuse
    };
  }

  // Request DeviceMotion permission. On iOS 13+ this MUST be called from a user gesture (the
  // "Start guided capture" tap) or motion events never fire. Resolves true where no prompt is
  // needed (Android/desktop) or the user grants it.
  function requestMotionPermission(w) {
    w = w || (typeof window !== "undefined" ? window : {});
    try {
      var DME = w.DeviceMotionEvent;
      if (DME && typeof DME.requestPermission === "function") {
        return DME.requestPermission().then(function (r) { return r === "granted"; }, function () { return false; });
      }
    } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(true);
  }

  function flagOn(w) {
    w = w || (typeof window !== "undefined" ? window : {});
    try {
      var q = ((w.location && w.location.search) || "").match(/[?&]fundxsensors=([^&]+)/);
      if (q) return q[1] === "1";
      return !!(w.localStorage && w.localStorage.getItem("smd_fundx_sensors") === "1");
    } catch (e) { return false; }
  }

  var API = {
    CFG: CFG,
    capabilities: capabilities,
    makeImuAdapter: makeImuAdapter,
    fuse: fuse,
    makeManager: makeManager,
    makeDepthAdapter: makeDepthAdapter,
    requestMotionPermission: requestMotionPermission,
    flagOn: flagOn,
    depthFlagOn: depthFlagOn
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_FUNDX_SENSORS = API;
})();
