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

console.log(`kardiox-digitize-learned: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
