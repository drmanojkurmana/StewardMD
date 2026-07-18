/* fundx-vision.js — FundX AI · Vision Engine (core, pure logic).
 *
 * The Vision Engine ACQUIRES and UNDERSTANDS retinal images. It NEVER performs
 * clinical reasoning and NEVER recommends treatment (that is the Clinical Engine,
 * Phase C). It emits only versioned structured JSON (RetinalFindings + QualityScore).
 *
 * This file is intentionally DOM-free and dependency-free so it is:
 *   - headless-testable (test/fundx.test.mjs runs it under Node with no browser),
 *   - reusable by other StewardMD features (exposed as window.SMD_FUNDX_VISION),
 *   - independent of the FundX UI (fundx.js) and storage (fundx-store.js).
 *
 * Real per-frame detectors (MediaPipe iris/face) and canvas heuristics live in the
 * UI layer / detector layer (added in a later milestone) and feed FrameAnalysis
 * objects into this engine. Retinal foundation-model inference is behind the
 * IRetinaModel interface: the MockRetinaModel here is swapped for real inference
 * (Vertex AI / Gemini / Cerebras / local ONNX or TFLite) with NO change to this
 * engine's contracts, the UI, or the persisted data.
 *
 * Additive + reversible: this module only defines a namespace; it does nothing on
 * its own and is a no-op unless the FundX feature flag is on (enforced in fundx.js).
 */
