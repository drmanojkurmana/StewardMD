/* Goal 2 inference stage: run each auto-detected/digitised layout through the reconstruction layer +
 * the real inference path. Full coverage (12x1) -> dense signal -> multi-engine ensemble + hybrid STEMI
 * (render is calibrated mV). Partial (3x4/6x2) -> rhythm-strip rate + SAFE deferral (ensemble never fed
 * fabricated data), exactly as the reconstruction layer prescribes. Reports per layout: detected layout,
 * coverage, whether the ensemble ran, dx, rhythm rate, and digitiser fidelity. No mock data. */
const path = require("path"), fs = require("fs");
const D = process.env.D, SM = process.env.SMD_ROOT || path.join(__dirname, "..", "..", "..", "..");
const ort = require(path.join(D, "node_modules", "onnxruntime-node"));
require(path.join(SM, "kardiox-fusion.js")); require(path.join(SM, "kardiox-stemi.js"));
const RECON = require(path.join(SM, "kardiox-reconstruct.js"));
const ORT = require(path.join(SM, "kardiox-ort.js"));
const E = require(path.join(SM, "kardiox-engines.js"));
const MODELS = path.join(D, "models");
const resolve = (f) => { const b = path.basename(f), a = path.join(MODELS, b), c = path.join(MODELS, "engines", b); return fs.existsSync(a) ? a : c; };
const cache = {}; const ctx = { ort, ready: (f) => fs.existsSync(resolve(f)), load: (f) => cache[f], stemi: {}, fs: 500 };
const STD12 = RECON.STD12;
function corr(a, b) { const n = Math.min(a.length, b.length); a = a.slice(0, n); b = b.slice(0, n); const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let na = 0, nb = 0, d = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; d += x * y; na += x * x; nb += y * y; } return (na < 1e-9 || nb < 1e-9) ? null : d / Math.sqrt(na * nb); }

(async () => {
  const input = JSON.parse(fs.readFileSync(path.join(D, "layouts_input.json"), "utf8"));
  const files = new Set(); E.ENGINES.forEach((e) => (e.heads ? e.heads.map((c) => `models/ecglib_${c}.onnx`) : [e.model.file]).forEach((f) => files.add(f)));
  for (const f of files) if (fs.existsSync(resolve(f))) cache[f] = await ort.InferenceSession.create(resolve(f));

  const rows = [];
  for (const rec of input.records) {
    const recon = RECON.reconstruct(rec.digitized);
    const dense = RECON.toDense(recon);
    const row = { record: rec.record, labels: rec.labels, trueLayout: rec.trueLayout, detected: rec.detected.layout,
      coverage: +recon.overallCoverage.toFixed(2), full: recon.full, rhythm: recon.confidence.rhythm };
    // digitiser fidelity: per-lead corr of covered window vs true (12x1 = full 10s; 3x4/6x2 = the cell window)
    const fids = [];
    for (let li = 0; li < 12; li++) {
      const name = STD12[li], seg = rec.digitized.leads[name]; if (!seg) continue;
      const colWin = RECON.LAYOUTS[recon.layout].leadColumns[name], cs = RECON.LAYOUTS[recon.layout].secondsPerCell;
      const isStrip = name === recon.rhythmLead; const t0 = isStrip ? 0 : colWin * cs, cnt = seg.mv.length;
      const trueSeg = rec.true[li].slice(Math.round(t0 * 500), Math.round(t0 * 500) + cnt);
      const c = corr(seg.mv, trueSeg); if (c != null) fids.push(Math.abs(c));
    }
    row.fidelity = fids.length ? +(fids.reduce((s, x) => s + x, 0) / fids.length).toFixed(3) : null;

    if (dense.dense) {
      const rep = await E.analyze(dense.dense, ctx);
      row.ensembleRan = true; row.primary = rep.primaryDiagnosis; row.conf = +rep.primaryConfidence.toFixed(2);
      row.top = rep.differentials.slice(0, 3).map((d) => `${d.diagnosis} ${(d.probability * 100) | 0}%`).join(", ");
      row.emergency = rep.emergencyFlags;
    } else {
      row.ensembleRan = false;
      const strip = RECON.rhythmLeadSignal(recon);
      const rp = strip ? ORT.rpeaks(strip, recon.fs) : { bpm: null, regularity: "n/a" };
      row.rhythmRate = rp.bpm; row.rhythmReg = rp.regularity;
      row.deferReason = "partial coverage -> ensemble not run on fabricated data; rhythm strip only";
    }
    rows.push(row);
    const dx = row.ensembleRan ? `ENSEMBLE: ${row.primary} (${row.conf})${row.emergency.length ? " [" + row.emergency.join(",") + "]" : ""}` : `DEFER (rhythm ${row.rhythmRate || "?"}bpm ${row.rhythmReg})`;
    console.log(`${rec.record} ${rec.trueLayout}->${rec.detected.layout} cov=${row.coverage} fid=${row.fidelity} | ${dx}`);
  }

  console.log("\n── per-layout summary ──");
  ["12x1", "3x4", "6x2"].forEach((L) => {
    const g = rows.filter((r) => r.trueLayout === L);
    const det = g.filter((r) => r.detected === L).length, ens = g.filter((r) => r.ensembleRan).length;
    const fid = (g.reduce((s, r) => s + (r.fidelity || 0), 0) / g.length).toFixed(3);
    console.log(`  ${L}: layout-detected ${det}/${g.length} | ensemble ran ${ens}/${g.length} | mean fidelity ${fid} | ${ens ? "full-coverage 12-lead dx" : "rhythm-strip rate + safe deferral"}`);
  });
  fs.writeFileSync(path.join(D, "layouts_results.json"), JSON.stringify(rows, null, 2));
  console.log("wrote layouts_results.json");
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
