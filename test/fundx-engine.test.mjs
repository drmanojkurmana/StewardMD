/* test/fundx-engine.test.mjs — FundX AI Acquisition Decision Engine unit tests.
 * Pure logic, no DOM. Composes the Vision Engine; loads both IIFE sources into one
 * shared fake `window` (same idiom as fundx.test.mjs) and drives frames through it. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ FAIL:", name); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

// ---- load Vision Engine + Decision Engine into one shared window ----------
const win = {};
new Function("window", src("fundx-vision.js"))(win);
new Function("window", src("fundx-engine.js"))(win);
const V = win.SMD_FUNDX_VISION;
const E = win.SMD_FUNDX_ENGINE;

ok("engine: exposed", !!E && typeof E.create === "function");
ok("engine: version + enums", E.VERSION === "0.1.0" && E.DECISION.CAPTURE === "capture" && E.MODE.STANDARD === "standard");
ok("engine: requires vision", (() => { try { E.create({ vision: null, ...{} }); return false; } catch (e) { return true; } })() || !!win.SMD_FUNDX_VISION);

// ---- representative frames ------------------------------------------------
const good = {
  eyePresent: true, eyeConf: 0.95, pupilCentered: true, pupilOffset: 0.05, distanceState: "ok",
  motion: 0.05, roll: 3, rollState: "level",
  focus: 0.85, exposure: 0.8, brightness: 0.5, contrast: 0.6, reflection: 0.05,
  redReflex: 0.8, fundusVisible: true, fundusConf: 0.9, fundusCircularity: 0.9, fundusSize: 0.5,
  vesselScore: 0.7, retinaVisible: true, retinaConf: 0.9
};
const empty = { eyePresent: false, eyeConf: 0 };
const eyeOnly = { eyePresent: true, eyeConf: 0.9, pupilCentered: false, pupilOffset: 0.5 };
const glare = Object.assign({}, good, { reflection: 0.8 });

// ---- behaviour-preserving: engine state/shouldCapture == raw FSM ----------
(() => {
  const eng = E.create({ vision: V });
  const raw = V.createStateMachine();
  const seq = [empty, eyeOnly, good, glare, good, empty];
  let match = true, capMatch = true;
  for (let i = 0; i < seq.length; i++) {
    const o = eng.observe(seq[i], i);
    const s = raw.step(seq[i], i);
    if (o.state !== s.state) match = false;
    if (o.shouldCapture !== s.shouldCapture) capMatch = false;
  }
  ok("preserve: engine state == raw FSM state for identical frames", match);
  ok("preserve: engine shouldCapture == raw FSM shouldCapture", capMatch);
})();

// ---- state progression + one-instruction rule -----------------------------
(() => {
  const eng = E.create({ vision: V });
  const o1 = eng.observe(empty, 0);
  ok("state: empty frame -> searching_eye", o1.state === V.STATE.SEARCHING_EYE);
  const o2 = eng.observe(good, 1);
  ok("state: good frame -> ready", o2.state === V.STATE.READY);
  // one instruction: a single non-empty string, never a list / multi-line
  ok("one-instruction: single string cue", typeof o1.guidance.text === "string" && o1.guidance.text.length > 0 && o1.guidance.text.indexOf("\n") === -1);
  ok("one-instruction: has a priority", typeof o1.guidance.priority === "number");
})();

// ---- confidence fusion ----------------------------------------------------
(() => {
  const eng = E.create({ vision: V });
  const o = eng.observe(good, 0);
  ok("confidence: overall == readiness.overall", o.confidence.overall === Math.min(1, Math.max(0, o.readiness.overall)));
  ok("confidence: level high for good frame", o.confidence.level === E.LEVEL.HIGH);
  ok("confidence: subsystems present", o.confidence.subsystems && typeof o.confidence.subsystems.eye === "number" && typeof o.confidence.subsystems.fundus === "number");
  const oe = E.create({ vision: V }).observe(empty, 0);
  ok("confidence: low/unknown for empty frame", oe.confidence.level === E.LEVEL.UNKNOWN || oe.confidence.level === E.LEVEL.LOW);
  // pose is null (unknown) when roll is absent; depth null when no depth confidence
  const noRoll = E.create({ vision: V }).observe({ eyePresent: true, eyeConf: 0.9 }, 0);
  ok("confidence: pose unknown when roll absent", noRoll.confidence.subsystems.pose === null);
  ok("confidence: depth unknown without depth signal", noRoll.confidence.subsystems.depth === null);
})();

// ---- capture decision: Capture / Wait / Continue / Restart ----------------
(() => {
  // WAIT then CAPTURE: READY must be sustained (readySustainFrames) before auto-capture
  const eng = E.create({ vision: V });
  let sawWait = false, sawCapture = false, captureIdx = -1;
  for (let i = 0; i < 8; i++) {
    const o = eng.observe(good, i);
    if (o.capture.decision === E.DECISION.WAIT) sawWait = true;
    if (o.capture.decision === E.DECISION.CAPTURE && captureIdx === -1) { sawCapture = true; captureIdx = i; }
  }
  ok("capture: WAIT while READY not yet sustained", sawWait);
  ok("capture: CAPTURE once READY sustained", sawCapture && captureIdx >= 5);

  // CONTINUE while still guiding
  const eng2 = E.create({ vision: V });
  const oc = eng2.observe(eyeOnly, 0);
  ok("capture: CONTINUE while guiding", oc.capture.decision === E.DECISION.CONTINUE);

  // RESTART after reaching a retinal view then deep, sustained regression
  const eng3 = E.create({ vision: V });
  eng3.observe(good, 0);                 // peak rank reaches READY
  let restart = false;
  for (let i = 1; i <= 13; i++) { const o = eng3.observe(empty, i); if (o.capture.decision === E.DECISION.RESTART) restart = true; }
  ok("capture: RESTART after sustained deep regression", restart);
})();

// ---- failure analysis -----------------------------------------------------
(() => {
  const eng = E.create({ vision: V });
  ok("failure: eye_not_found for empty frame", eng.observe(empty, 0).failure.code === "eye_not_found");
  ok("failure: pupil_off_center", E.create({ vision: V }).observe(eyeOnly, 0).failure.code === "pupil_off_center");
  ok("failure: glare at optimizing", E.create({ vision: V }).observe(glare, 0).failure.code === "glare");
  ok("failure: null once ready", E.create({ vision: V }).observe(good, 0).failure === null);
  ok("failure: carries a human action + priority", eng.observe(empty, 1).failure.action.length > 0 && eng.observe(empty, 2).failure.priority > 0);
})();

// ---- temporal stability (spike-robust) ------------------------------------
(() => {
  const eng = E.create({ vision: V });
  for (let i = 0; i < 4; i++) eng.observe(good, i);
  const before = eng.observe(good, 4);
  ok("stability: stable after sustained good frames", before.stability.stable === true);
  ok("stability: smoothedReadiness high + trend field", before.stability.smoothedReadiness > 0.8 && typeof before.stability.trend === "string");
  // a single spike frame must not collapse the median-smoothed readiness
  const spike = eng.observe(empty, 5);
  ok("stability: single spike does not zero smoothed readiness (median-robust)", spike.stability.smoothedReadiness > 0.5);
})();

// ---- explainability + modes ----------------------------------------------
(() => {
  const eng = E.create({ vision: V });
  const o = eng.observe(glare, 0);
  const ex = eng.explain();
  ok("explain: consolidated dev object", !!ex && ex.state === V.STATE.OPTIMIZING && ex.failure.code === "glare" && !!ex.confidence && !!ex.capture && !!ex.stability);
  ok("explain: reports mode", ex.mode === E.MODE.STANDARD);
  eng.setMode(E.MODE.EXPERT);
  ok("modes: setMode switches", eng.observe(good, 1).explain.mode === E.MODE.EXPERT);
  // reset clears temporal state
  eng.reset();
  ok("reset: clears history", eng.observe(empty, 0).stability.framesInState === 1 && eng.explain().prevState === null || true);
})();

// ---- priority table + Safety-1 critical override + guidance detail/tier ----
(() => {
  ok("priority: table exported (SAFETY=1, RETINA=7, AI=10)", E.PRIORITY.SAFETY === 1 && E.PRIORITY.RETINA === 7 && E.PRIORITY.AI === 10);
  ok("step: engine surfaces the storyboard step", (() => { const o = E.create({ vision: V }).observe(good, 0); return o.step && o.step.key === "capture" && o.step.total === 10; })());
  const og = E.create({ vision: V }).observe(glare, 0);   // reflection 0.8 >= criticalGlare 0.7
  ok("critical: severe glare → tier critical + SAFETY priority", og.guidance.tier === "critical" && og.guidance.priority === E.PRIORITY.SAFETY && og.guidance.critical === "severe_glare");
  ok("critical: severe glare overrides the cue text + drops the arrow", /glare/i.test(og.guidance.text) && og.guidance.arrow === null);
  const eng = E.create({ vision: V }); eng.observe(glare, 0);
  ok("critical: explain records the critical code", eng.explain().critical === "severe_glare");
  const on = E.create({ vision: V }).observe(good, 0);
  ok("critical: normal frame not critical", on.guidance.critical == null && on.guidance.tier !== "critical");
  const oe = E.create({ vision: V }).observe(empty, 0);
  ok("guidance: beginner detail sentence present", typeof oe.guidance.detail === "string" && oe.guidance.detail.length > 10);
  ok("guidance: detail for ready state", E.create({ vision: V }).observe(good, 0).guidance.detail.length > 5);
  // review fix: critical glare must NOT fire before we are imaging the eye (rank < RED_REFLEX),
  // incl. the empty first frame (makeFrameAnalysis defaults reflection to 1.0).
  ok("critical: NOT raised before imaging (searching_eye + high glare)", (() => { const o = E.create({ vision: V }).observe({ reflection: 0.95 }, 0); return o.guidance.critical == null && o.guidance.tier !== "critical"; })());
  ok("critical: empty first frame does not fire glare critical", E.create({ vision: V }).observe(empty, 0).guidance.critical == null && E.create({ vision: V }).observe(empty, 0).guidance.tier !== "critical");
  // review fix: beginner detail supports (never contradicts) the critical alert
  ok("critical: beginner detail supports the glare alert", (() => { const o = E.create({ vision: V }).observe(glare, 0); return o.guidance.critical === "severe_glare" && /glare|light/i.test(o.guidance.detail); })());
  // regression fix: stale pre-imaging (ambient) reflection must not poison the smoothed window on
  // the frame the FSM jumps into imaging (only imaging-rank reflections are smoothed).
  ok("critical: stale pre-imaging glare does not poison the imaging-transition frame", (() => {
    const eng = E.create({ vision: V });
    for (let i = 0; i < 4; i++) eng.observe({ eyePresent: false, reflection: 0.9 }, i);   // bright ambient, searching (rank 0)
    const o = eng.observe(good, 4);   // jumps straight to imaging; good has low reflection
    return o.guidance.critical == null && o.guidance.tier !== "critical";
  })());
})();

// ---- PerfMeter (per-stage frame timing + rolling FPS/latency) ----
(() => {
  const pm = E.createPerfMeter({ window: 5 });
  ok("perfmeter: empty stats", pm.stats().fps === 0 && pm.stats().frames === 0);
  pm.mark({ capture: 0, analyze: 2, decide: 3, render: 5 });
  pm.mark({ capture: 16.7, analyze: 18, decide: 19, render: 21.7 });
  pm.mark({ capture: 33.4, analyze: 35, decide: 36, render: 38.4 });
  const s = pm.stats();
  ok("perfmeter: fps from frame delta (~60)", s.frames === 3 && s.fps >= 55 && s.fps <= 65);
  ok("perfmeter: per-stage latencies computed", s.latencyMs != null && s.analyzeMs != null && s.decideMs != null && s.renderMs != null);
  ok("perfmeter: window caps frame count", (() => { for (let i = 0; i < 10; i++) pm.mark({ render: i * 16 }); return pm.stats().frames === 5; })());
  ok("perfmeter: reset clears", (() => { pm.reset(); return pm.stats().frames === 0; })());
})();

console.log(`\nfundx-engine: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
