/* test/fundx-enhance.test.mjs — FundX image-enhancement pipeline (pure). */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const win = {};
new Function("window", readFileSync(new URL("../fundx-enhance.js", import.meta.url), "utf8"))(win);
const E = win.SMD_FUNDX_ENHANCE;
ok("enhance: exposed + pipeline defined", !!E && E.DEFAULT_PIPELINE.length >= 4);

function fill(w, h, fn) { const data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const [r, g, b] = fn(x, y); data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; } return { data, width: w, height: h }; }
function contrast(img) { const d = img.data; let s = 0, sq = 0, n = d.length / 4; for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; s += l; sq += l * l; } const m = s / n; return Math.sqrt(Math.max(0, sq / n - m * m)); }

// low-contrast image: luma clustered 110..140 in a gradient
const low = fill(24, 24, (x) => { const v = 110 + (x % 8) * 4; return [v, v, v]; });
const before = contrast(low);
const out = E.enhance(low);
ok("enhance: returns a NEW object (original untouched)", out !== low && out.data !== low.data);
ok("enhance: dimensions preserved", out.width === 24 && out.height === 24);
ok("enhance: low-contrast image gains contrast", contrast(out) > before);
ok("enhance: original array unmodified", contrast(low) === before);
const delta = E.metricsDelta(low, out);
ok("enhance: metricsDelta reports before/after", delta.contrastAfter > delta.contrastBefore);

// gray-world neutralises a colour cast (channel means converge)
const cast = fill(16, 16, () => [180, 120, 90]);
const wb = { data: new Uint8ClampedArray(cast.data), width: 16, height: 16 };
E.stages.grayWorld(wb);
function means(img) { const d = img.data; let r = 0, g = 0, b = 0, n = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } return [r / n, g / n, b / n]; }
const m = means(wb);
ok("enhance: grayWorld converges channel means", Math.max(m[0], m[1], m[2]) - Math.min(m[0], m[1], m[2]) < 6);

// reflection suppression lowers a bright specular spot
const glare = fill(16, 16, (x, y) => (x === 8 && y === 8) ? [255, 255, 255] : [80, 60, 50]);
const g2 = { data: new Uint8ClampedArray(glare.data), width: 16, height: 16 };
E.stages.reflectionSuppress(g2);
const oi = (8 * 16 + 8) * 4;
ok("enhance: reflectionSuppress dampens specular pixel", g2.data[oi] < 255);

// enhancer is swappable
E.registerEnhancer({ id: "noop", enhance: (img) => img });
ok("enhance: registerEnhancer swaps implementation", E.getEnhancer().id === "noop");
E.registerEnhancer(null);
ok("enhance: reverts to default pipeline", E.getEnhancer().id === "pipeline");

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
