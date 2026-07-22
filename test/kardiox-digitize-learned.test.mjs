/* test/kardiox-digitize-learned.test.mjs — learned-digitiser JS core (SMD_KARDIOX_DIGITIZE_LEARNED).
 * Verifies preprocessing (resize + z-score) and turning a segmentation label map into per-lead traces,
 * with an injected fake native segmenter. The real model runs on-device via the native ORT plugin. */
import { readFileSync } from "node:fs";

globalThis.window = globalThis;
new Function(readFileSync(new URL("../kardiox-digitize-learned.js", import.meta.url), "utf8"))();
const L = globalThis.SMD_KARDIOX_DIGITIZE_LEARNED;
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log("  x FAIL:", n)); };

ok("module exposed", !!L && typeof L.digitize === "function" && L.LABELS.length === 13);

// preprocess: any image → tensor [1,1,1024,1280], z-scored (mean~0, std~1)
const W0 = 120, H0 = 60, data = new Uint8ClampedArray(W0 * H0 * 4);
for (let i = 0; i < W0 * H0; i++) { const v = (i * 37) % 256; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
const pre = L.preprocess({ width: W0, height: H0, data });
ok("preprocess dims [1,1,1024,1280]", JSON.stringify(pre.dims) === JSON.stringify([1, 1, 1024, 1280]) && pre.data.length === 1024 * 1280);
let m = 0; for (let i = 0; i < pre.data.length; i++) m += pre.data[i]; m /= pre.data.length;
let s = 0; for (let i = 0; i < pre.data.length; i++) s += (pre.data[i] - m) ** 2; s = Math.sqrt(s / pre.data.length);
ok("preprocess z-score (mean~0, std~1)", Math.abs(m) < 1e-3 && Math.abs(s - 1) < 1e-2);

// build a synthetic segmentation label map (1024x1280): lead I as a flat line in a left cell,
// lead II as a sine across the full width (rhythm strip); III absent.
const PW = L.PATCH_W, PH = L.PATCH_H, lab = new Uint8Array(PW * PH);
function ink(x, y, c) { for (let t = -2; t <= 2; t++) { const yy = y + t; if (x >= 0 && x < PW && yy >= 0 && yy < PH) lab[yy * PW + x] = c; } }
for (let x = 0; x <= 300; x++) ink(x, 200, 1);                                  // lead I: y=200, cols 0..300
for (let x = 0; x < PW; x++) ink(x, Math.round(900 + 40 * Math.sin(x / PW * 6 * Math.PI)), 2); // lead II: full-width sine
const leads = L.labelMapToLeadTraces(lab, PW, PH);

ok("lead I detected in its cell", leads.I.present && leads.I.xRange[0] <= 2 && Math.abs(leads.I.xRange[1] - 300) <= 3);
ok("lead I trace tracks y~200", leads.I.present && Math.abs(leads.I.trace[150] - 200) <= 2);
ok("lead II detected full-width (rhythm strip)", leads.II.present && leads.II.widthFrac > 0.95);
const col = Math.round(PW * 0.25), expY = 900 + 40 * Math.sin(col / PW * 6 * Math.PI); // xRange[0]~0 so trace idx≈col
ok("lead II trace follows the sine", leads.II.present && Math.abs(leads.II.trace[col - leads.II.xRange[0]] - expY) <= 6);
ok("absent lead III reported not present", leads.III && leads.III.present === false);

// digitize() with a fake native segmenter returning the label map
const res = await L.digitize({ width: W0, height: H0, data }, { segment: (f32, dims) => { ok("native runner gets [1,1,1024,1280] float input", dims[2] === 1024 && dims[3] === 1280 && f32.length === 1024 * 1280); return Promise.resolve(lab); } });
ok("digitize returns per-lead traces + method", res.method === "learned-nnunet-onnx" && res.leads.I.present && res.leads.II.present);

// ── signal RECONSTRUCTION: segmentation label map → {leads:{mv,fs}} → SMD_KARDIOX_RECONSTRUCT ──
new Function(readFileSync(new URL("../kardiox-reconstruct.js", import.meta.url), "utf8"))();
const R = globalThis.SMD_KARDIOX_RECONSTRUCT;
ok("reconstruct module + segmentToDigitized exposed", !!R && typeof R.reconstruct === "function" && typeof L.segmentToDigitized === "function");

const SW = 768, SH = 512;
function paint(lab, W, x, y, c) { for (let t = -2; t <= 2; t++) { const yy = y + t; if (x >= 0 && x < W && yy >= 0 && yy < SH) lab[yy * W + x] = c; } }
const NAME2C = {}; L.LABELS.forEach((n, i) => { NAME2C[n] = i; });

// A) 12x1 full-disclosure — every lead a continuous full-width row → real 12-lead ensemble path.
const labA = new Uint8Array(SW * SH);
for (let c = 1; c <= 12; c++) { const cy = 18 + c * 40; for (let x = 0; x < SW; x++) paint(labA, SW, x, Math.round(cy + 8 * Math.sin(x / SW * 8 * Math.PI)), c); }
const digA = L.segmentToDigitized(labA, SW, SH);
ok("12x1: layout detected", digA && digA.layout === "12x1");
ok("12x1: 12 leads, each ~10s (5000 @ 500Hz)", digA && Object.keys(digA.leads).length === 12 && digA.leads.V6.mv.length === 5000 && digA.leads.I.mv.length === 5000);
const recA = R.reconstruct(digA);
ok("12x1: reconstruct → full coverage (feeds the ensemble)", recA && recA.samples === 5000 && recA.fs === 500 && !!R.toDense(recA).dense);

// B) 3x4 + rhythm strip — 2.5s cells + a full-width lead-II strip. Lead II appears TWICE (cell + strip).
const GRID = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]];
const labB = new Uint8Array(SW * SH);
const topH = Math.floor(SH * 0.78), rowH = Math.floor(topH / 3), colW = Math.floor(SW / 4);
for (let r = 0; r < 3; r++) for (let cc = 0; cc < 4; cc++) {
  const c = NAME2C[GRID[r][cc]], cy = r * rowH + Math.floor(rowH / 2), x0 = cc * colW + 6, x1 = cc * colW + colW - 6;
  for (let x = x0; x < x1; x++) paint(labB, SW, x, Math.round(cy + 18 * Math.sin((x - x0) / (x1 - x0) * 4 * Math.PI)), c);
}
const stripY = topH + Math.floor((SH - topH) / 2);                              // full-width lead-II rhythm strip
for (let x = 0; x < SW; x++) paint(labB, SW, x, Math.round(stripY + 20 * Math.sin(x / SW * 12 * Math.PI)), NAME2C.II);
const digB = L.segmentToDigitized(labB, SW, SH);
ok("3x4: layout detected", digB && digB.layout === "3x4");
ok("3x4: rhythm lead is II", digB && digB.rhythmLead === "II");
ok("3x4: duplicate lead-II resolved to the 10s STRIP (not the 2.5s cell, not merged garbage)", digB && digB.leads.II.mv.length === 5000);
ok("3x4: grid cells are ~2.5s (1250 samples)", digB && digB.leads.aVR.mv.length === 1250 && digB.leads.V3.mv.length === 1250);
const recB = R.reconstruct(digB);
ok("3x4: reconstruct → PARTIAL (ensemble deferred, no fabrication)", recB && recB.samples === 5000 && !R.toDense(recB).dense);
ok("3x4: lead-II strip is the continuous rhythm lead", recB && R.rhythmLeadSignal(recB) && R.rhythmLeadSignal(recB).length === 5000);

// C) too few leads → null (caller falls back to the honest segmentation card)
const labC = new Uint8Array(SW * SH);
for (let x = 0; x < 300; x++) { paint(labC, SW, x, 100, 1); paint(labC, SW, x, 200, 2); }
ok("<3 leads → segmentToDigitized returns null", L.segmentToDigitized(labC, SW, SH) === null);
ok("empty / size-mismatch label map → null", L.segmentToDigitized(new Uint8Array(10), SW, SH) === null);

console.log(`kardiox-digitize-learned: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
