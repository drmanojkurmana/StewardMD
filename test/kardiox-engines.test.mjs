/* test/kardiox-engines.test.mjs — Multi-engine registry + Evidence Fusion v2 + routing + unified report.
 * Uses a fake ONNX runtime so it runs headless: EcgLib (AFIB+PVC fire), ECG-Diagnosis (AF agrees, STE
 * critical, PVC disagrees), NSTEMI Not-Ready (skipped). Verifies agreement/disagreement never hidden. */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
globalThis.window = globalThis;
["kardiox-fusion.js", "kardiox-engines.js"].forEach(f => new Function(read(f))());
const E = globalThis.SMD_KARDIOX_ENGINES;
ok("engines module exposed", !!E && typeof E.analyze === "function" && Array.isArray(E.ENGINES));

// fake ONNX: logits by file. EcgLib AFIB+PVC fire; ECG-Diagnosis AF(agree)+STE(critical) fire, PVC low(disagree).
function dataFor(file) {
  if (/ecglib_AFIB/.test(file)) return [4]; if (/ecglib_PVC/.test(file)) return [4];
  if (/ecglib_/.test(file)) return [-4];
  if (/ecg_diagnosis/.test(file)) return [-4, 4, -4, -4, -4, -4, -4, -4, 4]; // SNR,AF,IAVB,LBBB,RBBB,PAC,PVC,STD,STE
  if (/heartgpt/.test(file)) return [0.95]; // probOut engine → already a probability (AFIB)
  return [-4];
}
const fakeOrt = { Tensor: function (t, d, s) { this.type = t; this.data = d; this.dims = s; } };
const ctx = {
  ort: fakeOrt,
  ready: (file) => !/nstemi/.test(file),                 // NSTEMI Not-Ready → skipped
  load: (file) => ({ run: async () => ({ logit: { data: Float32Array.from(dataFor(file)) } }) }),
};
const leads = []; for (let c = 0; c < 12; c++) { const L = new Array(5000); for (let i = 0; i < 5000; i++) L[i] = Math.sin(i / 20); leads.push(L); }

const rep = await E.analyze(leads, ctx);
ok("ran EcgLib + ECG-Diagnosis + HeartGPT, skipped Not-Ready NSTEMI", rep.enginesRun.indexOf("ecglib") >= 0 && rep.enginesRun.indexOf("ecg-diagnosis") >= 0 && rep.enginesRun.indexOf("heartgpt") >= 0 && rep.enginesSkipped.indexOf("nstemi") >= 0);
ok("primary = ST elevation (critical outranks urgent AF)", /st elevation/i.test(rep.primaryDiagnosis));
ok("differentials include AF + STE + PVC", (() => { const d = rep.differentials.map(x => x.diagnosis.toLowerCase()).join("|"); return /atrial fibrillation/.test(d) && /st elevation/.test(d) && /premature ventricular/.test(d); })());
ok("AGREEMENT surfaced: AF corroborated by 2 engines", rep.agreement.some(a => /atrial fibrillation/i.test(a.diagnosis) && a.models.length >= 2));
ok("DISAGREEMENT surfaced (not hidden): PVC one-for one-against", rep.disagreement.some(d => /premature ventricular/i.test(d.diagnosis) && d.supporting.length && d.against.length));
ok("modelContributions per engine", rep.modelContributions.length === 3 && rep.modelContributions.every(m => Array.isArray(m.diagnoses)));
ok("emergencyFlags include STEMI + AF (critical/urgent)", rep.emergencyFlags.some(f => /st elevation/i.test(f)) && rep.emergencyFlags.some(f => /atrial fibrillation/i.test(f)));
ok("confidence present + recommendations urgent", rep.confidence > 0 && /urgent/i.test(rep.recommendations.join(" ")));
ok("unified report shape complete", "primaryDiagnosis" in rep && "differentials" in rep && "modelContributions" in rep && "explanation" in rep && "emergencyFlags" in rep);

console.log(`\nkardiox-engines: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