(function () {
  "use strict";

  var VERSION = "0.1.0";
  var SCHEMA_VERSION = 1;

  // ---- helpers ------------------------------------------------------------
  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (n !== n ? 0 : n); }
  function num(n, d) { n = +n; return n !== n ? (d || 0) : n; }
  function bool(v) { return !!v; }
  // Deterministic string hash (FNV-1a-ish) — used to seed the mock model so a given
  // scan produces stable "findings" (important for reproducible tests + timelines).
  function hashStr(s) {
    s = String(s == null ? "" : s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  // Small seeded PRNG (mulberry32) — deterministic, no Math.random dependency.
  function seededRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- acquisition states (Master Plan Part 2, Module 11; grouped for practicality)
  // Frame-driven states auto-advance/regress based on gates. CAPTURING and later are
  // UI-driven (set explicitly) because they are not a function of a single frame.
  var STATE = {
    SEARCHING_EYE: "searching_eye",
    CENTERING_PUPIL: "centering_pupil",
    WORKING_DISTANCE: "working_distance",
    RED_REFLEX: "red_reflex",
    LOCATING_FUNDUS: "locating_fundus",     // circular fundus glow appears (no lens detection)
    OPTIMIZING: "optimizing",                // focus + exposure + glare + steady + level
    ASSESSING_QUALITY: "assessing_quality",  // vessel structures + diagnostic image quality
    READY: "ready",
    CAPTURING: "capturing",
    SELECTING: "selecting",
    PROCESSING: "processing",
    REVIEW: "review",
    DONE: "done"
  };

  // Default tunable thresholds. Kept in one object so tuning never touches logic.
  var CFG = {
    eyeConf: 0.55,
    pupilOffsetMax: 0.22,        // normalized offset from center (0 = centered)
    alignMin: 0.55,             // optical-axis confidence (eye+pupil+distance+glow; NO lens)
    redReflexMin: 0.45,
    fundusMin: 0.5,             // circular fundus-appearance confidence
    fundusCircularityMin: 0.45, // how circular the illuminated field is
    vesselMin: 0.4,             // vessel-like structure score
    focusMin: 0.55,
    exposureMin: 0.5,
    reflectionMax: 0.4,         // reflection score (0 = none) below this passes
    motionMax: 0.35,            // motion (0 = still) below this passes
    rollLevelMax: 18,           // |roll| deg within which the phone is "level"
    diagnosticMin: 0.62,        // composite diagnostic image-quality gate for auto-capture
    captureReadiness: 0.85,     // overall readiness to enter READY / auto-capture
    readySustainFrames: 6,      // frames READY must hold before auto burst
    qualityAccept: 60,          // post-capture QualityScore.overall (0..100) to accept
    stallFramesForFallback: 90, // ~10s stuck in optical setup before the fallback may offer
    lensConfirmFallback: false  // optional "Confirm lens is positioned" — OFF by default
  };

  // ---- FrameAnalysis ------------------------------------------------------
  // The normalized per-frame observation object. Detectors produce partials;
  // makeFrameAnalysis fills defaults + clamps so the engine sees a stable shape.
  function makeFrameAnalysis(p) {
    p = p || {};
    return {
      schemaVersion: SCHEMA_VERSION,
      // presence / geometry
      eyePresent: bool(p.eyePresent), eyeConf: clamp01(p.eyeConf),
      pupilCentered: p.pupilCentered != null ? bool(p.pupilCentered) : (num(p.pupilOffset, 1) <= CFG.pupilOffsetMax),
      pupilOffset: clamp01(p.pupilOffset != null ? p.pupilOffset : 1),
      pupilDir: p.pupilDir || null,          // {x:-1..1, y:-1..1}: where pupil sits vs center
      // distance / motion / phone pose (roll)
      distanceState: p.distanceState || "unknown",   // "far" | "near" | "ok" | "unknown"
      distanceMm: p.distanceMm != null ? num(p.distanceMm) : null,
      motion: clamp01(p.motion != null ? p.motion : 1),
      roll: p.roll != null ? num(p.roll) : null,      // phone roll in degrees (null = unknown)
      rollState: p.rollState || "unknown",            // "level" | "cw" | "ccw" | "unknown"
      // image quality signals (observable heuristics)
      focus: clamp01(p.focus), exposure: clamp01(p.exposure),
      brightness: clamp01(p.brightness), contrast: clamp01(p.contrast),
      noise: clamp01(p.noise), reflection: clamp01(p.reflection != null ? p.reflection : 1),
      redReflex: clamp01(p.redReflex),
      // circular fundus appearance (the observed illuminated field) + vessel-like structure
      fundusVisible: bool(p.fundusVisible), fundusConf: clamp01(p.fundusConf),
      fundusCircularity: clamp01(p.fundusCircularity),
      fundusCenter: p.fundusCenter || null,           // {x,y} offset from frame centre, -1..1
      fundusSize: clamp01(p.fundusSize),              // fraction of frame the fundus fills
      vesselScore: clamp01(p.vesselScore != null ? p.vesselScore : p.vesselVisibility),
      // retina/disc/macula: REPORTED findings (from the vision model), NOT capture gates
      retinaVisible: p.retinaVisible != null ? bool(p.retinaVisible) : bool(p.fundusVisible),
      retinaConf: clamp01(p.retinaConf != null ? p.retinaConf : p.fundusConf),
      discVisible: p.discVisible != null ? bool(p.discVisible) : false, discConf: clamp01(p.discConf),
      maculaVisible: p.maculaVisible != null ? bool(p.maculaVisible) : false, maculaConf: clamp01(p.maculaConf),
      vesselVisibility: clamp01(p.vesselVisibility != null ? p.vesselVisibility : p.vesselScore),
      fieldOfView: clamp01(p.fieldOfView != null ? p.fieldOfView : p.fundusSize),
      // lens fields retained for backward-compat ONLY — never used to gate acquisition
      lensPresent: bool(p.lensPresent), lensConf: clamp01(p.lensConf), lensCentered: bool(p.lensCentered),
      ts: p.ts != null ? num(p.ts) : null
    };
  }

  // ---- AlignmentEngine ----------------------------------------------------
  // Fuses geometry + the "looking-down-the-optical-column" glow into an optical-axis
  // confidence. Driven by eye + pupil + working distance + red-reflex/fundus glow — there
  // is NO lens-detection term (lens power/presence is never required).
  var AlignmentEngine = {
    compute: function (fa) {
      fa = makeFrameAnalysis(fa);
      var eye = fa.eyeConf * (fa.eyePresent ? 1 : 0.3);
      var pupil = (1 - fa.pupilOffset) * (fa.pupilCentered ? 1 : 0.6);
      var dist = fa.distanceState === "ok" ? 1 : (fa.distanceState === "unknown" ? 0.5 : 0.35);
      var glow = Math.max(fa.redReflex, fa.fundusConf);   // we are looking into the eye's optics
      var optical = clamp01(0.32 * eye + 0.30 * pupil + 0.18 * dist + 0.20 * glow);
      return {
        schemaVersion: SCHEMA_VERSION,
        eyeAlignment: clamp01(eye),
        pupilAlignment: clamp01(pupil),
        distanceState: fa.distanceState,
        opticalAxisConfidence: optical,
        acceptable: optical >= CFG.alignMin
      };
    }
  };

  // Composite DIAGNOSTIC image-quality score — the evidence that a usable retinal image is
  // actually present (circular fundus field + vessels + red reflex + focus/exposure/glare).
  // Auto-capture is gated on THIS, not on any physical lens detection.
  function diagnosticScore(fa) {
    fa = makeFrameAnalysis(fa);
    var fundus = fa.fundusConf * (fa.fundusCircularity >= CFG.fundusCircularityMin ? 1 : 0.6);
    var glare = 1 - fa.reflection;
    return clamp01(0.24 * fundus + 0.20 * fa.vesselScore + 0.16 * fa.redReflex + 0.16 * fa.focus + 0.12 * fa.exposure + 0.08 * glare + 0.04 * fa.contrast);
  }

  // ---- ReadinessScore -----------------------------------------------------
  // Weighted composite 0..1 plus per-gate booleans that drive the gate chips. Every gate is
  // an observable optical/image-quality cue — no lens gate.
  var GATE_WEIGHTS = {
    eye: 0.10, pupil: 0.12, distance: 0.06, redReflex: 0.10,
    fundus: 0.14, focus: 0.12, exposure: 0.08, reflection: 0.08,
    motion: 0.06, level: 0.04, vessels: 0.06, quality: 0.04
  };
  // opts.operatorConfirmed (only when CFG.lensConfirmFallback) relaxes the SETUP proxies
  // (distance/red-reflex) so a stalled beginner can advance — it never relaxes the real
  // image-evidence gates (fundus/vessels/quality), so capture still needs a real image.
  function gatesFor(fa, align, opts) {
    opts = opts || {};
    var confirmed = !!(opts.operatorConfirmed && CFG.lensConfirmFallback);
    var distOk = fa.distanceState === "ok" || (confirmed && fa.distanceState !== "far");
    var redOk = fa.redReflex >= (confirmed ? CFG.redReflexMin * 0.6 : CFG.redReflexMin);
    var diag = diagnosticScore(fa);
    return {
      eye: fa.eyePresent && fa.eyeConf >= CFG.eyeConf,
      pupil: fa.pupilCentered && fa.pupilOffset <= CFG.pupilOffsetMax,
      distance: distOk,
      redReflex: redOk,
      fundus: fa.fundusVisible && fa.fundusConf >= CFG.fundusMin && fa.fundusCircularity >= CFG.fundusCircularityMin,
      focus: fa.focus >= CFG.focusMin,
      exposure: fa.exposure >= CFG.exposureMin,
      reflection: fa.reflection <= CFG.reflectionMax,
      motion: fa.motion <= CFG.motionMax,
      level: fa.roll == null || fa.rollState === "unknown" ? true : Math.abs(fa.roll) <= CFG.rollLevelMax,
      vessels: fa.vesselScore >= CFG.vesselMin,
      quality: diag >= CFG.diagnosticMin,
      _diagnostic: diag
    };
  }
  var ReadinessScore = {
    compute: function (fa, align, opts) {
      fa = makeFrameAnalysis(fa);
      align = align || AlignmentEngine.compute(fa);
      var gates = gatesFor(fa, align, opts);
      var overall = 0, total = 0;
      for (var k in GATE_WEIGHTS) {
        if (!GATE_WEIGHTS.hasOwnProperty(k)) continue;
        total += GATE_WEIGHTS[k];
        if (gates[k]) overall += GATE_WEIGHTS[k];
      }
      var ov = total ? overall / total : 0;
      return {
        schemaVersion: SCHEMA_VERSION,
        overall: clamp01(ov),
        diagnostic: gates._diagnostic,
        gates: gates,
        // ready requires the diagnostic-quality gate — capture only on real retinal image quality
        ready: ov >= CFG.captureReadiness && gates.quality
      };
    }
  };

  // ---- AcquisitionStateMachine -------------------------------------------
  // Adaptive (never a fixed sequence): each frame recomputes the highest satisfied
  // prefix of ordered gates; the current state is the first UNsatisfied gate's state
  // (or READY when all pass). It regresses instantly if a lower gate is lost. States
  // from CAPTURING onward are UI-driven and set explicitly via .set().
  // Quality-driven progression — every step is an observable optical/image cue, in order.
  // There is NO "lens detected" gate; the flow advances as the fundus view + image quality
  // improve, and auto-captures only when diagnostic-quality retinal features are present.
  var ORDER = [
    { state: STATE.SEARCHING_EYE, gate: function (g) { return g.eye; } },
    { state: STATE.CENTERING_PUPIL, gate: function (g) { return g.pupil; } },
    { state: STATE.WORKING_DISTANCE, gate: function (g) { return g.distance; } },
    { state: STATE.RED_REFLEX, gate: function (g) { return g.redReflex; } },
    { state: STATE.LOCATING_FUNDUS, gate: function (g) { return g.fundus; } },
    { state: STATE.OPTIMIZING, gate: function (g) { return g.focus && g.exposure && g.reflection && g.motion && g.level; } },
    { state: STATE.ASSESSING_QUALITY, gate: function (g) { return g.vessels && g.quality; } }
  ];
  // Pre-fundus "optical setup" states — if guidance stalls here, the optional config-gated
  // operator-confirm fallback may be offered (never in the normal flow).
  var SETUP_STATES = { searching_eye: 1, centering_pupil: 1, working_distance: 1, red_reflex: 1, locating_fundus: 1 };
  function createStateMachine(opts) {
    opts = opts || {};
    var uiDriven = { capturing: 1, selecting: 1, processing: 1, review: 1, done: 1 };
    var self = {
      state: STATE.SEARCHING_EYE,
      readiness: null, alignment: null, gates: null,
      readyFrames: 0, stalledFrames: 0, operatorConfirmed: false,
      history: [],   // {from,to,ts} transitions — part of acquisition metadata
      reset: function () { self.state = STATE.SEARCHING_EYE; self.readyFrames = 0; self.stalledFrames = 0; self.operatorConfirmed = false; self.history = []; return self; },
      // Optional fallback (only relaxes SETUP proxies when CFG.lensConfirmFallback is on):
      // capture STILL requires real diagnostic image quality — this only un-sticks setup.
      confirmLensPositioned: function () { self.operatorConfirmed = true; return self; },
      // UI-driven set (capture/select/process/review). Records transition.
      set: function (s, ts) { if (s !== self.state) self.history.push({ from: self.state, to: s, ts: ts != null ? ts : null }); self.state = s; return self; },
      // Frame-driven step. Returns {state, changed, readiness, alignment, gates, diagnostic, stalled, shouldCapture}.
      step: function (frameAnalysis, ts) {
        var fa = makeFrameAnalysis(frameAnalysis);
        var align = AlignmentEngine.compute(fa);
        var read = ReadinessScore.compute(fa, align, { operatorConfirmed: self.operatorConfirmed });
        self.alignment = align; self.readiness = read; self.gates = read.gates;
        if (uiDriven[self.state]) return { state: self.state, changed: false, readiness: read, alignment: align, gates: read.gates, diagnostic: read.diagnostic };
        var target = STATE.READY;
        for (var i = 0; i < ORDER.length; i++) { if (!ORDER[i].gate(read.gates)) { target = ORDER[i].state; break; } }
        if (target === STATE.READY && read.ready) { self.readyFrames++; } else { self.readyFrames = 0; }
        var changed = target !== self.state;
        if (changed) { self.history.push({ from: self.state, to: target, ts: ts != null ? ts : null }); self.state = target; self.stalledFrames = 0; }
        else { self.stalledFrames++; }
        return {
          state: self.state, changed: changed, readiness: read, alignment: align, gates: read.gates,
          diagnostic: read.diagnostic,
          // UI may offer the optional operator-confirm fallback (only if the flag is on)
          stalled: SETUP_STATES[self.state] === 1 && self.stalledFrames >= CFG.stallFramesForFallback,
          // auto burst only when READY (all quality gates incl. diagnostic) held long enough
          shouldCapture: self.state === STATE.READY && self.readyFrames >= CFG.readySustainFrames
        };
      }
    };
    if (opts.state) self.state = opts.state;
    return self;
  }

  // ---- QualityEngine + BestFrameSelector ---------------------------------
  // Post-capture image quality scoring. Consumes a frame's metrics (subset of
  // FrameAnalysis) and returns a versioned QualityScore with rejection reasons.
  var QualityEngine = {
    score: function (m) {
      m = m || {};
      // Capture quality is IMAGE quality (fundus field + vessels + focus/exposure/glare),
      // not disease structures — those come from the vision model post-capture.
      var sub = {
        focus: clamp01(m.focus), sharpness: clamp01(m.sharpness != null ? m.sharpness : m.focus),
        exposure: clamp01(m.exposure), brightness: clamp01(m.brightness),
        contrast: clamp01(m.contrast), noise: clamp01(m.noise),
        reflection: 1 - clamp01(m.reflection != null ? m.reflection : 0),   // higher = less reflection
        fundusVisibility: clamp01(m.fundusConf != null ? m.fundusConf : (m.retinaConf != null ? m.retinaConf : (m.retinaVisible ? 0.7 : 0))),
        vesselVisibility: clamp01(m.vesselScore != null ? m.vesselScore : m.vesselVisibility),
        redReflex: clamp01(m.redReflex),
        fieldOfView: clamp01(m.fieldOfView != null ? m.fieldOfView : m.fundusSize)
      };
      var w = { focus: 2, sharpness: 1.5, exposure: 1.5, contrast: 1, noise: 1, reflection: 1.5,
        fundusVisibility: 2.5, vesselVisibility: 2, redReflex: 1, fieldOfView: 1 };
      var acc = 0, tot = 0;
      for (var k in w) { if (!w.hasOwnProperty(k)) continue; acc += w[k] * (k === "noise" ? (1 - sub.noise) : sub[k]); tot += w[k]; }
      var overall = Math.round((tot ? acc / tot : 0) * 100);
      var reasons = [];
      if (sub.focus < CFG.focusMin) reasons.push("poor_focus");
      if (sub.exposure < CFG.exposureMin) reasons.push("poor_exposure");
      if ((1 - sub.reflection) > CFG.reflectionMax) reasons.push("excessive_reflection");
      if (sub.fundusVisibility < CFG.fundusMin) reasons.push("fundus_not_visible");
      if (sub.vesselVisibility < CFG.vesselMin) reasons.push("no_vessels_detected");
      if (sub.fieldOfView < 0.4) reasons.push("field_of_view_inadequate");
      return {
        schemaVersion: SCHEMA_VERSION, overall: overall, subscores: sub,
        accepted: overall >= CFG.qualityAccept, reasons: reasons
      };
    }
  };
  var BestFrameSelector = {
    // frames: [{ id?, metrics }]. Returns indices of best overall / fundus / vessel + scores.
    select: function (frames) {
      frames = frames || [];
      if (!frames.length) return { best: -1, scores: [] };
      var scores = frames.map(function (f) { return QualityEngine.score(f.metrics || f); });
      function argmaxBy(fn) { var bi = 0, bv = -1; for (var i = 0; i < scores.length; i++) { var v = fn(scores[i]); if (v > bv) { bv = v; bi = i; } } return bi; }
      return {
        best: argmaxBy(function (s) { return s.overall; }),
        bestFundus: argmaxBy(function (s) { return s.subscores.fundusVisibility; }),
        bestVessel: argmaxBy(function (s) { return s.subscores.vesselVisibility; }),
        scores: scores
      };
    }
  };

  // ---- IRetinaModel + MockRetinaModel ------------------------------------
  // The single swap point for retinal foundation-model inference. Any real provider
  // (Vertex/Gemini/Cerebras/ONNX/TFLite) must implement analyze(input, ctx) -> Promise
  // resolving to a RetinalFindings object of the SAME schema. The UI + storage only
  // ever see the schema, never the provider — so swapping models changes nothing else.
  var _retinaModel = null;
  var MockRetinaModel = {
    id: "mock",
    provider: "mock",
    modelVersion: "mock-0.1",
    // input: { imageDataUrl?, metrics?, quality? }  ctx: { patientRef, eye, ts, seed? }
    analyze: function (input, ctx) {
      ctx = ctx || {}; input = input || {};
      var seed = hashStr((ctx.seed || "") + "|" + (ctx.patientRef || "anon") + "|" + (ctx.eye || "?") + "|" + (ctx.ts || 0));
      var rnd = seededRng(seed);
      function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
      function rint(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
      var cdr = +(0.35 + rnd() * 0.4).toFixed(2);
      var ma = rint(0, 18), hem = rint(0, 6), exu = rint(0, 8), cws = rint(0, 3);
      var findings = {
        schemaVersion: SCHEMA_VERSION,
        quality: input.quality != null ? input.quality : rint(60, 98),
        retina_visible: true,
        optic_disc: { visible: true, cup_disc_ratio: cdr, edema: rnd() < 0.08, pallor: rnd() < 0.06 },
        macula: { visible: true, edema: rnd() < 0.12 },
        vessels: { arteriovenous_ratio: +(0.5 + rnd() * 0.3).toFixed(2), tortuosity: pick(["normal", "mild", "moderate"]) },
        microaneurysms: ma,
        hemorrhages: hem,
        hard_exudates: exu,
        cotton_wool_spots: cws,
        drusen: rint(0, 10),
        field_of_view: pick(["posterior_pole", "wide", "partial"]),
        confidence: +(0.7 + rnd() * 0.29).toFixed(2),
        provider: MockRetinaModel.provider,
        model_version: MockRetinaModel.modelVersion,
        is_mock: true,
        disclaimer: "Simulated detection preview from a mock model. Not a diagnosis. For workflow/demo only."
      };
      return findings;
    }
  };
  function registerRetinaModel(impl) { _retinaModel = impl || null; return _retinaModel; }
  function getRetinaModel() { return _retinaModel || MockRetinaModel; }

  // ---- Findings builder (the stable Vision→Clinical contract) -------------
  var Findings = {
    build: function (parts) {
      parts = parts || {};
      var model = parts.model || getRetinaModel();
      var raw = parts.findings || (model && model.analyze ? model.analyze(parts.input || {}, parts.ctx || {}) : {});
      return {
        schemaVersion: SCHEMA_VERSION,
        engine: "vision",
        engineVersion: VERSION,
        generatedAt: parts.now != null ? parts.now : (typeof Date !== "undefined" ? Date.now() : 0),
        provider: raw.provider || (model && model.provider) || "unknown",
        modelVersion: raw.model_version || (model && model.modelVersion) || "unknown",
        quality: parts.quality || null,
        findings: raw
      };
    }
  };

  // ---- CoachDirector ------------------------------------------------------
  // Turns state + analysis into an adaptive cue: on-screen text, a directional arrow,
  // a haptic pattern name, a spoken line, and a tone. Never a fixed script.
  var Coach = {
    cueFor: function (state, fa, readiness) {
      fa = makeFrameAnalysis(fa);
      var t = "info", arrow = null, haptic = null, text = "", voice = "";
      // Direction from the OBSERVED fundus-field offset when we have it, else the pupil offset.
      function moveDir() {
        var c = (fa.fundusVisible && fa.fundusCenter) ? fa.fundusCenter : fa.pupilDir;
        if (c) { var cx = +c.x || 0, cy = +c.y || 0; if (Math.abs(cx) >= Math.abs(cy)) return cx > 0 ? "right" : "left"; return cy > 0 ? "down" : "up"; }
        return null;
      }
      // Working distance from distance estimate + how much of the frame the fundus fills.
      function distDir() {
        if (fa.distanceState === "far" || (fa.fundusVisible && fa.fundusSize < 0.35)) return "closer";
        if (fa.distanceState === "near" || (fa.fundusVisible && fa.fundusSize > 0.85)) return "farther";
        return null;
      }
      // Rotation from phone roll (rotate the OPPOSITE way to level the image).
      function rotDir() { return fa.rollState === "cw" ? "rot_ccw" : (fa.rollState === "ccw" ? "rot_cw" : null); }
      switch (state) {
        case STATE.SEARCHING_EYE: text = "Point the camera at the eye"; voice = "Find the eye"; break;
        case STATE.CENTERING_PUPIL: arrow = moveDir(); text = arrow ? "Move " + arrow : "Center the pupil"; haptic = "selection"; voice = arrow ? "Move " + arrow : "Center the pupil"; break;
        case STATE.WORKING_DISTANCE: {
          var d0 = distDir();
          if (d0 === "closer") { text = "Move a little closer"; arrow = "closer"; voice = "Move closer"; }
          else if (d0 === "farther") { text = "Ease back a little"; arrow = "farther"; voice = "Move back"; }
          else { text = "Good working distance — steady"; voice = "Hold distance"; }
          break;
        }
        case STATE.RED_REFLEX: arrow = moveDir(); text = "Find the orange-red glow — tilt slightly"; haptic = "selection"; voice = arrow ? "Move " + arrow : "Find the red reflex"; break;
        case STATE.LOCATING_FUNDUS: {
          var dd = distDir(), md = moveDir();
          if (dd) { arrow = dd; text = dd === "closer" ? "Move closer to fill the view" : "Ease back a little"; voice = dd === "closer" ? "Move closer" : "Move back"; }
          else if (md) { arrow = md; text = "Bring the retinal view to the centre"; voice = "Move " + md; }
          else { text = "Retinal view found — hold steady"; t = "good"; haptic = "selection"; voice = "Hold steady"; }
          break;
        }
        case STATE.OPTIMIZING: {
          var rd = rotDir();
          if (fa.reflection > CFG.reflectionMax) { text = "Glare — dim the room or shift the angle"; t = "warn"; haptic = "warning"; voice = "Reduce glare"; }
          else if (rd) { arrow = rd; text = "Rotate to level the image"; voice = rd === "rot_cw" ? "Rotate clockwise" : "Rotate counter-clockwise"; }
          else if (fa.motion > CFG.motionMax) { text = "Hold steady"; t = "warn"; voice = "Hold steady"; }
          else if (fa.focus < CFG.focusMin) { text = "Steady for focus…"; voice = "Focusing"; }
          else { text = "Improving exposure…"; voice = "Adjusting exposure"; }
          break;
        }
        case STATE.ASSESSING_QUALITY: text = "Checking image quality — hold steady"; t = "good"; haptic = "selection"; voice = "Hold steady"; break;
        case STATE.READY: text = "Hold — capturing"; t = "good"; haptic = "success"; voice = "Hold still, capturing"; break;
        case STATE.CAPTURING: text = "Capturing…"; t = "good"; haptic = "success"; voice = "Capturing"; break;
        case STATE.SELECTING: text = "Selecting best frame…"; break;
        case STATE.PROCESSING: text = "Processing…"; break;
        case STATE.REVIEW: text = "Review your capture"; break;
        default: text = "";
      }
      return { text: text, arrow: arrow, haptic: haptic, voice: voice, tone: t };
    }
  };

  // ---- validation ---------------------------------------------------------
  // The nine mandated ScanRecord fields (+ audit). validate.scanRecord enforces them.
  var SCAN_REQUIRED = ["id", "originalImage", "processedImage", "quality", "acquisition",
    "vision", "patientContext", "timestamp", "device", "provider", "audit"];
  var validate = {
    scanRecord: function (r) {
      var errors = [];
      r = r || {};
      SCAN_REQUIRED.forEach(function (k) { if (r[k] == null) errors.push("missing:" + k); });
      if (r.vision && r.vision.schemaVersion == null) errors.push("vision.schemaVersion");
      return { ok: errors.length === 0, errors: errors };
    },
    findings: function (f) {
      var errors = [];
      f = f || {};
      if (f.schemaVersion == null) errors.push("schemaVersion");
      if (f.engine !== "vision") errors.push("engine");
      if (f.findings == null) errors.push("findings");
      return { ok: errors.length === 0, errors: errors };
    }
  };

  // ---- public API ---------------------------------------------------------
  var API = {
    VERSION: VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    STATE: STATE,
    CFG: CFG,
    makeFrameAnalysis: makeFrameAnalysis,
    AlignmentEngine: AlignmentEngine,
    ReadinessScore: ReadinessScore,
    createStateMachine: createStateMachine,
    QualityEngine: QualityEngine,
    BestFrameSelector: BestFrameSelector,
    MockRetinaModel: MockRetinaModel,
    registerRetinaModel: registerRetinaModel,
    getRetinaModel: getRetinaModel,
    Findings: Findings,
    Coach: Coach,
    validate: validate
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;        // node/test
  if (typeof window !== "undefined") window.SMD_FUNDX_VISION = API;                  // browser
})();
