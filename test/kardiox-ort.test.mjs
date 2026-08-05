/* test/kardiox-ort.test.mjs — REAL on-device provider (kardiox-ort.js) end-to-end with a fake ONNX
 * runtime: proves the full signal → heads → fusion → rules → ECGAnalysis path, honest no-signal error.
 * (Real pretrained-weight verification lives in the Node harness on real PTB-XL; this locks the wiring.) */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

globalThis.window = globalThis;
const loadInto = (f) => new Function(read(f))();
["kardiox-models.js", "kardiox-signal.js", "kardiox-rules.js", "kardiox-fusion.js", "kardiox-ort.js"].forEach(loadInto);
const ORT = globalThis.SMD_KARDIOX_ORT;
ok("ort provider exposed", !!ORT && typeof ORT.makeOrtAnalyzer === "function");

// Fake ONNX runtime: the AFIB head fires strongly; STACH/PVC don't.
const fakeOrt = {
  Tensor: function (type, data, dims) { this.type = type; this.data = data; this.dims = dims; },
  InferenceSession: { create: async (p) => { const s = String(p); const logit = /AFIB/.test(s) ? 4.0 : /STACH/.test(s) ? -3.0 : -4.0;
    return { run: async () => ({ logit: { data: Float32Array.from([logit]) } }) }; } }
};
const manifest = { input: { leads: 12, samples: 5000, fs_hz: 500 }, source_weight: 0.6, heads: [
  { pathology: "AFIB", label: "Atrial fibrillation", severity: "urgent", file: "models/ecglib_AFIB.onnx", threshold: 0.5 },
  { pathology: "STACH", label: "Sinus tachycardia", severity: "warn", file: "models/ecglib_STACH.onnx", threshold: 0.5 },
  { pathology: "PVC", label: "Premature ventricular complex", severity: "warn", file: "models/ecglib_PVC.onnx", threshold: 0.5 }
] };
// Synthetic 12-lead signal; lead II = R-peak spike train (~60 bpm @ 500 Hz).
const N = 5000, leads = [];
for (let c = 0; c < 12; c++) { const L = new Array(N); for (let i = 0; i < N; i++) L[i] = (c === 1 && i % 500 < 3) ? 2.0 : 0.04 * Math.sin(i / 22); leads.push(L); }

const a = await ORT.makeOrtAnalyzer({ ort: fakeOrt, manifest, baseUrl: "x" }).analyze({ id: "t1", signal: leads }, () => {});
ok("verdict = Atrial fibrillation (urgent head fires, headlines over rivals)", a.verdict === "Atrial fibrillation");
ok("confidence high (>0.6)", a.confidence > 0.6);
ok("NOT a demo/mock — real engine tag", a.demo !== true && a.engine === "ecglib-ensemble-1.1.0");
ok("differentials = all heads, AFIB ranked #1", a.differentials.length === 3 && a.differentials[0].label === "Atrial fibrillation");
ok("real heart rate measured by DSP (~60 bpm)", a.measurements.ventRateBpm >= 50 && a.measurements.ventRateBpm <= 70);
ok("Evidence Fusion attached (log-odds consensus)", a.fusion && a.fusion.method === "logodds-consensus");

const stages = [];
await ORT.makeOrtAnalyzer({ ort: fakeOrt, manifest, baseUrl: "x" }).analyze({ id: "t2", signal: leads }, (s) => stages.push(s));
ok("pipeline streams real stages (rhythm→report)", stages.includes("rhythm") && stages.includes("report"));

let threw = null;
try { await ORT.makeOrtAnalyzer({ ort: fakeOrt, manifest, baseUrl: "x" }).analyze({ id: "t3" }, () => {}); } catch (e) { threw = e; }
ok("no signal + no digitiser → typed needs_signal error (never fabricates)", threw && threw.code === "needs_signal");

// CR4: ensemble heads load SEQUENTIALLY (peak footprint = one model at a time), not all at once via
// Promise.all (which briefly holds every model's decode buffer → the memory spike that risked OOM).
let live = 0, maxLive = 0;
const seqOrt = {
  Tensor: function (t, d, dm) { this.type = t; this.data = d; this.dims = dm; },
  InferenceSession: { create: async (p) => { live++; if (live > maxLive) maxLive = live; await Promise.resolve(); await Promise.resolve(); live--; const logit = /AFIB/.test(String(p)) ? 4.0 : -4.0; return { run: async () => ({ logit: { data: Float32Array.from([logit]) } }) }; } }
};
await ORT.makeOrtAnalyzer({ ort: seqOrt, manifest, baseUrl: "x" }).analyze({ id: "seq", signal: leads }, () => {});
ok("ensemble heads load sequentially — peak 1 concurrent session, not the full ensemble at once (CR4)", maxLive === 1);

// R6 #2: a head-load failure must NOT poison the cached analyzer (leave a truthy partial _sessions that
// silently runs a smaller ensemble forever). All-or-nothing: it surfaces an error, and the SAME analyzer
// retries + fully loads on the next analysis.
const flakyOrt = {
  Tensor: fakeOrt.Tensor, _recovered: false,
  InferenceSession: { create: async (p) => {
    const s = String(p);
    if (/STACH/.test(s) && !flakyOrt._recovered) { flakyOrt._recovered = true; throw new Error("simulated decode OOM"); }
    return { run: async () => ({ logit: { data: Float32Array.from([/AFIB/.test(s) ? 4.0 : -4.0]) } }) };
  } }
};
const flaky = ORT.makeOrtAnalyzer({ ort: flakyOrt, manifest, baseUrl: "x" });
let ferr = null;
try { await flaky.analyze({ id: "f1", signal: leads }, () => {}); } catch (e) { ferr = e; }
ok("a head-load failure surfaces an error, not a silent partial ensemble (R6 #2)", !!ferr);
const recovered = await flaky.analyze({ id: "f2", signal: leads }, () => {});
ok("the SAME cached analyzer retries + fully loads next analysis (ensure not poisoned)", recovered && recovered.verdict === "Atrial fibrillation");

// R6 #4: dispose() releases every cached ONNX session (frees the ensemble) so the provider cache can evict.
let released = 0;
const relOrt = { Tensor: fakeOrt.Tensor, InferenceSession: { create: async (p) => ({ run: async () => ({ logit: { data: Float32Array.from([/AFIB/.test(String(p)) ? 4.0 : -4.0]) } }), release: () => { released++; } }) } };
const disp = ORT.makeOrtAnalyzer({ ort: relOrt, manifest, baseUrl: "x" });
await disp.analyze({ id: "d1", signal: leads }, () => {});
disp.dispose();
ok("dispose() releases every cached session (frees the ~157 MB ensemble)", typeof disp.dispose === "function" && released === manifest.heads.length);

console.log(`\nkardiox-ort: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
