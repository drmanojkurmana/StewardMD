/* Stages 4-9 of the KardioX end-to-end pipeline, on the REAL digitised signals from
 * render_and_digitize.py.
 *   (4) feed the recovered waveform into the ONNX diagnostic ensemble (EcgLib 7 heads + ECG-Diagnosis
 *       + HeartGPT) via onnxruntime-node  (5) Evidence Fusion (log-odds consensus, kardiox-fusion.js)
 *   (6) ranked differential  (7) structured interpretation  (kardiox-engines.js report)
 *   (8) compare AI output vs the expected (ground-truth) label  (9) confidence + execution time + failures.
 * Runs E.analyze on BOTH the TRUE signal (model-quality upper bound) and the DIGITISED signal (the full
 * image->diagnosis path) so digitiser error is separated from model error. No mock data.
 *
 * Environment:
 *   D         workspace dir with e2e_input.json (from render_and_digitize.py) + models/ (ecglib_*.onnx +
 *             engines/ecg_diagnosis.onnx + engines/heartgpt_afib.onnx[.data]) + node_modules/onnxruntime-node.
 *   SMD_ROOT  repo root holding kardiox-fusion.js / kardiox-engines.js (default: derived from this file).
 *
 * Run:  D=/path/to/workspace node e2e_diagnose.cjs
 */
const path = require("path"), fs = require("fs");
const D = process.env.D;
const SM = process.env.SMD_ROOT || path.join(__dirname, "..", "..", "..", "..");
const ort = require(path.join(D, "node_modules", "onnxruntime-node"));
require(path.join(SM, "kardiox-fusion.js"));
const E = require(path.join(SM, "kardiox-engines.js"));
const MODELS = path.join(D, "models");
const INPUT = process.env.E2E_INPUT || "e2e_input.json";

const resolve = (file) => {
  const b = path.basename(file), a = path.join(MODELS, b), c = path.join(MODELS, "engines", b);
  return fs.existsSync(a) ? a : c;
};
const cache = {};
const ctx = { ort, ready: (f) => fs.existsSync(resolve(f)), load: (f) => cache[f] };

// expected-label -> does the AI differential contain the ground-truth diagnosis?
const MATCH = {
  AF:   (rep) => rep.differentials.some((d) => /atrial fibrillation/i.test(d.diagnosis)),
  RBBB: (rep) => rep.differentials.some((d) => /bundle branch block|rbbb/i.test(d.diagnosis)),
  PVC:  (rep) => rep.differentials.some((d) => /premature ventricular/i.test(d.diagnosis)),
  STE:  (rep) => rep.differentials.some((d) => /st elevation|stemi/i.test(d.diagnosis)),
  // SNR (normal sinus) is the negative control: correct == no urgent/critical false positive.
  SNR:  (rep) => rep.emergencyFlags.length === 0,
};
function matches(labels, rep) {
  return labels.every((l) => (MATCH[l] ? MATCH[l](rep) : rep.differentials.some((d) => new RegExp(l, "i").test(d.diagnosis))));
}
const short = (rep) => rep.differentials.slice(0, 4).map((d) => `${d.diagnosis} ${(d.probability * 100) | 0}%`).join(", ");

