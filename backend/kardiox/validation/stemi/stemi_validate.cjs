/* STEMI before/after validation on the REAL PTB-XL set (stemi_valset.json): NN-only vs the hybrid
 * (NN + rule-based ST detector) through the real kardiox-engines pipeline via onnxruntime-node.
 * Reports sensitivity / specificity / accuracy, per-group false positives (incl. the RBBB/LBBB stress),
 * and per-territory sensitivity. No mock data. */
const path = require("path"), fs = require("fs");
const D = process.env.D, SM = process.env.SMD_ROOT || path.join(__dirname, "..", "..", "..", "..");
const ort = require(path.join(D, "node_modules", "onnxruntime-node"));
require(path.join(SM, "kardiox-fusion.js"));
require(path.join(SM, "kardiox-stemi.js"));
const E = require(path.join(SM, "kardiox-engines.js"));
const MODELS = path.join(D, "models");
const resolve = (file) => { const b = path.basename(file), a = path.join(MODELS, b), c = path.join(MODELS, "engines", b); return fs.existsSync(a) ? a : c; };
const cache = {};
const baseCtx = { ort, ready: (f) => fs.existsSync(resolve(f)), load: (f) => cache[f] };
const flaggedSTE = (rep) => rep.differentials.some((d) => /st elevation|stemi/i.test(d.diagnosis)) || rep.emergencyFlags.some((f) => /st elevation/i.test(f));

(async () => {
  const set = JSON.parse(fs.readFileSync(path.join(D, process.env.VALSET || "stemi_valset.json"), "utf8"));
  const files = new Set();
  E.ENGINES.forEach((e) => (e.heads ? e.heads.map((c) => `models/ecglib_${c}.onnx`) : [e.model.file]).forEach((f) => files.add(f)));
  for (const f of files) if (fs.existsSync(resolve(f))) cache[f] = await ort.InferenceSession.create(resolve(f));

  const rows = [];
  for (const r of set) {
    const nn = await E.analyze(r.signal, { ...baseCtx });                      // NN only
    const hy = await E.analyze(r.signal, { ...baseCtx, stemi: {}, fs: r.fs }); // NN + rule
    rows.push({ record: r.record, group: r.group, territory: r.territory,
      nnSTE: flaggedSTE(nn), hySTE: flaggedSTE(hy),
      nnPrimary: nn.primaryDiagnosis, hyPrimary: hy.primaryDiagnosis,
      ruleFired: hy.enginesRun.indexOf("stemi-rule") >= 0 });
  }
  const pos = rows.filter((r) => r.group === "stemi"), neg = rows.filter((r) => r.group !== "stemi");
  const metric = (key) => {
    const tp = pos.filter((r) => r[key]).length, tn = neg.filter((r) => !r[key]).length;
    return { sens: +(tp / pos.length).toFixed(3), spec: +(tn / neg.length).toFixed(3),
      acc: +((tp + tn) / rows.length).toFixed(3), tp, fn: pos.length - tp, tn, fp: neg.length - tn };
  };
  const nnM = metric("nnSTE"), hyM = metric("hySTE");

  console.log(`STEMI validation on REAL PTB-XL — ${pos.length} STEMI+ / ${neg.length} negatives (${neg.filter(r=>r.group==='normal').length} NORM, ${neg.filter(r=>r.group==='rbbb').length} RBBB, ${neg.filter(r=>r.group==='lbbb').length} LBBB)\n`);
  console.log("                sensitivity  specificity  accuracy   TP/FN   TN/FP");
  console.log(`  NN only        ${nnM.sens}        ${nnM.spec}        ${nnM.acc}      ${nnM.tp}/${nnM.fn}    ${nnM.tn}/${nnM.fp}`);
  console.log(`  HYBRID (NN+rule)${hyM.sens}        ${hyM.spec}        ${hyM.acc}      ${hyM.tp}/${hyM.fn}    ${hyM.tn}/${hyM.fp}\n`);

  // per-territory sensitivity (hybrid)
  const terrs = {}; pos.forEach((r) => { (terrs[r.territory] = terrs[r.territory] || { n: 0, hit: 0 }).n++; if (r.hySTE) terrs[r.territory].hit++; });
  console.log("  hybrid sensitivity by territory:", Object.entries(terrs).map(([t, v]) => `${t} ${v.hit}/${v.n}`).join("  "));
  // false positives by negative group (hybrid)
  ["normal", "rbbb", "lbbb"].forEach((g) => {
    const gr = neg.filter((r) => r.group === g), fp = gr.filter((r) => r.hySTE);
    console.log(`  hybrid false-positive on ${g}: ${fp.length}/${gr.length}${fp.length ? " -> " + fp.map((r) => r.record).join(",") : ""}`);
  });
  // records the hybrid newly catches / newly loses vs NN
  const gained = pos.filter((r) => r.hySTE && !r.nnSTE), lost = pos.filter((r) => !r.hySTE && r.nnSTE);
  console.log(`\n  STEMI+ gained by hybrid: ${gained.length} (${gained.map(r=>r.record+"/"+r.territory).join(", ")||"none"})`);
  console.log(`  STEMI+ lost by hybrid:   ${lost.length} (${lost.map(r=>r.record).join(", ")||"none"})`);
  fs.writeFileSync(path.join(D, "stemi_validation.json"), JSON.stringify({ nn: nnM, hybrid: hyM, rows }, null, 2));
  console.log("\nwrote stemi_validation.json");
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
