/* Hypothalamic-pituitary feedback axes (thyroid and adrenal) as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/endoaxis.mjs [--print-model]
 * Static layout here; hormones, feedback and gauges move in endoaxis.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: {
    label: "Where the axis is disturbed", a: [0, 1, 2, 3, 4, 5],
    names: ["intact axis", "primary failure (the gland)", "secondary failure (the pituitary)", "tertiary failure (the hypothalamus)", "primary excess (the gland)", "secondary excess (the pituitary)"],
    ticks: ["intact", "gland fails", "pituitary fails", "hypothalamus fails", "gland excess", "pituitary excess"], start: 1,
  },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "replace the end hormone" },
    { label: "suppress or block the end hormone" },
    { label: "remove the source" },
    { label: "remove the source, then replace the end hormone" },
  ],
  status: "Axis: {level} · {drug} ·",
  drugNames: ["no treatment", "end-hormone replacement", "suppression or block", "source removed", "source removed, then replacement"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const rep = drug === 1 || drug === 4 ? 1 : 0, blk = drug === 2 ? 1 : 0, rem = drug === 3 || drug === 4 ? 1 : 0;
  const rmG = rem && level === 4 ? 1 : 0, rmP = rem && level === 5 ? 1 : 0;
  let cap = 1, pc = 1, hc = 1, auto = 0, ad = 0;
  if (level === 1) cap = 0.18;
  if (level === 2) pc = 0.15;
  if (level === 3) hc = 0.15;
  if (level === 4) { if (rmG) cap = 0.06; else auto = 1; }
  if (level === 5 && !rmP) ad = 1;
  let H = 0.5, P = 0.5, G = 0.5;
  for (let i = 0; i < 80; i++) {
    const h = hc * cl(1 - G);
    const p = ad ? cl(0.98 - 0.15 * G) : pc * cl(1.4 * h * (1 - 0.6 * G));
    const g = cl((auto ? 0.92 : cap * p) * (blk ? 0.5 : 1) + 0.5 * rep);
    H += 0.4 * (h - H); P += 0.4 * (p - P); G += 0.4 * (g - G);
  }
  const gs = rmG ? 0.06 : level === 1 ? 0.3 : level === 4 ? 0.85 : cl(0.5 + 0.55 * (P - 0.5));
  const ps = ad ? 1.3 : level === 2 ? 0.8 : 1;
  const rp = level === 2 ? 0.25 : ad ? 0.15 : 1, rh = level === 3 ? 0.25 : 1;
  const w = (v, ws) => (v < 0.3 ? ws[0] : v < 0.7 ? ws[1] : ws[2]);
  const words = [w(P, ["low", "normal", "high"]), w(G, ["low", "normal", "high"]), w(G, ["under-supplied", "balanced", "over-exposed"])];
  return { H, P, G, gs, ps, rp, rh, rep, blk, rmG, rmP, brake: G, words,
    readout: "pituitary drive " + words[0] + " · end hormone " + words[1] + " · tissues " + words[2] };
}
const TESTS = [
  [0, 0, "pituitary drive normal · end hormone normal · tissues balanced"],
  [1, 0, "pituitary drive high · end hormone low · tissues under-supplied"],
  [4, 0, "pituitary drive low · end hormone high · tissues over-exposed"],
  [5, 2, "pituitary drive high · end hormone normal · tissues balanced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path class="ax-div" d="M480 56V428"/>
<g id="arrows"></g>
<g id="nodes"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.ax-div{stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:2 6;opacity:.5}
.ax-a{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.fb-l{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-dasharray:5 4;stroke-linecap:round}
.fb-t{fill:none;stroke:var(--c-bad);stroke-width:3.2;stroke-linecap:round}
.ax-tis{fill:var(--c-fl)}
.ax-tis-o{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.ax-st{fill:var(--anatomy-strong);font:600 11px var(--anatomy-mono);pointer-events:none}
.ax-ring{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-dasharray:5 4}
.p-rel{--cc:var(--c-cyt)}.p-pit{--cc:var(--c-cyt2)}.p-end{--cc:#ff9a3d}.p-cap .p-pill{fill:var(--anatomy-paper)}
.p-fb{fill:none;stroke:var(--c-bad);stroke-width:1.3}
.p-blk{fill:var(--c-bad)}
`;

buildScene({
  id: "endocrine-feedback-axes", fig: "Fig 1", title: "Hypothalamic-pituitary feedback axes", W, H, body, extraCss,
  label: "Two animated hormone axes side by side, the thyroid axis and the adrenal axis. In each, the hypothalamus releases a releasing hormone, which tells the pituitary to release a trophic hormone, which tells the end gland to release its hormone. The end hormone acts on body tissues and also feeds back to turn the pituitary and hypothalamus down. A slider moves the fault between the gland, pituitary and hypothalamus, for failure or excess, and a treatment menu offers replacement, suppression, or removal of the source. Gauges show the releasing hormone, pituitary hormone, end hormone, gland size and strength of feedback.",
  caption: "Schematic, not to scale. Hormone flow, gland size and gauge levels are qualitative and illustrative; no doses, thresholds, reference ranges or drug names are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "endoaxis.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>The axes.</strong> The hypothalamus releases TRH (thyroid axis) or CRH (adrenal axis). These make the anterior pituitary release TSH or ACTH, which drive the thyroid gland or the adrenal cortex to make thyroid hormone (T4, T3) or cortisol. The end hormone feeds back on both the pituitary and the hypothalamus (negative feedback), so the end hormone is held near a set level. TSH and ACTH also keep their gland grown. This is standard teaching in endocrinology and physiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Reading the fault.</strong> In primary failure the gland cannot respond, so the end hormone is low and the pituitary hormone is high. In secondary or tertiary failure the pituitary or hypothalamus fails, so the end hormone is low and the pituitary hormone is low or inappropriately normal (central hypothyroidism, secondary adrenal insufficiency). In primary excess the gland makes hormone on its own, so the pituitary hormone is suppressed. In secondary excess a pituitary tumour escapes feedback, so the pituitary hormone stays high and drives the gland (for example Cushing disease). Replacing an end hormone in a healthy axis, or blocking it in a failing one, pushes the axis the wrong way.",
    "<strong>Treatment ideas shown.</strong> Replacing the missing end hormone, suppressing or blocking an excess one, and removing the source (the overactive gland or the pituitary tumour). These are teaching toggles only, with no agent names or doses.",
  ],
  simplified: "Aldosterone and the renin system, thyroid hormone conversion and binding, immune and autoimmune causes, ectopic ACTH and other non-pituitary sources, tertiary excess, pituitary hormones other than TSH and ACTH, dynamic tests, the care needed when a source is removed or an axis is replaced (including stress cover for cortisol), and all doses and targets are left out. Gland size and hormone flow are illustrative, and the figure does not say how any patient should be treated or monitored.",
});