(async () => {
  const input = JSON.parse(fs.readFileSync(path.join(D, INPUT), "utf8"));
  const files = new Set();
  E.ENGINES.forEach((e) => (e.heads ? e.heads.map((c) => `models/ecglib_${c}.onnx`) : [e.model.file]).forEach((f) => files.add(f)));
  const loaded = [];
  for (const f of files) if (fs.existsSync(resolve(f))) { cache[f] = await ort.InferenceSession.create(resolve(f)); loaded.push(path.basename(f)); }
  console.log("ONNX sessions loaded:", loaded.join(", "), "\n");

  const results = []; let stageFail = 0;
  for (const rec of input.records) {
    const row = { record: rec.record, labels: rec.labels, fidelityMean: rec.fidelityMean,
      renderMs: rec.renderMs, digitizeMs: rec.digitizeMs };
    try {
      let t = Date.now(); const repTrue = await E.analyze(rec.true, ctx); row.inferMsTrue = Date.now() - t;
      t = Date.now(); const repDig = await E.analyze(rec.digitized, ctx); row.inferMsDig = Date.now() - t;
      row.true = { primary: repTrue.primaryDiagnosis, conf: +repTrue.primaryConfidence.toFixed(3),
        top: short(repTrue), engines: repTrue.enginesRun, emergency: repTrue.emergencyFlags,
        agree: repTrue.agreement.map((a) => a.diagnosis), match: matches(rec.labels, repTrue) };
      row.dig = { primary: repDig.primaryDiagnosis, conf: +repDig.primaryConfidence.toFixed(3),
        top: short(repDig), engines: repDig.enginesRun, emergency: repDig.emergencyFlags,
        agree: repDig.agreement.map((a) => a.diagnosis), match: matches(rec.labels, repDig),
        contributions: repDig.modelContributions.filter((m) => m.diagnoses.length).map((m) => `${m.model}[${m.diagnoses.map((d) => d.code + ":" + d.probability).join(" ")}]`),
        disagree: repDig.disagreement.map((x) => x.diagnosis), explanation: repDig.explanation };
      row.totalMs = rec.renderMs + rec.digitizeMs + row.inferMsDig;
    } catch (e) {
      row.error = String(e && e.stack || e); stageFail++;
    }
    results.push(row);

    console.log(`== ${rec.record}  [expected: ${rec.labels.join(",")}]  digitiser fidelity ${rec.fidelityMean}`);
    if (row.error) { console.log("  STAGE FAILURE:", row.error.split("\n")[0]); continue; }
    console.log(`  TRUE signal   -> ${row.true.primary} (${row.true.conf})  match=${row.true.match ? "YES" : "no"}`);
    console.log(`                  engines: ${row.true.engines.join("+")}  top: ${row.true.top}`);
    console.log(`  IMAGE->DIGITISE->dx -> ${row.dig.primary} (${row.dig.conf})  match=${row.dig.match ? "YES" : "no"}`);
    console.log(`                  engines: ${row.dig.engines.join("+")}  top: ${row.dig.top}`);
    console.log(`                  contributions: ${row.dig.contributions.join("  ") || "(none over threshold)"}`);
    if (row.dig.agree.length) console.log(`                  AGREE(>=2 engines): ${row.dig.agree.join(", ")}`);
    if (row.dig.disagree.length) console.log(`                  DISAGREE (shown): ${row.dig.disagree.join(", ")}`);
    if (row.dig.emergency.length) console.log(`                  EMERGENCY: ${row.dig.emergency.join(", ")}`);
    console.log(`                  time: render ${rec.renderMs}ms + digitise ${rec.digitizeMs}ms + infer ${row.inferMsDig}ms = ${row.totalMs.toFixed(0)}ms\n`);
  }

  const done = results.filter((r) => !r.error);
  const digMatch = done.filter((r) => r.dig.match).length, trueMatch = done.filter((r) => r.true.match).length;
  console.log("============================================================");
  console.log(`records: ${results.length} | stage failures: ${stageFail}`);
  console.log(`ground-truth agreement - TRUE signal: ${trueMatch}/${done.length} | IMAGE->dx: ${digMatch}/${done.length}`);
  console.log(`mean digitiser fidelity: ${(done.reduce((s, r) => s + (r.fidelityMean || 0), 0) / done.length).toFixed(4)}`);
  console.log(`mean end-to-end time (image->dx): ${(done.reduce((s, r) => s + r.totalMs, 0) / done.length).toFixed(0)}ms`);
  fs.writeFileSync(path.join(D, "e2e_results.json"), JSON.stringify(results, null, 2));
  console.log("wrote e2e_results.json");
  process.exit(stageFail ? 1 : 0);
})().catch((e) => { console.error("E2E FATAL", e); process.exit(2); });
