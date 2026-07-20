/* fundx-engine.js — FundX AI · Acquisition Decision Engine (README 05).
 *
 * The single "brain" that decides, every frame: what state acquisition is in, the ONE
 * instruction the clinician should follow, how confident the system is, and whether to
 * capture / wait / continue / restart. It is deterministic and headless-testable.
 *
 * This module is ADDITIVE and COMPOSES the existing Vision Engine primitives — it never
 * reimplements them:
 *   - the finite-state machine        (SMD_FUNDX_VISION.createStateMachine)
 *   - optical-axis alignment          (AlignmentEngine, via step.alignment)
 *   - the weighted readiness composite (ReadinessScore, via step.readiness/gates/diagnostic)
 *   - the one-instruction coach cue    (Coach.cueFor)
 *
 * On top of those it adds the consolidations README 05 asks for and that did not exist as a
 * single unit:
 *   - Confidence fusion    — one overall confidence + per-subsystem breakdown + a level.
 *   - Capture decision      — a 4-way classifier: Capture / Wait / Continue / Restart.
 *   - Failure analysis      — the machine-readable reason acquisition is blocked + its recovery.
 *   - Temporal stability    — spike-robust smoothing, trend, and regression-based restart, so a
 *                             single bad frame never drives a decision.
 *   - Explainability        — a consolidated developer object (state, transition, confidences,
 *                             capture reason) for Developer Mode. Clinicians never see it.
 *   - Modes                 — beginner / standard / expert adjust guidance verbosity only.
 *                             Capture TIMING stays identical to the validated FSM (patient
 *                             safety: acquisition behaviour is not loosened by a UI mode).
 *
 * DOM-free + dependency-injected (reads window.SMD_FUNDX_VISION, or opts.vision) so it runs
 * under Node for tests exactly like the Vision Engine. Exposed as window.SMD_FUNDX_ENGINE.
 * Reversible: defining this namespace does nothing on its own; only the flag-gated UI uses it.
 */
