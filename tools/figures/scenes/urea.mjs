/* Urea cycle as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/urea.mjs [--print-model]
 * Static layout here; substrate particles, ammonia, urea and gauges move in urea.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Urea cycle function", a: [1, 0.45, 0.05], names: ["normal", "partial defect", "complete defect"], ticks: ["normal", "partial defect", "complete defect"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "protein restriction" },
    { label: "nitrogen scavenger" },
    { label: "dialysis" },
  ],
  status: "Cycle: {level} \u00b7 {drug} \u00b7",
  drugNames: ["no treatment", "protein restriction", "a nitrogen scavenger", "dialysis"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const act = S.level.a[level];
  const restr = drug === 1 ? 1 : 0, scav = drug === 2 ? 1 : 0, dial = drug === 3 ? 1 : 0;
  const prod = restr ? 0.38 : 0.82;
  const fluxRaw = Math.min(prod, act * 0.9);
  const scavClear = scav ? 0.38 : 0, dialClear = dial ? 0.55 : 0;
  const resid = Math.max(0, prod - fluxRaw - scavClear - dialClear);
  const NH3 = cl(0.07 + 1.1 * resid);
  const Flux = cl(fluxRaw * 1.15);
  const Urea = Flux;
  const Brain = cl(NH3 * 0.95);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(NH3, 0.3, 0.6, ["normal", "raised", "high"]), w(Flux, 0.35, 0.7, ["very low", "reduced", "normal"]), w(Urea, 0.35, 0.7, ["very low", "reduced", "normal"])];
  return { act, restr, scav, dial, prod, fluxRaw, NH3, Flux, Urea, Brain, words, readout: "ammonia " + words[0] + " \u00b7 cycle flux " + words[1] + " \u00b7 urea " + words[2] };
}
const TESTS = [
  [0, 0, "ammonia normal \u00b7 cycle flux normal \u00b7 urea normal"],
  [1, 0, "ammonia raised \u00b7 cycle flux reduced \u00b7 urea reduced"],
  [2, 0, "ammonia high \u00b7 cycle flux very low \u00b7 urea very low"],
  [2, 3, "ammonia raised \u00b7 cycle flux very low \u00b7 urea very low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="ur-hep" x="230" y="80" width="480" height="310" rx="16"/>
<rect class="ur-mito" x="250" y="100" width="230" height="150" rx="14"/>
<ellipse id="brainGlow" class="ur-glow" cx="830" cy="160" rx="88" ry="72" opacity="0"/>
<path id="bloodline" class="ur-blood" d="M710 200 C745 195 770 188 795 175"/>
<path id="ureaV" class="ur-vessel" d="M652 302 L720 300 L779 330"/>
<path id="scavline" class="ur-scavline" d="M300 178 C460 105 650 115 790 262"/>
<path class="ur-return" d="M505 332 L368 332 L408 196"/>
<path class="ur-flowline" d="M118 210 L262 178 L315 158 L420 158 L505 214 L582 272 L505 332 L652 302"/>
<g id="brainSlot"></g>
<g id="kidneySlot"></g>
<g id="nodes"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-nh3:#e5484d;--c-urea:#c98a3d;--c-cit:#3fbfae;--c-arg:#e9b84a;--c-orn:#7fc4e8;--c-scav:#5ec1a0}
body[data-theme="light"]{--c-nh3:#c42a3d;--c-urea:#a86e28;--c-cit:#1f8f83;--c-arg:#b8860b;--c-orn:#2f7ad8;--c-scav:#2f8f6e}
.ur-hep{fill:color-mix(in srgb,var(--c-endo) 12%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 50%,var(--anatomy-mid));stroke-width:1.6}
.ur-mito{fill:color-mix(in srgb,var(--c-neut) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-neut) 55%,var(--anatomy-mid));stroke-width:1.6}
.ur-glow{fill:var(--c-cyt2);stroke:none}
.ur-cap{fill:var(--anatomy-strong);font-size:12px}
.ur-flowline{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:4 5;opacity:.55}
.ur-return{fill:none;stroke:var(--c-orn);stroke-width:1.6;stroke-dasharray:5 5;opacity:.6}
.ur-scavline{fill:none;stroke:var(--c-scav);stroke-width:1.4;stroke-dasharray:4 5;opacity:.15}
.ur-vessel{fill:none;stroke:var(--c-urea);stroke-width:10;stroke-linecap:round;opacity:.55}
.ur-blood{fill:none;stroke:var(--c-nh3);stroke-width:4;stroke-linecap:round;stroke-dasharray:8 6;opacity:.5}
.ur-node{fill:var(--anatomy-card);stroke:var(--anatomy-strong);stroke-width:1.4}
.ur-block{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.ur-mach{fill:var(--anatomy-card);stroke:var(--anatomy-strong);stroke-width:1.4}
.ur-machin{fill:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.ur-tube{fill:none;stroke:var(--anatomy-mid);stroke-width:3;stroke-linecap:round}
.p-flow{--cc:var(--c-urea)}.p-nh3{--cc:var(--c-nh3)}.p-urea{--cc:var(--c-urea)}.p-orn{--cc:var(--c-orn)}.p-scav{--cc:var(--c-scav)}.p-prot{--cc:#b08954}.p-dial{--cc:var(--c-fl)}
.dr-g-fill.g-nh3{fill:var(--c-nh3)}.dr-g-fill.g-urea{fill:var(--c-urea)}.dr-g-fill.g-cit{fill:var(--c-cit)}
`;

buildScene({
  id: "urea-cycle", fig: "Fig 1", title: "Urea cycle: turning ammonia into urea", W, H, body, extraCss,
  label: "An animated liver cell with a mitochondrion inside it, beside the brain and a kidney. Protein breakdown makes ammonia, shown as red pieces. Inside the liver cell a loop of beads carries substrate through the cycle: two steps in the mitochondrion, then citrulline, argininosuccinate and arginine in the surrounding fluid, giving urea plus ornithine, which returns to the mitochondrion. Urea travels in blood to the kidney. When a cycle step is blocked, ammonia builds up, reaches the brain and the brain glows, while urea falls. Protein restriction shrinks the protein pile, a scavenger opens a green bypass to the kidney, and dialysis connects a filter machine that traps ammonia. The level slider changes cycle function and the treatment choices are protein restriction, a nitrogen scavenger and dialysis. Gauges show ammonia, cycle flux, urea and brain effect.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "urea.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With dialysis",
  sourcesLis: [
    "<strong>How the urea cycle works.</strong> Protein and amino acid breakdown releases ammonia, which is toxic, especially to the brain. In the liver, ammonia enters the urea cycle to be made into urea, which the kidney excretes. The first steps are inside mitochondria: carbamoyl phosphate synthetase makes carbamoyl phosphate, and ornithine transcarbamylase combines it with ornithine to make citrulline. Citrulline leaves the mitochondrion and, in the cytosol, is converted through argininosuccinate to arginine. Arginase then splits arginine into urea and ornithine, and ornithine returns to the mitochondrion to start again. This is standard teaching in biochemistry and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What goes wrong in a defect.</strong> When an enzyme of the cycle is partly or completely defective, for example ornithine transcarbamylase deficiency, the cycle cannot keep up with ammonia production. Ammonia accumulates in blood (hyperammonaemia), reaches the brain and can cause vomiting, drowsiness, confusion and coma, while urea production falls. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Restricting protein reduces the ammonia load. A nitrogen scavenger provides an alternative route for nitrogen to leave the body, bypassing the blocked cycle. Dialysis directly clears ammonia from the blood in a severe crisis. These are teaching toggles only, shown as concepts without any dose or product name.",
  ],
  simplified: "Aspartate as the second nitrogen donor, fumarate and the link to the citric acid cycle, N-acetylglutamate activation of the first enzyme, other cycle defects and carriers, newborn screening, and all doses, thresholds and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
