/* test/kardiox-digitize.test.mjs — on-device ECG digitiser core (SMD_KARDIOX_DIGITIZE).
 * Rasterises KNOWN traces into a grayscale buffer, digitises, and checks layout detection + that the
 * recovered mV waveform matches the drawn signal. Pure pixels — no canvas/DOM (validated on real
 * rendered ECGs in the node verification harness; visual/photo fidelity is validated on-device). */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log("  x FAIL:", n)); };

globalThis.window = globalThis;
new Function(readFileSync(new URL("../kardiox-digitize.js", import.meta.url), "utf8"))();
const D = globalThis.SMD_KARDIOX_DIGITIZE;
ok("module exposed", !!D && typeof D.digitizeImageData === "function");

// Pearson correlation
function corr(a, b) {
  const n = Math.min(a.length, b.length); let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return sab / (Math.sqrt(saa * sbb) || 1e-9);
}

// Rasterise a 12x1 ECG: 12 horizontal bands, each a distinct sinusoid drawn as 3px-thick black ink on white.
function render12x1(W, H) {
  const gray = new Uint8Array(W * H).fill(255);
  const bandH = Math.floor(H / 12), amp = bandH * 0.30, ideal = [];
  for (let L = 0; L < 12; L++) {
    const cy = L * bandH + bandH / 2, freq = 2 + L * 0.4, wav = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      const s = Math.sin(2 * Math.PI * freq * x / W); wav[x] = s;
      const y = Math.round(cy + amp * s);
      for (let t = -1; t <= 1; t++) { const yy = y + t; if (yy >= 0 && yy < H) gray[yy * W + x] = 0; }
    }
    ideal.push(wav);
  }
  return { data: gray, width: W, height: H, ideal, bandH };
}

const W = 900, H = 1200;
const img = render12x1(W, H);
const res = D.digitizeImageData({ width: W, height: H, data: img.data });

ok("layout auto-detected as 12x1", res.layout === "12x1");
ok("all 12 leads digitised", Object.keys(res.leads).length === 12 && ["I", "II", "V6"].every((l) => res.leads[l] && res.leads[l].mv.length > 0));
ok("mv resampled to 10 s @ 500 Hz (5000)", res.leads.I.mv.length === 5000);
ok("calibration present (geometry fallback, no grid)", res.calibration && res.calibration.pxPerMm > 0 && res.calibration.method === "geometry");
ok("amplitudeReliable is honestly false (classical)", res.amplitudeReliable === false);

// waveform recovery: recovered mV should track the drawn sinusoid (sign-agnostic: image-y inversion)
let good = 0;
for (const L of ["I", "II", "III", "aVR", "V1", "V3", "V6"]) {
  const idx = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"].indexOf(L);
  // resample the ideal wave to 5000 to compare
  const mv = res.leads[L].mv, ideal = img.ideal[idx], id5000 = mv.map((_, i) => ideal[Math.round(i / (mv.length - 1) * (W - 1))]);
  const c = Math.abs(corr(mv, id5000));
  if (c > 0.8) good++; else console.log(`    ${L}: |corr|=${c.toFixed(2)}`);
}
ok("recovered waveforms track the drawn signal (|corr|>0.8 for 7/7 leads)", good === 7);

// 3x4 + rhythm strip: 3 trace rows + a full-width bottom strip → layout 3x4. Rows are drawn like a REAL
// ECG (dense flat baseline + periodic QRS spikes) so the smoothed row-ink profile shows a clear band per
// row — matching how the layout detector reads real photos (an unrealistic dense sine does not).
function drawRow(gray, W, H, x0, w, cy, amp, beats) {
  for (let x = 0; x < w; x++) {
    const ph = (x / w * beats) % 1; let dy = 0;
    if (ph > 0.45 && ph < 0.5) dy = -amp; else if (ph >= 0.5 && ph < 0.54) dy = amp * 0.4;
    const y = Math.round(cy + dy);
    for (let t = -1; t <= 1; t++) { const yy = y + t; if (x0 + x < W && yy >= 0 && yy < H) gray[yy * W + (x0 + x)] = 0; }
  }
}
function render3x4(W, H) {
  const gray = new Uint8Array(W * H).fill(255);
  const rowH = Math.floor(H * 0.78 / 3), cellW = Math.floor(W / 4);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) drawRow(gray, W, H, c * cellW, cellW, r * rowH + rowH / 2, rowH * 0.30, 4);
  drawRow(gray, W, H, 0, W, Math.floor(H * 0.89), 40, 10);   // full-width rhythm strip
  return { data: gray, width: W, height: H };
}
const r34 = D.digitizeImageData(render3x4(W, H));
ok("layout auto-detected as 3x4 with rhythm strip", r34.layout === "3x4" && r34.rhythmLead === "II");
ok("3x4 cells → 2.5 s windows + a 10 s rhythm II", r34.leads.I.mv.length === 1250 && r34.leads.II.mv.length === 5000);

console.log(`kardiox-digitize: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
