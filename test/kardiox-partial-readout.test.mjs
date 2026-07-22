/* test/kardiox-partial-readout.test.mjs — on-device 3x4 partial analysis (kardiox-ort safePartial).
 * A 3x4 printout can't feed the 10s neural ensemble, but the lead-II strip gives RHYTHM (timing) and the
 * limb leads give a GAIN-INDEPENDENT axis. This verifies safePartial reports those (not a bare deferral)
 * and NEVER reports ST/BBB/morphology from the classical digitiser's unreliable amplitudes. No ONNX. */
import { readFileSync } from "node:fs";

globalThis.window = globalThis;
for (const m of ["kardiox-models", "kardiox-signal", "kardiox-fusion", "kardiox-rules", "kardiox-reconstruct", "kardiox-ort"])
  new Function(readFileSync(new URL("../" + m + ".js", import.meta.url), "utf8"))();
const ORT = globalThis.SMD_KARDIOX_ORT;
const FS = 500;
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log("  x FAIL:", n)); };

// synthetic ECG cell: flat baseline + QRS spikes; `rrs` (samples) lets us make irregular rhythm.
function cell(sec, amp, rrs) {
  const n = Math.round(sec * FS), mv = new Array(n).fill(0); let r = Math.round(0.2 * FS), i = 0;
  while (r < n) { for (let k = -6; k <= 6; k++) { const j = r + k; if (j >= 0 && j < n) mv[j] = amp * Math.max(0, 1 - Math.abs(k) / 6); } r += rrs[i % rrs.length]; i++; }
  return mv;
}
function build3x4(stripRrs, axisSign) {
  const leads = {};
  for (const L of ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"])
    leads[L] = { mv: cell(2.5, L === "aVR" ? -1.0 : (L === "aVF" ? axisSign : 0.8), [Math.round(60 / 75 * FS)]), fs: FS };
  leads["II"] = { mv: cell(10, 1.0, stripRrs), fs: FS };   // 10s rhythm strip
  return { id: "t", leads, rhythmLead: "II", layoutHint: "3x4", calibration: { pxPerMm: 8, mmPerMv: 10 } };
}
const analyzer = ORT.makeOrtAnalyzer({});
const reg = Math.round(60 / 75 * FS);

// 1) regular 3x4 → rhythm + axis, no ST/morphology
const a1 = await analyzer.analyzePaper(build3x4([reg], 0.8));
ok("regular 3x4 → rhythm verdict (not bare deferral)", /Regular rhythm/i.test(a1.verdict) && !/insufficient/i.test(a1.verdict));
ok("rate reported ~75", Math.abs(a1.measurements.ventRateBpm - 75) <= 6);
ok("normal axis reported", a1.measurements.axisDeg != null && a1.findings.some(f => /axis/i.test(f.title)));
ok("NO ST/STEMI/BBB finding (amplitude not trusted)", !a1.findings.some(f => /ST|STEMI|elevation|bundle|BBB/i.test(f.title)));
ok("interpretation states ST/morphology NOT computed", /NOT computed/i.test(a1.clinicalInterpretation));
ok("severity stays info for a normal regular rhythm", a1.severity === "info");

// 2) irregular strip → AF suspicion, warn
const irr = [Math.round(0.55 * FS), Math.round(0.95 * FS), Math.round(0.7 * FS), Math.round(1.1 * FS)];
const a2 = await analyzer.analyzePaper(build3x4(irr, 0.8));
ok("irregular 3x4 → considers atrial fibrillation", /atrial fibrillation|irregular/i.test(a2.verdict));
ok("irregular → severity warn", a2.severity === "warn");
ok("irregular still no fabricated ST finding", !a2.findings.some(f => /ST|elevation/i.test(f.title)));

console.log(`kardiox-partial-readout: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
