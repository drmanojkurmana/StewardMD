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
    DETECTING_LENS: "detecting_lens",
    ALIGNING: "aligning",
    RED_REFLEX: "red_reflex",
    RETINA: "retina",
    OPTIMIZING: "optimizing",          // focus + exposure + reflection + motion
    FRAMING: "framing",                // optic disc + macula + field of view
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
    pupilOffsetMax: 0.22,       // normalized offset from center (0 = centered)
    lensConf: 0.5,
    alignMin: 0.6,              // optical-axis confidence to pass ALIGNING
    redReflexMin: 0.45,
    retinaMin: 0.5,
    focusMin: 0.55,
    exposureMin: 0.5,
    reflectionMax: 0.4,         // reflection score (0 = none) below this passes
    motionMax: 0.35,            // motion (0 = still) below this passes
    discMin: 0.5,
    maculaMin: 0.5,
    fovMin: 0.5,
    captureReadiness: 0.9,      // overall readiness to enter READY / auto-capture
    readySustainFrames: 6,      // frames READY must hold before auto burst
    qualityAccept: 65           // QualityScore.overall (0..100) to accept an image
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
      lensPresent: bool(p.lensPresent), lensConf: clamp01(p.lensConf),
      lensCentered: p.lensCentered != null ? bool(p.lensCentered) : bool(p.lensPresent),
      // distance / motion
      distanceState: p.distanceState || "unknown",   // "far" | "near" | "ok" | "unknown"
      distanceMm: p.distanceMm != null ? num(p.distanceMm) : null,
      motion: clamp01(p.motion != null ? p.motion : 1),
      // image quality signals
      focus: clamp01(p.focus), exposure: clamp01(p.exposure),
      brightness: clamp01(p.brightness), contrast: clamp01(p.contrast),
      noise: clamp01(p.noise), reflection: clamp01(p.reflection != null ? p.reflection : 1),
      // retinal signals (heuristic red-reflex now; mock disc/macula/retina until real models)
      redReflex: clamp01(p.redReflex),
      retinaVisible: p.retinaVisible != null ? bool(p.retinaVisible) : false, retinaConf: clamp01(p.retinaConf),
      discVisible: p.discVisible != null ? bool(p.discVisible) : false, discConf: clamp01(p.discConf),
      maculaVisible: p.maculaVisible != null ? bool(p.maculaVisible) : false, maculaConf: clamp01(p.maculaConf),
      vesselVisibility: clamp01(p.vesselVisibility),
      fieldOfView: clamp01(p.fieldOfView),
      ts: p.ts != null ? num(p.ts) : null
    };
  }

  // ---- AlignmentEngine ----------------------------------------------------
  // Fuses geometry signals into optical-path confidence + working-distance guidance.
  var AlignmentEngine = {
    compute: function (fa) {
      fa = makeFrameAnalysis(fa);
      var eye = fa.eyeConf * (fa.eyePresent ? 1 : 0.3);
      var pupil = (1 - fa.pupilOffset) * (fa.pupilCentered ? 1 : 0.6);
      var lens = fa.lensConf * (fa.lensPresent ? 1 : 0.3) * (fa.lensCentered ? 1 : 0.7);
      var dist = fa.distanceState === "ok" ? 1 : (fa.distanceState === "unknown" ? 0.5 : 0.35);
      var optical = clamp01(0.30 * eye + 0.30 * pupil + 0.25 * lens + 0.15 * dist);
      return {
        schemaVersion: SCHEMA_VERSION,
        eyeAlignment: clamp01(eye),
        pupilAlignment: clamp01(pupil),
        lensAlignment: clamp01(lens),
        distanceState: fa.distanceState,
        opticalAxisConfidence: optical,
        acceptable: optical >= CFG.alignMin
      };
    }
  };

  // ---- ReadinessScore -----------------------------------------------------
  // Weighted composite 0..1 plus the per-gate booleans that drive the gate chips.
  var GATE_WEIGHTS = {
    eye: 0.10, pupil: 0.12, lens: 0.10, alignment: 0.12, distance: 0.06,
    redReflex: 0.08, retina: 0.10, focus: 0.08, exposure: 0.06,
    reflection: 0.06, motion: 0.06, disc: 0.04, macula: 0.01, fov: 0.01
  };
  function gatesFor(fa, align) {
    return {
      eye: fa.eyePresent && fa.eyeConf >= CFG.eyeConf,
      pupil: fa.pupilCentered && fa.pupilOffset <= CFG.pupilOffsetMax,
      lens: fa.lensPresent && fa.lensConf >= CFG.lensConf,
      alignment: align.opticalAxisConfidence >= CFG.alignMin,
      distance: fa.distanceState === "ok",
      redReflex: fa.redReflex >= CFG.redReflexMin,
      retina: fa.retinaVisible && fa.retinaConf >= CFG.retinaMin,
      focus: fa.focus >= CFG.focusMin,
      exposure: fa.exposure >= CFG.exposureMin,
      reflection: fa.reflection <= CFG.reflectionMax,
      motion: fa.motion <= CFG.motionMax,
      disc: fa.discVisible && fa.discConf >= CFG.discMin,
      macula: fa.maculaVisible && fa.maculaConf >= CFG.maculaMin,
      fov: fa.fieldOfView >= CFG.fovMin
    };
  }
  var ReadinessScore = {
    compute: function (fa, align) {
      fa = makeFrameAnalysis(fa);
      align = align || AlignmentEngine.compute(fa);
      var gates = gatesFor(fa, align);
      var overall = 0, total = 0;
      for (var k in GATE_WEIGHTS) {
        if (!GATE_WEIGHTS.hasOwnProperty(k)) continue;
        total += GATE_WEIGHTS[k];
        if (gates[k]) overall += GATE_WEIGHTS[k];
      }
      return {
        schemaVersion: SCHEMA_VERSION,
        overall: clamp01(total ? overall / total : 0),
        gates: gates,
        ready: (total ? overall / total : 0) >= CFG.captureReadiness
      };
    }
  };

  // ---- AcquisitionStateMachine -------------------------------------------
  // Adaptive (never a fixed sequence): each frame recomputes the highest satisfied
  // prefix of ordered gates; the current state is the first UNsatisfied gate's state
  // (or READY when all pass). It regresses instantly if a lower gate is lost. States
  // from CAPTURING onward are UI-driven and set explicitly via .set().
  var ORDER = [
    { state: STATE.SEARCHING_EYE, gate: function (g) { return g.eye; } },
    { state: STATE.CENTERING_PUPIL, gate: function (g) { return g.pupil; } },
    { state: STATE.DETECTING_LENS, gate: function (g) { return g.lens; } },
    { state: STATE.ALIGNING, gate: function (g) { return g.alignment && g.distance; } },
    { state: STATE.RED_REFLEX, gate: function (g) { return g.redReflex; } },
    { state: STATE.RETINA, gate: function (g) { return g.retina; } },
    { state: STATE.OPTIMIZING, gate: function (g) { return g.focus && g.exposure && g.reflection && g.motion; } },
    { state: STATE.FRAMING, gate: function (g) { return g.disc && g.macula && g.fov; } }
  ];
  function createStateMachine(opts) {
    opts = opts || {};
    var uiDriven = { capturing: 1, selecting: 1, processing: 1, review: 1, done: 1 };
    var self = {
      state: STATE.SEARCHING_EYE,
      readiness: null, alignment: null, gates: null,
      readyFrames: 0,
      history: [],   // {state, ts} transitions — part of acquisition metadata
      reset: function () { self.state = STATE.SEARCHING_EYE; self.readyFrames = 0; self.history = []; return self; },
      // UI-driven set (capture/select/process/review). Records transition.
      set: function (s, ts) { if (s !== self.state) self.history.push({ from: self.state, to: s, ts: ts != null ? ts : null }); self.state = s; return self; },
      // Frame-driven step. Returns {state, changed, readiness, alignment, gates}.
      step: function (frameAnalysis, ts) {
        var fa = makeFrameAnalysis(frameAnalysis);
        var align = AlignmentEngine.compute(fa);
        var read = ReadinessScore.compute(fa, align);
        self.alignment = align; self.readiness = read; self.gates = read.gates;
        if (uiDriven[self.state]) return { state: self.state, changed: false, readiness: read, alignment: align, gates: read.gates };
        // first unsatisfied gate in order → that state; else READY
        var target = STATE.READY;
        for (var i = 0; i < ORDER.length; i++) { if (!ORDER[i].gate(read.gates)) { target = ORDER[i].state; break; } }
        if (target === STATE.READY && read.overall >= CFG.captureReadiness) { self.readyFrames++; }
        else { self.readyFrames = 0; }
        var changed = target !== self.state;
        if (changed) { self.history.push({ from: self.state, to: target, ts: ts != null ? ts : null }); self.state = target; }
        return {
          state: self.state, changed: changed, readiness: read, alignment: align, gates: read.gates,
          // true when READY has held long enough → UI should trigger the auto burst
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
      var sub = {
        focus: clamp01(m.focus), sharpness: clamp01(m.sharpness != null ? m.sharpness : m.focus),
        exposure: clamp01(m.exposure), brightness: clamp01(m.brightness),
        contrast: clamp01(m.contrast), noise: clamp01(m.noise),
        reflection: 1 - clamp01(m.reflection != null ? m.reflection : 0),   // higher = less reflection
        retinaVisibility: clamp01(m.retinaConf != null ? m.retinaConf : (m.retinaVisible ? 0.7 : 0)),
        discVisibility: clamp01(m.discConf != null ? m.discConf : (m.discVisible ? 0.7 : 0)),
        maculaVisibility: clamp01(m.maculaConf != null ? m.maculaConf : (m.maculaVisible ? 0.7 : 0)),
        vesselVisibility: clamp01(m.vesselVisibility),
        fieldOfView: clamp01(m.fieldOfView)
      };
      var w = { focus: 2, sharpness: 1.5, exposure: 1.5, contrast: 1, noise: 1, reflection: 1.5,
        retinaVisibility: 2, discVisibility: 1.5, maculaVisibility: 1, vesselVisibility: 1, fieldOfView: 1 };
      var acc = 0, tot = 0;
      for (var k in w) { if (!w.hasOwnProperty(k)) continue; acc += w[k] * (k === "noise" ? (1 - sub.noise) : sub[k]); tot += w[k]; }
      var overall = Math.round((tot ? acc / tot : 0) * 100);
      var reasons = [];
      if (sub.focus < CFG.focusMin) reasons.push("poor_focus");
      if (sub.exposure < CFG.exposureMin) reasons.push("poor_exposure");
      if ((1 - sub.reflection) > CFG.reflectionMax) reasons.push("excessive_reflection");
      if (sub.retinaVisibility < CFG.retinaMin) reasons.push("retina_not_visible");
      if (sub.discVisibility < CFG.discMin) reasons.push("disc_not_visible");
      if (sub.maculaVisibility < CFG.maculaMin) reasons.push("macula_not_visible");
      if (sub.fieldOfView < CFG.fovMin) reasons.push("field_of_view_inadequate");
      return {
        schemaVersion: SCHEMA_VERSION, overall: overall, subscores: sub,
        accepted: overall >= CFG.qualityAccept, reasons: reasons
      };
    }
  };
  var BestFrameSelector = {
    // frames: [{ id?, metrics }]. Returns indices of best overall/disc/macula/vessel + scores.
    select: function (frames) {
      frames = frames || [];
      if (!frames.length) return { best: -1, scores: [] };
      var scores = frames.map(function (f) { return QualityEngine.score(f.metrics || f); });
      function argmaxBy(fn) { var bi = 0, bv = -1; for (var i = 0; i < scores.length; i++) { var v = fn(scores[i]); if (v > bv) { bv = v; bi = i; } } return bi; }
      return {
        best: argmaxBy(function (s) { return s.overall; }),
        bestDisc: argmaxBy(function (s) { return s.subscores.discVisibility; }),
        bestMacula: argmaxBy(function (s) { return s.subscores.maculaVisibility; }),
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
      function dir() {
        if (fa.pupilDir) {
          if (Math.abs(fa.pupilDir.x) >= Math.abs(fa.pupilDir.y)) return fa.pupilDir.x > 0 ? "right" : "left";
          return fa.pupilDir.y > 0 ? "down" : "up";
        }
        return null;
      }
      switch (state) {
        case STATE.SEARCHING_EYE: text = "Point the camera at the eye"; voice = "Find the eye"; break;
        case STATE.CENTERING_PUPIL: text = "Center the pupil"; arrow = dir(); haptic = "selection"; voice = arrow ? "Move " + arrow : "Center the pupil"; break;
        case STATE.DETECTING_LENS: text = "Bring the 20D lens into view"; voice = "Position the lens"; break;
        case STATE.ALIGNING:
          if (fa.distanceState === "far") { text = "Move a little closer"; arrow = "closer"; voice = "Move closer"; }
          else if (fa.distanceState === "near") { text = "Move back slightly"; arrow = "farther"; voice = "Move back"; }
          else { text = "Align through the lens"; voice = "Aligning"; }
          break;
        case STATE.RED_REFLEX: text = "Searching for the red reflex — tilt slightly"; haptic = "selection"; voice = "Find the red reflex"; break;
        case STATE.RETINA: text = "Retina detected — hold steady"; t = "good"; haptic = "selection"; voice = "Retina found"; break;
        case STATE.OPTIMIZING:
          if (fa.reflection > CFG.reflectionMax) { text = "Reflection — reduce room light"; t = "warn"; haptic = "warning"; voice = "Reduce reflection"; }
          else if (fa.motion > CFG.motionMax) { text = "Hold steady"; t = "warn"; voice = "Hold steady"; }
          else if (fa.focus < CFG.focusMin) { text = "Improving focus…"; voice = "Focusing"; }
          else { text = "Improving exposure…"; voice = "Adjusting exposure"; }
          break;
        case STATE.FRAMING: text = "Framing optic disc and macula"; t = "good"; voice = "Framing"; break;
        case STATE.READY: text = "Hold — capturing"; t = "good"; haptic = "success"; voice = "Hold steady, capturing"; break;
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
