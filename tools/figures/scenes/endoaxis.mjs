/* Hypothalamic-pituitary-thyroid feedback axis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/endoaxis.mjs [--print-model]
 * Static layout here; releasing hormone, TSH, thyroid hormone, feedback and gauges move in endoaxis.page.js.
 * Qualitative: no doses, no numeric thresholds. The thyroid axis is drawn; the adrenal (CRH, ACTH, cortisol) axis follows the same logic. */
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
  if (rmP) pc = 0.12;
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

/* ---------------- static layout ----------------
 * Left to right story: brain (hypothalamus) -> pituitary -> thyroid -> body tissues,
 * with a dashed feedback brake running back along the bottom. Organ centres:
 * brain (150, 235), pituitary (360, 250), thyroid (590, 250), body box (740..860, 225..335). */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<ellipse id="glandGlow" class="ex-glowg" cx="590" cy="250" rx="100" ry="80" opacity="0"/>
<ellipse id="tisGlow" class="ex-glow" cx="800" cy="280" rx="100" ry="85" opacity="0"/>
<path id="trhV" class="ex-portal" d="M155 263C225 260 280 252 322.6 250"/>
<path id="tshV" class="ex-ves" d="M397.4 250C445 258 530 235 614 199"/>
<path id="t4V" class="ex-ves" d="M590 304C645 307 695 304 740 300"/>
<path id="blkV" class="ex-drop" d="M590 118C590 150 590 180 590 212"/>
<path id="fbMain" class="ex-fb" d="M770 335L770 392L200 392L200 316M360 392L360 292"/>
<path id="tbP" class="ex-tbar" d="M348 292L372 292"/>
<path id="tbH" class="ex-tbar" d="M188 316L212 316"/>
<g id="brainSlot"></g>
<g id="pitSlot"></g>
<g id="thySlot"></g>
<g id="folls"></g>
<circle id="hypo" class="ex-hypo" cx="155" cy="263" r="6"/>
<g id="tisBox"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="docks"></g>
<ellipse id="ringG" class="ex-ring" cx="590" cy="250" rx="112" ry="82" opacity="0"/>
<ellipse id="ringP" class="ex-ring" cx="360" cy="250" rx="62" ry="52" opacity="0"/>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.ex-ves{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:14;stroke-linecap:round;opacity:.55}
.ex-portal{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper));stroke-width:7;stroke-linecap:round;opacity:.55}
.ex-drop{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:3 4;stroke-linecap:round;opacity:.6}
.ex-fb{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-dasharray:6 5;stroke-linecap:round}
.ex-tbar{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.ex-glow{fill:var(--c-fl);stroke:none}
.ex-glowg{fill:#ff9a3d;stroke:none}
.ex-hypo{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 50%,#000);stroke-width:1}
.ex-foll{fill:color-mix(in srgb,#ff9a3d 55%,var(--anatomy-paper));stroke:color-mix(in srgb,#ff9a3d 60%,#000);stroke-width:1}
.ex-tis{fill:var(--c-fl)}
.ex-tis-o{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.ex-rel{--cc:var(--c-cyt)}.ex-pit{--cc:var(--c-cyt2)}.ex-end{--cc:#ff9a3d}.ex-dock{--cc:var(--c-bad)}
.ex-fbp{fill:none;stroke:var(--c-bad);stroke-width:1.3}
.ex-cap2{fill:var(--c-fl)}
.ex-cap{fill:var(--anatomy-strong);font-size:12px}
.ex-ring{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-dasharray:6 5}
`;

buildScene({
  id: "endocrine-feedback-axes", fig: "Fig 1", title: "Hypothalamic pituitary feedback: the thyroid axis", W, H, body, extraCss,
  label: "One animated hormone axis drawn left to right. The hypothalamus in the brain releases TRH, which tells the pituitary to release TSH, which tells the thyroid gland to release thyroid hormone. Thyroid hormone acts on body tissues and also feeds back along the bottom to turn the pituitary and the hypothalamus down. A slider moves the fault between the gland, the pituitary and the hypothalamus, for failure or excess, and a treatment menu offers replacement, suppression or block, or removal of the source. Gauges show the releasing hormone, the pituitary hormone, the end hormone, gland size and strength of feedback. The adrenal axis follows the same pattern and is not drawn.",
  caption: "Schematic, not to scale. Hormone flow, gland size and gauge levels are qualitative and illustrative; no doses, thresholds, reference ranges or drug names are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "endoaxis.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With source removed, then replaced",
  sourcesLis: [
    "<strong>The axis drawn.</strong> The hypothalamus releases TRH (thyrotropin-releasing hormone), which makes the anterior pituitary release TSH (thyroid-stimulating hormone), which drives the thyroid gland to make thyroid hormone (T4, T3). Thyroid hormone sets the metabolic pace of body tissues and feeds back on both the pituitary and the hypothalamus (negative feedback), so its level is held near a set point. TSH also keeps the gland grown. The adrenal axis (CRH, ACTH, cortisol) follows the same pattern and is not drawn. This is standard teaching in endocrinology and physiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Reading the fault.</strong> In primary failure the gland cannot respond, so thyroid hormone is low and TSH is high. In secondary or tertiary failure the pituitary or hypothalamus fails, so thyroid hormone is low and TSH is low. In primary excess the gland makes hormone on its own, so TSH is suppressed. In secondary excess a pituitary growth escapes feedback, so TSH stays high and drives the gland. Replacing hormone in a healthy axis, or blocking it in a failing one, pushes the axis the wrong way.",
    "<strong>Treatment ideas shown.</strong> Replacing the missing end hormone, suppressing or blocking an excess one, and removing the source (the overactive gland or the pituitary growth), with replacement after removal. Removing a source without replacing leaves the axis low. These are teaching toggles only, with no agent names or doses.",
  ],
  simplified: "The adrenal axis and all other pituitary hormones, thyroid hormone conversion and binding, immune and other causes, ectopic sources, tertiary excess, dynamic tests, the care needed when a source is removed or an axis is replaced, and all doses and targets are left out. Gland size and hormone flow are illustrative, and the figure does not say how any patient should be treated or monitored.",
});
