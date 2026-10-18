/* Dose and response at receptors as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/dose.mjs [--print-model]
 * Left: log concentration and response curves. Right: receptors in a cell membrane, binding and the cell response.
 * Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ----------------
 * level = drug concentration (relative units inside the model only, never shown).
 * drug 0 full agonist alone, 1 partial agonist alone,
 * drug 2 full agonist with a competitive antagonist, 3 full agonist with a non-competitive antagonist.
 * Response reaches its ceiling before every receptor is occupied: spare receptors.
 * Competitive block fades as concentration rises (surmountable, same ceiling, curve shifted right).
 * Non-competitive block lowers the ceiling at any concentration (not surmountable). */
const MD = {
  level: { label: "Drug concentration", a: [0.08, 0.35, 1], names: ["low", "medium", "high"], ticks: ["low", "medium", "high"], start: 1 },
  drugLabel: "Drug at the receptor",
  settings: [
    { label: "full agonist" },
    { label: "partial agonist" },
    { label: "full agonist with competitive antagonist" },
    { label: "full agonist with non-competitive antagonist" },
  ],
  status: "Concentration: {level} · {drug} ·",
  drugNames: ["full agonist", "partial agonist", "full agonist with a competitive antagonist", "full agonist with a non-competitive antagonist"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Emax = [1, 0.6, 1, 0.45][drug];
  const shift = drug === 2 ? 3.5 : 1;
  const Resp = cl(Emax * a / (0.18 * shift + a));
  const RespFull = cl(a / (0.18 + a));
  const Occ = cl(a / ((drug === 2 ? 1.58 : 0.45) + a));
  const Block = drug === 2 ? cl(1 - Resp / Math.max(0.01, RespFull)) : drug === 3 ? 0.55 : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Occ, 0.35, 0.65, ["few", "some", "most"]), w(Resp, 0.35, 0.65, ["low", "moderate", "high"]), Emax < 0.7 ? "reduced" : "full"];
  return { a, drug, Emax, shift, Resp, Occ, Block, words, readout: "binding " + words[0] + " \u00B7 response " + words[1] + " \u00B7 ceiling " + words[2] };
}
const TESTS = [
  [2, 0, "binding most \u00B7 response high \u00B7 ceiling full"],
  [2, 1, "binding most \u00B7 response moderate \u00B7 ceiling reduced"],
  [2, 2, "binding some \u00B7 response moderate \u00B7 ceiling full"],
  [0, 2, "binding few \u00B7 response low \u00B7 ceiling full"],
];

/* ---------------- static layout ----------------
 * Graph panel x14-500, cell panel x510-946, both y44-440. Gauges panel below (from y448).
 * Graph plot: x84-474 (log concentration), y85-350 (response, top is the ceiling).
 * Concentration ticks for low, medium, high sit at x187, 319, 412 under the axis.
 * Label pills (centres checked against each other, the axes and the panel titles):
 *   graph: Efficacy 390,78 and Potency 140,120 - well apart, clear of the zone title at left.
 *   cell: Receptor 585,88 and Agonist 795,88 on the top row; Competitive blocker 645,152 and
 *   Non-competitive blocker 835,152 on the next row (only one is visible at a time, and their
 *   boxes do not touch anyway); Cell response 625,368, Inverse agonist 825,318 and
 *   Spare receptors 825,368 along the bottom, each clear of the next. */
