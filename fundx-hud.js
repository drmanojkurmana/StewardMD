/* fundx-hud.js — FundX AI · Optical Corridor™ HUD (presentation layer).
 *
 * A spatial-AR acquisition HUD rendered as SVG over the live camera. It is a PURE CONSUMER of the
 * existing engine — it changes nothing in fundx-vision.js / fundx-engine.js / fundx-detect.js and
 * never gates capture (capture stays owned by the validated readiness + retinal-quality path). It
 * replaces the flat ring + arrow + score with the Optical Corridor: concentric rings receding to a
 * vanishing point on the optical axis, a shrinking centre reticle, directional flow chevrons, a warm
 * red-reflex bloom, a hold ring, and a soft capture bloom.
 *
 * Design source: "FundX AI · Optical Corridor™ Engineering Handoff v1.0". Everything binds to real
 * engine fields (step.state/gates/readiness/shouldCapture/guidance + FrameAnalysis fundusCenter/
 * redReflex/focus/pupilOffset...). Motion is continuous morph: params lerp toward the current
 * stage's target every frame (τ≈120 ms); elements only fade — nothing pops or flashes.
 *
 * CRITICAL (handoff §01/§15): the "lens/reflex/retina" corridor segments only light from REAL
 * optical evidence (redReflex + fundus + vessels), so a bare face can never look capture-ready —
 * the false-readiness the flat ring produced is impossible in this visual language.
 *
 * Flag-gated (smd_fundx_corridor, default OFF → the legacy ring renders, an instant no-deploy
 * revert). deriveTargets() is DOM-free + unit-tested. Exposed as window.SMD_FUNDX_HUD.
 */
