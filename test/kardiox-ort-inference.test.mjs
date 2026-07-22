/* test/kardiox-ort-inference.test.mjs — REAL on-device analyzer inference (SMD_KARDIOX_ORT).
 *
 * Loads the 7 EcgLib ONNX heads through onnxruntime-node (same InferenceSession API as onnxruntime-web
 * in the WebView) via a fake model-manager that returns the cached bytes, then runs makeOrtAnalyzer over
 * the labelled CPSC records. This proves the on-device wiring (source→session→preprocess→run→fusion→
 * verdict) produces CORRECT diagnoses on real weights — everything except the WKWebView runtime itself.
 *
 * Skips (prints SKIP, exit 0) if the model files or fixtures are not present in this environment. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const JOB = process.env.CLAUDE_JOB_DIR || "";
const MODELS = join(JOB, "tmp/verify/models");
const FIX = join(JOB, "tmp/verify/cpsc_engine_signals.json");
if (!JOB || !existsSync(join(MODELS, "ecglib_AFIB.onnx")) || !existsSync(FIX)) {
  console.log("kardiox-ort-inference: SKIP (models/fixtures not in this environment)");
  process.exit(0);
}

const ort = (await import("onnxruntime-node")).default;

// load the buildless kardiox modules so window.SMD_KARDIOX_* resolve (dependency order)
globalThis.window = globalThis;
for (const m of ["kardiox-models", "kardiox-signal", "kardiox-fusion", "kardiox-rules", "kardiox-reconstruct", "kardiox-ort"]) {
  new Function(readFileSync(new URL(`../${m}.js`, import.meta.url), "utf8"))();
}
const ORT = globalThis.SMD_KARDIOX_ORT;

// fake model-manager: return each head's bytes straight from disk (what source() yields on-device)
const mgr = { source: (file) => Promise.resolve({ bytes: new Uint8Array(readFileSync(join(MODELS, file))) }) };
const analyzer = ORT.makeOrtAnalyzer({ ort, modelManager: mgr, manifest: ORT.DEFAULT_MANIFEST });

const records = JSON.parse(readFileSync(FIX, "utf8"));
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log("  x FAIL:", n)); };

const P = (a, code) => { const h = (a.headProbabilities || []).find((x) => x.pathology === code); return h ? h.prob : 0; };

for (const r of records) {
  const a = await analyzer.analyze({ id: r.record, signal: r.signal });
  const afib = P(a, "AFIB"), crbbb = P(a, "CRBBB"), pvc = P(a, "PVC");
  console.log(`${r.record} [${r.labels}] → "${a.verdict}" (${a.severity})  AFIB=${afib.toFixed(2)} CRBBB=${crbbb.toFixed(2)} PVC=${pvc.toFixed(2)}`);
  ok(`${r.record}: produced a verdict`, typeof a.verdict === "string" && a.verdict.length > 0);
  const lab = (r.labels || [])[0];
  if (lab === "AF") ok(`${r.record}: AFIB fires on AF`, afib >= 0.5);
  if (lab === "RBBB") ok(`${r.record}: CRBBB fires on RBBB`, crbbb >= 0.5);
  if (lab === "PVC") ok(`${r.record}: PVC fires on PVC`, pvc >= 0.5);
  if (lab === "SNR") ok(`${r.record}: no false AFib on normal`, afib < 0.5); // the earlier "AFib on everything" bug
}

console.log(`kardiox-ort-inference: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
