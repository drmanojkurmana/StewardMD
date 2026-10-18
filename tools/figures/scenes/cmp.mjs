/* Cardiomyopathies as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/cmp.mjs [--print-model]
 * Static layout here; the heart organ, cutaway overlays, flow and gauges move in cmp.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Cardiomyopathy type", a: [1, 1, 1], names: ["dilated", "hypertrophic", "restrictive"], ticks: ["dilated", "hypertrophic", "restrictive"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "heart failure therapy" },
    { label: "beta blocker or septal reduction" },
    { label: "treat the cause" },
    { label: "full bundle: all of the above" },
  ],
  status: "Type: {level} · {drug} ·",
  drugNames: ["no treatment", "heart failure therapy", "a beta blocker or septal reduction", "treating the cause", "the full bundle"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const hf = drug === 1 || drug === 4 ? 1 : 0, bb = drug === 2 || drug === 4 ? 1 : 0, cause = drug === 3 || drug === 4 ? 1 : 0;
  const P0 = level === 0 ? 1 : 0, P1 = level === 1 ? 1 : 0, P2 = level === 2 ? 1 : 0;
  let Dil = P0 ? 0.92 : P1 ? 0.24 : 0.30;
  let Wall = P0 ? 0.18 : P1 ? 0.92 : 0.46;
  let Stiff = P0 ? 0.30 : P1 ? 0.55 : 0.95;
  let Dia = P0 ? 0.45 : P1 ? 0.78 : 0.92;
  let Sys = P0 ? 0.88 : P1 ? 0.24 : 0.34;
  let Out = P1 ? 0.86 : 0.05;
  if (hf) { Sys = cl(Sys - (P0 ? 0.36 : 0.08)); Dia = cl(Dia - 0.10); Dil = cl(Dil - (P0 ? 0.06 : 0)); }
  if (bb) { Out = cl(Out - (P1 ? 0.66 : 0.02)); Dia = cl(Dia - (P1 ? 0.26 : 0.05)); }
  if (cause) { Dil = cl(Dil - (P0 ? 0.30 : 0.03)); Stiff = cl(Stiff - (P2 ? 0.32 : 0.05)); Dia = cl(Dia - (P2 ? 0.32 : P0 ? 0.16 : 0.05)); Sys = cl(Sys - (P0 ? 0.25 : P2 ? 0.05 : 0.02)); Wall = cl(Wall - (P2 ? 0.06 : 0)); Out = cl(Out - (P1 ? 0.05 : 0)); }
  const Fill = cl(1 - Dia), Ej = cl(1 - Sys);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Dil, 0.35, 0.65, ["small", "normal", "dilated"]), w(Wall, 0.35, 0.65, ["thin", "normal", "thick"]), w(Fill, 0.35, 0.65, ["poor", "reduced", "good"]), w(Ej, 0.35, 0.65, ["poor", "reduced", "good"])];
  return { hf, bb, cause, P0, P1, P2, Dil, Wall, Stiff, Dia, Sys, Out, Fill, Ej, words, readout: "chamber " + words[0] + " · wall " + words[1] + " · filling " + words[2] + " · ejection " + words[3] };
}
const TESTS = [
  [0, 0, "chamber dilated · wall thin · filling reduced · ejection poor"],
  [1, 0, "chamber small · wall thick · filling poor · ejection good"],
  [2, 0, "chamber small · wall normal · filling poor · ejection good"],
  [0, 1, "chamber dilated · wall thin · filling good · ejection reduced"],
  [1, 2, "chamber small · wall thick · filling reduced · ejection good"],
  [2, 3, "chamber small · wall normal · filling reduced · ejection good"],
  [0, 4, "chamber normal · wall thin · filling good · ejection good"],
  [2, 4, "chamber small · wall normal · filling reduced · ejection good"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CAUSES</text>
<text class="sc-zone" x="400" y="68">HEART</text>
<text class="sc-zone" x="640" y="68">BLOOD OUT</text>
<g id="causes"></g><g id="heartSlot"></g><g id="heart"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cardiomyopathies", fig: "Fig 1", title: "Cardiomyopathies: three ways the ventricle fails", W, H, body,
  label: "An animated real heart in dilated, hypertrophic and restrictive cardiomyopathy. In dilated disease the ventricle stretches, the wall thins and squeezing fails, after causes such as alcohol, viral myocarditis and genetic disease. In hypertrophic disease the septum thickens and blocks outflow. In restrictive disease amyloid deposits stiffen the wall so filling fails. Blood flows in from the left and leaves for the body on the right. Gauges show dilatation, wall thickness, stiffness, filling, ejection and outflow block. Treatment choices are heart failure therapy, a beta blocker or septal reduction, treating the cause, and a full bundle of all of them.",
  caption: "Schematic, not to scale. Chamber sizes, speeds and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cmp.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With the full bundle",
  sourcesLis: [
    "<strong>What cardiomyopathy means.</strong> A cardiomyopathy is disease of heart muscle where the cardiac muscle itself fails, without valve, coronary or pressure overload explaining it. The three classic patterns are dilated (ventricular dilatation, thin wall, systolic failure), hypertrophic (septal hypertrophy, dynamic outflow obstruction, diastolic dysfunction and sudden death risk) and restrictive (a stiff ventricle, classically from amyloid, with poor filling). This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Causes shown on the left.</strong> Multiple causes are implicated, often together in a patient with an initial insult and systemic involvement. Shown examples are alcohol, viral myocarditis, inherited gene changes and amyloid deposits. Myocarditis is inflammation of heart muscle that can heal, scar or progress to a dilated ventricle. These are teaching associations only.",
    "<strong>Treatment ideas shown.</strong> Heart failure therapy unloads a failing ventricle so it squeezes better, a beta blocker slows and softens contraction so the outflow tract opens, septal reduction thins the bulging septum, treating the cause removes alcohol, infection or amyloid triggers, and the full bundle does all of these together. These are teaching toggles only.",
  ],
  simplified: "Genetic subtypes and testing, arrhythmia devices and anticoagulation, transplant and mechanical support, specific amyloid therapies, imaging measurements, exercise advice and all doses and drug choices are left out. The heart is real anatomy art with a schematic cutaway overlay that shows chamber size, wall thickness and deposits. The figure does not say how any patient should be treated.",
  extraCss: `
.cmp-node{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.cmp-ic{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.8}
.cmp-ic2{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.cmp-ic3{fill:none;stroke:var(--c-lymph);stroke-width:2;stroke-linecap:round}
.cmp-ic4{fill:none;stroke:var(--c-cyt);stroke-width:1.6;stroke-linecap:round}
.cmp-icd{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.6}
.cmp-ves{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-linecap:round;opacity:.85}
.cmp-vesIn{fill:none;stroke:color-mix(in srgb,var(--c-fl) 55%,var(--anatomy-paper));stroke-linecap:round;opacity:.85}
.cmp-cav{fill:color-mix(in srgb,var(--c-rbc) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:1}
.cmp-ring{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--c-tis));stroke-linecap:round}
.cmp-bulge{fill:color-mix(in srgb,var(--c-rbc) 62%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.cmp-wall{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-linecap:round}
.cmp-shade{fill:var(--c-bad);stroke:none}
.cmp-halo{fill:none;stroke:var(--c-fl);stroke-linecap:round}
.cmp-amy{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.6}
.cmp-rec{fill:none;stroke:var(--c-lymph);stroke-width:1.6;stroke-linecap:round}
.cmp-arrow{fill:var(--c-rbc);stroke:none}
.p-in{--cc:var(--c-fl)}.p-out{--cc:var(--c-rbc)}.p-turb{--cc:var(--c-eos)}.p-blk{--cc:var(--c-lymph)}.p-sup{--cc:var(--c-fl)}.p-clr{--cc:var(--c-cyt)}
.cmp-cap{fill:var(--anatomy-strong);font-size:13px}
.dr-g-fill.g-dil{fill:var(--c-bad)}.dr-g-fill.g-wall{fill:var(--c-neut)}.dr-g-fill.g-stiff{fill:var(--c-cyt)}.dr-g-fill.g-fill{fill:var(--c-fl)}.dr-g-fill.g-ej{fill:var(--c-good)}.dr-g-fill.g-out{fill:var(--c-eos)}
`,
});
