/* test/kardiox-reconstruct.test.mjs — paper-ECG reconstruction layer + analyzePaper wiring.
 * Verifies layout placement (t=c*D), no-fabrication (partial → no dense), confidence warn, and that
 * analyzePaper runs the ensemble ONLY on full-coverage layouts (12x1), else returns a safe warn. */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
globalThis.window = globalThis;
["kardiox-models.js", "kardiox-signal.js", "kardiox-rules.js", "kardiox-fusion.js", "kardiox-reconstruct.js", "kardiox-ort.js"].forEach(f => new Function(read(f))());
const RC = globalThis.SMD_KARDIOX_RECONSTRUCT, ORT = globalThis.SMD_KARDIOX_ORT;
ok("reconstruct layer exposed", !!RC && typeof RC.reconstruct === "function" && typeof RC.toDense === "function");

const N = 5000, full = [];
for (let li = 0; li < 12; li++) { const L = new Array(N); for (let i = 0; i < N; i++) L[i] = (li === 1 && i % 500 < 3) ? 2.0 : 0.04 * Math.sin(i / 22); full.push(L); }
const V1 = RC.STD12.indexOf("V1");

// 12x1 → full coverage → dense
const s12 = RC.simulateFromFull(full, 500, "12x1", "II");
const r12 = RC.reconstruct(s12, { fs: 500, seconds: 10 });
ok("12x1 full coverage", r12.full && r12.overallCoverage >= 0.999);
ok("12x1 toDense returns a dense signal", RC.toDense(r12).dense !== null);

// 3x4 → partial → placement math + NO dense + warn
const s34 = RC.simulateFromFull(full, 500, "3x4", "II");
const r34 = RC.reconstruct(s34, { fs: 500, seconds: 10 });
ok("3x4 V1(col2) sample 2500 placed at true t=c*D", Math.abs(r34.canvas[V1 * N + 2500] - full[6][2500]) < 1e-4 && r34.mask[V1 * N + 2500] === 1);
ok("3x4 V1 masked-absent before its window", r34.mask[V1 * N + 500] === 0 && Number.isNaN(r34.canvas[V1 * N + 500]));
ok("3x4 rhythm lead II full 10s coverage", r34.perLead["II"].coverage >= 0.999);
ok("3x4 partial → toDense null (never fabricates)", RC.toDense(r34).dense === null);
ok("3x4 low overall confidence + warnings", r34.confidence.overall < 0.5 && r34.warnings.length > 0);
ok("contemporaneity group col0 = I,II,III (frontal axis valid there)", JSON.stringify(r34.contemporaneityGroups[0].slice().sort()) === JSON.stringify(["I", "II", "III"]));

// analyzePaper wiring with a fake ONNX runtime (AFIB head fires)
const fakeOrt = { Tensor: function (t, d, s) { this.type = t; this.data = d; this.dims = s; },
  InferenceSession: { create: async (p) => ({ run: async () => ({ logit: { data: Float32Array.from([/AFIB/.test(String(p)) ? 4.0 : -4.0]) } }) }) } };
const manifest = { input: { leads: 12, samples: 5000, fs_hz: 500 }, source_weight: 0.6, heads: [
  { pathology: "AFIB", label: "Atrial fibrillation", severity: "urgent", file: "models/ecglib_AFIB.onnx", threshold: 0.5 },
  { pathology: "CRBBB", label: "Complete RBBB", severity: "warn", file: "models/ecglib_CRBBB.onnx", threshold: 0.5 } ] };
const prov = ORT.makeOrtAnalyzer({ ort: fakeOrt, manifest, baseUrl: "x" });

const a12 = await prov.analyzePaper(Object.assign({ id: "p12" }, s12), () => {});
ok("analyzePaper 12x1 runs the ensemble → AF verdict", a12.verdict === "Atrial fibrillation" && a12.reconstruction.layout === "12x1");
ok("analyzePaper 12x1: real (not demo) + full-coverage reconstruction attached", a12.demo !== true && a12.reconstruction.confidence.full === true);

const a34 = await prov.analyzePaper(Object.assign({ id: "p34" }, s34), () => {});
// 3x4 now gives a rhythm/axis read-out from the strip + limb leads, but the 12-lead ENSEMBLE must still
// NOT run on fabricated dense data, and NO ST/BBB/morphology may be fabricated from unreliable amplitudes.
ok("analyzePaper 3x4 → ensemble NOT run on fabricated data (no head probabilities, partial coverage)",
   a34.reconstruction.confidence.full === false && (!a34.headProbabilities || a34.headProbabilities.length === 0));
ok("analyzePaper 3x4 → no fabricated ST/STEMI/BBB morphology finding",
   !(a34.findings || []).some(f => /ST|STEMI|elevation|bundle|BBB|LVH/i.test(f.title)));
ok("analyzePaper 3x4 low confidence + reconstruction warnings surfaced", a34.confidence < 0.5 && a34.reconstruction.warnings.length > 0);

console.log(`\nkardiox-reconstruct: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
