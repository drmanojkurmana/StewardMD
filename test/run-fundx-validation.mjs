/* run-fundx-validation.mjs — FundX acquisition ENGINE validation harness (computational).
 *
 * Drives the REAL state machine (fundx-vision.js) over many simulated acquisition sessions
 * per scenario to measure, against a clinical-adequacy ground truth:
 *   - capture success rate + median time-to-capture (adequate scenarios → should capture)
 *   - false-capture rate (inadequate scenarios → must NOT capture)
 *   - missed-capture rate + median guidance corrections
 * This validates the auto-capture gate + informs CFG threshold calibration. It does NOT
 * replace real-world / clinical / device / lens validation (see docs/fundx/VALIDATION.md).
 *
 * USAGE: node test/run-fundx-validation.mjs        (deterministic; seeded)
 */
import { readFileSync } from "node:fs";
const win = {};
new Function("window", readFileSync(new URL("../fundx-vision.js", import.meta.url), "utf8"))(win);
const V = win.SMD_FUNDX_VISION;

const ANALYZE_MS = 110;                 // engine analyze cadence → frames-to-seconds
const BUDGET = 180;                     // ~20 s acquisition budget (frames)
const SESSIONS = 400;                   // sessions per scenario
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// Peak signal profiles per scenario (what the BEST sustained frame looks like) + dynamics.
// adequate = a clinically usable image is genuinely reachable (independent of the engine).
const P = (o) => Object.assign({ eyeConf: 0.95, pupilOffset: 0.05, distanceOk: 0.9, redReflex: 0.8, fundusConf: 0.85, fundusCirc: 0.8, focus: 0.85, exposure: 0.85, reflection: 0.1, motion: 0.05, vessel: 0.7, ramp: 30, noise: 0.05, roll: 4 }, o);
const SCENARIOS = [
  { key: "skilled_normal", label: "Skilled operator, normal eye", peak: P({}) },
  { key: "junior_doctor", label: "Junior doctor", peak: P({ ramp: 45, noise: 0.08 }) },
  { key: "nurse", label: "Nurse", peak: P({ ramp: 60, noise: 0.10, pupilOffset: 0.08 }) },
  { key: "beginner", label: "First-time beginner (post-instruction)", peak: P({ ramp: 85, noise: 0.14, pupilOffset: 0.10, motion: 0.12 }) },
  { key: "dark_iris", label: "Dark iris (marginal red reflex)", peak: P({ redReflex: 0.52, fundusConf: 0.62, focus: 0.72, ramp: 70, noise: 0.12 }) },
  { key: "hand_shake", label: "Operator hand shake", peak: P({ motion: 0.30, focus: 0.70, ramp: 60, noise: 0.16 }) },
  // ---- genuinely INADEQUATE: engine must refuse (false-capture must be ~0) ----
  { key: "small_pupil", label: "Small pupil", peak: P({ redReflex: 0.34, fundusConf: 0.40, fundusCirc: 0.55, vessel: 0.30, ramp: 70, noise: 0.10 }), adequate: false },
  { key: "media_opacity", label: "Media opacity / mild cataract", peak: P({ fundusConf: 0.50, vessel: 0.22, focus: 0.44, contrastLow: true, ramp: 70, noise: 0.10 }), adequate: false },
  { key: "poor_lighting", label: "Bright room / glare", peak: P({ exposure: 0.42, reflection: 0.55, redReflex: 0.5, ramp: 60, noise: 0.12 }), adequate: false },
  { key: "decoy_no_fundus", label: "Not on the eye (skin/room)", peak: P({ eyeConf: 0.2, redReflex: 0.15, fundusConf: 0.10, fundusCirc: 0.2, vessel: 0.10, ramp: 40, noise: 0.08 }), adequate: false }
];
function isAdequate(pk) { return pk.focus >= 0.6 && pk.vessel >= 0.45 && pk.fundusConf >= 0.55 && pk.reflection <= 0.35 && pk.redReflex >= 0.45; }

