/* test/fundx-detect.test.mjs — FundX perception layer (heuristics, fundus/vessel/pose, hub).
 * Pure pixel math + merge logic; the camera + MediaPipe paths are browser-only and verified
 * on-device. Runs under `npm test`. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ FAIL:", name); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const win = {};
new Function("window", src("fundx-vision.js"))(win);
new Function("window", src("fundx-detect.js"))(win);
const V = win.SMD_FUNDX_VISION, D = win.SMD_FUNDX_DETECT;
ok("detect: exposed", !!D && !!D.Heuristic && !!D.makeHub && !!D.makePose);
ok("detect: simulated retina provider removed", D.makeSimRetina === undefined);
// auto-flash (torch) guards: safe no-op before a camera stream exists (never throws)
{
  const camt = D.makeCamera();
  ok("cam: torch API present", typeof camt.setTorch === "function" && typeof camt.torchSupported === "function");
  ok("cam: torchSupported false without stream", camt.torchSupported() === false);
  ok("cam: setTorch no-op without stream", camt.setTorch(true) === false && camt.torchOn() === false);
}

// ---- synthetic image builders ------------------------------------------
function fill(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const [r, g, b] = fn(x, y); data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return { data, width: w, height: h };
}
const gray = fill(40, 40, () => [128, 128, 128]);
function warmCircle(w, h, cx, cy, rad) { return fill(w, h, (x, y) => (Math.hypot(x - cx, y - cy) <= rad ? [210, 90, 60] : [10, 8, 8])); }
const fundusImg = warmCircle(40, 40, 20, 20, 13);
const fundusOff = warmCircle(40, 40, 30, 20, 9);

// ---- Heuristic basics (unchanged) --------------------------------------
ok("heuristic: gray → no reflection, mid brightness", D.Heuristic.analyze(gray).reflection < 0.1 && Math.abs(D.Heuristic.analyze(gray).brightness - 0.5) < 0.05);

// ---- fundus (circular illuminated field) — REAL ------------------------
ok("fundus: flat gray → not a fundus", D.Heuristic.fundus(gray).fundusVisible === false);
const ff = D.Heuristic.fundus(fundusImg);
ok("fundus: warm circle → visible, circular, centred", ff.fundusVisible === true && ff.fundusCircularity > 0.5 && Math.abs(ff.fundusCenter.x) < 0.15 && ff.fundusSize > 0.2);
const fo = D.Heuristic.fundus(fundusOff);
ok("fundus: offset circle → centre offset to the right", fo.fundusVisible === true && fo.fundusCenter.x > 0.15);

// ---- vessels (curvilinear structure) — REAL ----------------------------
const flatGreen = fill(40, 40, () => [60, 120, 60]);
const vesselsImg = fill(40, 40, (x) => (x % 4 === 0 ? [20, 30, 20] : [60, 120, 60]));
ok("vessels: structured field scores higher than flat", D.Heuristic.vessels(vesselsImg) > D.Heuristic.vessels(flatGreen));
ok("vessels: flat field ~ 0", D.Heuristic.vessels(flatGreen) < 0.15);

// ---- phone pose (roll) — real; no sensor in Node → unknown, non-blocking
const pose = D.makePose();
ok("pose: no sensor → unknown (never blocks the level gate)", pose.read().rollState === "unknown" && pose.read().roll === null);

// ---- Hub merge → FrameAnalysis from observable signals -----------------
const hub = D.makeHub();
const fa = hub.build({ imageData: fundusImg, mpPartial: { eyePresent: true, eyeConf: 0.9, pupilCentered: true, pupilOffset: 0.05, distanceState: "ok", motion: 0.05 }, posePartial: { roll: 4, rollState: "level" }, ts: 5 });
ok("hub: merges fundus + vessels + MP geometry + roll", fa.schemaVersion === V.SCHEMA_VERSION && fa.fundusVisible === true && fa.eyePresent === true && fa.rollState === "level" && fa.vesselScore >= 0);
ok("hub: derives retinaVisible from the REAL fundus (not simulated)", fa.retinaVisible === fa.fundusVisible);
ok("hub: no lens field is ever set true", fa.lensPresent === false);

// optional findings-level provider (disc/macula enrichment; NOT a capture gate)
hub.setRetinaSignalProvider(() => ({ discVisible: true, discConf: 1, maculaVisible: true, maculaConf: 1 }));
const fa2 = hub.build({ imageData: fundusImg, mpPartial: { eyePresent: true } });
ok("hub: retina-signal provider enriches disc/macula", fa2.discVisible === true && fa2.maculaVisible === true);

// ---- full guided run reaches READY via IMAGE QUALITY, never a lens gate -
const hub2 = D.makeHub(); hub2.resetSession();
const sm = V.createStateMachine();
let st;
for (let i = 0; i < 12; i++) {
  const f = hub2.build({ imageData: fundusImg, mpPartial: { eyePresent: true, eyeConf: 0.95, pupilCentered: true, pupilOffset: 0.05, distanceState: "ok", motion: 0.05 }, posePartial: { roll: 3, rollState: "level" }, ts: i });
  // a real in-focus frame has focus/vessels the flat-colour synthetic can't encode:
  f.focus = 0.9; f.exposure = 0.85; f.reflection = 0.1; f.contrast = 0.7; f.vesselScore = 0.7; f.redReflex = 0.8;
  st = sm.step(f, i);
}
ok("hub+engine: image-quality-driven run reaches READY (no lens gate anywhere)", st.state === V.STATE.READY);

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