const GX0 = 84, GX1 = 474, GY0 = 85, GY1 = 350;
const body = `
<rect class="sc-tissue dose-bg" x="14" y="44" width="486" height="396" rx="18"/>
<rect class="sc-tissue dose-bg" x="510" y="44" width="436" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">DOSE AND RESPONSE</text>
<text class="sc-zone" x="530" y="68">RECEPTOR AND CELL</text>
<g id="graph"></g>
<path class="dose-axis" d="M${GX0} ${GY0}V${GY1}H${GX1}"/>
<path class="dose-grid" d="M${GX0} ${(GY0 + GY1) / 2}H${GX1}"/>
<text class="sc-lab dose-ylab" transform="rotate(-90 44 218)" x="44" y="218" text-anchor="middle">response</text>
<text class="sc-lab" x="187" y="368" text-anchor="middle">low</text>
<text class="sc-lab" x="319" y="368" text-anchor="middle">medium</text>
<text class="sc-lab" x="412" y="368" text-anchor="middle">high</text>
<text class="sc-lab" x="280" y="392" text-anchor="middle">drug concentration</text>
<text class="sc-lab dose-curvelab" id="curvelab" x="474" y="414" text-anchor="end">full agonist</text>
<g id="cellfx"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-full:#38d1ff;--c-part:#e9b84a;--c-comp:#ff7a9a;--c-noncomp:#c084fc;--c-lig:#38d1ff;--c-sig:#3ddc97}
body[data-theme="light"]{--c-full:#0a7fd1;--c-part:#b57f0a;--c-comp:#d13a5e;--c-noncomp:#7c3aed;--c-lig:#0a7fd1;--c-sig:#0f9f76}
.dose-bg{opacity:.35}
.dose-axis{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.dose-grid{fill:none;stroke:var(--anatomy-faint);stroke-width:1;stroke-dasharray:4 4}
.dose-ylab{letter-spacing:.05em}
.dose-curvelab{fill:var(--anatomy-strong);font-weight:700}
.dose-curve{fill:none;stroke-width:2;stroke-linecap:round}
.dc0{stroke:var(--c-full)}.dc1{stroke:var(--c-part)}.dc2{stroke:var(--c-comp)}.dc3{stroke:var(--c-noncomp)}
.dose-marker{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:2}
.dose-dash{stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:3 3}
.dose-plateau{stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:5 4}
.dose-arrow{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6}
.cell-body{fill:color-mix(in srgb,var(--c-mac) 16%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.cell-glow{fill:var(--c-sig)}
.membr{fill:color-mix(in srgb,var(--c-endo) 45%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.rec-stem{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.rec-pocket{stroke:var(--anatomy-strong);stroke-width:1.2}
.rec-fill{fill:var(--c-lig)}
.rec-allo{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.lig-p{fill:var(--c-lig);stroke:color-mix(in srgb,var(--c-lig) 50%,#000);stroke-width:.5}
.ant-c{fill:var(--c-comp);stroke:color-mix(in srgb,var(--c-comp) 50%,#000);stroke-width:.5}
.ant-n{fill:var(--c-noncomp);stroke:color-mix(in srgb,var(--c-noncomp) 50%,#000);stroke-width:.5}
.sig-p{fill:var(--c-sig)}
.basal-p{fill:var(--anatomy-mid)}
`;

buildScene({
  id: "dose-response-receptors", fig: "Fig 1", title: "Dose and response at receptors", W, H, body, extraCss,
  label: "An animated dose and response graph beside receptors in a cell membrane. Raising the drug concentration binds more receptors and raises the response. A full agonist reaches the full ceiling, a partial agonist reaches only part of it, a competitive antagonist shifts the curve to the right with the same ceiling, and a non-competitive antagonist lowers the ceiling. Gauges show binding, response, the ceiling and antagonist block.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, concentrations or drug names are shown or implied.",
  scene: { W, H, GX0, GX1, GY0, GY1 }, pageJs: readFileSync(join(HERE, "dose.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Full agonist alone", withLabel: "With a partial agonist or an antagonist",
  sourcesLis: [
    "<strong>Binding and response.</strong> A drug binds reversibly to a receptor. More concentration means more receptors occupied (binding, or occupancy) until binding saturates. The response also rises and then levels at a ceiling (the maximum effect, called efficacy). The concentration position of the curve is potency: a curve further left needs less drug for the same effect. Response can reach its ceiling before every receptor is bound, because the cell amplifies the signal: these unneeded receptors are called spare receptors. This is standard teaching in pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Agonists and antagonists shown.</strong> A full agonist binds and fully switches the receptor on. A partial agonist binds but only partly switches it on, so its ceiling is lower however much is given. A competitive antagonist binds the same site reversibly without switching the receptor on: more agonist can out-compete it, so the curve shifts right with the same ceiling (surmountable). A non-competitive antagonist binds a separate site or disables the receptor, so the ceiling itself falls and more agonist cannot restore it. An inverse agonist (explained in the figure, not a selectable drug) binds and lowers the resting activity that some receptors show on their own. These are teaching toggles only.",
  ],
  simplified: "Binding curves measured separately from responses, receptor subtypes and signalling pathways, desensitisation and tolerance, allosteric modulators that only change the agonist effect, irreversible antagonists in detail, and every named drug and dose are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
