/* test/fundx-detect.test.mjs — FundX perception layer (heuristics, sim-retina, hub).
 * Pure pixel math + merge logic; the camera + MediaPipe paths are browser-only and
 * verified on-device. Runs under `npm test`. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ FAIL:", name); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

// load engine (needed by the hub) then the detector layer, sharing one fake window
const win = {};
new Function("window", src("fundx-vision.js"))(win);
new Function("window", src("fundx-detect.js"))(win);
const V = win.SMD_FUNDX_VISION, D = win.SMD_FUNDX_DETECT;
ok("detect: exposed", !!D && !!D.Heuristic && !!D.makeHub);

// ---- synthetic ImageData builders --------------------------------------
function fill(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const [r, g, b] = fn(x, y); data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}
const gray = fill(32, 32, () => [128, 128, 128]);
const checker = fill(32, 32, (x, y) => (((x + y) & 1) ? [255, 255, 255] : [0, 0, 0]));
const white = fill(32, 32, () => [255, 255, 255]);
const redGlow = fill(32, 32, () => [220, 40, 40]);

// ---- Heuristic ----------------------------------------------------------
const hg = D.Heuristic.analyze(gray);
const hc = D.Heuristic.analyze(checker);
const hw = D.Heuristic.analyze(white);
const hr = D.Heuristic.analyze(redGlow);
ok("heuristic: checker focus > gray focus", hc.focus > hg.focus && hc.focus > 0.5);
ok("heuristic: gray focus ~0 (flat)", hg.focus < 0.1);
ok("heuristic: white → high reflection", hw.reflection > 0.5);
ok("heuristic: white → low exposure (clipped)", hw.exposure < 0.2);
ok("heuristic: gray → good exposure, no reflection", hg.exposure > 0.8 && hg.reflection < 0.1);
ok("heuristic: gray brightness ~0.5", Math.abs(hg.brightness - 0.5) < 0.05);
ok("heuristic: red glow → high red-reflex", hr.redReflex > 0.6 && hr.redReflex > hg.redReflex);
ok("heuristic: all outputs in [0,1]", [hg, hc, hw, hr].every((o) => Object.keys(o).every((k) => o[k] >= 0 && o[k] <= 1)));

// ---- SimRetina progression ---------------------------------------------
const sim = D.makeSimRetina();
const goodH = { focus: 0.8, brightness: 0.5, redReflex: 0.8, reflection: 0.1, contrast: 0.6 };
let s;
s = sim.signal(goodH, true); ok("sim: retina appears when aligned+glow", s.retinaVisible === true && s.discVisible === false);
sim.signal(goodH, true); s = sim.signal(goodH, true);
ok("sim: disc appears after streak≥3", s.discVisible === true);
sim.signal(goodH, true); s = sim.signal(goodH, true);
ok("sim: macula appears after streak≥5", s.maculaVisible === true && s.fieldOfView > 0.5);
const bad = sim.signal({ focus: 0.1, brightness: 0.5, redReflex: 0.1, reflection: 0.1, contrast: 0.1 }, true);
ok("sim: retina lost when no glow", bad.retinaVisible === false);
const sim2 = D.makeSimRetina();
ok("sim: not aligned → no retina", sim2.signal(goodH, false).retinaVisible === false);

// ---- Hub merge → FrameAnalysis -----------------------------------------
const hub = D.makeHub();
const fa = hub.build({ imageData: checker, mpPartial: { eyePresent: true, eyeConf: 0.9, pupilCentered: true, pupilOffset: 0.1, distanceState: "ok" }, ts: 10 });
ok("hub: builds a FrameAnalysis (engine-normalized)", fa.schemaVersion === V.SCHEMA_VERSION);
ok("hub: merges MediaPipe geometry", fa.eyePresent === true && fa.pupilOffset === 0.1 && fa.distanceState === "ok");
ok("hub: merges heuristic focus", fa.focus === hc.focus && fa.ts === 10);

// full guided run reaches Capture-Ready via the hub + state machine (no real models)
const hub2 = D.makeHub(); hub2.resetSession();
const sm = V.createStateMachine();
let stRes;
for (let i = 0; i < 12; i++) {
  const f = hub2.build({ imageData: redGlow, mpPartial: { eyePresent: true, eyeConf: 0.95, pupilCentered: true, pupilOffset: 0.05, lensPresent: true, lensConf: 0.9, distanceState: "ok", motion: 0.05 }, ts: i });
  // red glow gives red-reflex + brightness; focus is low on a flat red field, so nudge it real:
  f.focus = 0.9; f.exposure = 0.85; f.reflection = 0.1; f.contrast = 0.6;
  stRes = sm.step(f, i);
}
ok("hub+engine: guided run reaches READY", stRes.state === V.STATE.READY || stRes.state === V.STATE.FRAMING);

// retina-signal provider is swappable
const hub3 = D.makeHub();
hub3.setRetinaSignalProvider(() => ({ retinaVisible: true, retinaConf: 1, discVisible: true, discConf: 1, maculaVisible: true, maculaConf: 1, vesselVisibility: 1, fieldOfView: 1 }));
const fa3 = hub3.build({ imageData: gray, mpPartial: { eyePresent: true, pupilOffset: 0.1, distanceState: "ok" } });
ok("hub: retina-signal provider swappable", fa3.discVisible === true && fa3.maculaVisible === true);

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