function runSession(peak, rnd) {
  const sm = V.createStateMachine();
  const g = (v, t, n) => clamp01(v * smooth(t) + (rnd() - 0.5) * 2 * n);
  let captureFrame = -1, corrections = 0, lastArrow = null;
  for (let f = 0; f < BUDGET; f++) {
    const t = peak.ramp ? f / peak.ramp : 1;
    const fa = {
      eyePresent: true, eyeConf: g(peak.eyeConf, t, peak.noise),
      pupilOffset: clamp01(peak.pupilOffset + (1 - smooth(t)) * 0.4 + (rnd() - 0.5) * peak.noise), pupilCentered: undefined,
      distanceState: (g(peak.distanceOk, t, peak.noise) > 0.6 ? "ok" : (rnd() < 0.5 ? "far" : "near")),
      redReflex: g(peak.redReflex, t, peak.noise), fundusVisible: undefined,
      fundusConf: g(peak.fundusConf, t, peak.noise), fundusCircularity: g(peak.fundusCirc, t, peak.noise),
      fundusCenter: { x: (rnd() - 0.5) * 0.2, y: (rnd() - 0.5) * 0.2 }, fundusSize: 0.55,
      focus: g(peak.focus, t, peak.noise), exposure: g(peak.exposure, t, peak.noise),
      contrast: peak.contrastLow ? g(0.25, t, peak.noise) : g(0.7, t, peak.noise),
      reflection: clamp01(peak.reflection + (rnd() - 0.5) * peak.noise), motion: clamp01(peak.motion + (rnd() - 0.5) * peak.noise),
      vesselScore: g(peak.vessel, t, peak.noise), roll: peak.roll + (rnd() - 0.5) * 6, rollState: "level"
    };
    fa.fundusVisible = fa.fundusConf >= 0.5 && fa.fundusCircularity >= 0.45;
    fa.pupilCentered = fa.pupilOffset <= 0.22;
    const step = sm.step(fa, f);
    const cue = V.Coach.cueFor(step.state, fa, step.readiness);
    if (cue.arrow && cue.arrow !== lastArrow) { corrections++; lastArrow = cue.arrow; }
    if (step.shouldCapture) { captureFrame = f; break; }
  }
  return { captured: captureFrame >= 0, captureFrame, corrections };
}

console.log("FundX acquisition ENGINE validation — " + SESSIONS + " sessions/scenario, " + BUDGET + "-frame (~" + Math.round(BUDGET * ANALYZE_MS / 1000) + "s) budget\n");
console.log("scenario                         adeq  cap%   miss%  false%  medTime  medCorr");
console.log("-------------------------------------------------------------------------------");
const rows = [];
for (const sc of SCENARIOS) {
  const adequate = sc.adequate !== undefined ? sc.adequate : isAdequate(sc.peak);
  let cap = 0; const times = [], corrs = [];
  for (let i = 0; i < SESSIONS; i++) {
    const rnd = mulberry32(0xF00D + i * 7 + sc.key.length * 131);
    const res = runSession(sc.peak, rnd);
    corrs.push(res.corrections);
    if (res.captured) { cap++; times.push(res.captureFrame); }
  }
  const capRate = cap / SESSIONS;
  const medT = times.length ? (median(times) * ANALYZE_MS / 1000).toFixed(1) + "s" : "—";
  const row = { key: sc.key, label: sc.label, adequate, capRate, miss: adequate ? 1 - capRate : null, falseCap: adequate ? null : capRate, medT, medCorr: median(corrs) };
  rows.push(row);
  console.log(
    sc.key.padEnd(32) +
    (adequate ? "yes " : "NO  ").padEnd(6) +
    (capRate * 100).toFixed(0).padStart(4) + "  " +
    (adequate ? ((1 - capRate) * 100).toFixed(0).padStart(5) : "  —").padEnd(6) + " " +
    (adequate ? "  —" : (capRate * 100).toFixed(1).padStart(5)).padEnd(7) + " " +
    medT.padStart(7) + "  " + String(median(corrs)).padStart(6)
  );
}
// aggregate acceptance checks
const trained = rows.filter(r => ["skilled_normal", "junior_doctor", "nurse"].indexOf(r.key) >= 0);
const firstTime = rows.filter(r => r.key === "beginner")[0];
const inadequate = rows.filter(r => r.adequate === false);
const trainedCap = trained.reduce((a, r) => a + r.capRate, 0) / trained.length;
const worstFalse = Math.max.apply(null, inadequate.map(r => r.falseCap));
console.log("\nAcceptance snapshot (engine-level, simulated):");
console.log("  trained-user capture rate:        " + (trainedCap * 100).toFixed(1) + "%   (target >90%)");
console.log("  first-time (beginner) capture:    " + (firstTime.capRate * 100).toFixed(1) + "%   (target >80%)");
console.log("  worst false-capture (inadequate): " + (worstFalse * 100).toFixed(1) + "%   (target <5%, ~0 for decoy)");
console.log("  decoy (not-on-eye) false-capture: " + ((rows.filter(r => r.key === "decoy_no_fundus")[0].falseCap) * 100).toFixed(1) + "%   (target ~0%)");
