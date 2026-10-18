/* Glaucoma and aqueous humour flow as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/glauc.mjs [--print-model]
 * Static layout here; aqueous flow, iris, angle, optic cup and gauges move in glauc.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Angle state", a: [0.95, 0.4, 0.1], names: ["open angle", "closed angle", "acute closure"], ticks: ["open angle", "closed angle", "acute"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "reduce production (aqueous suppressant drops)" },
    { label: "increase outflow (outflow drops)" },
    { label: "laser (peripheral iridotomy)" },
  ],
  status: "Angle: {level} · {drug} ·",
  drugNames: ["no treatment", "reduce production", "increase outflow", "laser iridotomy"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const angleRaw = S.level.a[level], laser = drug === 3 ? 1 : 0, reduce = drug === 1 ? 1 : 0, incOut = drug === 2 ? 1 : 0;
  let angle = angleRaw;
  if (laser && level === 1) angle = 0.9;
  if (laser && level === 2) angle = 0.85;
  const prod = reduce ? 0.32 : 0.75;
  const outflow = cl(angle * (incOut ? 1.25 : 0.9) + (incOut ? 0.12 : 0));
  const iop = cl(0.12 + prod * (1.05 - outflow));
  const cup = cl(0.05 + 0.85 * iop * iop + (level === 2 ? 0.12 : level === 1 ? 0.08 : 0));
  const vision = cl(1 - cup * 0.95);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(iop, 0.3, 0.55, ["normal", "raised", "high"]), w(outflow, 0.3, 0.65, ["blocked", "reduced", "open"]), w(cup, 0.25, 0.5, ["healthy", "cupping", "severe cupping"])];
  return { angleRaw, angle, laser, reduce, incOut, prod, outflow, iop, cup, vision, words, readout: "pressure " + words[0] + " · outflow " + words[1] + " · optic nerve " + words[2] };
}
const TESTS = [
  [0, 0, "pressure normal · outflow open · optic nerve healthy"],
  [2, 0, "pressure high · outflow blocked · optic nerve severe cupping"],
  [2, 2, "pressure high · outflow blocked · optic nerve severe cupping"],
  [2, 3, "pressure raised · outflow open · optic nerve cupping"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="396" rx="18"/>
<rect class="sc-tissue" x="584" y="44" width="362" height="194" rx="18"/>
<rect class="sc-tissue" x="584" y="246" width="362" height="194" rx="18"/>
<text class="sc-zone" x="34" y="68">EYE: AQUEOUS FLOW</text>
<text class="sc-zone" x="604" y="68">OPTIC DISC, ENLARGED</text>
<text class="sc-zone" x="604" y="270">ANGLE, ENLARGED</text>
<g id="eye"></g>
<g id="flow"></g>
<g id="disc"></g>
<g id="angled"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "glaucoma-aqueous", fig: "Fig 1", title: "Glaucoma: aqueous flow, pressure and the optic nerve", W, H, body,
  label: "An animated eye showing aqueous humour made by the ciliary body, flowing through the pupil into the front chamber and draining through the trabecular meshwork. When the angle between iris and cornea closes, drainage fails and pressure rises, cupping the optic disc. An enlarged optic disc and an enlarged angle view are shown. Gauges show production, angle, outflow, pressure, cupping and vision. Treatments reduce production, increase outflow, or use laser to bypass a blocked pupil.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, pressures or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "glauc.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With laser",
  sourcesLis: [
    "<strong>How aqueous humour flows.</strong> The ciliary body makes aqueous humour into the posterior chamber. It flows forward through the pupil into the anterior chamber, then drains at the iridocorneal angle through the trabecular meshwork into the canal of Schlemm and episcleral veins. A smaller share leaves by the uveoscleral route. This is standard teaching in ophthalmology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Open and closed angle glaucoma.</strong> In open angle glaucoma the angle looks open but trabecular drainage works poorly, so pressure rises slowly and the optic disc cups with gradual visual field loss. In closed angle glaucoma the iris blocks the angle; in acute closure the iris bows forward, the chamber shallows, drainage stops and pressure rises fast with pain and blurred vision. Raised pressure damages retinal ganglion cell axons at the optic disc, enlarging the cup. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Drops that reduce aqueous production, drops that increase trabecular or uveoscleral outflow, and laser peripheral iridotomy, which makes a small hole in the peripheral iris so aqueous can bypass a blocked pupil and the iris falls back. These are teaching toggles only.",
  ],
  simplified: "Uveoscleral drainage detail, episcleral venous pressure, diurnal pressure variation, visual field patterns, retinal nerve fibre layer imaging, normal pressure glaucoma, secondary causes, surgery such as trabeculectomy, and all doses and pressure targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.gl-sclera{fill:color-mix(in srgb,var(--anatomy-paper) 88%,var(--c-fl));stroke:var(--anatomy-mid);stroke-width:1.6}
.gl-cornea{fill:color-mix(in srgb,var(--c-fl) 22%,transparent);stroke:var(--c-fl);stroke-width:1.8}
.gl-chamber{fill:color-mix(in srgb,var(--c-fl) 16%,transparent)}
.gl-lens{fill:color-mix(in srgb,var(--c-b) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-b) 55%,#000);stroke-width:1.2}
.gl-iris{fill:none;stroke:#8a5aa8;stroke-width:11;stroke-linecap:round}
body[data-theme="light"] .gl-iris{stroke:#7a4498}
.cl-ciliary{--cc:var(--c-mac)}
.gl-vitreous{fill:color-mix(in srgb,var(--c-lymph) 10%,transparent)}
.gl-nerve{fill:color-mix(in srgb,var(--c-plt) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1.2}
.gl-disc{fill:color-mix(in srgb,var(--c-plt) 38%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1.2}
.gl-cup{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.gl-vessel{fill:none;stroke:var(--c-rbc);stroke-width:2;stroke-linecap:round}
.gl-vessel.ven{stroke:var(--c-fl)}
.gl-trab{fill:none;stroke:var(--c-good);stroke-width:2.4;stroke-linecap:round}
.gl-canal{fill:none;stroke:var(--c-cyt2);stroke-width:3;stroke-linecap:round}
.gl-laser{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-dasharray:5 3;stroke-linecap:round}
.gl-hole{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4}
.p-aq{--cc:var(--c-fl)}
.dr-g-fill.g-aq{fill:var(--c-fl)}.dr-g-fill.g-angle{fill:var(--c-good)}.dr-g-fill.g-cup{fill:var(--c-bad)}
`,
});
