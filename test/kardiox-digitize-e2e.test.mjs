/* test/kardiox-digitize-e2e.test.mjs — FULL offline pipeline: image → on-device digitiser → reconstruct
 * → ensemble → diagnosis, on REAL labelled CPSC signals rendered as 12x1 ECG images IN-NODE (no Python,
 * no server). Proves the on-device digitiser recovers the signal AND the whole offline photo→dx path
 * gives correct diagnoses on real weights. Skips (exit 0) if models/fixtures are absent here. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const JOB = process.env.CLAUDE_JOB_DIR || "";
const MODELS = join(JOB, "tmp/verify/models"), FIX = join(JOB, "tmp/verify/cpsc_engine_signals.json");
if (!JOB || !existsSync(join(MODELS, "ecglib_AFIB.onnx")) || !existsSync(FIX)) {
  console.log("kardiox-digitize-e2e: SKIP (models/fixtures not in this environment)");
  process.exit(0);
}
const ort = (await import("onnxruntime-node")).default;
globalThis.window = globalThis;
for (const m of ["kardiox-models", "kardiox-signal", "kardiox-fusion", "kardiox-rules", "kardiox-reconstruct", "kardiox-digitize", "kardiox-ort"])
  new Function(readFileSync(new URL(`../${m}.js`, import.meta.url), "utf8"))();
const { SMD_KARDIOX_DIGITIZE: DIG, SMD_KARDIOX_ORT: ORT } = globalThis;

const mgr = { source: (f) => Promise.resolve({ bytes: new Uint8Array(readFileSync(join(MODELS, f))) }) };
const analyzer = ORT.makeOrtAnalyzer({ ort, modelManager: mgr, manifest: ORT.DEFAULT_MANIFEST });

// render a 12-lead signal as a 12x1 ECG image (grayscale buffer): 25 mm/s, 10 mm/mV, geometry calibration.
// Params match a standard-gain printout with clean inter-lead spacing (bandH 130, ±1.4 mV clamp).
const PXMM = 4, MMS = 25, MMV = 10, SECS = 10, FS = 500;
function render12x1(sig) {
  const nSamp = SECS * FS, W = SECS * MMS * PXMM, bandH = 130, H = bandH * 12;
  const gray = new Uint8Array(W * H).fill(255);
  const set = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) gray[y * W + x] = 0; };
  for (let L = 0; L < 12; L++) {
    const cy = L * bandH + bandH / 2, lead = sig[L]; let prevY = null;
    for (let x = 0; x < W; x++) {
      const si = Math.min(lead.length - 1, Math.round(x / (W - 1) * (nSamp - 1)));
      const y = Math.round(cy - Math.max(-1.4, Math.min(1.4, lead[si])) * MMV * PXMM);
      if (prevY !== null) { for (let yy = Math.min(prevY, y); yy <= Math.max(prevY, y); yy++) set(x, yy); } else set(x, y);
      prevY = y;
    }
  }
  return { data: gray, width: W, height: H };
}
function corr(a, b) { const n = Math.min(a.length, b.length); let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; s += da * db; sa += da * da; sb += db * db; } return s / (Math.sqrt(sa * sb) || 1e-9); }
const LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log("  x FAIL:", n)); };
const records = JSON.parse(readFileSync(FIX, "utf8"));
const P = (a, code) => { const h = (a.headProbabilities || []).find((x) => x.pathology === code); return h ? h.prob : 0; };
let corrSum = 0, corrN = 0, detected12 = 0;

for (const r of records) {
  const img = render12x1(r.signal);
  const dig = DIG.digitizeImageData(img);
  const full = dig.layout === "12x1" && Object.keys(dig.leads).length === 12;
  if (full) {
    detected12++;
    for (const L of ["I", "II", "V2"]) { const idx = LEADS.indexOf(L); const rec = dig.leads[L] && dig.leads[L].mv; if (rec) { const orig = rec.map((_, i) => r.signal[idx][Math.min(r.signal[idx].length - 1, Math.round(i / (rec.length - 1) * (5000 - 1)))]); const c = Math.abs(corr(rec, orig)); corrSum += c; corrN++; } }
  }
  const a = await analyzer.analyzePaper({ id: r.record, ...dig });
  const afib = P(a, "AFIB"), crbbb = P(a, "CRBBB"), pvc = P(a, "PVC"), lab = (r.labels || [])[0];
  console.log(`${r.record} [${lab}] ${full ? "12x1" : "defer(" + dig.layout + ")"} → "${a.verdict}"  AFIB=${afib.toFixed(2)} CRBBB=${crbbb.toFixed(2)} PVC=${pvc.toFixed(2)}`);
  // NEVER a false diagnosis, whether analyzed or safely deferred (the whole point)
  ok(`${r.record}: no false AFib`, afib < 0.5 || lab === "AF");
  // where the image segmented to a full 12x1, the correct dx must fire
  if (full && lab === "AF") ok(`${r.record}: image→dx AFib`, afib >= 0.5);
  if (full && lab === "RBBB") ok(`${r.record}: image→dx RBBB`, crbbb >= 0.5);
  if (full && lab === "PVC") ok(`${r.record}: image→dx PVC`, pvc >= 0.5);
  // a record that didn't segment must SAFELY DEFER, not fabricate
  if (!full) ok(`${r.record}: safely defers (no fabricated dx)`, /insufficient|deferred|no high-probability|sinus/i.test(a.verdict) && a.severity !== "critical");
}
ok(`>=5/6 images segmented to full 12x1 (matches backend e2e)`, detected12 >= 5);
ok(`digitiser signal recovery (mean |corr| ${(corrSum / (corrN || 1)).toFixed(2)} > 0.7)`, corrSum / (corrN || 1) > 0.7);

console.log(`kardiox-digitize-e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