(function () {
  "use strict";

  var VERSION = "0.1.0";
  var SCHEMA_VERSION = 1;

  var MODE = { BEGINNER: "beginner", STANDARD: "standard", EXPERT: "expert" };
  // Capture decision — every frame resolves to exactly one of these (README 05 "Capture Decision").
  var DECISION = { CAPTURE: "capture", WAIT: "wait", CONTINUE: "continue", RESTART: "restart" };
  var LEVEL = { HIGH: "high", MEDIUM: "medium", LOW: "low", UNKNOWN: "unknown" };
  // Explicit state-priority table (README 05): higher-priority concerns override lower ones.
  // SAFETY is priority 1 — a critical blocker (e.g. severe glare) preempts the one-instruction flow.
  var PRIORITY = { SAFETY: 1, EYE: 2, LENS: 3, PHONE_ALIGN: 4, LENS_ALIGN: 5, RED_REFLEX: 6, RETINA: 7, QUALITY: 8, CAPTURE: 9, AI: 10 };

  // Tunables kept out of the logic so calibration never edits behaviour.
  var ENGINE_CFG = {
    levelHigh: 0.75, levelMed: 0.5, levelLow: 0.25,   // confidence.overall -> level bands
    historyMax: 30,           // rolling temporal buffer length
    smoothWindow: 5,          // frames used for the spike-robust (median) readiness
    stableVarMax: 0.02,       // readiness variance below which guidance is "stable"
    stableMinFrames: 2,       // consecutive frames in a state before it counts as stable
    regressLostFrames: 12,    // frames of deep regression before recommending a restart
    regressPeakRank: 4,       // must have reached >= LOCATING_FUNDUS to consider a restart
    regressNowRank: 1,        // ...and fallen back to <= CENTERING_PUPIL
    glareHysteresis: 0.1,     // critical glare clears at (criticalGlare - this) — avoids flicker
    manualThreshold: 60       // default readiness% at which manual "Capture best frame" is allowed
  };

  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (n !== n ? 0 : n); }
  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mean(arr) { if (!arr.length) return 0; var t = 0; for (var i = 0; i < arr.length; i++) t += arr[i]; return t / arr.length; }
  function variance(arr) { if (arr.length < 2) return 0; var m = mean(arr), v = 0; for (var i = 0; i < arr.length; i++) { var d = arr[i] - m; v += d * d; } return v / arr.length; }
  function levelFor(x) { return x >= ENGINE_CFG.levelHigh ? LEVEL.HIGH : x >= ENGINE_CFG.levelMed ? LEVEL.MEDIUM : x >= ENGINE_CFG.levelLow ? LEVEL.LOW : LEVEL.UNKNOWN; }

  function resolveVision(opts) {
    if (opts && opts.vision) return opts.vision;
    if (typeof window !== "undefined" && window.SMD_FUNDX_VISION) return window.SMD_FUNDX_VISION;
    return null;
  }

  function create(opts) {
    opts = opts || {};
    var V = resolveVision(opts);
    if (!V) throw new Error("fundx-engine: SMD_FUNDX_VISION is required");
    var STATE = V.STATE;
    var CRITICAL_GLARE = (V.CFG && V.CFG.criticalGlare != null) ? V.CFG.criticalGlare : 0.7;

    // Ordered acquisition ranks (drives regression detection + priority ordering). Mirrors the
    // Vision Engine's ORDER; higher = closer to capture. UI-driven states rank above READY.
    var RANK = {};
    [STATE.SEARCHING_EYE, STATE.CENTERING_PUPIL, STATE.WORKING_DISTANCE, STATE.RED_REFLEX,
      STATE.LOCATING_FUNDUS, STATE.OPTIMIZING, STATE.ASSESSING_QUALITY, STATE.READY,
      STATE.CAPTURING, STATE.SELECTING, STATE.PROCESSING, STATE.REVIEW, STATE.DONE
    ].forEach(function (s, i) { RANK[s] = i; });
    function rank(s) { return RANK[s] != null ? RANK[s] : 0; }

    // Machine-readable failure code + priority for the blocking state (README 05 "Failure Analysis"
    // + "State Priorities"). The human recovery action comes from the Coach cue (never duplicated).
    function failureFor(state, fa, cue, gates) {
      var code = null, priority = 0;
      switch (state) {
        case STATE.SEARCHING_EYE: code = "eye_not_found"; priority = 2; break;
        case STATE.CENTERING_PUPIL: code = "pupil_off_center"; priority = 4; break;
        case STATE.WORKING_DISTANCE: code = fa.distanceState === "near" ? "too_close" : "too_far"; priority = 4; break;
        case STATE.RED_REFLEX: code = "no_red_reflex"; priority = 6; break;
        case STATE.LOCATING_FUNDUS: code = "fundus_not_found"; priority = 7; break;
        case STATE.OPTIMIZING:
          // The worst sub-cause first (matches the Coach's own priority order).
          if (!gates.reflection) code = "glare";
          else if (!gates.level) code = "phone_tilted";
          else if (!gates.motion) code = "motion";
          else if (!gates.focus) code = "out_of_focus";
          else code = "exposure";
          priority = 8; break;
        case STATE.ASSESSING_QUALITY: code = "quality_low"; priority = 8; break;
        default: return null;   // READY / capturing / later — nothing is "blocking"
      }
      return { code: code, priority: priority, action: cue ? cue.text : "", arrow: cue ? cue.arrow : null };
    }

    // Per-subsystem confidence (0..1, or null = not observable this frame). The OVERALL confidence
    // reuses the Vision Engine's validated weighted composite (readiness.overall) so there is one
    // source of truth; the breakdown here is for fusion transparency + Developer Mode.
    function fuseConfidence(fa, align, readiness) {
      var subsystems = {
        eye: align ? clamp01(align.eyeAlignment) : null,
        pupil: align ? clamp01(align.pupilAlignment) : null,
        distance: fa.distanceState === "ok" ? 1 : (fa.distanceState === "unknown" ? null : 0.35),
        redReflex: clamp01(fa.redReflex),
        fundus: clamp01(fa.fundusConf),
        vessel: clamp01(fa.vesselScore),
        quality: clamp01(readiness.diagnostic),
        motion: fa.motionConfidence != null ? clamp01(fa.motionConfidence) : clamp01(1 - fa.motion),
        pose: fa.roll == null ? null : clamp01(1 - Math.min(1, Math.abs(fa.roll) / 45)),
        depth: fa.distanceConfidence != null ? clamp01(fa.distanceConfidence) : null
      };
      var overall = clamp01(readiness.overall);
      return { overall: overall, level: levelFor(overall), subsystems: subsystems };
    }

    var self = {
      V: V,
      sm: opts.stateMachine || V.createStateMachine(),
      mode: opts.mode || MODE.STANDARD,
      manualThreshold: opts.manualThreshold != null ? opts.manualThreshold : ENGINE_CFG.manualThreshold,
      prevState: null,
      framesInState: 0,
      lostFrames: 0,
      peakRank: 0,
      criticalGlareActive: false,
      history: [],       // {ts, rank, readiness, reflection}
      last: null,        // last Decision (for explain())

      MODE: MODE, DECISION: DECISION, LEVEL: LEVEL,

      setMode: function (m) { if (m === MODE.BEGINNER || m === MODE.STANDARD || m === MODE.EXPERT) self.mode = m; return self; },
      confirmLensPositioned: function () { if (self.sm.confirmLensPositioned) self.sm.confirmLensPositioned(); return self; },
      // UI-driven transitions (capturing/selecting/processing/review/done) pass straight through.
      set: function (s, ts) { if (self.sm.set) self.sm.set(s, ts); return self; },
      explain: function () { return self.last ? self.last.explain : null; },
      reset: function () {
        if (self.sm.reset) self.sm.reset();
        self.prevState = null; self.framesInState = 0; self.lostFrames = 0; self.peakRank = 0;
        self.criticalGlareActive = false;
        self.history = []; self.last = null; return self;
      },

      // The frame-driven decision. Returns a single consolidated object; every field the existing
      // UI already reads (state/changed/readiness/gates/diagnostic/alignment/stalled/shouldCapture)
      // is preserved with identical semantics, plus the new confidence/capture/failure/stability/
      // guidance/explain consolidations.
      observe: function (frameAnalysis, ts) {
        var fa = V.makeFrameAnalysis(frameAnalysis);
        if (ts == null) ts = fa.ts;
        var step = self.sm.step(fa, ts);
        var state = step.state, align = step.alignment, readiness = step.readiness, gates = step.gates;

        // temporal bookkeeping
        var changed = step.changed;
        if (changed) { self.prevState = self.last ? self.last.state : self.prevState; self.framesInState = 1; }
        else self.framesInState++;
        var r = rank(state);
        if (r > self.peakRank) self.peakRank = r;

        self.history.push({ ts: ts, rank: r, readiness: clamp01(readiness.overall), reflection: clamp01(fa.reflection) });
        if (self.history.length > ENGINE_CFG.historyMax) self.history.shift();

        // temporal stability — spike-robust smoothing + trend (never decide from one frame)
        var recent = self.history.slice(-ENGINE_CFG.smoothWindow).map(function (h) { return h.readiness; });
        var smoothed = median(recent);
        var half = Math.max(1, Math.floor(recent.length / 2));
        var trendDelta = mean(recent.slice(-half)) - mean(recent.slice(0, half));
        var trend = trendDelta > 0.02 ? "improving" : (trendDelta < -0.02 ? "degrading" : "steady");
        var stable = variance(recent) <= ENGINE_CFG.stableVarMax && self.framesInState >= ENGINE_CFG.stableMinFrames;

        // regression tracking — did we reach a retinal view then fall far back?
        var deepRegression = self.peakRank >= ENGINE_CFG.regressPeakRank && r <= ENGINE_CFG.regressNowRank;
        if (deepRegression) self.lostFrames++; else self.lostFrames = 0;

        var cue = V.Coach.cueFor(state, fa, readiness);
        var confidence = fuseConfidence(fa, align, readiness);
        var failure = failureFor(state, fa, cue, gates);

        // Safety priority-1 override (README 05): SEVERE, SUSTAINED glare washing out an actual
        // retinal image preempts the state's cue with a red instruction. Gated so it only applies
        // once we are imaging the eye (rank >= RED_REFLEX — before that there is no image to wash out
        // and "find the eye" is the right instruction; also avoids the makeFrameAnalysis default
        // reflection=1.0 firing on an empty first frame). Driven by SMOOTHED reflection with
        // hysteresis so a single-frame spike never flips the safety tier.
        // Only smooth over reflections from IMAGING frames (rank >= RED_REFLEX). The FSM can jump
        // several ranks in a single frame, so an unfiltered window would be poisoned by the bright
        // ambient-scene reflections recorded while merely finding the eye — falsely firing the glare
        // critical on the transition frame.
        var redReflexRank = rank(STATE.RED_REFLEX);
        var recentRefl = self.history.slice(-ENGINE_CFG.smoothWindow)
          .filter(function (h) { return h.rank >= redReflexRank; })
          .map(function (h) { return h.reflection; });
        var smoothedReflection = recentRefl.length ? median(recentRefl) : 0;
        var imaging = r >= redReflexRank;
        if (imaging && smoothedReflection >= CRITICAL_GLARE) self.criticalGlareActive = true;
        else if (!imaging || smoothedReflection < CRITICAL_GLARE - ENGINE_CFG.glareHysteresis) self.criticalGlareActive = false;
        var critical = self.criticalGlareActive
          ? { code: "severe_glare", text: "Too much glare — dim the light or change the angle", detail: "Bright light is washing out the retinal view — dim the room or tilt away from the light." }
          : null;
        var gDetail = critical ? critical.detail : (V.Coach.detailFor ? V.Coach.detailFor(state) : "");
        var gTier = critical ? "critical" : (cue.tone === "warn" ? "warn" : (r >= rank(STATE.READY) ? "good" : "info"));
        var gPriority = critical ? PRIORITY.SAFETY : (failure ? failure.priority : (r >= rank(STATE.READY) ? PRIORITY.CAPTURE : PRIORITY.EYE));

        // ---- capture decision (README 05): exactly one of Capture / Wait / Continue / Restart ----
        var ready = !!readiness.ready;
        var canManual = Math.round(clamp01(readiness.overall) * 100) >= self.manualThreshold;
        var decision, reason;
        if (self.lostFrames >= ENGINE_CFG.regressLostFrames) {
          decision = DECISION.RESTART;
          reason = "retinal view lost for " + self.lostFrames + " frames — restart acquisition";
        } else if (step.shouldCapture) {
          // Auto-capture timing is owned by the validated FSM (READY sustained). Never loosened.
          decision = DECISION.CAPTURE;
          reason = "diagnostic-quality retina held steady";
        } else if (state === STATE.READY || (ready && !stable)) {
          decision = DECISION.WAIT;
          reason = ready ? "quality reached — steadying before capture" : "hold steady";
        } else {
          decision = DECISION.CONTINUE;
          reason = failure ? failure.code : "guiding";
        }

        var explain = {
          schemaVersion: SCHEMA_VERSION,
          state: state, prevState: self.prevState, changed: changed,
          transitionReason: changed ? ("advanced to " + state) : (failure ? failure.code : "holding"),
          framesInState: self.framesInState,
          blockingState: failure ? state : null,
          failure: failure,
          confidence: confidence,
          readiness: clamp01(readiness.overall), smoothedReadiness: smoothed, diagnostic: readiness.diagnostic,
          stability: { stable: stable, trend: trend, variance: variance(recent) },
          capture: { decision: decision, reason: reason },
          critical: critical ? critical.code : null,
          priority: gPriority,
          mode: self.mode
        };

        var out = {
          schemaVersion: SCHEMA_VERSION,
          // ---- preserved fields (identical semantics to sm.step, so the UI is unchanged) ----
          state: state, changed: changed,
          readiness: readiness, gates: gates, diagnostic: step.diagnostic, alignment: align,
          stalled: step.stalled, shouldCapture: step.shouldCapture,
          // ---- new consolidations ----
          prevState: self.prevState,
          step: V.Storyboard ? V.Storyboard.stepFor(state) : null,
          confidence: confidence,
          guidance: { text: critical ? critical.text : cue.text, detail: gDetail, arrow: critical ? null : cue.arrow, haptic: critical ? "warning" : cue.haptic, voice: critical ? critical.text : cue.voice, tone: cue.tone, tier: gTier, priority: gPriority, critical: critical ? critical.code : null },
          capture: { decision: decision, reason: reason, canManual: canManual, ready: ready, sustained: !!step.shouldCapture },
          failure: failure,
          stability: { stable: stable, trend: trend, smoothedReadiness: smoothed, variance: variance(recent), framesInState: self.framesInState },
          explain: explain
        };
        self.last = out;
        return out;
      }
    };
    return self;
  }

  // ---- PerfMeter (README 08: per-stage frame timing + rolling FPS/latency) ----------------
  // Pure timing aggregator. mark() records a frame's per-stage timestamps (ms, e.g. from
  // performance.now); stats() returns rolling FPS + mean stage latencies over a window. The
  // JS-side stages (analyze/decide/render) are measurable without a device; native camera/GPU
  // latencies are supplied by the native plugin when present (else reported as null).
  function perfRound(n) { return (n == null || n !== n) ? null : Math.round(n * 10) / 10; }
  function createPerfMeter(opts) {
    opts = opts || {};
    var win = opts.window || 30;
    var frames = [], lastFrameTs = null;
    function stageAvg(from, to) {
      var sum = 0, n = 0;
      for (var i = 0; i < frames.length; i++) {
        var s = frames[i].stages;
        if (s && s[to] != null && s[from] != null) { sum += (s[to] - s[from]); n++; }
      }
      return n ? sum / n : null;
    }
    return {
      // stages: { capture, analyze, decide, render } timestamps in ms. Returns the frame record.
      mark: function (stages) {
        stages = stages || {};
        var now = stages.render != null ? stages.render : (stages.decide != null ? stages.decide : stages.analyze);
        var dt = (lastFrameTs != null && now != null) ? (now - lastFrameTs) : null;
        lastFrameTs = now;
        var rec = { ts: now, dt: dt, stages: stages };
        frames.push(rec); if (frames.length > win) frames.shift();
        return rec;
      },
      stats: function () {
        if (!frames.length) return { frames: 0, fps: 0, latencyMs: null, analyzeMs: null, decideMs: null, renderMs: null };
        var sumDt = 0, nDt = 0;
        for (var i = 0; i < frames.length; i++) { if (frames[i].dt != null && frames[i].dt > 0) { sumDt += frames[i].dt; nDt++; } }
        var meanDt = nDt ? sumDt / nDt : null;
        var lat = stageAvg("capture", "render"); if (lat == null) lat = stageAvg("capture", "decide");
        return {
          frames: frames.length,
          fps: meanDt ? Math.round(1000 / meanDt) : 0,
          latencyMs: perfRound(lat),
          analyzeMs: perfRound(stageAvg("capture", "analyze")),
          decideMs: perfRound(stageAvg("analyze", "decide")),
          renderMs: perfRound(stageAvg("decide", "render"))
        };
      },
      reset: function () { frames = []; lastFrameTs = null; }
    };
  }

  var API = {
    VERSION: VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MODE: MODE,
    DECISION: DECISION,
    LEVEL: LEVEL,
    PRIORITY: PRIORITY,
    ENGINE_CFG: ENGINE_CFG,
    create: create,
    createPerfMeter: createPerfMeter
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;   // node/test
  if (typeof window !== "undefined") window.SMD_FUNDX_ENGINE = API;            // browser
})();
