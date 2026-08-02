/* test/fundx.test.mjs — FundX AI Vision Engine + store + flag-gating unit tests.
 * Pure logic, no DOM. Runs under `npm test`. Loads the browser IIFE sources with
 * readFileSync + new Function and injects fake window/localStorage/location. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ FAIL:", name); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

function fakeLocalStorage() {
  const store = {};
  return { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, _store: store };
}

// ---- load Vision Engine -------------------------------------------------
const winV = {};
new Function("window", src("fundx-vision.js"))(winV);
const V = winV.SMD_FUNDX_VISION;
ok("vision: exposed", !!V);
ok("vision: version + schema", V.VERSION === "0.1.0" && V.SCHEMA_VERSION === 1);

// makeFrameAnalysis clamps + defaults
const fa0 = V.makeFrameAnalysis({ eyeConf: 5, focus: -3 });
ok("frameAnalysis: clamps to [0,1]", fa0.eyeConf === 1 && fa0.focus === 0);
ok("frameAnalysis: defaults present", fa0.schemaVersion === 1 && fa0.reflection === 1 && fa0.motion === 1);

// A fully-passing frame — driven by observable optical/image cues, NO lens fields.
const good = {
  eyePresent: true, eyeConf: 0.95, pupilCentered: true, pupilOffset: 0.05, distanceState: "ok",
  motion: 0.05, roll: 3, rollState: "level",
  focus: 0.9, exposure: 0.85, brightness: 0.7, contrast: 0.7, noise: 0.1, reflection: 0.1,
  redReflex: 0.8, fundusVisible: true, fundusConf: 0.9, fundusCircularity: 0.8, fundusCenter: { x: 0.02, y: 0.02 }, fundusSize: 0.6,
  vesselScore: 0.7
};

// no lens gate exists anywhere
ok("engine: no lens gate in the readiness gate map", V.ReadinessScore.compute(good).gates.lens === undefined);
ok("engine: no DETECTING_LENS state", V.STATE.DETECTING_LENS === undefined && V.STATE.LOCATING_FUNDUS === "locating_fundus");

// Alignment (eye + pupil + distance + glow; no lens term)
const al = V.AlignmentEngine.compute(good);
ok("alignment: optical high + acceptable", al.opticalAxisConfidence > 0.9 && al.acceptable === true && al.lensAlignment === undefined);
ok("alignment: empty not acceptable", V.AlignmentEngine.compute({}).acceptable === false);

// Readiness — quality-driven gates
const r = V.ReadinessScore.compute(good);
ok("readiness: all gates pass → ready", r.ready === true && r.overall >= 0.9);
ok("readiness: quality-driven gate map", r.gates.eye && r.gates.pupil && r.gates.fundus && r.gates.vessels && r.gates.quality && r.gates.focus);
ok("readiness: diagnostic composite present + high", r.diagnostic >= V.CFG.diagnosticMin);
const rEmpty = V.ReadinessScore.compute({});
ok("readiness: empty frame not ready", rEmpty.ready === false && rEmpty.gates.eye === false && rEmpty.gates.quality === false);

// State machine: empty → searching_eye; good → READY (never blocks on a lens)
const sm = V.createStateMachine();
ok("stateMachine: empty → searching_eye", sm.step({}).state === V.STATE.SEARCHING_EYE);
let last;
for (let i = 0; i < V.CFG.readySustainFrames + 1; i++) last = sm.step(good, i);
ok("stateMachine: good frame → ready (quality-gated)", last.state === V.STATE.READY);
ok("stateMachine: sustained ready → shouldCapture", last.shouldCapture === true);
ok("stateMachine: regresses when eye lost", sm.step({}).state === V.STATE.SEARCHING_EYE);
sm.set(V.STATE.CAPTURING);
ok("stateMachine: UI state held during frames", sm.step(good).state === V.STATE.CAPTURING);

// A frame with good geometry but NO diagnostic image quality must NOT auto-capture,
// and must NOT stall on any lens step — it waits at the quality/fundus stage.
const sm2 = V.createStateMachine();
const geomOnly = { eyePresent: true, eyeConf: 0.9, pupilCentered: true, pupilOffset: 0.05, distanceState: "ok", redReflex: 0.6, motion: 0.05 };
let s2; for (let i = 0; i < 10; i++) s2 = sm2.step(geomOnly, i);
ok("stateMachine: no fundus/quality → not READY, not a lens stall", s2.state !== V.STATE.READY && s2.shouldCapture !== true && [V.STATE.LOCATING_FUNDUS, V.STATE.RED_REFLEX, V.STATE.WORKING_DISTANCE].indexOf(s2.state) >= 0);

// Optional operator-confirm fallback: OFF by default; ON only relaxes SETUP, never quality.
V.CFG.lensConfirmFallback = true;
const sm3 = V.createStateMachine(); sm3.confirmLensPositioned();
let s3; for (let i = 0; i < 6; i++) s3 = sm3.step({ eyePresent: true, eyeConf: 0.9, pupilCentered: true, pupilOffset: 0.05, distanceState: "unknown", redReflex: 0.1 }, i);
ok("fallback: confirm advances past setup proxies (distance/red-reflex)", [V.STATE.LOCATING_FUNDUS, V.STATE.RED_REFLEX].indexOf(s3.state) >= 0 || s3.gates.distance === true);
ok("fallback: still never auto-captures without diagnostic quality", s3.shouldCapture !== true);
V.CFG.lensConfirmFallback = false;

// QualityEngine — image quality (fundus + vessels), not disease structures
const q = V.QualityEngine.score(good);
ok("quality: good frame accepted, no reasons", q.accepted === true && q.overall >= 65 && q.reasons.length === 0 && q.subscores.fundusVisibility >= 0.8);
// A non-retinal frame (no red reflex / fundus) is STAGE-1 GATED — no retinal quality is computed.
const qBad = V.QualityEngine.score({ focus: 0.1, exposure: 0.1, reflection: 0.9 });
ok("quality: non-retinal frame gated (retinalGate false, no red reflex)", qBad.retinalGate === false && qBad.accepted === false && qBad.reasons.indexOf("no_red_reflex") >= 0);
// A RETINAL frame (passes the gate) with poor image quality is rejected with the quality reasons.
const qPoor = V.QualityEngine.score({ redReflex: 0.7, fundusVisible: true, fundusConf: 0.7, fundusCircularity: 0.6, retinaConf: 0.7, focus: 0.1, exposure: 0.1, reflection: 0.9, vesselScore: 0.1, fundusSize: 0.6 });
ok("quality: retinal-but-poor frame scored + rejected + reasons", qPoor.retinalGate === true && qPoor.accepted === false && qPoor.reasons.indexOf("poor_focus") >= 0);

// ===== STAGE-1 RETINAL GATE: every non-retinal scene must be REJECTED before scoring =====
// Realistic heuristic values (sharp focus, some texture → false fundus/vessel), but no red reflex
// and no circular fundus — exactly what let the curtain scene through before the gate.
const nonRetinal = {
  room:     { focus: 0.60, exposure: 0.60, reflection: 0.10, redReflex: 0.02, fundusVisible: true, fundusConf: 0.20, fundusCircularity: 0.10, vesselScore: 0.20 },
  window:   { focus: 0.85, exposure: 0.90, reflection: 0.05, redReflex: 0.05, fundusVisible: true, fundusConf: 0.40, fundusCircularity: 0.15, vesselScore: 0.50 },
  curtains: { focus: 0.84, exposure: 0.85, reflection: 0.00, redReflex: 0.09, fundusVisible: true, fundusConf: 0.52, fundusCircularity: 0.13, vesselScore: 0.72 }, // the reported bug
  wall:     { focus: 0.50, exposure: 0.70, reflection: 0.05, redReflex: 0.00, fundusVisible: false, fundusConf: 0.10, fundusCircularity: 0.05, vesselScore: 0.05 },
  desk:     { focus: 0.70, exposure: 0.65, reflection: 0.10, redReflex: 0.03, fundusVisible: true, fundusConf: 0.30, fundusCircularity: 0.20, vesselScore: 0.30 },
  laptop:   { focus: 0.90, exposure: 0.80, reflection: 0.15, redReflex: 0.04, fundusVisible: true, fundusConf: 0.35, fundusCircularity: 0.20, vesselScore: 0.60 },
  phone:    { focus: 0.85, exposure: 0.75, reflection: 0.20, redReflex: 0.05, fundusVisible: true, fundusConf: 0.30, fundusCircularity: 0.25, vesselScore: 0.40 },
  clothing: { focus: 0.60, exposure: 0.60, reflection: 0.08, redReflex: 0.08, fundusVisible: true, fundusConf: 0.30, fundusCircularity: 0.20, vesselScore: 0.60 },
  face:     { eyePresent: true, eyeConf: 0.90, pupilCentered: true, focus: 0.80, exposure: 0.70, reflection: 0.10, redReflex: 0.15, fundusVisible: true, fundusConf: 0.30, fundusCircularity: 0.30, vesselScore: 0.40 },
  hand:     { focus: 0.70, exposure: 0.65, reflection: 0.10, redReflex: 0.10, fundusVisible: true, fundusConf: 0.25, fundusCircularity: 0.20, vesselScore: 0.30 },
  ceiling:  { focus: 0.50, exposure: 0.80, reflection: 0.05, redReflex: 0.00, fundusVisible: false, fundusConf: 0.10, fundusCircularity: 0.05, vesselScore: 0.10 }
};
Object.keys(nonRetinal).forEach(function (name) {
  const qs = V.QualityEngine.score(nonRetinal[name]);
  ok("retinal-gate: " + name + " REJECTED before scoring", qs.retinalGate === false && qs.accepted === false && qs.overall === 0);
});
// Positive control: a genuine fundus view PASSES the gate and IS scored.
const qFundus = V.QualityEngine.score({ redReflex: 0.75, fundusVisible: true, fundusConf: 0.85, fundusCircularity: 0.75, retinaConf: 0.8, vesselScore: 0.7, focus: 0.85, exposure: 0.8, reflection: 0.1, fundusSize: 0.6 });
ok("retinal-gate: genuine fundus PASSES + accepted", qFundus.retinalGate === true && qFundus.accepted === true && qFundus.overall >= 60);
// BestFrameSelector over a burst of non-retinal frames must not accept any.
const bfsBad = V.BestFrameSelector.select(Object.keys(nonRetinal).map(function (k) { return { metrics: nonRetinal[k] }; }));
ok("retinal-gate: best of an all-non-retinal burst is not accepted", bfsBad.scores.every(function (s) { return s.accepted === false && s.retinalGate === false; }));

// ===== expanded adversarial corpus: warm, circular, BRIGHT but FEATURELESS (no vessels) =====
// A SHARP warm glowing disk (lamp, ember, sunset through a round window) can clear red-reflex +
// circular-fundus + retina-confidence yet has NO retinal vessels. Before Stage-1 structural
// corroboration this was the remaining hole — it must now be REJECTED with no_retinal_structure.
const featurelessWarm = {
  lamp:     { redReflex: 0.72, fundusVisible: true, fundusConf: 0.62, fundusCircularity: 0.70, retinaConf: 0.62, vesselScore: 0.05, focus: 0.85, exposure: 0.80 },
  glowDisk: { redReflex: 0.60, fundusVisible: true, fundusConf: 0.58, fundusCircularity: 0.55, retinaConf: 0.58, vesselScore: 0.08, focus: 0.75, exposure: 0.75 },
  ember:    { redReflex: 0.90, fundusVisible: true, fundusConf: 0.55, fundusCircularity: 0.60, retinaConf: 0.55, vesselScore: 0.02, focus: 0.70, exposure: 0.85 }
};
Object.keys(featurelessWarm).forEach(function (name) {
  const qs = V.QualityEngine.score(featurelessWarm[name]);
  ok("retinal-gate: featureless warm '" + name + "' REJECTED (no vessel structure)", qs.retinalGate === false && qs.accepted === false && qs.overall === 0 && qs.reasons.indexOf("no_retinal_structure") >= 0);
});
// A genuinely retinal but OUT-OF-FOCUS frame is EXEMPT from the vessel requirement (blur suppresses
// vessels) — it still passes the gate and is scored, then rejected for poor focus. Nothing unsafe
// is accepted, but a real (recoverable) fundus view is never wrongly gated as "not an eye".
const qBlurryReal = V.QualityEngine.score({ redReflex: 0.7, fundusVisible: true, fundusConf: 0.7, fundusCircularity: 0.6, retinaConf: 0.7, vesselScore: 0.08, focus: 0.15, exposure: 0.6 });
ok("retinal-gate: blurry-but-real fundus passes gate (blur-exempt) then quality-rejected", qBlurryReal.retinalGate === true && qBlurryReal.accepted === false);

// ===== Workflow 2 · upload mode: an EXISTING full-frame fundus fills the frame (low circularity) =====
// It must be REJECTED by the live "circular red-reflex glow" gate but ACCEPTED in upload mode, while
// upload mode still rejects genuinely non-retinal images (warmth + vessels remain required).
const fullFrameFundus = { redReflex: 0.7, fundusVisible: true, fundusConf: 0.8, fundusCircularity: 0.2, retinaConf: 0.8, vesselScore: 0.6, focus: 0.7, exposure: 0.7 };
ok("upload: full-frame fundus rejected in LIVE mode (needs circular glow)", V.QualityEngine.score(fullFrameFundus).retinalGate === false);
ok("upload: full-frame fundus PASSES in upload mode (circularity relaxed) + scored", V.QualityEngine.score(fullFrameFundus, { upload: true }).retinalGate === true && V.QualityEngine.score(fullFrameFundus, { upload: true }).overall > 0);
ok("upload: non-retinal still rejected in upload mode", V.QualityEngine.score({ redReflex: 0.05, fundusVisible: false, fundusConf: 0.1, retinaConf: 0.1, vesselScore: 0.05, focus: 0.8 }, { upload: true }).retinalGate === false);
ok("upload: circularity still enforced in live (default) mode", V.QualityEngine.score(fullFrameFundus, {}).retinalGate === false);

// ===== hard eye gate: no eye → zero readiness (never fake acquisition progress) =====
// Everything else is perfect, but there is no eye — readiness must be zero, not a misleading
// partial score from incidental fundus-like signals.
const rNoEye = V.ReadinessScore.compute({ eyePresent: false, eyeConf: 0, redReflex: 0.8, fundusVisible: true, fundusConf: 0.9, fundusCircularity: 0.9, focus: 0.9, exposure: 0.8, reflection: 0.05, motion: 0.05, vesselScore: 0.7, distanceState: "ok" });
ok("hard-eye-gate: no eye → readiness 0 + not ready", rNoEye.overall === 0 && rNoEye.ready === false);
ok("hard-eye-gate: with eye, readiness scored normally", V.ReadinessScore.compute(good).overall > 0.5);

// ===== CaptureRingBuffer (README 08): capacity cap + best = highest score, not newest =====
const cb = V.createCaptureBuffer({ max: 5 });
ok("capture-buffer: starts empty", cb.size() === 0 && cb.best() === null);
for (let i = 0; i < 8; i++) cb.push({ ts: i, metrics: { focus: 0.1 }, dataUrl: "d" + i });
ok("capture-buffer: capacity caps size + evicts oldest", cb.size() === 5 && cb.frames()[0].ts === 3);
ok("capture-buffer: recent(n) returns the last n", cb.recent(2).length === 2 && cb.recent(2)[1].ts === 7);
// a high-quality frame in the MIDDLE, low-quality after → best() finds the middle one, not newest
const cb2 = V.createCaptureBuffer({ max: 10 });
cb2.push({ ts: 0, metrics: { focus: 0.2 } });
cb2.push({ ts: 1, metrics: good, dataUrl: "BEST" });   // genuine fundus → high score
cb2.push({ ts: 2, metrics: { focus: 0.2 } });           // newest, but low score
const cbBest = cb2.best();
ok("capture-buffer: best = highest score, NOT newest", cbBest && cbBest.frame.dataUrl === "BEST" && cbBest.frame.ts === 1 && cbBest.score >= 60);
ok("capture-buffer: push computes retinal-gated score", cb2.frames()[0].retinalGate === false && cb2.frames()[1].retinalGate === true);
// bestAccepted returns only a usable (retinal + quality) frame, else null — never a best-of-bad
const cbBad = V.createCaptureBuffer({ max: 4 });
[nonRetinal.room, nonRetinal.wall, nonRetinal.desk].forEach((m) => cbBad.push({ metrics: m }));
ok("capture-buffer: bestAccepted null when nothing usable", cbBad.bestAccepted() === null && cbBad.best().score === 0);

// ===== QualityWords (README 03: clinician sees words, never scores) =====
ok("quality-words: 90 → Excellent", V.qualityWord(90).label === "Excellent" && V.qualityWord(90).tone === "good");
ok("quality-words: 75 → Good", V.qualityWord(75).label === "Good");
ok("quality-words: 62 → Acceptable", V.qualityWord(62).label === "Acceptable");
ok("quality-words: 40 → Retake recommended", V.qualityWord(40).label === "Retake recommended" && V.qualityWord(40).tone === "warn");
ok("quality-words: gated result → No retina detected", V.qualityWord({ retinalGate: false, overall: 0 }).label === "No retina detected" && V.qualityWord({ retinalGate: false }).gated === true);
ok("quality-words: accepts a QualityScore object", V.qualityWord({ retinalGate: true, overall: 88 }).label === "Excellent");

// ===== Coach.detailFor (beginner-mode verbose coaching) =====
ok("coach-detail: searching_eye has a full sentence", V.Coach.detailFor(V.STATE.SEARCHING_EYE).length > 20);
ok("coach-detail: ready has a sentence", V.Coach.detailFor(V.STATE.READY).length > 5);
ok("coach-detail: unknown state → empty", V.Coach.detailFor("nope") === "");

// ===== Storyboard (README 03 live progress model) =====
ok("storyboard: 10 named steps", V.Storyboard.total === 10 && V.Storyboard.steps.length === 10);
ok("storyboard: searching_eye → step 1", V.Storyboard.stepFor(V.STATE.SEARCHING_EYE).index === 1 && V.Storyboard.stepFor(V.STATE.SEARCHING_EYE).total === 10);
ok("storyboard: ready + capturing → capture step", V.Storyboard.stepFor(V.STATE.READY).key === "capture" && V.Storyboard.stepFor(V.STATE.CAPTURING).key === "capture");
ok("storyboard: review states → review step", V.Storyboard.stepFor(V.STATE.REVIEW).key === "review");
ok("storyboard: progress increases with the journey", V.Storyboard.stepFor(V.STATE.RED_REFLEX).progress > V.Storyboard.stepFor(V.STATE.SEARCHING_EYE).progress);
ok("storyboard: pre/unknown state → null", V.Storyboard.stepFor("idle") === null);

// BestFrameSelector
const bfs = V.BestFrameSelector.select([{ metrics: { focus: 0.2 } }, { metrics: good }, { metrics: { focus: 0.5 } }]);
ok("bestFrame: picks the good frame + fundus/vessel picks", bfs.best === 1 && bfs.scores.length === 3 && bfs.bestFundus === 1 && bfs.bestVessel === 1);
ok("bestFrame: empty → -1", V.BestFrameSelector.select([]).best === -1);

// MockRetinaModel determinism + swap interface
const ctx = { patientRef: "MRN1", eye: "right", ts: 111 };
const m1 = V.MockRetinaModel.analyze({ quality: 90 }, ctx);
const m2 = V.MockRetinaModel.analyze({ quality: 90 }, ctx);
ok("mockModel: deterministic per ctx", JSON.stringify(m1) === JSON.stringify(m2));
const m3 = V.MockRetinaModel.analyze({ quality: 90 }, { patientRef: "MRN2", eye: "left", ts: 222 });
ok("mockModel: varies across ctx", JSON.stringify(m1) !== JSON.stringify(m3));
ok("mockModel: flagged non-diagnostic", m1.is_mock === true && m1.provider === "mock" && /not a diagnosis/i.test(m1.disclaimer));
// registerRetinaModel swaps the provider without touching contracts
const fake = { provider: "vertex", modelVersion: "gemini-x", analyze: () => ({ schemaVersion: 1, provider: "vertex", model_version: "gemini-x", findings: 1 }) };
V.registerRetinaModel(fake);
ok("retinaModel: swap point works", V.getRetinaModel().provider === "vertex");
V.registerRetinaModel(null);
ok("retinaModel: reverts to mock", V.getRetinaModel().provider === "mock");

// Findings builder + validation
const built = V.Findings.build({ ctx, quality: q, now: 999 });
ok("findings: versioned + engine=vision", built.schemaVersion === 1 && built.engine === "vision" && built.generatedAt === 999);
ok("findings: validate ok", V.validate.findings(built).ok === true);
ok("findings: validate catches bad", V.validate.findings({}).ok === false);

// Coach
// rotate coaching from phone roll
const cueRot = V.Coach.cueFor(V.STATE.OPTIMIZING, { rollState: "cw", roll: 30, focus: 0.9, exposure: 0.9, reflection: 0.1, motion: 0.05 });
ok("coach: phone rolled cw → rotate counter-clockwise cue", cueRot.arrow === "rot_ccw" && /counter-clockwise/i.test(cueRot.voice));
// direction from the observed fundus field offset
const cueFund = V.Coach.cueFor(V.STATE.LOCATING_FUNDUS, { fundusVisible: true, fundusCenter: { x: -0.6, y: 0.1 }, fundusSize: 0.6, distanceState: "ok" });
ok("coach: fundus offset left → move left", cueFund.arrow === "left");
const cue = V.Coach.cueFor(V.STATE.CENTERING_PUPIL, { pupilDir: { x: 0.8, y: 0.1 } });
ok("coach: centering emits right arrow", cue.arrow === "right" && !!cue.text && !!cue.voice);
const cueReady = V.Coach.cueFor(V.STATE.READY, good);
ok("coach: ready is positive tone + success haptic", cueReady.tone === "good" && cueReady.haptic === "success");

// ScanRecord validation (nine mandated fields)
const goodRec = { id: "s1", originalImage: "x", processedImage: "x", quality: q, acquisition: { eye: "right" }, vision: built, patientContext: { ref: "MRN1" }, timestamp: 1, device: { platform: "ios" }, provider: { provider: "mock" }, audit: { operator: "dr" } };
ok("scanRecord: complete record valid", V.validate.scanRecord(goodRec).ok === true);
ok("scanRecord: missing field flagged", V.validate.scanRecord({ id: "s1" }).ok === false);

// ---- load Store (native path with fake Filesystem) ----------------------
const writes = [];
const fakeFs = {
  writeFile: (o) => { writes.push(o.path); return Promise.resolve(); },
  getUri: (o) => Promise.resolve({ uri: "file:///data/" + o.path }),
  deleteFile: () => Promise.resolve()
};
const winS = { SMD_FUNDX_VISION: V, SMD_IS_NATIVE: true, Capacitor: { isNativePlatform: () => true, Plugins: { Filesystem: fakeFs } } };
const lsS = fakeLocalStorage();
new Function("window", "localStorage", src("fundx-store.js"))(winS, lsS);
const STORE = winS.SMD_FUNDX_STORE;
ok("store: exposed", !!STORE);

await (async () => {
  const meta = await STORE.saveScan(goodRec);
  ok("store: saveScan wrote 2 images (orig+proc)", writes.length === 2);
  ok("store: meta strips heavy image dataURLs", meta.originalImage === undefined && meta.processedImage === undefined);
  ok("store: meta keeps image refs", !!(meta.images && meta.images.original && meta.images.original.uri));
  const list = await STORE.listScans("MRN1");
  ok("store: listScans by patient", list.length === 1 && list[0].id === "s1");
  const none = await STORE.listScans("OTHER");
  ok("store: listScans filters other patients", none.length === 0);
  const uri = await STORE.imageUri("s1", "original");
  ok("store: imageUri returns native uri", /^file:\/\//.test(uri));
  const got = await STORE.getScan("s1");
  ok("store: getScan by id", got && got.id === "s1");
  await STORE.saveScan(goodRec);
  const all = await STORE.listScans();
  ok("store: re-save updates in place (no dupe)", all.filter((m) => m.id === "s1").length === 1);
  // updateScan: metadata-only patch (clinician oversight) — must NOT require the stripped images
  const upd = await STORE.updateScan("s1", { clinicianReview: { status: "accepted", history: [{ action: "accept" }] } });
  ok("store: updateScan patches meta without image re-validation", upd && upd.clinicianReview && upd.clinicianReview.status === "accepted");
  const reGot = await STORE.getScan("s1");
  ok("store: updateScan persists clinicianReview", reGot && reGot.clinicianReview && reGot.clinicianReview.status === "accepted");
  ok("store: updateScan on unknown id → null (no throw)", (await STORE.updateScan("nope", { x: 1 })) === null);
  await STORE.deleteScan("s1");
  const after = await STORE.listScans();
  ok("store: deleteScan removes record", after.length === 0);
  // invalid record rejected
  let rejected = false;
  try { await STORE.saveScan({ id: "bad" }); } catch (e) { rejected = true; }
  ok("store: saveScan rejects invalid record", rejected === true);
  // learning + operator
  const lp = STORE.learning.completeLevel(1, 5);
  ok("store: learning.completeLevel", lp.levels[1].done === true);
  const op = STORE.operator.record({ quality: 80, captures: 1 }, 5);
  ok("store: operator.record aggregates", op.scans === 1 && op.avgQuality === 80);
})();

// ---- flag gating (fundx.js) ---------------------------------------------
function loadFundx(flagVal) {
  const ls = fakeLocalStorage(); if (flagVal != null) ls.setItem("smd_fundx", flagVal);
  const win = { SMD_FUNDX_VISION: V, SMD_FUNDX_STORE: STORE };
  const loc = { search: "" };
  new Function("window", "localStorage", "location", src("fundx.js"))(win, ls, loc);
  return win.FUNDX;
}
ok("flag: default ON (private dev/testing; PUBLIC-RELEASE-GATE) → real module, enabled=true", loadFundx(null).enabled() === true);
ok("flag: '0' → stub, enabled=false", loadFundx("0").enabled() === false);
ok("flag: '1' → real module, enabled=true", loadFundx("1").enabled() === true);
// URL override on
function loadFundxUrl(searchStr) {
  const ls = fakeLocalStorage();
  const win = { SMD_FUNDX_VISION: V, SMD_FUNDX_STORE: STORE };
  new Function("window", "localStorage", "location", src("fundx.js"))(win, ls, { search: searchStr });
  return win.FUNDX;
}
ok("flag: ?fundx=1 forces on", loadFundxUrl("?fundx=1").enabled() === true);
ok("flag: ?fundx=0 forces off", loadFundxUrl("?fundx=0").enabled() === false);

// ---- M3 capture processing (pure helpers on window.FUNDX) ---------------
const FX = loadFundx("1");
const stats = { startTs: 0, attempts: 1, captures: 1, retries: 0, burstCount: 2, readinessTrace: [10, 50, 90] };
const burst = [
  { dataUrl: "data:image/jpeg;base64,AAAA", metrics: { focus: 0.9, exposure: 0.85, brightness: 0.5, contrast: 0.6, noise: 0.1, reflection: 0.1, redReflex: 0.75, fundusVisible: true, fundusConf: 0.85, fundusCircularity: 0.7, retinaConf: 0.9, discConf: 0.9, maculaConf: 0.9, vesselVisibility: 0.7, fieldOfView: 0.9 } },
  { dataUrl: "data:image/jpeg;base64,BBBB", metrics: { focus: 0.2, exposure: 0.3, reflection: 0.6, retinaConf: 0.1 } }
];
const res = FX._buildResult(burst, { ref: "MRN1", name: "Test" }, "right", stats);
ok("capture: buildResult picks the best (sharp) frame", res && res.best === 0);
ok("capture: buildResult quality accepted for good frame", res.quality.accepted === true);
ok("capture: buildResult findings versioned + engine=vision", res.findings.engine === "vision" && res.findings.schemaVersion === 1);
ok("capture: buildResult images set (orig+proc)", res.images.original === "data:image/jpeg;base64,AAAA" && !!res.images.processed);
ok("capture: buildResult null on empty burst", FX._buildResult([], {}, "right", {}) === null);

const rec = FX._buildScanRecord(res, { ref: "MRN1", name: "Test" }, "right", stats, { id: "fx_test", now: 1000 });
ok("record: passes 9-field validation", V.validate.scanRecord(rec).ok === true);
ok("record: all nine categories present", !!(rec.originalImage && rec.processedImage && rec.quality && rec.acquisition && rec.vision && rec.patientContext && rec.timestamp && rec.device && rec.provider && rec.audit));
ok("record: provider carried from findings", rec.provider.provider === "mock");
ok("record: acquisition captures eye + readiness trace", rec.acquisition.eye === "right" && rec.acquisition.readinessTrace.length === 3);
ok("record: device app version + audit action present", !!rec.device.appVersion && rec.audit.actions[0].type === "created");

// ---- M4 integration regression guards (source presence) -----------------
const icu = src("icu.js");
ok("icu: MEMBER.fundx defined", /MEMBER\.fundx\s*=/.test(icu));
ok("icu: Records workspace includes fundx member", /members:\s*\["documents",\s*"fundx"/.test(icu));
ok("icu: RENDER.fundx sub-tab present", /fundx:\s*function\s*\(\)/.test(icu) && /FundX AI · Retinal imaging/.test(icu));
ok("icu: launch:fundx opens FUNDX with patient context", /arg === "fundx"/.test(icu) && /FUNDX\.open\(\{\s*ref:/.test(icu));

const fj = src("fundx.js");
ok("fundx: scan detail viewer present", /function openDetail\(/.test(fj) && /screen === "detail"/.test(fj));
ok("fundx: delete-scan wired", /function deleteScan\(/.test(fj) && /data-fx="deletescan"/.test(fj));

// ---- M5 Guided Training Mode --------------------------------------------
const FXt = loadFundx("1");
ok("training: seven levels defined", FXt._levels().length === 7);
ok("training: level names in order", FXt._levels()[0].key === "find_eye" && FXt._levels()[6].key === "diagnostic_capture");
ok("training: L1 needs eye", FXt._levelAchieved(1, { eye: true }, {}) === true && FXt._levelAchieved(1, { eye: false }, {}) === false);
ok("training: L2 needs pupil", FXt._levelAchieved(2, { pupil: true }, {}) === true);
ok("training: L3 needs working distance (not lens)", FXt._levelAchieved(3, { distance: true }, {}) === true && FXt._levelAchieved(3, {}, {}) === false);
ok("training: L4 needs red reflex", FXt._levelAchieved(4, { redReflex: true }, {}) === true && FXt._levelAchieved(4, {}, {}) === false);
ok("training: L5 needs the fundus view (not a lens)", FXt._levelAchieved(5, { fundus: true }, {}) === true && FXt._levelAchieved(5, {}, {}) === false);
ok("training: L7 needs readiness.ready", FXt._levelAchieved(7, {}, { ready: true }) === true && FXt._levelAchieved(7, {}, { ready: false }) === false);
ok("fundx: training screen wired", /function screenTraining\(/.test(fj) && /screen === "training"/.test(fj) && /data-fx="level"/.test(fj));

// ---- M9 Timeline + Compare (pure helpers) -------------------------------
const FXtl = loadFundx("1");
function scan(id, ts, q, cdr) { return { id: id, timestamp: ts, quality: { overall: q }, vision: { findings: { optic_disc: { cup_disc_ratio: cdr } } } }; }
const scans = [scan("a", 300, 90, 0.5), scan("b", 100, 70, 0.4), scan("c", 200, 80, 0.45)];
const qt = FXtl._trend(scans, "quality");
ok("timeline: trend sorted ascending by time", qt.length === 3 && qt[0].t === 100 && qt[2].t === 300);
ok("timeline: quality trend values", qt[0].v === 70 && qt[2].v === 90);
const ct = FXtl._trend(scans, "cdr");
ok("timeline: cdr trend reads optic_disc.cup_disc_ratio", ct[2].v === 0.5);
ok("timeline: trend drops null metrics", FXtl._trend([{ timestamp: 1, quality: {} }], "quality").length === 0);
const d = FXtl._compareDelta(scan("b", 100, 70, 0.4), scan("a", 300, 90, 0.5));
ok("compare: quality delta", d.qualityDelta === 20);
ok("compare: cdr delta rounded", d.cdrDelta === 0.1);
ok("compare: days apart (200ms → 0 days)", d.days === 0);
const dDays = FXtl._compareDelta(scan("x", 0, 70, 0.4), scan("y", 3 * 86400000, 90, 0.5));
ok("compare: days apart (3 days)", dDays.days === 3);
ok("compare: null-safe when metric missing", FXtl._compareDelta({ timestamp: 1 }, { timestamp: 2 }).qualityDelta === null);
ok("fundx: timeline + compare screens wired", /function screenTimeline\(/.test(fj) && /function screenCompare\(/.test(fj) && /screen === "timeline"/.test(fj) && /screen === "compare"/.test(fj));

// ---- M10 Settings + Export ----------------------------------------------
const FXset = loadFundx("1");
const recX = FXset._buildScanRecord(
  FXset._buildResult([{ dataUrl: "data:,x", metrics: { focus: 0.9, exposure: 0.85, reflection: 0.1, retinaConf: 0.9, discConf: 0.9, maculaConf: 0.9, contrast: 0.6, fieldOfView: 0.9 } }], { ref: "MRN1" }, "right", { startTs: 0 }),
  { ref: "MRN1", name: "Test" }, "right", { startTs: 0 }, { id: "fx_x", now: 1000 });
const payload = FXset._exportPayload(recX);
ok("export: payload schema + timestamp", payload.schema === "fundx.scan.export/1" && payload.exportedAt != null);
ok("export: carries findings + metadata, NO image bytes", !!(payload.scan.vision && payload.scan.quality && payload.scan.device && payload.scan.audit) && payload.scan.originalImage === undefined);
ok("export: provider/model version included", !!payload.scan.provider && payload.scan.provider.provider === "mock");
ok("fundx: settings screen + provider/sensitivity/export wired", /function screenSettings\(/.test(fj) && /data-fx="setprovider"/.test(fj) && /data-fx="setsens"/.test(fj) && /function exportScan\(/.test(fj) && /screen === "settings"/.test(fj));

// ---- M11 Clinical Engine integration (nested flag, advisory) ------------
ok("fundx: clinical card wired behind smd_fundx_clinical", /function clinicalOn\(/.test(fj) && /function clinicalCard\(/.test(fj) && /data-fx="setclinical"/.test(fj) && /SMD_FUNDX_CLINICAL/.test(fj));

// ---- cloud auto-activation (health-gated) -------------------------------
const FXc = loadFundx("1");
ok("cloud: parseHealth detects available vertex", FXc._parseHealth({ providers: [{ name: "vertex", available: true }, { name: "cerebras", available: false }] }).vision === true);
ok("cloud: parseHealth detects developer as vision-capable", FXc._parseHealth({ providers: [{ name: "developer", available: true }] }).vision === true);
ok("cloud: parseHealth none available → no vision", FXc._parseHealth({ providers: [{ name: "vertex", available: false }] }).vision === false);
ok("cloud: parseHealth cerebras-only → clinical yes, vision no", (function () { const h = FXc._parseHealth({ providers: [{ name: "cerebras", available: true }] }); return h.vision === false && h.clinical === true; })());
ok("cloud: providerTarget picks vertex-gemini when enabled + backend vision", FXc._providerTarget(true, { vision: true }) === "vertex-gemini");
ok("cloud: providerTarget stays mock when disabled", FXc._providerTarget(false, { vision: true }) === "mock");
ok("cloud: providerTarget stays mock when backend has no vision", FXc._providerTarget(true, { vision: false }) === "mock");
ok("fundx: cloud consent + auto-activation wired", /function applyProviderSelection\(/.test(fj) && /\/api\/fundx\/health/.test(fj) && /data-fx="cloudyes"/.test(fj) && /data-fx="setcloud"/.test(fj));

// ---- guidance is SIGNAL-DRIVEN (not timers / hard-coded sequences) -------
// (a) the decision depends only on frame signals, never wall-clock: identical frames
//     produce identical states/decisions even with wildly different timestamps.
const smA = V.createStateMachine(), smB = V.createStateMachine();
let ra, rb; for (let i = 0; i < 8; i++) { ra = smA.step(good, i * 1e7); rb = smB.step(good, i); }
ok("signal-driven: decision independent of timestamp/wall-clock", ra.state === rb.state && ra.shouldCapture === rb.shouldCapture && ra.state === V.STATE.READY);
// (b) changing ONE measured signal flips its gate + regresses state (no fixed sequence)
const smC = V.createStateMachine(); for (let i = 0; i < 8; i++) smC.step(good, i);
const dStep = smC.step(Object.assign({}, good, { focus: 0.2 }), 99);
ok("signal-driven: degrading focus alone leaves READY", dStep.gates.focus === false && dStep.state !== V.STATE.READY);
ok("signal-driven: restoring the signal re-advances", smC.step(good, 100).readiness.ready === true);
// (c) coaching direction is a pure function of the measured offset
ok("signal-driven: coach follows the measured offset", V.Coach.cueFor(V.STATE.CENTERING_PUPIL, { pupilDir: { x: -0.8 } }).arrow === "left" && V.Coach.cueFor(V.STATE.CENTERING_PUPIL, { pupilDir: { x: 0.8 } }).arrow === "right");

// ---- developer mode: live overlay metrics + frame-by-frame recorder ------
const FXd = loadFundx("1");
// stepGood mirrors the Decision Engine's observe() output (a superset of sm.step) — what
// onFrame now feeds the dev overlay: adds capture{decision}, confidence{level}, failure, stability.
const stepGood = { state: V.STATE.READY, shouldCapture: true, diagnostic: 0.83, gates: { focus: true, quality: true, reflection: true, motion: true, distance: true, redReflex: true, vessels: true, fundus: true, level: true }, readiness: { overall: 1, ready: true }, capture: { decision: "capture", reason: "ok", canManual: true, ready: true, sustained: true }, confidence: { overall: 0.95, level: "high", subsystems: {} }, failure: null, stability: { smoothedReadiness: 0.95, stable: true, trend: "steady" } };
const dm = FXd._devMetrics(stepGood, V.makeFrameAnalysis(good));
const labels = dm.map((m) => m[0]);
ok("devmode: overlay lists all live metrics + decision + perf", dm.length === 16 && ["focus", "glare (refl)", "motion", "distance", "roll", "red reflex", "vessel", "fundus", "DIAGNOSTIC", "confidence", "blocker", "decision", "pipeline", "fps · latency", "stages a·d·r ms"].every((l) => labels.indexOf(l) >= 0));
FXd._recordDevFrame(stepGood, V.makeFrameAnalysis(good));
const csv = FXd._devCsv();
ok("devmode: CSV has every metric column", /(^|,)focus,glare,motion,distance,roll/.test(csv) && /diagnostic,readiness/.test(csv) && /,capture,decision,confidence,confLevel,blocker,smoothed(\n|$)/.test(csv.split("\n")[0] + "\n"));
ok("devmode: frame recorded", FXd._devBuffer().length === 1);

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