(function () {
  "use strict";

  // ---- geometry + design tokens (handoff §02 / §06) ----------------------
  var VB_W = 384, VB_H = 832, CX = 192, CY = 378, MAXR = 236, LR = 118, CAM_Y = 752;
  var COL = {
    corridor: "#35e0c8", info: "#4db6d8", adjust: "#f2b34a",
    reflex: "#ff7a4d", ready: "#34d399", searching: "#9fb8c0"
  };
  // stage → corridor ring count (2 searching → 7 ready) (handoff §11)
  function ringCountFor(rank) { return Math.max(2, Math.min(7, 2 + rank)); }

  function clamp01(n) { n = +n; return n < 0 ? 0 : n > 1 ? 1 : (n !== n ? 0 : n); }
  function num(n, d) { n = +n; return n !== n ? (d || 0) : n; }

  // ---- deriveTargets: engine step + FrameAnalysis → HUD target params -----
  // Pure. `step` is SMD_FUNDX_ENGINE.observe() output (or sm.step()); `fa` is the FrameAnalysis.
  // Returns the target parameter set the render loop interpolates toward (handoff §11 map).
  function deriveTargets(step, fa) {
    step = step || {}; fa = fa || {};
    var readiness = (step.readiness && step.readiness.overall) || 0;
    var gates = step.gates || {};
    var guidance = step.guidance || {};
    var state = step.state || "searching_eye";
    var rank = stageRank(state);

    // Vanishing point: the optical-axis projection. Use the observed fundus offset once a fundus
    // field exists, else the pupil offset — so the corridor BENDS off-centre and straightens as the
    // instrument comes onto axis. (handoff §08)
    var off = (fa.fundusVisible && fa.fundusCenter) ? fa.fundusCenter : (fa.pupilDir || null);
    var ox = 0, oy = 0;
    if (off) { ox = clampRange(num(off.x) * MAXR * 0.5, -MAXR, MAXR); oy = clampRange(num(off.y) * MAXR * 0.5, -MAXR, MAXR); }
    var offMag = Math.min(1, Math.sqrt((off ? num(off.x) : 0) * (off ? num(off.x) : 0) + (off ? num(off.y) : 0) * (off ? num(off.y) : 0)));

    // Optical evidence — the warm/retina layers only light from a REAL fundus field (a circular
    // illuminated retinal glow), NEVER from raw red-channel dominance. A warm/reddish bare FACE has
    // no fundus field → no bloom, no warm accent (handoff §15 — a false reflex must be impossible).
    var redReflex = clamp01(fa.redReflex);
    var hasFundus = !!fa.fundusVisible;
    var reflexLit = hasFundus ? clamp01((redReflex - 0.3) / 0.6) : 0;

    // Accent colour: state + guidance tone (handoff §06/§11). Warm only with real fundus evidence.
    var tone = guidance.tier || guidance.tone || "info";
    var accent = state === "ready" || step.shouldCapture ? COL.ready
      : (hasFundus && redReflex >= 0.45) ? COL.reflex
      : tone === "warn" || tone === "critical" ? COL.adjust
      : rank <= 0 ? COL.searching
      : rank >= stageRank("locating_fundus") ? COL.corridor
      : COL.info;

    // Directional flow: shown only while off-axis; magnitude ∝ offset; hidden as offset→0.
    var arrow = guidance.arrow || null;
    return {
      ox: ox, oy: oy,
      ringCount: ringCountFor(rank),
      reticleSize: 10 + 58 * (1 - clamp01(readiness)),
      reflexR: 20 + 76 * reflexLit,           // r 20→96, gated on a real fundus field
      reflexAlpha: reflexLit,                 // warm bloom opacity — 0 without a fundus field
      vectorAlpha: arrow ? clamp01(offMag / 0.4) : 0,
      vectorArrow: arrow,
      holdTarget: (state === "ready" || step.shouldCapture) ? 1 : 0,   // hold-ring fill target
      capture: !!step.shouldCapture,
      accent: accent,
      readiness: clamp01(readiness),
      // Ghost condensing lens: a presentation of correct lens placement (a setup proxy, NOT tracked —
      // handoff §02/§15). Present once we're positioning (rank ≥ working distance), receding as the
      // retina takes over toward capture. Lock brackets confirm only when the optical chain is proven.
      ghostLensAlpha: rank >= stageRank("working_distance") && rank < stageRank("ready") ? clamp01(0.42 * (1 - 0.5 * clamp01(readiness))) : 0,
      lockAlpha: (hasFundus && redReflex >= 0.45) ? 1 : 0,
      stageLabel: shortStage(state),
      rank: rank
    };
  }

  function clampRange(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  var STAGE_ORDER = ["searching_eye", "centering_pupil", "working_distance", "red_reflex",
    "locating_fundus", "optimizing", "assessing_quality", "ready", "capturing", "selecting", "processing", "review", "done"];
  function stageRank(s) { var i = STAGE_ORDER.indexOf(s); return i < 0 ? 0 : i; }
  function shortStage(s) {
    return { searching_eye: "Searching", centering_pupil: "Eye", working_distance: "Distance",
      red_reflex: "Reflex", locating_fundus: "Align", optimizing: "Focus", assessing_quality: "Quality",
      ready: "Hold", capturing: "Capturing", selecting: "Selecting", processing: "Analyzing",
      review: "Review", done: "Done" }[s] || "";
  }

  // ---- SVG renderer (browser) --------------------------------------------
  function svg(tag, attrs) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) for (var k in attrs) { if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]); }
    return el;
  }
  function reducedMotion() { try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  function create(opts) {
    opts = opts || {};
    var host = null, root = null, running = false, raf = 0, lastT = 0;
    var target = deriveTargets({}, {});   // desired params
    var cur = deriveTargets({}, {});      // interpolated params
    var held = 0;
    var nodes = {};

    function build() {
      root = svg("svg", { viewBox: "0 0 " + VB_W + " " + VB_H, class: "fundx-corridor", "aria-hidden": "true", preserveAspectRatio: "xMidYMid slice" });
      // corridor rings (max 7; opacity/scale set per frame)
      nodes.rings = [];
      for (var i = 0; i < 7; i++) { var r = svg("circle", { cx: CX, cy: CY, r: 1, fill: "none", "stroke-width": 2, opacity: 0 }); root.appendChild(r); nodes.rings.push(r); }
      // optical beam camera→vanishing point
      nodes.beam = svg("line", { x1: CX, y1: CAM_Y, x2: CX, y2: CY, "stroke-width": 2, opacity: 0.28, "stroke-linecap": "round" }); root.appendChild(nodes.beam);
      // ghost condensing lens (translucent ring + specular arc) — setup-proxy presentation
      nodes.ghost = svg("g", { opacity: 0 });
      nodes.ghost.appendChild(svg("circle", { cx: CX, cy: CY, r: LR, fill: "none", stroke: "#cfe8ec", "stroke-width": 2, opacity: 0.7 }));
      nodes.ghost.appendChild(svg("circle", { cx: CX, cy: CY, r: LR - 7, fill: "rgba(180,220,225,0.045)", stroke: "none" }));
      nodes.ghost.appendChild(svg("path", { d: "M " + (CX - 44) + " " + (CY - LR + 12) + " A " + LR + " " + LR + " 0 0 1 " + (CX + 44) + " " + (CY - LR + 12), fill: "none", stroke: "#eafcff", "stroke-width": 3, "stroke-linecap": "round", opacity: 0.85 }));
      root.appendChild(nodes.ghost);
      // lens-lock brackets (four corners) — confirm the locked optical chain (fade in on lock)
      nodes.lock = svg("g", { opacity: 0 });
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) {
        var x = CX + c[0] * 150, y = CY + c[1] * 150, len = 22;
        nodes.lock.appendChild(svg("path", { d: "M " + (x - c[0] * len) + " " + y + " L " + x + " " + y + " L " + x + " " + (y - c[1] * len), fill: "none", stroke: COL.ready, "stroke-width": 3, "stroke-linecap": "round" }));
      });
      root.appendChild(nodes.lock);
      // reflex bloom (warm radial)
      var defs = svg("defs"); var g = svg("radialGradient", { id: "fxReflexGrad" });
      g.appendChild(svg("stop", { offset: "0%", "stop-color": COL.reflex, "stop-opacity": "0.9" }));
      g.appendChild(svg("stop", { offset: "100%", "stop-color": COL.reflex, "stop-opacity": "0" }));
      defs.appendChild(g); root.appendChild(defs);
      nodes.reflex = svg("circle", { cx: CX, cy: CY, r: 20, fill: "url(#fxReflexGrad)", opacity: 0 }); root.appendChild(nodes.reflex);
      // directional chevrons (3)
      nodes.vectors = svg("g", { opacity: 0 });
      for (var v = 0; v < 3; v++) { nodes.vectors.appendChild(svg("path", { d: "M -14 -10 L 0 0 L -14 10", fill: "none", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.9 - v * 0.28 })); }
      root.appendChild(nodes.vectors);
      // hold ring (progress arc around centre)
      nodes.hold = svg("circle", { cx: CX, cy: CY, r: 74, fill: "none", "stroke-width": 4, "stroke-linecap": "round", opacity: 0, transform: "rotate(-90 " + CX + " " + CY + ")" }); root.appendChild(nodes.hold);
      // centre reticle (shrinks to a dot as confidence rises)
      nodes.reticle = svg("circle", { cx: CX, cy: CY, r: 40, fill: "none", "stroke-width": 2.5, opacity: 0.85 }); root.appendChild(nodes.reticle);
      // capture bloom (soft, no flash)
      nodes.bloom = svg("circle", { cx: CX, cy: CY, r: 10, fill: "#dffcf5", opacity: 0 }); root.appendChild(nodes.bloom);
      return root;
    }

    function setRing(el, r, alpha, color) { el.setAttribute("r", r.toFixed(1)); el.setAttribute("opacity", alpha.toFixed(3)); el.setAttribute("stroke", color); }

    function paint() {
      var HOLD_C = 2 * Math.PI * 74;
      var vp_x = CX + cur.ox, vp_y = CY + cur.oy;
      var col = cur.accent;
      // rings: near ≈MAXR down to ≈0.1×, opacity 0.55→0.21 by depth; centres interpolate to the vp
      var count = Math.round(cur.ringCount);
      for (var i = 0; i < nodes.rings.length; i++) {
        var el = nodes.rings[i];
        if (i >= count) { el.setAttribute("opacity", 0); continue; }
        var depth = count > 1 ? i / (count - 1) : 0;           // 0 = near, 1 = far
        var rr = MAXR * (1 - 0.9 * depth);
        var a = (0.55 - 0.34 * depth) * (0.5 + 0.5 * cur.readiness);
        var e = 1 - Math.pow(1 - depth, 2);                    // easeOut → rings converge to vp
        el.setAttribute("cx", (CX + (vp_x - CX) * e).toFixed(1));
        el.setAttribute("cy", (CY + (vp_y - CY) * e).toFixed(1));
        setRing(el, rr, a, col);
      }
      // beam → vanishing point
      nodes.beam.setAttribute("x2", vp_x.toFixed(1)); nodes.beam.setAttribute("y2", vp_y.toFixed(1)); nodes.beam.setAttribute("stroke", col);
      // ghost lens + lock brackets (setup presentation + optical-chain confirmation)
      nodes.ghost.setAttribute("opacity", (cur.ghostLensAlpha || 0).toFixed(3));
      nodes.lock.setAttribute("opacity", (cur.lockAlpha || 0).toFixed(3));
      // reflex bloom at the vanishing point
      nodes.reflex.setAttribute("cx", vp_x.toFixed(1)); nodes.reflex.setAttribute("cy", vp_y.toFixed(1));
      nodes.reflex.setAttribute("r", cur.reflexR.toFixed(1)); nodes.reflex.setAttribute("opacity", cur.reflexAlpha.toFixed(3));
      // directional chevrons: point from centre toward the vp, spaced along the beam
      if (cur.vectorAlpha > 0.02 && (cur.ox || cur.oy)) {
        nodes.vectors.setAttribute("opacity", cur.vectorAlpha.toFixed(3));
        var ang = Math.atan2(cur.oy, cur.ox) * 180 / Math.PI;
        var kids = nodes.vectors.childNodes;
        for (var c = 0; c < kids.length; c++) {
          var t = 0.34 + c * 0.2;
          kids[c].setAttribute("stroke", col);
          kids[c].setAttribute("transform", "translate(" + (CX + (vp_x - CX) * t).toFixed(1) + " " + (CY + (vp_y - CY) * t).toFixed(1) + ") rotate(" + ang.toFixed(1) + ")");
        }
      } else { nodes.vectors.setAttribute("opacity", 0); }
      // reticle at TRUE centre (target), shrinks with confidence
      nodes.reticle.setAttribute("r", Math.max(3, cur.reticleSize).toFixed(1)); nodes.reticle.setAttribute("stroke", col);
      // hold ring
      nodes.hold.setAttribute("opacity", (held > 0.01 ? 0.9 : 0).toFixed(3));
      nodes.hold.setAttribute("stroke", COL.ready);
      nodes.hold.setAttribute("stroke-dasharray", HOLD_C.toFixed(1));
      nodes.hold.setAttribute("stroke-dashoffset", (HOLD_C * (1 - clamp01(held))).toFixed(1));
      // capture bloom
      nodes.bloom.setAttribute("r", (10 + 120 * cur._bloom).toFixed(1)); nodes.bloom.setAttribute("opacity", (0.55 * cur._bloom).toFixed(3));
    }

    var rm = reducedMotion();
    function tick(now) {
      if (!running) return;
      var dt = lastT ? Math.min(64, now - lastT) : 16; lastT = now;
      // continuous morph toward target: P = lerp(P, target, 1 − e^(−dt/τ)) (handoff §03)
      var kPos = rm ? 1 : (1 - Math.exp(-dt / 85));
      var kMorph = rm ? 1 : (1 - Math.exp(-dt / 120));
      cur.ox += (target.ox - cur.ox) * kPos; cur.oy += (target.oy - cur.oy) * kPos;
      cur.ringCount += (target.ringCount - cur.ringCount) * kMorph;
      cur.reticleSize += (target.reticleSize - cur.reticleSize) * kMorph;
      cur.reflexR += (target.reflexR - cur.reflexR) * kMorph;
      cur.reflexAlpha += (target.reflexAlpha - cur.reflexAlpha) * kMorph;
      cur.vectorAlpha += (target.vectorAlpha - cur.vectorAlpha) * kMorph;
      cur.readiness += (target.readiness - cur.readiness) * kMorph;
      cur.ghostLensAlpha = (cur.ghostLensAlpha || 0) + ((target.ghostLensAlpha || 0) - (cur.ghostLensAlpha || 0)) * kMorph;
      cur.lockAlpha = (cur.lockAlpha || 0) + ((target.lockAlpha || 0) - (cur.lockAlpha || 0)) * kMorph;
      cur.accent = target.accent;
      // hold ring accumulates while READY, releases otherwise; capture bloom is a one-shot decay
      held += ((target.holdTarget ? 1 : 0) - held) * (target.holdTarget ? (rm ? 1 : 1 - Math.exp(-dt / 900)) : 0.25);
      cur._bloom = cur._bloom || 0;
      if (target.capture && cur._bloom < 0.02) cur._bloom = 1;
      cur._bloom *= Math.exp(-dt / 220);
      if (host) paint();
      raf = requestAnimationFrame(tick);
    }

    return {
      mount: function (container) {
        if (!container || typeof document === "undefined") return this;
        host = container; if (!root) build(); if (root.parentNode !== host) host.appendChild(root);
        rm = reducedMotion();
        if (!running) { running = true; lastT = 0; raf = requestAnimationFrame(tick); }
        return this;
      },
      push: function (step, fa) { target = deriveTargets(step, fa); target._bloom = 0; return this; },
      unmount: function () {
        running = false; if (raf) cancelAnimationFrame(raf); raf = 0; held = 0;
        try { if (root && root.parentNode) root.parentNode.removeChild(root); } catch (e) {}
        host = null; return this;
      },
      isMounted: function () { return !!host; }
    };
  }

  // ---- Lensless DESIGN PREVIEW timeline (no camera, no capture, no findings) --------------
  // demoStep(t) returns a synthetic {step, fa} for elapsed ms `t`, scripting a full successful
  // acquisition so the corridor can be evaluated on-device WITHOUT a 20D lens. Pure + testable.
  // This is a design preview only — it never captures, saves, or produces clinical output.
  var DEMO_MS = 14000;
  function demoStep(t) {
    t = Math.max(0, +t || 0);
    function ramp(a, b, t0, t1) { if (t <= t0) return a; if (t >= t1) return b; return a + (b - a) * ((t - t0) / (t1 - t0)); }
    var state = "searching_eye", redReflex = 0, focus = 0.3, fundusVisible = false, fundusCenter = null,
      pupilDir = null, readiness = 0, shouldCapture = false, distanceState = "far", arrow = null, tone = "info";
    if (t < 2000) { state = "searching_eye"; readiness = 0; }
    else if (t < 4000) { state = "centering_pupil"; pupilDir = { x: ramp(-0.5, 0, 2000, 4000), y: ramp(0.3, 0, 2000, 4000) }; arrow = "left"; readiness = ramp(0.1, 0.3, 2000, 4000); }
    else if (t < 6000) { state = "working_distance"; distanceState = t < 5000 ? "far" : "ok"; arrow = "closer"; readiness = ramp(0.3, 0.45, 4000, 6000); }
    else if (t < 8000) { state = "red_reflex"; redReflex = ramp(0.1, 0.72, 6000, 8000); fundusVisible = t > 6600; fundusCenter = { x: ramp(0.5, 0.35, 6600, 8000), y: -0.2 }; readiness = ramp(0.45, 0.55, 6000, 8000); }
    else if (t < 10000) { state = "locating_fundus"; redReflex = 0.78; fundusVisible = true; fundusCenter = { x: ramp(0.4, 0, 8000, 10000), y: ramp(-0.3, 0, 8000, 10000) }; readiness = ramp(0.55, 0.7, 8000, 10000); }
    else if (t < 12000) { state = "optimizing"; redReflex = 0.82; fundusVisible = true; fundusCenter = { x: 0, y: 0 }; focus = ramp(0.4, 0.9, 10000, 12000); readiness = ramp(0.7, 0.85, 10000, 12000); }
    else if (t < 13500) { state = "ready"; redReflex = 0.85; fundusVisible = true; fundusCenter = { x: 0, y: 0 }; focus = 0.9; readiness = ramp(0.85, 1, 12000, 13500); tone = "good"; }
    else { state = "ready"; redReflex = 0.85; fundusVisible = true; fundusCenter = { x: 0, y: 0 }; focus = 0.92; readiness = 1; shouldCapture = t < 13800; tone = "good"; }
    return {
      step: { state: state, readiness: { overall: readiness, ready: readiness >= 0.9 }, gates: {}, shouldCapture: shouldCapture, guidance: { arrow: arrow, tone: tone } },
      fa: { eyePresent: t >= 2000, redReflex: redReflex, focus: focus, fundusVisible: fundusVisible, fundusCenter: fundusCenter, pupilDir: pupilDir, distanceState: distanceState }
    };
  }

  var API = {
    VB_W: VB_W, VB_H: VB_H, CX: CX, CY: CY, MAXR: MAXR, COL: COL, DEMO_MS: DEMO_MS,
    deriveTargets: deriveTargets, stageRank: stageRank, ringCountFor: ringCountFor, create: create, demoStep: demoStep
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;   // node/test
  if (typeof window !== "undefined") window.SMD_FUNDX_HUD = API;              // browser
})();
